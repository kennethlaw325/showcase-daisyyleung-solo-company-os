import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("learning signal deletion contract", () => {
  it("keeps deletion tenant-safe, idempotent, and content-free in the database", () => {
    const migration = read("supabase/migrations/202608200001_learning_signal_deletion.sql");
    expect(migration).toContain("deleted_at timestamptz");
    expect(migration).toContain("deleted_by uuid");
    expect(migration).toContain("learning_records_deletion_fields_consistent");
    expect(migration).toContain("where deleted_at is null");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("for update");
    expect(migration).toContain("actor_role not in ('owner', 'admin')");
    expect(migration).toContain("'learning.deleted'");
    expect(migration).toContain("'{}')");
    expect(migration).toContain("revoke all on function public.delete_learning_signal(uuid) from public, anon, service_role");
    expect(migration).toContain("grant execute on function public.delete_learning_signal(uuid) to authenticated");
  });

  it("routes deletion through the authenticated RPC without accepting tenant or actor input", () => {
    const route = read("app/api/learnings/[id]/route.ts");
    expect(route).toContain("contextOrResponse()");
    expect(route).toContain('supabase.rpc("delete_learning_signal"');
    expect(route).toContain("p_learning_id: id");
    expect(route).not.toContain("workspace_id");
    expect(route).not.toContain("actor_id");
    expect(route).not.toContain("createSupabaseAdminClient");
  });

  it("shows an accessible two-step control only for authorized outcome cards", () => {
    const page = read("app/app/outcomes/page.tsx");
    const control = read("src/components/portal/learning-deletion-control.tsx");
    expect(page).toContain("created_by");
    expect(page).toContain('context.membership.role === "owner"');
    expect(page).toContain('context.membership.role === "admin"');
    expect(page).toContain("key={item.id}");
    expect(page).toContain("No reusable learnings yet.");
    expect(page).toContain("LearningDeletionControl");
    expect(control).toContain("Press again to delete");
    expect(control).toContain("Demo mode does not delete data.");
    expect(control).toContain('fetch(`/api/learnings/${learningId}`, { method: "DELETE" })');
    expect(control).toContain("aria-live");
    expect(control).toContain("router.refresh()");
  });

  it("filters deleted learning from every active read and export path while retaining snapshots", () => {
    for (const path of [
      "app/app/page.tsx",
      "src/lib/server/case-work-packets.ts",
      "app/api/workspace/export/route.ts",
      "app/app/outcomes/page.tsx",
    ]) {
      expect(read(path)).toContain("deleted_at");
    }
    const casePage = read("app/app/cases/[id]/page.tsx");
    expect(casePage).toContain("case_learning_applications");
    expect(casePage).toContain("loadRelatedLearnings");
    expect(read("supabase/migrations/202608150001_case_work_packets.sql")).toContain("learning_note_snapshot");
  });
});
