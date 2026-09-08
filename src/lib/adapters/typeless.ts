import { z } from "zod";

/**
 * @deprecated Superseded by the Groq adapter. This server-only file is kept
 * temporarily because project deletion requires explicit user approval.
 */

export const TYPELESS_PROVIDER_URL = "https://api.typelessapi.com/v1/transcribe";
export const TYPELESS_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const TYPELESS_DEFAULT_TIMEOUT_MS = 30_000;
export const TYPELESS_DEFAULT_RETRY_AFTER_SECONDS = 60;
export const TYPELESS_MAX_RETRY_AFTER_SECONDS = 3_600;

export const TYPELESS_MODELS = [
  "typeless-1.0-lite",
  "typeless-1.0-pro",
  "typeless-1.0-max",
] as const;

export type TypelessModel = (typeof TYPELESS_MODELS)[number];

export const TYPELESS_AUDIO_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/wav"] as const;
export type TypelessAudioMimeType = (typeof TYPELESS_AUDIO_MIME_TYPES)[number];

const typelessModelSchema = z.enum(TYPELESS_MODELS);
const typelessLanguageSchema = z.string().regex(/^[a-z]{2}$/i);

const typelessSuccessResponseSchema = z.object({
  status: z.literal("success"),
  result: z.object({
    transcript: z.string().trim().min(1),
    detected_language: z.string().trim().min(1).nullable(),
    duration_seconds: z.number().finite().nonnegative(),
  }).strict(),
  usage: z.object({
    billed_audio_seconds: z.number().finite().nonnegative(),
    output_token_count: z.number().int().nonnegative(),
  }).strict(),
  request_id: z.string().trim().min(1).max(200),
}).strict();

export type TypelessTranscript = {
  transcript: string;
  detectedLanguage: string | null;
  durationSeconds: number;
  usage: {
    billedAudioSeconds: number;
    outputTokenCount: number;
  };
  requestId: string;
};

export type TypelessErrorCode =
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "payment_required"
  | "forbidden"
  | "payload_too_large"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_error"
  | "invalid_response"
  | "timeout"
  | "transport"
  | "aborted";

export interface TypelessErrorOptions {
  code: TypelessErrorCode;
  status: number;
  retryable?: boolean;
  requestId?: string;
  retryAfter?: number;
  providerStatus?: number;
  cause?: unknown;
}

/** A safe, metadata-only error that can cross the route boundary. */
export class TypelessError extends Error {
  readonly code: TypelessErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly retryAfter?: number;
  readonly providerStatus?: number;

  constructor(message: string, options: TypelessErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "TypelessError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
    this.providerStatus = options.providerStatus;
  }
}

/** Alias kept explicit for callers that prefer a provider-specific name. */
export { TypelessError as TypelessAdapterError };

export interface TypelessRuntime {
  apiKey: string;
  model: TypelessModel;
}

export interface TranscribeTypelessOptions {
  /** Optional ISO-639-1 language hint (for example, `en` or `zh`). */
  language?: string;
  /** Tests and controlled server callers may override the configured model. */
  model?: string;
  filename?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function safeStatus(status: unknown, fallback = 502): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : fallback;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return undefined;
  // Request IDs are metadata only. Keep control characters and delimiters out
  // of logs/headers even if a provider response is malformed.
  if (![...normalized].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x21 && code <= 0x7e;
  })) return undefined;
  return normalized;
}

function normalizeRetryAfter(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const number = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.min(TYPELESS_MAX_RETRY_AFTER_SECONDS, Math.floor(number));
}

function responseRequestId(response: Response, payload?: unknown): string | undefined {
  const headerId = safeRequestId(response.headers.get("x-request-id") ?? response.headers.get("request-id"));
  if (headerId) return headerId;
  if (typeof payload !== "object" || payload === null) return undefined;
  const candidate = payload as Record<string, unknown>;
  const error = typeof candidate.error === "object" && candidate.error !== null
    ? candidate.error as Record<string, unknown>
    : undefined;
  return safeRequestId(candidate.request_id ?? candidate.requestId ?? error?.request_id ?? error?.requestId);
}

function parseProviderErrorBody(raw: string): unknown {
  if (!raw || raw.length > 256_000) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function providerErrorForResponse(response: Response, payload: unknown): TypelessError {
  const status = safeStatus(response.status);
  const requestId = responseRequestId(response, payload);
  const retryAfter = status === 429
    ? normalizeRetryAfter(response.headers.get("retry-after")) ?? TYPELESS_DEFAULT_RETRY_AFTER_SECONDS
    : undefined;

  if (status === 400) return new TypelessError("Typeless rejected the recording request.", { code: "invalid_request", status, providerStatus: status, requestId });
  if (status === 401) return new TypelessError("Typeless authentication is not configured correctly.", { code: "unauthorized", status: 503, providerStatus: status, requestId });
  if (status === 402) return new TypelessError("Typeless transcription requires an active billing plan.", { code: "payment_required", status, providerStatus: status, requestId });
  if (status === 403) return new TypelessError("Typeless denied the transcription request.", { code: "forbidden", status, providerStatus: status, requestId });
  if (status === 413) return new TypelessError("The recording is too large for Typeless.", { code: "payload_too_large", status, providerStatus: status, requestId });
  if (status === 429) return new TypelessError("Typeless is rate limiting transcription requests.", { code: "rate_limited", status, retryable: true, providerStatus: status, requestId, retryAfter });
  if (status === 500 || status === 503) return new TypelessError("Typeless is temporarily unavailable.", { code: "provider_unavailable", status: 503, retryable: true, providerStatus: status, requestId });
  return new TypelessError("Typeless transcription failed.", { code: "provider_error", status: status >= 500 ? 502 : status, retryable: status >= 500, providerStatus: status, requestId });
}

function safeTimeoutMs(value: number | undefined): number {
  if (value === undefined) return TYPELESS_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) return TYPELESS_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(value), 120_000);
}

export function normalizeTypelessAudioMimeType(value: string | null | undefined): TypelessAudioMimeType | null {
  if (typeof value !== "string") return null;
  const base = value.split(";", 1)[0]?.trim().toLowerCase();
  return (TYPELESS_AUDIO_MIME_TYPES as readonly string[]).includes(base)
    ? base as TypelessAudioMimeType
    : null;
}

export function getTypelessModel(value = process.env.TYPELESS_TRANSCRIPT_MODEL): TypelessModel {
  const configured = value?.trim() || "typeless-1.0-pro";
  const parsed = typelessModelSchema.safeParse(configured);
  if (!parsed.success) {
    throw new TypelessError("Typeless transcription model is not configured.", { code: "not_configured", status: 503 });
  }
  return parsed.data;
}

export function getTypelessRuntime(): TypelessRuntime {
  const apiKey = process.env.TYPELESS_API_KEY?.trim();
  if (!apiKey) throw new TypelessError("Typeless transcription is not configured.", { code: "not_configured", status: 503 });
  return { apiKey, model: getTypelessModel() };
}

function requestLanguage(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = typelessLanguageSchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new TypelessError("Typeless language hint is invalid.", { code: "invalid_request", status: 400 });
  }
  return parsed.data.toLowerCase();
}

function requestModel(value: string | undefined): TypelessModel {
  try {
    return getTypelessModel(value);
  } catch (error) {
    if (error instanceof TypelessError) throw error;
    throw new TypelessError("Typeless transcription model is invalid.", { code: "invalid_request", status: 400, cause: error });
  }
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
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /abort|cancel/i.test(error.message);
}

/**
 * Sends one recording to Typeless and validates the complete success shape.
 * This operation is deliberately never retried: the provider may bill an
 * audio POST even when the client does not receive a response.
 */
export async function transcribeTypeless(audio: Blob, options: TranscribeTypelessOptions = {}): Promise<TypelessTranscript> {
  const runtime = getTypelessRuntime();
  const mimeType = normalizeTypelessAudioMimeType(audio.type);
  if (!mimeType) throw new TypelessError("This recording format is not supported.", { code: "invalid_request", status: 400 });
  if (!Number.isFinite(audio.size) || audio.size <= 0) throw new TypelessError("The recording is empty.", { code: "invalid_request", status: 400 });
  if (audio.size > TYPELESS_MAX_AUDIO_BYTES) throw new TypelessError("The recording is too large.", { code: "payload_too_large", status: 413 });

  const model = requestModel(options.model ?? runtime.model);
  const language = requestLanguage(options.language);
  const form = new FormData();
  const extension = mimeType === "audio/ogg" ? "ogg" : mimeType === "audio/wav" ? "wav" : "webm";
  form.append("audio", audio, options.filename?.trim() || `recording.${extension}`);
  form.append("model", model);
  if (language) form.append("language", language);

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = buildAbortSignal(options.signal, safeTimeoutMs(options.timeoutMs));
  if (options.signal?.aborted) {
    timeout.cleanup();
    throw new TypelessError("Typeless transcription was cancelled.", { code: "aborted", status: 499 });
  }

  let response: Response;
  try {
    response = await fetchImpl(TYPELESS_PROVIDER_URL, {
      method: "POST",
      headers: { Authorization: `Token ${runtime.apiKey}` },
      body: form,
      signal: timeout.signal,
    });
  } catch (error) {
    const abortedByCaller = Boolean(options.signal?.aborted);
    const didTimeout = timeout.didTimeout();
    timeout.cleanup();
    if (didTimeout) throw new TypelessError("Typeless transcription timed out.", { code: "timeout", status: 504, retryable: true, cause: error });
    if (abortedByCaller || isAbortError(error)) throw new TypelessError("Typeless transcription was cancelled.", { code: "aborted", status: 499, cause: error });
    throw new TypelessError("Typeless transcription could not be reached.", { code: "transport", status: 502, retryable: true, cause: error });
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
    throw new TypelessError("Typeless returned an unreadable response.", { code: "invalid_response", status: 502, cause: error });
  }
  if (raw.length > 256_000) throw new TypelessError("Typeless returned an oversized response.", { code: "invalid_response", status: 502 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new TypelessError("Typeless returned an invalid response.", { code: "invalid_response", status: 502, cause: error });
  }
  const result = typelessSuccessResponseSchema.safeParse(parsed);
  if (!result.success) {
    const requestId = responseRequestId(response, parsed);
    throw new TypelessError("Typeless returned an invalid response.", { code: "invalid_response", status: 502, requestId });
  }
  return {
    transcript: result.data.result.transcript,
    detectedLanguage: result.data.result.detected_language,
    durationSeconds: result.data.result.duration_seconds,
    usage: {
      billedAudioSeconds: result.data.usage.billed_audio_seconds,
      outputTokenCount: result.data.usage.output_token_count,
    },
    requestId: result.data.request_id,
  };
}
