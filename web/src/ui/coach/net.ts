// Geometry of Mike's "mind": a small neural network inside a glass sphere.
// Pure maths (no DOM), so the drawing code in orb.ts stays thin and this part is testable.

export type Mood = "happy" | "think" | "wow" | "sad";

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

export interface Net {
  nodes: Vec3[];
  /** Pairs of node indices, each pair once (a < b). */
  edges: [number, number][];
  /** For every node the edges that touch it, as indices into `edges`. */
  links: number[][];
}

/** Small deterministic generator: every avatar shows the same network on every visit. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const dist2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * Neurons spread evenly inside a sphere of the given radius (two shells and a
 * core, so the network has depth), each wired to its nearest neighbours. A
 * chain through all nodes guarantees that a signal can reach every neuron.
 */
export function buildNet(count: number, radius = 0.76, seed = 11): Net {
  const rand = rng(seed);
  const nodes: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    // Fibonacci sphere: even spread without clumps at the poles.
    const y = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(1 - y * y);
    const a = i * golden;
    // Every third neuron sits deeper inside.
    const r = radius * (i % 3 === 2 ? 0.42 + rand() * 0.16 : 0.86 + rand() * 0.14);
    nodes.push([Math.cos(a) * ring * r, y * r, Math.sin(a) * ring * r]);
  }
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  const add = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(a < b ? [a, b] : [b, a]);
  };
  const perNode = count > 16 ? 3 : 2;
  nodes.forEach((n, i) => {
    const near = nodes
      .map((m, j) => [dist2(n, m), j] as [number, number])
      .filter(([, j]) => j !== i)
      .sort((x, y) => x[0] - y[0]);
    for (let k = 0; k < perNode && k < near.length; k++) add(i, near[k][1]);
  });
  // Nearest-neighbour wiring can leave islands; link each node to the closest earlier one.
  for (let i = 1; i < count; i++) {
    let best = 0;
    for (let j = 1; j < i; j++) if (dist2(nodes[i], nodes[j]) < dist2(nodes[i], nodes[best])) best = j;
    add(i, best);
  }
  const links: number[][] = nodes.map(() => []);
  edges.forEach(([a, b], e) => {
    links[a].push(e);
    links[b].push(e);
  });
  return { nodes, edges, links };
}

/** Turns a point around the vertical axis (yaw), then tips it forward/back (pitch). */
export function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x = p[0] * cy + p[2] * sy;
  const z = -p[0] * sy + p[2] * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [x, p[1] * cp - z * sp, p[1] * sp + z * cp];
}

/**
 * Perspective view from a camera on the +z axis: returns screen offsets in
 * sphere radii (y pointing down) and a scale that is larger for near points.
 */
export function project(p: Vec3, camera = 3.4): { x: number; y: number; scale: number } {
  const scale = camera / (camera - p[2]);
  return { x: p[0] * scale, y: -p[1] * scale, scale };
}

export interface MoodLook {
  /** Main and second light colour. */
  a: Rgb;
  b: Rgb;
  /** Signals running through the network at once (for the largest avatar). */
  signals: number;
  /** Signal speed in edges per second. */
  speed: number;
  /** Turns per second of the network. */
  spin: number;
  /** Overall brightness, 0..1. */
  glow: number;
  /** Where Mike looks when nothing else draws his attention (x right, y up, -1..1). */
  gaze: [number, number];
  /** Eye height and width relative to the default eye. */
  eyeH: number;
  eyeW: number;
  /** Outer eye corners drop by this much (sad eyes). */
  droop: number;
}

export const MOODS: Record<Mood, MoodLook> = {
  happy: { a: [64, 224, 190], b: [70, 150, 255], signals: 5, speed: 2.2, spin: 0.045, glow: 0.85, gaze: [0, 0], eyeH: 1, eyeW: 1, droop: 0 },
  think: { a: [128, 140, 255], b: [190, 120, 255], signals: 8, speed: 3.4, spin: 0.09, glow: 0.8, gaze: [0.45, 0.5], eyeH: 0.62, eyeW: 1, droop: 0 },
  wow: { a: [255, 205, 96], b: [255, 140, 70], signals: 10, speed: 4.2, spin: 0.12, glow: 1, gaze: [0, 0.1], eyeH: 1.22, eyeW: 1.22, droop: 0 },
  sad: { a: [255, 128, 118], b: [150, 110, 190], signals: 2, speed: 1.1, spin: 0.02, glow: 0.5, gaze: [-0.1, -0.5], eyeH: 0.8, eyeW: 1, droop: 0.32 },
};

const NUMERIC = ["signals", "speed", "spin", "glow", "eyeH", "eyeW", "droop"] as const;

/** Moves a look a step `k` (0..1) towards a target, so a mood change glides instead of jumping. */
export function blendLook(from: MoodLook, to: MoodLook, k: number): MoodLook {
  const mix = (x: number, y: number) => x + (y - x) * k;
  const out = { ...from };
  for (const key of NUMERIC) out[key] = mix(from[key], to[key]);
  out.a = [mix(from.a[0], to.a[0]), mix(from.a[1], to.a[1]), mix(from.a[2], to.a[2])];
  out.b = [mix(from.b[0], to.b[0]), mix(from.b[1], to.b[1]), mix(from.b[2], to.b[2])];
  out.gaze = [mix(from.gaze[0], to.gaze[0]), mix(from.gaze[1], to.gaze[1])];
  return out;
}

/** How many neurons an avatar of this size (CSS px) shows: tiny ones stay readable. */
export function nodeCount(size: number): number {
  if (size <= 32) return 9;
  if (size <= 60) return 18;
  return 34;
}
