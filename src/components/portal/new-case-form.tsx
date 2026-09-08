"use client";

import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import { caseSupportCopy } from "@/src/data/case-support-copy";
import { ACCEPTED_FILE_TYPES, MAX_FILES, uploadSourceFiles, validateSourceFiles } from "@/src/lib/client/source-upload";
import { LearningPicker } from "@/src/components/portal/learning-picker";
import { SpeechToTextControl } from "@/src/components/portal/browser-speech-to-text-control";
import { ClientSelector } from "@/src/components/portal/client-selector";
import type { LearningCandidatesByModule } from "@/src/lib/server/case-work-packets";
import type { WorkflowStream } from "@/src/lib/domain/types";
import { buildGeneralFlowContext, CASE_FLOWS, moduleForFlow, type CaseFlowKey } from "@/src/lib/domain/general-flow";

// Manual and guided intake deliberately consume the same ordered flow map.
const flows = CASE_FLOWS;

export function NewCaseForm({ demo, learningCandidatesByModule, workflowStreams = [], clients = [] }: { demo: boolean; learningCandidatesByModule?: LearningCandidatesByModule; workflowStreams?: WorkflowStream[]; clients?: Array<{ id: string; name: string; company?: string }> }) {
  const router = useRouter();
  const { locale, localeSaving } = useLocale();
  const copy = getPortalCopy(locale).newCase;
  const customAudienceCopy = locale === "zh-Hant"
    ? {
        legend: "3. 定義第 4 份自訂受眾稿",
        note: "系統會固定產生自己、客戶及公開 3 份受眾稿；以下設定只用來建立第 4 份自訂受眾稿。",
        knowledgeLevel: "自訂受眾的知識程度",
        goal: "第 4 份自訂受眾稿目標",
        tone: "自訂受眾語氣",
        format: "自訂受眾格式",
        boundaries: "自訂受眾披露界線 · 每行一項",
      }
    : {
        legend: "3. Define the fourth custom audience draft",
        note: "Self, client, and public drafts are generated automatically. The settings below define an optional fourth custom audience draft.",
        knowledgeLevel: "Custom audience knowledge",
        goal: "Fourth custom draft goal",
        tone: "Custom audience tone",
        format: "Custom audience format",
        boundaries: "Custom audience disclosure boundaries · one per line",
      };
  const uploadCopy = caseSupportCopy[locale].upload;
  const inputId = useId();
  const sourceTextId = useId().replace(/:/g, "");
  const formRef = useRef<HTMLFormElement>(null);
  const preservedFormValuesRef = useRef<Record<string, string>>({});
  const restorePreservedValuesRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const intakeCaseIdRef = useRef<string | null>(null);
  const uploadedFileKeysRef = useRef(new Set<string>());
  const intakeIdempotencyRef = useRef<{ serialized: string; key: string } | null>(null);
  const submitInFlightRef = useRef(false);
  const workflowSaveIdempotencyRef = useRef<{ serialized: string; key: string } | null>(null);
  const workflowSaveInFlightRef = useRef(false);
  const [flow, setFlow] = useState<CaseFlowKey>("growth");
  const [availableWorkflowStreams, setAvailableWorkflowStreams] = useState<WorkflowStream[]>(workflowStreams);
  const [workflowStreamId, setWorkflowStreamId] = useState<string | null>(null);
  const [customWorkflowName, setCustomWorkflowName] = useState("");
  const [workflowSaveState, setWorkflowSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [workflowSaveMessage, setWorkflowSaveMessage] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sourceText, setSourceText] = useState("");
  const selectedWorkflow = availableWorkflowStreams.find((stream) => stream.id === workflowStreamId) ?? null;
  const canonicalModule = moduleForFlow(flow);
  const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

  function preserveCurrentFormValues() {
    const form = formRef.current;
    if (!form) return;
    const next = { ...preservedFormValuesRef.current };
    for (const field of Array.from(form.elements)) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) || !field.name) continue;
      if (field instanceof HTMLInputElement && ["checkbox", "file", "hidden", "radio"].includes(field.type)) continue;
      next[field.name] = field.value;
    }
    preservedFormValuesRef.current = next;
    restorePreservedValuesRef.current = true;
  }

  useLayoutEffect(() => {
    if (!restorePreservedValuesRef.current || !formRef.current) return;
    for (const [name, value] of Object.entries(preservedFormValuesRef.current)) {
      const field = formRef.current.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = value;
    }
    restorePreservedValuesRef.current = false;
  }, [flow, workflowStreamId]);

  async function fileManifest(files: readonly File[]) {
    return Promise.all(files.slice(0, MAX_FILES).map(async (file) => {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
      return { kind: "upload" as const, filename: file.name.slice(0, 255), sha256: hash, byteSize: file.size, urlHost: null };
    }));
  }

  const workflowDefaultText = (name: string) => {
    const value = selectedWorkflow?.intake_defaults?.[name];
    return typeof value === "string" ? value : Array.isArray(value) ? value.join("\n") : "";
  };

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!next.length) return;
    const validationError = validateSourceFiles(next, selectedFiles.length);
    if (validationError) {
      const translated = locale === "zh-Hant"
        ? validationError.replace(/^You can add (\d+) more sources? to this case\.?$/, "這個工作最多可加入 $1 個來源。")
          .replace(/ is not a supported PDF, DOCX, PPTX, TXT, or MD file\.?$/, "並非支援的 PDF、DOCX、PPTX、TXT 或 MD 檔案。")
          .replace(/ is a legacy PowerPoint file\. Save it as an unencrypted PPTX before uploading\.?$/, "是舊版 PowerPoint，請先另存為未加密的 PPTX。")
          .replace(/ must be between 1 byte and 10 MB\.?$/, "必須介乎 1 byte 至 10 MB。")
        : validationError;
      setError(translated);
      return;
    }
    setError("");
    setSelectedFiles((current) => [...current, ...next].slice(0, MAX_FILES));
  }

  async function saveCustomWorkflow() {
    if (demo || flow !== "general" || workflowSaveState === "saving" || workflowSaveInFlightRef.current) return;
    const name = customWorkflowName.trim();
    if (!name) {
      setWorkflowSaveState("error");
      setWorkflowSaveMessage(locale === "zh-Hant" ? "請先輸入工作流名稱。" : "Enter a workflow name first.");
      return;
    }
    if (name.length > 120) {
      setWorkflowSaveState("error");
      setWorkflowSaveMessage(locale === "zh-Hant" ? "工作流名稱最多 120 個字元。" : "Workflow names are limited to 120 characters.");
      return;
    }
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const values = (field: string) => Array.from(new Set(String(formData.get(field) ?? "").split("\n").map((item) => item.trim()).filter(Boolean)));
    const text = (field: string) => String(formData.get(field) ?? "").trim();
    const workflowPayload = {
      baseModule: "operations" as const,
      name,
      description: locale === "zh-Hant" ? "適用於不同工作的自定義資料收集及下一步決定。" : "A broadly useful setup for capturing context and the next decision.",
      goalMode: "decision" as const,
      intakeDefaults: {
        schemaVersion: 1,
        flowKey: "general" as const,
        successCriteria: text("successCriteria"),
        workflowGuidance: text("workflowGuidance"),
        decisionsNeeded: values("decisionsNeeded"),
        owners: values("owners"),
        deadlines: values("deadlines"),
        sopContext: text("sopContext"),
        blockers: values("blockers"),
        crossFunctionalSignals: values("crossFunctionalSignals"),
      },
      checklist: [],
      stageVisibility: { intake: true, artifact: true, approval: true, gmail: true, outcome: true },
    };
    const serialized = JSON.stringify(workflowPayload);
    let stableRequest = workflowSaveIdempotencyRef.current;
    if (!stableRequest || stableRequest.serialized !== serialized) {
      stableRequest = { serialized, key: crypto.randomUUID() };
      workflowSaveIdempotencyRef.current = stableRequest;
    }
    workflowSaveInFlightRef.current = true;
    setWorkflowSaveState("saving");
    setWorkflowSaveMessage("");
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...workflowPayload,
          idempotencyKey: stableRequest.key,
        }),
      });
      const body = await response.json() as { workflow?: WorkflowStream; error?: string };
      if (!response.ok || !body.workflow?.id) throw new Error(body.error ?? (locale === "zh-Hant" ? "未能儲存工作流。" : "The workflow could not be saved."));
      setAvailableWorkflowStreams((current) => [body.workflow!, ...current.filter((stream) => stream.id !== body.workflow!.id)]);
      setFlow("general");
      setWorkflowSaveState("saved");
      setWorkflowSaveMessage(locale === "zh-Hant" ? "已儲存到我的工作流，下次可直接選用。" : "Saved to My Workflow; you can select it next time.");
    } catch (cause) {
      setWorkflowSaveState("error");
      setWorkflowSaveMessage(cause instanceof Error ? cause.message : (locale === "zh-Hant" ? "未能儲存工作流。" : "The workflow could not be saved."));
    } finally {
      workflowSaveInFlightRef.current = false;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setState("submitting");
    setError("");
    const form = new FormData(event.currentTarget);
    const lineValues = (name: string) => Array.from(new Set(String(form.get(name) ?? "").split("\n").map((value) => value.trim()).filter(Boolean)));
    const defaultValue = (name: string) => selectedWorkflow?.intake_defaults?.[name];
    const textValue = (name: string) => {
      const value = String(form.get(name) ?? "").trim();
      const fallback = defaultValue(name);
      return value || (typeof fallback === "string" ? fallback : "");
    };
    const listValue = (name: string) => {
      const values = lineValues(name);
      const fallback = defaultValue(name);
      return values.length ? values : Array.isArray(fallback) ? fallback : [];
    };
    const sharedContext = {
      schemaVersion: 1,
      successCriteria: textValue("successCriteria"),
      workflowGuidance: String(form.get("workflowGuidance") ?? "").trim(),
    };
    const objective = String(form.get("objective") ?? "").trim();
    const intakeContext = canonicalModule === "growth"
      ? {
          ...sharedContext,
          offer: textValue("offer"),
          leadProfile: textValue("leadProfile"),
          pipelineContext: textValue("pipelineContext"),
          campaignContext: textValue("campaignContext"),
          conversionTarget: textValue("conversionTarget"),
        }
      : canonicalModule === "operations"
        ? flow === "general"
          ? buildGeneralFlowContext({
              objective,
              successCriteria: sharedContext.successCriteria,
              workflowGuidance: sharedContext.workflowGuidance,
              decisionsNeeded: listValue("decisionsNeeded"),
              owners: listValue("owners"),
              deadlines: listValue("deadlines"),
              sopContext: textValue("sopContext"),
              blockers: listValue("blockers"),
              crossFunctionalSignals: listValue("crossFunctionalSignals"),
            })
          : {
              ...sharedContext,
              decisionsNeeded: listValue("decisionsNeeded"),
              owners: listValue("owners"),
              deadlines: listValue("deadlines"),
              sopContext: textValue("sopContext"),
              blockers: listValue("blockers"),
              crossFunctionalSignals: listValue("crossFunctionalSignals"),
            }
        : sharedContext;
    const selectedLearningIds = form.getAll("selectedLearningIds").filter((value): value is string => typeof value === "string");
    const semanticPayload = {
      module: canonicalModule,
      title: form.get("title"),
      brief: form.get("objective"),
      source: form.get("sourceText"),
      sourceUrls: String(form.get("sourceUrls") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      intakeContext,
      workflowStreamId: selectedWorkflow?.id ?? undefined,
      expectedStreamVersion: selectedWorkflow?.version ?? undefined,
      clientId: clientId || undefined,
      selectedLearningIds,
      sourceManifest: await fileManifest(selectedFiles),
      audience: canonicalModule === "intelligence" ? {
        preset: form.get("audiencePreset") ?? "custom",
        knowledgeLevel: form.get("knowledgeLevel") ?? "informed generalist",
        goal: form.get("audienceGoal") ?? "understand and decide",
        tone: form.get("tone") ?? "clear and grounded",
        format: form.get("format") ?? "structured brief",
        disclosureBoundaries: String(form.get("disclosureBoundaries") ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      } : undefined,
    };
    const serialized = JSON.stringify(semanticPayload);
    let stableRequest = intakeIdempotencyRef.current;
    if (!stableRequest || stableRequest.serialized !== serialized) {
      stableRequest = { serialized, key: crypto.randomUUID() };
      intakeIdempotencyRef.current = stableRequest;
      // A changed semantic payload starts a new atomic intake. Any uploaded
      // file bookkeeping belongs to the previous case and must not leak into
      // the new request.
      intakeCaseIdRef.current = null;
      uploadedFileKeysRef.current.clear();
    }
    const payload = { ...semanticPayload, idempotencyKey: stableRequest.key };
    if (demo) {
      router.push(`/app/cases/${canonicalModule === "growth" ? "growth-offer-launch" : canonicalModule === "operations" ? "studio-retro" : "ai-agents-brief"}`);
      submitInFlightRef.current = false;
      return;
    }

    try {
      let caseId = intakeCaseIdRef.current;
      if (!caseId) {
        const response = await fetch("/api/cases/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const body = (await response.json()) as { id?: string; error?: string };
        if (!response.ok || !body.id) throw new Error(body.error ?? copy.error);
        caseId = body.id;
        intakeCaseIdRef.current = caseId;
      }
      const pendingFiles = selectedFiles.filter((file) => !uploadedFileKeysRef.current.has(fileKey(file)));
      if (pendingFiles.length) {
        await uploadSourceFiles(caseId, pendingFiles, {
          locale,
          onProgress: (message) => setUploadMessage(message),
          onUploaded: (file) => uploadedFileKeysRef.current.add(fileKey(file)),
        });
      }
      const generationResponse = await fetch(`/api/cases/${caseId}/generate-revision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audience: payload.audience, selectedLearningIds }) });
      const generationBody = (await generationResponse.json()) as { error?: string };
      if (!generationResponse.ok) throw new Error(generationBody.error ?? copy.error);
      router.push(`/app/cases/${caseId}`);
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      submitInFlightRef.current = false;
    }
  }

  return (
    <form ref={formRef} className="new-case-form" onSubmit={submit} key={selectedWorkflow?.id ?? "manual-flow"}>
      {availableWorkflowStreams.length ? <fieldset className="workflow-picker-fieldset">
        <legend>{locale === "zh-Hant" ? "先選擇我的工作流（可選）" : "Choose a My Workflow preset (optional)"}</legend>
        <div className="workflow-picker-grid">
          {availableWorkflowStreams.map((stream) => {
            return <label className={`workflow-picker-option ${selectedWorkflow?.id === stream.id ? "is-selected" : ""}`} key={stream.id}>
              <input type="radio" name="workflowStream" value={stream.id} checked={selectedWorkflow?.id === stream.id} onChange={() => {
                preserveCurrentFormValues();
                setWorkflowStreamId(stream.id);
                setFlow(stream.intake_defaults?.flowKey === "general" ? "general" : stream.base_module);
              }} />
              <strong>{stream.name} · v{stream.version}</strong>
              <small>{stream.description || (locale === "zh-Hant" ? "可重用的工作資料及檢查清單" : "Reusable intake defaults and checklist")}{stream.stage_visibility.gmail ? "" : ` · ${locale === "zh-Hant" ? "不建立 Gmail 草稿" : "Gmail draft off"}`}</small>
            </label>;
          })}
        </div>
      </fieldset> : null}
      {selectedWorkflow ? <fieldset className="workflow-binding-summary"><legend>{locale === "zh-Hant" ? "工作流已套用" : "Workflow applied"}</legend><p><strong>{selectedWorkflow.name}</strong> · {locale === "zh-Hant" ? `第 ${selectedWorkflow.version} 版` : `Version ${selectedWorkflow.version}`}</p><p>{selectedWorkflow.description}</p>{selectedWorkflow.checklist.length ? <ul>{selectedWorkflow.checklist.map((item) => <li key={item.id}>{item.label}{item.required ? " *" : ""}</li>)}</ul> : null}<button type="button" className="portal-secondary-button" onClick={() => { preserveCurrentFormValues(); setWorkflowStreamId(null); }}>{locale === "zh-Hant" ? "取消工作流預設" : "Clear workflow preset"}</button></fieldset> : null}
      <fieldset>
        <legend>{copy.moduleLegend}</legend>
        <div className="module-picker">
          {flows.map((item) => {
            const label = item.key === "general" ? (locale === "zh-Hant" ? "自定義" : "Custom") : getPortalCopy(locale).today.modules[item.key];
            const description = item.key === "general"
              ? (locale === "zh-Hant" ? "適用於不同工作的目標、背景、人物、證據、限制及下一步決定" : "Capture the goal, context, people, evidence, constraints, and next decision for different cases")
              : copy.moduleDescriptions[item.key];
            return <label className={`module-option ${flow === item.key ? "is-selected" : ""}`} key={item.key}>
              <input type="radio" name="flow" value={item.key} checked={flow === item.key} onChange={() => {
                preserveCurrentFormValues();
                setWorkflowStreamId(null);
                setFlow(item.key);
              }} />
              <span className={`case-module-mark ${item.accent}`}>{item.number}</span>
              <strong>{label}</strong>
              <small>{description}</small>
              <i aria-hidden="true">✓</i>
            </label>;
          })}
        </div>
        <input type="hidden" name="module" value={canonicalModule} />
      </fieldset>
      {flow === "general" ? <fieldset className="custom-workflow-save-panel">
        <legend>{locale === "zh-Hant" ? "儲存自定義工作流（可選）" : "Save this Custom workflow (optional)"}</legend>
        <p className="fieldset-note">{locale === "zh-Hant" ? "工作標題與工作流名稱分開；儲存後下次可在上方選用。" : "The case title stays separate from the workflow name. Save it here to reuse this setup next time."}</p>
        <div className="custom-workflow-save-row">
          <label><span>{locale === "zh-Hant" ? "工作流名稱" : "Workflow name"}</span><input value={customWorkflowName} onChange={(event) => { setCustomWorkflowName(event.target.value); setWorkflowSaveState("idle"); setWorkflowSaveMessage(""); }} maxLength={120} placeholder={locale === "zh-Hant" ? "例如：客戶決策整理" : "e.g. Client decision review"} disabled={demo || workflowSaveState === "saving"} /></label>
          <button type="button" className="portal-secondary-button" onClick={saveCustomWorkflow} disabled={demo || !customWorkflowName.trim() || workflowSaveState === "saving" || workflowSaveState === "saved"}>{workflowSaveState === "saving" ? (locale === "zh-Hant" ? "儲存中…" : "Saving…") : (locale === "zh-Hant" ? "儲存到我的工作流" : "Save to My Workflow")}</button>
        </div>
        {demo ? <p className="fieldset-note">{locale === "zh-Hant" ? "示範模式不能儲存工作流。" : "Demo mode cannot save workflows."}</p> : null}
        {workflowSaveMessage ? <p className={workflowSaveState === "error" ? "portal-error" : "client-selector-message"} role={workflowSaveState === "error" ? "alert" : "status"}>{workflowSaveMessage}</p> : null}
      </fieldset> : null}
      <fieldset>
        <legend>{copy.outcomeLegend}</legend>
        <div className="portal-field-grid">
          <ClientSelector clients={clients} value={clientId} onChange={setClientId} locale={locale} demo={demo} disabled={state === "submitting" || localeSaving} />
          <label><span>{copy.caseTitle}</span><input name="title" required maxLength={120} placeholder={copy.caseTitlePlaceholder} /></label>
          <label className="full"><span>{copy.objective}</span><textarea name="objective" required rows={4} maxLength={3000} placeholder={copy.objectivePlaceholder} /></label>
          <label className="full"><span>{copy.successCriteria}</span><textarea name="successCriteria" defaultValue={workflowDefaultText("successCriteria")} required rows={3} maxLength={2000} placeholder={copy.successPlaceholder} /></label>
          <label className="full"><span>{copy.workflowGuidance}</span><textarea name="workflowGuidance" defaultValue={workflowDefaultText("workflowGuidance")} rows={3} maxLength={4000} placeholder={copy.workflowGuidancePlaceholder} /><small className="fieldset-note">{copy.workflowGuidanceNote}</small></label>
        </div>
      </fieldset>
      {canonicalModule === "growth" ? <fieldset>
        <legend>{copy.growthFocusLegend}</legend>
        <div className="portal-field-grid">
          <label className="full"><span>{copy.offer}</span><textarea name="offer" defaultValue={workflowDefaultText("offer")} required rows={3} maxLength={4000} placeholder={copy.offerPlaceholder} /></label>
          <label className="full"><span>{copy.leadProfile}</span><textarea name="leadProfile" defaultValue={workflowDefaultText("leadProfile")} required rows={3} maxLength={4000} placeholder={copy.leadProfilePlaceholder} /></label>
          <label><span>{copy.pipelineContext}</span><textarea name="pipelineContext" defaultValue={workflowDefaultText("pipelineContext")} rows={3} maxLength={4000} placeholder={copy.pipelineContextPlaceholder} /></label>
          <label><span>{copy.campaignContext}</span><textarea name="campaignContext" defaultValue={workflowDefaultText("campaignContext")} rows={3} maxLength={4000} placeholder={copy.campaignContextPlaceholder} /></label>
          <label className="full"><span>{copy.conversionTarget}</span><textarea name="conversionTarget" defaultValue={workflowDefaultText("conversionTarget")} required rows={2} maxLength={2000} placeholder={copy.conversionTargetPlaceholder} /></label>
        </div>
      </fieldset> : canonicalModule === "operations" ? <fieldset>
        <legend>{flow === "general" ? (locale === "zh-Hant" ? "3. 自定義工作重點" : "3. Custom case focus") : copy.operationsFocusLegend}</legend>
        <div className="portal-field-grid">
          <label className="full"><span>{flow === "general" ? (locale === "zh-Hant" ? "下一步／需要決定" : "Next step / decision needed") : copy.decisionsNeeded}</span><textarea name="decisionsNeeded" defaultValue={workflowDefaultText("decisionsNeeded")} required rows={3} maxLength={40000} placeholder={flow === "general" ? (locale === "zh-Hant" ? "例如：確認下一位負責人及可行日期" : "e.g. Confirm the next owner and a workable date") : copy.decisionsNeededPlaceholder} /></label>
          <label><span>{flow === "general" ? (locale === "zh-Hant" ? "人物／持份者" : "People / stakeholders") : copy.owners}</span><textarea name="owners" defaultValue={workflowDefaultText("owners")} rows={3} maxLength={40000} placeholder={flow === "general" ? (locale === "zh-Hant" ? "例如：客戶、合作夥伴、內部負責人" : "e.g. Client, partner, internal owner") : copy.ownersPlaceholder} /></label>
          <label><span>{flow === "general" ? (locale === "zh-Hant" ? "限制／期限" : "Constraints / deadlines") : copy.deadlines}</span><textarea name="deadlines" defaultValue={workflowDefaultText("deadlines")} rows={3} maxLength={40000} placeholder={flow === "general" ? (locale === "zh-Hant" ? "例如：本週五前完成；不可影響現有交付" : "e.g. Complete by Friday; do not disrupt current delivery") : copy.deadlinesPlaceholder} /></label>
          <label className="full"><span>{flow === "general" ? (locale === "zh-Hant" ? "背景／目前情況" : "Background / current situation") : copy.sopContext}</span><textarea name="sopContext" defaultValue={workflowDefaultText("sopContext")} rows={3} maxLength={8000} placeholder={flow === "general" ? (locale === "zh-Hant" ? "描述目前發生甚麼、已嘗試甚麼及需要保留的脈絡" : "Describe what is happening, what has been tried, and the context to preserve") : copy.sopContextPlaceholder} /></label>
          <label><span>{flow === "general" ? (locale === "zh-Hant" ? "阻礙" : "Blockers") : copy.blockers}</span><textarea name="blockers" defaultValue={workflowDefaultText("blockers")} rows={3} maxLength={40000} placeholder={flow === "general" ? (locale === "zh-Hant" ? "例如：缺少資料、時間或負責人" : "e.g. Missing information, time, or an owner") : copy.blockersPlaceholder} /></label>
          <label><span>{flow === "general" ? (locale === "zh-Hant" ? "已知資料／證據" : "Known information / evidence") : copy.crossFunctionalSignals}</span><textarea name="crossFunctionalSignals" defaultValue={workflowDefaultText("crossFunctionalSignals")} rows={3} maxLength={40000} placeholder={flow === "general" ? (locale === "zh-Hant" ? "列出已知事實、訊號或來源" : "List known facts, signals, or sources") : copy.crossFunctionalSignalsPlaceholder} /></label>
        </div>
      </fieldset> : null}
      <LearningPicker candidatesByModule={learningCandidatesByModule ?? { growth: [], operations: [], intelligence: [] }} module={canonicalModule} />
      {canonicalModule === "intelligence" ? <fieldset>
        <legend>{customAudienceCopy.legend}</legend>
        <input type="hidden" name="audiencePreset" value="custom" />
        <p className="fieldset-note">{customAudienceCopy.note}</p>
        <div className="portal-field-grid">
          <label><span>{customAudienceCopy.knowledgeLevel}</span><input name="knowledgeLevel" defaultValue={workflowDefaultText("knowledgeLevel") || (locale === "zh-Hant" ? "熟悉相關範疇" : "Informed generalist")} maxLength={200} /></label>
          <label><span>{customAudienceCopy.tone}</span><input name="tone" defaultValue={workflowDefaultText("tone") || (locale === "zh-Hant" ? "清晰、踏實、簡潔" : "Clear, grounded, and concise")} maxLength={200} /></label>
          <label className="full"><span>{customAudienceCopy.goal}</span><input name="audienceGoal" defaultValue={workflowDefaultText("audienceGoal") || (locale === "zh-Hant" ? "理解決定及其影響" : "Understand the decision and implications")} maxLength={300} /></label>
          <label><span>{customAudienceCopy.format}</span><textarea name="format" defaultValue={workflowDefaultText("format") || (locale === "zh-Hant" ? "包含建議的結構化簡報" : "Structured brief with recommendations")} rows={3} maxLength={200} /></label>
          <label><span>{customAudienceCopy.boundaries}</span><textarea name="disclosureBoundaries" defaultValue={workflowDefaultText("disclosureBoundaries")} rows={3} placeholder={copy.boundariesPlaceholder} /></label>
        </div>
      </fieldset> : null}
      <fieldset>
        <legend>{canonicalModule === "intelligence" ? copy.sourceLegend : copy.sourceLegendShort}</legend>
        <div className="portal-field-grid">
          <label className="full" htmlFor={sourceTextId}><span>{copy.pasted}</span><textarea id={sourceTextId} name="sourceText" value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={7} maxLength={100000} placeholder={copy.pastedPlaceholderByModule[canonicalModule]} /></label>
          <SpeechToTextControl className="full speech-to-text-field" value={sourceText} onChange={setSourceText} locale={locale} disabled={state === "submitting" || localeSaving} targetTextareaId={sourceTextId} />
          <label className="full"><span>{copy.urls}</span><textarea name="sourceUrls" rows={3} placeholder={copy.urlPlaceholder} /></label>
          <div className="upload-placeholder full">
            <input ref={fileInputRef} id={inputId} className="visually-hidden" type="file" accept={ACCEPTED_FILE_TYPES} multiple tabIndex={-1} disabled={state === "submitting" || localeSaving || selectedFiles.length >= MAX_FILES} onChange={selectFiles} />
            <label htmlFor={inputId}><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg></span><div><strong>{selectedFiles.length ? `${selectedFiles.length} ${locale === "zh-Hant" ? "個檔案已選取" : `file${selectedFiles.length === 1 ? "" : "s"} selected`}` : uploadCopy.addFiles}</strong><small>{uploadCopy.helper(Math.max(0, MAX_FILES - selectedFiles.length))}</small></div></label>
            <button className="portal-secondary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={state === "submitting" || localeSaving || selectedFiles.length >= MAX_FILES}>{locale === "zh-Hant" ? "選擇檔案" : "Choose files"}</button>
            {selectedFiles.length ? <ul aria-label={locale === "zh-Hant" ? "已選檔案" : "Selected files"}>{selectedFiles.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}</ul> : null}
            {uploadMessage ? <p className="source-upload-status" role="status">{uploadMessage}</p> : null}
          </div>
        </div>
      </fieldset>
      <div className="form-action-bar"><div><strong>{copy.aiReady}</strong><span>{copy.reviewBeforeAction}</span></div><button className="portal-primary-button" type="submit" disabled={state === "submitting" || localeSaving}>{state === "submitting" ? copy.creating : copy.create}</button></div>
      {error ? <p className="portal-error" role="alert">{error}</p> : null}
    </form>
  );
}
