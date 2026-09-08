import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthRequiredError, WorkspaceRequiredError, requirePortalContext } from "../supabase/auth";

export const MAX_REQUEST_BODY_BYTES = 2_000_000;

export class RequestBodyTooLargeError extends Error {
  readonly status = 413;

  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export class InvalidRequestBodyError extends Error {
  readonly status = 400;

  constructor(message = "Invalid request body") {
    super(message);
    this.name = "InvalidRequestBodyError";
  }
}

const SAFE_AI_ERROR_CODES = new Set(["timeout", "provider_request", "invalid_output", "not_configured", "quota", "generic"]);

function isSafeAiError(error: unknown): error is Error & { aiError: true; aiErrorCode: string } {
  if (!(error instanceof Error)) return false;
  const metadata = error as Error & { aiError?: unknown; aiErrorCode?: unknown };
  return metadata.aiError === true
    && typeof metadata.aiErrorCode === "string"
    && SAFE_AI_ERROR_CODES.has(metadata.aiErrorCode);
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) return json({ error: "Invalid request" }, { status: 400 });
  if (error instanceof AuthRequiredError) return json({ error: "Authentication required" }, { status: 401 });
  if (error instanceof WorkspaceRequiredError) return json({ error: "Forbidden" }, { status: 403 });
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  const message = status >= 500 && !isSafeAiError(error)
    ? "Internal server error"
    : error instanceof Error ? error.message : "Request failed";
  return json({ error: message }, { status });
}

async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel("request body too large");
        } catch {
          // The typed size error is the client-visible result even if a
          // custom stream rejects cancellation during cleanup.
        }
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readText(request: Request, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<string> {
  const bytes = await readBoundedBytes(request, maxBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InvalidRequestBodyError("Invalid UTF-8 request body");
  }
}

export async function readJson(request: Request, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<unknown> {
  const text = await readText(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidRequestBodyError("Invalid JSON");
  }
}

export async function contextOrResponse() {
  try {
    return { context: await requirePortalContext() } as const;
  } catch (error) {
    return { response: errorResponse(error) } as const;
  }
}
