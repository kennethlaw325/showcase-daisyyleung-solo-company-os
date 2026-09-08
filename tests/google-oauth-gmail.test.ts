import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  createGooglePkcePair,
  createOpaqueStateNonce,
  exchangeGoogleCode,
  fetchGoogleIdentity,
  googlePkceCookieName,
  refreshGoogleAccessToken,
  revokeGoogleToken,
  safeGoogleReturnTo,
  validateGoogleTokenSet,
  verifyGoogleOAuthState,
} from "../src/lib/adapters/google";
import {
  buildRfc2822Message,
  createGmailDraft,
  createGmailProviderMessageId,
  findGmailDraftByMessageId,
} from "../src/lib/adapters/gmail";

const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const IDEMPOTENCY_KEY = "approved-draft-attempt-0001";
const root = resolve(import.meta.dirname, "..");

function subjectHeaderValue(message: string): string {
  const lines = message.split("\r\n");
  const subjectIndex = lines.findIndex((line) => line.startsWith("Subject:"));
  if (subjectIndex < 0) throw new Error("Subject header missing");
  const values = [lines[subjectIndex].slice("Subject:".length).trimStart()];
  for (let index = subjectIndex + 1; lines[index]?.startsWith(" "); index += 1) values.push(lines[index].slice(1));
  return values.join("");
}

function decodeEncodedSubject(value: string): string {
  return [...value.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"))
    .join("");
}

describe("Google OAuth PKCE", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret-with-enough-entropy");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:3000/api/oauth/google/callback");
    vi.stubEnv("GOOGLE_OAUTH_STATE_SECRET", "test-state-secret-with-at-least-32-characters");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates a unique S256 verifier/challenge pair and keeps the verifier out of the authorization URL", () => {
    const pkce = createGooglePkcePair();
    const nonce = createOpaqueStateNonce();
    const state = createGoogleOAuthState({ userId: "user-1", workspaceId: "workspace-1", pkceNonce: nonce, returnTo: "/app/settings/connections", now: Date.now() });
    const url = new URL(buildGoogleAuthorizationUrl(state, pkce.challenge));

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(createHash("sha256").update(pkce.verifier, "ascii").digest("base64url"));
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("code_verifier")).toBe(false);
    expect(verifyGoogleOAuthState(state).pkceNonce).toBe(nonce);
    expect(googlePkceCookieName(nonce)).toBe(`solo_os_google_pkce_${nonce}`);
  });

  it("rejects OAuth state that has no bound PKCE nonce", () => {
    const state = createGoogleOAuthState({ userId: "user-1", workspaceId: "workspace-1", pkceNonce: "", now: Date.now() });
    expect(() => verifyGoogleOAuthState(state)).toThrow(/Expired OAuth state/);
  });

  it("sends the bound verifier only to Google's token endpoint", async () => {
    const pkce = createGooglePkcePair();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "access-token-example",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/gmail.compose openid email",
    }), { status: 200 }));

    await expect(exchangeGoogleCode("authorization-code", pkce.verifier)).resolves.toMatchObject({ access_token: "access-token-example" });
    const [, init] = fetchMock.mock.calls[0];
    const body = init?.body as URLSearchParams;
    expect(body.get("code_verifier")).toBe(pkce.verifier);
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("rejects unsafe OAuth return paths and requires a separate state secret", () => {
    expect(safeGoogleReturnTo("/app/settings/connections")).toBe("/app/settings/connections");
    expect(safeGoogleReturnTo("//evil.example")).toBe("/app/settings/connections");
    expect(safeGoogleReturnTo("/\\evil.example")).toBe("/app/settings/connections");
    expect(safeGoogleReturnTo("/app/%0d%0a")).toBe("/app/%0d%0a");
    vi.stubEnv("GOOGLE_OAUTH_STATE_SECRET", "");
    expect(() => createGoogleOAuthState({ userId: "user-1", workspaceId: "workspace-1", pkceNonce: createOpaqueStateNonce() })).toThrow(/state secret/);
  });

  it("validates exact durable token fields and rejects extra or non-Bearer grants", () => {
    expect(() => validateGoogleTokenSet({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer", scope: "openid email" })).toThrow(/scopes/);
    expect(() => validateGoogleTokenSet({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "MAC", scope: "https://www.googleapis.com/auth/gmail.compose openid email" })).toThrow(/type/);
    expect(() => validateGoogleTokenSet({ access_token: "a", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.compose openid email" })).toThrow(/refresh/);
  });

  it("fetches verified OIDC identity and Gmail profile and requires an exact mailbox match", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: "google-sub", email: "User@Example.com", email_verified: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "user@example.com" }), { status: 200 }));
    await expect(fetchGoogleIdentity("access-token")).resolves.toMatchObject({ sub: "google-sub", email: "user@example.com", mailboxEmail: "user@example.com" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("openidconnect.googleapis.com");
    expect(String(fetchMock.mock.calls[1][0])).toContain("gmail.googleapis.com/gmail/v1/users/me/profile");
  });

  it("preserves a refresh token when Google does not rotate it and accepts a rotated one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access-example", expires_in: 3600, token_type: "Bearer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access-2-example", refresh_token: "rotated-refresh", expires_in: 3600, token_type: "Bearer" }), { status: 200 }));
    await expect(refreshGoogleAccessToken("old-refresh")).resolves.toMatchObject({ access_token: "new-access-example", refresh_token: "old-refresh" });
    await expect(refreshGoogleAccessToken("old-refresh")).resolves.toMatchObject({ access_token: "new-access-2-example", refresh_token: "rotated-refresh" });
    expect((fetchMock.mock.calls[0][1]?.body as URLSearchParams).get("refresh_token")).toBe("old-refresh");
  });

  it("classifies invalid_grant separately from transient refresh failures", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 400 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(refreshGoogleAccessToken("old-refresh")).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(refreshGoogleAccessToken("old-refresh")).rejects.toMatchObject({ code: "transient" });
  });

  it("revokes with an x-www-form-urlencoded body and treats HTTP 400 as already revoked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 400 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(revokeGoogleToken("refresh-token")).resolves.toBeUndefined();
    await expect(revokeGoogleToken("refresh-token")).rejects.toThrow(/revocation/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/revoke");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "content-type": "application/x-www-form-urlencoded" });
    expect((init?.body as URLSearchParams).get("token")).toBe("refresh-token");
  });

  it("loads the persisted connection for the verified user and keeps callback feedback bounded", () => {
    const page = readFileSync(resolve(root, "app/app/settings/connections/page.tsx"), "utf8");
    const panel = readFileSync(resolve(root, "src/components/portal/connection-panel.tsx"), "utf8");
    const callback = readFileSync(resolve(root, "app/api/oauth/google/callback/route.ts"), "utf8");
    const disconnect = readFileSync(resolve(root, "app/api/oauth/google/disconnect/route.ts"), "utf8");
    const action = readFileSync(resolve(root, "app/api/cases/[id]/action/route.ts"), "utf8");
    expect(page).toContain('.eq("workspace_id", context.workspace.id)');
    expect(page).toContain('.eq("owner_user_id", context.user.id)');
    expect(page).toContain("gmailConfigured");
    expect(page).toContain("process.env.GOOGLE_OAUTH_STATE_SECRET?.length");
    expect(page).toContain('requestedCallbackResult === "connected" && !demo && !initialConnected');
    expect(panel).toContain('href="/api/oauth/google/start"');
    expect(panel).toContain('initialConnected || (demo && callbackResult === "connected")');
    expect(panel).not.toContain('router.push("/api/oauth/google/start")');
    expect(panel).toContain('aria-live="polite"');
    expect(callback).toContain('error=google_connect');
    expect(callback).toContain("google_connect_${failureStage}_failed");
    expect(callback).toContain('errorUrl.searchParams.set("stage", failureStage)');
    expect(callback).not.toContain("console.error(error");
    expect(callback).toContain("revokeGoogleToken");
    expect(disconnect).toContain('.eq("owner_user_id", context.user.id)');
    expect(disconnect).toContain("p_reauthorization_required: providerRevoked");
    expect(action).toContain('.eq("owner_user_id", context.user.id)');
    expect(callback).toContain("connect_google_oauth");
    expect(callback).toContain("fetchGoogleIdentity");
    expect(action).toContain("p_connection_id: connection.id");
    expect(action).toContain("execution_connection_id");
    expect(action).toContain("postClaimSecret");
    expect(panel).toContain("setEmail(null)");
    expect(panel).toContain('fetch("/api/workspace/export")');
  });
});

describe("Gmail draft reconciliation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses a deterministic content-free Message-ID without exposing the idempotency key", () => {
    const marker = createGmailProviderMessageId(ACTION_ID, IDEMPOTENCY_KEY);
    const sameMarker = createGmailProviderMessageId(ACTION_ID, IDEMPOTENCY_KEY);
    const otherMarker = createGmailProviderMessageId("22222222-2222-4222-8222-222222222222", IDEMPOTENCY_KEY);
    const message = buildRfc2822Message({ to: "person@example.com", subject: "Approved subject", body: "Approved body" }, marker);

    expect(marker).toBe(sameMarker);
    expect(marker).not.toBe(otherMarker);
    expect(marker).not.toContain(IDEMPOTENCY_KEY);
    expect(message).toContain(`Message-ID: ${marker}\r\n`);
  });

  it("builds deterministic multipart alternatives with safe base64 parts", () => {
    const marker = createGmailProviderMessageId(ACTION_ID, IDEMPOTENCY_KEY);
    const payload = {
      to: "person@example.com",
      cc: ["copy@example.com"],
      bcc: ["blind@example.com"],
      subject: "Subject with <hostile> text",
      thread_id: "thread-123",
      body: "**Bold** _italic_ ==highlight==\n\n- one\n- two\n1. first\n2. second\n你好 👋\n<script>alert('x')</script>",
    };
    const message = buildRfc2822Message(payload, marker);
    const sameMessage = buildRfc2822Message(payload, marker);
    const boundary = message.match(/boundary="([A-Za-z0-9-]+)"/)?.[1];
    expect(boundary).toMatch(/^solo-os-alt-[a-f0-9]{32}$/);
    expect(message).toBe(sameMessage);
    expect(message).toContain("MIME-Version: 1.0\r\n");
    expect(message).toContain("Content-Type: multipart/alternative;");
    expect(message).toContain("To: person@example.com\r\n");
    expect(message).toContain("Cc: copy@example.com\r\n");
    expect(message).toContain("Bcc: blind@example.com\r\n");
    expect(message).toContain("Subject: Subject with <hostile> text\r\n");
    expect(message).toContain(`Message-ID: ${marker}\r\n`);
    expect(message).toContain("X-Solo-OS-Thread: thread-123\r\n");
    if (!boundary) throw new Error("MIME boundary missing");
    const parts = message.split(`--${boundary}`).slice(1, -1).map((part) => part.replace(/^\r\n/, ""));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("Content-Type: text/plain");
    expect(parts[1]).toContain("Content-Type: text/html");
    expect(message.indexOf("Content-Type: text/plain")).toBeLessThan(message.indexOf("Content-Type: text/html"));
    const decodePart = (part: string) => {
      const body = part.split("\r\n\r\n")[1]?.replace(/\r\n/g, "") ?? "";
      expect(body).toMatch(/^[A-Za-z0-9+/=]*$/);
      const encodedLines = part.split("\r\n\r\n")[1]?.trim().split("\r\n") ?? [];
      expect(encodedLines.every((line) => line.length <= 76)).toBe(true);
      return Buffer.from(body, "base64").toString("utf8");
    };
    const plain = decodePart(parts[0]);
    const html = decodePart(parts[1]);
    expect(plain).toContain("Bold italic highlight");
    expect(plain).toContain("- one\n- two");
    expect(plain).toContain("1. first\n2. second");
    expect(plain).toContain("你好 👋");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<mark>highlight</mark>");
    expect(html).toContain("你好 👋");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(message.match(new RegExp(`--${boundary}`, "g"))?.length).toBe(3);
  });

  it("serializes Unicode subjects as RFC 2047 UTF-8 encoded-words", () => {
    const subject = "你好，Demo User 👋";
    const message = buildRfc2822Message({ to: "person@example.com", subject, body: "body" });
    const headerValue = subjectHeaderValue(message);

    expect(headerValue).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(decodeEncodedSubject(headerValue)).toBe(subject);
  });

  it("folds long Unicode subjects without splitting code points or exceeding encoded-word limits", () => {
    const subject = "你好🙂".repeat(40);
    const message = buildRfc2822Message({ to: "person@example.com", subject, body: "body" });
    const headerValue = subjectHeaderValue(message);
    const words = [...headerValue.matchAll(/=\?UTF-8\?B\?[^?]+\?=/g)].map((match) => match[0]);
    const subjectLines = message.split("\r\n").filter((line) => line === "Subject:" || line.startsWith(" =?UTF-8?B?"));

    expect(words.length).toBeGreaterThan(1);
    expect(words.every((word) => word.length <= 75)).toBe(true);
    expect(subjectLines.every((line) => line.length <= 76)).toBe(true);
    expect(decodeEncodedSubject(headerValue)).toBe(subject);
  });

  it("keeps printable ASCII subjects byte-for-byte compatible", () => {
    const message = buildRfc2822Message({ to: "person@example.com", subject: "Approved subject", body: "body" });
    expect(message).toContain("Subject: Approved subject\r\n");
    expect(message).not.toContain("=?UTF-8?B?");
  });

  it("searches drafts only by the deterministic Message-ID", async () => {
    const marker = createGmailProviderMessageId(ACTION_ID, IDEMPOTENCY_KEY);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ drafts: [{ id: "draft-1", message: { id: "message-1", threadId: "thread-1" } }] }), { status: 200 }));

    await expect(findGmailDraftByMessageId({ accessToken: "access-token-example", providerMessageId: marker })).resolves.toEqual({ id: "draft-1", messageId: "message-1", threadId: "thread-1" });
    const [requestUrl, init] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe("/gmail/v1/users/me/drafts");
    expect(url.searchParams.get("q")).toBe(`rfc822msgid:${marker}`);
    expect(url.searchParams.get("maxResults")).toBe("2");
    expect(init?.method).toBeUndefined();
  });

  it("fails closed when reconciliation finds multiple drafts", async () => {
    const marker = createGmailProviderMessageId(ACTION_ID, IDEMPOTENCY_KEY);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ drafts: [{ id: "draft-1" }, { id: "draft-2" }] }), { status: 200 }));
    await expect(findGmailDraftByMessageId({ accessToken: "access-token-example", providerMessageId: marker })).rejects.toThrow(/multiple matches/);
  });

  it("embeds the same marker in the created draft and never calls a send endpoint", async () => {
    const marker = createGmailProviderMessageId(ACTION_ID, IDEMPOTENCY_KEY);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "draft-1", message: { id: "message-1" } }), { status: 200 }));

    await createGmailDraft({ accessToken: "access-token-example", payload: { to: "person@example.com", subject: "Approved subject", body: "Approved body" }, idempotencyKey: IDEMPOTENCY_KEY, providerMessageId: marker });
    const [requestUrl, init] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(String(init?.body)) as { message: { raw: string } };
    expect(requestBody.message.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = Buffer.from(requestBody.message.raw, "base64url").toString("utf8");
    expect(String(requestUrl)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(String(requestUrl)).not.toContain("/send");
    expect(init?.method).toBe("POST");
    expect(decoded).toContain(`Message-ID: ${marker}\r\n`);
  });
});
