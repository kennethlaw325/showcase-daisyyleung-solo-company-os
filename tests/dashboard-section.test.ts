import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { demoCases } from "../src/data/demo-data";

const root = resolve(import.meta.dirname, "..");

describe("today dashboard focus", () => {
  it("removes the Pilot usage / Operating health card and its home-page queries", () => {
    const dashboard = readFileSync(resolve(root, "src/components/portal/today-dashboard.tsx"), "utf8");
    const home = readFileSync(resolve(root, "app/app/page.tsx"), "utf8");
    const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
    expect(dashboard).not.toContain("UsageSummary");
    expect(dashboard).not.toContain("Pilot usage");
    expect(dashboard).not.toContain("operating-health");
    expect(dashboard).toContain("single-panel");
    expect(home).not.toContain("usage_events");
    expect(home).not.toContain("get_workspace_daily_ai_call_cap");
    expect(css).not.toContain(".usage-ring");
    expect(css).not.toContain(".operating-health");
  });

  it("uses the module mark metadata for every case row", () => {
    const dashboard = readFileSync(resolve(root, "src/components/portal/today-dashboard.tsx"), "utf8");
    expect(demoCases[3]?.module).toBe("operations");
    expect(dashboard).toMatch(/operations:\s*\{\s*accent:\s*"cyan",\s*number:\s*"02"\s*\}/);
    expect(dashboard).not.toContain("String(index + 1)");
  });
});
