import OpenAI from "openai";
import type { ProviderGenerationInput, ProviderGenerationResult } from "./ai";

type OpenAISafeErrorCode = "timeout" | "provider_request" | "invalid_output" | "not_configured" | "quota";
type OpenAIErrorMetadata = { status?: unknown; name?: unknown; message?: unknown };

const OPENAI_PROVIDER_LABELS = {
  authentication: "authentication",
  quota: "quota_exceeded",
  invalidRequest: "invalid_request",
  permissionDenied: "permission_denied",
  modelNotFound: "model_not_found",
  requestFailed: "request_failed",
} as const;

function metadata(error: unknown): OpenAIErrorMetadata | undefined {
  return typeof error === "object" && error !== null ? error as OpenAIErrorMetadata : undefined;
}

function sanitizedStatus(error: unknown): number | undefined {
  const value = metadata(error)?.status;
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function isTimeoutError(error: unknown): boolean {
  const value = metadata(error);
  const name = typeof value?.name === "string" ? value.name : "";
  const message = typeof value?.message === "string" ? value.message : "";
  return /abort|timeout|timed out|deadline/i.test(`${name} ${message}`);
}

function safeError(message: string, code: OpenAISafeErrorCode, status?: number, providerLabel?: string): Error {
  const safeStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  return Object.assign(new Error(message), {
    aiError: true,
    aiErrorCode: code,
    ...(safeStatus === undefined ? {} : { status: safeStatus, providerStatus: safeStatus }),
    ...(providerLabel ? { providerLabel } : {}),
  });
}

function safeProviderFailure(error: unknown): Error {
  if (isTimeoutError(error)) return safeError("OpenAI request timed out", "timeout");
  const status = sanitizedStatus(error);
  let providerLabel: string = OPENAI_PROVIDER_LABELS.requestFailed;
  let code: OpenAISafeErrorCode = "provider_request";
  if (status === 401) {
    providerLabel = OPENAI_PROVIDER_LABELS.authentication;
    code = "not_configured";
  } else if (status === 429) {
    providerLabel = OPENAI_PROVIDER_LABELS.quota;
    code = "quota";
  } else if (status === 400 || status === 422) {
    providerLabel = OPENAI_PROVIDER_LABELS.invalidRequest;
  } else if (status === 403) {
    providerLabel = OPENAI_PROVIDER_LABELS.permissionDenied;
  } else if (status === 404) {
    providerLabel = OPENAI_PROVIDER_LABELS.modelNotFound;
  }
  const statusText = status === undefined ? providerLabel : `${status}: ${providerLabel}`;
  return safeError(`OpenAI request failed (${statusText})`, code, status, providerLabel);
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw safeError("OpenAI configuration is missing", "not_configured");
  return new OpenAI({ apiKey, maxRetries: 0 });
}

/** Structured Responses call; privacy defaults are explicit and non-negotiable. */
export async function generateOpenAIStructured<T>(input: ProviderGenerationInput<T>): Promise<ProviderGenerationResult<T>> {
  const model = input.model;
  const client = getClient();
  const request = {
    model,
    input: [
      ...(input.system ? [{ role: "system", content: input.system }] : []),
      { role: "user", content: typeof input.input === "string" ? input.input : JSON.stringify(input.input) },
    ],
    store: false,
    background: false,
    max_output_tokens: input.maxOutputTokens ?? 8_000,
    text: {
      format: {
        type: "json_schema",
        name: input.schemaName,
        strict: true,
        schema: input.schema,
      },
    },
  } as unknown as Parameters<typeof client.responses.create>[0];
  let aggregateInputTokens = 0;
  let aggregateOutputTokens = 0;
  let aggregateTotalTokens = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: {
      output_text?: string;
      id?: string;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    try {
      response = (await client.responses.create(request, input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : undefined)) as unknown as typeof response;
    } catch (error) {
      const status = sanitizedStatus(error);
      if (!isTimeoutError(error) && status !== undefined && status >= 500 && status <= 599 && attempt === 0) continue;
      throw safeProviderFailure(error);
    }
    aggregateInputTokens += response.usage?.input_tokens ?? 0;
    aggregateOutputTokens += response.usage?.output_tokens ?? 0;
    aggregateTotalTokens += response.usage?.total_tokens ?? (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
    let parsed: unknown;
    try {
      if (!response.output_text) throw new Error("missing output");
      parsed = JSON.parse(response.output_text);
    } catch {
      if (attempt === 0) continue;
      throw safeError("OpenAI returned invalid structured output after one retry", "invalid_output");
    }
    const validation = input.validator.safeParse(parsed);
    if (!validation.success) {
      if (attempt === 0) continue;
      throw safeError("OpenAI returned schema-invalid structured output after one retry", "invalid_output");
    }
    return {
      value: validation.data,
      responseId: response.id,
      usage: { inputTokens: aggregateInputTokens, outputTokens: aggregateOutputTokens, totalTokens: aggregateTotalTokens },
    };
  }
  throw safeError("OpenAI structured output failed", "invalid_output");
}
