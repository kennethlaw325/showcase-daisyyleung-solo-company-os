"use client";

import Link from "next/link";
import { useState } from "react";
import { LocaleProvider, useLocale } from "@/src/components/locale-provider";
import { ThemeToggle } from "@/src/components/theme-provider";
import { demoCases } from "@/src/data/demo-data";
import { moduleCopy, siteCopy } from "@/src/data/site-copy";

function LanguageButton() {
  const { locale, toggleLocale } = useLocale();

  return (
    <button className="language-button" type="button" onClick={toggleLocale} aria-label="Switch language">
      <span className={locale === "zh-Hant" ? "is-active" : ""}>繁</span>
      <span aria-hidden="true">/</span>
      <span className={locale === "en" ? "is-active" : ""}>EN</span>
    </button>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function CopyLines({ text }: { text: string }) {
  const lines = text.split("\n");
  return <>{lines.map((line, index) => <span className={lines.length > 1 ? "copy-line" : undefined} key={`${index}-${line}`}>{line}</span>)}</>;
}

function TodayPreview({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const labels =
    locale === "zh-Hant"
      ? {
          greeting: "早晨，Demo User",
          subtitle: "今日最值得推進嘅工作。",
          today: "今日",
          view: "查看全部",
          notice: "第三版內容已審批",
          cases: [
            { title: "創始服務增長計劃", nextAction: "審閱客戶培育與銷售跟進" },
            { title: "工作室每週情報回顧", nextAction: "記錄實際進展與跨部門洞察" },
            { title: "人工智能公關簡報", nextAction: "確認媒體稿與客戶稿" },
          ],
        }
      : {
          greeting: "Good morning, Demo User",
          subtitle: "Here’s the work that most deserves your attention.",
          today: "Today",
          view: "View all",
          notice: "Revision three approved",
          cases: [
            { title: "Founding offer growth plan", nextAction: "Review nurture and sales follow-up" },
            { title: "Studio intelligence review", nextAction: "Capture progress and cross-team insight" },
            { title: "AI public relations brief", nextAction: "Confirm media and client versions" },
          ],
        };

  return (
    <div className={`product-window ${compact ? "is-compact" : ""}`} aria-label="Solo Company OS product preview">
      <div className="window-rail" aria-hidden="true">
        <BrandMark />
        <span className="rail-icon is-current">⌂</span>
        <span className="rail-icon">＋</span>
        <span className="rail-icon">✓</span>
        <span className="rail-icon">↗</span>
      </div>
      <div className="window-main">
        <div className="window-topline">
          <span>{labels.today}</span>
          <div className="window-meta">
            <span className="inline-notice"><i aria-hidden="true">✓</i>{labels.notice}</span>
            <div className="demo-avatar">DU</div>
          </div>
        </div>
        <div className="window-heading">
          <div>
            <p className="window-kicker">{labels.greeting}</p>
            <h3>{labels.subtitle}</h3>
          </div>
          <Link className="window-add" href="/app" aria-label={locale === "zh-Hant" ? "開啟示範工作空間並新增工作" : "Open the demo workspace to add work"}>＋</Link>
        </div>
        <div className="priority-strip">
          <div><strong>02</strong><span>{locale === "zh-Hant" ? "待審批" : "Approvals"}</span></div>
          <div><strong>01</strong><span>{locale === "zh-Hant" ? "可執行" : "Ready"}</span></div>
          <div><strong>01</strong><span>{locale === "zh-Hant" ? "待回顧" : "Outcomes"}</span></div>
        </div>
        <div className="preview-list-heading">
          <span>{locale === "zh-Hant" ? "優先工作" : "Priority work"}</span>
          <span>{labels.view}</span>
        </div>
        <div className="preview-case-list">
          {demoCases.slice(0, compact ? 2 : 3).map((item, index) => (
            <div className="preview-case" key={item.id}>
              <span className={`case-accent ${item.accent}`} />
              <div>
                <strong>{labels.cases[index].title}</strong>
                <span>{labels.cases[index].nextAction}</span>
              </div>
              <span className={`status-dot status-${item.status}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductPageInner() {
  const { locale } = useLocale();
  const [approvalResult, setApprovalResult] = useState<{ kind: "changed" | "approved"; at: string } | null>(null);
  const copy = locale === "zh-Hant" ? siteCopy.zh : siteCopy.en;
  const approvalDemo = locale === "zh-Hant"
    ? {
        revision: "第三版",
        recipient: "收件人",
        subject: "主旨",
        subjectLine: "聚焦推進下一輪服務增長",
        preview: "完整內容預覽",
        message: "Alex，你好——我已將本次合作聚焦於一個結果：把現有服務由商機培育，推進為一套團隊可執行的銷售轉化計劃……",
        locked: "修訂稿與行動資料已鎖定",
        change: "要求修改",
        approve: "審批並建立電郵草稿",
        note: "任何修改都會令今次審批失效。Solo Company OS 永不自動發送電郵。",
      }
    : {
        revision: "Revision three",
        recipient: "To",
        subject: "Subject",
        subjectLine: "A focused route from demand to conversion",
        preview: "Full message preview",
        message: "Hi Alex — I’ve focused the engagement on one outcome: moving the offer you already have from demand nurture to a sales motion your team can execute…",
        locked: "Revision and action payload locked",
        change: "Request changes",
        approve: "Approve and create email draft",
        note: "Any edit invalidates this approval. Solo Company OS never sends email automatically.",
      };
  const approvalFeedback = locale === "zh-Hant"
    ? {
        changed: "已送出修改要求：系統會以你的備註準備第四版修訂稿，並重新要求審批。示範模式，不會真正送出",
        approved: "已建立 Gmail 電郵草稿並鎖定第三版內容，草稿仍留在你的收件匣待你親自寄出。示範模式，不會真正寄出",
        at: "示範時間",
      }
    : {
        changed: "Change request sent: revision four will be prepared from your note and returned for approval. Demo mode, nothing is sent",
        approved: "Gmail draft created and revision three locked. The draft stays in your mailbox until you send it yourself. Demo mode, nothing is sent",
        at: "Demo timestamp",
      };
  const learningTags = locale === "zh-Hant"
    ? ["有效做法", "失效原因", "下一步", "其他角度"]
    : ["What worked", "What failed", "Next action", "Other angles"];

  return (
    <main className={`marketing-page ${locale === "en" ? "is-en" : "is-zh"}`}>
      <header className="marketing-nav">
        <Link className="brand-lockup" href="#top" aria-label="Solo Company OS home">
          <BrandMark />
          <span>Solo Company OS</span>
        </Link>
        <nav aria-label="Product navigation">
          <Link href="#product">{copy.nav.product}</Link>
          <Link href="#modules">{copy.nav.modules}</Link>
          <Link href="#trust">{copy.nav.safety}</Link>
        </nav>
        <div className="nav-actions">
          <ThemeToggle language={locale === "zh-Hant" ? "zh" : "en"} compact />
          <LanguageButton />
          <Link className="nav-login" href="/app">{copy.nav.login}</Link>
          <Link className="button button-small" href="/request-access">{copy.nav.apply}</Link>
        </div>
      </header>

      <section className="hero-section" id="top">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-copy reveal-block">
          <p className="section-eyebrow">{copy.hero.eyebrow}</p>
          <h1><CopyLines text={copy.hero.headline} /></h1>
          <p className="hero-body"><CopyLines text={copy.hero.body} /></p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/request-access">{copy.hero.primary}<span aria-hidden="true">↗</span></Link>
            <Link className="text-link" href="#product">{copy.hero.secondary}<span aria-hidden="true">↓</span></Link>
          </div>
          <p className="hero-trust"><span aria-hidden="true">✓</span><span className="hero-trust-text"><CopyLines text={copy.hero.trust} /></span></p>
        </div>
        <div className="hero-product reveal-block">
          <div className="orbit orbit-one" aria-hidden="true" />
          <div className="orbit orbit-two" aria-hidden="true" />
          <TodayPreview />
        </div>
      </section>

      <section className="scatter-section" id="product">
        <div className="scatter-cloud" aria-hidden="true">
          <span className="scatter-pill pill-notes">{locale === "zh-Hant" ? "筆記" : "Notes"}</span>
          <span className="scatter-pill pill-ai">{locale === "zh-Hant" ? "人工智能對話" : "AI chats"}</span>
          <span className="scatter-pill pill-email">{locale === "zh-Hant" ? "電郵" : "Email"}</span>
          <span className="scatter-pill pill-tasks">{locale === "zh-Hant" ? "任務" : "Tasks"}</span>
          <span className="scatter-pill pill-files">{locale === "zh-Hant" ? "文件" : "Files"}</span>
          <span className="scatter-thread thread-one" />
          <span className="scatter-thread thread-two" />
        </div>
        <div className="wide-copy reveal-block">
          <p className="section-eyebrow dark">{copy.problem.kicker}</p>
          <h2><CopyLines text={copy.problem.title} /></h2>
          <p className="copy-lines"><CopyLines text={copy.problem.body} /></p>
        </div>
      </section>

      <section className="command-section">
        <div className="command-copy reveal-block">
          <p className="section-eyebrow dark">{copy.command.eyebrow}</p>
          <h2><CopyLines text={copy.command.title} /></h2>
          <p className="copy-lines"><CopyLines text={copy.command.body} /></p>
          <div className="command-principles">
            <span><i>01</i>{locale === "zh-Hant" ? "先處理需要你判斷的事" : "Judgement before busywork"}</span>
            <span><i>02</i>{locale === "zh-Hant" ? "每項工作只有一個清楚下一步" : "One clear next action"}</span>
            <span><i>03</i>{locale === "zh-Hant" ? "結果未回顧，就未算真正完成" : "No outcome, not truly complete"}</span>
          </div>
        </div>
        <div className="command-stage reveal-block"><TodayPreview compact /></div>
      </section>

      <section className="modules-section" id="modules">
        <div className="modules-intro reveal-block">
          <p className="section-eyebrow">{copy.modules.eyebrow}</p>
          <h2><CopyLines text={copy.modules.title} /></h2>
        </div>
        <div className="module-stack">
          {moduleCopy.map((module) => {
            const content = locale === "zh-Hant" ? module.zh : module.en;
            return (
              <article className={`module-card module-${module.accent}`} key={module.key}>
                <div className="module-number">{module.number}</div>
                <div className="module-copy">
                  <p className="section-eyebrow">{content.eyebrow}</p>
                  <h3><CopyLines text={content.title} /></h3>
                  <p className="copy-lines"><CopyLines text={content.body} /></p>
                </div>
                <div className="module-flow" aria-label={`${content.eyebrow} workflow`}>
                  {content.flow.map((step, index) => (
                    <div key={step}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{step}</strong>
                      {index < content.flow.length - 1 ? <i aria-hidden="true">→</i> : null}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="approval-section" id="trust">
        <div className="approval-copy reveal-block">
          <p className="section-eyebrow">{copy.approval.eyebrow}</p>
          <h2><CopyLines text={copy.approval.title} /></h2>
          <p className="copy-lines"><CopyLines text={copy.approval.body} /></p>
        </div>
        <div className="approval-console reveal-block">
          <div className="approval-console-top"><span>{locale === "zh-Hant" ? "外部行動審批" : "External action approval"}</span><span>{approvalDemo.revision}</span></div>
          <div className="approval-field"><span>{approvalDemo.recipient}</span><strong>alex@northstar.studio</strong></div>
          <div className="approval-field"><span>{approvalDemo.subject}</span><strong>{approvalDemo.subjectLine}</strong></div>
          <div className="approval-message">
            <span>{approvalDemo.preview}</span>
            <p>{approvalDemo.message}</p>
          </div>
          <div className="approval-hash"><span aria-hidden="true">◇</span><div><strong>{approvalDemo.locked}</strong><small>sha256 · 8f2c…71ab</small></div></div>
          <div className="approval-buttons"><button type="button" onClick={() => setApprovalResult({ kind: "changed", at: new Date().toLocaleTimeString(locale === "zh-Hant" ? "zh-HK" : "en-GB", { hour: "2-digit", minute: "2-digit" }) })}>{approvalDemo.change}</button><button type="button" onClick={() => setApprovalResult({ kind: "approved", at: new Date().toLocaleTimeString(locale === "zh-Hant" ? "zh-HK" : "en-GB", { hour: "2-digit", minute: "2-digit" }) })}>✓ {approvalDemo.approve}</button></div>
          {approvalResult ? <p className={`approval-result is-${approvalResult.kind}`} role="status">{approvalResult.kind === "approved" ? "✓ " : "↺ "}{approvalFeedback[approvalResult.kind]} · {approvalFeedback.at} {approvalResult.at}</p> : null}
          <p className="console-note">{approvalDemo.note}</p>
        </div>
      </section>

      <section className="learning-section">
        <div className="learning-visual reveal-block" aria-label={locale === "zh-Hant" ? "結果學習閉環圖" : "Outcome learning loop diagram"}>
          <div className="learning-core"><BrandMark /><strong>{locale === "zh-Hant" ? "更好的\n下一步" : "A better\nnext action"}</strong></div>
          <span className="learning-node node-action">01<br/><strong>{locale === "zh-Hant" ? "行動" : "Action"}</strong></span>
          <span className="learning-node node-outcome">02<br/><strong>{locale === "zh-Hant" ? "結果" : "Outcome"}</strong></span>
          <span className="learning-node node-review">03<br/><strong>{locale === "zh-Hant" ? "回顧" : "Review"}</strong></span>
          <span className="learning-node node-learn">04<br/><strong>{locale === "zh-Hant" ? "學習" : "Learn"}</strong></span>
        </div>
        <div className="learning-copy reveal-block">
          <p className="section-eyebrow dark">{copy.learning.eyebrow}</p>
          <h2><CopyLines text={copy.learning.title} /></h2>
          <p className="copy-lines"><CopyLines text={copy.learning.body} /></p>
          <div className="learning-tags">{learningTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        </div>
      </section>

      <section className="trust-section">
        <div className="trust-heading reveal-block">
          <p className="section-eyebrow">{copy.trust.eyebrow}</p>
          <h2><CopyLines text={copy.trust.title} /></h2>
        </div>
        <div className="trust-grid">
          <article><span className="trust-symbol">◇</span><h3>{locale === "zh-Hant" ? "來源與限制" : "Sources and limits"}</h3><p>{locale === "zh-Hant" ? "分開事實、假設、缺口及不確定性。" : "Keep facts, assumptions, gaps, and uncertainty distinct."}</p></article>
          <article><span className="trust-symbol">✓</span><h3>{locale === "zh-Hant" ? "精確審批" : "Exact approval"}</h3><p>{locale === "zh-Hant" ? "審批綁定指定修訂稿與完整行動資料。" : "Approval binds to one revision and exact payload."}</p></article>
          <article><span className="trust-symbol">↺</span><h3>{locale === "zh-Hant" ? "完整紀錄" : "Traceable history"}</h3><p>{locale === "zh-Hant" ? "每次修改、決定、執行與結果均可追蹤。" : "Trace every revision, decision, action, and outcome."}</p></article>
          <article><span className="trust-symbol">▣</span><h3>{locale === "zh-Hant" ? "用量與私隱" : "Usage and privacy"}</h3><p>{locale === "zh-Hant" ? "工作空間彼此隔離、敏感憑證只存伺服器，並設清晰用量上限。" : "Isolated workspaces, server-only secrets, and clear limits."}</p></article>
        </div>
      </section>

      <section className="final-cta">
        <div className="cta-glow" aria-hidden="true" />
        <div className="cta-content reveal-block">
          <p className="section-eyebrow">{copy.cta.eyebrow}</p>
          <h2><CopyLines text={copy.cta.title} /></h2>
          <p className="copy-lines"><CopyLines text={copy.cta.body} /></p>
          <Link className="button button-primary" href="/request-access">{copy.cta.button}<span aria-hidden="true">↗</span></Link>
          <small>{copy.cta.note}</small>
        </div>
        <div className="footer-links">
          <span>Solo Company OS</span>
          <div><Link href="/privacy">{locale === "zh-Hant" ? "私隱" : "Privacy"}</Link><Link href="/terms">{locale === "zh-Hant" ? "條款" : "Terms"}</Link><Link href="/app">{locale === "zh-Hant" ? "開啟 OS" : "Open OS"}</Link></div>
        </div>
      </section>
    </main>
  );
}

export function ProductPage() {
  return <LocaleProvider><ProductPageInner /></LocaleProvider>;
}
