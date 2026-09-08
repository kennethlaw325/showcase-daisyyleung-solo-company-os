import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  workflowChecklistSchema,
  workflowIntakeDefaultsSchema,
  workflowStreamCreateRequestSchema,
  generationRequestSchema,
} from "../src/lib/domain/schemas";
import { normalizeWorkflowStreamPayload, streamAllowsGmailDraft, workflowStreamContentHash } from "../src/lib/domain/workflow-stream";
import { getPortalCopy } from "../src/lib/i18n/portal-copy";

const projectRoot = resolve(import.meta.dirname, "..");

describe("My Workflow v1 contract", () => {
  const payload = {
    idempotencyKey: "00000000-0000-4000-8000-000000000010",
    baseModule: "growth" as const,
    name: "Launch sprint",
    description: "A bounded path from offer to review.",
    goalMode: "outcome" as const,
    intakeDefaults: { successCriteria: "Three qualified replies", offer: "Strategy Sprint" },
    checklist: [{ id: "proof", label: "Confirm the proof point", required: true }],
    stageVisibility: { intake: true, artifact: true, approval: true, gmail: false, outcome: true },
  };

  it("accepts only bounded preset fields and excludes prompt/schema/gate controls", () => {
    expect(workflowStreamCreateRequestSchema.safeParse(payload).success).toBe(true);
    expect(workflowStreamCreateRequestSchema.safeParse({ ...payload, idempotencyKey: undefined }).success).toBe(false);
    expect(workflowStreamCreateRequestSchema.safeParse({ ...payload, prompt: "override" }).success).toBe(false);
    expect(workflowStreamCreateRequestSchema.safeParse({ ...payload, outputSchema: {} }).success).toBe(false);
    expect(workflowStreamCreateRequestSchema.safeParse({ ...payload, stageVisibility: { ...payload.stageVisibility, send: true } }).success).toBe(false);
    expect(workflowIntakeDefaultsSchema.safeParse({ prompt: "no" }).success).toBe(false);
    expect(workflowIntakeDefaultsSchema.safeParse({ flowKey: "general" }).success).toBe(true);
    expect(workflowIntakeDefaultsSchema.safeParse({ flowKey: "growth" }).success).toBe(false);
    expect(workflowIntakeDefaultsSchema.safeParse({ flowKey: "general", unsupported: "no" }).success).toBe(false);
  });

  it("keeps intake, artifact, approval, and outcome gates permanently enabled", () => {
    expect(workflowStreamCreateRequestSchema.safeParse({
      ...payload,
      stageVisibility: { ...payload.stageVisibility, approval: false },
    }).success).toBe(false);
  });

  it("normalizes a stream and computes a stable semantic content hash", () => {
    const semanticPayload = {
      baseModule: payload.baseModule,
      name: payload.name,
      description: payload.description,
      goalMode: payload.goalMode,
      intakeDefaults: payload.intakeDefaults,
      checklist: payload.checklist,
      stageVisibility: payload.stageVisibility,
    };
    const normalized = normalizeWorkflowStreamPayload(semanticPayload);
    expect(normalized.stageVisibility.gmail).toBe(false);
    expect(workflowStreamContentHash(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(workflowStreamContentHash({ ...payload, description: " A bounded path from offer to review. " })).toBe(workflowStreamContentHash(payload));
  });

  it("keeps Gmail visibility explicit and checklist shape bounded", () => {
    expect(streamAllowsGmailDraft({ stage_visibility: { gmail: false } })).toBe(false);
    expect(streamAllowsGmailDraft(null)).toBe(true);
    expect(workflowChecklistSchema.safeParse([{ id: "bad key", label: "x", required: true }]).success).toBe(false);
  });

  it("requires exact stream id/version pairing on case intake", () => {
    const context = { schemaVersion: 1, successCriteria: "Three replies", offer: "Offer", leadProfile: "Leads", conversionTarget: "Replies" };
    const request = { idempotencyKey: "00000000-0000-4000-8000-000000000011", module: "growth" as const, title: "Case", brief: "Brief", intakeContext: context, workflowStreamId: "00000000-0000-4000-8000-000000000001", expectedStreamVersion: 1 };
    expect(generationRequestSchema.safeParse(request).success).toBe(true);
    expect(generationRequestSchema.safeParse({ ...request, idempotencyKey: undefined }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...request, workflowStreamId: "00000000-0000-4000-8000-000000000001", expectedStreamVersion: undefined }).success).toBe(false);
  });

  it("keeps My Workflow copy focused on reusable work settings", () => {
    const zh = getPortalCopy("zh-Hant").workflows;
    const en = getPortalCopy("en").workflows;
    expect(zh.baseModule).toBe("工作類別");
    expect(en.baseModule).toBe("Work category");
    expect(zh.name).toBe("工作流名稱");
    expect(en.name).toBe("Workflow name");
    expect(zh.intro).toContain("直接重用");
    expect(en.intro).toContain("reuse");
    expect(JSON.stringify(zh)).not.toMatch(/底層|引擎|模板/);
    expect(JSON.stringify(en)).not.toMatch(/underlying|engine|template/i);

    for (const file of ["app/app/workflows/page.tsx", "src/components/portal/workflow-manager.tsx"]) {
      const source = readFileSync(resolve(projectRoot, file), "utf8");
      expect(source).not.toMatch(/底層|引擎|模板/);
      expect(source).not.toMatch(/underlying|engine|template/i);
    }
  });

  it("keeps module and category implementation details out of the workflow UI", () => {
    const managerSource = readFileSync(resolve(projectRoot, "src/components/portal/workflow-manager.tsx"), "utf8");
    const newCaseSource = readFileSync(resolve(projectRoot, "src/components/portal/new-case-form.tsx"), "utf8");
    expect(managerSource).not.toMatch(/WORKFLOW_MODULE_LABELS/);
    expect(managerSource).not.toMatch(/copy\.baseModule/);
    expect(managerSource).not.toMatch(/copy\.category/);
    expect(newCaseSource).not.toMatch(/WORKFLOW_MODULE_LABELS/);
  });
});
