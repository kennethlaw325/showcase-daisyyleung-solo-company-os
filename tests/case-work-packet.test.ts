import { describe, expect, it } from "vitest";
import { parseCaseWorkPacket, validateLearningApplicationAccounting } from "../src/lib/domain/case-work-packet";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRelatedLearnings } from "../src/lib/server/case-work-packets";

const learningId = "00000000-0000-4000-8000-000000000001";
const secondLearningId = "00000000-0000-4000-8000-000000000002";

function packet(module: "growth" | "operations" | "intelligence", learningApplications = []) {
  const plan = module === "growth"
    ? { opportunity: "Opportunity", hypothesis: "Hypothesis", conversionPath: "Signal to sale", proof: ["Proof"], measures: ["Replies"] }
    : module === "operations"
      ? { bottleneck: "Bottleneck", decision: "Decision", owners: ["Owner"], dependencies: ["Dependency"], measures: ["Cycle time"], contradictions: [], deadlineCollisions: [] }
      : { claims: ["Claim"], evidenceBoundaries: ["Boundary"], uncertainty: ["Unknown"], audienceStrategy: "Plain brief" };
  return {
    evidenceBrief: { observations: ["Observation"], assumptions: ["Assumption"], gaps: ["Gap"], risks: ["Risk"] },
    plan,
    deliverable: { title: "Title", summary: "Summary", body: "Body", next_action: "Next" },
    learningApplications,
  };
}

describe("lightweight case work packet contract", () => {
  it.each(["growth", "operations", "intelligence"] as const)("validates the %s module plan", (module) => {
    expect(parseCaseWorkPacket(module, packet(module), [])).toMatchObject({ deliverable: { title: "Title" } });
  });

  it("accepts empty selection and exact one-to-one accounting", () => {
    expect(() => validateLearningApplicationAccounting([], [])).not.toThrow();
    expect(() => validateLearningApplicationAccounting([learningId, secondLearningId], [
      { learningId, disposition: "applied", rationale: "Used" },
      { learningId: secondLearningId, disposition: "not_applied", rationale: "Source facts outranked it" },
    ])).not.toThrow();
  });

  it.each([
    [[learningId], [{ learningId, disposition: "applied", rationale: "One" }, { learningId, disposition: "applied", rationale: "Duplicate" }]],
    [[learningId], []],
    [[], [{ learningId, disposition: "applied", rationale: "Unselected" }]],
  ] as const)("rejects duplicate, missing, or unselected applications", (selected, applications) => {
    expect(() => validateLearningApplicationAccounting(selected, applications)).toThrow();
  });

  it("rejects a module plan that does not match the case module", () => {
    expect(() => parseCaseWorkPacket("operations", packet("growth"), [])).toThrow();
  });

  it("rejects an Operations packet that omits either audit field", () => {
    const complete = packet("operations");
    const withoutContradictions = Object.fromEntries(Object.entries(complete.plan).filter(([key]) => key !== "contradictions"));
    expect(() => parseCaseWorkPacket("operations", { ...complete, plan: withoutContradictions }, [])).toThrow();
    const withoutDeadlineCollisions = Object.fromEntries(Object.entries(complete.plan).filter(([key]) => key !== "deadlineCollisions"));
    expect(() => parseCaseWorkPacket("operations", { ...complete, plan: withoutDeadlineCollisions }, [])).toThrow();
  });

  it("represents a cross-functional contradiction and a deadline collision without inventing their evidence", () => {
    const complete = packet("operations");
    const parsed = parseCaseWorkPacket("operations", {
      ...complete,
      plan: {
        ...complete.plan,
        contradictions: ["Marketing says 15 Sep is locked, while the vendor source says free media changes through 2026-08-30 then HK$40,000."],
        deadlineCollisions: ["A 2026-09-01 launch/delay decision follows the earlier 2026-08-30 cost/change cutoff."],
      },
    }, []);
    expect(parsed.plan).toMatchObject({ contradictions: ["Marketing says 15 Sep is locked, while the vendor source says free media changes through 2026-08-30 then HK$40,000."], deadlineCollisions: ["A 2026-09-01 launch/delay decision follows the earlier 2026-08-30 cost/change cutoff."] });
  });

  it("rejects packets with a missing evidence stage field", () => {
    const complete = packet("growth");
    const { risks: omittedRisks, ...evidenceBrief } = complete.evidenceBrief;
    expect(omittedRisks).toEqual(["Risk"]);
    const incomplete = { ...complete, evidenceBrief };
    expect(() => parseCaseWorkPacket("growth", incomplete, [])).toThrow();
  });

  it("rejects duplicate learning selections before persistence", () => {
    expect(() => validateLearningApplicationAccounting([learningId, learningId], [
      { learningId, disposition: "applied", rationale: "Used" },
    ])).toThrow("Duplicate learning selection");
  });

  it("returns no unrelated learning when strict FTS finds no match and never falls back to recency", async () => {
    const calls: string[] = [];
    const chain = {
      select() { calls.push("select"); return chain; },
      eq(field: string, value: unknown) { calls.push(`eq:${field}:${String(value)}`); return chain; },
      neq(field: string, value: unknown) { calls.push(`neq:${field}:${String(value)}`); return chain; },
      is(field: string, value: unknown) { calls.push(`is:${field}:${String(value)}`); return chain; },
      textSearch(field: string, query: string, options: unknown) { calls.push(`fts:${field}:${query}:${JSON.stringify(options)}`); return chain; },
      limit(value: number) { calls.push(`limit:${value}`); return Promise.resolve({ data: [], error: null }); },
    };
    const supabase = { from(table: string) { calls.push(`from:${table}`); return chain; } } as unknown as SupabaseClient;
    const result = await loadRelatedLearnings({ supabase, workspaceId: "workspace-1", module: "intelligence", query: "provider migration", limit: 3 });
    expect(result).toEqual([]);
    expect(calls.filter((call) => call.startsWith("fts:")).length).toBe(1);
    expect(calls.some((call) => call.startsWith("order:"))).toBe(false);
  });

  it("does not query when the related-learning search text is empty", async () => {
    const supabase = { from: () => { throw new Error("empty queries must short-circuit"); } } as unknown as SupabaseClient;
    await expect(loadRelatedLearnings({ supabase, workspaceId: "workspace-1", module: "growth", query: "   " })).resolves.toEqual([]);
  });
});
