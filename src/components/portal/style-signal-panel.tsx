"use client";

import { useState } from "react";

export function StyleSignalPanel({ signal, profileActive = false, locale = "en" }: { signal: { id: string; status: string; structural_metadata?: { changedFields?: string[] } } | null; profileActive?: boolean; locale?: "en" | "zh-Hant" }) {
  const zh = locale === "zh-Hant"; const [state, setState] = useState(signal?.status ?? "none"); const [busy, setBusy] = useState(false);
  if (!signal || state !== "pending") return <section className="portal-panel style-signal-panel"><p className="portal-kicker">{zh ? "語氣學習" : "Tone learning"}</p><p>{profileActive ? (zh ? "工作區已有已確認的語氣規則。" : "Confirmed workspace style rules are active.") : (zh ? "尚未啟用工作區語氣規則。" : "No confirmed workspace style rules are active yet.")}</p></section>;
  const pendingSignal = signal;
  async function resolve(decision: "confirm" | "discard") { setBusy(true); try { const response = await fetch("/api/style-signals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signalId: pendingSignal.id, decision }) }); if (response.ok) setState(decision === "confirm" ? "confirmed" : "discarded"); } finally { setBusy(false); } }
  return <section className="portal-panel style-signal-panel" aria-labelledby="style-signal-title"><div className="artifact-heading"><div><p className="portal-kicker">{zh ? "語氣學習" : "Tone learning"}</p><h2 id="style-signal-title">{zh ? "要把這次人手修改加入工作區語氣嗎？" : "Reuse this human edit as workspace style?"}</h2></div></div><p>{zh ? `偵測到修改欄位：${pendingSignal.structural_metadata?.changedFields?.join(", ") || "內容"}。只會保存受限規則，不會複製整份內容。` : `Changed fields: ${pendingSignal.structural_metadata?.changedFields?.join(", ") || "content"}. Only bounded rules are saved; the full artifact is not copied.`}</p><div className="button-row"><button type="button" className="portal-primary-button" onClick={() => resolve("confirm")} disabled={busy}>{zh ? "確認加入" : "Confirm style"}</button><button type="button" className="portal-secondary-button" onClick={() => resolve("discard")} disabled={busy}>{zh ? "捨棄" : "Discard"}</button></div></section>;
}
