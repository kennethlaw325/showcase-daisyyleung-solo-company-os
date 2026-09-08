import { z } from "zod";
import {
  growthIntakeContextSchema,
  intelligenceIntakeContextSchema,
  normalizeIntakeList,
  operationsIntakeContextSchema,
  sharedIntakeContextSchema,
} from "./case-intake-context";
import type { CaseFlowKey } from "./general-flow";
import { PILOT_POLICY_VERSION } from "../legal/pilot-policy";
import { PPTX_MIME } from "../security/source-formats";

export const moduleKeySchema = z.enum(["growth", "operations", "intelligence"]);
/** Stable presentation keys used by both manual and guided intake. */
export const caseFlowKeySchema = z.enum(["growth", "operations", "intelligence", "general"]);
export const localeSchema = z.enum(["en", "zh-Hant"]);
export const caseStatusSchema = z.enum([
  "draft",
  "working",
  "awaiting_approval",
  "approved",
  "action_pending",
  "outcome_pending",
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);
export const actionTypeSchema = z.literal("gmail.create_draft");
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const email = z.string().trim().email().max(320);

export const workflowGoalModeSchema = z.enum(["outcome", "decision", "project", "checklist"]);
export const workflowStreamStatusSchema = z.enum(["active", "archived"]);

const workflowDefaultValueSchema = z.union([
  z.string().trim().max(4_000),
  z.array(z.string().trim().max(2_000)).max(20),
]);

/** Presets may prefill intake only; prompt, schema, gate, and send controls are deliberately absent. */
export const workflowIntakeDefaultsSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  flowKey: z.literal("general").optional(),
  successCriteria: workflowDefaultValueSchema.optional(),
  workflowGuidance: workflowDefaultValueSchema.optional(),
  offer: workflowDefaultValueSchema.optional(),
  leadProfile: workflowDefaultValueSchema.optional(),
  pipelineContext: workflowDefaultValueSchema.optional(),
  campaignContext: workflowDefaultValueSchema.optional(),
  conversionTarget: workflowDefaultValueSchema.optional(),
  decisionsNeeded: workflowDefaultValueSchema.optional(),
  owners: workflowDefaultValueSchema.optional(),
  deadlines: workflowDefaultValueSchema.optional(),
  sopContext: workflowDefaultValueSchema.optional(),
  blockers: workflowDefaultValueSchema.optional(),
  crossFunctionalSignals: workflowDefaultValueSchema.optional(),
  audiencePreset: workflowDefaultValueSchema.optional(),
  knowledgeLevel: workflowDefaultValueSchema.optional(),
  audienceGoal: workflowDefaultValueSchema.optional(),
  tone: workflowDefaultValueSchema.optional(),
  format: workflowDefaultValueSchema.optional(),
  disclosureBoundaries: workflowDefaultValueSchema.optional(),
}).strict();

export const workflowChecklistItemSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  label: boundedText(200),
  required: z.boolean().default(true),
}).strict();

export const workflowChecklistSchema = z.array(workflowChecklistItemSchema).max(30);

export const workflowStageVisibilitySchema = z.object({
  intake: z.boolean().default(true),
  artifact: z.boolean().default(true),
  approval: z.boolean().default(true),
  gmail: z.boolean().default(true),
  outcome: z.boolean().default(true),
}).strict().refine((visibility) => visibility.intake && visibility.artifact && visibility.approval && visibility.outcome, {
  message: "workflow safety gates cannot be disabled",
});

const workflowName = boundedText(120);
const workflowDescription = z.string().trim().max(2_000).default("");

/**
 * The semantic workflow payload is shared by create and revise.  Creation
 * carries a client-generated idempotency key; revisions remain keyed by the
 * expected immutable version and deliberately do not accept that field.
 */
export const workflowStreamPayloadSchema = z.object({
  baseModule: moduleKeySchema,
  name: workflowName,
  description: workflowDescription,
  goalMode: workflowGoalModeSchema,
  intakeDefaults: workflowIntakeDefaultsSchema,
  checklist: workflowChecklistSchema,
  stageVisibility: workflowStageVisibilitySchema,
}).strict();

export const workflowStreamCreateRequestSchema = workflowStreamPayloadSchema.extend({
  idempotencyKey: z.string().uuid(),
}).strict();

export const workflowStreamReviseRequestSchema = workflowStreamPayloadSchema.extend({
  expectedVersion: z.number().int().positive(),
}).strict();

export const workflowStreamArchiveRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  action: z.literal("archive").default("archive"),
}).strict();

export const workflowStreamRevisionRequestSchema = workflowStreamReviseRequestSchema;

/** @deprecated Use the module-specific intake context schemas. */
export const caseInputsSchema = sharedIntakeContextSchema;

export const audiencePresetSchema = z.enum(["self", "client", "public", "custom"]);
export const audienceKnowledgeLevelSchema = z.string().trim().min(1).max(200);
export const audienceProfileSchema = z.object({
  preset: audiencePresetSchema,
  knowledgeLevel: audienceKnowledgeLevelSchema,
  goal: boundedText(500),
  tone: boundedText(200),
  format: boundedText(200),
  disclosureBoundaries: z.array(z.string().trim().min(1).max(500)).max(20),
});
export const audienceProfileInputSchema = z.union([audienceProfileSchema, audiencePresetSchema]);
export const learningDispositionSchema = z.enum(["keep", "adapt", "discard"]);

export const actionPayloadSchema = z.object({
  to: email,
  cc: z.array(email).max(20).optional(),
  bcc: z.array(email).max(20).optional(),
  subject: boundedText(998),
  body: boundedText(100_000),
  thread_id: z.string().trim().max(255).optional(),
}).strict();

const creationFields = {
  idempotencyKey: z.string().uuid(),
  title: boundedText(200),
  brief: boundedText(20_000),
  source: z.string().max(100_000).optional(),
  sourceUrls: z.array(z.string().url().refine((value) => value.startsWith("https://"), "Only public HTTPS URLs are supported")).max(5).optional().default([]),
  audience: audienceProfileInputSchema.optional(),
  customAudience: z.string().trim().max(200).optional(),
  clientId: z.string().uuid().optional(),
  selectedLearningIds: z.array(z.string().uuid()).max(3).optional().default([]),
  sourceManifest: z.array(z.object({ kind: z.enum(["upload", "url", "pasted"]), filename: z.string().trim().min(1).max(255), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), byteSize: z.number().int().nonnegative().max(10 * 1024 * 1024).optional(), urlHost: z.string().trim().max(255).nullable().optional() }).strict()).max(5).optional().default([]),
  workflowStreamId: z.string().uuid().optional(),
  expectedStreamVersion: z.number().int().positive().optional(),
  /** Type-only marker for archived snapshots; strict parsing rejects legacy `inputs`. */
  inputs: z.never().optional(),
} as const;

/**
 * Creation is a strict top-level module union.  `module` remains the sole
 * authority; the persisted context JSON deliberately contains no module key.
 */
export const growthCreationRequestSchema = z.object({
  ...creationFields,
  module: z.literal("growth"),
  intakeContext: growthIntakeContextSchema,
}).strict().superRefine((value, context) => {
  if (Boolean(value.workflowStreamId) !== Boolean(value.expectedStreamVersion)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [value.workflowStreamId ? "expectedStreamVersion" : "workflowStreamId"], message: "Workflow stream id and expected version must be provided together" });
  }
});

export const operationsCreationRequestSchema = z.object({
  ...creationFields,
  module: z.literal("operations"),
  intakeContext: operationsIntakeContextSchema,
}).strict().superRefine((value, context) => {
  if (Boolean(value.workflowStreamId) !== Boolean(value.expectedStreamVersion)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [value.workflowStreamId ? "expectedStreamVersion" : "workflowStreamId"], message: "Workflow stream id and expected version must be provided together" });
  }
});

export const intelligenceCreationRequestSchema = z.object({
  ...creationFields,
  module: z.literal("intelligence"),
  intakeContext: intelligenceIntakeContextSchema,
}).strict().superRefine((value, context) => {
  if (Boolean(value.workflowStreamId) !== Boolean(value.expectedStreamVersion)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [value.workflowStreamId ? "expectedStreamVersion" : "workflowStreamId"], message: "Workflow stream id and expected version must be provided together" });
  }
});

export const generationRequestSchema = z.discriminatedUnion("module", [
  growthCreationRequestSchema,
  operationsCreationRequestSchema,
  intelligenceCreationRequestSchema,
]);

/** Rev-0 intake is deliberately separate from generation; files upload direct to Storage. */
export const intakeRequestSchema = generationRequestSchema;

export const revisionGenerationRequestSchema = z.object({
  audience: audienceProfileInputSchema.optional(),
  customAudience: z.string().trim().max(200).optional(),
});

/** Case deletion deliberately preserves the exact, untrimmed title. */
export const caseDeletionRequestSchema = z.object({
  confirmationTitle: z.string().min(1).max(200),
  requestId: z.string().uuid(),
}).strict();

/** The profile-locale endpoint accepts only the two supported values. */
export const profileLocaleRequestSchema = z.object({ locale: localeSchema });

/** The greeting name is deliberately short, plain text, and owned by the signed-in user. */
export const profileDisplayNameRequestSchema = z.object({ displayName: boundedText(80) });

export const revisionRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: boundedText(200),
  summary: boundedText(20_000),
  body: boundedText(100_000),
  nextAction: boundedText(2_000),
  action: actionPayloadSchema.optional(),
  /** @deprecated retained only so archived source snapshots continue to typecheck. */
  content: z.unknown().optional(),
  /** @deprecated retained only so archived source snapshots continue to typecheck. */
  brief: boundedText(20_000).optional(),
});

export const approvalRequestSchema = z.object({
  artifactRevision: z.number().int().positive(),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/i),
  actionPayloadHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

export const actionRequestSchema = z.object({
  actionId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(16).max(200),
});

export const styleSignalDecisionSchema = z.enum(["confirm", "discard"]);
export const styleRulesSchema = z.object({
  tone: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
  structure: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
  clarity: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
  antiCorporate: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
}).strict();
export const styleSignalResolutionSchema = z.object({
  decision: styleSignalDecisionSchema,
  rules: styleRulesSchema.optional().default({}),
}).strict();

export const clientCreateRequestSchema = z.object({
  name: boundedText(160),
  company: z.string().trim().max(160).optional().default(""),
  notes: z.string().trim().max(5_000).optional().default(""),
  contactMetadata: z.record(z.string(), z.string().trim().max(500)).refine((value) => Object.keys(value).length <= 20).optional().default({}),
}).strict();
export const clientUpdateRequestSchema = clientCreateRequestSchema.extend({ status: z.enum(["active", "archived"]).optional().default("active") }).strict();

export const importSourceSchema = z.object({
  kind: z.enum(["pasted", "upload"]).default("upload"),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", PPTX_MIME, "text/plain", "text/markdown"]),
  byteSize: z.number().int().positive().max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  extractedText: z.string().max(100_000),
  truncated: z.boolean().default(false),
}).strict();
/** Bounded text accepted by guided import before it is converted into a
 * server-derived synthetic source.  Hashes are always computed on the server
 * from the submitted bytes; callers cannot provide a trusted hash here. */
export const importTextSchema = z.string().trim().min(1).max(100_000);
export const importClassifyRequestSchema = z.object({
  flow: caseFlowKeySchema,
  sources: z.array(importSourceSchema).min(1).max(4),
}).strict();

/**
 * Guided proposals intentionally permit blank required values while a person
 * is reviewing an AI suggestion.  The confirmation union below switches to
 * the strict persisted intake schemas, so no case can be created until those
 * values are complete.  Every object is strict to keep arbitrary model keys
 * out of the confirmation boundary.
 */
const guidedText = (max: number) => z.string().trim().max(max).default("");
const guidedList = (maxItems: number, maxText = 2_000) => z
  .array(z.string().trim().max(maxText))
  .max(maxItems)
  .default([])
  .transform(normalizeIntakeList);

const guidedSharedShape = {
  schemaVersion: z.literal(1).default(1),
  successCriteria: guidedText(2_000),
  workflowGuidance: guidedText(4_000),
} as const;

export const guidedGrowthIntakeContextSchema = z.object({
  ...guidedSharedShape,
  offer: guidedText(4_000),
  leadProfile: guidedText(4_000),
  pipelineContext: guidedText(4_000),
  campaignContext: guidedText(4_000),
  conversionTarget: guidedText(2_000),
}).strict();

export const guidedOperationsIntakeContextSchema = z.object({
  ...guidedSharedShape,
  decisionsNeeded: guidedList(20),
  owners: guidedList(20),
  deadlines: guidedList(20),
  sopContext: guidedText(8_000),
  blockers: guidedList(20),
  crossFunctionalSignals: guidedList(20),
}).strict();

export const guidedIntelligenceIntakeContextSchema = z.object(guidedSharedShape).strict();

export const guidedAudienceProfileSchema = z.object({
  preset: z.literal("custom").default("custom"),
  knowledgeLevel: guidedText(200),
  goal: guidedText(500),
  tone: guidedText(200),
  format: guidedText(200),
  disclosureBoundaries: guidedList(20, 500),
}).strict();

export const guidedImportContextSchemaByFlow = {
  growth: guidedGrowthIntakeContextSchema,
  operations: guidedOperationsIntakeContextSchema,
  intelligence: guidedIntelligenceIntakeContextSchema,
  general: guidedOperationsIntakeContextSchema,
} as const;

export function guidedImportContextSchemaForFlow(flow: CaseFlowKey) {
  return guidedImportContextSchemaByFlow[flow];
}

const importConfirmCommonFields = {
  idempotencyKey: z.string().uuid(),
  title: boundedText(200),
  brief: boundedText(20_000),
  sources: z.array(importSourceSchema).min(1).max(4),
  clientId: z.string().uuid().optional(),
  audience: audienceProfileInputSchema.optional(),
  customAudience: z.string().trim().max(200).optional(),
  selectedLearningIds: z.array(z.string().uuid()).max(3).optional().default([]),
} as const;

/**
 * Confirmation is discriminated by the user-selected presentation flow.  The
 * server derives the persisted module from this key; callers cannot submit a
 * free-form module or context object.
 */
export const importConfirmRequestSchema = z.discriminatedUnion("flow", [
  z.object({ ...importConfirmCommonFields, flow: z.literal("growth"), intakeContext: growthIntakeContextSchema }).strict(),
  z.object({ ...importConfirmCommonFields, flow: z.literal("operations"), intakeContext: operationsIntakeContextSchema }).strict(),
  z.object({ ...importConfirmCommonFields, flow: z.literal("intelligence"), intakeContext: intelligenceIntakeContextSchema }).strict(),
  z.object({ ...importConfirmCommonFields, flow: z.literal("general"), intakeContext: operationsIntakeContextSchema }).strict(),
]);

const proposalCommonFields = {
  confidence: z.number().min(0).max(1),
  title: boundedText(200),
  objective: boundedText(20_000),
  checklist: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/), label: boundedText(200), required: z.boolean() }).strict()).max(30),
  gaps: z.array(boundedText(1_000)).max(20),
  conflicts: z.array(boundedText(1_000)).max(20),
  risks: z.array(boundedText(1_000)).max(20),
  evidenceMappings: z.array(z.object({ filename: boundedText(255), hash: z.string().regex(/^[a-f0-9]{64}$/), supports: z.array(boundedText(200)).max(10) }).strict()).max(3),
} as const;

/** Structured AI output is equally strict and flow-specific. */
export const importProposalSchema = z.discriminatedUnion("flow", [
  z.object({ ...proposalCommonFields, flow: z.literal("growth"), module: z.literal("growth"), intakeContext: guidedGrowthIntakeContextSchema }).strict(),
  z.object({ ...proposalCommonFields, flow: z.literal("operations"), module: z.literal("operations"), intakeContext: guidedOperationsIntakeContextSchema }).strict(),
  z.object({ ...proposalCommonFields, flow: z.literal("intelligence"), module: z.literal("intelligence"), intakeContext: guidedIntelligenceIntakeContextSchema, audience: guidedAudienceProfileSchema }).strict(),
  z.object({ ...proposalCommonFields, flow: z.literal("general"), module: z.literal("operations"), intakeContext: guidedOperationsIntakeContextSchema }).strict(),
]);

export const reanalysisRequestSchema = z.object({
  triggerType: z.enum(["manual", "source_added"]).default("manual"),
  expectedRevision: z.number().int().nonnegative().optional(),
  sourceStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  idempotencyKey: z.string().trim().min(16).max(200).optional(),
  process: z.boolean().default(false),
}).strict();

export const outcomeRequestSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;
    const input = value as Record<string, unknown>;
    return {
      ...input,
      // Keep the first kernel's result field as a backwards-compatible alias.
      actualResult: input.actualResult ?? input.result,
      nextAction: input.nextAction,
      // `learningNote` was the original optional context field. It remains a
      // compatible alias for an explicitly edited candidate learning.
      learningCandidate: input.learningCandidate ?? input.learningNote,
      learningApplicability: input.learningApplicability ?? input.applicability,
      approveAdaptedLearning: [input.approveAdaptedLearning, input.confirmLearning, input.approvedForReuse]
        .some((value) => value === true || value === "true" || value === "on"),
    };
  },
  z.object({
    expectedResult: optionalText(20_000),
    actualResult: boundedText(20_000),
    evidence: optionalText(20_000),
    confidence: z.enum(["low", "medium", "high"]).default("medium"),
    whatWorked: optionalText(10_000),
    whatFailed: optionalText(10_000),
    blockers: optionalText(10_000),
    nextAction: boundedText(2_000),
    improvements: optionalText(10_000),
    otherAngles: optionalText(10_000),
    followUpDate: z
      .union([z.string().date(), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" ? null : value)),
    learningDisposition: learningDispositionSchema,
    learningNote: z.string().trim().max(10_000).optional(),
    learningCandidate: z.string().trim().max(10_000).optional(),
    learningApplicability: z.string().trim().max(4_000).optional(),
    approveAdaptedLearning: z.boolean().default(false),
    result: z.string().trim().max(20_000).optional(),
  }),
);

/** The normalized server-side pilot application payload. */
export const pilotApplicationSchema = z.object({
  email,
  name: boundedText(160),
  company: boundedText(200).optional(),
  role: boundedText(200).optional(),
  goals: boundedText(10_000),
  locale: z.enum(["en", "zh-Hant"]).default("en"),
  website: z.string().url().max(2_000).optional(),
  honeypot: z.string().max(200).optional(),
  submissionId: z.string().uuid(),
  consent: z.literal(true),
  consentVersion: z.literal(PILOT_POLICY_VERSION),
}).strict();

/** Exact browser form fields accepted by the plural compatibility route. */
export const pilotApplicationFormSchema = z.object({
  name: boundedText(160),
  email,
  role: boundedText(200),
  pain: boundedText(1_200),
  desiredOutcome: boundedText(1_200),
  locale: z.enum(["en", "zh-Hant"]),
  submissionId: z.string().uuid(),
  consent: z.literal(true),
  consentVersion: z.literal(PILOT_POLICY_VERSION),
  website: z.string().max(200).optional().default(""),
}).strict();

export const magicLinkRequestSchema = z.object({ email });

export const googleCallbackSchema = z.object({
  code: boundedText(4_000),
  state: boundedText(2_000),
});

export const inviteRequestSchema = z.object({
  email,
  applicationId: z.string().uuid().optional(),
  workspaceName: boundedText(160).optional(),
  role: z.enum(["owner", "member", "admin"]).default("member"),
}).strict();

export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export const caseCreateSchema = generationRequestSchema;
export const caseSchema = generationRequestSchema;
export type RevisionRequest = z.infer<typeof revisionRequestSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type OutcomeRequest = z.infer<typeof outcomeRequestSchema>;
export type WorkflowStreamCreateRequest = z.infer<typeof workflowStreamCreateRequestSchema>;
export type WorkflowStreamReviseRequest = z.infer<typeof workflowStreamReviseRequestSchema>;
export type WorkflowStreamArchiveRequest = z.infer<typeof workflowStreamArchiveRequestSchema>;
