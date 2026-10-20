import { useEffect, useState } from "preact/hooks";

import { STRENGTHS, type AnalysisStrength } from "../app/analysisService";
import type { StoredGame } from "../domain/types";
import { getSetting, listGames, putGames, setSetting } from "../storage/db";
import { currentUser, signIn, signOut, signUp, syncAvailable, syncNow } from "../storage/sync";
import { IconSync } from "./icons";

function AccountCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [lastSync, setLastSync] = useState(0);

  const refresh = async () => {
    const u = await currentUser();
    setUser(u?.email ?? null);
    setLastSync(await getSetting<number>("sync.lastSyncAt", 0));
  };
  useEffect(() => {
    void refresh();
  }, []);

  if (!syncAvailable()) {
    return (
      <div class="card">
        <h3>Konto &amp; Synchronisierung</h3>
        <p class="muted small" style={{ margin: 0 }}>
          In dieser Version ist kein Sync-Server hinterlegt. Deine Daten bleiben auf diesem Gerät.
        </p>
      </div>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div class="card">
      <h3>Konto &amp; Synchronisierung</h3>
      {user ? (
        <>
          <p style={{ marginTop: 0 }}>
            Angemeldet als <strong>{user}</strong>. Partien, Analysen und Einstellungen werden automatisch zwischen
            deinen Geräten abgeglichen.
          </p>
          <p class="muted small">
            Letzter Abgleich: {lastSync ? new Date(lastSync).toLocaleString("de-DE") : "noch nie"}
          </p>
          <div class="row">
            <button
              class="btn primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await syncNow();
                  setMsg({ text: `Abgeglichen: ${r.pulled} empfangen, ${r.pushed} gesendet.` });
                })
              }
            >
              <IconSync /> Jetzt abgleichen
            </button>
            <button class="btn" disabled={busy} onClick={() => run(signOut)}>
              Abmelden
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="muted small" style={{ marginTop: 0 }}>
            Melde dich an, damit iPad, Handy und weitere Geräte dieselben Partien und Analysen haben. Ohne Konto
            funktioniert alles lokal auf diesem Gerät.
          </p>
          <label class="field">
            <span>E-Mail</span>
            <input type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Passwort</span>
            <input
              type="password"
              autocomplete="current-password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
          <div class="row">
            <button class="btn primary" disabled={busy || !email || !password} onClick={() => run(() => signIn(email, password))}>
              Anmelden
            </button>
            <button
              class="btn"
              disabled={busy || !email || password.length < 6}
              onClick={() =>
                run(async () => {
                  const needsConfirm = await signUp(email, password);
                  setMsg({
                    text: needsConfirm
                      ? "Konto erstellt. Bitte bestätige die E-Mail über den Link und melde dich dann hier an."
                      : "Konto erstellt und angemeldet.",
                  });
                })
              }
            >
              Konto erstellen
            </button>
          </div>
        </>
      )}
      {msg && (
        <p class={msg.error ? "error small" : "small"} style={{ marginBottom: 0 }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function BackupCard() {
  const [msg, setMsg] = useState("");
  const exportData = async () => {
    const games = await listGames();
    const blob = new Blob([JSON.stringify({ format: "schach-analyse-backup", version: 1, games })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `schach-analyse-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importData = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { games?: StoredGame[] };
      const games = (data.games ?? []).filter((g) => g && typeof g.id === "string");
      await putGames(games);
      setMsg(`${games.length} Partien importiert.`);
    } catch {
      setMsg("Die Datei konnte nicht gelesen werden.");
    }
  };
  return (
    <div class="card">
      <h3>Datensicherung</h3>
      <p class="muted small" style={{ marginTop: 0 }}>
        Exportiere alle Partien samt Analysen als Datei, oder spiele eine Sicherung wieder ein.
      </p>
      <div class="row">
        <button class="btn" onClick={exportData}>
          Exportieren
        </button>
        <label class="btn">
          Importieren
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void importData(f);
            }}
          />
        </label>
      </div>
      {msg && <p class="small">{msg}</p>}
    </div>
  );
}

export function SettingsView() {
  const [names, setNames] = useState("");
  const [strength, setStrength] = useState<AnalysisStrength>("normal");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSetting<string[]>("usernames", []).then((u) => setNames(u.join(", ")));
    void getSetting<AnalysisStrength>("analysis.strength", "normal").then(setStrength);
  }, []);

  const saveNames = async () => {
    const list = names
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    await setSetting("usernames", list);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div class="page-title">Einstellungen</div>
      <div class="grid" style={{ alignItems: "start" }}>
        <div>
          <div class="card">
            <h3>Deine Spielernamen</h3>
            <p class="muted small" style={{ marginTop: 0 }}>
              Namen auf Chess.com, Lichess oder in deinen PGN-Dateien. Daran erkennt die App, welche Seite du gespielt
              hast, und baut dein Profil.
            </p>
            <label class="field">
              <span>Namen, mit Komma getrennt</span>
              <input type="text" value={names} onInput={(e) => setNames(e.currentTarget.value)} placeholder="z. B. TimBoenig, tim_b" />
            </label>
            <button class="btn primary" onClick={saveNames}>
              {saved ? "Gespeichert ✓" : "Speichern"}
            </button>
          </div>
          <div class="card">
            <h3>Analyse-Stärke</h3>
            <p class="muted small" style={{ marginTop: 0 }}>
              Höhere Stärke ist genauer, braucht aber mehr Zeit und Akku. „Normal“ ist für Tablets und Handys ein guter
              Kompromiss.
            </p>
            <div class="segmented">
              {(Object.keys(STRENGTHS) as AnalysisStrength[]).map((k) => (
                <button
                  key={k}
                  class={strength === k ? "active" : ""}
                  onClick={() => {
                    setStrength(k);
                    void setSetting("analysis.strength", k);
                  }}
                >
                  {STRENGTHS[k].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <AccountCard />
          <BackupCard />
          <div class="card">
            <h3>Über die App</h3>
            <p class="small muted" style={{ margin: 0 }}>
              Die Analyse läuft mit Stockfish 17.1 (WebAssembly, GPLv3) vollständig auf deinem Gerät und funktioniert
              auch offline. Figuren: Cburnett (CC BY-SA 3.0 / GPLv2+). Eröffnungsnamen: lichess-org/chess-openings
              (CC0).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
