// What Lucena already explained also lives in the settings, which the account
// syncs: an explanation read on the phone does not come back on the laptop.
// localStorage stays the quick answer while a page decides; the settings fill
// it in at start and again right before a guide would open.
import { getSetting, setSetting } from "../../storage/db";
import { mergeSeen, onSeenChange, seenList } from "./store";

const SETTING_KEY = "stage.seen";

/** Adds what the synced settings know to this device, and writes back what only this device knew. */
export async function hydrateSeen(): Promise<void> {
  try {
    const stored = await getSetting<unknown>(SETTING_KEY, []);
    const list = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
    mergeSeen(list);
    const local = seenList();
    if (local.some((id) => !list.includes(id))) await setSetting(SETTING_KEY, local);
  } catch {
    // No database (private mode): this device's own list still holds.
  }
}

/** Keeps the settings copy current from app start on. */
export function startSeenSync(): () => void {
  void hydrateSeen();
  return onSeenChange((list) => void setSetting(SETTING_KEY, list).catch(() => undefined));
}
