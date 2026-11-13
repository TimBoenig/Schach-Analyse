// Minimal UCI client over any line-based transport (a Web Worker running the
// Caissa WASM build in the app, a Node process in tests).
import type { PvLine } from "../domain/types";
import { ENGINE_NET } from "./info";

export interface UciTransport {
  send(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  terminate(): void;
  /** Called when the engine crashed (e.g. the WASM worker ran out of memory). */
  onError?(cb: (err: Error) => void): void;
}

/** Thrown when the engine crashed or stopped answering; it must be replaced. */
export class EngineFailure extends Error {}

// A search may overrun its limit a little (slow phones, throttled tabs); after
// this grace the engine is told to stop, and after STOP_GRACE_MS it counts as hung.
const SEARCH_GRACE_MS = 20_000;
const DEPTH_ONLY_BUDGET_MS = 120_000;
const STOP_GRACE_MS = 5_000;

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
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private multiPv = 0;
  private failure: EngineFailure | null = null;
  private failListeners = new Set<(e: EngineFailure) => void>();

  constructor(private transport: UciTransport) {
    transport.onLine((line) => {
      for (const l of [...this.listeners]) l(line);
    });
    transport.onError?.((err) => this.fail(new EngineFailure(`Die Engine ist abgestürzt: ${err.message}`)));
    this.ready = (async () => {
      await this.command("uci", (l) => l === "uciok");
      await this.isReady();
    })();
    // A crash during start-up surfaces on the first real command instead.
    this.ready.catch(() => undefined);
  }

  /** True once the engine crashed or hung; create a new one then. */
  get broken(): boolean {
    return this.failure !== null;
  }

  private fail(err: EngineFailure): void {
    if (this.failure) return;
    this.failure = err;
    for (const f of [...this.failListeners]) f(err);
    this.failListeners.clear();
    this.listeners.clear();
  }

  private command(cmd: string, done: (line: string) => boolean, timeoutMs = 0): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      let deadTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(stopTimer);
        clearTimeout(deadTimer);
        this.listeners.delete(listener);
        this.failListeners.delete(onFail);
      };
      const listener = (line: string) => {
        if (done(line)) {
          finish();
          resolve();
        }
      };
      const onFail = (e: EngineFailure) => {
        finish();
        reject(e);
      };
      this.listeners.add(listener);
      this.failListeners.add(onFail);
      if (timeoutMs > 0) {
        // Overdue: ask for the result now; no answer after that means the worker hangs.
        stopTimer = setTimeout(() => {
          this.transport.send("stop");
          deadTimer = setTimeout(() => this.fail(new EngineFailure("Die Engine antwortet nicht mehr.")), STOP_GRACE_MS);
        }, timeoutMs);
      }
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
      // The engine keeps its previous position when it rejects a FEN; the search
      // that follows would then describe the wrong position.
      let rejected = false;
      this.transport.send(`position fen ${fen}`);
      const go = ["go"];
      if (limits.depth) go.push("depth", String(limits.depth));
      if (limits.movetimeMs) go.push("movetime", String(Math.round(limits.movetimeMs)));
      if (go.length === 1) go.push("depth", "12");
      const budget = (limits.movetimeMs ?? 0) + (limits.depth || !limits.movetimeMs ? DEPTH_ONLY_BUDGET_MS : 0) + SEARCH_GRACE_MS;
      await this.command(
        go.join(" "),
        (line) => {
          if (line.startsWith("info string Invalid")) rejected = true;
          const info = parseInfoLine(line);
          if (info) {
            const { multipv, ...rest } = info;
            lines.set(multipv, rest);
          }
          return line.startsWith("bestmove");
        },
        budget,
      );
      if (rejected) return [];
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
    this.fail(new EngineFailure("Engine beendet."));
    try {
      this.transport.send("quit");
    } finally {
      this.transport.terminate();
    }
  }
}

const ENGINE_DIR = `${import.meta.env.BASE_URL}caissa/`;

/** Download state of the engine's neural network (about 76 MB, once per device). */
export interface EngineLoad {
  state: "idle" | "loading" | "ready" | "failed";
  /** Bytes received so far and expected in total (0 when the server does not say). */
  loaded: number;
  total: number;
}

let engineLoad: EngineLoad = { state: "idle", loaded: 0, total: 0 };
const loadListeners = new Set<(l: EngineLoad) => void>();

function setEngineLoad(next: EngineLoad): void {
  engineLoad = next;
  for (const l of [...loadListeners]) l(next);
}

export const getEngineLoad = (): EngineLoad => engineLoad;

/** Calls `cb` on every change of the download state; returns the unsubscribe function. */
export function onEngineLoad(cb: (l: EngineLoad) => void): () => void {
  loadListeners.add(cb);
  return () => loadListeners.delete(cb);
}

let netBlob: Promise<Blob> | null = null;

// Every engine worker needs the network. It is downloaded once here and handed
// to the workers as a Blob (passed by reference), instead of each of up to 32
// workers fetching its own 76 MB.
function loadEngineNet(): Promise<Blob> {
  netBlob ??= (async () => {
    setEngineLoad({ state: "loading", loaded: 0, total: 0 });
    const res = await fetch(`${ENGINE_DIR}caissa.pnn?v=${ENGINE_NET}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      const blob = await res.blob();
      setEngineLoad({ state: "ready", loaded: blob.size, total: blob.size });
      return blob;
    }
    const chunks: BlobPart[] = [];
    let loaded = 0;
    let shown = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      // One update per megabyte keeps the UI calm.
      if (loaded - shown >= 1 << 20) {
        shown = loaded;
        setEngineLoad({ state: "loading", loaded, total });
      }
    }
    const blob = new Blob(chunks);
    setEngineLoad({ state: "ready", loaded: blob.size, total: blob.size });
    return blob;
  })().catch((e: unknown) => {
    // Next engine start tries again (e.g. the connection dropped mid-download).
    netBlob = null;
    setEngineLoad({ state: "failed", loaded: 0, total: 0 });
    throw e;
  });
  return netBlob;
}

/** Caissa (single-threaded WASM build, see web/engine/caissa) in a dedicated Web Worker. */
export function createEngineWorker(): UciTransport {
  const worker = new Worker(`${ENGINE_DIR}caissa.js`);
  let onError: (err: Error) => void = () => undefined;
  let dead = false;
  // The worker queues UCI commands until it has the network.
  loadEngineNet().then(
    (net) => {
      if (!dead) worker.postMessage({ net });
    },
    (e: unknown) => {
      if (!dead) onError(new Error(`Die Engine-Daten konnten nicht geladen werden (${e instanceof Error ? e.message : String(e)}).`));
    },
  );
  return {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => {
      worker.onmessage = (e: MessageEvent) => {
        const data = typeof e.data === "string" ? e.data : String(e.data);
        for (const line of data.split("\n")) if (line) cb(line);
      };
    },
    terminate: () => {
      dead = true;
      worker.terminate();
    },
    onError: (cb) => {
      onError = cb;
      worker.onerror = (e: ErrorEvent) => {
        e.preventDefault?.();
        cb(new Error(e.message || "Worker-Fehler"));
      };
      worker.onmessageerror = () => cb(new Error("Ungültige Nachricht"));
    },
  };
}
