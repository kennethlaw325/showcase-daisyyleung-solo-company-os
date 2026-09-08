import { describe, expect, it } from "vitest";
import { CASE_FLOWS, moduleForFlow } from "../src/lib/domain/general-flow";
import { importConfirmRequestSchema, importProposalSchema, intakeRequestSchema } from "../src/lib/domain/schemas";
import { deterministicImportProposal, guidedImportJsonSchema, type ImportedSource } from "../src/lib/server/import-classification";
import { guidedValidationResponse } from "../app/api/imports/confirm/route";

const source: ImportedSource = {
  kind: "pasted",
  filename: "pasted-intake.txt",
  mimeType: "text/plain",
  byteSize: 86,
  sha256: "a".repeat(64),
  extractedText: "Recruit 80 places, convert 15 consulting customers, budget 30,000, owner Alex.",
  truncated: false,
};

describe("guided import flow contract", () => {
  it("keeps each selected flow authoritative and returns its exact draft shape", () => {
    for (const flow of CASE_FLOWS) {
      const proposal = deterministicImportProposal([source], "en", flow.key);
      const draft: Record<string, unknown> = { ...proposal };
      delete draft.sources;
      expect(proposal.flow).toBe(flow.key);
      expect(proposal.module).toBe(moduleForFlow(flow.key));
      expect(importProposalSchema.safeParse(draft).success).toBe(true);
      expect(guidedImportJsonSchema(flow.key)).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
  });

  it("does not let Growth keywords override a selected non-Growth flow", () => {
    expect(deterministicImportProposal([source], "en", "intelligence")).toMatchObject({
      flow: "intelligence",
      module: "intelligence",
      intakeContext: { schemaVersion: 1 },
    });
    expect(deterministicImportProposal([source], "en", "general")).toMatchObject({
      flow: "general",
      module: "operations",
    });
  });

  it("rejects arbitrary AI keys before they can reach confirmation", () => {
    const proposal = deterministicImportProposal([source], "en", "growth");
    const unsafe = {
      ...proposal,
      intakeContext: {
        ...proposal.intakeContext,
        clientName: "North Star Studio",
        contactPerson: "Alex",
        budget: "30,000",
      },
    };
    expect(importProposalSchema.safeParse(unsafe).success).toBe(false);
  });

  it("accepts a completed reviewed Growth draft through both confirmation and intake boundaries", () => {
    const confirmed = importConfirmRequestSchema.parse({
      idempotencyKey: "00000000-0000-4000-8000-000000000012",
      flow: "growth",
      title: "North Star Studio new-case launch",
      brief: "Recruit 80 places and convert at least 15 consulting customers.",
      intakeContext: {
        schemaVersion: 1,
        successCriteria: "80 registrations and at least 15 qualified consulting customers",
        workflowGuidance: "State the budget currency and timing as unresolved until confirmed.",
        offer: "A new limited-place programme",
        leadProfile: "Prospective North Star Studio customers",
        pipelineContext: "80 available places",
        campaignContext: "Recruitment campaign with Alex as contact",
        conversionTarget: "At least 15 consulting customers within a confirmed 30,000 budget",
      },
      sources: [source],
    });
    const { flow, sources, ...creation } = confirmed;
    expect(flow).toBe("growth");
    expect(sources).toHaveLength(1);
    expect(intakeRequestSchema.safeParse({ ...creation, module: moduleForFlow(flow) }).success).toBe(true);
  });

  it("returns a recoverable field error for incomplete screenshot-like Growth details", async () => {
    const result = importConfirmRequestSchema.safeParse({
      idempotencyKey: "00000000-0000-4000-8000-000000000012",
      flow: "growth",
      title: "North Star Studio new-case launch",
      brief: "Recruit 80 places.",
      intakeContext: { clientName: "North Star Studio", contactPerson: "Alex", budget: "30,000" },
      sources: [source],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected the screenshot-like payload to fail");
    const response = guidedValidationResponse(result.error, "en");
    expect(response?.status).toBe(422);
    expect(await response?.json()).toEqual(expect.objectContaining({ errorCode: "guided_intake_invalid" }));
    expect(JSON.stringify(await guidedValidationResponse(result.error, "zh-Hant")?.json())).not.toContain("Invalid request");
  });
});
