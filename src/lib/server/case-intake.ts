import type { SupabaseClient } from "@supabase/supabase-js";
import { intakeRequestSchema } from "../domain/schemas";
import { getTemplateVersion } from "../domain/templates";
import { fetchSafeUrl } from "../security/url";
import { extractDocument } from "../security/documents";
import { sha256Hex } from "../security/hash";
import type { PortalContext } from "../domain/types";
import { buildIntakeSnapshotPayload, type IntakeSnapshotSource } from "./intake-snapshots";

const URL_MIME_TYPES = [
  "text/html",
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

type IntakeInput = ReturnType<typeof intakeRequestSchema.parse>;

/** Pasted source remains evidence only; structured context is stored on cases. */
export function buildPastedIntakeText(request: Pick<IntakeInput, "source"> & { inputs?: unknown }): string {
  return request.source?.trim().slice(0, 100_000) ?? "";
}

export async function createCaseIntake(input: {
  request: IntakeInput;
  context: PortalContext;
  admin: SupabaseClient;
  reviewedSources?: Array<{ kind: "pasted" | "upload"; filename: string; mimeType: string; byteSize: number; sha256: string; extractedText: string }>;
}): Promise<{ caseRecord: Record<string, unknown> & { id: string }; sourceCount: number; replayed: boolean }> {
  const { request, context, admin, reviewedSources = [] } = input;
  const template = getTemplateVersion(request.module);
  const pastedIntakeText = buildPastedIntakeText(request);
  const fetchedSources = await Promise.all(request.sourceUrls.map(async (sourceUrl) => {
    const response = await fetchSafeUrl(sourceUrl, { maxBytes: 2_000_000, maxRedirects: 3, timeoutMs: 10_000, allowedContentTypes: URL_MIME_TYPES });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw Object.assign(new Error("A submitted URL returned an empty response"), { status: 422 });
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const text = mimeType === "text/html"
      ? plainTextFromHtml(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).slice(0, 100_000)
      : (await extractDocument({ bytes, mime: mimeType, filename: new URL(sourceUrl).pathname })).text;
    if (!text) throw Object.assign(new Error("A submitted URL contained no extractable text"), { status: 422 });
    const parsedUrl = new URL(sourceUrl);
    return {
      url: sourceUrl,
      filename: `${parsedUrl.hostname}${parsedUrl.pathname === "/" ? "" : parsedUrl.pathname}`.slice(0, 255) || parsedUrl.hostname,
      mimeType: mimeType === "text/html" ? "text/plain" : mimeType,
      byteSize: bytes.byteLength,
      hash: sha256Hex(bytes),
      text,
    };
  }));
  // Complete all source extraction and validation before the first database
  // mutation. The idempotent RPC below owns the transaction that creates the
  // case, source rows, immutable intake snapshot, and audit records.
  const sourceRows = [
    ...(pastedIntakeText ? [{ source_kind: "pasted" as const, storage_path: null, source_url: null, filename: "intake.txt", mime_type: "text/plain", byte_size: Math.max(1, Buffer.byteLength(pastedIntakeText, "utf8")), sha256: sha256Hex(pastedIntakeText), extraction_status: "extracted" as const, extracted_text: pastedIntakeText, extraction_error_code: null }] : []),
    ...fetchedSources.map((source) => ({ source_kind: "url" as const, storage_path: null, source_url: source.url, filename: source.filename, mime_type: source.mimeType, byte_size: source.byteSize, sha256: source.hash, extraction_status: "extracted" as const, extracted_text: source.text, extraction_error_code: null })),
    // Imported upload bytes are intentionally converted into an extracted
    // evidence row. The bytes never reach this RPC and remain transient.
    ...reviewedSources.map((source) => ({ source_kind: "pasted" as const, storage_path: null, source_url: null, filename: source.filename.slice(0, 255), mime_type: "text/plain" as const, byte_size: source.byteSize, sha256: source.sha256, extraction_status: "extracted" as const, extracted_text: source.extractedText, extraction_error_code: null })),
  ];
  const snapshotSources: IntakeSnapshotSource[] = [
    ...(pastedIntakeText ? [{ kind: "pasted" as const, filename: "intake.txt", sha256: sha256Hex(pastedIntakeText), byteSize: Buffer.byteLength(pastedIntakeText, "utf8"), urlHost: null }] : []),
    ...fetchedSources.map((source) => ({ kind: "url" as const, filename: source.filename, sha256: source.hash, byteSize: source.byteSize, urlHost: (() => { try { return new URL(source.url).hostname; } catch { return null; } })() })),
    ...reviewedSources.map((source) => ({ kind: source.kind, filename: source.filename, sha256: source.sha256, byteSize: source.byteSize, urlHost: null })),
    ...request.sourceManifest.map((source) => ({ kind: source.kind, filename: source.filename, sha256: source.sha256 ?? null, byteSize: source.byteSize ?? null, urlHost: source.urlHost ?? null })),
  ];
  if (sourceRows.length > 5 || snapshotSources.length > 5) {
    throw Object.assign(new Error("A case can include up to five sources"), { status: 400 });
  }
  const snapshotPayload = buildIntakeSnapshotPayload({ request, sources: snapshotSources, selectedLearningIds: request.selectedLearningIds });
  const { data, error } = await admin.rpc("create_case_intake_idempotent", {
    p_workspace_id: context.workspace.id,
    p_actor_id: context.user.id,
    p_idempotency_key: request.idempotencyKey,
    p_module: request.module,
    p_template_version: template.version,
    p_title: request.title,
    p_brief: request.brief,
    p_intake_context: request.intakeContext,
    p_source_rows: sourceRows,
    p_snapshot_payload: snapshotPayload,
    p_workflow_stream_id: request.workflowStreamId ?? null,
    p_workflow_stream_version: request.expectedStreamVersion ?? null,
    p_client_id: request.clientId ?? null,
  });
  if (error) {
    const message = typeof error.message === "string" ? error.message : "";
    const conflictMessages = new Set([
      "case idempotency actor conflict",
      "case idempotency payload conflict",
      "client unavailable",
      "workflow stream is unavailable",
      "stale workflow stream version",
      "workflow stream module mismatch",
    ]);
    if (conflictMessages.has(message)) throw Object.assign(new Error(message), { status: 409 });
    throw new Error("Case intake unavailable");
  }
  if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("Case intake unavailable");
  const result = data as { case?: unknown; sourceCount?: unknown; replayed?: unknown };
  if (!result.case || typeof result.case !== "object" || Array.isArray(result.case) || typeof (result.case as { id?: unknown }).id !== "string") {
    throw new Error("Case intake unavailable");
  }
  return {
    caseRecord: result.case as Record<string, unknown> & { id: string },
    sourceCount: typeof result.sourceCount === "number" ? result.sourceCount : sourceRows.length,
    replayed: result.replayed === true,
  };
}

export function parseIntakeRequest(value: unknown): IntakeInput {
  return intakeRequestSchema.parse(value);
}
