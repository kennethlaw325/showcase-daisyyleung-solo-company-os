---
title: Typeless transcription integration contract
status: superseded
owner: Demo User
updated: 2026-08-27
source_of_truth: false
supersedes: []
tags: [solo-company-os, typeless, transcription, privacy, integration]
---

# Typeless transcription integration

> Superseded on 2026-08-27 by
> [`groq-transcription-integration.md`](groq-transcription-integration.md).
> The historical public endpoint now returns `410 Gone` and cannot call
> Typeless.

## Scope and authority

This protocol governs the optional voice-input path in Solo Company OS. It is
an ephemeral, user-initiated transcription request for the authenticated
portal. Manual typing and pasting remain the primary recovery path. The
transcription route writes no audio or transcript to Supabase, Storage, logs,
analytics, browser storage, or a local project file. After a transcript is
returned to the editable intake field, a later explicit case submission or
guided-import confirmation stores that text under the same lifecycle as text
the user typed; the recording itself is never stored by Solo Company OS.

The current provider contract was checked against the official Typeless API
documentation on 2026-08-27:

- [Typeless API documentation](https://docs.typelessapi.com/) — Transcript API
  base `https://api.typelessapi.com/v1`, `POST /transcribe`, and provider
  request/response and error contract.

The provider contract is a T0 static source claim only. Account permissions,
billing, retention/DPA terms, and live behavior remain an explicit launch gate.

## Selected surface and request contract

The integration uses one server-side REST request. GraphQL, a provider SDK,
and webhooks are rejected because they would add surface area without helping a
single synchronous upload/transcript operation.

- Provider URL is fixed to `https://api.typelessapi.com/v1/transcribe`.
- The route sends `multipart/form-data` with `audio`, required allowlisted
  `model`, and optional ISO-639-1 `language` (`en` or `zh`).
- Authentication is the server-only `Authorization: Token <TYPELESS_API_KEY>`
  header. `TYPELESS_API_KEY` never appears in client code, responses, logs, or
  fixtures.
- Models are allowlisted to `typeless-1.0-lite`, `typeless-1.0-pro`, and
  `typeless-1.0-max`; the default is `typeless-1.0-pro`.
- Accepted audio base MIME types are `audio/webm`, `audio/ogg`, and
  `audio/wav`; codec parameters are normalized before validation.
- The application and client cap a recording at 10 MiB. The browser timer caps
  capture at 120 seconds. The provider request has a finite timeout and never
  retries an audio POST because billing/outcome can be ambiguous.
- A success must validate `status: "success"`, transcript, nullable detected
  language, duration, usage, and request ID before the transcript reaches the
  controlled text value.

## Trust, privacy, and failure boundaries

The route authenticates through `contextOrResponse()` and derives no tenant
identifier from the request body. It validates content type, Content-Length,
actual `File.size`, nonempty bytes, MIME, language, and server model before the
provider call. The server forwards only the recording and contract fields.

Provider bodies are never forwarded. Responses expose only a bounded error
code/message, retryability, safe request ID metadata, and (for 429) a numeric
`Retry-After` value (provider value clamped to a finite range, or a bounded
default). Provider 402, 429, and 503 outcomes have actionable UI recovery;
timeouts, transport failures, aborts, malformed responses, permission denial,
and unsupported capture all preserve manual entry.

The UI states that Typeless cloud processing occurs after Stop and that Solo
Company OS does not store the recording. It does not claim Typeless zero data
retention, a DPA, or free API access. Users may type/paste or use the installed
Typeless desktop app in the focused text area whenever the service is absent.

## Evidence and release gate

Local adapter, route, and component tests are T1 evidence for deterministic
schema/error handling and browser cleanup only. They do not prove provider
account permissions, billing, retention, quotas, or production transport.
Before live tenant data is enabled, obtain a separate approval covering the
Typeless account/environment, billing, privacy/retention terms, and a bounded
canary. Record the exact provider request metadata and observed response
without recording audio or transcript content. Stop on provider schema drift,
unexpected status, identity mismatch, timeout budget breach, or any logging
that includes content or credentials.
