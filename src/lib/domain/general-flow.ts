import type { ModuleKey } from "./types";

/**
 * UI flow keys are intentionally separate from the three canonical modules.
 * `general` is kept as an internal compatibility key for the broadly useful
 * Custom intake shape; it is not a fourth persisted module or workflow
 * builder.
 */
export type CaseFlowKey = ModuleKey | "general";

export const GENERAL_FLOW_MODULE: ModuleKey = "operations";

/**
 * The four entry flows are shared by manual and guided intake.  `general`
 * remains a presentation key only; it always persists as Operations.
 *
 * Keep this ordered list as the single source for the numbered picker.  The
 * labels are intentionally English defaults; portal callers localise their
 * visible copy while retaining the stable key and engine mapping.
 */
export const CASE_FLOWS = [
  { key: "growth" as const, number: "01", title: "Growth & Revenue", subtitle: "Move leads through demand, sales, and conversion", accent: "violet", engine: "growth" as const },
  { key: "operations" as const, number: "02", title: "Business Insights", subtitle: "Connect market signals with cross-functional insight", accent: "cyan", engine: "operations" as const },
  { key: "intelligence" as const, number: "03", title: "Brand Communications & PR", subtitle: "Shape source-led PR for distinct audiences", accent: "amber", engine: "intelligence" as const },
  { key: "general" as const, number: "04", title: "Custom", subtitle: "Goal, context, people, evidence, constraints, and the next decision", accent: "sea", engine: GENERAL_FLOW_MODULE },
] as const;

/** Backwards-compatible name for callers that only need the Custom flow. */
export const GENERAL_FLOW = CASE_FLOWS[3];

export function moduleForFlow(flow: CaseFlowKey): ModuleKey {
  return flow === "general" ? GENERAL_FLOW_MODULE : flow;
}

/**
 * Build the operations context for the Custom flow without adding facts.
 * The user's objective remains the fallback decision request; optional fields
 * remain empty until the user supplies them.
 */
export function buildGeneralFlowContext(input: {
  objective: string;
  successCriteria: string;
  workflowGuidance?: string;
  decisionsNeeded?: string[];
  owners?: string[];
  deadlines?: string[];
  sopContext?: string;
  blockers?: string[];
  crossFunctionalSignals?: string[];
}) {
  const objective = input.objective.trim();
  return {
    schemaVersion: 1 as const,
    successCriteria: input.successCriteria.trim(),
    ...(input.workflowGuidance?.trim() ? { workflowGuidance: input.workflowGuidance.trim() } : {}),
    decisionsNeeded: input.decisionsNeeded?.map((value) => value.trim()).filter(Boolean).length
      ? input.decisionsNeeded.map((value) => value.trim()).filter(Boolean)
      : [objective],
    owners: input.owners ?? [],
    deadlines: input.deadlines ?? [],
    ...(input.sopContext?.trim() ? { sopContext: input.sopContext.trim() } : {}),
    blockers: input.blockers ?? [],
    crossFunctionalSignals: input.crossFunctionalSignals ?? [],
  };
}

/** Descriptive aliases keep the mapping discoverable to route/UI callers. */
export const generalFlowModule = moduleForFlow;
export const mapGeneralFlowToOperations = buildGeneralFlowContext;
