import { useEffect, useState } from "preact/hooks";

import { EXCLUDE_BULLET_KEY, SKIP_BULLET_KEY } from "../domain/analysisDepth";
import { getSetting, onDataChanged } from "../storage/db";

export interface BulletPrefs {
  /** Leave Bullet out of statistics, profile, friends and training. */
  excludeBullet: boolean;
  /** Leave Bullet out of bulk and automatic analysis. */
  skipBullet: boolean;
}

// Kept between pages so a filter does not flash with Bullet before the setting loads.
let last: BulletPrefs = { excludeBullet: false, skipBullet: false };
let loaded: Promise<BulletPrefs> | null = null;

export function loadBulletPrefs(): Promise<BulletPrefs> {
  loaded ??= Promise.all([getSetting<boolean>(EXCLUDE_BULLET_KEY, false), getSetting<boolean>(SKIP_BULLET_KEY, false)]).then(
    ([excludeBullet, skipBullet]) => (last = { excludeBullet, skipBullet }),
  );
  return loaded;
}

/** Bullet settings, refreshed when settings change (also through sync). */
export function useBulletPrefs(): BulletPrefs & { ready: boolean } {
  const [prefs, setPrefs] = useState(last);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      loaded = null;
      void loadBulletPrefs().then((p) => {
        if (!alive) return;
        setPrefs(p);
        setReady(true);
      });
    };
    load();
    const off = onDataChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { ...prefs, ready };
}
