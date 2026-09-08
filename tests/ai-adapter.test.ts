import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { classifyAiError, estimateAiCostUsd, generateStructured, getAiErrorDiagnostics, getAiRuntime, getConfiguredAiProvider } from "../src/lib/adapters/ai";

const openAiState = vi.hoisted(() => ({
  create: vi.fn(),
  options: [] as unknown[],
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: openAiState.create };

    constructor(options: unknown) {
      openAiState.options.push(options);
    }
  },
}));

const originalProvider = process.env.AI_PROVIDER;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalFastModel = process.env.GEMINI_FAST_MODEL;
const originalReasoningModel = process.env.GEMINI_REASONING_MODEL;

afterEach(() => {
  vi.unstubAllGlobals();
  openAiState.create.mockReset();
  openAiState.options.length = 0;
  if (originalProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalProvider;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalFastModel === undefined) delete process.env.GEMINI_FAST_MODEL;
  else process.env.GEMINI_FAST_MODEL = originalFastModel;
  if (originalReasoningModel === undefined) delete process.env.GEMINI_REASONING_MODEL;
  else process.env.GEMINI_REASONING_MODEL = originalReasoningModel;
});

describe("AI provider adapter", () => {
  it("requires an explicit supported AI provider and fails closed for unset or unknown values", () => {
    delete process.env.AI_PROVIDER;
    expect(() => getConfiguredAiProvider()).toThrow();
    expect(() => getConfiguredAiProvider()).toThrow(/not configured/i);

    process.env.AI_PROVIDER = "   ";
    expect(() => getConfiguredAiProvider()).toThrow(/not configured/i);
    process.env.AI_PROVIDER = "typo-provider";
    expect(() => getConfiguredAiProvider()).toThrow(/invalid|not configured/i);
    process.env.AI_PROVIDER = "openai";
    expect(getConfiguredAiProvider()).toBe("openai");
  });

  it("routes Gemini fast and reasoning models explicitly", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_FAST_MODEL = "gemini-fast-test";
    process.env.GEMINI_REASONING_MODEL = "gemini-reasoning-test";
    expect(getAiRuntime("fast")).toEqual({ provider: "gemini", model: "gemini-fast-test" });
    expect(getAiRuntime("reasoning")).toEqual({ provider: "gemini", model: "gemini-reasoning-test" });
  });

  it("sends stateless schema-constrained Gemini requests and maps usage", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const requestBodies: Array<Record<string, unknown>> = [];
    const requestUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requestUrls.push(url);
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        id: "interaction-test",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: '{"ok":true}' }] }],
        usage: { total_input_tokens: 8, total_output_tokens: 3, total_tokens: 11 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const generated = await generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Return ok",
      schemaName: "ok_response",
      schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] },
      validator: z.object({ ok: z.boolean() }),
    });

    expect(generated.value).toEqual({ ok: true });
    expect(generated.usage).toEqual({ inputTokens: 8, outputTokens: 3, totalTokens: 11 });
    expect(requestBodies).toHaveLength(1);
    expect(requestUrls).toEqual(["https://generativelanguage.googleapis.com/v1/interactions"]);
    expect(requestBodies[0]).toMatchObject({
      model: "gemini-3.6-flash",
      store: false,
      background: false,
      response_format: [{ type: "text", mime_type: "application/json" }],
    });
    expect(requestBodies[0]).toMatchObject({ response_format: [{ type: "text", mime_type: "application/json", schema: expect.any(Object) }] });
  });

  it("keeps non-completed Gemini interactions bounded and does not leak provider content", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const providerPrivateText = "PRIVATE_PROVIDER_MESSAGE_SHOULD_NOT_ESCAPE";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "interaction-failed",
      status: "failed",
      error: { message: providerPrivateText, details: [{ content: providerPrivateText }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Private fixture that must not appear in the thrown error",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
    });

    await expect(result).rejects.toThrow("Gemini interaction did not complete");
    await expect(result).rejects.not.toThrow(providerPrivateText);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await result.catch((error) => expect(classifyAiError(error)).toBe("provider_request"));
  });

  it("retries once when completed model output is invalid JSON", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "interaction-invalid-json",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: "{invalid" }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "interaction-valid-json",
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: '{"ok":true}' }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const generated = await generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Return ok",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
    });

    expect(generated.value).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns only a bounded Gemini error classification", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "parameter_unknown",
        message: "Unknown parameter at response_format; private input is intentionally omitted.",
      },
    }), { status: 400, headers: { "Content-Type": "application/json" } })));

    await expect(generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Private fixture that must not appear in the thrown error",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
    })).rejects.toThrow("Gemini request failed (400: parameter_unknown:response_format)");
  });

  it("exposes only validated provider diagnostics", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "parameter_unknown", message: "Unknown parameter at response_format; private body omitted." },
    }), { status: 400, headers: { "Content-Type": "application/json" } })));

    let thrown: unknown;
    try {
      await generateStructured({
        provider: "gemini",
        model: "gemini-3.6-flash",
        input: "Private fixture",
        schemaName: "ok_response",
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
        validator: z.object({ ok: z.boolean() }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(getAiErrorDiagnostics(thrown)).toEqual({ providerStatus: 400, providerLabel: "parameter_unknown:response_format" });
    expect(getAiErrorDiagnostics({ providerStatus: 600, providerLabel: "parameter_unknown:response_format,PRIVATE_PROVIDER_MESSAGE" })).toEqual({});
    expect(getAiErrorDiagnostics({ providerStatus: 500, providerLabel: "provider-private body" })).toEqual({ providerStatus: 500 });
  });

  it("classifies plain-text Gemini errors without returning the provider body", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Invalid JSON payload received. Unknown name 'generation_config' at 'request'. Private fixture omitted.", { status: 400 })));

    await expect(generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Private fixture",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
    })).rejects.toThrow("Gemini request failed (400: parameter_unknown:generation_config)");
  });

  it("keeps a failed call counted while clearing its estimated provider cost", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "42", error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "authentication", message: "API key is invalid" } }), { status: 400 })));

    await expect(generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Anonymous fixture",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      quotaClient: { rpc } as never,
    })).rejects.toThrow("Gemini request failed (400: authentication)");

    expect(rpc).toHaveBeenNthCalledWith(1, "reserve_workspace_ai_quota", expect.objectContaining({
      p_workspace_id: "11111111-1111-4111-8111-111111111111",
      p_actor_id: "22222222-2222-4222-8222-222222222222",
      p_provider: "gemini",
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_workspace_usage", {
      p_usage_event_id: "42",
      p_actor_id: "22222222-2222-4222-8222-222222222222",
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_total_tokens: 0,
      p_actual_cost_usd: 0,
    });
  });

  it("logs a bounded refund failure when usage completion returns false", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "reservation-false", error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "authentication", message: "API key is invalid" } }), { status: 400 })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Anonymous fixture",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      quotaClient: { rpc } as never,
    })).rejects.toThrow("Gemini request failed (400: authentication)");

    expect(errorSpy).toHaveBeenCalledWith("AI quota refund failed", { component: "ai-adapter", reservationId: "reservation-false" });
    errorSpy.mockRestore();
  });

  it("keeps the provider error when usage completion returns an error", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "reservation-error", error: null })
      .mockResolvedValueOnce({ data: true, error: { message: "private refund result detail" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "authentication", message: "API key is invalid" } }), { status: 400 })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Anonymous fixture",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      quotaClient: { rpc } as never,
    })).rejects.toThrow("Gemini request failed (400: authentication)");

    expect(errorSpy).toHaveBeenCalledWith("AI quota refund failed", { component: "ai-adapter", reservationId: "reservation-error" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private refund result detail");
    errorSpy.mockRestore();
  });

  it("retries one OpenAI 5xx rejection and returns bounded diagnostics", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key-not-a-secret";
    const privateBody = "PRIVATE_OPENAI_PROVIDER_BODY";
    openAiState.create.mockRejectedValue(Object.assign(new Error(privateBody), { status: 500, error: { message: privateBody } }));

    let thrown: unknown;
    try {
      await generateStructured({
        provider: "openai",
        model: "gpt-5.6-luna",
        input: "Private fixture",
        schemaName: "ok_response",
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
        validator: z.object({ ok: z.boolean() }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(openAiState.create).toHaveBeenCalledTimes(2);
    expect(openAiState.options).toEqual([expect.objectContaining({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 })]);
    expect(thrown).toMatchObject({ aiError: true, aiErrorCode: "provider_request", providerStatus: 500, providerLabel: "request_failed" });
    expect(getAiErrorDiagnostics(thrown)).toEqual({ providerStatus: 500, providerLabel: "request_failed" });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(privateBody);
  });

  it("turns a second OpenAI attempt after a 5xx into a successful bounded result", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key-not-a-secret";
    openAiState.create
      .mockRejectedValueOnce(Object.assign(new Error("private first failure"), { status: 503 }))
      .mockResolvedValueOnce({ output_text: '{"ok":true}', id: "openai-success", usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } });

    const generated = await generateStructured({
      provider: "openai",
      model: "gpt-5.6-luna",
      input: "Return ok",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
    });

    expect(generated.value).toEqual({ ok: true });
    expect(generated.usage).toEqual({ inputTokens: 4, outputTokens: 2, totalTokens: 6 });
    expect(openAiState.create).toHaveBeenCalledTimes(2);
  });

  it("fails fast on a private-body OpenAI 400 with bounded diagnostics", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key-not-a-secret";
    const privateBody = "PRIVATE_OPENAI_400_BODY";
    openAiState.create.mockRejectedValue(Object.assign(new Error(privateBody), { status: 400, error: { message: privateBody } }));

    let thrown: unknown;
    try {
      await generateStructured({
        provider: "openai",
        model: "gpt-5.6-luna",
        input: "Private fixture",
        schemaName: "ok_response",
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
        validator: z.object({ ok: z.boolean() }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(openAiState.create).toHaveBeenCalledTimes(1);
    expect(thrown).toMatchObject({ aiError: true, aiErrorCode: "provider_request", providerStatus: 400, providerLabel: "invalid_request" });
    expect(getAiErrorDiagnostics(thrown)).toEqual({ providerStatus: 400, providerLabel: "invalid_request" });
    expect((thrown as Error).message).toBe("OpenAI request failed (400: invalid_request)");
    expect((thrown as Error).message).not.toContain(privateBody);
  });

  it("keeps the provider error when usage completion throws", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "reservation-throws", error: null })
      .mockRejectedValueOnce(new Error("private refund detail"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "authentication", message: "API key is invalid" } }), { status: 400 })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Anonymous fixture",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      quotaClient: { rpc } as never,
    })).rejects.toThrow("Gemini request failed (400: authentication)");

    expect(errorSpy).toHaveBeenCalledWith("AI quota refund failed", { component: "ai-adapter", reservationId: "reservation-throws" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private refund detail");
    errorSpy.mockRestore();
  });

  it("completes successful reserved usage with provider counts and estimated cost", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "reservation-success", error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "interaction-success",
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: '{"ok":true}' }] }],
      usage: { total_input_tokens: 12, total_output_tokens: 5, total_tokens: 17 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const generated = await generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Return ok",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      quotaClient: { rpc } as never,
    });

    expect(generated.value).toEqual({ ok: true });
    expect(rpc).toHaveBeenNthCalledWith(2, "complete_workspace_usage", {
      p_usage_event_id: "reservation-success",
      p_actor_id: "22222222-2222-4222-8222-222222222222",
      p_input_tokens: 12,
      p_output_tokens: 5,
      p_total_tokens: 17,
      p_actual_cost_usd: estimateAiCostUsd("gemini", "gemini-3.6-flash", 12, 5),
    });
  });

  it("keeps a valid generated result when successful usage completion fails", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-not-a-secret";
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "reservation-completion-failed", error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "interaction-success",
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: '{"ok":true}' }] }],
      usage: { total_input_tokens: 3, total_output_tokens: 2, total_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const generated = await generateStructured({
      provider: "gemini",
      model: "gemini-3.6-flash",
      input: "Return ok",
      schemaName: "ok_response",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      validator: z.object({ ok: z.boolean() }),
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      quotaClient: { rpc } as never,
    });

    expect(generated.value).toEqual({ ok: true });
    expect(errorSpy).toHaveBeenCalledWith("AI usage completion failed", { component: "ai-adapter", reservationId: "reservation-completion-failed" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private");
    errorSpy.mockRestore();
  });
});
