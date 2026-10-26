// Scouting report: how to beat a particular player. Built from that player's
// own profile (their games seen from their side) and, where it helps, the
// user's profile, so recommendations combine "where they score badly" with
// "what you play well".
//
// Opening advice needs no engine analysis (results and first moves only);
// tactical and strategic advice comes from the analyzed games' skills and
// error map and is skipped while too little is analyzed.

import { trSpeed } from "../i18n";
import type { PlayerProfile, SkillScore } from "../profile/models";
import { openingLabel, type FirstMoveStat, type MoveChoice, type OpeningStat } from "../profile/openings";
import { fmt } from "../profile/num";
import type { HeadToHead } from "./h2h";

export type TipKind = "Eröffnung" | "Taktik" | "Strategie" | "Zeit" | "Psychologie";

export interface ScoutTip {
  key: string;
  kind: TipKind;
  title: string;
  text: string;
  /** How strongly the data backs the tip (for sorting). */
  weight: number;
}

export interface OpeningPick {
  key: string;
  /** e.g. "1. e4" or "Französische Verteidigung". */
  title: string;
  text: string;
  /** Games of the scouted player in this line. */
  games: number;
  their_score_pct: number | null;
  /** The user's own record in it (null when the user never played it). */
  my_games: number;
  my_score_pct: number | null;
  value: number;
}

export interface SkillCompare {
  key: string;
  name: string;
  them: number;
  me: number | null;
  reliable: boolean;
}

export interface ScoutReport {
  name: string;
  games: number;
  analyzed: number;
  /** Strongest advice first. */
  plan: ScoutTip[];
  /** What to avoid: the player's clear strengths. */
  cautions: ScoutTip[];
  /** Openings to aim for with White (the scouted player has Black). */
  as_white: OpeningPick[];
  /** Answers to choose with Black (the scouted player has White). */
  as_black: OpeningPick[];
  /** What the player opens with as White. */
  their_first_moves: MoveChoice[];
  /** How the player answers first moves as Black. */
  their_replies: FirstMoveStat[];
  /** How the player's losses ended. */
  losses: { key: string; label: string; count: number; pct: number }[];
  skills: SkillCompare[];
  h2h: HeadToHead;
}

// Lines with fewer games say nothing about a player.
export const MIN_LINE_GAMES = 2;
// Pseudo-games at 50 % mixed into each line's score so a 1:0 does not read as 100 %.
const PRIOR_GAMES = 2;
const MAX_PICKS = 4;
const MAX_TIPS = 6;

const shrunk = (pct: number | null, n: number) => (pct === null ? 50 : (pct * n + 50 * PRIOR_GAMES) / (n + PRIOR_GAMES));
const p0 = (v: number) => `${fmt(v, 0)} %`;
const games = (n: number) => `${n} ${n === 1 ? "Partie" : "Partien"}`;

const LOSS_LABELS: Record<string, string> = {
  Checkmate: "Matt",
  Resignation: "Aufgabe",
  Time: "Zeit",
  Abandon: "Abbruch",
};

// Dative forms for "mit dem Springer" etc.; labels come from the error map.
const WITH_PIECE: Record<string, string> = {
  Bauer: "dem Bauern",
  Springer: "dem Springer",
  Läufer: "dem Läufer",
  Turm: "dem Turm",
  Dame: "der Dame",
  König: "dem König",
};

const PIECE_DE: Record<string, string> = {
  pawn: "Bauern",
  knight: "Springer",
  bishop: "Läufer",
  rook: "Türme",
  queen: "Damen",
};

/** How far a skill sits below/above the yardstick (typical for the rating, else 50). */
function gap(s: SkillScore): number {
  return s.score - (s.typical ?? 50);
}

type TipText = (name: string, s: SkillScore, p: PlayerProfile) => { title: string; text: string; kind: TipKind };

const EXPLOIT: Record<string, TipText> = {
  opening: (n, s) => ({
    kind: "Eröffnung",
    title: "Früh Fragen stellen",
    text: `${n} verliert schon in der Eröffnung an Boden (${s.detail}). Spiel aktive, prinzipielle Eröffnungen und stell früh konkrete Drohungen, statt ruhig aufzubauen.`,
  }),
  middlegame: (n, s) => ({
    kind: "Strategie",
    title: "Komplexes Mittelspiel suchen",
    text: `Im Mittelspiel unterlaufen ${n} die meisten Fehler (${s.detail}). Halte Figuren auf dem Brett und vermeide frühe Abtausche.`,
  }),
  endgame: (n, s) => ({
    kind: "Strategie",
    title: "Ins Endspiel abwickeln",
    text: `Im Endspiel spielt ${n} schwach (${s.detail}). Bei ausgeglichener Stellung abtauschen, vor allem die Damen, und das Endspiel lange weiterspielen.`,
  }),
  tactics: (n, s) => ({
    kind: "Taktik",
    title: "Komplikationen riskieren",
    text: `${n} bestraft gegnerische Fehler selten (${s.detail}). Scharfe Stellungen und Angriffe lohnen sich, auch wenn sie nicht ganz korrekt sind.`,
  }),
  safety: (n, s, p) => {
    const by = (p.statistics.hanging_stats?.by_piece ?? {}) as Record<string, number>;
    const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    const piece = top && top[1] > 0 ? ` Am häufigsten hängen ${PIECE_DE[top[0]] ?? top[0]}.` : "";
    return {
      kind: "Taktik",
      title: "Doppelangriffe und Drohungen",
      text: `${n} lässt oft Figuren ungedeckt (${s.detail}).${piece} Prüfe nach jedem Zug, was ungedeckt steht, und suche Gabeln, Spieße und Abzugsangriffe.`,
    };
  },
  conversion: (n, s) => ({
    kind: "Psychologie",
    title: "Nie früh aufgeben",
    text: `Gewonnene Stellungen bringt ${n} oft nicht nach Hause (${s.detail}). Bleib in schlechteren Stellungen zäh und stell weiter Probleme, die Partie kippt häufig noch.`,
  }),
  defense: (n, s) => ({
    kind: "Strategie",
    title: "Im Vorteil weiter drücken",
    text: `In schlechteren Stellungen bricht ${n} schnell ein (${s.detail}). Sobald du besser stehst: weiter angreifen und Druck halten, statt nur abzusichern.`,
  }),
  time: (n, s) => ({
    kind: "Zeit",
    title: "Über die Uhr gewinnen",
    text: `${n} hat Probleme mit der Bedenkzeit (${s.detail}). Spiel zügig, hol dir einen Zeitvorsprung und stell in der Zeitnot einfache, aber unangenehme Fragen.`,
  }),
};

const CAUTION: Record<string, (name: string, s: SkillScore) => string> = {
  opening: (n) => `${n} kennt sich in der Eröffnung gut aus. Weiche mit einer Nebenvariante früh von der Theorie ab.`,
  middlegame: (n) => `${n} spielt das Mittelspiel stark. Vereinfache, wenn du gleich stehst, statt das Mittelspiel lange zu halten.`,
  endgame: (n) => `${n} ist im Endspiel stark. Such die Entscheidung im Mittelspiel und tausch nicht ohne Not ab.`,
  tactics: (n) => `${n} ist taktisch stark und bestraft Fehler. Halte deine Figuren gedeckt und meide unnötig offene Stellungen.`,
  safety: (n) => `${n} stellt kaum etwas ein. Billige Fallen bringen hier wenig, setz auf langfristigen Druck.`,
  conversion: (n) => `${n} verwertet Vorteile sicher. Gerate früh nicht in Nachteil, Aufholjagden sind schwer.`,
  defense: (n) => `${n} verteidigt sich zäh. Verwerte einen Vorteil geduldig und sauber statt hektisch.`,
  time: (n) => `${n} teilt die Bedenkzeit gut ein. Hoffe nicht auf Zeitnot, sondern spiel auf die Stellung.`,
};

function skillTips(name: string, p: PlayerProfile): { plan: ScoutTip[]; cautions: ScoutTip[] } {
  const plan: ScoutTip[] = [];
  const cautions: ScoutTip[] = [];
  for (const s of p.skills) {
    if (!s.reliable || s.grade === "Keine Uhrdaten") continue;
    const g = gap(s);
    if ((g <= -8 || s.score < 35) && EXPLOIT[s.key]) {
      plan.push({ key: `skill_${s.key}`, ...EXPLOIT[s.key](name, s, p), weight: Math.max(-g, 35 - s.score, 8) });
    } else if ((g >= 8 || s.score >= 70) && CAUTION[s.key]) {
      cautions.push({ key: `strong_${s.key}`, kind: "Strategie", title: s.name, text: CAUTION[s.key](name, s), weight: Math.max(g, s.score - 70, 8) });
    }
  }
  return { plan, cautions };
}

/** Tips that need no engine: losses on time, colour and time-control gaps, tilt, error timing. */
function resultTips(name: string, p: PlayerProfile): ScoutTip[] {
  const tips: ScoutTip[] = [];
  const st = p.statistics;
  const losses = Number(st.losses ?? 0);
  const onTime = Number(st.loss_term_counts?.Time ?? 0);
  if (losses >= 4 && onTime / losses >= 0.25 && !p.skills.some((s) => s.key === "time" && s.reliable && gap(s) <= -8)) {
    tips.push({
      key: "loses_on_time",
      kind: "Zeit",
      title: "Über die Uhr gewinnen",
      text: `${name} verliert ${p0((onTime / losses) * 100)} der Niederlagen auf Zeit (${onTime} von ${losses}). Spiel zügig und halte die Stellung kompliziert, wenn die Uhr knapp wird.`,
      weight: (onTime / losses) * 40,
    });
  }

  type Row = { label: string; games: number; score_pct: number };
  const colors = (p.breakdowns.color ?? []) as Row[];
  if (colors.length === 2 && colors.every((c) => c.games >= 5)) {
    const [w, b] = colors;
    const d = w.score_pct - b.score_pct;
    if (Math.abs(d) >= 12) {
      const [weak, strong] = d > 0 ? [b, w] : [w, b];
      tips.push({
        key: "color_gap",
        kind: "Strategie",
        title: `Mit ${weak.label} verwundbar`,
        text: `Mit ${weak.label} holt ${name} nur ${p0(weak.score_pct)}, mit ${strong.label} ${p0(strong.score_pct)}. Hat ${name} ${weak.label}, spiel auf Gewinn, hat ${name} ${strong.label}, reicht oft ein solides Remis.`,
        weight: Math.abs(d) / 2,
      });
    }
  }

  const speeds = ((p.breakdowns.speed ?? []) as Row[]).filter((r) => r.games >= 5);
  if (speeds.length >= 2) {
    const sorted = [...speeds].sort((a, b) => a.score_pct - b.score_pct);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    if (hi.score_pct - lo.score_pct >= 12) {
      tips.push({
        key: "speed_gap",
        kind: "Zeit",
        title: `${lo.label} ist die Schwachstelle`,
        text: `In ${lo.label} holt ${name} nur ${p0(lo.score_pct)}, in ${hi.label} ${p0(hi.score_pct)}. Fordere ${name} am besten in ${lo.label} heraus.`,
        weight: (hi.score_pct - lo.score_pct) / 2,
      });
    }
  }

  const d = p.deep;
  if (d) {
    const overall = d.precision.overall.score_pct;
    const afterLoss = d.after_result.find((b) => b.key === "loss");
    if (afterLoss && afterLoss.games >= 4 && afterLoss.score_pct !== null && overall !== null && overall - afterLoss.score_pct >= 12) {
      tips.push({
        key: "tilt",
        kind: "Psychologie",
        title: "Revanche sofort spielen",
        text: `Nach einer Niederlage holt ${name} nur ${p0(afterLoss.score_pct)} statt ${p0(overall)}. Eine direkte Revanche nach einem Sieg lohnt sich.`,
        weight: (overall - afterLoss.score_pct) / 2,
      });
    }
    const buckets = d.by_move_number.filter((b) => b.moves >= 30 && b.per100 !== null);
    const totalMoves = buckets.reduce((s, b) => s + b.moves, 0);
    const avgRate = totalMoves ? (buckets.reduce((s, b) => s + b.errors, 0) / totalMoves) * 100 : 0;
    const peak = [...buckets].sort((a, b) => (b.per100 as number) - (a.per100 as number))[0];
    if (peak && avgRate > 0 && (peak.per100 as number) >= avgRate * 1.4) {
      tips.push({
        key: "error_window",
        kind: "Strategie",
        title: `Kritische Phase: Zug ${peak.label}`,
        text: `Zwischen Zug ${peak.label} macht ${name} die meisten schweren Fehler (${fmt(peak.per100 as number, 1)} pro 100 Züge, sonst ${fmt(avgRate, 1)}). Halte die Stellung bis dahin spannend und rechne in dieser Phase besonders genau.`,
        weight: ((peak.per100 as number) / avgRate - 1) * 15,
      });
    }
    const pieces = d.by_piece.filter((b) => b.moves >= 30 && b.per100 !== null);
    const worstPiece = [...pieces].sort((a, b) => (b.per100 as number) - (a.per100 as number))[0];
    const pieceAvg = pieces.length ? pieces.reduce((s, b) => s + (b.per100 as number), 0) / pieces.length : 0;
    if (worstPiece && pieceAvg > 0 && (worstPiece.per100 as number) >= pieceAvg * 1.5) {
      const withPiece = WITH_PIECE[worstPiece.label] ?? worstPiece.label;
      tips.push({
        key: "error_piece",
        kind: "Taktik",
        title: `Schwachpunkt: Züge mit ${withPiece}`,
        text: `Mit ${withPiece} unterlaufen ${name} deutlich mehr Fehler (${fmt(worstPiece.per100 as number, 1)} pro 100 Züge) als mit anderen Figuren. Stellungen, in denen diese Figur viel ziehen muss, sind unangenehm für ${name}.`,
        weight: ((worstPiece.per100 as number) / pieceAvg - 1) * 10,
      });
    }
  }
  return tips;
}

function myLine(me: PlayerProfile | null, color: "white" | "black", name: string): OpeningStat | undefined {
  return me?.openings?.[color].find((l) => l.name === name);
}

function mine(stat: { games: number; score_pct: number | null } | undefined): string {
  return stat && stat.games >= MIN_LINE_GAMES && stat.score_pct !== null ? ` Du selbst holst damit ${p0(stat.score_pct)} (${games(stat.games)}).` : "";
}

function value(theirPct: number | null, n: number, my?: { games: number; score_pct: number | null }): number {
  const base = 50 - shrunk(theirPct, n);
  const own = my && my.games >= MIN_LINE_GAMES ? 0.4 * (shrunk(my.score_pct, my.games) - 50) : 0;
  return base + own;
}

const reply = (moveNo: string, san: string) => `${moveNo} ${san}`;

/** With White against the player: first moves and openings where the player scores badly with Black. */
function whitePicks(name: string, them: PlayerProfile, me: PlayerProfile | null): OpeningPick[] {
  const o = them.openings;
  if (!o) return [];
  const picks: OpeningPick[] = [];
  for (const v of o.black_vs) {
    if (v.games < MIN_LINE_GAMES || v.score_pct === null) continue;
    const my = me?.openings?.white_first.find((m) => m.san === v.san);
    const usual = v.replies[0];
    picks.push({
      key: `w1_${v.san}`,
      title: `1. ${v.san}`,
      text:
        `Gegen 1. ${v.san} holt ${name} mit Schwarz ${p0(v.score_pct)} (${games(v.games)})` +
        (usual ? ` und antwortet meist ${reply("1…", usual.san)}.` : ".") +
        mine(my),
      games: v.games,
      their_score_pct: v.score_pct,
      my_games: my?.games ?? 0,
      my_score_pct: my?.score_pct ?? null,
      value: value(v.score_pct, v.games, my),
    });
  }
  for (const l of o.black) picks.push(linePick(name, l, myLine(me, "white", l.name), "Schwarz"));
  return rank(picks);
}

/** With Black against the player: answers to the player's first moves where the player scores badly with White. */
function blackPicks(name: string, them: PlayerProfile, me: PlayerProfile | null): OpeningPick[] {
  const o = them.openings;
  if (!o) return [];
  const picks: OpeningPick[] = [];
  const total = o.white_first.reduce((s, m) => s + m.games, 0);
  for (const first of o.white_vs) {
    const mineVs = me?.openings?.black_vs.find((m) => m.san === first.san);
    for (const r of first.replies) {
      if (r.games < MIN_LINE_GAMES || r.score_pct === null) continue;
      const my = mineVs?.replies.find((x) => x.san === r.san);
      const only = r.score_pct <= 45 ? "nur " : "";
      picks.push({
        key: `b1_${first.san}_${r.san}`,
        title: `1. ${first.san} ${r.san}`,
        text: `Auf 1. ${first.san} mit ${reply("1…", r.san)} antworten: dagegen holt ${name} ${only}${p0(r.score_pct)} (${games(r.games)}).${mine(my)}`,
        games: r.games,
        their_score_pct: r.score_pct,
        my_games: my?.games ?? 0,
        my_score_pct: my?.score_pct ?? null,
        // Answers to a move the player rarely plays are worth less.
        value: value(r.score_pct, r.games, my) * (total ? 0.5 + first.games / total / 2 : 1),
      });
    }
  }
  for (const l of o.white) picks.push(linePick(name, l, myLine(me, "black", l.name), "Weiß"));
  return rank(picks);
}

function linePick(name: string, l: OpeningStat, my: OpeningStat | undefined, colorDe: string): OpeningPick {
  const extra: string[] = [];
  if (l.first_error_move !== null && l.analyzed >= MIN_LINE_GAMES) extra.push(`der erste schwere Fehler kommt im Schnitt in Zug ${fmt(l.first_error_move, 0)}`);
  if (l.wp_after_opening !== null && l.analyzed >= MIN_LINE_GAMES && l.wp_after_opening <= 45) {
    extra.push(`nach der Eröffnung steht ${name} meist schlechter (${p0(l.wp_after_opening)} Gewinnchance)`);
  }
  return {
    key: `line_${l.color}_${l.name}`,
    title: openingLabel(l.name),
    text:
      `Mit ${colorDe} in dieser Eröffnung holt ${name} ${p0(l.score_pct ?? 0)} (${games(l.games)})` +
      (extra.length ? `; ${extra.join(", ")}.` : ".") +
      mine(my),
    games: l.games,
    their_score_pct: l.score_pct,
    my_games: my?.games ?? 0,
    my_score_pct: my?.score_pct ?? null,
    value: value(l.score_pct, l.games, my),
  };
}

function rank(picks: OpeningPick[]): OpeningPick[] {
  return picks
    .filter((p) => p.games >= MIN_LINE_GAMES)
    .sort((a, b) => b.value - a.value || b.games - a.games)
    .slice(0, MAX_PICKS);
}

function openingTip(side: "white" | "black", picks: OpeningPick[]): ScoutTip | null {
  const best = picks[0];
  // Only a line where the player clearly underperforms is worth steering into.
  if (!best || best.value < 5) return null;
  return {
    key: `opening_${side}`,
    kind: "Eröffnung",
    title: side === "white" ? `Mit Weiß: ${best.title}` : `Mit Schwarz: ${best.title}`,
    text: best.text,
    weight: best.value,
  };
}

export function buildScoutReport(name: string, them: PlayerProfile, me: PlayerProfile | null, h2h: HeadToHead): ScoutReport {
  const as_white = whitePicks(name, them, me);
  const as_black = blackPicks(name, them, me);
  const { plan, cautions } = skillTips(name, them);
  plan.push(...resultTips(name, them));
  for (const t of [openingTip("white", as_white), openingTip("black", as_black)]) if (t) plan.push(t);
  plan.sort((a, b) => b.weight - a.weight);
  cautions.sort((a, b) => b.weight - a.weight);

  const lossCounts = (them.statistics.loss_term_counts ?? {}) as Record<string, number>;
  const lossTotal = Object.values(lossCounts).reduce((s, v) => s + v, 0);
  const losses = Object.entries(lossCounts)
    .filter(([, c]) => c > 0)
    .map(([key, count]) => ({ key, label: LOSS_LABELS[key] ?? key, count, pct: lossTotal ? (count / lossTotal) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  const skills: SkillCompare[] = them.skills
    .filter((s) => s.sample > 0 && s.grade !== "Keine Uhrdaten")
    .map((s) => {
      const m = me?.skills.find((x) => x.key === s.key);
      return { key: s.key, name: s.name, them: s.score, me: m && m.sample > 0 && m.grade !== "Keine Uhrdaten" ? m.score : null, reliable: s.reliable };
    });

  return {
    name,
    games: them.total_games,
    analyzed: them.analyzed_games,
    plan: plan.slice(0, MAX_TIPS),
    cautions: cautions.slice(0, 3),
    as_white,
    as_black,
    their_first_moves: them.openings?.white_first ?? [],
    their_replies: them.openings?.black_vs ?? [],
    losses,
    skills,
    h2h,
  };
}

/** Short German summary of a player's main rating, e.g. "Blitz 1480". */
export function ratingLabel(p: PlayerProfile): string {
  return p.rating ? `${trSpeed(p.rating.speed)} ${p.rating.rating}` : "";
}
