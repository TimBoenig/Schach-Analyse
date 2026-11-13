// Performance presets decide how many engines run side by side.
import { describe, expect, it } from "vitest";

import { defaultPerfChoice, normalizePerfChoice, resolvePerf, type DeviceInfo } from "../../src/domain/performance";

const pc = (cores: number): DeviceInfo => ({ cores, mobile: false });

describe("performance presets", () => {
  it.each([
    [4, [1, 2, 2, 3]],
    [8, [1, 2, 4, 7]],
    [16, [1, 4, 8, 15]],
    [2, [1, 2, 2, 2]],
  ])("spread engines over %i cores, never weaker towards the top", (cores, expected) => {
    const engines = (["eco", "balanced", "high", "max"] as const).map((p) => resolvePerf({ preset: p }, pc(cores)).engines);
    expect(engines).toEqual(expected);
    expect(Math.max(...engines)).toBeLessThanOrEqual(cores);
    expect(engines).toEqual([...engines].sort((a, b) => a - b));
  });

  it("keeps the summed hash of all engines within the memory budget", () => {
    for (const choice of [{ preset: "max" as const }, { preset: "custom" as const, engines: 32, hashMb: 512 }]) {
      const p = resolvePerf(choice, pc(64));
      expect(p.engines * p.hashMb).toBeLessThanOrEqual(1024);
      expect(p.hashMb).toBeGreaterThanOrEqual(16);
    }
    expect(resolvePerf({ preset: "custom", engines: 2, hashMb: 256 }, pc(8))).toEqual({ engines: 2, hashMb: 256 });
  });

  it("starts phones and small machines economical, desktops balanced", () => {
    expect(defaultPerfChoice({ cores: 8, mobile: true }).preset).toBe("eco");
    expect(defaultPerfChoice(pc(4)).preset).toBe("eco");
    expect(defaultPerfChoice(pc(12)).preset).toBe("balanced");
  });

  it.each([
    [null, "balanced"],
    ["max", "balanced"],
    [{ preset: "turbo" }, "balanced"],
  ])("falls back to the device default for unknown stored values (%j)", (raw, preset) => {
    expect(normalizePerfChoice(raw, pc(12)).preset).toBe(preset);
  });

  it("clamps a custom choice to the device and the hash options", () => {
    expect(normalizePerfChoice({ preset: "custom", engines: 99, hashMb: 100 }, pc(8))).toEqual({
      preset: "custom",
      engines: 8,
      hashMb: 128,
    });
    expect(normalizePerfChoice({ preset: "custom", engines: 0 }, pc(8))).toMatchObject({ engines: 1, hashMb: 32 });
  });
});
