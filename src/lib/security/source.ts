import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PPTX_MIME, SUPPORTED_SOURCE_MIME_TYPES } from "./source-formats";

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCES_PER_CASE = 5;

export const ALLOWED_SOURCE_MIME_TYPES = SUPPORTED_SOURCE_MIME_TYPES;

export const sourceMimeSchema = z.enum(ALLOWED_SOURCE_MIME_TYPES);
const sourceExtensionByMime: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  [PPTX_MIME]: "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
};

export const sourceUploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: sourceMimeSchema,
  byteSize: z.number().int().positive().max(MAX_SOURCE_BYTES),
}).superRefine((value, context) => {
  const extension = value.filename.toLowerCase().split(".").pop() ?? "";
  if (sourceExtensionByMime[value.mimeType] !== extension) context.addIssue({ code: z.ZodIssueCode.custom, path: ["filename"], message: "Filename extension does not match the declared source type" });
});

export const sourceRegisterRequestSchema = sourceUploadRequestSchema.extend({
  sourceId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(500),
});

export const sourceUploadAbortRequestSchema = z.object({
  sourceId: z.string().uuid(),
});

export function sanitizeSourceFilename(filename: string): string {
  const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "source";
  const safe = basename.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^\.+/, "").slice(0, 220);
  return safe || "source";
}

export function buildSourceStoragePath(input: { workspaceId: string; caseId: string; filename: string }): string {
  return `${input.workspaceId}/${input.caseId}/${randomUUID()}-${sanitizeSourceFilename(input.filename)}`;
}

export function isStoragePathForCase(storagePath: string, workspaceId: string, caseId: string): boolean {
  return storagePath.startsWith(`${workspaceId}/${caseId}/`) && storagePath.split("/").length === 3 && !storagePath.includes("..") && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,280}$/i.test(storagePath);
}

export function sourceErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "sourceErrorCode" in error) {
    const code = (error as { sourceErrorCode?: unknown }).sourceErrorCode;
    if (code === "docx_parser_unavailable" || code === "docx_parse_failed" || code === "pptx_parser_unavailable" || code === "pptx_parse_failed" || code === "powerpoint_binary_or_encrypted_unsupported" || code === "unsupported_document" || code === "source_size_limit") return code;
  }
  if (error instanceof Error && /unsupported document|does not match/i.test(error.message)) return "unsupported_document";
  if (error instanceof Error && /size limit|exceed/i.test(error.message)) return "source_size_limit";
  if (error instanceof Error && /storage|download/i.test(error.message)) return "storage_download_failed";
  return "extraction_failed";
}
