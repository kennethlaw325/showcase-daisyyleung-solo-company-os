"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";

type CaseDeleteControlProps = {
  caseId: string;
  title: string;
  demo?: boolean;
  deletionPending?: boolean;
  deletionRequestId?: string | null;
};

export function CaseDeleteControl({ caseId, title, demo = false, deletionPending = false, deletionRequestId = null }: CaseDeleteControlProps) {
  const router = useRouter();
  const { locale, localeSaving } = useLocale();
  const copy = getPortalCopy(locale).case.deletion;
  const inputId = useId();
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [requestId, setRequestId] = useState(deletionRequestId ?? "");
  const [state, setState] = useState<"idle" | "confirming" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const exactTitleMatches = confirmationTitle === title;
  const disabled = demo || localeSaving || state === "confirming" || !exactTitleMatches;

  async function deleteCase() {
    if (demo || !exactTitleMatches) return;
    const nextRequestId = requestId || crypto.randomUUID();
    setRequestId(nextRequestId);
    setState("confirming");
    setMessage("");
    try {
      const response = await fetch(`/api/cases/${caseId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmationTitle, requestId: nextRequestId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.error);
      setState("success");
      setMessage(copy.success);
      router.push("/app");
      router.refresh();
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : copy.error);
    }
  }

  if (demo) {
    return <section className="portal-panel case-delete-zone" aria-labelledby={`${inputId}-title`}><div className="artifact-heading"><div><h2 id={`${inputId}-title`}>{copy.dangerTitle}</h2></div></div><p>{copy.dangerBody}</p><p className="case-delete-scope">{copy.scope}</p><p className="case-delete-demo" role="note">{copy.demo}</p><button className="portal-danger-button" type="button" disabled>{copy.confirm}</button></section>;
  }

  return (
    <section className={`portal-panel case-delete-zone ${deletionPending ? "is-pending" : ""}`} aria-labelledby={`${inputId}-title`}>
      <div className="artifact-heading"><div><h2 id={`${inputId}-title`}>{deletionPending ? copy.pendingTitle : copy.dangerTitle}</h2></div></div>
      <p>{deletionPending ? copy.pendingBody : copy.dangerBody}</p>
      <p className="case-delete-scope">{copy.scope}</p>
      <label htmlFor={inputId}>{copy.confirmationLabel}</label>
      <input id={inputId} type="text" value={confirmationTitle} placeholder={copy.confirmationPlaceholder} onChange={(event) => setConfirmationTitle(event.target.value)} autoComplete="off" spellCheck={false} disabled={state === "confirming"} />
      {!exactTitleMatches && confirmationTitle.length > 0 ? <small className="case-delete-hint">{copy.confirmationPlaceholder}</small> : null}
      <div className="case-delete-actions">
        <button className="portal-danger-button" type="button" disabled={disabled} onClick={deleteCase}>{state === "confirming" ? copy.confirming : deletionPending ? copy.retry : copy.confirm}</button>
      </div>
      {message ? <p className={state === "error" ? "portal-error" : "case-delete-success"} role={state === "error" ? "alert" : "status"} aria-live="polite">{message}</p> : null}
    </section>
  );
}
