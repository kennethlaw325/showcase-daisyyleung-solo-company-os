import { describe, expect, it } from "vitest";
import { formatHongKongDate, formatHongKongDateTime, formatHongKongTime } from "../src/lib/i18n/hong-kong-time";

describe("Hong Kong date and time formatting", () => {
  it("converts UTC instants to the Hong Kong local date and time", () => {
    const instant = new Date("2026-01-01T20:00:00Z");

    expect(formatHongKongTime(instant)).toBe("04:00");
    expect(formatHongKongDate(instant)).toBe("02/01/2026");
    expect(formatHongKongDateTime(instant)).toBe("02/01/2026, 04:00");
  });

  it("returns an empty value for invalid dates", () => {
    expect(formatHongKongDateTime("not-a-date")).toBe("");
    expect(formatHongKongDate(new Date("invalid"))).toBe("");
    expect(formatHongKongTime(new Date("invalid"))).toBe("");
  });
});
