// Guards the single German→English dictionary: every text the code passes to
// t()/tj()/tr() has an English entry, no entry is left over, placeholders and
// line breaks match, and no German text reaches the page without t().
import { describe, expect, it } from "vitest";

import { browserLang, setLangNow, t, tj, tr, tStored } from "../../src/i18n";
import { EN } from "../../src/i18n/en";
import { scan } from "./scan";

const result = scan();
const placeholders = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort().join();
// Keys made only of placeholders ("{a}{b}") read the same in both languages.
const needsEntry = (s: string) => /\p{L}/u.test(s.replace(/\{[A-Za-z0-9_]+\}/g, ""));

describe("dictionary", () => {
  it("has an English entry for every text passed to t()", () => {
    const missing = [...new Set(result.keys.filter((k) => needsEntry(k.text) && !(k.text in EN)).map((k) => `${k.file}:${k.line} ${JSON.stringify(k.text)}`))];
    expect(missing).toEqual([]);
  });

  it("has no unused entries", () => {
    const used = new Set(result.keys.map((k) => k.text));
    const shape = (s: string) => s.replace(/\{[A-Za-z0-9_]+\}/g, "{}");
    // Texts stored in German (classifier, endings) are matched back by tStored, so a literal or template counts as use.
    const shapes = new Set([...result.literals].map(shape));
    const unused = Object.keys(EN).filter((k) => !used.has(k) && !result.literals.has(k) && !shapes.has(shape(k)));
    expect(unused).toEqual([]);
  });

  it("keeps placeholders, line breaks and edge spaces", () => {
    const bad = Object.entries(EN).filter(
      ([de, en]) =>
        placeholders(de) !== placeholders(en) ||
        (de.match(/\n/g) ?? []).length !== (en.match(/\n/g) ?? []).length ||
        /^\s/.test(de) !== /^\s/.test(en) ||
        /\s$/.test(de) !== /\s$/.test(en),
    );
    expect(bad).toEqual([]);
  });

  it("finds no German text outside t()", () => {
    // Words that read the same in both languages and names in the imprint.
    const allowed = /LegalView\.tsx/;
    const hits = result.german.filter((g) => !allowed.test(g.file)).map((g) => `${g.file}:${g.line} ${JSON.stringify(g.text)}`);
    expect(hits).toEqual([]);
  });
});

describe("language", () => {
  it("picks German or English from the browser, English otherwise", () => {
    expect(browserLang(["de-AT", "en"])).toBe("de");
    expect(browserLang(["fr-FR", "en-GB", "de"])).toBe("en");
    expect(browserLang(["fr", "es"])).toBe("en");
    expect(browserLang([])).toBe("en");
  });

  it("translates whole sentences, inline parts and stored German texts", () => {
    setLangNow("en", EN);
    try {
      expect(t("{n} Punkte", { n: 3 })).toBe("3 points");
      expect(tr("de", "{n} Punkte", { n: 3 })).toBe("3 Punkte");
      // A left-out part (`cond && t(...)`) leaves no "false" behind.
      expect(t("{n} importiert{n2}.{n3}{failedMonthsNote}", { n: "2", n2: "", n3: false, failedMonthsNote: "" })).toBe("2 imported.");
      const bold = { bold: true };
      expect(tj("{x} Sie läuft auch offline weiter, wenn die Partien einmal geladen sind.", { x: bold })).toEqual([bold, " It keeps working offline once the games are loaded."]);
      expect(tStored("Eröffnungstheorie.")).toBe("Opening theory.");
    } finally {
      setLangNow("de");
    }
    expect(t("{n} Punkte", { n: 3 })).toBe("3 Punkte");
  });
});
