---
title: Solo Company OS Knowledge Map
status: active
owner: Demo User
updated: 2026-08-16
source_of_truth: true
supersedes: []
tags: [solo-company-os, index, routing]
---

# Solo Company OS knowledge map

## Purpose

Route project-scoped work to the smallest authoritative source. This folder is for current project identity, system boundaries, architecture routing, and terminology; implementation details remain in the source tree.

## Retrieval triggers

Read this index after the project-root `AGENTS.md` for every project-scoped task. Continue only to the linked index or source needed for the request.

## Canonical sources

- Project rules, security boundaries, approval invariants, and validation contract: [`../AGENTS.md`](../AGENTS.md) — active, authoritative.
- Product experience, visual system, interaction patterns, responsive behaviour, and accessibility: [`../design.md`](../design.md) — active, authoritative unless superseded by `AGENTS.md`.
- Product identity, current surfaces, environment contract, and operating flow: [`../README.md`](../README.md) — active, authoritative unless superseded by `AGENTS.md`.
- Application and API implementation: [`../app/`](../app/) and [`../src/`](../src/) — active implementation sources.
- Database schema, RLS, and RPC lifecycle rules: [`../supabase/migrations/`](../supabase/migrations/) — active implementation source of truth.
- Verification: [`../tests/`](../tests/) and [`../supabase/tests/`](../supabase/tests/) — active acceptance evidence.
- Governance, write-kernel lifecycle, failure visibility, and pilot consent:
  [`../20_protocols/INDEX.md`](../20_protocols/INDEX.md) and the linked active
  protocol documents.
- Release evidence register: [`../50_telemetry/release-evidence-register.md`](../50_telemetry/release-evidence-register.md) — observational, not authoritative.

## Knowledge routing

- Agent roles and boundaries: [`../10_agents/INDEX.md`](../10_agents/INDEX.md).
- Active workflows and validation procedures: [`../20_protocols/INDEX.md`](../20_protocols/INDEX.md).
- Current decisions, handoffs, and lessons: [`../30_memory/INDEX.md`](../30_memory/INDEX.md).
- Project skill inventory: [`../40_skills/INDEX.md`](../40_skills/INDEX.md).
- Generated run evidence and reports: [`../50_telemetry/INDEX.md`](../50_telemetry/INDEX.md).

## Current architecture and glossary

- `case`: one tenant-owned unit of work scoped by `workspace_id`.
- `artifact revision`: immutable generated or edited case output bound by its content hash.
- `approval`: a human decision bound to the exact artifact revision and, when relevant, exact action payload hash.
- `learning`: an outcome-derived proposal that is reusable only after explicit confirmation.
- Public routes must not load tenant data; portal data is derived from the verified server session and protected by RLS.

No separate architecture document is currently authoritative. Read the relevant implementation source and migration when the `README.md` is insufficient.
