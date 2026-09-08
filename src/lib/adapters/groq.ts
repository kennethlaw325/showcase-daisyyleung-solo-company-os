import { z } from "zod";

/** Server-only Groq speech-to-text adapter with a fixed provider origin. */
export const GROQ_PROVIDER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const GROQ_DEFAULT_TIMEOUT_MS = 30_000;
export const GROQ_DEFAULT_RETRY_AFTER_SECONDS = 60;
export const GROQ_MAX_RETRY_AFTER_SECONDS = 3_600;

export const GROQ_TRANSCRIPTION_MODELS = [
  "whisper-large-v3-turbo",
  "whisper-large-v3",
] as const;

export type GroqTranscriptionModel = (typeof GROQ_TRANSCRIPTION_MODELS)[number];

export const GROQ_AUDIO_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/wav"] as const;
export type GroqAudioMimeType = (typeof GROQ_AUDIO_MIME_TYPES)[number];

const groqModelSchema = z.enum(GROQ_TRANSCRIPTION_MODELS);
const groqLanguageSchema = z.string().regex(/^[a-z]{2}$/i);
const groqSuccessResponseSchema = z.object({
  text: z.string().trim().min(1),
}).passthrough();

export type GroqTranscript = {
  transcript: string;
  requestId?: string;
};

export type GroqErrorCode =
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "payload_too_large"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_error"
  | "invalid_response"
  | "timeout"
  | "transport"
  | "aborted";

export interface GroqErrorOptions {
  code: GroqErrorCode;
  status: number;
  retryable?: boolean;
  requestId?: string;
  retryAfter?: number;
  providerStatus?: number;
  cause?: unknown;
}

/** A content-free, bounded error that may cross the route boundary. */
export class GroqError extends Error {
  readonly code: GroqErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly retryAfter?: number;
  readonly providerStatus?: number;

  constructor(message: string, options: GroqErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "GroqError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
    this.providerStatus = options.providerStatus;
  }
}

export interface GroqRuntime {
  apiKey: string;
  model: GroqTranscriptionModel;
}

export interface TranscribeGroqOptions {
  /** Optional ISO-639-1 language hint, such as `en` or `zh`. */
  language?: string;
  model?: string;
  filename?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return undefined;
  if (![...normalized].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x21 && code <= 0x7e;
  })) return undefined;
  return normalized;
}

function responseRequestId(response: Response, payload?: unknown): string | undefined {
  const headerId = safeRequestId(response.headers.get("x-request-id") ?? response.headers.get("request-id"));
  if (headerId) return headerId;
  if (typeof payload !== "object" || payload === null) return undefined;
  const candidate = payload as Record<string, unknown>;
  const groqMetadata = typeof candidate.x_groq === "object" && candidate.x_groq !== null
    ? candidate.x_groq as Record<string, unknown>
    : undefined;
  return safeRequestId(groqMetadata?.id);
}

function normalizeRetryAfter(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const number = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.min(GROQ_MAX_RETRY_AFTER_SECONDS, Math.floor(number));
}

function parseProviderErrorBody(raw: string): unknown {
  if (!raw || raw.length > 256_000) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function providerErrorForResponse(response: Response, payload: unknown): GroqError {
  const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
    ? response.status
    : 502;
  const requestId = responseRequestId(response, payload);
  const retryAfter = status === 429
    ? normalizeRetryAfter(response.headers.get("retry-after")) ?? GROQ_DEFAULT_RETRY_AFTER_SECONDS
    : undefined;

  if (status === 400 || status === 404 || status === 422) {
    return new GroqError("Groq rejected the recording request.", { code: "invalid_request", status: 400, providerStatus: status, requestId });
  }
  if (status === 401) {
    return new GroqError("Groq rejected the configured server credentials.", { code: "unauthorized", status: 503, providerStatus: status, requestId });
  }
  if (status === 403) {
    return new GroqError("Groq denied the transcription request.", { code: "forbidden", status: 503, providerStatus: status, requestId });
  }
  if (status === 413) {
    return new GroqError("The recording is too large for Groq.", { code: "payload_too_large", status, providerStatus: status, requestId });
  }
  if (status === 429) {
    return new GroqError("Groq is rate limiting transcription requests.", { code: "rate_limited", status, retryable: true, providerStatus: status, requestId, retryAfter });
  }
  if (status === 498 || status === 500 || status === 502 || status === 503) {
    return new GroqError("Groq is temporarily unavailable.", { code: "provider_unavailable", status: 503, retryable: true, providerStatus: status, requestId });
  }
  return new GroqError("Groq transcription failed.", {
    code: "provider_error",
    status: status >= 500 ? 502 : status,
    retryable: status >= 500,
    providerStatus: status,
    requestId,
  });
}

function safeTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return GROQ_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(value), 120_000);
}

export function normalizeGroqAudioMimeType(value: string | null | undefined): GroqAudioMimeType | null {
  if (typeof value !== "string") return null;
  const base = value.split(";", 1)[0]?.trim().toLowerCase();
  return (GROQ_AUDIO_MIME_TYPES as readonly string[]).includes(base)
    ? base as GroqAudioMimeType
    : null;
}

export function getGroqModel(value = process.env.GROQ_TRANSCRIPTION_MODEL): GroqTranscriptionModel {
  const configured = value?.trim() || "whisper-large-v3-turbo";
  const parsed = groqModelSchema.safeParse(configured);
  if (!parsed.success) {
    throw new GroqError("Groq transcription model is not configured.", { code: "not_configured", status: 503 });
  }
  return parsed.data;
}

export function getGroqRuntime(): GroqRuntime {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new GroqError("Groq transcription is not configured.", { code: "not_configured", status: 503 });
  return { apiKey, model: getGroqModel() };
}

function requestLanguage(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = groqLanguageSchema.safeParse(value.trim());
  if (!parsed.success) throw new GroqError("Groq language hint is invalid.", { code: "invalid_request", status: 400 });
  return parsed.data.toLowerCase();
}

function buildAbortSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort("timeout");
  }, timeoutMs);
  const onAbort = () => controller.abort(parent?.reason ?? "aborted");
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort|cancel/i.test(error.message));
}

/**
 * Sends one recording to Groq. The audio POST is never retried because the
 * provider may have processed the recording even when the response is lost.
 */
export async function transcribeGroq(audio: Blob, options: TranscribeGroqOptions = {}): Promise<GroqTranscript> {
  const runtime = getGroqRuntime();
  const mimeType = normalizeGroqAudioMimeType(audio.type);
  if (!mimeType) throw new GroqError("This recording format is not supported.", { code: "invalid_request", status: 400 });
  if (!Number.isFinite(audio.size) || audio.size <= 0) throw new GroqError("The recording is empty.", { code: "invalid_request", status: 400 });
  if (audio.size > GROQ_MAX_AUDIO_BYTES) throw new GroqError("The recording is too large.", { code: "payload_too_large", status: 413 });

  const model = getGroqModel(options.model ?? runtime.model);
  const language = requestLanguage(options.language);
  const extension = mimeType === "audio/ogg" ? "ogg" : mimeType === "audio/wav" ? "wav" : "webm";
  const form = new FormData();
  form.append("file", audio, options.filename?.trim() || `recording.${extension}`);
  form.append("model", model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (language) form.append("language", language);

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = buildAbortSignal(options.signal, safeTimeoutMs(options.timeoutMs));
  if (options.signal?.aborted) {
    timeout.cleanup();
    throw new GroqError("Groq transcription was cancelled.", { code: "aborted", status: 499 });
  }

  let response: Response;
  try {
    response = await fetchImpl(GROQ_PROVIDER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}` },
      body: form,
      signal: timeout.signal,
    });
  } catch (error) {
    const abortedByCaller = Boolean(options.signal?.aborted);
    const didTimeout = timeout.didTimeout();
    timeout.cleanup();
    if (didTimeout) throw new GroqError("Groq transcription timed out.", { code: "timeout", status: 504, retryable: true, cause: error });
    if (abortedByCaller || isAbortError(error)) throw new GroqError("Groq transcription was cancelled.", { code: "aborted", status: 499, cause: error });
    throw new GroqError("Groq transcription could not be reached.", { code: "transport", status: 502, retryable: true, cause: error });
  }
  timeout.cleanup();

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = parseProviderErrorBody(await response.text());
    } catch {
      payload = undefined;
    }
    throw providerErrorForResponse(response, payload);
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    throw new GroqError("Groq returned an unreadable response.", { code: "invalid_response", status: 502, cause: error });
  }
  if (raw.length > 256_000) throw new GroqError("Groq returned an oversized response.", { code: "invalid_response", status: 502 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new GroqError("Groq returned an invalid response.", { code: "invalid_response", status: 502, cause: error });
  }
  const result = groqSuccessResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new GroqError("Groq returned an invalid response.", { code: "invalid_response", status: 502, requestId: responseRequestId(response, parsed) });
  }
  return {
    transcript: result.data.text,
    ...(responseRequestId(response, parsed) ? { requestId: responseRequestId(response, parsed) } : {}),
  };
}
