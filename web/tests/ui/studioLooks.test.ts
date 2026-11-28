// The redesign of Nov 2026: the short look (word-by-word captions, puzzles) and the lesson look
// (chapters, reading along, takeaways and their recap).
import { beforeAll, describe, expect, it } from "vitest";

import { buildAiPrompt, importAiScript, toAiScript } from "../../src/ui/studio/aiScript";
import { tokens } from "../../src/ui/studio/draw2d";
import { chapterBreak, chaptersOf, currentSentence } from "../../src/ui/studio/lessonLook";
import { blankProject, scene, type StudioProject } from "../../src/ui/studio/model";
import { noteFrom, sideToMove, wordTimes } from "../../src/ui/studio/shortLook";
import { compile } from "../../src/ui/studio/timeline";
import { setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";

beforeAll(() => setLangNow("de", EN));

const withScenes = (labels: string[]): StudioProject => ({ ...blankProject(), scenes: labels.map((label) => scene({ label })) });

describe("short look", () => {
  it("lights caption words up in order, longer words for longer, all before the part ends", () => {
    const words = ["Der", "Springer", "greift", "e5", "an."];
    const times = wordTimes(words, 3);
    expect(times).toHaveLength(5);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeLessThan(3 * 0.82);
    // "Springer" takes longer to say than "Der".
    expect(times[2] - times[1]).toBeGreaterThan(times[1] - times[0]);
  });

  it("names the side to move in a puzzle: after the move on screen, else from the position", () => {
    expect(sideToMove({ pill: { text: "1. e4", plain: "", side: "w", age: 0, alpha: 1 }, toMove: "w" })).toBe("b");
    expect(sideToMove({ pill: { text: "1… e5", plain: "", side: "b", age: 0, alpha: 1 }, toMove: "b" })).toBe("w");
    expect(sideToMove({ pill: null, toMove: "b" })).toBe("b");
    // A question card after 3... Sf6 has no move of its own: White is to move.
    const r = importAiScript(JSON.stringify({ plattform: "tiktok", szenen: [{ zug: "1. e4 e5 2. Lc4 Sc6 3. Dh5 Sf6", titel: "Angriff" }, { karte: "frage", titel: "Welcher Zug?" }] }));
    expect(compile(r.project!).scenes.map((c) => c.turn)).toEqual(["w", "w"]);
  });

  it("shows the takeaway note only after the captions had their time", () => {
    expect(noteFrom(1)).toBe(1.2);
    expect(noteFrom(6)).toBeCloseTo(3.3);
  });
});

describe("lesson look", () => {
  it("builds chapters from numbered small lines and ignores the studio's own variation labels", () => {
    const p = withScenes(["", "", "Kapitel 1: Das Zentrum", "Variante 1", "Kapitel 1: Das Zentrum", "Kapitel 2: Die Falle", "Kapitel 2: Die Falle", "Kapitel 3: Das Fazit", ""]);
    expect(chaptersOf(p)).toEqual([
      { name: "Das Zentrum", start: 2, end: 5 },
      { name: "Die Falle", start: 5, end: 7 },
      { name: "Das Fazit", start: 7, end: 9 },
    ]);
  });

  it("falls back to plain small lines when no chapter is numbered", () => {
    const p = withScenes(["", "Idee", "Idee", "Zurück zur Hauptvariante", "Falle"]);
    expect(chaptersOf(p).map((c) => [c.name, c.start, c.end])).toEqual([
      ["Idee", 1, 4],
      ["Falle", 4, 5],
    ]);
  });

  it("holds the chapter title for 1.3 s, then hands the page back over half a second", () => {
    expect([chapterBreak(-0.1), chapterBreak(0), chapterBreak(1.2), chapterBreak(1.55), chapterBreak(1.8), chapterBreak(3)]).toEqual([0, 1, 1, 0.5, 0, 0]);
  });

  it("reads sentence by sentence, giving long sentences more time", () => {
    const list = tokens("Kurz. Dieser zweite Satz ist deutlich länger als der erste. Ende!");
    expect(currentSentence(list, 0, 10)).toBe(0);
    expect(currentSentence(list, 3, 10)).toBe(1);
    expect(currentSentence(list, 9.5, 10)).toBe(2);
    expect(currentSentence(tokens("Nur ein Satz ohne Punkt"), 5, 6)).toBe(0);
  });
});

describe("takeaways in AI scripts", () => {
  it("reads \"merksatz\", writes it back and keeps it through a round trip", () => {
    const r = importAiScript(JSON.stringify({ plattform: "youtube", szenen: [{ zug: "1. e4", titel: "Start", merksatz: "Besetze das Zentrum." }, { titel: "Ohne" }] }));
    expect(r.errors).toEqual([]);
    expect(r.project!.scenes.map((s) => s.takeaway)).toEqual(["Besetze das Zentrum.", ""]);
    const again = importAiScript(toAiScript(r.project!));
    expect(again.project!.scenes.map((s) => s.takeaway)).toEqual(["Besetze das Zentrum.", ""]);
  });

  it("asks for takeaways and explains the new layout in both prompts, with examples that use them", () => {
    const long = buildAiPrompt({ topic: "Italienisch", platform: "youtube", length: 240, notes: "", type: "explain" });
    const short = buildAiPrompt({ topic: "Falle", platform: "tiktok", length: 30, notes: "", type: "explain" });
    expect(long).toContain("MERKSÄTZE, KAPITEL UND MITLESEN");
    expect(short).toContain("LERNEFFEKT UND KOMMENTARE");
    for (const prompt of [long, short]) {
      const r = importAiScript(prompt);
      expect(r.errors).toEqual([]);
      expect(r.project!.scenes.some((s) => s.takeaway)).toBe(true);
    }
    // The long example's chapters are all numbered, so the chapter rail shows each of them.
    const lesson = importAiScript(long).project!;
    expect(chaptersOf(lesson).map((c) => c.name)).toEqual(["Das Zentrum", "Die Falle", "Das Fazit"]);
  });
});
