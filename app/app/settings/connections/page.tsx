import type { Metadata } from "next";
import { ConnectionPanel } from "@/src/components/portal/connection-panel";
import { isSafeDemoMode } from "@/src/demo-mode";
import { Localized } from "@/src/components/locale-provider";
import { requirePortalContext } from "@/src/lib/supabase/auth";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const metadata: Metadata = { title: "Connections", robots: { index: false, follow: false } };

type ConnectionsSearchParams = Promise<Record<string, string | string[] | undefined>>;
type CallbackFailureStage = "request" | "session" | "token" | "identity" | "persistence";
const CALLBACK_FAILURE_STAGES = new Set<CallbackFailureStage>(["request", "session", "token", "identity", "persistence"]);

function firstSearchParam(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConnectionsPage() {
  const demo = isSafeDemoMode();
  const query: Awaited<ConnectionsSearchParams> = {};
  const requestedCallbackResult = firstSearchParam(query, "connected") === "google"
    ? "connected"
    : firstSearchParam(query, "error") === "google_connect"
      ? "error"
      : null;
  const requestedFailureStage = firstSearchParam(query, "stage");
  const callbackFailureStage = requestedCallbackResult === "error" && requestedFailureStage && CALLBACK_FAILURE_STAGES.has(requestedFailureStage as CallbackFailureStage)
    ? requestedFailureStage as CallbackFailureStage
    : null;
  let initialConnected = false;
  let connectionEmail: string | null = null;
  let connectionStatus: "active" | "reauthorization_required" | "disconnecting" | null = null;
  let reconnectReason: string | null = null;
  let gmailConfigured = false;

  if (!demo) {
    const context = await requirePortalContext();
    const supabase = await createServerSupabaseClient();
    const { data: connection } = await supabase
      .from("oauth_connections")
      .select("id, provider_account_email, mailbox_email, status, last_error_code")
      .eq("workspace_id", context.workspace.id)
      .eq("provider", "google")
      .eq("owner_user_id", context.user.id)
      .maybeSingle();
    connectionEmail = connection?.mailbox_email ?? connection?.provider_account_email ?? null;
    connectionStatus = connection?.status ?? null;
    reconnectReason = connection?.last_error_code ?? null;
    initialConnected = connection?.status === "active";
    // Keep provider and service-role configuration on the server; the client
    // receives only this bounded readiness flag.
    gmailConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID
      && process.env.GOOGLE_CLIENT_SECRET
      && (process.env.GOOGLE_OAUTH_STATE_SECRET?.length ?? 0) >= 32
      && process.env.GOOGLE_OAUTH_REDIRECT_URI
      && process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }
  const callbackResult = requestedCallbackResult === "connected" && !demo && !initialConnected
    ? "error"
    : requestedCallbackResult;

  return (
    <main className="portal-page">
      <header className="portal-page-header compact"><div><Localized zh={<><p className="portal-kicker">設定 / 連接</p><h1>有意識地連接。</h1><p>每個連接都有清晰職責、可見範圍及可撤回權限。</p></>} en={<><p className="portal-kicker">Settings / Connections</p><h1>Connect deliberately.</h1><p>Every connector has a narrow job, visible scope, and reversible access.</p></>} /></div></header>
      <ConnectionPanel demo={demo} initialConnected={initialConnected} initialStatus={connectionStatus} connectionEmail={connectionEmail} reconnectReason={reconnectReason} callbackResult={callbackResult} callbackFailureStage={callbackFailureStage} gmailConfigured={gmailConfigured} />
    </main>
  );
}
