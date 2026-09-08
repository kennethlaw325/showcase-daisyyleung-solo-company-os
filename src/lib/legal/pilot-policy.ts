/**
 * The founding-pilot policy bundle is the single source used by the public
 * consent form and both legal pages.  It is deliberately a working, pre-
 * launch policy: counsel review is still a launch gate.
 */

export const PILOT_POLICY_VERSION = "founding-pilot-2026-08-21-v1" as const;

export type PilotPolicyLocale = "en" | "zh-Hant";
export type PilotPolicyDocument = "privacy" | "terms";

export type PilotPolicySection = {
  heading: string;
  body: string;
};

export type PilotPolicyCopy = {
  title: string;
  eyebrow: string;
  reviewNotice: string;
  intro: string;
  sections: readonly PilotPolicySection[];
};

export type PilotPolicyBundle = {
  privacy: Record<PilotPolicyLocale, PilotPolicyCopy>;
  terms: Record<PilotPolicyLocale, PilotPolicyCopy>;
  contactPermission: Record<PilotPolicyLocale, { label: string; body: string }>;
};

export const pilotPolicy = {
  privacy: {
    "zh-Hant": {
      eyebrow: "創始試用 · 私隱聲明",
      title: "私隱應該在工作流程中清楚可見。",
      reviewNotice: "這是創始試用的預發布版本，正待法律顧問審閱；此版本不是法律批准或生產政策。",
      intro: "本聲明說明設計夥伴試用期間預計如何處理資料、人工智能服務及外部連接。試用功能、保留期限及支援安排仍可能調整。",
      sections: [
        { heading: "我們收集甚麼", body: "申請資料、受邀帳戶身分、你提交的來源、產生的草稿、明確審批、連接器執行紀錄、結果回顧，以及不含內容的用量事件。" },
        { heading: "人工智能處理", body: "你選擇的來源內容會由伺服器送到已設定的人工智能服務，以產生所要求的草稿。Gemini 及 OpenAI 請求使用 store: false，不使用背景執行或供應商管理的對話記憶。Solo Company OS 不宣稱零資料保留。" },
        { heading: "外部連接", body: "Gmail 連接是可選的。試用只要求 gmail.compose 權限及建立草稿；不會讀取收件匣，也不會自動傳送電郵。為了在中斷後避免重複草稿，系統可能只搜尋不含內容的草稿識別資料。" },
        { heading: "你的控制及資料要求", body: "工作空間擁有人可以要求匯出資料，並按照介面確認刪除個案。詳細保留、支援存取、刪除時限及處理者條款，均是正式推出前的必要條件。個案刪除與來源證據保存的關係仍待決定，現階段不會以此聲明改變產品行為。" },
        { heading: "聯絡我們", body: "如要提出資料問題、匯出要求或撤回聯絡許可，請回覆 Demo User 提供的試用聯絡電郵；試用期間會由人工處理。" },
      ],
    },
    en: {
      eyebrow: "Founding pilot · Privacy",
      title: "Privacy should be visible in the workflow.",
      reviewNotice: "This is a pre-launch founding-pilot version pending legal counsel review; it is not legal approval or a production policy.",
      intro: "This note explains the intended handling of data, AI providers, and external connections during design-partner testing. Pilot features, retention periods, and support arrangements may still change.",
      sections: [
        { heading: "What we collect", body: "Application details, invited account identity, sources you submit, generated drafts, explicit approvals, connector execution records, outcome reviews, and content-free usage events." },
        { heading: "AI processing", body: "Selected source content is sent server-side to the configured AI provider to create the requested draft. Gemini and OpenAI requests use store: false and do not use background execution or provider-managed conversation state. Solo Company OS does not claim Zero Data Retention." },
        { heading: "External connections", body: "Gmail is optional. The pilot requests gmail.compose and creates drafts only; it does not read the inbox or automatically send email. To prevent duplicate drafts after an interruption, it may search draft metadata using a content-free action marker." },
        { heading: "Your controls and requests", body: "Workspace owners can request an export and explicitly delete cases through the interface. Detailed retention, support access, deletion timing, and processor terms are launch requirements. The relationship between case deletion and provenance preservation remains unresolved; this note does not change product behaviour." },
        { heading: "Contact", body: "For a data question, export request, or withdrawal of contact permission, reply to the pilot contact email provided by Demo User; requests are handled manually during the pilot." },
      ],
    },
  },
  terms: {
    "zh-Hant": {
      eyebrow: "創始試用 · 服務條款",
      title: "試用協助判斷，但不取代你的判斷。",
      reviewNotice: "這是創始試用的預發布版本，正待法律顧問審閱；此版本不是法律批准或生產條款。",
      intro: "這些工作條款只適用於設計夥伴測試。正式推出、收費或擴大使用前，必須完成法律審閱及相應更新。",
      sections: [
        { heading: "人工審批及責任", body: "人工智能產生的內容只是草稿。你須在審批或使用前核實事實、收件人、聲稱、授權及適用性，並對自己的外部行動負責。" },
        { heading: "不會自動傳送", body: "Gmail 連接器只可建立已審批的草稿。傳送是你在 Gmail 內另行進行的手動操作。" },
        { heading: "可接受用途", body: "請勿上載密碼或其他秘密、違法內容、受規管的專業紀錄，或你沒有權限處理的第三方資料。" },
        { heading: "試用安排", body: "創始試用期間功能可能改變，並不提供公開價格、服務水平保證或生產可用性承諾。任何邀請均須以有效的版本化試用同意紀錄為前提。" },
        { heading: "聯絡許可", body: "你可以選擇同意我們就創始試用聯絡你。撤回許可不會影響撤回前已進行的處理；如要撤回，請使用私隱聲明所列的聯絡方法。" },
      ],
    },
    en: {
      eyebrow: "Founding pilot · Terms",
      title: "The pilot assists judgement; it does not replace it.",
      reviewNotice: "These are pre-launch founding-pilot terms pending legal counsel review; they are not legal approval or production terms.",
      intro: "These working terms support design-partner testing only. Legal review and an update to the final terms are required before production onboarding, payment, or wider use.",
      sections: [
        { heading: "Human approval and responsibility", body: "AI-generated material is a draft. You are responsible for checking facts, recipients, claims, permissions, and suitability before approving or using an artifact, and for your own external actions." },
        { heading: "No autonomous sending", body: "The Gmail connector may create an approved draft only. Sending remains a separate manual action in Gmail." },
        { heading: "Acceptable use", body: "Do not upload passwords or other secrets, unlawful content, regulated professional records, or third-party material you are not authorised to process." },
        { heading: "Pilot availability", body: "Features may change during the founding pilot. No public price, service-level guarantee, or production availability commitment is offered. Every invitation requires a valid versioned pilot-consent record." },
        { heading: "Contact permission", body: "You may choose to let us contact you about the founding pilot. Withdrawal does not affect processing that occurred before withdrawal; use the contact method in the privacy note to withdraw." },
      ],
    },
  },
  contactPermission: {
    "zh-Hant": {
      label: "創始試用聯絡許可",
      body: "我同意 Solo Company OS 就創始試用聯絡我，並確認已閱讀私隱聲明及服務條款。",
    },
    en: {
      label: "Founding-pilot contact permission",
      body: "I agree that Solo Company OS may contact me about the founding pilot and confirm that I have read the privacy note and terms.",
    },
  },
} satisfies PilotPolicyBundle;

export function policyCopy(document: PilotPolicyDocument, locale: PilotPolicyLocale): PilotPolicyCopy {
  return pilotPolicy[document][locale];
}
