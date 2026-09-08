const CANONICAL_ENTRY_PREFIXES = ["/app", "/admin", "/login", "/auth", "/api/auth", "/api/oauth"] as const;

export type CanonicalPrivateEntryInput = {
  requestUrl: string | URL;
  configuredSiteUrl: string | undefined | null;
  vercelEnv: string | undefined | null;
};

/**
 * Returns true for browser and authentication entry points that must share
 * the configured production origin. Public API routes are intentionally not
 * included because their forms may be submitted from a preview origin.
 */
export function isCanonicalPrivateEntryPath(pathname: string): boolean {
  return CANONICAL_ENTRY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function parseHttpsOrigin(value: string | undefined | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Builds an absolute canonical redirect without ever using the request host
 * as a redirect destination. The helper is deliberately pure: deployment
 * environment values are supplied by the caller so each branch is testable.
 */
export function buildCanonicalPrivateEntryUrl({ requestUrl, configuredSiteUrl, vercelEnv }: CanonicalPrivateEntryInput): URL | null {
  if (vercelEnv !== "production") return null;
  const canonicalOrigin = parseHttpsOrigin(configuredSiteUrl);
  if (!canonicalOrigin) return null;

  let incoming: URL;
  try {
    incoming = new URL(requestUrl.toString());
  } catch {
    return null;
  }
  if (incoming.origin === "null") return null;
  if (incoming.origin === canonicalOrigin.origin) return null;

  const destination = new URL(canonicalOrigin.origin);
  destination.pathname = incoming.pathname;
  destination.search = incoming.search;
  destination.hash = incoming.hash;
  return destination;
}
