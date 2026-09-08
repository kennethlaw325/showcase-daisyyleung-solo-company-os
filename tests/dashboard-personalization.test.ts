import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { profileDisplayNameRequestSchema } from "../src/lib/domain/schemas";
import { getHongKongGreetingPeriod } from "../src/lib/i18n/hong-kong-time";
import { getPortalCopy } from "../src/lib/i18n/portal-copy";

const root = resolve(import.meta.dirname, "..");

describe("dashboard personalisation", () => {
  it("uses explicit Hong Kong time boundaries for the three greetings", () => {
    expect(getHongKongGreetingPeriod(new Date("2026-08-14T20:59:00Z"))).toBe("evening");
    expect(getHongKongGreetingPeriod(new Date("2026-08-14T21:00:00Z"))).toBe("morning");
    expect(getHongKongGreetingPeriod(new Date("2026-08-15T03:59:00Z"))).toBe("morning");
    expect(getHongKongGreetingPeriod(new Date("2026-08-15T04:00:00Z"))).toBe("afternoon");
    expect(getHongKongGreetingPeriod(new Date("2026-08-15T09:59:00Z"))).toBe("afternoon");
    expect(getHongKongGreetingPeriod(new Date("2026-08-15T10:00:00Z"))).toBe("evening");
  });

  it("renders localized morning, afternoon, and evening greetings", () => {
    const zh = getPortalCopy("zh-Hant").today;
    const en = getPortalCopy("en").today;
    expect(zh.greeting("morning", "Demo User")).toBe("早安，Demo User。");
    expect(zh.greeting("afternoon", "Demo User")).toBe("午安，Demo User。");
    expect(zh.greeting("evening", "Demo User")).toBe("晚安，Demo User。");
    expect(en.greeting("afternoon", "Demo User")).toBe("Good afternoon, Demo User.");
  });

  it("accepts a trimmed bounded name and rejects blank or oversized names", () => {
    expect(profileDisplayNameRequestSchema.parse({ displayName: " Demo User " }).displayName).toBe("Demo User");
    expect(profileDisplayNameRequestSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(profileDisplayNameRequestSchema.safeParse({ displayName: "x".repeat(81) }).success).toBe(false);
  });

  it("persists only the verified user's own display name", () => {
    const route = readFileSync(resolve(root, "app/api/profile/display-name/route.ts"), "utf8");
    expect(route).toContain("contextOrResponse");
    expect(route).toContain('.eq("id", context.user.id)');
    expect(route).not.toContain("workspaceId");
  });

  it("shows unpadded counts and keeps revision buttons equal", () => {
    const dashboard = readFileSync(resolve(root, "src/components/portal/today-dashboard.tsx"), "utf8");
    const approvals = readFileSync(resolve(root, "app/app/approvals/page.tsx"), "utf8");
    const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
    expect(dashboard).toContain("<strong>{approvalCount}</strong>");
    expect(approvals).toContain("<>{items.length} 項待處理</>");
    expect(css).toMatch(/\.form-action-buttons\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  });
});
