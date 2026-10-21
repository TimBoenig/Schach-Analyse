// The endgame lessons promise a forced win (or a draw for Philidor); check the
// claim against the same Stockfish build the app plays with.
import { existsSync } from "node:fs";

import { Chess } from "chess.js";
import { afterAll, describe, expect, it } from "vitest";

import { BASIC_ENDGAMES } from "../../src/domain/training";
import { UciEngine } from "../../src/engine/uci";
import { ENGINE_JS, nodeTransport } from "../engine";

describe.skipIf(!existsSync(ENGINE_JS))("endgame basics", () => {
  const engine = new UciEngine(nodeTransport());
  afterAll(() => engine.quit());

  it.each(BASIC_ENDGAMES.map((b) => [b.title, b] as const))("%s has the promised outcome", async (_, b) => {
    expect(new Chess(b.fen).isGameOver()).toBe(false);
    const [line] = await engine.analyse(b.fen, { depth: 14 });
    if (b.goal === "hold") {
      expect(line.mate).toBeNull();
      expect(Math.abs(line.cp ?? 999)).toBeLessThan(100);
    } else {
      expect(line.mate !== null ? line.mate > 0 : (line.cp ?? 0) >= 300).toBe(true);
    }
  }, 20_000);
});
