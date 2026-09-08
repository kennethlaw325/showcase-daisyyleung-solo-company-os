# AGENTS.md

This project inherits the active user-level Codex `AGENTS.md` and adds the following product-specific rules.

## Product boundaries

- This repository is the authoritative source for Solo Company OS.
- The public product page and private portal share one codebase, but public routes must never query or embed tenant content.
- The first release supports Growth, Operations, and Intelligence only. Do not add billing, teams, autonomous sending, broad crawling, or a general workflow builder without an approved scope change.
- All site layouts must include `Copyright © 2026 Demo User. All rights reserved.` exactly once.

## Security and tenancy

- Every tenant-owned database row must include `workspace_id` and be protected by Row Level Security.
- Derive workspace membership from the verified server session. Never trust a client-supplied workspace identifier.
- Service-role, OpenAI, Google OAuth, and Vault credentials are server-only and must never use `NEXT_PUBLIC_` prefixes.
- Logs and analytics may contain identifiers, status, timings, and usage only. Never log source text, artifacts, prompts, OAuth tokens, or email bodies.
- User-supplied URLs are untrusted data. Block private networks, localhost, unsupported protocols, excessive redirects, and oversized responses.

## Approval invariants

- An external action requires approval of the exact artifact revision and exact action payload hash.
- Any artifact, recipient, subject, or body change invalidates prior approval.
- Gmail integration may create drafts only. Do not implement or call a send endpoint.
- Connector execution must be idempotent and audit-recorded.
- A case is not complete until its outcome review records a next action and learning disposition.

## AI and privacy

- Use structured outputs and validate them before persistence.
- Set Gemini Interactions and OpenAI Responses requests to `store: false`; do not use background mode or provider-managed conversation state in the MVP.
- Use a billing-enabled Gemini Developer API project before processing real tenant data; free-tier calls are limited to sealed anonymous fixtures.
- Approved reusable learning may be suggested later but must never silently modify a template or user artifact.
- Do not claim Zero Data Retention or autonomous monitoring.

## Validation

- Use npm and preserve `package-lock.json`.
- Run `npm run check` before reporting implementation complete.
- Changes to schema or RLS require migration tests and explicit cross-workspace denial coverage.
- Changes to approvals require tests for stale revisions, payload changes, and idempotent retry.

## Governance protocols

- Treat SQL migrations and narrow RPCs as the domain write kernel; keep
  service-role capabilities explicit, fixed-search-path, fully qualified, and
  least-privilege. Follow [`20_protocols/domain-write-kernel-and-code-lifecycle.md`](20_protocols/domain-write-kernel-and-code-lifecycle.md).
- Record security/readiness claims with their actual evidence tier and defence
  status; unverified claims remain launch gates. Follow
  [`20_protocols/security-assurance-and-release-evidence.md`](20_protocols/security-assurance-and-release-evidence.md).
- Every failure exposes a bounded state, safest cause, recovery action, and
  content-free record. Follow
  [`20_protocols/validation-failure-visibility-and-content.md`](20_protocols/validation-failure-visibility-and-content.md).
- Founding-pilot consent is versioned, database-timestamped, retry-idempotent,
  and required before invitation. Follow
  [`20_protocols/pilot-consent.md`](20_protocols/pilot-consent.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
