"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLocale } from "@/src/components/locale-provider";
import { ThemeToggle } from "@/src/components/theme-provider";
import { getPortalCopy } from "@/src/lib/i18n/portal-copy";

type NavigationCounts = { approvals: number; outcomes: number };

export function PortalShell({ children, demo = false, counts, userName = "Demo User" }: { children: ReactNode; demo?: boolean; counts?: NavigationCounts; userName?: string }) {
  const pathname = usePathname();
  const { locale, toggleLocale, localeError, localeSaving } = useLocale();
  const copy = getPortalCopy(locale);
  const navigation = [
    { href: "/app", label: copy.shell.nav.today, icon: "⌂", exact: true },
    { href: "/app/new", label: copy.shell.nav.newCase, icon: "＋" },
    { href: "/app/approvals", label: copy.shell.nav.approvals, icon: "✓", countKey: "approvals" as const },
    { href: "/app/outcomes", label: copy.shell.nav.outcomes, icon: "↗", countKey: "outcomes" as const },
    { href: "/app/settings/connections", label: copy.shell.nav.connections, icon: "◇" },
  ] as const;
  const resources = [
    { href: "/app/clients", label: locale === "zh-Hant" ? "客戶" : "Clients", icon: "◎" },
    { href: "/app/workflows", label: locale === "zh-Hant" ? "我的工作流" : "My Workflow", icon: "⌘" },
    { href: "/app/intakes", label: locale === "zh-Hant" ? "初始輸入" : "Initial Inputs", icon: "▤" },
  ] as const;
  const language = locale === "zh-Hant" ? "zh" : "en";
  const languageLabel = language === "zh" ? copy.shell.switchToEnglish : copy.shell.switchToChinese;
  const resolvedCounts = counts ?? (demo ? { approvals: 2, outcomes: 1 } : { approvals: 0, outcomes: 0 });
  const initials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SC";
  const languageToggle = (
    <button className="language-button portal-language-button" type="button" onClick={toggleLocale} aria-label={languageLabel} title={languageLabel} disabled={localeSaving}>
      <span className={language === "zh" ? "is-active" : ""}>繁中</span><span aria-hidden="true"> / </span><span className={language === "en" ? "is-active" : ""}>EN</span>
    </button>
  );

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <Link href="/app" className="portal-brand" aria-label={language === "zh" ? "Solo Company OS 今日" : "Solo Company OS Today"}>
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>Solo Company OS</span>
        </Link>
        {demo ? <span className="demo-badge">{copy.shell.demo}</span> : null}
        <nav aria-label={copy.shell.portalNavigation}>
          {navigation.map((item) => {
            const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} key={item.href}>
                <span className="portal-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
                {"countKey" in item ? <small>{resolvedCounts[item.countKey]}</small> : null}
              </Link>
            );
          })}
        </nav>
        <nav className="portal-sidebar-menu" aria-label={locale === "zh-Hant" ? "資源庫" : "Library"}>
          <p>{locale === "zh-Hant" ? "資源庫" : "Library"}</p>
          {resources.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} key={item.href}><span className="portal-nav-icon">{item.icon}</span><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="portal-sidebar-bottom">
          <Link href="/">{copy.shell.productSite}</Link>
          <div className="portal-profile"><span>{initials}</span><div><strong>{userName}</strong><small>{copy.shell.owner}</small></div></div>
        </div>
      </aside>
      <div className="portal-mobile-bar">
        <Link href="/app" className="portal-brand"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>Solo Company OS</span></Link>
        <div className="portal-mobile-actions">
          {languageToggle}
          <ThemeToggle language={language} compact />
          <Link href="/app/more" aria-label={locale === "zh-Hant" ? "更多" : "More"}>⋯</Link>
          <Link href="/app/new" aria-label={copy.shell.createCase}>＋</Link>
        </div>
      </div>
      <div className="portal-desktop-tools">
        {languageToggle}
        <ThemeToggle language={language} />
      </div>
      <div className="portal-content">{children}</div>
      {localeError ? <p className="portal-error portal-locale-error" role="alert">{localeError}</p> : null}
      <nav className="portal-mobile-nav" aria-label={copy.shell.mobileNavigation}>
        {navigation.map((item) => {
          const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return <Link href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} key={item.href}><span>{item.icon}</span><small>{item.label}</small></Link>;
        })}
      </nav>
    </div>
  );
}
