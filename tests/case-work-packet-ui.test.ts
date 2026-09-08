import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const picker = read("src/components/portal/learning-picker.tsx");
const packet = read("src/components/portal/case-work-packet.tsx");
const outcomes = read("app/app/outcomes/page.tsx");
const styles = read("app/globals.css");
const casePage = read("app/app/cases/[id]/page.tsx");
const route = read("app/api/cases/[id]/generate-revision/route.ts");
const migration = read("supabase/migrations/202608150001_case_work_packets.sql");

describe("lightweight work packet UI and boundary contract", () => {
  it("renders separately labelled learning epistemic sections", () => {
    for (const heading of ["可重用學習：", "適用情境：", "證據：", "證據信心："]) expect(picker).toContain(heading);
    for (const heading of ["可重用學習：", "適用情境：", "證據：", "證據信心：", "下一步／測試行動："]) expect(packet).toContain(heading);
    for (const heading of ["證據數量：", "Evidence count:", "學習信心：", "Learning confidence:", "驗證狀態：", "Validation status:"]) {
      expect(picker).not.toContain(heading);
      expect(packet).not.toContain(heading);
      expect(outcomes).not.toContain(heading);
    }
    expect(picker).toContain("presentLearningCard(candidate)");
    expect(packet).toContain("presentLearningCard(application)");
    expect(styles).toMatch(/\.learning-picker-card-section\s*\{\s*display:\s*grid/i);
    expect(styles).toMatch(/\.learning-card-section\s*\{\s*display:\s*grid/i);
  });

  it("renders immutable application snapshots and a legacy-safe fallback", () => {
    expect(casePage).toContain("other_angles_snapshot");
    expect(casePage).not.toContain("applicationOutcomes");
    expect(packet).toContain('operations: "商業洞察"');
    expect(packet).toContain('bottleneck: "目前阻礙"');
    expect(packet).toContain('contradictions: "矛盾"');
    expect(packet).toContain('deadlineCollisions: "限期衝突"');
    expect(packet).toContain('contradictions: "Contradictions"');
    expect(packet).toContain('deadlineCollisions: "Deadline collisions"');
    expect(packet).not.toContain("舊流程產生");
    expect(packet).not.toContain("Legacy revision");
    expect(casePage).toContain("work_packet_source_artifact_id");
    expect(casePage).toContain('packetState={workPacketState}');
    expect(packet).toContain("human-edited revision inherits the evidence and plan");
    expect(packet).toContain("packetSourceRevision");
    expect(packet).toContain("packet source is incomplete");
  });

  it("keeps finalization server-only and prevents selected-learning regeneration", () => {
    expect(route).toContain('admin.rpc("finalize_case_work_packet"');
    expect(route).toContain("Reusable learning can only be selected for the first generation");
    expect(migration).toMatch(/revoke all on function public\.finalize_case_work_packet[\s\S]*authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.finalize_case_work_packet[\s\S]*to service_role/i);
  });
});
