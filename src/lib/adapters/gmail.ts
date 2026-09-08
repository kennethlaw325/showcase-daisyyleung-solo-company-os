import { createHash } from "node:crypto";
import type { ActionPayload } from "../domain/types";
import { formatEmailBody } from "../presentation/email-formatting";

function base64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function escapeHeader(input: string): string {
  return input.replace(/[\r\n]/g, "").trim();
}

function subjectHeader(input: string): string {
  const subject = escapeHeader(input);
  if (!/[^\x00-\x7F]/u.test(subject)) return `Subject: ${subject}\r\n`;

  const encodedWords: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const codePoint of subject) {
    const codePointBytes = Buffer.byteLength(codePoint, "utf8");
    if (chunk && chunkBytes + codePointBytes > 45) {
      encodedWords.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += codePoint;
    chunkBytes += codePointBytes;
  }
  if (chunk) encodedWords.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
  return `Subject:\r\n ${encodedWords.join("\r\n ")}\r\n`;
}

function assertProviderMessageId(messageId: string): string {
  if (!/^<[A-Za-z0-9._@-]{10,250}>$/.test(messageId)) throw new Error("Invalid Gmail reconciliation marker");
  return messageId;
}

function base64Lines(input: string): string {
  const encoded = Buffer.from(input, "utf8").toString("base64");
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 76) lines.push(encoded.slice(index, index + 76));
  return lines.join("\r\n");
}

export function createGmailProviderMessageId(actionId: string, idempotencyKey: string): string {
  if (!actionId || !idempotencyKey || idempotencyKey.length < 16) throw new Error("Gmail reconciliation identity is invalid");
  const digest = createHash("sha256").update(`${actionId}:${idempotencyKey}`, "utf8").digest("hex");
  return `<solo-os-${digest}@actions.solo-company-os.invalid>`;
}

export function buildRfc2822Message(payload: ActionPayload, providerMessageId?: string): string {
  const cc = payload.cc?.length ? `Cc: ${payload.cc.map(escapeHeader).join(", ")}\r\n` : "";
  const bcc = payload.bcc?.length ? `Bcc: ${payload.bcc.map(escapeHeader).join(", ")}\r\n` : "";
  const thread = payload.thread_id ? `X-Solo-OS-Thread: ${escapeHeader(payload.thread_id)}\r\n` : "";
  const messageId = providerMessageId ? `Message-ID: ${assertProviderMessageId(providerMessageId)}\r\n` : "";
  const formatted = formatEmailBody(payload.body);
  const boundaryDigest = createHash("sha256")
    .update(`${payload.to}\n${payload.cc?.join(",") ?? ""}\n${payload.bcc?.join(",") ?? ""}\n${payload.subject}\n${payload.thread_id ?? ""}\n${payload.body}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  const boundary = `solo-os-alt-${boundaryDigest}`;
  const mimeBody = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(formatted.plainText),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(formatted.html),
    `--${boundary}--`,
  ].join("\r\n");
  return `To: ${escapeHeader(payload.to)}\r\n${cc}${bcc}${subjectHeader(payload.subject)}${messageId}${thread}MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${mimeBody}\r\n`;
}

export interface GmailDraftResult {
  id: string;
  messageId?: string;
  threadId?: string;
}

function assertAccessToken(accessToken: string): string {
  if (!accessToken || accessToken.length > 8_000) throw new Error("Google access token is missing");
  return accessToken;
}

const GMAIL_TIMEOUT_MS = 10_000;

function fetchGmail(input: string | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GMAIL_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function gmailJson<T>(input: string | URL, init: RequestInit, errorMessage: string): Promise<T> {
  const response = await fetchGmail(input, init);
  if (!response.ok) throw new Error(errorMessage);
  return await response.json() as T;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

/** Gmail adapter deliberately exposes profile and draft operations only. */
export async function getGmailProfile(accessToken: string): Promise<GmailProfile> {
  const validatedAccessToken = assertAccessToken(accessToken);
  const payload = await gmailJson<{ emailAddress?: string; messagesTotal?: number; threadsTotal?: number }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${validatedAccessToken}` } },
    "Gmail profile lookup failed",
  );
  if (typeof payload.emailAddress !== "string" || !payload.emailAddress.trim()) throw new Error("Gmail profile is invalid");
  return { emailAddress: payload.emailAddress.trim().toLowerCase(), messagesTotal: payload.messagesTotal, threadsTotal: payload.threadsTotal };
}

/** Gmail adapter intentionally exposes draft creation and draft-only reconciliation; no send method exists. */
export async function findGmailDraftByMessageId(input: { accessToken: string; providerMessageId: string }): Promise<GmailDraftResult | null> {
  const accessToken = assertAccessToken(input.accessToken);
  const providerMessageId = assertProviderMessageId(input.providerMessageId);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
  url.searchParams.set("q", `rfc822msgid:${providerMessageId}`);
  url.searchParams.set("maxResults", "2");
  const payload = await gmailJson<{ drafts?: Array<{ id?: string; message?: { id?: string; threadId?: string } }> }>(url, { headers: { Authorization: `Bearer ${accessToken}` } }, "Gmail draft reconciliation failed");
  const matches = (payload.drafts ?? []).filter((draft) => typeof draft.id === "string");
  if (matches.length > 1) throw new Error("Gmail draft reconciliation found multiple matches");
  const match = matches[0];
  return match?.id ? { id: match.id, messageId: match.message?.id, threadId: match.message?.threadId } : null;
}

export async function createGmailDraft(input: { accessToken: string; payload: ActionPayload; idempotencyKey: string; providerMessageId: string }): Promise<GmailDraftResult> {
  const accessToken = assertAccessToken(input.accessToken);
  if (!input.idempotencyKey || input.idempotencyKey.length < 16) throw new Error("Idempotency key is required");
  const providerMessageId = assertProviderMessageId(input.providerMessageId);
  const payload = await gmailJson<{ id?: string; message?: { id?: string; threadId?: string } }>("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { raw: base64Url(buildRfc2822Message(input.payload, providerMessageId)) } }),
  }, "Gmail draft creation failed");
  if (!payload.id) throw new Error("Gmail returned no draft id");
  return { id: payload.id, messageId: payload.message?.id, threadId: payload.message?.threadId };
}
