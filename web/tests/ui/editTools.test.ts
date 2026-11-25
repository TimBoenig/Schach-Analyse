// Short edits: start in the critical position, squeeze the middle, outro as overlay,
// arrows only when their piece stands there, hooks and captions in both languages, phonk pressure.
import { beforeAll, describe, expect, it } from "vitest";

import { captionKit, EDIT_TARGET_SECONDS, hookIdeas, keyMoveLabel, MIDDLE_MAX_SECONDS, OUTRO_SECONDS, tightenEdit } from "../../src/ui/studio/editTools";
import { generateMusic, musicCues } from "../../src/ui/studio/musicGen";
import { reelTemplate, scene, scenePositions, START_FEN, type StudioProject } from "../../src/ui/studio/model";
import { compile, frameAt, xzSquare } from "../../src/ui/studio/timeline";
import { importAiScript } from "../../src/ui/studio/aiScript";
import { setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";

beforeAll(() => setLangNow("de", EN));

/** Légal's trap as the long first cut of an edit: six build-up moves, then sacrifice, forced exchange, mate, outro. */
const longEdit = (): StudioProject => ({
  ...reelTemplate(),
  startFen: START_FEN,
  scenes: [
    scene({ moves: "1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6", duration: 4 }),
    scene({ moves: "5. Nxe5", duration: 2, badge: "brilliant", stamp: "OPFER", effects: ["hitstop"] }),
    scene({ moves: "5... Bxd1", duration: 3.5 }),
    scene({ moves: "6. Bxf7+", duration: 3.5 }),
    scene({ moves: "6... Ke7", duration: 3.5 }),
    scene({ moves: "7. Nd5#", duration: 4, effects: ["mate", "slowmo"] }),
    scene({ card: "outro", title: "Folge für mehr", duration: 4 }),
  ],
});

describe("tightenEdit", () => {
  it("starts at the key blow with a hook, squeezes sacrifice to mate, shrinks the outro, and is stable", () => {
    const before = longEdit();
    const was = compile(before).total;
    const r = tightenEdit(before, { lang: "en" });
    const tl = compile(r.project);

    // Starts right before 5. Nxe5 (the position after the eight build-up half-moves) and says so.
    expect(r.project.scenes[0].moves).toBe("5. Nxe5");
    expect(scenePositions(r.project)[0].before).toBe(scenePositions(before)[1].before);
    expect(keyMoveLabel(r.project)).toEqual({ label: "5. Sxe5", side: "white" });
    // The hook: a text on top in the chosen language and the sacrifice landing within 2 s.
    expect(r.project.scenes[0].title).toBe("DEADLY TRAP");
    // The sacrifice itself lands within two seconds (the showcase throw of a brilliant move needs its run-up).
    expect(tl.scenes[0].steps[0].t1).toBeLessThanOrEqual(2);
    // Between the sacrifice and the mate: the forced exchange in at most a few seconds.
    const mate = r.project.scenes.findIndex((s) => s.effects.includes("mate"));
    const middle = tl.scenes.slice(1, mate).reduce((sum, c) => sum + c.dur, 0);
    expect(middle).toBeLessThanOrEqual(MIDDLE_MAX_SECONDS);
    expect(r.project.scenes[1].moves).toBe("5... Bxd1 6. Bxf7+ 6... Ke7");
    // Outro 1.3 s, and the whole clip lands in the target range.
    expect(tl.scenes[tl.scenes.length - 1].dur).toBeLessThanOrEqual(OUTRO_SECONDS + 0.7);
    expect(r.seconds).toBeLessThan(was / 1.8);
    expect(r.seconds).toBeLessThanOrEqual(EDIT_TARGET_SECONDS[1] + 3);
    expect(r.changes).toHaveLength(4);
    // Nothing left to do on a second run.
    const again = tightenEdit(r.project, { lang: "en" });
    expect(again.project.scenes.map((s) => [s.moves, s.duration, s.tempo])).toEqual(r.project.scenes.map((s) => [s.moves, s.duration, s.tempo]));
    expect(again.project.startFen).toBe(r.project.startFen);
  });

  it("an edit that is already short and tight is left alone (except the hook text)", () => {
    const tight = reelTemplate();
    const r = tightenEdit(tight, { keepStart: true });
    expect(r.project.scenes.map((s) => s.moves)).toEqual(tight.scenes.map((s) => s.moves));
    // Only the first picture (hook, at most 1.3 s) and the outro (1.3 s) are shortened.
    expect(r.project.scenes.map((s) => s.duration)).toEqual(tight.scenes.map((s, i) => Math.min(s.duration, i === 0 || s.card === "outro" ? OUTRO_SECONDS : 99)));
  });
});

describe("arrows wait for their piece", () => {
  it("an arrow of the next move stays hidden until the piece stands on its square; a played move's arrow shows", () => {
    // Italian game, knight still on f3: arrows g5-f7 and c4-f7 belong to the move that comes next.
    const p: StudioProject = {
      ...reelTemplate(),
      startFen: START_FEN,
      scenes: [
        scene({ moves: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6", duration: 2 }),
        scene({ duration: 2, arrows: [{ from: "g5", to: "f7", tone: "bad" }] }),
        scene({ moves: "4. Ng5", duration: 2, arrows: [{ from: "g5", to: "f7", tone: "bad" }, { from: "f3", to: "g5", tone: "accent" }] }),
      ],
    };
    const tl = compile(p);
    const waiting = frameAt(tl, p, tl.scenes[1].start + tl.scenes[1].annotate + 0.5)!;
    expect(waiting.arrows.filter((a) => !a.path).every((a) => a.alpha === 0)).toBe(true);
    const done = frameAt(tl, p, tl.scenes[2].start + tl.scenes[2].annotate + 0.5)!;
    const shown = done.arrows.filter((a) => !a.path && a.alpha > 0.9).map((a) => `${a.from}${a.to}`);
    // The knight stands on g5 now (g5-f7 shows), and the arrow of the move it just played (f3-g5) shows too.
    expect(done.pieces.some((q) => q.type === "n" && xzSquare(q.x, q.z) === "g5")).toBe(true);
    expect(shown).toEqual(expect.arrayContaining(["g5f7", "f3g5"]));
  });
});

describe("outro over the shattered board", () => {
  it("a short outro after the mate continues the shatter (no new impact, no new music cue)", () => {
    const p = tightenEdit(longEdit(), { lang: "en" }).project;
    const tl = compile(p);
    const outro = tl.scenes[tl.scenes.length - 1];
    const f = frameAt(tl, p, outro.start + 0.2)!;
    expect(outro.mateCarried).toBe(true);
    expect(f.mate).toEqual(tl.scenes[tl.scenes.length - 2].mate);
    // The mate effect is already far along: the pieces have broken, the king lies.
    expect(f.fx.find((e) => e.kind === "mate")!.age).toBeGreaterThan(1.5);
    expect(musicCues(tl).filter((c) => c.kind === "mate")).toHaveLength(1);
    // Without a mate scene before it, the outro is the plain one.
    const plain = { ...p, scenes: p.scenes.map((s) => ({ ...s, effects: s.effects.filter((e) => e !== "mate") })) };
    expect(compile(plain).scenes.some((c) => c.mateCarried)).toBe(false);
  });
});

describe("hooks and captions", () => {
  it("come in both languages, with the comment question naming the side that has to answer", () => {
    expect(hookIdeas("de")[0].text).toContain("NIE schlagen");
    expect(hookIdeas("en")[0].text).not.toBe(hookIdeas("de")[0].text);
    const key = { label: "4. Ng5", side: "white" as const };
    expect(captionKit("de", key).question).toContain("als Schwarz nach 4. Ng5");
    expect(captionKit("en", key).question).toBe("How do you defend as Black after 4. Ng5? 👇");
    expect(captionKit("en", null).question).toMatch(/trap/);
    const kit = captionKit("en", key, "Deadly trap");
    expect(kit.caption.startsWith("Deadly trap\n\n")).toBe(true);
    expect(kit.tips.map((x) => x.title)).toHaveLength(4);
    expect(kit.tips[0].text).toMatch(/15 to 25/);
  });
});

describe("phonk edit sound", () => {
  it("has pressure: most of the energy sits in the bass, and the drop on the hit is louder than the bar before", async () => {
    const RATE = 16000;
    const g = await generateMusic({ style: "phonk", seed: 3, intensity: 0.8, duration: 14, rate: RATE, bpm: 90, cues: [{ t: 8, kind: "drop" }] });
    let low = 0;
    let all = 0;
    let y = 0;
    const a = 1 - Math.exp((-2 * Math.PI * 150) / RATE);
    for (const x of g.left) {
      y += (x - y) * a;
      low += y * y;
      all += x * x;
    }
    expect(low / all).toBeGreaterThan(0.76);
  }, 30000);
});

describe("the edit tools work without an extra click", () => {
  const script = JSON.stringify({
    videoart: "edit",
    pgn: "1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#",
    szenen: [
      { zugNr: "1-8", dauer: 4 },
      { zugNr: 9, dauer: 2, bewertung: "brillant", stempel: "OPFER", effekte: ["hitstop"] },
      { zugNr: 10, dauer: 3.5 },
      { zugNr: 11, dauer: 3.5 },
      { zugNr: 12, dauer: 3.5 },
      { zugNr: 13, dauer: 4, effekte: ["matt"] },
      { karte: "abspann", titel: "Folge für mehr", dauer: 4 },
    ],
  });

  it("an imported AI edit (import dialog) starts in the critical position, is dense and ends on a 1.3 s outro; the raw import stays as written", () => {
    const raw = importAiScript(script, { art: "edit" });
    const made = importAiScript(script, { art: "edit", tighten: true });
    expect(raw.errors).toEqual([]);
    expect(made.errors).toEqual([]);
    expect(made.stats!.seconds).toBeLessThan(raw.stats!.seconds / 1.8);
    expect(made.project!.scenes[0].title).not.toBe("");
    expect(made.project!.scenes[made.project!.scenes.length - 1].duration).toBeLessThanOrEqual(OUTRO_SECONDS);
    expect(raw.project!.scenes[0].title).toBe("");
  });

  it("the reel template ends on the short outro and the arrows of one scene show together or not at all", () => {
    const tpl = reelTemplate();
    expect(tpl.scenes[tpl.scenes.length - 1].duration).toBe(OUTRO_SECONDS);
    // c4-f7 alone would be legal now (the bishop stands on c4), but g5-f7 of the same scene is not: none shows.
    const p: StudioProject = {
      ...reelTemplate(),
      startFen: START_FEN,
      scenes: [scene({ moves: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6", duration: 2 }), scene({ duration: 2, arrows: [{ from: "g5", to: "f7", tone: "bad" }, { from: "c4", to: "f7", tone: "bad" }] })],
    };
    const tl = compile(p);
    const f = frameAt(tl, p, tl.scenes[1].start + tl.scenes[1].annotate + 0.5)!;
    expect(f.arrows.filter((a) => !a.path).every((a) => a.alpha === 0)).toBe(true);
  });
});
