import { describe, expect, it, vi } from "vitest";
import { handleGroqTranscription } from "../app/api/transcription/groq/route";
import { GroqError } from "../src/lib/adapters/groq";
import type { contextOrResponse } from "../src/lib/server/route-utils";

const context = { user: { id: "user-1" }, workspace: { id: "workspace-1" } } as never;
const authenticated = (() => Promise.resolve({ context })) as typeof contextOrResponse;
const unauthorized = (() => Promise.resolve({ response: new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 }) })) as typeof contextOrResponse;

function request(options: { audio?: Blob; contentType?: string; language?: string; contentLength?: string } = {}): Request {
  const form = new FormData();
  if (options.audio !== undefined) form.append("audio", options.audio, "recording.webm");
  if (options.language !== undefined) form.append("language", options.language);
  const headers = new Headers();
  if (options.contentType !== undefined) headers.set("content-type", options.contentType);
  const result = new Request("http://localhost/api/transcription/groq", { method: "POST", body: form, headers });
  if (options.contentLength !== undefined) {
    const cloneHeaders = new Headers(result.headers);
    cloneHeaders.set("content-length", options.contentLength);
    return new Request(result, { headers: cloneHeaders });
  }
  return result;
}

function configuredRuntime() {
  return { apiKey: "server-only-placeholder-key", model: "whisper-large-v3-turbo" as const };
}

describe("Groq transcription route", () => {
  it("returns the existing authentication response without parsing or calling the provider", async () => {
    const transcribe = vi.fn();
    const response = await handleGroqTranscription(request(), { authenticate: unauthorized, transcribe, runtime: configuredRuntime });
    expect(response.status).toBe(401);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("requires bounded multipart audio and rejects unsupported fields before provider work", async () => {
    const transcribe = vi.fn();
    const bad = await handleGroqTranscription(new Request("http://localhost/api/transcription/groq", { method: "POST", body: "not multipart" }), { authenticate: authenticated, transcribe, runtime: configuredRuntime });
    expect(bad.status).toBe(400);

    const oversized = await handleGroqTranscription(request({ audio: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "audio/webm" }) }), { authenticate: authenticated, transcribe, runtime: configuredRuntime });
    expect(oversized.status).toBe(413);

    const unexpected = new FormData();
    unexpected.append("audio", new Blob(["bytes"], { type: "audio/webm" }), "recording.webm");
    unexpected.append("notes", "unexpected");
    const unexpectedResponse = await handleGroqTranscription(new Request("http://localhost/api/transcription/groq", { method: "POST", body: unexpected }), { authenticate: authenticated, transcribe, runtime: configuredRuntime });
    expect(unexpectedResponse.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("validates the route contract and forwards only normalized fields", async () => {
    const transcribe = vi.fn(async () => ({ transcript: "hello", requestId: "request-1" }));
    const success = await handleGroqTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm;codecs=opus" }), language: "en" }), { authenticate: authenticated, transcribe, runtime: configuredRuntime });
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ transcript: "hello", requestId: "request-1" });
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ model: "whisper-large-v3-turbo", language: "en", filename: "recording.webm" }));

    const unsupported = await handleGroqTranscription(request({ audio: new Blob(["bytes"], { type: "audio/aac" }) }), { authenticate: authenticated, transcribe, runtime: configuredRuntime });
    expect(unsupported.status).toBe(400);
    const invalidLanguage = await handleGroqTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm" }), language: "en-US" }), { authenticate: authenticated, transcribe, runtime: configuredRuntime });
    expect(invalidLanguage.status).toBe(400);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Groq is unconfigured", async () => {
    const unavailableRuntime = vi.fn(() => { throw new GroqError("Groq transcription is not configured.", { code: "not_configured", status: 503 }); });
    const response = await handleGroqTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm" }) }), { authenticate: authenticated, transcribe: vi.fn(), runtime: unavailableRuntime });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Groq transcription is not configured.", code: "not_configured", retryable: false });
  });

  it("maps provider rate limits to a safe response with numeric Retry-After", async () => {
    const transcribe = vi.fn(async () => {
      throw new GroqError("Groq is rate limiting transcription requests.", { code: "rate_limited", status: 429, retryable: true, requestId: "req-rate" });
    });
    const response = await handleGroqTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm" }) }), { authenticate: authenticated, transcribe, runtime: configuredRuntime });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await response.json()).toEqual({ error: "Groq is rate limiting transcription requests.", code: "rate_limited", retryable: true, requestId: "req-rate" });
  });
});
