const APPROVAL_CONFLICTS = new Set([
  "stale artifact",
  "stale action",
  "case is not awaiting approval",
  "action approval required",
]);

export function approvalError(error: { message?: string } | null) {
  const message = error?.message ?? "Approval unavailable";
  const status = message === "not authorized" ? 403 : APPROVAL_CONFLICTS.has(message) ? 409 : 500;
  return Object.assign(new Error(message), { status });
}
