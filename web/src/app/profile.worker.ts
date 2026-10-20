// Builds the player profile off the main thread: the tactics replay behind it
// costs ~50 ms per game, which would freeze the UI for large histories.
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

self.onmessage = (e: MessageEvent<ProfileRequest>) => {
  const { id, games, usernames, format, date, color } = e.data;
  try {
    const profile = buildPlayerProfile(games, usernames, format, date, color);
    (self as unknown as Worker).postMessage({ id, profile });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
