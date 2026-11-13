import { describe, expect, it } from "vitest";

import {
  archetypes,
  buildRanking,
  climbPlan,
  LARGE_EFFORT,
  probBetter,
  qualityMap,
  RANK_FACTORS,
  type RankInput,
  type Ranking,
  type RankRow,
  ranksOf,
  rescore,
  simulateTournament,
  TOURNAMENT_RUNS,
} from "../../src/domain/players";
import type { RawGame } from "../../src/domain/metrics";
import { buildPlayerProfile } from "../../src/domain/profile";
import { buildMoves, gameRow, PUNISHED, THROWN_WIN } from "../profile/fixtures";

type Cells = Record<string, [number, number]>;

/** A ranking whose points and overall scores follow the ranking's rules from the given estimates. */
function league(players: { id: string; me?: boolean; cells: Cells }[]): Ranking {
  const rows: RankRow[] = players.map((p) => ({
    id: p.id,
    name: p.id,
    is_me: Boolean(p.me),
    rank: null,
    overall: null,
    games: 60,
    analyzed: 40,
    source: "lichess",
    breakdown: [],
    missing: [],
    cells: {},
  }));
  for (const f of RANK_FACTORS) {
    const est = players.map((p) => (p.cells[f.key] ? { value: p.cells[f.key][0], se: p.cells[f.key][1] } : null));
    const n = est.filter(Boolean).length;
    est.forEach((a, i) => {
      let points: number | null = null;
      if (a && n >= 2) {
        let sum = 0;
        est.forEach((b, j) => {
          if (b && j !== i) sum += probBetter(a, b, f.higher_is_better);
        });
        points = (sum / (n - 1)) * 100;
      }
      rows[i].cells[f.key] = { value: a?.value ?? null, se: a?.se ?? null, rank: null, points, note: "" };
    });
  }
  for (const r of rows) {
    let w = 0;
    let s = 0;
    for (const f of RANK_FACTORS) {
      const pts = r.cells[f.key].points;
      if (f.weight > 0 && pts !== null) {
        w += f.weight;
        s += f.weight * pts;
      }
    }
    r.overall = w >= 30 ? s / w : null;
  }
  const ranks = ranksOf(new Map(rows.map((r) => [r.id, r.overall])));
  rows.forEach((r) => (r.rank = ranks.get(r.id) ?? null));
  rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return { factors: RANK_FACTORS, period: "All Time", rows, rating_speed: "Blitz", speed_effects: {}, notes: [] };
}

// Strongest to weakest by play, while the ratings run the other way.
const GROUP = [
  { id: "Lena", cells: { expectation: [12, 2], accuracy: [88, 0.6], blunders: [0.4, 0.05], rating: [1300, 60] } as Cells },
  { id: "Tim", me: true, cells: { expectation: [4, 2], accuracy: [84, 0.6], blunders: [0.6, 0.05], rating: [1500, 60] } as Cells },
  { id: "Max", cells: { expectation: [0, 2], accuracy: [82, 0.6], blunders: [0.7, 0.05], rating: [1700, 60] } as Cells },
  { id: "Ida", cells: { expectation: [-6, 2], accuracy: [79, 0.6], blunders: [0.9, 0.05], rating: [1900, 60] } as Cells },
];

describe("tournament", () => {
  it("plays every pairing from the players' own play, the same way every time, and never from the rating", () => {
    const t = simulateTournament(league(GROUP), () => null)!;
    expect(t.rows.map((r) => r.id)).toEqual(["Lena", "Tim", "Max", "Ida"]);
    expect(t).toMatchObject({ rounds: 2, games_each: 6, runs: TOURNAMENT_RUNS });
    expect(t.rows.reduce((s, r) => s + r.win, 0)).toBeCloseTo(1, 9);
    // Six pairings, two games each: twelve points are handed out.
    expect(t.rows.reduce((s, r) => s + r.expected, 0)).toBeCloseTo(12, 9);
    expect(t.rows.every((r) => r.podium >= r.win && r.podium <= 1)).toBe(true);
    // Without direct games the draw share is the typical one.
    expect(t.draw_rate).toBeCloseTo(0.08, 9);
    expect(simulateTournament(league(GROUP), () => null)).toEqual(t);
    // Turning the ratings upside down changes nothing.
    const flipped = GROUP.map((p, i) => ({ ...p, cells: { ...p.cells, rating: [1900 - i * 200, 60] as [number, number] } }));
    expect(simulateTournament(league(flipped), () => null)!.rows).toEqual(t.rows);
  });

  it("lets the direct games count and needs three ranked players", () => {
    const base = simulateTournament(league(GROUP), () => null)!;
    // Ida has beaten Lena 20 times in a row.
    const h2h = (a: string, b: string) => (a === "Lena" && b === "Ida" ? { games: 20, wins: 0, draws: 0 } : null);
    const t = simulateTournament(league(GROUP), h2h)!;
    const win = (x: typeof t, id: string) => x.rows.find((r) => r.id === id)!.win;
    expect(win(t, "Ida")).toBeGreaterThan(win(base, "Ida"));
    expect(win(t, "Lena")).toBeLessThan(win(base, "Lena"));
    expect(t.draw_rate).toBeCloseTo((0.08 * 30) / 50, 9);
    expect(simulateTournament(league(GROUP.slice(0, 2)), () => null)).toBeNull();
  });
});

describe("player types", () => {
  const row = (id: string, points: Record<string, number>, overall: number | null = 50): RankRow => ({
    id,
    name: id,
    is_me: false,
    rank: null,
    overall,
    games: 50,
    analyzed: 30,
    source: "lichess",
    breakdown: [],
    missing: [],
    cells: Object.fromEntries(Object.entries(points).map(([k, p]) => [k, { value: 1, se: 1, rank: null, points: p, note: "" }])),
  });
  const all = (p: number) => Object.fromEntries(["expectation", "accuracy", "blunders", "opening", "middlegame", "tactics", "endgame", "conversion", "defense", "safety", "time", "h2h"].map((k) => [k, p]));

  it("names the area a player stands out in, the clearly weakest one, and stays generic without either", () => {
    const types = archetypes({
      factors: RANK_FACTORS,
      period: "All Time",
      rating_speed: null,
      speed_effects: {},
      notes: [],
      rows: [
        row("Ana", { ...all(55), endgame: 90, conversion: 80, defense: 70, opening: 20 }),
        row("Ben", all(55)),
        row("Cem", all(30)),
        row("Dan", all(80), null),
      ],
    });
    expect(types.Ana).toEqual({ title: "Endspiel-Ass", area: "endgame", points: 80, weak: "Eröffnung" });
    expect(types.Ben).toMatchObject({ title: "Allrounder", area: null, weak: null });
    expect(types.Cem).toMatchObject({ title: "Herausforderer", area: null, weak: null });
    expect(types.Dan.title).toBe("Neu dabei");
  });

  it("gives every title to one player only: the strongest claim wins, the others move to their next standout area", () => {
    const types = archetypes({
      factors: RANK_FACTORS,
      period: "All Time",
      rating_speed: null,
      speed_effects: {},
      notes: [],
      rows: [
        row("Ana", { ...all(55), endgame: 90, conversion: 80, defense: 70 }),
        // Also best at the endgame, but less so: precision is the next standout.
        row("Eva", { ...all(55), endgame: 78, conversion: 78, defense: 78, accuracy: 70 }),
        // Only the endgame stands out and it is taken.
        row("Fil", { ...all(55), endgame: 66, conversion: 66, defense: 66 }),
      ],
    });
    expect(types.Ana).toMatchObject({ title: "Endspiel-Ass", area: "endgame" });
    expect(types.Eva).toMatchObject({ title: "Präzisionsmaschine", area: "precision", points: 70 });
    expect(types.Fil).toMatchObject({ title: "Allrounder", area: null, points: 66 });
  });
});

describe("climbing a place", () => {
  // Activity is equal, so only real play separates them.
  const close = league([
    { id: "Lena", cells: { expectation: [6, 2], accuracy: [85, 0.8], blunders: [0.55, 0.06], activity: [10, 0], rating: [1500, 60] } },
    { id: "Tim", me: true, cells: { expectation: [5, 2], accuracy: [84.5, 0.8], blunders: [0.6, 0.06], activity: [10, 0], rating: [2000, 60] } },
    { id: "Max", cells: { expectation: [0, 2], accuracy: [80, 0.8], blunders: [0.8, 0.06], activity: [10, 0], rating: [1200, 60] } },
  ]);
  // Lena is far ahead and plays much more.
  const far = league([
    { id: "Lena", cells: { expectation: [10, 2], accuracy: [86, 0.8], blunders: [0.5, 0.06], activity: [30, 0] } },
    { id: "Tim", me: true, cells: { expectation: [5, 2], accuracy: [84, 0.8], blunders: [0.6, 0.06], activity: [5, 0] } },
    { id: "Max", cells: { expectation: [0, 2], accuracy: [80, 0.8], blunders: [0.8, 0.06], activity: [10, 0] } },
  ]);
  // Between the two: one change would do, but only as a big step.
  const mid = league([
    { id: "Lena", cells: { expectation: [8, 2], accuracy: [85.5, 0.8], blunders: [0.55, 0.06], activity: [10, 0] } },
    { id: "Tim", me: true, cells: { expectation: [5, 2], accuracy: [84.5, 0.8], blunders: [0.6, 0.06], activity: [10, 0] } },
    { id: "Max", cells: { expectation: [0, 2], accuracy: [80, 0.8], blunders: [0.8, 0.06], activity: [10, 0] } },
  ]);
  const passes = (r: Ranking, changes: Record<string, number>) => {
    const m = rescore(r, "Tim", changes)!;
    return m.get("Tim")! > m.get("Lena")!;
  };

  it("finds the smallest single change that passes the player above, easiest first, never the rating", () => {
    const plan = climbPlan(close, "Tim")!;
    const lena = close.rows.find((x) => x.id === "Lena")!.overall as number;
    expect(plan).toMatchObject({ rank: 2, target: { id: "Lena", rank: 1 }, chaser: { id: "Max" }, combo: null });
    expect(plan.gap).toBeCloseTo(lena - (plan.overall as number), 9);
    // Fewer blunders alone cannot close this gap: their points are nearly used up.
    expect(plan.levers.map((l) => l.key).sort()).toEqual(["accuracy", "expectation"]);
    expect(plan.levers.map((l) => l.effort)).toEqual([...plan.levers.map((l) => l.effort)].sort((a, b) => a - b));
    for (const l of plan.levers) {
      expect(passes(close, { [l.key]: l.to })).toBe(true);
      expect(passes(close, { [l.key]: l.from + l.delta * 0.97 })).toBe(false);
    }
    // Max is too far behind to pass Tim with any one change: the place is safe.
    expect(plan.chaser!.lever).toBeNull();
    const top = climbPlan(close, "Lena")!;
    expect([top.target, top.levers, top.combo, top.gap]).toEqual([null, [], null, 0]);
    expect(climbPlan(close, "Niemand")).toBeNull();
  });

  it("combines accuracy, blunders and results when no single change is enough", () => {
    const plan = climbPlan(far, "Tim")!;
    expect(plan.levers).toEqual([]);
    const combo = plan.combo!;
    expect(combo.map((l) => l.key)).toEqual(["accuracy", "blunders", "expectation"]);
    expect(combo.find((l) => l.key === "blunders")!.delta).toBeLessThan(0);
    const apply = (scale: number) => Object.fromEntries(combo.map((l) => [l.key, l.from + l.delta * scale]));
    expect(passes(far, apply(1))).toBe(true);
    expect(passes(far, apply(0.97))).toBe(false);
  });

  it("offers the combination next to a single big step when it keeps every part doable", () => {
    const plan = climbPlan(mid, "Tim")!;
    expect(plan.levers.map((l) => l.key)).toEqual(["expectation"]);
    expect(plan.levers[0].effort).toBeGreaterThan(LARGE_EFFORT);
    const combo = plan.combo!;
    expect(Math.max(...combo.map((l) => l.effort))).toBeLessThanOrEqual(LARGE_EFFORT);
    expect(passes(mid, Object.fromEntries(combo.map((l) => [l.key, l.to])))).toBe(true);
  });

  it("compares ratings on the platform the shown rating comes from", () => {
    // Kai plays most games on Lichess (Rapid, unrated here) but his Blitz rating
    // is from Chess.com, the platform of the others: it must be compared.
    const pad = (n: number) => String(n).padStart(2, "0");
    const rows = (user: string, n: number, speed: string, source: string, elo: string | null, prefix: string): RawGame[] =>
      Array.from({ length: n }, (_, i) => ({
        ...gameRow(`${prefix}${i}`, buildMoves(PUNISHED), { user, utc: `2026.06.${pad(i + 1)} 18:00:00` }),
        speed_category: speed,
        source,
        white_elo: elo,
        black_elo: elo,
      }));
    const games = [
      ...rows("Kai", 20, "Rapid", "lichess", null, "k1"),
      ...rows("Kai", 8, "Blitz", "chesscom", "1400", "k2"),
      ...rows("Max", 12, "Blitz", "chesscom", "1600", "m"),
      ...rows("Ida", 12, "Blitz", "chesscom", "1500", "i"),
    ];
    const input = (id: string): RankInput => ({ id, name: id, is_me: id === "Kai", usernames: [id], profile: buildPlayerProfile(games, [id]) });
    const ranking = buildRanking([input("Kai"), input("Max"), input("Ida")], games, { now: Date.parse("2026-06-25T00:00:00Z") / 1000 });
    const kai = ranking.rows.find((r) => r.id === "Kai")!;
    expect(kai.source).toBe("lichess");
    expect(kai.cells.rating).toMatchObject({ value: 1400, rank: 3 });
    expect(ranking.notes.some((n) => n.includes("nicht vergleichbar"))).toBe(false);
  });

  it("re-scores exactly like the ranking and keeps the rating out of it", () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const match = (user: string, opp: string, wins: number, losses: number, prefix: string): RawGame[] =>
      Array.from({ length: wins + losses }, (_, i) => {
        const won = i < wins;
        const g = gameRow(`${prefix}${i}`, buildMoves(won ? PUNISHED : THROWN_WIN), { user, result: won ? "1-0" : "0-1", utc: `2026.06.${pad(i + 1)} 18:00:00` });
        return { ...g, black: opp, pgn: String(g.pgn).replace('[Black "Gegner"]', `[Black "${opp}"]`) };
      });
    const games = [...match("Tim", "Max", 6, 2, "a"), ...match("Ida", "Max", 1, 5, "b")];
    const input = (id: string, names: string[], isMe = false): RankInput => ({ id, name: id, is_me: isMe, usernames: names, profile: buildPlayerProfile(games, names) });
    const ranking = buildRanking([input("ich", ["Tim"], true), input("Max", ["Max"]), input("Ida", ["Ida"])], games, { now: Date.parse("2026-06-20T00:00:00Z") / 1000 });
    const tim = ranking.rows.find((x) => x.id === "ich")!;
    const same = rescore(ranking, "ich", { h2h: tim.cells.h2h.value as number })!;
    for (const x of ranking.rows) expect(same.get(x.id)).toBeCloseTo(x.overall as number, 9);
    // A rating of 3000 moves nobody.
    const rated = rescore(ranking, "ich", { rating: 3000 });
    if (rated) for (const x of ranking.rows) expect(rated.get(x.id)).toBeCloseTo(x.overall as number, 9);
    // Losing every direct game costs Tim points and gives them to Max, his opponent.
    const worse = rescore(ranking, "ich", { h2h: 0 })!;
    expect(worse.get("ich")!).toBeLessThan(tim.overall as number);
    expect(worse.get("Max")!).toBeGreaterThan(ranking.rows.find((x) => x.id === "Max")!.overall as number);
    // Skills need ten analysed games: Ida has none to change.
    expect(rescore(ranking, "Ida", { endgame: 90 })).toBeNull();
  });
});

describe("play quality against results", () => {
  it("names a corner only beyond the noise and a finding only beyond a one-sided 95 % bar", () => {
    const q = qualityMap(
      league([
        { id: "Ole", cells: { accuracy: [78, 0.5], expectation: [15, 2] } },
        { id: "Pia", cells: { accuracy: [88, 0.5], expectation: [-12, 2] } },
        { id: "Mia", cells: { accuracy: [83, 0.5], expectation: [1, 2] } },
        { id: "Tim", me: true, cells: { accuracy: [83.2, 3], expectation: [0, 9] } },
        { id: "Neu", cells: { accuracy: [80, 1] } },
      ]),
    )!;
    const at = (id: string) => q.points.find((p) => p.id === id)!;
    expect([at("Ole").quadrant, at("Pia").quadrant, at("Mia").quadrant, at("Tim").quadrant]).toEqual(["fighter", "unlucky", null, null]);
    expect(q.findings.map((f) => [f.id, f.kind])).toEqual([
      ["Ole", "fighter"],
      ["Pia", "unlucky"],
    ]);
    expect(q.findings[0].text).toMatch(/^Ole holt klar mehr Punkte/);
    expect(q.missing).toEqual(["Neu"]);
    expect(q.x_mean).toBeCloseTo((78 + 88 + 83 + 83.2) / 4, 9);
    expect(qualityMap(league(GROUP.slice(0, 2)))).toBeNull();
  });
});
