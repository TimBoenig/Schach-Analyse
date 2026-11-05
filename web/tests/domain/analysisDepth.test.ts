import { describe, expect, it } from "vitest";

import {
  deeperPreset,
  DEPTH_PRESETS,
  estimateGame,
  isBulletGame,
  NO_BULLET,
  normalizeChoice,
  recordSpeed,
  resolveSettings,
  scopeOf,
  statsFormat,
  TYPICAL_POSITIONS,
  TYPICAL_VERIFY_POSITIONS,
} from "../../src/domain/analysisDepth";
import { filterGames } from "../../src/domain/metrics";
import { buildPlayerProfile } from "../../src/domain/profile";
import { buildMoves, gameRow } from "../profile/fixtures";

describe("depth choices", () => {
  it("reads legacy preset names and falls back per scope", () => {
    expect(resolveSettings(normalizeChoice("deep"))).toEqual(DEPTH_PRESETS.deep.settings);
    expect(normalizeChoice(undefined, "own")).toEqual({ preset: "normal" });
    expect(normalizeChoice("nonsense", "friends")).toEqual({ preset: "fast" });
  });

  it("clamps custom limits and always keeps two lines for Great/Brilliant", () => {
    const s = resolveSettings({ preset: "custom", depth: 99, seconds: 0.01 });
    expect(s).toEqual({ depth: 26, movetimeMs: 200, multiPv: 2 });
    expect(resolveSettings({ preset: "custom", depth: 14, seconds: 2.5 })).toEqual({ depth: 14, movetimeMs: 2500, multiPv: 2 });
  });

  it("offers the next deeper preset and nothing above the maximum", () => {
    expect(deeperPreset({ depth: 12 })).toBe("normal");
    expect(deeperPreset({ depth: 17 })).toBe("deep");
    expect(deeperPreset({ depth: 24 })).toBeNull();
  });

  it("uses the own depth for own games and the friends depth for everyone else", () => {
    expect(scopeOf({ white: "Lena", black: "TIM" }, ["tim"])).toBe("own");
    expect(scopeOf({ white: "Lena", black: "Max" }, ["tim"])).toBe("friends");
  });
});

describe("analysis time estimate", () => {
  const s = DEPTH_PRESETS.fast.settings;

  it("is the time-limit upper bound until enough positions were measured", () => {
    const few = recordSpeed({}, s, 10, 1000);
    // The deeper re-check of critical moves (1.2 s each at "Schnell") is part of the bound.
    expect(estimateGame(s, few)).toEqual({ seconds: 0.4 * TYPICAL_POSITIONS + 1.2 * TYPICAL_VERIFY_POSITIONS, measured: false });
    expect(estimateGame({ ...s, verify: false }, few)).toEqual({ seconds: 0.4 * TYPICAL_POSITIONS, measured: false });
  });

  it("uses the measured device speed and lets newer runs count", () => {
    let log = recordSpeed({}, s, 100, 20_000); // 0.2 s per position
    expect(estimateGame(s, log)).toEqual({ seconds: 0.2 * TYPICAL_POSITIONS, measured: true });
    log = recordSpeed(log, s, 5000, 500_000); // 0.1 s per position, capped sample
    const est = estimateGame(s, log);
    expect(est.seconds).toBeCloseTo(0.1 * TYPICAL_POSITIONS, 1);
    // Other limits have their own measurement.
    expect(estimateGame(DEPTH_PRESETS.deep.settings, log).measured).toBe(false);
  });
});

describe("Bullet exclusion", () => {
  const row = (id: string, speed: string, chess960 = 0) => ({ ...gameRow(id, buildMoves()), speed_category: speed, chess960 });

  it("detects Bullet from the category or the time control", () => {
    expect(isBulletGame({ speed_category: "UltraBullet" })).toBe(true);
    expect(isBulletGame({ speed_category: "", time_control: "60+1" })).toBe(true);
    expect(isBulletGame({ speed_category: "", time_control: "180+2" })).toBe(false);
  });

  it("only turns 'All Formats' into the no-Bullet filter", () => {
    expect(statsFormat("All Formats", true)).toBe(NO_BULLET);
    expect(statsFormat("Bullet", true)).toBe("Bullet");
    expect(statsFormat("All Formats", false)).toBe("All Formats");
  });

  it("keeps every other format, Chess960 included, out of the statistics only for Bullet", () => {
    const games = [row("a", "Bullet"), row("b", "UltraBullet"), row("c", "Blitz"), row("d", "Rapid"), row("e", "Blitz", 1)];
    expect(filterGames(games, ["tim"], "All Colors", NO_BULLET).map(([g]) => g.id)).toEqual(["c", "d", "e"]);
    expect(buildPlayerProfile(games, ["tim"], NO_BULLET).total_games).toBe(3);
    expect(buildPlayerProfile(games, ["tim"], "Bullet").total_games).toBe(1);
  });
});
