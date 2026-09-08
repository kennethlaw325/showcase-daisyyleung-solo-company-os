import { PilotPolicyPage } from "@/src/components/legal/pilot-policy-page";
import type { PilotPolicyLocale } from "@/src/lib/legal/pilot-policy";

type PolicySearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseLocale(value: string | string[] | undefined): PilotPolicyLocale {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "en" || candidate === "zh-Hant" ? candidate : "zh-Hant";
}

export default async function TermsPage() {
  const query: Awaited<PolicySearchParams> = {};
  return <PilotPolicyPage document="terms" locale={parseLocale(query.lang ?? query.locale)} />;
}
