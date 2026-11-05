// Engine failures must never leave the analysis queue waiting forever.
import { afterEach, describe, expect, it, vi } from "vitest";

import { EngineFailure, UciEngine, type UciTransport } from "../../src/engine/uci";

/** Answers the handshake; `go` behaviour is up to the test. */
function fakeEngine(onGo: (emit: (l: string) => void) => void) {
  let emit: (l: string) => void = () => undefined;
  let crash: (e: Error) => void = () => undefined;
  const sent: string[] = [];
  const transport: UciTransport = {
    send: (cmd) => {
      sent.push(cmd);
      queueMicrotask(() => {
        if (cmd === "uci") emit("uciok");
        else if (cmd === "isready") emit("readyok");
        else if (cmd.startsWith("go")) onGo(emit);
      });
    },
    onLine: (cb) => (emit = cb),
    terminate: () => undefined,
    onError: (cb) => (crash = cb),
  };
  return { transport, sent, crash: (e: Error) => crash(e) };
}

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

afterEach(() => vi.useRealTimers());

describe("UciEngine failure handling", () => {
  it("returns the lines of a normal search", async () => {
    const f = fakeEngine((emit) => {
      emit("info depth 10 multipv 1 score cp 25 pv e2e4 e7e5");
      emit("bestmove e2e4");
    });
    const engine = new UciEngine(f.transport);
    expect(await engine.analyse(FEN, { movetimeMs: 100 })).toEqual([{ depth: 10, cp: 25, mate: null, pv: ["e2e4", "e7e5"] }]);
    expect(engine.broken).toBe(false);
  });

  it("asks a stalled search to stop and gives up on a hung engine", async () => {
    vi.useFakeTimers();
    const f = fakeEngine(() => undefined); // never answers "go"
    const engine = new UciEngine(f.transport);
    const search = engine.analyse(FEN, { movetimeMs: 1000 });
    const failed = expect(search).rejects.toBeInstanceOf(EngineFailure);
    await vi.advanceTimersByTimeAsync(1000 + 20_000);
    expect(f.sent).toContain("stop");
    await vi.advanceTimersByTimeAsync(5_000);
    await failed;
    expect(engine.broken).toBe(true);
    // Later commands fail fast instead of queueing behind the dead worker.
    await expect(engine.analyse(FEN, { movetimeMs: 10 })).rejects.toBeInstanceOf(EngineFailure);
  });

  it("rejects the running search when the worker crashes", async () => {
    const f = fakeEngine(() => undefined);
    const engine = new UciEngine(f.transport);
    const search = engine.analyse(FEN, { depth: 12 });
    await new Promise((r) => setTimeout(r, 0));
    f.crash(new Error("out of memory"));
    await expect(search).rejects.toThrow(/abgestürzt: out of memory/);
  });
});
