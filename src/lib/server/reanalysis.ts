import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DEFAULT_QUOTA_INPUT_TOKENS, DEFAULT_QUOTA_OUTPUT_TOKENS, classifyAiError, estimateAiCostUsd, generateStructured, getAiRuntime, getAiErrorDiagnostics, toSafeAiError } from "../adapters/ai";
import { caseWorkPacketOutputSchema, caseWorkPacketSchema, parseCaseWorkPacket } from "../domain/case-work-packet";
import { getTemplateVersion, normalizeAudienceProfile } from "../domain/templates";
import { parsePersistedIntakeContext } from "../domain/case-intake-context";
import type { ModuleKey, PortalContext } from "../domain/types";
import { buildCaseAnalysisInput, buildCaseAnalysisSystemPrompt } from "./case-analysis";
import { loadActiveWritingStyleProfile, styleRulesPrompt } from "./style-learning";
import { localePromptInstruction } from "../i18n/locale";
import { hashJson } from "../security/hash";

export type ReanalysisDelta = {
  newFacts: string[];
  changedInterpretation: string[];
  contradictions: string[];
  unresolvedGaps: string[];
  confidence: "low" | "medium" | "high";
  recommendedNextAction: string;
};

export const reanalysisDeltaSchema = z.object({
  newFacts: z.array(z.string().trim().min(1).max(1000)).max(20),
  changedInterpretation: z.array(z.string().trim().min(1).max(1000)).max(20),
  contradictions: z.array(z.string().trim().min(1).max(1000)).max(20),
  unresolvedGaps: z.array(z.string().trim().min(1).max(1000)).max(20),
  confidence: z.enum(["low", "medium", "high"]),
  recommendedNextAction: z.string().trim().min(1).max(2000),
}).strict();

export const reanalysisDeltaJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    newFacts: { type: "array", maxItems: 20, items: { type: "string" } },
    changedInterpretation: { type: "array", maxItems: 20, items: { type: "string" } },
    contradictions: { type: "array", maxItems: 20, items: { type: "string" } },
    unresolvedGaps: { type: "array", maxItems: 20, items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    recommendedNextAction: { type: "string" },
  },
  required: ["newFacts", "changedInterpretation", "contradictions", "unresolvedGaps", "confidence", "recommendedNextAction"],
} as const;

export function normalizeReanalysisDelta(value: unknown): ReanalysisDelta {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const list = (item: unknown) => Array.isArray(item) ? item.filter((value): value is string => typeof value === "string").map((value) => value.trim().slice(0, 1000)).filter(Boolean).slice(0, 20) : [];
  const confidence = input.confidence === "high" || input.confidence === "low" ? input.confidence : "medium";
  return {
    newFacts: list(input.newFacts),
    changedInterpretation: list(input.changedInterpretation),
    contradictions: list(input.contradictions),
    unresolvedGaps: list(input.unresolvedGaps),
    confidence,
    recommendedNextAction: typeof input.recommendedNextAction === "string" ? input.recommendedNextAction.trim().slice(0, 2000) : "Review the new information before taking action.",
  };
}

export async function currentSourceStateHash(supabase: SupabaseClient, caseId: string) {
  const { data, error } = await supabase.from("source_items").select("id,sha256,extraction_status,filename,byte_size").eq("case_id", caseId).order("id", { ascending: true });
  if (error) throw new Error("Source state unavailable");
  return hashJson((data ?? []).map((source) => ({ id: source.id, sha256: source.sha256, status: source.extraction_status, filename: source.filename, byte_size: source.byte_size })));
}

export async function enqueueReanalysis(input: { supabase: SupabaseClient; caseId: string; actorId: string; triggerType: "manual" | "source_added"; expectedRevision?: number; sourceStateHash?: string; idempotencyKey?: string }) {
  const { data, error } = await input.supabase.rpc("enqueue_case_reanalysis", {
    p_case_id: input.caseId,
    p_actor_id: input.actorId,
    p_trigger_type: input.triggerType,
    p_source_state_hash: input.sourceStateHash ?? null,
    p_expected_revision: input.expectedRevision ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error || !data) throw new Error(error?.message === "stale reanalysis revision" ? "stale reanalysis revision" : "Reanalysis unavailable");
  return data;
}

/** Process exactly one queued request; source/revision guards live in the SQL kernel. */
export async function processReanalysis(input: { supabase: SupabaseClient; admin: SupabaseClient; context: PortalContext; requestId: string }) {
  const { data: started, error: startError } = await input.admin.rpc("start_case_reanalysis", { p_request_id: input.requestId, p_actor_id: input.context.user.id });
  if (startError || !started) throw Object.assign(new Error(startError?.message === "reanalysis follow_up_only" ? "reanalysis follow_up_only" : "Reanalysis unavailable"), { status: startError?.message === "reanalysis follow_up_only" ? 409 : 409 });
  if (started.status !== "running") return started;
  const [{ data: caseRecord, error: caseError }, { data: sources, error: sourceError }] = await Promise.all([
    input.supabase.from("cases").select("id,module,template_version,title,brief,status,current_revision,intake_context").eq("workspace_id", input.context.workspace.id).eq("id", started.case_id).maybeSingle(),
    input.supabase.from("source_items").select("filename,source_url,extracted_text").eq("workspace_id", input.context.workspace.id).eq("case_id", started.case_id).eq("extraction_status", "extracted").order("created_at", { ascending: true }),
  ]);
  if (caseError || sourceError || !caseRecord) {
    await input.admin.rpc("fail_case_reanalysis", { p_request_id: input.requestId, p_actor_id: input.context.user.id, p_error_code: "case_unavailable" });
    throw new Error("Reanalysis case unavailable");
  }
  const sourceText = (sources ?? []).map((source) => `${source.source_url ? `SOURCE URL: ${source.source_url}` : `SOURCE: ${source.filename}`}\n${(source.extracted_text ?? "").slice(0, 30_000)}`).join("\n\n").slice(0, 100_000);
  if (!sourceText) {
    await input.admin.rpc("fail_case_reanalysis", { p_request_id: input.requestId, p_actor_id: input.context.user.id, p_error_code: "source_unavailable" });
    throw Object.assign(new Error("Reanalysis requires an extracted source"), { status: 409 });
  }
  const moduleKey = caseRecord.module as ModuleKey;
  const template = getTemplateVersion(moduleKey, caseRecord.template_version);
  const structuredContext = parsePersistedIntakeContext(moduleKey, caseRecord.intake_context);
  const styleRules = await loadActiveWritingStyleProfile({ supabase: input.supabase, workspaceId: input.context.workspace.id });
  const analysisInput = buildCaseAnalysisInput({ authoritativeModule: moduleKey, objective: caseRecord.brief, structuredContext, sourceEvidence: sourceText, audienceProfile: normalizeAudienceProfile("self"), styleRules });
  const runtime = getAiRuntime("reasoning");
  const estimatedCostUsd = estimateAiCostUsd(runtime.provider, runtime.model, DEFAULT_QUOTA_INPUT_TOKENS, DEFAULT_QUOTA_OUTPUT_TOKENS);
  const { data: executionRunId, error: executionError } = await input.admin.rpc("start_case_execution_run", { p_workspace_id: input.context.workspace.id, p_case_id: caseRecord.id, p_actor_id: input.context.user.id, p_provider: runtime.provider, p_model: runtime.model, p_estimated_cost_usd: estimatedCostUsd });
  if (executionError || typeof executionRunId !== "string") throw new Error("Execution state unavailable");
  const combinedSchema = { ...caseWorkPacketOutputSchema(moduleKey), properties: { ...caseWorkPacketOutputSchema(moduleKey).properties as Record<string, unknown>, delta: reanalysisDeltaJsonSchema }, required: [...(caseWorkPacketOutputSchema(moduleKey).required as string[]), "delta"] };
  try {
    const generated = await generateStructured({
      provider: runtime.provider,
      model: runtime.model,
      system: `${buildCaseAnalysisSystemPrompt(template.prompt, moduleKey, analysisInput.writingAcceptanceCriteria, styleRulesPrompt(styleRules))} This is a source-state reanalysis. Return the normal validated work packet and a bounded delta object with newFacts, changedInterpretation, contradictions, unresolvedGaps, confidence, and recommendedNextAction. Never reopen completed or outcome-pending cases; source facts outrank prior interpretation. ${localePromptInstruction(input.context.locale)}`,
      input: analysisInput,
      schemaName: `${moduleKey}_reanalysis_v${template.version}`,
      schema: combinedSchema,
      validator: z.object({ ...caseWorkPacketSchema.shape, delta: reanalysisDeltaSchema }),
      workspaceId: input.context.workspace.id,
      userId: input.context.user.id,
      quotaClient: input.admin,
      quotaEstimatedCostUsd: estimatedCostUsd,
      timeoutMs: 60_000,
    });
    const inputTokens = generated.usage?.inputTokens ?? 0;
    const outputTokens = generated.usage?.outputTokens ?? 0;
    const totalTokens = generated.usage?.totalTokens ?? inputTokens + outputTokens;
    const actualCostUsd = estimateAiCostUsd(runtime.provider, runtime.model, inputTokens, outputTokens);
    if (generated.quotaReservationId) {
      const { error: usageError } = await input.admin.rpc("complete_workspace_usage", { p_usage_event_id: generated.quotaReservationId, p_actor_id: input.context.user.id, p_input_tokens: inputTokens, p_output_tokens: outputTokens, p_total_tokens: totalTokens, p_actual_cost_usd: actualCostUsd });
      if (usageError) throw new Error("Usage state unavailable");
    }
    const parsed = generated.value as z.infer<typeof caseWorkPacketSchema> & { delta: ReanalysisDelta };
    const packet = parseCaseWorkPacket(moduleKey, parsed, []);
    const { error: executionCompletionError } = await input.admin.from("execution_runs").update({ status: "succeeded", response_id: generated.responseId, input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens, estimated_cost_usd: actualCostUsd, completed_at: new Date().toISOString() }).eq("id", executionRunId).eq("workspace_id", input.context.workspace.id);
    if (executionCompletionError) throw new Error("Execution state unavailable");
    const { data: finalized, error: finalizeError } = await input.admin.rpc("finalize_case_work_packet", { p_actor_id: input.context.user.id, p_case_id: caseRecord.id, p_expected_revision: caseRecord.current_revision, p_execution_run_id: executionRunId, p_content: packet.deliverable, p_content_locale: input.context.locale, p_evidence: packet.evidenceBrief, p_plan: packet.plan, p_selected_learning_ids: [], p_application_accounting: [] });
    if (finalizeError || !finalized || typeof finalized !== "object") throw Object.assign(new Error(finalizeError?.message?.includes("stale case revision") ? "stale case revision" : "Reanalysis persistence unavailable"), { status: 409 });
    const finalizedArtifact = (finalized as { artifact?: { revision?: number } }).artifact;
    if (!finalizedArtifact?.revision) throw new Error("Reanalysis artifact unavailable");
    const { data: completed, error: completionError } = await input.admin.rpc("complete_case_reanalysis", { p_request_id: input.requestId, p_actor_id: input.context.user.id, p_resulting_revision: finalizedArtifact.revision, p_result_delta: parsed.delta });
    if (completionError || !completed) throw new Error("Reanalysis completion unavailable");
    return completed;
  } catch (error) {
    const code = classifyAiError(error);
    await input.admin.from("execution_runs").update({ status: code === "timeout" ? "timed_out" : "failed", error_code: code, completed_at: new Date().toISOString() }).eq("id", executionRunId).eq("workspace_id", input.context.workspace.id);
    await input.admin.rpc("fail_case_reanalysis", { p_request_id: input.requestId, p_actor_id: input.context.user.id, p_error_code: code });
    console.error("AI reanalysis failed", { route: "cases.reanalysis", requestId: input.requestId, code, status: "failed", ...getAiErrorDiagnostics(error) });
    throw toSafeAiError(error);
  }
}
