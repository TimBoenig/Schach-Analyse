// Whether the hidden admin entries (dashboard, video studio) are shown in
// settings on this device. This is only a way to keep them out of the way: the
// password is what protects them (app/adminApi.ts, checked on the server).
// Its own tiny module, so the settings page does not pull the studio code in.
const UNLOCK_KEY = "schach.studio.unlocked";

/** Taps on the "About" heading in settings that open the hidden studio. */
export const UNLOCK_TAPS = 7;

export function studioUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStudioUnlocked(on: boolean): void {
  try {
    if (on) localStorage.setItem(UNLOCK_KEY, "1");
    else localStorage.removeItem(UNLOCK_KEY);
  } catch {
    // private mode: the studio simply stays locked
  }
}
