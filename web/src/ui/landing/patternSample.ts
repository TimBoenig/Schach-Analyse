// The example behind "Viele Partien zeigen dein Muster" on the landing page: an
// invented player whose costly moves fall mostly in the endgame. The page counts
// the games up, and the pattern is only named once enough games back it, as
// everywhere in the app. Plainly marked as an example on the page: nothing here
// belongs to a real person. There is deliberately no one-game view: a single
// game proves nothing, and a sample that small would look like broken data.

import { t } from "../../i18n";

export type Phase = "opening" | "middlegame" | "endgame";

export interface SampleGame {
  result: "win" | "draw" | "loss";
  /** Phases of the costly moves in this game. */
  mistakes: { phase: Phase; motif: string }[];
}

export const PHASE_LABEL: Record<Phase, string> = { opening: t("Eröffnung"), middlegame: t("Mittelspiel"), endgame: t("Endspiel") };
export const PHASES: Phase[] = ["opening", "middlegame", "endgame"];

/** How many games the example player has. */
export const SAMPLE_SIZE = 150;

// Same rule as everywhere in the app: a pattern needs enough games behind it.
export const MIN_GAMES = 20;
export const MIN_REPEATS = 5;

const MOTIFS: Record<Phase, string[]> = {
  opening: [t("Gambit falsch angenommen"), t("Rochade zu spät")],
  middlegame: [t("Gabel übersehen"), t("Figur hängen gelassen"), t("Grundreihe offen")],
  endgame: [t("Turmendspiel nicht gehalten"), t("Turmendspiel nicht gehalten"), t("König zu passiv")],
};

/** Deterministic, so the page shows the same example on every visit and in tests. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function build(): SampleGame[] {
  const next = rng(7);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const games: SampleGame[] = [];
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const count = next() < 0.25 ? 0 : next() < 0.6 ? 1 : 2;
    const mistakes = Array.from({ length: count }, () => {
      const r = next();
      const phase: Phase = r < 0.18 ? "opening" : r < 0.48 ? "middlegame" : "endgame";
      return { phase, motif: pick(MOTIFS[phase]) };
    });
    const r = next();
    const result = count === 0 ? (r < 0.8 ? "win" : "draw") : r < 0.45 ? "loss" : r < 0.6 ? "draw" : "win";
    games.push({ result, mistakes });
  }
  return games;
}

export const SAMPLE_GAMES: SampleGame[] = build();

export interface SampleReading {
  games: SampleGame[];
  /** Share of all costly moves per phase, 0..1. */
  share: Record<Phase, number>;
  /** The most frequent motif, only once enough games back it. */
  pattern: { motif: string; games: number } | null;
  /** The three most frequent motifs with the number of games they appear in; empty below the evidence floor. */
  motifs: { motif: string; games: number }[];
  /** All costly moves in these games. */
  costly: number;
}

/** What the newest `n` games of the example player say. */
export function readSample(n: number): SampleReading {
  const games = SAMPLE_GAMES.slice(0, Math.max(1, n));
  const counts: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  const motifs = new Map<string, number>();
  for (const g of games) {
    for (const m of g.mistakes) counts[m.phase] += 1;
    // A motif counts once per game: "in how many games" is what a player can act on.
    for (const motif of new Set(g.mistakes.map((m) => m.motif))) motifs.set(motif, (motifs.get(motif) ?? 0) + 1);
  }
  const total = counts.opening + counts.middlegame + counts.endgame || 1;
  const share = { opening: counts.opening / total, middlegame: counts.middlegame / total, endgame: counts.endgame / total };
  const ranked = [...motifs].sort((a, b) => b[1] - a[1]).map(([motif, g]) => ({ motif, games: g }));
  const enough = games.length >= MIN_GAMES;
  const pattern = enough && ranked[0] && ranked[0].games >= MIN_REPEATS ? ranked[0] : null;
  return { games, share, pattern, motifs: enough ? ranked.slice(0, 3) : [], costly: total === 1 && !counts.opening && !counts.middlegame && !counts.endgame ? 0 : total };
}
