// Records of the friends group: the best game, the longest winning run, the
// biggest comeback and other highlights, each with the game it happened in.
// These are facts, not advice, so they need no significance test; a record
// stays with whoever set it first, like a real one.

import { filterGames } from "../metrics/filters";
import { type Outcome, outcomeFor, parseMoves, parseSummary, type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import { fmt as fmtDot } from "../profile/num";

// German decimal comma: "92,5".
const fmt = (x: number, digits: number) => fmtDot(x, digits).replace(".", ",");

export interface RecordMember {
  id: string;
  name: string;
  is_me: boolean;
  usernames: string[];
}

export interface GroupRecord {
  key: string;
  title: string;
  holder: { id: string; name: string; is_me: boolean };
  value: number;
  /** The record in words, e.g. "96,4 %" or "9 Siege in Folge". */
  text: string;
  /** Where and when, e.g. "gegen kev1n · 03.11.2026". */
  detail: string;
  game_id: string | null;
  played_at: number | null;
}

// A win needs this many moves of the player before its accuracy can be a record.
const MIN_RECORD_MOVES = 20;
// Shorter wins are mostly opponents leaving early, not a quick knockout.
const MIN_QUICK_MOVES = 10;
// A comeback starts from at most this winning chance.
const COMEBACK_WP = 0.25;

interface Game {
  g: RawGame;
  color: "white" | "black";
  at: number;
  result: Outcome | null;
  member: RecordMember;
}

const dateDe = (at: number | null) => (at === null ? "" : new Date(at * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }));
const opponent = (x: Game) => String((x.color === "white" ? x.g.black : x.g.white) ?? "?");
const elo = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Best value per member wins; ties go to the earlier game. */
function best<T>(
  rows: { x: Game; v: number; extra?: T }[],
  higher = true,
): { x: Game; v: number; extra?: T } | null {
  let top: { x: Game; v: number; extra?: T } | null = null;
  for (const r of rows) {
    if (!Number.isFinite(r.v)) continue;
    if (!top || (higher ? r.v > top.v : r.v < top.v) || (r.v === top.v && r.x.at < top.x.at)) top = r;
  }
  return top;
}

export function groupRecords(members: RecordMember[], games: RawGame[], format = "All Formats", date = "All Time"): GroupRecord[] {
  const all: Game[] = [];
  for (const m of members) {
    for (const [g, color] of filterGames(games, m.usernames, "All Colors", format, "All Sources", date)) {
      const at = parsePlayedAt(g);
      if (at === null) continue;
      all.push({ g, color, at, result: outcomeFor(g.result, color), member: m });
    }
  }
  all.sort((a, b) => a.at - b.at);
  const out: GroupRecord[] = [];
  const add = (key: string, title: string, top: { x: Game; v: number } | null, text: (v: number) => string, detail: (x: Game) => string) => {
    if (!top) return;
    out.push({
      key,
      title,
      holder: { id: top.x.member.id, name: top.x.member.name, is_me: top.x.member.is_me },
      value: top.v,
      text: text(top.v),
      detail: detail(top.x),
      game_id: top.x.g.id ? String(top.x.g.id) : null,
      played_at: top.x.at,
    });
  };
  const side = (x: Game) => (parseSummary(x.g.summary_json)?.[x.color] ?? null) as Record<string, unknown> | null;
  const analyzed = (x: Game) => parseSummary(x.g.summary_json)?.analysis_status === "completed" && side(x) !== null;
  // White makes the odd plies: 25 plies are 13 moves for White but 12 for Black.
  const ownMoves = (x: Game) => {
    const plies = parseMoves(x.g.moves_json).length;
    return x.color === "white" ? Math.ceil(plies / 2) : Math.floor(plies / 2);
  };
  const vs = (x: Game) => `gegen ${opponent(x)} · ${dateDe(x.at)}`;

  const wins = all.filter((x) => x.result === "win");
  add(
    "best_game",
    "Beste Partie",
    best(wins.filter((x) => analyzed(x) && ownMoves(x) >= MIN_RECORD_MOVES).map((x) => ({ x, v: Number(side(x)?.accuracy ?? 0) }))),
    (v) => `${fmt(v, 1)} %`,
    (x) => `Genauigkeit im Sieg ${vs(x)}`,
  );

  // Brilliant moves add up over all games; the record points at the latest one.
  const brilliant = new Map<string, { n: number; last: Game | null }>();
  for (const x of all) {
    if (!analyzed(x)) continue;
    const n = Number(side(x)?.Brilliant ?? 0) || 0;
    if (!n) continue;
    const e = brilliant.get(x.member.id) ?? { n: 0, last: null };
    e.n += n;
    e.last = x;
    brilliant.set(x.member.id, e);
  }
  const brill = best([...brilliant.values()].filter((e) => e.last).map((e) => ({ x: e.last as Game, v: e.n })));
  add("brilliant", "Brillanz", brill, (v) => `${v} ${v === 1 ? "brillanter Zug" : "brillante Züge"}`, (x) => `zuletzt ${vs(x)}`);

  const runs: { x: Game; v: number }[] = [];
  for (const m of members) {
    let run = 0;
    for (const x of all) {
      if (x.member !== m || x.result === null) continue;
      run = x.result === "win" ? run + 1 : 0;
      if (run >= 2) runs.push({ x, v: run });
    }
  }
  add("streak", "Siegesserie", best(runs), (v) => `${v} Siege in Folge`, (x) => `bis ${dateDe(x.at)}`);

  const comebacks = wins
    .filter(analyzed)
    .map((x) => {
      const moves = parseMoves(x.g.moves_json);
      let low = 1;
      for (const mv of moves) {
        const w = Number(mv.win_chance_after);
        if (!Number.isFinite(w)) continue;
        low = Math.min(low, x.color === "white" ? w : 1 - w);
      }
      return { x, v: low };
    })
    .filter((r) => r.v <= COMEBACK_WP);
  add(
    "comeback",
    "Aufholjagd",
    best(comebacks, false),
    (v) => `aus ${v < 0.01 ? "unter 1" : fmt(v * 100, 0)} % gewonnen`,
    (x) => `Gewinnchance zwischendurch, ${vs(x)}`,
  );

  const quick = wins
    .filter((x) => !["timeout", "abandonment", "timeout_insufficient"].includes(String(x.g.termination_mode ?? "")))
    .map((x) => ({ x, v: ownMoves(x) }))
    .filter((r) => r.v >= MIN_QUICK_MOVES);
  add("quick", "Kurzer Prozess", best(quick, false), (v) => `Sieg in ${v} Zügen`, vs);

  const upsets = wins
    .map((x) => {
      const own = elo(x.color === "white" ? x.g.white_elo : x.g.black_elo);
      const opp = elo(x.color === "white" ? x.g.black_elo : x.g.white_elo);
      return { x, v: own !== null && opp !== null ? opp - own : NaN };
    })
    .filter((r) => r.v > 0);
  add("upset", "Größter Coup", best(upsets), (v) => `${fmt(v, 0)} Elo stärker besiegt`, vs);

  // Longest run of analysed games without a blunder; unanalysed games do not break it.
  const clean: { x: Game; v: number }[] = [];
  for (const m of members) {
    let run = 0;
    for (const x of all) {
      if (x.member !== m || !analyzed(x)) continue;
      run = Number(side(x)?.Blunder ?? 0) > 0 ? 0 : run + 1;
      if (run >= 2) clean.push({ x, v: run });
    }
  }
  add("clean", "Ohne Patzer", best(clean), (v) => `${v} Partien in Folge ohne Patzer`, (x) => `bis ${dateDe(x.at)}`);
  return out;
}
