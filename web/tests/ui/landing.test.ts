import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { MIN_GAMES, MIN_REPEATS, readSample, SAMPLE_SIZE } from "../../src/ui/landing/patternSample";
import { buildFrames, SCENES } from "../../src/ui/landing/reel";
import { PUZZLE_FEN } from "../../src/ui/landingPuzzle";
import { parseHash, toHash } from "../../src/ui/router";

describe("landing page", () => {
  it("has its own short address for the social-media bio link", () => {
    expect(parseHash("#/hello")).toEqual({ view: "landing" });
    expect(parseHash("#/hallo")).toEqual({ view: "landing" });
    expect(toHash({ view: "landing" })).toBe("#/hello");
  });

  it("opens the showreel with a puzzle that has exactly one mating move", () => {
    const g = new Chess(PUZZLE_FEN);
    const mates = g.moves().filter((san) => {
      const t = new Chess(PUZZLE_FEN);
      t.move(san);
      return t.isCheckmate();
    });
    expect(mates).toEqual(["Rd8#"]);
  });
});

describe("landing showreel", () => {
  it("plays only legal moves, ends every clip with mate and badges real moves", () => {
    for (const scene of SCENES) {
      const frames = buildFrames(scene);
      expect(frames).toHaveLength(scene.beats.length + 1);
      const end = new Chess(frames[frames.length - 1].fen);
      expect(end.isCheckmate(), scene.id).toBe(true);
      // The quick moves between two comments keep the last comment; the first frame has no move.
      expect(frames[0].label).toBeNull();
      expect(frames[0].badge).toBeUndefined();
      expect(frames.slice(1).every((f) => f.last && f.label)).toBe(true);
    }
    // The show covers the kinds the page promises: brilliant, best and blunder.
    const badges = new Set(SCENES.flatMap((s) => s.beats.map((b) => b.badge)));
    expect([...badges]).toEqual(expect.arrayContaining(["Brilliant", "Best", "Blunder"]));
  });
});

describe("landing pattern example", () => {
  it("names the endgame pattern only once enough games back it", () => {
    expect(readSample(MIN_GAMES - 1).pattern).toBeNull();
    expect(readSample(MIN_GAMES - 1).motifs).toEqual([]);
    const all = readSample(SAMPLE_SIZE);
    expect(all.games).toHaveLength(SAMPLE_SIZE);
    expect(all.share.endgame).toBeGreaterThan(all.share.middlegame);
    expect(all.share.middlegame).toBeGreaterThan(all.share.opening);
    expect(all.pattern?.motif).toBe("Turmendspiel nicht gehalten");
    expect(all.pattern!.games).toBeGreaterThanOrEqual(MIN_REPEATS);
    expect(all.motifs).toHaveLength(3);
  });
});
