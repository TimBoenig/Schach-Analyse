// Video studio: move input, templates, the timeline that animates pieces,
// stored-project repair and the geometry behind the 3D board.
import { describe, expect, it } from "vitest";

import { STRIDE } from "../../src/ui/three/mesh";
import { lookAt, multiply, perspective, screenToBoard, toScreen } from "../../src/ui/studio/math3d";
import {
  DEFAULT_VIDEO,
  fromMoves,
  displaySan,
  moveTokens,
  normalizeProject,
  parseMoves,
  POLL_COLOURS,
  scene,
  scenePositions,
  spellNotation,
  START_FEN,
  styleFromTheme,
  TEMPLATES,
  type StudioProject,
} from "../../src/ui/studio/model";
import { pieceMesh, triangulate } from "../../src/ui/studio/pieces";
import { arrowMesh } from "../../src/ui/studio/renderer";
import { compile, frameAt, holdSide, MAX_SIDE_TURN, plainMove, squareXZ, xzSquare } from "../../src/ui/studio/timeline";
import { duckedVolume, loopSeconds, synthLoop } from "../../src/ui/studio/music";
import { Chess } from "chess.js";
import { parseHash, toHash } from "../../src/ui/router";
import { environment } from "../../src/ui/studio/environments";
import { buildAiPrompt, guessPerspective, importAiScript, speechSheet, toAiScript } from "../../src/ui/studio/aiScript";
import { buildProject, defaultAnswers, suggestPerspective, distributeScript, explainMove, fenAt, fitLength, playMove, takeBack, treeFromPgn } from "../../src/ui/studio/wizard";

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
    expect(displaySan("Qxf7#")).toBe("Dxf7#");
    expect(displaySan("e8=N")).toBe("e8=S");
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
    // Moving pieces make no sound.
    expect(tl.sounds).toHaveLength(0);
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
    expect(mate.tempo).toBe(0.7);
    expect([variation.badge, p.scenes.find((s) => s.moves === "3… Sf6")!.badge]).toEqual(["best", "blunder"]);
    // Every effect the studio has is explained to the AI.
    for (const word of ["matt:", "drohung:", "spotlight:", "wackeln:", "zoom:", "blitz:", "konfetti:", "zeitlupe:"]) expect(prompt).toContain(`- ${word}`);
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
  const mate = () => make([scene({ moves: "1. f3 e5 2. g4 Dh4#", effects: ["mate", "threat"], badge: "brilliant", duration: 2 })]);

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
    expect(late.badge).toMatchObject({ kind: "brilliant", square: "h4" });
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

describe("studio for viewers", () => {
  it("keeps one side of the board for the whole video", () => {
    const scenes = [scene({ moves: "1. e4", camera: "white" }), scene({ moves: "1... e5", camera: "corner" })];
    const white = make(scenes);
    const black = { ...white, video: { ...white.video, perspective: "black" as const } };
    const yaw = (p: StudioProject, t: number) => frameAt(compile(p), p, t)!.camera.yaw;
    for (const t of [0.5, 5]) expect(yaw(black, t) - yaw(white, t)).toBeCloseTo(180);
    // "weiss"/"schwarz" from the AI mean a side, relative to the video's perspective.
    const r = importAiScript(JSON.stringify({ perspektive: "schwarz", szenen: [{ zug: "1. e4", kamera: "schwarz" }, { zug: "1... c5", kamera: "weiss", bewertung: "??" }] })).project!;
    expect([r.video.perspective, r.scenes[0].camera, r.scenes[1].camera, r.scenes[1].badge]).toEqual(["black", "white", "black", "blunder"]);
    expect(suggestPerspective(playMove(treeFromPgn("1. e4 e5 2. Lc4 Sc6 3. Dh5").tree, { line: "main", ply: 5 }, { from: "g7", to: "g6" })!.tree)).toBe("white");
    const t = treeFromPgn("1. e4 e5 2. Lc4 Sc6 3. Dh5 Sf6").tree;
    t.keyPly = 5;
    expect(suggestPerspective(t)).toBe("black");
  });

  it("draws each poll answer as an arrow in its button's colour", () => {
    const p = make([scene({ moves: "1. e4 e5 2. Lc4 Sc6 3. Dh5" }), scene({ card: "poll", options: ["A) Sf6", "B) g6", "C) Zauberzug"], countdown: 3, duration: 4 })]);
    const tl = compile(p);
    expect(tl.scenes[1].poll).toEqual([
      { from: "g8", to: "f6", colour: POLL_COLOURS[0], letter: "A" },
      { from: "g7", to: "g6", colour: POLL_COLOURS[1], letter: "B" },
    ]);
    const f = frameAt(tl, p, tl.scenes[1].start + 1.5)!;
    expect(f.arrows.filter((a) => a.colour).map((a) => [a.to, a.alpha])).toEqual([
      ["f6", 1],
      ["g6", 1],
    ]);
    expect(f.pollMarks.map((m) => m.letter)).toEqual(["A", "B"]);
  });

  it("spells moves out, says whose move it is and lights the squares the subtitle names", () => {
    const chess = new Chess();
    expect(["Nf3", "e5", "Nxe5"].map((m) => plainMove(chess.move(m)))).toEqual(["Springer von g1 nach f3", "Bauer von e7 nach e5", "Springer schlägt Bauer auf e5"]);
    expect(plainMove(new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1").move("O-O"))).toBe("Kurze Rochade: König nach g1");
    expect(plainMove(new Chess(parseMoves(START_FEN, "e4 e5 Lc4 Sc6 Dh5 Sf6").fen).move("Qxf7#"))).toBe("Dame schlägt Bauer auf f7, Matt");
    expect(plainMove(new Chess("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1").move("exd6"))).toBe("Bauer schlägt Bauer en passant auf d6");
    const p = make([scene({ moves: "1. e4 e5 2. Sf3", text: "Der Springer greift *e5* an.", duration: 5 })]);
    const tl = compile(p);
    const end = frameAt(tl, p, tl.total - 0.4)!;
    expect(end.pill).toMatchObject({ text: "2. Sf3", plain: "Springer von g1 nach f3", side: "w" });
    expect(end.hints.map((h) => h.square)).toEqual(["e5"]);
    // A piece in flight draws its path.
    const st = tl.scenes[0].steps[0];
    expect(frameAt(tl, p, (st.t0 + st.t1) / 2)!.arrows.some((a) => a.from === "e2" && a.to === "e4")).toBe(true);
    // Old projects with annotation symbols keep their badge.
    expect(normalizeProject({ scenes: [{ moves: "e4", badge: "!!" }] }).scenes[0].badge).toBe("brilliant");
  });
});

describe("studio perspective and sound", () => {
  it("never turns a Black video to White's side unless the scene asks for the opposite view", () => {
    const scenes = [scene({ moves: "1. e4 e5", camera: "side", orbit: 30, duration: 6 }), scene({ moves: "2. Lc4", camera: "corner", orbit: -30, duration: 6 })];
    const base = make(scenes);
    const black = { ...base, video: { ...base.video, perspective: "black" as const } };
    const tl = compile(black);
    for (let t = 0; t < tl.total; t += 0.25) {
      const yaw = frameAt(tl, black, t)!.camera.yaw;
      const off = ((((yaw - 180) % 360) + 540) % 360) - 180;
      expect(Math.abs(off)).toBeLessThanOrEqual(MAX_SIDE_TURN + 0.01);
    }
    expect(holdSide(170, true, true)).toBe(40);
    expect(holdSide(10, false, false)).toBe(10);
  });

  it("guesses Black for Black openings when the AI leaves out the perspective", () => {
    const r = importAiScript(JSON.stringify({ titel: "Die Englund-Gambit Falle", szenen: [{ zug: "1. d4 e5" }] }));
    expect(r.project!.video.perspective).toBe("black");
    expect(importAiScript(JSON.stringify({ titel: "Italienisch", szenen: [{ zug: "1. e4 e5" }] })).project!.video.perspective).toBe("white");
    expect(guessPerspective("Sizilianisch für Anfänger")).toBe("black");
    expect(buildAiPrompt({ topic: "x", platform: "tiktok", length: 30, notes: "", side: "black" })).toContain('"perspektive": "schwarz"');
  });

  it("makes seamless, clipped music loops and ducks them under the voice", () => {
    for (const id of ["lofi", "tension", "epic"] as const) {
      const pcm = synthLoop(id, 8000);
      expect(pcm.length).toBe(Math.round(loopSeconds(id) * 8000));
      expect(Math.max(...pcm.map(Math.abs))).toBeLessThanOrEqual(1);
      expect(pcm.some((x) => Math.abs(x) > 0.05)).toBe(true);
    }
    expect(duckedVolume(0.6, true)).toBeLessThan(0.6);
    expect(duckedVolume(0.6, false)).toBe(0.6);
    expect(normalizeProject({ video: { music: "bogus", musicVolume: 7 } }).video).toMatchObject({ music: "lofi", musicVolume: 1, voice: false });
  });
});

describe("studio framing", () => {
  it("backs the camera off when the board is turned, so no corner is cut", async () => {
    const { fitDistance } = await import("../../src/ui/studio/renderer");
    expect(fitDistance(0.56, 45)).toBeGreaterThan(fitDistance(0.56, 0) * 1.1);
    expect(fitDistance(0.56, 180)).toBeCloseTo(fitDistance(0.56, 0));
  });
});

describe("studio pieces and design", () => {
  it("gives every piece its own height and marks the bishop slit and knight eyes as details", () => {
    const height = (t: "p" | "n" | "b" | "r" | "q" | "k") => {
      const v = pieceMesh(t).vertices;
      let top = 0;
      for (let i = 1; i < v.length; i += STRIDE) top = Math.max(top, v[i]);
      return top;
    };
    const order = (["p", "r", "n", "b", "q", "k"] as const).map(height);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1] + 0.04);
    const details = (t: "b" | "n" | "p") => {
      const v = pieceMesh(t).vertices;
      let n = 0;
      for (let i = 9; i < v.length; i += STRIDE) if (v[i] > 0.25) n++;
      return n;
    };
    expect(details("b")).toBeGreaterThan(0);
    expect(details("n")).toBeGreaterThan(0);
    expect(details("p")).toBe(0);
  });

  it("lets the AI set the whole design and warns about text that will not fit", () => {
    const r = importAiScript(
      JSON.stringify({
        look: "walnuss",
        design: { figuren: "holz", untertitelStil: "kontur", schrift: "elegant", akzent: "#ffb84d", textgroesse: 1.2, musik: "episch", figurenRand: false },
        szenen: [{ zug: "1. e4", titel: "Ein viel zu langer Titel, der niemals in zwei Zeilen passt", untertitel: "x" }],
      }),
    );
    const p = r.project!;
    expect([p.style.theme, p.style.material, p.style.captionStyle, p.style.titleFont, p.style.accent, p.style.textScale, p.style.pieceRim, p.video.music]).toEqual(["walnuss", "wood", "outline", "serif", "#ffb84d", 1.2, false, "epic"]);
    expect(r.warnings.some((w) => w.includes("Titel"))).toBe(true);
    // Round trip keeps the design.
    const again = importAiScript(toAiScript(p)).project!;
    expect([again.style.material, again.style.captionStyle, again.video.music]).toEqual(["wood", "outline", "epic"]);
    expect(buildAiPrompt({ topic: "x", platform: "tiktok", length: 30, notes: "" })).toContain("SO SIEHT DAS VIDEO AUS");
  });
});

describe("studio long lessons and short captions", () => {
  it("cuts long short-video subtitles into glanceable parts but keeps lesson text whole", async () => {
    const { textParts, SHORT_CHUNK } = await import("../../src/ui/studio/timeline");
    const long = "Der Springer greift e5 an, und gleichzeitig deckt er d4. Schwarz muss jetzt reagieren, sonst fällt der Bauer.";
    const parts = textParts(long, true);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(SHORT_CHUNK);
    expect(parts.join(" ")).toBe(long);
    expect(textParts(long, false)).toEqual([long]);
    expect(textParts("A | B", false)).toEqual(["A", "B"]);
  });

  it("never cuts a text off: overlong parts turn pages at words and keep their highlights", async () => {
    const { textParts, SHORT_CHUNK, LESSON_CHUNK } = await import("../../src/ui/studio/timeline");
    // One long run without any punctuation used to stay in one piece and lose its end on screen.
    const run = "Der weiße Springer springt jetzt mitten ins Zentrum hinein und greift dabei gleich zwei schwarze Figuren auf einmal an";
    const parts = textParts(run, true);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(SHORT_CHUNK + 2);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(run);
    // A highlight that spans the cut is closed and reopened, so both halves stay coloured.
    const starred = textParts("Achtung *der Läufer auf c4 zielt die ganze Zeit schon auf den Punkt f7 neben dem König* jetzt", true);
    for (const p of starred) expect((p.match(/\*/g) ?? []).length % 2).toBe(0);
    // Lessons page only when the reading column is full.
    const lesson = "Ein ruhiger Satz zum Plan. ".repeat(20).trim();
    const pages = textParts(lesson, false);
    expect(pages.length).toBe(2);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(LESSON_CHUNK);
  });

  it("draws a piece letter as the piece itself only when the label really is a move", async () => {
    const { moveParts } = await import("../../src/ui/studio/compose");
    expect(moveParts("3. Lb5")).toEqual({ no: "3. ", piece: "L", rest: "b5", black: false });
    expect(moveParts("3… Sxe5+")).toEqual({ no: "3… ", piece: "S", rest: "xe5+", black: true });
    expect(moveParts("12. e4")).toMatchObject({ piece: "", rest: "e4" });
    expect(moveParts("Springer nach f3")).toMatchObject({ piece: "", rest: "Springer nach f3" });
    expect(moveParts("O-O")).toMatchObject({ piece: "", rest: "O-O" });
  });

  it("stands flat pieces on their own square, from above and from the side", async () => {
    const { drawStandees } = await import("../../src/ui/studio/flat");
    const { cameraMatrix } = await import("../../src/ui/studio/renderer");
    const W = 1080;
    const H = 1920;
    for (const pitch of [88, 54, 22]) {
      const camera = { yaw: 0, pitch, zoom: 1, tx: 0, tz: 0 };
      const { viewProj } = cameraMatrix(camera, W / H);
      const [x, z] = squareXZ("e4");
      let at = [0, 0];
      let rect = [0, 0, 0, 0];
      const ctx = {
        canvas: { width: W, height: H },
        save() {},
        restore() {},
        rotate() {},
        translate(a: number, b: number) {
          at = [a, b];
        },
        drawImage(_i: unknown, dx: number, dy: number, w: number, h: number) {
          rect = [at[0] + dx, at[1] + dy, w, h];
        },
      } as unknown as CanvasRenderingContext2D;
      const frame = { camera, pieces: [{ id: 1, type: "p", color: "w", x, y: 0, z, scale: 1, alpha: 1 }] } as unknown as Parameters<typeof drawStandees>[1];
      drawStandees(ctx, frame, viewProj, { "white-pawn": {} as HTMLImageElement });
      const c = toScreen(viewProj, [x, 0, z])!;
      const [left, top, w, h] = rect;
      // Centred sideways on the square at every angle.
      expect(Math.abs(left + w / 2 - c.x * W)).toBeLessThan(1);
      const foot = top + h * 0.88;
      const middle = top + h * 0.54;
      if (pitch === 88) expect(Math.abs(middle - c.y * H)).toBeLessThan(h * 0.05);
      else expect(foot).toBeGreaterThanOrEqual(c.y * H - 1);
      // The foot never lands on the square in front of it.
      const next = toScreen(viewProj, [x, 0, z + 0.5])!;
      expect(foot).toBeLessThan(next.y * H);
    }
  });

  it("shows the opening card from the very first frame, so its text never appears twice", () => {
    const p = make([scene({ card: "intro", title: "Die Spanische", text: "In 60 Sekunden", duration: 3 }), scene({ moves: "e4", title: "Zug", duration: 3 })]);
    const tl = compile(p);
    expect(frameAt(tl, p, 0)!.card.alpha).toBe(1);
    // Later cards still fade in.
    const q = make([scene({ moves: "e4", title: "Zug", duration: 3 }), scene({ card: "outro", title: "Ende", duration: 3 })]);
    const tq = compile(q);
    expect(frameAt(tq, q, tq.scenes[1].start + 0.05)!.card.alpha).toBeLessThan(0.5);
  });

  it("writes notation in texts out for beginners, but leaves squares and pawn moves alone", () => {
    expect(spellNotation("Nach *Sf3* und Lxc6 steht e5 schwach.")).toBe("Nach *Springer f3* und Läufer schlägt auf c6 steht e5 schwach.");
    expect(spellNotation("Dxf7# gewinnt, Td8+ auch, Nf3 ist englisch.")).toBe("Dame schlägt auf f7, Matt gewinnt, Turm d8 mit Schach auch, Springer f3 ist englisch.");
    expect(spellNotation("Nach O-O-O oder 0-0 kommt exd5 und e8=D.")).toBe("Nach lange Rochade oder kurze Rochade kommt Bauer schlägt auf d5 und e8 wird Dame.");
    // Words, squares, arrows and pawn moves stay untouched.
    expect(spellNotation("Der König auf e1, Bauer e4, Pfeil f3-e5, Kd")).toBe("Der König auf e1, Bauer e4, Pfeil f3-e5, Kd");
    // In the video it applies to titles and subtitles, the stored project stays as written.
    const p = make([scene({ moves: "1. e4", title: "Warum Sf3?", text: "Weil *Sf3* e5 angreift.", duration: 4 })]);
    const tl = compile(p);
    const f = frameAt(tl, p, 3)!;
    expect([f.title.text, f.text.text]).toEqual(["Warum Springer f3?", "Weil *Springer f3* e5 angreift."]);
    expect(p.scenes[0].text).toBe("Weil *Sf3* e5 angreift.");
    const off = { ...p, video: { ...p.video, spellMoves: false } };
    expect(frameAt(compile(off), off, 3)!.text.text).toBe("Weil *Sf3* e5 angreift.");
  });

  it("uses the flat 2D board for YouTube lessons and keeps 3D for short videos", () => {
    // New lessons from the assistant and the AI import start in 2D, short videos in 3D.
    const lessonJson = buildAiPrompt({ topic: "Italienisch", platform: "youtube", length: 240, notes: "" });
    const lesson = importAiScript(lessonJson.slice(lessonJson.indexOf("```json") + 7, lessonJson.lastIndexOf("```"))).project!;
    expect(lesson.style.view).toBe("2d");
    const shortJson = buildAiPrompt({ topic: "Falle", platform: "tiktok", length: 30, notes: "" });
    expect(importAiScript(shortJson.slice(shortJson.indexOf("```json") + 7, shortJson.lastIndexOf("```"))).project!.style.view).toBe("3d");
    // The AI can ask for either look, and the round trip keeps it.
    const asked = importAiScript(JSON.stringify({ plattform: "tiktok", design: { ansicht: "2d" }, szenen: [{ zug: "e4", titel: "x" }] })).project!;
    expect(asked.style.view).toBe("2d");
    expect(toAiScript(asked)).toContain('"ansicht": "2d"');
    // Saved projects from before: lessons switch to 2D, everything else stays 3D.
    expect(normalizeProject({ video: { format: "16:9", lesson: true } }).style.view).toBe("2d");
    expect(normalizeProject({ video: { format: "9:16" } }).style.view).toBe("3d");
    expect(normalizeProject({ style: { view: "3d" }, video: { format: "16:9", lesson: true } }).style.view).toBe("3d");
    // Flat standees on the 3D board: a look of its own, also for the AI.
    expect(normalizeProject({ style: { view: "billboard" } }).style.view).toBe("billboard");
    const standees = importAiScript(JSON.stringify({ design: { ansicht: "aufsteller" }, szenen: [{ zug: "e4", titel: "x" }] })).project!;
    expect(standees.style.view).toBe("billboard");
    expect(toAiScript(standees)).toContain('"ansicht": "aufsteller"');
  });

  it("maps the flat board so overlays and clicks land on the right square, from both sides", async () => {
    const { boardSlot, flatView, flatMatrix } = await import("../../src/ui/studio/flat");
    for (const yaw of [0, 180]) {
      const frame = { camera: { yaw, pitch: 54, zoom: 1, tx: 0, tz: 0 }, lesson: true } as Parameters<typeof flatView>[0];
      const slot = boardSlot(1920, 1080, true);
      const view = flatView(frame, slot);
      const m = flatMatrix(1920, 1080, view);
      const [x, z] = squareXZ("b2");
      const p = toScreen(m, [x, 0, z])!;
      // White's corner is bottom left from White's side, top right from Black's.
      if (yaw === 0) expect([p.x < 0.3, p.y > 0.5]).toEqual([true, true]);
      else expect([p.x > 0.15, p.y < 0.5]).toEqual([true, true]);
      // The lesson board stays left of the reading column.
      expect(slot.cx + slot.size / 2).toBeLessThan(1920 * 0.6);
      const hit = screenToBoard(m, p.x, p.y)!;
      expect(xzSquare(hit.x, hit.z)).toBe("b2");
    }
    // In a tall video the board sits between the move pill and the subtitles and stays inside the picture.
    const tall = boardSlot(1080, 1920, false);
    expect(tall.size).toBeGreaterThan(650);
    expect(tall.cy - tall.size / 2).toBeGreaterThan(560);
    expect(tall.cy + tall.size / 2).toBeLessThan(1920 - 470);
  });

  it("builds YouTube scripts as calm lessons with the board left and a move list", () => {
    const prompt = buildAiPrompt({ topic: "Italienisch", platform: "youtube", length: 240, notes: "" });
    expect(prompt).toContain("LERNVIDEO");
    expect(prompt).toContain("4 Minuten");
    const json = prompt.slice(prompt.indexOf("```json") + 7, prompt.lastIndexOf("```"));
    const r = importAiScript(json);
    expect(r.errors).toEqual([]);
    const p = r.project!;
    expect([p.video.format, p.video.lesson, p.video.tempo]).toEqual(["16:9", true, 0.8]);
    const tl = compile(p);
    const f = frameAt(tl, p, tl.scenes[2].start + tl.scenes[2].dur - 0.5)!;
    expect(f.lesson).toBe(true);
    expect(f.moveList).toEqual(["1. e4", "1… e5", "2. Sf3"]);
    // The short prompt asks for glanceable subtitles.
    expect(buildAiPrompt({ topic: "x", platform: "tiktok", length: 30, notes: "" })).toContain("höchstens 60 Zeichen");
  });
});

describe("studio mp4 writer", () => {
  it("lays out ftyp, mdat and moov with chunk offsets pointing at each sample", async () => {
    const { muxMp4 } = await import("../../src/ui/studio/mp4");
    const v = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
    const a = [new Uint8Array([7, 7]), new Uint8Array([8])];
    const file = muxMp4([
      { kind: "video", timescale: 30000, config: new Uint8Array([1, 100, 0, 40]), width: 1080, height: 1920, samples: v.map((data, i) => ({ data, duration: 1000, key: i === 0 })) },
      { kind: "audio", codec: "aac", timescale: 48000, config: new Uint8Array([0x11, 0x90]), channels: 2, sampleRate: 48000, samples: a.map((data) => ({ data, duration: 1024, key: true })) },
    ]);
    const dv = new DataView(file.buffer);
    const top: string[] = [];
    let o = 0;
    while (o < file.length) {
      top.push(String.fromCharCode(...file.subarray(o + 4, o + 8)));
      o += dv.getUint32(o);
    }
    expect(top).toEqual(["ftyp", "mdat", "moov"]);
    expect(o).toBe(file.length);
    // Every stco offset points at the matching sample's first byte.
    const firsts: number[] = [];
    for (let i = 0; i + 4 < file.length; i++) {
      if (String.fromCharCode(...file.subarray(i, i + 4)) !== "stco") continue;
      const n = dv.getUint32(i + 8);
      for (let k = 0; k < n; k++) firsts.push(file[dv.getUint32(i + 12 + k * 4)]);
    }
    expect(firsts).toEqual([1, 4, 6, 7, 8]);
  });
});
