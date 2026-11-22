import { describe, expect, it } from "vitest";

import { ownChesscomNames, quickImportMessage } from "../../src/domain/quickImport";

const cc = (white: string, black: string, extra: { source?: string; deleted?: boolean } = {}) => ({ white, black, source: "chesscom", ...extra });

describe("ownChesscomNames", () => {
  it("asks every own chess.com account, not only the name typed last", () => {
    const games = [cc("TimB", "x"), cc("y", "timb"), cc("TimAlt", "z"), cc("Lena", "TimB"), cc("TimLi", "q", { source: "lichess" })];
    // The import dialog last held the friend Lena: "Neueste holen" used to ask only her account.
    expect(ownChesscomNames(games, ["TimB", "TimAlt", "TimLi", "Lena"], "Lena", ["lena"])).toEqual(["TimB", "TimAlt"]);
  });

  it("keeps a freshly typed own name without stored games and ignores tombstones", () => {
    const games = [cc("TimB", "x"), cc("Gone", "y", { deleted: true })];
    expect(ownChesscomNames(games, ["TimB", "Gone", "NewAcc"], " NewAcc ")).toEqual(["TimB", "NewAcc"]);
    expect(ownChesscomNames(games, ["TimB"], "timb")).toEqual(["TimB"]);
  });

  it("is empty when nothing points to a chess.com account, so the dialog opens", () => {
    expect(ownChesscomNames([cc("Lena", "x")], ["Lena"], "Lena", ["Lena"])).toEqual([]);
    expect(ownChesscomNames([], [], undefined)).toEqual([]);
  });
});

describe("quickImportMessage", () => {
  const base = { names: ["TimB"], queued: 0, failed: [] as string[] };

  it("names every account asked and what came back", () => {
    expect(quickImportMessage({ ...base, names: ["TimB", "TimAlt"], queued: 2, result: { imported: 3, already_known: 40, skipped: [] } })).toBe(
      "3 neue Partien von TimB und TimAlt geholt, 2 werden jetzt analysiert.",
    );
    expect(quickImportMessage({ ...base, result: { imported: 0, already_known: 12, skipped: [{}] } })).toBe(
      "Keine neuen Partien von TimB auf chess.com. Alle 12 Partien der letzten zwei Monate sind schon da. 1 Partie (Chess960 oder Varianten) kann die App nicht analysieren.",
    );
  });

  it("never claims completeness when a month or an account failed", () => {
    const text = quickImportMessage({ ...base, names: ["TimB", "Tipo"], failed: ["Auf chess.com gibt es keinen Spieler „Tipo“."], result: { imported: 0, already_known: 5, skipped: [], failed_months: 1 } });
    expect(text).not.toContain("schon da");
    expect(text).toContain("Ein Monat konnte nicht geladen werden");
    expect(text).toContain("keinen Spieler „Tipo“");
  });
});
