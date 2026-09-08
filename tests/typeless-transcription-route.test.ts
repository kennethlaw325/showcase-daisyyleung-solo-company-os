import { describe, expect, it, vi } from "vitest";
import { handleTypelessTranscription, POST } from "../app/api/transcription/typeless/route";
import { TypelessError } from "../src/lib/adapters/typeless";
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
  const result = new Request("http://localhost/api/transcription/typeless", { method: "POST", body: form, headers });
  if (options.contentLength !== undefined) {
    const cloneHeaders = new Headers(result.headers);
    cloneHeaders.set("content-length", options.contentLength);
    return new Request(result, { headers: cloneHeaders });
  }
  return result;
}

function runtime() {
  return { apiKey: "server-only-placeholder-key", model: "typeless-1.0-pro" as const };
}

describe("Typeless transcription route", () => {
  it("retires the public endpoint without calling the legacy provider", async () => {
    const response = await POST(request({ audio: new Blob(["bytes"], { type: "audio/webm" }) }));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: "The Typeless transcription endpoint has been retired. Use the Groq transcription endpoint.",
      code: "provider_retired",
      retryable: false,
    });
  });

  it("returns the existing authentication response without parsing or calling the provider", async () => {
    const transcribe = vi.fn();
    const response = await handleTypelessTranscription(request(), { authenticate: unauthorized, transcribe, runtime });
    expect(response.status).toBe(401);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("requires multipart audio and rejects oversized requests before provider work", async () => {
    const transcribe = vi.fn();
    const bad = await handleTypelessTranscription(new Request("http://localhost/api/transcription/typeless", { method: "POST", body: "not multipart" }), { authenticate: authenticated, transcribe, runtime });
    expect(bad.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();

    const oversized = await handleTypelessTranscription(request({ audio: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "audio/webm" }) }), { authenticate: authenticated, transcribe, runtime });
    expect(oversized.status).toBe(413);

    const chunkedOversized = await handleTypelessTranscription(new Request("http://localhost/api/transcription/typeless", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=bounded-test" },
      body: new Uint8Array(10 * 1024 * 1024 + 200_001),
    }), { authenticate: authenticated, transcribe, runtime });
    expect(chunkedOversized.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects duplicate or unexpected multipart fields", async () => {
    const transcribe = vi.fn();
    const form = new FormData();
    form.append("audio", new Blob(["bytes"], { type: "audio/webm" }), "recording.webm");
    form.append("notes", "unexpected");
    const response = await handleTypelessTranscription(new Request("http://localhost/api/transcription/typeless", { method: "POST", body: form }), { authenticate: authenticated, transcribe, runtime });
    expect(response.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects empty or unsupported files, allows multipart overhead, and never trusts Content-Length over File.size", async () => {
    const transcribe = vi.fn(async () => ({
      transcript: "hello",
      detectedLanguage: "en",
      durationSeconds: 1,
      usage: { billedAudioSeconds: 1, outputTokenCount: 1 },
      requestId: "request-1",
    }));
    const empty = await handleTypelessTranscription(request({ audio: new Blob([], { type: "audio/webm" }) }), { authenticate: authenticated, transcribe, runtime });
    expect(empty.status).toBe(400);
    const unsupported = await handleTypelessTranscription(request({ audio: new Blob(["bytes"], { type: "audio/mp4" }) }), { authenticate: authenticated, transcribe, runtime });
    expect(unsupported.status).toBe(400);
    const forged = await handleTypelessTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm" }), contentLength: "1" }), { authenticate: authenticated, transcribe, runtime });
    expect(forged.status).toBe(200);
    const withMultipartOverhead = await handleTypelessTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm" }), contentLength: String(10 * 1024 * 1024 + 1_000) }), { authenticate: authenticated, transcribe, runtime });
    expect(withMultipartOverhead.status).toBe(200);
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Typeless is unconfigured and forwards only the validated contract fields", async () => {
    const transcribe = vi.fn(async () => ({
      transcript: "hello",
      detectedLanguage: "en",
      durationSeconds: 1,
      usage: { billedAudioSeconds: 1, outputTokenCount: 2 },
      requestId: "request-1",
    }));
    const success = await handleTypelessTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm;codecs=opus" }), language: "en" }), { authenticate: authenticated, transcribe, runtime });
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({ transcript: "hello", requestId: "request-1" });
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ model: "typeless-1.0-pro", language: "en" }));

    const unavailableRuntime = vi.fn(() => { throw new TypelessError("Typeless transcription is not configured.", { code: "not_configured", status: 503 }); });
    const unavailable = await handleTypelessTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm" }) }), { authenticate: authenticated, transcribe, runtime: unavailableRuntime });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "Typeless transcription is not configured.", code: "not_configured", retryable: false });
  });

  it("maps provider rate limits to a safe response with a numeric Retry-After", async () => {
    const transcribe = vi.fn(async () => {
      throw new TypelessError("Typeless is rate limiting transcription requests.", { code: "rate_limited", status: 429, retryable: true, requestId: "req-rate", retryAfter: undefined });
    });
    const response = await handleTypelessTranscription(request({ audio: new Blob(["bytes"], { type: "audio/webm" }) }), { authenticate: authenticated, transcribe, runtime });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await response.json()).toEqual({ error: "Typeless is rate limiting transcription requests.", code: "rate_limited", retryable: true, requestId: "req-rate" });
  });
});
