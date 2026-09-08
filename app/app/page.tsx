import type { Metadata } from "next";
import { TodayDashboard, type DashboardCase, type DashboardLearning } from "@/src/components/portal/today-dashboard";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { presentLearningCard, summarizeLearningTitle } from "@/src/lib/presentation/learning-card";
import { formatHongKongDate, getHongKongGreetingPeriod } from "@/src/lib/i18n/hong-kong-time";

export const metadata: Metadata = { title: "Today", robots: { index: false, follow: false } };


const accents = { growth: "violet", operations: "cyan", intelligence: "amber" } as const;
const nextActions = {
  awaiting_approval: "Review the latest artifact",
  action_pending: "Execute the approved action",
  outcome_pending: "Record the observed outcome",
  blocked: "Add the missing context",
} as const;

export default async function PortalHomePage() {
  const initialGreetingPeriod = getHongKongGreetingPeriod();
  if (isSafeDemoMode()) return <TodayDashboard demo initialGreetingPeriod={initialGreetingPeriod} />;

  const context = await requirePortalContext();
  const supabase = await createServerSupabaseClient();
  const [caseResult, learningResult] = await Promise.all([
    supabase.from("cases").select("id,module,title,status,updated_at").eq("workspace_id", context.workspace.id).in("status", Object.keys(nextActions)).order("updated_at", { ascending: false }).limit(12),
    supabase.from("learning_records").select("id,note,disposition,created_at,cases(module,title)").eq("workspace_id", context.workspace.id).eq("approved_for_reuse", true).is("deleted_at", null).order("created_at", { ascending: false }).limit(4),
  ]);

  const cases: DashboardCase[] = (caseResult.data ?? []).flatMap((item) => {
    if (!(item.status in nextActions) || !(item.module in accents)) return [];
    const status = item.status as keyof typeof nextActions;
    const moduleKey = item.module as keyof typeof accents;
    return [{ id: item.id, module: moduleKey, title: item.title, status, nextAction: nextActions[status], meta: `Updated ${formatHongKongDate(new Date(item.updated_at))}`, accent: accents[moduleKey] }];
  });
  const learnings: DashboardLearning[] = (learningResult.data ?? []).map((item) => {
    const related = Array.isArray(item.cases) ? item.cases[0] : item.cases;
    const moduleKey = related?.module ?? "Workspace";
    const presentation = presentLearningCard({ note: item.note });
    return { module: moduleKey, title: summarizeLearningTitle(presentation.learning), body: presentation.learning, tags: [moduleKey, item.disposition] };
  });
  const userName = context.user.displayName || context.user.email?.split("@")[0] || (context.locale === "zh-Hant" ? "工作空間擁有人" : "Workspace owner");
  return <TodayDashboard cases={cases} learnings={learnings} userName={userName} initialGreetingPeriod={initialGreetingPeriod} />;
}
