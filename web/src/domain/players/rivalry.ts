// You against one player, read from your direct games: how the duel has gone
// so far, who is on a run, where your games tip over (the phase of the
// decisive error and who errs first), how both of you play against each other
// compared with your other games, and how your next game most likely starts.
//
// Counts and scores are shown as facts. Sentences that draw a conclusion pass
// the evidence rules: accuracy changes need MIN_GROUP_GAMES analysed duels and
// a two-sided 95 % test, shares need MIN_SITUATIONS cases and a one-sided 95 %
// bound, opening edges MIN_LINE_GAMES games and a deviation from 50 %.

import { filterGames } from "../metrics/filters";
import { outcomeFor, parseMoves, parseSummary, type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import { meansDiffer, MIN_GROUP_GAMES, MIN_LINE_GAMES, MIN_SITUATIONS, scoreDeviation, shareAtLeast, Z95, Z_ONE } from "../profile/evidence";
import type { PlayerProfile } from "../profile/models";
import { fmt as fmtDot } from "../profile/num";
import { openingLabel, type MoveChoice } from "../profile/openings";
import { Board } from "../tactics/board";
import { classifyGamePhase } from "../tactics/phase";

// German decimal comma: "92,5".
const fmt = (x: number, digits: number) => fmtDot(x, digits).replace(".", ",");

export type Phase = "opening" | "middlegame" | "endgame";
export const PHASE_DE: Record<Phase, string> = { opening: "Eröffnung", middlegame: "Mittelspiel", endgame: "Endspiel" };
const PHASE_IN: Record<Phase, string> = { opening: "in der Eröffnung", middlegame: "im Mittelspiel", endgame: "im Endspiel" };

const SERIOUS = new Set(["Mistake", "Blunder", "Miss"]);
// The decisive error leaves the loser at most this winning chance, and they never get back to even.
const LOST_WP = 0.3;

export interface DuelGame {
  id: string;
  played_at: number | null;
  date: string;
  /** Your colour. */
  color: "white" | "black";
  /** Your points: 1, 0.5 or 0. */
  score: number;
  speed: string;
  opening: string;
  my_acc: number | null;
  their_acc: number | null;
  /** Who made the first serious error (mistake, miss or blunder). */
  first_error: "me" | "them" | null;
  /** The move that decided a decisive game: after it the loser never got back to even. */
  decisive: { phase: Phase; by: "me" | "them"; move: number } | null;
}

export interface DuelInsights {
  /** Oldest first. */
  games: DuelGame[];
  /** Wins minus losses after each game, oldest first. */
  balance: number[];
  /** Current winning run (draws end it), from two wins on. */
  streak: { who: "me" | "them"; count: number } | null;
  analyzed: number;
  accuracy: {
    mine: number | null;
    theirs: number | null;
    /** Accuracy in the other games (same filters). */
    my_usual: number | null;
    their_usual: number | null;
    /** Clearly different from the other games (null: within noise or too few duels). */
    my_change: "better" | "worse" | null;
    their_change: "better" | "worse" | null;
  };
  first_error: { me: number; them: number };
  /** Decisive errors per phase and by whom. */
  decisive: { phase: Phase; me: number; them: number }[];
  /** Conclusions that pass the evidence rules, one German sentence each. */
  facts: string[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const lower = (names: Iterable<string>) => new Set([...names].map((n) => n.toLowerCase()));

function accuracyOf(g: RawGame, color: "white" | "black"): number | null {
  const s = parseSummary(g.summary_json);
  if (s?.analysis_status !== "completed") return null;
  const a = Number((s[color] as Record<string, unknown> | undefined)?.accuracy ?? 0);
  return Number.isFinite(a) && a > 0 ? a : null;
}

function phaseAt(fen: string, ply: number, book: boolean): Phase {
  try {
    const p = String(classifyGamePhase(new Board(fen), ply, book)).toLowerCase();
    return p.includes("end") ? "endgame" : p.includes("open") ? "opening" : "middlegame";
  } catch {
    return "middlegame";
  }
}

function duelGame(g: RawGame, color: "white" | "black"): DuelGame | null {
  const o = outcomeFor(g.result, color);
  if (!o) return null;
  const score = o === "win" ? 1 : o === "draw" ? 0.5 : 0;
  const myAcc = accuracyOf(g, color);
  const theirs: "white" | "black" = color === "white" ? "black" : "white";
  const moves = myAcc === null ? [] : parseMoves(g.moves_json);
  const mover = (i: number): "me" | "them" => ((i % 2 === 0) === (color === "white") ? "me" : "them");
  const firstErr = moves.findIndex((m) => SERIOUS.has(m.classification));
  let decisive: DuelGame["decisive"] = null;
  if (moves.length && score !== 0.5) {
    const loser: "me" | "them" = score === 1 ? "them" : "me";
    const loserIsWhite = (loser === "me") === (color === "white");
    const wpOf = (i: number) => (loserIsWhite ? moves[i].win_chance_after : 1 - moves[i].win_chance_after);
    // Walk back from the end while the loser stays below even.
    let k = moves.length - 1;
    while (k >= 0 && wpOf(k) < 0.5) k--;
    for (let i = k + 1; i < moves.length; i++) {
      if (mover(i) === loser && wpOf(i) <= LOST_WP) {
        const m = moves[i];
        decisive = { phase: phaseAt(m.fen_before, m.ply || i + 1, Boolean(m.is_book_move)), by: loser, move: m.move_number || Math.floor(i / 2) + 1 };
        break;
      }
    }
  }
  return {
    id: String(g.id ?? ""),
    played_at: parsePlayedAt(g),
    date: String(g.date ?? ""),
    color,
    score,
    speed: String(g.speed_category ?? ""),
    opening: String(g.opening ?? ""),
    my_acc: myAcc,
    their_acc: accuracyOf(g, theirs),
    first_error: firstErr < 0 ? null : mover(firstErr),
    decisive,
  };
}

function change(duel: number[], other: number[]): "better" | "worse" | null {
  if (!meansDiffer(duel, other, Z95, MIN_GROUP_GAMES)) return null;
  return (mean(duel) as number) > (mean(other) as number) ? "better" : "worse";
}

/** Everything about your direct games with one player (both name lists may hold several accounts). */
export function duelInsights(games: RawGame[], me: string[], them: string[], name: string, format = "All Formats", date = "All Time"): DuelInsights {
  const theirNames = lower(them);
  const myNames = lower(me);
  const duels: DuelGame[] = [];
  const myOther: number[] = [];
  for (const [g, color] of filterGames(games, me, "All Colors", format, "All Sources", date)) {
    const opp = String((color === "white" ? g.black : g.white) ?? "").toLowerCase();
    if (theirNames.has(opp)) {
      const d = duelGame(g, color);
      if (d) duels.push(d);
    } else {
      const a = accuracyOf(g, color);
      if (a !== null) myOther.push(a);
    }
  }
  const theirOther: number[] = [];
  for (const [g, color] of filterGames(games, them, "All Colors", format, "All Sources", date)) {
    const opp = String((color === "white" ? g.black : g.white) ?? "").toLowerCase();
    if (myNames.has(opp)) continue;
    const a = accuracyOf(g, color);
    if (a !== null) theirOther.push(a);
  }
  duels.sort((a, b) => (a.played_at ?? 0) - (b.played_at ?? 0) || a.date.localeCompare(b.date));

  const balance: number[] = [];
  let run = 0;
  for (const d of duels) {
    run += d.score === 1 ? 1 : d.score === 0 ? -1 : 0;
    balance.push(run);
  }
  let streak: DuelInsights["streak"] = null;
  const last = duels[duels.length - 1];
  if (last && last.score !== 0.5) {
    let count = 0;
    while (count < duels.length && duels[duels.length - 1 - count].score === last.score) count++;
    if (count >= 2) streak = { who: last.score === 1 ? "me" : "them", count };
  }

  const analysed = duels.filter((d) => d.my_acc !== null);
  const mineAcc = analysed.map((d) => d.my_acc as number);
  const theirAcc = analysed.map((d) => d.their_acc).filter((v): v is number => v !== null);
  const accuracy = {
    mine: mean(mineAcc),
    theirs: mean(theirAcc),
    my_usual: mean(myOther),
    their_usual: mean(theirOther),
    my_change: change(mineAcc, myOther),
    their_change: change(theirAcc, theirOther),
  };
  const first_error = {
    me: duels.filter((d) => d.first_error === "me").length,
    them: duels.filter((d) => d.first_error === "them").length,
  };
  const decisive = (["opening", "middlegame", "endgame"] as const).map((phase) => ({
    phase,
    me: duels.filter((d) => d.decisive?.phase === phase && d.decisive.by === "me").length,
    them: duels.filter((d) => d.decisive?.phase === phase && d.decisive.by === "them").length,
  }));

  const facts: string[] = [];
  if (accuracy.my_change && accuracy.mine !== null && accuracy.my_usual !== null) {
    facts.push(`Gegen ${name} spielst du klar ${accuracy.my_change === "better" ? "genauer" : "ungenauer"} als sonst: ${fmt(accuracy.mine, 1)} statt ${fmt(accuracy.my_usual, 1)} % Genauigkeit.`);
  }
  if (accuracy.their_change && accuracy.theirs !== null && accuracy.their_usual !== null) {
    facts.push(`${name} spielt gegen dich klar ${accuracy.their_change === "better" ? "genauer" : "ungenauer"} als sonst: ${fmt(accuracy.theirs, 1)} statt ${fmt(accuracy.their_usual, 1)} %.`);
  }
  const errs = first_error.me + first_error.them;
  if (errs >= MIN_SITUATIONS) {
    if (shareAtLeast(first_error.me, errs, 0.5, Z_ONE) && first_error.me > first_error.them) {
      facts.push(`Den ersten groben Fehler macht meistens du (${first_error.me} von ${errs} Partien). Ruhig bleiben zahlt sich gegen ${name} aus.`);
    } else if (shareAtLeast(first_error.them, errs, 0.5, Z_ONE) && first_error.them > first_error.me) {
      facts.push(`Den ersten groben Fehler macht meistens ${name} (${first_error.them} von ${errs} Partien): Stellungen lange spannend halten lohnt sich.`);
    }
  }
  const lost = decisive.reduce((s, d) => s + d.me, 0);
  if (lost >= MIN_SITUATIONS) {
    const top = [...decisive].sort((a, b) => b.me - a.me)[0];
    // Three phases: a third would be chance.
    if (shareAtLeast(top.me, lost, 1 / 3, Z_ONE)) {
      facts.push(`Deine Niederlagen gegen ${name} kippen meist ${PHASE_IN[top.phase]} (${top.me} von ${lost}).`);
    }
  }
  const won = decisive.reduce((s, d) => s + d.them, 0);
  if (won >= MIN_SITUATIONS) {
    const top = [...decisive].sort((a, b) => b.them - a.them)[0];
    if (shareAtLeast(top.them, won, 1 / 3, Z_ONE)) {
      facts.push(`Deine Siege gegen ${name} entscheiden sich meist ${PHASE_IN[top.phase]} (${top.them} von ${won}).`);
    }
  }
  return { games: duels, balance, streak, analyzed: analysed.length, accuracy, first_error, decisive, facts };
}

// ---------- the likely opening of your next game ----------

export interface PreviewLine {
  first: string;
  reply: string;
  /** How likely your next game with this colour starts like this (0..1). */
  chance: number;
  name: string | null;
  /** Your record in this start (your colour), and theirs (their colour). */
  mine: { games: number; score_pct: number | null } | null;
  theirs: { games: number; score_pct: number | null } | null;
  /** Who the start clearly suits: a score clearly above or below 50 % on either side. */
  edge: "me" | "them" | null;
}

export interface OpeningPreview {
  as_white: PreviewLine[];
  as_black: PreviewLine[];
}

// Shares from fewer games say little about what someone plays.
const MIN_FIRST_GAMES = 5;
const MIN_REPLY_GAMES = 3;
const MIN_CHANCE = 0.05;

function lineName(first: string, reply: string, profiles: PlayerProfile[]): string | null {
  let best: { name: string; games: number } | null = null;
  for (const p of profiles) {
    for (const st of [...(p.openings?.white ?? []), ...(p.openings?.black ?? [])]) {
      if (st.line[0] === first && st.line[1] === reply && (!best || st.games > best.games)) best = { name: st.name, games: st.games };
    }
  }
  return best ? openingLabel(best.name) : null;
}

function edgeOf(mine: PreviewLine["mine"], theirs: PreviewLine["theirs"]): PreviewLine["edge"] {
  const m = mine ? scoreDeviation(mine, 50, Z_ONE, MIN_LINE_GAMES) : 0;
  const t = theirs ? scoreDeviation(theirs, 50, Z_ONE, MIN_LINE_GAMES) : 0;
  const forMe = m > 0 || t < 0;
  const forThem = m < 0 || t > 0;
  return forMe && !forThem ? "me" : forThem && !forMe ? "them" : null;
}

function preview(
  firsts: MoveChoice[],
  replies: (first: string) => MoveChoice[] | undefined,
  mineOf: (first: string, reply: string) => MoveChoice | undefined,
  theirsOf: (first: string, reply: string) => MoveChoice | undefined,
  profiles: PlayerProfile[],
  limit: number,
): PreviewLine[] {
  const total = firsts.reduce((s, f) => s + f.games, 0);
  if (total < MIN_FIRST_GAMES) return [];
  const out: PreviewLine[] = [];
  for (const f of firsts) {
    const rs = replies(f.san) ?? [];
    const n = rs.reduce((s, r) => s + r.games, 0);
    if (n < MIN_REPLY_GAMES) continue;
    for (const r of rs) {
      const chance = (f.games / total) * (r.games / n);
      if (chance < MIN_CHANCE) continue;
      const mine = mineOf(f.san, r.san);
      const theirs = theirsOf(f.san, r.san);
      const m = mine ? { games: mine.games, score_pct: mine.score_pct } : null;
      const t = theirs ? { games: theirs.games, score_pct: theirs.score_pct } : null;
      out.push({ first: f.san, reply: r.san, chance, name: lineName(f.san, r.san, profiles), mine: m, theirs: t, edge: edgeOf(m, t) });
    }
  }
  return out.sort((a, b) => b.chance - a.chance).slice(0, limit);
}

/**
 * The starts your next game most likely has, per colour: your first moves
 * against their answers (you with White) and their first moves against your
 * answers (you with Black), with both records in that start.
 */
export function openingPreview(me: PlayerProfile, them: PlayerProfile, limit = 3): OpeningPreview {
  const mo = me.openings;
  const to = them.openings;
  if (!mo || !to) return { as_white: [], as_black: [] };
  const profiles = [me, them];
  return {
    as_white: preview(
      mo.white_first,
      (f) => to.black_vs.find((v) => v.san === f)?.replies,
      (f, r) => mo.white_vs.find((v) => v.san === f)?.replies.find((x) => x.san === r),
      (f, r) => to.black_vs.find((v) => v.san === f)?.replies.find((x) => x.san === r),
      profiles,
      limit,
    ),
    as_black: preview(
      to.white_first,
      (f) => mo.black_vs.find((v) => v.san === f)?.replies,
      (f, r) => mo.black_vs.find((v) => v.san === f)?.replies.find((x) => x.san === r),
      (f, r) => to.white_vs.find((v) => v.san === f)?.replies.find((x) => x.san === r),
      profiles,
      limit,
    ),
  };
}
