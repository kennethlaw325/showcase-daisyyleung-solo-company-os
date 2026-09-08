"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { buildDefaultActionDraft } from "@/src/lib/presentation/human-readable";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import type { Locale } from "@/src/lib/i18n/locale";
import type { ActionPayload, CaseStatus, ModuleKey } from "@/src/lib/domain/types";
import type { ActionDraftTemplate } from "@/src/lib/presentation/human-readable";

type ActionDraftEditorProps = {
  caseId: string;
  expectedRevision?: number;
  title: string;
  summary: string;
  body: string;
  nextAction: string;
  contentLocale?: Locale;
  module?: ModuleKey;
  caseStatus?: CaseStatus;
  action?: Pick<ActionPayload, "to" | "cc" | "bcc" | "subject" | "body" | "thread_id"> | null;
  onCancel?: () => void;
  demo?: boolean;
};

const ACTION_BODY_MAX_LENGTH = 100_000;

function replaceTextareaSelection(textarea: HTMLTextAreaElement, nextValue: string, selectionStart: number, selectionEnd: number): void {
  if (nextValue.length > ACTION_BODY_MAX_LENGTH) return;
  textarea.value = nextValue;
  textarea.focus();
  textarea.setSelectionRange(selectionStart, selectionEnd);
}

function applyInlineMarker(textarea: HTMLTextAreaElement, marker: "**" | "_" | "=="): void {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  if (start !== end) {
    const before = value.slice(Math.max(0, start - marker.length), start);
    const after = value.slice(end, end + marker.length);
    if (before === marker && after === marker) {
      replaceTextareaSelection(textarea, `${value.slice(0, start - marker.length)}${selected}${value.slice(end + marker.length)}`, start - marker.length, end - marker.length);
      return;
    }
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
      replaceTextareaSelection(textarea, `${value.slice(0, start)}${selected.slice(marker.length, -marker.length)}${value.slice(end)}`, start, end - marker.length * 2);
      return;
    }
  }
  const insertion = `${marker}${selected}${marker}`;
  replaceTextareaSelection(textarea, `${value.slice(0, start)}${insertion}${value.slice(end)}`, start + marker.length, start + marker.length + selected.length);
}

function lineRange(value: string, start: number, end: number): { start: number; end: number } {
  const rangeStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  // A selection ending immediately after a newline ends on the previous
  // line; do not unexpectedly format the next line as well.
  const effectiveEnd = end > start && end > 0 && value[end - 1] === "\n" ? end - 1 : end;
  const nextNewline = value.indexOf("\n", effectiveEnd);
  return { start: rangeStart, end: nextNewline < 0 ? value.length : nextNewline };
}

function applyListMarker(textarea: HTMLTextAreaElement, kind: "bullet" | "number"): void {
  const value = textarea.value;
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const range = lineRange(value, selectionStart, selectionEnd);
  const selectedLines = value.slice(range.start, range.end).split("\n");
  const nonBlank = selectedLines.filter((line) => line.trim().length > 0);
  if (!nonBlank.length) return;
  const bulletPattern = /^(\s*)-\s+(.*)$/;
  const numberPattern = /^(\s*)\d+\.\s+(.*)$/;
  const allSameKind = nonBlank.every((line) => (kind === "bullet" ? bulletPattern.test(line) : numberPattern.test(line)));
  let nextNumber = 1;
  const nextLines = selectedLines.map((line) => {
    if (!line.trim()) return line;
    const bullet = line.match(bulletPattern);
    const numbered = line.match(numberPattern);
    if (allSameKind) {
      if (kind === "bullet" && bullet) return `${bullet[1]}${bullet[2]}`;
      if (kind === "number" && numbered) return `${numbered[1]}${numbered[2]}`;
    }
    const indentation = bullet?.[1] ?? numbered?.[1] ?? line.match(/^\s*/)?.[0] ?? "";
    const content = bullet?.[2] ?? numbered?.[2] ?? line.trimStart();
    if (kind === "bullet") return `${indentation}- ${content}`;
    const numberedLine = `${indentation}${nextNumber}. ${content}`;
    nextNumber += 1;
    return numberedLine;
  });
  const replacement = nextLines.join("\n");
  replaceTextareaSelection(textarea, `${value.slice(0, range.start)}${replacement}${value.slice(range.end)}`, range.start, range.start + replacement.length);
}

export function ActionDraftEditor({
  caseId,
  expectedRevision = 1,
  title,
  summary,
  body: artifactBody,
  nextAction,
  contentLocale = "en",
  module = "growth",
  action = null,
  onCancel,
  demo = false,
}: ActionDraftEditorProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = getPortalCopy(locale).actionDraft;
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [draftTemplate, setDraftTemplate] = useState<ActionDraftTemplate>("detailed");
  const subjectRef = useRef<HTMLInputElement>(null);
  const actionBodyRef = useRef<HTMLTextAreaElement>(null);
  const actionBodyId = useId();
  const draftSource = { title, summary, body: artifactBody, nextAction };
  const defaultDraft = buildDefaultActionDraft(draftSource, contentLocale);
  const isEditing = Boolean(onCancel);
  const needsAction = module !== "intelligence";
  const canChooseTemplate = needsAction && !action;

  function applyDraftTemplate(template: ActionDraftTemplate) {
    const nextDraft = buildDefaultActionDraft(draftSource, contentLocale, template);
    setDraftTemplate(template);
    if (subjectRef.current) subjectRef.current.value = nextDraft.subject;
    if (actionBodyRef.current) actionBodyRef.current.value = nextDraft.body;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setError("");
    const form = new FormData(event.currentTarget);
    const recipients = (name: string) => String(form.get(name) ?? "")
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const cc = recipients("cc");
    const bcc = recipients("bcc");
    const threadId = String(form.get("threadId") ?? "").trim();
    const payload = {
      expectedRevision,
      title: form.get("title"),
      summary: form.get("summary"),
      body: form.get("artifactBody"),
      nextAction: form.get("nextAction"),
      ...(needsAction
        ? {
            action: {
              to: form.get("to"),
              ...(cc.length ? { cc } : {}),
              ...(bcc.length ? { bcc } : {}),
              subject: form.get("subject"),
              body: form.get("actionBody"),
              ...(threadId ? { thread_id: threadId } : {}),
            },
          }
        : {}),
    };
    if (demo) {
      // Showcase build has no API routes: confirm the new draft locally instead of failing.
      setSavedRevision(expectedRevision + 1);
      setState("saved");
      return;
    }
    try {
      const response = await fetch(`/api/cases/${caseId}/revision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string; artifact?: { revision?: number } };
      if (!response.ok) {
        const message = response.status === 409 && result.error === "no changes to save" ? copy.noChangeError : response.status === 409 ? copy.staleError : result.error ?? copy.error;
        throw new Error(message);
      }
      setSavedRevision(result.artifact?.revision ?? expectedRevision + 1);
      setState("saved");
      // The server page now renders the new awaiting-approval revision. Keep
      // the success state long enough for screen readers before refreshing.
      window.setTimeout(() => router.refresh(), 180);
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : copy.error);
    }
  }

  return (
    <form className="portal-panel action-draft-editor" onSubmit={submit}>
      <div className="artifact-heading">
        <div>
          <p className="portal-kicker">{isEditing ? copy.editKicker : copy.kicker}</p>
          <h2>{isEditing ? copy.editTitle : copy.title}</h2>
        </div>
        <span>{isEditing ? copy.editCreates : copy.creates}</span>
      </div>
      <p>{isEditing ? copy.editBody : copy.body}</p>
      <div className="portal-field-grid">
        <label className="full"><span>{locale === "zh-Hant" ? "標題" : "Title"}</span><input name="title" required maxLength={200} defaultValue={title} /></label>
        <label className="full"><span>{locale === "zh-Hant" ? "摘要" : "Summary"}</span><textarea name="summary" required rows={4} maxLength={20000} defaultValue={summary} /></label>
        <label className="full"><span>{locale === "zh-Hant" ? "工作內容" : "Working content"}</span><textarea name="artifactBody" required rows={8} maxLength={100000} defaultValue={artifactBody} /></label>
        <label className="full"><span>{locale === "zh-Hant" ? "下一步" : "Next action"}</span><textarea name="nextAction" required rows={3} maxLength={2000} defaultValue={nextAction} /></label>
        {needsAction ? <>
          {canChooseTemplate ? <fieldset className="full email-draft-template-picker">
            <legend>{locale === "zh-Hant" ? "選擇草稿格式" : "Choose draft format"}</legend>
            <div className="email-draft-template-options">
              <label className={draftTemplate === "detailed" ? "is-selected" : ""}>
                <input type="radio" name="emailDraftTemplate" value="detailed" checked={draftTemplate === "detailed"} onChange={() => applyDraftTemplate("detailed")} />
                <strong>{locale === "zh-Hant" ? "詳細版" : "Detailed"}</strong>
                <small>{locale === "zh-Hant" ? "完整包含摘要、詳情及下一步。" : "Includes the full summary, details, and next step."}</small>
              </label>
              <label className={draftTemplate === "key-points" ? "is-selected" : ""}>
                <input type="radio" name="emailDraftTemplate" value="key-points" checked={draftTemplate === "key-points"} onChange={() => applyDraftTemplate("key-points")} />
                <strong>{locale === "zh-Hant" ? "重點版" : "Key points"}</strong>
                <small>{locale === "zh-Hant" ? "最多三個重點，加上明確跟進事項。" : "Up to three key points with one explicit action."}</small>
              </label>
            </div>
            <p>{locale === "zh-Hant" ? "切換格式會重新產生下方主旨及內文；建立前仍可修改。" : "Switching format regenerates the subject and body below. You can still edit both before creation."}</p>
          </fieldset> : null}
          <label><span>{copy.recipient}</span><input name="to" type="email" required placeholder="client@example.com" defaultValue={action?.to ?? ""} /></label>
          <label><span>{copy.cc}</span><input name="cc" type="text" placeholder="copy@example.com, another@example.com" defaultValue={action?.cc?.join(", ") ?? ""} /></label>
          <label><span>{copy.bcc}</span><input name="bcc" type="text" placeholder="blind@example.com" defaultValue={action?.bcc?.join(", ") ?? ""} /></label>
          <label><span>{copy.subject}</span><input ref={subjectRef} name="subject" required maxLength={998} defaultValue={action?.subject ?? defaultDraft.subject} placeholder={copy.subject} /></label>
          <label><span>{copy.thread}</span><input name="threadId" maxLength={255} defaultValue={action?.thread_id ?? ""} placeholder={locale === "zh-Hant" ? "可選的 Gmail 對話串 ID" : "Optional Gmail thread ID"} /></label>
          <div className="full action-body-field">
            <label htmlFor={actionBodyId}>{copy.draftBody}</label>
            <div className="email-format-toolbar" role="toolbar" aria-label={copy.toolbar.label}>
              <button type="button" title={copy.toolbar.bold} aria-label={copy.toolbar.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (actionBodyRef.current) applyInlineMarker(actionBodyRef.current, "**"); }} disabled={state === "saving" || state === "saved"}>{copy.toolbar.bold}</button>
              <button type="button" title={copy.toolbar.italic} aria-label={copy.toolbar.italic} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (actionBodyRef.current) applyInlineMarker(actionBodyRef.current, "_"); }} disabled={state === "saving" || state === "saved"}>{copy.toolbar.italic}</button>
              <button type="button" title={copy.toolbar.highlight} aria-label={copy.toolbar.highlight} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (actionBodyRef.current) applyInlineMarker(actionBodyRef.current, "=="); }} disabled={state === "saving" || state === "saved"}>{copy.toolbar.highlight}</button>
              <button type="button" title={copy.toolbar.bulletList} aria-label={copy.toolbar.bulletList} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (actionBodyRef.current) applyListMarker(actionBodyRef.current, "bullet"); }} disabled={state === "saving" || state === "saved"}>{copy.toolbar.bulletList}</button>
              <button type="button" title={copy.toolbar.numberedList} aria-label={copy.toolbar.numberedList} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (actionBodyRef.current) applyListMarker(actionBodyRef.current, "number"); }} disabled={state === "saving" || state === "saved"}>{copy.toolbar.numberedList}</button>
            </div>
            <textarea id={actionBodyId} ref={actionBodyRef} name="actionBody" required rows={16} maxLength={ACTION_BODY_MAX_LENGTH} defaultValue={action?.body ?? defaultDraft.body} />
          </div>
        </> : null}
      </div>
      <div className="form-action-bar">
        <div><strong>{copy.nextStep}</strong><span className="action-draft-proof">{copy.proof}</span><span>{copy.editInvalidates}</span></div>
        <div className="form-action-buttons">
          {onCancel ? <button className="portal-secondary-button" type="button" onClick={onCancel} disabled={state === "saving"}>{copy.cancel}</button> : null}
          <button className="portal-primary-button" type="submit" disabled={state === "saving" || state === "saved"}>{state === "saving" ? copy.saving : state === "saved" ? copy.success : copy.submit}</button>
        </div>
      </div>
      {state === "saved" && savedRevision ? <p className="approval-success" role="status">{copy.successBody(savedRevision)}</p> : null}
      {error ? <p className="portal-error" role="alert">{error}</p> : null}
    </form>
  );
}
