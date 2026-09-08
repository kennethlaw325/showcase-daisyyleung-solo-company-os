import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { caseSupportCopy } from "../src/data/case-support-copy";
import { moduleCopy, siteCopy } from "../src/data/site-copy";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key)).sort();
}

describe("public product contract", () => {
  it("keeps Traditional Chinese and English copy keys aligned", () => {
    expect(keys(siteCopy.zh)).toEqual(keys(siteCopy.en));
  });

  it("keeps the case support cards complete in Traditional Chinese and English", () => {
    expect(keys(caseSupportCopy["zh-Hant"])).toEqual(keys(caseSupportCopy.en));
    expect(caseSupportCopy.en.upload.helper(1)).toContain("1 slot left");
    expect(caseSupportCopy.en.upload.helper(2)).toContain("2 slots left");
    expect(caseSupportCopy["zh-Hant"].learningPanel.safetyNote).toContain("不會自動套用");

    const panels = readFileSync(resolve(import.meta.dirname, "../src/components/portal/case-support-panels.tsx"), "utf8");
    const page = readFileSync(resolve(import.meta.dirname, "../app/app/cases/[id]/page.tsx"), "utf8");
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(panels).toContain("case-side-count");
    expect(page).not.toContain("{sources.length} items");
    expect(styles).toContain(".artifact-heading > div:last-child:not(:first-child)");
    expect(styles).toContain("min-height: 46px");
  });

  it("keeps the English closing promise aligned with the Chinese start-from-scratch meaning", () => {
    expect(siteCopy.zh.cta.title).toBe("下個 Job，\n唔使再由零開始。");
    expect(siteCopy.en.cta.title).toBe("Your next job\ndoesn’t have to start from scratch.");
  });

  it("keeps the approved pipeline names and intentional two-line hero copy", () => {
    expect(moduleCopy.map((module) => module.zh.eyebrow)).toEqual(["商業增長與銷售轉化", "商業洞察", "品牌傳訊與公關"]);
    expect(moduleCopy.map((module) => module.en.eyebrow)).toEqual(["Growth & Revenue", "Business Insights", "Brand Communications & PR"]);
    expect(siteCopy.zh.hero.headline).toBe("讓一人公司，\n開始像一間多人公司般運作。");
    expect(siteCopy.en.hero.headline).toBe("Let a company of one\noperate like a company of many.");
    expect(siteCopy.zh.cta.title).not.toBe(siteCopy.zh.hero.headline);
    expect(siteCopy.zh.hero.body.split("\n")).toHaveLength(2);
  });

  it("does not import tenant clients or records into the public product page", () => {
    const page = readFileSync(resolve(import.meta.dirname, "../app/page.tsx"), "utf8");
    const product = readFileSync(resolve(import.meta.dirname, "../src/components/marketing/product-page.tsx"), "utf8");
    expect(`${page}\n${product}`).not.toMatch(/supabase|requirePortalContext|pilot_applications|workspace_members/i);
    expect(product).toContain('from "@/src/data/demo-data"');
  });

  it("does not label the public privacy and terms pages as drafts", () => {
    const privacy = readFileSync(resolve(import.meta.dirname, "../app/privacy/page.tsx"), "utf8");
    const terms = readFileSync(resolve(import.meta.dirname, "../app/terms/page.tsx"), "utf8");

    expect(privacy).not.toContain(" · Draft");
    expect(terms).not.toContain(" · Draft");
  });

  it("places the required copyright in the root layout", () => {
    const layout = readFileSync(resolve(import.meta.dirname, "../app/layout.tsx"), "utf8");
    expect(layout).toContain("Copyright © 2026 Demo User. All rights reserved.");
    expect(layout).toContain("Manrope");
  });

  it("offers a persistent light and dark theme across public and portal UI", () => {
    const layout = readFileSync(resolve(import.meta.dirname, "../app/layout.tsx"), "utf8");
    const provider = readFileSync(resolve(import.meta.dirname, "../src/components/theme-provider.tsx"), "utf8");
    const product = readFileSync(resolve(import.meta.dirname, "../src/components/marketing/product-page.tsx"), "utf8");
    const portal = readFileSync(resolve(import.meta.dirname, "../src/components/portal/portal-shell.tsx"), "utf8");
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(layout).toContain("<ThemeProvider>");
    expect(provider).toContain('"solo-company-os-theme"');
    expect(provider).toContain('document.documentElement.dataset.theme = theme');
    expect(provider).toContain('savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark"');
    expect(provider).not.toContain('matchMedia("(prefers-color-scheme: light)")');
    expect(product).toContain("<ThemeToggle");
    expect(portal.match(/<ThemeToggle/g)).toHaveLength(2);
    expect(styles).toContain(':root[data-theme="light"]');
  });

  it("keeps live portal navigation counts and profile labels tenant-derived", () => {
    const layout = readFileSync(resolve(import.meta.dirname, "../app/app/layout.tsx"), "utf8");
    const portal = readFileSync(resolve(import.meta.dirname, "../src/components/portal/portal-shell.tsx"), "utf8");

    expect(layout).toContain('.in("status", ["awaiting_approval", "outcome_pending"])');
    expect(layout).toContain('from("profiles")');
    expect(portal).not.toContain('count: 2');
    expect(portal).not.toContain('<strong>Demo User</strong>');
  });

  it("uses the approved navy, sea-glass, and coral palette without purple or yellow accents", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(styles).toContain("--navy: #17324d");
    expect(styles).toContain("--sea: #5fa8a2");
    expect(styles).toContain("--coral: #c97b68");
    expect(styles).not.toMatch(/#f4b96b|244,\s*185,\s*107|128,\s*110,\s*245|138,\s*110,\s*255|109,\s*77,\s*255|#eeeafc|#e2def3|#9485f1/i);
  });

  it("wraps complete interface copy instead of truncating it", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(styles).toContain("Content must remain readable at every width");
    expect(styles).not.toContain("text-overflow: ellipsis");
    expect(styles).toContain("overflow-wrap: break-word");
    expect(styles).toContain(".hero-copy h1 span");
    expect(styles).toContain("font-size: clamp(3.25rem, 5.2vw, 4.9rem)");
    expect(styles).toContain(".marketing-page.is-en .hero-copy h1");
    expect(styles).toContain("font-size: clamp(3rem, 4.15vw, 4.2rem)");
    expect(styles).toContain("overflow-x: clip");
    expect(styles).not.toContain(".marketing-page {\n  overflow: clip;");
  });

  it("keeps the English learning and trust payoff lines together", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(styles).toContain(".marketing-page.is-en .learning-copy h2 .copy-line:nth-child(2)");
    expect(styles).toContain(".marketing-page.is-en .trust-heading h2 .copy-line:nth-child(2)");
  });

  it("keeps the Chinese Today preview heading on one line at desktop widths", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(styles).toContain(".marketing-page.is-zh .window-heading h3");
  });

  it("keeps desktop split-layout copy clear of its product visuals", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8").replace(/\r\n?/g, "\n");

    expect(styles).toContain("--marketing-split-width: 1280px");
    expect(styles).toContain("--marketing-split-gap: clamp(120px, 9vw, 160px)");
    expect(styles.match(/gap: var\(--marketing-split-gap\)/g)).toHaveLength(2);
    expect(styles.match(/calc\(\(100vw - var\(--marketing-split-width\)\) \/ 2\)/g)).toHaveLength(2);
    expect(styles).toContain("@media (max-width: 1100px) {\n  .command-section,\n  .approval-section {");
  });

  it("keeps preview status-dot fills from leaking into portal status labels", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(styles).toContain(".status-dot.status-awaiting_approval");
    expect(styles).toContain(".status-dot.status-action_pending");
    expect(styles).toContain(".status-dot.status-outcome_pending");
    expect(styles).toContain(".status-dot.status-blocked");
    expect(styles).not.toMatch(/^\.status-(awaiting_approval|action_pending|outcome_pending|blocked)\s*\{/m);
  });

  it("keeps outcome controls large and readable in both themes", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");
    const form = readFileSync(resolve(import.meta.dirname, "../src/components/portal/outcome-form.tsx"), "utf8");

    expect(styles).toContain(".outcome-select-trigger");
    expect(styles).toContain(".outcome-select-menu");
    expect(styles).toContain(".outcome-select-option");
    expect(styles).toContain("height: 58px");
    expect(styles).toContain("min-height: 52px");
    expect(styles).toContain("min-height: 126px");
    expect(styles).toContain(':root[data-theme="light"] .outcome-select-menu');
    expect(form).toContain('aria-haspopup="listbox"');
    expect(form).toContain('role="option"');
    expect(form).toContain('type="hidden"');
  });

  it("keeps public request and login forms in one selected locale", () => {
    const shell = readFileSync(resolve(import.meta.dirname, "../src/components/public-form-shell.tsx"), "utf8");
    const requestForm = readFileSync(resolve(import.meta.dirname, "../src/components/request-access-form.tsx"), "utf8");
    const loginForm = readFileSync(resolve(import.meta.dirname, "../src/components/login-form.tsx"), "utf8");
    const requestPage = readFileSync(resolve(import.meta.dirname, "../app/request-access/page.tsx"), "utf8");
    const loginPage = readFileSync(resolve(import.meta.dirname, "../app/login/page.tsx"), "utf8");

    expect(shell).toContain('"use client"');
    expect(shell).toContain("<LocaleProvider>");
    expect(shell).toContain("繁");
    expect(shell).toContain("EN");
    expect(shell).toContain("toggleLocale");
    expect(requestForm).toContain("useLocale");
    expect(requestForm).toContain("locale,");
    expect(requestForm).not.toContain("document.documentElement.lang");
    expect(loginForm).toContain("useLocale");
    expect(requestPage).toContain("zh:");
    expect(requestPage).toContain("en:");
    expect(loginPage).toContain("zh:");
    expect(loginPage).toContain("en:");
    expect(requestPage).toContain('zh: "協助塑造\\n一人公司的\\n工作系統。"');
    expect(loginPage).toContain('zh: "你的工作只留在\\n你的工作空間。"');
    expect(requestForm).not.toMatch(/Name\s*\/|顧問\s*\/|名稱\s*\//);
  });

  it("keeps public form text readable on light surfaces", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

    expect(styles).toContain(':root[data-theme="light"] .pilot-form label > span');
    expect(styles).toContain(':root[data-theme="light"] .pilot-form input');
    expect(styles).toContain(':root[data-theme="light"] .pilot-form input::placeholder');
    expect(styles).toContain(':root[data-theme="light"] .consent-field span');
    expect(styles).toContain(':root[data-theme="light"] .pilot-form > small');
    expect(styles).toContain(':root[data-theme="light"] .login-form div p');
    expect(styles).toContain(':root[data-theme="light"] .form-language-button');
    expect(styles).toContain("color: #344054");
    expect(styles).toContain("color: #667085");
    expect(styles).toContain("background: #f8fafc");
  });
});
