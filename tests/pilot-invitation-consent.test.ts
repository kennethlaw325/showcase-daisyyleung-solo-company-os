import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  inviteUserByEmail: vi.fn(),
  requirePlatformAdminUser: vi.fn(),
}));

vi.mock("../src/lib/supabase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/supabase/auth")>();
  return { ...actual, requirePlatformAdminUser: mocks.requirePlatformAdminUser };
});

vi.mock("../src/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: mocks.from,
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
  }),
}));

import { POST } from "../app/api/admin/invites/route";

const applicationId = "a1400000-0000-4000-8000-000000000301";

function request() {
  return new Request("http://localhost/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "applicant@example.com", applicationId }),
  });
}

function queryResult(data: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

afterEach(() => {
  mocks.from.mockReset();
  mocks.inviteUserByEmail.mockReset();
  mocks.requirePlatformAdminUser.mockReset();
});

describe("pilot invitation consent gate", () => {
  it.each([
    ["legacy", { submission_id: null, consent_policy_version: null, consent_locale: null, consented_at: null }],
    ["inactive version", { submission_id: "a1400000-0000-4000-8000-000000000302", consent_policy_version: "old", consent_locale: "en", consented_at: "2026-08-21T00:00:00.000Z" }],
    ["locale mismatch", { submission_id: "a1400000-0000-4000-8000-000000000303", consent_policy_version: "founding-pilot-2026-08-21-v1", consent_locale: "zh-Hant", consented_at: "2026-08-21T00:00:00.000Z" }],
  ])("rejects %s consent before workspace or Auth side effects", async (_label, consent) => {
    mocks.requirePlatformAdminUser.mockResolvedValue({ id: "a1400000-0000-4000-8000-000000000399" });
    const applicationQuery = queryResult({
      id: applicationId,
      email: "applicant@example.com",
      status: "new",
      locale: "en",
      ...consent,
    });
    mocks.from.mockReturnValue(applicationQuery);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Pilot application consent is missing or inactive" });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
  });
});
