"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/src/components/locale-provider";

type LearningDeletionState = "idle" | "confirming" | "deleting" | "done" | "error";

export function LearningDeletionControl({ learningId, demo = false }: { learningId: string; demo?: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [state, setState] = useState<LearningDeletionState>("idle");
  const [message, setMessage] = useState("");
  const labels = locale === "zh-Hant"
    ? {
      cancel: "取消",
      confirm: "再按一次以刪除",
      delete: "刪除這項學習",
      deleting: "刪除中⋯",
      demo: "示範模式不會刪除資料。",
      done: "已移除",
      error: "未能刪除，請再試一次。",
      prompt: "這會從工作空間的可重用學習中移除，但會保留已套用的歷史快照。",
    }
    : {
      cancel: "Cancel",
      confirm: "Press again to delete",
      delete: "Delete this learning",
      deleting: "Deleting…",
      demo: "Demo mode does not delete data.",
      done: "Removed",
      error: "Unable to delete. Try again.",
      prompt: "This removes it from reusable workspace learning while preserving applied historical snapshots.",
    };

  async function deleteLearning() {
    if (state === "deleting" || state === "done") return;
    if (state !== "confirming" && state !== "error") {
      setState("confirming");
      setMessage(labels.prompt);
      return;
    }
    setState("deleting");
    setMessage("");
    try {
      const response = await fetch(`/api/learnings/${learningId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(labels.error);
      setState("done");
      setMessage(labels.done);
      router.refresh();
    } catch {
      setState("error");
      setMessage(labels.error);
    }
  }

  if (demo) {
    return <div className="learning-deletion-control"><button className="learning-delete-button" type="button" disabled>{labels.delete}</button><span className="learning-deletion-status" role="status" aria-live="polite">{labels.demo}</span></div>;
  }

  if (state === "done") {
    return <span className="learning-deletion-status" role="status" aria-live="polite">{message}</span>;
  }

  return (
    <div className="learning-deletion-control">
      <button
        className="learning-delete-button"
        type="button"
        onClick={deleteLearning}
        disabled={state === "deleting"}
        aria-describedby={state === "confirming" || state === "error" ? `${learningId}-deletion-message` : undefined}
      >
        {state === "deleting" ? labels.deleting : state === "confirming" || state === "error" ? labels.confirm : labels.delete}
      </button>
      {state === "confirming" || state === "error" ? <button className="learning-delete-cancel" type="button" onClick={() => { setState("idle"); setMessage(""); }}>{labels.cancel}</button> : null}
      {message ? <span id={`${learningId}-deletion-message`} className={state === "error" ? "portal-error" : "learning-deletion-prompt"} role={state === "error" ? "alert" : "status"} aria-live="polite">{message}</span> : null}
    </div>
  );
}
