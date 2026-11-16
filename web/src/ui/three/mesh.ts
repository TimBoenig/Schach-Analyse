// Tiny mesh toolkit for the site's 3D objects: turned shapes (chess pieces, a
// cup) and boxes. Pure maths, no WebGL, so shapes can be tested.

/** Vertex layout: position xyz, normal xyz, colour rgb, metalness (10 floats). */
export const STRIDE = 10;

export interface Material {
  /** Linear-ish RGB, 0..1. */
  color: [number, number, number];
  /** 0 = porcelain/plastic, 1 = polished metal. */
  metal: number;
}

export interface Mesh {
  vertices: number[];
  indices: number[];
}

/** Profile point of a turned shape: distance from the axis and height. */
export type ProfilePoint = [r: number, y: number];

// Neighbouring profile segments that bend more than this get a hard edge.
const CREASE = Math.cos((38 * Math.PI) / 180);

/**
 * Turns a profile (bottom to top) around the vertical axis, like wood on a
 * lathe. Gentle bends are shaded smoothly, sharp ones keep a crisp edge.
 */
export function lathe(profile: ProfilePoint[], material: Material, segments = 56): Mesh {
  // Outward normal of each profile segment in the (r, y) plane.
  const segNormals = profile.slice(1).map(([r, y], i) => {
    const dr = r - profile[i][0];
    const dy = y - profile[i][1];
    const len = Math.hypot(dr, dy) || 1;
    return [dy / len, -dr / len] as [number, number];
  });
  // Rings: [r, y, nr, ny]; a crease point produces two rings with different normals.
  const rings: [number, number, number, number][] = [];
  /** Index of the ring that ends segment i, and of the ring that starts it. */
  const startRing: number[] = [];
  const endRing: number[] = [];
  profile.forEach(([r, y], i) => {
    const before = segNormals[i - 1];
    const after = segNormals[i];
    if (before && after && before[0] * after[0] + before[1] * after[1] >= CREASE) {
      const nr = before[0] + after[0];
      const ny = before[1] + after[1];
      const len = Math.hypot(nr, ny) || 1;
      rings.push([r, y, nr / len, ny / len]);
      endRing[i - 1] = rings.length - 1;
      startRing[i] = rings.length - 1;
      return;
    }
    if (before) {
      rings.push([r, y, before[0], before[1]]);
      endRing[i - 1] = rings.length - 1;
    }
    if (after) {
      rings.push([r, y, after[0], after[1]]);
      startRing[i] = rings.length - 1;
    }
  });
  const vertices: number[] = [];
  const cols = segments + 1;
  for (const [r, y, nr, ny] of rings) {
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      vertices.push(r * c, y, r * sn, nr * c, ny, nr * sn, ...material.color, material.metal);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segNormals.length; i++) {
    const a = startRing[i] * cols;
    const b = endRing[i] * cols;
    for (let s = 0; s < segments; s++) {
      indices.push(a + s, b + s, a + s + 1, a + s + 1, b + s, b + s + 1);
    }
  }
  return { vertices, indices };
}

/** Axis-aligned box given by its centre and size. */
export function box(center: [number, number, number], size: [number, number, number], material: Material): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  const h = size.map((v) => v / 2);
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const base = vertices.length / STRIDE;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 0, 0];
        p[axis] = center[axis] + sign * h[axis];
        p[u] = center[u] + su * h[u];
        p[v] = center[v] + sv * h[v];
        const n = [0, 0, 0];
        n[axis] = sign;
        vertices.push(...p, ...n, ...material.color, material.metal);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { vertices, indices };
}

export function merge(...meshes: Mesh[]): Mesh {
  const out: Mesh = { vertices: [], indices: [] };
  for (const m of meshes) {
    const offset = out.vertices.length / STRIDE;
    for (const v of m.vertices) out.vertices.push(v);
    for (const i of m.indices) out.indices.push(i + offset);
  }
  return out;
}

/** Lowest and highest point and the widest radius, to frame a model in the camera. */
export function bounds(mesh: Mesh): { minY: number; maxY: number; radius: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  let radius = 0;
  for (let i = 0; i < mesh.vertices.length; i += STRIDE) {
    minY = Math.min(minY, mesh.vertices[i + 1]);
    maxY = Math.max(maxY, mesh.vertices[i + 1]);
    radius = Math.max(radius, Math.hypot(mesh.vertices[i], mesh.vertices[i + 2]));
  }
  return { minY, maxY, radius };
}
