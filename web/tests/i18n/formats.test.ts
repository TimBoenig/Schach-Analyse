// Dates and axis labels follow the page language, not just the texts.
import { afterEach, describe, expect, it } from "vitest";

import { dayMonthLabel, monthYearLabel, setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";
import { formatDate } from "../../src/ui/labels";

afterEach(() => setLangNow("de"));

describe("date formats", () => {
  it("writes dates the German or the English way", () => {
    expect(formatDate("2026.11.22")).toBe("22.11.2026");
    expect(dayMonthLabel(new Date(2026, 10, 2))).toBe("02.11.");
    expect(monthYearLabel(new Date(2026, 10, 2))).toBe("11.26");
    setLangNow("en", EN);
    expect(formatDate("2026.11.22")).toBe("Nov 22, 2026");
    expect(dayMonthLabel(new Date(2026, 10, 2))).toBe("11/02");
    expect(monthYearLabel(new Date(2026, 10, 2))).toBe("11/26");
  });
});
