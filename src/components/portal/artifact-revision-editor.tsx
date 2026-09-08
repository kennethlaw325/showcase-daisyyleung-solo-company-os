"use client";

import { useState } from "react";
import { ActionDraftEditor } from "@/src/components/portal/action-draft-editor";
import { HumanReadableContent } from "@/src/components/portal/human-readable-content";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import type { ActionPayload, CaseStatus, ModuleKey } from "@/src/lib/domain/types";

type ArtifactRevisionEditorProps = {
  caseId: string;
  revision: number;
  title: string;
  summary: string;
  body: string;
  nextAction: string;
  contentLocale: "en" | "zh-Hant";
  module: ModuleKey;
  caseStatus: CaseStatus;
  actionStatus?: "pending" | "executing" | "executed" | "failed" | "cancelled";
  action?: Pick<ActionPayload, "to" | "cc" | "bcc" | "subject" | "body" | "thread_id"> | null;
  demo?: boolean;
};

export function ArtifactRevisionEditor({ caseId, revision, title, summary, body, nextAction, contentLocale, module, caseStatus, actionStatus = "pending", action = null, demo = false }: ArtifactRevisionEditorProps) {
  const { locale } = useLocale();
  const copy = getPortalCopy(locale).case;
  const [editing, setEditing] = useState(false);
  const canEdit = actionStatus !== "executing" && actionStatus !== "executed" && (
    caseStatus === "awaiting_approval" ||
    (caseStatus === "action_pending" && actionStatus === "pending") ||
    (module === "intelligence" && caseStatus === "outcome_pending")
  );

  return <>
    <section className="portal-panel artifact-panel">
      <div className="artifact-heading"><div><p className="portal-kicker">{copy.currentArtifact}</p><h2>{title}</h2></div><div><span className="version-chip">{copy.revisionLabel(revision)}</span><button className="portal-secondary-button artifact-edit-button" type="button" onClick={() => setEditing(true)} disabled={!canEdit}>{copy.edit}</button></div></div>
      <article className="artifact-body"><section><h3>{copy.summary}</h3><HumanReadableContent content={summary} locale={locale} /></section><section><h3>{copy.workingArtifact}</h3><HumanReadableContent content={body} locale={locale} /></section><section><h3>{copy.nextAction}</h3><HumanReadableContent content={nextAction} locale={locale} /></section></article>
    </section>
    {editing && canEdit ? <ActionDraftEditor caseId={caseId} expectedRevision={revision} title={title} summary={summary} body={body} nextAction={nextAction} contentLocale={contentLocale} module={module} action={action} demo={demo} onCancel={() => setEditing(false)} /> : null}
  </>;
}
