import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { removeCanonicalCaseSourceObjects } from "../app/api/cases/[id]/route";
import { caseDeletionRequestSchema } from "../src/lib/domain/schemas";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("case deletion contract", () => {
  it("requires the exact untrimmed title and a UUID request", () => {
    const input = { confirmationTitle: "  Case title  ", requestId: "80000000-0000-4000-8000-000000000301" };
    expect(caseDeletionRequestSchema.parse(input)).toEqual(input);
    expect(() => caseDeletionRequestSchema.parse({ ...input, confirmationTitle: "" })).toThrow();
    expect(() => caseDeletionRequestSchema.parse({ ...input, requestId: "not-a-uuid" })).toThrow();
  });

  it("keeps the route bounded to the canonical one-level Storage prefix and server RPCs", () => {
    const route = read("app/api/cases/[id]/route.ts");
    expect(route).toContain('admin.rpc("begin_case_deletion"');
    expect(route).toContain('admin.rpc("finalize_case_deletion"');
    expect(route).toContain("source-documents");
    expect(route).toContain("MAX_OBJECTS_PER_LIST = 1_000");
    expect(route).toContain("MAX_STORAGE_PASSES = 3");
    expect(route).not.toContain("gmail");
    expect(route).not.toContain("input.workspaceId");
  });

  it("renders bilingual exact-confirmation and Gmail retention warnings", () => {
    const control = read("src/components/portal/case-delete-control.tsx");
    const copy = read("src/lib/i18n/portal-copy.ts");
    const page = read("app/app/cases/[id]/page.tsx");
    expect(control).toContain("confirmationTitle === title");
    expect(control).toContain("crypto.randomUUID()");
    expect(control).toContain("deletionPending");
    expect(copy).toContain("Existing Gmail drafts will not be deleted. The system keeps only a deletion record without case content.");
    expect(copy).toContain("已建立的 Gmail 草稿不會刪除；系統只會保留不含工作內容的刪除紀錄。");
    expect(copy).not.toContain("may keep a record");
    expect(copy).not.toContain("可能保留刪除紀錄");
    expect(page).toContain("deletion_request_id");
    expect(page).toContain("CaseDeleteControl");
  });

  it("treats an empty prefix as success without remove", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    const remove = vi.fn();
    await removeCanonicalCaseSourceObjects({ from: () => ({ list, remove }) }, "80000000-0000-4000-8000-000000000101", "80000000-0000-4000-8000-000000000201");
    expect(list).toHaveBeenCalledWith("80000000-0000-4000-8000-000000000101/80000000-0000-4000-8000-000000000201", { limit: 1_000, offset: 0 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("rechecks after removal and retries a transient list", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [{ name: "first.txt" }, { name: "nested/ignored.txt" }], error: null })
      .mockResolvedValueOnce({ data: [{ name: "second.txt" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    await removeCanonicalCaseSourceObjects({ from: () => ({ list, remove }) }, "80000000-0000-4000-8000-000000000101", "80000000-0000-4000-8000-000000000201");
    expect(remove).toHaveBeenNthCalledWith(1, ["80000000-0000-4000-8000-000000000101/80000000-0000-4000-8000-000000000201/first.txt"]);
    expect(remove).toHaveBeenNthCalledWith(2, ["80000000-0000-4000-8000-000000000101/80000000-0000-4000-8000-000000000201/second.txt"]);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("returns a bounded error when Storage cannot list or remove", async () => {
    const listError = vi.fn().mockResolvedValue({ data: null, error: new Error("storage down") });
    await expect(removeCanonicalCaseSourceObjects({ from: () => ({ list: listError, remove: vi.fn() }) }, "80000000-0000-4000-8000-000000000101", "80000000-0000-4000-8000-000000000201")).rejects.toMatchObject({ status: 503 });
    const remove = vi.fn().mockResolvedValue({ data: null, error: new Error("remove failed") });
    await expect(removeCanonicalCaseSourceObjects({ from: () => ({ list: vi.fn().mockResolvedValue({ data: [{ name: "one.txt" }], error: null }), remove }) }, "80000000-0000-4000-8000-000000000101", "80000000-0000-4000-8000-000000000201")).rejects.toMatchObject({ status: 503 });
  });
});
