import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientSnapshot } from "@/src/components/portal/client-snapshot";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { loadClientSnapshot } from "@/src/lib/server/clients";
import { demoCases } from "@/src/data/demo-data";

const demoClients: Record<string, { name: string; company: string; notes: string; caseIds: string[] }> = {
  "demo-client-northstar": { name: "Northstar", company: "Northstar Studio", notes: "Founding-offer pilot. Prefers one clear decision per email; no attachments.", caseIds: ["growth-offer-launch", "ai-agents-brief"] },
  "demo-client-bean-bloom": { name: "Bean & Bloom", company: "Bean & Bloom", notes: "Two-person studio. Wants the weekly operating review summarised in five lines.", caseIds: ["studio-retro", "partner-decision"] },
};

const demoOutcomes: Record<string, { next_action: string; blockers: string; actual_result: string; follow_up_date: string | null }> = {
  "growth-offer-launch": { next_action: "Send revision 3 once the pilot count is corrected.", blockers: "Pricing page still shows the old tiering.", actual_result: "Two qualified conversations booked from the first outreach batch.", follow_up_date: "2026-09-15" },
  "ai-agents-brief": { next_action: "Confirm the public explainer wording with the client.", blockers: "", actual_result: "Client approved the media narrative unchanged.", follow_up_date: null },
  "studio-retro": { next_action: "Record what actually moved this week.", blockers: "Outcome review not written up yet.", actual_result: "", follow_up_date: "2026-09-12" },
  "partner-decision": { next_action: "Add the missing owner for the handoff decision.", blockers: "No owner named for the operations step.", actual_result: "", follow_up_date: null },
};

type PageProps = { params: Promise<{ id: string }> };
export const metadata: Metadata = { title: "Client snapshot | Solo Company OS" };

export function generateStaticParams() {
  return [{ id: "demo-client-northstar" }, { id: "demo-client-bean-bloom" }];
}

export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;
  const context = isSafeDemoMode() ? null : await requirePortalContext();
  if (!context) {
    const profile = demoClients[id] ?? { name: "Demo client", company: "Demo workspace", notes: "", caseIds: [] };
    const linked = demoCases.filter((item) => profile.caseIds.includes(item.id));
    return <ClientSnapshot
      demo
      locale="en"
      snapshot={{
        client: { id, name: profile.name, company: profile.company, status: "active", notes: profile.notes },
        cases: linked.map((item, index) => ({ id: item.id, title: item.title, module: item.module, status: item.status, current_revision: 3 - index, updated_at: `2026-09-0${index + 4}T09:00:00.000Z` })),
        outcomes: linked.map((item) => ({ case_id: item.id, ...demoOutcomes[item.id] })),
        sources: linked.flatMap((item, index) => [{ case_id: item.id, id: `${item.id}-source-a` }, ...(index === 0 ? [{ case_id: item.id, id: `${item.id}-source-b` }] : [])]),
        audit: linked.map((item, index) => ({ id: index + 1, event_type: "artifact_revision_created", created_at: `2026-09-0${index + 4}T09:00:00.000Z` })),
      }}
    />;
  }
  let snapshot;
  try { snapshot = await loadClientSnapshot({ supabase: await createServerSupabaseClient(), workspaceId: context.workspace.id, clientId: id }); } catch { notFound(); }
  return <ClientSnapshot snapshot={snapshot} locale={context.locale} />;
}
