// Builds the player profile (and the full export, which contains it) off the
// main thread: the tactics replay behind it costs ~50 ms per game, which would
// freeze the UI for large histories.
import { type AiExportInput, buildAiExport } from "../domain/aiExport";
import { buildFullExport, type ExportInput } from "../domain/export";
import { buildPlayerProfile } from "../domain/profile";
import type { StoredGame } from "../domain/types";

export interface ProfileRequest {
  id: number;
  /** Games of this profile, by id; their content is in `upserts` or was sent before. */
  gameIds: string[];
  /** Games the worker has not seen yet, or whose content changed since. */
  upserts: StoredGame[];
  usernames: string[];
  format: string;
  date: string;
  color: string;
}

export interface ExportRequest {
  id: number;
  kind: "export";
  input: ExportInput;
}

export interface AiExportRequest {
  id: number;
  kind: "ai-export";
  input: AiExportInput;
}

// The games sent so far. Copying a thousand analysed games into the worker took
// half a second of blocked main thread per profile, so only changes travel.
const known = new Map<string, StoredGame>();

self.onmessage = (e: MessageEvent<ProfileRequest | ExportRequest | AiExportRequest>) => {
  const { id } = e.data;
  try {
    if ("kind" in e.data) {
      const result = e.data.kind === "ai-export" ? buildAiExport(e.data.input) : buildFullExport(e.data.input);
      (self as unknown as Worker).postMessage({ id, result });
      return;
    }
    const { gameIds, upserts, usernames, format, date, color } = e.data;
    for (const g of upserts) known.set(g.id, g);
    const games = gameIds.map((gid) => known.get(gid)).filter((g): g is StoredGame => g !== undefined);
    const profile = buildPlayerProfile(games, usernames, format, date, color);
    // The per-game drill-down lists (megabytes for a long history) are only used
    // by the desktop app; copying them back to the page cost time for nothing.
    if (profile.statistics) delete (profile.statistics as Record<string, unknown>).drill_down;
    (self as unknown as Worker).postMessage({ id, result: profile });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
