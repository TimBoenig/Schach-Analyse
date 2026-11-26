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
  closeTemplate,
  type StudioProject,
} from "../../src/ui/studio/model";
import { pieceMesh, triangulate } from "../../src/ui/studio/pieces";
import { arrowMesh } from "../../src/ui/studio/renderer";
import { compile, frameAt, holdSide, MAX_SIDE_TURN, plainMove, squareXZ, xzSquare } from "../../src/ui/studio/timeline";
import { mixHasSound } from "../../src/ui/studio/audio";
import { duckedVolume, loopSeconds, synthLoop } from "../../src/ui/studio/music";
import { Chess } from "chess.js";
import { parseHash, toHash } from "../../src/ui/router";
import { environment } from "../../src/ui/studio/environments";
import { reelCamera, reelSquareAt } from "../../src/ui/studio/reel";
import { REEL_BEAT } from "../../src/ui/studio/timeline";
import { setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";
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
    // Every landing piece knocks once, at the end of its step.
    expect(tl.sounds).toEqual(c.steps.map((st) => ({ t: c.start + st.t1, kind: "move" })));
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

  it("writes the prompt and the export with English field names on an English page, and reads both back", () => {
    setLangNow("en", EN);
    try {
      for (const platform of ["reels", "youtube"] as const) {
        const prompt = buildAiPrompt({ topic: "Italian", platform, length: 30, notes: "", side: "black" });
        expect(prompt).toContain('"scenes"');
        expect(prompt).toContain('"perspective": "black"');
        expect(prompt).not.toMatch(/"(szenen|zug|untertitel|sprechtext|kamera)"/);
        const r = importAiScript(prompt);
        expect(r.errors).toEqual([]);
        // The long example is deliberately shorter than its stated length, in both languages.
        expect(r.warnings.length).toBe(platform === "youtube" ? 1 : 0);
        const p = r.project!;
        const out = toAiScript(p);
        expect(out).not.toMatch(/"(szenen|zug|kamera|markierungen|pfeile)"/);
        const again = importAiScript(out).project!;
        expect(again.scenes.map((s) => [s.moves, s.camera, s.arrows, s.marks, s.effects, s.badge])).toEqual(p.scenes.map((s) => [s.moves, s.camera, s.arrows, s.marks, s.effects, s.badge]));
      }
    } finally {
      setLangNow("de");
    }
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
    for (const id of ["lofi", "tension", "epic", "beat"] as const) {
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

describe("reel look", () => {
  const project = TEMPLATES.find((x) => x.id === "reel")!.make();
  const tl = compile(project);

  it("is a square, silent-looking template in the reel view and survives a stored-project repair", () => {
    expect(project.style.view).toBe("reel");
    expect(project.style.theme).toBe("mono");
    expect(project.video.format).toBe("1:1");
    expect(normalizeProject(JSON.parse(JSON.stringify(project))).style.view).toBe("reel");
  });

  it("flows without a cut: no strobe at scene changes, and shake only on the mating blow", () => {
    const cam = (tk: number) => reelCamera(frameAt(tl, project, tk)!, 1080, 1080);
    // No scene change strobes white (a white pulse is a cut), only the first picture is plain too.
    for (const c of tl.scenes.filter((sc) => !sc.scene.effects.includes("mate"))) expect(cam(c.start + 0.05).flash).toBe(0);
    // The mate scene shakes after the moves landed, and no camera ever leaves the board's bounds.
    const mate = tl.scenes.find((c) => c.scene.effects.includes("mate"))!;
    const late = cam(mate.start + mate.fxAt + 0.05);
    expect(Math.abs(late.shakeX) + Math.abs(late.shakeY)).toBeGreaterThan(1);
    // The mate backs the camera off to the whole board so the breaking pieces are all in view.
    const settled = cam(mate.start + mate.fxAt + 1.2);
    expect(settled.S).toBeLessThan(1080 / 7);
    expect(settled.fx).toBeCloseTo(0, 1);
    for (let tk = 0.01; tk < tl.total; tk += 0.05) {
      const c = cam(tk);
      expect(c.S).toBeGreaterThan((1080 / 9.2) * 0.4);
      expect(Math.abs(c.fx)).toBeLessThanOrEqual(3.5);
      expect(Math.abs(c.fz)).toBeLessThanOrEqual(3.5);
    }
  });

  it("moves the camera smoothly: a scene change never jumps the picture, and the overview is kept", () => {
    const cam = (tk: number) => reelCamera(frameAt(tl, project, tk)!, 1080, 1080);
    const dt = 1 / 30;
    // Frame to frame, outside the mating blow, the zoom changes by a few percent at most, the centre by under a square, the horizon by a few degrees.
    const mate = tl.scenes.find((c) => c.scene.effects.includes("mate"))!;
    let prev = cam(0.01);
    for (let tk = dt; tk < tl.total - 0.1; tk += dt) {
      const c = cam(tk);
      const inMate = tk > mate.start && tk < mate.start + mate.dur;
      if (!inMate) {
        expect(Math.abs(Math.log(c.S / prev.S))).toBeLessThan(0.18);
        expect(Math.hypot(c.fx - prev.fx, c.fz - prev.fz)).toBeLessThan(0.6);
        expect(Math.abs(c.roll - prev.roll)).toBeLessThan(0.05);
      }
      prev = c;
    }
    // The tightest the camera ever gets is still more than three squares across; it moves in and out and never stays at one size.
    let tightest = 0;
    let widest = Infinity;
    for (let tk = 0.01; tk < tl.total - 0.1; tk += 0.05) {
      const s = cam(tk).S;
      tightest = Math.max(tightest, s);
      widest = Math.min(widest, s);
    }
    expect(tightest).toBeLessThan(1080 / 2.8);
    expect(tightest / widest).toBeGreaterThan(1.3);
  });

  it("pulls the shot back so a long arrow stays in the picture, and maps clicks back to squares", () => {
    const fork = tl.scenes.find((c) => c.scene.moves === "Nc7+")!;
    const frame = frameAt(tl, project, fork.start + fork.annotate + 0.6)!;
    const cam = reelCamera(frame, 1080, 1080);
    const [ax, az] = squareXZ("c7");
    const [bx, bz] = squareXZ("e8");
    expect(Math.hypot(bx - ax, bz - az) * cam.S).toBeLessThan(0.75 * 1080);
    // The camera's own centre is a square of the board, and the square it looks at maps to the middle of the picture.
    const view = { ...cam, W: 1080, H: 1080, dir: 1 as const };
    expect(reelSquareAt(view, 0.5 - cam.shakeX / 1080, 0.5 - cam.shakeY / 1080)).toBe(xzSquare(Math.max(-3.5, Math.min(3.5, cam.fx)), Math.max(-3.5, Math.min(3.5, cam.fz))));
  });

  it("keeps scenes on the 90 BPM grid of the reference and moves starting right away", () => {
    // Reference: hard cuts every 20 frames (0.667 s) at 90 BPM, so every scene is a whole number of beats.
    for (const c of tl.scenes) expect(c.dur / REEL_BEAT).toBeCloseTo(Math.round(c.dur / REEL_BEAT), 5);
    // An ordinary move starts right away and is quick.
    const plain = tl.scenes.find((c) => c.steps.length && !c.scene.badge.match(/brilliant|great|best/) && !c.scene.effects.includes("slowmo"))!;
    expect(plain.steps[0].t0).toBeLessThan(0.15);
    expect(plain.steps[0].t1 - plain.steps[0].t0).toBeLessThan(0.7);
  });

  it("shows off a great move: in close on the piece, slow spin through the air, hard landing, back out", () => {
    const fork = tl.scenes.find((c) => c.scene.moves === "Nc7+")!;
    const step = fork.steps[fork.steps.length - 1];
    const at = (dt: number) => frameAt(tl, project, fork.start + dt)!;
    const cam = (dt: number) => reelCamera(at(dt), 1080, 1080);
    // The camera is in before take-off, and the move itself is in slow motion (an ordinary move takes 0.4 s).
    expect(step.t0).toBeGreaterThan(0.5);
    expect(step.t1 - step.t0).toBeGreaterThan(0.8);
    expect(cam(step.t0).S).toBeGreaterThan(cam(0.02).S * 1.3);
    // In the air the camera stays on the piece, close but still about three squares across.
    const mid = (step.t0 + step.t1) / 2;
    const flying = at(mid).pieces.find((p) => p.flight && p.flight.k > 0 && p.flight.k < 1)!;
    expect(Math.hypot(cam(mid).fx - flying.x, cam(mid).fz - flying.z)).toBeLessThan(0.3);
    expect(cam(mid).S).toBeLessThanOrEqual(1080 / 3.3 + 1e-6);
    // The landing hits: the picture shakes and flashes briefly.
    const hit = cam(step.t1 + 0.02);
    expect(Math.abs(hit.shakeX) + Math.abs(hit.shakeY)).toBeGreaterThan(1);
    expect(hit.flash).toBeGreaterThan(0);
    // Then the camera backs out again before the scene ends.
    expect(cam(fork.dur - 0.02).S).toBeLessThan(cam(mid).S * 0.8);
    // A blunder is no show.
    const blunder = tl.scenes.find((c) => c.scene.badge === "blunder")!;
    expect(blunder.steps[0].t0).toBeLessThan(0.15);
  });

  it("starts on the board without a title card, showing the whole board first and then flying in", () => {
    expect(project.scenes[0].card).toBe("none");
    expect(project.scenes[0].title).toBe("");
    const cam = (tk: number) => reelCamera(frameAt(tl, project, tk)!, 1080, 1080);
    // The first picture is the overview: the whole board (8 squares and a margin) in the middle, held for a moment.
    for (const tk of [0.01, 0.3, 0.6]) {
      expect(1080 / cam(tk).S).toBeGreaterThanOrEqual(8.7);
      expect(Math.abs(cam(tk).fx) + Math.abs(cam(tk).fz)).toBeLessThan(0.05);
    }
    // The picture is alive from the first frame (the horizon sways a little), and the camera closes in afterwards.
    expect(Math.abs(cam(0.3).roll - cam(0.01).roll)).toBeGreaterThan(1e-4);
    expect(cam(tl.scenes[0].dur - 0.02).S).toBeGreaterThan(cam(0.01).S * 1.05);
  });

  it("an AI script of type edit becomes a quiet, fast reel, and the prompt asks for the type", () => {
    const text = JSON.stringify({ videoart: "edit", titel: "T", laenge: 40, szenen: [{ zug: "1. e4" }, { zug: "1... e5" }, { zug: "2. Nf3", dauer: 0.6 }] });
    const res = importAiScript(text);
    const p = res.project!;
    expect(p.style.view).toBe("reel");
    expect(p.style.theme).toBe("mono");
    expect(p.video.music).toBe("generated");
    expect(p.video.lucena).toBe(false);
    expect(p.video.tempo).toBeGreaterThan(2);
    // Scenes without a duration default to one beat and are not stretched to the asked length.
    expect(p.scenes.map((x) => x.duration)).toEqual([0.6, 0.6, 0.6]);
    // The same script without the type stays an explainer.
    expect(importAiScript(JSON.stringify({ titel: "T", szenen: [{ zug: "1. e4" }] })).project!.style.view).not.toBe("reel");
    // A reel project exports with its type, and the prompt asks for it or sets it.
    expect(toAiScript(p)).toContain("videoart");
    expect(buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "" })).toContain('"videoart"');
    expect(buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "", type: "edit" })).toContain("EDIT-REGELN");
    expect(buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "", type: "explain" })).toContain('"videoart": "erklaerung"');
    // The example in an edit prompt imports without a single complaint.
    const example = buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "", type: "edit" }).split("```json")[1].split("```")[0];
    const ex = importAiScript(example);
    expect(ex.errors).toEqual([]);
    expect(ex.project!.style.view).toBe("reel");
  });

  it("is reachable from an AI script", () => {
    const text = JSON.stringify({ titel: "T", look: "reel", design: { ansicht: "reel" }, szenen: [{ zug: "1. e4", titel: "x", untertitel: "y", dauer: 3 }] });
    const res = importAiScript(text);
    expect(res.project?.style.view).toBe("reel");
    expect(res.project?.style.theme).toBe("mono");
  });
});

describe("edit pressure: hit-stop, cuts, strengths, stamps", () => {
  const reelOf = (scenes: StudioProject["scenes"]): StudioProject => ({ ...make(scenes), style: { ...styleFromTheme("mono"), view: "reel" }, video: { ...DEFAULT_VIDEO, introFly: false, tempo: 2.4 } });

  it("freezes the animation clock for 0.25 s at the impact while the post effects keep running", () => {
    const p = reelOf([scene({ moves: "1. e4", duration: 1.4, effects: ["hitstop", "invert"], stamp: "wow" })]);
    const tl = compile(p);
    const c = tl.scenes[0];
    expect(c.hit).toBe(c.fxAt);
    const before = frameAt(tl, p, c.fxAt - 0.05)!;
    const during = frameAt(tl, p, c.fxAt + 0.1)!;
    const later = frameAt(tl, p, c.fxAt + 0.2)!;
    const after = frameAt(tl, p, c.fxAt + 0.3)!;
    // The picture (clock) stands still from the impact until 0.25 s later, then runs on from there.
    expect(during.local).toBeCloseTo(c.fxAt, 5);
    expect(later.local).toBeCloseTo(c.fxAt, 5);
    expect(after.local).toBeCloseTo(c.fxAt + 0.05, 5);
    expect(before.local).toBeLessThan(c.fxAt);
    // The invert flash and the stamp play on the real clock, during the freeze.
    expect(before.impact.invert).toBe(0);
    expect(during.impact.invert).toBe(1);
    expect(after.impact.invert).toBe(0);
    expect(during.impact.stamp).toMatchObject({ text: "WOW" });
    expect(frameAt(tl, p, c.fxAt + 0.45)!.impact.stamp).toBeNull();
    // Scenes stay a whole number of beats and are as long as the freeze needs.
    expect(c.dur / REEL_BEAT).toBeCloseTo(Math.round(c.dur / REEL_BEAT), 6);
    expect(c.dur).toBeGreaterThanOrEqual(c.fxAt + 0.25);
    // The very last frame of the scene is not still in the middle of a fade: tails count in clock time.
    expect(frameAt(tl, p, c.dur - 1e-3)!.dur).toBeCloseTo(c.dur - 0.25, 6);
  });

  it("gives a blunder or brilliant move in the reel look the invert flash and RGB split by itself, unless switched off", () => {
    const flash = (badge: "blunder" | "best", power: Partial<Record<"invert" | "glitch", number>> = {}) => {
      const p = reelOf([scene({ moves: "1. e4", duration: 1.4, badge, power })]);
      const tl = compile(p);
      return frameAt(tl, p, tl.scenes[0].fxAt + 0.05)!.impact;
    };
    expect(flash("blunder")).toMatchObject({ invert: 1 });
    expect(flash("blunder").glitch).toBeGreaterThan(0.3);
    expect(flash("best").invert).toBe(0);
    expect(flash("blunder", { invert: 0, glitch: 0 })).toMatchObject({ invert: 0, glitch: 0 });
    // A half-strength invert is half inverted.
    const p = reelOf([scene({ moves: "1. e4", effects: ["invert"], power: { invert: 0.5 } })]);
    const tl = compile(p);
    expect(frameAt(tl, p, tl.scenes[0].fxAt + 0.05)!.impact.invert).toBe(0.5);
  });

  it("cuts through the angles of a scene on the beat, quickly, and starts after the hit-stop", () => {
    const p = make([scene({ moves: "1. e4", duration: 3, cameras: ["close", "low", "top"] }), scene({ duration: 3, cameras: ["close", "top"], effects: ["hitstop"], moves: "1... e5" })]);
    const tl = compile(p);
    const [a, b] = tl.scenes;
    // Three angles share the scene evenly.
    expect(a.cutIv).toBeCloseTo((a.dur - a.cutFrom) / 3, 6);
    const preset = (c: typeof a, local: number) => frameAt(tl, p, c.start + local)!.cut?.preset;
    expect(preset(a, 0.01)).toBe("close");
    expect(preset(a, a.cutIv + 0.01)).toBe("low");
    expect(preset(a, 2 * a.cutIv + 0.01)).toBe("top");
    // A whip, not a slow flight: half way through the cut the yaw is between the two angles, a fifth of a second later it has arrived.
    const yaw = (local: number) => frameAt(tl, p, a.start + local)!.camera.yaw;
    expect(yaw(a.cutIv + 0.1)).toBeLessThan(Math.max(yaw(a.cutIv - 0.01), yaw(a.cutIv + 0.3)));
    expect(yaw(a.cutIv + 0.25)).toBeCloseTo(yaw(a.cutIv + 0.3), 0);
    // With a hit-stop the plain camera runs until the impact, the cuts begin there.
    expect(b.cutFrom).toBe(b.fxAt);
    expect(frameAt(tl, p, b.start + b.fxAt - 0.05)!.cut).toBeNull();
    expect(frameAt(tl, p, b.start + b.fxAt + 0.3)!.cut?.preset).toBe("close");
    expect(b.dur).toBeGreaterThanOrEqual(b.fxAt + 0.25 + 2 * 0.25);
  });

  it("scales shake and zoom with their strength and pushes the picture in with punch and riser", () => {
    const shake = (power: number) => {
      const p = make([scene({ moves: "1. e4", effects: ["shake"], power: { shake: power } })]);
      const tl = compile(p);
      const c = tl.scenes[0];
      const tremor = (tk: number) => frameAt(tl, p, c.start + c.fxAt + tk)!.camera;
      return Math.abs(tremor(0.02).yaw - tremor(0.4).yaw) + Math.abs(tremor(0.02).tx - tremor(0.4).tx);
    };
    expect(shake(1)).toBeGreaterThan(shake(0.3) * 2);
    const p = make([scene({ moves: "1. e4", duration: 3, effects: ["punch", "dutch"] }), scene({ moves: "1... e5", duration: 3, effects: ["dutch", "riser"], power: { dutch: 0.5 } })]);
    const tl = compile(p);
    const at = (i: number, local: number) => frameAt(tl, p, tl.scenes[i].start + local)!;
    // Punch-in: from 1.0 to 0.65 in half a second, then it stays.
    expect(at(0, 0).push).toBe(1);
    expect(at(0, 0.5).push).toBeCloseTo(0.65, 5);
    expect(at(0, 2).push).toBeCloseTo(0.65, 5);
    // Dutch angle tilts one way, the next scene the other way, half as much at half strength.
    expect(at(0, 1).roll).toBeCloseTo(12, 5);
    expect(at(1, 1).roll).toBeCloseTo(-6, 5);
    expect(at(0, 1).camera.roll).toBeCloseTo(12, 5);
    // Riser: slow at first, faster towards the impact, closer at the end.
    const c = tl.scenes[1];
    expect(at(1, c.fxAt * 0.3).push).toBeGreaterThan(at(1, c.fxAt * 0.7).push);
    expect(1 - at(1, c.fxAt * 0.6).push).toBeLessThan((1 - at(1, c.fxAt).push) * 0.5);
    expect(at(1, c.fxAt).push).toBeLessThan(0.75);
  });

  it("frames each angle of a cutting reel scene differently and rolls the horizon for a Dutch angle", () => {
    const p = reelOf([scene({ moves: "1. e4", duration: 2, cameras: ["top", "close", "side"] })]);
    const tl = compile(p);
    const c = tl.scenes[0];
    const cam = (local: number) => reelCamera(frameAt(tl, p, c.start + local)!, 1080, 1080);
    const wide = cam(c.cutIv * 0.9);
    const near = cam(c.cutIv + 0.4);
    expect(near.S).toBeGreaterThan(wide.S * 1.3);
    // Side angle leans the horizon the other way than top does.
    expect(cam(2 * c.cutIv + 0.4).roll).not.toBeCloseTo(wide.roll, 2);
    const tilted = reelOf([scene({ moves: "1. e4", duration: 2, effects: ["dutch"] })]);
    const plain = reelOf([scene({ moves: "1. e4", duration: 2 })]);
    const rollOf = (q: StudioProject) => reelCamera(frameAt(compile(q), q, 1.9)!, 1080, 1080).roll;
    expect(Math.abs(rollOf(tilted) - rollOf(plain))).toBeCloseTo((12 * Math.PI) / 180, 3);
    // The zoom stays out of the black around the board whatever the cuts do.
    for (let tk = 0.01; tk < c.dur; tk += 0.05) expect(Math.abs(cam(tk).fx)).toBeLessThanOrEqual(3.5);
  });

  it("blurs only a scene that asks for a whip, along the way the camera swings", () => {
    const p = make([scene({ moves: "1. e4", duration: 2, cameras: ["close", "side"], effects: ["whip"] }), scene({ duration: 2, cameras: ["close", "side"] })]);
    const tl = compile(p);
    const a = tl.scenes[0];
    const mid = frameAt(tl, p, a.start + a.cutIv + 0.1)!.impact.blur!;
    expect(mid.amount).toBeGreaterThan(0.9);
    expect(Math.hypot(mid.dx, mid.dy)).toBeCloseTo(1, 5);
    // Sideways for a turn of the camera, none when it stands still.
    expect(Math.abs(mid.dx)).toBeGreaterThan(0.8);
    expect(frameAt(tl, p, a.start + a.cutIv + 0.4)!.impact.blur).toBeNull();
    expect(frameAt(tl, p, tl.scenes[1].start + tl.scenes[1].cutIv + 0.1)!.impact.blur).toBeNull();
  });

  it("repairs the new scene fields of stored projects and old projects keep working", () => {
    const raw = JSON.parse(JSON.stringify(make([scene({ moves: "1. e4" })])));
    raw.scenes[0].cameras = ["close", "nonsense", "top"];
    raw.scenes[0].stamp = "very long stamp text that is cut";
    raw.scenes[0].power = { shake: 7, bogus: 1, zoom: "x" };
    delete raw.scenes[0].effects;
    const fixed = normalizeProject(raw).scenes[0];
    expect(fixed.cameras).toEqual(["close", "top"]);
    expect(fixed.stamp).toBe("VERY LONG STAM");
    expect(fixed.power).toEqual({ shake: 1 });
    const old = JSON.parse(JSON.stringify(make([scene({ moves: "1. e4" })])));
    for (const k of ["cameras", "stamp", "power"]) delete old.scenes[0][k];
    expect(normalizeProject(old).scenes[0]).toMatchObject({ cameras: [], stamp: "", power: {} });
  });
});

describe("AI script: game on top, half-move numbers, cuts and strengths", () => {
  const PGN = "[Event \"x\"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0";
  const run = (scenes: unknown[], extra: Record<string, unknown> = {}) => importAiScript(JSON.stringify({ videoart: "edit", titel: "T", pgn: PGN, szenen: scenes, ...extra }));

  it("plays the named half-moves of the game and shows the same position again without a number", () => {
    const res = run([{ zugNr: "1-3" }, { dauer: 1.3, kameras: ["nah", "oben"] }, { zugNr: 4 }, { zugNr: 5 }, { zugNr: "4." }]);
    expect(res.errors).toEqual([]);
    const sc = res.project!.scenes;
    expect(sc.map((s) => s.moves)).toEqual(["1. e4 e5 2. Lc4", "", "2… Sc6", "3. Dh5", "4. Dxf7#"]);
    // Continuing needs no jump; a scene without number stays on the position, and skipping ahead cross-fades to the position before the move.
    expect(sc.map((s) => s.fen === "")).toEqual([true, true, true, true, false]);
    const positions = scenePositions(res.project!);
    expect(positions[1].before).toBe(positions[0].after);
    expect(sc[4].fen).toBe(positions[4].before);
    expect(positions[4].before).not.toBe(positions[3].after);
    expect(new Chess(positions[4].after).isCheckmate()).toBe(true);
    // The mate gets its animation, the scene without a camera takes the first cut as its own.
    expect(sc[4].effects).toContain("mate");
    expect(sc[1]).toMatchObject({ cameras: ["close", "top"], camera: "close" });
  });

  it("counts chess move numbers as half-moves, jumps back, and reports numbers that do not exist", () => {
    const res = run([{ zugNr: 7 }, { zugNr: "1..." }, { zugNr: 9 }, { zugNr: "abc" }]);
    const sc = res.project!.scenes;
    expect(sc[0].moves).toBe("4. Dxf7#");
    expect(sc[1].moves).toBe("1… e5");
    expect(sc[1].fen).not.toBe("");
    expect(res.warnings.join("|")).toContain("zugNr 9");
    expect(res.warnings.join("|")).toContain("abc");
    // Without a game on top zugNr is ignored with a hint, and spelled-out moves still work next to it.
    const none = importAiScript(JSON.stringify({ szenen: [{ zugNr: 3, zug: "1. e4" }] }));
    expect(none.project!.scenes[0].moves).toBe("1. e4");
    expect(none.warnings.join("|")).toContain("zugNr");
    // An impossible move in the game is named; the moves before it are usable.
    const broken = importAiScript(JSON.stringify({ pgn: "1. e4 e5 2. Ke4 Nc6", szenen: [{ zugNr: 2 }] }));
    expect(broken.errors.join("|")).toContain("Ke4");
    expect(broken.project!.scenes[0].moves).toBe("1… e5");
    // The old format with spelled-out moves is untouched.
    expect(importAiScript(JSON.stringify({ szenen: [{ zug: "1. e4 e5" }] })).project!.scenes[0].moves).toBe("1. e4 e5");
  });

  it("reads effect strengths in every shape and leaves out effects with strength 0", () => {
    const res = run([
      { zugNr: 1, effekte: { wackeln: 0.3, zoom: 1, blitz: 0 } },
      { zugNr: 2, effekte: ["wackeln:0.4", { effekt: "glitch", staerke: 0.5 }, "Hitstop"] },
      { zugNr: 3, effekte: ["wackeln", "punch"], intensitaet: 0.5 },
      { zugNr: 4, wackeln: 0.2, invert: true, stempel: "sacrifice", bewertung: "patzer" },
      { zugNr: 5, effekte: ["gibtesnicht"] },
    ]);
    const sc = res.project!.scenes;
    expect(sc[0].effects).toEqual(["shake", "zoom"]);
    expect(sc[0].power).toEqual({ shake: 0.3, flash: 0 });
    expect(sc[1].effects).toEqual(["shake", "glitch", "hitstop"]);
    expect(sc[1].power).toEqual({ shake: 0.4, glitch: 0.5 });
    expect(sc[2].power).toEqual({ shake: 0.5, punch: 0.5 });
    expect(sc[3]).toMatchObject({ effects: expect.arrayContaining(["shake", "invert"]), power: { shake: 0.2 }, stamp: "SACRIFICE" });
    expect(res.warnings.join("|")).toContain("gibtesnicht");
  });

  it("exports cuts, stamps and strengths in the same format, in both languages, and reads them back", () => {
    const res = run([{ zugNr: "1-2", kameras: ["nah", "tief"], stempel: "??", effekte: { wackeln: 0.3, hitstop: 1, invert: 0 } }]);
    const out = toAiScript(res.project!);
    expect(out).toContain('"kameras"');
    expect(out).toContain('"stempel": "??"');
    expect(out).toContain('"wackeln": 0.3');
    expect(out).toContain('"invert": 0');
    const back = importAiScript(out).project!.scenes[0];
    expect(back).toMatchObject({ cameras: ["close", "low"], stamp: "??", power: { shake: 0.3, invert: 0 } });
    expect(back.effects).toEqual(["shake", "hitstop"]);
    setLangNow("en", EN);
    try {
      const en = toAiScript(res.project!);
      expect(en).toContain('"cameras"');
      expect(en).toContain('"stamp"');
      expect(en).toContain('"shake": 0.3');
      expect(importAiScript(en).project!.scenes[0]).toMatchObject({ cameras: ["close", "low"], stamp: "??", power: { shake: 0.3, invert: 0 } });
    } finally {
      setLangNow("de");
    }
  });

  it("teaches the prompt the game on top, the cuts, strengths and stamps, and its example uses them cleanly", () => {
    const prompt = buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "", type: "edit" });
    for (const word of ['"pgn"', "zugNr", '"kameras"', '"stempel"', "hitstop", "riser", "whip", "schraeglage", "intensitaet"]) expect(prompt).toContain(word);
    const example = prompt.split("```json")[1].split("```")[0];
    const res = importAiScript(example);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    const p = res.project!;
    // The example is built like the advice: calm build-up, impact with hit-stop and stamp, quick cuts, mate with full strength.
    expect(p.scenes.some((s) => s.effects.includes("riser"))).toBe(true);
    expect(p.scenes.some((s) => s.effects.includes("hitstop") && s.stamp !== "")).toBe(true);
    expect(p.scenes.some((s) => s.cameras.length === 3 && s.effects.includes("whip"))).toBe(true);
    expect(p.scenes.find((s) => s.effects.includes("mate"))?.power).toEqual({});
    const tl = compile(p);
    expect(tl.scenes.every((c) => !c.error)).toBe(true);
    // The plain (non-edit) prompt knows the new format too, and a spelled-out script keeps working.
    expect(buildAiPrompt({ topic: "x", platform: "tiktok", length: 20, notes: "" })).toContain("zugNr");
  });
});

describe("the edit prompt", () => {
  const edit = buildAiPrompt({ topic: "Schäfermatt", platform: "tiktok", length: 30, notes: "Mit Pointe", type: "edit" });

  it("tells the AI it is the editor of a fast reel, with goal, structure, beat, strengths and format, and drops the explainer sections", () => {
    for (const part of ["DU BIST DER EDITOR", "TikTok", "Phonk", "HOOK", "AUFBAU", "AUFPRALL", "NACHSPIEL", "HÖHEPUNKT", "ABSPANN", "90 BPM", "STÄRKEN", "AUSGABEFORMAT", "PRÜF VOR DEM ANTWORTEN", "Schäfermatt", "Mit Pointe"]) expect(edit).toContain(part);
    // Nothing that would pull the AI back to a captioned explainer: its rules, layout, design block, polls, orb.
    for (const part of ["SO WIRD ES FÜR ZUSCHAUER", "SO SIEHT DAS VIDEO AUS (", "DESIGN (\"design\"", "Umfrage (", "Lucena:", "Tempo: \"zugtempo\""]) expect(edit).not.toContain(part);
    // The auto prompt carries the edit brief too, with the choice up front.
    const auto = buildAiPrompt({ topic: "x", platform: "tiktok", length: 30, notes: "" });
    expect(auto).toContain("DU BIST DER EDITOR");
    expect(auto.indexOf("VORAB: WAS FÜR EIN VIDEO")).toBeLessThan(auto.indexOf("DU BIST DER EDITOR"));
  });

  it("asks for durations the studio keeps as written: whole beats, just under the multiple", () => {
    const scenes = importAiScript(edit.split("```json")[1].split("```")[0]).project!.scenes;
    // The prompt advises 0.6 / 1.3 / 2 / 2.6 / 4 because the studio rounds up to whole beats of 2/3 s.
    const compiled = compile(importAiScript(edit.split("```json")[1].split("```")[0]).project!);
    compiled.scenes.forEach((c, i) => {
      const beats = c.dur / REEL_BEAT;
      const wanted = scenes[i].duration;
      expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-6);
      // The studio keeps every scene as long as asked: none grows by an extra beat (the hit-stop pause is part of its scene).
      expect(c.dur, `scene ${i + 1}`).toBeLessThan(wanted + 0.1);
    });
    for (const d of [0.6, 1.3, 2, 2.6, 4]) expect(Math.ceil(d / REEL_BEAT - 1e-6) * REEL_BEAT - d).toBeLessThan(0.1);
  });

  it("reads in English too, with the English field names", () => {
    setLangNow("en", EN);
    try {
      const en = buildAiPrompt({ topic: "x", platform: "tiktok", length: 30, notes: "", type: "edit" });
      expect(en).toContain("YOU ARE THE EDITOR");
      expect(en).not.toContain("DU BIST DER EDITOR");
      const res = importAiScript(en.split("```json")[1].split("```")[0]);
      expect(res.errors).toEqual([]);
      expect(res.warnings).toEqual([]);
      expect(res.project!.style.view).toBe("reel");
    } finally {
      setLangNow("de");
    }
  });
});

describe("side guess and effect names", () => {
  it("does not read the effect \"dutch\" as the Dutch Defence", () => {
    const res = importAiScript(JSON.stringify({ titel: "Falle", szenen: [{ zug: "1. e4", effekte: ["dutch"] }] }));
    expect(res.project!.video.perspective).toBe("white");
    // The texts still decide: a title naming a Black opening shows the video from Black's side.
    expect(importAiScript(JSON.stringify({ titel: "Sizilianisch", szenen: [{ zug: "1. e4" }] })).project!.video.perspective).toBe("black");
  });
});

describe("sound indicator", () => {
  const mix = { music: "none" as const, musicVolume: 0.5, musicFile: null, musicGen: null, voice: null, voiceVolume: 1, effects: true, master: 1 };
  it("is on only when something would actually be heard", () => {
    const withMoves = compile(make([scene({ moves: "e4", duration: 1 })]));
    const empty = compile(make([scene({ duration: 1 })]));
    expect(mixHasSound(mix, withMoves)).toBe(true);
    expect(mixHasSound({ ...mix, effects: false }, withMoves)).toBe(false);
    expect(mixHasSound(mix, empty)).toBe(false);
    expect(mixHasSound({ ...mix, music: "beat" }, empty)).toBe(true);
    expect(mixHasSound({ ...mix, music: "beat", master: 0 }, empty)).toBe(false);
  });
});

describe("edit defaults, calm camera and scenario prompts", () => {
  const body = (o: Partial<Parameters<typeof buildAiPrompt>[0]>) => buildAiPrompt({ topic: "Schäfermatt", platform: "tiktok", length: 30, notes: "", ...o });
  const exampleOf = (prompt: string) => importAiScript(prompt.split("```json")[1].split("```")[0]);

  it("makes an edit of a script that forgot its type, when an edit was asked for, and keeps the edit free of captions and own zooms", () => {
    const script = JSON.stringify({ titel: "T", szenen: [{ zug: "1. e4", zoom: 0.5, drehung: 20, fokus: true }, { zug: "1... e5", titel: "Stempel?" }] });
    // Without the question the script is a slow 3D explainer, with it a reel.
    expect(importAiScript(script).project!.style.view).not.toBe("reel");
    const p = importAiScript(script, { art: "edit" }).project!;
    expect(p.style.view).toBe("reel");
    expect(p.video.tempo).toBeGreaterThan(2);
    expect(p.video.introFly).toBe(false);
    // The camera flies by itself: the AI's own zoom, turn and focus are dropped, and a scene without a title shows no move caption.
    expect(p.scenes.map((s) => [s.zoom, s.orbit, s.focus, s.title])).toEqual([[1, 0, false, ""], [1, 0, false, "Stempel?"]]);
    // An explainer asked for stays one, even when the AI wrote "edit".
    expect(importAiScript(JSON.stringify({ videoart: "edit", szenen: [{ zug: "1. e4" }] }), { art: "explain" }).project!.style.view).not.toBe("reel");
    // The music style from the questions is kept; "auto" leaves the automatic choice.
    expect(importAiScript(script, { art: "edit", musicStyle: "phonk" }).project!.video.musicStyle).toBe("phonk");
    expect(importAiScript(script, { art: "edit", musicStyle: "auto" }).project!.video.musicStyle).toBe("auto");
    // The platform of the questions is the fallback when the script names none; a short clip starts on the board instead of flying in.
    expect(importAiScript(script, { platform: "shorts" }).project!.video.platform).toBe("shorts");
    expect(importAiScript(script, { platform: "shorts" }).project!.video.introFly).toBe(false);
  });

  it("never closes in past about four squares on the reel's tilted board, and settles within a beat", () => {
    const project = exampleOf(body({ scenario: "edit" })).project!;
    const tl = compile(project);
    let tightest = 0;
    for (let tk = 0.01; tk < tl.total - 0.1; tk += 0.05) tightest = Math.max(tightest, reelCamera(frameAt(tl, project, tk)!, 1080, 1080).S);
    expect(tightest).toBeLessThan(1080 / 3.6);
  });

  it("builds a prompt per scenario, with the answers in it, and leaves the prompt of the plain options as it was", () => {
    const plain = body({});
    expect(body({ answers: {} })).toBe(plain);
    const edit = body({ scenario: "edit", answers: { pace: "fast", hook: "question", point: "mate", ending: "part2", level: "club", music: "phonk", language: "en" } });
    for (const part of ["KAMERA IM EDIT", "EFFEKTE IM EDIT", "Zielgruppe: Vereinsspieler", "so schnell wie möglich", "Siehst du das Matt", "Mattzug", "Teil 2", "Phonk", "Englisch"]) expect(edit).toContain(part);
    // The edit hands the camera to the studio: no zoom, no turn, no focus, no zoom or confetti effect.
    for (const part of ["zoom: Schneller Zoom", "konfetti: Konfetti", "Kameras (\"kamera\")"]) expect(edit).not.toContain(part);
    const opening = body({ scenario: "opening", answers: { voice: false, poll: true, game: "1. e4 e5 2. Nf3" } });
    for (const part of ["SZENARIO: ERÖFFNUNG VORSTELLEN", "1. e4 e5 2. Nf3", "Kein Sprechtext", "Ende das Video mit einer Umfrage", "VORAB: VIDEOART"]) expect(opening).toContain(part);
    expect(opening).toContain('"videoart": "erklaerung"');
    expect(body({ scenario: "puzzle" })).toContain("SZENARIO: RÄTSEL / TAKTIK");
    expect(body({ scenario: "explain" })).toContain("SZENARIO: KURZES ERKLÄRVIDEO");
    expect(body({ scenario: "lesson", platform: "youtube", length: 240 })).toContain("SZENARIO: YOUTUBE-LEKTION");
    // The scenarios differ from each other, and the edit stays free of the explainer sections.
    expect(new Set(["edit", "explain", "opening", "puzzle", "lesson", "auto"].map((s) => body({ scenario: s as "edit" })))).toHaveLength(6);
    expect(edit).not.toContain("SZENARIO:");
    // An own game is quoted at most once, cut at a sane length.
    expect(body({ answers: { game: "x".repeat(9000) } }).match(/x{4000}/g)).toHaveLength(1);
    // Every scenario's example imports without a problem.
    for (const s of ["edit", "explain", "opening", "puzzle"] as const) {
      const res = exampleOf(body({ scenario: s }));
      expect(res.errors, s).toEqual([]);
      expect(res.warnings, s).toEqual([]);
    }
  });

  it("states durations the studio really keeps: the minimums of the prompt are the minimums of the timeline", () => {
    const pgn = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#";
    const lengthOf = (scene: object) => {
      const res = importAiScript(JSON.stringify({ videoart: "edit", pgn, szenen: [{ zugNr: 2, dauer: 1.3 }, scene] }), { art: "edit" });
      return compile(res.project!).scenes[1].dur;
    };
    // [scene, what the prompt tells the AI to write, what the studio makes of it]: a move needs 1.3, the show or a mate 2.6, mate + slow motion + hit-stop 4.
    const table: [object, number, number][] = [
      [{ zugNr: 3, dauer: 0.6 }, 1.3, 1.33],
      [{ dauer: 0.6, pfeile: ["h5-f7 gefahr"] }, 0.6, 0.67],
      [{ zugNr: 6, dauer: 1.3, effekte: { hitstop: 1, wackeln: 0.4 }, stempel: "X" }, 1.3, 1.33],
      [{ zugNr: 6, dauer: 1.3, bewertung: "brillant" }, 2.6, 2.67],
      [{ zugNr: 6, dauer: 2, effekte: ["zeitlupe"] }, 2.6, 2.67],
      [{ zugNr: 7, dauer: 2.6, effekte: ["matt"] }, 2.6, 2.67],
      [{ zugNr: 7, dauer: 2.6, effekte: { matt: 1, zeitlupe: 1, hitstop: 1 } }, 4, 4],
      [{ dauer: 1.3, kameras: ["nah", "tief", "oben"], effekte: ["whip"] }, 1.3, 1.33],
      [{ zugNr: 6, dauer: 1.3, kameras: ["nah", "tief"], effekte: ["hitstop"] }, 2, 2],
    ];
    for (const [scene, , studio] of table) expect(lengthOf(scene), JSON.stringify(scene)).toBeCloseTo(studio, 1);
    const prompt = body({ scenario: "edit" });
    for (const part of ["Eine Szene MIT Zug ist mindestens 1.3 lang", "mit Show (brillant, grossartig, bester, zeitlupe) oder Matt 2.6", "mit Matt, Zeitlupe und \"hitstop\" 4"]) expect(prompt).toContain(part);
    // The example the AI copies is as long as the prompt asks for (15 to 25 s, 8 to 14 scenes).
    const example = exampleOf(prompt).project!;
    expect(example.scenes.length).toBeGreaterThanOrEqual(8);
    expect(compile(example).total).toBeGreaterThan(15);
    expect(compile(example).total).toBeLessThan(25);
  });

  it("turns the answers of an edit into edit instructions instead of explainer ones", () => {
    const answers = { game: "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#", level: "beginner" as const, hook: "bold" as const, ending: "none" as const, music: "epic" as const, language: "de" as const, pace: "fast" as const };
    const edit = body({ scenario: "edit", answers });
    for (const part of ["Schreib die Züge unverändert in \"pgn\"", "Pointe muss ohne Schachwissen sofort klar sein", "kurzer \"titel\" in der Hook-Szene", "kein Abspann: lass die Szene \"abspann\" weg", "Der Takt bleibt 90 BPM", "Pauken und Streicher", "Szenen ohne Zug 0.6", "(Hook-Titel, Stempel, Abspann)"]) expect(edit).toContain(part);
    // Nothing that belongs to explanations: teaching beginners, captions, voice-over.
    for (const part of ["Begriffe beim ersten Mal erklären", "Nimm genau diese Züge", "Untertitel, Sprechtext"]) expect(edit).not.toContain(part);
    // The same answers in an explainer keep the explainer wording.
    const explain = body({ scenario: "explain", answers: { ...answers, music: undefined } });
    for (const part of ["Nimm genau diese Züge", "Begriffe beim ersten Mal erklären", "kein Aufruf, das Video endet mit der Pointe"]) expect(explain).toContain(part);
    // Every music style hands the AI its own advice, and the prompt still imports.
    const hints = (["chill", "ambient", "phonk", "epic", "thriller"] as const).map((m) => body({ scenario: "edit", answers: { music: m } }));
    expect(new Set(hints.map((h) => h.split("Der Takt bleibt 90 BPM")[1].split("\n")[0])).size).toBe(5);
    // A result-first hook tells the AI how to use the jump back in time.
    expect(body({ scenario: "edit", answers: { hook: "result" } })).toContain("springt \"zugNr\" zurück");
  });

  it("imports a realistic AI answer of a result-first edit without a complaint, with hook title, jumps back and no outro", () => {
    const pgn = "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#";
    const reply = "Klar, hier ist dein Edit:\n\n```json\n" + JSON.stringify({
      videoart: "edit", titel: "Matt in 4", plattform: "tiktok", laenge: 12, perspektive: "weiss", pgn,
      szenen: [
        { zugNr: 7, dauer: 1.3, titel: "Siehst du das Matt?", effekte: { punch: 0.5 }, pfeile: ["h5-f7 akzent"] },
        { zugNr: "2.", dauer: 1.3, effekte: ["riser"], markierungen: ["f7 gefahr"] },
        { zugNr: "3...", dauer: 1.3, bewertung: "patzer", stempel: "PATZER", effekte: { hitstop: 1, invert: 1, glitch: 0.6, wackeln: 0.4 } },
        { dauer: 1.3, kameras: ["nah", "tief", "oben"], effekte: { whip: 1, wackeln: 0.2 } },
        { zugNr: 7, dauer: 4, stempel: "MATT", effekte: { matt: 1, zeitlupe: 1, hitstop: 1, wackeln: 1 } },
      ],
    }) + "\n```\nViel Erfolg!";
    const res = importAiScript(reply, { art: "edit", platform: "tiktok", musicStyle: "epic" });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    const p = res.project!;
    expect(p.scenes.map((sc) => sc.title)).toEqual(["Siehst du das Matt?", "", "", "", ""]);
    expect(p.scenes.some((sc) => sc.card === "outro")).toBe(false);
    expect(p.video.musicStyle).toBe("epic");
    // The jumps back (ply 7, then White's 2nd, then Black's 3rd move) show the right moves, and none of the scenes is cut short.
    const tl = compile(p);
    expect(tl.scenes.every((c) => !c.error)).toBe(true);
    expect(tl.scenes[0].scene.moves).toBe("4. Dxf7#");
    expect(tl.scenes[1].scene.moves).toContain("Dh5");
    expect(tl.scenes[2].scene.moves).toContain("Sf6");
  });

  it("writes the scenario prompts in English with the English field names", () => {
    setLangNow("en", EN);
    try {
      const en = body({ scenario: "puzzle", answers: { hook: "bold", language: "de", level: "strong" } });
      for (const part of ["SCENARIO: PUZZLE / TACTIC", "advanced players", "bold claim", "German"]) expect(en).toContain(part);
      expect(en).not.toContain("SZENARIO");
      const edit = body({ scenario: "edit", answers: { pace: "calm" } });
      expect(edit).toContain("CAMERA IN THE EDIT");
      expect(edit).not.toContain("KAMERA IM EDIT");
    } finally {
      setLangNow("de");
    }
  });
});

describe("scene length", () => {
  const base = (view: "3d" | "reel", speed = 1) => {
    const p = make([scene({ moves: "1. e4 e5", duration: 3 }), scene({ moves: "2. Sf3", duration: 3 })]);
    return { ...p, style: { ...p.style, view }, video: { ...p.video, speed } };
  };
  const lengthOf = (p: StudioProject, duration: number) => compile({ ...p, scenes: p.scenes.map((s, i) => (i === 0 ? { ...s, duration } : s)) }).scenes[0];

  it("runs a scene exactly as long as asked once it is above its minimum, and never below the minimum", () => {
    for (const view of ["3d", "reel"] as const) {
      const p = base(view);
      const minimum = lengthOf(p, 0.5).minDur;
      expect(lengthOf(p, 0.5).dur).toBeCloseTo(minimum, 6);
      expect(minimum).toBeGreaterThan(1);
      const long = Math.ceil(minimum) + 3;
      expect(lengthOf(p, long).dur).toBeGreaterThanOrEqual(long - 1e-6);
      expect(lengthOf(p, long).dur).toBeLessThan(long + (view === "reel" ? REEL_BEAT : 0.001));
    }
  });

  it("lets the editor slider ask for real seconds: duration = real length * tempo reproduces that length", () => {
    for (const view of ["3d", "reel"] as const) {
      for (const speed of [0.75, 1, 1.5]) {
        const p = base(view, speed);
        const real = lengthOf(p, 20).dur;
        // A beat multiple in the reel (what the slider steps through), whole tenths otherwise.
        const target = view === "reel" ? real - 3 * REEL_BEAT : Math.round((real - 1) * 10) / 10;
        expect(lengthOf(p, target * speed).dur).toBeCloseTo(target, 6);
      }
    }
  });

  it("squeezes a scene to a length below its natural one when asked to, and still plays all moves in it", () => {
    for (const view of ["3d", "reel"] as const) {
      const p = base(view);
      const natural = lengthOf(p, 0.5).minDur;
      const target = view === "reel" ? REEL_BEAT * 2 : 1;
      expect(target).toBeLessThan(natural);
      const squeezed = compile({ ...p, scenes: p.scenes.map((s, i) => (i === 0 ? { ...s, duration: target, squeeze: true } : s)) }).scenes[0];
      expect(squeezed.dur).toBeCloseTo(target, 6);
      expect(squeezed.steps).toHaveLength(2);
      expect(squeezed.steps[1].t1).toBeLessThanOrEqual(squeezed.dur);
      expect(squeezed.minDur).toBeCloseTo(natural, 6);
    }
  });

  it("lets a scene with speech be set to any length between its visual length and its speech floor", () => {
    const p = base("3d");
    const talky = { ...p, scenes: p.scenes.map((s, i) => (i === 0 ? { ...s, speech: "word ".repeat(30) } : s)) };
    const c0 = compile(talky).scenes[0];
    expect(c0.floorDur).toBeGreaterThan(c0.minDur + 1);
    const mid = (c0.minDur + c0.floorDur) / 2;
    const set = compile({ ...talky, scenes: talky.scenes.map((s, i) => (i === 0 ? { ...s, duration: mid, squeeze: true } : s)) }).scenes[0];
    expect(set.dur).toBeCloseTo(mid, 6);
  });
});

describe("the close variant of the reel look", () => {
  const close = closeTemplate();
  const tl = compile(close);
  const cam = (tk: number) => reelCamera(frameAt(tl, close, tk)!, 1080, 1080, "close");

  it("is the reference look: a tight, straight crop that follows the move, tilted only at the opening and under threat", () => {
    expect(close.style).toMatchObject({ view: "reel", reelLook: "close" });
    // After the opening pull-in every held picture is about four and a half squares across and nearly level.
    const book = tl.scenes[1];
    const held = cam(book.start + book.dur - 0.05);
    expect(1080 / held.S).toBeGreaterThan(4);
    expect(1080 / held.S).toBeLessThan(5.8);
    expect(Math.abs(held.roll)).toBeLessThan(0.06);
    // The very first picture is the overview of the whole board, held straight, so the position can be taken in before the camera moves in.
    expect(1080 / cam(0.05).S).toBeGreaterThanOrEqual(8.7);
    expect(Math.abs(cam(0.05).roll)).toBeLessThan(0.08);
    // The classic camera frames the same scene wider and sways far more.
    const classic = reelCamera(frameAt(tl, close, book.start + book.dur - 0.05)!, 1080, 1080, "classic");
    expect(classic.S).toBeLessThan(held.S);
  });

  it("is chosen in the AI format, written back, and the classic cut stays the default", () => {
    const script = (extra: object) => JSON.stringify({ videoart: "edit", pgn: "1. e4 e5", szenen: [{ zugNr: "1-2" }], ...extra });
    expect(importAiScript(script({ schnittstil: "nah" })).project!.style.reelLook).toBe("close");
    expect(importAiScript(script({ cutStyle: "close" })).project!.style.reelLook).toBe("close");
    expect(importAiScript(script({})).project!.style.reelLook).toBe("classic");
    const again = importAiScript(toAiScript(importAiScript(script({ schnittstil: "nah" })).project!)).project!;
    expect(again.style.reelLook).toBe("close");
    const odd = importAiScript(script({ schnittstil: "bunt" }));
    expect(odd.project!.style.reelLook).toBe("classic");
    expect(odd.warnings.join(" ")).toContain("bunt");
    expect(normalizeProject({ style: { view: "reel", reelLook: "nonsense" } }).style.reelLook).toBe("classic");
  });

  it("tells the AI about it in the edit prompt and the automatic one", () => {
    const ask = (type: "edit" | "auto") => buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "", type });
    expect(ask("edit")).toContain("\"schnittstil\"");
    expect(ask("auto")).toContain("\"schnittstil\"");
    expect(buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "", type: "explain" })).not.toContain("schnittstil");
  });

  it("keeps titles and subtitles of a squeezed scene clean: fully in before the fade-out starts, gone at the cut", () => {
    const p = make([scene({ moves: "1. e4 e5", duration: 3 }), scene({ moves: "2. Sf3", duration: 3 })]);
    const short = { ...p, scenes: p.scenes.map((s, i) => (i === 0 ? { ...s, title: "Titel", text: "Untertitel", duration: 0.5, squeeze: true } : { ...s, title: "Anders", text: "Anderer Text" })) };
    const tl = compile(short);
    const d = tl.scenes[0].dur;
    expect(d).toBeLessThan(1);
    const f = (t: number) => frameAt(tl, short, t)!;
    // Entrance (age 0.4 in the renderer) is complete while the fade-out has not begun.
    expect(f(d * 0.5).title.age).toBeGreaterThanOrEqual(0.4 - 1e-6);
    expect(f(d * 0.5).title.alpha).toBe(1);
    expect(f(d - 0.001).title.alpha).toBeLessThan(0.05);
    expect(f(d - 0.001).text.alpha).toBeLessThan(0.05);
  });
});
