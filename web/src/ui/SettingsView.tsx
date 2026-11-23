import { useEffect, useRef, useState } from "preact/hooks";

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
import { LangChoice } from "./LangSwitch";
import { IconCloud, IconInfo, IconPalette, IconProfile, IconGlobe } from "./icons";
import { Coach, COACH_NAME, resetTips } from "./Coach";
import { resetSeen } from "./stage/store";
import { setStudioUnlocked, studioUnlocked, UNLOCK_TAPS } from "./studio/access";
import { onPhone, PHONE_SCALES, type PhoneScale, readPhoneScale, setPhoneScale } from "./phoneScale";
import { BOARD_THEMES, DEFAULT_BOARD, THEME_LABELS, setBoardTheme, setTheme, type BoardTheme, type ThemeMode } from "./theme";
import { ENGINE_NAME, ENGINE_VERSION } from "../engine/info";
import { t } from "../i18n";

/**
 * "About" card. Holds the hidden way into the video studio: tapping the
 * heading seven times in a row unlocks it on this device. Not a security
 * measure (the studio shows no private data), just out of normal users' way.
 */
function AboutCard() {
  const [unlocked, setUnlocked] = useState(studioUnlocked);
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((tk) => now - tk < 3000), now];
    if (!unlocked && taps.current.length >= UNLOCK_TAPS) {
      taps.current = [];
      setStudioUnlocked(true);
      setUnlocked(true);
    }
  };
  return (
    <div class="card settings-card">
      <div class="about-tap" onClick={tap}>
        <SettingsHead icon={<IconInfo />} title={t("Über {BRAND}", { BRAND })} />
      </div>
      <p class="small muted" style={{ margin: 0 }}>
        {t("{BRAND} ({BRAND_DOMAIN}) ist dein persönlicher Schachtrainer: kostenlos und ohne Werbung. Die Analyse läuft mit {ENGINE_NAME} {ENGINE_VERSION} (WebAssembly, MIT-Lizenz) vollständig auf deinem Gerät und funktioniert auch offline. Figuren: Cburnett (CC BY-SA 3.0). Eröffnungsnamen: lichess-org/chess-openings (CC0).", { BRAND, BRAND_DOMAIN, ENGINE_NAME, ENGINE_VERSION })}
      </p>
      {unlocked && (
        <div class="about-studio">
          <button class="btn primary" onClick={() => navigate({ view: "studio" })}>
            
            {t("Videostudio öffnen")}
          </button>
          <button
            class="btn ghost"
            onClick={() => {
              setStudioUnlocked(false);
              setUnlocked(false);
            }}
          >
            
            {t("Wieder verstecken")}
          </button>
        </div>
      )}
    </div>
  );
}

function AppearanceCard() {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [board, setBoard] = useState<BoardTheme>(DEFAULT_BOARD);
  const [tipsBack, setTipsBack] = useState(false);
  const [scale, setScale] = useState<PhoneScale>(readPhoneScale);
  useEffect(() => {
    void getSetting<ThemeMode>("ui.theme", "system").then(setThemeState);
    void getSetting<BoardTheme>("ui.board", DEFAULT_BOARD).then(setBoard);
  }, []);
  return (
    <div class="card settings-card">
      <SettingsHead icon={<IconPalette />} title={t("Darstellung")} sub={t("Farben der App und des Bretts.")} />
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
      {onPhone() && (
        <>
          <div class="muted small" style={{ marginBottom: "6px" }}>
            {t("Größe auf dem Handy")}
          </div>
          <div class="segmented" style={{ marginBottom: "14px" }}>
            {(Object.keys(PHONE_SCALES) as PhoneScale[]).map((k) => (
              <button
                key={k}
                class={scale === k ? "active" : ""}
                onClick={() => {
                  setScale(k);
                  setPhoneScale(k);
                }}
              >
                {PHONE_SCALES[k].label}
              </button>
            ))}
          </div>
        </>
      )}
      <div class="muted small" style={{ marginBottom: "6px" }}>
        
        {t("Brettfarben")}
      </div>
      <div class="board-themes">
        {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((k) => {
          const tk = BOARD_THEMES[k];
          return (
            <button
              key={k}
              class={`board-theme${board === k ? " active" : ""}`}
              aria-label={t("Brettfarben {label}", { label: tk.label })}
              onClick={() => {
                setBoard(k);
                void setBoardTheme(k);
              }}
            >
              <span class="swatch">
                <span style={{ background: tk.light }} />
                <span style={{ background: tk.dark }} />
                <span style={{ background: tk.dark }} />
                <span style={{ background: tk.light }} />
              </span>
              {tk.label}
            </button>
          );
        })}
      </div>
      <div class="row" style={{ marginTop: "14px" }}>
        <button
          class="btn small"
          onClick={() => {
            // Both kinds of explanation: the page guides in full screen and the older inline tips.
            resetSeen();
            resetTips();
            setTipsBack(true);
          }}
        >
          {tipsBack ? t("{COACH_NAME} erklärt jede Seite wieder beim ersten Besuch ✓", { COACH_NAME }) : t("Erklärungen von {COACH_NAME} wieder anzeigen", { COACH_NAME })}
        </button>
      </div>
    </div>
  );
}

function LanguageCard() {
  return (
    <div class="card settings-card">
      <SettingsHead icon={<IconGlobe />} title={t("Sprache")} sub={t("Die App erkennt die Sprache deines Browsers. Hier kannst du sie fest einstellen; die Seite lädt dann neu.")} />
      <LangChoice />
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
      <SettingsHead icon={<IconCloud />} title={t("Konto & Synchronisierung")} />
      <p class="muted small" style={{ marginTop: 0 }}>
        {signedIn
          ? t("Angemeldet als {email}. Profil, Statistiken und Partien sind auf allen deinen Geräten.", { email: s.email })
          : t("Mit einem Konto siehst du deine Analysen auf PC, iPad und Handy. Ohne Konto bleibt alles auf diesem Gerät.")}
      </p>
      <button class={`btn${signedIn ? "" : " primary"}`} onClick={() => navigate({ view: "account" })}>
        {signedIn ? t("Konto verwalten") : t("Anmelden oder registrieren")}
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
      setMsg({ text: `${n} ${n === 1 ? t("Partie") : t("Partien")} exportiert.` });
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
          t("{games} Partien eingespielt", { games: r.games }) +
          (r.settings ? t(", {settings} Einstellungen ergänzt", { settings: r.settings }) : "") +
          ".",
      });
    } catch {
      setMsg({ text: t("Die Datei ist keine lesbare Sicherung von {BRAND}.", { BRAND }), error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="card" id="export">
      <h3>{t("Export & Datensicherung")}</h3>
      <p class="muted small" style={{ marginTop: 0 }}>
        
        {t("Der vollständige Export ist die Datensicherung: jede Partie mit allen analysierten Zügen, die Auswertung pro Partie, Statistiken, Fähigkeiten, Stärken und Schwächen, Eröffnungen, Einblicke sowie Trainingsplan und -fortschritt. Er lässt sich hier wieder einspielen. Für eine KI ist der KI-Export daneben besser geeignet.")}
      </p>
      <div class="filters">
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>
      <div class="row">
        <button class="btn primary" disabled={busy !== null} onClick={() => void run("json")}>
          {busy === "json" ? t("Wird erstellt …") : t("Alles exportieren (JSON)")}
        </button>
        <button class="btn" disabled={busy !== null} onClick={() => void run("csv")}>
          
          {t("Tabelle (CSV)")}
        </button>
        <button class="btn" disabled={busy !== null} onClick={() => void run("pgn")}>
          PGN
        </button>
      </div>
      <p class="small faint" style={{ margin: "8px 0 12px" }}>
        
        {t("CSV öffnet sich in Excel oder Numbers (eine Zeile pro Partie mit Genauigkeit und Fehlern), PGN in jedem Schachprogramm.")}
      </p>
      <label class={`btn${busy ? " disabled" : ""}`}>
        
        {t("Sicherung einspielen")}
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
          <SettingsHead icon={<IconProfile />} title={t("Deine Spielernamen")} />
          <Coach size={44} title={t("Wie heißt du beim Schach?")}>
            
            {t("Trag deine Namen von chess.com, Lichess oder aus deinen PGN-Dateien ein. Daran erkenne ich, welche Seite du gespielt hast, und baue dein Profil.")}
          </Coach>
          <label class="field">
            <span>{t("Namen, mit Komma getrennt")}</span>
            <input type="text" value={names} onInput={(e) => setNames(e.currentTarget.value)} placeholder={t("z. B. MaxMuster, max_m")} />
          </label>
          <button class="btn primary" onClick={saveNames}>
            {saved ? t("Gespeichert ✓") : t("Speichern")}
          </button>
        </div>
        <LanguageCard />
        <AppearanceCard />
        <AccountCard />
        <AboutCard />
      </div>
    </div>
  );
}
