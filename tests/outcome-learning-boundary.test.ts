import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapOutcomeRpcError, parseOutcomeReviewResult } from "../app/api/cases/[id]/outcome/route";

const route = readFileSync(resolve(process.cwd(), "app/api/cases/[id]/outcome/route.ts"), "utf8");
const form = readFileSync(resolve(process.cwd(), "src/components/portal/outcome-form.tsx"), "utf8");

describe("outcome learning epistemic boundary", () => {
  it("allows insufficient evidence instead of forcing a reusable principle", () => {
    expect(route).toContain("sufficientEvidence");
    expect(route).toContain("learning and applicability to null");
    expect(route).toContain("candidateText = null");
  });

  it("keeps plans and hypotheses outside candidate-learning generation input", () => {
    const generationInput = route.match(/input:\s*\{([\s\S]*?)\},\s*schemaName: "outcome_reusable_learning_epistemic_v1"/)?.[1] ?? "";
    expect(generationInput).toContain("actualResult");
    expect(generationInput).toContain("whatWorked");
    expect(generationInput).not.toContain("nextAction");
    expect(generationInput).not.toContain("improvements");
    expect(generationInput).not.toContain("otherAngles");
    expect(generationInput).not.toContain("expectedResult");
  });

  it("requires exact adapted text, applicability, and explicit reuse approval", () => {
    expect(route).toContain("!userCandidate || !userApplicability || !input.approveAdaptedLearning");
    expect(form).toContain('required={learningDisposition === "adapt"}');
    expect(form).toContain('name="learningApplicability" required');
    expect(form).toContain('name="approveAdaptedLearning"');
  });

  it("records the outcome, learning, audit receipts, and completion only through the atomic RPC", () => {
    expect(route).toContain('rpc("record_case_outcome_review"');
    expect(route).not.toContain('.from("learning_records")');
    expect(route).not.toContain('.from("audit_events")');
    expect(route).toContain("parseOutcomeReviewResult(rpcResult, input.learningDisposition)");
  });

  it("cannot report approved reuse when the RPC fails or returns an invalid result", () => {
    expect(route).toContain("if (error) throw mapOutcomeRpcError(error)");
    const invalidKeepApproval = {
      completed: true,
      learningRequested: true,
      outcomeId: "13000000-0000-4000-8000-000000000501",
      learningId: "13000000-0000-4000-8000-000000000502",
      learningGenerated: true,
      learningApproval: "approved_for_reuse",
    };
    expect(() => parseOutcomeReviewResult(invalidKeepApproval, "keep")).toThrow("Outcome unavailable");
    expect(() => parseOutcomeReviewResult({ ...invalidKeepApproval, learningId: null, learningGenerated: false, learningApproval: "not_proposed" }, "adapt")).toThrow("Outcome unavailable");
    expect(route).not.toMatch(/return json\([\s\S]*isAdapt \? ["']approved_for_reuse/);
  });

  it("maps stale and cross-workspace kernel denials to bounded recovery states", () => {
    expect(mapOutcomeRpcError({ message: "outcome not pending" })).toMatchObject({ status: 409, message: "Outcome is no longer pending; refresh this case" });
    expect(mapOutcomeRpcError({ message: "outcome not authorized" })).toMatchObject({ status: 404, message: "Outcome unavailable" });
    expect(mapOutcomeRpcError({ message: "unexpected database failure" })).toMatchObject({ message: "Outcome unavailable" });
  });
});
