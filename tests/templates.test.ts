import { describe, expect, it } from "vitest";
import { audienceProfileForPreset, buildAudienceVariants, getTemplateVersion, markStaleVariants, TEMPLATE_HISTORY, TEMPLATE_VERSIONS } from "../src/lib/domain/templates";
import { audienceProfileSchema } from "../src/lib/domain/schemas";
import { buildAudienceAdaptationPrompt } from "../src/lib/server/audience";

describe("versioned templates and public relations audience variants", () => {
  it("ships latest versions with retained prompt history for each supported module", () => {
    expect(Object.keys(TEMPLATE_VERSIONS).sort()).toEqual(["growth", "intelligence", "operations"]);
    expect(getTemplateVersion("growth").version).toBe(2);
    expect(getTemplateVersion("operations").version).toBe(3);
    expect(getTemplateVersion("intelligence").version).toBe(1);
    expect(TEMPLATE_HISTORY.growth.map((template) => template.version)).toEqual([1, 2]);
    expect(TEMPLATE_HISTORY.operations.map((template) => template.version)).toEqual([1, 2, 3]);
    expect(getTemplateVersion("growth", 1).version).toBe(1);
    expect(() => getTemplateVersion("growth", 99)).toThrow(/Unsupported template/);
  });

  it("keeps Operations v1/v2 history while adding the v3 decision-intelligence audit contract", () => {
    const [v1, v2, v3] = TEMPLATE_HISTORY.operations;
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
    expect(v3.prompt).toMatch(/audit every supplied date, dependency, deadline/i);
    expect(v3.prompt).toMatch(/restructure the plan.*provisional decision.*before the cutoff/i);
    expect(v3.prompt).toMatch(/perceived, contractual, or proposed/i);
    expect(v3.prompt).toMatch(/locked.*perception/i);
    expect(v3.prompt).toMatch(/never invent an owner, deadline, consequence, baseline, denominator, or KPI/i);
    expect(v3.prompt).toMatch(/unsupported absolute KPIs such as 100%/i);
    expect(v3.prompt).toMatch(/absolute targets only when supplied/i);
  });

  it("creates self/client/public variants tied to a core hash", () => {
    const variants = buildAudienceVariants({ coreRevision: 2, coreHash: "a".repeat(64), core: { title: "Signal", summary: "Summary", body: "Evidence" }, now: "2026-01-01T00:00:00.000Z" });
    expect(variants.map((variant) => variant.audience.preset)).toEqual(["self", "client", "public"]);
    expect(variants.every((variant) => variant.core_hash === "a".repeat(64) && !variant.stale && audienceProfileSchema.safeParse(variant.audience).success)).toBe(true);
    expect(markStaleVariants(variants, "b".repeat(64)).every((variant) => variant.stale)).toBe(true);
  });

  it("keeps every built-in audience profile tied to the same requested deliverable", () => {
    for (const preset of ["self", "client", "public", "custom"] as const) {
      const profile = audienceProfileForPreset(preset);
      expect(profile.goal).toMatch(/same requested deliverable/i);
      expect(profile.format).toMatch(/same requested deliverable/i);
    }
  });

  it("makes audience changes preserve artifact intent and type", () => {
    const objective = "Write a company introduction";
    const prompt = buildAudienceAdaptationPrompt({ objective, writingAcceptanceCriteria: ["Use concrete source-grounded wording"] });
    expect(prompt).toMatch(/preserve the original deliverable intent and type/i);
    expect(prompt).toMatch(/do not turn a company introduction into a report or an announcement/i);
    expect(prompt).toMatch(/concrete source-grounded wording/i);
    expect(prompt).not.toContain(objective);
  });
});
