import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../src/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { POST } from "../app/api/pilot/application/route";
import { POST as POST_FORM } from "../app/api/pilot-applications/route";

const submissionId = "a1400000-0000-4000-8000-000000000201";

function request(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/pilot/application", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function validPayload() {
  return {
    email: "applicant@example.com",
    name: "Applicant",
    company: "Solo Studio",
    role: "Consultant",
    goals: "A bounded pilot goal",
    locale: "en",
    submissionId,
    consent: true,
    consentVersion: "founding-pilot-2026-08-21-v1",
  };
}

afterEach(() => {
  mocks.rpc.mockReset();
});

describe("pilot application route", () => {
  it("allowlists the consent payload and delegates the write to the twelve-argument RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: "b1400000-0000-4000-8000-000000000201", error: null });

    const response = await POST(request(validPayload()));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(mocks.rpc).toHaveBeenCalledWith("submit_pilot_application", {
      p_email: "applicant@example.com",
      p_name: "Applicant",
      p_company: "Solo Studio",
      p_role: "Consultant",
      p_goals: "A bounded pilot goal",
      p_locale: "en",
      p_website: null,
      p_metadata_hash: null,
      p_submission_id: submissionId,
      p_consent: true,
      p_consent_policy_version: "founding-pilot-2026-08-21-v1",
      p_consent_locale: "en",
    });
  });

  it("rejects missing or unknown consent fields before a database call", async () => {
    const missing = { ...validPayload(), consent: undefined };
    const missingResponse = await POST(request(missing));
    expect(missingResponse.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const unknownResponse = await POST(request({ ...validPayload(), extra: "not allowed" }));
    expect(unknownResponse.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a generic application error when the write kernel rejects the request", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("database detail") });
    const response = await POST(request(validPayload()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it("returns an explicit 429 when the write kernel reports an exhausted rate bucket", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await POST(request(validPayload()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ accepted: false, error: "Application rate limit reached", retryable: true });
  });

  it("transforms only the approved browser form fields before forwarding consent", async () => {
    mocks.rpc.mockResolvedValue({ data: "b1400000-0000-4000-8000-000000000202", error: null });
    const response = await POST_FORM(request({
      name: "Applicant",
      email: "applicant@example.com",
      role: "Consultant",
      pain: "Scattered context",
      desiredOutcome: "A clear result",
      locale: "zh-Hant",
      submissionId: "a1400000-0000-4000-8000-000000000202",
      consent: true,
      consentVersion: "founding-pilot-2026-08-21-v1",
      website: "",
    }));

    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_pilot_application", expect.objectContaining({
      p_email: "applicant@example.com",
      p_name: "Applicant",
      p_role: "Consultant",
      p_goals: "Scattered context\n\nA clear result",
      p_locale: "zh-Hant",
      p_submission_id: "a1400000-0000-4000-8000-000000000202",
      p_consent: true,
      p_consent_policy_version: "founding-pilot-2026-08-21-v1",
      p_consent_locale: "zh-Hant",
    }));

    mocks.rpc.mockReset();
    const unknownResponse = await POST_FORM(request({
      name: "Applicant",
      email: "applicant@example.com",
      role: "Consultant",
      pain: "Scattered context",
      desiredOutcome: "A clear result",
      locale: "zh-Hant",
      submissionId: "a1400000-0000-4000-8000-000000000203",
      consent: true,
      consentVersion: "founding-pilot-2026-08-21-v1",
      unknown: "reject me",
    }));
    expect(unknownResponse.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
