import { afterEach, describe, expect, it, vi } from "vitest";
import {
  transcribeTypeless,
  TYPELESS_PROVIDER_URL,
  TypelessError,
} from "../src/lib/adapters/typeless";

const originalApiKey = process.env.TYPELESS_API_KEY;
const originalModel = process.env.TYPELESS_TRANSCRIPT_MODEL;

function audioFixture(type = "audio/webm;codecs=opus"): Blob {
  return new Blob(["audio fixture"], { type });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalApiKey === undefined) delete process.env.TYPELESS_API_KEY;
  else process.env.TYPELESS_API_KEY = originalApiKey;
  if (originalModel === undefined) delete process.env.TYPELESS_TRANSCRIPT_MODEL;
  else process.env.TYPELESS_TRANSCRIPT_MODEL = originalModel;
  vi.useRealTimers();
});

describe("Typeless adapter", () => {
  it("sends one bounded multipart request and validates/maps a successful response", async () => {
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    process.env.TYPELESS_TRANSCRIPT_MODEL = "typeless-1.0-pro";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("typeless-1.0-pro");
      expect(form.get("language")).toBe("en");
      expect(form.get("audio")).toBeInstanceOf(Blob);
      expect(init?.headers).toEqual({ Authorization: "Token test-key-not-a-secret" });
      return new Response(JSON.stringify({
        status: "success",
        result: { transcript: "Hello from Typeless", detected_language: null, duration_seconds: 2.5 },
        usage: { billed_audio_seconds: 3, output_token_count: 4 },
        request_id: "req-success-1",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(transcribeTypeless(audioFixture(), { language: "en", fetchImpl: fetchMock })).resolves.toEqual({
      transcript: "Hello from Typeless",
      detectedLanguage: null,
      durationSeconds: 2.5,
      usage: { billedAudioSeconds: 3, outputTokenCount: 4 },
      requestId: "req-success-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(TYPELESS_PROVIDER_URL);
  });

  it("fails closed for malformed success responses without forwarding provider content", async () => {
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    const privateText = "PRIVATE_PROVIDER_BODY";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: "success",
      result: { transcript: privateText },
      request_id: "req-malformed",
    }), { status: 200 }));

    await expect(transcribeTypeless(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
    });
    await expect(transcribeTypeless(audioFixture(), { fetchImpl: fetchMock })).rejects.not.toThrow(privateText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps provider rate limits to a safe error with bounded retry metadata and request ID", async () => {
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "private provider details", request_id: "body-id" },
    }), { status: 429, headers: { "retry-after": "99999", "x-request-id": "header-id" } }));

    let thrown: unknown;
    try {
      await transcribeTypeless(audioFixture(), { fetchImpl: fetchMock });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypelessError);
    expect(thrown).toMatchObject({ code: "rate_limited", status: 429, retryable: true, requestId: "header-id", retryAfter: 3600 });
    expect(String((thrown as Error).message)).not.toContain("private provider details");
  });

  it("uses a numeric default Retry-After when the provider omits it", async () => {
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
    await expect(transcribeTypeless(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "rate_limited", retryAfter: 60 });
  });

  it("maps billing and unavailable responses without retrying the audio POST", async () => {
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("private", { status: 402 }))
      .mockResolvedValueOnce(new Response("private", { status: 503 }));

    await expect(transcribeTypeless(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "payment_required", status: 402, retryable: false });
    await expect(transcribeTypeless(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "provider_unavailable", status: 503, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps transport and timeout failures distinctly", async () => {
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    const transport = vi.fn(async () => { throw new Error("network down"); });
    await expect(transcribeTypeless(audioFixture(), { fetchImpl: transport })).rejects.toMatchObject({ code: "transport", status: 502 });

    vi.useFakeTimers();
    const timeoutFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }));
    const pending = transcribeTypeless(audioFixture(), { fetchImpl: timeoutFetch, timeoutMs: 10 });
    const timeoutAssertion = expect(pending).rejects.toMatchObject({ code: "timeout", status: 504 });
    await vi.advanceTimersByTimeAsync(10);
    await timeoutAssertion;
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
  });

  it("fails before fetch when the service is unconfigured or the model is not allowlisted", async () => {
    delete process.env.TYPELESS_API_KEY;
    const fetchMock = vi.fn();
    await expect(transcribeTypeless(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    process.env.TYPELESS_TRANSCRIPT_MODEL = "provider-private-model";
    await expect(transcribeTypeless(audioFixture(), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty, unsupported, oversized, and invalid language inputs locally", async () => {
    process.env.TYPELESS_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn();
    await expect(transcribeTypeless(new Blob([], { type: "audio/webm" }), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(transcribeTypeless(audioFixture("audio/mp4"), { fetchImpl: fetchMock })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(transcribeTypeless(audioFixture(), { language: "en-US", fetchImpl: fetchMock })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
