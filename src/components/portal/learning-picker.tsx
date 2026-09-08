"use client";

import { useState } from "react";
import type { ModuleKey } from "@/src/lib/domain/types";
import type { LearningCandidate, LearningCandidatesByModule } from "@/src/lib/server/case-work-packets";
import { useLocale } from "@/src/components/locale-provider";
import { localizeLearningConfidence, presentLearningCard } from "@/src/lib/presentation/learning-card";

function missing(locale: "zh-Hant" | "en") {
  return locale === "zh-Hant" ? "未記錄" : "Not recorded";
}

function LearningCard({ candidate, selected, disabled, onToggle }: { candidate: LearningCandidate; selected: boolean; disabled: boolean; onToggle: () => void }) {
  const { locale } = useLocale();
  const isZh = locale === "zh-Hant";
  const empty = missing(locale);
  const sections = presentLearningCard(candidate);
  return (
    <label className={`learning-picker-card ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}>
      <input type="checkbox" name="selectedLearningIds" value={candidate.id} checked={selected} disabled={disabled} onChange={onToggle} />
      <span className="learning-picker-card-body">
        <span className="learning-picker-card-section"><strong>{isZh ? "可重用學習：" : "Reusable learning:"}</strong><span>{sections.learning || empty}</span></span>
        <span className="learning-picker-card-section"><strong>{isZh ? "適用情境：" : "Applicability:"}</strong><span>{sections.applicability || empty}</span></span>
        <span className="learning-picker-card-section"><strong>{isZh ? "證據：" : "Evidence:"}</strong><span>{sections.evidence || empty}</span></span>
        <span className="learning-picker-card-section"><strong>{isZh ? "證據信心：" : "Evidence confidence:"}</strong><span>{sections.evidenceConfidence ? localizeLearningConfidence(sections.evidenceConfidence, locale) : empty}</span></span>
        <small>{candidate.sourceCaseTitle}</small>
      </span>
      <i aria-hidden="true">✓</i>
    </label>
  );
}

export function LearningPicker({ candidatesByModule, module }: { candidatesByModule: LearningCandidatesByModule; module: ModuleKey }) {
  const { locale } = useLocale();
  const [selectedByModule, setSelectedByModule] = useState<Record<ModuleKey, string[]>>({ growth: [], operations: [], intelligence: [] });
  const candidates = candidatesByModule[module] ?? [];
  const isZh = locale === "zh-Hant";
  const selectedIds = selectedByModule[module];
  const selectedCount = selectedIds.length;

  function toggle(id: string) {
    setSelectedByModule((currentByModule) => {
      const current = currentByModule[module];
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= 3
          ? current
          : [...current, id];
      return { ...currentByModule, [module]: next };
    });
  }

  return (
    <fieldset className="learning-picker-fieldset">
      <legend className="visually-hidden">{isZh ? "可重用學習" : "Reusable learning"}</legend>
      <details>
        <summary>{isZh ? "可選：加入已確認的可重用學習" : "Optional: add approved reusable learning"}<span>{selectedCount}/3</span></summary>
        <p className="fieldset-note">{isZh ? "只會作為歷史指引提供給首次生成；來源事實優先。你可選 0 至 3 項。" : "Used only as historical guidance for the first generation; source facts take priority. Choose 0–3."}</p>
        {candidates.length ? <div className="learning-picker-list">{candidates.map((candidate) => <LearningCard key={candidate.id} candidate={candidate} selected={selectedIds.includes(candidate.id)} disabled={selectedCount >= 3 && !selectedIds.includes(candidate.id)} onToggle={() => toggle(candidate.id)} />)}</div> : <p className="empty-side-note">{isZh ? "此模組暫時沒有已確認學習。" : "No approved learning is available for this module yet."}</p>}
      </details>
    </fieldset>
  );
}
