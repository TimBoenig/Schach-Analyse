// Turns a studio project into a timeline and answers "what is on screen at
// second t": where every piece stands (mid-flight included), the camera,
// arrows, marks, texts and cards. Pure, so preview and export show exactly the
// same frame for the same t, and it is tested without a browser.
import { Chess, type Move, type PieceSymbol } from "chess.js";

import {
  germanSan,
  scenePositions,
  type CameraPreset,
  type Card,
  type Mood,
  type Scene,
  type StudioMark,
  type StudioProject,
  type Tone,
} from "./model";

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
  error?: string;
}

export interface Timeline {
  scenes: CompiledScene[];
  total: number;
  /** Seconds at which a piece lands, for move sounds. */
  sounds: { t: number; kind: "move" | "capture" | "check" }[];
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
  side: { yaw: 90, pitch: 40, zoom: 1, tx: 0, tz: 0 },
  low: { yaw: -24, pitch: 20, zoom: 0.82, tx: 0, tz: 0.4 },
  close: { yaw: 12, pitch: 52, zoom: 0.8, tx: 0, tz: 0 },
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
}

export interface FrameArrow {
  from: string;
  to: string;
  tone: Tone;
  progress: number;
  alpha: number;
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
  pill: { text: string; age: number; alpha: number } | null;
  card: { kind: Card; age: number; alpha: number };
  countdown: number | null;
  mood: Mood;
  progress: number;
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
  const tempo = Math.max(0.3, project.video.tempo);
  const scenes: CompiledScene[] = [];
  const sounds: Timeline["sounds"] = [];
  let board: PieceState[] = piecesOf(positions[0]?.before ?? project.startFen, next);
  let prevFen = positions[0]?.before ?? project.startFen;
  let t = 0;

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
    const moveDur = MOVE / tempo;
    const lead = index === 0 && project.video.introFly ? 1.2 : jumpOut.length || jumpIn.size ? 0.7 : 0.35;
    const steps: Step[] = [];
    let at = lead;
    const chess = new Chess(pos.before);
    pos.parsed.moves.forEach((m) => {
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
      const dur = moveDur * (m.piece === "n" ? 1.12 : 1);
      steps.push({ t0: at, t1: at + dur, label: moveLabel(m, fenBefore), movers, captured, promo, from: m.from, to: m.to, check, capture: Boolean(m.captured) });
      sounds.push({ t: t + at + dur, kind: check ? "check" : m.captured ? "capture" : "move" });
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
    const minimum = annotate + (s.arrows.length || s.marks.length ? 1.4 : 0.9) + (s.card === "question" ? s.countdown : 0);
    const dur = Math.max(s.duration, minimum);
    const lastStep = steps[steps.length - 1];
    const focus = lastStep?.to ?? s.arrows[0]?.to ?? s.marks[0]?.square ?? null;
    scenes.push({ scene: s, start: t, dur, before, jumpOut, jumpIn, steps, annotate, focus, error: pos.parsed.error });
    t += dur;
    prevFen = pos.after;
  });
  return { scenes, total: t, sounds };
}

export function sceneAt(timeline: Timeline, t: number): number {
  const list = timeline.scenes;
  for (let i = list.length - 1; i >= 0; i--) if (t >= list[i].start) return i;
  return 0;
}

function sceneCamera(c: CompiledScene, local: number): CameraState {
  const s = c.scene;
  const base = CAMERAS[s.camera];
  let tx = base.tx;
  let tz = base.tz;
  let zoom = base.zoom * s.zoom;
  if (s.focus && c.focus) {
    const [fx, fz] = squareXZ(c.focus);
    tx += fx * 0.4;
    tz += fz * 0.4;
    zoom *= 0.88;
  }
  return { yaw: base.yaw + s.orbit * local, pitch: base.pitch, zoom, tx, tz };
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

export function cameraAt(timeline: Timeline, index: number, local: number, introFly: boolean): CameraState {
  const c = timeline.scenes[index];
  const target = sceneCamera(c, local);
  if (index === 0) {
    if (!introFly) return target;
    // Opening shot: the camera sweeps in from high above and to the side.
    const from: CameraState = { yaw: target.yaw - 75, pitch: 80, zoom: target.zoom * 1.9, tx: target.tx, tz: target.tz };
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

export function frameAt(timeline: Timeline, project: StudioProject, t: number): Frame | null {
  if (!timeline.scenes.length) return null;
  const time = Math.max(0, Math.min(t, Math.max(0, timeline.total - 1e-4)));
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
  const textAlpha = nextScene && nextScene.scene.text === s.text ? 1 : clamp01(tail / 0.3);
  const textStart = prev && prev.scene.text === s.text ? prev.start : c.start;

  const current = moving ?? lastDone;
  const pill = current ? { text: current.label, age: local - current.t0, alpha: 1 } : null;

  const cardIn = prev?.scene.card === s.card && s.card !== "none" ? 1 : clamp01(local / CARD_FADE);
  const cardOut = nextScene?.scene.card === s.card ? 1 : clamp01(tail / CARD_FADE);
  const countdown = s.card === "question" && s.countdown > 0 ? Math.max(0, s.countdown - Math.max(0, local - 0.6)) : null;

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
    title: { text: s.title, age: time - titleStart, alpha: titleAlpha },
    text: { text: s.text, age: time - textStart, alpha: textAlpha },
    pill,
    card: { kind: s.card, age: local, alpha: s.card === "none" ? 0 : Math.min(cardIn, cardOut) },
    countdown,
    mood: s.mood,
    progress: timeline.total ? time / timeline.total : 0,
  };
}
