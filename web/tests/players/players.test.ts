import { describe, expect, it } from "vitest";

import {
  buildRanking,
  buildScoutReport,
  frequentOpponents,
  headToHead,
  parsePlayers,
  playerId,
  type RankInput,
} from "../../src/domain/players";
import { buildPlayerProfile, type PlayerProfile } from "../../src/domain/profile";
import type { OpeningInsights } from "../../src/domain/profile/openings";
import type { RawGame } from "../../src/domain/metrics";
import { buildMoves, gameRow, PUNISHED, THROWN_WIN } from "../profile/fixtures";

const pad = (n: number) => String(n).padStart(2, "0");

/** `user` vs `opp`; `wins` games won by `user` (White), then `losses` lost ones. */
function match(user: string, opp: string, wins: number, losses: number, prefix: string): RawGame[] {
  const rows: RawGame[] = [];
  for (let i = 0; i < wins + losses; i++) {
    const won = i < wins;
    const g = gameRow(`${prefix}${i}`, buildMoves(won ? PUNISHED : THROWN_WIN), {
      user,
      result: won ? "1-0" : "0-1",
      utc: `2026.06.${pad(i + 1)} 18:00:00`,
    });
    rows.push({ ...g, black: opp, pgn: String(g.pgn).replace('[Black "Gegner"]', `[Black "${opp}"]`) });
  }
  return rows;
}

const input = (id: string, names: string[], games: RawGame[], isMe = false): RankInput => ({
  id,
  name: id,
  is_me: isMe,
  usernames: names,
  profile: buildPlayerProfile(games, names),
});

describe("tracked players", () => {
  it("keeps route ids unique, never shadows the ranking page and drops broken entries", () => {
    expect(playerId("Max Mustermann!", ["maxmustermann"])).toBe("maxmustermann-2");
    expect(playerId("Rangliste")).toBe("rangliste-2");
    const parsed = parsePlayers([
      { id: "max", accounts: [{ source: "lichess", username: " Max " }], friend: 1, added_at: 5 },
      { id: "leer", accounts: [{ source: "lichess", username: "  " }] },
      "kaputt",
    ]);
    expect(parsed).toEqual([
      { id: "max", name: "Max", accounts: [{ source: "lichess", username: "Max" }], friend: true, added_at: 5, imported_at: null },
    ]);
  });

  it("counts the head-to-head from the first player's side and suggests frequent opponents", () => {
    const games = [...match("Tim", "Max", 3, 1, "a"), ...match("Tim", "Ida", 1, 0, "b"), ...match("Max", "Ida", 2, 0, "c")];
    const h = headToHead(games, ["tim"], ["MAX"]);
    expect([h.games, h.wins, h.draws, h.losses, h.score_pct]).toEqual([4, 3, 0, 1, 75]);
    expect(h.recent[0].played_at).toBeGreaterThan(h.recent[3].played_at as number);
    expect(headToHead(games, ["max"], ["tim"]).score_pct).toBe(25);

    // Ida was met once only; Max already tracked players are left out.
    expect(frequentOpponents(games, ["Tim"]).map((o) => [o.username, o.games, o.score_pct])).toEqual([["Max", 4, 75]]);
    expect(frequentOpponents(games, ["Tim"], ["max"])).toEqual([]);
  });
});

describe("friends ranking", () => {
  const games = [...match("Tim", "Max", 6, 2, "a"), ...match("Ida", "Ole", 1, 5, "b")];

  it("ranks every factor with the better value first and combines the places", () => {
    const ranking = buildRanking(
      [input("ich", ["Tim"], games, true), input("Max", ["Max"], games), input("Ida", ["Ida"], games)],
      games,
      { now: Date.parse("2026-06-20T00:00:00Z") / 1000 },
    );
    const row = (id: string) => ranking.rows.find((r) => r.id === id)!;
    // Tim scored 75 %, Ida 17 %, Max 25 %.
    expect([row("ich").cells.score.rank, row("Max").cells.score.rank, row("Ida").cells.score.rank]).toEqual([1, 2, 3]);
    // Fewer blunders per game is better.
    expect(ranking.factors.find((f) => f.key === "blunders")?.higher_is_better).toBe(false);
    expect(row("ich").cells.blunders.value).toBeLessThan(row("Ida").cells.blunders.value as number);
    expect(row("ich").cells.blunders.rank).toBe(1);
    // Direct encounters only count inside the group: Ida never met Tim or Max.
    expect(row("ich").cells.h2h).toMatchObject({ value: 75, rank: 1, note: "6/8" });
    expect(row("Ida").cells.h2h.value).toBeNull();
    expect(ranking.rows[0].id).toBe("ich");
    expect(ranking.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(row("ich").overall).toBeGreaterThan(row("Ida").overall as number);
    // All games happened within the last 30 days.
    expect(row("ich").cells.activity.value).toBe(8);
  });

  it("lets ties share a place and leaves players without data unranked", () => {
    const same = [...match("A", "X", 2, 2, "a"), ...match("B", "Y", 2, 2, "b")];
    const ranking = buildRanking([input("A", ["A"], same), input("B", ["B"], same), input("C", ["C"], same)], same);
    const score = ranking.rows.map((r) => [r.id, r.cells.score.rank, r.cells.score.points]);
    expect(score).toEqual([
      ["A", 1, 50],
      ["B", 1, 50],
      ["C", null, null],
    ]);
    expect(ranking.rows.find((r) => r.id === "C")?.rank).toBeNull();
  });
});

describe("scouting report", () => {
  const openings = (o: Partial<OpeningInsights>): OpeningInsights => ({
    white: [],
    black: [],
    white_first: [],
    black_vs: [],
    white_vs: [],
    wp_after_opening: null,
    facts: [],
    ...o,
  });

  it("aims for the first move and the answer the player handles worst", () => {
    const base = buildPlayerProfile(match("Max", "Tim", 2, 2, "m"), ["Max"]);
    const them: PlayerProfile = {
      ...base,
      openings: openings({
        black_vs: [
          { san: "e4", games: 10, score_pct: 70, replies: [{ san: "c5", games: 10, score_pct: 70 }] },
          { san: "d4", games: 6, score_pct: 20, replies: [{ san: "d5", games: 6, score_pct: 20 }] },
        ],
        white_first: [{ san: "e4", games: 12, score_pct: 60 }],
        white_vs: [
          {
            san: "e4",
            games: 12,
            score_pct: 60,
            replies: [
              { san: "e5", games: 8, score_pct: 75 },
              { san: "c6", games: 4, score_pct: 25 },
            ],
          },
        ],
      }),
    };
    const me: PlayerProfile = { ...base, openings: openings({ white_first: [{ san: "d4", games: 5, score_pct: 80 }] }) };
    const r = buildScoutReport("Max", them, me, headToHead([], [], []));
    expect(r.as_white[0]).toMatchObject({ title: "1. d4", their_score_pct: 20, my_games: 5, my_score_pct: 80 });
    expect(r.as_white[0].text).toContain("Du selbst holst damit 80 %");
    expect(r.as_black[0]).toMatchObject({ title: "1. e4 c6", their_score_pct: 25 });
    expect(r.plan.map((t) => t.key)).toEqual(expect.arrayContaining(["opening_white", "opening_black"]));
  });

  it("turns weak skills and losses on time into a plan and strong skills into warnings", () => {
    const base = buildPlayerProfile(match("Max", "Tim", 2, 6, "m"), ["Max"]);
    const them: PlayerProfile = {
      ...base,
      openings: openings({}),
      statistics: { ...base.statistics, losses: 6, loss_term_counts: { Checkmate: 1, Resignation: 2, Time: 3, Abandon: 0 } },
      skills: base.skills.map((s) =>
        s.key === "endgame"
          ? { ...s, score: 20, typical: 50, reliable: true }
          : s.key === "tactics"
            ? { ...s, score: 85, typical: 50, reliable: true }
            : { ...s, score: 50, typical: 50, reliable: true },
      ),
    };
    const r = buildScoutReport("Max", them, null, headToHead([], [], []));
    const keys = r.plan.map((t) => t.key);
    expect(keys).toContain("skill_endgame");
    expect(keys).toContain("loses_on_time");
    expect(r.cautions.map((c) => c.key)).toEqual(["strong_tactics"]);
    expect(r.losses[0]).toMatchObject({ key: "Time", label: "Zeit", count: 3, pct: 50 });
    // Advice talks about the player by name, never with a guessed pronoun.
    for (const t of [...r.plan, ...r.cautions]) expect(t.text).not.toMatch(/\b(er|sie|ihn|ihm|ihr)\b/);
  });
});
