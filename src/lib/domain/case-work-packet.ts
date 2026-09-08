import { z } from "zod";
import type { ModuleKey } from "./types";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = (maxItems: number, maxText = 2_000) => z.array(z.string().trim().min(1).max(maxText)).max(maxItems);

export const learningApplicationDispositionSchema = z.enum([
  "applied",
  "partially_applied",
  "not_applied",
  "conflicted",
]);

export const learningApplicationSchema = z.object({
  learningId: z.string().uuid(),
  disposition: learningApplicationDispositionSchema,
  rationale: boundedText(4_000),
});

const evidenceBriefSchema = z.object({
  observations: boundedList(20),
  assumptions: boundedList(20),
  gaps: boundedList(20),
  risks: boundedList(20),
});

const deliverableSchema = z.object({
  title: boundedText(200),
  summary: boundedText(20_000),
  body: boundedText(100_000),
  next_action: boundedText(2_000),
});

const growthPlanSchema = z.object({
  opportunity: boundedText(4_000),
  hypothesis: boundedText(4_000),
  conversionPath: boundedText(8_000),
  proof: boundedList(20, 4_000),
  measures: boundedList(20, 1_000),
});

const operationsPlanSchema = z.object({
  bottleneck: boundedText(4_000),
  decision: boundedText(4_000).describe("The smallest source-grounded decision; label any AI-introduced decision as proposed."),
  owners: boundedList(20, 1_000).describe("Named owners supplied by the user, or explicitly proposed and labelled responsibilities when evidence leaves ownership unassigned."),
  dependencies: boundedList(20, 2_000).describe("Supplied deadlines, SOP constraints, blockers, dependencies, and cross-functional signals; do not invent a dependency or deadline."),
  measures: boundedList(20, 1_000).describe("Observable operating measures with supplied baselines or denominators only; label targets as proposals when supporting evidence is missing."),
  contradictions: boundedList(20, 2_000),
  deadlineCollisions: boundedList(20, 2_000),
});

const intelligencePlanSchema = z.object({
  claims: boundedList(20, 4_000),
  evidenceBoundaries: boundedList(20, 4_000),
  uncertainty: boundedList(20, 4_000),
  audienceStrategy: boundedText(8_000),
});

export const caseWorkPacketSchema = z.object({
  evidenceBrief: evidenceBriefSchema,
  plan: z.union([growthPlanSchema, operationsPlanSchema, intelligencePlanSchema]),
  deliverable: deliverableSchema,
  learningApplications: z.array(learningApplicationSchema).max(3),
});

export type CaseWorkPacket = z.infer<typeof caseWorkPacketSchema>;
export type LearningApplication = z.infer<typeof learningApplicationSchema>;

export const caseWorkPacketGenerationRequestSchema = z.object({
  audience: z.unknown().optional(),
  customAudience: z.string().trim().max(200).optional(),
  selectedLearningIds: z.array(z.string().uuid()).max(3).optional().default([]),
});

export type CaseWorkPacketGenerationRequest = z.infer<typeof caseWorkPacketGenerationRequestSchema>;

/**
 * The provider must account for exactly the IDs explicitly selected by the
 * user. This is intentionally independent of database lookups so it can be
 * tested before persistence and before any provider/quota work.
 */
export function validateLearningApplicationAccounting(
  selectedLearningIds: readonly string[],
  applications: readonly LearningApplication[],
): void {
  const selected = new Set(selectedLearningIds);
  if (selected.size !== selectedLearningIds.length) throw new Error("Duplicate learning selection");
  const accounted = new Set<string>();
  for (const application of applications) {
    if (accounted.has(application.learningId)) throw new Error("Duplicate learning application");
    if (!selected.has(application.learningId)) throw new Error("Learning application references an unselected learning");
    accounted.add(application.learningId);
  }
  if (accounted.size !== selected.size || [...selected].some((id) => !accounted.has(id))) {
    throw new Error("Learning application accounting is incomplete");
  }
}

function stringSchema(description: string) {
  return { type: "string", description } as const;
}

function listSchema(description: string, maxItems = 20) {
  return { type: "array", maxItems, items: stringSchema(description) } as const;
}

const evidenceBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    observations: listSchema("Source-grounded observations; do not invent facts."),
    assumptions: listSchema("Explicit assumptions that still need validation."),
    gaps: listSchema("Missing evidence or unanswered questions."),
    risks: listSchema("Material risks or constraints."),
  },
  required: ["observations", "assumptions", "gaps", "risks"],
} as const;

const deliverableJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: stringSchema("A concise deliverable title."),
    summary: stringSchema("A concise decision-ready summary."),
    body: stringSchema("The ordinary artifact body, grounded in source facts."),
    next_action: stringSchema("The next human action."),
  },
  required: ["title", "summary", "body", "next_action"],
} as const;

const planJsonSchemas = {
  growth: {
    type: "object",
    additionalProperties: false,
    properties: {
      opportunity: stringSchema("The bounded offer, lead, pipeline, or campaign opportunity."),
      hypothesis: stringSchema("The testable hypothesis connecting the offer and lead signal to conversion."),
      conversionPath: stringSchema("The path from demand through campaign or pipeline movement to conversion."),
      proof: listSchema("Source-grounded proof needed to support the growth hypothesis."),
      measures: listSchema("Observable conversion or pipeline measures; do not invent baselines."),
    },
    required: ["opportunity", "hypothesis", "conversionPath", "proof", "measures"],
  },
  operations: {
    type: "object",
    additionalProperties: false,
    properties: {
      bottleneck: stringSchema("The current decision, ownership, deadline, SOP, blocker, or signal bottleneck."),
      decision: stringSchema("The smallest source-grounded decision; label any AI-introduced decision as proposed."),
      owners: listSchema("Named owners supplied in the source, or explicitly proposed and labelled responsibilities when ownership is unassigned."),
      dependencies: listSchema("Supplied deadlines, SOP constraints, blockers, dependencies, and cross-functional signals; do not invent a dependency or deadline."),
      measures: listSchema("Observable operating measures with supplied baselines or denominators only; label targets as proposals when evidence is missing."),
      contradictions: listSchema("Contradictory dates, dependencies, or cross-functional/source claims supported by the supplied evidence; allow an empty list."),
      deadlineCollisions: listSchema("Deadline or cutoff collisions, including supported consequences; allow an empty list."),
    },
    required: ["bottleneck", "decision", "owners", "dependencies", "measures", "contradictions", "deadlineCollisions"],
  },
  intelligence: {
    type: "object",
    additionalProperties: false,
    properties: {
      claims: listSchema("Claims that can be made from the supplied evidence."),
      evidenceBoundaries: listSchema("What the evidence does and does not establish."),
      uncertainty: listSchema("Uncertainty and confidence limits."),
      audienceStrategy: stringSchema("Audience-specific framing that respects disclosure boundaries."),
    },
    required: ["claims", "evidenceBoundaries", "uncertainty", "audienceStrategy"],
  },
} as const;

const learningApplicationsJsonSchema = {
  type: "array",
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      learningId: stringSchema("The exact selected learning ID."),
      disposition: { type: "string", enum: ["applied", "partially_applied", "not_applied", "conflicted"] },
      rationale: stringSchema("Why this learning was or was not used in this revision."),
    },
    required: ["learningId", "disposition", "rationale"],
  },
} as const;

export function caseWorkPacketOutputSchema(module: ModuleKey): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      evidenceBrief: evidenceBriefJsonSchema,
      plan: planJsonSchemas[module],
      deliverable: deliverableJsonSchema,
      learningApplications: learningApplicationsJsonSchema,
    },
    required: ["evidenceBrief", "plan", "deliverable", "learningApplications"],
  };
}

/** Validate module-specific plan fields after the provider envelope parses. */
export function parseCaseWorkPacket(module: ModuleKey, value: unknown, selectedLearningIds: readonly string[]): CaseWorkPacket {
  const parsed = caseWorkPacketSchema.parse(value);
  const expectedPlan = module === "growth"
    ? growthPlanSchema
    : module === "operations"
      ? operationsPlanSchema
      : intelligencePlanSchema;
  expectedPlan.parse(parsed.plan);
  validateLearningApplicationAccounting(selectedLearningIds, parsed.learningApplications);
  return parsed;
}
