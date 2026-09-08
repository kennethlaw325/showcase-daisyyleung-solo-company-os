import type { Metadata } from "next";
import { PublicFormShell } from "@/src/components/public-form-shell";
import { RequestAccessForm } from "@/src/components/request-access-form";
import { isSafeDemoMode } from "@/src/demo-mode";

export const metadata: Metadata = { title: "Request founding access", description: "Apply to join the invite-only Solo Company OS founding pilot." };

export default function RequestAccessPage() {
  return (
    <PublicFormShell
      eyebrow={{ zh: "創始試用 · 8–12 個名額", en: "Founding Pilot · 8–12 places" }}
      title={{ zh: "協助塑造\n一人公司的\n工作系統。", en: "Help shape the operating system for a company of one." }}
      intro={{
        zh: "我們正在尋找顧問、創作者及自由工作者，一起由背景脈絡走向清晰行動，並坦誠分享哪些做法真正有效。",
        en: "We’re looking for consultants, creators, and freelancers who want a clearer path from context to action—and are willing to share honest feedback about what works.",
      }}
    >
      <RequestAccessForm demo={isSafeDemoMode()} />
    </PublicFormShell>
  );
}
