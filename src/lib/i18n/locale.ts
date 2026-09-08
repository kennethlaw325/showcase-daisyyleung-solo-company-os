/** Supported private portal and AI content locales. */
export type Locale = "en" | "zh-Hant";

export const LOCALES = ["zh-Hant", "en"] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = "zh-Hant";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-Hant";
}

export function parseLocale(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  return isLocale(value) ? value : fallback;
}

/**
 * Every structured AI request carries this instruction. Keeping it in one
 * small helper makes it difficult for a new generation path to accidentally
 * omit the user's verified language preference.
 */
export function localePromptInstruction(locale: Locale): string {
  return locale === "zh-Hant"
    ? "Write every structured text field in Traditional Chinese using natural Hong Kong-appropriate wording. Do not mix in English unless it is a proper noun, URL, email address, product name, or exact source quotation."
    : "Write every structured text field in clear English. Do not switch to another language unless it is a proper noun, URL, email address, product name, or exact source quotation.";
}

export function localeDisplayName(locale: Locale): string {
  return locale === "zh-Hant" ? "繁中" : "EN";
}
