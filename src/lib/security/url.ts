import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const PRIVATE_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

export interface SafeFetchOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  allowedContentTypes?: readonly string[];
}

export function isPrivateIp(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (PRIVATE_HOSTNAMES.has(normalized) || normalized.endsWith(".localhost") || normalized.endsWith(".internal") || normalized.endsWith(".local") || normalized.endsWith(".lan")) return true;
  if (net.isIPv4(normalized)) {
    const octets = normalized.split(".").map(Number);
    const [a, b] = octets;
    return a === 10 || a === 127 || a === 0 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedIpv4) return isPrivateIp(mappedIpv4);
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!mappedHex) return false;
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIp([high >> 8, high & 0xff, low >> 8, low & 0xff].join("."));
  }
  return false;
}

export async function assertSafeUrl(input: string | URL): Promise<URL> {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs are supported");
  if (url.username || url.password) throw new Error("URLs with credentials are not supported");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || isPrivateIp(hostname)) throw new Error("Private or local network URLs are not allowed");
  // Resolve every address and fail closed if DNS cannot be verified.
  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
      throw new Error("URL resolves to a private network");
    }
  } catch (error) {
    if (error instanceof Error && /private network/.test(error.message)) throw error;
    throw new Error("Unable to verify URL host");
  }
  return url;
}

async function requestPinnedHttps(url: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error("URL resolves to a private network");
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = https.request({
      protocol: "https:",
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { Accept: "text/plain,text/html,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      createConnection: () => tls.connect({ host: selected.address, port: url.port ? Number(url.port) : 443, servername: url.hostname, ALPNProtocols: ["http/1.1"] }),
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, String(value));
      }
      const declaredLength = Number(headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        fail(new Error("Response exceeds size limit"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          response.destroy();
          fail(new Error("Response exceeds size limit"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode ?? 502, headers, body: Buffer.concat(chunks) });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("URL fetch timed out")));
    request.on("error", fail);
    request.end();
  });
}

export async function fetchSafeUrl(input: string | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let current = await assertSafeUrl(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await requestPinnedHttps(current, maxBytes, timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === maxRedirects) throw new Error("Too many redirects");
      current = await assertSafeUrl(new URL(location, current));
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Fetch failed with status ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("Response exceeds size limit");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (options.allowedContentTypes?.length && (!contentType || !options.allowedContentTypes.includes(contentType))) {
      throw new Error("Unsupported response content type");
    }
    if (response.body.byteLength > maxBytes) throw new Error("Response exceeds size limit");
    const body = Uint8Array.from(response.body).buffer as ArrayBuffer;
    return new Response(body, { status: response.status, headers: response.headers });
  }
  throw new Error("Unable to fetch URL");
}
