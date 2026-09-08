import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "../proxy";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("security remediation repository hardening", () => {
  it("pins CI actions and schedules dependency updates", () => {
    const ci = read(".github/workflows/ci.yml");
    const dependabot = read(".github/dependabot.yml");
    expect(ci).not.toMatch(/actions\/(checkout|setup-node)@v\d/);
    expect(ci).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
    expect(ci).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(dependabot).toMatch(/package-ecosystem: npm[\s\S]*interval: weekly[\s\S]*package-ecosystem: github-actions/i);
    expect(dependabot).toMatch(/dependency-name: eslint[\s\S]*version-update:semver-major/i);
  });

  it("tracks only a sanitized environment template and documents its copy step", () => {
    expect(read(".gitignore")).toContain(".env*");
    const template = read("env.example");
    for (const secret of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET", "PLATFORM_ADMIN_EMAILS", "APPLICATION_HASH_SALT"]) {
      expect(template).toMatch(new RegExp(`^${secret}=$`, "m"));
    }
    expect(read("README.md")).toContain("Copy `env.example` to `.env.local`");
  });

  it("publishes global security headers and keeps Supabase connections explicit", () => {
    const config = read("next.config.ts");
    const proxy = read("proxy.ts");
    const layout = read("app/layout.tsx");
    for (const header of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy", "Strict-Transport-Security"]) expect(config).toContain(header);
    expect(config).toContain('value: "camera=(), microphone=(self), geolocation=(), payment=()"');
    expect(config).not.toContain("Content-Security-Policy");

    const connectSources = ["'self'", "https://supabase.example.test", "wss://supabase.example.test"];
    const productionPolicy = buildContentSecurityPolicy("fixed-nonce", { isDevelopment: false, connectSources });
    expect(productionPolicy).toBe("default-src 'self'; script-src 'self' 'nonce-fixed-nonce' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://supabase.example.test wss://supabase.example.test; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    expect(productionPolicy).toMatch(/script-src 'self' 'nonce-fixed-nonce' 'strict-dynamic'/);
    expect(productionPolicy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    const developmentPolicy = buildContentSecurityPolicy("fixed-dev-nonce", { isDevelopment: true, connectSources });
    expect(developmentPolicy).toMatch(/script-src 'self' 'nonce-fixed-dev-nonce' 'strict-dynamic' 'unsafe-eval'/);
    expect(developmentPolicy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(proxy).toContain("Buffer.from(crypto.randomUUID())");
    expect(proxy).toContain('requestHeaders.set("Content-Security-Policy", contentSecurityPolicy)');
    expect(proxy).toContain('response.headers.set("Content-Security-Policy", contentSecurityPolicy)');
    expect(proxy).toContain('source: "/((?!_next/static|_next/image|favicon.ico|og.png).*)"');
    expect(proxy).not.toMatch(/script-src[^\n]*'unsafe-inline'/);
    expect(layout).toContain("await connection()");
  });
});
