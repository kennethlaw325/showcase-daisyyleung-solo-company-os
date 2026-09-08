"use client";

import { useLocale } from "@/src/components/locale-provider";
import { RegenerateFromSourcesButton } from "@/src/components/portal/regenerate-from-sources-button";
import { SourceUploadManager } from "@/src/components/portal/source-upload-manager";
import { caseSupportCopy } from "@/src/data/case-support-copy";
import { localizeLearningEvidence, presentLearningCard } from "@/src/lib/presentation/learning-card";

type SourceSummary = {
  id: string;
  kind: string;
  label: string;
  meta: string;
  extracted?: boolean;
};

type LearningSummary = {
  id: string;
  note: string;
  tags: string[];
};

function localizeSourceLabel(label: string, locale: "zh-Hant" | "en") {
  const copy = caseSupportCopy[locale].sourcePanel;
  return ["pasted notes", "intake.txt"].includes(label.toLowerCase()) ? copy.pastedNotes : label;
}

function localizeSourceMeta(meta: string, locale: "zh-Hant" | "en") {
  if (locale === "en") return meta;
  const copy = caseSupportCopy[locale].sourcePanel;
  return meta
    .replace(/Public HTTPS/gi, copy.publicHttps)
    .replace(/extracted/gi, copy.extracted)
    .replace(/captured/gi, copy.captured)
    .replace(/registered/gi, copy.registered);
}

function localizeTag(tag: string, locale: "zh-Hant" | "en") {
  const tags = caseSupportCopy[locale].learningPanel.tags;
  return tag in tags ? tags[tag as keyof typeof tags] : tag;
}

export function CaseSupportPanels({
  caseId,
  sources,
  uploadCount,
  relatedLearnings,
  demo,
  regenerationDisabled,
  regenerationDisabledReason,
  currentRevision = 0,
}: {
  caseId: string;
  sources: SourceSummary[];
  uploadCount: number;
  relatedLearnings: LearningSummary[];
  demo: boolean;
  regenerationDisabled: boolean;
  regenerationDisabledReason?: "closed" | "missingSource";
  currentRevision?: number;
}) {
  const { locale } = useLocale();
  const copy = caseSupportCopy[locale];
  const localizedDisabledReason = regenerationDisabledReason
    ? copy.regenerate[regenerationDisabledReason]
    : undefined;

  return (
    <>
      <section className="portal-panel source-panel" aria-labelledby="source-panel-title">
        <header className="case-side-heading">
          <div>
            <p className="portal-kicker">{copy.sourcePanel.eyebrow}</p>
            <h2 id="source-panel-title">{copy.sourcePanel.title}</h2>
          </div>
          <span className="case-side-count" aria-label={`${copy.sourcePanel.title}: ${sources.length}`}>{sources.length}</span>
        </header>
        {sources.length ? sources.map((source) => (
          <div className="source-item" key={source.id}>
            <span>{source.kind}</span>
            <div>
              <strong>{localizeSourceLabel(source.label, locale)}</strong>
              <small>{localizeSourceMeta(source.meta, locale)}</small>
            </div>
          </div>
        )) : (
          <div className="case-side-empty-state">
            <strong>{copy.sourcePanel.emptyTitle}</strong>
            <p>{copy.sourcePanel.emptyBody}</p>
          </div>
        )}
        <SourceUploadManager caseId={caseId} currentCount={uploadCount} demo={demo} />
        <RegenerateFromSourcesButton caseId={caseId} demo={demo} currentRevision={currentRevision} disabled={regenerationDisabled} disabledReason={localizedDisabledReason} />
      </section>

      <section className="portal-panel related-learning-panel" aria-labelledby="learning-panel-title">
        <header className="case-side-heading">
          <div>
            <p className="portal-kicker">{copy.learningPanel.eyebrow}</p>
            <h2 id="learning-panel-title">{copy.learningPanel.title}</h2>
          </div>
          <span className="case-side-count" aria-label={`${copy.learningPanel.title}: ${relatedLearnings.length}`}>{relatedLearnings.length}</span>
        </header>
        {relatedLearnings.length ? relatedLearnings.map((learning) => {
          const sections = presentLearningCard(learning);
          const rows = [
            { label: copy.learningPanel.sections.learning, value: sections.learning },
            { label: copy.learningPanel.sections.applicability, value: sections.applicability },
            { label: copy.learningPanel.sections.evidence, value: localizeLearningEvidence(sections.evidence, locale) },
            { label: copy.learningPanel.sections.hypothesis, value: sections.hypothesis },
            { label: copy.learningPanel.sections.nextAction, value: sections.nextAction },
            { label: copy.learningPanel.sections.improvements, value: sections.improvements },
          ].filter((row) => row.value);
          return (
            <article key={learning.id}>
              <dl className="related-learning-sections">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
              <div className="related-learning-tags">{learning.tags.map((tag) => <span key={tag}>{localizeTag(tag, locale)}</span>)}</div>
            </article>
          );
        }) : (
          <div className="case-side-empty-state">
            <strong>{copy.learningPanel.emptyTitle}</strong>
            <p>{copy.learningPanel.emptyBody}</p>
          </div>
        )}
        <small className="learning-safety-note">{copy.learningPanel.safetyNote}</small>
      </section>
    </>
  );
}
