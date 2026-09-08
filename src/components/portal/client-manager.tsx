"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";

type Client = { id: string; name: string; company?: string | null; status: "active" | "archived"; notes?: string | null };
type CaseDirectoryItem = { id: string; title: string; module: "growth" | "operations" | "intelligence"; status: string; client_id?: string | null; updated_at?: string | null; workflow_stream_id?: string | null; workflow_stream_name?: string | null; workflow_stream_group_id?: string | null };

type CaseCategory = {
  key: string;
  label: string;
  module: CaseDirectoryItem["module"];
  custom: boolean;
};

function moduleLabel(module: CaseDirectoryItem["module"], zh: boolean) {
  const labels = {
    growth: zh ? "增長與收入" : "Growth & Revenue",
    operations: zh ? "商業洞察" : "Business Insights",
    intelligence: zh ? "品牌傳訊與公關" : "Brand Communications & PR",
  } as const;
  return labels[module];
}

function categoryKey(item: CaseDirectoryItem) {
  return item.workflow_stream_group_id ? `workflow:${item.workflow_stream_group_id}` : `module:${item.module}`;
}

export function ClientManager({ initialClients, initialCases = [], locale = "en" }: { initialClients: Client[]; initialCases?: CaseDirectoryItem[]; locale?: "en" | "zh-Hant" }) {
  const zh = locale === "zh-Hant";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const clientsById = useMemo(() => new Map(initialClients.map((client) => [client.id, client])), [initialClients]);
  const categories = useMemo(() => {
    const customCategories = new Map<string, CaseCategory>();
    for (const item of initialCases) {
      if (!item.workflow_stream_group_id || !item.workflow_stream_name) continue;
      customCategories.set(categoryKey(item), { key: categoryKey(item), label: item.workflow_stream_name, module: item.module, custom: true });
    }
    const modules: CaseDirectoryItem["module"][] = ["growth", "operations", "intelligence"];
    return [
      ...[...customCategories.values()].sort((left, right) => left.label.localeCompare(right.label)),
      ...modules.map((module) => ({ key: `module:${module}`, label: moduleLabel(module, zh), module, custom: false })),
    ];
  }, [initialCases, zh]);
  const visibleCases = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return initialCases.filter((item) => {
      if (category !== "all" && categoryKey(item) !== category) return false;
      if (clientFilter !== "all" && (item.client_id ?? "none") !== clientFilter) return false;
      if (!needle) return true;
      const client = item.client_id ? clientsById.get(item.client_id) : undefined;
      return [item.title, item.workflow_stream_name, moduleLabel(item.module, zh), client?.name, client?.company].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
    });
  }, [category, clientFilter, clientsById, initialCases, query, zh]);
  const groupedCases = useMemo(() => {
    return categories.map((caseCategory) => ({ ...caseCategory, items: visibleCases.filter((item) => categoryKey(item) === caseCategory.key) })).filter((group) => group.items.length);
  }, [categories, visibleCases]);
  return <section className="portal-panel client-manager case-directory" aria-labelledby="clients-title">
    <div className="artifact-heading"><div><p className="portal-kicker">{zh ? "篩選條件" : "Filters"}</p><h2 id="clients-title">{zh ? "搜尋個案" : "Search cases"}</h2></div><span>{visibleCases.length} {zh ? "項" : visibleCases.length === 1 ? "case" : "cases"}</span></div>
    <div className="case-directory-filters" role="search">
      <label><span>{zh ? "搜尋" : "Search"}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜尋標題、客戶或類別" : "Search title, client, or category"} /></label>
      <label><span>{zh ? "類別" : "Category"}</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">{zh ? "全部類別" : "All categories"}</option>{categories.some((item) => item.custom) ? <optgroup label={zh ? "自定義工作流" : "Custom workflows"}>{categories.filter((item) => item.custom).map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</optgroup> : null}<optgroup label={zh ? "基本類別" : "Core categories"}>{categories.filter((item) => !item.custom).map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</optgroup></select></label>
      <label><span>{zh ? "客戶" : "Client"}</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="all">{zh ? "所有客戶" : "All clients"}</option>{initialClients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}<option value="none">{zh ? "未連結客戶" : "No client"}</option></select></label>
    </div>
    {groupedCases.map((group) => {
      const headingId = `case-directory-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      return <section className={`case-directory-group module-${group.module}${group.custom ? " is-custom" : ""}`} key={group.key} aria-labelledby={headingId}><div className="case-directory-group-heading"><div><span className="case-directory-group-type">{group.custom ? (zh ? "自定義工作流" : "Custom workflow") : (zh ? "基本類別" : "Core category")}</span><h3 id={headingId}>{group.label}</h3></div><span>{group.items.length} {zh ? "個案" : group.items.length === 1 ? "case" : "cases"}</span></div><div className="client-case-list">{group.items.map((item) => <CaseDirectoryRow key={item.id} item={item} client={item.client_id ? clientsById.get(item.client_id) : undefined} locale={locale} />)}</div></section>;
    })}
    {!visibleCases.length ? <div className="case-directory-empty"><strong>{zh ? "找不到符合條件的個案。" : "No cases match these filters."}</strong><p>{zh ? "嘗試清除搜尋或改用其他類別及客戶。" : "Try clearing the search or choosing another category or client."}</p></div> : null}
  </section>;
}

function CaseDirectoryRow({ item, client, locale }: { item: CaseDirectoryItem; client?: Client; locale: "en" | "zh-Hant" }) {
  const zh = locale === "zh-Hant";
  const status = (getPortalCopy(locale).case.status as Record<string, string>)[item.status] ?? item.status;
  return <article className="client-case-list-row"><div><strong>{item.title || (zh ? "未命名工作" : "Untitled case")}</strong><span>{client ? `${client.name}${client.company ? ` · ${client.company}` : ""}` : (zh ? "未連結客戶" : "No client linked")} · {status}</span></div><Link className="portal-secondary-button case-open-button" href={`/app/cases/${item.id}`}>{zh ? "開啟個案" : "Open case"}</Link></article>;
}
