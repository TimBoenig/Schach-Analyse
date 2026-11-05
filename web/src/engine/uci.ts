// Minimal UCI client over any line-based transport (a Web Worker running
// Stockfish WASM in the app, a Node process in tests).
import type { PvLine } from "../domain/types";

export interface UciTransport {
  send(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  terminate(): void;
  /** The engine died or could not load (e.g. the worker script is missing offline). */
  onError?(cb: (err: Error) => void): void;
}

/** Stockfish is not usable; every waiting and later request fails with this. */
export class EngineFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineFailure";
  }
}

/** How long the engine may take to answer "uci" before it counts as broken. */
export const ENGINE_START_TIMEOUT_MS = 30000;

export interface SearchLimits {
  depth?: number;
  movetimeMs?: number;
  multiPv?: number;
}

/** Scores are relative to the side to move, like python-chess `score.relative`. */
export function parseInfoLine(line: string): (PvLine & { multipv: number }) | null {
  if (!line.startsWith("info ") || !line.includes(" pv ") || line.includes(" currmove ")) return null;
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let cp: number | null = null;
  let mate: number | null = null;
  let pv: string[] = [];
  let bound = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "depth") depth = Number(tokens[++i]);
    else if (t === "multipv") multipv = Number(tokens[++i]);
    else if (t === "score") {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      if (kind === "cp") cp = value;
      else if (kind === "mate") mate = value;
      if (tokens[i + 1] === "lowerbound" || tokens[i + 1] === "upperbound") bound = true;
    } else if (t === "pv") {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  // Aspiration-window bounds are not final scores.
  if (bound || (cp === null && mate === null)) return null;
  return { multipv, depth, cp, mate, pv };
}

export class UciEngine {
  private listeners = new Set<(line: string) => void>();
  private rejectors = new Set<(err: Error) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private multiPv = 0;
  private failure: Error | null = null;

  constructor(private transport: UciTransport, startTimeoutMs = ENGINE_START_TIMEOUT_MS) {
    transport.onLine((line) => {
      for (const l of [...this.listeners]) l(line);
    });
    // Without this a broken worker left every analysis waiting forever at 0 %.
    transport.onError?.((err) => this.fail(err));
    const timer = setTimeout(() => this.fail(new EngineFailure("Stockfish antwortet nicht.")), startTimeoutMs);
    this.ready = (async () => {
      try {
        await this.command("uci", (l) => l === "uciok");
        await this.isReady();
      } finally {
        clearTimeout(timer);
      }
    })();
    // Callers see the failure through their own request; this only keeps it from being "unhandled".
    this.ready.catch(() => undefined);
  }

  /** True once the engine died; a fresh instance is needed. */
  get failed(): boolean {
    return this.failure !== null;
  }

  private fail(err: Error): void {
    if (this.failure) return;
    this.failure = err instanceof EngineFailure ? err : new EngineFailure(err.message || "Stockfish ist abgestürzt.");
    for (const reject of [...this.rejectors]) reject(this.failure);
    this.rejectors.clear();
    this.listeners.clear();
  }

  private command(cmd: string, done: (line: string) => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      const listener = (line: string) => {
        if (done(line)) {
          this.listeners.delete(listener);
          this.rejectors.delete(reject);
          resolve();
        }
      };
      this.listeners.add(listener);
      this.rejectors.add(reject);
      this.transport.send(cmd);
    });
  }

  private isReady(): Promise<void> {
    return this.command("isready", (l) => l === "readyok");
  }

  async setOption(name: string, value: string | number): Promise<void> {
    await this.ready;
    this.transport.send(`setoption name ${name} value ${value}`);
    await this.isReady();
  }

  async newGame(): Promise<void> {
    await this.ready;
    this.transport.send("ucinewgame");
    await this.isReady();
  }

  /** Analyse one position; resolves with the PV lines ordered by multipv rank. */
  analyse(fen: string, limits: SearchLimits): Promise<PvLine[]> {
    const run = async () => {
      await this.ready;
      const multiPv = limits.multiPv ?? 1;
      if (multiPv !== this.multiPv) {
        await this.setOption("MultiPV", multiPv);
        this.multiPv = multiPv;
      }
      const lines = new Map<number, PvLine>();
      this.transport.send(`position fen ${fen}`);
      const go = ["go"];
      if (limits.depth) go.push("depth", String(limits.depth));
      if (limits.movetimeMs) go.push("movetime", String(Math.round(limits.movetimeMs)));
      if (go.length === 1) go.push("depth", "12");
      await this.command(go.join(" "), (line) => {
        const info = parseInfoLine(line);
        if (info) {
          const { multipv, ...rest } = info;
          lines.set(multipv, rest);
        }
        return line.startsWith("bestmove");
      });
      return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Ask the engine to finish the current search early (it still emits bestmove). */
  stop(): void {
    this.transport.send("stop");
  }

  quit(): void {
    try {
      this.transport.send("quit");
    } finally {
      this.transport.terminate();
    }
  }
}

/** Stockfish 17.1 lite (single-threaded WASM) in a dedicated Web Worker. */
export function createStockfishWorker(): UciTransport {
  const worker = new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish.js`);
  return {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => {
      worker.onmessage = (e: MessageEvent) => {
        const data = typeof e.data === "string" ? e.data : String(e.data);
        for (const line of data.split("\n")) if (line) cb(line);
      };
    },
    terminate: () => worker.terminate(),
    onError: (cb) => {
      worker.onerror = (e: ErrorEvent) => {
        e.preventDefault?.();
        cb(new EngineFailure(`Stockfish konnte nicht starten${e.message ? ` (${e.message})` : ""}.`));
      };
    },
  };
}
