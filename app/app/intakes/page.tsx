import type { Metadata } from "next";
import { IntakeHistory } from "@/src/components/portal/intake-history";
import { Localized } from "@/src/components/locale-provider";
import { isSafeDemoMode } from "@/src/demo-mode";
import { listIntakeSnapshots, type IntakeSnapshotListItem } from "@/src/lib/server/intake-snapshots";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { parseLocale } from "@/src/lib/i18n/locale";

export const metadata: Metadata = { title: "Initial Inputs", robots: { index: false, follow: false } };

const demoSnapshots: IntakeSnapshotListItem[] = [{
  id: "demo-intake-001",
  caseId: "growth-offer-launch",
  caseTitle: "Strategy Sprint · Founding offer",
  module: "growth",
  payload: {
    schemaVersion: 1,
    title: "Strategy Sprint · Founding offer",
    objective: "Turn the existing service into one focused offer and an approved first outreach draft.",
    module: "growth",
    moduleContext: { schemaVersion: 1, successCriteria: "Three qualified conversations" },
    sourceManifest: [{ kind: "pasted", filename: "intake.txt", sha256: null, byteSize: 4200, urlHost: null }],
  },
  snapshot_status: "exact",
  semantic_payload_hash: "8f2c1b9770d385d3ad9bf0b496459f3fb6905ef6c088723054255794cb0b71ab",
  created_at: "2026-08-20T09:00:00.000Z",
}];

export default async function InitialInputsPage() {
  const requestedCase: string | string[] | undefined = undefined;
  const focusedCaseId = typeof requestedCase === "string" && requestedCase.length <= 100 ? requestedCase : undefined;
  const demo = isSafeDemoMode();
  const context = demo ? null : await requirePortalContext();
  const snapshots = demo
    ? demoSnapshots
    : await listIntakeSnapshots({ supabase: await createServerSupabaseClient(), workspaceId: context!.workspace.id });
  const locale = demo ? parseLocale(undefined) : context!.locale;
  return <main className="portal-page initial-inputs-page">
    <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">初始輸入</p><h1>初始輸入。</h1><p>查看每個個案建立當刻的不可修改快照；舊個案會清楚標示為部分重建。</p></>} en={<><p className="portal-kicker">Initial inputs</p><h1>Initial inputs.</h1><p>Review the immutable snapshot captured when each case was created. Older cases are clearly marked as partial reconstructions.</p></>} /></div></header>
    <IntakeHistory snapshots={snapshots} locale={locale} focusedCaseId={focusedCaseId} />
  </main>;
}
