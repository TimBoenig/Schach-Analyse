// The close reel look's pointer hand (one continuous movement: fly in, grab, drag, let go, float away) and the sparse arrows of an edit.
import { beforeAll, describe, expect, it } from "vitest";

import { buildAiPrompt, importAiScript } from "../../src/ui/studio/aiScript";
import { ARROW_GAP, ARROW_SHARE, thinArrows } from "../../src/ui/studio/arrowRules";
import { tightenEdit } from "../../src/ui/studio/editTools";
import { handAt, HAND_REST, type HandStep } from "../../src/ui/studio/hand";
import { closeTemplate, reelTemplate, scene, START_FEN, type Scene, type StudioProject } from "../../src/ui/studio/model";
import { compile, frameAt, squareXZ } from "../../src/ui/studio/timeline";
import { setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";

beforeAll(() => setLangNow("de", EN));

describe("the pointer hand", () => {
  const step: HandStep = { t0: 0.5, t1: 0.9, from: "e2", to: "e4" };

  it("flies in open, closes its fist on the grab, drags the piece and lets go with a fade", () => {
    expect(handAt([step], 0.05)).toBeNull();
    const flying = handAt([step], 0.4)!;
    expect(flying.grip).toBe(0);
    expect(flying.alpha).toBeGreaterThan(0);
    // It arrives next to the piece it will move, to the lower right, whichever way the board is turned.
    const arrived = handAt([step], 0.499)!;
    const [ex, ez] = squareXZ("e2");
    expect(arrived.x).toBeCloseTo(ex, 1);
    expect(arrived.z).toBeCloseTo(ez, 1);
    expect(arrived.ox).toBeCloseTo(HAND_REST.x, 1);
    expect(arrived.oz).toBeCloseTo(HAND_REST.z, 1);
    // Drag: closed by the end of the grab, and it holds the piece where the piece is (a hair behind).
    const mid = handAt([step], 0.7)!;
    expect(mid.grip).toBe(1);
    const [fx, fz] = squareXZ("e4");
    expect(Math.hypot(mid.x - ex, mid.z - ez)).toBeGreaterThan(0.5);
    expect(Math.hypot(mid.x - fx, mid.z - fz)).toBeGreaterThan(0.5);
    // Let go: opens, drifts away from the landing square, fades out, then is gone.
    const open = handAt([step], 1.0)!;
    expect(open.grip).toBeLessThan(1);
    expect(Math.hypot(open.ox, open.oz)).toBeGreaterThan(Math.hypot(HAND_REST.x, HAND_REST.z));
    expect(handAt([step], 1.15)!.alpha).toBeLessThan(open.alpha);
    expect(handAt([step], 1.4)).toBeNull();
  });

  it("never jumps: the hand starts and stops softly, also between two moves and across a cut", () => {
    const steps: HandStep[] = [step, { t0: 1.02, t1: 1.4, from: "d7", to: "d5" }];
    const before: HandStep = { t0: -1.0, t1: -0.6, from: "g1", to: "f3" };
    const at = (t: number) => handAt(steps, t, { before });
    const pos = (h: NonNullable<ReturnType<typeof at>>) => [h.x + h.ox, h.z + h.oz];
    let prev = at(0)!;
    let speed = 0;
    for (let t = 1 / 60; t < 1.8; t += 1 / 60) {
      const h = at(t);
      if (!h || !prev) {
        prev = h as never;
        continue;
      }
      const d = Math.hypot(pos(h)[0] - pos(prev)[0], pos(h)[1] - pos(prev)[1]);
      // Speed changes gradually (no teleport and no instant start), grip and fade do not snap either.
      expect(Math.abs(d - speed)).toBeLessThan(0.5);
      expect(Math.abs(h.grip - prev.grip)).toBeLessThan(0.5);
      expect(Math.abs(h.alpha - prev.alpha)).toBeLessThan(0.3);
      expect(Math.abs(h.angle - prev.angle)).toBeLessThan(0.1);
      speed = d;
      prev = h;
    }
  });

  it("is the same movement across a cut on the beat: the hand flies in during the scene before and lets go in the scene after", () => {
    const project = closeTemplate();
    const tl = compile(project);
    // The scene that follows another one: its hand is already on the way at its first frame.
    const i = tl.scenes.findIndex((c, k) => k > 1 && c.steps.length && !c.jumpIn.size && !c.jumpOut.length && tl.scenes[k - 1].steps.length && c.scene.card === "none");
    const c = tl.scenes[i];
    const start = frameAt(tl, project, c.start + 0.001)!;
    expect(start.hand).not.toBeNull();
    // And the scene before still shows it at its very end (flying in to this scene's piece), without a pop.
    const prev = tl.scenes[i - 1];
    const end = frameAt(tl, project, prev.start + prev.dur - 0.001)!;
    expect(end.hand).not.toBeNull();
    expect(Math.hypot(end.hand!.x + end.hand!.ox - (start.hand!.x + start.hand!.ox), end.hand!.z + end.hand!.oz - (start.hand!.z + start.hand!.oz))).toBeLessThan(0.3);
  });

  it("is only there in the close look", () => {
    const classic = reelTemplate();
    const tl = compile(classic);
    expect(frameAt(tl, classic, tl.scenes[1].start + 0.3)!.hand).toBeNull();
    const close = closeTemplate();
    const tc = compile(close);
    expect(frameAt(tc, close, tc.scenes[1].start + 0.3)!.hand).not.toBeNull();
  });
});

const make = (scenes: Scene[]): StudioProject => ({ ...reelTemplate(), startFen: START_FEN, scenes });

describe("sparse arrows in an edit", () => {
  it("keeps arrows on a threat and the key move, never on every move, never on neighbouring scenes, and drops an arrow that only repeats its move", () => {
    const p = make([
      scene({ moves: "1. e4 e5", arrows: [{ from: "e2", to: "e4", tone: "accent" }] }),
      scene({ moves: "2. Qh5", arrows: [{ from: "h5", to: "f7", tone: "bad" }] }),
      scene({ moves: "2... Nc6", arrows: [{ from: "b8", to: "c6", tone: "accent" }] }),
      scene({ moves: "3. Bc4", arrows: [{ from: "c4", to: "f7", tone: "accent" }] }),
      scene({ moves: "3... Nf6??", badge: "blunder", arrows: [{ from: "g8", to: "f6", tone: "bad" }] }),
      scene({ moves: "4. Qxf7#", effects: ["mate"], arrows: [{ from: "f7", to: "e8", tone: "accent" }] }),
      scene({ card: "outro", title: "x" }),
    ]);
    const r = thinArrows(p);
    const withArrows = r.project.scenes.map((s, i) => (s.arrows.length ? i : -1)).filter((i) => i >= 0);
    expect(withArrows.length).toBeLessThanOrEqual(Math.ceil(p.scenes.length * ARROW_SHARE));
    expect(withArrows.length).toBeGreaterThan(0);
    for (let k = 1; k < withArrows.length; k++) expect(withArrows[k] - withArrows[k - 1]).toBeGreaterThan(ARROW_GAP);
    // The threat arrow of the blunder stays (the scene with the highest worth); the queen's earlier threat is too close to it.
    expect(r.project.scenes[4].arrows).toEqual([{ from: "g8", to: "f6", tone: "bad" }]);
    expect(r.project.scenes[1].arrows).toEqual([]);
    // The plain move arrows are gone.
    expect(r.project.scenes[0].arrows).toEqual([]);
    expect(r.project.scenes[2].arrows).toEqual([]);
    expect(r.removed).toBe(p.scenes.reduce((n, s) => n + s.arrows.length, 0) - r.project.scenes.reduce((n, s) => n + s.arrows.length, 0));
    // Already sparse: nothing more to take away.
    expect(thinArrows(r.project).removed).toBe(0);
  });

  it("is applied to every AI edit and to the Edit tab's tightening, but not to explainer videos", () => {
    const arrow = (from: string, to: string) => [`${from}-${to} akzent`];
    const szenen = [
      { zug: "1. e4", pfeile: arrow("e2", "e4") },
      { zug: "1... e5", pfeile: arrow("e7", "e5") },
      { zug: "2. Nf3", pfeile: arrow("g1", "f3") },
      { zug: "2... Nc6", pfeile: arrow("b8", "c6") },
      { zug: "3. Bc4", pfeile: arrow("f1", "c4") },
    ];
    const count = (p: StudioProject | null) => p!.scenes.filter((s) => s.arrows.length).length;
    const edit = importAiScript(JSON.stringify({ videoart: "edit", szenen }), { art: "edit" });
    const explain = importAiScript(JSON.stringify({ videoart: "erklaerung", szenen }), { art: "explain" });
    expect(count(explain.project)).toBe(5);
    expect(count(edit.project)).toBe(0);
    // A threat the edit's own scene points at stays.
    const threat = importAiScript(JSON.stringify({ videoart: "edit", pgn: "1. e4 e5 2. Qh5 Nc6", szenen: [{ zugNr: 3, pfeile: ["h5-f7 gefahr"] }, { zugNr: 4, pfeile: ["b8-c6 akzent"] }] }), { art: "edit" });
    expect(threat.project!.scenes.flatMap((s) => s.arrows)).toEqual([{ from: "h5", to: "f7", tone: "bad" }]);
    // The tightening of an existing project thins them too.
    const busy = make(szenen.map((s, i) => scene({ moves: s.zug, arrows: [{ from: "e2", to: "e4", tone: "accent" }, { from: "a1", to: "a2", tone: "accent" }][i % 2 ? 1 : 0] ? [{ from: "h5", to: "f7", tone: "accent" }] : [] })));
    const tightened = tightenEdit(busy, { lang: "en", keepStart: true });
    expect(count(tightened.project)).toBeLessThan(count(busy));
  });
});

describe("the edit prompt: rare arrows, no language in the picture", () => {
  it("asks for almost no arrows, only sign stamps, and a single closing sentence, in both languages, with an example that follows it", () => {
    for (const lang of ["de", "en"] as const) {
      setLangNow(lang, lang === "en" ? EN : undefined);
      try {
        const prompt = buildAiPrompt({ topic: "x", platform: "reels", length: 20, notes: "", type: "edit" });
        // Arrows: zero to two in a whole edit; stamps are signs, not words; the outro sentence is the only text.
        expect(prompt).toMatch(lang === "de" ? /0 bis 2 Pfeile im ganzen Video/ : /zero to two arrows in the whole video/);
        expect(prompt).toMatch(lang === "de" ? /universelle[sn]? Zeichen/ : /universal sign/);
        expect(prompt).toMatch(lang === "de" ? /einzige Text im ganzen Video/ : /only text in the whole video/);
        const res = importAiScript(prompt.split("```json")[1].split("```")[0]);
        const stamps = res.project!.scenes.map((s) => s.stamp).filter(Boolean);
        expect(stamps.length).toBeGreaterThan(0);
        for (const st of stamps) expect(st).toMatch(/^[?!#+]{1,3}$/);
        expect(res.project!.scenes.filter((s) => s.arrows.length).length).toBeLessThanOrEqual(1);
        // Only the closing card carries a title.
        expect(res.project!.scenes.filter((s) => s.card !== "outro" && s.title).length).toBe(0);
      } finally {
        setLangNow("de");
      }
    }
  });
});
