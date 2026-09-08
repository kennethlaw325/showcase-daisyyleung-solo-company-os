---
title: Founding Pilot Consent Contract
status: active
owner: Demo User
updated: 2026-08-21
source_of_truth: true
supersedes: []
tags: [solo-company-os, pilot, consent, privacy, invitations]
---

# Founding pilot consent contract

## Active version

The active policy version is `founding-pilot-2026-08-21-v1`. The structured
bilingual bundle in [`src/lib/legal/pilot-policy.ts`](../src/lib/legal/pilot-policy.ts)
drives the consent form and both public documents. It is a founding-pilot,
pre-launch policy pending counsel review; it does not claim legal approval.

## Submission contract

- Browser submissions carry a UUID `submissionId`, `consent: true`, the exact
  policy version, and the selected `en` or `zh-Hant` locale.
- The SQL RPC is the domain write kernel and is executable only by
  `service_role`. Direct table writes and the legacy eight-argument RPC are
  revoked for API roles; the legacy function remains present for migration
  compatibility and is not dropped.
- Consent evidence is versioned and timestamped by the database. New rows
  persist `submission_id`, `consent_policy_version`, `consent_locale`, and
  `consented_at` together, or none of them. Historical rows are not backfilled.
- Exact retries with the same UUID and identical applicant/consent data return
  the existing row before rate limiting. Reusing the UUID with changed data
  fails closed. Only the first insertion writes one content-free audit event.
- Invitation creation checks active, complete, locale-matched evidence before
  any workspace or Auth side effect. Legacy, missing, mismatched, or inactive
  consent cannot be invited.

## Language and recovery

The form links to both the matching-locale privacy and terms documents. Changing
locale remounts the consent controls, creates a new submission UUID, and
requires fresh consent. A failed retry keeps the applicant's values and the
same UUID so the SQL idempotency contract can be used safely.

## Open launch decision

The relationship between case deletion and provenance retention is unresolved
and launch-blocking. This protocol records the blocker only; it does not change
deletion behaviour, migrations, or tests until an accepted decision is recorded.
