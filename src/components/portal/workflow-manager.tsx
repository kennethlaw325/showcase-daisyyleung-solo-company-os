"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import type { ModuleKey, WorkflowChecklistItem, WorkflowGoalMode, WorkflowStream } from "@/src/lib/domain/types";

type FormState = {
  baseModule: ModuleKey;
  name: string;
  description: string;
  goalMode: WorkflowGoalMode;
  intakeDefaultsText: string;
  checklistText: string;
  gmail: boolean;
};

const EMPTY_FORM: FormState = {
  baseModule: "operations",
  name: "",
  description: "",
  goalMode: "decision",
  intakeDefaultsText: "{}",
  checklistText: "",
  gmail: true,
};

function editableIntakeDefaults(stream: WorkflowStream): Record<string, unknown> {
  const visibleDefaults: Record<string, unknown> = { ...stream.intake_defaults };
  delete visibleDefaults.schemaVersion;
  delete visibleDefaults.flowKey;
  return visibleDefaults;
}

function withPreservedInternalDefaults(visibleDefaults: Record<string, unknown>, stream: WorkflowStream | null): Record<string, unknown> {
  if (!stream) return { ...visibleDefaults, schemaVersion: 1, flowKey: "general" };
  return {
    ...visibleDefaults,
    ...(stream.intake_defaults.schemaVersion === 1 ? { schemaVersion: 1 } : {}),
    ...(stream.intake_defaults.flowKey === "general" ? { flowKey: "general" } : {}),
  };
}

function formFromStream(stream: WorkflowStream): FormState {
  return {
    baseModule: stream.base_module,
    name: stream.name,
    description: stream.description,
    goalMode: stream.goal_mode,
    intakeDefaultsText: JSON.stringify(editableIntakeDefaults(stream), null, 2),
    checklistText: stream.checklist.map((item) => item.label).join("\n"),
    gmail: stream.stage_visibility.gmail,
  };
}

function checklistFromText(value: string): WorkflowChecklistItem[] {
  return value.split("\n").map((label) => label.trim()).filter(Boolean).slice(0, 30).map((label, index) => ({
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || `step-${index + 1}`,
    label,
    required: true,
  }));
}

export function WorkflowManager({ demo, initialWorkflows }: { demo: boolean; initialWorkflows: WorkflowStream[] }) {
  const { locale, localeSaving } = useLocale();
  const copy = getPortalCopy(locale).workflows;
  const goalModeLabels: Record<WorkflowGoalMode, string> = locale === "zh-Hant"
    ? { outcome: "結果", decision: "決策", project: "專案", checklist: "檢查清單" }
    : { outcome: "Outcome", decision: "Decision", project: "Project", checklist: "Checklist" };
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [editing, setEditing] = useState<WorkflowStream | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const createIdempotencyRef = useRef<{ serialized: string; key: string } | null>(null);
  const saveInFlightRef = useRef(false);
  const active = useMemo(() => workflows.filter((stream) => stream.status === "active"), [workflows]);

  function startCreate() {
    createIdempotencyRef.current = null;
    setEditing(null);
    setEditorOpen(true);
    setForm(EMPTY_FORM);
    setError("");
  }

  function startEdit(stream: WorkflowStream) {
    createIdempotencyRef.current = null;
    setEditing(stream);
    setEditorOpen(true);
    setForm(formFromStream(stream));
    setError("");
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (saveInFlightRef.current || state === "saving") return;
    saveInFlightRef.current = true;
    setState("saving");
    setError("");
    try {
      const parsedIntakeDefaults = JSON.parse(form.intakeDefaultsText) as unknown;
      if (!parsedIntakeDefaults || typeof parsedIntakeDefaults !== "object" || Array.isArray(parsedIntakeDefaults)) {
        throw new Error(copy.error);
      }
      const intakeDefaults = withPreservedInternalDefaults(parsedIntakeDefaults as Record<string, unknown>, editing);
      const payload = {
        // New workflows use the general/custom flow internally. Existing
        // revisions keep the module that was stored with their source stream.
        baseModule: editing ? form.baseModule : "operations" as const,
        name: form.name,
        description: form.description,
        goalMode: editing ? form.goalMode : "decision" as const,
        intakeDefaults,
        checklist: checklistFromText(form.checklistText),
        stageVisibility: { intake: true, artifact: true, approval: true, gmail: form.gmail, outcome: true },
      };
      let requestBody: Record<string, unknown> = editing
        ? { ...payload, expectedVersion: editing.version }
        : payload;
      if (!editing) {
        const serialized = JSON.stringify(payload);
        let stableRequest = createIdempotencyRef.current;
        if (!stableRequest || stableRequest.serialized !== serialized) {
          stableRequest = { serialized, key: crypto.randomUUID() };
          createIdempotencyRef.current = stableRequest;
        }
        requestBody = { ...payload, idempotencyKey: stableRequest.key };
      }
      const response = await fetch(editing ? `/api/workflows/${editing.id}` : "/api/workflows", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const body = await response.json() as { workflow?: WorkflowStream; error?: string };
      if (!response.ok || !body.workflow) throw new Error(body.error ?? copy.error);
      setWorkflows((current) => editing
        ? [...current.map((stream) => stream.id === editing.id ? { ...stream, status: "archived" as const } : stream), body.workflow!]
        : [body.workflow!, ...current]);
      setEditing(null);
      setEditorOpen(false);
      setForm(EMPTY_FORM);
      setState("idle");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      saveInFlightRef.current = false;
    }
  }

  async function archive(stream: WorkflowStream) {
    setState("saving");
    setError("");
    try {
      const response = await fetch(`/api/workflows/${stream.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive", expectedVersion: stream.version }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.error);
      setWorkflows((current) => current.map((item) => item.id === stream.id ? { ...item, status: "archived" as const } : item));
      setState("idle");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : copy.error);
    }
  }

  return (
    <section className="workflow-manager" aria-label={copy.title}>
      <div className="workflow-manager-toolbar"><button type="button" className="portal-primary-button" onClick={startCreate} disabled={localeSaving || demo}>{copy.create}</button></div>
      {demo ? <p className="fieldset-note workflow-demo-note">{copy.fixed}</p> : null}
      <div className="workflow-stream-list">
        {workflows.length ? workflows.map((stream) => {
          return <article className={`portal-panel workflow-stream-card ${stream.status === "archived" ? "is-archived" : ""}`} key={stream.id}>
            <header><div><h3>{stream.name}</h3><p>{stream.description || " "}</p></div><span className={`workflow-stream-status ${stream.status}`}>{stream.status === "active" ? copy.active : copy.archived} · {copy.version(stream.version)}</span></header>
            <dl><div><dt>{copy.goalMode}</dt><dd>{goalModeLabels[stream.goal_mode]}</dd></div><div><dt>{copy.versionLabel}</dt><dd>{copy.version(stream.version)}</dd></div><div><dt>{copy.checklist}</dt><dd>{stream.checklist.length}</dd></div><div><dt>{copy.gmail}</dt><dd>{stream.stage_visibility.gmail ? (locale === "zh-Hant" ? "開" : "On") : (locale === "zh-Hant" ? "關" : "Off")}</dd></div></dl>
            {stream.status === "active" ? <footer><button type="button" className="portal-secondary-button" onClick={() => startEdit(stream)} disabled={demo || state === "saving"}>{copy.edit}</button><button type="button" className="portal-secondary-button is-danger" onClick={() => archive(stream)} disabled={demo || state === "saving"}>{copy.archive}</button></footer> : null}
          </article>;
        }) : <div className="portal-panel no-outcome-card"><strong>{copy.noStreams}</strong></div>}
      </div>
      {!demo && editorOpen ? <div className="portal-panel workflow-editor-panel">
        <header><div><p className="portal-kicker">{editing ? copy.edit : copy.create}</p><h2>{editing?.name ?? copy.create}</h2></div><button type="button" className="portal-secondary-button" onClick={() => { setEditing(null); setEditorOpen(false); setForm(EMPTY_FORM); }}>{copy.cancel}</button></header>
        <div className="portal-field-grid">
          <label><span>{copy.name}</span><input value={form.name} maxLength={120} placeholder={copy.namePlaceholder} onChange={(event) => updateForm("name", event.target.value)} required /></label>
          <label className="full"><span>{copy.description}</span><textarea value={form.description} maxLength={2000} rows={3} onChange={(event) => updateForm("description", event.target.value)} /></label>
          <label><span>{copy.goalMode}</span><select value={form.goalMode} disabled={!editing} onChange={(event) => updateForm("goalMode", event.target.value as WorkflowGoalMode)}>{(["outcome", "decision", "project", "checklist"] as WorkflowGoalMode[]).map((mode) => <option value={mode} key={mode}>{goalModeLabels[mode]}</option>)}</select></label>
          <label className="full"><span>{copy.intakeDefaults}</span><textarea value={form.intakeDefaultsText} rows={5} onChange={(event) => updateForm("intakeDefaultsText", event.target.value)} /></label>
          <label className="full"><span>{copy.checklist}</span><textarea value={form.checklistText} rows={4} placeholder={copy.checklistHint} onChange={(event) => updateForm("checklistText", event.target.value)} /></label>
          <label className="workflow-checkbox"><input type="checkbox" checked={form.gmail} onChange={(event) => updateForm("gmail", event.target.checked)} /><span>{copy.gmail}</span></label>
        </div>
        <button type="button" className="portal-primary-button" onClick={save} disabled={state === "saving" || localeSaving}>{state === "saving" ? copy.saving : copy.save}</button>
        {error ? <p className="portal-error" role="alert">{error}</p> : null}
      </div> : null}
      {active.length === 0 && workflows.length > 0 ? <p className="fieldset-note">{copy.noStreams}</p> : null}
    </section>
  );
}
