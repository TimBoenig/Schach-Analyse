// Mike's neural network: the geometry behind the animated avatar.
import { describe, expect, it } from "vitest";

import { blendLook, buildNet, MOODS, nodeCount, project, rotate } from "../../src/ui/coach/net";

describe("coach network", () => {
  it.each([9, 18, 34])("wires %i neurons into one connected network inside the sphere", (count) => {
    const net = buildNet(count);
    expect(net.nodes).toHaveLength(count);
    for (const n of net.nodes) expect(Math.hypot(...n)).toBeLessThan(0.8);
    // Every edge once, between two different existing nodes.
    const keys = net.edges.map(([a, b]) => `${a}-${b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of net.edges) expect(a < b && b < count).toBe(true);
    // A signal that starts anywhere can reach every neuron.
    const seen = new Set([0]);
    const todo = [0];
    while (todo.length) {
      const at = todo.pop()!;
      for (const e of net.links[at]) {
        const [a, b] = net.edges[e];
        const next = a === at ? b : a;
        if (!seen.has(next)) {
          seen.add(next);
          todo.push(next);
        }
      }
    }
    expect(seen.size).toBe(count);
  });

  it("builds the same network every time", () => {
    expect(buildNet(18)).toEqual(buildNet(18));
  });

  it("draws near points larger and keeps distances when turning", () => {
    expect(project([0.5, 0, 0.7]).scale).toBeGreaterThan(project([0.5, 0, -0.7]).scale);
    expect(project([0.5, 0.2, 0]).y).toBeLessThan(0); // up in space is up on screen
    const turned = rotate([0.3, 0.4, 0.5], 1.1, 0.4);
    expect(Math.hypot(...turned)).toBeCloseTo(Math.hypot(0.3, 0.4, 0.5), 10);
    // A quarter turn brings a point on the right to the front or back, not elsewhere.
    const quarter = rotate([1, 0, 0], Math.PI / 2, 0);
    expect(quarter[0]).toBeCloseTo(0, 10);
    expect(Math.abs(quarter[2])).toBeCloseTo(1, 10);
  });

  it("glides between moods and uses fewer neurons for small avatars", () => {
    const half = blendLook(MOODS.happy, MOODS.sad, 0.5);
    expect(half.glow).toBeCloseTo((MOODS.happy.glow + MOODS.sad.glow) / 2);
    expect(half.a[0]).toBeCloseTo((MOODS.happy.a[0] + MOODS.sad.a[0]) / 2);
    expect(blendLook(MOODS.happy, MOODS.wow, 1)).toEqual(MOODS.wow);
    expect(nodeCount(26)).toBeLessThan(nodeCount(52));
    expect(nodeCount(52)).toBeLessThan(nodeCount(148));
  });
});
