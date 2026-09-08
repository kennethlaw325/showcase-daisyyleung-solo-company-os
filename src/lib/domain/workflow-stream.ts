import type { ModuleKey, WorkflowChecklistItem, WorkflowIntakeDefaults, WorkflowStageVisibility, WorkflowStream } from "./types";
import {
  workflowChecklistSchema,
  workflowIntakeDefaultsSchema,
  workflowStageVisibilitySchema,
  workflowStreamPayloadSchema,
  workflowStreamReviseRequestSchema,
  type WorkflowStreamCreateRequest,
  type WorkflowStreamReviseRequest,
} from "./schemas";
import { hashJson } from "../security/hash";

export const DEFAULT_WORKFLOW_STAGE_VISIBILITY: WorkflowStageVisibility = {
  intake: true,
  artifact: true,
  approval: true,
  gmail: true,
  outcome: true,
};

export const WORKFLOW_MODULE_LABELS: Record<ModuleKey, { en: string; zhHant: string }> = {
  growth: { en: "Growth & Revenue", zhHant: "增長與收入" },
  operations: { en: "Business Insights", zhHant: "商業洞察" },
  intelligence: { en: "Brand Communications & PR", zhHant: "品牌傳訊與公關" },
};

export const WORKFLOW_STREAM_SELECT = "id,workspace_id,group_id,version,base_module,name,description,goal_mode,intake_defaults,checklist,stage_visibility,status,content_hash,created_by,created_at,updated_at";

export type WorkflowStreamPayload = {
  baseModule: ModuleKey;
  name: string;
  description: string;
  goalMode: WorkflowStreamCreateRequest["goalMode"];
  intakeDefaults: WorkflowIntakeDefaults;
  checklist: WorkflowChecklistItem[];
  stageVisibility: WorkflowStageVisibility;
};

/** The hash covers the semantic preset only, never its tenant, id, version, or status. */
export function workflowStreamContentHash(payload: WorkflowStreamPayload): string {
  return hashJson({
    base_module: payload.baseModule,
    name: payload.name.trim(),
    description: payload.description.trim(),
    goal_mode: payload.goalMode,
    intake_defaults: payload.intakeDefaults,
    checklist: payload.checklist,
    stage_visibility: payload.stageVisibility,
  });
}

export function normalizeWorkflowStreamPayload(value: unknown): WorkflowStreamPayload {
  const parsed = workflowStreamPayloadSchema.parse(value);
  return {
    baseModule: parsed.baseModule,
    name: parsed.name,
    description: parsed.description,
    goalMode: parsed.goalMode,
    intakeDefaults: workflowIntakeDefaultsSchema.parse(parsed.intakeDefaults),
    checklist: workflowChecklistSchema.parse(parsed.checklist),
    stageVisibility: workflowStageVisibilitySchema.parse(parsed.stageVisibility),
  };
}

export function normalizeWorkflowStreamRevision(value: unknown): WorkflowStreamReviseRequest {
  const parsed = workflowStreamReviseRequestSchema.parse(value);
  const { expectedVersion, ...payload } = parsed;
  return { ...normalizeWorkflowStreamPayload(payload), expectedVersion };
}

export function workflowStreamToPayload(stream: Pick<WorkflowStream, "base_module" | "name" | "description" | "goal_mode" | "intake_defaults" | "checklist" | "stage_visibility">): WorkflowStreamPayload {
  return normalizeWorkflowStreamPayload({
    baseModule: stream.base_module,
    name: stream.name,
    description: stream.description,
    goalMode: stream.goal_mode,
    intakeDefaults: stream.intake_defaults,
    checklist: stream.checklist,
    stageVisibility: stream.stage_visibility,
  });
}

export function streamAllowsGmailDraft(stream: { stage_visibility?: { gmail?: boolean } } | null | undefined): boolean {
  return stream?.stage_visibility?.gmail ?? true;
}

export function workflowStreamDisplayLabel(stream: Pick<WorkflowStream, "name" | "version">): string {
  return `${stream.name} v${stream.version}`;
}

export function activeWorkflowStreams(streams: readonly WorkflowStream[]): WorkflowStream[] {
  return streams.filter((stream) => stream.status === "active").sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
}
