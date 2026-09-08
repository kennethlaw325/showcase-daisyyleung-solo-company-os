import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_QUOTA_INPUT_TOKENS,
  DEFAULT_QUOTA_OUTPUT_TOKENS,
  classifyAiError,
  estimateAiCostUsd,
  generateStructured,
  getAiRuntime,
  toSafeAiError,
} from "../adapters/ai";
import { styleRulesSchema } from "../domain/schemas";
import { hashJson } from "../security/hash";

export type StyleRules = {
  tone?: string[];
  structure?: string[];
  clarity?: string[];
  antiCorporate?: string[];
};

const MAX_RULES = 8;
const boundedRuleList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 240)).filter(Boolean).slice(0, MAX_RULES)
  : [];

export function normalizeStyleRules(value: unknown): StyleRules {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    tone: boundedRuleList(input.tone),
    structure: boundedRuleList(input.structure),
    clarity: boundedRuleList(input.clarity),
    antiCorporate: boundedRuleList(input.antiCorporate),
  };
}

export function structuralEditMetadata(input: {
  before: { title: string; summary: string; body: string; next_action: string };
  after: { title: string; summary: string; body: string; next_action: string };
}) {
  const fields = ["title", "summary", "body", "next_action"] as const;
  return {
    changedFields: fields.filter((field) => input.before[field] !== input.after[field]),
    beforeLengths: Object.fromEntries(fields.map((field) => [field, input.before[field].length])),
    afterLengths: Object.fromEntries(fields.map((field) => [field, input.after[field].length])),
    beforeHash: hashJson(input.before),
    afterHash: hashJson(input.after),
  };
}

export function deterministicStyleRulesFromEdit(metadata: { changedFields?: readonly string[] }): StyleRules {
  const changed = metadata.changedFields ?? [];
  const rules: StyleRules = {};
  if (changed.includes("body") || changed.includes("summary")) {
    rules.structure = ["Preserve the human editor's section order and paragraph rhythm."];
    rules.clarity = ["Lead with the concrete change the editor made explicit."];
  }
  if (changed.includes("title")) rules.tone = ["Use the editor's direct, specific naming pattern."];
  rules.antiCorporate = ["Avoid generic corporate filler."];
  return normalizeStyleRules(rules);
}

export async function deriveStyleRulesFromEdit(input: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  workspaceId: string;
  userId: string;
  signal: { case_id: string; revision_before: number; revision_after: number; structural_metadata: unknown };
}): Promise<StyleRules> {
  const revisionContent = (value: unknown) => {
    const content = value && typeof value === "object" && !Array.isArray(value) && "content" in value
      ? (value as { content?: unknown }).content
      : null;
    if (!content || typeof content !== "object" || Array.isArray(content)) return null;
    const artifact = content as Record<string, unknown>;
    if (!["title", "summary", "body", "next_action"].every((key) => typeof artifact[key] === "string")) return null;
    return artifact as Record<"title" | "summary" | "body" | "next_action", string>;
  };
  const [beforeResult, afterResult] = await Promise.all([
    input.supabase.from("case_artifacts").select("content").eq("workspace_id", input.workspaceId).eq("case_id", input.signal.case_id).eq("revision", input.signal.revision_before).maybeSingle(),
    input.supabase.from("case_artifacts").select("content").eq("workspace_id", input.workspaceId).eq("case_id", input.signal.case_id).eq("revision", input.signal.revision_after).maybeSingle(),
  ]);
  const before = revisionContent(beforeResult.data);
  const after = revisionContent(afterResult.data);
  if (!before || !after) throw Object.assign(new Error("Style edit revisions unavailable"), { status: 409 });

  const metadata = normalizeEditMetadata(input.signal.structural_metadata);
  let runtime;
  try {
    runtime = getAiRuntime("fast");
  } catch (error) {
    if (classifyAiError(error) === "not_configured") return deterministicStyleRulesFromEdit(metadata);
    throw toSafeAiError(error);
  }

  const boundedContent = (value: unknown) => typeof value === "string" ? value.slice(0, 8_000) : "";
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      tone: { type: "array", maxItems: 8, items: { type: "string", maxLength: 240 } },
      structure: { type: "array", maxItems: 8, items: { type: "string", maxLength: 240 } },
      clarity: { type: "array", maxItems: 8, items: { type: "string", maxLength: 240 } },
      antiCorporate: { type: "array", maxItems: 8, items: { type: "string", maxLength: 240 } },
    },
    required: ["tone", "structure", "clarity", "antiCorporate"],
  } as const;
  try {
    const generated = await generateStructured({
      provider: runtime.provider,
      model: runtime.model,
      system: "Compare the human-edited artifact with its immediate previous revision. Derive at most eight short reusable writing-style rules per category. Describe the editor's tone, structure, clarity, and anti-corporate preferences without copying whole paragraphs, inventing facts, or changing the requested deliverable.",
      input: {
        changedFields: metadata.changedFields,
        beforeLengths: metadata.beforeLengths,
        afterLengths: metadata.afterLengths,
        before: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, boundedContent(value)])),
        after: Object.fromEntries(Object.entries(after).map(([key, value]) => [key, boundedContent(value)])),
      },
      schemaName: "workspace_style_rules_v1",
      schema,
      validator: styleRulesSchema,
      workspaceId: input.workspaceId,
      userId: input.userId,
      quotaClient: input.admin,
      quotaEstimatedCostUsd: estimateAiCostUsd(runtime.provider, runtime.model, DEFAULT_QUOTA_INPUT_TOKENS, DEFAULT_QUOTA_OUTPUT_TOKENS),
      timeoutMs: 30_000,
    });
    return normalizeStyleRules(generated.value);
  } catch (error) {
    throw toSafeAiError(error);
  }
}

function normalizeEditMetadata(value: unknown): { changedFields: string[]; beforeLengths: Record<string, number>; afterLengths: Record<string, number> } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const list = Array.isArray(input.changedFields) ? input.changedFields.filter((item): item is string => typeof item === "string") : [];
  const lengths = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
    : {};
  return { changedFields: list, beforeLengths: lengths(input.beforeLengths), afterLengths: lengths(input.afterLengths) };
}

export async function loadActiveWritingStyleProfile(input: { supabase: SupabaseClient; workspaceId: string }): Promise<StyleRules | null> {
  const { data } = await input.supabase.from("writing_style_profiles").select("rules,active").eq("workspace_id", input.workspaceId).eq("active", true).maybeSingle();
  return data?.rules ? normalizeStyleRules(data.rules) : null;
}

export function styleRulesPrompt(rules: StyleRules | null): string {
  if (!rules) return "";
  const lines = Object.entries(rules).flatMap(([key, values]) => (values ?? []).map((value) => `${key}: ${value}`));
  if (!lines.length) return "";
  return `Confirmed workspace writing style constraints (opt-in): ${lines.join("; ")}. Style may not override source facts, module, schema, approval gates, privacy, or safety checks.`;
}
