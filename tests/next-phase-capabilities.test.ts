import { describe, expect, it } from "vitest";
import { buildIntakeSnapshotPayload, buildLegacyIntakeSnapshotPayload } from "../src/lib/server/intake-snapshots";
import { deterministicImportProposal, moduleFromText } from "../src/lib/server/import-classification";
import { normalizeReanalysisDelta } from "../src/lib/server/reanalysis";
import { deterministicStyleRulesFromEdit, normalizeStyleRules, structuralEditMetadata, styleRulesPrompt } from "../src/lib/server/style-learning";
import { operationsIntakeContextSchema } from "../src/lib/domain/case-intake-context";

describe("next-phase capability boundaries", () => {
  it("builds an exact intake payload without inventing omitted audience or learning", () => {
    const payload = buildIntakeSnapshotPayload({ request: { title: "Launch", brief: "Move the offer", module: "growth", intakeContext: { schemaVersion: 1, successCriteria: "Reply", offer: "Offer", leadProfile: "Leads", conversionTarget: "Reply" } } });
    expect(payload.schemaVersion).toBe(1);
    expect(payload).not.toHaveProperty("audience");
    expect(payload).not.toHaveProperty("selectedLearningIds");
    const selected = buildIntakeSnapshotPayload({ request: { title: "Launch", brief: "Move the offer", module: "growth", intakeContext: { schemaVersion: 1, successCriteria: "Reply", offer: "Offer", leadProfile: "Leads", conversionTarget: "Reply" } }, selectedLearningIds: ["00000000-0000-4000-8000-000000000001"] });
    expect(selected.selectedLearningIds).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });

  it("marks legacy reconstruction as partial and keeps only persisted fields", () => {
    const payload = buildLegacyIntakeSnapshotPayload({ title: "Legacy", brief: "Existing brief", module: "operations", intake_context: null });
    expect(payload.moduleContext).toEqual({});
    expect(payload.sourceManifest).toEqual([]);
  });

  it("classifies bounded imported text into one canonical module", () => {
    expect(moduleFromText("meeting decisions, owner and deadline")).toBe("operations");
    const proposal = deterministicImportProposal([{ kind: "upload", filename: "notes.txt", mimeType: "text/plain", byteSize: 10, sha256: "a".repeat(64), extractedText: "meeting decisions and owners", truncated: false }]);
    expect(proposal.module).toBe("operations");
    expect(operationsIntakeContextSchema.safeParse(proposal.intakeContext).success).toBe(true);
    expect(proposal.sources[0].kind).toBe("upload");
    expect(proposal.sources[0].sha256).toBe("a".repeat(64));
  });

  it("normalizes a bounded delta and style profile prompt", () => {
    const delta = normalizeReanalysisDelta({ newFacts: ["A"], confidence: "high", recommendedNextAction: "Review" });
    expect(delta.confidence).toBe("high");
    expect(delta.newFacts).toEqual(["A"]);
    const rules = normalizeStyleRules({ tone: ["plain", " ", 4], antiCorporate: ["No filler"] });
    expect(rules.tone).toEqual(["plain"]);
    expect(styleRulesPrompt(rules)).toContain("source facts");
  });

  it("emits structural metadata without storing full artifact content", () => {
    const metadata = structuralEditMetadata({ before: { title: "A", summary: "B", body: "C", next_action: "D" }, after: { title: "A", summary: "B2", body: "C", next_action: "D" } });
    expect(metadata.changedFields).toEqual(["summary"]);
    expect(metadata).not.toHaveProperty("body");
  });

  it("derives bounded fallback rules when AI is unavailable", () => {
    const rules = deterministicStyleRulesFromEdit({ changedFields: ["summary", "body"] });
    expect(rules.structure?.length).toBe(1);
    expect(rules.clarity?.length).toBe(1);
    expect(rules.antiCorporate).toEqual(["Avoid generic corporate filler."]);
  });
});
