import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_SCOPES = ["https://www.googleapis.com/auth/gmail.compose", "openid", "email"] as const;
const GOOGLE_SCOPE = GOOGLE_OAUTH_SCOPES.join(" ");
const GOOGLE_SCOPE_KEYS = ["gmail.compose", "openid", "email"] as const;
const PKCE_COOKIE_PREFIX = "solo_os_google_pkce_";
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const DEFAULT_RETURN_TO = "/app/settings/connections";
const GOOGLE_TIMEOUT_MS = 10_000;

export interface GoogleOAuthState {
  userId: string;
  workspaceId: string;
  pkceNonce: string;
  returnTo?: string;
  now: number;
}

export interface GooglePkcePair {
  verifier: string;
  challenge: string;
}

export interface GoogleTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  email_verified: true;
  mailboxEmail: string;
}

export type GoogleOAuthProviderErrorCode = "invalid_grant" | "transient" | "provider";

/** Sanitized provider failure; never carries Google's response body. */
export class GoogleOAuthProviderError extends Error {
  readonly code: GoogleOAuthProviderErrorCode;

  constructor(code: GoogleOAuthProviderErrorCode, message = "Google OAuth provider request failed") {
    super(message);
    this.name = "GoogleOAuthProviderError";
    this.code = code;
  }
}

function clientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google OAuth configuration is missing");
  return { clientId, clientSecret, redirectUri };
}

function stateSecret(): string {
  const stateSigningValue = process.env.GOOGLE_OAUTH_STATE_SECRET;
  if (!stateSigningValue || stateSigningValue.length < 32) throw new Error("Google OAuth state secret is missing");
  return stateSigningValue;
}

/** Only same-origin relative paths are accepted from OAuth state. */
export function safeGoogleReturnTo(returnTo?: string | null): string {
  if (
    typeof returnTo !== "string"
    || !returnTo.startsWith("/")
    || returnTo.startsWith("//")
    || returnTo.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(returnTo)
    || returnTo.length > 500
  ) return DEFAULT_RETURN_TO;
  return returnTo;
}

export function createGoogleOAuthState(input: Omit<GoogleOAuthState, "now" | "returnTo"> & { returnTo?: string | null; now?: number }): string {
  const payload = Buffer.from(JSON.stringify({ ...input, returnTo: safeGoogleReturnTo(input.returnTo), now: input.now ?? Date.now() }), "utf8").toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(state: string, maxAgeMs = 10 * 60_000): GoogleOAuthState {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("Invalid OAuth state");
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("Invalid OAuth state");
  let parsed: Partial<GoogleOAuthState>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<GoogleOAuthState>;
  } catch {
    throw new Error("Invalid OAuth state");
  }
  if (
    typeof parsed.userId !== "string"
    || typeof parsed.workspaceId !== "string"
    || typeof parsed.pkceNonce !== "string"
    || !PKCE_NONCE_PATTERN.test(parsed.pkceNonce)
    || typeof parsed.now !== "number"
    || !Number.isFinite(parsed.now)
    || Date.now() - parsed.now > maxAgeMs
    || parsed.now > Date.now() + 30_000
    || safeGoogleReturnTo(parsed.returnTo) !== parsed.returnTo
  ) throw new Error("Expired OAuth state");
  return { ...parsed, returnTo: safeGoogleReturnTo(parsed.returnTo), now: parsed.now } as GoogleOAuthState;
}

export function createGooglePkcePair(): GooglePkcePair {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier, "ascii").digest("base64url") };
}

export function createOpaqueStateNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function googlePkceCookieName(nonce: string): string {
  if (!PKCE_NONCE_PATTERN.test(nonce)) throw new Error("Invalid OAuth PKCE nonce");
  return `${PKCE_COOKIE_PREFIX}${nonce}`;
}

export function assertGooglePkceVerifier(verifier: string): string {
  if (!PKCE_VERIFIER_PATTERN.test(verifier)) throw new Error("Invalid OAuth PKCE verifier");
  return verifier;
}

export function buildGoogleAuthorizationUrl(state: string, codeChallenge: string): string {
  const { clientId, redirectUri } = clientConfig();
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new Error("Invalid OAuth PKCE challenge");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function fetchGoogle(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function normalizeScope(scope: string): string {
  if (scope === "https://www.googleapis.com/auth/gmail.compose") return "gmail.compose";
  if (scope === "https://www.googleapis.com/auth/userinfo.email") return "email";
  return scope;
}

export function normalizeGoogleScopes(scope: string | string[] | undefined): string[] {
  const values = Array.isArray(scope) ? scope : typeof scope === "string" ? scope.split(/\s+/) : [];
  return [...new Set(values.map(normalizeScope).filter(Boolean))].sort();
}

export function validateGoogleTokenSet(payload: unknown, options: { requireRefreshToken?: boolean; requireScope?: boolean } = {}): GoogleTokenSet {
  if (!payload || typeof payload !== "object") throw new Error("Google token response is invalid");
  const candidate = payload as Partial<GoogleTokenSet>;
  if (typeof candidate.access_token !== "string" || candidate.access_token.length < 1 || candidate.access_token.length > 8_000) throw new Error("Google access token is invalid");
  if (options.requireRefreshToken !== false && (typeof candidate.refresh_token !== "string" || candidate.refresh_token.length < 1 || candidate.refresh_token.length > 8_000)) throw new Error("Google refresh token is required");
  if (candidate.refresh_token !== undefined && (typeof candidate.refresh_token !== "string" || candidate.refresh_token.length < 1 || candidate.refresh_token.length > 8_000)) throw new Error("Google refresh token is invalid");
  if (candidate.token_type !== "Bearer") throw new Error("Google token type is invalid");
  if (!Number.isInteger(candidate.expires_in) || (candidate.expires_in as number) <= 0 || (candidate.expires_in as number) > 86_400) throw new Error("Google token expiry is invalid");
  const normalized = normalizeGoogleScopes(candidate.scope);
  if ((options.requireScope ?? true) && (normalized.length !== GOOGLE_SCOPE_KEYS.length || normalized.some((scope, index) => scope !== [...GOOGLE_SCOPE_KEYS].sort()[index]))) throw new Error("Google scopes are invalid");
  return { ["access_token"]: candidate.access_token, ["refresh_token"]: candidate.refresh_token, expires_in: candidate.expires_in as number, token_type: candidate.token_type, scope: normalized.join(" ") };
}

export async function exchangeGoogleCode(code: string, codeVerifier: string): Promise<GoogleTokenSet> {
  const { clientId, clientSecret, redirectUri } = clientConfig();
  const verifier = assertGooglePkceVerifier(codeVerifier);
  if (!code || code.length > 8_000) throw new Error("Google authorization code is invalid");
  const response = await fetchGoogle("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: clientId, ["client_secret"]: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!response.ok) throw new Error("Google token exchange failed");
  return validateGoogleTokenSet(await response.json(), { requireRefreshToken: true, requireScope: true });
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenSet> {
  if (!refreshToken || refreshToken.length > 8_000) throw new Error("Google refresh token is invalid");
  const { clientId, clientSecret } = clientConfig();
  const response = await fetchGoogle("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ["refresh_token"]: refreshToken, client_id: clientId, ["client_secret"]: clientSecret, grant_type: "refresh_token" }),
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) throw new GoogleOAuthProviderError("invalid_grant", "Google token refresh failed");
    if (response.status === 408 || response.status === 429 || response.status >= 500) throw new GoogleOAuthProviderError("transient", "Google token refresh failed");
    throw new GoogleOAuthProviderError("provider", "Google token refresh failed");
  }
  const refreshed = validateGoogleTokenSet(await response.json(), { requireRefreshToken: false, requireScope: false });
  return { ...refreshed, refresh_token: refreshed.refresh_token ?? refreshToken };
}

async function readJsonResponse(response: Response, message: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(message);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") throw new Error(message);
  return payload as Record<string, unknown>;
}

export async function fetchGoogleIdentity(accessToken: string): Promise<GoogleIdentity> {
  if (!accessToken || accessToken.length > 8_000) throw new Error("Google access token is invalid");
  const headers = { Authorization: `Bearer ${accessToken}` };
  const userinfo = await readJsonResponse(await fetchGoogle("https://openidconnect.googleapis.com/v1/userinfo", { headers }), "Google identity lookup failed");
  const profile = await readJsonResponse(await fetchGoogle("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers }), "Gmail profile lookup failed");
  const sub = typeof userinfo.sub === "string" ? userinfo.sub : "";
  const email = typeof userinfo.email === "string" ? userinfo.email.trim().toLowerCase() : "";
  const mailboxEmail = typeof profile.emailAddress === "string" ? profile.emailAddress.trim().toLowerCase() : "";
  if (!sub || sub.length > 256 || !email || email.length > 320 || userinfo.email_verified !== true || !mailboxEmail || mailboxEmail.length > 320 || email !== mailboxEmail) throw new Error("Google identity is not verified");
  return { sub, email, email_verified: true, mailboxEmail };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  if (!token || token.length > 8_000) throw new Error("Invalid Google token");
  const response = await fetchGoogle("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok && response.status !== 400) throw new Error("Google token revocation failed");
}
