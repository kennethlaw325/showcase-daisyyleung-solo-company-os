import type { PortalContext, PortalUser, Workspace } from "../domain/types";
import { DEFAULT_LOCALE, parseLocale } from "../i18n/locale";
import { createSupabaseAdminClient } from "./admin";
import { createServerSupabaseClient } from "./server";

export class AuthRequiredError extends Error {
  readonly status = 401;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class WorkspaceRequiredError extends Error {
  readonly status = 403;
  constructor(message = "Workspace membership required") {
    super(message);
    this.name = "WorkspaceRequiredError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isInvitationEligibleForMagicLink(
  invitation: { status: "pending" | "accepted"; expires_at: string },
  now = new Date(),
): boolean {
  return invitation.status === "accepted" || new Date(invitation.expires_at) > now;
}

async function getVerifiedUser(): Promise<{ id: string; email?: string } | null> {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return null;
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email };
}

export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

/**
 * Derives the tenant exclusively from the verified Supabase user session and
 * membership row. No request/body workspace id is accepted here.
 */
export async function getPortalContext(): Promise<PortalContext | null> {
  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return null;
  }
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const [{ data: membership, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
    supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, slug, timezone, default_locale)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle(),
    supabase.from("profiles").select("locale,display_name").eq("id", user.id).maybeSingle(),
  ]);
  if (membershipError || !membership?.workspace_id || !membership.workspaces) return null;
  const rawWorkspace = Array.isArray(membership.workspaces) ? membership.workspaces[0] : membership.workspaces;
  if (!rawWorkspace) return null;

  const workspaceLocale = parseLocale(rawWorkspace.default_locale, DEFAULT_LOCALE);
  const locale = parseLocale(profileError ? undefined : profile?.locale, workspaceLocale);
  const displayName = profileError ? undefined : profile?.display_name?.trim() || undefined;
  const portalUser: PortalUser = { id: user.id, email: user.email, displayName, role: membership.role, locale };
  const workspace: Workspace = {
    id: rawWorkspace.id,
    name: rawWorkspace.name,
    slug: rawWorkspace.slug,
    timezone: rawWorkspace.timezone,
    default_locale: workspaceLocale,
  };
  const role = membership.role === "owner" || membership.role === "admin" ? membership.role : "member";
  return { user: portalUser, locale, workspace, membership: { workspace_id: workspace.id, role } };
}

export async function requirePortalContext(): Promise<PortalContext> {
  const context = await getPortalContext();
  if (!context) throw new AuthRequiredError();
  return context;
}

/**
 * Verifies a platform administrator from the server session only. This helper
 * deliberately does not query workspace membership, so bootstrap admins can
 * create the first isolated workspace for an invited pilot.
 */
export async function requirePlatformAdminUser(): Promise<PortalUser> {
  const user = await getVerifiedUser();
  if (!user) throw new AuthRequiredError();
  let listedInDatabase = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    listedInDatabase = Boolean(data);
  } catch {
    listedInDatabase = false;
  }
  const listedInEnvironment = Boolean(user.email && platformAdminEmails().includes(normalizeEmail(user.email)));
  if (!listedInDatabase && !listedInEnvironment) {
    throw new WorkspaceRequiredError("Administrator access required");
  }
  return { id: user.id, email: user.email, role: "platform_admin" };
}

export async function requestInviteOnlyMagicLink(email: string, redirectTo?: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const admin = createSupabaseAdminClient();
  const { data: invitation, error: inviteError } = await admin
    .from("invitations")
    .select("id, status, expires_at")
    .eq("email", normalized)
    .in("status", ["pending", "accepted"])
    .maybeSingle();
  if (inviteError || !invitation || !isInvitationEligibleForMagicLink(invitation)) {
    // Do not disclose whether an address is invited to callers.
    throw new Error("Magic link unavailable");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: redirectTo ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000/auth/callback",
    },
  });
  if (error) throw new Error("Magic link unavailable");
}

export async function exchangeAuthCode(code: string) {
  const supabase = await createServerSupabaseClient();
  return supabase.auth.exchangeCodeForSession(code);
}
