import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerationRequest } from "../domain/schemas";
import { hashJson } from "../security/hash";

export type IntakeSnapshotSource = {
  kind: "pasted" | "url" | "upload";
  filename: string;
  sha256?: string | null;
  byteSize?: number | null;
  urlHost?: string | null;
};

export type IntakeSnapshotPayload = {
  schemaVersion: 1;
  title: string;
  objective: string;
  module: GenerationRequest["module"];
  moduleContext: Record<string, unknown>;
  audience?: unknown;
  selectedLearningIds?: string[];
  sourceManifest: IntakeSnapshotSource[];
};

export type IntakeSnapshotListItem = {
  id: string | null;
  caseId: string;
  caseTitle: string;
  module: GenerationRequest["module"];
  payload: IntakeSnapshotPayload;
  snapshot_status: "exact" | "partial_legacy";
  semantic_payload_hash: string | null;
  created_at: string | null;
};

export function buildIntakeSnapshotPayload(input: {
  request: Pick<GenerationRequest, "title" | "brief" | "module" | "intakeContext" | "audience">;
  sources?: readonly IntakeSnapshotSource[];
  selectedLearningIds?: readonly string[];
}): IntakeSnapshotPayload {
  const payload: IntakeSnapshotPayload = {
    schemaVersion: 1,
    title: input.request.title,
    objective: input.request.brief,
    module: input.request.module,
    moduleContext: input.request.intakeContext,
    sourceManifest: (input.sources ?? []).map((source) => ({
      kind: source.kind,
      filename: source.filename.slice(0, 255),
      sha256: source.sha256 ?? null,
      byteSize: source.byteSize ?? null,
      urlHost: source.kind === "url" ? source.urlHost ?? null : null,
    })),
  };
  if (input.request.audience !== undefined) payload.audience = input.request.audience;
  if (input.selectedLearningIds?.length) payload.selectedLearningIds = [...input.selectedLearningIds].slice(0, 30);
  return payload;
}

export function buildLegacyIntakeSnapshotPayload(caseRecord: {
  title: string;
  brief: string;
  module: GenerationRequest["module"];
  intake_context?: Record<string, unknown> | null;
}): IntakeSnapshotPayload {
  return {
    schemaVersion: 1,
    title: caseRecord.title,
    objective: caseRecord.brief,
    module: caseRecord.module,
    moduleContext: caseRecord.intake_context ?? {},
    sourceManifest: [],
  };
}

/**
 * Read the workspace's initial inputs without materialising legacy snapshots.
 * Cases created before immutable snapshots existed are reconstructed in
 * memory and marked `partial_legacy`; the GET path deliberately performs no
 * RPC or insert.
 */
export async function listIntakeSnapshots(input: {
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<IntakeSnapshotListItem[]> {
  const [{ data: snapshots, error: snapshotError }, { data: cases, error: caseError }] = await Promise.all([
    input.supabase
      .from("case_intake_snapshots")
      .select("id,case_id,payload,semantic_payload_hash,snapshot_status,created_at")
      .eq("workspace_id", input.workspaceId)
      .order("created_at", { ascending: false }),
    input.supabase
      .from("cases")
      .select("id,title,brief,module,intake_context,created_at")
      .eq("workspace_id", input.workspaceId)
      .order("created_at", { ascending: false }),
  ]);
  if (snapshotError || caseError) throw new Error("Initial inputs unavailable");

  const byCase = new Map((snapshots ?? []).map((snapshot) => [snapshot.case_id, snapshot]));
  const rows: IntakeSnapshotListItem[] = [];
  for (const caseRecord of cases ?? []) {
    const exact = byCase.get(caseRecord.id);
    if (exact) {
      rows.push({
        id: exact.id,
        caseId: caseRecord.id,
        caseTitle: caseRecord.title,
        module: caseRecord.module as GenerationRequest["module"],
        payload: exact.payload as IntakeSnapshotPayload,
        snapshot_status: exact.snapshot_status === "partial_legacy" ? "partial_legacy" : "exact",
        semantic_payload_hash: exact.semantic_payload_hash ?? null,
        created_at: exact.created_at ?? caseRecord.created_at ?? null,
      });
      continue;
    }
    rows.push({
      id: null,
      caseId: caseRecord.id,
      caseTitle: caseRecord.title,
      module: caseRecord.module as GenerationRequest["module"],
      payload: buildLegacyIntakeSnapshotPayload(caseRecord),
      snapshot_status: "partial_legacy",
      semantic_payload_hash: null,
      created_at: caseRecord.created_at ?? null,
    });
  }
  return rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export async function ensureCaseIntakeSnapshot(input: {
  admin: SupabaseClient;
  workspaceId: string;
  actorId: string;
  caseId: string;
  payload: IntakeSnapshotPayload;
  status?: "exact" | "partial_legacy";
}) {
  const { data, error } = await input.admin.rpc("record_case_intake_snapshot", {
    p_case_id: input.caseId,
    p_actor_id: input.actorId,
    p_payload: input.payload,
    p_snapshot_status: input.status ?? "exact",
  });
  if (error || !data) throw new Error("Intake snapshot unavailable");
  return { ...data, semantic_payload_hash: data.semantic_payload_hash ?? hashJson(input.payload) };
}
