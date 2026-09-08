"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LocaleProvider, useLocale } from "@/src/components/locale-provider";

export type PublicFormCopy = {
  zh: string;
  en: string;
};

type PublicFormShellProps = {
  eyebrow: PublicFormCopy;
  title: PublicFormCopy;
  intro: PublicFormCopy;
  children: ReactNode;
};

function LanguageButton() {
  const { locale, toggleLocale } = useLocale();
  const label = locale === "zh-Hant" ? "切換至英文" : "Switch to Traditional Chinese";

  return (
    <button className="language-button form-language-button" type="button" onClick={toggleLocale} aria-label={label} title={label}>
      <span className={locale === "zh-Hant" ? "is-active" : ""}>繁</span>
      <span aria-hidden="true">/</span>
      <span className={locale === "en" ? "is-active" : ""}>EN</span>
    </button>
  );
}

function PublicFormShellInner({ eyebrow, title, intro, children }: PublicFormShellProps) {
  const { locale } = useLocale();
  const copy = locale === "zh-Hant" ? { eyebrow: eyebrow.zh, title: title.zh, intro: intro.zh } : { eyebrow: eyebrow.en, title: title.en, intro: intro.en };
  const principles = locale === "zh-Hant"
    ? [
        { number: "01", title: "只限受邀", detail: "8–12 位創始試用夥伴" },
        { number: "02", title: "人手審批", detail: "不會有外部行動被靜默執行" },
        { number: "03", title: "以成果為本", detail: "真實結果會影響下一步" },
      ]
    : [
        { number: "01", title: "Invite-only", detail: "8–12 founding design partners" },
        { number: "02", title: "Human-approved", detail: "No external action happens silently" },
        { number: "03", title: "Outcome-led", detail: "Real results shape the next action" },
      ];

  return (
    <main className="public-form-page">
      <div className="public-form-glow" aria-hidden="true" />
      <header className="minimal-header">
        <Link href="/" className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>Solo Company OS</span>
        </Link>
        <div className="minimal-header-actions">
          <LanguageButton />
          <Link href="/">{locale === "zh-Hant" ? "返回產品頁" : "Back to product"}</Link>
        </div>
      </header>
      <section className="public-form-wrap">
        <div className="public-form-copy">
          <p className="section-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
          <div className="pilot-principles">
            {principles.map((principle) => (
              <span key={principle.number}>
                <i>{principle.number}</i>
                <strong>{principle.title}</strong>
                <small>{principle.detail}</small>
              </span>
            ))}
          </div>
        </div>
        <div className="public-form-card">{children}</div>
      </section>
    </main>
  );
}

export function PublicFormShell(props: PublicFormShellProps) {
  return <LocaleProvider><PublicFormShellInner {...props} /></LocaleProvider>;
}
