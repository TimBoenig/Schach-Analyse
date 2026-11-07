// Several single-threaded Stockfish engines behind one analyse() call. Each
// search goes to an idle engine, so N engines work on N positions at once.
// Size and hash can change while searches run: extra engines retire once
// their current search is done, new hash sizes apply before the next search.
import type { PvLine } from "../domain/types";
import type { SearchLimits, UciEngine } from "./uci";

interface Slot {
  engine: UciEngine;
  busy: boolean;
  hashMb: number;
}

export class EnginePool {
  private slots: Slot[] = [];
  private waiting: Array<(slot: Slot) => void> = [];
  private size = 1;
  private hashMb = 16;

  constructor(private create: () => UciEngine) {}

  /** Target number of engines and hash per engine; applies to running analyses too. */
  configure({ engines, hashMb }: { engines: number; hashMb: number }): void {
    this.size = Math.max(1, Math.floor(engines));
    this.hashMb = hashMb;
    // Idle engines beyond the new size are not needed any more.
    for (const s of [...this.slots]) if (!s.busy && this.slots.length > this.size) this.retire(s);
    this.serveWaiting();
  }

  /** Engines currently allowed to search in parallel. */
  get capacity(): number {
    return this.size;
  }

  /** Engines that exist right now (busy or idle). */
  get running(): number {
    return this.slots.length;
  }

  private retire(slot: Slot): void {
    this.slots = this.slots.filter((s) => s !== slot);
    slot.engine.quit();
  }

  private spawn(): Slot {
    const slot: Slot = { engine: this.create(), busy: false, hashMb: 0 };
    this.slots.push(slot);
    return slot;
  }

  private idleSlot(): Slot | null {
    // A crashed or hung engine is dropped; a fresh one takes its place.
    for (const s of [...this.slots]) if (!s.busy && s.engine.broken) this.retire(s);
    const idle = this.slots.find((s) => !s.busy);
    if (idle) return idle;
    return this.slots.length < this.size ? this.spawn() : null;
  }

  private serveWaiting(): void {
    while (this.waiting.length) {
      const slot = this.idleSlot();
      if (!slot) return;
      slot.busy = true;
      this.waiting.shift()!(slot);
    }
  }

  private acquire(): Promise<Slot> {
    const slot = this.waiting.length ? null : this.idleSlot();
    if (slot) {
      slot.busy = true;
      return Promise.resolve(slot);
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(slot: Slot): void {
    slot.busy = false;
    if (slot.engine.broken || this.slots.length > this.size) this.retire(slot);
    this.serveWaiting();
  }

  analyse(fen: string, limits: SearchLimits): Promise<PvLine[]> {
    return this.acquire().then(async (slot) => {
      try {
        if (slot.hashMb !== this.hashMb) {
          // Only between searches: changing the hash mid-search would clear it under the engine.
          await slot.engine.setOption("Hash", this.hashMb);
          slot.hashMb = this.hashMb;
        }
        return await slot.engine.analyse(fen, limits);
      } finally {
        this.release(slot);
      }
    });
  }

  /** Ends the running searches early (they still answer, so nothing hangs). */
  stopSearches(): void {
    for (const s of this.slots) if (s.busy) s.engine.stop();
  }

  /** Stops every engine (e.g. on page unload). */
  quit(): void {
    for (const s of [...this.slots]) this.retire(s);
  }
}
