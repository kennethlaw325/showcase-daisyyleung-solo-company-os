"use client";

import type { ModuleKey } from "@/src/lib/domain/types";
import { useLocale } from "@/src/components/locale-provider";
import { localizeLearningConfidence, presentLearningCard } from "@/src/lib/presentation/learning-card";

export type CaseWorkPacketLearningApplication = {
  id: string;
  learningId: string;
  disposition: "applied" | "partially_applied" | "not_applied" | "conflicted";
  rationale: string;
  note: string;
  tags: string[];
  applicability?: string | null;
  evidence?: string | null;
  confidence?: string | null;
  supportingOutcomeCount?: number | null;
  learningConfidence?: string | null;
  validationStatus?: string | null;
  nextAction?: string | null;
  improvements?: string | null;
  otherAngles?: string | null;
};

type EvidenceBrief = { observations?: string[]; assumptions?: string[]; gaps?: string[]; risks?: string[] };
type Plan = Record<string, string | string[]>;

function missing(locale: "zh-Hant" | "en") {
  return locale === "zh-Hant" ? "未記錄" : "Not recorded";
}

function Value({ value, locale }: { value: string | string[] | undefined; locale: "zh-Hant" | "en" }) {
  if (Array.isArray(value)) return value.length ? <ul>{value.map((item) => <li key={item}>{item}</li>)}</ul> : <span>{missing(locale)}</span>;
  return <span>{value || missing(locale)}</span>;
}

function OutputGrid({ values, locale }: { values: Record<string, string | string[] | undefined>; locale: "zh-Hant" | "en" }) {
  return <dl className="case-work-packet-grid">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><Value value={value} locale={locale} /></dd></div>)}</dl>;
}

function LearningApplicationCard({ application, locale }: { application: CaseWorkPacketLearningApplication; locale: "zh-Hant" | "en" }) {
  const isZh = locale === "zh-Hant";
  const empty = missing(locale);
  const disposition = isZh
    ? { applied: "已套用", partially_applied: "部分套用", not_applied: "未套用", conflicted: "有衝突" }[application.disposition]
    : { applied: "Applied", partially_applied: "Partially applied", not_applied: "Not applied", conflicted: "Conflicted" }[application.disposition];
  const sections = presentLearningCard(application);
  return (
    <article className="case-work-packet-learning-card">
      <header><strong>{disposition}</strong><span>{application.learningId.slice(0, 8)}</span></header>
      <div className="learning-card-sections">
        <div className="learning-card-section"><strong>{isZh ? "可重用學習：" : "Reusable learning:"}</strong><span>{sections.learning || empty}</span></div>
        <div className="learning-card-section"><strong>{isZh ? "適用情境：" : "Applicability:"}</strong><span>{sections.applicability || empty}</span></div>
        <div className="learning-card-section"><strong>{isZh ? "證據：" : "Evidence:"}</strong><span>{sections.evidence || empty}</span></div>
        <div className="learning-card-section"><strong>{isZh ? "證據信心：" : "Evidence confidence:"}</strong><span>{sections.evidenceConfidence ? localizeLearningConfidence(sections.evidenceConfidence, locale) : empty}</span></div>
        <div className="learning-card-section"><strong>{isZh ? "待測試假設：" : "Hypothesis to test:"}</strong><span>{sections.hypothesis || empty}</span></div>
        <div className="learning-card-section"><strong>{isZh ? "下一步／測試行動：" : "Next step/test action:"}</strong><span>{sections.nextAction || empty}</span></div>
      </div>
      <p className="case-work-packet-rationale"><strong>{isZh ? "本次應用理由：" : "Application rationale:"}</strong> {application.rationale || empty}</p>
    </article>
  );
}

export function CaseWorkPacket({
  module,
  evidence,
  plan,
  applications,
  packetState,
  packetSourceRevision,
}: {
  module: ModuleKey;
  evidence?: EvidenceBrief | null;
  plan?: Plan | null;
  applications: CaseWorkPacketLearningApplication[];
  packetState?: "current" | "inherited" | "absent" | "incomplete";
  packetSourceRevision?: number | null;
}) {
  const { locale } = useLocale();
  const isZh = locale === "zh-Hant";
  const moduleLabel = isZh
    ? { growth: "增長與收入", operations: "商業洞察", intelligence: "品牌傳訊與公關" }[module]
    : { growth: "Growth & Revenue", operations: "Business Insights", intelligence: "Brand Communications & PR" }[module];
  const evidenceLabels = isZh ? ["觀察", "假設", "缺口", "風險"] : ["Observations", "Assumptions", "Gaps", "Risks"];
  const planLabels = isZh ? {
    opportunity: "機會", hypothesis: "假設", conversionPath: "轉換路徑", proof: "證明", measures: "衡量指標",
    bottleneck: "目前阻礙", decision: "決策", owners: "負責人", dependencies: "依賴", contradictions: "矛盾", deadlineCollisions: "限期衝突", claims: "主張", evidenceBoundaries: "證據界線", uncertainty: "不確定性", audienceStrategy: "受眾策略",
  } : {
    opportunity: "Opportunity", hypothesis: "Hypothesis", conversionPath: "Conversion path", proof: "Proof", measures: "Measures",
    bottleneck: "Bottleneck", decision: "Decision", owners: "Owners", dependencies: "Dependencies", contradictions: "Contradictions", deadlineCollisions: "Deadline collisions", claims: "Claims", evidenceBoundaries: "Evidence boundaries", uncertainty: "Uncertainty", audienceStrategy: "Audience strategy",
  };
  const localizePlan = (input: Plan) => Object.fromEntries(Object.entries(input).map(([key, value]) => [planLabels[key as keyof typeof planLabels] ?? key, value]));
  const resolvedState = packetState ?? "incomplete";
  const hasPacket = Boolean(evidence && plan && (resolvedState === "current" || resolvedState === "inherited"));
  const packetStateCopy = resolvedState === "inherited"
    ? (isZh
      ? `目前修訂稿沿用第 ${packetSourceRevision ?? "—"} 稿工作包的證據摘要及計劃。`
      : `This human-edited revision inherits the evidence and plan from packet revision ${packetSourceRevision ?? "—"}.`)
    : resolvedState === "incomplete"
      ? (isZh ? "工作包來源不完整，未顯示單一可信的證據摘要或計劃。" : "The packet source is incomplete, so no single evidence brief or plan is treated as authoritative.")
      : (isZh ? "這份修訂稿沒有來源工作包。" : "No work packet is attached to this revision.");
  return (
    <section className="portal-panel case-work-packet-panel" aria-labelledby="case-work-packet-title">
      <header className="artifact-heading"><div><p className="portal-kicker">{isZh ? "工作包" : "Work packet"}</p><h2 id="case-work-packet-title">{isZh ? "證據與計劃" : "Evidence & plan"}</h2></div><span>{moduleLabel}</span></header>
      {resolvedState === "inherited" ? <p className="empty-side-note">{packetStateCopy}</p> : null}
      {hasPacket ? <>
        <details className="case-work-packet-context" open={false}><summary>{isZh ? "證據摘要" : "Evidence brief"}</summary><OutputGrid values={{ [evidenceLabels[0]]: evidence?.observations, [evidenceLabels[1]]: evidence?.assumptions, [evidenceLabels[2]]: evidence?.gaps, [evidenceLabels[3]]: evidence?.risks }} locale={locale} /></details>
        <details className="case-work-packet-context"><summary>{isZh ? "模組計劃" : "Module plan"}</summary><OutputGrid values={localizePlan(plan ?? {})} locale={locale} /></details>
      </> : <p className="empty-side-note">{packetStateCopy}</p>}
      <div className="case-work-packet-applications"><h3>{isZh ? "學習應用" : "Learning applications"}</h3>{applications.length ? applications.map((application) => <LearningApplicationCard key={application.id} application={application} locale={locale} />) : <p className="empty-side-note">{isZh ? "本次沒有選取可重用學習。" : "No reusable learning was selected for this revision."}</p>}</div>
    </section>
  );
}
