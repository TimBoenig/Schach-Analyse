// Markdown export for AI chats: structure, perspective, per-game evidence and size limits.
import { describe, expect, it } from "vitest";

import { AI_EXPORT_LIMITS, annotatedMovetext, buildAiExport } from "../../src/domain/aiExport";
import { rangeFilter } from "../../src/domain/metrics";
import type { StoredGame } from "../../src/domain/types";
import { buildMoves, gameRow, profileGames, THROWN_WIN } from "../profile/fixtures";

const NOW = Date.UTC(2026, 6, 1);
const games = profileGames(4, 4) as unknown as StoredGame[];

function build(extra: Partial<Parameters<typeof buildAiExport>[0]> = {}) {
  return buildAiExport({ games, usernames: ["Tim"], dateFilter: "All Time", settings: [], today: "2026-07-01", now: NOW, ...extra });
}

describe("buildAiExport", () => {
  it("starts with the task and legend, then the profile, then per-game evidence", () => {
    const { text, games: n, analyzed } = build();
    expect([n, analyzed]).toEqual([8, 8]);
    const order = ["## 1. Auftrag an die KI", "## 2. Legende", "## 3. Überblick", "## 13. Eröffnungen", "## 16. Partienliste", "## 17. Kritische Momente", "## 18. Partien mit Engine-Kommentaren"];
    const at = order.map((h) => text.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain("Spieler: **Tim**");
  });

  it("numbers games newest first and reuses the number in every section", () => {
    const { text } = build();
    // June games (clean wins) are newer than the May losses.
    expect(text).toMatch(/\| P001 \| 2026\.06\.04 \|/);
    expect(text).toMatch(/\| P008 \| 2026\.05\.01 \|/);
    expect(text).toMatch(/### P005 · 2026\.05\.04 .* Niederlage/);
  });

  it("explains a thrown win from the player's view with the better move and the position", () => {
    const { text } = build();
    const block = text.slice(text.indexOf("### P005"), text.indexOf("### P006"));
    // Ply 16 is White's 9th move: the player's winning chance drops 85 % → 25 %.
    expect(block).toMatch(/\*\*9\. d5\?\?\*\* Patzer in der Eröffnung: GC 85 % → 25 % \(Bewertung \+4\.2 → -3\.0\)/);
    expect(block).toContain("Besser:");
    expect(block).toMatch(/Stellung vor dem Zug: `[^`]+ w /);
  });

  it("gives Black's winning chance from Black's view", () => {
    // Black blunders at ply 15: White's winning chance rises to 85 %, Black's falls to 15 %.
    const black = [gameRow("b1", buildMoves({ 15: ["Blunder", 0.85] }), { userWhite: false, result: "1-0" })] as unknown as StoredGame[];
    const { text } = build({ games: black });
    // Black's own blunder at ply 16 (9. d5 is White's): use a Black error instead.
    expect(text).toMatch(/\*\*8\.\.\. Bxc3\?\?\*\* Patzer .*GC 50 % → 15 %/);
  });

  it("keeps the per-game sections inside the detail limits", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      gameRow(`g${i}`, buildMoves(THROWN_WIN), { result: "0-1", utc: `2026.04.${String(i + 1).padStart(2, "0")} 18:00:00` }),
    ) as unknown as StoredGame[];
    const lim = AI_EXPORT_LIMITS.compact;
    const { text } = build({ games: many, detail: "compact" });
    const list = text.slice(text.indexOf("## 16."), text.indexOf("## 17."));
    expect(list.match(/^\| P\d+ /gm)).toHaveLength(20);
    const moments = text.slice(text.indexOf("## 17."), text.indexOf("## 18."));
    expect(moments.match(/^### P/gm)).toHaveLength(lim.moments);
    expect(text.slice(text.indexOf("## 18.")).match(/^### P/gm)).toHaveLength(lim.annotated);
    expect(build({ games: many }).text.length).toBeGreaterThan(text.length);
  });

  it("limits the games to the period and says when nothing is there", () => {
    const june = build({ dateFilter: rangeFilter(Date.UTC(2026, 5, 1) / 1000, NOW / 1000) });
    expect(june.games).toBe(4);
    expect(june.text).toContain("(2026-06-01 bis 2026-07-01)");
    const none = build({ usernames: ["Niemand"] });
    expect(none.games).toBe(0);
    expect(none.text).toContain("Keine eigenen Partien");
  });
});

describe("annotatedMovetext", () => {
  it("writes White-perspective scores after every move and verdicts with NAGs", () => {
    const text = annotatedMovetext(buildMoves(THROWN_WIN), "white");
    expect(text.startsWith("1. e4 {0.0} 1... e5 {0.0} 2. Nf3")).toBe(true);
    expect(text).toMatch(/8\.\.\. Bxc3\?\? \{\+4\.2; Patzer \(Gegner\), GC 50 → 85 %, besser \S+\}/);
    expect(text).toMatch(/9\. d5\?\? \{-3\.0; Patzer \(eigener Zug\), GC 85 → 25 %, besser \S+\}/);
  });
});
