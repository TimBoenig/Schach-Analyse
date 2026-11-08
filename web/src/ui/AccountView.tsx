// Account page (#/konto): sign in, register, reset the password and see what
// is stored online. The app works fully without an account; signing in only
// adds the compact online copy so every device shows the same profile.
import { useEffect, useState } from "preact/hooks";

import { onDataChanged, listGames } from "../storage/db";
import {
  changePassword,
  deleteCloudData,
  MIN_PASSWORD,
  passwordProblem,
  refreshSyncStatus,
  requestPasswordReset,
  signIn,
  signOut,
  signUp,
  subscribeSyncStatus,
  syncAvailable,
  syncNow,
  clearAuthCallback,
  getAuthCallback,
  type SyncStatus,
} from "../storage/sync";
import { PageHeader } from "./Layout";
import { Coach, CoachAvatar } from "./Coach";
import { IconEye, IconEyeOff, IconSync } from "./icons";

type Mode = "login" | "register" | "forgot" | "newPassword";
type Msg = { text: string; error?: boolean } | null;

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>({ phase: "off", email: null, lastAt: 0, error: null });
  useEffect(() => subscribeSyncStatus(setS), []);
  return s;
}

function PasswordField({
  value,
  onInput,
  label = "Passwort",
  autocomplete,
}: {
  value: string;
  onInput: (v: string) => void;
  label?: string;
  autocomplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label class="field">
      <span>{label}</span>
      <div class="pw-field">
        <input
          type={show ? "text" : "password"}
          autocomplete={autocomplete}
          value={value}
          onInput={(e) => onInput(e.currentTarget.value)}
        />
        <button
          type="button"
          class="btn icon ghost"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"}
        >
          {show ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
    </label>
  );
}

function ago(ms: number): string {
  if (!ms) return "noch nie";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  return new Date(ms).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

/** Local numbers that the online copy mirrors. */
function useLocalCounts() {
  const [c, setC] = useState<{ games: number; analysed: number } | null>(null);
  useEffect(() => {
    const load = () =>
      void listGames().then((gs) =>
        setC({ games: gs.length, analysed: gs.filter((g) => g.summary_json?.analysis_status === "completed").length }),
      );
    load();
    return onDataChanged(load);
  }, []);
  return c;
}

const SYNCED = [
  ["Partien", "Spieldaten, PGN und Ergebnis jeder Partie"],
  ["Analysen kompakt", "Bewertung, Einstufung und Engine-Zug pro Zug, ohne lange Varianten"],
  ["Profil & Statistiken", "Genauigkeit, Fähigkeiten, Zugbilanz und Eröffnungen entstehen daraus auf jedem Gerät"],
  ["Spieler & Freunde", "deine Freundesliste samt Ranglisten-Auswahl"],
  ["Training & Einstellungen", "Fortschritt, Tagesplan, Namen, Analysetiefe, Aussehen"],
] as const;

function SignedIn({ status, recovery }: { status: SyncStatus; recovery: boolean }) {
  const counts = useLocalCounts();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(recovery);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const running = status.phase === "running";
  return (
    <div class="dash">
      <section class="card tile span-6 account-hero">
        <div class="account-id">
          <span class="account-avatar">{(status.email ?? "?").slice(0, 1).toUpperCase()}</span>
          <div>
            <div class="small muted">Angemeldet als</div>
            <strong class="account-mail">{status.email}</strong>
          </div>
        </div>
        <div class={`sync-state ${status.phase}`}>
          <span class="sync-dot" />
          {running
            ? "Wird abgeglichen …"
            : status.phase === "error"
              ? status.error
              : `Abgeglichen ${ago(status.lastAt)}`}
        </div>
        <div class="row" style={{ flexWrap: "wrap", gap: "8px" }}>
          <button
            class="btn primary"
            disabled={busy || running}
            onClick={() =>
              run(async () => {
                const r = await syncNow();
                setMsg({ text: r.pulled || r.pushed ? `Fertig: ${r.pulled} empfangen, ${r.pushed} gesendet.` : "Alles ist auf dem neuesten Stand." });
              })
            }
          >
            <IconSync /> Jetzt abgleichen
          </button>
          <button class="btn" disabled={busy} onClick={() => run(signOut)}>
            Abmelden
          </button>
        </div>
        {msg && <p class={`small ${msg.error ? "error" : "ok"}`}>{msg.text}</p>}
      </section>

      <section class="card tile span-6">
        <div class="tile-head">
          <h3>Online gespeichert</h3>
          <span class="tile-sub">{counts ? `${counts.games} Partien · ${counts.analysed} analysiert` : " "}</span>
        </div>
        <ul class="synced-list">
          {SYNCED.map(([t, d]) => (
            <li key={t}>
              <strong>{t}</strong>
              <span class="small muted">{d}</span>
            </li>
          ))}
        </ul>
        <p class="faint small" style={{ marginBottom: 0 }}>
          Lange Engine-Varianten und der Rechen-Cache bleiben auf dem Gerät, auf dem sie entstanden sind. Eine
          analysierte Partie braucht online nur wenige Kilobyte; ein anderes Gerät baut daraus die volle Partie mit allen
          Bewertungen wieder auf.
        </p>
      </section>

      <section class="card tile span-12">
        <div class="tile-head">
          <h3>Sicherheit</h3>
        </div>
        {showPw ? (
          <div class="account-form narrow">
            {recovery && <p style={{ marginTop: 0 }}>Du hast den Link zum Zurücksetzen geöffnet. Lege jetzt ein neues Passwort fest.</p>}
            <PasswordField label="Neues Passwort" value={pw} onInput={setPw} autocomplete="new-password" />
            <p class="faint small">Mindestens {MIN_PASSWORD} Zeichen, mit einer Zahl oder einem Sonderzeichen.</p>
            <div class="row" style={{ gap: "8px" }}>
              <button
                class="btn primary"
                disabled={busy || !!passwordProblem(pw)}
                onClick={() =>
                  run(async () => {
                    await changePassword(pw);
                    clearAuthCallback();
                    setPw("");
                    setShowPw(false);
                    setMsg({ text: "Neues Passwort gespeichert." });
                  })
                }
              >
                Passwort speichern
              </button>
              {!recovery && (
                <button class="btn ghost" onClick={() => setShowPw(false)}>
                  Abbrechen
                </button>
              )}
            </div>
          </div>
        ) : (
          <div class="row" style={{ flexWrap: "wrap", gap: "8px" }}>
            <button class="btn" onClick={() => setShowPw(true)}>
              Passwort ändern
            </button>
            {confirmDelete ? (
              <>
                <button
                  class="btn danger"
                  disabled={busy}
                  onClick={() => run(async () => void (await deleteCloudData()))}
                >
                  Ja, Online-Daten löschen
                </button>
                <button class="btn ghost" onClick={() => setConfirmDelete(false)}>
                  Abbrechen
                </button>
              </>
            ) : (
              <button class="btn ghost" onClick={() => setConfirmDelete(true)}>
                Online-Daten löschen
              </button>
            )}
          </div>
        )}
        {confirmDelete && (
          <p class="faint small">
            Löscht alles, was dieses Konto online gespeichert hat, und meldet dich ab. Die Partien auf diesem Gerät
            bleiben erhalten; andere Geräte behalten ihre Kopie, bis du dich dort abmeldest.
          </p>
        )}
        <p class="faint small" style={{ marginBottom: 0 }}>
          Passwörter speichert nur der Anmeldedienst (Supabase Auth) und nur als sicherer Hash. Jede Zeile online ist an
          dein Konto gebunden; andere Nutzer können sie nicht lesen.
        </p>
      </section>
    </div>
  );
}

function SignedOut({ initialMode, notice }: { initialMode: Mode; notice: Msg }) {
  const [mode, setMode] = useState<Mode>(initialMode === "newPassword" ? "login" : initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(notice);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        await signIn(email, password);
        clearAuthCallback();
        void syncNow().catch(() => undefined);
      } else if (mode === "register") {
        const needsConfirm = await signUp(email, password);
        setMsg({
          text: needsConfirm
            ? "Fast geschafft! Öffne den Link in der Bestätigungsmail, danach bist du hier angemeldet."
            : "Konto erstellt. Deine Daten werden jetzt abgeglichen.",
        });
        if (!needsConfirm) void syncNow().catch(() => undefined);
      } else {
        await requestPasswordReset(email);
        setMsg({ text: "Wenn es ein Konto mit dieser Adresse gibt, ist jetzt eine Mail mit einem Link unterwegs." });
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  const pwIssue = mode === "register" && password ? passwordProblem(password) : null;
  const canSubmit = Boolean(email.includes("@") && (mode === "forgot" || (password && !pwIssue)));

  return (
    <div class="dash">
      <section class="card tile span-6 account-pitch">
        <Coach size={56} title="Deine Analysen auf jedem Gerät">
          Mit einem Konto siehst du dein Profil, deine Statistiken, die Zugbilanz und deine Freunde auf dem PC, dem iPad
          und dem Handy. Ohne Konto bleibt alles wie gehabt auf diesem Gerät.
        </Coach>
        <ul class="synced-list">
          {SYNCED.map(([t, d]) => (
            <li key={t}>
              <strong>{t}</strong>
              <span class="small muted">{d}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="card tile span-6">
        <div class="segmented full" role="tablist" style={{ marginBottom: "14px" }}>
          {(
            [
              ["login", "Anmelden"],
              ["register", "Registrieren"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              class={mode === m ? "active" : ""}
              onClick={() => {
                setMode(m);
                setMsg(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <form class="account-form" onSubmit={submit}>
          {mode === "forgot" && <p style={{ marginTop: 0 }}>Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>}
          <label class="field">
            <span>E-Mail</span>
            <input type="email" autocomplete="email" inputMode="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          </label>
          {mode !== "forgot" && (
            <PasswordField
              value={password}
              onInput={setPassword}
              autocomplete={mode === "register" ? "new-password" : "current-password"}
            />
          )}
          {mode === "register" && (
            <p class={`small ${pwIssue ? "error" : "faint"}`} style={{ marginTop: 0 }}>
              {pwIssue ?? `Mindestens ${MIN_PASSWORD} Zeichen, mit einer Zahl oder einem Sonderzeichen.`}
            </p>
          )}
          <button class="btn primary block" type="submit" disabled={busy || !canSubmit}>
            {busy ? "Einen Moment …" : mode === "login" ? "Anmelden" : mode === "register" ? "Konto erstellen" : "Link senden"}
          </button>
          <div class="row" style={{ justifyContent: "space-between", marginTop: "10px" }}>
            {mode === "forgot" ? (
              <button type="button" class="link-btn" onClick={() => setMode("login")}>
                Zurück zur Anmeldung
              </button>
            ) : (
              <button type="button" class="link-btn" onClick={() => setMode("forgot")}>
                Passwort vergessen?
              </button>
            )}
          </div>
        </form>
        {msg && <p class={`small ${msg.error ? "error" : "ok"}`}>{msg.text}</p>}
      </section>
    </div>
  );
}

export function AccountView() {
  const status = useSyncStatus();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void refreshSyncStatus().finally(() => setReady(true));
  }, []);
  const callback = getAuthCallback();
  const recovery = callback?.type === "recovery" && !callback.error;
  const notice: Msg = callback?.error
    ? { text: callback.error, error: true }
    : callback?.type === "signup"
      ? { text: "E-Mail bestätigt. Du kannst dich jetzt anmelden." }
      : null;

  if (!syncAvailable()) {
    return (
      <div>
        <PageHeader />
        <div class="empty">
          <CoachAvatar size={88} mood="think" />
          <h3>Kein Sync-Server hinterlegt</h3>
          <p>Diese Version läuft rein lokal. Deine Partien und Analysen bleiben auf diesem Gerät.</p>
        </div>
      </div>
    );
  }

  const signedIn = Boolean(status.email) && status.phase !== "signed-out";
  return (
    <div>
      <PageHeader />
      {!ready ? (
        <div class="dash">
          <div class="skeleton span-6" style={{ height: "260px" }} />
          <div class="skeleton span-6" style={{ height: "260px" }} />
        </div>
      ) : signedIn ? <SignedIn status={status} recovery={recovery} /> : <SignedOut initialMode="login" notice={notice} />}
    </div>
  );
}
