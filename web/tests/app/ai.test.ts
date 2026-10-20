import { afterEach, describe, expect, it, vi } from "vitest";
import { type AiConfig, aiReady, parseSse, streamChat } from "../../src/app/ai";
import { gameCoachMessages, profileSummary } from "../../src/domain/profile";
import type { GameReview, PlayerProfile } from "../../src/domain/profile";

const CFG: AiConfig = { provider: "groq", baseUrl: "https://ai.test/v1/", model: "m", apiKey: "gsk_x" };

function sse(chunks: string[], split = 7): Response {
  const text = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(text);
  // Deliver in small, arbitrary pieces so events straddle chunk borders.
  const stream = new ReadableStream({
    start(ctl) {
      for (let i = 0; i < bytes.length; i += split) ctl.enqueue(bytes.slice(i, i + split));
      ctl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("AI client", () => {
  it("splits server-sent events and keeps the unfinished rest", () => {
    expect(parseSse('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b"')).toEqual({ data: ['{"a":1}', "[DONE]"], rest: 'data: {"b"' });
  });

  it.each([
    [{ ...CFG, apiKey: "" }, false],
    [{ ...CFG, model: " " }, false],
    [{ provider: "lmstudio", baseUrl: "http://localhost:1234/v1", model: "x", apiKey: "" }, true],
    [CFG, true],
  ])("decides whether the coach is usable (%#)", (cfg, ready) => {
    expect(aiReady(cfg)).toBe(ready);
  });

  it("streams deltas and sends the key and model", async () => {
    const fetchMock = vi.fn(async () => sse(["Hal", "lo ", "Tim"]));
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const out = await streamChat(CFG, [{ role: "user", content: "hi" }], (t) => seen.push(t));
    expect(out).toBe("Hallo Tim");
    expect(seen.at(-1)).toBe("Hallo Tim");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ai.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gsk_x");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", stream: true });
  });

  it("accepts a plain JSON answer when the server does not stream", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ choices: [{ message: { content: "Bereit." } }] }));
    expect(await streamChat(CFG, [], () => undefined)).toBe("Bereit.");
  });

  it("explains a rejected key in German", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(streamChat(CFG, [], () => undefined)).rejects.toThrow(/API-Schlüssel wurde abgelehnt/);
  });
});

describe("coach prompts", () => {
  it("hands the model the engine findings of the game", () => {
    const review = {
      grade: "3,0 (befriedigend)",
      headline: "Knapp verloren.",
      phases: [{ phase: "opening", name: "Eröffnung", accuracy: 80, moves: 8, errors: 1, grade: "2,0", comment: "" }],
      key_moments: [
        { ply_index: 20, move_label: "11. Dxf7", by_user: true, classification: "Blunder", title: "", text: "", wp_before: 0.62, wp_after: 0.18, best_move_san: "Le2" },
      ],
      positives: [],
      negatives: ["Dame eingestellt."],
    } as unknown as GameReview;
    const [system, user] = gameCoachMessages(review, {
      white: "Tim",
      black: "Gegner",
      result: "0-1",
      opening: "Italienisch",
      userColor: "white",
      userAccuracy: 71.4,
      opponentAccuracy: 80,
      userRating: 1500,
      opponentRating: 1550,
    });
    expect(system.content).toMatch(/Deutsch/);
    expect(user.content).toContain("11. Dxf7 (mein Zug, Blunder): Gewinnchance 62 % → 18 %, besser war Le2");
    expect(user.content).toContain("ich 71 %, Gegner 80 %");
    expect(user.content).toContain("Wertung: ich 1500, Gegner 1550.");
  });

  it("summarises skills with the typical value for the rating", () => {
    const p = {
      total_games: 12,
      analyzed_games: 10,
      overview: { wins: 5, draws: 1, losses: 6, score_pct: 45.8, avg_accuracy: 74.2 },
      rating: null,
      skills: [
        { key: "tactics", name: "Taktisches Sehen", score: 41.6, typical: 55, sample: 10 },
        { key: "time", name: "Zeitmanagement", score: 50, typical: null, sample: 0 },
      ],
      strengths: [],
      weaknesses: [{ title: "Taktisches Sehen" }],
      patterns: [],
      deep: { facts: ["Abends spielst du am besten."] },
      openings_best: [],
      openings_worst: [],
      style: null,
    } as unknown as PlayerProfile;
    const text = profileSummary(p);
    expect(text).toContain("- Taktisches Sehen: 42 (55)");
    expect(text).not.toContain("Zeitmanagement");
    expect(text).toContain("- Abends spielst du am besten.");
  });
});
