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

// Marked parts (vertex "metal" 0.5) are drawn in a contrasting shade of the piece colour by the renderer.
const DETAIL: Material = { color: [1, 1, 1], metal: 0.5 };

/** Radius of a lathe profile at height y (profiles go upwards). */
function radiusAt(profile: ProfilePoint[], y: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1];
    const [r1, y1] = profile[i];
    if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) return y1 === y0 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

/**
 * A band lying on a lathe surface along a tilted plane (y = y0 + slope * z):
 * how the bishop's mitre slit reads from every side.
 */
export function slitBand(profile: ProfilePoint[], y0: number, slope: number, width: number, material: Material, segments = 48): Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const [cx, cz] = [Math.cos(a), Math.sin(a)];
    for (const side of [-1, 1]) {
      // Find where the plane meets the surface in this direction (fixed point on the radius).
      let r = radiusAt(profile, y0);
      for (let k = 0; k < 8; k++) r = radiusAt(profile, y0 + slope * r * cz + side * width);
      const y = y0 + slope * r * cz + side * width;
      const rr = r * 1.012 + 0.002;
      const nl = Math.hypot(1, 0.2);
      vertices.push(rr * cx, y, rr * cz, cx / nl, 0.2 / nl, cz / nl, ...material.color, material.metal);
    }
    if (i > 0) {
      const b = (i - 1) * 2;
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  return { vertices, indices };
}

/** Crown points for the queen: small upright cones on a ring. */
function crownPoints(count: number, ring: number, y: number, r: number, h: number): Mesh[] {
  const out: Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const cone = lathe([[0, 0], [r, 0], [r * 0.55, h * 0.55], [0.012, h], [0, h]], WHITE, 14);
    out.push(translate(cone, Math.cos(a) * ring, y, Math.sin(a) * ring), translate(sphere(r * 0.55, 10), Math.cos(a) * ring, y + h, Math.sin(a) * ring));
  }
  return out;
}

// Heights rise clearly from pawn to king, and each piece has its own head
// (ball, battlements, horse, slit mitre, spiked crown, cross) so they can be told apart at a glance.
function pawn(): Mesh {
  return lathe(
    [...foot(0.29), [0.2, 0.18], [0.15, 0.25], [0.11, 0.34], [0.09, 0.39], [0.17, 0.41], [0.17, 0.445], [0.095, 0.47], ...arc(0, 0.585, 0.13, -64, 90, 14)],
    WHITE,
  );
}

function rook(): Mesh {
  const body = lathe(
    [...foot(0.34), [0.26, 0.19], [0.23, 0.3], [0.215, 0.55], [0.25, 0.59], [0.31, 0.62], [0.31, 0.66], [0.29, 0.68], [0.29, 0.79], [0.2, 0.79], [0.2, 0.73], [0, 0.73]],
    WHITE,
  );
  const crenels: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    crenels.push(box([Math.cos(a) * 0.245, 0.85, Math.sin(a) * 0.245], [0.13, 0.13, 0.13], WHITE));
  }
  return merge(body, ...crenels);
}

const BISHOP: ProfilePoint[] = [
  ...foot(0.31), [0.21, 0.19], [0.15, 0.3], [0.11, 0.46], [0.095, 0.56], [0.19, 0.59], [0.19, 0.625], [0.11, 0.65],
  [0.14, 0.7], [0.175, 0.78], [0.18, 0.86], [0.16, 0.94], [0.12, 1.01], [0.07, 1.06], [0.03, 1.08], [0, 1.08],
];

function bishop(): Mesh {
  const body = lathe(BISHOP, WHITE);
  return merge(body, slitBand(BISHOP, 0.9, 0.75, 0.014, DETAIL), translate(sphere(0.055), 0, 1.12, 0));
}

function queen(): Mesh {
  const body = lathe(
    [
      ...foot(0.36), [0.25, 0.2], [0.18, 0.33], [0.13, 0.55], [0.115, 0.72], [0.22, 0.755], [0.22, 0.795], [0.14, 0.82],
      [0.17, 0.92], [0.24, 1.03], [0.255, 1.06], [0.2, 1.07], [0.13, 1.09], [0.08, 1.13], [0, 1.15],
    ],
    WHITE,
  );
  return merge(body, ...crownPoints(8, 0.215, 1.04, 0.045, 0.11), translate(sphere(0.07), 0, 1.2, 0));
}

function king(): Mesh {
  const body = lathe(
    [
      ...foot(0.37), [0.26, 0.2], [0.19, 0.34], [0.14, 0.56], [0.125, 0.74], [0.23, 0.775], [0.23, 0.815], [0.15, 0.84],
      [0.18, 0.95], [0.235, 1.06], [0.22, 1.1], [0.14, 1.13], [0.1, 1.17], [0, 1.18],
    ],
    WHITE,
  );
  const cross = merge(box([0, 1.36, 0], [0.085, 0.36, 0.085], WHITE), box([0, 1.4, 0], [0.27, 0.085, 0.085], WHITE));
  return merge(body, cross);
}

function knight(): Mesh {
  const base = lathe([...foot(0.34), [0.25, 0.2], [0.22, 0.24], [0, 0.24]], WHITE);
  // Side outline of the horse's head, nose pointing to -z (towards the opponent of White).
  const head: [number, number][] = [
    [0.25, 0.22], [0.28, 0.42], [0.27, 0.6], [0.23, 0.78], [0.16, 0.92], [0.15, 1.06], [0.09, 0.99],
    [0.02, 1.0], [-0.08, 0.95], [-0.19, 0.85], [-0.29, 0.73], [-0.34, 0.64], [-0.3, 0.56], [-0.2, 0.56],
    [-0.11, 0.59], [-0.06, 0.52], [-0.12, 0.42], [-0.18, 0.3], [-0.19, 0.22],
  ];
  // Mane: a narrower ridge along the back of the neck.
  const mane: [number, number][] = [
    [0.27, 0.36], [0.31, 0.5], [0.3, 0.66], [0.25, 0.82], [0.18, 0.95], [0.13, 0.9], [0.2, 0.76], [0.23, 0.6], [0.23, 0.44],
  ];
  const eyes = [-1, 1].map((side) => translate(sphere(0.03, 10), side * 0.16, 0.85, -0.06)).map((m) => recolor(m, DETAIL));
  return merge(base, extrude(head, 0.32, WHITE, 0.04), extrude(mane, 0.12, WHITE, 0.03), ...eyes);
}

function recolor(mesh: Mesh, material: Material): Mesh {
  const vertices = mesh.vertices.slice();
  for (let i = 0; i < vertices.length; i += STRIDE) {
    vertices[i + 6] = material.color[0];
    vertices[i + 7] = material.color[1];
    vertices[i + 8] = material.color[2];
    vertices[i + 9] = material.metal;
  }
  return { vertices, indices: mesh.indices.slice() };
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
