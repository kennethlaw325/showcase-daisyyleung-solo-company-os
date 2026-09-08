import type { Metadata } from "next";
import { Localized } from "@/src/components/locale-provider";
import { WorkflowManager } from "@/src/components/portal/workflow-manager";
import { demoWorkflowStreams } from "@/src/data/demo-data";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { WORKFLOW_STREAM_SELECT } from "@/src/lib/domain/workflow-stream";
import type { WorkflowStream } from "@/src/lib/domain/types";

export const metadata: Metadata = { title: "My Workflow", robots: { index: false, follow: false } };

export default async function WorkflowsPage() {
  const demo = isSafeDemoMode();
  let workflows: WorkflowStream[] = demo ? [...demoWorkflowStreams] as unknown as WorkflowStream[] : [];
  if (!demo) {
    const context = await requirePortalContext();
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.from("workflow_streams").select(WORKFLOW_STREAM_SELECT).eq("workspace_id", context.workspace.id).order("status", { ascending: true }).order("updated_at", { ascending: false });
    workflows = (data ?? []) as unknown as WorkflowStream[];
  }
  return (
    <main className="portal-page workflows-page">
      <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">我的工作流</p><h1>把習慣固定下來。</h1><p>自訂工作流名稱、預設資料及檢查清單，日後建立工作時可以直接重用；審批關卡及結果回顧始終保留。</p></>} en={<><p className="portal-kicker">My Workflow</p><h1>Make the useful path repeatable.</h1><p>Name and reuse intake defaults and checklists for future cases; approval gates and outcome review stay protected.</p></>} /></div></header>
      <WorkflowManager demo={demo} initialWorkflows={workflows} />
    </main>
  );
}
