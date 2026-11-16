// Shapes of the site's 3D objects (turned on a "lathe" from a profile).
import { describe, expect, it } from "vitest";

import { bounds, box, lathe, merge, STRIDE } from "../../src/ui/three/mesh";
import { modelMesh } from "../../src/ui/three/models";

const MAT = { color: [1, 1, 1] as [number, number, number], metal: 0 };

function check(mesh: { vertices: number[]; indices: number[] }) {
  const count = mesh.vertices.length / STRIDE;
  expect(Number.isInteger(count)).toBe(true);
  expect(mesh.indices.length % 3).toBe(0);
  for (const i of mesh.indices) expect(i >= 0 && i < count).toBe(true);
  for (let v = 0; v < mesh.vertices.length; v += STRIDE) {
    expect(Math.hypot(mesh.vertices[v + 3], mesh.vertices[v + 4], mesh.vertices[v + 5])).toBeCloseTo(1, 5);
  }
  return count;
}

describe("3D meshes", () => {
  it("turns a cylinder with outward normals and a hard edge at the lid", () => {
    const mesh = lathe([[1, 0], [1, 2], [0, 2]], MAT, 8);
    // Wall: 2 rings; lid: 2 rings (the 90° corner is not smoothed) -> 4 rings of 9.
    expect(check(mesh)).toBe(36);
    // First vertex is on the wall at angle 0: normal points away from the axis.
    expect(mesh.vertices[3]).toBeCloseTo(1);
    expect(mesh.vertices[4]).toBeCloseTo(0);
    // Last ring is the lid's centre: normal points up.
    const last = mesh.vertices.slice(-STRIDE);
    expect(last[4]).toBeCloseTo(1);
    const b = bounds(mesh);
    expect([b.minY, b.maxY]).toEqual([0, 2]);
    expect(b.radius).toBeCloseTo(1);
  });

  it("shares one ring where the profile bends gently", () => {
    const mesh = lathe([[1, 0], [1.05, 1], [1.1, 2]], MAT, 8);
    expect(check(mesh)).toBe(27);
  });

  it("merges meshes with shifted indices", () => {
    const a = box([0, 0, 0], [1, 1, 1], MAT);
    const both = merge(a, box([3, 0, 0], [1, 1, 1], MAT));
    expect(check(both)).toBe(48);
    expect(Math.max(...both.indices)).toBe(47);
    expect(bounds(both).radius).toBeCloseTo(Math.hypot(3.5, 0.5));
  });

  it.each(["king", "trophy"] as const)("builds a valid %s that fits 16-bit indices", (kind) => {
    const mesh = modelMesh(kind);
    expect(check(mesh)).toBeLessThan(65536);
    expect(bounds(mesh).minY).toBe(0);
  });
});
