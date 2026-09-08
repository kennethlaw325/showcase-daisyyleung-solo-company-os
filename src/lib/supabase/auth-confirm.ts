import type { EmailOtpType } from "@supabase/supabase-js";

const supportedEmailOtpTypes = ["invite", "magiclink"] as const satisfies readonly EmailOtpType[];

export type SupportedEmailOtpType = (typeof supportedEmailOtpTypes)[number];

export interface AuthConfirmation {
  tokenHash: string;
  type: SupportedEmailOtpType;
  next: string;
}

export function safePortalRedirect(value: string | null): string {
  if (!value || !/^\/(?![\\/])/.test(value)) return "/app";
  try {
    const base = new URL("https://solo-company-os.invalid");
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return "/app";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/app";
  }
}

export function parseAuthConfirmation(url: URL): AuthConfirmation | null {
  const tokenHash = url.searchParams.get("token_hash")?.trim();
  const rawType = url.searchParams.get("type");
  if (!tokenHash || !supportedEmailOtpTypes.some((type) => type === rawType)) return null;
  return {
    tokenHash,
    type: rawType as SupportedEmailOtpType,
    next: safePortalRedirect(url.searchParams.get("next")),
  };
}
