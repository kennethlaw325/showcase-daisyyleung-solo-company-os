// @vitest-environment jsdom

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PortalShell } from "../src/components/portal/portal-shell";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
}));

vi.mock("@/src/components/locale-provider", () => ({
  useLocale: () => ({ locale: "en", toggleLocale: vi.fn(), localeError: "", localeSaving: false }),
}));

vi.mock("@/src/components/theme-provider", () => ({
  ThemeToggle: ({ compact = false }: { compact?: boolean }) => <button type="button" aria-label={compact ? "Compact theme" : "Theme"} />,
}));

describe("portal mobile navigation", () => {
  it("keeps all five destinations reachable at the mobile breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 720 });
    const { container } = render(<PortalShell><main>Fixture</main></PortalShell>);
    const mobileNav = container.querySelector("nav.portal-mobile-nav");
    expect(mobileNav).not.toBeNull();
    const links = Array.from(mobileNav!.querySelectorAll<HTMLAnchorElement>("a"));

    expect(links).toHaveLength(5);
    expect(links.every((link) => link.getAttribute("href"))).toBe(true);
    expect(links.map((link) => link.getAttribute("href"))).toContain("/app/settings/connections");
    expect(links.some((link) => link.textContent?.includes("Connections"))).toBe(true);
  });

  it("labels the secondary navigation as Library", () => {
    const { container } = render(<PortalShell><main>Fixture</main></PortalShell>);
    const resourceNav = container.querySelector("nav.portal-sidebar-menu");
    expect(resourceNav?.getAttribute("aria-label")).toBe("Library");
    expect(resourceNav?.querySelector("p")?.textContent).toBe("Library");
  });
});
