import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace export", () => {
  it("exports only the verified session workspace as a downloadable no-store JSON file", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/workspace/export/route.ts"), "utf8");
    expect(route).toContain("contextOrResponse()");
    expect(route).toContain('.eq("workspace_id", context.workspace.id)');
    expect(route).toContain('"content-disposition"');
    expect(route).toContain('"cache-control": "private, no-store"');
    for (const table of ["cases", "source_items", "case_artifacts", "case_audience_variants", "case_actions", "case_approvals", "case_outcomes", "learning_records"]) {
      expect(route).toContain(`"${table}"`);
    }
    expect(route).not.toContain("oauth_connections");
  });
});
