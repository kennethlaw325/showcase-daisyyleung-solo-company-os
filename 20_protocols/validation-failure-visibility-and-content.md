---
title: Validation, Failure Visibility, and Content Register
status: active
owner: Demo User
updated: 2026-08-21
source_of_truth: true
supersedes: []
tags: [solo-company-os, validation, failure, content, i18n]
---

# Validation, failure visibility, and content register

## Behaviour-first testing policy

Prefer tests that exercise the observable boundary: rendered labels and links,
request parsing, response status and recovery, database invariants, privilege
grants, idempotent retries, and tenant visibility. Do not make a test pass by
asserting that the implementation contains a particular string. Static source
checks are reserved for prohibited surfaces, migration signature/version drift,
and inventory contracts where there is no safer executable boundary.

## Failure Visibility Contract

Every validation or runtime failure must make four things visible at the
boundary where a person can recover:

1. **State** — what failed (`invalid`, `blocked`, `stale`, `unavailable`, or
   `not configured`) without exposing secrets or source content.
2. **Cause** — the safest known explanation, bounded to the relevant field,
   revision, permission, connector, or environment.
3. **Recovery** — one concrete action such as edit and retry, reconnect,
   request fresh approval, choose a supported language, or contact the pilot
   owner.
4. **Record** — an identifier, status, timing, or usage fact suitable for
   audit/telemetry; never source text, prompts, artifacts, email bodies, or
   OAuth tokens.

API responses should be stable and non-sensitive. The UI should preserve
recoverable values after a failed retry and should not manufacture success when
the write kernel rejected the payload. Stale approvals and changed payloads
must name the need for a fresh approval. A missing provider configuration must
not be presented as an empty AI result.

## Content register and language intent

The interface has one bilingual content contract, but not one undifferentiated
register:

| Surface | Traditional Chinese | English | Intent |
| --- | --- | --- | --- |
| Marketing/public story | Restrained Hong Kong Cantonese-influenced Traditional Chinese | Clear, warm plain English | Explain the operating loop without unverified hype, testimonials, pricing, or autonomy claims. |
| Portal and AI output | Clear written Traditional Chinese using Hong Kong terms | Clear written English | Help a person decide, edit, approve, recover, and record an outcome. |
| Privacy and Terms | Formal equivalent written Traditional Chinese | Formal equivalent English | Preserve meaning and limitations; label founding-pilot, pre-launch, and counsel-review-pending status. |
| Errors and security states | Direct written language plus recovery action | Direct written language plus recovery action | Say what is blocked and what the person can do next. |

Traditional Chinese and English are equivalent legal and consent surfaces. Public
language toggles may persist locally; authenticated portal language is persisted
for the verified user. A language change must not mutate an artifact revision or
carry an old consent checkbox into a new locale/version.
