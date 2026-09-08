import type { Metadata } from "next";
import { LoginForm, type LoginInitialError } from "@/src/components/login-form";
import { isSafeDemoMode } from "@/src/demo-mode";
import { PublicFormShell } from "@/src/components/public-form-shell";

export const metadata: Metadata = { title: "Sign in", description: "Invite-only access to the Solo Company OS pilot." };

const CALLBACK_ERROR_MAP: Record<string, LoginInitialError> = {
  auth_failed: "link_expired",
  invalid_confirmation: "link_expired",
  missing_code: "link_expired",
  admin_required: "generic",
  invite_required: "generic",
  workspace_setup_failed: "generic",
};

type LoginSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage() {
  const params: Awaited<LoginSearchParams> = {};
  const rawError = params.error;
  const initialError = typeof rawError === "string" && Object.hasOwn(CALLBACK_ERROR_MAP, rawError) ? CALLBACK_ERROR_MAP[rawError] : undefined;

  return (
    <PublicFormShell
      eyebrow={{ zh: "私人試用入口", en: "Private pilot portal" }}
      title={{ zh: "你的工作只留在\n你的工作空間。", en: "Your operating work stays in your workspace." }}
      intro={{
        zh: "Solo Company OS 使用安全電郵連結。\n只有獲批的試用邀請才可建立個人工作空間。",
        en: "Solo Company OS uses secure email links.\nOnly approved pilot invitations can create a personal workspace.",
      }}
    >
      <LoginForm initialError={initialError} demo={isSafeDemoMode()} />
    </PublicFormShell>
  );
}
