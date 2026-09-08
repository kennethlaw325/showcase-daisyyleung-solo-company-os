---
title: Groq transcription integration contract
status: active
owner: Demo User
updated: 2026-08-27
source_of_truth: true
supersedes: [typeless-transcription-integration.md]
tags: [solo-company-os, groq, transcription, privacy, integration]
---

# Groq transcription integration

## Scope and authority

This protocol governs the optional, user-initiated voice-input path in the
authenticated portal. The browser records locally and uploads only after the
user selects Stop. Solo Company OS does not write the audio or provider
response to Supabase, Storage, logs, analytics, browser storage, or project
files. A returned transcript remains editable and is persisted only if the
user later submits or confirms the case, under the same lifecycle as typed
text. Manual typing and pasting remain the recovery path.

The provider contract was checked against official Groq documentation on
2026-08-27:

- [Speech to Text](https://console.groq.com/docs/speech-to-text) for endpoint,
  models, multipart fields, file limits, formats, and pricing.
- [Rate Limits](https://console.groq.com/docs/rate-limits) for free-plan audio
  limits and `Retry-After` behavior.
- [API Error Codes](https://console.groq.com/docs/errors) for bounded status
  handling and provider error shape.
- [Your Data in GroqCloud](https://console.groq.com/docs/your-data) for default
  inference handling, exceptional reliability/abuse retention, data location,
  and optional Zero Data Retention controls.

These are T0 source claims. Local tests are T1 evidence for our adapter and
route only. They do not prove account permissions, production quotas, network
transport, or account-level Data Controls.

## Selected request contract

- Fixed provider URL:
  `https://api.groq.com/openai/v1/audio/transcriptions`.
- Server-only authentication: `Authorization: Bearer <GROQ_API_KEY>`.
- `multipart/form-data` fields: `file`, required allowlisted `model`, optional
  ISO-639-1 `language`, `response_format=json`, and `temperature=0`.
- Default model: `whisper-large-v3-turbo`; `whisper-large-v3` is also
  allowlisted for an explicit accuracy-first configuration.
- Browser capture accepts `audio/webm`, `audio/ogg`, and `audio/wav`, including
  normalized codec parameters. The app caps recordings at 10 MiB and 120
  seconds, below Groq's documented free-tier 25 MB upload limit.
- A success must contain a non-empty `text` value. Only the transcript and a
  bounded request ID, when present, cross the adapter boundary.
- Audio POSTs are never retried automatically because the provider may have
  processed a request even when its response is lost. Users receive an
  actionable retry/manual-entry state instead.

## Error, privacy, and quota boundaries

The authenticated route derives workspace identity from the verified server
session and accepts no workspace identifier from the browser. It validates the
multipart boundary, bounded stream size, actual file size, exact field set,
MIME type, language, and server model before the provider call.

Provider response bodies and credentials are never returned or logged. Safe
responses expose a bounded code/message, retryability, optional request ID,
and a numeric, clamped `Retry-After` for rate limits. Authentication,
permission, payload, rate-limit, capacity, server, transport, timeout, abort,
and malformed-response failures preserve the manual-entry path.

Groq states that inference customer data is not retained by default, but it
may temporarily log inputs and outputs for reliability or abuse investigation
for up to 30 days unless account Data Controls opt out. The transcription
endpoint is eligible for Zero Data Retention. This project does not claim ZDR
is enabled, and the UI therefore says only that Groq processes the recording
under its Data Controls and Solo Company OS does not persist it.

Groq currently documents free-plan base limits for both Whisper models of 20
requests/minute, 2,000 requests/day, 7,200 audio seconds/hour, and 28,800 audio
seconds/day. These are provider-controlled quotas, not a permanent free-service
promise. The selected Turbo model is documented at US$0.04/audio hour after
moving to paid usage.

## Release gate

Before claiming production voice transcription works, verify that the intended
Vercel environment has a server-only `GROQ_API_KEY`, the selected model is
enabled for that Groq project, and account Data Controls are accepted for the
pilot. Run one consented, non-sensitive bounded canary and record only status,
timing, request ID, model, and byte count. Stop on schema drift, unexpected
retention settings, credential exposure, content logging, quota mismatch, or
target-environment transport failure.
