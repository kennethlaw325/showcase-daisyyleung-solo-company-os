import { Worker } from "node:worker_threads";
import {
  extractPptxInWorker,
  isPptxExtractionError,
  parsePptxZip,
  pptxError,
} from "./pptx";
import { LEGACY_PPT_MIME, PPTX_MIME } from "./source-formats";

export type DocumentMime =
  | "text/plain"
  | "text/markdown"
  | "text/html"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | typeof PPTX_MIME;

export interface ExtractedDocument {
  text: string;
  mime: DocumentMime;
  truncated: boolean;
}

const MAX_EXTRACTED_CHARS = 100_000;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 1_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;
const DOCX_WORKER_TIMEOUT_MS = 10_000;

type DocxExtractionErrorCode = "docx_parser_unavailable" | "docx_parse_failed";

function docxError(code: DocxExtractionErrorCode, message: string): Error & { sourceErrorCode: DocxExtractionErrorCode } {
  return Object.assign(new Error(message), { sourceErrorCode: code });
}

function isDocxExtractionError(error: unknown, code?: DocxExtractionErrorCode): error is Error & { sourceErrorCode: DocxExtractionErrorCode } {
  if (typeof error !== "object" || error === null || !("sourceErrorCode" in error)) return false;
  const value = (error as { sourceErrorCode?: unknown }).sourceErrorCode;
  return (value === "docx_parser_unavailable" || value === "docx_parse_failed") && (code === undefined || value === code);
}

function clamp(text: string): { text: string; truncated: boolean } {
  const normalized = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  return { text: normalized.slice(0, MAX_EXTRACTED_CHARS), truncated: normalized.length > MAX_EXTRACTED_CHARS };
}

function requireExtractedText(result: { text: string; truncated: boolean }) {
  if (!result.text) throw new Error("Document contains no extractable text; OCR and encrypted documents are not supported");
  return result;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new Error("Malformed DOCX archive");
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error("Malformed DOCX archive");
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function hasZip64Extra(bytes: Uint8Array, offset: number, length: number): boolean {
  const end = offset + length;
  if (offset < 0 || end > bytes.byteLength) throw new Error("Malformed DOCX archive");
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) throw new Error("Malformed DOCX archive");
    const type = readUint16(bytes, cursor);
    const size = readUint16(bytes, cursor + 2);
    cursor += 4;
    if (cursor + size > end) throw new Error("Malformed DOCX archive");
    if (type === 0x0001) return true;
    cursor += size;
  }
  return false;
}

interface DocxEntry {
  compressionMethod: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

interface DocxArchive {
  entries: DocxEntry[];
  totalCompressed: number;
}

/**
 * Validate the DOCX ZIP central directory before handing bytes to Mammoth.
 * The declarations are used only to locate each entry and to bind the
 * worker's actual-size checks to the same archive metadata. Every local
 * header and compressed-data range must be disjoint and end before the
 * central directory; data-descriptor archives are rejected because their
 * local declarations cannot safely delimit the entry without a second ZIP
 * parser.
 */
function parseDocxZip(bytes: Uint8Array): DocxArchive {
  const minEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minEocdOffset; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Malformed DOCX archive");

  const diskNumber = readUint16(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUint16(bytes, eocdOffset + 6);
  const entriesOnDisk = readUint16(bytes, eocdOffset + 8);
  const entryCount = readUint16(bytes, eocdOffset + 10);
  const centralDirectorySize = readUint32(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(bytes, eocdOffset + 16);
  const commentLength = readUint16(bytes, eocdOffset + 20);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) throw new Error("Multi-disk DOCX archives are not supported");
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) throw new Error("ZIP64 DOCX archives are not supported");
  if (eocdOffset + 22 + commentLength !== bytes.byteLength) throw new Error("Malformed DOCX archive");
  if (entryCount > MAX_DOCX_ENTRIES || centralDirectoryOffset + centralDirectorySize > eocdOffset || centralDirectoryOffset < 0) throw new Error("DOCX archive exceeds entry limits");

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  let cursor = centralDirectoryOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  const structuralRanges: Array<[number, number]> = [];
  const entries: DocxEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralDirectoryEnd || readUint32(bytes, cursor) !== 0x02014b50) throw new Error("Malformed DOCX archive");
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
    if (cursor + recordLength > centralDirectoryEnd) throw new Error("Malformed DOCX archive");
    if ((flags & 0x0001) !== 0 || diskStart !== 0) throw new Error("Encrypted or multi-disk DOCX archives are not supported");
    if ((flags & 0x0008) !== 0) throw new Error("DOCX data-descriptor archives are not supported");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff || hasZip64Extra(bytes, cursor + 46 + filenameLength, extraLength)) throw new Error("ZIP64 DOCX archives are not supported");
    if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error("Unsupported DOCX compression method");
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error("DOCX archive exceeds decompressed size limit");

    if (localHeaderOffset + 30 > centralDirectoryOffset || readUint32(bytes, localHeaderOffset) !== 0x04034b50) throw new Error("Malformed DOCX archive");
    const localFlags = readUint16(bytes, localHeaderOffset + 6);
    const localMethod = readUint16(bytes, localHeaderOffset + 8);
    const localFilenameLength = readUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (
      (localFlags & 0x0001) !== 0 ||
      localFlags !== flags ||
      localMethod !== compressionMethod ||
      localFilenameLength !== filenameLength ||
      dataOffset < 0 ||
      dataOffset > centralDirectoryOffset ||
      dataEnd < dataOffset ||
      dataEnd > centralDirectoryOffset
    ) {
      throw new Error("Malformed DOCX archive");
    }
    for (let nameIndex = 0; nameIndex < filenameLength; nameIndex += 1) {
      if (bytes[cursor + 46 + nameIndex] !== bytes[localHeaderOffset + 30 + nameIndex]) throw new Error("Malformed DOCX archive");
    }
    if (hasZip64Extra(bytes, localHeaderOffset + 30 + localFilenameLength, localExtraLength)) throw new Error("ZIP64 DOCX archives are not supported");
    if ((flags & 0x0008) === 0) {
      const localCrc = readUint32(bytes, localHeaderOffset + 14);
      const localCompressedSize = readUint32(bytes, localHeaderOffset + 18);
      const localUncompressedSize = readUint32(bytes, localHeaderOffset + 22);
      if (localCrc !== readUint32(bytes, cursor + 16) || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize) throw new Error("Malformed DOCX archive");
    }
    structuralRanges.push([localHeaderOffset, dataOffset], [dataOffset, dataEnd]);
    entries.push({
      compressionMethod: compressionMethod as 0 | 8,
      compressedSize,
      uncompressedSize,
      dataOffset,
    });
    cursor += recordLength;
  }
  if (cursor !== centralDirectoryEnd) throw new Error("Malformed DOCX archive");
  structuralRanges.sort(([left], [right]) => left - right);
  for (let index = 1; index < structuralRanges.length; index += 1) {
    const previous = structuralRanges[index - 1];
    const current = structuralRanges[index];
    if (previous[1] > previous[0] && current[1] > current[0] && previous[1] > current[0]) throw new Error("Malformed DOCX archive");
  }
  if (totalUncompressed > 0 && (totalCompressed === 0 || totalUncompressed > totalCompressed * MAX_DOCX_COMPRESSION_RATIO)) throw new Error("DOCX archive compression ratio exceeds limit");
  return { entries, totalCompressed };
}

export function preflightDocxZip(bytes: Uint8Array): void {
  parseDocxZip(bytes);
}

const DOCX_WORKER_SOURCE = `
  const { parentPort } = require("node:worker_threads");
  const { createInflateRaw } = require("node:zlib");
  let mammoth = null;
  try {
    mammoth = require("mammoth");
  } catch {
    // The parent receives a bounded parser-unavailable code below.  Never
    // forward the module-loader error or its paths across the worker boundary.
  }
  const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
  const MAX_DOCX_COMPRESSION_RATIO = 100;
  const MAX_EXTRACTED_CHARS = 100000;
  const clamp = (text) => {
    const normalized = String(text || "").replace(/\\u0000/g, "").replace(/\\r\\n/g, "\\n").trim();
    return { text: normalized.slice(0, MAX_EXTRACTED_CHARS), truncated: normalized.length > MAX_EXTRACTED_CHARS };
  };
  const inflateAndCount = (bytes, entry, totalCompressed, totalActual) => new Promise((resolve, reject) => {
    const compressedEnd = entry.dataOffset + entry.compressedSize;
    if (!Number.isSafeInteger(entry.dataOffset) || !Number.isSafeInteger(entry.compressedSize) || entry.dataOffset < 0 || entry.compressedSize < 0 || compressedEnd < entry.dataOffset || compressedEnd > bytes.byteLength) {
      reject(new Error("Malformed DOCX archive"));
      return;
    }
    const compressed = Buffer.from(bytes.buffer, bytes.byteOffset + entry.dataOffset, entry.compressedSize);
    const inflater = createInflateRaw();
    let actual = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      inflater.destroy();
      reject(error);
    };
    inflater.on("data", (chunk) => {
      actual += chunk.byteLength;
      if (actual > entry.uncompressedSize || totalActual + actual > MAX_DOCX_UNCOMPRESSED_BYTES || totalActual + actual > totalCompressed * MAX_DOCX_COMPRESSION_RATIO) {
        fail(new Error("DOCX archive exceeds actual decompressed limits"));
      }
    });
    inflater.once("error", (error) => fail(error));
    inflater.once("end", () => {
      if (settled) return;
      settled = true;
      if (actual !== entry.uncompressedSize) {
        reject(new Error("DOCX archive actual size does not match declaration"));
        return;
      }
      resolve(actual);
    });
    try {
      inflater.end(compressed);
    } catch (error) {
      fail(error);
    }
  });
  const validateArchive = async (bytes, entries, totalCompressed) => {
    let totalActual = 0;
    for (const entry of entries) {
      let actual;
      if (entry.compressionMethod === 0) {
        const dataEnd = entry.dataOffset + entry.compressedSize;
        if (!Number.isSafeInteger(entry.dataOffset) || !Number.isSafeInteger(entry.compressedSize) || dataEnd < entry.dataOffset || entry.dataOffset < 0 || dataEnd > bytes.byteLength) throw new Error("Malformed DOCX archive");
        actual = entry.compressedSize;
        if (actual !== entry.uncompressedSize) throw new Error("DOCX archive actual size does not match declaration");
      } else if (entry.compressionMethod === 8) {
        actual = await inflateAndCount(bytes, entry, totalCompressed, totalActual);
      } else {
        throw new Error("Unsupported DOCX compression method");
      }
      totalActual += actual;
      if (totalActual > MAX_DOCX_UNCOMPRESSED_BYTES || (totalActual > 0 && (totalCompressed === 0 || totalActual > totalCompressed * MAX_DOCX_COMPRESSION_RATIO))) throw new Error("DOCX archive exceeds actual decompressed limits");
    }
  };
  parentPort.on("message", async (message) => {
    try {
      if (!mammoth) {
        parentPort.postMessage({ ok: false, errorCode: "docx_parser_unavailable" });
        return;
      }
      if (!message || typeof message !== "object" || !("bytes" in message) || !("entries" in message) || !("totalCompressed" in message)) throw new Error("Malformed DOCX archive");
      const { bytes, entries, totalCompressed } = message;
      if (!(bytes instanceof Uint8Array) || !Array.isArray(entries) || !Number.isSafeInteger(totalCompressed) || totalCompressed < 0) throw new Error("Malformed DOCX archive");
      await validateArchive(bytes, entries, totalCompressed);
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      parentPort.postMessage({ ok: true, ...clamp(result.value) });
    } catch {
      parentPort.postMessage({ ok: false, errorCode: "docx_parse_failed" });
    }
  });
`;

async function extractDocxInWorker(bytes: Uint8Array, archive: DocxArchive): Promise<{ text: string; truncated: boolean }> {
  let worker: Worker;
  try {
    worker = new Worker(DOCX_WORKER_SOURCE, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    });
  } catch {
    throw docxError("docx_parser_unavailable", "DOCX parser is unavailable");
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
      finish(() => reject(docxError("docx_parse_failed", "DOCX extraction timed out")));
    }, DOCX_WORKER_TIMEOUT_MS);
    worker.once("message", (message: unknown) => {
      void worker.terminate();
      finish(() => {
        if (!message || typeof message !== "object" || !("ok" in message) || message.ok !== true) {
          const workerCode = typeof message === "object" && message !== null && "errorCode" in message
            ? (message as { errorCode?: unknown }).errorCode
            : undefined;
          reject(workerCode === "docx_parser_unavailable"
            ? docxError("docx_parser_unavailable", "DOCX parser is unavailable")
            : docxError("docx_parse_failed", "DOCX extraction failed"));
          return;
        }
        const result = message as { ok: true; text?: unknown; truncated?: unknown };
        if (typeof result.text !== "string" || typeof result.truncated !== "boolean") {
          reject(docxError("docx_parse_failed", "DOCX extraction failed"));
          return;
        }
        resolve({ text: result.text, truncated: result.truncated });
      });
    });
    worker.once("error", () => {
      finish(() => reject(docxError("docx_parser_unavailable", "DOCX parser is unavailable")));
    });
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(docxError("docx_parser_unavailable", "DOCX parser is unavailable")));
    });
    try {
      worker.postMessage({ bytes: transferable, entries: archive.entries, totalCompressed: archive.totalCompressed }, [transferable.buffer]);
    } catch {
      finish(() => reject(docxError("docx_parse_failed", "DOCX extraction failed")));
    }
  });
}

/** Extraction is intentionally a boundary: callers receive text only, never raw files in logs or prompts. */
export async function extractDocument(input: { bytes: Uint8Array; mime: string; filename?: string }): Promise<ExtractedDocument> {
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds size limit");
  const mimeValue = input.mime.toLowerCase().split(";", 1)[0];
  const filename = input.filename?.trim().toLowerCase() ?? "";
  if (mimeValue === LEGACY_PPT_MIME || filename.endsWith(".ppt")) {
    throw pptxError("powerpoint_binary_or_encrypted_unsupported", "Legacy or encrypted PowerPoint files are not supported; save the file as an unencrypted PPTX");
  }
  const mime = mimeValue as DocumentMime;
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/html") {
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      throw new Error("Document content does not match the declared text type");
    }
    const result = requireExtractedText(clamp(decoded));
    return { ...result, mime };
  }
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (!hasPrefix(input.bytes, [0x50, 0x4b, 0x03, 0x04])) throw new Error("Document content does not match the declared DOCX type");
    const archive = parseDocxZip(input.bytes);
    try {
      const extracted = await extractDocxInWorker(input.bytes, archive);
      try {
        const clamped = requireExtractedText(extracted);
        return { ...clamped, mime };
      } catch {
        throw docxError("docx_parse_failed", "DOCX extraction failed");
      }
    } catch (error) {
      if (isDocxExtractionError(error)) throw error;
      throw docxError("docx_parse_failed", "DOCX extraction failed");
    }
  }
  if (mime === PPTX_MIME) {
    if (hasPrefix(input.bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw pptxError("powerpoint_binary_or_encrypted_unsupported", "Legacy or encrypted PowerPoint files are not supported; save the file as an unencrypted PPTX");
    if (!hasPrefix(input.bytes, [0x50, 0x4b, 0x03, 0x04])) throw pptxError("pptx_parse_failed", "PPTX content does not match the declared type");
    let archive;
    try {
      archive = parsePptxZip(input.bytes);
    } catch (error) {
      if (error instanceof Error && /encrypted|macro-enabled|legacy/i.test(error.message)) throw pptxError("powerpoint_binary_or_encrypted_unsupported", "Legacy or encrypted PowerPoint files are not supported; save the file as an unencrypted PPTX");
      if (error instanceof Error && /size limit|compression ratio|exceeds entry limits|decompressed/i.test(error.message)) throw Object.assign(new Error("PPTX archive exceeds extraction limits"), { sourceErrorCode: "source_size_limit" });
      throw pptxError("pptx_parse_failed", "PPTX extraction failed");
    }
    try {
      const extracted = await extractPptxInWorker(input.bytes, archive);
      try {
        const clamped = requireExtractedText(extracted);
        return { ...clamped, mime };
      } catch {
        throw pptxError("pptx_parse_failed", "PPTX extraction failed");
      }
    } catch (error) {
      if (isPptxExtractionError(error)) throw error;
      throw pptxError("pptx_parse_failed", "PPTX extraction failed");
    }
  }
  if (mime === "application/pdf") {
    if (!hasPrefix(input.bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new Error("Document content does not match the declared PDF type");
    const parserModule = (await import("pdf-parse")) as unknown as Record<string, unknown>;
    const parse = parserModule.default ?? parserModule;
    let value = "";
    if (typeof parse === "function") {
      const result = await (parse as (data: Buffer) => Promise<{ text?: string }>)(Buffer.from(input.bytes));
      value = result.text ?? "";
    } else if (typeof parserModule.PDFParse === "function") {
      const parser = new (parserModule.PDFParse as new (options: { data: Uint8Array }) => { getText(): Promise<{ text?: string }>; })({ data: input.bytes });
      value = (await parser.getText()).text ?? "";
    } else {
      throw new Error("PDF extraction is unavailable");
    }
    const clamped = requireExtractedText(clamp(value));
    return { ...clamped, mime };
  }
  throw new Error(`Unsupported document type${input.filename ? `: ${input.filename}` : ""}`);
}
