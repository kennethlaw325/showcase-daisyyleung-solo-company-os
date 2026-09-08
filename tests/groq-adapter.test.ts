import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GROQ_PROVIDER_URL,
  GroqError,
  transcribeGroq,
} from "../src/lib/adapters/groq";

const originalApiKey = process.env.GROQ_API_KEY;
const originalModel = process.env.GROQ_TRANSCRIPTION_MODEL;

function audioFixture(type = "audio/webm"): Blob {
  return new Blob(["audio fixture"], { type });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.GROQ_TRANSCRIPTION_MODEL;
  else process.env.GROQ_TRANSCRIPTION_MODEL = originalModel;
});

describe("Groq transcription adapter", () => {
  it("sends the fixed OpenAI-compatible multipart contract and validates the result", async () => {
    process.env.GROQ_API_KEY = "test-key-not-a-secret";
    process.env.GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("file")).toBeInstanceOf(Blob);
      expect(form.get("model")).toBe("whisper-large-v3-turbo");
      expect(form.get("response_format")).toBe("json");
      expect(form.get("language")).toBe("en");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key-not-a-secret");
      expect(new Headers(init?.headers).has("content-type")).toBe(false);
      return new Response(JSON.stringify({ text: "Hello from Groq" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-success-1" },
      });
    });

    await expect(transcribeGroq(audioFixture(), { language: "en", fetchImpl: fetchMock })).resolves.toEqual({
      transcript: "Hello from Groq",
      requestId: "req-success-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(GROQ_PROVIDER_URL);
  });

  it("fails closed for malformed success responses without forwarding provider content", async () => {
    process.env.GROQ_API_KEY = "test-key-not-a-secret";
    const privateText = "PRIVATE_PROVIDER_BODY";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: privateText }), { status: 200 }));

    await expect(transcribeGroq(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
    await expect(transcribeGroq(audioFixture(), { fetchImpl: fetchMock })).rejects.not.toThrow(privateText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps provider rate limits to a safe error with bounded Retry-After metadata", async () => {
    process.env.GROQ_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "private provider details", type: "rate_limit_error" },
    }), { status: 429, headers: { "retry-after": "99999", "x-request-id": "header-id" } }));

    let thrown: unknown;
    try {
      await transcribeGroq(audioFixture(), { fetchImpl: fetchMock });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GroqError);
    expect(thrown).toMatchObject({ code: "rate_limited", status: 429, retryable: true, requestId: "header-id", retryAfter: 3_600 });
    expect(String((thrown as Error).message)).not.toContain("private provider details");
  });

  it("maps provider failures without retrying an ambiguous audio POST", async () => {
    process.env.GROQ_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("private", { status: 401 }))
      .mockResolvedValueOnce(new Response("private", { status: 413 }))
      .mockResolvedValueOnce(new Response("private", { status: 503 }));

    await expect(transcribeGroq(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "unauthorized", status: 503, retryable: false });
    await expect(transcribeGroq(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "payload_too_large", status: 413, retryable: false });
    await expect(transcribeGroq(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "provider_unavailable", status: 503, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("distinguishes provider credential rejection without exposing provider details or credentials", async () => {
    const configuredCredential = "server-key-fixture";
    const providerBody = "PRIVATE_PROVIDER_BODY";
    process.env.GROQ_API_KEY = configuredCredential;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: providerBody, type: "authentication_error" },
    }), { status: 401 }));

    let thrown: unknown;
    try {
      await transcribeGroq(audioFixture(), { fetchImpl: fetchMock });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GroqError);
    expect(thrown).toMatchObject({ code: "unauthorized", status: 503, providerStatus: 401, retryable: false });
    const message = String((thrown as Error).message);
    expect(message).toBe("Groq rejected the configured server credentials.");
    expect(message).not.toContain(providerBody);
    expect(message).not.toContain(configuredCredential);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps transport and timeout failures distinctly", async () => {
    process.env.GROQ_API_KEY = "test-key-not-a-secret";
    const transport = vi.fn(async () => { throw new Error("network down"); });
    await expect(transcribeGroq(audioFixture(), { fetchImpl: transport })).rejects.toMatchObject({ code: "transport", status: 502 });

    vi.useFakeTimers();
    const timeoutFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }));
    const pending = transcribeGroq(audioFixture(), { fetchImpl: timeoutFetch, timeoutMs: 10 });
    const timeoutAssertion = expect(pending).rejects.toMatchObject({ code: "timeout", status: 504 });
    await vi.advanceTimersByTimeAsync(10);
    await timeoutAssertion;
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
  });

  it("fails before fetch when the service is unconfigured or the model is not allowlisted", async () => {
    delete process.env.GROQ_API_KEY;
    const fetchMock = vi.fn();
    await expect(transcribeGroq(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    process.env.GROQ_API_KEY = "test-key-not-a-secret";
    process.env.GROQ_TRANSCRIPTION_MODEL = "provider-private-model";
    await expect(transcribeGroq(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty, unsupported, oversized, and invalid language inputs locally", async () => {
    process.env.GROQ_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn();
    await expect(transcribeGroq(new Blob([], { type: "audio/webm" }), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(transcribeGroq(audioFixture("audio/aac"), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(transcribeGroq(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "audio/webm" }), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
    await expect(transcribeGroq(audioFixture(), { language: "en-US", fetchImpl: fetchMock })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
