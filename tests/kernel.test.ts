import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isCompleteable } from "../src/lib/domain/state-machine";
import { approvalRequestSchema, outcomeRequestSchema } from "../src/lib/domain/schemas";
import { hashJson, stableStringify } from "../src/lib/security/hash";
import { estimateAiCostUsd } from "../src/lib/adapters/ai";

describe("case kernel", () => {
  it("allows only explicit state transitions", () => {
    expect(canTransition("draft", "working")).toBe(true);
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("awaiting_approval", "outcome_pending")).toBe(true);
    expect(() => assertTransition("approved", "completed")).toThrow(/Invalid case transition/);
  });

  it("requires an outcome, next action, and disposition before completion", () => {
    expect(isCompleteable({ status: "outcome_pending", hasOutcome: true, hasNextAction: true, learningDisposition: "keep" })).toBe(true);
    expect(isCompleteable({ status: "outcome_pending", hasOutcome: true, hasNextAction: false, learningDisposition: "keep" })).toBe(false);
    expect(isCompleteable({ status: "outcome_pending", hasOutcome: true, hasNextAction: true })).toBe(false);
    expect(outcomeRequestSchema.safeParse({ expectedResult: "ship", actualResult: "done", evidence: "reply", confidence: "high", whatWorked: "tight scope", whatFailed: "none", blockers: "", nextAction: "follow up", improvements: "keep cadence", otherAngles: "test timing", followUpDate: "2026-08-12", learningDisposition: "adapt", learningNote: "keep" }).success).toBe(true);
  });

  it("hashes objects independent of key insertion order", () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
    expect(approvalRequestSchema.safeParse({ artifactRevision: 1, artifactHash: "a".repeat(64), actionPayloadHash: "b".repeat(64) }).success).toBe(true);
    expect(approvalRequestSchema.safeParse({ artifactRevision: 1, artifactHash: "a".repeat(64) }).success).toBe(true);
  });

  it("uses bounded conservative pricing for quota reservations", () => {
    expect(estimateAiCostUsd("openai", "gpt-5.6-terra", 1_000_000, 1_000_000)).toBe(25);
    expect(estimateAiCostUsd("openai", "unknown-model", 1_000, 2_000)).toBe(0.18);
    expect(estimateAiCostUsd("openai", "gpt-5.6-luna", -1, 0)).toBe(0);
    expect(estimateAiCostUsd("gemini", "gemini-3.6-flash", 1_000_000, 1_000_000)).toBe(9);
  });
});
