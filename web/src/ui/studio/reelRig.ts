// The camera rig of the reel (edit) looks: the camera's whole path is planned once per video, like a camera operator who has read the
// script, and every frame only reads its spot on that path.
//
// Why planned and not decided frame by frame: the old camera picked a framing per scene and corrected it afterwards (a zoom effect here,
// a move that would leave the picture there). Each correction was a second move right after the first, so the picture flew somewhere
// and straight back. Now every framing already holds everything its scene will show, the camera arrives before the first piece lifts,
// stays still while a move is played (only a slow push-in) and leaves after the landing. Between the framings it glides on a monotone
// curve: never past its target, never back, speed changing smoothly across scene changes. The looks that cut (neon, comic) cut hard
// instead of gliding when the framing changes clearly: a clean cut reads better than a hurried flight.
import { powerOf, type CameraPreset, type ReelLook } from "./model";
import { cinemaWindow } from "./reelStyles";
import { animDur, squareXZ, WHIP_T, type CompiledScene, type ReelShot } from "./timeline";

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The opening overview: the picture is this many squares across (the whole board with a margin) and stays so for this many seconds. */
export const OVERVIEW_ACROSS = 8.8;
export const OVERVIEW_HOLD = 0.7;

/**
 * The camera angles of a scene that cuts (`cameras`), translated to the flat board: how close the picture is
 * (0 = whole board, 1 = very close; kept at 3 squares or more) and how far the horizon leans.
 */
export const PRESET_LOOK: Record<CameraPreset, { cl: number; roll: number }> = {
  white: { cl: 0.2, roll: 0 },
  black: { cl: 0.25, roll: 0 },
  top: { cl: 0.1, roll: 0 },
  corner: { cl: 0.45, roll: 9 },
  side: { cl: 0.55, roll: -12 },
  low: { cl: 0.7, roll: -7 },
  close: { cl: 0.9, roll: 4 },
};

export interface Pose {
  /** Pixels per square. */
  S: number;
  /** Board point in the middle of the picture. */
  x: number;
  z: number;
  /** Tilt of the horizon in degrees. */
  roll: number;
}

interface Key extends Pose {
  t: number;
  /** A hard cut lands on this key: the path jumps here instead of gliding. */
  cut?: boolean;
}

/** How a look moves its camera. */
export interface Grammar {
  /** Seconds a glide from one framing to the next takes. */
  glide: number;
  /** Seconds the camera keeps watching a landing before it glides on. */
  settle: number;
  /** Push-in per second while a framing is held, so a held picture is never dead. */
  creep: number;
  /** Changes smaller than these (zoom as a log factor, centre in squares) are not worth a move: the camera stays where it is. */
  lazyZoom: number;
  lazyShift: number;
  /** The scene changes cut hard when the framing changes clearly (instead of gliding). */
  cuts: boolean;
  /** Seconds from the overview into the first framing (0 = a cut). */
  open: number;
  /** Room kept around every square that must stay in the picture: the square plus the piece standing tall on it. */
  marginX: number;
  marginZ: number;
}

export const GRAMMAR: Record<ReelLook, Grammar> = {
  classic: { glide: 0.6, settle: 0.12, creep: 0.035, lazyZoom: 0.16, lazyShift: 0.9, cuts: false, open: 0.8, marginX: 0.55, marginZ: 0.65 },
  close: { glide: 0.45, settle: 0.1, creep: 0.025, lazyZoom: 0.12, lazyShift: 0.7, cuts: false, open: 1.2, marginX: 0.85, marginZ: 1.2 },
  cinema: { glide: 1.15, settle: 0.25, creep: 0.02, lazyZoom: 0.2, lazyShift: 1.2, cuts: false, open: 1.6, marginX: 1.1, marginZ: 1.3 },
  neon: { glide: 0.3, settle: 0.1, creep: 0.06, lazyZoom: 0.14, lazyShift: 0.8, cuts: true, open: 0, marginX: 0.9, marginZ: 1.2 },
  comic: { glide: 0.3, settle: 0.12, creep: 0, lazyZoom: 0.14, lazyShift: 0.8, cuts: true, open: 0, marginX: 0.95, marginZ: 1.25 },
};

/** The height of the picture the board may use: all of it, except between the cinema look's wide-screen bars. */
export const visibleHeight = (W: number, H: number, look: ReelLook): number => (look === "cinema" ? cinemaWindow(W, H).h : H);

/** The light sway of the horizon in degrees, on the continuous camera clock so it never jumps. */
export function sway(look: ReelLook, t: number): number {
  if (look === "classic") return 13 * Math.sin(t * 0.8) + 7 * Math.sin(t * 0.31 + 1.3);
  if (look === "close") return 1.6 * Math.sin(t * 0.9);
  if (look === "cinema") return 1.4 * Math.sin(t * 0.37 + 0.6);
  return 0;
}

/** Squares across the picture's shorter side for each look's framings: a move, the mating blow, a card, the opening title. */
const ACROSS: Record<Exclude<ReelLook, "classic">, { move: number; mate: number; card: number; title: number }> = {
  close: { move: 4.6, mate: 6.2, card: 8.6, title: 6.8 },
  cinema: { move: 5.8, mate: 7.4, card: 8.6, title: 7.6 },
  neon: { move: 4.4, mate: 6.4, card: 8.6, title: 7 },
  comic: { move: 4.8, mate: 6.6, card: 8.6, title: 7 },
};

/**
 * The framing a scene asks for, before the rig makes it lazy and fits it: centred on what the scene is about (the move, else the arrow,
 * else the mark), as close as the look likes, never closer than both ends of a long move allow.
 */
export function framing(shot: ReelShot, m: number, preset: CameraPreset | null, look: ReelLook, alt = 1): Pose {
  if (look === "classic") return classicFraming(shot, m, preset);
  const a = ACROSS[look];
  const span = shot.move ?? shot.arrow;
  let across = a.move * alt;
  if (preset) across *= 1 + 0.35 * (0.3 - PRESET_LOOK[preset].cl);
  across /= shot.zoom;
  if (shot.effects.includes("mate")) across = Math.max(across, a.mate);
  if (shot.card !== "none") across = a.card;
  // The title shot at the start has no move to frame: it keeps most of the board in view.
  if (shot.index === 0 && !shot.move) across = Math.max(across, a.title);
  let [tx, tz] = [0, 0];
  if (span) {
    const [ax, az] = squareXZ(span.from);
    const [bx, bz] = squareXZ(span.to);
    across = Math.max(across, Math.hypot(bx - ax, bz - az) + 3.4);
    [tx, tz] = [(ax + bx) / 2, (az + bz) / 2];
  } else {
    const sq = shot.fxSquare ?? shot.mark;
    if (sq) [tx, tz] = squareXZ(sq);
  }
  across = Math.min(across, 8.6);
  // The whole board in view stays centred.
  const hold = clamp01((8.6 - across) / 2);
  return { S: m / across, x: tx * hold, z: tz * hold, roll: preset ? PRESET_LOOK[preset].roll * 0.3 : 0 };
}

/** The classic tilted look: a moderate framing chosen by what the scene shows (not by its number, which made the picture pump in and out). */
function classicFraming(shot: ReelShot, m: number, preset: CameraPreset | null): Pose {
  const wide = m / 9.2;
  const near = m / 2.3;
  // The mating blow ends with the whole board in view.
  if (shot.effects.includes("mate") && !shot.move) return { S: wide * 1.12, x: 0, z: 0, roll: 0 };
  let cl = preset ? Math.min(0.55, PRESET_LOOK[preset].cl) : 0.27;
  if (!preset && shot.hero) cl += 0.1;
  cl += (1 - shot.zoom) * 0.5;
  if (shot.effects.includes("spotlight")) cl += 0.05;
  if (shot.card !== "none") cl = 0.08;
  if (shot.index === 0 && !shot.move) cl = Math.min(cl, 0.12);
  let S = Math.exp(lerp(Math.log(wide), Math.log(near), clamp01(cl)));
  let [tx, tz] = [0, 0];
  const span = shot.arrow ?? shot.move;
  if (span) {
    const [ax, az] = squareXZ(span.from);
    const [bx, bz] = squareXZ(span.to);
    S = Math.min(S, (0.6 * m) / (Math.hypot(bx - ax, bz - az) + 1.6));
    [tx, tz] = [(ax + bx) / 2, (az + bz) / 2];
  } else {
    const sq = shot.fxSquare ?? shot.mark;
    if (sq) [tx, tz] = squareXZ(sq);
  }
  const hold = clamp01(((S - wide) / (near - wide)) * 1.4);
  return { S, x: tx * hold, z: tz * hold, roll: preset ? PRESET_LOOK[preset].roll : 0 };
}

/** The squares a scene must keep in the picture: every square its moves touch, its arrows and marks. */
function needed(c: CompiledScene, shot: ReelShot): string[] {
  const out = new Set<string>();
  for (const mv of shot.moves) for (const sq of mv.squares) out.add(sq);
  for (const a of c.scene.arrows) {
    out.add(a.from);
    out.add(a.to);
  }
  for (const mk of c.scene.marks) out.add(mk.square);
  if (!out.size && shot.fxSquare) out.add(shot.fxSquare);
  return [...out];
}

/**
 * The pose moved as little as possible so that all squares fit with their margins: it backs off just enough and slides just enough.
 * Works in the tilted frame of the picture, where the picture is an upright rectangle. `limit` keeps the centre on the board.
 */
export function fitPose(pose: Pose, squares: string[], W: number, H: number, mx: number, mz: number, limit = 3.5): Pose {
  const rad = (pose.roll * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let S = pose.S;
  let [px, pz] = [pose.x, pose.z];
  if (squares.length) {
    const pts = squares.map((sq) => {
      const [x, z] = squareXZ(sq);
      return [x * c - z * s, x * s + z * c] as const;
    });
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const spanX = Math.max(...xs) - Math.min(...xs) + 2 * mx;
    const spanZ = Math.max(...zs) - Math.min(...zs) + 2 * mz;
    S = Math.min(S, W / spanX, H / spanZ);
    const halfX = W / (2 * S) - mx;
    const halfZ = H / (2 * S) - mz;
    const [cx, cz] = [px * c - pz * s, px * s + pz * c];
    const clampTo = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    const fx = clampTo(cx, Math.max(...xs) - halfX, Math.min(...xs) + halfX);
    const fz = clampTo(cz, Math.max(...zs) - halfZ, Math.min(...zs) + halfZ);
    [px, pz] = [fx * c + fz * s, -fx * s + fz * c];
  }
  return { S, x: Math.max(-limit, Math.min(limit, px)), z: Math.max(-limit, Math.min(limit, pz)), roll: pose.roll };
}

/** Does the pose already show all squares with their margins? */
function shows(pose: Pose, squares: string[], W: number, H: number, mx: number, mz: number): boolean {
  const f = fitPose(pose, squares, W, H, mx, mz, 99);
  return Math.abs(f.S - pose.S) < 1e-6 && Math.hypot(f.x - pose.x, f.z - pose.z) < 1e-6;
}

export interface Track {
  /** Keys split into stretches at the hard cuts; inside a stretch the path glides. */
  parts: { keys: Key[]; slopes: number[][] }[];
}

/** The path the camera takes through a whole video. */
export function planTrack(scenes: CompiledScene[], shots: ReelShot[], W: number, H0: number, look: ReelLook): Track {
  const g = GRAMMAR[look];
  // The cinema bars cover part of the frame: only the window between them counts.
  const H = visibleHeight(W, H0, look);
  const m = Math.min(W, H);
  const keys: Key[] = [];
  const add = (t: number, p: Pose, cut = false) => {
    const last = keys[keys.length - 1];
    // Two keys in the same moment: a cut keeps both (the jump), anything else lets the later wish win.
    if (last && t <= last.t + 0.02 && !(cut && t >= last.t)) {
      keys[keys.length - 1] = { ...p, t: last.t, cut: last.cut || cut };
      return;
    }
    keys.push({ ...p, t: Math.max(t, last ? last.t : 0), cut });
  };
  // The centre stays far enough inside that the classic tilted picture shows no black; the other looks may show a little edge.
  // (A move on the edge may show a strip of black: better than cutting the move off.)
  const limitOf = (S: number) => (look === "classic" ? Math.max(0, 5.2 - (m / 2 / S) * 1.1) : 3.1);
  // The classic look sways its horizon by up to twenty degrees: it fits into the part of the picture that stays on screen at any tilt.
  const [fw, fh] = look === "classic" ? [m * 0.92, m * 0.92] : [W, H];
  const fit = (p: Pose, sq: string[]) => {
    const clamped = (q: Pose) => {
      const f = fitPose(q, sq, fw, fh, g.marginX, g.marginZ, 99);
      const lim = limitOf(f.S);
      return { ...f, x: Math.max(-lim, Math.min(lim, f.x)), z: Math.max(-lim, Math.min(lim, f.z)) };
    };
    const first = clamped(p);
    if (shows(first, sq, fw, fh, g.marginX, g.marginZ)) return first;
    // An edge square and "no black around the board" pull against each other: the picture backs off just as far as both hold
    // (searched between this framing and the whole board, where both always hold).
    let [lo, hi] = [Math.min(first.S, m / OVERVIEW_ACROSS), first.S];
    for (let n = 0; n < 16; n++) {
      const mid = Math.sqrt(lo * hi);
      if (shows(clamped({ ...p, S: mid }), sq, fw, fh, g.marginX, g.marginZ)) lo = mid;
      else hi = mid;
    }
    return clamped({ ...p, S: lo });
  };

  const overview: Pose = { S: m / OVERVIEW_ACROSS, x: 0, z: 0, roll: 0 };
  let cur: Pose = overview;
  let curT = 0;
  let curNeed: string[] = [];
  let lastLand = scenes.length ? Math.min(OVERVIEW_HOLD, animDur(scenes[0]) * 0.45) : 0;
  let lastMove: string[] = [];
  add(0, overview);
  add(lastLand, overview);
  curT = lastLand;
  let off = 0;
  let alt = 1;
  /** Holds the current framing until `t`, pushing in slowly as far as the squares still fit. */
  const hold = (t: number) => {
    if (t <= curT) return;
    // Never backs out while holding: a push that would lose a square simply stops.
    // Nor does it slide: the push only goes on while everything stays in the picture where it is.
    const pushed = g.creep ? fit({ ...cur, S: cur.S * Math.exp(g.creep * (t - curT)) }, curNeed) : cur;
    if (pushed.S >= cur.S && Math.hypot(pushed.x - cur.x, pushed.z - cur.z) < 0.02) cur = { ...cur, S: pushed.S };
    add(t, cur);
    curT = t;
  };
  /** Moves to a new framing: by a glide that ends at `t`, or by a hard cut at `t`. */
  const go = (t: number, p: Pose, cut = false) => {
    if (cut) {
      hold(t);
      add(t, p, true);
    } else add(Math.max(t, curT + g.glide * 0.6), p);
    cur = p;
    curT = Math.max(t, curT);
  };

  scenes.forEach((c, i) => {
    const shot = shots[i];
    const D = animDur(c);
    const T0 = off;
    off += D;
    const s = c.scene;
    // Arrows and marks come after the moves: the framing first holds the moves and opens for the rest when they appear.
    const all = needed(c, shot);
    const need = shot.moves.length ? [...new Set(shot.moves.flatMap((mv) => mv.squares))] : all;
    const first = shot.moves[0]?.t0 ?? Math.min(0.3, D * 0.3);
    const lastT1 = shot.moves.length ? shot.moves[shot.moves.length - 1].t1 : first;
    // The camera arrives just before the first piece lifts (at once on a punch-in, which pushes from the scene's first frame).
    let arrive = T0 + (s.effects.includes("punch") ? 0 : Math.max(0, first - 0.08));
    if (i === 0) {
      arrive = Math.max(arrive, lastLand + g.open);
      // A first scene that cuts between angles gets to its first cut: the opening glide is shortened, never the cuts dropped.
      if (s.cameras.length) arrive = Math.min(arrive, Math.max(lastLand + 0.35, T0 + c.cutFrom + (c.cutFrom === 0 ? c.cutIv : 0) - 0.05));
    }
    // The cutting looks alternate tight and wider framings, so a cut always reads as a new picture.
    if (look === "comic" || look === "neon") alt = shot.moves.length ? (alt === 1 ? 1.35 : 1) : 1;
    // A scene that cuts between angles is entered on the angle it shows when the camera arrives.
    const local = arrive - T0;
    const preset = s.cameras.length && local >= c.cutFrom ? s.cameras[Math.min(s.cameras.length - 1, Math.floor((local - c.cutFrom) / c.cutIv + 1e-9))] : shot.entryPreset;
    let want = framing(shot, m, preset, look, alt);
    if (shot.hero) want = heroPose(want, shot.hero.from, shot.hero.to, m, look, 0.25);
    // Repeated beats on the same picture build up: each one a step closer, never back out (the old cycle pumped in and out).
    if (i > 0 && !shot.moves.length && !shot.move && shot.card === "none" && sameFocus(shot, shots[i - 1])) want = { ...want, S: Math.max(want.S, cur.S * 1.12) };
    if (s.effects.includes("dutch")) want = { ...want, roll: want.roll + (i % 2 ? -1 : 1) * 12 * powerOf(s, "dutch") };
    // The glide starts after the last landing has been watched; if the scene comes too quickly it starts earlier and keeps that landing in the picture.
    const start = Math.max(curT + 0.05, arrive - g.glide);
    const early = start < lastLand + g.settle;
    let target = fit(want, early && i > 0 ? [...need, ...lastMove] : need);
    // Lazy: a framing that changes little is not worth a move.
    const small = Math.abs(Math.log(target.S / cur.S)) < g.lazyZoom && Math.hypot(target.x - cur.x, target.z - cur.z) < g.lazyShift && Math.abs(target.roll - cur.roll) < 3;
    if (i > 0 && small && shows(cur, need, fw, fh, g.marginX, g.marginZ)) target = { ...cur, roll: target.roll };
    // A cut only where the picture clearly changes: a cut to almost the same framing is a jump cut, that glides instead.
    const clear = Math.abs(Math.log(target.S / cur.S)) > 0.25 || Math.hypot(target.x - cur.x, target.z - cur.z) > 2;
    const cut = g.cuts && i > 0 && clear;
    if (cut) go(T0, target, true);
    else if (i === 0 && g.open === 0) go(arrive, target, true);
    else {
      hold(Math.min(start, arrive - 0.05));
      go(arrive, target);
    }
    curNeed = need;

    // Inside the scene, in time order.
    const extra: { t: number; f: () => void }[] = [];
    const at = (t: number, f: () => void) => extra.push({ t: T0 + t, f });
    // The scene's cuts between angles: a quick whip from one framing to the next on the beat.
    if (s.cameras.length) {
      s.cameras.forEach((p, k) => {
        if (k === 0 && c.cutFrom === 0) return;
        const since = c.cutFrom + k * c.cutIv;
        if (since >= D) return;
        at(since, () => hold(T0 + since));
        at(since + WHIP_T, () => go(T0 + since + WHIP_T, fit(framing(shot, m, p, look, alt), need), g.cuts));
      });
    }
    // The showcase move: the camera is already close, and slides with the piece from its square to where it lands.
    if (shot.hero) {
      const h = shot.hero;
      at(h.t0, () => hold(T0 + h.t0));
      at(h.t1, () => go(T0 + h.t1, fit({ ...heroPose(framing(shot, m, preset, look, alt), h.from, h.to, m, look, 0.75), roll: cur.roll, S: cur.S * 1.06 }, need)));
    }
    const eff = (kind: Parameters<typeof powerOf>[1]) => s.effects.includes(kind);
    if (eff("punch")) at(0.5, () => go(T0 + 0.5, fit({ ...cur, S: cur.S / (1 - 0.35 * powerOf(s, "punch")) }, need)));
    if (eff("riser")) {
      const end = Math.max(0.4, c.fxAt);
      at(end * 0.55, () => go(T0 + end * 0.55, fit({ ...cur, S: cur.S / (1 - 0.08 * powerOf(s, "riser")) }, need)));
      at(end, () => go(T0 + end, fit({ ...cur, S: cur.S / (1 - 0.22 * powerOf(s, "riser")) }, need)));
    }
    if (eff("zoom") && c.fxAt < D) {
      at(c.fxAt, () => hold(T0 + c.fxAt));
      at(c.fxAt + 0.5, () => go(T0 + c.fxAt + 0.5, fit({ ...cur, S: cur.S * (1 + 0.35 * powerOf(s, "zoom")) }, need), g.cuts));
    }
    // The close looks lean into a threat or the mating blow.
    const lean = look !== "classic" && (eff("threat") || eff("mate"));
    if (lean && c.fxAt < D) {
      at(c.fxAt, () => hold(T0 + c.fxAt));
      at(c.fxAt + 0.6, () => go(T0 + c.fxAt + 0.6, { ...cur, roll: cur.roll + (look === "comic" ? 6 : 12) }));
    }
    if (need.length < all.length) {
      at(c.annotate, () => {
        hold(T0 + c.annotate);
        curNeed = all;
        if (!shows(cur, all, fw, fh, g.marginX, g.marginZ)) go(T0 + c.annotate + g.glide, fit(cur, all));
      });
    }
    // The mating blow: the camera backs off to show the whole board while the pieces break.
    if (eff("mate") && c.fxAt < D) {
      at(c.fxAt + 0.3, () => hold(T0 + c.fxAt + 0.3));
      at(c.fxAt + 1, () => {
        const wide = look === "classic" ? m / 8.2 : m / ACROSS[look].mate;
        go(T0 + c.fxAt + 1, { S: Math.min(cur.S, wide), x: 0, z: 0, roll: cur.roll });
      });
    }
    // A scene that orbits rolls the horizon slowly while it lasts.
    if (s.orbit) at(D, () => go(T0 + D, { ...cur, roll: cur.roll + Math.max(-10, Math.min(10, s.orbit * D * 0.5)) }));
    extra
      .filter((e) => e.t > curT && e.t < T0 + D + 1e-6)
      .sort((a, b) => a.t - b.t)
      .forEach((e) => e.f());
    if (shot.moves.length) {
      lastLand = T0 + lastT1;
      lastMove = shot.moves[shot.moves.length - 1].squares;
    }
  });
  hold(off + 0.01);
  return build(keys);
}

/** The showcase framing: tight enough to feel the piece, wide enough for both ends of its flight, centred `k` of the way along it. */
function heroPose(base: Pose, from: string, to: string, m: number, look: ReelLook, k: number): Pose {
  const [ax, az] = squareXZ(from);
  const [bx, bz] = squareXZ(to);
  const across = Math.max(look === "classic" ? 4.2 : 4.0, Math.hypot(bx - ax, bz - az) + 2.6);
  const mid = [(ax + bx) / 2, (az + bz) / 2];
  const toward = [lerp(ax, bx, k), lerp(az, bz, k)];
  return { S: Math.max(base.S, m / across), x: lerp(mid[0], toward[0], 0.5), z: lerp(mid[1], toward[1], 0.5), roll: base.roll };
}

const sameFocus = (a: ReelShot, b: ReelShot) => (a.mark ?? a.arrow?.to ?? a.fxSquare) === (b.mark ?? b.arrow?.to ?? b.fxSquare);

/** Monotone cubic slopes (Fritsch–Carlson): the curve passes every key, never overshoots, and holds still where the keys do. */
function slopes(ts: number[], ys: number[]): number[] {
  const n = ts.length;
  if (n < 2) return ys.map(() => 0);
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (ts[k + 1] - ts[k]));
  const out = [0];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) out.push(0);
    else {
      const h0 = ts[k] - ts[k - 1];
      const h1 = ts[k + 1] - ts[k];
      out.push((3 * (h0 + h1)) / ((2 * h1 + h0) / d[k - 1] + (h1 + 2 * h0) / d[k]));
    }
  }
  out.push(0);
  return out;
}

const CHANNELS = [(k: Key) => Math.log(k.S), (k: Key) => k.x, (k: Key) => k.z, (k: Key) => k.roll];

function build(keys: Key[]): Track {
  const parts: Track["parts"] = [];
  let run: Key[] = [];
  const close = () => {
    if (!run.length) return;
    const ts = run.map((k) => k.t);
    parts.push({ keys: run, slopes: CHANNELS.map((ch) => slopes(ts, run.map(ch))) });
  };
  for (const k of keys) {
    if (k.cut && run.length) {
      close();
      run = [];
    }
    run.push(k);
  }
  close();
  return { parts };
}

/** The camera's framing at camera time `t` (seconds of animation since the start). */
export function sampleTrack(track: Track, t: number): Pose {
  const parts = track.parts;
  let part = parts[0];
  for (const p of parts) if (p.keys[0].t <= t) part = p;
  const ks = part.keys;
  if (t <= ks[0].t) return { S: ks[0].S, x: ks[0].x, z: ks[0].z, roll: ks[0].roll };
  const last = ks[ks.length - 1];
  if (t >= last.t) return { S: last.S, x: last.x, z: last.z, roll: last.roll };
  let lo = 0;
  let hi = ks.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ks[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = ks[lo];
  const b = ks[hi];
  const h = b.t - a.t;
  const u = (t - a.t) / h;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  const v = CHANNELS.map((ch, i) => h00 * ch(a) + h10 * h * part.slopes[i][lo] + h01 * ch(b) + h11 * h * part.slopes[i][hi]);
  return { S: Math.exp(v[0]), x: v[1], z: v[2], roll: v[3] };
}

const cache = new WeakMap<object, Map<string, Track>>();
/** The track of a video, planned once per compiled timeline, picture size and look. */
export function trackOf(owner: object, scenes: CompiledScene[], shots: ReelShot[], W: number, H: number, look: ReelLook): Track {
  let byKey = cache.get(owner);
  if (!byKey) cache.set(owner, (byKey = new Map()));
  const key = `${W}x${H}:${look}`;
  let tr = byKey.get(key);
  if (!tr) byKey.set(key, (tr = planTrack(scenes, shots, W, H, look)));
  return tr;
}
