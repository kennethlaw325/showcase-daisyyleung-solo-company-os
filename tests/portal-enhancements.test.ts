import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { operationsIntakeContextSchema } from "../src/lib/domain/case-intake-context";
import { buildGeneralFlowContext, moduleForFlow } from "../src/lib/domain/general-flow";
import { importClassifyRequestSchema, importConfirmRequestSchema } from "../src/lib/domain/schemas";
import { extractImportText } from "../src/lib/server/import-classification";
import { sha256Hex } from "../src/lib/security/hash";

const projectRoot = resolve(import.meta.dirname, "..");

describe("portal intake and guided import boundaries", () => {
  it("maps General to Operations and preserves the exact objective", () => {
    const objective = "Decide whether to pause the launch until proof is ready.";
    const context = buildGeneralFlowContext({
      objective,
      successCriteria: "A recorded decision",
      owners: ["Demo User"],
      deadlines: ["Friday"],
      sopContext: "Use the launch review",
      blockers: ["Proof is missing"],
      crossFunctionalSignals: ["Sales needs a decision"],
    });
    expect(moduleForFlow("general")).toBe("operations");
    expect(context.decisionsNeeded).toEqual([objective]);
    expect(context).not.toHaveProperty("module");
    expect(context).toMatchObject({ owners: ["Demo User"], deadlines: ["Friday"], sopContext: "Use the launch review", blockers: ["Proof is missing"], crossFunctionalSignals: ["Sales needs a decision"] });
    expect(operationsIntakeContextSchema.safeParse(context).success).toBe(true);
  });

  it("derives a bounded text source and never accepts empty or oversized text", () => {
    const source = extractImportText("  Meeting notes and one decision.  ");
    expect(source.filename).toBe("pasted-intake.txt");
    expect(source.kind).toBe("pasted");
    expect(source.extractedText).toBe("Meeting notes and one decision.");
    expect(source.sha256).toBe(sha256Hex(new TextEncoder().encode(source.extractedText)));
    expect(() => extractImportText(" \n\t ")).toThrow(/cannot be empty/i);
    expect(() => extractImportText("x".repeat(100_001))).toThrow(/100,000/i);
  });

  it("allows a text source alongside up to three extracted file sources", () => {
    const source = { kind: "upload" as const, filename: "source.txt", mimeType: "text/plain" as const, byteSize: 1, sha256: "a".repeat(64), extractedText: "x", truncated: false };
    expect(importClassifyRequestSchema.safeParse({ flow: "operations", sources: [source, { ...source, filename: "one.txt" }, { ...source, filename: "two.txt" }, { ...source, filename: "three.txt" }] }).success).toBe(true);
    expect(importClassifyRequestSchema.safeParse({ flow: "operations", sources: [] }).success).toBe(false);
    expect(importClassifyRequestSchema.safeParse({ flow: "operations", sources: [source, source, source, source, source] }).success).toBe(false);
  });

  it("validates an optional client link only at the confirm boundary", () => {
    const source = { kind: "upload" as const, filename: "source.txt", mimeType: "text/plain" as const, byteSize: 1, sha256: "a".repeat(64), extractedText: "x", truncated: false };
    const base = {
      idempotencyKey: "00000000-0000-4000-8000-000000000012",
      flow: "operations" as const,
      title: "Imported notes",
      brief: "Review this decision",
      intakeContext: { schemaVersion: 1, successCriteria: "A recorded decision", decisionsNeeded: ["Review this decision"] },
      sources: [source],
    };
    expect(importConfirmRequestSchema.safeParse({ ...base, clientId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(importConfirmRequestSchema.safeParse({ ...base, clientId: "not-a-uuid" }).success).toBe(false);
  });

  it("keeps the portal intake surfaces aligned and padded", () => {
    const css = readFileSync(resolve(projectRoot, "app/portal-enhancements.css"), "utf8");
    expect(css).toMatch(/\.import-wizard\s*\{[^}]*padding:/s);
    expect(css).toMatch(/\.speech-to-text-control\s*\{[^}]*border:/s);
    expect(css).toMatch(/\.intake-snapshot-panel\s*\{[^}]*grid-template-columns:/s);
    expect(css).toMatch(/\.new-case-page[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.new-case-form \.client-selector > label\s*\{[^}]*gap:\s*9px/s);
  });

  it("marks the new-case page for responsive intro treatment", () => {
    const source = readFileSync(resolve(projectRoot, "app/app/new/page.tsx"), "utf8");
    expect(source).toContain('className="portal-page new-case-page"');
    expect(source).toContain("Start with semi-automatic analysis or manual entry. You can review the input before creation.");
  });
});
