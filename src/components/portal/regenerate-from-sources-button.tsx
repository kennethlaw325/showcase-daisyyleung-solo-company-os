"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { caseSupportCopy } from "@/src/data/case-support-copy";

export function RegenerateFromSourcesButton({ caseId, demo, disabled, disabledReason, currentRevision = 0 }: { caseId: string; demo: boolean; disabled: boolean; disabledReason?: string; currentRevision?: number }) {
  const router = useRouter();
  const { locale, localeSaving } = useLocale();
  const copy = caseSupportCopy[locale].regenerate;
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const displayDisabledReason = disabledReason ?? (disabled ? copy.closed : undefined);

  async function regenerate() {
    if (demo) {
      setState("done");
      setMessage(copy.demoRevision(currentRevision + 1));
      return;
    }
    setState("working");
    setMessage("");
    try {
      const response = await fetch(`/api/cases/${caseId}/generate-revision`, { method: "POST" });
      const body = (await response.json()) as { case?: { current_revision?: number }; error?: string };
      if (!response.ok) throw new Error(body.error ?? copy.error);
      const revision = body.case?.current_revision;
      if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error(copy.error);
      setState("done");
      setMessage(copy.successRevision(Number(revision)));
      router.refresh();
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : copy.error);
    }
  }

  return (
    <div className="source-regenerate">
      <button type="button" disabled={disabled || state === "working" || localeSaving} onClick={regenerate}>{state === "working" ? copy.working : copy.idle}</button>
      {displayDisabledReason ? <p className="source-upload-status" role="note">{displayDisabledReason}</p> : null}
      {message ? <p className={state === "error" ? "portal-error" : "source-upload-status"} role={state === "error" ? "alert" : "status"} aria-live="polite">{message}</p> : null}
    </div>
  );
}
