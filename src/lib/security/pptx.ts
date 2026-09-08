import { Worker } from "node:worker_threads";
export { LEGACY_PPT_MIME, PPTX_MIME } from "./source-formats";

export type PptxExtractionErrorCode =
  | "pptx_parser_unavailable"
  | "pptx_parse_failed"
  | "powerpoint_binary_or_encrypted_unsupported";

export interface PptxExtraction {
  text: string;
  truncated: boolean;
}

const MAX_PPTX_ENTRIES = 1_000;
const MAX_PPTX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_PPTX_COMPRESSION_RATIO = 100;
const PPTX_WORKER_TIMEOUT_MS = 10_000;

export function pptxError(code: PptxExtractionErrorCode, message: string): Error & { sourceErrorCode: PptxExtractionErrorCode } {
  return Object.assign(new Error(message), { sourceErrorCode: code });
}

export function isPptxExtractionError(error: unknown, code?: PptxExtractionErrorCode): error is Error & { sourceErrorCode: PptxExtractionErrorCode } {
  if (typeof error !== "object" || error === null || !("sourceErrorCode" in error)) return false;
  const value = (error as { sourceErrorCode?: unknown }).sourceErrorCode;
  return (
    value === "pptx_parser_unavailable" ||
    value === "pptx_parse_failed" ||
    value === "powerpoint_binary_or_encrypted_unsupported"
  ) && (code === undefined || value === code);
}

interface PptxEntry {
  name: string;
  nameBytes: Uint8Array;
  compressionMethod: 0 | 8;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

export interface PptxArchive {
  entries: PptxEntry[];
  totalCompressed: number;
  totalUncompressed: number;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new Error("Malformed PPTX archive");
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error("Malformed PPTX archive");
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function hasZip64Extra(bytes: Uint8Array, offset: number, length: number): boolean {
  const end = offset + length;
  if (offset < 0 || end > bytes.byteLength) throw new Error("Malformed PPTX archive");
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) throw new Error("Malformed PPTX archive");
    const type = readUint16(bytes, cursor);
    const size = readUint16(bytes, cursor + 2);
    cursor += 4;
    if (cursor + size > end) throw new Error("Malformed PPTX archive");
    if (type === 0x0001) return true;
    cursor += size;
  }
  return false;
}

function decodeName(nameBytes: Uint8Array, flags: number): string {
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
  } catch {
    throw new Error("PPTX archive filename is not valid UTF-8");
  }
  if (!name || name.includes("\\") || name.includes("\u0000") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new Error("PPTX archive contains an unsafe filename");
  }
  if ((flags & 0x0800) === 0 && /[^\x00-\x7f]/.test(name)) {
    // Non-UTF-8 names are ambiguous across ZIP readers.  ASCII package paths
    // remain valid and avoid decoding a legacy code page differently.
    throw new Error("PPTX archive filename encoding is unsupported");
  }
  const segments = name.split("/");
  const isDirectory = name.endsWith("/");
  if (isDirectory) segments.pop();
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("PPTX archive contains an unsafe filename");
  }
  return name;
}

/**
 * Validate a PPTX ZIP central directory before any XML parser or decompressor
 * runs.  The parser intentionally rejects ZIP64, data descriptors, encrypted
 * entries, ambiguous filenames, overlapping ranges, unsupported compression,
 * and archives whose declared expansion exceeds the bounded extraction cap.
 */
export function parsePptxZip(bytes: Uint8Array): PptxArchive {
  const minEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minEocdOffset; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Malformed PPTX archive");

  const diskNumber = readUint16(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUint16(bytes, eocdOffset + 6);
  const entriesOnDisk = readUint16(bytes, eocdOffset + 8);
  const entryCount = readUint16(bytes, eocdOffset + 10);
  const centralDirectorySize = readUint32(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(bytes, eocdOffset + 16);
  const commentLength = readUint16(bytes, eocdOffset + 20);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) throw new Error("Multi-disk PPTX archives are not supported");
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) throw new Error("ZIP64 PPTX archives are not supported");
  if (eocdOffset + 22 + commentLength !== bytes.byteLength) throw new Error("Malformed PPTX archive");
  if (entryCount > MAX_PPTX_ENTRIES || centralDirectoryOffset < 0 || centralDirectoryOffset + centralDirectorySize > eocdOffset) throw new Error("PPTX archive exceeds entry limits");

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let cursor = centralDirectoryOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  const structuralRanges: Array<[number, number]> = [];
  const names = new Set<string>();
  const entries: PptxEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralDirectoryEnd || readUint32(bytes, cursor) !== 0x02014b50) throw new Error("Malformed PPTX archive");
    const flags = readUint16(bytes, cursor + 8);
    const compressionMethod = readUint16(bytes, cursor + 10);
    const compressedSize = readUint32(bytes, cursor + 20);
    const uncompressedSize = readUint32(bytes, cursor + 24);
    const filenameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentSize = readUint16(bytes, cursor + 32);
    const diskStart = readUint16(bytes, cursor + 34);
    const localHeaderOffset = readUint32(bytes, cursor + 42);
    const recordLength = 46 + filenameLength + extraLength + commentSize;
    if (cursor + recordLength > centralDirectoryEnd) throw new Error("Malformed PPTX archive");
    if ((flags & 0x0001) !== 0 || diskStart !== 0) throw new Error("Encrypted or multi-disk PPTX archives are not supported");
    if ((flags & 0x0008) !== 0) throw new Error("PPTX data-descriptor archives are not supported");
    if ((flags & 0x0020) !== 0 || (flags & 0x0040) !== 0) throw new Error("Unsupported PPTX ZIP flags");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff || hasZip64Extra(bytes, cursor + 46 + filenameLength, extraLength)) throw new Error("ZIP64 PPTX archives are not supported");
    if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error("Unsupported PPTX compression method");
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + filenameLength);
    const name = decodeName(nameBytes, flags);
    if (names.has(name)) throw new Error("PPTX archive contains duplicate filenames");
    names.add(name);

    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_PPTX_UNCOMPRESSED_BYTES) throw new Error("PPTX archive exceeds decompressed size limit");

    if (localHeaderOffset + 30 > centralDirectoryOffset || readUint32(bytes, localHeaderOffset) !== 0x04034b50) throw new Error("Malformed PPTX archive");
    const localFlags = readUint16(bytes, localHeaderOffset + 6);
    const localMethod = readUint16(bytes, localHeaderOffset + 8);
    const localFilenameLength = readUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (
      localFlags !== flags ||
      localMethod !== compressionMethod ||
      localFilenameLength !== filenameLength ||
      dataOffset < 0 ||
      dataOffset > centralDirectoryOffset ||
      dataEnd < dataOffset ||
      dataEnd > centralDirectoryOffset
    ) throw new Error("Malformed PPTX archive");
    for (let nameIndex = 0; nameIndex < filenameLength; nameIndex += 1) {
      if (bytes[cursor + 46 + nameIndex] !== bytes[localHeaderOffset + 30 + nameIndex]) throw new Error("Malformed PPTX archive");
    }
    if (hasZip64Extra(bytes, localHeaderOffset + 30 + localFilenameLength, localExtraLength)) throw new Error("ZIP64 PPTX archives are not supported");
    const localCrc = readUint32(bytes, localHeaderOffset + 14);
    const localCompressedSize = readUint32(bytes, localHeaderOffset + 18);
    const localUncompressedSize = readUint32(bytes, localHeaderOffset + 22);
    const centralCrc = readUint32(bytes, cursor + 16);
    if (localCrc !== centralCrc || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize) throw new Error("Malformed PPTX archive");
    structuralRanges.push([localHeaderOffset, dataOffset], [dataOffset, dataEnd]);
    entries.push({ name, nameBytes, compressionMethod: compressionMethod as 0 | 8, flags, compressedSize, uncompressedSize, dataOffset });
    cursor += recordLength;
  }
  if (cursor !== centralDirectoryEnd) throw new Error("Malformed PPTX archive");
  structuralRanges.sort(([left], [right]) => left - right);
  for (let index = 1; index < structuralRanges.length; index += 1) {
    const previous = structuralRanges[index - 1];
    const current = structuralRanges[index];
    if (previous[1] > previous[0] && current[1] > current[0] && previous[1] > current[0]) throw new Error("Malformed PPTX archive");
  }
  if (totalUncompressed > 0 && (totalCompressed === 0 || totalUncompressed > totalCompressed * MAX_PPTX_COMPRESSION_RATIO)) throw new Error("PPTX archive compression ratio exceeds limit");
  if (!names.has("[Content_Types].xml") || !names.has("ppt/presentation.xml") || !names.has("ppt/_rels/presentation.xml.rels")) throw new Error("PPTX package parts are incomplete");
  return { entries, totalCompressed, totalUncompressed };
}

export function preflightPptxZip(bytes: Uint8Array): void {
  parsePptxZip(bytes);
}

const PPTX_WORKER_SOURCE = `
  const { parentPort } = require("node:worker_threads");
  const { createInflateRaw } = require("node:zlib");
  const MAX_UNCOMPRESSED = 50 * 1024 * 1024;
  const MAX_RATIO = 100;
  const MAX_SLIDES = 300;
  const MAX_CHARS = 100000;
  const PptxError = (code) => ({ ok: false, errorCode: code });
  const read16 = (bytes, offset) => {
    if (offset < 0 || offset + 2 > bytes.byteLength) throw new Error("Malformed PPTX archive");
    return bytes[offset] | (bytes[offset + 1] << 8);
  };
  const read32 = (bytes, offset) => {
    if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error("Malformed PPTX archive");
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  };
  const clamp = (value) => {
    const normalized = String(value || "").replace(/\\u0000/g, "").replace(/\\r\\n/g, "\\n").trim();
    return { text: normalized.slice(0, MAX_CHARS), truncated: normalized.length > MAX_CHARS };
  };
  const decodeXml = (value) => String(value).replace(/&(#x[0-9a-f]+|#\\d+|lt|gt|amp|quot|apos);/gi, (full, entity) => {
    const lower = String(entity).toLowerCase();
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error("Unsupported XML entity");
    return String.fromCodePoint(code);
  });
  const rejectUnsafeXml = (xml) => {
    if (typeof xml !== "string" || /<!DOCTYPE|<!ENTITY|<!\\[CDATA\\[/i.test(xml)) throw new Error("Unsafe PPTX XML");
  };
  const attr = (element, name) => {
    const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')/g;
    let match;
    while ((match = pattern.exec(element))) if (match[1] === name) return decodeXml(match[2] ?? match[3] ?? "");
    return null;
  };
  const normalizeTarget = (base, target) => {
    if (!target || target.startsWith("/") || target.includes("\\\\") || target.includes("\\u0000") || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) throw new Error("Unsafe PPTX relationship target");
    const segments = (base + target).split("/");
    const resolved = [];
    for (const segment of segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") throw new Error("Unsafe PPTX relationship target");
      else resolved.push(segment);
    }
    const value = resolved.join("/");
    if (!value || value.startsWith("/") || value.includes("..")) throw new Error("Unsafe PPTX relationship target");
    return value;
  };
  const inflateAndCount = (bytes, entry, totalCompressed, totalActual) => new Promise((resolve, reject) => {
    const compressedEnd = entry.dataOffset + entry.compressedSize;
    if (!Number.isSafeInteger(entry.dataOffset) || !Number.isSafeInteger(entry.compressedSize) || entry.dataOffset < 0 || entry.compressedSize < 0 || compressedEnd < entry.dataOffset || compressedEnd > bytes.byteLength) {
      reject(new Error("Malformed PPTX archive")); return;
    }
    const compressed = Buffer.from(bytes.buffer, bytes.byteOffset + entry.dataOffset, entry.compressedSize);
    const inflater = createInflateRaw();
    const chunks = [];
    let actual = 0;
    let settled = false;
    const fail = (error) => { if (settled) return; settled = true; inflater.destroy(); reject(error); };
    inflater.on("data", (chunk) => {
      actual += chunk.byteLength;
      if (actual > entry.uncompressedSize || totalActual + actual > MAX_UNCOMPRESSED || totalActual + actual > totalCompressed * MAX_RATIO) {
        fail(new Error("PPTX archive exceeds actual decompressed limits")); return;
      }
      chunks.push(chunk);
    });
    inflater.once("error", (error) => fail(error));
    inflater.once("end", () => {
      if (settled) return;
      settled = true;
      if (actual !== entry.uncompressedSize) { reject(new Error("PPTX archive actual size does not match declaration")); return; }
      resolve(Buffer.concat(chunks));
    });
    try { inflater.end(compressed); } catch (error) { fail(error); }
  });
  const decompress = async (bytes, entry, totalCompressed, totalActual) => {
    if (entry.compressionMethod === 0) {
      const end = entry.dataOffset + entry.compressedSize;
      if (!Number.isSafeInteger(entry.dataOffset) || !Number.isSafeInteger(entry.compressedSize) || end < entry.dataOffset || entry.dataOffset < 0 || end > bytes.byteLength || entry.compressedSize !== entry.uncompressedSize) throw new Error("PPTX archive actual size does not match declaration");
      if (totalActual + entry.uncompressedSize > MAX_UNCOMPRESSED || totalActual + entry.uncompressedSize > totalCompressed * MAX_RATIO) throw new Error("PPTX archive exceeds actual decompressed limits");
      return Buffer.from(bytes.buffer, bytes.byteOffset + entry.dataOffset, entry.compressedSize);
    }
    if (entry.compressionMethod === 8) return inflateAndCount(bytes, entry, totalCompressed, totalActual);
    throw new Error("Unsupported PPTX compression method");
  };
  const parseRelationships = (xml, base) => {
    rejectUnsafeXml(xml);
    const map = new Map();
    const pattern = /<Relationship\\b([\\s\\S]*?)(?:\\/?>)/gi;
    let match;
    while ((match = pattern.exec(xml))) {
      const body = match[1];
      const id = attr(body, "Id");
      const type = attr(body, "Type");
      const target = attr(body, "Target");
      const mode = attr(body, "TargetMode");
      if (!id || !type || !target || mode && mode.toLowerCase() !== "internal") throw new Error("Unsafe PPTX relationship");
      map.set(id, { type, target: normalizeTarget(base, target) });
    }
    if (!map.size) throw new Error("PPTX relationships are missing");
    return map;
  };
  const slideIds = (xml) => {
    rejectUnsafeXml(xml);
    const result = [];
    const pattern = /<p:sldId\\b([\\s\\S]*?)(?:\\/?>)/gi;
    let match;
    while ((match = pattern.exec(xml))) {
      const id = attr(match[1], "r:id");
      if (id) result.push(id);
    }
    return result;
  };
  const slideText = (xml) => {
    rejectUnsafeXml(xml);
    const result = [];
    const pattern = /<a:t\\b[^>]*>([\\s\\S]*?)<\\/a:t>/gi;
    let match;
    while ((match = pattern.exec(xml))) {
      const body = match[1];
      if (/<[A-Za-z!/]/.test(body)) throw new Error("Malformed PPTX slide text");
      result.push(decodeXml(body));
    }
    if ((xml.match(/<a:t\\b/gi) || []).length !== (xml.match(/<\\/a:t>/gi) || []).length) throw new Error("Malformed PPTX slide text");
    return result.join(" ").replace(/\\s+/g, " ").trim();
  };
  const readXml = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parentPort.on("message", async (message) => {
    try {
      if (!message || typeof message !== "object" || !(message.bytes instanceof Uint8Array) || !Array.isArray(message.entries) || !Number.isSafeInteger(message.totalCompressed) || message.totalCompressed < 0) throw new Error("Malformed PPTX archive");
      const bytes = message.bytes;
      const entries = message.entries;
      const byName = new Map(entries.map((entry) => [entry.name, entry]));
      if (!byName.has("[Content_Types].xml") || !byName.has("ppt/presentation.xml") || !byName.has("ppt/_rels/presentation.xml.rels")) throw new Error("PPTX package parts are incomplete");
      let totalActual = 0;
      const parts = new Map();
      const needed = new Set(["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]);
      for (const entry of entries) if (/^ppt\\/slides\\/slide\\d+\\.xml$/i.test(entry.name)) needed.add(entry.name);
      for (const entry of entries) {
        const value = await decompress(bytes, entry, message.totalCompressed, totalActual);
        totalActual += entry.uncompressedSize;
        if (totalActual > MAX_UNCOMPRESSED || (totalActual > 0 && (message.totalCompressed === 0 || totalActual > message.totalCompressed * MAX_RATIO))) throw new Error("PPTX archive exceeds actual decompressed limits");
        if (needed.has(entry.name)) parts.set(entry.name, value);
        if (/vbaProject\\.bin$/i.test(entry.name)) throw Object.assign(new Error("Macro-enabled PowerPoint packages are not supported"), { unsupported: true });
      }
      const contentTypes = readXml(parts.get("[Content_Types].xml"));
      if (/macroEnabled|vbaProject|application\\/vnd\\.ms-powerpoint/i.test(contentTypes)) throw Object.assign(new Error("Macro-enabled PowerPoint packages are not supported"), { unsupported: true });
      if (!/presentationml\\.presentation\\.main\\+xml/i.test(contentTypes) || !/presentationml\\.slide\\+xml/i.test(contentTypes)) throw new Error("PPTX content types are unsupported");
      const presentationXml = readXml(parts.get("ppt/presentation.xml"));
      const relationshipsXml = readXml(parts.get("ppt/_rels/presentation.xml.rels"));
      const relationships = parseRelationships(relationshipsXml, "ppt/");
      const orderedIds = slideIds(presentationXml);
      if (!orderedIds.length || orderedIds.length > MAX_SLIDES) throw new Error("PPTX slide count exceeds limit");
      const output = [];
      for (let index = 0; index < orderedIds.length; index += 1) {
        const relation = relationships.get(orderedIds[index]);
        if (!relation || !/\\/relationships\\/slide$/i.test(relation.type) || !/^ppt\\/slides\\/slide\\d+\\.xml$/i.test(relation.target)) throw new Error("PPTX slide relationship is invalid");
        const slide = parts.get(relation.target);
        if (!slide) throw new Error("PPTX slide part is missing");
        const text = slideText(readXml(slide));
        if (text) output.push("Slide " + (index + 1) + ": " + text);
      }
      const result = clamp(output.join("\\n\\n"));
      if (!result.text) throw new Error("PowerPoint contains no extractable slide text");
      parentPort.postMessage({ ok: true, ...result });
    } catch (error) {
      parentPort.postMessage(error && error.unsupported ? PptxError("powerpoint_binary_or_encrypted_unsupported") : PptxError("pptx_parse_failed"));
    }
  });
`;

export async function extractPptxInWorker(bytes: Uint8Array, archive: PptxArchive): Promise<PptxExtraction> {
  let worker: Worker;
  try {
    worker = new Worker(PPTX_WORKER_SOURCE, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    });
  } catch {
    throw pptxError("pptx_parser_unavailable", "PPTX parser is unavailable");
  }
  const transferable = new Uint8Array(bytes.byteLength);
  transferable.set(bytes);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(pptxError("pptx_parse_failed", "PPTX extraction timed out")));
    }, PPTX_WORKER_TIMEOUT_MS);
    worker.once("message", (message: unknown) => {
      void worker.terminate();
      finish(() => {
        if (!message || typeof message !== "object" || !("ok" in message) || message.ok !== true) {
          const workerCode = typeof message === "object" && message !== null && "errorCode" in message
            ? (message as { errorCode?: unknown }).errorCode
            : undefined;
          reject(workerCode === "powerpoint_binary_or_encrypted_unsupported"
            ? pptxError("powerpoint_binary_or_encrypted_unsupported", "Legacy or encrypted PowerPoint files are not supported")
            : workerCode === "pptx_parser_unavailable"
              ? pptxError("pptx_parser_unavailable", "PPTX parser is unavailable")
              : pptxError("pptx_parse_failed", "PPTX extraction failed"));
          return;
        }
        const result = message as { ok: true; text?: unknown; truncated?: unknown };
        if (typeof result.text !== "string" || typeof result.truncated !== "boolean") {
          reject(pptxError("pptx_parse_failed", "PPTX extraction failed"));
          return;
        }
        resolve({ text: result.text, truncated: result.truncated });
      });
    });
    worker.once("error", () => finish(() => reject(pptxError("pptx_parser_unavailable", "PPTX parser is unavailable"))));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(pptxError("pptx_parser_unavailable", "PPTX parser is unavailable")));
    });
    try {
      worker.postMessage({ bytes: transferable, entries: archive.entries, totalCompressed: archive.totalCompressed }, [transferable.buffer]);
    } catch {
      finish(() => reject(pptxError("pptx_parse_failed", "PPTX extraction failed")));
    }
  });
}
