// The example behind "Eine Partie oder viele" on the landing page: an invented
// player whose costly moves fall mostly in the endgame. After one game the
// picture is wrong (that game went wrong in the opening); the more games are
// read, the closer it comes to the truth. Plainly marked as an example on the
// page: nothing here belongs to a real person.

import { t } from "../../i18n";

export type Phase = "opening" | "middlegame" | "endgame";

export interface SampleGame {
  result: "win" | "draw" | "loss";
  /** Phases of the costly moves in this game. */
  mistakes: { phase: Phase; motif: string }[];
}

export const PHASE_LABEL: Record<Phase, string> = { opening: t("Eröffnung"), middlegame: t("Mittelspiel"), endgame: t("Endspiel") };
export const PHASES: Phase[] = ["opening", "middlegame", "endgame"];

/** How many games the slider offers. */
export const SAMPLE_STEPS = [1, 10, 40, 150] as const;

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
  // The newest game, the one a player looks at right after playing it.
  const games: SampleGame[] = [{ result: "loss", mistakes: [{ phase: "opening", motif: t("Gambit falsch angenommen") }] }];
  for (let i = 1; i < SAMPLE_STEPS[SAMPLE_STEPS.length - 1]; i++) {
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
  const [motif, repeats] = [...motifs].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const pattern = games.length >= MIN_GAMES && repeats >= MIN_REPEATS ? { motif, games: repeats } : null;
  return { games, share, pattern };
}
