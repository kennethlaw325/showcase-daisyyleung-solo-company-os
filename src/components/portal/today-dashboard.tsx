"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { demoCases, demoLearnings } from "@/src/data/demo-data";
import { useLocale } from "@/src/components/locale-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";
import { getHongKongGreetingPeriod, type GreetingPeriod } from "@/src/lib/i18n/hong-kong-time";

export type DashboardCase = {
  id: string;
  module: "growth" | "operations" | "intelligence";
  title: string;
  status: "awaiting_approval" | "action_pending" | "outcome_pending" | "blocked";
  nextAction: string;
  meta: string;
  accent: "violet" | "cyan" | "amber";
};

export type DashboardLearning = {
  module: string;
  title: string;
  body: string;
  tags: readonly string[];
};

const moduleMarks = {
  growth: { accent: "violet", number: "01" },
  operations: { accent: "cyan", number: "02" },
  intelligence: { accent: "amber", number: "03" },
} as const;

export function TodayDashboard({
  cases = demoCases,
  learnings = demoLearnings,
  userName = "Demo User",
  initialGreetingPeriod = getHongKongGreetingPeriod(),
  demo = false,
}: {
  cases?: readonly DashboardCase[];
  learnings?: readonly DashboardLearning[];
  userName?: string;
  initialGreetingPeriod?: GreetingPeriod;
  demo?: boolean;
  /** Compatibility input for older snapshot callers; the dashboard no longer renders usage. */
  usage?: unknown;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = getPortalCopy(locale).today;
  const [greetingPeriod, setGreetingPeriod] = useState(initialGreetingPeriod);
  const [displayName, setDisplayName] = useState(userName);
  const [nameDraft, setNameDraft] = useState(userName);
  const [editingName, setEditingName] = useState(false);
  const [nameState, setNameState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    const timer = window.setInterval(() => setGreetingPeriod(getHongKongGreetingPeriod()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = nameDraft.trim();
    if (!nextName) {
      setNameState("error");
      return;
    }
    setNameState("saving");
    try {
      if (!demo) {
        const response = await fetch("/api/profile/display-name", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: nextName }),
        });
        const result = (await response.json()) as { displayName?: string };
        if (!response.ok || result.displayName !== nextName) throw new Error(copy.nameSaveError);
      }
      setDisplayName(nextName);
      setNameDraft(nextName);
      setEditingName(false);
      setNameState("saved");
      if (!demo) router.refresh();
    } catch {
      setNameState("error");
    }
  }

  const approvalCount = cases.filter((item) => item.status === "awaiting_approval").length;
  const actionCount = cases.filter((item) => item.status === "action_pending").length;
  const outcomeCount = cases.filter((item) => item.status === "outcome_pending").length;
  const blockedCount = cases.filter((item) => item.status === "blocked").length;
  return (
    <main className="portal-page today-page">
      <header className="portal-page-header">
        <div>
          <p className="portal-kicker">{copy.kicker}</p>
          <div className="today-greeting-row">
            <h1>{copy.greeting(greetingPeriod, displayName)}</h1>
            {!editingName ? <button className="name-edit-button" type="button" onClick={() => { setNameDraft(displayName); setNameState("idle"); setEditingName(true); }}>{copy.editName}</button> : null}
          </div>
          {editingName ? <form className="name-edit-form" onSubmit={saveDisplayName}>
            <label><span>{copy.nameLabel}</span><input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={80} required /></label>
            <button className="portal-primary-button" type="submit" disabled={nameState === "saving"}>{nameState === "saving" ? copy.savingName : copy.saveName}</button>
            <button className="portal-secondary-button" type="button" onClick={() => { setNameDraft(displayName); setNameState("idle"); setEditingName(false); }} disabled={nameState === "saving"}>{copy.cancelName}</button>
          </form> : null}
          {nameState === "saved" ? <div className="name-feedback" role="status">{copy.nameSaved}{demo ? (locale === "zh-Hant" ? "（示範模式：只在這個瀏覽器分頁顯示，重新載入後會回復預設名稱。）" : " (Demo mode: this name is shown in this browser tab only and resets on reload.)") : null}</div> : nameState === "error" ? <div className="name-feedback is-error" role="alert">{copy.nameSaveError}</div> : null}
          <p>{copy.attention(cases.length)}</p>
        </div>
        <Link className="portal-primary-button" href="/app/new">{copy.newCase}</Link>
      </header>

      <section className="today-priority-grid" aria-label={copy.priorities}>
        <article><span>{copy.awaitingApproval}</span><strong>{approvalCount}</strong><small>{copy.exactRevisions}</small></article>
        <article><span>{copy.readyToExecute}</span><strong>{actionCount}</strong><small>{copy.approvedDraft}</small></article>
        <article><span>{copy.outcomeDue}</span><strong>{outcomeCount}</strong><small>{copy.learningLoop}</small></article>
        <article><span>{copy.blocked}</span><strong>{blockedCount}</strong><small>{copy.missingContext}</small></article>
      </section>

      <section className="portal-section">
        <div className="portal-section-heading"><div><p className="portal-kicker">{copy.priorityWork}</p><h2>{copy.needsNext}</h2></div><span>{copy.orderedByJudgement}</span></div>
        <div className="case-table">
          {cases.length ? cases.map((item) => {
            const mark = moduleMarks[item.module];
            return (
              <Link href={`/app/cases/${item.id}`} className="case-row" key={item.id}>
                <span className={`case-module-mark ${mark.accent}`}>{mark.number}</span>
                <div className="case-row-title"><strong>{item.title}</strong><small>{copy.modules[item.module]}</small></div>
                <span className={`case-status status-${item.status}`}><i />{copy.statuses[item.status]}</span>
                <div className="case-next"><small>{copy.nextAction}</small><strong>{copy.nextActions[item.status]}</strong></div>
                <span className="row-arrow">→</span>
              </Link>
            );
          }) : <div className="empty-work-state"><strong>{copy.clearTitle}</strong><p>{copy.clearBody}</p><Link href="/app/new">{copy.firstCase}</Link></div>}
        </div>
      </section>

      <section className="portal-lower-grid single-panel">
        <div className="portal-panel">
          <div className="portal-section-heading compact"><div><p className="portal-kicker">{copy.learningSignal}</p><h2>{copy.usefulAgain}</h2></div><Link href="/app/outcomes">{copy.viewAll}</Link></div>
          <div className="learning-list">
            {learnings.length ? learnings.map((item) => <article key={item.title}><span>{item.module}</span><h3>{item.title}</h3><p>{item.body}</p><div>{item.tags.map((tag) => <small key={tag}>{tag}</small>)}</div></article>) : <article><span>{locale === "zh-Hant" ? "結果學習" : "Outcome learning"}</span><h3>{copy.noLearning}</h3><p>{copy.noLearningBody}</p></article>}
          </div>
        </div>
      </section>
    </main>
  );
}
