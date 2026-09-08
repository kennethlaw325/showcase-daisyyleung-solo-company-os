import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningDisposition, ModuleKey } from "../domain/types";
import { hashJson } from "../security/hash";

export type LearningCandidate = {
  id: string;
  module: ModuleKey;
  sourceCaseId: string;
  sourceCaseTitle: string;
  note: string;
  tags: string[];
  disposition: LearningDisposition;
  approvedForReuse: true;
  applicability: string | null;
  evidence: string | null;
  evidenceConfidence: string | null;
  supportingOutcomeCount: number | null;
  learningConfidence: string | null;
  validationStatus: string | null;
};

export type LearningCandidatesByModule = Record<ModuleKey, LearningCandidate[]>;

export type RelatedLearning = {
  id: string;
  note: string;
  tags: string[];
};

export type LearningSnapshot = {
  learningId: string;
  note: string;
  tags: string[];
};

export class LearningSelectionError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "LearningSelectionError";
  }
}

const modules: ModuleKey[] = ["growth", "operations", "intelligence"];

export function emptyLearningCandidatesByModule(): LearningCandidatesByModule {
  return { growth: [], operations: [], intelligence: [] };
}

/**
 * Return only strict full-text matches for the current case. An empty query,
 * FTS error, or no match is intentionally an empty result; recency is not a
 * relevance substitute for related learning suggestions.
 */
export async function loadRelatedLearnings(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  module: ModuleKey;
  query: string;
  limit?: number;
}): Promise<RelatedLearning[]> {
  const query = input.query.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().slice(0, 500);
  if (!query) return [];
  const limit = Math.min(10, Math.max(1, Math.trunc(input.limit ?? 3)));
  try {
    const { data, error } = await input.supabase
      .from("learning_records")
      .select("id,note,tags,cases!inner(module,workspace_id)")
      .eq("workspace_id", input.workspaceId)
      .eq("approved_for_reuse", true)
      .neq("disposition", "discard")
      .is("deleted_at", null)
      .eq("cases.workspace_id", input.workspaceId)
      .eq("cases.module", input.module)
      .textSearch("search_document", query, { type: "websearch", config: "simple" })
      .limit(limit);
    if (error || !data?.length) return [];
    return (data as Array<{ id: string; note: string; tags: string[] | null }>).map((learning) => ({
      id: learning.id,
      note: learning.note,
      tags: Array.isArray(learning.tags) ? learning.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim()) : [],
    }));
  } catch {
    return [];
  }
}

type LearningRow = {
  id: string;
  case_id: string | null;
  note: string;
  tags: string[] | null;
  disposition: LearningDisposition;
  approved_for_reuse: boolean;
  applicability: string | null;
  supporting_outcome_count: number | null;
  learning_confidence: string | null;
  validation_status: string | null;
  created_at: string;
};

type CaseRow = { id: string; module: ModuleKey; title: string };
type OutcomeRow = { id: string; case_id: string; evidence: string; confidence: string };

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapCandidate(row: LearningRow, sourceCase: CaseRow, outcome?: OutcomeRow): LearningCandidate {
  const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim()) : [];
  return {
    id: row.id,
    module: sourceCase.module,
    sourceCaseId: sourceCase.id,
    sourceCaseTitle: sourceCase.title,
    note: row.note,
    tags,
    disposition: row.disposition,
    approvedForReuse: true,
    // Applicability is epistemic data, not a tag or module label. Historical
    // rows remain null/unassessed rather than being silently rewritten.
    applicability: asText(row.applicability),
    evidence: asText(outcome?.evidence),
    evidenceConfidence: asText(outcome?.confidence),
    supportingOutcomeCount: row.supporting_outcome_count,
    learningConfidence: asText(row.learning_confidence),
    validationStatus: asText(row.validation_status),
  };
}

/**
 * Load only approved, non-discarded learning rows and return a minimal DTO.
 * The module is derived from the source case rather than client input.
 */
export async function loadApprovedLearningCandidates(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  module?: ModuleKey;
  limit?: number;
}): Promise<LearningCandidatesByModule> {
  const grouped = emptyLearningCandidatesByModule();
  const { data: learningRows, error: learningError } = await input.supabase
    .from("learning_records")
    .select("id,case_id,note,tags,disposition,approved_for_reuse,applicability,supporting_outcome_count,learning_confidence,validation_status,created_at")
    .eq("workspace_id", input.workspaceId)
    .eq("approved_for_reuse", true)
    .neq("disposition", "discard")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(60, Math.max(1, input.limit ?? 30)));
  if (learningError || !learningRows?.length) return grouped;

  const rows = learningRows as LearningRow[];
  const caseIds = [...new Set(rows.map((row) => row.case_id).filter((id): id is string => Boolean(id)))];
  if (!caseIds.length) return grouped;
  const [{ data: caseRows }, { data: outcomeRows }] = await Promise.all([
    input.supabase.from("cases").select("id,module,title").eq("workspace_id", input.workspaceId).in("id", caseIds),
    input.supabase.from("case_outcomes").select("id,case_id,evidence,confidence").eq("workspace_id", input.workspaceId).in("case_id", caseIds),
  ]);
  const casesById = new Map((caseRows as CaseRow[] | null ?? []).map((row) => [row.id, row]));
  const outcomesByCaseId = new Map((outcomeRows as OutcomeRow[] | null ?? []).map((row) => [row.case_id, row]));
  for (const row of rows) {
    if (!row.case_id) continue;
    const sourceCase = casesById.get(row.case_id);
    if (!sourceCase || (input.module && sourceCase.module !== input.module)) continue;
    grouped[sourceCase.module].push(mapCandidate(row, sourceCase, outcomesByCaseId.get(sourceCase.id)));
  }
  return grouped;
}

/**
 * Re-fetch and validate selected IDs immediately before AI runtime/quota use.
 * A filtered workspace query deliberately treats cross-workspace IDs as
 * missing, avoiding disclosure of another tenant’s records.
 */
export async function validateSelectedLearningIds(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  module: ModuleKey;
  selectedIds: readonly string[];
}): Promise<LearningCandidate[]> {
  const selectedIds = [...input.selectedIds];
  if (selectedIds.length > 3) throw new LearningSelectionError("Select no more than three learnings");
  if (new Set(selectedIds).size !== selectedIds.length) throw new LearningSelectionError("Duplicate learning selection");
  if (!selectedIds.length) return [];

  const { data: learningRows, error: learningError } = await input.supabase
    .from("learning_records")
    .select("id,case_id,note,tags,disposition,approved_for_reuse,applicability,supporting_outcome_count,learning_confidence,validation_status,created_at")
    .eq("workspace_id", input.workspaceId)
    .in("id", selectedIds)
    .eq("approved_for_reuse", true)
    .neq("disposition", "discard")
    .is("deleted_at", null);
  if (learningError || !learningRows || learningRows.length !== selectedIds.length) {
    throw new LearningSelectionError("One or more selected learnings are unavailable");
  }

  const rows = learningRows as LearningRow[];
  const caseIds = [...new Set(rows.map((row) => row.case_id).filter((id): id is string => Boolean(id)))];
  if (rows.some((row) => !row.case_id)) throw new LearningSelectionError("Selected learning is missing its source case");
  const [{ data: caseRows, error: caseError }, { data: outcomeRows }] = await Promise.all([
    input.supabase.from("cases").select("id,module,title").eq("workspace_id", input.workspaceId).in("id", caseIds),
    input.supabase.from("case_outcomes").select("id,case_id,evidence,confidence").eq("workspace_id", input.workspaceId).in("case_id", caseIds),
  ]);
  if (caseError || !caseRows || caseRows.length !== caseIds.length) throw new LearningSelectionError("Selected learning source is unavailable");
  const casesById = new Map((caseRows as CaseRow[]).map((row) => [row.id, row]));
  const outcomesByCaseId = new Map((outcomeRows as OutcomeRow[] | null ?? []).map((row) => [row.case_id, row]));
  const candidates = rows.map((row) => {
    const sourceCase = row.case_id ? casesById.get(row.case_id) : undefined;
    if (!sourceCase || sourceCase.module !== input.module) throw new LearningSelectionError("Selected learning does not match this case module");
    return mapCandidate(row, sourceCase, outcomesByCaseId.get(sourceCase.id));
  });
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return selectedIds.map((id) => byId.get(id)!).filter(Boolean);
}

export function learningSnapshot(candidate: Pick<LearningCandidate, "id" | "note" | "tags">): LearningSnapshot {
  return { learningId: candidate.id, note: candidate.note, tags: [...candidate.tags] };
}

export function learningSnapshotHash(snapshot: LearningSnapshot): string {
  return hashJson(snapshot);
}

export function learningGuidanceForPrompt(candidates: readonly LearningCandidate[]) {
  return candidates.map((candidate) => ({
    learningId: candidate.id,
    note: candidate.note,
    tags: candidate.tags,
    applicability: candidate.applicability,
    evidenceConfidence: candidate.evidenceConfidence,
    supportingOutcomeCount: candidate.supportingOutcomeCount,
    learningConfidence: candidate.learningConfidence,
    validationStatus: candidate.validationStatus,
  }));
}

export function isModuleKey(value: string): value is ModuleKey {
  return modules.includes(value as ModuleKey);
}
