import type { Metadata } from "next";
import { NewCaseEntry } from "@/src/components/portal/new-case-entry";
import { isSafeDemoMode } from "@/src/demo-mode";
import { Localized } from "@/src/components/locale-provider";
import { getPortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { emptyLearningCandidatesByModule, loadApprovedLearningCandidates } from "@/src/lib/server/case-work-packets";
import { WORKFLOW_STREAM_SELECT } from "@/src/lib/domain/workflow-stream";
import { demoWorkflowStreams } from "@/src/data/demo-data";
import type { WorkflowStream } from "@/src/lib/domain/types";
import { listClients } from "@/src/lib/server/clients";

export const metadata: Metadata = { title: "New case", robots: { index: false, follow: false } };

export default async function NewCasePage() {
  const requestedMode: string | string[] | undefined = undefined;
  const initialMode = requestedMode === "manual" ? "manual" : "guided";
  const demo = isSafeDemoMode();
  let learningCandidatesByModule = emptyLearningCandidatesByModule();
  let workflowStreams: WorkflowStream[] = demo ? [...demoWorkflowStreams] as unknown as WorkflowStream[] : [];
  let clients: Array<{ id: string; name: string; company?: string }> = [];
  if (!demo) {
    const context = await getPortalContext();
    if (context) {
      learningCandidatesByModule = await loadApprovedLearningCandidates({
        supabase: await createServerSupabaseClient(),
        workspaceId: context.workspace.id,
      });
      const supabase = await createServerSupabaseClient();
      const { data } = await supabase.from("workflow_streams").select(WORKFLOW_STREAM_SELECT).eq("workspace_id", context.workspace.id).eq("status", "active").order("updated_at", { ascending: false });
      workflowStreams = (data ?? []) as unknown as WorkflowStream[];
      clients = await listClients(supabase, context.workspace.id);
    }
  }
  return (
    <main className="portal-page new-case-page">
      <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">由結果開始</p><h1>建立新工作。</h1><p>先選擇半自動分析或手動填寫；建立前你都可以審閱輸入。</p></>} en={<><p className="portal-kicker">Start with the outcome</p><h1>Create a new case.</h1><p>Start with semi-automatic analysis or manual entry. You can review the input before creation.</p></>} /></div></header>
      <NewCaseEntry demo={demo} learningCandidatesByModule={learningCandidatesByModule} workflowStreams={workflowStreams} clients={clients} initialMode={initialMode} />
    </main>
  );
}
