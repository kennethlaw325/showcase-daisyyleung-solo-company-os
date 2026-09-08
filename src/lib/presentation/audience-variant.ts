import type { Locale } from "@/src/lib/i18n/locale";

const PRESET_LABELS: Record<Locale, Record<string, string>> = {
  "zh-Hant": { self: "自己", client: "客戶", public: "公開", custom: "自訂" },
  en: { self: "Self", client: "Client", public: "Public", custom: "Custom" },
};

const ZH_PROFILE_LABELS: Record<string, string> = {
  "direct and reflective": "直接、反思式",
  "clear and collaborative": "清晰、協作式",
  "plain and approachable": "平實、易理解",
  "clear and audience-appropriate": "清晰、適合受眾",
  "working note": "工作筆記",
  "working note with evidence and next action": "包含證據及下一步的工作筆記",
  "client-ready brief": "客戶版簡報",
  "public explainer": "公開說明",
  "audience brief": "受眾簡報",
  "the same requested deliverable, adapted for internal use": "同一交付內容的內部版本",
  "the same requested deliverable, adapted for client use": "同一交付內容的客戶版本",
  "the same requested deliverable, adapted for public use": "同一交付內容的公開版本",
  "the same requested deliverable, adapted for the custom audience": "同一交付內容的自訂受眾版本",
};

export function localizeAudiencePreset(preset: string, locale: Locale): string {
  const normalized = preset.trim().toLowerCase();
  return PRESET_LABELS[locale][normalized] ?? preset.trim();
}

export function localizeAudienceProfileValue(value: string | null | undefined, locale: Locale): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || locale === "en") return normalized;
  return ZH_PROFILE_LABELS[normalized.toLowerCase()] ?? normalized;
}
