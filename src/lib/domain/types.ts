/** The three bounded capabilities supported by the first release. */
export type ModuleKey = "growth" | "operations" | "intelligence";
export type Locale = "en" | "zh-Hant";

export type WorkflowGoalMode = "outcome" | "decision" | "project" | "checklist";

export type WorkflowStreamStatus = "active" | "archived";

export type WorkflowStageVisibility = {
  intake: boolean;
  artifact: boolean;
  approval: boolean;
  gmail: boolean;
  outcome: boolean;
};

export type WorkflowChecklistItem = {
  id: string;
  label: string;
  required: boolean;
};

export type WorkflowIntakeDefaults = Record<string, string | string[] | number | undefined>;

export interface WorkflowStream {
  id: string;
  workspace_id: string;
  group_id: string;
  version: number;
  base_module: ModuleKey;
  name: string;
  description: string;
  goal_mode: WorkflowGoalMode;
  intake_defaults: WorkflowIntakeDefaults;
  checklist: WorkflowChecklistItem[];
  stage_visibility: WorkflowStageVisibility;
  status: WorkflowStreamStatus;
  content_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Persisted structured intake is validated at the domain boundary. */
export type IntakeContext = Record<string, unknown>;

export type CaseStatus =
  | "draft"
  | "working"
  | "awaiting_approval"
  | "approved"
  | "action_pending"
  | "outcome_pending"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type ActionType = "gmail.create_draft";

export type AudiencePreset = "self" | "client" | "public" | "custom";
/** Free text is intentional: a user may say "informed generalist" or name a domain level. */
export type AudienceKnowledgeLevel = string;

export interface AudienceProfile {
  preset: AudiencePreset;
  knowledgeLevel: AudienceKnowledgeLevel;
  goal: string;
  tone: string;
  format: string;
  disclosureBoundaries: string[];
}

export type LearningDisposition = "keep" | "adapt" | "discard";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_locale: "en" | "zh-Hant";
}

export interface PortalUser {
  id: string;
  email?: string;
  displayName?: string;
  role?: string;
  locale?: Locale;
}

export interface CaseRecord {
  id: string;
  workspace_id: string;
  module: ModuleKey;
  template_key: ModuleKey;
  template_version: number;
  title: string;
  brief: string;
  /** Null/empty object identifies a legacy case with no structured context. */
  intake_context: IntakeContext | null;
  /** Immutable preset provenance. Null means this is a legacy or blank case. */
  workflow_stream_id?: string | null;
  workflow_stream_version?: number | null;
  workflow_stream_hash?: string | null;
  status: CaseStatus;
  current_revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ArtifactRecord {
  id: string;
  case_id: string;
  workspace_id: string;
  revision: number;
  kind: string;
  content: unknown;
  content_hash: string;
  /** Locale captured when this immutable revision was generated. */
  content_locale: Locale;
  /** Resolved packet source; self for AI packet artifacts, inherited for edits. */
  work_packet_source_artifact_id?: string | null;
  created_by: string;
  created_at: string;
  stale?: boolean;
}

export interface ActionPayload {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  thread_id?: string;
}

export interface ActionRecord {
  id: string;
  case_id: string;
  workspace_id: string;
  artifact_revision: number;
  action_type: ActionType;
  payload: ActionPayload;
  payload_hash: string;
  idempotency_key: string;
  status: "pending" | "executing" | "executed" | "failed" | "cancelled";
  provider_reference?: string;
  provider_message_id?: string;
  execution_attempt_id?: string;
  execution_approval_id?: string;
  execution_started_at?: string;
  reconciliation_checked_at?: string;
}

export interface ApprovalRecord {
  id: string;
  case_id: string;
  workspace_id: string;
  artifact_revision: number;
  artifact_hash: string;
  action_payload_hash: string;
  approved_by: string;
  approved_at: string;
  revoked_at?: string;
}

export interface OutcomeReview {
  id: string;
  case_id: string;
  workspace_id: string;
  expected_result: string;
  actual_result: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  what_worked: string;
  what_failed: string;
  blockers: string;
  next_action: string;
  improvements: string;
  other_angles: string;
  follow_up_date?: string | null;
  learning_disposition: LearningDisposition;
  learning_note?: string;
  learning_candidate?: string;
  learning_applicability?: string;
  approve_adapted_learning?: boolean;
  reviewed_by: string;
  reviewed_at: string;
}

export interface TemplateVersion {
  key: ModuleKey;
  version: number;
  label: string;
  description: string;
  requiredInputs: readonly string[];
  outputSchema: Record<string, unknown>;
  prompt: string;
}

export interface AudienceVariant {
  id: string;
  core_revision: number;
  audience: AudienceProfile;
  preset: AudiencePreset;
  custom_audience?: string;
  title: string;
  summary: string;
  body: string;
  core_hash: string;
  stale: boolean;
  created_at: string;
  /** Locale of the source artifact used for this adaptation. */
  content_locale?: Locale;
}

export interface GenerationResult {
  case: CaseRecord;
  artifact: ArtifactRecord;
  action?: ActionRecord;
  variants?: AudienceVariant[];
}

export interface SourceItem {
  id: string;
  workspace_id: string;
  case_id: string;
  source_kind: "private_upload" | "url" | "pasted";
  storage_path?: string;
  source_url?: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256?: string | null;
  extraction_status: "pending" | "processing" | "extracted" | "failed";
  extraction_error_code?: string | null;
  created_at: string;
}

export interface ExecutionRun {
  id: string;
  workspace_id: string;
  case_id: string;
  provider: "gemini" | "openai";
  model: string;
  status: "started" | "succeeded" | "failed" | "timed_out";
  response_id?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost_usd: number;
  error_code?: string | null;
  started_at: string;
  completed_at?: string | null;
}

export interface PortalContext {
  user: PortalUser;
  /** Verified profile preference; workspace.default_locale is only a fallback. */
  locale: Locale;
  workspace: Workspace;
  membership: { workspace_id: string; role: "owner" | "member" | "admin" };
}

export interface SupabaseErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}
