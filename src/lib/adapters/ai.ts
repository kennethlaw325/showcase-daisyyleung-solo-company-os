import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { createSupabaseAdminClient } from "../supabase/admin";
import { generateGeminiStructured } from "./gemini";
import { generateOpenAIStructured } from "./openai";

export type AiProvider = "gemini" | "openai";
export type AiModelRole = "fast" | "reasoning";

export type AiErrorCode = "timeout" | "provider_request" | "invalid_output" | "not_configured" | "quota" | "generic";

type AiErrorMetadata = {
  aiError?: unknown;
  aiErrorCode?: unknown;
  status?: unknown;
  providerStatus?: unknown;
  providerLabel?: unknown;
};

const AI_ERROR_CODES: readonly AiErrorCode[] = ["timeout", "provider_request", "invalid_output", "not_configured", "quota", "generic"];
const AI_PROVIDER_LABEL_BASES = new Set(["authentication", "billing_required", "model_not_found", "quota_exceeded", "permission_denied", "parameter_unknown", "invalid_request", "request_failed"]);
const AI_PROVIDER_LABEL_FIELDS = new Set(["model", "input", "system_instruction", "response_format", "generation_config", "store", "background"]);

function aiErrorMetadata(error: unknown): AiErrorMetadata | undefined {
  return typeof error === "object" && error !== null ? error as AiErrorMetadata : undefined;
}

function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === "string" && AI_ERROR_CODES.includes(value as AiErrorCode);
}

function isSafeProviderLabel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (AI_PROVIDER_LABEL_BASES.has(value)) return true;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1 || value.indexOf(":", separator + 1) !== -1) return false;
  const base = value.slice(0, separator);
  const fields = value.slice(separator + 1).split(",");
  return AI_PROVIDER_LABEL_BASES.has(base)
    && fields.length > 0
    && fields.every((field) => AI_PROVIDER_LABEL_FIELDS.has(field));
}

export type AiErrorDiagnostics = { providerStatus?: number; providerLabel?: string };

/** Return only bounded provider metadata safe for operational logs. */
export function getAiErrorDiagnostics(error: unknown): AiErrorDiagnostics {
  const metadata = aiErrorMetadata(error);
  const diagnostics: AiErrorDiagnostics = {};
  if (typeof metadata?.providerStatus === "number" && Number.isInteger(metadata.providerStatus) && metadata.providerStatus >= 100 && metadata.providerStatus <= 599) {
    diagnostics.providerStatus = metadata.providerStatus;
  }
  if (isSafeProviderLabel(metadata?.providerLabel)) diagnostics.providerLabel = metadata.providerLabel;
  return diagnostics;
}

/** Map internal AI failures to a small, safe set of operational categories. */
export function classifyAiError(error: unknown): AiErrorCode {
  if (error instanceof QuotaExceededError) return "quota";
  const metadata = aiErrorMetadata(error);
  if (isAiErrorCode(metadata?.aiErrorCode)) return metadata.aiErrorCode;
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|deadline|aborted/i.test(message)) return "timeout";
  if (/quota|rate limit|too many requests|\b429\b/i.test(message)) return "quota";
  if (/configuration|not configured|api key|credential/i.test(message)) return "not_configured";
  if (/invalid (?:structured )?output|schema-invalid|missing output|malformed output|invalid interaction/i.test(message)) return "invalid_output";
  if (/provider|request failed|interaction (?:did not complete|failed)|api error/i.test(message)) return "provider_request";
  return "generic";
}

export function isAiError(error: unknown): boolean {
  const metadata = aiErrorMetadata(error);
  return error instanceof QuotaExceededError || metadata?.aiError === true || isAiErrorCode(metadata?.aiErrorCode);
}

export function aiErrorUserMessage(code: AiErrorCode): string {
  switch (code) {
    case "timeout": return "AI generation timed out. Please try again.";
    case "provider_request": return "The AI provider could not complete this request. Please try again.";
    case "invalid_output": return "The AI provider returned an unusable result. Please try again.";
    case "not_configured": return "AI generation is not configured for this workspace.";
    case "quota": return "The AI usage limit has been reached. Please try again later.";
    default: return "AI generation failed. Please try again.";
  }
}

export function aiErrorHttpStatus(code: AiErrorCode): number {
  switch (code) {
    case "quota": return 429;
    case "timeout": return 504;
    case "not_configured": return 503;
    case "provider_request":
    case "invalid_output": return 502;
    default: return 500;
  }
}

/** Convert an internal AI failure into a bounded route-safe error. */
export function toSafeAiError(error: unknown): Error & { status: number; aiError: true; aiErrorCode: AiErrorCode } {
  const code = classifyAiError(error);
  return Object.assign(new Error(aiErrorUserMessage(code)), {
    status: aiErrorHttpStatus(code),
    aiError: true as const,
    aiErrorCode: code,
  });
}

function markAiError(error: unknown, fallbackCode?: AiErrorCode): Error {
  const target = error instanceof Error ? error : new Error("AI generation failed");
  Object.assign(target, { aiError: true, ...(fallbackCode ? { aiErrorCode: fallbackCode } : {}) });
  return target;
}

export class QuotaExceededError extends Error {
  readonly status = 429;
  readonly aiError = true;
  readonly aiErrorCode: AiErrorCode = "quota";

  constructor(message = "AI usage quota exceeded") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

/** Conservative planning prices; update only after a vendor pricing review. */
const MODEL_PRICING_USD_PER_MILLION: Readonly<Record<AiProvider, Readonly<Record<string, ModelPricing>>>> = {
  gemini: {
    "gemini-3.6-flash": { inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5 },
    "gemini-3.5-flash-lite": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
    "gemini-2.5-pro": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
    "gemini-2.5-flash": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
    default: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  },
  openai: {
    "gpt-5.6-luna": { inputUsdPerMillion: 15, outputUsdPerMillion: 60 },
    "gpt-5.6-terra": { inputUsdPerMillion: 5, outputUsdPerMillion: 20 },
    default: { inputUsdPerMillion: 20, outputUsdPerMillion: 80 },
  },
};

export const DEFAULT_QUOTA_INPUT_TOKENS = 120_000;
export const DEFAULT_QUOTA_OUTPUT_TOKENS = 8_000;
export const MONTHLY_AI_CALL_CAP = 50;
export const MONTHLY_ESTIMATED_USD_CAP = 5;

export interface AiRuntime {
  provider: AiProvider;
  model: string;
}

export interface ProviderGenerationInput<T> {
  model: string;
  system?: string;
  input: string | Record<string, unknown>;
  schemaName: string;
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ProviderGenerationResult<T> {
  value: T;
  responseId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface StructuredGenerationInput<T> extends Omit<ProviderGenerationInput<T>, "model" | "maxOutputTokens"> {
  provider?: AiProvider;
  model?: string;
  modelRole?: AiModelRole;
  workspaceId?: string;
  userId?: string;
  quotaUnits?: number;
  quotaClient?: SupabaseClient;
  quotaEstimatedCostUsd?: number;
}

export interface StructuredGenerationResult<T> extends ProviderGenerationResult<T> {
  provider: AiProvider;
  model: string;
  quotaReservationId?: string;
}

export function getConfiguredAiProvider(): AiProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (!configured) throw markAiError(new Error("AI provider is not configured"), "not_configured");
  if (configured === "openai") return "openai";
  if (configured === "gemini") return "gemini";
  throw markAiError(new Error("AI provider configuration is invalid"), "not_configured");
}

function getModelForProvider(provider: AiProvider, role: AiModelRole): string {
  if (provider === "gemini") {
    return role === "reasoning"
      ? process.env.GEMINI_REASONING_MODEL?.trim() || "gemini-3.6-flash"
      : process.env.GEMINI_FAST_MODEL?.trim() || "gemini-3.5-flash-lite";
  }
  return role === "reasoning"
    ? process.env.OPENAI_TERRA_MODEL?.trim() || process.env.OPENAI_LUNA_MODEL?.trim() || "gpt-5.6-terra"
    : process.env.OPENAI_LUNA_MODEL?.trim() || "gpt-5.6-luna";
}

export function getAiRuntime(role: AiModelRole): AiRuntime {
  const provider = getConfiguredAiProvider();
  return { provider, model: getModelForProvider(provider, role) };
}

export function estimateAiCostUsd(provider: AiProvider, model: string, inputTokens: number, outputTokens: number): number {
  const prices = MODEL_PRICING_USD_PER_MILLION[provider];
  const pricing = prices[model] ?? prices.default;
  return Number(((Math.max(0, inputTokens) * pricing.inputUsdPerMillion + Math.max(0, outputTokens) * pricing.outputUsdPerMillion) / 1_000_000).toFixed(6));
}

function sanitizeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sanitizeUsage(usage: ProviderGenerationResult<unknown>["usage"]): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const inputTokens = sanitizeTokenCount(usage?.inputTokens);
  const outputTokens = sanitizeTokenCount(usage?.outputTokens);
  const totalTokens = usage?.totalTokens === undefined
    ? Math.min(Number.MAX_SAFE_INTEGER, inputTokens + outputTokens)
    : sanitizeTokenCount(usage.totalTokens);
  return { inputTokens, outputTokens, totalTokens };
}

async function assertQuota(
  provider: AiProvider,
  workspaceId?: string,
  userId?: string,
  quotaUnits = 1,
  quotaClient?: SupabaseClient,
  model = "default",
  estimatedCostUsd = 0,
): Promise<string | undefined> {
  if (!workspaceId) return undefined;
  if (!userId) throw new Error("Quota actor is required");
  const client = quotaClient ?? (() => {
    try {
      return createSupabaseAdminClient();
    } catch {
      throw new Error("Quota storage is not configured");
    }
  })();
  const { data, error } = await client.rpc("reserve_workspace_ai_quota", {
    p_workspace_id: workspaceId,
    p_actor_id: userId,
    p_provider: provider,
    p_model: model,
    p_estimated_cost_usd: estimatedCostUsd,
    p_units: quotaUnits,
  });
  if (error) throw new Error("Quota check unavailable");
  if (!data || data === false || data === 0 || (typeof data === "object" && data !== null && "allowed" in data && data.allowed === false)) {
    throw new QuotaExceededError();
  }
  if (typeof data === "string") return data;
  if (typeof data === "number" && Number.isSafeInteger(data) && data > 0) return String(data);
  if (typeof data === "object" && data !== null && "id" in data && typeof data.id === "string") return data.id;
  return undefined;
}

export async function generateStructured<T>(input: StructuredGenerationInput<T>): Promise<StructuredGenerationResult<T>> {
  const role = input.modelRole ?? "fast";
  let provider: AiProvider;
  let model: string;
  try {
    provider = input.provider ?? getConfiguredAiProvider();
    model = input.model?.trim() || getModelForProvider(provider, role);
  } catch (error) {
    throw markAiError(error, "not_configured");
  }
  const estimatedCostUsd = input.quotaEstimatedCostUsd
    ?? estimateAiCostUsd(provider, model, DEFAULT_QUOTA_INPUT_TOKENS, DEFAULT_QUOTA_OUTPUT_TOKENS);
  let quotaReservationId: string | undefined;
  let quotaClient: SupabaseClient | undefined;
  try {
    quotaClient = input.workspaceId
      ? input.quotaClient ?? createSupabaseAdminClient()
      : undefined;
    quotaReservationId = await assertQuota(provider, input.workspaceId, input.userId, input.quotaUnits ?? 1, quotaClient, model, estimatedCostUsd);
  } catch (error) {
    throw markAiError(error, classifyAiError(error));
  }
  const providerInput: ProviderGenerationInput<T> = {
    model,
    system: input.system,
    input: input.input,
    schemaName: input.schemaName,
    schema: input.schema,
    validator: input.validator,
    maxOutputTokens: DEFAULT_QUOTA_OUTPUT_TOKENS,
    timeoutMs: input.timeoutMs,
  };
  let generated: ProviderGenerationResult<T>;
  try {
    generated = provider === "gemini"
      ? await generateGeminiStructured(providerInput)
      : await generateOpenAIStructured(providerInput);
  } catch (providerError) {
    if (quotaReservationId && quotaClient && input.userId) {
      try {
        const { data: refundData, error: refundError } = await quotaClient.rpc("complete_workspace_usage", {
          p_usage_event_id: quotaReservationId,
          p_actor_id: input.userId,
          p_input_tokens: 0,
          p_output_tokens: 0,
          p_total_tokens: 0,
          p_actual_cost_usd: 0,
        });
        if (refundError || !refundData) {
          console.error("AI quota refund failed", { component: "ai-adapter", reservationId: quotaReservationId });
        }
      } catch {
        console.error("AI quota refund failed", { component: "ai-adapter", reservationId: quotaReservationId });
      }
    }
    throw markAiError(providerError);
  }
  if (quotaReservationId && quotaClient && input.userId) {
    const usage = sanitizeUsage(generated.usage);
    const actualCostUsd = estimateAiCostUsd(provider, model, usage.inputTokens, usage.outputTokens);
    try {
      const { data: completionData, error: completionError } = await quotaClient.rpc("complete_workspace_usage", {
        p_usage_event_id: quotaReservationId,
        p_actor_id: input.userId,
        p_input_tokens: usage.inputTokens,
        p_output_tokens: usage.outputTokens,
        p_total_tokens: usage.totalTokens,
        p_actual_cost_usd: actualCostUsd,
      });
      if (completionError || !completionData) {
        console.error("AI usage completion failed", { component: "ai-adapter", reservationId: quotaReservationId });
      }
    } catch {
      console.error("AI usage completion failed", { component: "ai-adapter", reservationId: quotaReservationId });
    }
  }
  return { ...generated, provider, model, quotaReservationId };
}
