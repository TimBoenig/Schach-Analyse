// Turns a studio project into a timeline and answers "what is on screen at
// second t": where every piece stands (mid-flight included), the camera,
// arrows, marks, texts and cards. Pure, so preview and export show exactly the
// same frame for the same t, and it is tested without a browser.
import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";

import {
  germanSan,
  spellNotation,
  parseMoves,
  POLL_COLOURS,
  scenePositions,
  type Badge,
  type CameraPreset,
  type Card,
  type Effect,
  type Mood,
  type Scene,
  type StudioMark,
  type StudioProject,
  type Tone,
} from "./model";
import { t } from "../../i18n";

export interface PieceState {
  id: number;
  type: PieceSymbol;
  color: "w" | "b";
  square: string;
}

interface Mover {
  id: number;
  from: string;
  to: string;
}

export interface Step {
  t0: number;
  t1: number;
  label: string;
  movers: Mover[];
  captured?: number;
  promo?: { pawn: number; piece: PieceState };
  from: string;
  to: string;
  check?: string;
  capture: boolean;
  /** The move in plain words, for viewers who don't read notation: "Springer nach f3". */
  plain: string;
  color: "w" | "b";
}

export interface CompiledScene {
  scene: Scene;
  start: number;
  dur: number;
  before: PieceState[];
  /** Pieces that fade out / in when the scene jumps to another position. */
  jumpOut: PieceState[];
  jumpIn: Set<number>;
  steps: Step[];
  /** When arrows and marks start to appear (after the moves). */
  annotate: number;
  focus: string | null;
  /** When the scene's effects start: the moment the last move lands (or right away without moves). */
  fxAt: number;
  /** Square the effects point at: where the last move landed, else the first arrow or mark. */
  fxSquare: string | null;
  /** The mated (or checked) king for the mate effect, and the piece that gives mate. */
  mate: { king: string; by: string } | null;
  /** Squares the threat effect pulses on. */
  threats: string[];
  /** Poll answers drawn as coloured arrows on the board. */
  poll: { from: string; to: string; colour: string; letter: string }[];
  error?: string;
}

export interface Timeline {
  scenes: CompiledScene[];
  total: number;
  /** The board is seen from Black's side in every scene. */
  flip: boolean;
  /** Seconds of the effect sounds (moves themselves stay silent). */
  sounds: { t: number; kind: "boom" | "whoosh" | "sparkle" }[];
}

export interface CameraState {
  yaw: number;
  pitch: number;
  zoom: number;
  tx: number;
  tz: number;
}

export const CAMERAS: Record<CameraPreset, CameraState> = {
  white: { yaw: 0, pitch: 54, zoom: 1, tx: 0, tz: 0 },
  black: { yaw: 180, pitch: 54, zoom: 1, tx: 0, tz: 0 },
  top: { yaw: 0, pitch: 88, zoom: 1.02, tx: 0, tz: 0 },
  corner: { yaw: 38, pitch: 44, zoom: 0.98, tx: 0, tz: 0 },
  side: { yaw: 50, pitch: 42, zoom: 1, tx: 0, tz: 0 },
  low: { yaw: -24, pitch: 22, zoom: 0.96, tx: 0, tz: 0.4 },
  close: { yaw: 12, pitch: 52, zoom: 0.95, tx: 0, tz: 0 },
};

export interface FramePiece {
  id: number;
  type: PieceSymbol;
  color: "w" | "b";
  x: number;
  y: number;
  z: number;
  scale: number;
  alpha: number;
  /** Toppling (radians) towards `tiltYaw`, for the mated king. */
  tilt?: number;
  tiltYaw?: number;
}

export interface FrameArrow {
  from: string;
  to: string;
  tone: Tone;
  progress: number;
  alpha: number;
  /** Own colour instead of a tone (poll answers). */
  colour?: string;
}

export interface FrameMark {
  square: string;
  tone: Tone;
  alpha: number;
}

export interface Frame {
  index: number;
  /** Seconds since the start of the video. */
  time: number;
  local: number;
  scene: Scene;
  pieces: FramePiece[];
  arrows: FrameArrow[];
  marks: FrameMark[];
  lastMove: { from: string; to: string; alpha: number } | null;
  /** Ring around the square a piece just landed on (0..1 animation). */
  landing: { square: string; k: number } | null;
  camera: CameraState;
  title: { text: string; age: number; alpha: number };
  text: { text: string; age: number; alpha: number };
  label: string;
  pill: { text: string; plain: string; side: "w" | "b"; age: number; alpha: number } | null;
  card: { kind: Card; age: number; alpha: number };
  countdown: number | null;
  mood: Mood;
  progress: number;
  /** Active effects with the seconds since they started. */
  fx: { kind: Effect; age: number }[];
  fxSquare: string | null;
  mate: { king: string; by: string } | null;
  threats: string[];
  badge: { kind: Exclude<Badge, "">; square: string; age: number } | null;
  /** Lesson layout (wide video, explanation panel on the right). */
  lesson: boolean;
  /** Moves played so far in this line, for the lesson's move list (last one is the current). */
  moveList: string[];
  /** Letter bubbles at the end of the poll arrows. */
  pollMarks: { square: string; letter: string; colour: string; alpha: number }[];
  /** Squares the subtitle names, softly lit so viewers find them. */
  hints: { square: string; alpha: number }[];
}

/** Board coordinates: file a..h along x (-3.5..3.5), rank 1..8 along z (3.5..-3.5). */
export function squareXZ(square: string): [number, number] {
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  return [f - 3.5, 3.5 - r];
}

export function xzSquare(x: number, z: number): string | null {
  const f = Math.floor(x + 4);
  const r = Math.floor(4 - z);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return `${String.fromCharCode(97 + f)}${r + 1}`;
}

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

function piecesOf(fen: string, next: () => number): PieceState[] {
  const out: PieceState[] = [];
  const chess = new Chess(fen);
  for (const row of chess.board()) for (const p of row) if (p) out.push({ id: next(), type: p.type, color: p.color, square: p.square });
  return out;
}

const PIECE_WORD: Record<PieceSymbol, string> = { p: t("Bauer"), n: t("Springer"), b: t("Läufer"), r: t("Turm"), q: t("Dame"), k: t("König") };

/**
 * The move for people who don't read notation: "Springer von g1 nach f3",
 * "Läufer schlägt Springer auf c6", "Kurze Rochade: König nach g1".
 * Naming the start square and the captured piece lets a beginner find both on the board.
 */
export function plainMove(m: Move): string {
  const mark = m.san.includes("#") ? t(", Matt") : m.san.includes("+") ? t(", Schach") : "";
  if (m.flags.includes("k")) return t("Kurze Rochade: König nach {to}{mark}", { to: m.to, mark });
  if (m.flags.includes("q")) return t("Lange Rochade: König nach {to}{mark}", { to: m.to, mark });
  const who = PIECE_WORD[m.piece];
  let s: string;
  if (m.flags.includes("e")) s = t("{who} schlägt Bauer en passant auf {to}", { who, to: m.to });
  else if (m.captured) s = t("{who} schlägt {1} auf {to}", { who, 1: PIECE_WORD[m.captured], to: m.to });
  else s = t("{who} von {from} nach {to}", { who, from: m.from, to: m.to });
  if (m.promotion) s += t(" und wird {0}", { 0: PIECE_WORD[m.promotion] });
  return s + mark;
}

/** "3. Lb5" or "3… a6": the move pill always says which move it is. */
function moveLabel(m: Move, fenBefore: string): string {
  const no = Number(fenBefore.split(" ")[5]) || 1;
  return `${no}${m.color === "w" ? "." : "…"} ${germanSan(m.san)}`;
}

const MOVE = 0.85;
const GAP = 0.3;
const CARD_FADE = 0.45;

export function compile(project: StudioProject): Timeline {
  let nextId = 1;
  const next = () => nextId++;
  const positions = scenePositions(project);
  const speed = Math.max(0.3, project.video.speed || 1);
  const tempo = Math.max(0.3, project.video.tempo * speed);
  const scenes: CompiledScene[] = [];
  const sounds: Timeline["sounds"] = [];
  let board: PieceState[] = piecesOf(positions[0]?.before ?? project.startFen, next);
  let prevFen = positions[0]?.before ?? project.startFen;
  let tk = 0;

  project.scenes.forEach((s, index) => {
    const pos = positions[index];
    let jumpOut: PieceState[] = [];
    const jumpIn = new Set<number>();
    if (pos.before !== prevFen) {
      // Keep the pieces that stand on the same square in both positions; the rest cross-fade.
      const target = new Chess(pos.before);
      const kept: PieceState[] = [];
      const used = new Set<number>();
      for (const row of target.board()) {
        for (const p of row) {
          if (!p) continue;
          const same = board.find((b) => !used.has(b.id) && b.square === p.square && b.type === p.type && b.color === p.color);
          if (same) {
            used.add(same.id);
            kept.push(same);
          } else {
            const fresh = { id: next(), type: p.type, color: p.color, square: p.square };
            jumpIn.add(fresh.id);
            kept.push(fresh);
          }
        }
      }
      jumpOut = board.filter((b) => !used.has(b.id));
      board = kept;
    }
    const before = board.map((p) => ({ ...p }));
    const sceneTempo = Math.max(0.3, s.tempo || 1);
    const moveDur = MOVE / tempo / sceneTempo;
    const slowmo = s.effects.includes("slowmo");
    const lead = index === 0 && project.video.introFly ? 1.2 : jumpOut.length || jumpIn.size ? 0.7 : 0.35;
    const steps: Step[] = [];
    let at = lead;
    const chess = new Chess(pos.before);
    pos.parsed.moves.forEach((m, mi) => {
      const fenBefore = chess.fen();
      chess.move(m.san);
      const movers: Mover[] = [];
      const piece = board.find((p) => p.square === m.from)!;
      movers.push({ id: piece.id, from: m.from, to: m.to });
      let captured: number | undefined;
      if (m.flags.includes("e")) {
        const sq = `${m.to[0]}${m.from[1]}`;
        captured = board.find((p) => p.square === sq)?.id;
      } else if (m.captured) {
        captured = board.find((p) => p.square === m.to)?.id;
      }
      if (m.flags.includes("k") || m.flags.includes("q")) {
        const rank = m.from[1];
        const [rf, rt] = m.flags.includes("k") ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
        const rook = board.find((p) => p.square === rf);
        if (rook) movers.push({ id: rook.id, from: rf, to: rt });
      }
      let promo: Step["promo"];
      if (m.promotion) promo = { pawn: piece.id, piece: { id: next(), type: m.promotion, color: m.color, square: m.to } };
      let check: string | undefined;
      if (chess.inCheck()) {
        const kingColor = chess.turn();
        for (const row of chess.board()) for (const p of row) if (p && p.type === "k" && p.color === kingColor) check = p.square;
      }
      // Knights jump in a higher arc and need a moment longer.
      // Slow motion stretches only the scene's last move, the one that matters.
      const dur = moveDur * (m.piece === "n" ? 1.12 : 1) * (slowmo && mi === pos.parsed.moves.length - 1 ? 2.6 : 1);
      steps.push({ t0: at, t1: at + dur, label: moveLabel(m, fenBefore), movers, captured, promo, from: m.from, to: m.to, check, capture: Boolean(m.captured), plain: plainMove(m), color: m.color });
      // Board after the move.
      board = board.filter((p) => p.id !== captured);
      for (const mv of movers) {
        const p = board.find((b) => b.id === mv.id);
        if (p) p.square = mv.to;
      }
      if (promo) board = board.filter((p) => p.id !== promo.pawn).concat(promo.piece);
      at += dur + GAP / tempo;
    });
    const annotate = steps.length ? steps[steps.length - 1].t1 + 0.15 : lead;
    const lastStep = steps[steps.length - 1];
    const fxAt = lastStep ? lastStep.t1 : lead;
    // Effects need their moment on screen; the speaker's text needs time to be said.
    const fxTime = s.effects.includes("mate") ? 2.2 : s.effects.includes("confetti") ? 1.4 : s.effects.length ? 0.8 : 0;
    const spoken = s.speech.trim() ? s.speech.trim().split(/\s+/).length / 2.6 + 0.6 : 0;
    const minimum = Math.max(
      annotate + (s.arrows.length || s.marks.length ? 1.4 : 0.9) + (s.card === "question" || s.card === "poll" ? s.countdown : 0),
      fxAt + fxTime,
      spoken,
    );
    const dur = Math.max(s.duration / speed, minimum);
    const focus = lastStep?.to ?? s.arrows[0]?.to ?? s.marks[0]?.square ?? null;
    let mate: CompiledScene["mate"] = null;
    if (s.effects.includes("mate")) {
      // The king of the side to move after the scene falls; without a real mate, still the king in check or to move.
      let king = "";
      for (const row of chess.board()) for (const p of row) if (p && p.type === "k" && p.color === chess.turn()) king = p.square;
      if (king) mate = { king, by: lastStep?.to ?? s.arrows[0]?.from ?? king };
    }
    let threats: string[] = [];
    if (s.effects.includes("threat")) {
      threats = [...s.arrows.filter((a) => a.tone === "bad").map((a) => a.to), ...s.marks.filter((m) => m.tone === "bad").map((m) => m.square)];
      if (!threats.length && lastStep) {
        // Without red arrows: every enemy piece the moved piece now attacks.
        const mover = chess.get(lastStep.to as Square);
        if (mover) {
          for (const row of chess.board()) for (const p of row) if (p && p.color !== mover.color && chess.attackers(p.square, mover.color).includes(lastStep.to as Square)) threats.push(p.square);
        }
      }
      threats = [...new Set(threats)].slice(0, 6);
    }
    if (mate) sounds.push({ t: tk + fxAt + 0.85, kind: "boom" });
    if (s.effects.includes("zoom") || s.effects.includes("flash")) sounds.push({ t: tk + Math.max(0, fxAt - 0.15), kind: "whoosh" });
    if (s.effects.includes("confetti")) sounds.push({ t: tk + fxAt, kind: "sparkle" });
    // Each poll answer that is a legal move here gets its own coloured arrow.
    const poll: CompiledScene["poll"] = [];
    if (s.card === "poll") {
      s.options.forEach((o, k) => {
        const m = o.match(/^\s*([A-Za-z])\s*[).:]\s*(.+)$/);
        const parsed = parseMoves(pos.after, m ? m[2] : o);
        const mv = parsed.moves[0];
        if (mv) poll.push({ from: mv.from, to: mv.to, colour: POLL_COLOURS[k % POLL_COLOURS.length], letter: m ? m[1].toUpperCase() : String.fromCharCode(65 + k) });
      });
    }
    scenes.push({ scene: s, start: tk, dur, before, jumpOut, jumpIn, steps, annotate, focus, fxAt, fxSquare: focus, mate, threats, poll, error: pos.parsed.error });
    tk += dur;
    prevFen = pos.after;
  });
  return { scenes, total: tk, sounds, flip: project.video.perspective === "black" };
}

export function sceneAt(timeline: Timeline, tk: number): number {
  const list = timeline.scenes;
  for (let i = list.length - 1; i >= 0; i--) if (tk >= list[i].start) return i;
  return 0;
}

function sceneCamera(c: CompiledScene, local: number, flip: boolean): CameraState {
  const s = c.scene;
  const preset = CAMERAS[s.camera];
  // Presets are relative to the video's side: "Normal" from Black's side looks from rank 8.
  const base = flip ? { ...preset, yaw: preset.yaw + 180 } : preset;
  let tx = base.tx;
  let tz = base.tz;
  let zoom = base.zoom * s.zoom;
  if (s.focus && c.focus) {
    const [fx, fz] = squareXZ(c.focus);
    tx += fx * 0.4;
    tz += fz * 0.4;
    zoom *= 0.94;
  }
  return { yaw: holdSide(base.yaw + s.orbit * local, flip, s.camera === "black"), pitch: base.pitch, zoom, tx, tz };
}

/** Largest turn away from the video's own side. Beyond this viewers lose track of who plays up the board. */
export const MAX_SIDE_TURN = 40;

/** Keeps the camera on the video's side unless the scene explicitly asks for the opposite view. */
export function holdSide(yaw: number, flip: boolean, opposite: boolean): number {
  const home = flip !== opposite ? 180 : 0;
  let d = yaw - home;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return home + Math.max(-MAX_SIDE_TURN, Math.min(MAX_SIDE_TURN, d));
}

function lerpCamera(a: CameraState, b: CameraState, k: number): CameraState {
  return {
    yaw: a.yaw + (b.yaw - a.yaw) * k,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
    zoom: a.zoom + (b.zoom - a.zoom) * k,
    tx: a.tx + (b.tx - a.tx) * k,
    tz: a.tz + (b.tz - a.tz) * k,
  };
}

/** Zoom and shake effects on top of the scene's camera. */
function effectCamera(c: CompiledScene, local: number, cam: CameraState): CameraState {
  const fx = c.scene.effects;
  const age = local - c.fxAt;
  let out = cam;
  if (fx.includes("zoom") && c.fxSquare && age > -0.15) {
    const k = ease(clamp01((age + 0.15) / 0.4));
    const [x, z] = squareXZ(c.fxSquare);
    out = { ...out, zoom: out.zoom * (1 - 0.3 * k), tx: out.tx + (x * 0.6 - out.tx) * k, tz: out.tz + (z * 0.6 - out.tz) * k };
  }
  if (c.mate && age > 0) {
    // The camera moves in on the falling king.
    const k = ease(clamp01(age / 0.9));
    const [x, z] = squareXZ(c.mate.king);
    out = { ...out, zoom: out.zoom * (1 - 0.28 * k), tx: out.tx + (x * 0.7 - out.tx) * k, tz: out.tz + (z * 0.7 - out.tz) * k };
  }
  const shakes = fx.includes("shake") || fx.includes("mate");
  if (shakes) {
    // A short decaying tremor on every landing of the scene, strongest on the last.
    let amp = 0;
    let phase = 0;
    for (const st of c.steps) {
      const a = local - st.t1;
      if (a < 0 || a > 0.7) continue;
      amp = Math.max(amp, (st === c.steps[c.steps.length - 1] ? 1 : 0.5) * (1 - a / 0.7) ** 2);
      phase = a;
    }
    if (!c.steps.length && age >= 0 && age < 0.7) {
      amp = (1 - age / 0.7) ** 2;
      phase = age;
    }
    if (amp > 0) out = { ...out, yaw: out.yaw + Math.sin(phase * 70) * 1.6 * amp, pitch: out.pitch + Math.sin(phase * 53 + 1) * 1.1 * amp, tx: out.tx + Math.sin(phase * 61 + 2) * 0.08 * amp };
  }
  return out;
}

export function cameraAt(timeline: Timeline, index: number, local: number, introFly: boolean): CameraState {
  const c = timeline.scenes[index];
  const target = effectCamera(c, local, sceneCamera(c, local, timeline.flip));
  if (index === 0) {
    if (!introFly) return target;
    // Opening shot: the camera sweeps in from high above and to the side.
    const from: CameraState = { yaw: target.yaw - 30, pitch: 80, zoom: target.zoom * 1.9, tx: target.tx, tz: target.tz };
    return lerpCamera(from, target, ease(local / 2.2));
  }
  const span = 1.15;
  if (local >= span) return target;
  const prev = timeline.scenes[index - 1];
  const from = cameraAt(timeline, index - 1, prev.dur, introFly);
  // Never spin the long way round between two presets.
  let yaw = from.yaw;
  while (target.yaw - yaw > 180) yaw += 360;
  while (target.yaw - yaw < -180) yaw -= 360;
  return lerpCamera({ ...from, yaw }, target, ease(local / span));
}

const arrowKey = (a: { from: string; to: string; tone: Tone }) => `${a.from}${a.to}${a.tone}`;
const markKey = (m: StudioMark) => `${m.square}${m.tone}`;

export function frameAt(timeline: Timeline, project: StudioProject, tk: number): Frame | null {
  if (!timeline.scenes.length) return null;
  const time = Math.max(0, Math.min(tk, Math.max(0, timeline.total - 1e-4)));
  const index = sceneAt(timeline, time);
  const c = timeline.scenes[index];
  const prev = timeline.scenes[index - 1];
  const nextScene = timeline.scenes[index + 1];
  const local = time - c.start;
  const s = c.scene;

  // ---- pieces
  const pieces: FramePiece[] = [];
  const place = (p: PieceState, sq: string, extra: Partial<FramePiece> = {}) => {
    const [x, z] = squareXZ(sq);
    pieces.push({ id: p.id, type: p.type, color: p.color, x, y: 0, z, scale: 1, alpha: 1, ...extra });
  };
  const fade = clamp01(local / 0.55);
  for (const p of c.jumpOut) if (fade < 1) place(p, p.square, { alpha: 1 - fade, scale: 1 - 0.25 * fade });
  const squares = new Map<number, string>(c.before.map((p) => [p.id, p.square]));
  const gone = new Set<number>();
  for (const st of c.steps) if (local >= st.t1 && st.promo) gone.add(st.promo.pawn);
  for (const p of c.before) {
    let extra: Partial<FramePiece> = {};
    if (c.jumpIn.has(p.id)) extra = { alpha: fade, scale: 0.75 + 0.25 * fade };
    let sq = squares.get(p.id)!;
    let flying: Partial<FramePiece> | null = null;
    for (const st of c.steps) {
      if (st.captured === p.id && local >= st.t0) {
        // The captured piece waits until the attacker arrives, then sinks away.
        const k = clamp01((local - (st.t0 + (st.t1 - st.t0) * 0.7)) / 0.3);
        extra = { alpha: 1 - k, scale: 1 - 0.5 * k };
        if (k >= 1) gone.add(p.id);
      }
      for (const mv of st.movers) {
        if (mv.id !== p.id || local < st.t0) continue;
        if (local >= st.t1) {
          sq = mv.to;
          continue;
        }
        const k = ease((local - st.t0) / (st.t1 - st.t0));
        const [ax, az] = squareXZ(mv.from);
        const [bx, bz] = squareXZ(mv.to);
        const dist = Math.hypot(bx - ax, bz - az);
        const knight = p.type === "n";
        const lift = (knight ? 1.0 : 0.22 + Math.min(0.35, dist * 0.06)) * Math.sin(Math.PI * k);
        flying = { x: ax + (bx - ax) * k, z: az + (bz - az) * k, y: lift };
      }
      if (st.promo?.pawn === p.id && local >= st.t1) gone.add(p.id);
    }
    if (gone.has(p.id)) continue;
    if (flying) {
      const [x0, z0] = squareXZ(sq);
      pieces.push({ id: p.id, type: p.type, color: p.color, x: x0, y: 0, z: z0, scale: 1, alpha: 1, ...extra, ...flying });
    } else place(p, sq, extra);
  }
  for (const st of c.steps) {
    if (st.promo && local >= st.t1) {
      const k = clamp01((local - st.t1) / 0.35);
      place(st.promo.piece, st.to, { scale: 0.4 + 0.6 * ease(k), alpha: k });
    }
  }

  // ---- the mated king topples, away from the piece that gives mate
  if (c.mate && local > c.fxAt + 0.35) {
    const k = clamp01((local - c.fxAt - 0.35) / 0.75);
    // Falls fast, bounces once on the board.
    const fall = k < 0.75 ? ease(k / 0.75) : 1 - Math.sin(((k - 0.75) / 0.25) * Math.PI) * 0.08;
    const king = pieces.find((p) => p.type === "k" && xzSquare(p.x, p.z) === c.mate!.king);
    if (king) {
      const [kx, kz] = squareXZ(c.mate.king);
      const [ax, az] = squareXZ(c.mate.by);
      const dx = kx - ax || 0.001;
      const dz = kz - az;
      king.tilt = 1.42 * fall;
      // Lifted a little so the tipped base does not sink into the board.
      king.y += 0.17 * Math.sin(king.tilt);
      king.tiltYaw = Math.atan2(dx, dz);
    }
  }

  // ---- last move and landing ring
  const done = c.steps.filter((st) => local >= st.t1);
  const moving = c.steps.find((st) => local >= st.t0 && local < st.t1);
  let lastMove: Frame["lastMove"] = null;
  const lastDone = done[done.length - 1];
  if (lastDone) lastMove = { from: lastDone.from, to: lastDone.to, alpha: clamp01((local - lastDone.t1) / 0.25) };
  else if (!moving && prev?.steps.length && !c.jumpIn.size && !c.jumpOut.length) {
    const p = prev.steps[prev.steps.length - 1];
    lastMove = { from: p.from, to: p.to, alpha: 1 };
  }
  const landing = lastDone && local - lastDone.t1 < 0.7 ? { square: lastDone.to, k: (local - lastDone.t1) / 0.7 } : null;

  // ---- arrows and marks (kept on screen when the next scene shows the same one)
  const prevArrows = new Set((prev?.scene.arrows ?? []).map(arrowKey));
  const nextArrows = new Set((nextScene?.scene.arrows ?? []).map(arrowKey));
  const tail = c.dur - local;
  const arrows: FrameArrow[] = s.arrows.map((a, i) => {
    const carried = prevArrows.has(arrowKey(a));
    const start = c.annotate + i * 0.14;
    const progress = carried ? 1 : ease(clamp01((local - start) / 0.45));
    const outA = nextArrows.has(arrowKey(a)) ? 1 : clamp01(tail / 0.3);
    return { ...a, progress, alpha: (carried ? 1 : clamp01((local - start) / 0.2)) * outA };
  });
  // The piece in flight draws a faint path, so it is clear which piece goes where.
  if (moving) {
    const k = clamp01((local - moving.t0) / (moving.t1 - moving.t0));
    arrows.push({ from: moving.from, to: moving.to, tone: "accent", progress: ease(Math.min(1, k * 1.6)), alpha: 0.55 });
  } else if (lastDone && local - lastDone.t1 < 0.4) {
    arrows.push({ from: lastDone.from, to: lastDone.to, tone: "accent", progress: 1, alpha: 0.55 * (1 - (local - lastDone.t1) / 0.4) });
  }
  // Poll answers appear together with their buttons.
  const pollMarks: Frame["pollMarks"] = [];
  c.poll.forEach((p, k) => {
    const start = 0.35 + k * 0.12;
    const alpha = clamp01((local - start) / 0.3) * clamp01(tail / 0.3);
    arrows.push({ from: p.from, to: p.to, tone: "accent", colour: p.colour, progress: ease(clamp01((local - start) / 0.45)), alpha });
    pollMarks.push({ square: p.to, letter: p.letter, colour: p.colour, alpha });
  });
  const prevMarks = new Set((prev?.scene.marks ?? []).map(markKey));
  const nextMarks = new Set((nextScene?.scene.marks ?? []).map(markKey));
  const marks: FrameMark[] = s.marks.map((m, i) => {
    const carried = prevMarks.has(markKey(m));
    const start = c.annotate + i * 0.08;
    const inA = carried ? 1 : clamp01((local - start) / 0.3);
    return { ...m, alpha: inA * (nextMarks.has(markKey(m)) ? 1 : clamp01(tail / 0.3)) };
  });
  const checkStep = [...done].reverse().find((st) => st.check);
  if (checkStep?.check) marks.push({ square: checkStep.check, tone: "bad", alpha: clamp01((local - checkStep.t1) / 0.25) });

  // ---- texts: a headline that stays the same over several scenes does not re-enter
  let titleStart = c.start;
  for (let i = index - 1; i >= 0 && timeline.scenes[i].scene.title === s.title && timeline.scenes[i].scene.card === s.card; i--) titleStart = timeline.scenes[i].start;
  const titleStays = nextScene && nextScene.scene.title === s.title && nextScene.scene.card === s.card;
  const titleAlpha = titleStays ? 1 : clamp01(tail / 0.3);
  // A subtitle with "|" shows its parts one after another, each for an equal share of the scene.
  const lesson = isLesson(project);
  const spell = (x: string) => (project.video.spellMoves ? spellNotation(x) : x);
  const parts = textParts(spell(s.text), !lesson);
  let textNow = parts[0] ?? "";
  let textAlpha = nextScene && nextScene.scene.text === s.text ? 1 : clamp01(tail / 0.3);
  let textStart = prev && prev.scene.text === s.text ? prev.start : c.start;
  if (parts.length > 1) {
    const share = c.dur / parts.length;
    const k = Math.min(parts.length - 1, Math.floor(local / share));
    textNow = parts[k];
    textStart = c.start + k * share;
    if (k < parts.length - 1) textAlpha = clamp01((share * (k + 1) - local) / 0.2);
  }

  const current = moving ?? lastDone;
  const pill = current ? { text: current.label, plain: current.plain, side: current.color, age: local - current.t0, alpha: 1 } : null;
  // Squares named in the subtitle part on screen ("greift *e5* an") glow softly.
  const hints: Frame["hints"] = [];
  if (project.video.squareHints && s.card === "none") {
    const named = new Set((textNow.match(/\b[a-h][1-8]\b/g) ?? []).filter((sq) => !s.marks.some((m) => m.square === sq)));
    const k = clamp01((time - textStart - 0.2) / 0.35) * textAlpha;
    for (const square of [...named].slice(0, 4)) hints.push({ square, alpha: k });
  }

  // The very first card is there from the first frame: fading it in would show the plain headline and
  // subtitle underneath for a moment, the same text twice at the start of the video.
  const cardIn = !prev || (prev.scene.card === s.card && s.card !== "none") ? 1 : clamp01(local / CARD_FADE);
  const cardOut = nextScene?.scene.card === s.card ? 1 : clamp01(tail / CARD_FADE);
  const countdown = (s.card === "question" || s.card === "poll") && s.countdown > 0 ? Math.max(0, s.countdown - Math.max(0, local - 0.6)) : null;

  return {
    index,
    time,
    local,
    scene: s,
    pieces,
    arrows,
    marks,
    lastMove,
    landing,
    camera: cameraAt(timeline, index, local, project.video.introFly),
    title: { text: spell(s.title), age: time - titleStart, alpha: titleAlpha },
    text: { text: textNow, age: time - textStart, alpha: textAlpha },
    label: s.label,
    pill,
    card: { kind: s.card, age: local, alpha: s.card === "none" ? 0 : Math.min(cardIn, cardOut) },
    countdown,
    mood: s.mood,
    progress: timeline.total ? time / timeline.total : 0,
    fx: local >= c.fxAt ? s.effects.map((kind) => ({ kind, age: local - c.fxAt })) : [],
    fxSquare: c.fxSquare,
    mate: c.mate,
    threats: c.threats,
    lesson,
    moveList: lesson ? moveListAt(timeline, index, local) : [],
    badge: s.badge && c.fxSquare && local >= c.fxAt ? { kind: s.badge, square: lastDone?.to ?? c.fxSquare, age: local - c.fxAt } : null,
    pollMarks,
    hints,
  };
}

export const isLesson = (p: StudioProject) => p.video.lesson && p.video.format === "16:9";

/** Characters a short-video viewer can read at a glance while still watching the board. */
export const SHORT_CHUNK = 60;

/** Characters the lesson's reading column holds at normal text size; longer explanations turn pages. */
export const LESSON_CHUNK = 330;

/**
 * Splits a subtitle into the parts shown one after another. "|" splits by hand.
 * A part longer than fits is split at sentences, then commas, then words: in
 * short videos at a quick look (SHORT_CHUNK), in lessons at a full reading
 * column (LESSON_CHUNK). So a text is never cut off, it only turns a page.
 */
export function textParts(text: string, short: boolean): string[] {
  const manual = text.split("|").map((x) => x.trim()).filter(Boolean);
  const limit = short ? SHORT_CHUNK : LESSON_CHUNK;
  const out: string[] = [];
  for (const part of manual) {
    if (part.length <= limit) {
      out.push(part);
      continue;
    }
    const sentences = part.match(/[^.!?:;]+[.!?:;]*\s*/g) ?? [part];
    const units = sentences.flatMap((p) => (p.length <= limit ? [p] : (p.match(/[^,]+,?\s*/g) ?? [p]).flatMap((c) => (c.length <= limit ? [c] : byWords(c, limit)))));
    let cur = "";
    for (const unit of units) {
      if (cur && (cur + unit).trim().length > limit) {
        out.push(cur.trim());
        cur = "";
      }
      cur += unit;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.length ? balanceStars(out) : [text];
}

function byWords(text: string, limit: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > limit) {
      out.push(`${cur} `);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(`${cur} `);
  return out;
}

/** A *highlight* split across two parts is closed at the end of the first and reopened in the next. */
function balanceStars(parts: string[]): string[] {
  let open = false;
  return parts.map((p) => {
    let q = open ? `*${p}` : p;
    open = ((q.match(/\*/g) ?? []).length % 2) === 1;
    if (open) q += "*";
    return q;
  });
}

/** Move labels of the line on the board, up to now. */
function moveListAt(timeline: Timeline, index: number, local: number): string[] {
  const list: string[] = [];
  for (let i = 0; i <= index; i++) {
    const c = timeline.scenes[i];
    // A jump to another position (variation, new start) begins a fresh list.
    if (i > 0 && (c.jumpOut.length || c.jumpIn.size)) list.length = 0;
    for (const st of c.steps) if (i < index || st.t0 <= local) list.push(st.label);
  }
  return list;
}
