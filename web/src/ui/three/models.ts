// The site's 3D objects, built from code instead of downloaded model files:
// nothing to license, nothing to load, a few hundred bytes each.
import { box, lathe, merge, type Material, type Mesh } from "./mesh";

export type ModelKind = "king" | "trophy";

const GOLD: Material = { color: [1.0, 0.76, 0.33], metal: 1 };
const EBONY: Material = { color: [0.1, 0.1, 0.12], metal: 0 };

function king(): Mesh {
  const foot = lathe([[0, 0], [0.5, 0], [0.53, 0.05], [0.5, 0.12], [0, 0.12]], EBONY);
  const body = lathe(
    [
      [0.5, 0.12], [0.42, 0.16], [0.37, 0.22], [0.4, 0.28], [0.31, 0.34],
      [0.22, 0.52], [0.17, 0.8], [0.15, 1.08], [0.19, 1.13],
    ],
    GOLD,
  );
  const collar = lathe([[0.19, 1.13], [0.29, 1.15], [0.3, 1.2], [0.2, 1.24], [0.17, 1.26]], GOLD);
  const head = lathe([[0.17, 1.26], [0.2, 1.32], [0.31, 1.52], [0.32, 1.58], [0.26, 1.61], [0.1, 1.66], [0.07, 1.72], [0, 1.72]], GOLD);
  const cross = merge(box([0, 1.89, 0], [0.075, 0.36, 0.075], GOLD), box([0, 1.93, 0], [0.25, 0.075, 0.075], GOLD));
  return merge(foot, body, collar, head, cross);
}

function trophy(): Mesh {
  const foot = lathe([[0, 0], [0.4, 0], [0.42, 0.05], [0.4, 0.14], [0, 0.14]], EBONY);
  const cup = lathe(
    [
      [0.3, 0.14], [0.26, 0.2], [0.12, 0.28], [0.08, 0.5], [0.1, 0.62], [0.17, 0.68], [0.14, 0.74], [0.2, 0.82], [0.32, 0.96],
      [0.4, 1.14], [0.45, 1.36], [0.47, 1.58], [0.5, 1.62], [0.5, 1.68], [0.47, 1.72], [0.5, 1.84], [0.48, 1.86], [0.45, 1.84],
      [0.42, 1.58], [0.38, 1.3], [0.26, 1.06], [0, 0.98],
    ],
    GOLD,
  );
  // Two flat handles, as on a winner's cup.
  const handles = [-1, 1].flatMap((side) => [
    box([side * 0.6, 1.5, 0], [0.26, 0.06, 0.08], GOLD),
    box([side * 0.7, 1.32, 0], [0.06, 0.42, 0.08], GOLD),
    box([side * 0.56, 1.12, 0], [0.34, 0.06, 0.08], GOLD),
  ]);
  return merge(foot, cup, ...handles);
}

const BUILDERS: Record<ModelKind, () => Mesh> = { king, trophy };
const cache = new Map<ModelKind, Mesh>();

export function modelMesh(kind: ModelKind): Mesh {
  let mesh = cache.get(kind);
  if (!mesh) {
    mesh = BUILDERS[kind]();
    cache.set(kind, mesh);
  }
  return mesh;
}
