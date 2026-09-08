import { describe, expect, it } from "vitest";
import {
  growthIntakeContextSchema,
  intelligenceIntakeContextSchema,
  operationsIntakeContextSchema,
  parsePersistedIntakeContext,
} from "../src/lib/domain/case-intake-context";
import {
  generationRequestSchema,
  intakeRequestSchema,
} from "../src/lib/domain/schemas";
import { buildCaseAnalysisInput, buildCaseAnalysisSystemPrompt, CASE_ANALYSIS_SAFETY_INSTRUCTIONS, deriveWritingAcceptanceCriteria, OPERATIONS_DECISION_INTELLIGENCE_COMPATIBILITY_CONTRACT } from "../src/lib/server/case-analysis";

const shared = { schemaVersion: 1 as const, successCriteria: "A measurable result" };

describe("module-specific intake context", () => {
  it("requires the strict Growth focus and normalizes optional text", () => {
    const parsed = growthIntakeContextSchema.parse({
      ...shared,
      offer: " Strategy Sprint ",
      leadProfile: "Founders with a delayed launch",
      pipelineContext: "   ",
      campaignContext: "Existing channel",
      conversionTarget: "Three qualified conversations",
    });
    expect(parsed.offer).toBe("Strategy Sprint");
    expect(parsed.pipelineContext).toBeUndefined();
    expect(growthIntakeContextSchema.safeParse({ ...parsed, module: "operations" }).success).toBe(false);
    expect(growthIntakeContextSchema.safeParse({ ...parsed, unknownField: true }).success).toBe(false);
    expect(growthIntakeContextSchema.safeParse({ ...parsed, offer: "x".repeat(4_001) }).success).toBe(false);
    expect(growthIntakeContextSchema.safeParse({ ...parsed, offer: undefined }).success).toBe(false);
  });

  it("requires Operations decisions and defaults optional lists with de-duplication", () => {
    const parsed = operationsIntakeContextSchema.parse({
      ...shared,
      decisionsNeeded: [" Confirm owner ", "Confirm owner", "  ", "Choose deadline"],
    });
    expect(parsed.decisionsNeeded).toEqual(["Confirm owner", "Choose deadline"]);
    expect(parsed.owners).toEqual([]);
    expect(parsed.deadlines).toEqual([]);
    expect(parsed.blockers).toEqual([]);
    expect(parsed.crossFunctionalSignals).toEqual([]);
    expect(operationsIntakeContextSchema.safeParse({ ...shared, decisionsNeeded: [] }).success).toBe(false);
    expect(operationsIntakeContextSchema.safeParse({ ...shared, decisionsNeeded: ["x"], offer: "wrong module" }).success).toBe(false);
    expect(operationsIntakeContextSchema.safeParse({ ...shared, decisionsNeeded: ["x".repeat(2_001)] }).success).toBe(false);
    expect(operationsIntakeContextSchema.safeParse({ ...shared, decisionsNeeded: Array.from({ length: 21 }, () => "x") }).success).toBe(false);
  });

  it("accepts Intelligence on the shared schema and no module-specific focus", () => {
    const parsed = intelligenceIntakeContextSchema.parse({ ...shared, workflowGuidance: "Keep claims grounded" });
    expect(parsed).toEqual({ schemaVersion: 1, successCriteria: "A measurable result", workflowGuidance: "Keep claims grounded" });
    expect(intelligenceIntakeContextSchema.safeParse({ ...parsed, offer: "wrong module" }).success).toBe(false);
  });

  it("uses top-level module discrimination and rejects wrong or unknown fields", () => {
    const growth = {
      idempotencyKey: "18000000-0000-4000-8000-000000000401",
      module: "growth",
      title: "Offer",
      brief: "Move the offer",
      intakeContext: { ...shared, offer: "Offer", leadProfile: "Leads", conversionTarget: "Replies" },
    };
    expect(generationRequestSchema.safeParse(growth).success).toBe(true);
    expect(intakeRequestSchema.safeParse({ ...growth, intakeContext: { ...growth.intakeContext, decisionsNeeded: ["Wrong module"] } }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...growth, legacyField: true }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...growth, inputs: { successCriteria: "legacy" } }).success).toBe(false);
  });

  it("keeps legacy persisted context and fails closed for malformed non-empty values", () => {
    expect(parsePersistedIntakeContext("growth", null)).toBeNull();
    expect(parsePersistedIntakeContext("growth", {})).toBeNull();
    expect(() => parsePersistedIntakeContext("growth", { schemaVersion: 99 })).toThrow(/invalid/i);
    expect(() => parsePersistedIntakeContext("growth", { module: "growth" })).toThrow(/invalid/i);
  });

  it("builds one safe analysis envelope for both initial and revision generation", () => {
    const input = buildCaseAnalysisInput({
      authoritativeModule: "operations",
      objective: "Resolve the handoff",
      structuredContext: operationsIntakeContextSchema.parse({ ...shared, decisionsNeeded: ["Confirm owner"] }),
      sourceEvidence: "Meeting notes",
      audienceProfile: { preset: "self", knowledgeLevel: "expert", goal: "Decide", tone: "Direct", format: "Note", disclosureBoundaries: [] },
      learningGuidance: [{ learningId: "old", note: "Historical", tags: [] }],
    });
    expect(input).toMatchObject({ authoritativeModule: "operations", objective: "Resolve the handoff", sourceEvidence: "Meeting notes" });
    expect(input.structuredContext).toHaveProperty("decisionsNeeded");
    expect(CASE_ANALYSIS_SAFETY_INSTRUCTIONS).toMatch(/source facts outrank learning/i);
    expect(CASE_ANALYSIS_SAFETY_INSTRUCTIONS).toMatch(/Missing Operations fields are gaps/i);
  });

  it("adds the Operations decision-intelligence contract for v1/v2 and v3 cases only", () => {
    const operationsPrompt = buildCaseAnalysisSystemPrompt("operations template", "operations");
    expect(operationsPrompt).toContain(OPERATIONS_DECISION_INTELLIGENCE_COMPATIBILITY_CONTRACT);
    expect(operationsPrompt).toMatch(/compare all supplied dates chronologically/i);
    expect(operationsPrompt).toMatch(/cost or change cutoff/i);
    expect(operationsPrompt).toMatch(/restructure the plan.*provisional decision.*before the cutoff/i);
    expect(operationsPrompt).toMatch(/cross-functional.*source claim/i);
    expect(operationsPrompt).toMatch(/vendor or contract evidence.*contractual constraint/i);
    expect(operationsPrompt).toMatch(/\"locked\" alone.*perceived constraint/i);
    expect(operationsPrompt).toMatch(/supplied decisions and owners.*proposed decisions and owners/i);
    expect(operationsPrompt).toMatch(/never invent an owner, deadline, consequence, baseline, denominator, or KPI/i);
    expect(operationsPrompt).toMatch(/unsupported absolute KPIs such as 100%/i);
    expect(operationsPrompt).toMatch(/absolute targets only when an absolute target is supplied/i);

    const growthPrompt = buildCaseAnalysisSystemPrompt("growth template", "growth");
    expect(growthPrompt).not.toContain(OPERATIONS_DECISION_INTELLIGENCE_COMPATIBILITY_CONTRACT);
    expect(growthPrompt).not.toMatch(/Operations decision-intelligence compatibility contract/i);
  });

  it("turns vague Hong Kong anti-corporate cues into concrete writing criteria", () => {
    const criteria = deriveWritingAcceptanceCriteria({
      objective: "寫俾街客睇：介紹公司，但唔好太sales、好膠、太官腔，唔似我哋",
      workflowGuidance: "有人味啲，避免致力於、可靠而優質呢類句式",
      audienceProfile: { preset: "public", knowledgeLevel: "beginner", goal: "街客容易明", tone: "plain", format: "same requested deliverable", disclosureBoundaries: [] },
    }).join(" ");
    expect(criteria).toMatch(/plain.*source-grounded.*concrete nouns and verbs/i);
    expect(criteria).toMatch(/empty self-praise|stock corporate filler/i);
    expect(criteria).toMatch(/same requested artifact|same requested deliverable/i);
    expect(criteria).toMatch(/street or public cues/i);
  });

  it("recognizes a Cantonese AI-written tone cue without relying on another style keyword", () => {
    const criteria = deriveWritingAcceptanceCriteria({
      objective: "幫我執公司介紹，唔好一睇就覺得係 AI 寫",
      audienceProfile: { preset: "client", knowledgeLevel: "intermediate", goal: "Read the introduction", tone: "natural", format: "same requested deliverable", disclosureBoundaries: [] },
    }).join(" ");
    expect(criteria).toMatch(/generic AI copy/i);
    expect(criteria).toMatch(/stock corporate filler/i);
  });

  it("keeps requested artifact content separate from analysis and gaps", () => {
    const input = buildCaseAnalysisInput({
      authoritativeModule: "intelligence",
      objective: "Write a company introduction",
      structuredContext: intelligenceIntakeContextSchema.parse({ ...shared, workflowGuidance: "Keep it concrete" }),
      sourceEvidence: "Company history",
      audienceProfile: { preset: "self", knowledgeLevel: "expert", goal: "Review", tone: "Direct", format: "same requested deliverable", disclosureBoundaries: [] },
    });
    expect(input.writingAcceptanceCriteria.join(" ")).toMatch(/deliverable.*requested artifact itself/i);
    expect(input.writingAcceptanceCriteria.join(" ")).toMatch(/evidenceBrief.*plan/i);
    expect(input.writingAcceptanceCriteria.join(" ")).not.toMatch(/turn a company introduction into a report/i);
  });
});
