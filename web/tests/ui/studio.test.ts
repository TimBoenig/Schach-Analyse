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
import { environment } from "../../src/ui/studio/environments";
import { buildAiPrompt, importAiScript, speechSheet, toAiScript } from "../../src/ui/studio/aiScript";
import { buildProject, defaultAnswers, distributeScript, explainMove, fenAt, fitLength, playMove, takeBack, treeFromPgn } from "../../src/ui/studio/wizard";

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

describe("studio assistant", () => {
  const trap = () => treeFromPgn("1. e4 e5 2. Lc4 Sc6 3. Dh5 Sf6 4. Dxf7#").tree;
  const legalEverywhere = (p: StudioProject) => expect(() => scenePositions(p)).not.toThrow();

  it("turns a different move on the board into a variation and back-steps out of it", () => {
    const t = trap();
    const r = playMove(t, { line: "main", ply: 5 }, { from: "g7", to: "g6" })!;
    expect(r.tree.main).toHaveLength(7);
    expect(r.tree.variations).toEqual([{ from: 5, moves: ["g6"] }]);
    expect(r.cursor).toEqual({ line: 0, ply: 1 });
    // The main-line move again just steps forward instead of branching.
    expect(playMove(t, { line: "main", ply: 5 }, { from: "g8", to: "f6" })!.tree.variations).toEqual([]);
    expect(playMove(t, { line: "main", ply: 5 }, { from: "a2", to: "a4" })).toBeNull();
    const back = takeBack(r.tree, r.cursor);
    expect(back.tree.variations).toEqual([]);
    expect(fenAt(back.tree, back.cursor)).toBe(fenAt(t, { line: "main", ply: 5 }));
  });

  it("builds a trap video with a poll before the key move, a variation and a jump back", () => {
    const t = playMove(trap(), { line: "main", ply: 5 }, { from: "g7", to: "g6" })!.tree;
    t.keyPly = 6;
    const p = buildProject(t, { ...defaultAnswers("trap"), name: "Schäfermatt", poll: true });
    legalEverywhere(p);
    const cards = p.scenes.map((s) => s.card);
    const poll = cards.indexOf("poll");
    expect(poll).toBeGreaterThan(0);
    expect(p.scenes[poll].options).toHaveLength(3);
    expect(p.scenes[poll].options.some((o) => o.endsWith("Dxf7#"))).toBe(true);
    expect(p.scenes[poll + 1].title).toMatch(/^Richtig: [ABC]\) Dxf7#$/);
    const variation = p.scenes.find((s) => s.label === "Variante 1")!;
    expect(variation.fen).toBe(fenAt(t, { line: "main", ply: 5 }));
    // The scene after the variation returns to the main line explicitly.
    expect(p.scenes[poll].fen).toBe(fenAt(t, { line: "main", ply: 6 }));
    expect(cards.at(-1)).toBe("outro");
    expect(cards[0]).not.toBe("none");
  });

  it.each([15, 30, 60])("stretches or squeezes a video to about %i seconds", (seconds) => {
    const p = buildProject(treeFromPgn("1. e4 e5 2. Sf3 Sc6 3. Lb5 a6 4. La4 Sf6 5. 0-0 Le7").tree, { ...defaultAnswers("opening"), length: seconds as 15 | 30 | 45 | 60 });
    legalEverywhere(p);
    const total = compile(fitLength(p, seconds)).total;
    expect(Math.abs(total - seconds)).toBeLessThan(seconds * 0.2);
  });

  it("puts script sentences on the scene that names their move and the call to action on the outro", () => {
    const p = buildProject(trap(), { ...defaultAnswers("trap"), poll: false });
    const script = "Diese Falle sieht harmlos aus. Mit Dh5 greift Weiß sofort f7 an. Dxf7 ist Schachmatt. Folge für mehr Fallen!";
    const out = distributeScript(p, script);
    const withText = (re: RegExp) => out.scenes.find((s) => re.test(s.text));
    expect(withText(/Dh5 greift/)?.moves).toMatch(/Dh5/);
    expect(withText(/Schachmatt/)?.moves).toMatch(/Dxf7/);
    expect(out.scenes.at(-1)!.title).toMatch(/^Folge für mehr Fallen/);
    // Every scene with script text lasts long enough to read it.
    for (const s of out.scenes.filter((x) => x.text && script.includes(x.text.split(" | ")[0]))) expect(s.duration).toBeGreaterThanOrEqual(s.text.split(/\s+/).filter(Boolean).length / 2.6);
  });

  it("explains threats and checks with arrows", () => {
    const fen = fenAt(trap(), { line: "main", ply: 4 });
    const qh5 = explainMove(fen, "Qh5", 4);
    expect(qh5.arrows.some((a) => a.from === "h5" && a.to === "f7")).toBe(true);
    expect(qh5.text).toMatch(/droht Matt/);
    const mate = explainMove(fenAt(trap(), { line: "main", ply: 6 }), "Qxf7#", 6);
    expect(mate.text).toMatch(/matt/i);
  });

  it("shows subtitle parts one after another and speed shortens the video", () => {
    const p = make([scene({ moves: "e4", text: "Erster Teil | Zweiter Teil", duration: 4 })]);
    const tl = compile(p);
    expect(frameAt(tl, p, 0.5)!.text.text).toBe("Erster Teil");
    expect(frameAt(tl, p, tl.total - 0.3)!.text.text).toBe("Zweiter Teil");
    const fast = { ...p, video: { ...p.video, speed: 2 } };
    expect(compile(fast).total).toBeLessThan(tl.total);
  });

  it.each(["podium", "table", "neon", "hall", "library"] as const)("builds a valid %s environment", (id) => {
    const env = environment(id, "#6d7cff")!;
    expect(env.parts.length).toBeGreaterThan(0);
    for (const { mesh } of env.parts) {
      const count = mesh.vertices.length / STRIDE;
      expect(count).toBeLessThan(65536);
      expect(Math.max(...mesh.indices)).toBeLessThan(count);
    }
    expect(environment("void", "#6d7cff")).toBeNull();
  });

  it("repairs old projects without the new fields", () => {
    const old = JSON.parse(JSON.stringify(make([scene({ moves: "e4" })])));
    delete old.style.environment;
    delete old.video.speed;
    delete old.video.platform;
    delete old.scenes[0].options;
    const p = normalizeProject(old)!;
    expect(p.style.environment).toBe("void");
    expect(p.video.speed).toBe(1);
    expect(p.video.platform).toBe("tiktok");
    expect(p.scenes[0].options).toEqual([]);
  });
});

describe("studio AI scripts", () => {
  const promptJson = () => buildAiPrompt({ topic: "Spanisch", platform: "reels", length: 30, notes: "Mit Variante\nLocker" });

  it("ships a prompt whose own example imports without a single problem", () => {
    const prompt = promptJson();
    expect(prompt).toContain("Spanisch");
    expect(prompt).toContain("  Mit Variante");
    const r = importAiScript(prompt);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const p = r.project!;
    expect(() => scenePositions(p)).not.toThrow();
    const variation = p.scenes.find((s) => s.moves === "3… g6")!;
    // "zurueck: 2" from after 4. Dxf7# lands after 3. Dh5.
    expect(variation.fen).toBe(parseMoves(START_FEN, "e4 e5 Lc4 Sc6 Dh5").fen);
    const mate = p.scenes.find((s) => s.moves === "4. Dxf7#")!;
    expect(mate.effects).toEqual(["mate", "shake"]);
    expect(mate.badge).toBe("!!");
    expect(mate.tempo).toBe(0.7);
    expect(p.scenes.find((s) => s.title === "Ziel: f7")!.arrows).toEqual([{ from: "c4", to: "f7", tone: "bad" }]);
    expect(p.scenes.find((s) => s.card === "poll")!.options).toHaveLength(3);
    expect(p.style.environment).toBe("podium");
  });

  it("reads sloppy answers: text around the JSON, trailing commas, any key spelling and arrow format", () => {
    const answer = `Klar, hier ist dein Skript:
\`\`\`json
{ "Titel": "Test", "Umgebung": "Turniersaal", "Geschwindigkeit": "1,5",
  "Szenen": [
    { "Zug": "1. e4", "Kamera": "Schräg", "Pfeile": [["e4", "d5", "rot"], {"von": "e4", "nach": "f5", "farbe": "Idee"}], "Markierungen": ["d5 grün"], "Kleine Zeile": "Teil 1", },
    { "zug": "1... e5", "kamera": "Drohne", "effekte": ["Zeitlupe", "Explosion"] },
  ],
}
\`\`\`
Viel Spaß!`;
    const r = importAiScript(answer);
    expect(r.errors).toEqual([]);
    const p = r.project!;
    expect(p.video.speed).toBe(1.5);
    expect(p.style.environment).toBe("hall");
    expect(p.scenes[0]).toMatchObject({ camera: "corner", label: "Teil 1", arrows: [{ from: "e4", to: "d5", tone: "bad" }, { from: "e4", to: "f5", tone: "idea" }], marks: [{ square: "d5", tone: "good" }] });
    expect(p.scenes[1].effects).toEqual(["slowmo"]);
    expect(r.warnings.some((w) => w.includes("Drohne"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("Explosion"))).toBe(true);
  });

  it("names the scene of an illegal move, keeps the legal ones and returns to the main line", () => {
    const r = importAiScript(
      JSON.stringify({
        szenen: [{ zug: "1. e4 e5 2. Sf3" }, { variante: { zurueck: 1 }, zug: "2. Lc4" }, { hauptvariante: true, zug: "2... Sc6 3. Lb7" }],
      }),
    );
    expect(r.errors).toEqual(["Szene 3: „Bb7“ ist in dieser Stellung nicht möglich, nur 2… Sc6 wird gezeigt."]);
    const p = r.project!;
    expect(p.scenes[1]).toMatchObject({ label: "Variante 1", fen: parseMoves(START_FEN, "e4 e5").fen });
    expect(p.scenes[2]).toMatchObject({ label: "Zurück zur Hauptvariante", fen: parseMoves(START_FEN, "e4 e5 Sf3").fen, moves: "2… Sc6" });
    expect(r.stats).toMatchObject({ scenes: 3, moves: 5, variations: 1 });
    expect(importAiScript("Das kann ich leider nicht.").project).toBeNull();
  });

  it("adds the mate animation to a mating move and gives the current video back in the same format", () => {
    const r = importAiScript(JSON.stringify({ laenge: 20, szenen: [{ karte: "titel", titel: "Hook" }, { zug: "1. f3 e5 2. g4 Dh4#", sprechtext: "Das ist das schnellste Matt, das es im Schach gibt, und es passiert wirklich." }] }));
    const p = r.project!;
    expect(p.scenes[1].effects).toEqual(["mate"]);
    expect(p.scenes[1].mood).toBe("wow");
    const again = importAiScript(toAiScript(p)).project!;
    expect(again.scenes.map((s) => [s.moves, s.effects, s.speech, s.camera])).toEqual(p.scenes.map((s) => [s.moves, s.effects, s.speech, s.camera]));
    expect(speechSheet(p)).toMatch(/^0:00–0:0\d {2}Szene 1 \(Hook\)/);
  });
});

describe("studio effects", () => {
  const mate = () => make([scene({ moves: "1. f3 e5 2. g4 Dh4#", effects: ["mate", "threat"], badge: "!!", duration: 2 })]);

  it("tips the mated king over away from the queen, lifts the badge and adds the boom", () => {
    const p = mate();
    const tl = compile(p);
    const c = tl.scenes[0];
    expect(c.mate).toEqual({ king: "e1", by: "h4" });
    expect(c.dur).toBeGreaterThanOrEqual(c.fxAt + 2.2);
    const late = frameAt(tl, p, c.fxAt + 1.5)!;
    const king = late.pieces.find((x) => x.type === "k" && x.color === "w")!;
    expect(king.tilt).toBeGreaterThan(1.2);
    // Queen on h4, king on e1: it falls towards smaller files (negative x) and towards rank 1 (positive z).
    expect(Math.sin(king.tiltYaw!)).toBeLessThan(0);
    expect(late.badge).toMatchObject({ text: "!!", square: "h4" });
    expect(frameAt(tl, p, c.fxAt - 0.1)!.fx).toEqual([]);
    expect(tl.sounds.some((s) => s.kind === "boom")).toBe(true);
  });

  it("finds the threatened pieces itself and slow motion stretches only the last move", () => {
    const p = make([scene({ moves: "1. e4 e5 2. Dh5", effects: ["threat"] })]);
    expect(compile(p).scenes[0].threats.sort()).toEqual(["e5", "f7", "h7"]);
    const slow = make([scene({ moves: "1. e4 e5", effects: ["slowmo"] })]);
    const [a, b] = compile(slow).scenes[0].steps;
    expect(b.t1 - b.t0).toBeGreaterThan(2 * (a.t1 - a.t0));
  });
});
