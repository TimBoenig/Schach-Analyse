// Builds the player profile (and the full export, which contains it) off the
// main thread: the tactics replay behind it costs ~50 ms per game, which would
// freeze the UI for large histories.
import { type AiExportInput, buildAiExport } from "../domain/aiExport";
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

export interface AiExportRequest {
  id: number;
  kind: "ai-export";
  input: AiExportInput;
}

self.onmessage = (e: MessageEvent<ProfileRequest | ExportRequest | AiExportRequest>) => {
  const { id } = e.data;
  try {
    if ("kind" in e.data) {
      const result = e.data.kind === "ai-export" ? buildAiExport(e.data.input) : buildFullExport(e.data.input);
      (self as unknown as Worker).postMessage({ id, result });
      return;
    }
    const { games, usernames, format, date, color } = e.data;
    (self as unknown as Worker).postMessage({ id, result: buildPlayerProfile(games, usernames, format, date, color) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
