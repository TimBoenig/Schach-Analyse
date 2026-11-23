// Admin dashboard (Settings): aggregated usage numbers from the server. Only
// counts arrive here, never names, e-mail addresses or game contents.
import { useCallback, useEffect, useState } from "preact/hooks";

import { adminStats, clearAdmin, hasAdminToken, type AdminStats, type DayCount } from "../../app/adminApi";
import { BarList } from "../charts";
import { locale, t } from "../../i18n";
import { AdminLogin } from "./AdminLogin";

/** Supabase free plan: 500 MB database. */
const FREE_DB_BYTES = 500 * 1024 * 1024;
const CHART_DAYS = 30;

const num = (v: number, digits = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(v);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div class="admin-tile">
      <span class="admin-tile-value tnum">{value}</span>
      <span class="admin-tile-label">{label}</span>
      {sub && <span class="admin-tile-sub faint">{sub}</span>}
    </div>
  );
}

function Daily({ title, days, note }: { title: string; days: DayCount[]; note?: string }) {
  const last = days.slice(-CHART_DAYS);
  const total = last.reduce((s, d) => s + d.n, 0);
  const peak = Math.max(1, ...last.map((d) => d.n));
  return (
    <div class="admin-block">
      <h4>{title}</h4>
      <p class="small faint" style={{ margin: "0 0 6px" }}>
        {t("Letzte {n} Tage: {sum}", { n: CHART_DAYS, sum: num(total) })}
        {note ? ` · ${note}` : ""}
      </p>
      <div class="admin-bars" role="img" aria-label={title}>
        {last.map((d) => (
          <span key={d.day} class="admin-bar-col" title={`${d.day}: ${d.n}`}>
            <i style={{ height: `${Math.max(d.n > 0 ? 4 : 0, (d.n / peak) * 100)}%` }} />
          </span>
        ))}
      </div>
      <div class="admin-bars-axis small faint">
        <span>{last[0]?.day}</span>
        <span>{t("Spitze {n}", { n: num(peak) })}</span>
        <span>{last[last.length - 1]?.day}</span>
      </div>
    </div>
  );
}

/** What the numbers suggest doing: only claims the numbers themselves support. */
export function adminHints(s: AdminStats): string[] {
  const hints: string[] = [];
  const unconfirmed = s.users.total - s.users.confirmed;
  if (unconfirmed > 0) hints.push(t("Nicht bestätigte Konten: {n}. Zustellung der Bestätigungsmail prüfen.", { n: unconfirmed }));
  const idle = s.funnel.signedUp - s.funnel.synced;
  if (idle > 0) hints.push(t("Konten ohne Partie: {n} von {total}. Die Hürde liegt nach der Anmeldung (Import-Schritt).", { n: idle, total: s.funnel.signedUp }));
  const unanalysed = s.funnel.synced - s.funnel.analysed;
  if (unanalysed > 0) hints.push(t("Konten mit Partien, aber ohne Analyse: {n}. Der Hinweis auf die Analyse ist zu unauffällig.", { n: unanalysed }));
  if (s.activity.oldUsers >= 3 && pct(s.activity.oldUsersActive7d, s.activity.oldUsers) < 40)
    hints.push(t("Nur {p} % der Konten, die älter als eine Woche sind, waren in den letzten 7 Tagen aktiv: Bindung ausbauen (Training, Erinnerung).", { p: pct(s.activity.oldUsersActive7d, s.activity.oldUsers) }));
  const used = pct(s.storage.tableBytes, FREE_DB_BYTES);
  if (used >= 60) hints.push(t("Die Sync-Tabelle belegt {p} % der 500 MB im kostenlosen Supabase-Tarif.", { p: used }));
  return hints;
}

export function AdminPanel() {
  const [signedIn, setSignedIn] = useState(hasAdminToken);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    const r = await adminStats();
    setBusy(false);
    if (r.ok) return setStats(r.stats);
    if (r.reason === "unauthorized") return setSignedIn(false);
    setProblem(
      r.reason === "unconfigured"
        ? t("Die Datenbank-Anbindung ist auf dem Server noch nicht eingerichtet (SUPABASE_SERVICE_ROLE_KEY).")
        : r.reason === "migration"
          ? t("Die Datenbank-Funktion admin_stats() fehlt noch: Migration 20261123_admin_stats.sql einspielen.")
          : t("Die Zahlen konnten nicht geladen werden."),
    );
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  if (!signedIn) return <AdminLogin onDone={() => setSignedIn(true)} />;

  const s = stats;
  const hints = s ? adminHints(s) : [];
  return (
    <div class="admin-panel">
      <div class="row admin-bar">
        <button class="btn" disabled={busy} onClick={() => void load()}>
          {busy ? t("Lädt …") : t("Aktualisieren")}
        </button>
        <button
          class="btn ghost"
          onClick={() => {
            clearAdmin();
            setStats(null);
            setSignedIn(false);
          }}
        >
          {t("Abmelden")}
        </button>
        {s && <span class="small faint">{t("Stand: {time}", { time: new Date(s.generatedAt).toLocaleString() })}</span>}
      </div>
      {problem && <p class="small error">{problem}</p>}
      {s && (
        <>
          <div class="admin-tiles">
            <Tile label={t("Registriert")} value={s.users.total} sub={t("+{a} in 7 Tagen · +{b} in 30 Tagen", { a: s.users.signups7d, b: s.users.signups30d })} />
            <Tile label={t("Aktiv heute")} value={s.activity.active1d} sub={t("{n} in 7 Tagen · {m} in 30 Tagen", { n: s.activity.active7d, m: s.activity.active30d })} />
            <Tile
              label={t("Bindung")}
              value={s.activity.oldUsers ? `${pct(s.activity.oldUsersActive7d, s.activity.oldUsers)} %` : "–"}
              sub={t("{a} von {b} Konten (älter als 7 Tage) in den letzten 7 Tagen aktiv", { a: s.activity.oldUsersActive7d, b: s.activity.oldUsers })}
            />
            <Tile label={t("Partien synchronisiert")} value={num(s.games.total)} sub={t("{p} % analysiert", { p: pct(s.games.analysed, s.games.total) })} />
            <Tile label={t("Partien pro Konto")} value={num(s.games.perUserMedian)} sub={t("Median · Durchschnitt {avg}", { avg: num(s.games.perUserAvg) })} />
            <Tile label={t("Speicher")} value={`${num(s.storage.tableBytes / 1048576, 1)} MB`} sub={t("{n} Datensätze · {p} % des Gratis-Tarifs", { n: num(s.storage.records), p: pct(s.storage.tableBytes, FREE_DB_BYTES) })} />
          </div>

          <div class="admin-grid">
            <Daily title={t("Neue Registrierungen")} days={s.users.signupsByDay} />
            <Daily title={t("Aktive Konten pro Tag")} days={s.activity.activeByDay} note={t("Konten mit Sync-Aktivität")} />
            <Daily title={t("Neue oder geänderte Partien pro Tag")} days={s.games.syncedByDay} />
            <div class="admin-block">
              <h4>{t("Vom Konto zur Analyse")}</h4>
              <BarList
                max={Math.max(1, s.funnel.signedUp)}
                rows={[
                  { label: t("Registriert"), value: s.funnel.signedUp, valueText: String(s.funnel.signedUp) },
                  { label: t("Mit Partien"), value: s.funnel.synced, valueText: `${s.funnel.synced} · ${pct(s.funnel.synced, s.funnel.signedUp)} %` },
                  { label: t("Mit Analyse"), value: s.funnel.analysed, valueText: `${s.funnel.analysed} · ${pct(s.funnel.analysed, s.funnel.signedUp)} %` },
                  { label: t("Mit 20+ Analysen"), value: s.funnel.analysedMany, valueText: `${s.funnel.analysedMany} · ${pct(s.funnel.analysedMany, s.funnel.signedUp)} %` },
                ]}
              />
              <h4 style={{ marginTop: "16px" }}>{t("Konten nach Partienzahl")}</h4>
              <BarList
                max={Math.max(1, s.funnel.signedUp)}
                rows={s.games.buckets.map((b) => ({ label: b.label, value: b.n, valueText: String(b.n) }))}
              />
            </div>
          </div>

          {hints.length > 0 && (
            <div class="admin-block">
              <h4>{t("Was die Zahlen nahelegen")}</h4>
              <ul class="admin-hints small">
                {hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          <p class="small faint" style={{ margin: "12px 0 0" }}>
            {t("Nur zusammengezählte Zahlen: keine Namen, Mailadressen oder Partieninhalte. „Aktiv“ heißt: Anmeldung oder Sync-Änderung in diesem Zeitraum. Gelöschte Partien: {n}.", { n: s.storage.deletedGames })}
          </p>
        </>
      )}
    </div>
  );
}
