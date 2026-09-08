"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "@/src/components/locale-provider";

export function LearningConfirmationButton({ learningId, demo = false }: { learningId: string; demo?: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  async function confirm() {
    if (demo) {
      setState("done");
      return;
    }
    setState("saving");
    const response = await fetch(`/api/learnings/${learningId}/confirm`, { method: "POST" });
    if (!response.ok) {
      setState("error");
      return;
    }
    setState("done");
    router.refresh();
  }
  const labels = locale === "zh-Hant"
    ? { saving: "確認中⋯", done: "已確認 ✓", error: "再試一次", idle: "確認可供重用 →" }
    : { saving: "Confirming…", done: "Confirmed ✓", error: "Try again", idle: "Confirm for reuse →" };
  return <button type="button" onClick={confirm} disabled={state === "saving" || state === "done"}>{state === "saving" ? labels.saving : state === "done" ? labels.done : state === "error" ? labels.error : labels.idle}</button>;
}
