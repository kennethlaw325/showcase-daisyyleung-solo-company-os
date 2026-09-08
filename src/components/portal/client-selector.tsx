"use client";

import { useId, useState } from "react";

export type ClientOption = { id: string; name: string; company?: string | null };

type ClientSelectorProps = {
  clients?: ClientOption[];
  value: string;
  onChange: (clientId: string) => void;
  locale?: "en" | "zh-Hant";
  demo?: boolean;
  disabled?: boolean;
};

/**
 * A shared, optional client link used by both manual and guided intake.
 * Creating a client is an explicit action; demo mode only adds a local option.
 */
export function ClientSelector({ clients = [], value, onChange, locale = "en", demo = false, disabled = false }: ClientSelectorProps) {
  const zh = locale === "zh-Hant";
  const selectId = useId().replace(/:/g, "");
  const addNameId = `${selectId}-add-name`;
  const addCompanyId = `${selectId}-add-company`;
  const [options, setOptions] = useState<ClientOption[]>(clients);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function openAdd() {
    setAdding(true);
    setError("");
    setMessage("");
  }

  function closeAdd() {
    if (busy) return;
    setAdding(false);
    setName("");
    setCompany("");
    setError("");
  }

  async function addClient() {
    const trimmedName = name.trim();
    if (!trimmedName || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let client: ClientOption;
      if (demo) {
        client = { id: `demo-client-${Date.now()}`, name: trimmedName, company: company.trim() || null };
      } else {
        const response = await fetch("/api/clients", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: trimmedName, company: company.trim() }),
        });
        const body = await response.json() as { client?: ClientOption; error?: string };
        if (!response.ok || !body.client) throw new Error(body.error ?? (zh ? "未能新增客戶。" : "The client could not be added."));
        client = body.client;
      }
      setOptions((current) => current.some((item) => item.id === client.id) ? current : [client, ...current]);
      onChange(client.id);
      setName("");
      setCompany("");
      setAdding(false);
      setMessage(demo
        ? (zh ? "示範客戶只在今次頁面暫存。" : "Demo client is available on this page only.")
        : (zh ? "客戶已新增並已連結。" : "Client added and linked."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? "未能新增客戶。" : "The client could not be added."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="client-selector" data-testid="client-selector">
      <label htmlFor={selectId}><span>{zh ? "連結客戶（可選）" : "Link client (optional)"}</span>
        <select id={selectId} name="clientId" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || busy}>
          <option value="">{zh ? "不連結" : "No client"}</option>
          {options.map((client) => <option value={client.id} key={client.id}>{client.name}{client.company ? ` · ${client.company}` : ""}</option>)}
        </select>
      </label>
      <button type="button" className="portal-secondary-button client-selector-add" onClick={openAdd} disabled={disabled || busy || adding}>
        {zh ? "＋ 新增客戶" : "＋ Add new client"}
      </button>
      {adding ? <div className="client-selector-add-form" role="group" aria-label={zh ? "新增客戶" : "Add new client"}>
        <label htmlFor={addNameId}><span>{zh ? "名稱" : "Name"}</span><input id={addNameId} value={name} onChange={(event) => setName(event.target.value)} autoComplete="organization" disabled={busy} /></label>
        <label htmlFor={addCompanyId}><span>{zh ? "公司（可選）" : "Company (optional)"}</span><input id={addCompanyId} value={company} onChange={(event) => setCompany(event.target.value)} autoComplete="organization" disabled={busy} /></label>
        <div className="client-selector-add-actions"><button type="button" className="portal-primary-button" onClick={addClient} disabled={!name.trim() || busy}>{busy ? (zh ? "新增中…" : "Adding…") : (zh ? "確認新增" : "Add client")}</button><button type="button" className="portal-secondary-button" onClick={closeAdd} disabled={busy}>{zh ? "取消" : "Cancel"}</button></div>
      </div> : null}
      {message ? <p className="client-selector-message" role="status">{message}</p> : null}
      {error ? <p className="portal-error" role="alert">{error}</p> : null}
    </div>
  );
}
