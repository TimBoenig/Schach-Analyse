import { describe, expect, it } from "vitest";

import {
  buildMatchup,
  buildRanking,
  buildScoutReport,
  frequentOpponents,
  headToHead,
  orderPlayers,
  parsePlayers,
  playerId,
  rankedFriends,
  type RankInput,
  type TrackedPlayer,
} from "../../src/domain/players";
import { buildOpeningInsights, buildPlayerProfile, type PlayerProfile } from "../../src/domain/profile";
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
      { id: "max", name: "Max", accounts: [{ source: "lichess", username: "Max" }], friend: true, hidden: false, added_at: 5, imported_at: null },
    ]);
  });

  it("keeps hidden friends out of the ranking and lists them last, friends before opponents", () => {
    const p = (id: string, friend: boolean, hidden: boolean): TrackedPlayer =>
      parsePlayers([{ id, accounts: [{ source: "lichess", username: id }], friend, hidden }])[0];
    const players = [p("ida", false, false), p("max", true, true), p("lena", true, false), p("ole", true, false)];
    expect(players.map((x) => x.hidden)).toEqual([false, true, false, false]);
    expect(rankedFriends(players).map((x) => x.id)).toEqual(["lena", "ole"]);

    const games: Record<string, number> = { ida: 50, max: 40, lena: 3, ole: 12 };
    const { shown, hidden } = orderPlayers(players.map((player) => ({ player, games: games[player.id] })));
    // Friends first even with fewer games; the opponent with most games trails them.
    expect(shown.map((c) => c.player.id)).toEqual(["ole", "lena", "ida"]);
    expect(hidden.map((c) => c.player.id)).toEqual(["max"]);
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
    tree: buildOpeningInsights([]).tree,
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
          { san: "d4", games: 12, score_pct: 20, replies: [{ san: "d5", games: 12, score_pct: 20 }] },
          // Three lost games prove nothing: no recommendation.
          { san: "c4", games: 3, score_pct: 0, replies: [{ san: "e5", games: 3, score_pct: 0 }] },
        ],
        white_first: [{ san: "e4", games: 12, score_pct: 60 }],
        white_vs: [
          {
            san: "e4",
            games: 12,
            score_pct: 60,
            replies: [
              { san: "e5", games: 8, score_pct: 75 },
              { san: "c6", games: 14, score_pct: 20 },
              { san: "d5", games: 2, score_pct: 0 },
            ],
          },
        ],
      }),
    };
    const me: PlayerProfile = { ...base, openings: openings({ white_first: [{ san: "d4", games: 10, score_pct: 80 }] }) };
    const r = buildScoutReport("Max", them, me, headToHead([], [], []));
    expect(r.as_white[0]).toMatchObject({ title: "1. d4", their_score_pct: 20, my_games: 10, my_score_pct: 80 });
    expect(r.as_white.map((p) => p.title)).not.toContain("1. c4");
    expect(r.as_black.map((p) => p.title)).not.toContain("1. e4 d5");
    expect(r.as_white[0].text).toContain("Du selbst holst damit 80 %");
    expect(r.as_black[0]).toMatchObject({ title: "1. e4 c6", their_score_pct: 20 });
    expect(r.plan.map((t) => t.key)).toEqual(expect.arrayContaining(["opening_white", "opening_black"]));
  });

  it("turns weak skills and losses on time into a plan and strong skills into warnings", () => {
    const base = buildPlayerProfile(match("Max", "Tim", 2, 6, "m"), ["Max"]);
    const them: PlayerProfile = {
      ...base,
      openings: openings({}),
      statistics: { ...base.statistics, losses: 12, loss_term_counts: { Checkmate: 2, Resignation: 4, Time: 6, Abandon: 0 } },
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
    expect(r.losses[0]).toMatchObject({ key: "Time", label: "Zeit", count: 6, pct: 50 });
    // The same share of time losses from a handful of games is no plan yet.
    const few = { ...them, statistics: { ...them.statistics, losses: 4, loss_term_counts: { Checkmate: 1, Resignation: 1, Time: 2, Abandon: 0 } } };
    expect(buildScoutReport("Max", few, null, headToHead([], [], [])).plan.map((t) => t.key)).not.toContain("loses_on_time");
    // Advice talks about the player by name, never with a guessed pronoun.
    for (const t of [...r.plan, ...r.cautions]) expect(t.text).not.toMatch(/\b(er|sie|ihn|ihm|ihr)\b/);
  });
});

describe("fair comparison", () => {
  const games = [...match("A", "X", 4, 4, "a"), ...match("B", "Y", 4, 4, "b"), ...match("C", "Z", 4, 4, "c")].map((g) =>
    String(g.id).startsWith("c") ? { ...g, source: "lichess" } : g,
  );
  const withAcc = (inp: RankInput, acc: number): RankInput => ({
    ...inp,
    profile: { ...inp.profile, analyzed_games: 30, overview: { ...inp.profile.overview, avg_accuracy: acc, accuracy_sd: 8 } },
  });

  it("gives near-equal values near-equal points and keeps ratings to one platform", () => {
    const ranking = buildRanking(
      [withAcc(input("A", ["A"], games), 80), withAcc(input("B", ["B"], games), 80.2), withAcc(input("C", ["C"], games), 70)],
      games,
    );
    const acc = (id: string) => ranking.rows.find((r) => r.id === id)!.cells.accuracy;
    // B is ahead by 0,2 points: still first, but that is nearly a coin flip, not 100 against 50 points.
    expect(acc("B").rank).toBe(1);
    expect(Math.abs((acc("A").points as number) - (acc("B").points as number))).toBeLessThan(10);
    expect(acc("C").points).toBeLessThan(5);
    // C plays on Lichess, A and B on Chess.com: C's rating is left out instead of compared.
    const rating = (id: string) => ranking.rows.find((r) => r.id === id)!.cells.rating;
    expect([rating("A").value, rating("C").value]).toEqual([1500, null]);
    expect(ranking.notes.join(" ")).toContain("nicht vergleichbar");
  });

  it("lists the rating for orientation only and keeps it out of the overall score and the skills", () => {
    const rated = (inp: RankInput, elo: number): RankInput => ({ ...inp, profile: { ...inp.profile, overview: { ...inp.profile.overview, ratings: { Schnellschach: elo } } } });
    const same = [...match("A", "X", 4, 4, "a"), ...match("B", "Y", 4, 4, "b")];
    const run = (eloA: number) => buildRanking([rated(withAcc(input("A", ["A"], same), 80), eloA), rated(withAcc(input("B", ["B"], same), 80), 1500)], same);
    const low = run(900);
    const high = run(2400);
    const row = (r: typeof low, id: string) => r.rows.find((x) => x.id === id)!;
    // The rating cell still ranks, but 1500 points of rating gap move nothing overall.
    expect(row(high, "A").cells.rating.points).toBeGreaterThan(99);
    expect(row(high, "A").overall).toBeCloseTo(row(low, "A").overall as number, 6);

    // Same moves, different rating-typical prior: the comparison judges both alike.
    const base = buildPlayerProfile(match("Tim", "Max", 4, 4, "t"), ["Tim"]);
    const skill = (typical: number): PlayerProfile => ({
      ...base,
      analyzed_games: 30,
      // Profile score = 0.75 * raw 60 + 0.25 * typical (margin 15 -> prior share (15/30)² = 0.25).
      skills: base.skills.map((s) => (s.key === "endgame" ? { ...s, raw_score: 60, score: 0.75 * 60 + 0.25 * typical, typical, margin: 15, sample: 200, reliable: true } : s)),
    });
    const m = buildMatchup(skill(70), skill(30), headToHead([], [], []), true).rows.find((r) => r.key === "endgame")!;
    expect(m.me).toBeCloseTo(m.them as number, 6);
    expect(m.p_me).toBeCloseTo(0.5, 6);
  });

  it("forecasts the duel from the players' own play and the direct games, never from the rating", () => {
    const base = buildPlayerProfile(match("Tim", "Max", 4, 4, "t"), ["Tim"]);
    const rated = (rapid: number, skills: Record<string, [number, number]>): PlayerProfile => ({
      ...base,
      overview: { ...base.overview, ratings: { Schnellschach: rapid } },
      skills: base.skills.map((s) => (skills[s.key] ? { ...s, score: skills[s.key][0], margin: skills[s.key][1], sample: 200, reliable: true } : s)),
    });
    const me = rated(1200, { endgame: [78, 6], tactics: [50, 6] });
    const them = rated(1900, { endgame: [45, 6], tactics: [52, 25] });
    const none = headToHead([], [], []);
    const solo = buildMatchup(me, them, none, true);
    const p0 = solo.prediction!;
    // 700 points of rating gap (a fresh account) are shown, but the better endgame decides: above 50 %.
    expect(p0.elo).toMatchObject({ me: 1200, them: 1900, from: "Wertung" });
    expect(p0.elo_pct).toBeLessThan(2);
    expect(p0.pct).toBeGreaterThan(50);
    expect(p0.pct).toBeCloseTo(p0.quality_pct as number, 6);
    expect(buildMatchup(rated(2400, { endgame: [78, 6], tactics: [50, 6] }), them, none, true).prediction!.pct).toBeCloseTo(p0.pct, 6);
    expect(p0.basis).toContain("Wertung zählt nicht");
    // The rating row is listed but never counts as a lead.
    const ratingRow = solo.rows.find((r) => r.key === "rating")!;
    expect(ratingRow.edge).toBe("even");
    expect(solo.ahead + solo.behind + solo.even).toBe(solo.rows.filter((r) => r.p_me !== null).length - 1);
    // Six lost direct games pull the forecast down; the comparison counts like six games.
    const lost = { ...none, games: 6, losses: 6, score_pct: 0 };
    const p = buildMatchup(me, them, lost, true).prediction!;
    expect(p.pct).toBeCloseTo(((p0.quality_pct as number) * 6) / 12, 6);
    expect(p.low).toBeLessThan(p.pct);
    expect(p.high).toBeGreaterThan(p.pct);
    expect(p.basis).toContain("6 direkten Partien");
    const endgame = solo.rows.find((r) => r.key === "endgame")!;
    expect(endgame).toMatchObject({ edge: "me", sure: true });
    // A 2-point gap with a ±25 margin on one side decides nothing.
    expect(solo.rows.find((r) => r.key === "tactics")).toMatchObject({ edge: "even" });
  });
});

describe("scouting against the player's own level", () => {
  const base = buildPlayerProfile(match("Max", "Tim", 2, 6, "m"), ["Max"]);
  const withLine = (overall: number, line: number): PlayerProfile => ({
    ...base,
    total_games: 60,
    overview: { ...base.overview, score_pct: overall },
    openings: {
      white: [],
      black: [],
      white_first: [],
      white_vs: [],
      black_vs: [{ san: "e4", games: 20, score_pct: line, replies: [] }],
      wp_after_opening: null,
      tree: buildOpeningInsights([]).tree,
      facts: [],
    },
  });

  it("flags a line that is weak for this player, not just below 50 %", () => {
    const strong = buildScoutReport("Max", withLine(70, 45), null, headToHead([], [], []));
    expect(strong.plan.map((t) => t.key)).toContain("opening_white");
    expect(strong.as_white[0].text).toContain("Sonst holt Max");
    // 40 % in the line of a player who scores 40 % everywhere is no weak spot.
    expect(buildScoutReport("Max", withLine(40, 40), null, headToHead([], [], [])).as_white).toEqual([]);
  });

  it("steers into skills where you are clearly better and warns where the player is", () => {
    const set = (p: PlayerProfile, v: Record<string, number>): PlayerProfile => ({
      ...p,
      skills: p.skills.map((s) => ({ ...s, score: v[s.key] ?? 50, typical: v[s.key] ?? 50, margin: 6, sample: 200, reliable: true })),
    });
    const them = set(base, { endgame: 50, tactics: 72 });
    const me = set(buildPlayerProfile(match("Tim", "Max", 6, 2, "t"), ["Tim"]), { endgame: 75, tactics: 50 });
    const r = buildScoutReport("Max", them, me, headToHead([], [], []));
    const edge = r.plan.find((t) => t.key === "edge_endgame");
    expect(edge?.text).toContain("du 75, Max 50");
    expect(r.cautions.find((c) => c.key === "strong_tactics")?.text).toContain("klar stärker als du");
    for (const t of [...r.plan, ...r.cautions]) expect(t.text).not.toMatch(/\b(er|sie|ihn|ihm|ihr)\b/);
  });
});
