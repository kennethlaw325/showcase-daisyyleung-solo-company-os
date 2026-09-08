"use client";

import { useState } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";

type ConnectionCallbackResult = "connected" | "error" | null;
type ConnectionStatus = "active" | "reauthorization_required" | "disconnecting" | null;
type CallbackFailureStage = "request" | "session" | "token" | "identity" | "persistence" | null;

export function ConnectionPanel({
  demo = false,
  initialConnected = false,
  initialStatus = null,
  connectionEmail = null,
  reconnectReason = null,
  callbackResult = null,
  callbackFailureStage = null,
  gmailConfigured = false,
}: {
  demo?: boolean;
  initialConnected?: boolean;
  initialStatus?: ConnectionStatus;
  connectionEmail?: string | null;
  reconnectReason?: string | null;
  callbackResult?: ConnectionCallbackResult;
  callbackFailureStage?: CallbackFailureStage;
  gmailConfigured?: boolean;
}) {
  const { locale } = useLocale();
  const copy = getPortalCopy(locale).connections;
  const [connected, setConnected] = useState(initialConnected || (demo && callbackResult === "connected"));
  const [email, setEmail] = useState(connectionEmail);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(initialStatus ?? (initialConnected ? "active" : null));
  const [state, setState] = useState<"idle" | "connecting" | "disconnecting" | "error">(callbackResult === "error" ? "error" : "idle");
  const callbackError = callbackFailureStage === "session"
    ? copy.callbackSessionError
    : callbackFailureStage === "token"
      ? copy.callbackTokenError
      : callbackFailureStage === "identity"
        ? copy.callbackIdentityError
        : callbackFailureStage === "persistence"
          ? copy.callbackPersistenceError
          : callbackFailureStage === "request"
            ? copy.callbackRequestError
            : copy.callbackError;
  const [message, setMessage] = useState(callbackResult === "connected" ? copy.callbackSuccess : callbackResult === "error" ? callbackError : "");
  const [exporting, setExporting] = useState(false);
  const [dataMessage, setDataMessage] = useState("");

  function connectDemo() {
    setConnected(true);
    setConnectionStatus("active");
    setState("idle");
    setMessage(copy.callbackSuccess);
  }

  async function disconnect() {
    if (demo) {
      setConnected(false);
      setConnectionStatus(null);
      setEmail(null);
      setState("idle");
      setMessage(copy.disconnectSuccess);
      return;
    }
    setState("disconnecting");
    setMessage("");
    try {
      const response = await fetch("/api/oauth/google/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(copy.disconnectError);
      setConnected(false);
      setConnectionStatus(null);
      setEmail(null);
      setState("idle");
      setMessage(copy.disconnectSuccess);
    } catch {
      setState("error");
      setMessage(copy.disconnectError);
    }
  }

  function downloadExport(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function exportWorkspace() {
    setExporting(true);
    setDataMessage(copy.exporting);
    try {
      if (demo) {
        downloadExport(new Blob([JSON.stringify({ demo: true, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }), "solo-company-os-demo-export.json");
      } else {
        const response = await fetch("/api/workspace/export");
        if (!response.ok) throw new Error(copy.exportError);
        const disposition = response.headers.get("content-disposition") ?? "";
        const filename = /filename="([A-Za-z0-9_.-]+)"/i.exec(disposition)?.[1] ?? "solo-company-os-workspace-export.json";
        downloadExport(await response.blob(), filename);
      }
      setDataMessage(copy.exportReady);
    } catch {
      setDataMessage(copy.exportError);
    } finally {
      setExporting(false);
    }
  }

  const connectionStatusLabel = state === "connecting"
    ? copy.connecting
    : state === "disconnecting"
      ? copy.disconnecting
      : connectionStatus === "reauthorization_required"
        ? copy.reauthorizationRequired
      : connected
        ? copy.connected
        : copy.notConnected;

  return (
    <div className="settings-stack">
      <section className="portal-panel connection-card">
        <div className="connection-identity"><span className="gmail-mark" aria-hidden="true">M</span><div><h2>Gmail</h2><p>{copy.gmailBody}</p></div></div>
        <div className="connection-state">
          <span className={connected ? "connection-ok" : "connection-status-label"}><i aria-hidden="true" />{connectionStatusLabel}</span>
          {connected ? <button type="button" onClick={disconnect} disabled={state === "disconnecting"}>{state === "disconnecting" ? copy.disconnecting : copy.disconnect}</button> : demo ? <button className="portal-primary-button" type="button" onClick={connectDemo}>{copy.connect}</button> : gmailConfigured ? <a className="portal-primary-button" href="/api/oauth/google/start" onClick={() => { setState("connecting"); setMessage(copy.connecting); }}>{connectionStatus === "reauthorization_required" ? copy.reconnect : state === "connecting" ? copy.connecting : copy.connect}</a> : <button className="portal-primary-button" type="button" disabled>{copy.connect}</button>}
        </div>
        {email ? <p className="connection-email">{copy.connectedAs}: <strong>{email}</strong></p> : null}
        {connectionStatus === "reauthorization_required" || reconnectReason ? <p className="connection-reconnect-reason">{copy.reconnectReason}</p> : null}
        <div className="scope-note"><strong>{copy.requestedScope}</strong><code>gmail.compose</code><p>{copy.scopeBody}</p></div>
        <div className="connection-feedback" role={state === "error" ? "alert" : "status"} aria-live="polite">
          {message || (demo ? connectionStatusLabel : `${gmailConfigured ? copy.configured : copy.unconfigured} · ${connectionStatusLabel}`)}
        </div>
      </section>
      <section className="portal-panel data-settings">
        <div><p className="portal-kicker">{copy.dataControls}</p><h2>{copy.dataTitle}</h2><p>{copy.dataBody}</p><p className="data-feedback" role="status" aria-live="polite">{dataMessage}</p></div>
        <div className="data-actions"><button type="button" onClick={exportWorkspace} disabled={exporting}>{exporting ? copy.exporting : copy.export}</button><button type="button" className="danger-button" onClick={() => setDataMessage(copy.deleteUnavailable)}>{copy.delete}</button></div>
      </section>
    </div>
  );
}
