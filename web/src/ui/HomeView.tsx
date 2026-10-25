import { useEffect, useMemo, useState } from "preact/hooks";

import { enqueue } from "../app/analysisService";
import { listCoachAnswers } from "../app/coachAnswers";
import { exportData } from "../app/exporter";
import type { SavedCoachAnswer } from "../domain/export";
import { trFilter, trSpeed } from "../domain/i18n";
import { getUserColor, inDateFilter } from "../domain/metrics";
import {
  activityCalendar,
  comparePeriods,
  dailyActivity,
  focusNotes,
  formSummary,
  type KpiChange,
  type PlayerProfile,
  trendOf,
} from "../domain/profile";
import { CATEGORIES, CATEGORY_ORDER, type Category, type Exercise, localDay } from "../domain/training";
import { AreaChart, BarList, type BarRow } from "./charts";
import { Markdown } from "./AiCoach";
import { IconPlay, IconSpark } from "./icons";
import { formatDate, shortOpening } from "./labels";
import { navigate } from "./router";
import { loadTodayTraining, type TodayTraining } from "./training/useTraining";
import { FilterBar, useProfile } from "./useProfile";

// One tap for the periods that matter day to day; the filter bar below has the rest.
const QUICK: [string, string][] = [
  ["Last 7 Days", "7 Tage"],
  ["Last 14 Days", "14 Tage"],
  ["Last 30 Days", "30 Tage"],
  ["Last 90 Days", "3 Monate"],
  ["All Time", "Alles"],
];

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

function kpiText(k: KpiChange, v: number | null): string {
  if (v === null) return "–";
  switch (k.key) {
    case "games":
    case "rating":
      return String(Math.round(v));
    case "blunders":
      return de(v, 2);
    case "accuracy":
      return de(v, 1);
    default:
      return `${Math.round(v)} %`;
  }
}

function deltaText(k: KpiChange): string {
  if (k.delta === null) return "";
  const digits = k.key === "blunders" ? 2 : k.key === "accuracy" ? 1 : 0;
  const v = k.key === "games" || k.key === "rating" ? Math.round(k.delta) : Number(k.delta.toFixed(digits));
  if (v === 0) return "±0";
  return `${v > 0 ? "+" : "−"}${de(Math.abs(v), digits)}`;
}

function skillCategory(skill: string, pool: Exercise[]): Category | undefined {
  return CATEGORY_ORDER.find((c) => CATEGORIES[c].skills.includes(skill) && pool.some((e) => e.category === c));
}

function KpiStrip({ kpis, label }: { kpis: KpiChange[]; label: string }) {
  return (
    <section class="card kpi-strip span-12" aria-label={`Kennzahlen ${label}`}>
      {kpis.map((k) => {
        const t = trendOf(k);
        return (
          <div class="kpi-cell" key={k.key}>
            <div class="kpi-label">{k.label}</div>
            <div class="kpi-value tnum">{kpiText(k, k.value)}</div>
            <div class="kpi-delta small">
              {k.delta !== null ? (
                <>
                  <span class={`pill ${k.key === "games" ? "draw" : t === "up" ? "win" : t === "down" ? "loss" : "draw"}`}>
                    {deltaText(k)}
                  </span>{" "}
                  <span class="faint">vorher {kpiText(k, k.previous)}</span>
                </>
              ) : (
                <span class="faint">kein Vergleich</span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

const de1 = (v: number) => v.toFixed(1).replace(".", ",");

function FormStats({ weekly }: { weekly: { week: string; avg_accuracy: number | null }[] }) {
  const f = formSummary(weekly);
  if (f.weeks < 2) return null;
  const diff = f.recent !== null && f.previous !== null ? f.recent - f.previous : null;
  const trend = f.trend_per_month;
  return (
    <div class="mini-stats tile-foot">
      <div>
        <span class="kpi-label">Letzte 4 Wochen</span>
        <strong class="tnum">{f.recent !== null ? `${de1(f.recent)} %` : "–"}</strong>
        {diff !== null && <span class={`small ${diff >= 2 ? "ok" : diff <= -2 ? "bad" : "faint"}`}>{diff >= 0 ? "+" : "−"}{de1(Math.abs(diff))} zu davor</span>}
      </div>
      <div>
        <span class="kpi-label">Richtung</span>
        <strong class={trend === null ? "" : trend >= 1 ? "ok" : trend <= -1 ? "bad" : ""}>
          {trend === null ? "–" : trend >= 1 ? "steigend" : trend <= -1 ? "fallend" : "stabil"}
        </strong>
        {trend !== null && <span class="small faint">{trend >= 0 ? "+" : "−"}{de1(Math.abs(trend))} Punkte pro Monat</span>}
      </div>
      <div>
        <span class="kpi-label">Beste Woche</span>
        <strong class="tnum">{f.best ? `${de1(f.best.accuracy)} %` : "–"}</strong>
        {f.best && <span class="small faint">ab {formatDate(f.best.week.replace(/-/g, "."))}</span>}
      </div>
    </div>
  );
}

function Calendar({ days }: { days: ReturnType<typeof activityCalendar> }) {
  const total = days.flat().reduce((s, d) => s + d.games, 0);
  const active = days.flat().filter((d) => d.games > 0).length;
  const level = (n: number) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
  return (
    <>
      <div class="calendar" role="img" aria-label={`${total} Partien an ${active} Tagen in den letzten ${days.length} Wochen`}>
        {days.map((col, i) => (
          <div class="cal-col" key={i}>
            {col.map((d) => (
              <span
                key={d.day}
                class={`cal-cell l${level(d.games)}${d.future ? " future" : ""}`}
                title={`${formatDate(d.day.replace(/-/g, "."))}: ${d.games} ${d.games === 1 ? "Partie" : "Partien"}${d.score_pct !== null ? `, ${Math.round(d.score_pct)} % Punkte` : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
      <p class="small muted tile-foot">
        {total} Partien an {active} Tagen. Regelmäßig wenige Partien mit Nachbereitung bringen mehr als seltene Serien.
      </p>
    </>
  );
}

function RecentGames({ profile }: { profile: PlayerProfile }) {
  const games = profile.recent_games.slice(0, 6);
  if (!games.length) return <p class="muted small">Keine Partien in diesem Zeitraum.</p>;
  return (
    <div class="recent-list">
      {games.map((g) => {
        const tone = g.score === 1 ? "win" : g.score === 0 ? "loss" : "draw";
        return (
          <button key={g.game_id} class="recent-row" onClick={() => navigate({ view: "analysis", gameId: g.game_id })}>
            <span class={`pill ${tone}`}>{g.score === 1 ? "Sieg" : g.score === 0 ? "Niederlage" : g.score === null ? "offen" : "Remis"}</span>
            <span class="recent-main">
              <strong>{g.opponent}</strong>
              {g.opp_rating ? <span class="faint"> ({g.opp_rating})</span> : null}
              <span class="small muted recent-sub">
                {formatDate(g.date)} · {trSpeed(g.speed)} · {shortOpening(g.opening) || "–"}
              </span>
            </span>
            <span class="recent-acc tnum small">
              {g.accuracy !== null ? `${de(g.accuracy)} %` : <span class="faint">nicht analysiert</span>}
              {g.blunders ? <span class="faint"> · {g.blunders} Patzer</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function HomeView() {
  const { profile, comparison, games, usernames, loading, error, filters, setFilters } = useProfile({ compare: true });
  const [today, setToday] = useState<TodayTraining | null>(null);
  const [report, setReport] = useState<SavedCoachAnswer | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void loadTodayTraining().then(setToday).catch(() => setToday(null));
    void listCoachAnswers().then((a) => setReport(a.find((x) => x.key.startsWith("report:")) ?? null));
  }, []);

  const names = usernames ?? [];
  const calendar = useMemo(() => activityCalendar(dailyActivity(games, names), localDay(), 16), [games, usernames]);
  const open = useMemo(
    () =>
      games
        .filter((g) => getUserColor(g, names) && g.summary_json?.analysis_status !== "completed" && inDateFilter(g, filters.date))
        .map((g) => g.id),
    [games, usernames, filters.date],
  );

  const runExport = async () => {
    setExporting(true);
    try {
      await exportData("json", filters.date);
    } finally {
      setExporting(false);
    }
  };

  const header = (
    <>
      <div class="page-title">
        Start
        <span class="spacer" />
        <div class="segmented small-seg" role="group" aria-label="Zeitraum">
          {QUICK.map(([k, l]) => (
            <button key={k} class={filters.date === k ? "active" : ""} onClick={() => setFilters({ ...filters, date: k })}>
              {l}
            </button>
          ))}
        </div>
        <button class="btn" disabled={exporting} onClick={() => void runExport()} title="Alles im gewählten Zeitraum als eine Datei">
          {exporting ? "Exportiere …" : "Exportieren"}
        </button>
      </div>
      <FilterBar filters={filters} onChange={setFilters} />
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div>
        <div class="page-title">Start</div>
        <div class="empty">
          <h3>Willkommen</h3>
          <p>Trage deine Spielernamen ein und importiere deine Partien. Hier siehst du dann jeden Tag, wo du stehst und was du heute üben solltest.</p>
          <div class="row" style={{ justifyContent: "center" }}>
            <button class="btn primary" onClick={() => navigate({ view: "settings" })}>
              Spielernamen eintragen
            </button>
            <button class="btn" onClick={() => navigate({ view: "games", import: true })}>
              Partien importieren
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "120px" }} />
          <div class="skeleton span-6" style={{ height: "260px" }} />
          <div class="skeleton span-6" style={{ height: "260px" }} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {header}
        <p class="error">{error}</p>
      </div>
    );
  }
  if (!profile || !comparison) return <div>{header}</div>;

  const cmp = comparePeriods(comparison.current, comparison.previous);
  const notes = focusNotes(comparison.current, cmp);
  const period = trFilter(filters.date);
  const vsLabel = comparison.previous
    ? `${comparison.label} gegenüber dem Zeitraum davor`
    : `${comparison.label}, kein früherer Zeitraum zum Vergleich`;

  const weekly = (profile.trends.weekly ?? []) as { week: string; games: number; avg_accuracy: number | null; score_pct: number }[];
  const formPoints = weekly
    .filter((w) => w.avg_accuracy !== null)
    .map((w) => ({
      label: `${w.week.slice(8, 10)}.${w.week.slice(5, 7)}.`,
      value: w.avg_accuracy as number,
      detail: `Woche ab ${formatDate(w.week.replace(/-/g, "."))} · ${w.games} ${w.games === 1 ? "Partie" : "Partien"} · ${Math.round(w.score_pct)} % Punkte`,
    }));

  const skillRows: BarRow[] = cmp.skills.map((s) => {
    const t = s.delta === null ? "flat" : trendOf({ delta: s.delta, higher_is_better: true, threshold: 5 });
    return {
      label: s.name,
      value: s.score,
      reference: s.previous,
      valueText: `${Math.round(s.score)}${s.delta !== null ? ` (${s.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(s.delta))})` : ""}`,
      color: t === "up" ? "var(--win)" : t === "down" ? "var(--loss)" : undefined,
      faint: !s.reliable,
    };
  });

  const focus = comparison.current.weaknesses.slice(0, 3);
  const pool = comparison.current.exercises;
  const planned = today?.planned ?? 0;
  const done = today?.done ?? 0;

  return (
    <div class="home" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <div class="dash">
        <section class="card tile span-12 facts-card">
          <div class="tile-head">
            <h3>Wo du gerade stehst</h3>
            <span class="tile-sub">{vsLabel}</span>
          </div>
          {comparison.fallback && (
            <p class="small muted" style={{ marginTop: 0 }}>
              Gesamter Zeitraum gewählt: Der Vergleich zeigt deine letzten 30 Tage, damit du siehst, wie es zuletzt läuft.
            </p>
          )}
          {notes.length ? (
            <ul class="fact-list">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : (
            <p class="muted small" style={{ margin: 0 }}>
              {comparison.current.total_games
                ? "Noch keine deutlichen Veränderungen. Mit mehr analysierten Partien werden die Trends belastbarer."
                : "In diesem Zeitraum hast du noch keine Partie gespielt."}
            </p>
          )}
        </section>

        <KpiStrip kpis={cmp.kpis} label={comparison.label} />

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Heute</h3>
            {today && today.streak > 0 && <span class="tile-sub">{today.streak} Tage in Folge trainiert</span>}
          </div>
          <div class="today-row">
            <div>
              <div class="kpi-label">Tagesplan</div>
              <div class="kpi-value tnum">
                {done}
                {planned ? <span class="kpi-unit"> / {planned}</span> : null}
              </div>
              <div class="small muted">{planned ? "Übungen erledigt" : "Übungen heute"}</div>
            </div>
            <div>
              <div class="kpi-label">Diese Woche</div>
              <div class="kpi-value tnum">{today?.week.done ?? 0}</div>
              <div class="small muted">
                Übungen{today && today.week.done ? `, ${Math.round((today.week.correct / today.week.done) * 100)} % gelöst` : ""}
              </div>
            </div>
          </div>
          {planned > 0 && (
            <div class="progress" style={{ margin: "10px 0" }}>
              <div style={{ width: `${Math.min(100, (done / planned) * 100)}%` }} />
            </div>
          )}
          {today?.headline && <p class="small" style={{ margin: "6px 0 10px" }}>{today.headline}</p>}
          <div class="row tile-foot">
            <button class="btn primary" onClick={() => navigate({ view: "training" })}>
              <IconPlay /> {done && planned && done >= planned ? "Weiter üben" : "Tagesplan starten"}
            </button>
            {open.length > 0 && (
              <button class="btn" onClick={() => enqueue(open)} title={`Offene Partien im Zeitraum ${period}`}>
                {open.length} {open.length === 1 ? "Partie" : "Partien"} analysieren
              </button>
            )}
          </div>
        </section>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Deine Baustellen</h3>
            <span class="tile-sub">{comparison.label}</span>
          </div>
          {focus.length ? (
            <div class="insights">
              {focus.map((w) => {
                const change = cmp.skills.find((s) => s.key === w.key);
                const cat = skillCategory(w.key, pool);
                return (
                  <div class="insight neg" key={w.key}>
                    <div class="t">
                      {w.title}
                      {change?.delta !== null && change?.delta !== undefined && (
                        <span class={`pill ${change.delta >= 5 ? "win" : change.delta <= -5 ? "loss" : "draw"}`} style={{ marginLeft: "8px" }}>
                          {change.delta >= 0 ? "+" : "−"}
                          {Math.abs(Math.round(change.delta))}
                        </span>
                      )}
                    </div>
                    <div class="small">{w.text}</div>
                    {cat && (
                      <button class="btn small" style={{ marginTop: "8px" }} onClick={() => navigate({ view: "training", tab: "uebungen", category: cat })}>
                        <IconPlay /> {CATEGORIES[cat].label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p class="muted small">
              {comparison.current.analyzed_games
                ? "Keine klare Schwäche in diesem Zeitraum."
                : "Analysiere Partien aus diesem Zeitraum, dann erscheinen hier deine Baustellen."}
            </p>
          )}
        </section>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Fähigkeiten im Vergleich</h3>
            <span class="tile-sub">Strich = Zeitraum davor</span>
          </div>
          {skillRows.length ? (
            <>
              <BarList rows={skillRows} referenceLabel={comparison.previous ? "Zeitraum davor" : undefined} />
              <p class="faint small tile-foot">Grün: mindestens 5 Punkte besser, rot: 5 Punkte schlechter. Blass: wenige Daten.</p>
            </>
          ) : (
            <p class="muted small">Noch keine analysierten Partien in diesem Zeitraum.</p>
          )}
        </section>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Formkurve</h3>
            <span class="tile-sub">Genauigkeit pro Woche · {period}</span>
          </div>
          <AreaChart
            points={formPoints}
            format={(v) => v.toFixed(0)}
            height={220}
            reference={profile.rating ? { value: profile.rating.typical_accuracy, label: `Typisch für ${profile.rating.rating}` } : null}
          />
          <FormStats weekly={weekly} />
        </section>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Aktivität</h3>
            <span class="tile-sub">letzte 16 Wochen</span>
          </div>
          <Calendar days={calendar} />
        </section>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Letzte Partien</h3>
            <button class="btn small" onClick={() => navigate({ view: "games" })}>
              Alle Partien
            </button>
          </div>
          <RecentGames profile={profile} />
        </section>

        <section class="card tile span-12">
          <div class="tile-head">
            <h3>
              <IconSpark /> Letzter Trainerbericht
            </h3>
            {report && <span class="tile-sub">{report.title} · {new Date(report.created_at).toLocaleDateString("de-DE")}</span>}
            <span class="spacer" />
            <button class="btn small" onClick={() => navigate({ view: "insights" })}>
              {report ? "Zu den Einblicken" : "Bericht schreiben lassen"}
            </button>
          </div>
          {report ? (
            <div class="report-preview">
              <Markdown text={report.text} />
            </div>
          ) : (
            <p class="muted small" style={{ margin: 0 }}>
              Unter Einblicke schreibt dir der KI-Coach einen Bericht über deine Partien. Er wird gespeichert, erscheint hier
              und ist im Export enthalten.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
