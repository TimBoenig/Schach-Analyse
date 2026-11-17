// The studio's 3D chess set, built from code like the site's other 3D objects
// (lathe profiles plus one extruded knight head): no model files, nothing to
// license. Vertex colours are white; the renderer tints each side.
import { box, lathe, merge, STRIDE, type Material, type Mesh, type ProfilePoint } from "../three/mesh";
import type { PieceSymbol } from "chess.js";

const WHITE: Material = { color: [1, 1, 1], metal: 0 };

function arc(cx: number, cy: number, r: number, from: number, to: number, n: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    out.push([Math.max(0, cx + r * Math.cos(a)), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Round foot shared by every piece: a wide disc with a soft bevel and a step. */
function foot(r: number): ProfilePoint[] {
  return [
    [0, 0],
    [r, 0],
    [r + 0.012, 0.035],
    [r - 0.005, 0.075],
    [r * 0.86, 0.1],
    [r * 0.86, 0.125],
    [r * 0.78, 0.15],
  ];
}

export function translate(mesh: Mesh, dx: number, dy: number, dz: number): Mesh {
  const vertices = mesh.vertices.slice();
  for (let i = 0; i < vertices.length; i += STRIDE) {
    vertices[i] += dx;
    vertices[i + 1] += dy;
    vertices[i + 2] += dz;
  }
  return { vertices, indices: mesh.indices.slice() };
}

const sphere = (r: number, segments = 18) => lathe(arc(0, 0, r, -90, 90, 10), WHITE, segments);

/** Ear clipping for a simple polygon (counter-clockwise or clockwise). */
export function triangulate(poly: [number, number][]): number[] {
  const area = poly.reduce((s, [x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length];
    return s + x * ny - nx * y;
  }, 0);
  const idx = poly.map((_, i) => i);
  if (area < 0) idx.reverse();
  const out: number[] = [];
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const [a, b, c] = [poly[ia], poly[ib], poly[ic]];
      const convex = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      if (!convex) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c))) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/**
 * Extrudes a side outline (points as [z, y]) to a slab of the given thickness
 * along x, with flat sides and crisp edges, plus a narrow bevel band so the
 * edges catch the light.
 */
export function extrude(outline: [number, number][], thickness: number, material: Material, bevel = 0.025): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  const h = thickness / 2;
  const tri = triangulate(outline);
  // Centre of the outline, to pull the bevel inwards.
  const cz = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  const shrink = (p: [number, number]): [number, number] => {
    const dz = cz - p[0];
    const dy = cy - p[1];
    const l = Math.hypot(dz, dy) || 1;
    return [p[0] + (dz / l) * bevel, p[1] + (dy / l) * bevel];
  };
  for (const side of [-1, 1]) {
    const base = vertices.length / STRIDE;
    for (const p of outline) {
      const [z, y] = shrink(p);
      vertices.push(side * h, y, z, side, 0, 0, ...material.color, material.metal);
    }
    for (let i = 0; i < tri.length; i += 3) {
      if (side > 0) indices.push(base + tri[i], base + tri[i + 1], base + tri[i + 2]);
      else indices.push(base + tri[i], base + tri[i + 2], base + tri[i + 1]);
    }
  }
  const n = outline.length;
  const area = outline.reduce((s, [x, y], i) => s + x * outline[(i + 1) % n][1] - outline[(i + 1) % n][0] * y, 0);
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dz, dy) || 1;
    // Outward normal of this edge in the (z, y) plane.
    const nz = (dy / l) * sign;
    const ny = (-dz / l) * sign;
    const sa = shrink(a);
    const sb = shrink(b);
    // Wall (inner part of the thickness) and two bevel strips towards each face.
    const rows: [number, [number, number], [number, number], number][] = [
      [-h + bevel, a, b, 0],
      [h - bevel, a, b, 0],
    ];
    const base = vertices.length / STRIDE;
    for (const [x, pa, pb] of rows) {
      vertices.push(x, pa[1], pa[0], 0, ny, nz, ...material.color, material.metal);
      vertices.push(x, pb[1], pb[0], 0, ny, nz, ...material.color, material.metal);
    }
    indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    for (const side of [-1, 1]) {
      const bb = vertices.length / STRIDE;
      const nx = side * 0.7071;
      const k = 0.7071;
      vertices.push(side * (h - bevel), a[1], a[0], nx, ny * k, nz * k, ...material.color, material.metal);
      vertices.push(side * (h - bevel), b[1], b[0], nx, ny * k, nz * k, ...material.color, material.metal);
      vertices.push(side * h, sa[1], sa[0], nx, ny * k, nz * k, ...material.color, material.metal);
      vertices.push(side * h, sb[1], sb[0], nx, ny * k, nz * k, ...material.color, material.metal);
      if (side > 0) indices.push(bb, bb + 1, bb + 3, bb, bb + 3, bb + 2);
      else indices.push(bb, bb + 3, bb + 1, bb, bb + 2, bb + 3);
    }
  }
  // Normalise the bevel normals.
  for (let i = 0; i < vertices.length; i += STRIDE) {
    const l = Math.hypot(vertices[i + 3], vertices[i + 4], vertices[i + 5]) || 1;
    vertices[i + 3] /= l;
    vertices[i + 4] /= l;
    vertices[i + 5] /= l;
  }
  return { vertices, indices };
}

function pawn(): Mesh {
  return lathe(
    [...foot(0.3), [0.2, 0.19], [0.14, 0.27], [0.105, 0.37], [0.165, 0.405], [0.165, 0.43], [0.1, 0.455], ...arc(0, 0.575, 0.135, -62, 90, 12)],
    WHITE,
  );
}

function rook(): Mesh {
  const body = lathe(
    [...foot(0.34), [0.25, 0.2], [0.22, 0.32], [0.215, 0.56], [0.24, 0.6], [0.3, 0.63], [0.3, 0.68], [0.27, 0.7], [0.27, 0.8], [0.19, 0.8], [0.19, 0.74], [0, 0.74]],
    WHITE,
  );
  const crenels = [
    box([0.235, 0.85, 0], [0.07, 0.1, 0.17], WHITE),
    box([-0.235, 0.85, 0], [0.07, 0.1, 0.17], WHITE),
    box([0, 0.85, 0.235], [0.17, 0.1, 0.07], WHITE),
    box([0, 0.85, -0.235], [0.17, 0.1, 0.07], WHITE),
  ];
  return merge(body, ...crenels);
}

function bishop(): Mesh {
  const body = lathe(
    [
      ...foot(0.32), [0.22, 0.19], [0.16, 0.3], [0.115, 0.46], [0.1, 0.55], [0.2, 0.58], [0.2, 0.615], [0.12, 0.64],
      [0.15, 0.7], [0.175, 0.78], [0.165, 0.86], [0.13, 0.93], [0.07, 0.99], [0.035, 1.0], [0, 1.0],
    ],
    WHITE,
  );
  return merge(body, translate(sphere(0.055), 0, 1.04, 0));
}

function queen(): Mesh {
  const body = lathe(
    [
      ...foot(0.36), [0.25, 0.2], [0.18, 0.33], [0.13, 0.55], [0.115, 0.7], [0.22, 0.735], [0.22, 0.775], [0.14, 0.8],
      [0.17, 0.9], [0.235, 1.0], [0.25, 1.03], [0.215, 1.04], [0.15, 1.06], [0.09, 1.1], [0, 1.115],
    ],
    WHITE,
  );
  const balls: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    balls.push(translate(sphere(0.034, 12), Math.cos(a) * 0.235, 1.055, Math.sin(a) * 0.235));
  }
  return merge(body, translate(sphere(0.06), 0, 1.16, 0), ...balls);
}

function king(): Mesh {
  const body = lathe(
    [
      ...foot(0.37), [0.26, 0.2], [0.19, 0.34], [0.14, 0.56], [0.125, 0.73], [0.23, 0.765], [0.23, 0.805], [0.15, 0.83],
      [0.18, 0.93], [0.225, 1.03], [0.215, 1.07], [0.13, 1.1], [0.09, 1.13], [0, 1.135],
    ],
    WHITE,
  );
  const cross = merge(box([0, 1.26, 0], [0.065, 0.26, 0.065], WHITE), box([0, 1.29, 0], [0.2, 0.065, 0.065], WHITE));
  return merge(body, cross);
}

function knight(): Mesh {
  const base = lathe([...foot(0.34), [0.25, 0.2], [0.22, 0.24], [0, 0.24]], WHITE);
  // Side outline of the horse's head, nose pointing to -z (towards the opponent of White).
  const head: [number, number][] = [
    [0.24, 0.22], [0.27, 0.42], [0.25, 0.62], [0.2, 0.8], [0.13, 0.92], [0.12, 1.02], [0.07, 0.96],
    [0.01, 0.97], [-0.08, 0.92], [-0.18, 0.82], [-0.27, 0.71], [-0.31, 0.63], [-0.27, 0.56], [-0.19, 0.57],
    [-0.11, 0.6], [-0.06, 0.53], [-0.12, 0.42], [-0.17, 0.3], [-0.18, 0.22],
  ];
  return merge(base, extrude(head, 0.3, WHITE, 0.035));
}

const BUILD: Record<PieceSymbol, () => Mesh> = { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
const cache = new Map<PieceSymbol, Mesh>();

export function pieceMesh(type: PieceSymbol): Mesh {
  let m = cache.get(type);
  if (!m) {
    m = BUILD[type]();
    cache.set(type, m);
  }
  return m;
}
