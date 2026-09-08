import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanonicalPrivateEntryUrl, isCanonicalPrivateEntryPath } from "../src/lib/auth/canonical-private-entry";
import { POST as magicLinkPost } from "../app/api/auth/magic-link/route";

vi.mock("../src/lib/supabase/auth", () => ({
  requestInviteOnlyMagicLink: vi.fn(),
}));

vi.mock("../src/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const projectRoot = resolve(import.meta.dirname, "..");
const environment = process.env as Record<string, string | undefined>;
const originalNodeEnv = environment.NODE_ENV;
const originalApplicationHashSalt = process.env.APPLICATION_HASH_SALT;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalNodeEnv === undefined) delete environment.NODE_ENV;
  else environment.NODE_ENV = originalNodeEnv;
  if (originalApplicationHashSalt === undefined) delete process.env.APPLICATION_HASH_SALT;
  else process.env.APPLICATION_HASH_SALT = originalApplicationHashSalt;
});

describe("canonical private entry routing", () => {
  it("redirects production alias requests to the configured HTTPS origin while preserving URL data", () => {
    const destination = buildCanonicalPrivateEntryUrl({
      requestUrl: "https://solo-company-os-staging.vercel.app/app/cases/example?tab=source",
      configuredSiteUrl: "https://one-person-company-os.vercel.app/",
      vercelEnv: "production",
    });

    expect(destination?.toString()).toBe("https://one-person-company-os.vercel.app/app/cases/example?tab=source");
  });

  it("does not redirect non-production, same-origin, or invalid configured origins", () => {
    const input = {
      requestUrl: "https://preview.example.test/auth/callback?code=fixture",
      configuredSiteUrl: "https://one-person-company-os.vercel.app",
      vercelEnv: "preview",
    } as const;
    expect(buildCanonicalPrivateEntryUrl(input)).toBeNull();
    expect(buildCanonicalPrivateEntryUrl({ ...input, vercelEnv: "production", requestUrl: "https://one-person-company-os.vercel.app/login?error=auth_failed" })).toBeNull();
    expect(buildCanonicalPrivateEntryUrl({ ...input, vercelEnv: "production", configuredSiteUrl: "http://one-person-company-os.vercel.app" })).toBeNull();
    expect(buildCanonicalPrivateEntryUrl({ ...input, vercelEnv: "production", configuredSiteUrl: "https://one-person-company-os.vercel.app/path" })).toBeNull();
  });

  it("never uses the incoming host and only marks private/auth entry paths", () => {
    const destination = buildCanonicalPrivateEntryUrl({
      requestUrl: "https://attacker.example.test/admin/pilot?next=https%3A%2F%2Fattacker.example.test",
      configuredSiteUrl: "https://one-person-company-os.vercel.app",
      vercelEnv: "production",
    });
    expect(destination?.origin).toBe("https://one-person-company-os.vercel.app");
    expect(isCanonicalPrivateEntryPath("/app")).toBe(true);
    expect(isCanonicalPrivateEntryPath("/app/cases/example")).toBe(true);
    expect(isCanonicalPrivateEntryPath("/admin/pilot")).toBe(true);
    expect(isCanonicalPrivateEntryPath("/login")).toBe(true);
    expect(isCanonicalPrivateEntryPath("/auth/callback")).toBe(true);
    expect(isCanonicalPrivateEntryPath("/api/auth/magic-link")).toBe(true);
    expect(isCanonicalPrivateEntryPath("/api/oauth/google/callback")).toBe(true);
    expect(isCanonicalPrivateEntryPath("/api/pilot/apply")).toBe(false);
    expect(isCanonicalPrivateEntryPath("/api/other")).toBe(false);
    expect(isCanonicalPrivateEntryPath("/appx")).toBe(false);
  });
});

describe("re-entry source and UX contracts", () => {
  it("keeps a production no-salt response generic while logging one metadata-only failure", async () => {
    environment.NODE_ENV = "production";
    delete process.env.APPLICATION_HASH_SALT;
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const email = "invitee@example.test";
    const response = await magicLinkPost(new Request("http://localhost/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith("Magic link request failed", {
      route: "auth.magic-link",
      code: "magic_link_protection_not_configured",
      status: "failed",
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain(email);
  });

  it("canonicalizes selected routes before auth work and uses native public OS anchors", () => {
    const proxy = readFileSync(resolve(projectRoot, "proxy.ts"), "utf8");
    const product = readFileSync(resolve(projectRoot, "src/components/marketing/product-page.tsx"), "utf8");
    expect(proxy).toContain('"/login"');
    expect(proxy.indexOf("isCanonicalPrivateEntryPath(pathname)")).toBeLessThan(proxy.indexOf("createServerClient(url"));
    expect(product.match(/<a[^>]+href="\/app"/g)).toHaveLength(2);
    expect(product).not.toMatch(/<Link[^>]+href="\/app"/);
  });

  it("awaits Next 16 search params and keeps callback errors generic with a resend path", () => {
    const page = readFileSync(resolve(projectRoot, "app/login/page.tsx"), "utf8");
    const form = readFileSync(resolve(projectRoot, "src/components/login-form.tsx"), "utf8");
    expect(page).toContain("await searchParams");
    expect(page).toContain("initialError={initialError}");
    expect(page).toContain("Object.hasOwn(CALLBACK_ERROR_MAP, rawError)");
    expect(page).toContain('title={{ zh: "你的工作只留在\\n你的工作空間。"');
    expect(form).toContain("initialError?: LoginInitialError");
    expect(form).toContain("linkExpiredMessage");
    expect(form).toContain("requestAnother");
    expect(form).toContain("newest link in this same browser");
    expect(form).toContain("上方重新申請");
    expect(form).toMatch(/request another(?: link)? above/i);
    expect(form).not.toContain("下方重新申請");
    expect(form).not.toMatch(/request another(?: link)? below/i);
    expect(form).toContain("state === \"sent\" || (state === \"error\" && Boolean(initialError))");
    expect(form).not.toContain("searchParams.get(\"error\")");
  });
});
