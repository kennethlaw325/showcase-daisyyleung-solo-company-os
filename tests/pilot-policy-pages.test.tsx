// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage from "../app/privacy/page";
import TermsPage from "../app/terms/page";
import { PILOT_POLICY_VERSION, pilotPolicy } from "../src/lib/legal/pilot-policy";

describe("founding pilot policy pages", () => {
  afterEach(() => cleanup());

  it("renders the equivalent English privacy page and preserves its document in the language switch", async () => {
    render(await PrivacyPage({ searchParams: Promise.resolve({ lang: "en" }) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(pilotPolicy.privacy.en.title);
    expect(screen.getByText(pilotPolicy.privacy.en.reviewNotice)).toBeTruthy();
    expect(screen.getByRole("link", { name: "繁體中文" }).getAttribute("href")).toBe("/privacy?lang=zh-Hant");
    expect(screen.getByRole("link", { name: "English" }).getAttribute("href")).toBe("/privacy?lang=en");
  });

  it("defaults unsupported language values to Traditional Chinese and keeps terms separate", async () => {
    render(await TermsPage({ searchParams: Promise.resolve({ lang: "fr" }) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(pilotPolicy.terms["zh-Hant"].title);
    expect(screen.getByRole("link", { name: "English" }).getAttribute("href")).toBe("/terms?lang=en");
    expect(screen.getByRole("link", { name: "私隱聲明" }).getAttribute("href")).toBe("/privacy?lang=zh-Hant");
  });

  it("keeps one active policy version for every consent surface", () => {
    expect(PILOT_POLICY_VERSION).toBe("founding-pilot-2026-08-21-v1");
    expect(pilotPolicy.privacy.en.sections.length).toBeGreaterThan(0);
    expect(pilotPolicy.privacy["zh-Hant"].sections.length).toBe(pilotPolicy.privacy.en.sections.length);
    expect(pilotPolicy.terms["zh-Hant"].sections.length).toBe(pilotPolicy.terms.en.sections.length);
  });
});
