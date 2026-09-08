import type { ProviderGenerationInput, ProviderGenerationResult } from "./ai";

type GeminiInteractionResponse = {
  id?: string;
  status?: string;
  error?: unknown;
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_tokens?: number;
  };
};

type GeminiErrorResponse = {
  error?: {
    code?: string | number;
    message?: string;
    status?: string;
  };
};

const GEMINI_REQUEST_FIELDS = ["model", "input", "system_instruction", "response_format", "generation_config", "store", "background"] as const;

type GeminiSafeErrorCode = "timeout" | "provider_request" | "invalid_output" | "not_configured" | "quota";

function safeError(message: string, code: GeminiSafeErrorCode, status?: number, providerLabel?: string): Error {
  const safeStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  return Object.assign(new Error(message), {
    aiError: true,
    aiErrorCode: code,
    ...(safeStatus === undefined ? {} : { status: safeStatus, providerStatus: safeStatus }),
    ...(providerLabel ? { providerLabel } : {}),
  });
}

function safeGeminiErrorLabel(payload: GeminiErrorResponse, raw = ""): string {
  const error = payload.error;
  const rawCode = typeof error?.code === "string" ? error.code : typeof error?.status === "string" ? error.status : "request_failed";
  const safeCodes = new Set(["authentication", "billing_required", "model_not_found", "quota_exceeded", "permission_denied", "parameter_unknown", "invalid_request", "request_failed"]);
  const code = safeCodes.has(rawCode.toLowerCase()) ? rawCode.toLowerCase() : "request_failed";
  const message = error?.message ?? raw;
  const fields = GEMINI_REQUEST_FIELDS.filter((field) => new RegExp(`(?:at|field|parameter)\\s+["']?${field}\\b`, "i").test(message));
  if (/api key|authentication|credential/i.test(message)) return "authentication";
  if (/billing|paid tier/i.test(message)) return "billing_required";
  if (/not found/i.test(message) && /model/i.test(message)) return "model_not_found";
  if (/quota|rate limit/i.test(message)) return "quota_exceeded";
  if (/permission|not authorized/i.test(message)) return "permission_denied";
  if (/unknown (?:name|parameter)/i.test(message)) {
    const unknown = message.match(/unknown (?:name|parameter)\s+["']([a-z0-9_.-]+)["']/i)?.[1];
    const knownUnknown = unknown && GEMINI_REQUEST_FIELDS.includes(unknown as typeof GEMINI_REQUEST_FIELDS[number]) ? unknown : undefined;
    return knownUnknown ? `parameter_unknown:${knownUnknown}` : fields.length ? `parameter_unknown:${fields.join(",")}` : "parameter_unknown";
  }
  if (/invalid (?:json|argument|request)|malformed/i.test(message)) return fields.length ? `invalid_request:${fields.join(",")}` : "invalid_request";
  return fields.length ? `${code}:${fields.join(",")}` : code;
}

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw safeError("Gemini configuration is missing", "not_configured");
  return apiKey;
}

function outputText(response: GeminiInteractionResponse): string | undefined {
  const text = response.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
  return text || undefined;
}

function interactionStatusError(interaction: GeminiInteractionResponse): Error | undefined {
  if (interaction.status !== "completed") return safeError("Gemini interaction did not complete", "provider_request");
  if (!outputText(interaction)) return safeError("Gemini returned no model output", "invalid_output");
  return undefined;
}

/** Stateless Gemini Interactions call; request and response storage is explicitly disabled. */
export async function generateGeminiStructured<T>(input: ProviderGenerationInput<T>): Promise<ProviderGenerationResult<T>> {
  const apiKey = getApiKey();
  let aggregateInputTokens = 0;
  let aggregateOutputTokens = 0;
  let aggregateTotalTokens = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: input.model,
        input: typeof input.input === "string" ? input.input : JSON.stringify(input.input),
        ...(input.system ? { system_instruction: input.system } : {}),
        store: false,
        background: false,
        generation_config: { max_output_tokens: input.maxOutputTokens ?? 8_000 },
        response_format: [{ type: "text", mime_type: "application/json", schema: input.schema }],
      }),
      signal: input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined,
      });
    } catch (error) {
      if (error instanceof Error && /timeout|aborted|abort/i.test(error.name + error.message)) {
        throw safeError("Gemini request timed out", "timeout");
      }
      throw safeError("Gemini request could not be sent", "provider_request");
    }
    if (!response.ok) {
      let label = "request_failed";
      try {
        const raw = await response.text();
        let payload: GeminiErrorResponse = {};
        try {
          payload = JSON.parse(raw) as GeminiErrorResponse;
        } catch {
          // Some Google API errors are returned as plain text.
        }
        label = safeGeminiErrorLabel(payload, raw);
      } catch {
        // Provider error bodies are not guaranteed to be readable.
      }
      const errorCode: GeminiSafeErrorCode = label === "quota_exceeded" || response.status === 429
        ? "quota"
        : label === "authentication" || response.status === 401
          ? "not_configured"
          : "provider_request";
      throw safeError(`Gemini request failed (${response.status}: ${label})`, errorCode, response.status, label);
    }
    let interaction: GeminiInteractionResponse;
    try {
      interaction = await response.json() as GeminiInteractionResponse;
    } catch {
      throw safeError("Gemini returned an invalid interaction response", "provider_request", response.status);
    }
    aggregateInputTokens += interaction.usage?.total_input_tokens ?? 0;
    aggregateOutputTokens += interaction.usage?.total_output_tokens ?? 0;
    aggregateTotalTokens += interaction.usage?.total_tokens
      ?? (interaction.usage?.total_input_tokens ?? 0) + (interaction.usage?.total_output_tokens ?? 0);
    const interactionError = interactionStatusError(interaction);
    if (interactionError) throw interactionError;
    const text = outputText(interaction);
    if (!text) throw safeError("Gemini returned no model output", "invalid_output");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (attempt === 0) continue;
      throw safeError("Gemini returned invalid structured output after one retry", "invalid_output");
    }
    const validation = input.validator.safeParse(parsed);
    if (!validation.success) {
      if (attempt === 0) continue;
      throw safeError("Gemini returned schema-invalid structured output after one retry", "invalid_output");
    }
    return {
      value: validation.data,
      responseId: interaction.id,
      usage: {
        inputTokens: aggregateInputTokens,
        outputTokens: aggregateOutputTokens,
        totalTokens: aggregateTotalTokens,
      },
    };
  }
  throw safeError("Gemini structured output failed", "invalid_output");
}
