import { useEffect, useState } from "preact/hooks";

import { exportData, type ExportKind, restoreBackup } from "../app/exporter";
import { BRAND, BRAND_DOMAIN } from "../brand";
import { getSetting, setSetting } from "../storage/db";
import { refreshSyncStatus } from "../storage/sync";
import { useSyncStatus } from "./AccountView";
import { PageHeader } from "./Layout";
import { navigate, type SettingsTab } from "./router";
import { PeriodSelect } from "./useProfile";
import { AiExportCard } from "./AiExportCard";
import { AnalysisSettingsCards, SettingsHead } from "./AnalysisSettingsCard";
import { IconCloud, IconInfo, IconPalette, IconProfile } from "./icons";
import { Coach, COACH_NAME, resetTips } from "./Coach";
import { BOARD_THEMES, THEME_LABELS, setBoardTheme, setTheme, type BoardTheme, type ThemeMode } from "./theme";

function AppearanceCard() {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [board, setBoard] = useState<BoardTheme>("gruen");
  const [tipsBack, setTipsBack] = useState(false);
  useEffect(() => {
    void getSetting<ThemeMode>("ui.theme", "system").then(setThemeState);
    void getSetting<BoardTheme>("ui.board", "gruen").then(setBoard);
  }, []);
  return (
    <div class="card settings-card">
      <SettingsHead icon={<IconPalette />} title="Darstellung" sub="Farben der App und des Bretts." />
      <div class="segmented" style={{ marginBottom: "14px" }}>
        {(Object.keys(THEME_LABELS) as ThemeMode[]).map((k) => (
          <button
            key={k}
            class={theme === k ? "active" : ""}
            onClick={() => {
              setThemeState(k);
              void setTheme(k);
            }}
          >
            {THEME_LABELS[k]}
          </button>
        ))}
      </div>
      <div class="muted small" style={{ marginBottom: "6px" }}>
        Brettfarben
      </div>
      <div class="board-themes">
        {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((k) => {
          const t = BOARD_THEMES[k];
          return (
            <button
              key={k}
              class={`board-theme${board === k ? " active" : ""}`}
              aria-label={`Brettfarben ${t.label}`}
              onClick={() => {
                setBoard(k);
                void setBoardTheme(k);
              }}
            >
              <span class="swatch">
                <span style={{ background: t.light }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.light }} />
              </span>
              {t.label}
            </button>
          );
        })}
      </div>
      <div class="row" style={{ marginTop: "14px" }}>
        <button
          class="btn small"
          onClick={() => {
            resetTips();
            setTipsBack(true);
          }}
        >
          {tipsBack ? "Mikes Tipps sind wieder da ✓" : `Erklärungen von ${COACH_NAME} wieder anzeigen`}
        </button>
      </div>
    </div>
  );
}

function AccountCard() {
  const s = useSyncStatus();
  useEffect(() => void refreshSyncStatus(), []);
  if (s.phase === "off") return null;
  const signedIn = Boolean(s.email) && s.phase !== "signed-out";
  return (
    <div class="card settings-card">
      <SettingsHead icon={<IconCloud />} title="Konto & Synchronisierung" />
      <p class="muted small" style={{ marginTop: 0 }}>
        {signedIn
          ? `Angemeldet als ${s.email}. Profil, Statistiken und Partien sind auf allen deinen Geräten.`
          : "Mit einem Konto siehst du deine Analysen auf PC, iPad und Handy. Ohne Konto bleibt alles auf diesem Gerät."}
      </p>
      <button class={`btn${signedIn ? "" : " primary"}`} onClick={() => navigate({ view: "account" })}>
        {signedIn ? "Konto verwalten" : "Anmelden oder registrieren"}
      </button>
    </div>
  );
}

function BackupCard() {
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<ExportKind | "import" | null>(null);
  const [period, setPeriod] = useState("All Time");
  const run = async (kind: ExportKind) => {
    setBusy(kind);
    setMsg(null);
    try {
      const n = await exportData(kind, period);
      setMsg({ text: `${n} ${n === 1 ? "Partie" : "Partien"} exportiert.` });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
    }
  };
  const importData = async (file: File) => {
    setBusy("import");
    setMsg(null);
    try {
      const r = await restoreBackup(file);
      setMsg({
        text:
          `${r.games} Partien eingespielt` +
          (r.settings ? `, ${r.settings} Einstellungen ergänzt` : "") +
          ".",
      });
    } catch {
      setMsg({ text: `Die Datei ist keine lesbare Sicherung von ${BRAND}.`, error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="card" id="export">
      <h3>Export &amp; Datensicherung</h3>
      <p class="muted small" style={{ marginTop: 0 }}>
        Der vollständige Export ist die Datensicherung: jede Partie mit allen analysierten Zügen, die Auswertung pro
        Partie, Statistiken, Fähigkeiten, Stärken und Schwächen, Eröffnungen, Einblicke sowie Trainingsplan und
        -fortschritt. Er lässt sich hier wieder einspielen. Für eine KI ist der KI-Export daneben besser geeignet.
      </p>
      <div class="filters">
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>
      <div class="row">
        <button class="btn primary" disabled={busy !== null} onClick={() => void run("json")}>
          {busy === "json" ? "Wird erstellt …" : "Alles exportieren (JSON)"}
        </button>
        <button class="btn" disabled={busy !== null} onClick={() => void run("csv")}>
          Tabelle (CSV)
        </button>
        <button class="btn" disabled={busy !== null} onClick={() => void run("pgn")}>
          PGN
        </button>
      </div>
      <p class="small faint" style={{ margin: "8px 0 12px" }}>
        CSV öffnet sich in Excel oder Numbers (eine Zeile pro Partie mit Genauigkeit und Fehlern), PGN in jedem
        Schachprogramm.
      </p>
      <label class={`btn${busy ? " disabled" : ""}`}>
        Sicherung einspielen
        <input
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          disabled={busy !== null}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void importData(f);
          }}
        />
      </label>
      {msg && <p class={`small ${msg.error ? "error" : "ok"}`}>{msg.text}</p>}
    </div>
  );
}

export function SettingsView({ tab }: { tab?: SettingsTab }) {
  const [names, setNames] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSetting<string[]>("usernames", []).then((u) => setNames(u.join(", ")));
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

  if (tab === "analyse") {
    return (
      <div>
        <PageHeader />
        <div class="settings-cols">
          <AnalysisSettingsCards />
        </div>
      </div>
    );
  }
  if (tab === "daten") {
    return (
      <div>
        <PageHeader />
        <div class="settings-cols">
          <AiExportCard />
          <BackupCard />
        </div>
      </div>
    );
  }
  return (
    <div>
      <PageHeader />
      <div class="settings-cols">
        <div class="card settings-card">
          <SettingsHead icon={<IconProfile />} title="Deine Spielernamen" />
          <Coach size={44} title="Wie heißt du beim Schach?">
            Trag deine Namen von chess.com, Lichess oder aus deinen PGN-Dateien ein. Daran erkenne ich, welche Seite du
            gespielt hast, und baue dein Profil.
          </Coach>
          <label class="field">
            <span>Namen, mit Komma getrennt</span>
            <input type="text" value={names} onInput={(e) => setNames(e.currentTarget.value)} placeholder="z. B. TimBoenig, tim_b" />
          </label>
          <button class="btn primary" onClick={saveNames}>
            {saved ? "Gespeichert ✓" : "Speichern"}
          </button>
        </div>
        <AppearanceCard />
        <AccountCard />
        <div class="card settings-card">
          <SettingsHead icon={<IconInfo />} title={`Über ${BRAND}`} />
          <p class="small muted" style={{ margin: 0 }}>
            {BRAND} ({BRAND_DOMAIN}) ist dein persönlicher Schachtrainer: kostenlos und ohne Werbung. Die Analyse läuft mit Stockfish 17.1 (WebAssembly, GPLv3) vollständig auf deinem Gerät und funktioniert
            auch offline. Figuren: Cburnett (CC BY-SA 3.0 / GPLv2+). Eröffnungsnamen: lichess-org/chess-openings
            (CC0).
          </p>
        </div>
      </div>
    </div>
  );
}
