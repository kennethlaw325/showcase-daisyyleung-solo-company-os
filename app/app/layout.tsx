import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/src/components/locale-provider";
import { PortalShell } from "@/src/components/portal/portal-shell";
import { isSafeDemoMode } from "@/src/demo-mode";
import { getPortalContext } from "@/src/lib/supabase/auth";
import { parseLocale } from "@/src/lib/i18n/locale";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import "../portal-enhancements.css";


export default async function PrivatePortalLayout({ children }: { children: ReactNode }) {
  const demo = isSafeDemoMode();
  if (demo) {
    const initialLocale = parseLocale(undefined);
    return <LocaleProvider demo initialLocale={initialLocale}><PortalShell demo>{children}</PortalShell></LocaleProvider>;
  }

  const context = await getPortalContext();
  if (!context) redirect("/login?error=invite_required&next=/app");
  const supabase = await createServerSupabaseClient();
  const [caseResult, profileResult] = await Promise.all([
    supabase.from("cases").select("status").eq("workspace_id", context.workspace.id).in("status", ["awaiting_approval", "outcome_pending"]),
    supabase.from("profiles").select("display_name").eq("id", context.user.id).maybeSingle(),
  ]);
  const statuses = caseResult.data ?? [];
  const counts = {
    approvals: statuses.filter((item) => item.status === "awaiting_approval").length,
    outcomes: statuses.filter((item) => item.status === "outcome_pending").length,
  };
  const userName = profileResult.data?.display_name?.trim() || context.user.email?.split("@", 1)[0] || (context.locale === "zh-Hant" ? "工作空間擁有人" : "Workspace owner");
  return <LocaleProvider persist initialLocale={context.locale}><PortalShell counts={counts} userName={userName}>{children}</PortalShell></LocaleProvider>;
}
