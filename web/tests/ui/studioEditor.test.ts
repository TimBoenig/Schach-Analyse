// The editor round of Nov 2026: saving that never loses work, the scene timeline, "start from the starting position",
// prompts tuned for short-video platforms and the one-click recipes.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAiPrompt, importAiScript, RECIPES } from "../../src/ui/studio/aiScript";
import { applyFromStart, fromStartState, LEAD_MAX, leadSeconds } from "../../src/ui/studio/leadIn";
import { blankProject, reelTemplate, scene, scenePositions, START_FEN, type StudioProject } from "../../src/ui/studio/model";
import { snapLength } from "../../src/ui/studio/SceneTrack";
import { loadProjects, mergeProjects, PROJECTS_KEY, saveProjects } from "../../src/ui/studio/store";
import { setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";

beforeAll(() => setLangNow("de", EN));

const LEGAL = "1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#";

/** A cut edit: it opens at move 5 of Légal's trap and knows the whole game. */
const cutEdit = (): StudioProject => {
  const base = { ...reelTemplate(), startFen: START_FEN, game: "e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#" };
  const fen = "rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5";
  return { ...base, scenes: [scene({ fen, moves: "5. Nxe5", duration: 1.3 }), scene({ moves: "5... Bxd1 6. Bxf7+ Ke7 7. Nd5#", duration: 4 })] };
};

describe("start from the starting position", () => {
  it("plays the known game up to the first scene and takes it out again", () => {
    const p = cutEdit();
    expect(fromStartState(p)).toEqual({ kind: "possible", plies: 8 });
    const on = applyFromStart(p, true);
    expect(on.video.fromStart).toBe(true);
    expect(on.scenes).toHaveLength(3);
    const lead = on.scenes[0];
    expect(lead.leadIn).toBe(true);
    expect(lead.squeeze).toBe(true);
    expect(lead.duration).toBeCloseTo(leadSeconds(8) * on.video.speed);
    // The lead-in starts in the starting position and ends exactly where the first real scene begins.
    const pos = scenePositions(on);
    expect(pos[0].before.split(" ")[0]).toBe(START_FEN.split(" ")[0]);
    expect(pos[0].after.split(" ").slice(0, 4)).toEqual(pos[1].before.split(" ").slice(0, 4));
    // Switching on twice does not stack lead-ins; off removes it and keeps the rest untouched.
    expect(applyFromStart(on, true).scenes.filter((s) => s.leadIn)).toHaveLength(1);
    const off = applyFromStart(on, false);
    expect(off.video.fromStart).toBe(false);
    expect(off.scenes.map((s) => s.moves)).toEqual(p.scenes.map((s) => s.moves));
  });

  it("knows when the video already starts there or the way is unknown", () => {
    const fromOne = { ...blankProject(), scenes: [scene({ moves: "1. e4 e5" })] };
    expect(fromStartState(fromOne)).toEqual({ kind: "already" });
    expect(applyFromStart(fromOne, true).scenes).toHaveLength(1);
    const puzzle = { ...cutEdit(), game: undefined };
    expect(fromStartState(puzzle)).toEqual({ kind: "unknown" });
    const kept = applyFromStart(puzzle, true);
    expect(kept.scenes).toHaveLength(2);
    expect(kept.video.fromStart).toBe(true);
  });

  it("keeps the lead-in short however long the way is", () => {
    expect(leadSeconds(1)).toBeGreaterThanOrEqual(1.3);
    expect(leadSeconds(200)).toBe(LEAD_MAX);
  });
});

describe("saving", () => {
  const disk = new Map<string, string>();
  beforeEach(() => {
    disk.clear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => void disk.set(k, v), removeItem: (k: string) => void disk.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never drops another tab's work and lets the newer version win", () => {
    const a = { ...blankProject(), id: "a", name: "A", updatedAt: 10 };
    const b = { ...blankProject(), id: "b", name: "B", updatedAt: 10 };
    const aNewer = { ...a, name: "A2", updatedAt: 20 };
    const merged = mergeProjects([a], [aNewer, b]);
    expect(merged.map((p) => [p.id, p.name])).toEqual([
      ["a", "A2"],
      ["b", "B"],
    ]);
    // A project this tab deleted stays deleted even though the disk still has it.
    expect(mergeProjects([a], [a, b], new Set(["b"])).map((p) => p.id)).toEqual(["a"]);
  });

  it("writes through to storage and reads back what another tab added", () => {
    const mine = { ...blankProject(), id: "mine", updatedAt: 5 };
    const theirs = { ...blankProject(), id: "theirs", updatedAt: 6 };
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([theirs]));
    const saved = saveProjects([mine]);
    expect(saved?.map((p) => p.id)).toEqual(["mine", "theirs"]);
    expect(loadProjects().map((p) => p.id)).toEqual(["theirs", "mine"]);
  });
});

describe("scene timeline", () => {
  it.each([
    [2.1, 0, 2.1],
    [0.2, 0, 0.5],
    [99, 0, 30],
    [0.9, 2 / 3, 2 / 3],
    [1.5, 2 / 3, 1.333],
    [0.1, 2 / 3, 0.667],
  ])("snaps %s s (beat %s) to %s s", (raw, beat, want) => {
    expect(snapLength(raw, beat)).toBeCloseTo(want, 2);
  });
});

describe("prompts for short-video platforms", () => {
  it("teaches the platform rules and asks for a post text in every kind of video", () => {
    for (const scenario of ["edit", "explain", "puzzle"] as const) {
      const p = buildAiPrompt({ topic: "", platform: "tiktok", length: 30, notes: "", scenario });
      expect(p).toContain("WAS AUF TIKTOK, REELS UND SHORTS FUNKTIONIERT");
      expect(p).toContain("BEITRAGSTEXT");
      expect(p).toContain('"posttext"');
    }
    const long = buildAiPrompt({ topic: "", platform: "youtube", length: 240, notes: "", scenario: "lesson" });
    expect(long).toContain("WAS AUF YOUTUBE FUNKTIONIERT");
    expect(long).not.toContain("WAS AUF TIKTOK");
  });

  it("adds the start and the recipe brief only when asked", () => {
    const plain = buildAiPrompt({ topic: "", platform: "tiktok", length: 15, notes: "", scenario: "edit", answers: {} });
    expect(plain).not.toContain("beginnt in der Grundstellung");
    expect(plain).not.toContain("REZEPT");
    const asked = buildAiPrompt({ topic: "", platform: "tiktok", length: 15, notes: "", scenario: "edit", answers: { start: "start", recipe: "trap" } });
    expect(asked).toContain("beginnt in der Grundstellung");
    expect(asked).toContain("REZEPT: FALLE IN 15 SEKUNDEN");
  });

  it("offers recipes for every quick format, each with its own brief", () => {
    expect(RECIPES.map((r) => r.id)).toEqual(["trap", "brilliant", "blunder", "findmove", "opening", "mygame"]);
    for (const r of RECIPES) expect(r.brief()).toMatch(/^REZEPT: /);
    expect(new Set(RECIPES.map((r) => r.label())).size).toBe(RECIPES.length);
  });

  it("imports the post text and starts the video from move 1 when asked", () => {
    const json = JSON.stringify({
      videoart: "edit",
      pgn: LEGAL,
      posttext: { text: "Kennst du die Falle?", hashtags: ["chess", "#schach"], kommentar: "Teil 2 morgen" },
      szenen: [
        { zugNr: 9, dauer: 1.3 },
        { zugNr: "10-13", dauer: 4, effekte: ["matt"] },
      ],
    });
    const plain = importAiScript(json, { art: "edit", tighten: true });
    expect(plain.project?.post).toBe("Kennst du die Falle?\n\n#chess #schach\n\nErster Kommentar: Teil 2 morgen");
    expect(plain.project?.scenes.some((s) => s.leadIn)).toBe(false);
    const fromStart = importAiScript(json, { art: "edit", tighten: true, fromStart: true });
    const scenes = fromStart.project?.scenes ?? [];
    expect(fromStart.project?.video.fromStart).toBe(true);
    expect(scenes.filter((s) => s.leadIn)).toHaveLength(1);
    expect(scenePositions(fromStart.project!)[scenes.findIndex((s) => s.leadIn)].before.split(" ")[0]).toBe(START_FEN.split(" ")[0]);
  });
});
