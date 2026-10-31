import { useEffect, useState } from "preact/hooks";

import { AI_PROVIDERS, type AiConfig, aiReady, defaultDetail, loadAiConfig, saveAiConfig, streamChat } from "../app/ai";
import { type CoachDetail, DETAIL_LEVELS } from "../domain/profile";
import { AUTO_ANALYZE_KEY, STRENGTHS, type AnalysisStrength } from "../app/analysisService";
import { exportData, type ExportKind, restoreBackup } from "../app/exporter";
import { getSetting, setSetting } from "../storage/db";
import { currentUser, signIn, signOut, signUp, syncAvailable, syncNow } from "../storage/sync";
import { IconSync } from "./icons";
import { PeriodSelect } from "./useProfile";
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
    <div class="card">
      <h3>Darstellung</h3>
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

function AiCard() {
  const saved = loadAiConfig();
  const [provider, setProvider] = useState(saved?.provider ?? "groq");
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? AI_PROVIDERS.groq.baseUrl);
  const [model, setModel] = useState(saved?.model ?? AI_PROVIDERS.groq.model);
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [detail, setDetail] = useState<CoachDetail>(saved?.detail ?? defaultDetail(saved?.provider ?? "groq"));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const p = AI_PROVIDERS[provider] ?? AI_PROVIDERS.custom;
  const cfg: AiConfig = { provider, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim(), detail };

  const pick = (k: string) => {
    setProvider(k);
    setBaseUrl(AI_PROVIDERS[k].baseUrl);
    setModel(AI_PROVIDERS[k].model);
    setDetail(defaultDetail(k));
    setStatus(null);
  };
  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const out = await streamChat(cfg, [{ role: "user", content: "Antworte nur mit: Bereit." }], () => undefined);
      setStatus({ ok: true, text: `Verbindung steht${out.trim() ? ` („${out.trim().slice(0, 40)}“)` : ""}.` });
      saveAiConfig(cfg);
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div class="card">
      <h3>
        KI-Coach <span class="pill">optional</span>
      </h3>
      <p class="muted small" style={{ marginTop: 0 }}>
        Erklärt Partien und beantwortet Fragen zu deinem Profil. Du nutzt dafür deinen eigenen Zugang bei einem Anbieter.
        Der Schlüssel bleibt nur auf diesem Gerät und wird nicht synchronisiert. An den Anbieter gehen nur die
        Analysewerte, keine Kontodaten.
      </p>
      <label class="field">
        <span>Anbieter</span>
        <select value={provider} onChange={(e) => pick(e.currentTarget.value)}>
          {Object.entries(AI_PROVIDERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      {(provider === "custom" || provider === "lmstudio") && (
        <label class="field">
          <span>Server-Adresse</span>
          <input value={baseUrl} onInput={(e) => setBaseUrl(e.currentTarget.value)} placeholder="https://…/v1" />
        </label>
      )}
      <label class="field">
        <span>Modell</span>
        <input value={model} onInput={(e) => setModel(e.currentTarget.value)} placeholder={p.model || "model-name"} />
      </label>
      <label class="field">
        <span>API-Schlüssel</span>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onInput={(e) => setApiKey(e.currentTarget.value)}
          placeholder={p.keyHint}
        />
      </label>
      <label class="field">
        <span>Datenmenge pro Frage</span>
        <select
          value={detail}
          onChange={(e) => {
            const v = e.currentTarget.value as CoachDetail;
            setDetail(v);
            // A working connection keeps working; only the amount of data changes.
            if (saved) saveAiConfig({ ...saved, detail: v });
          }}
        >
          {(Object.keys(DETAIL_LEVELS) as CoachDetail[]).map((k) => (
            <option key={k} value={k}>
              {DETAIL_LEVELS[k].label}
            </option>
          ))}
        </select>
      </label>
      <p class="small faint" style={{ margin: "-4px 0 10px" }}>
        Mehr Daten (alle Fähigkeiten, Einblicke, Eröffnungen und bis zu 40 Partien mit ihren teuersten Zügen) machen die
        Antworten genauer, brauchen aber ein Modell mit großem Kontext. Bei LM Studio dafür die Kontextlänge auf mindestens
        16 000 Tokens stellen.
      </p>
      {p.helpUrl && (
        <p class="small faint" style={{ margin: "0 0 10px" }}>
          Schlüssel erstellen:{" "}
          <a href={p.helpUrl} target="_blank" rel="noreferrer">
            {p.helpUrl.replace(/^https?:\/\//, "")}
          </a>
        </p>
      )}
      <div class="row">
        <button class="btn primary" disabled={testing || !aiReady(cfg)} onClick={() => void test()}>
          {testing ? "Teste …" : "Testen und speichern"}
        </button>
        {saved && (
          <button
            class="btn ghost"
            onClick={() => {
              saveAiConfig(null);
              setApiKey("");
              setStatus({ ok: true, text: "KI-Coach ausgeschaltet, Schlüssel gelöscht." });
            }}
          >
            Ausschalten
          </button>
        )}
      </div>
      {status && <p class={`small ${status.ok ? "ok" : "error"}`}>{status.text}</p>}
    </div>
  );
}

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
          (r.answers ? `, ${r.answers} Coach-Antworten` : "") +
          ".",
      });
    } catch {
      setMsg({ text: "Die Datei ist keine lesbare Sicherung der Schach-Analyse.", error: true });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="card" id="export">
      <h3>Export &amp; Datensicherung</h3>
      <p class="muted small" style={{ marginTop: 0 }}>
        Der vollständige Export enthält alles in einer Datei: jede Partie mit allen analysierten Zügen, die Auswertung
        pro Partie, Statistiken, Fähigkeiten, Stärken und Schwächen, Eröffnungen, Einblicke, Trainingsplan und
        -fortschritt sowie die gespeicherten Berichte des KI-Coachs. Der API-Schlüssel ist nie dabei.
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

export function SettingsView() {
  const [names, setNames] = useState("");
  const [strength, setStrength] = useState<AnalysisStrength>("normal");
  const [auto, setAuto] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSetting<string[]>("usernames", []).then((u) => setNames(u.join(", ")));
    void getSetting<AnalysisStrength>("analysis.strength", "normal").then(setStrength);
    void getSetting<boolean>(AUTO_ANALYZE_KEY, true).then(setAuto);
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
      <div class="settings-grid">
        <div>
          <div class="card">
            <h3>Deine Spielernamen</h3>
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
          <div class="card">
            <h3>Analyse-Stärke</h3>
            <p class="muted small" style={{ marginTop: 0 }}>
              Höhere Stärke ist genauer, braucht aber mehr Zeit und Akku. „Normal“ ist für Tablets und Handys ein guter
              Kompromiss.
            </p>
            <div class="segmented full stacked">
              {(Object.keys(STRENGTHS) as AnalysisStrength[]).map((k) => {
                const [name, depth] = STRENGTHS[k].label.split(" (");
                return (
                  <button
                    key={k}
                    class={strength === k ? "active" : ""}
                    onClick={() => {
                      setStrength(k);
                      void setSetting("analysis.strength", k);
                    }}
                  >
                    {name}
                    {depth && <small>{depth.replace(")", "")}</small>}
                  </button>
                );
              })}
            </div>
            <label class="toggle-row">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAuto(e.currentTarget.checked);
                  void setSetting(AUTO_ANALYZE_KEY, e.currentTarget.checked);
                }}
              />
              <span>
                <strong>Importierte Partien automatisch analysieren</strong>
                <small class="faint">Neue Partien kommen direkt in die Warteschlange, die neuesten zuerst.</small>
              </span>
            </label>
          </div>
          <AccountCard />
          <BackupCard />
        </div>
        <div>
          <AppearanceCard />
          <AiCard />
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
