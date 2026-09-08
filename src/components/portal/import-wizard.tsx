"use client";

import Link from "next/link";
import { useId, useRef, useState, type ChangeEvent } from "react";
import { SpeechToTextControl } from "@/src/components/portal/browser-speech-to-text-control";
import { ACCEPTED_FILE_TYPES, MAX_FILE_BYTES, isLegacyPowerPointFile, normalizedSourceMime } from "@/src/lib/client/source-upload";
import { ClientSelector } from "@/src/components/portal/client-selector";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import { CASE_FLOWS, moduleForFlow, type CaseFlowKey } from "@/src/lib/domain/general-flow";

const MAX_IMPORT_FILES = 3;

type Source = { kind: "pasted" | "upload"; filename: string; mimeType: string; byteSize: number; sha256: string; extractedText: string; truncated: boolean };
type AudienceDraft = { preset: "custom"; knowledgeLevel: string; goal: string; tone: string; format: string; disclosureBoundaries: string[] };
type Proposal = { flow: CaseFlowKey; module: "growth" | "operations" | "intelligence"; title: string; objective: string; intakeContext: Record<string, unknown>; audience?: AudienceDraft; gaps: string[]; conflicts?: string[]; risks: string[]; checklist?: Array<{ id: string; label: string; required: boolean }>; evidenceMappings?: Array<{ filename: string; hash: string; supports: string[] }>; confidence: number };
type Failure = { filename: string; code: string };
type Client = { id: string; name: string; company?: string };
type BusyPhase = "idle" | "analysing" | "creating" | "generating";

const LIST_CONTEXT_FIELDS = new Set(["decisionsNeeded", "owners", "deadlines", "blockers", "crossFunctionalSignals"]);

function normalizeLines(value: unknown) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  return Array.from(new Set(items.map((item) => String(item).trim()).filter(Boolean)));
}

function contextText(context: Record<string, unknown>, field: string) {
  const value = context[field];
  return typeof value === "string" ? value : "";
}

function contextLines(context: Record<string, unknown>, field: string) {
  const value = context[field];
  return Array.isArray(value) ? value.map(String).join("\n") : typeof value === "string" ? value : "";
}

function validateImportFiles(files: readonly File[], locale: "en" | "zh-Hant"): string | null {
  const zh = locale === "zh-Hant";
  if (files.length > MAX_IMPORT_FILES) return zh ? `最多選擇 ${MAX_IMPORT_FILES} 個支援檔案。` : `Choose up to ${MAX_IMPORT_FILES} supported files.`;
  for (const file of files) {
    if (isLegacyPowerPointFile(file)) return zh ? `${file.name} 是舊版 PowerPoint，請先另存為未加密的 PPTX。` : `${file.name} is a legacy PowerPoint file. Save it as an unencrypted PPTX before uploading.`;
    if (!normalizedSourceMime(file)) return zh ? `${file.name} 不是支援的 PDF、DOCX、PPTX、TXT 或 MD 檔案。` : `${file.name} is not a supported PDF, DOCX, PPTX, TXT, or MD file.`;
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) return zh ? `${file.name} 必須介乎 1 位元組至 10 MB。` : `${file.name} must be between 1 byte and 10 MB.`;
  }
  return null;
}

export function ImportWizard({ locale = "en", demo = false, clients = [] }: { locale?: "en" | "zh-Hant"; demo?: boolean; clients?: Client[] }) {
  const zh = locale === "zh-Hant";
  const portalCopy = getPortalCopy(locale);
  const fieldCopy = portalCopy.newCase;
  const textId = useId().replace(/:/g, "");
  const fileInputId = useId().replace(/:/g, "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [flow, setFlow] = useState<CaseFlowKey | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [clientId, setClientId] = useState("");
  const [confirmedCaseId, setConfirmedCaseId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busyPhase, setBusyPhase] = useState<BusyPhase>("idle");
  const [message, setMessage] = useState("");
  const confirmIdempotencyRef = useRef<{ serialized: string; key: string } | null>(null);
  const confirmInFlightRef = useRef(false);
  const busy = busyPhase !== "idle";

  function invalidateAnalysis() {
    setSources([]);
    setFailures([]);
    setProposal(null);
    setConfirmedCaseId(null);
    setMessage("");
    confirmIdempotencyRef.current = null;
  }

  function selectFlow(next: CaseFlowKey) {
    if (next === flow) return;
    invalidateAnalysis();
    setError("");
    setFlow(next);
  }

  function changeSourceText(next: string) {
    setSourceText(next);
    invalidateAnalysis();
  }

  function resetImport() {
    setFiles([]);
    setSourceText("");
    setFlow(null);
    setClientId("");
    setError("");
    setBusyPhase("idle");
    confirmIdempotencyRef.current = null;
    invalidateAnalysis();
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files ?? []);
    event.target.value = "";
    const validationError = validateImportFiles(next, locale);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setFiles(next);
    invalidateAnalysis();
  }

  async function classify() {
    if (!flow) {
      setError(zh ? "請先選擇一條工作流。" : "Choose one work flow before analysis.");
      return;
    }
    setBusyPhase("analysing"); setError(""); setMessage(""); setConfirmedCaseId(null);
    try {
      const body = new FormData();
      body.append("flow", flow);
      files.forEach((file) => body.append("files", file));
      if (sourceText.trim()) body.append("text", sourceText);
      const response = await fetch("/api/imports/classify", { method: "POST", body });
      const value = await response.json() as { proposal?: Proposal; sources?: Source[]; failures?: Failure[]; error?: string; errorCode?: string };
      setFailures(value.failures ?? []);
      if (!response.ok) throw new Error(value.errorCode === "no_sources_extracted"
        ? (zh ? "所選檔案無法擷取；請按下方提示修正後再試。" : "The selected files could not be extracted. Follow the recovery guidance below and try again.")
        : value.error ?? (zh ? "輸入無法讀取。" : "The input could not be read."));
      if (!value.proposal || !value.sources) throw new Error(zh ? "輸入無法讀取。" : "The input could not be read.");
      if (value.proposal.flow !== flow || value.proposal.module !== moduleForFlow(flow)) throw new Error(zh ? "分析結果與所選工作流程不符。" : "The analysis did not match the selected work flow.");
      setProposal(value.proposal);
      setSources(value.sources);
    } catch (cause) { setError(cause instanceof Error ? cause.message : (zh ? "匯入失敗。" : "Import failed.")); }
    finally { setBusyPhase("idle"); }
  }

  function updateProposalField(field: "title" | "objective", value: string) {
    setProposal((current) => current ? { ...current, [field]: value } : current);
  }

  function updateContextField(field: string, value: string) {
    setProposal((current) => current ? {
      ...current,
      intakeContext: {
        ...current.intakeContext,
        [field]: LIST_CONTEXT_FIELDS.has(field) ? value.split("\n") : value,
      },
    } : current);
  }

  function updateAudienceField(field: keyof Omit<AudienceDraft, "preset">, value: string) {
    setProposal((current) => current?.audience ? {
      ...current,
      audience: {
        ...current.audience,
        [field]: field === "disclosureBoundaries" ? value.split("\n") : value,
      },
    } : current);
  }

  function reviewedAudience(current: Proposal) {
    if (current.flow !== "intelligence" || !current.audience) return undefined;
    return {
      ...current.audience,
      knowledgeLevel: current.audience.knowledgeLevel.trim(),
      goal: current.audience.goal.trim(),
      tone: current.audience.tone.trim(),
      format: current.audience.format.trim(),
      disclosureBoundaries: normalizeLines(current.audience.disclosureBoundaries),
    };
  }

  function reviewedContext(current: Proposal) {
    const shared = {
      schemaVersion: 1 as const,
      successCriteria: contextText(current.intakeContext, "successCriteria"),
      workflowGuidance: contextText(current.intakeContext, "workflowGuidance"),
    };
    if (current.flow === "growth") {
      return {
        ...shared,
        offer: contextText(current.intakeContext, "offer"),
        leadProfile: contextText(current.intakeContext, "leadProfile"),
        pipelineContext: contextText(current.intakeContext, "pipelineContext"),
        campaignContext: contextText(current.intakeContext, "campaignContext"),
        conversionTarget: contextText(current.intakeContext, "conversionTarget"),
      };
    }
    if (current.flow === "intelligence") return shared;
    return {
      ...shared,
      decisionsNeeded: normalizeLines(current.intakeContext.decisionsNeeded),
      owners: normalizeLines(current.intakeContext.owners),
      deadlines: normalizeLines(current.intakeContext.deadlines),
      sopContext: contextText(current.intakeContext, "sopContext"),
      blockers: normalizeLines(current.intakeContext.blockers),
      crossFunctionalSignals: normalizeLines(current.intakeContext.crossFunctionalSignals),
    };
  }

  function firstMissingField(current: Proposal) {
    const context = reviewedContext(current);
    if (!current.title.trim()) return { id: "guided-case-title", label: fieldCopy.caseTitle };
    if (!current.objective.trim()) return { id: "guided-objective", label: fieldCopy.objective };
    if (!context.successCriteria.trim()) return { id: "guided-success-criteria", label: fieldCopy.successCriteria };
    if (current.flow === "growth") {
      if (!contextText(current.intakeContext, "offer").trim()) return { id: "guided-offer", label: fieldCopy.offer.replace("*", "") };
      if (!contextText(current.intakeContext, "leadProfile").trim()) return { id: "guided-lead-profile", label: fieldCopy.leadProfile.replace("*", "") };
      if (!contextText(current.intakeContext, "conversionTarget").trim()) return { id: "guided-conversion-target", label: fieldCopy.conversionTarget.replace("*", "") };
    }
    if ((current.flow === "operations" || current.flow === "general") && !normalizeLines(current.intakeContext.decisionsNeeded).length) {
      return { id: "guided-decisions-needed", label: current.flow === "general" ? (zh ? "下一步／需要決定" : "Next step / decision needed") : fieldCopy.decisionsNeeded.replace("*", "") };
    }
    if (current.flow === "intelligence") {
      const audience = reviewedAudience(current);
      if (!audience?.knowledgeLevel) return { id: "guided-audience-knowledge", label: fieldCopy.knowledgeLevel };
      if (!audience.goal) return { id: "guided-audience-goal", label: fieldCopy.audienceGoal };
      if (!audience.tone) return { id: "guided-audience-tone", label: fieldCopy.tone };
      if (!audience.format) return { id: "guided-audience-format", label: fieldCopy.format };
    }
    return null;
  }

  async function confirm() {
    if (!proposal || confirmInFlightRef.current) return;
    const missing = firstMissingField(proposal);
    if (missing) {
      setError(zh ? `請先補充「${missing.label}」。` : `Complete “${missing.label}” before creating the case.`);
      document.getElementById(missing.id)?.focus();
      return;
    }
    confirmInFlightRef.current = true;
    setBusyPhase("creating"); setError(""); setMessage("");
    try {
      const audience = reviewedAudience(proposal);
      const semanticPayload = { flow: proposal.flow, title: proposal.title.trim(), brief: proposal.objective.trim(), intakeContext: reviewedContext(proposal), ...(audience ? { audience } : {}), sources, clientId: clientId || undefined };
      const serialized = JSON.stringify(semanticPayload);
      let stableRequest = confirmIdempotencyRef.current;
      if (!stableRequest || stableRequest.serialized !== serialized) {
        stableRequest = { serialized, key: crypto.randomUUID() };
        confirmIdempotencyRef.current = stableRequest;
      }
      const response = await fetch("/api/imports/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...semanticPayload, idempotencyKey: stableRequest.key }) });
      const value = await response.json() as { id?: string; error?: string; demo?: boolean };
      if (!response.ok || !value.id) throw new Error(value.error ?? (zh ? "未能確認匯入。" : "Import confirmation failed."));
      setConfirmedCaseId(value.id);
      if (demo || value.demo) {
        setMessage(zh ? "示範工作已準備好；示範模式不會儲存或產生真實內容。" : "The demo case is ready; demo mode does not persist or generate real content.");
        return;
      }
      setBusyPhase("generating");
      setMessage(zh ? "工作已建立，正在產生第一份修訂稿⋯" : "Case created. Generating the first draft…");
      const generationResponse = await fetch(`/api/cases/${value.id}/generate-revision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(audience ? { audience } : {}),
      });
      const generation = await generationResponse.json() as { error?: string };
      if (!generationResponse.ok) {
        setMessage(zh ? "工作已建立，但第一份修訂稿未能產生。請開啟工作查看狀態及再試。" : "The case was created, but the first draft could not be generated. Open the case to inspect its state and try again.");
        setError(generation.error ?? (zh ? "第一份修訂稿產生失敗。" : "First-draft generation failed."));
        return;
      }
      setMessage(zh ? "工作及第一份修訂稿已準備好。" : "The case and its first draft are ready.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : (zh ? "匯入失敗。" : "Import failed.")); }
    finally { confirmInFlightRef.current = false; setBusyPhase("idle"); }
  }

  const hasInput = Boolean(sourceText.trim() || files.length);
  const selectedFlowName = flow === "general"
    ? (zh ? "自定義" : "Custom")
    : flow ? portalCopy.today.modules[flow] : "";
  const confirmButtonLabel = busyPhase === "creating"
    ? (zh ? "建立工作中…" : "Creating case…")
    : busyPhase === "generating"
      ? (zh ? "產生第一份修訂稿中…" : "Generating first draft…")
      : (zh ? "確認並產生第一份修訂稿" : "Confirm and generate first draft");

  return <section className="portal-panel import-wizard" aria-labelledby="guided-import-title">
    <div className="artifact-heading"><div><p className="portal-kicker">{zh ? "引導匯入" : "Guided import"}</p><h2 id="guided-import-title">{zh ? "由來源提出可審閱的工作草稿" : "Propose a reviewable case draft from your sources"}</h2></div></div>
    <p>{zh ? "先選擇工作流，再貼上文字、加入語音轉錄，或選擇最多三個檔案。" : "Choose a work flow, then paste text, add a speech transcript, or choose up to three files."}</p>

    <fieldset className="guided-flow-picker">
      <legend>{zh ? "1. 選擇工作流" : "1. Choose a work flow"}</legend>
      <p className="fieldset-note">{zh ? "AI 會按你選擇的工作流，把錄音或來源內容填入對應欄位。" : "AI will use the selected flow to place source or transcript details into the matching fields."}</p>
      <div className="module-picker">
        {CASE_FLOWS.map((item) => {
          const label = item.key === "general" ? (zh ? "自定義" : "Custom") : portalCopy.today.modules[item.key];
          const description = item.key === "general"
            ? (zh ? "整理目標、背景、人物、證據、限制及下一步決定" : "Capture the goal, context, people, evidence, constraints, and next decision")
            : fieldCopy.moduleDescriptions[item.key];
          return <label className={`module-option ${flow === item.key ? "is-selected" : ""}`} key={item.key}>
            <input type="radio" name="guidedFlow" value={item.key} checked={flow === item.key} onChange={() => selectFlow(item.key)} disabled={busy || Boolean(confirmedCaseId)} />
            <span className={`case-module-mark ${item.accent}`}>{item.number}</span>
            <strong>{label}</strong>
            <small>{description}</small>
            <i aria-hidden="true">✓</i>
          </label>;
        })}
      </div>
    </fieldset>

    <fieldset>
      <legend>{zh ? "2. 加入來源資料" : "2. Add source material"}</legend>
      <div className="portal-field-grid">
        <label className="full" htmlFor={textId}><span>{zh ? "來源文字或語音轉錄（可選）" : "Source text or speech transcript (optional)"}</span><textarea id={textId} value={sourceText} onChange={(event) => changeSourceText(event.target.value)} rows={7} maxLength={100000} placeholder={zh ? "貼上簡報、會議記錄或其他工作脈絡…" : "Paste a brief, meeting notes, or other working context…"} disabled={busy || Boolean(confirmedCaseId)} /></label>
        <SpeechToTextControl className="full speech-to-text-field" value={sourceText} onChange={changeSourceText} locale={locale} disabled={busy || Boolean(confirmedCaseId)} targetTextareaId={textId} />
        <div className="upload-placeholder full">
          <input ref={fileInputRef} id={fileInputId} className="visually-hidden" type="file" multiple accept={ACCEPTED_FILE_TYPES} tabIndex={-1} onChange={selectFiles} disabled={busy || Boolean(confirmedCaseId) || files.length >= MAX_IMPORT_FILES} />
          <label htmlFor={fileInputId}><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg></span><div><strong>{files.length ? `${files.length} ${zh ? "個檔案已選取" : `file${files.length === 1 ? "" : "s"} selected`}` : (zh ? "加入支援檔案" : "Add supported files")}</strong><small>{zh ? `最多 ${MAX_IMPORT_FILES} 個 PDF、DOCX、PPTX、TXT 或 MD；每個檔案上限 10 MB。` : `Up to ${MAX_IMPORT_FILES} PDF, DOCX, PPTX, TXT, or MD files; 10 MB each.`}</small></div></label>
          <button className="portal-secondary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || Boolean(confirmedCaseId) || files.length >= MAX_IMPORT_FILES}>{zh ? "選擇檔案" : "Choose files"}</button>
          {files.length ? <ul aria-label={zh ? "已選檔案" : "Selected files"}>{files.map((file) => <li key={`${file.name}-${file.size}-${file.lastModified}`}>{file.name}</li>)}</ul> : null}
        </div>
        <ClientSelector clients={clients} value={clientId} onChange={setClientId} locale={locale} demo={demo} disabled={busy || Boolean(confirmedCaseId)} />
      </div>
    </fieldset>
    {failures.length ? <p className="portal-error" role="status">{zh ? "擷取失敗：" : "Extraction failures: "}{failures.map((failure) => `${failure.filename} (${failure.code === "powerpoint_binary_or_encrypted_unsupported" ? (zh ? "請另存為未加密的 PPTX" : "save as an unencrypted PPTX") : failure.code === "pptx_parse_failed" ? (zh ? "PPTX 內容無法讀取" : "PPTX could not be read") : failure.code === "pptx_parser_unavailable" ? (zh ? "PPTX 讀取器暫時不可用" : "PPTX reader unavailable") : failure.code})`).join("; ")}</p> : null}
    <div className="form-action-bar"><div><strong>{zh ? "系統只會先準備可審閱草稿。" : "AI prepares a reviewable draft first."}</strong><span>{zh ? "確認前不會建立工作。" : "No case is created before your confirmation."}</span></div><button type="button" className="portal-primary-button" onClick={classify} disabled={!flow || !hasInput || busy || Boolean(confirmedCaseId)}>{busyPhase === "analysing" ? (zh ? "分析中…" : "Analysing…") : (zh ? "分析並提出草稿" : "Analyse and propose draft")}</button></div>

    {proposal ? <div className="import-proposal" aria-live="polite">
      <fieldset className="import-proposal-fieldset"><legend>{zh ? "3. 審閱及修訂草稿" : "3. Review and edit the draft"}</legend>
        <div className="portal-field-grid">
          <div className="import-source-list full">
            <p className="portal-kicker">{zh ? "已擷取來源" : "Extracted sources"} · {Math.round(proposal.confidence * 100)}% {zh ? "信心" : "confidence"}</p>
            <ul aria-label={zh ? "已擷取來源" : "Extracted sources"}>{sources.map((source) => <li key={source.sha256}><strong>{source.kind === "pasted" ? (zh ? "已貼上的文字或語音內容" : "Pasted or dictated notes") : source.filename}</strong><span>{source.truncated ? (zh ? "只讀取了部分內容" : "Partially read") : (zh ? "已完整讀取" : "Fully read")}</span></li>)}</ul>
          </div>
          <div className="import-readonly-field"><span>{zh ? "工作流" : "Work flow"}</span><strong>{selectedFlowName}</strong></div>
          <label><span>{fieldCopy.caseTitle}</span><input id="guided-case-title" value={proposal.title} maxLength={200} onChange={(event) => updateProposalField("title", event.target.value)} disabled={busy || Boolean(confirmedCaseId)} /></label>
          <label className="full"><span>{fieldCopy.objective}</span><textarea id="guided-objective" value={proposal.objective} maxLength={20000} onChange={(event) => updateProposalField("objective", event.target.value)} rows={5} disabled={busy || Boolean(confirmedCaseId)} /></label>
          <section className="import-context-fields full" aria-labelledby="guided-case-details-title">
            <div><p className="portal-kicker">{zh ? "工作資料" : "Case details"}</p><h3 id="guided-case-details-title">{zh ? "按工作流整理的欄位" : "Fields for this work flow"}</h3></div>
            <div className="portal-field-grid">
              <label className="full"><span>{fieldCopy.successCriteria}</span><textarea id="guided-success-criteria" value={contextText(proposal.intakeContext, "successCriteria")} onChange={(event) => updateContextField("successCriteria", event.target.value)} rows={3} maxLength={2000} disabled={busy || Boolean(confirmedCaseId)} /></label>
              <label className="full"><span>{fieldCopy.workflowGuidance}</span><textarea value={contextText(proposal.intakeContext, "workflowGuidance")} onChange={(event) => updateContextField("workflowGuidance", event.target.value)} rows={3} maxLength={4000} disabled={busy || Boolean(confirmedCaseId)} /><small className="fieldset-note">{fieldCopy.workflowGuidanceNote}</small></label>
              {proposal.flow === "growth" ? <>
                <label className="full"><span>{fieldCopy.offer}</span><textarea id="guided-offer" value={contextText(proposal.intakeContext, "offer")} onChange={(event) => updateContextField("offer", event.target.value)} rows={3} maxLength={4000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label className="full"><span>{fieldCopy.leadProfile}</span><textarea id="guided-lead-profile" value={contextText(proposal.intakeContext, "leadProfile")} onChange={(event) => updateContextField("leadProfile", event.target.value)} rows={3} maxLength={4000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{fieldCopy.pipelineContext}</span><textarea value={contextText(proposal.intakeContext, "pipelineContext")} onChange={(event) => updateContextField("pipelineContext", event.target.value)} rows={3} maxLength={4000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{fieldCopy.campaignContext}</span><textarea value={contextText(proposal.intakeContext, "campaignContext")} onChange={(event) => updateContextField("campaignContext", event.target.value)} rows={3} maxLength={4000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label className="full"><span>{fieldCopy.conversionTarget}</span><textarea id="guided-conversion-target" value={contextText(proposal.intakeContext, "conversionTarget")} onChange={(event) => updateContextField("conversionTarget", event.target.value)} rows={2} maxLength={2000} disabled={busy || Boolean(confirmedCaseId)} /></label>
              </> : proposal.flow === "operations" || proposal.flow === "general" ? <>
                <label className="full"><span>{proposal.flow === "general" ? (zh ? "下一步／需要決定*" : "Next step / decision needed*") : fieldCopy.decisionsNeeded}</span><textarea id="guided-decisions-needed" value={contextLines(proposal.intakeContext, "decisionsNeeded")} onChange={(event) => updateContextField("decisionsNeeded", event.target.value)} rows={3} maxLength={40000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{proposal.flow === "general" ? (zh ? "人物／持份者" : "People / stakeholders") : fieldCopy.owners}</span><textarea value={contextLines(proposal.intakeContext, "owners")} onChange={(event) => updateContextField("owners", event.target.value)} rows={3} maxLength={40000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{proposal.flow === "general" ? (zh ? "限制／期限" : "Constraints / deadlines") : fieldCopy.deadlines}</span><textarea value={contextLines(proposal.intakeContext, "deadlines")} onChange={(event) => updateContextField("deadlines", event.target.value)} rows={3} maxLength={40000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label className="full"><span>{proposal.flow === "general" ? (zh ? "背景／目前情況" : "Background / current situation") : fieldCopy.sopContext}</span><textarea value={contextText(proposal.intakeContext, "sopContext")} onChange={(event) => updateContextField("sopContext", event.target.value)} rows={3} maxLength={8000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{proposal.flow === "general" ? (zh ? "阻礙" : "Blockers") : fieldCopy.blockers}</span><textarea value={contextLines(proposal.intakeContext, "blockers")} onChange={(event) => updateContextField("blockers", event.target.value)} rows={3} maxLength={40000} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{proposal.flow === "general" ? (zh ? "已知資料／證據" : "Known information / evidence") : fieldCopy.crossFunctionalSignals}</span><textarea value={contextLines(proposal.intakeContext, "crossFunctionalSignals")} onChange={(event) => updateContextField("crossFunctionalSignals", event.target.value)} rows={3} maxLength={40000} disabled={busy || Boolean(confirmedCaseId)} /></label>
              </> : proposal.flow === "intelligence" && proposal.audience ? <>
                <label><span>{fieldCopy.knowledgeLevel}</span><input id="guided-audience-knowledge" value={proposal.audience.knowledgeLevel} onChange={(event) => updateAudienceField("knowledgeLevel", event.target.value)} maxLength={200} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{fieldCopy.tone}</span><input id="guided-audience-tone" value={proposal.audience.tone} onChange={(event) => updateAudienceField("tone", event.target.value)} maxLength={200} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label className="full"><span>{fieldCopy.audienceGoal}</span><input id="guided-audience-goal" value={proposal.audience.goal} onChange={(event) => updateAudienceField("goal", event.target.value)} maxLength={500} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{fieldCopy.format}</span><textarea id="guided-audience-format" value={proposal.audience.format} onChange={(event) => updateAudienceField("format", event.target.value)} rows={3} maxLength={200} disabled={busy || Boolean(confirmedCaseId)} /></label>
                <label><span>{fieldCopy.boundaries}</span><textarea value={proposal.audience.disclosureBoundaries.join("\n")} onChange={(event) => updateAudienceField("disclosureBoundaries", event.target.value)} rows={3} maxLength={10000} disabled={busy || Boolean(confirmedCaseId)} /></label>
              </> : null}
            </div>
          </section>
        </div>
      </fieldset>

      <div className="import-review-grid">
        <section className="import-review-card" aria-labelledby="guided-gaps-title"><h3 id="guided-gaps-title">{zh ? "待確認缺口" : "Gaps to confirm"}</h3>{proposal.gaps.length ? <ul>{proposal.gaps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>{zh ? "暫時未發現缺口。" : "No gaps identified yet."}</p>}</section>
        <section className="import-review-card" aria-labelledby="guided-risks-title"><h3 id="guided-risks-title">{zh ? "風險" : "Risks"}</h3>{proposal.risks.length ? <ul>{proposal.risks.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>{zh ? "暫時未發現風險。" : "No risks identified yet."}</p>}</section>
        <section className="import-review-card" aria-labelledby="guided-checklist-title"><h3 id="guided-checklist-title">{zh ? "檢查清單" : "Checklist"}</h3>{proposal.checklist?.length ? <ul>{proposal.checklist.map((item) => <li key={item.id}>{item.label}{item.required ? <small>{zh ? "必須確認" : "Required"}</small> : null}</li>)}</ul> : <p>{zh ? "未有額外檢查項目。" : "No additional checks yet."}</p>}</section>
        {proposal.conflicts?.length ? <section className="import-review-card" aria-labelledby="guided-conflicts-title"><h3 id="guided-conflicts-title">{zh ? "資料衝突" : "Conflicts"}</h3><ul>{proposal.conflicts.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section> : null}
      </div>

      <div className="form-action-bar"><div><strong>{zh ? "確認後會建立工作並產生第一份修訂稿。" : "Confirmation creates the case and its first draft."}</strong><span>{zh ? "完成後仍要由你審閱及審批。" : "You will still review and approve the result."}</span></div><button type="button" className="portal-primary-button" onClick={confirm} disabled={busy || Boolean(confirmedCaseId)}>{confirmButtonLabel}</button></div>
    </div> : null}

    {confirmedCaseId ? <div className="import-confirmed-links" role="status"><p>{message}</p><div className="button-row"><Link className="portal-secondary-button case-open-button" href={`/app/cases/${confirmedCaseId}`}>{zh ? "開啟工作" : "Open case"}</Link><Link className="portal-secondary-button" href={`/app/intakes?case=${encodeURIComponent(confirmedCaseId)}#initial-intake-${encodeURIComponent(confirmedCaseId)}`}>{zh ? "查看初始輸入" : "View initial inputs"}</Link><button type="button" className="portal-secondary-button" onClick={resetImport} disabled={busy}>{zh ? "開始另一個匯入" : "Start another import"}</button></div></div> : null}
    {!confirmedCaseId && message ? <p role="status">{message}</p> : null}
    {error ? <p className="portal-error" role="alert">{error}</p> : null}
  </section>;
}
