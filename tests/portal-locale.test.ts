import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { localePromptInstruction, parseLocale } from "../src/lib/i18n/locale";
import { getPortalCopy } from "../src/lib/i18n/portal-copy";
import { caseInputsSchema, profileLocaleRequestSchema } from "../src/lib/domain/schemas";
import { buildDefaultActionDraft } from "../src/lib/presentation/human-readable";
import { buildAudienceVariants } from "../src/lib/domain/templates";
import { MAX_FILE_BYTES, normalizedSourceMime, validateSourceFiles } from "../src/lib/client/source-upload";
import { buildPastedIntakeText } from "../src/lib/server/case-intake";
import { buildBalancedSourcePack } from "../app/api/cases/[id]/generate-revision/route";

const root = resolve(import.meta.dirname, "..");

describe("private portal locale contract", () => {
  it("keeps ordinary growth-intake vocabulary fully localized in Traditional Chinese", () => {
    const copy = getPortalCopy("zh-Hant").newCase;
    expect(copy.offer).toBe("服務或產品*");
    expect(copy.leadProfile).toBe("潛在客戶輪廓*");
    expect(copy.pipelineContext).toBe("銷售流程背景");
    expect(copy.campaignContext).toBe("推廣活動／渠道背景");
    expect(copy.sopContext).toBe("標準流程背景");
    const visibleGrowthCopy = [
      copy.caseTitlePlaceholder,
      copy.offer,
      copy.offerPlaceholder,
      copy.leadProfile,
      copy.leadProfilePlaceholder,
      copy.pipelineContext,
      copy.pipelineContextPlaceholder,
      copy.campaignContext,
      copy.campaignContextPlaceholder,
      copy.decisionsNeededPlaceholder,
      copy.sopContext,
      copy.sopContextPlaceholder,
      copy.crossFunctionalSignalsPlaceholder,
      ...Object.values(copy.pastedPlaceholderByModule),
      copy.aiReady,
    ].join(" ");
    expect(visibleGrowthCopy).not.toMatch(/\b(?:offer|lead|pipeline|campaign|onboarding|proof)\b/i);
    const portalCopy = getPortalCopy("zh-Hant");
    expect(portalCopy.case.status.working).toBe("系統處理中");
    expect(portalCopy.case.templateVersion(2)).toBe("模板第 2 版");
    expect([portalCopy.outcomeForm.learningNote, portalCopy.outcomeForm.notePlaceholder, portalCopy.outcomeForm.needsConfirmation].join(" ")).not.toMatch(/\bAI\b/);
  });

  it("accepts only supported profile locales and falls back safely", () => {
    expect(profileLocaleRequestSchema.safeParse({ locale: "zh-Hant" }).success).toBe(true);
    expect(profileLocaleRequestSchema.safeParse({ locale: "en" }).success).toBe(true);
    expect(profileLocaleRequestSchema.safeParse({ locale: "fr" }).success).toBe(false);
    expect(parseLocale("invalid", "en")).toBe("en");
  });

  it("makes the selected language explicit in every structured AI instruction", () => {
    expect(localePromptInstruction("zh-Hant")).toMatch(/Traditional Chinese/i);
    expect(localePromptInstruction("zh-Hant")).toMatch(/Hong Kong/i);
    expect(localePromptInstruction("en")).toMatch(/clear English/i);
    const generation = readFileSync(resolve(root, "app/api/cases/[id]/generate-revision/route.ts"), "utf8");
    const outcome = readFileSync(resolve(root, "app/api/cases/[id]/outcome/route.ts"), "utf8");
    const audience = readFileSync(resolve(root, "src/lib/server/audience.ts"), "utf8");
    const guidedImport = readFileSync(resolve(root, "src/lib/server/import-classification.ts"), "utf8");
    const importRoute = readFileSync(resolve(root, "app/api/imports/classify/route.ts"), "utf8");
    for (const source of [generation, outcome, audience, guidedImport]) expect(source).toContain("localePromptInstruction");
    expect(importRoute).toContain("locale: context!.locale");
  });

  it("uses source artifact locale for deterministic variants and email defaults", () => {
    const variants = buildAudienceVariants({ coreRevision: 1, coreHash: "a".repeat(64), contentLocale: "zh-Hant", core: { title: "標題", summary: "摘要", body: "內容" } });
    expect(variants.every((variant) => variant.content_locale === "zh-Hant")).toBe(true);
    expect(variants.find((variant) => variant.preset === "public")?.title).toContain("公開簡介");
    const draft = buildDefaultActionDraft({ title: "標題", summary: "摘要", body: "內容", nextAction: "下一步" }, "zh-Hant");
    expect(draft.subject).toContain("聚焦的下一步");
    expect(draft.body).toContain("摘要");
  });

  it("keeps artifact locale immutable and requires explicit new writes", () => {
    const migration = readFileSync(resolve(root, "supabase/migrations/202608120005_artifact_content_locale.sql"), "utf8");
    expect(migration).toContain("set not null");
    expect(migration).toContain("drop default");
    expect(migration).toContain("artifact content locale is immutable");
    const serverCases = readFileSync(resolve(root, "src/lib/server/cases.ts"), "utf8");
    expect(serverCases).toContain("content_locale: input.contentLocale");
  });

  it("uses a real bounded New Case file input and rev-zero intake flow", () => {
    const form = readFileSync(resolve(root, "src/components/portal/new-case-form.tsx"), "utf8");
    const intake = readFileSync(resolve(root, "app/api/cases/intake/route.ts"), "utf8");
    const retiredAlias = readFileSync(resolve(root, "app/api/cases/route.ts"), "utf8");
    expect(form).toContain('type="file"');
    expect(form).toContain("Choose files");
    expect(form).toContain("uploadSourceFiles");
    expect(form).toContain("/api/cases/intake");
    expect(intake).toContain("contextOrResponse");
    expect(intake).not.toContain("workspaceId");
    const retiredGenerationRoute = resolve(root, "app/api/cases", "generate", "route.ts");
    expect(existsSync(retiredGenerationRoute)).toBe(false);
    expect(retiredAlias).toContain("status: 410");
    expect(retiredAlias).not.toContain("./generate/route");
  });

  it("enforces the New Case upload limits before minting signed URLs", () => {
    const sourceFile = (name: string, size: number, type: string) => ({ name, size, type, lastModified: 0 }) as File;
    expect(validateSourceFiles(Array.from({ length: 5 }, (_, index) => sourceFile(`${index}.txt`, 1, "text/plain")))).toBeNull();
    expect(validateSourceFiles([sourceFile("sixth.txt", 1, "text/plain")], 5)).toMatch(/0 more sources/);
    expect(validateSourceFiles([sourceFile("large.pdf", MAX_FILE_BYTES + 1, "application/pdf")])).toMatch(/10 MB/);
    expect(validateSourceFiles([sourceFile("image.png", 1, "image/png")])).toMatch(/not a supported/);
    expect(normalizedSourceMime(sourceFile("brief.pptx", 1, "application/vnd.ms-powerpoint"))).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(normalizedSourceMime(sourceFile("notes.md", 1, "text/plain"))).toBe("text/markdown");
    expect(validateSourceFiles([sourceFile("legacy.ppt", 1, "application/vnd.ms-powerpoint")])).toMatch(/legacy|unencrypted PPTX/i);
  });

  it("keeps pasted notes as source evidence without promoting structured context", () => {
    const packed = buildPastedIntakeText({ source: "Customer notes", inputs: { successCriteria: "Three qualified replies" } });
    expect(packed).toBe("Customer notes");
    expect(packed).not.toContain("INTAKE INPUTS");
    expect(packed).not.toContain("Three qualified replies");
  });

  it("stores versioned bounded workflow guidance alongside success criteria", () => {
    expect(caseInputsSchema.safeParse({ schemaVersion: 1, successCriteria: "Three qualified replies", workflowGuidance: "Keep claims grounded in approved evidence." }).success).toBe(true);
    expect(caseInputsSchema.safeParse({ schemaVersion: 1, workflowGuidance: "x".repeat(4_001), successCriteria: "Result" }).success).toBe(false);
    expect(caseInputsSchema.safeParse({ schemaVersion: 1, successCriteria: "Keep this bounded", futureInput: { allowed: true } }).success).toBe(false);
    const form = readFileSync(resolve(root, "src/components/portal/new-case-form.tsx"), "utf8");
    expect(form).toContain('name="workflowGuidance"');
    expect(form).toContain("workflowGuidance: String(form.get(\"workflowGuidance\") ?? \"\")");
    const packed = buildPastedIntakeText({ source: "Customer notes", inputs: { schemaVersion: 1, successCriteria: "Three qualified replies", workflowGuidance: "Keep claims grounded." } });
    expect(packed).toBe("Customer notes");
    expect(readFileSync(resolve(root, "src/lib/i18n/portal-copy.ts"), "utf8")).toContain("intake → artifact → approval → optional Gmail draft → outcome");
  });

  it("wires revision feedback and disabled-source guidance into the case support UI", () => {
    const button = readFileSync(resolve(root, "src/components/portal/regenerate-from-sources-button.tsx"), "utf8");
    const panels = readFileSync(resolve(root, "src/components/portal/case-support-panels.tsx"), "utf8");
    const page = readFileSync(resolve(root, "app/app/cases/[id]/page.tsx"), "utf8");
    expect(button).toContain("current_revision");
    expect(button).toContain("successRevision");
    expect(button).toContain("router.refresh()");
    expect(button).toContain('aria-live="polite"');
    expect(panels).toContain("currentRevision");
    expect(panels).toContain("missingSource");
    expect(page).toContain('regenerationClosed ? "closed" : regenerationMissingSource ? "missingSource"');
    expect(page).toContain("currentRevision={caseRecord.current_revision}");
  });

  it("allocates prompt space to every extracted source", () => {
    const pack = buildBalancedSourcePack([
      { filename: "first.txt", source_url: null, extracted_text: "A".repeat(100_000) },
      { filename: "second.txt", source_url: null, extracted_text: "SECOND-SOURCE" },
    ]);
    expect(pack.length).toBeLessThanOrEqual(100_000);
    expect(pack).toContain("SOURCE: first.txt");
    expect(pack).toContain("SECOND-SOURCE");
  });
});
