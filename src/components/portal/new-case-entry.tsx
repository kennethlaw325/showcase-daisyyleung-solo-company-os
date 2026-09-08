"use client";

import { useId, useState } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { ImportWizard } from "@/src/components/portal/import-wizard";
import { NewCaseForm } from "@/src/components/portal/new-case-form";
import type { LearningCandidatesByModule } from "@/src/lib/server/case-work-packets";
import type { WorkflowStream } from "@/src/lib/domain/types";

type EntryMode = "guided" | "manual";
type Client = { id: string; name: string; company?: string };

export function NewCaseEntry({
  demo,
  learningCandidatesByModule,
  workflowStreams = [],
  clients = [],
  initialMode = "guided",
}: {
  demo: boolean;
  learningCandidatesByModule?: LearningCandidatesByModule;
  workflowStreams?: WorkflowStream[];
  clients?: Client[];
  initialMode?: EntryMode;
}) {
  const modeId = useId().replace(/:/g, "");
  const { locale } = useLocale();
  const zh = locale === "zh-Hant";
  const [mode, setMode] = useState<EntryMode>(initialMode);

  return (
    <section className="new-case-entry" aria-labelledby={`${modeId}-title`}>
      <fieldset className="new-case-mode-picker">
        <legend id={`${modeId}-title`}>{zh ? "選擇開始方式" : "Choose how to start"}</legend>
        <div className="new-case-mode-grid">
          <label className={`new-case-mode-option ${mode === "guided" ? "is-selected" : ""}`}>
            <input type="radio" name="new-case-mode" value="guided" checked={mode === "guided"} onChange={() => setMode("guided")} />
            <span className="new-case-mode-number">01</span>
            <strong>{zh ? "半自動匯入" : "Semi-automatic import"}</strong>
            <small>{zh ? "貼上文字、加入語音轉錄，或選擇最多三個支援檔案。建立前先審閱提案。" : "Paste text, dictate a transcript, or add up to three supported files. Review the proposed case before creation."}</small>
          </label>
          <label className={`new-case-mode-option ${mode === "manual" ? "is-selected" : ""}`}>
            <input type="radio" name="new-case-mode" value="manual" checked={mode === "manual"} onChange={() => setMode("manual")} />
            <span className="new-case-mode-number">02</span>
            <strong>{zh ? "手動填入個案" : "Manual case entry"}</strong>
            <small>{zh ? "選擇自訂或專用工作流程，逐項完成詳細輸入表格。" : "Choose a custom or specialised flow and complete the detailed field-by-field intake form."}</small>
          </label>
        </div>
      </fieldset>
      {mode === "guided" ? <ImportWizard locale={locale} demo={demo} clients={clients} /> : <NewCaseForm demo={demo} learningCandidatesByModule={learningCandidatesByModule} workflowStreams={workflowStreams} clients={clients} />}
    </section>
  );
}
