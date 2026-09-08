export const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

export type GreetingPeriod = "morning" | "afternoon" | "evening";

const hongKongHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: HONG_KONG_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

const hongKongTime = new Intl.DateTimeFormat("en-HK", {
  timeZone: HONG_KONG_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const hongKongDate = new Intl.DateTimeFormat("en-HK", {
  timeZone: HONG_KONG_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const hongKongDateTime = {
  en: new Intl.DateTimeFormat("en-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }),
  "zh-Hant": new Intl.DateTimeFormat("zh-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }),
} as const;

function validDate(value: Date | string | null | undefined): Date | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function formatHongKongTime(date = new Date()): string {
  const parsed = validDate(date);
  return parsed ? hongKongTime.format(parsed) : "";
}

export function formatHongKongDate(date = new Date()): string {
  const parsed = validDate(date);
  return parsed ? hongKongDate.format(parsed) : "";
}

/**
 * Format an instant for people in Hong Kong while keeping invalid input
 * content-free. Callers can use the original value as a semantic `<time>`
 * dateTime only after checking that this formatter returned a non-empty value.
 */
export function formatHongKongDateTime(value: Date | string | null | undefined, locale: "en" | "zh-Hant" = "en"): string {
  const parsed = validDate(value);
  return parsed ? hongKongDateTime[locale].format(parsed) : "";
}

export function isValidDateTime(value: Date | string | null | undefined): boolean {
  return validDate(value) !== null;
}

/** Morning is 05:00–11:59, afternoon is 12:00–17:59, and all other hours are evening. */
export function getHongKongGreetingPeriod(date = new Date()): GreetingPeriod {
  const hour = Number(hongKongHour.format(date));
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}
