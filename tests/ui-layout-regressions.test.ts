import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { caseSupportCopy } from "../src/data/case-support-copy";
import { portalCopy } from "../src/lib/i18n/portal-copy";

const styles = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");
const portalEnhancements = readFileSync(resolve(import.meta.dirname, "../app/portal-enhancements.css"), "utf8");
const marketingPage = readFileSync(resolve(import.meta.dirname, "../src/components/marketing/product-page.tsx"), "utf8");
const clientsPage = readFileSync(resolve(import.meta.dirname, "../app/app/clients/page.tsx"), "utf8");
const morePage = readFileSync(resolve(import.meta.dirname, "../app/app/more/page.tsx"), "utf8");

function declarationBlock(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^{}]*)\\}`, "m"));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

function blockContaining(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`[^{}]*${escaped}[^{}]*\\{([^{}]*)\\}`));
  expect(match, `Missing CSS rule containing ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("UI layout regressions", () => {
  it("names the client case view clearly without reviving the obsolete work-directory label", () => {
    expect(clientsPage).toContain("個案一覽");
    expect(clientsPage).toContain("按客戶整理個案。");
    expect(`${clientsPage}\n${morePage}`).not.toContain("工作目錄");
  });

  it("keeps client content inset from its panel and tablet viewport edges", () => {
    expect(blockContaining(".client-manager")).toMatch(/padding:\s*28px/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*1000px\)[\s\S]*?\.portal-page\s*\{\s*width:\s*min\(100% - 64px,\s*1180px\)/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*680px\)[\s\S]*?\.client-manager[\s\S]*?padding:\s*20px/);
  });

  it("gives client-case categories a distinct labelled visual boundary", () => {
    expect(portalEnhancements).toMatch(/\.case-directory-group\s*\{[^{}]*border:\s*1px solid/);
    expect(portalEnhancements).toMatch(/\.case-directory-group-heading\s*\{[^{}]*border-left:\s*4px solid/);
    expect(portalEnhancements).toContain(".case-directory-group-type");
    expect(portalEnhancements).toContain(".case-directory-group.is-custom");
  });

  it("keeps detailed case headings compact enough to stay on one line when space permits", () => {
    expect(declarationBlock(".case-header h1")).toMatch(/font-size:\s*clamp\(2rem,\s*3vw,\s*2\.9rem\)/);
    expect(declarationBlock(".case-header > div > p:last-child")).toMatch(/max-width:\s*min\(100%,\s*1000px\)/);
  });

  it("centres marketing language controls without changing their tap target or DOM class", () => {
    const languageButton = declarationBlock(".language-button");

    expect(marketingPage).toContain('className="language-button"');
    expect(languageButton).toMatch(/display:\s*inline-flex/);
    expect(languageButton).toMatch(/min-width:\s*44px/);
    expect(languageButton).toMatch(/min-height:\s*44px/);
    expect(languageButton).toMatch(/align-items:\s*center/);
    expect(languageButton).toMatch(/justify-content:\s*center/);
  });

  it("wraps long dashboard learning titles instead of forcing horizontal overflow", () => {
    const learningHeading = declarationBlock(".portal-page .learning-list h3");

    expect(learningHeading).toMatch(/white-space:\s*normal/);
    expect(learningHeading).not.toMatch(/white-space:\s*nowrap/);
    expect(learningHeading).toMatch(/overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/\.portal-page \.learning-list h3\s*\{[^{}]*overflow-wrap:\s*anywhere/);
  });

  it("restores standard inner spacing for the audience variants panel", () => {
    expect(blockContaining(".audience-variants-panel")).toMatch(/padding:\s*24px/);
  });

  it("distinguishes record-only source additions from a locked revision stage", () => {
    expect(caseSupportCopy["zh-Hant"].regenerate.closed).toBe("修訂階段已關閉；你仍可加入來源作記錄，但不能產生新修訂稿。");
    expect(caseSupportCopy.en.regenerate.closed).toBe("The revision stage is closed; you can still add sources for the record, but a new revision cannot be generated.");
  });

  it("groups four audience variants in one responsive frame with internal dividers", () => {
    const grid = declarationBlock(".audience-variant-grid");
    const article = declarationBlock(".audience-variant-grid article");

    expect(grid).toMatch(/display:\s*grid/);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(grid).toMatch(/margin-top:\s*24px/);
    expect(grid).toMatch(/gap:\s*0/);
    expect(grid).toMatch(/border:\s*1px\s+solid/);
    expect(grid).toMatch(/border-radius:\s*14px/);
    expect(grid).toMatch(/background:/);
    expect(grid).toMatch(/overflow:\s*hidden/);
    expect(article).toMatch(/border:\s*0/);
    expect(article).toMatch(/border-left:\s*1px\s+solid/);
    expect(article).toMatch(/border-radius:\s*0/);
    expect(article).toMatch(/background:\s*transparent/);
    expect(styles).toMatch(/\.audience-variant-grid article:first-child\s*\{[^{}]*border-left:\s*0/);

    expect(styles).toMatch(/@media\s*\(max-width:\s*1000px\)[\s\S]*?\.audience-variant-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(styles).toMatch(/\.audience-variant-grid article:nth-child\(even\)\s*\{[^{}]*border-left:\s*1px\s+solid/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\.audience-variant-grid\s*\{\s*grid-template-columns:\s*1fr/);
    expect(styles).toMatch(/\.audience-variant-grid article:nth-child\(n \+ 2\)\s*\{\s*border-top:\s*1px\s+solid/);
  });

  it("labels the dashboard priority list as all work needing action", () => {
    expect(portalCopy["zh-Hant"].today.needsNext).toBe("仍需你處理的工作");
    expect(portalCopy["zh-Hant"].today.orderedByJudgement).toBe("包括審批、執行、結果回顧及受阻工作");
    expect(portalCopy.en.today.needsNext).toBe("Work that still needs you");
    expect(portalCopy.en.today.orderedByJudgement).toBe("Includes approvals, ready actions, outcome reviews, and blocked work");
  });

  it("uses a complete empty-state sentence in the dashboard attention line", () => {
    expect(portalCopy["zh-Hant"].today.attention(0)).toBe("現時沒有工作需要你留意。");
    expect(portalCopy.en.today.attention(0)).toBe("No work needs your attention right now.");
    expect(portalCopy["zh-Hant"].today.attention(2)).toContain("2 項工作需要你留意");
    expect(portalCopy.en.today.attention(2)).toContain("2 things deserve");
  });

  it("reserves stable marketing navigation widths across locales", () => {
    const callToAction = declarationBlock(".button-small");

    expect(styles).toMatch(/^\.nav-login\s*\{[^{}]*min-width:\s*82px[^{}]*justify-content:\s*center[^{}]*\}/m);
    expect(callToAction).toMatch(/min-width:\s*142px/);
    expect(styles).toMatch(/\.nav-actions \.button-small\s*\{\s*display:\s*none/);
  });
});
