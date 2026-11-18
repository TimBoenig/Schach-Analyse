// Whether the hidden video studio is unlocked on this device. Its own tiny
// module, so the settings page does not pull the studio code into the app.
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
