import type { CaseStatus } from "./types";

/** Explicit transitions keep UI and API handlers from inventing state. */
export const CASE_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  draft: ["working", "cancelled"],
  working: ["awaiting_approval", "blocked", "failed", "cancelled"],
  awaiting_approval: ["approved", "outcome_pending", "working", "blocked", "cancelled"],
  approved: ["action_pending", "working", "cancelled"],
  action_pending: ["outcome_pending", "awaiting_approval", "failed", "blocked", "cancelled"],
  outcome_pending: ["awaiting_approval", "completed", "blocked", "failed"],
  completed: [],
  blocked: ["working", "cancelled"],
  failed: ["working", "cancelled"],
  cancelled: [],
};

export const CASE_STATUS_TRANSITIONS = CASE_TRANSITIONS;

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const isValidTransition = canTransition;

export function assertTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid case transition: ${from} -> ${to}`);
  }
}

export function transitionCase<T extends { status: CaseStatus }>(
  record: T,
  to: CaseStatus,
): T {
  assertTransition(record.status, to);
  return { ...record, status: to };
}

export function requiresApproval(status: CaseStatus): boolean {
  return status === "awaiting_approval" || status === "approved" || status === "action_pending";
}

export function isTerminal(status: CaseStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export function isCompleteable(input: {
  status: CaseStatus;
  hasOutcome: boolean;
  hasNextAction: boolean;
  learningDisposition?: string | null;
}): boolean {
  return (
    input.status === "outcome_pending" &&
    input.hasOutcome &&
    input.hasNextAction &&
    input.learningDisposition !== undefined &&
    input.learningDisposition !== null &&
    input.learningDisposition !== ""
  );
}
