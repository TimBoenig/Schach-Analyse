// One gentle hint at the top of the start page: first "secure your games with
// an account", then "install the app". Each can be dismissed for good.
import { useEffect, useState } from "preact/hooks";

import { installMode, onInstallChange, promptInstall } from "../app/install";
import { getSetting, setSetting } from "../storage/db";
import { syncAvailable } from "../storage/sync";
import { useSyncStatus } from "./AccountView";
import { navigate } from "./router";

/** Below this many games losing local data hurts little, so no nudge yet. */
const ACCOUNT_NUDGE_MIN_GAMES = 10;

export function HomeNudge({ games }: { games: number }) {
  const status = useSyncStatus();
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [mode, setMode] = useState(installMode());
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => {
    void getSetting<string[]>("ui.nudgesDismissed", []).then(setDismissed);
    return onInstallChange(() => setMode(installMode()));
  }, []);
  if (!dismissed) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    void setSetting("ui.nudgesDismissed", next);
  };

  const signedOut = syncAvailable() && status.phase === "signed-out";
  if (signedOut && games >= ACCOUNT_NUDGE_MIN_GAMES && !dismissed.includes("account")) {
    return (
      <div class="nudge card">
        <div class="nudge-text">
          <strong>Sichere deine {games} Partien</strong>
          <span class="small muted">
            Mit einem kostenlosen Konto gehen Analysen und Trainingsfortschritt nie verloren und sind auf jedem Gerät
            dabei.
          </span>
        </div>
        <div class="nudge-actions">
          <button class="btn primary" onClick={() => navigate({ view: "account" })}>
            Konto erstellen
          </button>
          <button class="btn ghost" onClick={() => dismiss("account")} aria-label="Hinweis ausblenden">
            Später
          </button>
        </div>
      </div>
    );
  }
  if (mode && !dismissed.includes("install")) {
    return (
      <div class="nudge card">
        <div class="nudge-text">
          <strong>Als App installieren</strong>
          <span class="small muted">
            {iosHelp
              ? "Tippe in Safari unten auf Teilen (das Viereck mit Pfeil) und dann auf „Zum Home-Bildschirm“."
              : "Eigenes Symbol auf dem Startbildschirm, Vollbild und auch ohne Internet nutzbar."}
          </span>
        </div>
        <div class="nudge-actions">
          {!iosHelp && (
            <button
              class="btn primary"
              onClick={() => (mode === "ios" ? setIosHelp(true) : void promptInstall())}
            >
              Installieren
            </button>
          )}
          <button class="btn ghost" onClick={() => dismiss("install")} aria-label="Hinweis ausblenden">
            {iosHelp ? "Fertig" : "Später"}
          </button>
        </div>
      </div>
    );
  }
  return null;
}
