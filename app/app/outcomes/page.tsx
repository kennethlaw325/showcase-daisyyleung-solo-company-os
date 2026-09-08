import type { Metadata } from "next";
import Link from "next/link";
import { OutcomeForm } from "@/src/components/portal/outcome-form";
import { demoLearnings } from "@/src/data/demo-data";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { LearningConfirmationButton } from "@/src/components/portal/learning-confirmation-button";
import { LearningDeletionControl } from "@/src/components/portal/learning-deletion-control";
import { Localized } from "@/src/components/locale-provider";
import { localizeLearningConfidence, localizeLearningEvidence, presentLearningCard, summarizeLearningTitle } from "@/src/lib/presentation/learning-card";
import { groupOutcomeLearnings, OUTCOME_LEARNING_CATEGORY_ORDER, outcomeLearningCategoryLabels } from "@/src/lib/presentation/outcome-learning";

export const metadata: Metadata = { title: "Outcomes", robots: { index: false, follow: false } };

const moduleLabels = { growth: "Growth & Revenue", operations: "Business Insights", intelligence: "Brand Communications & PR" } as const;
type CanonicalModule = "growth" | "operations" | "intelligence";
const demoLearningSources = [
  { id: "growth-offer-launch", title: "Strategy Sprint · Founding offer" },
  { id: "partner-decision", title: "Partner handoff decisions" },
] as const;

type OutcomeLearning = {
  id: string;
  module: string;
  title: string;
  body: string;
  observedResult: string;
  applicability: string;
  evidence: string;
  evidenceConfidence: string;
  hypothesis: string;
  nextAction: string;
  tags: string[];
  approvedBy: string;
  needsConfirmation: boolean;
  canDelete: boolean;
  sourceCaseId: string | null;
  sourceCaseTitle: string;
};

function recorded(value: string | null | undefined, locale: "zh-Hant" | "en") {
  return value?.trim() || (locale === "zh-Hant" ? "未記錄" : "Not recorded");
}

export default async function OutcomesPage() {
  const demo = isSafeDemoMode();
  let pageLocale: "en" | "zh-Hant" = "en";
  let pendingCases: { id: string; title: string; module: CanonicalModule }[] = [{ id: "studio-retro", title: "Studio intelligence review", module: "operations" }];
  let learnings: OutcomeLearning[] = demoLearnings.map((item, index) => ({
    ...item,
    id: `demo-learning-${index}`,
    observedResult: item.body,
    applicability: "",
    evidence: item.body,
    evidenceConfidence: "medium",
    hypothesis: "",
    nextAction: "",
    tags: [...item.tags],
    approvedBy: "Demo User",
    needsConfirmation: false,
    canDelete: true,
    sourceCaseId: demoLearningSources[index]?.id ?? null,
    sourceCaseTitle: demoLearningSources[index]?.title ?? item.title,
  }));
  if (!demo) {
    const context = await requirePortalContext();
    pageLocale = context.locale;
    const supabase = await createServerSupabaseClient();
    const [pendingResult, learningResult] = await Promise.all([
      supabase.from("cases").select("id,title,module").eq("workspace_id", context.workspace.id).eq("status", "outcome_pending").order("updated_at", { ascending: true }),
      supabase.from("learning_records").select("id,case_id,note,tags,disposition,approved_for_reuse,created_by,applicability,cases(module,title)").eq("workspace_id", context.workspace.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(12),
    ]);
    pendingCases = (pendingResult.data ?? []) as { id: string; title: string; module: CanonicalModule }[];
    const caseIds = [...new Set((learningResult.data ?? []).map((item) => item.case_id).filter((caseId): caseId is string => Boolean(caseId)))];
    const outcomeResult = caseIds.length
      ? await supabase.from("case_outcomes").select("case_id,actual_result,evidence,confidence,next_action,other_angles").eq("workspace_id", context.workspace.id).in("case_id", caseIds)
      : { data: [] };
    const outcomesByCase = new Map((outcomeResult.data ?? []).map((outcome) => [outcome.case_id, outcome]));
    learnings = (learningResult.data ?? []).map((item) => {
      const related = Array.isArray(item.cases) ? item.cases[0] : item.cases;
      const outcome = item.case_id ? outcomesByCase.get(item.case_id) : undefined;
      const presentation = presentLearningCard({
        note: item.note,
        observedResult: outcome?.actual_result,
        applicability: item.applicability,
        evidence: outcome?.evidence,
        evidenceConfidence: outcome?.confidence,
        hypothesis: outcome?.other_angles,
        nextAction: outcome?.next_action,
      });
      return {
        id: item.id,
        module: related?.module ?? "Workspace",
        title: summarizeLearningTitle(presentation.learning),
        body: presentation.learning,
        observedResult: presentation.observedResult || recorded(outcome?.actual_result, context.locale),
        applicability: presentation.applicability,
        evidence: presentation.evidence,
        evidenceConfidence: presentation.evidenceConfidence,
        hypothesis: presentation.hypothesis,
        nextAction: presentation.nextAction,
        tags: [item.disposition, item.approved_for_reuse ? "approved" : "needs review", ...(item.tags ?? [])],
        approvedBy: item.approved_for_reuse ? "Workspace owner" : "Pending confirmation",
        needsConfirmation: !item.approved_for_reuse && item.disposition !== "discard",
        canDelete: item.created_by === context.user.id || context.membership.role === "owner" || context.membership.role === "admin",
        sourceCaseId: item.case_id ?? null,
        sourceCaseTitle: related?.title ?? "Outcome learning",
      };
    });
  }
  const groupedLearnings = groupOutcomeLearnings(learnings);
  const categoryLabels = outcomeLearningCategoryLabels(pageLocale);
  const categoryLabelsZh = outcomeLearningCategoryLabels("zh-Hant");
  return (
    <main className="portal-page">
      <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">行動 → 結果 → 學習</p><h1>完成循環。</h1><p>記錄實際發生的事，並決定哪些內容值得重用，工作才算完成。</p></>} en={<><p className="portal-kicker">Action → outcome → learning</p><h1>Close the loop.</h1><p>Record what happened and decide what to reuse before closing a case.</p></>} /></div></header>
      {pendingCases.length ? <div className="outcome-pending-stack">{pendingCases.map((pendingCase) => <OutcomeForm key={pendingCase.id} demo={demo} caseId={pendingCase.id} title={pendingCase.title} moduleLabel={moduleLabels[pendingCase.module]} moduleKey={pendingCase.module} />)}</div> : <div className="portal-panel no-outcome-card"><Localized zh={<><strong>現時沒有待回顧結果。</strong><p>已審批的行動記錄後，工作會顯示在這裡。</p></>} en={<><strong>No outcomes are waiting.</strong><p>A case appears here after its approved action is recorded.</p></>} /></div>}
      <section className="portal-section outcome-learning-section">
        <div className="portal-section-heading"><div><Localized zh={<><p className="portal-kicker">工作空間知識</p><h2>可重用學習</h2><p className="portal-section-subtitle">只有已確認的學習才會建議在新工作使用</p></>} en={<><p className="portal-kicker">Workspace knowledge</p><h2>Reusable learnings</h2><p className="portal-section-subtitle">Only approved learning is suggested in future cases</p></>} /></div></div>
        <div className="outcome-learning-categories">{OUTCOME_LEARNING_CATEGORY_ORDER.map((category) => {
          const categoryLearnings = groupedLearnings[category];
          return <section className="outcome-learning-category" key={category} aria-labelledby={`outcome-category-${category}`}>
            <header><div><p className="portal-kicker"><Localized zh={<>{categoryLabelsZh[category]}</>} en={<>{categoryLabels[category]}</>} /></p><h3 id={`outcome-category-${category}`}>{categoryLearnings.length} <Localized zh={<>項學習</>} en={<>learning record{categoryLearnings.length === 1 ? "" : "s"}</>} /></h3></div></header>
            {categoryLearnings.length ? <div className="approved-learning-grid">{categoryLearnings.map((item) => (
              <article className="portal-panel" key={item.id}>
                <span><Localized zh={<>{categoryLabelsZh[category]}</>} en={<>{categoryLabels[category]}</>} /></span><h3>{item.title}</h3><p className="learning-card-summary">{item.body}</p>
                <details className="learning-details"><summary><Localized zh={<>查看詳細學習</>} en={<>View detailed learning</>} /></summary><div className="learning-card-sections">
                  <div className="learning-card-section"><strong><Localized zh={<>實際結果：</>} en={<>Observed result:</>} /></strong><span>{item.observedResult || <Localized zh={<>未記錄</>} en={<>Not recorded</>} />}</span></div>
                  <div className="learning-card-section"><strong><Localized zh={<>適用情境：</>} en={<>Applicability:</>} /></strong><span>{item.applicability || <Localized zh={<>未記錄</>} en={<>Not recorded</>} />}</span></div>
                  <div className="learning-card-section"><strong><Localized zh={<>證據：</>} en={<>Evidence:</>} /></strong><span>{item.evidence || <Localized zh={<>未記錄</>} en={<>Not recorded</>} />}</span></div>
                  <div className="learning-card-section"><strong><Localized zh={<>證據信心：</>} en={<>Evidence confidence:</>} /></strong><span>{item.evidenceConfidence ? <Localized zh={<>{localizeLearningConfidence(item.evidenceConfidence, "zh-Hant")}</>} en={<>{localizeLearningConfidence(item.evidenceConfidence, "en")}</>} /> : <Localized zh={<>未記錄</>} en={<>Not recorded</>} />}</span></div>
                  <div className="learning-card-section"><strong><Localized zh={<>待測試假設：</>} en={<>Hypothesis to test:</>} /></strong><span>{item.hypothesis || <Localized zh={<>未記錄</>} en={<>Not recorded</>} />}</span></div>
                  <div className="learning-card-section"><strong><Localized zh={<>下一步／測試行動：</>} en={<>Next step/test action:</>} /></strong><span>{item.nextAction || <Localized zh={<>未記錄</>} en={<>Not recorded</>} />}</span></div>
                </div></details>
                <div>{item.tags.map((tag) => <small key={tag}><Localized zh={<>{tag === "approved" ? "已確認重用" : tag === "needs review" ? "待審閱" : tag === "keep" ? "候選草稿" : tag === "adapt" ? "已編輯加入" : tag === "discard" ? "不作學習" : tag}</>} en={<>{tag}</>} /></small>)}</div>
                <footer><span>{item.approvedBy === "Demo User" ? "Demo User" : <Localized zh={<>{item.needsConfirmation ? "等待確認" : "工作空間擁有人"}</>} en={<>{item.approvedBy}</>} />}</span><div className="learning-card-actions">{item.needsConfirmation ? <LearningConfirmationButton learningId={item.id} demo={demo} /> : null}{item.canDelete ? <LearningDeletionControl learningId={item.id} demo={demo} /> : null}</div></footer>
                <details className="learning-evidence"><summary><Localized zh={<>查看證據 →</>} en={<>View evidence →</>} /></summary><div><strong><Localized zh={<>已記錄證據</>} en={<>Recorded evidence</>} /></strong><p><Localized zh={<>{localizeLearningEvidence(item.evidence, "zh-Hant") || "這項學習未有獨立證據紀錄。"}</>} en={<>{localizeLearningEvidence(item.evidence, "en") || "No separate evidence was recorded for this learning."}</>} /></p><small><Localized zh={<>來源個案：</>} en={<>Source case:</>} /> {item.sourceCaseId ? <Link href={`/app/cases/${item.sourceCaseId}`}>「{item.sourceCaseTitle}」</Link> : <>「{item.sourceCaseTitle}」</>}</small></div></details>
              </article>
            ))}</div> : <div className="portal-panel outcome-category-empty"><Localized zh={<><strong>這個分類暫時沒有學習。</strong><p>完成相關模組的結果回顧後，內容會顯示在這裡。</p></>} en={<><strong>No reusable learnings yet.</strong><p>Complete an outcome review for this module to see it here.</p></>} /></div>}
          </section>;
        })}</div>
      </section>
    </main>
  );
}
