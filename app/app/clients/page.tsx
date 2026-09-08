import type { Metadata } from "next";
import { ClientManager } from "@/src/components/portal/client-manager";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { listClientCases, listClients } from "@/src/lib/server/clients";
import { Localized } from "@/src/components/locale-provider";
import { parseLocale } from "@/src/lib/i18n/locale";
import { demoCases, demoWorkflowStreams } from "@/src/data/demo-data";

export const metadata: Metadata = { title: "Clients" };

const demoClients = [
  { id: "demo-client-northstar", name: "Northstar", company: "Northstar Studio", status: "active" as const, notes: "" },
  { id: "demo-client-bean-bloom", name: "Bean & Bloom", company: "Bean & Bloom", status: "active" as const, notes: "" },
];

const demoDirectoryCases = demoCases.map((item, index) => {
  const workflow = index < demoWorkflowStreams.length ? demoWorkflowStreams[index] : null;
  return {
    id: item.id,
    title: item.title,
    module: item.module,
    status: item.status,
    client_id: index % 2 === 0 ? demoClients[index % demoClients.length].id : null,
    updated_at: `2026-08-${String(27 - index).padStart(2, "0")}T09:00:00.000Z`,
    workflow_stream_id: workflow?.id ?? null,
    workflow_stream_name: workflow?.name ?? null,
    workflow_stream_group_id: workflow?.group_id ?? null,
  };
});

export default async function ClientsPage() {
  const demo = isSafeDemoMode();
  const context = demo ? null : await requirePortalContext();
  const locale = demo ? parseLocale(undefined) : context!.locale;
  const supabase = context ? await createServerSupabaseClient() : null;
  const clients = context ? await listClients(supabase!, context.workspace.id) : demoClients;
  const cases = context ? await listClientCases(supabase!, context.workspace.id) : demoDirectoryCases;
  return <main className="portal-page clients-page">
    <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">個案一覽</p><h1>按客戶整理個案。</h1><p>按客戶及類別搜尋整理，快速回到每個個案的脈絡。</p></>} en={<><p className="portal-kicker">Case overview</p><h1>Organize cases by client.</h1><p>Search and group cases by client and category so every decision stays traceable.</p></>} /></div></header>
    <ClientManager initialClients={clients} initialCases={cases} locale={locale} />
  </main>;
}
