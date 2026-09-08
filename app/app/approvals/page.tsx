import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalPanel } from "@/src/components/portal/approval-panel";
import { ArtifactApprovalPanel } from "@/src/components/portal/artifact-approval-panel";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { Localized } from "@/src/components/locale-provider";
import type { CaseStatus, ModuleKey } from "@/src/lib/domain/types";

export const metadata: Metadata = { title: "Approvals", robots: { index: false, follow: false } };

type PendingAction = { id: string; payload_hash: string; idempotency_key: string; status: "pending" | "executing" | "executed" | "failed" | "cancelled"; payload: { to: string; cc?: string[]; bcc?: string[]; subject: string; body: string; thread_id?: string } };
type ApprovalCase = { id: string; title: string; brief: string; module: ModuleKey; status: CaseStatus; current_revision: number };
type ApprovalArtifact = { revision: number; content_hash: string; content_locale?: string; content: Record<string, unknown> };
type ApprovalItem = { caseRecord: ApprovalCase; artifact: ApprovalArtifact | null; action: PendingAction | null };

const DEMO_GROWTH: ApprovalItem = {
  caseRecord: { id: "growth-offer-launch", title: "Strategy Sprint · Founding offer", brief: "Prepare the exact approved outreach for the founding offer.", module: "growth", status: "awaiting_approval", current_revision: 3 },
  artifact: { revision: 3, content_hash: "8f2c1b9770d385d3ad9bf0b496459f3fb6905ef6c088723054255794cb0b71ab", content_locale: "zh-Hant", content: { title: "Demand-to-revenue strategy", summary: "Position the Strategy Sprint as a focused decision product.", body: "Qualify prospects around a delayed launch, lead with concrete decision artifacts, and move follow-up toward one clear conversion event.", next_action: "Review the nurture and sales follow-up draft" } },
  action: { id: "00000000-0000-4000-8000-000000000014", payload_hash: "8f2c1b9770d385d3ad9bf0b496459f3fb6905ef6c088723054255794cb0b71ab", idempotency_key: "demo-growth-draft-000014", status: "pending", payload: { to: "alex@northstar.studio", subject: "A focused route from demand to conversion", body: "Hi Alex,\n\nI’ve shaped the Strategy Sprint around one outcome: moving qualified demand into a sales path your team can measure and follow.\n\nDemo User" } },
};

const DEMO_INTELLIGENCE: ApprovalItem = {
  caseRecord: { id: "ai-agents-brief", title: "Client audience brief", brief: "Approve the source-grounded client narrative.", module: "intelligence", status: "awaiting_approval", current_revision: 2 },
  artifact: { revision: 2, content_hash: "9f2c1b9770d385d3ad9bf0b496459f3fb6905ef6c088723054255794cb0b71ac", content_locale: "zh-Hant", content: { title: "Approval-first AI: reputation narrative", summary: "The strongest near-term story is useful preparation with human approval at consequential boundaries.", body: "Credibility concentrates where the system preserves provenance and pauses before external action.", next_action: "Approve the core PR narrative and audience boundaries" } },
  action: null,
};

function textField(content: Record<string, unknown>, key: string, fallback: string): string {
  return typeof content[key] === "string" && content[key] ? content[key] as string : fallback;
}

export default async function ApprovalsPage() {
  const demo = isSafeDemoMode();
  let items: ApprovalItem[] = [DEMO_GROWTH, DEMO_INTELLIGENCE];
  if (!demo) {
    const context = await requirePortalContext();
    const supabase = await createServerSupabaseClient();
    const result = await supabase.from("cases").select("id,title,brief,module,status,current_revision").eq("workspace_id", context.workspace.id).eq("status", "awaiting_approval").order("updated_at", { ascending: true }).limit(20);
    const cases = (result.data ?? []) as ApprovalCase[];
    items = await Promise.all(cases.map(async (caseRecord) => {
      const [artifactResult, actionResult] = await Promise.all([
        supabase.from("case_artifacts").select("revision,content_hash,content,content_locale").eq("workspace_id", context.workspace.id).eq("case_id", caseRecord.id).eq("revision", caseRecord.current_revision).maybeSingle(),
        supabase.from("case_actions").select("id,payload_hash,idempotency_key,payload,status").eq("workspace_id", context.workspace.id).eq("case_id", caseRecord.id).eq("artifact_revision", caseRecord.current_revision).maybeSingle(),
      ]);
      return { caseRecord, artifact: artifactResult.data as ApprovalArtifact | null, action: actionResult.data as PendingAction | null };
    }));
  }

  return (
    <main className="portal-page">
      <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">只有你能作出的決定</p><h1>待審批。</h1><p>逐項審閱目前修訂稿；如有修改，儲存後會建立下一稿，並需要重新審批。</p></>} en={<><p className="portal-kicker">Decisions only you can make</p><h1>Approvals.</h1><p>Review each current draft; edits save as the next draft and require fresh approval.</p></>} /></div><span className="header-count"><Localized zh={<>{items.length} 項待處理</>} en={<>{items.length} pending</>} /></span></header>
      <div className="approval-page-stack">
        {items.map(({ caseRecord, artifact, action }) => {
          const content = artifact?.content ?? {};
          const title = textField(content, "title", caseRecord.title);
          const summary = textField(content, "summary", caseRecord.brief);
          const body = textField(content, "body", summary);
          const nextAction = textField(content, "next_action", "Review the draft");
          const contentLocale = artifact?.content_locale === "zh-Hant" ? "zh-Hant" : "en";
          if (artifact && action) {
            return <ApprovalPanel key={caseRecord.id} demo={demo} caseId={caseRecord.id} artifactRevision={artifact.revision} artifactHash={artifact.content_hash} actionPayloadHash={action.payload_hash} actionId={action.id} idempotencyKey={action.idempotency_key} to={action.payload.to} cc={action.payload.cc} bcc={action.payload.bcc} threadId={action.payload.thread_id} subject={action.payload.subject} body={action.payload.body} artifactTitle={title} artifactSummary={summary} artifactBody={body} artifactNextAction={nextAction} contentLocale={contentLocale} module={caseRecord.module} caseStatus={caseRecord.status} actionStatus={action.status} />;
          }
          if (artifact && caseRecord.module === "intelligence") {
            return <ArtifactApprovalPanel key={caseRecord.id} caseId={caseRecord.id} revision={artifact.revision} artifactHash={artifact.content_hash} title={title} summary={summary} body={body} nextAction={nextAction} contentLocale={contentLocale} caseStatus={caseRecord.status} demo={demo} />;
          }
          return (
            <div className="portal-panel no-outcome-card" key={caseRecord.id}>
	              <Localized
	                zh={<>
	                  <strong>「{caseRecord.title}」還差 4 項資料，先可以審批。</strong>
	                  <ol className="required-action-data">
	                    <li><b>收件人：</b>填寫對方的電郵地址</li>
	                    <li><b>主旨：</b>填寫電郵主旨</li>
	                    <li><b>內文：</b>完成完整電郵草稿</li>
	                    <li><b>批准：</b>檢查以上資料後，按「批准」</li>
	                  </ol>
	                  <p className="approval-blocker-context"><b>這次審批的內容：</b>「{caseRecord.title}」的電郵草稿。批准後只會在 Gmail 建立草稿，不會自動寄出。</p>
	                  <Link href={`/app/cases/${caseRecord.id}`}>去「{caseRecord.title}」補完資料 →</Link>
	                </>}
	                en={<>
	                  <strong>“{caseRecord.title}” still needs four details before approval.</strong>
	                  <ol className="required-action-data">
	                    <li><b>Recipient:</b> add the recipient’s email address</li>
	                    <li><b>Subject:</b> add the email subject</li>
	                    <li><b>Message:</b> complete the full email draft</li>
	                    <li><b>Approve:</b> check the details above, then approve</li>
	                  </ol>
	                  <p className="approval-blocker-context"><b>You are approving:</b> the email draft for “{caseRecord.title}”. Approval creates a draft in Gmail only; nothing is sent automatically.</p>
	                  <Link href={`/app/cases/${caseRecord.id}`}>Finish the details in “{caseRecord.title}” →</Link>
	                </>}
              />
            </div>
          );
        })}
        {!items.length ? <div className="portal-panel no-outcome-card"><Localized zh={<><strong>現時沒有待審批項目。</strong><p>準備好新的修訂稿後，會顯示在這裡。</p></>} en={<><strong>No approvals are waiting.</strong><p>New approval-ready drafts will appear here.</p></>} /></div> : null}
      </div>
    </main>
  );
}
