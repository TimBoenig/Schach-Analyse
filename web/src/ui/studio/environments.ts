// 3D surroundings for the studio board, built from boxes and turned shapes
// like the pieces: a stage podium, a wooden table with a chess clock, a neon
// arena, a tournament hall and a library. Pure geometry (no WebGL), so the
// shapes can be tested; the renderer adds light, glow and distance haze.
import { box, lathe, merge, type Material, type Mesh, type ProfilePoint } from "../three/mesh";
import type { Environment } from "./model";
import { translate } from "./pieces";

export interface EnvPart {
  mesh: Mesh;
  /** Light the part gives off itself (linear RGB), for lamps and neon. */
  glow?: [number, number, number];
  gloss?: number;
}

export interface EnvLine {
  /** A glowing line on the floor: start and end (x, z) and its height. */
  a: [number, number];
  b: [number, number];
  y: number;
  width: number;
}

export interface EnvScene {
  parts: EnvPart[];
  lines: EnvLine[];
  /** Where the haze starts and where it covers everything (distance from the board's centre). */
  fog: [number, number];
  /** Haze colour; without it the video background colour. */
  fogColor?: string;
}

/** Bottom of the board's plinth: everything the board stands on has its top here. */
export const BOARD_FOOT = -0.44;

const lin = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => Math.pow(c, 2.2)) as [number, number, number];
};
const mat = (hex: string, metal = 0): Material => ({ color: lin(hex), metal });

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** A room seen from inside: floor, four walls and a ceiling. */
function room(size: number, height: number, floorY: number, wall: Material, floor: Material, ceiling: Material): Mesh[] {
  const h = size / 2;
  const t = 0.4;
  return [
    box([0, floorY - t / 2, 0], [size, t, size], floor),
    box([0, floorY + height + t / 2, 0], [size, t, size], ceiling),
    box([0, floorY + height / 2, -h], [size, height, t], wall),
    box([0, floorY + height / 2, h], [size, height, t], wall),
    box([-h, floorY + height / 2, 0], [t, height, size], wall),
    box([h, floorY + height / 2, 0], [t, height, size], wall),
  ];
}

function podium(accent: string): EnvScene {
  const top = BOARD_FOOT;
  const stone = mat("#1a1d27");
  const step: ProfilePoint[] = [
    [0, top],
    [7.1, top],
    [7.25, top - 0.08],
    [7.25, top - 0.55],
    [8.4, top - 0.6],
    [8.55, top - 0.7],
    [8.55, top - 1.15],
    [0, top - 1.15],
  ];
  const ring = lathe(
    [
      [7.27, top - 0.12],
      [7.33, top - 0.2],
      [7.33, top - 0.3],
      [7.27, top - 0.38],
    ],
    mat("#ffffff"),
    96,
  );
  const lower = lathe(
    [
      [8.57, top - 0.74],
      [8.62, top - 0.8],
      [8.57, top - 0.86],
    ],
    mat("#ffffff"),
    96,
  );
  const floor = box([0, top - 1.2, 0], [140, 0.1, 140], mat("#07080c"));
  // Tall light columns far away, like a TV studio.
  const columns: Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    columns.push(box([Math.cos(a) * 34, top + 6, Math.sin(a) * 34], [0.5, 16, 0.5], mat("#ffffff")));
  }
  const c = lin(accent);
  return {
    parts: [
      { mesh: lathe(step, stone, 96), gloss: 0.9 },
      { mesh: floor, gloss: 0.6 },
      { mesh: merge(ring, lower), glow: c.map((v) => v * 2.2) as [number, number, number] },
      { mesh: merge(...columns), glow: [0.55, 0.6, 0.85] },
    ],
    lines: [],
    fog: [16, 62],
  };
}

function table(): EnvScene {
  const top = BOARD_FOOT;
  const wood = mat("#6b4329");
  const dark = mat("#2a1a10");
  const floorY = top - 7.6;
  const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => box([sx * 8.2, (top + floorY) / 2 - 0.25, sz * 5.6], [0.7, top - floorY - 0.5, 0.7], dark)));
  // Chess clock: dark case, two white faces, two buttons (one lit).
  const cx = 6.6;
  const cz = -1.2;
  const clock = merge(
    box([cx, top + 0.6, cz], [1.2, 1.2, 3.0], mat("#16171c")),
    box([cx - 0.61, top + 0.7, cz - 0.7], [0.04, 0.7, 1.0], mat("#f2f0ea")),
    box([cx - 0.61, top + 0.7, cz + 0.7], [0.04, 0.7, 1.0], mat("#f2f0ea")),
    box([cx, top + 1.27, cz + 0.7], [0.35, 0.16, 0.35], mat("#16171c")),
  );
  const button = box([cx, top + 1.3, cz - 0.7], [0.35, 0.2, 0.35], mat("#ffffff"));
  // A mug of coffee.
  const mug = merge(
    lathe(
      [
        [0, top],
        [0.48, top],
        [0.5, top + 0.05],
        [0.5, top + 1.05],
        [0.44, top + 1.05],
        [0.44, top + 0.18],
        [0, top + 0.18],
      ],
      mat("#e9e6df"),
      40,
    ),
    box([0.62, top + 0.55, 0], [0.14, 0.55, 0.12], mat("#e9e6df")),
  );
  const coffee = lathe(
    [
      [0, top + 0.86],
      [0.44, top + 0.86],
    ],
    mat("#2b1a10"),
    40,
  );
  const walls = room(70, 22, floorY, mat("#2a2420"), mat("#3a2a1f"), mat("#15120f"));
  return {
    parts: [
      { mesh: box([0, top - 0.25, 0], [18, 0.5, 13], wood), gloss: 0.8 },
      { mesh: merge(...legs) },
      { mesh: clock, gloss: 0.9 },
      { mesh: button, glow: [1.4, 0.5, 0.3] },
      { mesh: translate(merge(mug, coffee), -6.3, 0, 3.2), gloss: 1 },
      { mesh: merge(...walls), gloss: 0.2 },
    ],
    lines: [],
    fog: [14, 40],
    fogColor: "#1c1611",
  };
}

function neon(accent: string): EnvScene {
  const top = BOARD_FOOT;
  const lines: EnvLine[] = [];
  for (let i = -15; i <= 15; i++) {
    lines.push({ a: [i * 2.5, -40], b: [i * 2.5, 40], y: top + 0.01, width: 0.05 });
    lines.push({ a: [-40, i * 2.5], b: [40, i * 2.5], y: top + 0.01, width: 0.05 });
  }
  const pillars: Mesh[] = [];
  const cyan: Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = box([Math.cos(a) * 28, top + 5, Math.sin(a) * 28], [0.35, 10, 0.35], mat("#ffffff"));
    (i % 2 ? cyan : pillars).push(p);
  }
  const c = lin(accent);
  return {
    parts: [
      { mesh: box([0, top - 0.05, 0], [160, 0.1, 160], mat("#05050b")), gloss: 1 },
      { mesh: merge(...pillars), glow: c.map((v) => v * 2.5) as [number, number, number] },
      { mesh: merge(...cyan), glow: [1.6, 0.4, 1.4] },
    ],
    lines,
    fog: [14, 44],
  };
}

function hall(): EnvScene {
  const top = BOARD_FOOT;
  const floorY = top - 7.6;
  const r = rng(5);
  const tables: Mesh[] = [];
  const boards: Mesh[] = [];
  const chairs: Mesh[] = [];
  for (let row = -2; row <= 2; row++) {
    for (let col = -2; col <= 2; col++) {
      const x = col * 22;
      const z = row * 16;
      if (Math.hypot(x, z) < 20) continue;
      tables.push(box([x, top - 0.25, z], [14, 0.5, 9], mat("#d9d5cc")), box([x, (top + floorY) / 2, z], [12, top - floorY - 0.5, 0.4], mat("#8d8a84")));
      boards.push(box([x, top + 0.05, z], [8.4, 0.2, 8.4], mat(r() > 0.5 ? "#3b4252" : "#56483a")));
      for (const side of [-1, 1]) chairs.push(box([x, floorY + 2.4, z + side * 7], [3.4, 4.8, 3.2], mat("#2f3644")));
    }
  }
  const lamps: Mesh[] = [];
  for (let i = -3; i <= 3; i++) lamps.push(box([i * 16, floorY + 25.6, 0], [10, 0.2, 60], mat("#ffffff")));
  return {
    parts: [
      { mesh: box([0, top - 0.25, 0], [16, 0.5, 11], mat("#e3dfd6")), gloss: 0.6 },
      { mesh: box([0, (top + floorY) / 2, 0], [14, top - floorY - 0.5, 0.4], mat("#8d8a84")) },
      { mesh: merge(...tables), gloss: 0.5 },
      { mesh: merge(...boards) },
      { mesh: merge(...chairs) },
      { mesh: merge(...room(130, 26, floorY, mat("#c7c2b8"), mat("#7a5a3e"), mat("#d9d6cf"))), gloss: 0.3 },
      { mesh: merge(...lamps), glow: [1.2, 1.15, 1.05] },
    ],
    lines: [],
    fog: [24, 80],
    fogColor: "#bdb7ac",
  };
}

function library(): EnvScene {
  const top = BOARD_FOOT;
  const floorY = top - 7.6;
  const r = rng(11);
  const spines = ["#7a2f2a", "#2f4a6b", "#3d5a3b", "#8a6a35", "#4a3466", "#1f1f24", "#9b8a6a", "#5c2a2a"];
  const shelves: Mesh[] = [];
  const books: Mesh[] = [];
  // Four walls of shelves around the reading table.
  for (let wall = 0; wall < 4; wall++) {
    for (let k = -3; k <= 3; k++) {
      const along = k * 7;
      const dist = 30;
      const pos = (u: number, y: number, d: number): [number, number, number] => {
        const [x, z] = wall === 0 ? [u, -d] : wall === 1 ? [u, d] : wall === 2 ? [-d, u] : [d, u];
        return [x, y, z];
      };
      const sizeShelf: [number, number, number] = wall < 2 ? [6.6, 0.3, 2.4] : [2.4, 0.3, 6.6];
      for (let level = 0; level < 6; level++) {
        const y = floorY + 1 + level * 3.6;
        shelves.push(box(pos(along, y, dist), sizeShelf, mat("#3a2414")));
        let u = along - 3.1;
        while (u < along + 3) {
          const w = 0.25 + r() * 0.35;
          const h = 2.2 + r() * 1.1;
          const size: [number, number, number] = wall < 2 ? [w, h, 1.8] : [1.8, h, w];
          books.push(box(pos(u + w / 2, y + 0.15 + h / 2, dist - 0.1), size, mat(spines[Math.floor(r() * spines.length)])));
          u += w + 0.02;
        }
      }
    }
  }
  // Green banker's lamp on the table.
  const lampBase = lathe(
    [
      [0, top],
      [0.7, top],
      [0.7, top + 0.15],
      [0.12, top + 0.25],
      [0.08, top + 1.9],
      [0, top + 1.9],
    ],
    mat("#b08d57", 1),
    32,
  );
  const shade = box([0.9, top + 2.0, 0], [2.2, 0.5, 0.9], mat("#1d5a3a"));
  const bulb = box([0.9, top + 1.72, 0], [1.8, 0.06, 0.6], mat("#ffffff"));
  return {
    parts: [
      { mesh: box([0, top - 0.25, 0], [17, 0.5, 12], mat("#4a2c1a")), gloss: 0.9 },
      { mesh: box([0, (top + floorY) / 2, 0], [14, top - floorY - 0.5, 1], mat("#2b1a10")) },
      { mesh: merge(...shelves) },
      { mesh: merge(...books.slice(0, books.length / 2)) },
      { mesh: merge(...books.slice(books.length / 2)) },
      { mesh: merge(...room(64, 24, floorY, mat("#2a1d16"), mat("#24170f"), mat("#120c08"))), gloss: 0.3 },
      { mesh: translate(merge(lampBase, shade), -6.4, 0, -3), gloss: 1 },
      { mesh: translate(bulb, -6.4, 0, -3), glow: [1.6, 1.3, 0.8] },
    ],
    lines: [],
    fog: [16, 38],
    fogColor: "#160f0a",
  };
}

export function environment(id: Environment, accent: string): EnvScene | null {
  switch (id) {
    case "podium":
      return podium(accent);
    case "table":
      return table();
    case "neon":
      return neon(accent);
    case "hall":
      return hall();
    case "library":
      return library();
    default:
      return null;
  }
}
