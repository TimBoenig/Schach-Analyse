// The studio's assistant: turns moves played on a 2D board (with side
// variations) plus a few answers into a finished video project — scenes,
// arrows, subtitles, poll, call to action — and spreads an uploaded script
// over the scenes. Pure functions, tested headless.
import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";

import { BRAND_DOMAIN } from "../../brand";
import { tightenEdit } from "./editTools";
import { compile } from "./timeline";
import {
  DEFAULT_VIDEO,
  displaySan,
  moveTokens,
  newId,
  scene,
  START_FEN,
  styleFromTheme,
  type BoardView,
  type CameraPreset,
  type Environment,
  type Platform,
  type Scene,
  type Side,
  type StudioArrow,
  type StudioMark,
  type StudioProject,
  type ThemeId,
} from "./model";
import { lang, t } from "../../i18n";

// ---------- move tree (main line plus side variations) ----------

export interface Variation {
  /** Main-line ply the variation replaces (0 = instead of the first move). */
  from: number;
  moves: string[];
}

export interface GameTree {
  startFen: string;
  main: string[];
  variations: Variation[];
  /** Main-line ply of the key move (trap, puzzle solution); the poll asks for it. -1 = none. */
  keyPly: number;
}

/** Where the user stands in the tree: on the main line or inside variation `line`. */
export interface Cursor {
  line: number | "main";
  ply: number;
}

export function emptyTree(startFen = START_FEN): GameTree {
  return { startFen, main: [], variations: [], keyPly: -1 };
}

/** Moves from the start position to the cursor. */
export function lineTo(tree: GameTree, cursor: Cursor): string[] {
  if (cursor.line === "main") return tree.main.slice(0, cursor.ply);
  const v = tree.variations[cursor.line];
  return [...tree.main.slice(0, v.from), ...v.moves.slice(0, cursor.ply)];
}

export function fenAt(tree: GameTree, cursor: Cursor): string {
  const chess = new Chess(tree.startFen);
  for (const san of lineTo(tree, cursor)) chess.move(san);
  return chess.fen();
}

/**
 * Plays a move at the cursor like an analysis board: continuing the line,
 * following an existing move, or opening a side variation when the main line
 * already goes another way. Returns the new tree and cursor, or null if illegal.
 */
export function playMove(tree: GameTree, cursor: Cursor, move: { from: string; to: string; promotion?: string }): { tree: GameTree; cursor: Cursor } | null {
  const chess = new Chess(fenAt(tree, cursor));
  let san: string;
  try {
    san = chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" }).san;
  } catch {
    return null;
  }
  if (cursor.line === "main") {
    if (cursor.ply === tree.main.length) return { tree: { ...tree, main: [...tree.main, san] }, cursor: { line: "main", ply: cursor.ply + 1 } };
    if (tree.main[cursor.ply] === san) return { tree, cursor: { line: "main", ply: cursor.ply + 1 } };
    const existing = tree.variations.findIndex((v) => v.from === cursor.ply && v.moves[0] === san);
    if (existing >= 0) return { tree, cursor: { line: existing, ply: 1 } };
    const variations = [...tree.variations, { from: cursor.ply, moves: [san] }];
    return { tree: { ...tree, variations }, cursor: { line: variations.length - 1, ply: 1 } };
  }
  const v = tree.variations[cursor.line];
  if (v.moves[cursor.ply] === san) return { tree, cursor: { line: cursor.line, ply: cursor.ply + 1 } };
  const variations = tree.variations.map((x, i) => (i === cursor.line ? { ...x, moves: [...x.moves.slice(0, cursor.ply), san] } : x));
  return { tree: { ...tree, variations }, cursor: { line: cursor.line, ply: cursor.ply + 1 } };
}

/** Removes the move before the cursor and everything after it on that line. */
export function takeBack(tree: GameTree, cursor: Cursor): { tree: GameTree; cursor: Cursor } {
  if (cursor.ply === 0) {
    if (cursor.line === "main") return { tree, cursor };
    const v = tree.variations[cursor.line];
    return { tree: { ...tree, variations: tree.variations.filter((_, i) => i !== cursor.line) }, cursor: { line: "main", ply: v.from } };
  }
  if (cursor.line === "main") {
    const cut = cursor.ply - 1;
    return {
      tree: { ...tree, main: tree.main.slice(0, cut), variations: tree.variations.filter((v) => v.from < cut), keyPly: tree.keyPly >= cut ? -1 : tree.keyPly },
      cursor: { line: "main", ply: cut },
    };
  }
  const line = cursor.line;
  const v = tree.variations[line];
  if (cursor.ply === 1) return { tree: { ...tree, variations: tree.variations.filter((_, i) => i !== line) }, cursor: { line: "main", ply: v.from } };
  return { tree: { ...tree, variations: tree.variations.map((x, i) => (i === line ? { ...x, moves: x.moves.slice(0, cursor.ply - 1) } : x)) }, cursor: { line, ply: cursor.ply - 1 } };
}

/** Main line from a PGN or move list; stops at the first illegal move. */
export function treeFromPgn(text: string, startFen = START_FEN): { tree: GameTree; error?: string } {
  const chess = new Chess(startFen);
  const main: string[] = [];
  for (const token of moveTokens(text)) {
    try {
      main.push(chess.move(token).san);
    } catch {
      return { tree: { ...emptyTree(startFen), main }, error: token };
    }
  }
  return { tree: { ...emptyTree(startFen), main } };
}

// ---------- automatic explanations ----------

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const ACC: Record<PieceSymbol, string> = { p: t("den Bauern"), n: t("den Springer"), b: t("den Läufer"), r: t("den Turm"), q: t("die Dame"), k: t("den König") };
const DAT: Record<PieceSymbol, string> = { p: t("dem Bauern"), n: t("dem Springer"), b: t("dem Läufer"), r: t("dem Turm"), q: t("der Dame"), k: t("dem König") };
const SIDE = { w: t("Weiß"), b: t("Schwarz") } as const;
const CENTRE = new Set(["d4", "e4", "d5", "e5"]);

export interface Insight {
  text: string;
  arrows: StudioArrow[];
  marks: StudioMark[];
}

/** What the moved piece now attacks that is worth pointing at: undefended or more valuable than itself. */
function threats(after: Chess, m: Move): { square: string; piece: PieceSymbol }[] {
  if (after.inCheck()) return [];
  const parts = after.fen().split(" ");
  parts[1] = m.color;
  parts[3] = "-";
  let probe: Chess;
  try {
    probe = new Chess(parts.join(" "));
  } catch {
    return [];
  }
  const enemy = m.color === "w" ? "b" : "w";
  const out: { square: string; piece: PieceSymbol }[] = [];
  for (const c of probe.moves({ square: m.to as Square, verbose: true })) {
    if (!c.captured || c.captured === "k") continue;
    const defended = after.isAttacked(c.to as Square, enemy);
    if (!defended || VALUE[c.captured] > VALUE[c.promotion ? "p" : m.promotion ?? m.piece]) out.push({ square: c.to, piece: c.captured });
  }
  return out.sort((a, b) => VALUE[b.piece] - VALUE[a.piece]).slice(0, 2);
}

/** A mate the moved piece threatens next move (the classic trap idea), if any. */
function mateThreat(after: Chess, m: Move): string | null {
  if (after.inCheck()) return null;
  const parts = after.fen().split(" ");
  parts[1] = m.color;
  parts[3] = "-";
  try {
    const probe = new Chess(parts.join(" "));
    for (const c of probe.moves({ square: m.to as Square, verbose: true })) {
      probe.move(c);
      const mate = probe.isCheckmate();
      probe.undo();
      if (mate) return c.to;
    }
  } catch {
    // An impossible probe position simply means no threat.
  }
  return null;
}

/** A plain German sentence about one move, plus arrows and marks that show it. */
export function explainMove(fenBefore: string, san: string, ply: number): Insight {
  const chess = new Chess(fenBefore);
  const m = chess.move(san);
  const side = SIDE[m.color];
  const arrows: StudioArrow[] = [];
  const marks: StudioMark[] = [];
  let text: string;
  if (m.flags.includes("k") || m.flags.includes("q")) text = t("{side} rochiert {1} und bringt den *König in Sicherheit*.", { side, 1: m.flags.includes("k") ? t("kurz") : t("lang") });
  else if (m.captured) {
    text = t("{side} schlägt mit {1} auf *{to}*.", { side, 1: DAT[m.piece], to: m.to });
    marks.push({ square: m.to, tone: "bad" });
  } else if (m.promotion) text = t("Der Bauer erreicht die letzte Reihe und wird zur *{0}*.", { 0: m.promotion === "q" ? t("Dame") : ACC[m.promotion].replace(/^(den|die|the) /, "") }); // i18n: regex
  else text = t("{side} zieht {1} nach *{to}*.", { side, 1: ACC[m.piece], to: m.to });
  // Extra clauses replace the sentence's full stop, so each language keeps its own word order.
  const base = text.replace(/\.$/, "");
  if (chess.isCheckmate()) text = t("{text}. *Schachmatt!*", { text: base });
  else if (chess.inCheck()) text = t("{text}. *Schach!*", { text: base });
  else {
    const hits = threats(chess, m);
    const mate = mateThreat(chess, m);
    if (mate) {
      text = t("{text} und *droht Matt* auf {square}.", { text: base, square: mate });
      arrows.push({ from: m.to, to: mate, tone: "bad" });
    } else if (hits.length) {
      const list = hits.map((h) => t("{piece} auf {square}", { piece: ACC[h.piece], square: h.square }));
      text = t("{text} und greift {targets} an.", { text: base, targets: list.length > 1 ? t("{list} und {last}", { list: list.slice(0, -1).join(", "), last: list[list.length - 1] }) : list[0] });
      for (const h of hits) arrows.push({ from: m.to, to: h.square, tone: "bad" });
    } else if (ply < 6 && m.piece === "p" && CENTRE.has(m.to)) text = t("{text} und besetzt das *Zentrum*.", { text: base });
    else if (ply < 14 && (m.piece === "n" || m.piece === "b") && (m.from[1] === "1" || m.from[1] === "8")) text = t("{text} und *entwickelt* eine Figur.", { text: base });
  }
  return { text, arrows, marks };
}

// ---------- questions ----------

export type VideoKind = "opening" | "trap" | "puzzle" | "game";
export type Vibe = "viral" | "calm" | "elegant" | "reel";
export type Ending = "follow" | "comment" | "save" | "site";

export interface Answers {
  kind: VideoKind;
  platform: Platform;
  /** Target length in seconds. */
  length: 15 | 30 | 45 | 60;
  vibe: Vibe;
  level: "beginner" | "advanced";
  name: string;
  hook: string;
  /** Ask the viewers for the key move before showing it. */
  poll: boolean;
  ending: Ending;
  environment: Environment;
  script: string;
  /** Side the board is seen from; "auto" = the side that plays the key move, else White. */
  perspective: Side | "auto";
}

export const KIND_LABEL: Record<VideoKind, string> = { opening: t("Eröffnung erklären"), trap: t("Falle oder Trick"), puzzle: t("Rätsel"), game: t("Partie-Moment") };
export const VIBE_LABEL: Record<Vibe, string> = { viral: t("Schnell & viral"), calm: t("Ruhig & lehrreich"), elegant: t("Edel & elegant"), reel: t("Reel-Look (Schwarz-Weiß)") };
export const ENDING_LABEL: Record<Ending, string> = { follow: t("Zum Folgen auffordern"), comment: t("Zum Kommentieren auffordern"), save: t("Zum Speichern auffordern"), site: t("Auf {BRAND_DOMAIN} schicken", { BRAND_DOMAIN }) };

/** Opening lines for the first second, where people decide to keep watching. No invented numbers. */
export function hookIdeas(kind: VideoKind, name: string, length: number): string[] {
  const n = name.trim() || t("diese Eröffnung");
  switch (kind) {
    case "opening":
      return [t("So funktioniert {withArticle}", { withArticle: withArticle(n) }), t("{capital} in {length} Sekunden", { capital: capital(withArticle(n)), length }), t("Diese Eröffnung musst du kennen")];
    case "trap":
      return [t("Fällst du auf diese Falle rein?"), t("Die gemeinste Falle in {withArticle}", { withArticle: withArticle(n, true) }), t("Stopp! Spiel diesen Zug nicht")];
    case "puzzle":
      return [t("Findest du den Gewinnzug?"), t("Schaffst du das in 5 Sekunden?"), t("Weiß zieht und gewinnt. Siehst du es?")];
    default:
      return [t("Dieser Zug hat alles entschieden"), t("Hättest du das gesehen?"), t("Der schönste Zug der Partie")];
  }
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Spanische Eröffnung" -> "die Spanische Eröffnung" ("der …" with `dative`). Names with their own article stay. */
function withArticle(name: string, dative = false): string {
  // English has no article before an opening name.
  if (lang() === "en" || /^(die|der|das|den|dem)\s/i.test(name)) return name;
  const feminine = /(eröffnung|partie|verteidigung|variante|falle)$/i.test(name);
  if (!feminine) return name;
  return `${dative ? "der" : "die"} ${name}`;
}

const ENDINGS: Record<Ending, { title: string; text: string }> = {
  follow: { title: t("Folge für mehr Schach-Tricks"), text: t("Und analysiere deine Partien gratis auf *{BRAND_DOMAIN}*", { BRAND_DOMAIN }) },
  comment: { title: t("Was hättest du gespielt?"), text: t("Schreib deinen Zug in die *Kommentare*") },
  save: { title: t("Speichern, bevor du es vergisst"), text: t("Mehr Training auf *{BRAND_DOMAIN}*", { BRAND_DOMAIN }) },
  site: { title: t("Wie gut spielst du wirklich?"), text: t("Analysiere deine Partien kostenlos auf *{BRAND_DOMAIN}*", { BRAND_DOMAIN }) },
};

const VIBES: Record<Vibe, { theme: ThemeId; serif: boolean; tempo: number; orbit: number; env: Environment; view?: BoardView }> = {
  viral: { theme: "neon", serif: false, tempo: 1.25, orbit: 7, env: "neon" },
  calm: { theme: "nova", serif: false, tempo: 0.95, orbit: 3, env: "podium" },
  elegant: { theme: "holz", serif: true, tempo: 0.9, orbit: 4, env: "library" },
  // The reel look moves the camera itself (roll, punch-ins), so the scenes keep a still orbit.
  reel: { theme: "mono", serif: true, tempo: 2.4, orbit: 0, env: "void", view: "reel" },
};

export function defaultAnswers(kind: VideoKind = "opening"): Answers {
  return { kind, platform: "tiktok", length: 30, vibe: "viral", level: "beginner", name: "", hook: "", poll: kind === "trap" || kind === "puzzle", ending: kind === "puzzle" ? "comment" : "follow", environment: "neon", script: "", perspective: "auto" };
}

// No view from the other side: one perspective for the whole video is easier to follow.
const CAMERAS: CameraPreset[] = ["corner", "white", "close", "side", "low", "top"];

interface Group {
  start: number;
  moves: string[];
}

/** Splits the main line into scenes: more moves per scene when the video must be short. */
function groupMoves(count: number, budget: number, keyPly: number): Group[] {
  const per = Math.max(1, Math.ceil(count / Math.max(1, budget)));
  const groups: Group[] = [];
  let i = 0;
  while (i < count) {
    let take = per;
    // The key move always opens a scene of its own, so the poll can stop right before it.
    if (keyPly > i && keyPly < i + take) take = keyPly - i;
    groups.push({ start: i, moves: [] });
    i += take;
  }
  return groups;
}

/** "3. Lb5 a6" or "3… a6 4. La4" for moves played from `fenBefore`. */
export function movesLabel(moves: Move[], fenBefore: string): string {
  let no = Number(fenBefore.split(" ")[5]) || 1;
  return moves
    .map((m, k) => {
      const s = m.color === "w" ? `${no}. ${displaySan(m.san)}` : k === 0 ? `${no}… ${displaySan(m.san)}` : displaySan(m.san);
      if (m.color === "b") no += 1;
      return s;
    })
    .join(" ");
}

/** Plausible wrong answers for a poll: checks and captures first, then any move, always the same for the same position. */
function distractors(fen: string, right: string, count: number): string[] {
  const chess = new Chess(fen);
  const all = chess.moves({ verbose: true }).filter((m) => m.san !== right);
  const score = (m: Move) => (m.san.includes("+") ? 3 : 0) + (m.captured ? 2 : 0) + (m.piece === "q" ? 1 : 0);
  return all
    .sort((a, b) => score(b) - score(a) || a.san.localeCompare(b.san))
    .slice(0, count)
    .map((m) => m.san);
}

/** The side the viewer should sit on: whoever plays the key move (the trap, the solution). */
export function suggestPerspective(tree: GameTree): Side {
  if (tree.keyPly < 0) return "white";
  const whiteFirst = (tree.startFen.split(" ")[1] ?? "w") === "w";
  return (tree.keyPly % 2 === 0) === whiteFirst ? "white" : "black";
}

/** Builds the whole video project from the played moves and the answers. */
export function buildProject(tree: GameTree, a: Answers): StudioProject {
  const vibe = VIBES[a.vibe];
  const scenes: Scene[] = [];
  const hook = a.hook.trim() || hookIdeas(a.kind, a.name, a.length)[0];
  const fast = a.vibe === "viral" || a.vibe === "reel";
  scenes.push(
    scene({
      card: a.kind === "puzzle" ? "question" : "intro",
      title: hook,
      text:
        a.kind === "puzzle"
          ? t("Schreib deine Lösung in die Kommentare")
          : a.name.trim() && !hook.toLowerCase().includes(a.name.trim().toLowerCase())
            ? a.name.trim()
            : a.level === "beginner"
              ? t("Einfach erklärt")
              : t("Die wichtigsten Ideen"),
      duration: a.vibe === "reel" ? 1.3 : fast ? 2.4 : 3.2,
      countdown: a.kind === "puzzle" && !a.poll ? 3 : 0,
      camera: "white",
      orbit: vibe.orbit,
      mood: a.kind === "trap" ? "wow" : "happy",
    }),
  );

  // For a puzzle the moves before the key move only set up the position.
  const keyPly = tree.keyPly >= 0 && tree.keyPly < tree.main.length ? tree.keyPly : a.kind === "puzzle" ? 0 : -1;
  const chess = new Chess(tree.startFen);
  let startFen = tree.startFen;
  let firstShown = 0;
  if (a.kind === "puzzle" && keyPly > 0) {
    for (const san of tree.main.slice(0, keyPly)) chess.move(san);
    startFen = chess.fen();
    firstShown = keyPly;
  }
  const shown = tree.main.slice(firstShown);
  const seconds = a.length - (fast ? 2.4 : 3.2) - 4 - (a.poll && keyPly >= 0 ? 4 : 0) - tree.variations.length * 3.5;
  const budget = Math.max(1, Math.floor(seconds / (fast ? 2.6 : 3.4)));
  const groups = groupMoves(shown.length, budget, keyPly >= 0 ? keyPly - firstShown : -1);
  groups.forEach((g, gi) => (g.moves = shown.slice(g.start, groups[gi + 1]?.start ?? shown.length)));

  let cam = 0;
  const board = new Chess(startFen);
  let backToMain = false;
  for (const g of groups) {
    const fenBefore = board.fen();
    const ply = firstShown + g.start;
    const isKey = keyPly >= 0 && ply === keyPly;
    if (isKey && a.poll) {
      const right = g.moves[0];
      const options = [right, ...distractors(fenBefore, right, 2)].sort();
      const letters = ["A", "B", "C"];
      const answer = letters[options.indexOf(right)];
      scenes.push(
        scene({
          card: "poll",
          title: a.kind === "puzzle" ? t("Welcher Zug gewinnt?") : t("Was spielt {0} jetzt?", { 0: SIDE[board.turn()] }),
          text: t("Stimm in den Kommentaren ab"),
          options: options.map((o, i) => `${letters[i]}) ${displaySan(o)}`),
          countdown: 3,
          duration: 4.2,
          camera: "top",
          mood: "think",
          fen: backToMain ? fenBefore : "",
        }),
      );
      backToMain = false;
      const insight = explainMove(fenBefore, right, ply);
      const played = new Chess(fenBefore);
      const ms = g.moves.map((s) => played.move(s));
      scenes.push(
        scene({
          moves: movesLabel(ms, fenBefore),
          title: t("Richtig: {answer}) {displaySan}", { answer, displaySan: displaySan(right) }),
          text: insight.text,
          arrows: insight.arrows,
          marks: insight.marks,
          camera: "low",
          focus: true,
          orbit: vibe.orbit,
          duration: fast ? 3.4 : 4.4,
          mood: "wow",
          effects: played.isCheckmate() ? ["mate"] : ["zoom", "confetti"],
          badge: played.isCheckmate() ? "" : "brilliant",
        }),
      );
    } else {
      const played = new Chess(fenBefore);
      const ms = g.moves.map((s) => played.move(s));
      const parts: string[] = [];
      const arrows: StudioArrow[] = [];
      let marks: StudioMark[] = [];
      const walk = new Chess(fenBefore);
      g.moves.forEach((san, k) => {
        const insight = explainMove(walk.fen(), san, ply + k);
        walk.move(san);
        parts.push(insight.text);
        // Every threat of the scene stays visible (at most three); marks only for the last move.
        for (const ar of insight.arrows) if (arrows.length < 3 && !arrows.some((x) => x.from === ar.from && x.to === ar.to)) arrows.push(ar);
        marks = insight.marks;
      });
      scenes.push(
        scene({
          moves: movesLabel(ms, fenBefore),
          fen: backToMain ? fenBefore : "",
          label: backToMain ? t("Zurück zur Hauptvariante") : "",
          title: isKey ? (a.kind === "trap" ? t("Der entscheidende Zug") : t("Der Schlüsselzug")) : movesLabel(ms, fenBefore),
          text: parts.join(" | "),
          arrows,
          marks,
          camera: isKey ? "low" : CAMERAS[cam++ % CAMERAS.length],
          focus: isKey || (fast && cam % 2 === 0),
          orbit: isKey ? vibe.orbit : 0,
          duration: (fast ? 2.2 : 3) + g.moves.length * (fast ? 0.9 : 1.2),
          mood: isKey ? "wow" : "think",
          effects: played.isCheckmate() ? ["mate"] : isKey ? ["zoom"] : arrows.some((x) => x.tone === "bad") && fast ? ["threat"] : [],
          badge: isKey && !played.isCheckmate() ? "great" : "",
        }),
      );
      backToMain = false;
    }
    for (const san of g.moves) board.move(san);

    // Side variations that branch inside this scene come right after it.
    const end = firstShown + g.start + g.moves.length;
    tree.variations.forEach((v, vi) => {
      if (v.from < ply || v.from >= end || !v.moves.length) return;
      const base = new Chess(tree.startFen);
      for (const san of tree.main.slice(0, v.from)) base.move(san);
      const vf = base.fen();
      const played = new Chess(vf);
      const ms = v.moves.map((s) => played.move(s));
      const walk = new Chess(vf);
      const texts = v.moves.slice(0, 3).map((san, k) => {
        const tk = explainMove(walk.fen(), san, v.from + k);
        walk.move(san);
        return tk;
      });
      const last = texts[texts.length - 1];
      scenes.push(
        scene({
          fen: vf,
          moves: movesLabel(ms, vf),
          label: t("Variante {0}", { 0: vi + 1 }),
          title: t("Und wenn {0}?", { 0: movesLabel(ms.slice(0, 1), vf).replace(/^\d+(\.|…) /, "") }),
          text: texts.map((tk) => tk.text).join(" | "),
          arrows: last?.arrows ?? [],
          marks: last?.marks ?? [],
          camera: "corner",
          duration: 2.6 + v.moves.length * 0.9,
          mood: "think",
        }),
      );
      backToMain = true;
    });
  }

  const end = ENDINGS[a.ending];
  // The reel look ends on a short overlay (1.3 s) and loops straight into its start, a 4 s end screen loses the viewers.
  scenes.push(scene({ card: "outro", title: end.title, text: end.text, duration: a.vibe === "reel" ? 1.3 : 4, camera: "corner", orbit: 6, mood: "wow" }));

  const style = styleFromTheme(vibe.theme, { titleFont: vibe.serif ? "serif" : "sans", environment: a.environment, view: a.platform === "youtube" ? "2d" : (vibe.view ?? "3d") });
  const project: StudioProject = {
    id: newId("p"),
    name: a.name.trim() || hook,
    startFen,
    scenes,
    style,
    video: { ...DEFAULT_VIDEO, perspective: a.perspective === "auto" ? suggestPerspective(tree) : a.perspective, platform: a.platform, format: a.platform === "youtube" ? "16:9" : "9:16", lesson: a.platform === "youtube", tempo: vibe.tempo },
    updatedAt: Date.now(),
  };
  const withScript = a.script.trim() ? distributeScript(project, a.script) : project;
  const fitted = fitLength(withScript, a.length);
  // The reel look is an edit: it starts on the critical position with a hook and keeps the middle short.
  return a.vibe === "reel" ? tightenEdit(fitted, { lang: lang() }).project : fitted;
}

/** Sets the overall speed so the video lasts about `seconds` (within sensible limits). */
export function fitLength(project: StudioProject, seconds: number): StudioProject {
  let p = { ...project, video: { ...project.video, speed: 1 } };
  // Two passes: the minimum time of moves and texts does not scale linearly.
  for (let i = 0; i < 3; i++) {
    const total = compile(p).total;
    const speed = Math.min(2.2, Math.max(0.6, p.video.speed * (total / seconds)));
    p = { ...p, video: { ...p.video, speed: Math.round(speed * 100) / 100 } };
  }
  return p;
}

// ---------- script ----------

/** Sentences of a script; blank lines and line breaks also end a sentence. */
export function sentences(script: string): string[] {
  return script
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** Moves a sentence mentions (e4, Sf3, Lb5, O-O …), in English SAN without check marks. */
function mentions(sentence: string): string[] {
  const found = sentence.match(/\b(?:[KDTLSQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[DTLSQRBN])?|0-0(?:-0)?|O-O(?:-O)?)/g) ?? [];
  return moveTokens(found.join(" ")).map((tk) => tk.replace(/[+#]/g, ""));
}

const WORDS_PER_SECOND = 2.6;
const CTA = /\b(folg|abonnier|kommentier|kommentar|speicher|teil (2|zwei)|link|like)/i;

/**
 * Spreads a voice-over script over the scenes. A sentence that names a move
 * goes to the scene that plays it; the others are spread in reading order
 * between those anchors. Each scene gets its sentences as subtitle parts and
 * enough time to read (or speak) them.
 */
export function distributeScript(project: StudioProject, script: string): StudioProject {
  const list = sentences(script);
  if (!list.length) return project;
  const scenes = project.scenes.map((s) => ({ ...s }));
  const content = scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.card !== "outro");
  if (!content.length) return project;
  const moveSets = content.map(({ s }) => new Set(moveTokens(s.moves).map((tk) => tk.replace(/[+#]/g, ""))));
  // Anchor: index into `content` for sentences that name a move, scanning forward only.
  const anchors: number[] = [];
  let cursor = 0;
  for (const sentence of list) {
    const named = mentions(sentence);
    let hit = -1;
    for (let j = cursor; j < content.length && hit < 0; j++) if (named.some((n) => moveSets[j].has(n))) hit = j;
    anchors.push(hit);
    if (hit >= 0) cursor = hit;
  }
  const target: number[] = [];
  for (let i = 0; i < list.length; i++) {
    if (anchors[i] >= 0) {
      target.push(anchors[i]);
      continue;
    }
    // Between the previous and next anchor (or the ends), in proportion to the position.
    let p = i - 1;
    while (p >= 0 && anchors[p] < 0) p--;
    let n = i + 1;
    while (n < list.length && anchors[n] < 0) n++;
    const lo = p >= 0 ? anchors[p] : 0;
    const hi = n < list.length ? anchors[n] : content.length - 1;
    const span = n - p;
    const pos = (i - p) / span;
    const tk = Math.round(lo + (hi - lo) * pos);
    target.push(Math.max(lo, Math.min(hi, Math.max(tk, target[target.length - 1] ?? 0))));
  }
  const buckets = content.map(() => [] as string[]);
  // A closing call to action ("Folge für Teil 2") belongs on the closing card.
  const outro = scenes.findIndex((s) => s.card === "outro");
  if (outro >= 0 && list.length > 1 && CTA.test(list[list.length - 1])) {
    scenes[outro].title = list.pop()!.replace(/[.!]+$/, "");
    target.pop();
  }
  list.forEach((sentence, i) => buckets[target[i]].push(sentence));
  buckets.forEach((b, j) => {
    if (!b.length) return;
    const s = scenes[content[j].i];
    // Long sentences become two parts so each fits the subtitle box.
    const parts = b.flatMap((x) => (x.length > 110 ? splitLong(x) : [x]));
    s.text = parts.join(" | ");
    const words = b.join(" ").split(/\s+/).length;
    s.duration = Math.max(s.duration, words / WORDS_PER_SECOND + 0.8);
  });
  return { ...project, scenes };
}

function splitLong(s: string): string[] {
  const mid = s.lastIndexOf(",", Math.floor(s.length * 0.6));
  if (mid > 25) return [s.slice(0, mid + 1).trim(), s.slice(mid + 1).trim()];
  const words = s.split(" ");
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

/** Scenes for a variation played in the editor: jump to the branch position and play it. */
export function variationScene(fen: string, moves: string[], index: number): Scene {
  const chess = new Chess(fen);
  const ms = moves.map((s) => chess.move(s));
  const walk = new Chess(fen);
  const texts = moves.map((san, k) => {
    const tk = explainMove(walk.fen(), san, k);
    walk.move(san);
    return tk;
  });
  const last = texts[texts.length - 1];
  return scene({ fen, moves: movesLabel(ms, fen), label: t("Variante {index}", { index }), title: t("Und wenn {displaySan}?", { displaySan: displaySan(moves[0] ?? "") }), text: texts.map((tk) => tk.text).join(" | "), arrows: last?.arrows ?? [], marks: last?.marks ?? [], camera: "corner", duration: 2.6 + moves.length * 0.9, mood: "think" });
}

/** Explanation and arrows for the moves of an existing scene ("Auto" button in the editor). */
export function autoScene(fenBefore: string, movesText: string, plyOffset = 0): Insight | null {
  const chess = new Chess(fenBefore);
  const texts: string[] = [];
  let last: Insight | null = null;
  for (const token of moveTokens(movesText)) {
    try {
      const before = chess.fen();
      const m = chess.move(token);
      last = explainMove(before, m.san, plyOffset + texts.length);
      texts.push(last.text);
    } catch {
      break;
    }
  }
  return last ? { text: texts.join(" | "), arrows: last.arrows, marks: last.marks } : null;
}
