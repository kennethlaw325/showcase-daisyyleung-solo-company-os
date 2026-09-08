import { afterEach, describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import { isPrivateIp, assertSafeUrl } from "../src/lib/security/url";
import { buildRfc2822Message } from "../src/lib/adapters/gmail";
import { buildSourceStoragePath, isStoragePathForCase, MAX_SOURCE_BYTES, sourceErrorCode, sourceUploadAbortRequestSchema, sourceUploadRequestSchema } from "../src/lib/security/source";
import { extractDocument, preflightDocxZip } from "../src/lib/security/documents";
import { LEGACY_PPT_MIME, PPTX_MIME } from "../src/lib/security/source-formats";
import { preflightPptxZip } from "../src/lib/security/pptx";
import { parseAuthConfirmation, safePortalRedirect } from "../src/lib/supabase/auth-confirm";
import { isInvitationEligibleForMagicLink } from "../src/lib/supabase/auth";

const docxWorkerMode = vi.hoisted(() => ({ value: "real" as "real" | "docx_parser_unavailable" | "docx_parse_failed" }));

vi.mock("node:worker_threads", async () => {
  const actual = await vi.importActual<typeof import("node:worker_threads")>("node:worker_threads");
  const { EventEmitter } = await vi.importActual<typeof import("node:events")>("node:events");
  class MockWorker extends EventEmitter {
    constructor(source: string | URL, options?: object) {
      super();
      if (docxWorkerMode.value === "real") {
        return new actual.Worker(source, options as never) as unknown as MockWorker;
      }
    }

    postMessage(): void {
      queueMicrotask(() => this.emit("message", { ok: false, errorCode: docxWorkerMode.value }));
    }

    terminate(): Promise<number> {
      return Promise.resolve(0);
    }
  }
  return { ...actual, Worker: MockWorker };
});

afterEach(() => {
  docxWorkerMode.value = "real";
});

describe("security boundaries", () => {
  function zipFixture(options: { compressedSize?: number; uncompressedSize?: number; encrypted?: boolean; dataDescriptor?: boolean; overlapCentralDirectory?: boolean } = {}): Uint8Array {
    const compressedSize = options.compressedSize ?? 1;
    const uncompressedSize = options.uncompressedSize ?? 1;
    const localOffset = 0;
    const dataOffset = 31;
    const centralSize = 47;
    const centralOffset = options.overlapCentralDirectory ? dataOffset : dataOffset + compressedSize;
    const bytes = new Uint8Array(centralOffset + centralSize + 22);
    const view = new DataView(bytes.buffer);
    const set32 = (offset: number, value: number) => view.setUint32(offset, value >>> 0, true);
    const set16 = (offset: number, value: number) => view.setUint16(offset, value, true);
    set32(0, 0x04034b50);
    set16(8, 0);
    set16(10, 0);
    set32(14, 0);
    set16(26, 1);
    set32(18, compressedSize);
    set32(22, uncompressedSize);
    bytes[30] = 0x61;
    if (!options.overlapCentralDirectory) bytes.fill(0, dataOffset, dataOffset + compressedSize);
    set32(centralOffset, 0x02014b50);
    set16(centralOffset + 8, (options.encrypted ? 1 : 0) | (options.dataDescriptor ? 0x0008 : 0));
    set16(centralOffset + 10, 0);
    set32(centralOffset + 16, 0);
    set32(centralOffset + 20, compressedSize);
    set32(centralOffset + 24, uncompressedSize);
    set16(centralOffset + 28, 1);
    set32(centralOffset + 42, localOffset);
    bytes[centralOffset + 46] = 0x61;
    const eocd = centralOffset + centralSize;
    set32(eocd, 0x06054b50);
    set16(eocd + 8, 1);
    set16(eocd + 10, 1);
    set32(eocd + 12, centralSize);
    set32(eocd + 16, centralOffset);
    return bytes;
  }

  function validDocxFixture(): Uint8Array {
    const entries = [
      ["[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"],
      ["_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"],
      ["word/document.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Hello from the extraction worker</w:t></w:r></w:p></w:body></w:document>"],
      ["unused.bin", ""],
    ].map(([name, text]) => {
      const data = new TextEncoder().encode(text);
      return { name: new TextEncoder().encode(name), data, compressed: new Uint8Array(deflateRawSync(data)) };
    });
    const crc32 = (data: Uint8Array) => {
      let crc = 0xffffffff;
      for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      return (crc ^ 0xffffffff) >>> 0;
    };
    const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.compressed.length, 0);
    const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
    const bytes = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(bytes.buffer);
    const set32 = (offset: number, value: number) => view.setUint32(offset, value >>> 0, true);
    const set16 = (offset: number, value: number) => view.setUint16(offset, value, true);
    let localOffset = 0;
    let centralOffset = localSize;
    for (const entry of entries) {
      const checksum = crc32(entry.data);
      set32(localOffset, 0x04034b50);
      set16(localOffset + 4, 20);
      set16(localOffset + 6, 0);
      set16(localOffset + 8, 8);
      set32(localOffset + 14, checksum);
      set32(localOffset + 18, entry.compressed.length);
      set32(localOffset + 22, entry.data.length);
      set16(localOffset + 26, entry.name.length);
      bytes.set(entry.name, localOffset + 30);
      bytes.set(entry.compressed, localOffset + 30 + entry.name.length);

      set32(centralOffset, 0x02014b50);
      set16(centralOffset + 4, 20);
      set16(centralOffset + 6, 20);
      set16(centralOffset + 8, 0);
      set16(centralOffset + 10, 8);
      set32(centralOffset + 16, checksum);
      set32(centralOffset + 20, entry.compressed.length);
      set32(centralOffset + 24, entry.data.length);
      set16(centralOffset + 28, entry.name.length);
      set16(centralOffset + 34, 0);
      set16(centralOffset + 36, 0);
      set16(centralOffset + 38, 0);
      set32(centralOffset + 42, localOffset);
      bytes.set(entry.name, centralOffset + 46);
      localOffset += 30 + entry.name.length + entry.compressed.length;
      centralOffset += 46 + entry.name.length;
    }
    const eocd = localSize + centralSize;
    set32(eocd, 0x06054b50);
    set16(eocd + 8, entries.length);
    set16(eocd + 10, entries.length);
    set32(eocd + 12, centralSize);
    set32(eocd + 16, localSize);
    return bytes;
  }

  function validPptxFixture(): Uint8Array {
    const entries = [
      ["[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/><Override PartName=\"/ppt/slides/slide1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/><Override PartName=\"/ppt/slides/slide2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/></Types>"],
      ["ppt/presentation.xml", "<?xml version=\"1.0\"?><p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><p:sldIdLst><p:sldId id=\"256\" r:id=\"rId2\"/><p:sldId id=\"257\" r:id=\"rId1\"/></p:sldIdLst></p:presentation>"],
      ["ppt/_rels/presentation.xml.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide2.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide1.xml\"/></Relationships>"],
      ["ppt/slides/slide1.xml", "<?xml version=\"1.0\"?><p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:t>First &amp; &#x1F600;</a:t></p:sld>"],
      ["ppt/slides/slide2.xml", "<?xml version=\"1.0\"?><p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:t>Second slide</a:t></p:sld>"],
    ].map(([name, text]) => {
      const data = new TextEncoder().encode(text);
      return { name: new TextEncoder().encode(name), data, compressed: new Uint8Array(deflateRawSync(data)) };
    });
    const crc32 = (data: Uint8Array) => {
      let crc = 0xffffffff;
      for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      return (crc ^ 0xffffffff) >>> 0;
    };
    const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.compressed.length, 0);
    const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
    const bytes = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(bytes.buffer);
    const set32 = (offset: number, value: number) => view.setUint32(offset, value >>> 0, true);
    const set16 = (offset: number, value: number) => view.setUint16(offset, value, true);
    let localOffset = 0;
    let centralOffset = localSize;
    for (const entry of entries) {
      const checksum = crc32(entry.data);
      set32(localOffset, 0x04034b50);
      set16(localOffset + 4, 20);
      set16(localOffset + 6, 0);
      set16(localOffset + 8, 8);
      set32(localOffset + 14, checksum);
      set32(localOffset + 18, entry.compressed.length);
      set32(localOffset + 22, entry.data.length);
      set16(localOffset + 26, entry.name.length);
      bytes.set(entry.name, localOffset + 30);
      bytes.set(entry.compressed, localOffset + 30 + entry.name.length);

      set32(centralOffset, 0x02014b50);
      set16(centralOffset + 4, 20);
      set16(centralOffset + 6, 20);
      set16(centralOffset + 8, 0);
      set16(centralOffset + 10, 8);
      set32(centralOffset + 16, checksum);
      set32(centralOffset + 20, entry.compressed.length);
      set32(centralOffset + 24, entry.data.length);
      set16(centralOffset + 28, entry.name.length);
      set32(centralOffset + 42, localOffset);
      bytes.set(entry.name, centralOffset + 46);
      localOffset += 30 + entry.name.length + entry.compressed.length;
      centralOffset += 46 + entry.name.length;
    }
    const eocd = localSize + centralSize;
    set32(eocd, 0x06054b50);
    set16(eocd + 8, entries.length);
    set16(eocd + 10, entries.length);
    set32(eocd + 12, centralSize);
    set32(eocd + 16, localSize);
    return bytes;
  }

  function forgedDocxDeclarationFixture(): Uint8Array {
    const bytes = validDocxFixture();
    const view = new DataView(bytes.buffer);
    const get16 = (offset: number) => view.getUint16(offset, true);
    const get32 = (offset: number) => view.getUint32(offset, true);
    const set32 = (offset: number, value: number) => view.setUint32(offset, value >>> 0, true);
    const eocd = bytes.byteLength - 22;
    let cursor = get32(eocd + 16);
    const centralEnd = cursor + get32(eocd + 12);
    while (cursor < centralEnd) {
      const nameLength = get16(cursor + 28);
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (name === "word/document.xml") {
        const localOffset = get32(cursor + 42);
        const declaredSize = get32(cursor + 24);
        set32(cursor + 24, declaredSize + 1);
        set32(localOffset + 22, declaredSize + 1);
        return bytes;
      }
      cursor += 46 + nameLength + get16(cursor + 30) + get16(cursor + 32);
    }
    throw new Error("Fixture entry not found");
  }

  function overlappingDocxFixture(): Uint8Array {
    const bytes = validDocxFixture();
    const view = new DataView(bytes.buffer);
    const get16 = (offset: number) => view.getUint16(offset, true);
    const get32 = (offset: number) => view.getUint32(offset, true);
    const set32 = (offset: number, value: number) => view.setUint32(offset, value >>> 0, true);
    const eocd = bytes.byteLength - 22;
    let cursor = get32(eocd + 16);
    const centralEnd = cursor + get32(eocd + 12);
    while (cursor < centralEnd) {
      const nameLength = get16(cursor + 28);
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (name === "unused.bin") {
        const localOffset = get32(cursor + 42);
        const compressedSize = get32(cursor + 20);
        set32(cursor + 20, compressedSize + 1);
        set32(localOffset + 18, compressedSize + 1);
        return bytes;
      }
      cursor += 46 + nameLength + get16(cursor + 30) + get16(cursor + 32);
    }
    throw new Error("Fixture entry not found");
  }

  it("accepts only supported email confirmations and same-origin portal redirects", () => {
    expect(safePortalRedirect("/app/cases/example?tab=source")).toBe("/app/cases/example?tab=source");
    expect(safePortalRedirect("//attacker.example/path")).toBe("/app");
    expect(safePortalRedirect("/\\attacker.example/path")).toBe("/app");
    expect(safePortalRedirect("https://attacker.example/path")).toBe("/app");

    const invite = parseAuthConfirmation(new URL("https://portal.example/auth/confirm?token_hash=fixture-hash&type=invite&next=/app"));
    expect(invite).toEqual({ tokenHash: "fixture-hash", type: "invite", next: "/app" });
    expect(parseAuthConfirmation(new URL("https://portal.example/auth/confirm?token_hash=fixture-hash&type=recovery"))).toBeNull();
    expect(parseAuthConfirmation(new URL("https://portal.example/auth/confirm?type=magiclink"))).toBeNull();
  });

  it("expires pending invitations without locking out accepted members", () => {
    const now = new Date("2026-08-12T12:00:00.000Z");

    expect(isInvitationEligibleForMagicLink({ status: "pending", expires_at: "2026-08-12T11:59:59.000Z" }, now)).toBe(false);
    expect(isInvitationEligibleForMagicLink({ status: "pending", expires_at: "2026-08-12T12:00:01.000Z" }, now)).toBe(true);
    expect(isInvitationEligibleForMagicLink({ status: "accepted", expires_at: "2026-08-01T00:00:00.000Z" }, now)).toBe(true);
  });

  it("blocks private, loopback, and link-local addresses", () => {
    for (const host of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.2", "169.254.169.254", "::1", "fd00::1", "localhost", "api.internal"]) {
      expect(isPrivateIp(host)).toBe(true);
    }
    expect(isPrivateIp("100.64.0.0")).toBe(true);
    expect(isPrivateIp("100.127.255.255")).toBe(true);
    expect(isPrivateIp("100.63.255.255")).toBe(false);
    expect(isPrivateIp("100.128.0.0")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:808:808")).toBe(false);
  });

  it("rejects IPv4-mapped loopback and carrier-grade NAT URLs", async () => {
    await expect(assertSafeUrl("https://[::ffff:127.0.0.1]/")).rejects.toThrow(/private|local/i);
    await expect(assertSafeUrl("https://[::ffff:7f00:1]/")).rejects.toThrow(/private|local/i);
    await expect(assertSafeUrl("https://100.64.0.1/")).rejects.toThrow(/private|local/i);
    await expect(assertSafeUrl("https://[::ffff:6440:1]/")).rejects.toThrow(/private|local/i);
    await expect(assertSafeUrl("https://8.8.8.8/")).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl("https://[::ffff:808:808]/")).resolves.toBeInstanceOf(URL);
  });

  it("rejects unsupported and credential-bearing URLs", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(/HTTP/);
    await expect(assertSafeUrl("http://localhost:3000")).rejects.toThrow(/HTTPS/i);
    await expect(assertSafeUrl("https://localhost:3000")).rejects.toThrow(/private|local/i);
    await expect(assertSafeUrl("https://user:pass@example.com")).rejects.toThrow(/credentials/);
  });

  it("strips header injection from draft metadata", () => {
    const message = buildRfc2822Message({ to: "a@example.com\r\nBcc: attacker@example.com", subject: "hello\r\nX-Evil: true", body: "body" });
    expect(message).not.toContain("\r\nBcc: attacker@example.com");
    expect(message).not.toContain("\r\nX-Evil: true");
    expect(message).toContain("To: a@example.comBcc: attacker@example.com");
  });

  it("bounds private source uploads and keeps paths tenant/case scoped", () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const caseId = "22222222-2222-4222-8222-222222222222";
    const path = buildSourceStoragePath({ workspaceId, caseId, filename: "../notes final.pdf" });
    expect(isStoragePathForCase(path, workspaceId, caseId)).toBe(true);
    expect(isStoragePathForCase(path, caseId, workspaceId)).toBe(false);
    expect(sourceUploadRequestSchema.safeParse({ filename: "notes.pdf", mimeType: "application/pdf", byteSize: MAX_SOURCE_BYTES }).success).toBe(true);
    expect(sourceUploadRequestSchema.safeParse({ filename: "slides.pptx", mimeType: PPTX_MIME, byteSize: 10 }).success).toBe(true);
    expect(sourceUploadRequestSchema.safeParse({ filename: "legacy.ppt", mimeType: PPTX_MIME, byteSize: 10 }).success).toBe(false);
    expect(sourceUploadRequestSchema.safeParse({ filename: "slides.md", mimeType: "text/plain", byteSize: 10 }).success).toBe(false);
    expect(sourceUploadRequestSchema.safeParse({ filename: "notes.exe", mimeType: "application/octet-stream", byteSize: 10 }).success).toBe(false);
    expect(sourceUploadRequestSchema.safeParse({ filename: "notes.pdf", mimeType: "application/pdf", byteSize: MAX_SOURCE_BYTES + 1 }).success).toBe(false);
    expect(sourceUploadAbortRequestSchema.safeParse({ sourceId: "33333333-3333-4333-8333-333333333333" }).success).toBe(true);
    expect(sourceUploadAbortRequestSchema.safeParse({ sourceId: "not-a-source-id" }).success).toBe(false);
  });

  it("rejects MIME-spoofed documents before parser execution", async () => {
    const fake = new TextEncoder().encode("not a PDF or DOCX");
    await expect(extractDocument({ bytes: fake, mime: "application/pdf", filename: "fake.pdf" })).rejects.toThrow(/declared PDF/i);
    await expect(extractDocument({ bytes: fake, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "fake.docx" })).rejects.toThrow(/declared DOCX/i);
  });

  it("extracts ordered slide text from a bounded PPTX and blocks legacy PowerPoint", async () => {
    const bytes = validPptxFixture();
    expect(() => preflightPptxZip(bytes)).not.toThrow();
    const extracted = await extractDocument({ bytes, mime: PPTX_MIME, filename: "brief.pptx" });
    expect(extracted.text).toContain("Slide 1: First & 😀");
    expect(extracted.text).toContain("Slide 2: Second slide");
    await expect(extractDocument({ bytes: new Uint8Array([1]), mime: LEGACY_PPT_MIME, filename: "legacy.ppt" })).rejects.toMatchObject({ sourceErrorCode: "powerpoint_binary_or_encrypted_unsupported" });
  });

  it("preflights DOCX ZIP declarations before any extraction worker runs", () => {
    expect(() => preflightDocxZip(zipFixture({ uncompressedSize: 50 * 1024 * 1024 + 1 }))).toThrow(/decompressed size/i);
    expect(() => preflightDocxZip(zipFixture({ compressedSize: 1, uncompressedSize: 101 }))).toThrow(/compression ratio/i);
    expect(() => preflightDocxZip(zipFixture({ encrypted: true }))).toThrow(/encrypted/i);
    expect(() => preflightDocxZip(zipFixture({ dataDescriptor: true }))).toThrow(/data-descriptor/i);
  });

  it("rejects forged DOCX declarations and metadata/data overlap through extraction", async () => {
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await expect(extractDocument({ bytes: forgedDocxDeclarationFixture(), mime, filename: "forged.docx" })).rejects.toThrow(/failed|size|declaration/i);
    await expect(extractDocument({ bytes: overlappingDocxFixture(), mime, filename: "overlap.docx" })).rejects.toThrow(/malformed/i);
    await expect(extractDocument({ bytes: zipFixture({ dataDescriptor: true }), mime, filename: "descriptor.docx" })).rejects.toThrow(/data-descriptor/i);
  });

  it("extracts a bounded valid DOCX inside the isolated Mammoth worker", async () => {
    const extracted = await extractDocument({
      bytes: validDocxFixture(),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "worker.docx",
    });
    expect(extracted.text).toContain("Hello from the extraction worker");
    expect(extracted.truncated).toBe(false);
  });

  it("keeps DOCX parser-unavailable and parse-failed worker codes distinct", async () => {
    const input = {
      bytes: validDocxFixture(),
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "worker-failure.docx",
    } as const;

    docxWorkerMode.value = "docx_parser_unavailable";
    await expect(extractDocument(input)).rejects.toMatchObject({ sourceErrorCode: "docx_parser_unavailable" });

    docxWorkerMode.value = "docx_parse_failed";
    let thrown: unknown;
    try {
      await extractDocument(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ sourceErrorCode: "docx_parse_failed" });
    expect(sourceErrorCode(thrown)).toBe("docx_parse_failed");
  });
});
