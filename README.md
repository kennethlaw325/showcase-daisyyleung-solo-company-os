> **Dot.ai AI Builder 學生作品展示版**｜原作者：daisyyleung（原 repo：daisyyleung/solo-company-os）｜本展示版所有人名、機構、聯絡、數據皆為虛構示範資料｜部署日期：2026-09-08
>
> 靜態展示版：以 `SOLO_OS_DEMO_MODE=true` 靜態導出（`next build` / `output: "export"`），後端 API、Supabase、AI 供應商與 OAuth 均未接線，畫面資料全部來自 `src/data/demo-data.ts` 固定示範 fixture。完整功能需自行部署後端。

---

# Solo Company OS

Solo Company OS is a bilingual, invite-only operating portal for consultants, creators, and freelancers. It turns source material into a traceable next action, requires human approval before external side effects, and turns recorded outcomes into reusable learning.

## Product surfaces

- `/` — public product story
- `/request-access` — founding pilot application
- `/login` — invite-only email OTP / Magic Link
- `/app` — Today command centre
- `/app/new` — choose semi-automatic analysis or manual entry, then launch a General, Growth, Operations, or Intelligence flow
- `/app/clients` — client list and linked-case snapshots
- `/app/import` — client/source import with an explicit review-before-create boundary
- `/app/intakes` — immutable initial-input snapshots and labelled legacy reconstructions
- `/app/cases/[id]` — case workspace and audit timeline
- `/app/approvals` — exact artifact and action approval
- `/app/outcomes` — outcome and learning loop
- `/app/settings/connections` — Gmail, usage, language, and data controls
- `/admin/pilot` — pilot applications and invitations

New cases use one strict, module-specific intake contract. Growth & Revenue captures the offer, lead profile, pipeline, campaign, and conversion target; Business Intelligence & Operating Memory captures decisions, owners, deadlines, SOPs, blockers, and cross-functional signals; Intelligence keeps the shared audience workflow. Structured context stays on the case, while pasted files and URLs remain source evidence.

## Local development

Requirements: Node.js 22.13 or later, npm, and a Docker-compatible runtime for the isolated local Supabase stack.

1. Install the pinned dependencies with `npm ci`.
2. Start Docker Desktop (Linux containers), OrbStack, Colima, Podman, or another Docker-compatible runtime that can run the local Linux Supabase containers.
3. Run `npm run db:start`; the pinned Supabase CLI applies every migration and starts local Auth, Storage, Postgres, Studio, and Mailpit.
4. Copy `env.example` to `.env.local` (`cp env.example .env.local` on macOS/Linux, or `Copy-Item env.example .env.local` in Windows PowerShell) and use the local URLs and keys printed by the CLI; keep Gemini, Groq, Gmail, and optional OpenAI credentials empty until their dedicated tests and gates.
5. Add Demo User's email to `PLATFORM_ADMIN_EMAILS`.
6. Run `npm run dev` and open `http://localhost:3000`.

Without Supabase credentials, the public site still builds. Set `SOLO_OS_DEMO_MODE=true` only in local or preview environments to explore the portal with fixed anonymous fixtures.

## Environment contract

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe | Supabase anon/session client |
| `NEXT_PUBLIC_SITE_URL` | Browser-safe | Canonical app origin and auth callback base |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin invitation and controlled system operations |
| `AI_PROVIDER` | Server only | Required; explicitly selects `gemini` or the optional `openai` fallback (there is no implicit provider) |
| `GEMINI_API_KEY` | Server only | Gemini Developer API authentication |
| `GEMINI_FAST_MODEL` / `GEMINI_REASONING_MODEL` | Server only | Explicit Gemini model routing |
| `OPENAI_API_KEY` | Server only | Optional fallback provider authentication |
| `OPENAI_LUNA_MODEL` / `OPENAI_TERRA_MODEL` | Server only | Optional fallback model routing |
| `GROQ_API_KEY` | Server only | Groq speech-to-text authentication; never expose to the browser |
| `GROQ_TRANSCRIPTION_MODEL` | Server only | Allowlisted Groq Whisper model; defaults to `whisper-large-v3-turbo` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Server only | Gmail OAuth Testing-mode connection |
| `GOOGLE_OAUTH_STATE_SECRET` | Server only | Separate HMAC secret for short-lived OAuth state (32+ random characters) |
| `GOOGLE_OAUTH_REDIRECT_URI` | Server only | Exact callback URL; local development uses `http://localhost:3000/api/oauth/google/callback` |
| `PLATFORM_ADMIN_EMAILS` | Server only | Comma-separated pilot administrators |
| `APPLICATION_HASH_SALT` | Server only | Bounded anti-abuse metadata hashing |
| `SOLO_OS_DEMO_MODE` | Server only | Anonymous fixtures; refused in production |

Never add service-role, Gemini, OpenAI, Google OAuth, Vault, or hash-salt values to a `NEXT_PUBLIC_` variable.

`AI_PROVIDER` must be set explicitly to `gemini` or `openai`; blank, missing, and unsupported values fail closed as not configured.

## External service setup

Use separate Supabase projects and credentials for development/staging and production.

- **Supabase:** apply the migrations, verify RLS is enabled, keep uploaded sources in the private `source-documents` bucket, and configure Auth redirect URLs per environment.
- **Gemini:** use a billing-enabled Gemini Developer API project for tenant data. Requests are server-side, schema-constrained, non-background, and use `store: false`. The OpenAI adapter remains an optional fallback only.
- **Groq:** set `GROQ_API_KEY` and, optionally, `GROQ_TRANSCRIPTION_MODEL` (`whisper-large-v3-turbo` by default) in the server environment. The browser records locally with `MediaRecorder` and sends one recording, only after Stop, to the authenticated `/api/transcription/groq` route. The route forwards it to Groq's fixed transcription endpoint and does not persist audio or transcript. Groq documents free-plan quotas, but they are provider-controlled rather than a permanent free-service promise. Account Data Controls, production transport, and a consented live canary remain deployment gates; this repository does not claim Zero Data Retention is enabled.
- **Google Cloud:** enable the Gmail API, use OAuth Testing mode for the founding pilot, add each design partner as a test user, and request only the draft-compose scope. OAuth uses S256 PKCE and a separate `GOOGLE_OAUTH_STATE_SECRET`. Testing-mode refresh tokens are limited to 7 days, so users may need to reconnect. The application stores one encrypted Google connection per workspace/user, creates drafts, and searches draft metadata only to reconcile interrupted attempts; it has no inbox reader or send route. `gmail.compose` is a restricted scope: public production use requires Google verification and a security assessment. This repository does not claim that external setup or verification is complete.
- **Vercel:** add server secrets separately for Preview and Production. Never enable demo mode in Production.

Before public launch, complete privacy/terms counsel review, Google OAuth production verification, production backup/restore rehearsal, accessibility review, and the planned name/trademark check.

## Pilot operations

1. A prospect submits `/request-access`.
2. Demo User reviews the record in `/admin/pilot` and creates an invitation.
3. The invited email requests a Magic Link at `/login`.
4. The accepted invite creates or joins only the invitation's personal workspace.
5. Users run a case, approve the exact revision and action payload, create a Gmail draft, then record the outcome and learning disposition.

The default generation cap is 10 per workspace per day (with controlled workspace-specific overrides), 50 per month, or an estimated US$5 monthly model cost, whichever is reached first.

## Safety contract

- Tenant content stays behind Supabase Auth and RLS.
- The browser never receives service credentials or OAuth refresh tokens.
- Voice recordings are sent to Groq only after the user stops recording and are not stored by Solo Company OS. Groq handles them under the account's Data Controls. The returned transcript is added to the editable intake text and follows the same persistence and deletion lifecycle as text the user typed after they submit or confirm the case. Manual typing and pasting remain available when the integration is unavailable.
- AI output is a draft until a human approves the exact revision.
- Gmail creates a draft only; a content-free Message-ID supports safe draft reconciliation, and sending remains manual.
- The public site uses sealed demo fixtures and never loads tenant records.

## Deployment gates

- `npm run check` passes in CI.
- Cross-workspace database and Storage access is denied.
- A stale revision or changed Gmail payload cannot execute.
- Gmail retries reuse the same idempotency key and never send mail.
- All three golden paths reach an outcome review and confirmed learning disposition.
- Traditional Chinese and English have no missing keys; keyboard, 320 px, screen-reader, and reduced-motion checks pass.
- Production has `SOLO_OS_DEMO_MODE=false`, separate credentials, backups, and tested recovery.

## Security and readiness evidence

The following register maps claims to the evidence currently available in this
repository. A source or local test result is not preview/live verification;
items marked as launch gates remain unresolved.

| Claim ID | Exact claim | Defence status | Evidence | Current state |
| --- | --- | --- | --- | --- |
| `ARCH-WRITE-KERNEL` | All new or changed domain writes use the SQL/RPC domain write kernel; current direct service-role writes remain transitional exceptions. | Planned | `20_protocols/domain-write-kernel-and-code-lifecycle.md`; `50_telemetry/release-evidence-register.md` | Source only; repo-wide migration is a launch/readiness gate. |
| `SEC-TENANCY-RLS` | Tenant-owned rows require `workspace_id` and are filtered by RLS. | Enforced | `supabase/migrations/202608090001_solo_company_os.sql`; `supabase/tests/001_tenancy_rls.test.sql` | Local database suite passed 2026-08-21; preview/live deployment evidence is not claimed. |
| `SEC-APPROVAL-HASH` | External action approval binds the exact artifact revision and payload hash. | Enforced | `supabase/migrations/202608150002_revision_edit_approval_hardening.sql`; approval tests | Local app and database suites passed 2026-08-21; deployment evidence is not claimed. |
| `SEC-PILOT-CONSENT` | New pilot applications require versioned consent before invitation. | Enforced | `supabase/migrations/20260821235900_pilot_consent_contract.sql`; `supabase/tests/014_pilot_consent_contract.test.sql`; `20_protocols/pilot-consent.md` | Local app and database suites passed 2026-08-21; preview/live evidence is not claimed. |
| `SEC-SECRET-BOUNDARY` | Service credentials and OAuth secrets remain server-only. | Enforced | `AGENTS.md`; `tests/security.test.ts`; `tests/repository-hardening.test.ts` | Local app suite passed 2026-08-21; external provider setup remains a launch gate. |
| `REL-COUNSEL` | Pilot Privacy and Terms have completed legal counsel review. | Planned | `src/lib/legal/pilot-policy.ts` | Launch-blocking; not yet verified. |
| `REL-GOOGLE` | Gmail production verification and security assessment are complete. | Planned | `20_protocols/security-assurance-and-release-evidence.md` | Launch-blocking; not yet verified. |
| `REL-RECOVERY` | Production backup/restore and recovery rehearsal has passed. | Planned | `50_telemetry/release-evidence-register.md` | Launch-blocking; not yet verified. |
| `REL-A11Y` | Public and portal accessibility checks pass at required widths and assistive-technology paths. | Planned | `design.md` acceptance checklist | Launch-blocking; not yet verified. |

Do not describe a planned item as “secure,” “verified,” or “ready” without a
matching evidence entry at the required environment tier.

## Validation

With the local Supabase stack running, `npm run check` lints, type-checks, runs application tests, creates a production build, lints the live local schema, and executes pgTAP tenancy/RPC tests. `npm run check:app` is available when no container runtime is installed, but it is not database readiness evidence. CI starts the isolated stack and runs the full command on every pull request and push to `main`.
