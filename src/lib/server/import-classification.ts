import { extractDocument } from "../security/documents";
import { LEGACY_PPT_MIME, PPTX_MIME } from "../security/source-formats";
import { pptxError } from "../security/pptx";
import { sha256Hex } from "../security/hash";
import type { ModuleKey } from "../domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importProposalSchema, guidedImportContextSchemaForFlow } from "../domain/schemas";
import { DEFAULT_QUOTA_INPUT_TOKENS, DEFAULT_QUOTA_OUTPUT_TOKENS, classifyAiError, estimateAiCostUsd, generateStructured, getAiRuntime, toSafeAiError } from "../adapters/ai";
import { localePromptInstruction, type Locale } from "../i18n/locale";
import { moduleForFlow, type CaseFlowKey } from "../domain/general-flow";

export const IMPORT_MAX_FILES = 3;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** Text imports stay bounded to the same extraction ceiling as pasted case
 * evidence, measured after UTF-8 encoding rather than trusting a client size. */
export const IMPORT_MAX_TEXT_BYTES = 100_000;
export const IMPORT_MAX_SOURCES = IMPORT_MAX_FILES + 1;
export const IMPORT_ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PPTX_MIME,
  "text/plain",
  "text/markdown",
]);

export type ImportedSource = { kind: "pasted" | "upload"; filename: string; mimeType: string; byteSize: number; sha256: string; extractedText: string; truncated: boolean };

export function extractImportText(value: string): ImportedSource {
  const text = value.trim();
  if (!text) throw Object.assign(new Error("Import text cannot be empty"), { status: 400 });
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > IMPORT_MAX_TEXT_BYTES) {
    throw Object.assign(new Error("Import text must be 100,000 bytes or less"), { status: 413 });
  }
  return {
    kind: "pasted",
    filename: "pasted-intake.txt",
    mimeType: "text/plain",
    byteSize: bytes.byteLength,
    sha256: sha256Hex(bytes),
    extractedText: text,
    truncated: false,
  };
}

export function moduleFromText(text: string): ModuleKey {
  if (/invoice|pipeline|lead|sales|conversion|revenue|客戶|銷售|轉換/i.test(text)) return "growth";
  if (/meeting|decision|owner|deadline|sop|blocker|operations|會議|決策|負責人|截止/i.test(text)) return "operations";
  return "intelligence";
}

export async function extractImportFile(file: File): Promise<ImportedSource> {
  if (file.size <= 0 || file.size > IMPORT_MAX_BYTES) throw new Error("Each import file must be between 1 byte and 10 MB");
  const filename = file.name.trim().slice(0, 255);
  const declaredMime = (file.type || "").split(";", 1)[0].toLowerCase();
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const extensionMime: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: PPTX_MIME, txt: "text/plain", md: "text/markdown" };
  if (extension === "ppt" || (declaredMime === LEGACY_PPT_MIME && extension !== "pptx")) {
    throw pptxError("powerpoint_binary_or_encrypted_unsupported", "Legacy or encrypted PowerPoint files are not supported; save the file as an unencrypted PPTX");
  }
  // Office/Markdown MIME values vary by browser; the supported filename
  // extension is canonical here and the parser still verifies the bytes.
  const mimeType = extensionMime[extension] ?? "";
  if (!IMPORT_ALLOWED_MIME.has(mimeType)) throw Object.assign(new Error("Unsupported import file type"), { sourceErrorCode: "unsupported_document" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extracted = await extractDocument({ bytes, mime: mimeType, filename });
  return { kind: "upload", filename, mimeType, byteSize: bytes.byteLength, sha256: sha256Hex(bytes), extractedText: extracted.text, truncated: extracted.truncated };
}

export function deterministicImportProposal(sources: readonly ImportedSource[], locale: Locale = "en", selectedFlow?: CaseFlowKey) {
  const text = sources.map((source) => source.extractedText).join("\n\n").slice(0, 100_000);
  // The guided picker is authoritative when present.  The optional inference
  // keeps this helper backwards-compatible for sealed fixtures and callers
  // outside the HTTP route.
  const flow = selectedFlow ?? moduleFromText(text);
  const moduleKey = moduleForFlow(flow);
  const zh = locale === "zh-Hant";
  const objective = text.slice(0, 500) || (zh ? "審閱匯入資料，找出下一個有用成果。" : "Review the imported source material and identify the next useful outcome.");
  const successCriteria = zh ? "審閱已擷取的資料" : "Review extracted evidence";
  const decision = zh ? "審閱匯入資料並確認下一項決定。" : "Review the imported evidence and confirm the next decision.";
  const intakeContext = flow === "growth"
    ? { schemaVersion: 1, successCriteria, workflowGuidance: "", offer: "", leadProfile: "", pipelineContext: "", campaignContext: "", conversionTarget: "" }
    : flow === "intelligence"
      ? { schemaVersion: 1, successCriteria, workflowGuidance: "" }
      : { schemaVersion: 1, successCriteria, workflowGuidance: "", decisionsNeeded: [decision], owners: [], deadlines: [], sopContext: "", blockers: [], crossFunctionalSignals: [] };
  const gaps = flow === "growth"
    ? (zh ? ["請補充服務或產品、潛在客戶輪廓及轉化目標，然後再建立個案。"] : ["Complete the offer, lead profile, and conversion target before creating the case."])
    : (zh ? ["建立前請確認所需成果及目標受眾。"] : ["Confirm the desired outcome and audience before creation."]);
  const sourceTitle = sources[0]?.kind === "upload"
    ? sources[0].filename.replace(/\.[^.]+$/, "")
    : (zh ? "匯入工作" : "Imported case");
  const audience = flow === "intelligence" ? {
    preset: "custom" as const,
    knowledgeLevel: zh ? "熟悉相關範疇" : "Informed generalist",
    goal: zh ? "理解決定及其影響" : "Understand the decision and implications",
    tone: zh ? "清晰、踏實、簡潔" : "Clear, grounded, and concise",
    format: zh ? "包含建議的結構化簡報" : "Structured brief with recommendations",
    disclosureBoundaries: [],
  } : undefined;
  return {
    flow,
    module: moduleKey,
    confidence: text.length > 200 ? 0.68 : 0.35,
    title: sourceTitle,
    objective,
    intakeContext,
    ...(audience ? { audience } : {}),
    checklist: [{ id: "review", label: zh ? "審閱匯入資料" : "Review imported evidence", required: true }],
    gaps,
    conflicts: [],
    risks: [zh ? "匯入文字可能被截短或缺少脈絡。" : "Imported text may be truncated or missing context."],
    evidenceMappings: sources.slice(0, 3).map((source) => ({ filename: source.filename, hash: source.sha256, supports: ["objective"] })),
    sources: sources.map(({ kind, filename, mimeType, byteSize, sha256, extractedText, truncated }) => ({ kind, filename, mimeType, byteSize, sha256, extractedText, truncated })),
  };
}

type GuidedJsonSchema = Record<string, unknown>;

function guidedTextJsonSchema(max: number) {
  return { type: "string", maxLength: max } as const;
}

function guidedListJsonSchema(maxItems: number, maxText = 2_000) {
  return { type: "array", maxItems, items: guidedTextJsonSchema(maxText) } as const;
}

/** Build the exact structured-output context schema for the selected flow. */
export function guidedImportJsonSchema(flow: CaseFlowKey): GuidedJsonSchema {
  const shared = {
    schemaVersion: { type: "integer", const: 1 },
    successCriteria: guidedTextJsonSchema(2_000),
    workflowGuidance: guidedTextJsonSchema(4_000),
  };
  const properties = flow === "growth"
    ? {
        ...shared,
        offer: guidedTextJsonSchema(4_000),
        leadProfile: guidedTextJsonSchema(4_000),
        pipelineContext: guidedTextJsonSchema(4_000),
        campaignContext: guidedTextJsonSchema(4_000),
        conversionTarget: guidedTextJsonSchema(2_000),
      }
    : flow === "intelligence"
      ? shared
      : {
          ...shared,
          decisionsNeeded: guidedListJsonSchema(20),
          owners: guidedListJsonSchema(20),
          deadlines: guidedListJsonSchema(20),
          sopContext: guidedTextJsonSchema(8_000),
          blockers: guidedListJsonSchema(20),
          crossFunctionalSignals: guidedListJsonSchema(20),
        };
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

function proposalJsonSchema(flow: CaseFlowKey): GuidedJsonSchema {
  const moduleKey = moduleForFlow(flow);
  const proposalProperties = {
    flow: { type: "string", enum: [flow] },
    module: { type: "string", enum: [moduleKey] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    title: guidedTextJsonSchema(200),
    objective: guidedTextJsonSchema(20_000),
    intakeContext: guidedImportJsonSchema(flow),
    checklist: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, properties: { id: guidedTextJsonSchema(64), label: guidedTextJsonSchema(200), required: { type: "boolean" } }, required: ["id", "label", "required"] } },
    gaps: { type: "array", maxItems: 20, items: guidedTextJsonSchema(1_000) },
    conflicts: { type: "array", maxItems: 20, items: guidedTextJsonSchema(1_000) },
    risks: { type: "array", maxItems: 20, items: guidedTextJsonSchema(1_000) },
    evidenceMappings: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, properties: { filename: guidedTextJsonSchema(255), hash: { type: "string", pattern: "^[a-f0-9]{64}$" }, supports: { type: "array", maxItems: 10, items: guidedTextJsonSchema(200) } }, required: ["filename", "hash", "supports"] } },
  };
  if (flow === "intelligence") {
    Object.assign(proposalProperties, {
      audience: {
        type: "object",
        additionalProperties: false,
        properties: {
          preset: { type: "string", enum: ["custom"] },
          knowledgeLevel: guidedTextJsonSchema(200),
          goal: guidedTextJsonSchema(500),
          tone: guidedTextJsonSchema(200),
          format: guidedTextJsonSchema(200),
          disclosureBoundaries: guidedListJsonSchema(20, 500),
        },
        required: ["preset", "knowledgeLevel", "goal", "tone", "format", "disclosureBoundaries"],
      },
    });
  }
  return { type: "object", additionalProperties: false, properties: proposalProperties, required: Object.keys(proposalProperties) };
}

export async function proposeImportTemplate(input: { sources: readonly ImportedSource[]; flow: CaseFlowKey; workspaceId: string; userId: string; locale: Locale; quotaClient: SupabaseClient }) {
  const fallback = deterministicImportProposal(input.sources, input.locale, input.flow);
  let runtime;
  try { runtime = getAiRuntime("fast"); } catch (error) {
    if (classifyAiError(error) === "not_configured") return fallback;
    throw toSafeAiError(error);
  }
  const schema = proposalJsonSchema(input.flow);
  const flowFieldGuidance = input.flow === "growth"
    ? "Use offer for the product or service; leadProfile for the intended customer; pipelineContext for current sales state; campaignContext for channels or recruitment activity; and conversionTarget for the measurable commercial result."
    : input.flow === "intelligence"
      ? "Use successCriteria for the observable communications or research result and workflowGuidance for constraints or evidence guidance. Fill audience knowledgeLevel, goal, tone, format, and disclosureBoundaries only from explicit source guidance; otherwise leave those draft fields empty for human review."
      : input.flow === "general"
        ? "Use decisionsNeeded for the next step or decision; owners for people and stakeholders; deadlines for constraints and timing; sopContext for background and current situation; blockers for obstacles; and crossFunctionalSignals for known information or evidence."
        : "Use decisionsNeeded for decisions; owners for responsible people; deadlines for timing; sopContext for the current process; blockers for obstacles; and crossFunctionalSignals for evidence across functions.";
  const estimatedCostUsd = estimateAiCostUsd(runtime.provider, runtime.model, DEFAULT_QUOTA_INPUT_TOKENS, DEFAULT_QUOTA_OUTPUT_TOKENS);
  const generated = await generateStructured({
    provider: runtime.provider,
    model: runtime.model,
    system: `Prepare a reviewable intake template for the selected ${input.flow} flow only. The selected flow is authoritative and maps to the ${moduleForFlow(input.flow)} engine; never change it. ${flowFieldGuidance} Return no artifact, invent no missing facts, and do not copy source text into evidence mappings. Low confidence, missing required fields, conflicts, and gaps must remain visible for user correction. Every intakeContext key must match this flow exactly. ${localePromptInstruction(input.locale)}`,
    input: { flow: input.flow, sources: input.sources.map((source) => ({ filename: source.filename, mimeType: source.mimeType, sha256: source.sha256, extractedText: source.extractedText.slice(0, 50_000) })) },
    schemaName: "guided_import_template_v1",
    schema,
    validator: importProposalSchema,
    workspaceId: input.workspaceId,
    userId: input.userId,
    quotaClient: input.quotaClient,
    quotaEstimatedCostUsd: estimatedCostUsd,
    timeoutMs: 30_000,
  });
  const parsed = importProposalSchema.parse(generated.value);
  if (parsed.flow !== input.flow || parsed.module !== moduleForFlow(input.flow)) {
    throw Object.assign(new Error("Guided import flow changed while analysing"), { status: 409 });
  }
  // Run the selected context parser once more at the boundary so a future
  // schema refactor cannot silently reintroduce arbitrary model keys.
  guidedImportContextSchemaForFlow(input.flow).parse(parsed.intakeContext);
  return { ...parsed, flow: input.flow, module: moduleForFlow(input.flow), sources: input.sources };
}
