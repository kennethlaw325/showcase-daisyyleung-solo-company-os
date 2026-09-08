import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPilotTable, type PilotApplicationSummary } from "@/src/components/admin-pilot-table";
import { isSafeDemoMode } from "@/src/demo-mode";
import { requirePlatformAdminUser } from "@/src/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { formatHongKongDate, formatHongKongTime } from "@/src/lib/i18n/hong-kong-time";

export const metadata: Metadata = { title: "Pilot admin", robots: { index: false, follow: false } };


export default async function PilotAdminPage() {
  const demo = isSafeDemoMode();
  let applications: PilotApplicationSummary[] | undefined;
  if (!demo) {
    try {
      await requirePlatformAdminUser();
      const admin = createSupabaseAdminClient();
      const result = await admin.from("pilot_applications").select("id,name,email,role,goals,created_at").in("status", ["new", "reviewing"]).order("created_at", { ascending: true }).limit(50);
      applications = (result.data ?? []).map((item) => { const submitted = new Date(item.created_at); return { id: item.id, name: item.name, email: item.email, role: item.role ?? "Solo operator", pain: item.goals, submitted: `${formatHongKongDate(submitted)}, ${formatHongKongTime(submitted)}` }; });
    } catch {
      redirect("/login?error=admin_required&next=/admin/pilot");
    }
  }
  return (
    <main className="admin-page">
      <header className="admin-header"><Link className="brand-lockup" href="/"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>Solo Company OS</span></Link><div><span>Founding pilot</span><Link href="/app">Portal →</Link></div></header>
      <section className="admin-intro"><div><p className="portal-kicker">Pilot control</p><h1>Build with the right twelve people.</h1><p>Review fit before account creation. Approval creates one exact invitation for the applicant’s email.</p></div><div className="admin-stats"><span><strong>02</strong>Pending review</span><span><strong>00</strong>Invited this week</span><span><strong>08</strong>Places remaining</span></div></section>
      <section className="admin-list-section"><div className="portal-section-heading"><div><p className="portal-kicker">Applications</p><h2>Pending review</h2></div><span>No account exists until approval</span></div><AdminPilotTable demo={demo} applications={applications} /></section>
    </main>
  );
}
