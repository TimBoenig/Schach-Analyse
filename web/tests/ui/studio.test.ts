// Video studio: move input, templates, the timeline that animates pieces,
// stored-project repair and the geometry behind the 3D board.
import { describe, expect, it } from "vitest";

import { STRIDE } from "../../src/ui/three/mesh";
import { lookAt, multiply, perspective, screenToBoard, toScreen } from "../../src/ui/studio/math3d";
import {
  DEFAULT_VIDEO,
  fromMoves,
  germanSan,
  moveTokens,
  normalizeProject,
  parseMoves,
  scene,
  scenePositions,
  START_FEN,
  styleFromTheme,
  TEMPLATES,
  type StudioProject,
} from "../../src/ui/studio/model";
import { pieceMesh, triangulate } from "../../src/ui/studio/pieces";
import { arrowMesh } from "../../src/ui/studio/renderer";
import { compile, frameAt, squareXZ, xzSquare } from "../../src/ui/studio/timeline";
import { parseHash, toHash } from "../../src/ui/router";

const make = (scenes: StudioProject["scenes"], startFen = START_FEN): StudioProject => ({
  id: "p",
  name: "t",
  startFen,
  scenes,
  style: styleFromTheme("nova"),
  video: { ...DEFAULT_VIDEO, introFly: false },
  updatedAt: 0,
});

describe("studio moves", () => {
  it("reads German and English SAN with move numbers, castling zeros and annotations", () => {
    expect(moveTokens("1. e4 e5 2. Sf3 Sc6 3. Lb5!? a6 4. 0-0 Dxd8=D+ {Kommentar} 1-0")).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "O-O", "Qxd8=Q+"]);
    expect(germanSan("Qxf7#")).toBe("Dxf7#");
    expect(germanSan("e8=N")).toBe("e8=S");
    const ok = parseMoves(START_FEN, "1. e4 e5 2. Sf3");
    expect(ok.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(parseMoves(START_FEN, "e4 Sf6 Ke3").error).toBe("Ke3");
  });

  it("ships templates whose every scene is legal", () => {
    for (const t of TEMPLATES) {
      const p = t.make();
      for (const pos of scenePositions(p)) expect(pos.parsed.error, t.id).toBeUndefined();
    }
    const built = fromMoves("Italienisch", "1. e4 e5 2. Sf3 Sc6 3. Lc4");
    // Title card, three scenes (two pairs and a lone white move), call to action.
    expect(built.project.scenes.map((s) => s.moves)).toEqual(["", "1. e4 e5", "2. Sf3 Sc6", "3. Lc4", ""]);
  });
});

describe("studio timeline", () => {
  it("moves the rook with the king when castling and keeps piece identities", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const p = make([scene({ moves: "O-O", duration: 2 })], fen);
    const tl = compile(p);
    const step = tl.scenes[0].steps[0];
    expect(step.movers.map((m) => `${m.from}${m.to}`).sort()).toEqual(["e1g1", "h1f1"]);
    const end = frameAt(tl, p, tl.total)!;
    const at = (sq: string) => end.pieces.find((x) => x.x === squareXZ(sq)[0] && x.z === squareXZ(sq)[1]);
    expect(at("g1")?.type).toBe("k");
    expect(at("f1")?.type).toBe("r");
    expect(at("h1")).toBeUndefined();
  });

  it("removes captured pieces (en passant too) and turns a promoted pawn into the new piece", () => {
    const p = make([scene({ moves: "exd6 Kxd6", duration: 2 }), scene({ fen: "8/4P3/8/8/8/8/8/k6K w - - 0 1", moves: "e8=D", duration: 2 })], "8/8/4k3/3pP3/8/8/8/4K3 w - d6 0 2");
    const tl = compile(p);
    const ep = tl.scenes[0].steps[0];
    const d5Pawn = tl.scenes[0].before.find((x) => x.square === "d5")!;
    expect(ep.captured).toBe(d5Pawn.id);
    const mid = frameAt(tl, p, tl.scenes[1].start - 0.01)!;
    expect(mid.pieces.filter((x) => x.alpha > 0.5)).toHaveLength(2);
    const end = frameAt(tl, p, tl.total)!;
    const e8 = squareXZ("e8");
    expect(end.pieces.find((x) => x.x === e8[0] && x.z === e8[1])?.type).toBe("q");
    expect(end.pieces.some((x) => x.type === "p" && x.alpha > 0)).toBe(false);
  });

  it("stretches a scene that is too short for its moves and plays them in order", () => {
    const p = make([scene({ moves: "e4 e5 Sf3 Sc6", duration: 1 })]);
    const tl = compile(p);
    const c = tl.scenes[0];
    expect(c.dur).toBeGreaterThan(c.steps[3].t1);
    expect(c.steps.map((s) => s.label)).toEqual(["1. e4", "1… e5", "2. Sf3", "2… Sc6"]);
    for (let i = 1; i < 4; i++) expect(c.steps[i].t0).toBeGreaterThan(c.steps[i - 1].t1);
    expect(tl.sounds).toHaveLength(4);
  });

  it("marks the checked king and keeps an arrow shown by two scenes on screen", () => {
    const arrow = { from: "c4", to: "f7", tone: "bad" as const };
    const p = make([scene({ moves: "e4 e5 Lc4 Sc6 Dh5 Sf6 Dxf7#", arrows: [arrow], duration: 3 }), scene({ arrows: [arrow], duration: 2 })]);
    const tl = compile(p);
    const end = frameAt(tl, p, tl.scenes[0].start + tl.scenes[0].dur - 0.01)!;
    expect(end.marks.find((m) => m.square === "e8")?.tone).toBe("bad");
    expect(end.arrows[0].alpha).toBe(1);
    const next = frameAt(tl, p, tl.scenes[1].start + 0.01)!;
    expect(next.arrows[0]).toMatchObject({ progress: 1, alpha: 1 });
  });

  it("maps squares to board coordinates and back", () => {
    for (const sq of ["a1", "h8", "e4", "d5"]) {
      const [x, z] = squareXZ(sq);
      expect(xzSquare(x + 0.3, z - 0.3)).toBe(sq);
    }
    expect(xzSquare(4.2, 0)).toBeNull();
  });
});

describe("studio storage", () => {
  it("repairs a broken project instead of failing", () => {
    const p = normalizeProject({ name: 42, startFen: "kaputt", scenes: [{ duration: 999, camera: "drone", arrows: [{ from: "z9", to: "a1" }, { from: "e2", to: "e4", tone: "neon" }], marks: "x" }], style: { theme: "neon", accent: "red" }, video: { fps: 24, tempo: 9 } });
    expect(p.startFen).toBe(START_FEN);
    expect(p.name).toBe("Neues Video");
    expect(p.scenes[0]).toMatchObject({ duration: 30, camera: "white", arrows: [{ from: "e2", to: "e4", tone: "accent" }], marks: [] });
    expect(p.style.accent).toBe(styleFromTheme("neon").accent);
    expect(p.video).toMatchObject({ fps: 30, tempo: 2.5 });
    expect(normalizeProject(null).scenes).toHaveLength(1);
  });
});

describe("studio geometry", () => {
  it("builds every piece with valid indices and unit normals", () => {
    for (const t of ["p", "n", "b", "r", "q", "k"] as const) {
      const m = pieceMesh(t);
      const count = m.vertices.length / STRIDE;
      expect(count).toBeLessThan(65536);
      expect(m.indices.every((i) => i >= 0 && i < count)).toBe(true);
      for (let v = 0; v < m.vertices.length; v += STRIDE) expect(Math.hypot(m.vertices[v + 3], m.vertices[v + 4], m.vertices[v + 5])).toBeCloseTo(1, 4);
    }
  });

  it("triangulates a concave outline into n-2 triangles", () => {
    const l: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    expect(triangulate(l)).toHaveLength((l.length - 2) * 3);
  });

  it("draws knight arrows as an L and grows arrows with their progress", () => {
    const full = arrowMesh("g1", "f3", 1, 1, 0);
    // Two shaft quads and a head.
    expect(full.length / 5).toBe(15);
    const xs = (d: number[]) => d.filter((_, i) => i % 5 === 0);
    expect(Math.min(...xs(full))).toBeLessThan(squareXZ("f3")[0] + 0.01);
    const half = arrowMesh("e2", "e6", 0.5, 1, 0);
    const zs = half.filter((_, i) => i % 5 === 2);
    expect(Math.min(...zs)).toBeGreaterThan(squareXZ("e5")[1]);
  });

  it("finds the clicked square through the camera", () => {
    const vp = multiply(perspective(0.8, 9 / 16, 0.5, 100, 0.07), lookAt([2, 14, 9], [0, 0, 0]));
    const [x, z] = squareXZ("c6");
    const s = toScreen(vp, [x, 0, z])!;
    const hit = screenToBoard(vp, s.x, s.y)!;
    expect(xzSquare(hit.x, hit.z)).toBe("c6");
  });

  it("has its own hidden route", () => {
    expect(parseHash("#/studio")).toEqual({ view: "studio" });
    expect(toHash({ view: "studio" })).toBe("#/studio");
  });
});

describe("studio captions", () => {
  it("emphasises starred words and keeps punctuation glued to them", async () => {
    const { tokens } = await import("../../src/ui/studio/compose");
    expect(tokens("das *Zentrum*. Ende")).toEqual([
      { word: "das", emph: false, glue: false },
      { word: "Zentrum", emph: true, glue: false },
      { word: ".", emph: false, glue: true },
      { word: "Ende", emph: false, glue: false },
    ]);
  });
});
