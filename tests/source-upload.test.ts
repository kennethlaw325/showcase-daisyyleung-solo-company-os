// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PPTX_MIME } from "../src/lib/security/source-formats";

const mocks = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("../src/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }),
    },
  }),
}));

import { uploadSourceFiles } from "../src/lib/client/source-upload";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.uploadToSignedUrl.mockReset();
});

describe("source upload reservation recovery", () => {
  it("marks a reserved source failed when the browser upload throws", async () => {
    const sourceId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sourceId,
        path: "workspace/case/slides.pptx",
        token: "signed-upload-token",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ finalized: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.uploadToSignedUrl.mockRejectedValueOnce(new Error("network failure"));

    const file = new File(["pptx-bytes"], "slides.pptx", { type: PPTX_MIME });
    await expect(uploadSourceFiles("case-id", [file], { locale: "en" })).rejects.toThrow("Could not upload slides.pptx.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/cases/case-id/sources/upload-url");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ sourceId }),
    });
  });
});
