---
title: Domain Write Kernel and Security-Sensitive Code Lifecycle
status: active
owner: Demo User
updated: 2026-08-21
source_of_truth: true
supersedes: []
tags: [solo-company-os, governance, domain-writes, security, lifecycle]
---

# Domain write kernel and code lifecycle

## Scope and authority

SQL migrations and narrowly scoped RPCs are the accepted target and mandatory
boundary for **all new or changed domain writes**. Routes may authenticate,
validate an allowlisted payload, and call the kernel; they must not
re-implement cross-row invariants, approval binding, tenancy, idempotency, or
audit sequencing in application code. The kernel is authoritative for the
write contract, while route tests prove the request boundary and user-facing
recovery behaviour.

Current direct service-role writes are registered transitional exceptions. The
broader migration is deferred, not silently accepted as conformance, and is a
planned launch/readiness item owned by Demo User:

| Transitional category | Current paths | Status | Launch/readiness impact |
| --- | --- | --- | --- |
| Case intake | `app/api/cases/route.ts`, `app/api/cases/intake/route.ts`, `src/lib/server/case-intake.ts` | Planned | Repo-wide write-kernel conformance remains a launch/readiness gate. |
| Execution start/complete/fail in generation, audience, and outcome | `app/api/cases/[id]/generate-revision/route.ts`, `src/lib/server/audience.ts`, `app/api/cases/[id]/outcome/route.ts` | Planned | Lifecycle and audit sequencing still require the SQL boundary. |
| Source extraction | `app/api/cases/[id]/sources/route.ts` | Planned | Extraction mutation remains a transitional exception. |
| Outcome-learning and audit sequencing | `app/api/cases/[id]/outcome/route.ts` | Planned | Outcome completion and learning provenance need one kernel transaction. |
| Audience variants | `src/lib/server/audience.ts` | Planned | Variant persistence remains outside the accepted target boundary. |
| Admin invitation database mutations | `app/api/admin/invites/route.ts` | Planned | Workspace, invitation, profile, status, and audit writes need a governed kernel. |
| Profile preferences | `app/api/profile/locale/route.ts`, `app/api/profile/display-name/route.ts` | Planned | Preference mutations remain transitional until the shared spec is adopted. |

This follow-up migrates pilot consent only; it does not migrate these existing
categories. The repository must not claim full write-kernel conformance until
the planned work is implemented and evidenced.

The TypeScript state machine in `src/lib/domain/state-machine.ts` is a UI
mirror/deprecated helper, not write authority. It must later be generated or
validated from the SQL/shared specification, or removed only with exact
deletion permission.

Service-role code is a capability, not a general database bypass. Every
service-role RPC must have an explicit signature, fixed `search_path`, fully
qualified references, a narrow grant, an actor or exact input boundary where
relevant, and an audit record for consequential state changes. Do not broaden
existing service-role writes as part of an unrelated change.

## Security-sensitive code lifecycle

1. **Design** — state the invariant, trust boundary, failure mode, and exact
   capability before editing. Resolve architecture disputes in an accepted
   decision record; do not hide an unresolved deletion/provenance choice in a
   migration.
2. **Implement** — make the smallest additive change, preserve historical
   records, reject unknown or stale inputs, and keep one writer per file.
3. **Review** — inspect the diff for privilege drift, data disclosure,
   unbounded input, missing idempotency, search-path hazards, and audit gaps.
4. **Validate** — run focused behaviour tests, migration/static contract
   tests, typecheck, lint, and `git diff --check`; run local database checks
   only when an already-running stack is safe to use.
5. **Release** — record evidence with its actual tier and revision. A local or
   preview result cannot be described as live verification. Unverified claims
   remain launch gates.
6. **Operate and retire** — monitor failure visibility and recovery actions;
   deprecate by revoking access before considering removal. Deletion of a
   function, row, note, or other user content requires explicit permission.

## Defence status vocabulary

Use one deliberate status for each control or claim:

- **Enforced** — present in the schema, runtime, or policy.
- **Tested** — behaviour is covered by an executable test, but runtime
  deployment evidence is not implied.
- **Manually verified** — a human inspected the stated environment or flow;
  record who, when, and revision.
- **Incidental** — observed as a side effect, not a relied-upon control.
- **Planned** — accepted work remains; it must not be represented as present.

Do not collapse these statuses into a generic “secure” or “ready” label.

## Change checklist

Before merging a security-sensitive change, attach the claim ID, exact input and
output contract, affected roles, migration ordering, focused tests, known
unknowns, and deployment-blocking status to the release evidence register.
