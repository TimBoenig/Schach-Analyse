// Admin dashboard (Settings): aggregated usage numbers from the server. Only
// counts arrive here, never names, e-mail addresses or game contents.
import { useCallback, useEffect, useState } from "preact/hooks";

import { adminStats, clearAdmin, hasAdminToken, type AdminStats } from "../../app/adminApi";
import { BarList } from "../charts";
import { locale, t } from "../../i18n";
import { AdminLogin } from "./AdminLogin";

/** Supabase free plan: 500 MB database. */
const FREE_DB_BYTES = 500 * 1024 * 1024;

const num = (v: number, digits = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(v);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
/** Day labels like "23.11.", shown only every few days so they never collide. */
const dayLabel = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div class={`admin-tile${tone ? ` ${tone}` : ""}`}>
      <span class="admin-tile-label">{label}</span>
      <span class="admin-tile-value tnum">{value}</span>
      {sub && <span class="admin-tile-sub faint">{sub}</span>}
    </div>
  );
}

function Card({ title, sub, children, wide }: { title: string; sub?: string; children: preact.ComponentChildren; wide?: boolean }) {
  return (
    <section class={`admin-block${wide ? " admin-wide" : ""}`}>
      <h4>{title}</h4>
      {sub && <p class="small faint admin-sub">{sub}</p>}
      {children}
    </section>
  );
}

/** Vertical bars with a label under each bar. Used for weeks and hours of the day. */
function Bars({ items, label, ariaLabel, tick }: { items: { key: string; n: number }[]; label: (key: string) => string; ariaLabel: string; tick?: (key: string, i: number) => boolean }) {
  const peak = Math.max(1, ...items.map((i) => i.n));
  return (
    <div class="admin-bars-wrap" role="img" aria-label={ariaLabel}>
      <div class="admin-bars">
        {items.map((it) => (
          <span key={it.key} class="admin-bar-col" title={`${label(it.key)}: ${num(it.n)}`}>
            <i style={{ height: `${it.n > 0 ? Math.max(4, (it.n / peak) * 100) : 0}%` }} />
          </span>
        ))}
      </div>
      <div class="admin-bars-labels small faint">
        {items.map((it, i) => (
          <span key={it.key}>{tick && !tick(it.key, i) ? "" : label(it.key)}</span>
        ))}
      </div>
    </div>
  );
}

/** Stepped funnel: each step is a bar as wide as its share of the first step. */
function Funnel({ steps }: { steps: { label: string; n: number }[] }) {
  const top = Math.max(1, steps[0]?.n ?? 1);
  return (
    <ol class="admin-funnel">
      {steps.map((s, i) => {
        const prev = i === 0 ? s.n : steps[i - 1].n;
        return (
          <li key={s.label}>
            <div class="admin-funnel-row">
              <span class="admin-funnel-label small">{s.label}</span>
              <div class="admin-funnel-track">
                <div class="admin-funnel-bar" style={{ width: `${Math.max(8, (s.n / top) * 100)}%` }}>
                  <strong class="tnum">{num(s.n)}</strong>
                </div>
              </div>
            </div>
            {i > 0 && <span class="small faint admin-funnel-note">{t("{p} % der vorherigen Stufe", { p: pct(s.n, prev) })}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div class="admin-meter">
      <div class="admin-meter-head small">
        <span>{label}</span>
        <strong class="tnum">{value} %</strong>
      </div>
      <div class="admin-meter-track">
        <div class="admin-meter-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

/** What the numbers suggest: only claims the numbers themselves support. */
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
  if (s.retention && s.retention.cohort >= 3 && pct(s.retention.back7d, s.retention.cohort) < 30)
    hints.push(t("Von {n} älteren Konten kamen nur {m} nach mindestens 7 Tagen zurück.", { n: s.retention.cohort, m: s.retention.back7d }));
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
  const weeks = s?.users.signupsByWeek;
  const hours = s?.activity.byHour;
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
        {s && <span class="small faint">{t("Stand: {time}", { time: new Date(s.generatedAt).toLocaleString(locale()) })}</span>}
      </div>
      {problem && <p class="small error">{problem}</p>}
      {s && (
        <>
          <div class="admin-tiles">
            <Tile label={t("Registriert")} value={num(s.users.total)} sub={t("+{a} in 7 Tagen · +{b} in 30 Tagen", { a: num(s.users.signups7d), b: num(s.users.signups30d) })} />
            <Tile label={t("Aktiv heute")} value={num(s.activity.active1d)} sub={t("{n} in 7 Tagen · {m} in 30 Tagen", { n: num(s.activity.active7d), m: num(s.activity.active30d) })} />
            <Tile label={t("Partien synchronisiert")} value={num(s.games.total)} sub={t("{p} % analysiert", { p: pct(s.games.analysed, s.games.total) })} />
            <Tile label={t("Partien pro Konto")} value={num(s.games.perUserMedian)} sub={t("Median · Durchschnitt {avg}", { avg: num(s.games.perUserAvg) })} />
            <Tile label={t("Speicher")} value={`${num(s.storage.tableBytes / 1048576, 1)} MB`} sub={t("{n} Datensätze · {p} % des Gratis-Tarifs", { n: num(s.storage.records), p: pct(s.storage.tableBytes, FREE_DB_BYTES) })} />
          </div>

          <div class="admin-grid">
            <Card wide title={t("Aktive Konten pro Tag")} sub={t("Letzte 60 Tage · Konten mit Sync-Aktivität")}>
              <Bars
                items={s.activity.activeByDay.map((d) => ({ key: d.day, n: d.n }))}
                label={dayLabel}
                ariaLabel={t("Aktive Konten pro Tag")}
                tick={(_k, i) => i % 10 === 0}
              />
            </Card>

            <Card title={t("Neue Registrierungen pro Woche")} sub={t("Letzte 12 Wochen")}>
              {weeks ? (
                <Bars
                  items={weeks.map((w) => ({ key: w.week, n: w.n }))}
                  label={(k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.`}
                  ariaLabel={t("Neue Registrierungen pro Woche")}
                  tick={(_k, i) => i % 3 === 0}
                />
              ) : (
                <p class="small faint">{t("Ab der Datenbank-Migration v2 verfügbar.")}</p>
              )}
            </Card>

            <Card title={t("Wann gesynct wird")} sub={t("Letzte 30 Tage, Berliner Zeit")}>
              {hours ? (
                <Bars
                  items={hours.map((h) => ({ key: String(h.h), n: h.n }))}
                  label={(k) => k}
                  ariaLabel={t("Sync-Aktivität nach Uhrzeit")}
                  tick={(_k, i) => i % 3 === 0}
                />
              ) : (
                <p class="small faint">{t("Ab der Datenbank-Migration v2 verfügbar.")}</p>
              )}
            </Card>

            <Card title={t("Vom Konto zur Analyse")} sub={t("Wie viele Konten jede Stufe erreichen")}>
              <Funnel
                steps={[
                  { label: t("Registriert"), n: s.funnel.signedUp },
                  { label: t("Mit Partien"), n: s.funnel.synced },
                  { label: t("Mit Analyse"), n: s.funnel.analysed },
                  { label: t("Mit 20+ Analysen"), n: s.funnel.analysedMany },
                ]}
              />
            </Card>

            <Card title={t("Rückkehr")} sub={t("Konten, die vor mehr als 8 Tagen angelegt wurden")}>
              {s.retention && s.retention.cohort > 0 ? (
                <div class="admin-rings">
                  <Meter label={t("nach Tag 1 aktiv")} value={pct(s.retention.back1d, s.retention.cohort)} />
                  <Meter label={t("nach Tag 7 aktiv")} value={pct(s.retention.back7d, s.retention.cohort)} />
                </div>
              ) : (
                <p class="small faint">{t("Noch keine Konten, die alt genug sind.")}</p>
              )}
            </Card>

            <Card title={t("Konten nach Partienzahl")}>
              <BarList
                max={Math.max(1, s.funnel.signedUp)}
                rows={s.games.buckets.map((b) => ({ label: b.label, value: b.n, valueText: String(b.n) }))}
              />
            </Card>

            <Card wide title={t("Partien pro Tag")} sub={t("Letzte 60 Tage · neu oder geändert gesynct")}>
              <Bars
                items={s.games.syncedByDay.map((d) => ({ key: d.day, n: d.n }))}
                label={dayLabel}
                ariaLabel={t("Partien pro Tag")}
                tick={(_k, i) => i % 10 === 0}
              />
            </Card>
          </div>

          {hints.length > 0 && (
            <section class="admin-block">
              <h4>{t("Was die Zahlen nahelegen")}</h4>
              <ul class="admin-hints small">
                {hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </section>
          )}
          <p class="small faint" style={{ margin: "12px 0 0" }}>
            {t("Nur zusammengezählte Zahlen: keine Namen, Mailadressen oder Partieninhalte. „Aktiv“ heißt: Anmeldung oder Sync-Änderung in diesem Zeitraum. Gelöschte Partien: {n}.", { n: num(s.storage.deletedGames) })}
          </p>
        </>
      )}
    </div>
  );
}
