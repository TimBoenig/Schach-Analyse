// The hero's showreel: short puzzles and famous games that play themselves on
// the board, each move followed by the badge the app would give it. Nothing
// here is invented data: the games are public-domain classics, and a test
// replays every line to prove each move is legal and each ending is mate.
import { Chess } from "chess.js";

import type { Classification } from "../../domain/types";
import type { Mood } from "../Coach";
import { PUZZLE_FEN } from "../landingPuzzle";
import { lang, t } from "../../i18n";

export interface Beat {
  san: string;
  badge?: Exclude<Classification, "">;
  /** What the coach says after this move; moves without text play quickly. */
  say?: string;
  mood?: Mood;
}

export interface Scene {
  id: string;
  kind: "puzzle" | "game";
  title: string;
  /** Moves played before the show starts (the board opens after them). */
  prelude: string[];
  /** Start position for puzzles; games start from the initial position. */
  fen?: string;
  intro: string;
  beats: Beat[];
}

export interface Frame {
  fen: string;
  last: { from: string; to: string } | null;
  badge?: Exclude<Classification, "">;
  /** The move as written for a German or English reader, with its number. */
  label: string | null;
  say: string;
  mood: Mood;
  ms: number;
}

const split = (s: string) => s.split(" ");

export const SCENES: Scene[] = [
  {
    id: "backrank",
    kind: "puzzle",
    title: t("Aufgabe: Grundreihe"),
    prelude: [],
    fen: PUZZLE_FEN,
    intro: t("Aufgabe: Weiß zieht und setzt matt. Der schwarze König steht hinter seinen eigenen Bauern."),
    beats: [{ san: "Rd8#", badge: "Best", mood: "wow", say: t("Matt. Die Grundreihe war offen. Solche Muster merke ich mir, wenn sie in deinen Partien vorkommen.") }],
  },
  {
    id: "legal",
    kind: "game",
    title: t("Légals Falle"),
    prelude: split("e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6"),
    intro: t("Weiß am Zug. Der Läufer auf g4 greift den Springer an, hinter dem die Dame steht."),
    beats: [
      { san: "Nxe5", badge: "Brilliant", mood: "wow", say: t("Brillant: Weiß lässt die Dame stehen. Wer sie nimmt, wird mattgesetzt.") },
      { san: "Bxd1", badge: "Blunder", mood: "sad", say: t("Patzer: Schwarz nimmt die Dame und übersieht das Matt.") },
      { san: "Bxf7+", badge: "Best", mood: "think", say: t("Der Läufer schlägt mit Schach. Der König hat nur ein Feld.") },
      { san: "Ke7" },
      { san: "Nd5#", badge: "Best", mood: "wow", say: t("Matt, mit drei Leichtfiguren und ohne Dame.") },
    ],
  },
  {
    id: "opera",
    kind: "game",
    title: t("Opernpartie"),
    prelude: split("e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5"),
    intro: t("Morphy gegen Braunschweig und Isouard, Paris 1858. Die weiße Dame greift von b3 aus b7 und f7 an. Schwarz am Zug."),
    beats: [
      { san: "b5", badge: "Blunder", mood: "sad", say: t("Patzer: Der Bauernzug erlaubt ein Opfer auf b5, nach dem Weiß mit Tempo angreift.") },
      { san: "Nxb5", badge: "Best", mood: "happy", say: t("Weiß opfert den Springer: Der Angriff ist mehr wert als die Figur.") },
      { san: "cxb5" },
      { san: "Bxb5+" },
      { san: "Nbd7" },
      { san: "O-O-O", badge: "Great", mood: "think", say: t("Großartig: Der Turm kommt mit Tempo auf die d-Linie.") },
      { san: "Rd8" },
      { san: "Rxd7" },
      { san: "Rxd7" },
      { san: "Rd1" },
      { san: "Qe6" },
      { san: "Bxd7+" },
      { san: "Nxd7" },
      { san: "Qb8+", badge: "Brilliant", mood: "wow", say: t("Brillant: Die Dame wird geopfert, um den Springer abzulenken.") },
      { san: "Nxb8" },
      { san: "Rd8#", badge: "Best", mood: "wow", say: t("Matt. Zug für Zug lese ich so auch deine Partien.") },
    ],
  },
  {
    id: "fool",
    kind: "game",
    title: t("Der kürzeste Weg zum Matt"),
    prelude: [],
    intro: t("Die Ausgangsstellung. Weiß zieht. Wie schnell kann eine Partie kippen?"),
    beats: [
      { san: "f3", badge: "Mistake", mood: "think", say: t("Fehler: Der Bauer schwächt den König schon im ersten Zug.") },
      { san: "e5" },
      { san: "g4", badge: "Blunder", mood: "sad", say: t("Patzer: Jetzt ist die Diagonale zum König offen.") },
      { san: "Qh4#", badge: "Best", mood: "wow", say: t("Matt nach zwei Zügen.") },
    ],
  },
];

// German piece letters, as a German player reads the move (T for Turm, not R).
const DE: Record<string, string> = { Q: "D", R: "T", B: "L", N: "S" };
export const localSan = (san: string): string => (lang() === "de" ? san.replace(/[QRBN]/g, (c) => DE[c]) : san);

const MS_INTRO = 2400;
const MS_QUICK = 650;
const MS_BEAT = 2100;
const MS_END = 3200;

/** Every picture of a scene: the opening position first, then the board after each move. */
export function buildFrames(scene: Scene): Frame[] {
  const game = new Chess(scene.fen);
  for (const san of scene.prelude) game.move(san);
  const frames: Frame[] = [{ fen: game.fen(), last: null, label: null, say: scene.intro, mood: "happy", ms: MS_INTRO }];
  scene.beats.forEach((b, i) => {
    const before = game.history().length;
    const m = game.move(b.san);
    const ply = before + 1;
    const number = ply % 2 === 1 ? `${(ply + 1) / 2}.` : `${ply / 2}...`;
    const prev = frames[frames.length - 1];
    const loud = Boolean(b.say);
    frames.push({
      fen: game.fen(),
      last: { from: m.from, to: m.to },
      badge: b.badge,
      label: scene.kind === "puzzle" ? localSan(m.san) : `${number} ${localSan(m.san)}`,
      say: b.say ?? prev.say,
      mood: b.mood ?? prev.mood,
      ms: i === scene.beats.length - 1 ? MS_END : loud ? MS_BEAT : MS_QUICK,
    });
  });
  return frames;
}
