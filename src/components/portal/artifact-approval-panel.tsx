"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionDraftEditor } from "@/src/components/portal/action-draft-editor";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import type { CaseStatus } from "@/src/lib/domain/types";

type ArtifactApprovalPanelProps = {
  caseId: string;
  revision: number;
  artifactHash: string;
  title: string;
  summary: string;
  body?: string;
  nextAction?: string;
  contentLocale?: "en" | "zh-Hant";
  caseStatus?: CaseStatus;
  demo?: boolean;
};

export function ArtifactApprovalPanel({ caseId, revision, artifactHash, title, summary, body = summary, nextAction = "Review the core synthesis", contentLocale = "en", caseStatus = "awaiting_approval", demo = false }: ArtifactApprovalPanelProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = getPortalCopy(locale).artifactApproval;
  const caseCopy = getPortalCopy(locale).case;
  const [state, setState] = useState<"ready" | "approving" | "approved" | "error">(caseStatus === "outcome_pending" ? "approved" : "ready");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const canEdit = caseStatus === "awaiting_approval" || caseStatus === "outcome_pending";
  const statusKey = state === "approved" || caseStatus === "outcome_pending" ? "outcome_pending" : "awaiting_approval";

  async function approve() {
    setState("approving");
    setError("");
    if (demo) {
      window.setTimeout(() => setState("approved"), 450);
      return;
    }
    try {
      const response = await fetch(`/api/cases/${caseId}/approval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactRevision: revision, artifactHash }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? copy.error);
      setState("approved");
      router.refresh();
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : copy.error);
    }
  }

  if (!editing && state === "approved") {
    return (
      <section className="portal-panel artifact-approval-panel is-approved">
        <div className="artifact-approval-confirmed">
          <div><span className={`case-status status-${statusKey}`}><i />{caseCopy.status[statusKey]}</span><h2>{copy.approved}</h2><p>{locale === "zh-Hant" ? `第 ${revision} 稿已鎖定；結果回顧會以這份內容為準。` : `Draft ${revision} is locked; its outcome review will use this exact content.`}</p></div>
          <button className="portal-secondary-button" type="button" onClick={() => setEditing(true)} disabled={!canEdit}>{copy.editApproved}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="portal-panel artifact-approval-panel">
      <div className="approval-card-header"><div><span className={`case-status status-${statusKey}`}><i />{caseCopy.status[statusKey]}</span><h2>{copy.title} · {caseCopy.revisionLabel(revision)}</h2></div><span className="locked-chip">{copy.revisionLocked}</span></div>
      <div className="artifact-approval-preview"><strong>{title}</strong><p>{summary}</p></div>
      <div className="payload-proof"><span>{locale === "zh-Hant" ? "內容指紋" : "Content fingerprint"}</span><code>sha256 · {artifactHash.slice(0, 8)}…{artifactHash.slice(-4)}</code><span>{copy.externalAction}</span><code>{copy.none}</code><span>{copy.nextGate}</span><code>{copy.outcomeReview}</code></div>
      {editing && canEdit ? <div className="approval-edit-region"><p>{copy.editingBody}</p><ActionDraftEditor caseId={caseId} expectedRevision={revision} title={title} summary={summary} body={body} nextAction={nextAction} contentLocale={contentLocale} module="intelligence" demo={demo} onCancel={() => setEditing(false)} /></div> : null}
      {!editing && (state === "ready" || state === "approving") ? <div className="approval-actions"><button className="portal-secondary-button" type="button" onClick={() => setEditing(true)} disabled={!canEdit || state === "approving"}>{copy.requestChanges}</button><button className="portal-primary-button" type="button" onClick={approve} disabled={state === "approving"}>{state === "approving" ? copy.binding : copy.approve}</button></div> : null}
      {error ? <p className="portal-error" role="alert">{error}</p> : null}
    </section>
  );
}
