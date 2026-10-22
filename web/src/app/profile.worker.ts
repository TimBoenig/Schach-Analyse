// Builds the player profile (and the full export, which contains it) off the
// main thread: the tactics replay behind it costs ~50 ms per game, which would
// freeze the UI for large histories.
import { buildFullExport, type ExportInput } from "../domain/export";
import { buildPlayerProfile } from "../domain/profile";
import type { StoredGame } from "../domain/types";

export interface ProfileRequest {
  id: number;
  games: StoredGame[];
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

self.onmessage = (e: MessageEvent<ProfileRequest | ExportRequest>) => {
  const { id } = e.data;
  try {
    if ("kind" in e.data) {
      (self as unknown as Worker).postMessage({ id, result: buildFullExport(e.data.input) });
      return;
    }
    const { games, usernames, format, date, color } = e.data;
    (self as unknown as Worker).postMessage({ id, result: buildPlayerProfile(games, usernames, format, date, color) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
