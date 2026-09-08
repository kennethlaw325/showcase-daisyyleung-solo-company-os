---
title: Solo Company OS Protocol Index
status: active
owner: Demo User
updated: 2026-08-28
source_of_truth: true
supersedes: []
tags: [solo-company-os, protocols, index]
---

# Protocol index

## Purpose

Route active operating, security, approval, tenancy, privacy, and validation procedures. Draft product ideas and generated reports do not belong here.

## Retrieval triggers

Read when changing lifecycle transitions, approvals, external actions, AI handling, RLS, source ingestion, or release validation.

## Inventory and authority

- Active product protocols and invariants: [`../AGENTS.md`](../AGENTS.md).
- Local development, provider setup, pilot operations, and deployment gates: [`../README.md`](../README.md).
- Enforced database procedures: [`../supabase/migrations/`](../supabase/migrations/).
- Contract and migration validation: [`../tests/`](../tests/) and [`../supabase/tests/`](../supabase/tests/).
- Domain write kernel and security-sensitive lifecycle:
  [`domain-write-kernel-and-code-lifecycle.md`](domain-write-kernel-and-code-lifecycle.md).
- Security assurance and evidence tiers:
  [`security-assurance-and-release-evidence.md`](security-assurance-and-release-evidence.md).
- Failure Visibility Contract and intentional language register:
  [`validation-failure-visibility-and-content.md`](validation-failure-visibility-and-content.md).
- Versioned founding-pilot consent and invitation gate:
  [`pilot-consent.md`](pilot-consent.md).
- Active Groq cloud transcription contract, privacy boundary, quotas, and
  release gate:
  [`groq-transcription-integration.md`](groq-transcription-integration.md).
- Superseded Typeless transcription contract (historical only):
  [`typeless-transcription-integration.md`](typeless-transcription-integration.md).
- Incident-scoped structural exceptions for the 2026-08-27 voice-transcription
  production recovery (exact blocker paths, review triggers, and non-waived
  release gates):
- Private GitHub upload structural exceptions and cohesion reviews (active,
  upload-scoped; includes the 2026-08-21 PR #18 `app/globals.css` refresh):
- Private GitHub PR #20 main-integration structural exceptions (active,
  integration-scoped; exact blocker bindings and non-waived gates):

The upload-scoped protocol above is the active exception record for its stated
private handoff only. When documentation and enforcement differ, `AGENTS.md`
governs product intent and migrations/tests govern implemented behavior; report
the conflict rather than guessing.
