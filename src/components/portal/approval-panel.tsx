"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionDraftEditor } from "@/src/components/portal/action-draft-editor";
import { FormattedEmailContent } from "@/src/components/portal/formatted-email-content";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import type { CaseStatus, ModuleKey } from "@/src/lib/domain/types";

type ApprovalPanelProps = {
  demo?: boolean;
  compact?: boolean;
  caseId?: string;
  artifactRevision?: number;
  artifactHash?: string;
  actionPayloadHash?: string;
  actionId?: string;
  idempotencyKey?: string;
  to?: string;
  cc?: string[];
  bcc?: string[];
  threadId?: string;
  subject?: string;
  body?: string;
  artifactTitle?: string;
  artifactSummary?: string;
  artifactBody?: string;
  artifactNextAction?: string;
  contentLocale?: "en" | "zh-Hant";
  module?: ModuleKey;
  caseStatus?: CaseStatus;
  actionStatus?: "pending" | "executing" | "executed" | "failed" | "cancelled";
};

const DEMO_HASH = "8f2c1b9770d385d3ad9bf0b496459f3fb6905ef6c088723054255794cb0b71ab";

export function ApprovalPanel({
  demo = false,
  compact = false,
  caseId = "growth-offer-launch",
  artifactRevision = 3,
  artifactHash = DEMO_HASH,
  actionPayloadHash = DEMO_HASH,
  actionId = "00000000-0000-4000-8000-000000000014",
  idempotencyKey = "demo-growth-draft-000014",
  to = "alex@northstar.studio",
  cc = [],
  bcc = [],
  threadId,
  subject = "A focused way to unblock your next launch",
  body = "Hi Alex,\n\nI’ve shaped the Strategy Sprint around one outcome: turning the offer you already have into a campaign your team can act on without another month of planning.\n\nThe working session produces the campaign decision, three tested angles, and the first approved outreach draft. If that sounds useful, I can share the one-page outline.\n\nDemo User",
  artifactTitle = "Outreach draft",
  artifactSummary = "Review the exact outreach before creating the Gmail draft.",
  artifactBody = body,
  artifactNextAction = "Review the approved outreach draft",
  contentLocale = "en",
  module = "growth",
  caseStatus = "awaiting_approval",
  actionStatus = "pending",
}: ApprovalPanelProps) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = getPortalCopy(locale).approval;
  const caseCopy = getPortalCopy(locale).case;
  const revisionLabel = caseCopy.revisionLabel(artifactRevision);
  const [state, setState] = useState<"ready" | "approving" | "approved" | "executing" | "executed" | "error">(
    actionStatus === "executed" ? "executed" : actionStatus === "executing" ? "executing" : caseStatus === "action_pending" ? "approved" : "ready",
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const canEdit = actionStatus !== "executing" && actionStatus !== "executed" && (caseStatus === "awaiting_approval" || (caseStatus === "action_pending" && actionStatus === "pending"));
  const statusKey = state === "executed" ? "outcome_pending" : state === "approved" || state === "executing" || caseStatus === "action_pending" ? "action_pending" : "awaiting_approval";

  async function approve() {
    setState("approving");
    setError("");
    if (demo) {
      window.setTimeout(() => setState("approved"), 550);
      return;
    }
    try {
      const response = await fetch(`/api/cases/${caseId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactRevision, artifactHash, actionPayloadHash }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? copy.error);
      setState("approved");
      router.refresh();
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : copy.error);
    }
  }

  async function execute() {
    setState("executing");
    setError("");
    if (demo) {
      window.setTimeout(() => setState("executed"), 550);
      return;
    }
    try {
      const response = await fetch(`/api/cases/${caseId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, idempotencyKey }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? copy.created);
      setState("executed");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : copy.created);
    }
  }

  return (
    <div className={`portal-approval-card ${compact ? "is-compact" : ""}`}>
      <div className="approval-card-header"><div><span className={`case-status status-${statusKey}`}><i />{caseCopy.status[statusKey]}</span><h2>{artifactTitle || copy.outreach} · {revisionLabel}</h2></div><span className="locked-chip">{copy.payloadLocked}</span></div>
      <div className="approval-detail-grid"><span>{copy.to}</span><strong>{to}</strong>{cc.length ? <><span>{copy.cc}</span><strong>{cc.join(", ")}</strong></> : null}{bcc.length ? <><span>{copy.bcc}</span><strong>{bcc.join(", ")}</strong></> : null}{threadId ? <><span>{copy.thread}</span><strong>{threadId}</strong></> : null}<span>{locale === "zh-Hant" ? "主旨" : "Subject"}</span><strong>{subject}</strong></div>
      <div className="approval-email-body"><FormattedEmailContent content={body} /></div>
      <div className="payload-proof"><span>{copy.artifactHash}</span><code>sha256 · {artifactHash.slice(0, 8)}…{artifactHash.slice(-4)}</code><span>{copy.action}</span><code>gmail.create_draft</code><span>{copy.approvalExpires}</span><code>{copy.anyEdit}</code><small>{copy.hashMeaning}</small></div>
      {editing && canEdit ? <div className="approval-edit-region"><p>{copy.editingBody}</p><ActionDraftEditor caseId={caseId} expectedRevision={artifactRevision} title={artifactTitle} summary={artifactSummary} body={artifactBody} nextAction={artifactNextAction} contentLocale={contentLocale} module={module} action={{ to, cc, bcc, subject, body, thread_id: threadId }} demo={demo} onCancel={() => setEditing(false)} /></div> : null}
      {!editing && state === "executed" ? <div className="approval-success" role="status"><span>✓</span><div><strong>{copy.created}</strong><p>{copy.createdBody}</p></div></div> : null}
      {!editing && state === "executing" ? <div className="approval-success" role="status"><span>…</span><div><strong>{copy.creatingDraft}</strong><p>{copy.lockedBody}</p></div></div> : null}
      {!editing && state === "approved" && actionStatus !== "executed" && actionStatus !== "executing" ? <div className="approval-success" role="status"><span>✓</span><div><strong>{copy.approved}</strong><p>{copy.ready}</p><div className="approval-actions"><button className="portal-secondary-button" type="button" onClick={() => setEditing(true)} disabled={!canEdit}>{copy.editApproved}</button><button className="portal-primary-button" type="button" onClick={execute}>{copy.createDraft}</button></div></div></div> : null}
      {!editing && (state === "ready" || state === "error" || state === "approving") ? <div className="approval-actions"><button className="portal-secondary-button" type="button" onClick={() => setEditing(true)} disabled={!canEdit || state === "approving"}>{copy.requestChanges}</button><button className="portal-primary-button" type="button" onClick={approve} disabled={state === "approving" || actionStatus !== "pending"}>{state === "approving" ? copy.binding : copy.approve}</button></div> : null}
      {!editing && actionStatus === "executed" ? <p className="approval-lock-note">{copy.lockedBody}</p> : null}
      {error ? <p className="portal-error" role="alert">{error}</p> : null}
    </div>
  );
}
