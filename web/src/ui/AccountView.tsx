// Account page (#/konto): sign in, register, reset the password and see what
// is stored online. The app works fully without an account; signing in only
// adds the compact online copy so every device shows the same profile.
import { useEffect, useState } from "preact/hooks";

import { onDataChanged, listGames } from "../storage/db";
import {
  accountInfo,
  changePassword,
  cloudGameCount,
  deleteAccount,
  deleteCloudData,
  resendConfirmation,
  setDisplayName,
  signInWithLink,
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
  type AccountInfo,
  type SyncStatus,
} from "../storage/sync";
import { SUPPORT_EMAIL } from "../brand";
import { navigate } from "./router";
import { PageHeader } from "./Layout";
import { Coach, CoachAvatar } from "./Coach";
import { IconEye, IconEyeOff, IconSync } from "./icons";

type Mode = "login" | "register" | "link" | "forgot" | "newPassword";
/** A mail is on its way and the page waits for its link to be opened. */
type Pending = { email: string; kind: "confirm" | "link" | "reset" } | null;
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

/** Why an account is worth it; shown before signing in and ticked off after. */
const BENEFITS = [
  ["Nichts geht verloren", "Leert der Browser seinen Speicher oder geht das Handy kaputt, holst du mit einer Anmeldung alles zurück."],
  ["Auf jedem Gerät", "PC, iPad und Handy zeigen dasselbe Profil, dieselben Statistiken und dieselbe Rangliste."],
  ["Training läuft weiter", "Tagesplan, Wiederholungen und Fortschritt merken sich, wo du aufgehört hast, egal wo du weitermachst."],
  ["Analysen nur einmal rechnen", "Was ein Gerät analysiert hat, ist auf allen anderen sofort fertig. Das spart Akku und Zeit."],
  ["Kostenlos und in deiner Hand", "Keine Werbung. Du kannst alles jederzeit herunterladen oder dein Konto mit einem Klick löschen."],
] as const;

function BenefitList({ done }: { done?: boolean }) {
  return (
    <ul class={`benefit-list${done ? " done" : ""}`}>
      {BENEFITS.map(([t, d]) => (
        <li key={t}>
          <span class="benefit-tick" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>{t}</strong>
            <span class="small muted">{d}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LegalLinks() {
  return (
    <p class="faint small legal-links">
      <a href="#/rechtliches">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a> ·{" "}
      <a href="#/rechtliches/lizenzen">Lizenzen</a>
    </p>
  );
}

function memberSince(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function SignedIn({ status, recovery }: { status: SyncStatus; recovery: boolean }) {
  const counts = useLocalCounts();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(recovery);
  const [confirm, setConfirm] = useState<"data" | "account" | null>(null);
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [online, setOnline] = useState<number | null>(null);
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    void accountInfo().then((i) => {
      setInfo(i);
      setName(i?.displayName ?? "");
    });
  }, [status.email]);
  useEffect(() => {
    void cloudGameCount().then(setOnline);
  }, [status.lastAt]);

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
  const shownName = info?.displayName || (status.email ?? "").split("@")[0];
  const allSafe = counts && counts.games > 0 && online !== null && online >= counts.games;
  return (
    <div class="dash">
      <section class="card tile span-6 account-hero">
        <div class="account-id">
          <span class="account-avatar">{(shownName || "?").slice(0, 1).toUpperCase()}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            {editName ? (
              <form
                class="row"
                style={{ gap: "6px" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await setDisplayName(name);
                    setInfo((i) => (i ? { ...i, displayName: name.trim() } : i));
                    setEditName(false);
                  });
                }}
              >
                <input
                  type="text"
                  style={{ flex: 1, minWidth: 0 }}
                  value={name}
                  maxLength={40}
                  placeholder="Wie sollen wir dich nennen?"
                  aria-label="Anzeigename"
                  onInput={(e) => setName(e.currentTarget.value)}
                />
                <button class="btn primary" disabled={busy}>
                  Speichern
                </button>
              </form>
            ) : (
              <>
                <strong class="account-name">
                  {shownName}{" "}
                  <button class="link-btn small" onClick={() => setEditName(true)}>
                    ändern
                  </button>
                </strong>
                <div class="small muted account-mail">{status.email}</div>
                {info?.createdAt ? <div class="faint small">Dabei seit {memberSince(info.createdAt)}</div> : null}
              </>
            )}
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
          <h3>Dein Konto bringt dir</h3>
          <span class={`tile-sub${allSafe ? " ok" : ""}`}>
            {counts && counts.games > 0 && online !== null
              ? allSafe
                ? `Alle ${counts.games} Partien gesichert`
                : `${online} von ${counts.games} Partien online`
              : " "}
          </span>
        </div>
        <BenefitList done />
      </section>

      <section class="card tile span-6">
        <div class="tile-head">
          <h3>Online gespeichert</h3>
          <span class="tile-sub">{counts ? `${counts.analysed} analysiert` : " "}</span>
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
          analysierte Partie braucht online nur wenige Kilobyte.
        </p>
      </section>

      <section class="card tile span-6">
        <div class="tile-head">
          <h3>Sicherheit & Daten</h3>
        </div>
        {showPw ? (
          <div class="account-form">
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
        ) : confirm ? (
          <div class="danger-zone">
            <p style={{ marginTop: 0 }}>
              {confirm === "data"
                ? "Löscht alles, was dieses Konto online gespeichert hat, und meldet dich ab. Die Partien auf diesem Gerät bleiben erhalten."
                : "Löscht dein Konto und alle Online-Daten endgültig. Die Partien auf diesem Gerät bleiben erhalten. Das lässt sich nicht rückgängig machen."}
            </p>
            <div class="row" style={{ flexWrap: "wrap", gap: "8px" }}>
              <button
                class="btn danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (confirm === "data") return void (await deleteCloudData());
                    const full = await deleteAccount();
                    if (!full) {
                      setMsg({
                        text: `Deine Online-Daten sind gelöscht. Die Anmeldung selbst konnte der Server noch nicht entfernen; schreib dafür kurz an ${SUPPORT_EMAIL}.`,
                        error: true,
                      });
                    }
                  })
                }
              >
                {confirm === "data" ? "Ja, Online-Daten löschen" : "Ja, Konto endgültig löschen"}
              </button>
              <button class="btn ghost" onClick={() => setConfirm(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <div class="account-actions">
            <button class="btn" onClick={() => setShowPw(true)}>
              Passwort ändern
            </button>
            <button class="btn" onClick={() => navigate({ view: "settings", tab: "daten" })}>
              Alle Daten herunterladen
            </button>
            <button class="btn ghost" onClick={() => setConfirm("data")}>
              Online-Daten löschen
            </button>
            <button class="btn ghost danger-text" onClick={() => setConfirm("account")}>
              Konto löschen
            </button>
          </div>
        )}
        <p class="faint small" style={{ marginBottom: 0 }}>
          Passwörter speichert nur der Anmeldedienst und nur als sicherer Hash. Jede Zeile online ist an dein Konto
          gebunden; andere Nutzer können sie nicht lesen.
        </p>
      </section>
      <div class="span-12">
        <LegalLinks />
      </div>
    </div>
  );
}

const RESEND_WAIT_S = 60;

/** Shown while a mail is on its way: where it went, what to do, resend. */
function MailSent({ pending, onBack }: { pending: NonNullable<Pending>; onBack: () => void }) {
  const [wait, setWait] = useState(RESEND_WAIT_S);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);
  const title =
    pending.kind === "confirm" ? "Bestätige deine E-Mail" : pending.kind === "link" ? "Dein Anmeldelink ist unterwegs" : "Link zum Zurücksetzen ist unterwegs";
  const resend = async () => {
    setMsg(null);
    try {
      if (pending.kind === "confirm") await resendConfirmation(pending.email);
      else if (pending.kind === "link") await signInWithLink(pending.email);
      else await requestPasswordReset(pending.email);
      setWait(RESEND_WAIT_S);
      setMsg({ text: "Neue Mail ist unterwegs." });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };
  return (
    <div class="mail-sent">
      <div class="mail-sent-icon" aria-hidden="true">
        ✉
      </div>
      <h3>{title}</h3>
      <p>
        Wir haben eine Mail an <strong>{pending.email}</strong> geschickt. Öffne den Link darin
        {pending.kind === "reset" ? " und lege ein neues Passwort fest." : ", dann bist du hier automatisch angemeldet."}
      </p>
      <ul class="small muted mail-tips">
        <li>Keine Mail nach zwei Minuten? Schau im Spam- oder Werbung-Ordner nach.</li>
        <li>Öffne den Link am besten auf diesem Gerät. Auf einem anderen klappt es auch, dann meldest du dich hier danach an.</li>
      </ul>
      <div class="row" style={{ flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
        <button class="btn" disabled={wait > 0} onClick={() => void resend()}>
          {wait > 0 ? `Erneut senden (${wait} s)` : "Erneut senden"}
        </button>
        <button class="btn ghost" onClick={onBack}>
          Andere Adresse
        </button>
      </div>
      {msg && <p class={`small ${msg.error ? "error" : "ok"}`}>{msg.text}</p>}
    </div>
  );
}

function SignedOut({ initialMode, notice }: { initialMode: Mode; notice: Msg }) {
  const [mode, setMode] = useState<Mode>(initialMode === "newPassword" ? "login" : initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(notice);
  const [pending, setPending] = useState<Pending>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const counts = useLocalCounts();

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setUnconfirmed(false);
    try {
      if (mode === "login") {
        await signIn(email, password);
        clearAuthCallback();
        void syncNow().catch(() => undefined);
      } else if (mode === "register") {
        const needsConfirm = await signUp(email, password);
        if (needsConfirm) setPending({ email: email.trim(), kind: "confirm" });
        else {
          setMsg({ text: "Konto erstellt. Deine Daten werden jetzt gesichert." });
          void syncNow().catch(() => undefined);
        }
      } else if (mode === "link") {
        await signInWithLink(email);
        setPending({ email: email.trim(), kind: "link" });
      } else {
        await requestPasswordReset(email);
        setPending({ email: email.trim(), kind: "reset" });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setUnconfirmed(/bestätige zuerst/i.test(text));
      setMsg({ text, error: true });
    } finally {
      setBusy(false);
    }
  };

  const pwIssue = mode === "register" && password ? passwordProblem(password) : null;
  const needsPw = mode === "login" || mode === "register";
  const canSubmit = Boolean(/.+@.+\..+/.test(email.trim()) && (!needsPw || (password && !pwIssue)));
  const tab = mode === "register" ? "register" : "login";

  return (
    <div class="dash">
      <section class="card tile span-6 account-pitch">
        <Coach size={56} title="Sichere deine Analysen">
          Ohne Konto bleibt alles nur auf diesem Gerät. Mit einem kostenlosen Konto ist es gesichert und überall
          dabei.
        </Coach>
        {counts && counts.games > 0 && (
          <p class="unsaved-note small">
            Auf diesem Gerät liegen {counts.games} Partien
            {counts.analysed ? `, ${counts.analysed} davon analysiert` : ""}, bisher ohne Sicherung.
          </p>
        )}
        <BenefitList />
      </section>

      <section class="card tile span-6">
        {pending ? (
          <MailSent pending={pending} onBack={() => setPending(null)} />
        ) : (
          <>
            <div class="segmented full" role="tablist" style={{ marginBottom: "14px" }}>
              {(
                [
                  ["login", "Anmelden"],
                  ["register", "Konto erstellen"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={tab === m}
                  class={tab === m ? "active" : ""}
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
              {mode === "link" && (
                <p style={{ marginTop: 0 }}>
                  Kein Passwort nötig: Wir schicken dir einen Link, ein Klick und du bist angemeldet. Gibt es noch kein
                  Konto, entsteht es dabei.
                </p>
              )}
              <label class="field">
                <span>E-Mail</span>
                <input type="email" autocomplete="email" inputMode="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
              </label>
              {needsPw && (
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
                {busy
                  ? "Einen Moment …"
                  : mode === "login"
                    ? "Anmelden"
                    : mode === "register"
                      ? "Kostenlos registrieren"
                      : mode === "link"
                        ? "Anmeldelink senden"
                        : "Link senden"}
              </button>
              <div class="row account-alt" style={{ justifyContent: "space-between", marginTop: "10px", flexWrap: "wrap", gap: "6px" }}>
                {mode === "forgot" || mode === "link" ? (
                  <button type="button" class="link-btn" onClick={() => setMode("login")}>
                    Mit Passwort anmelden
                  </button>
                ) : (
                  <>
                    <button type="button" class="link-btn" onClick={() => setMode("link")}>
                      Ohne Passwort, per Link
                    </button>
                    {mode === "login" && (
                      <button type="button" class="link-btn" onClick={() => setMode("forgot")}>
                        Passwort vergessen?
                      </button>
                    )}
                  </>
                )}
              </div>
              {mode === "register" && (
                <p class="faint small" style={{ marginBottom: 0 }}>
                  Wie wir mit deinen Daten umgehen, steht in der <a href="#/rechtliches/datenschutz">Datenschutzerklärung</a>.
                </p>
              )}
            </form>
            {msg && <p class={`small ${msg.error ? "error" : "ok"}`}>{msg.text}</p>}
            {unconfirmed && (
              <button class="btn small" onClick={() =>
                  void resendConfirmation(email)
                    .then(() => setPending({ email: email.trim(), kind: "confirm" }))
                    .catch((e: unknown) => setMsg({ text: e instanceof Error ? e.message : String(e), error: true }))
                }
              >
                Bestätigungsmail erneut senden
              </button>
            )}
          </>
        )}
      </section>
      <div class="span-12">
        <LegalLinks />
      </div>
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
