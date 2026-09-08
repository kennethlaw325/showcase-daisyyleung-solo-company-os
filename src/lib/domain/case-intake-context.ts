import { z } from "zod";
import type { ModuleKey } from "./types";

/** The only structured intake schema currently persisted with a case. */
export const INTAKE_CONTEXT_SCHEMA_VERSION = 1 as const;
export const MAX_INTAKE_CONTEXT_BYTES = 200_000;

const boundedText = (max: number) => z.string().trim().min(1).max(max);

/** Empty optional text is treated the same as an omitted field. */
const optionalText = (max: number) => z
  .string()
  .trim()
  .max(max)
  .transform((value) => value || undefined)
  .optional();

/**
 * Form list fields are newline-delimited in the UI.  The transform is also
 * useful for API callers: whitespace is removed and duplicate entries do not
 * create two competing instructions for the model.
 */
export function normalizeIntakeList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const item = value.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

const boundedList = (maxItems: number, maxText = 2_000) => z
  .array(z.string().trim().max(maxText))
  .max(maxItems)
  .transform(normalizeIntakeList);

const requiredList = (maxItems: number, maxText = 2_000) => boundedList(maxItems, maxText)
  .refine((values) => values.length > 0, "At least one item is required");

const sharedShape = {
  schemaVersion: z.literal(INTAKE_CONTEXT_SCHEMA_VERSION),
  successCriteria: boundedText(2_000),
  workflowGuidance: optionalText(4_000),
  /** Type-only compatibility marker; strict parsing still rejects this key. */
  futureInput: z.never().optional(),
} as const;

/** Shared context used by every module, including Intelligence. */
export const sharedIntakeContextSchema = z.object(sharedShape).strict();

/** Growth & Revenue focuses the analysis on offer-to-conversion movement. */
export const growthIntakeContextSchema = z.object({
  ...sharedShape,
  offer: boundedText(4_000),
  leadProfile: boundedText(4_000),
  pipelineContext: optionalText(4_000),
  campaignContext: optionalText(4_000),
  conversionTarget: boundedText(2_000),
}).strict();

/** Business Insights focuses on accountable movement. */
export const operationsIntakeContextSchema = z.object({
  ...sharedShape,
  decisionsNeeded: requiredList(20),
  owners: boundedList(20).default([]),
  deadlines: boundedList(20).default([]),
  sopContext: optionalText(8_000),
  blockers: boundedList(20).default([]),
  crossFunctionalSignals: boundedList(20).default([]),
}).strict();

export const intelligenceIntakeContextSchema = sharedIntakeContextSchema;

export const intakeContextSchemaByModule = {
  growth: growthIntakeContextSchema,
  operations: operationsIntakeContextSchema,
  intelligence: intelligenceIntakeContextSchema,
} as const;

export type SharedIntakeContext = z.infer<typeof sharedIntakeContextSchema>;
export type GrowthIntakeContext = z.infer<typeof growthIntakeContextSchema>;
export type OperationsIntakeContext = z.infer<typeof operationsIntakeContextSchema>;
export type IntelligenceIntakeContext = z.infer<typeof intelligenceIntakeContextSchema>;
export type IntakeContext = GrowthIntakeContext | OperationsIntakeContext | IntelligenceIntakeContext;
export type CaseIntakeContext = IntakeContext;

/**
 * A request context is discriminated by the authoritative top-level module.
 * The module is intentionally not copied into this JSON object.
 */
export function intakeContextSchemaForModule(module: ModuleKey) {
  return intakeContextSchemaByModule[module];
}

export function parseIntakeContext(module: ModuleKey, value: unknown): IntakeContext {
  const parsed = intakeContextSchemaForModule(module).parse(value);
  if ("module" in parsed) throw new Error("Intake context cannot contain a module");
  return parsed as IntakeContext;
}

/**
 * Legacy cases were created before structured context existed.  Null and the
 * database default `{}` intentionally retain that path; every other malformed
 * value fails closed before an AI runtime or quota reservation is touched.
 */
export function parsePersistedIntakeContext(module: ModuleKey, value: unknown): IntakeContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value) && value !== null && Object.keys(value).length === 0) return null;
  try {
    return parseIntakeContext(module, value);
  } catch {
    throw Object.assign(new Error("Case intake context is invalid"), { status: 422 });
  }
}

export function buildIntakeContext(module: ModuleKey, value: unknown): IntakeContext {
  return parseIntakeContext(module, value);
}

/** Stable descriptive aliases for callers that prefer the case-prefixed API. */
export const normalizeLineList = normalizeIntakeList;
export const parseCaseIntakeContext = parseIntakeContext;
export const parsePersistedCaseIntakeContext = parsePersistedIntakeContext;
