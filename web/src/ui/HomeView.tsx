import { useEffect, useMemo, useState } from "preact/hooks";

import { enqueue } from "../app/analysisService";
import { trFilter, trSpeed } from "../domain/i18n";
import { getUserColor, inDateFilter, isBulletGame } from "../domain/metrics";
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
import {
  CATEGORIES,
  CATEGORY_ORDER,
  type Category,
  type Exercise,
  localDay,
  type ProgressMap,
  type PuzzleExercise,
  puzzleOfTheDay,
} from "../domain/training";
import { PageHeader } from "./Layout";
import { AreaChart, ChangeBars, type ChangeRow, Ring, Sparkline } from "./charts";
import { Coach, CoachAvatar, COACH_NAME, type Mood } from "./Coach";
import { IconBoard, IconFreeBoard, IconPlay, IconUpload } from "./icons";
import { formatDate, shortOpening } from "./labels";
import { navigate } from "./router";
import { PuzzleRunner } from "./training/Runners";
import { loadTodayTraining, loadTrainingProgress, recordTrainingResult, type TodayTraining } from "./training/useTraining";
import { useBulletPrefs } from "./useAnalysisPrefs";
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

export function FormStats({ weekly }: { weekly: { week: string; avg_accuracy: number | null }[] }) {
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

export function Calendar({ days, note }: { days: ReturnType<typeof activityCalendar>; note?: string }) {
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
        {total} Partien an {active} Tagen.{" "}
        {note ?? "Regelmäßig wenige Partien mit Nachbereitung bringen mehr als seltene Serien."}
      </p>
    </>
  );
}

export function RecentGames({ profile }: { profile: PlayerProfile }) {
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

const TODAY_LABEL = () => new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

/** The last results as a row of tiles, oldest left, plus rating trend and accuracy. */
function FormCard({ profile }: { profile: PlayerProfile }) {
  const last = profile.recent_games.slice(0, 10);
  const chain = [...last].reverse();
  const wins = last.filter((g) => g.score === 1).length;
  const draws = last.filter((g) => g.score === 0.5).length;
  const losses = last.filter((g) => g.score === 0).length;
  const accs = last.map((g) => g.accuracy).filter((a): a is number => a !== null);
  const recentAcc = accs.length ? accs.reduce((s, a) => s + a, 0) / accs.length : null;
  const overallAcc = profile.analyzed_games ? profile.overview.avg_accuracy : null;
  const rc = profile.rating;
  const series = (profile.trends.ratings ?? {}) as Record<string, [number, number][]>;
  const key = rc && series[trSpeed(rc.speed)] ? trSpeed(rc.speed) : Object.keys(series).sort((a, b) => series[b].length - series[a].length)[0];
  const points = (series[key] ?? []).slice(-20).map(([, r]) => r);
  const ratingDelta = points.length >= 2 ? points[points.length - 1] - points[0] : null;
  return (
    <section class="card tile span-4 form-card">
      <div class="tile-head">
        <h3>Deine Form</h3>
        <span class="tile-sub">letzte {last.length} Partien</span>
      </div>
      {last.length ? (
        <>
          <div class="form-chain" role="img" aria-label={`${wins} Siege, ${draws} Remis, ${losses} Niederlagen`}>
            {chain.map((g) => (
              <button
                key={g.game_id}
                class={`form-dot ${g.score === 1 ? "win" : g.score === 0 ? "loss" : g.score === null ? "open" : "draw"}`}
                title={`${formatDate(g.date)} gegen ${g.opponent}: ${g.score === 1 ? "Sieg" : g.score === 0 ? "Niederlage" : g.score === null ? "offen" : "Remis"}`}
                onClick={() => navigate({ view: "analysis", gameId: g.game_id })}
              >
                {g.score === 1 ? "S" : g.score === 0 ? "N" : g.score === null ? "·" : "R"}
              </button>
            ))}
          </div>
          <div class="small muted">
            <strong class="ok">{wins} Siege</strong> · {draws} Remis · <span class="bad">{losses} Niederlagen</span>
          </div>
          <div class="form-rows">
            {rc && (
              <div class="form-row">
                <div>
                  <span class="kpi-label">Wertung {key}</span>
                  <strong class="tnum form-big">{points.length ? points[points.length - 1] : rc.rating}</strong>
                  {ratingDelta !== null && (
                    <span class={`pill ${ratingDelta > 0 ? "win" : ratingDelta < 0 ? "loss" : "draw"}`}>
                      {ratingDelta > 0 ? "+" : ratingDelta < 0 ? "−" : "±"}
                      {Math.abs(ratingDelta)}
                    </span>
                  )}
                </div>
                <Sparkline values={points} />
              </div>
            )}
            <div class="form-row">
              <div>
                <span class="kpi-label">Genauigkeit zuletzt</span>
                <strong class="tnum form-big">{recentAcc !== null ? `${de(recentAcc)} %` : "–"}</strong>
              </div>
              <span class="small faint">{overallAcc !== null ? `Schnitt im Zeitraum ${de(overallAcc)} %` : "noch nichts analysiert"}</span>
            </div>
          </div>
        </>
      ) : (
        <p class="muted small">Keine Partien in diesem Zeitraum.</p>
      )}
    </section>
  );
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** This week day by day: games played and the score on each day. */
function WeekStrip({ week, today }: { week: ReturnType<typeof activityCalendar>[number]; today: string }) {
  const played = week.reduce((n, d) => n + d.games, 0);
  return (
    <div class="week-strip">
      <div class="week-head">
        <span class="kpi-label">Deine Woche</span>
        <span class="small muted">
          {played} {played === 1 ? "Partie" : "Partien"} seit Montag
        </span>
      </div>
      <div class="week-days">
        {week.map((d, i) => {
          const tone = d.score_pct === null ? "" : d.score_pct >= 60 ? " good" : d.score_pct <= 40 ? " bad" : " even";
          return (
            <div
              key={d.day}
              class={`week-day${d.games ? " played" : ""}${tone}${d.day === today ? " today" : ""}${d.future ? " future" : ""}`}
              title={`${formatDate(d.day.replace(/-/g, "."))}: ${d.games} ${d.games === 1 ? "Partie" : "Partien"}${d.score_pct !== null ? `, ${Math.round(d.score_pct)} % Punkte` : ""}`}
            >
              <span class="week-name">{WEEKDAYS[i]}</span>
              <strong class="tnum">{d.future ? "" : d.games || "–"}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One puzzle from the player's own games per day, solvable right here. */
function DailyPuzzle({ ex, onResult }: { ex: PuzzleExercise | null; onResult: (ex: PuzzleExercise, ok: boolean) => void }) {
  return (
    <section class="card tile span-8 daily-puzzle">
      <div class="tile-head">
        <h3>Stellung des Tages</h3>
        <span class="tile-sub">aus deinen eigenen Partien · jeden Tag eine neue</span>
      </div>
      {ex ? (
        <PuzzleRunner
          key={ex.id}
          ex={ex}
          onResult={(ok) => onResult(ex, ok)}
          onNext={() => navigate({ view: "training", tab: "uebungen", category: ex.category })}
          nextLabel={`Mehr ${CATEGORIES[ex.category].label} üben`}
        />
      ) : (
        <p class="muted small">
          Sobald ein paar Partien analysiert sind, wartet hier jeden Tag eine Stellung, in der du danebengegriffen hast. Findest du
          diesmal den besten Zug?
        </p>
      )}
    </section>
  );
}

export function HomeView() {
  const { profile, comparison, games, usernames, loading, error, filters, setFilters } = useProfile({ compare: true });
  const [today, setToday] = useState<TodayTraining | null>(null);
  const [progress, setProgress] = useState<ProgressMap | null>(null);

  const refreshToday = () => void loadTodayTraining().then(setToday).catch(() => setToday(null));
  useEffect(() => {
    refreshToday();
    void loadTrainingProgress().then(setProgress).catch(() => setProgress({}));
  }, []);

  const names = usernames ?? [];
  const { skipBullet } = useBulletPrefs();
  const calendar = useMemo(() => activityCalendar(dailyActivity(games, names), localDay(), 16), [games, usernames]);
  const open = useMemo(
    () =>
      games
        .filter(
          (g) =>
            getUserColor(g, names) &&
            g.summary_json?.analysis_status !== "completed" &&
            inDateFilter(g, filters.date) &&
            !(skipBullet && isBulletGame(g)),
        )
        .map((g) => g.id),
    [games, usernames, filters.date, skipBullet],
  );
  // Picked once the progress is known, then kept for the visit so solving it
  // (which masters nothing yet) never swaps the board under the player.
  const [puzzleId, setPuzzleId] = useState<string | null>(null);
  const puzzle = useMemo(() => {
    if (!profile || !progress) return null;
    const pool = profile.exercises;
    const kept = puzzleId ? pool.find((e): e is PuzzleExercise => e.id === puzzleId && e.kind === "puzzle") : undefined;
    return kept ?? puzzleOfTheDay(pool, progress, localDay());
  }, [profile, progress, puzzleId]);
  useEffect(() => {
    if (puzzle && puzzle.id !== puzzleId) setPuzzleId(puzzle.id);
  }, [puzzle]);

  const header = (
    <>
      <PageHeader
        class="home-head"
        tabs={false}
        title={
          <div class="home-greeting">
            <span>{names[0] ? `Hallo ${names[0]}!` : "Start"}</span>
            <span class="home-date small muted">{TODAY_LABEL()}</span>
          </div>
        }
        actions={
          <div class="segmented small-seg" role="group" aria-label="Zeitraum">
            {QUICK.map(([k, l]) => (
              <button key={k} class={filters.date === k ? "active" : ""} onClick={() => setFilters({ ...filters, date: k })}>
                {l}
              </button>
            ))}
          </div>
        }
      />
      <FilterBar filters={filters} onChange={setFilters} hideDate />
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div class="welcome">
        <div class="welcome-hero card">
          <CoachAvatar size={112} mood="wow" />
          <h1>Hi, ich bin {COACH_NAME}!</h1>
          <p class="muted">
            Ich bin dein Schachtrainer. Ich schaue mir deine Partien an, erkläre dir jeden Fehler in einfachen Worten und
            stelle dir jeden Tag passende Übungen zusammen.
          </p>
          <ol class="welcome-steps">
            <li>
              <strong>Sag mir, wie du heißt</strong>
              <span class="small muted">Deinen Namen auf chess.com oder Lichess, damit ich deine Partien erkenne.</span>
            </li>
            <li>
              <strong>Lade deine Partien</strong>
              <span class="small muted">Direkt von chess.com oder Lichess oder als PGN-Datei.</span>
            </li>
            <li>
              <strong>Lass uns loslegen</strong>
              <span class="small muted">Ich analysiere alles auf deinem Gerät und zeige dir, woran du arbeiten solltest.</span>
            </li>
          </ol>
          <div class="row" style={{ justifyContent: "center" }}>
            <button class="btn primary big" onClick={() => navigate({ view: "settings" })}>
              Los geht's
            </button>
            <button class="btn big" onClick={() => navigate({ view: "games", import: true })}>
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
          <div class="skeleton span-8" style={{ height: "230px" }} />
          <div class="skeleton span-4" style={{ height: "230px" }} />
          <div class="skeleton span-12" style={{ height: "110px" }} />
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

  const changeRows: ChangeRow[] = cmp.skills.map((s) => ({
    label: s.name,
    delta: s.delta,
    valueText: String(Math.round(s.score)),
    faint: !s.reliable,
  }));

  const focus = comparison.current.weaknesses.slice(0, 3);
  const pool = comparison.current.exercises;
  const planned = today?.planned ?? 0;
  const done = today?.done ?? 0;
  const acc = cmp.kpis.find((k) => k.key === "accuracy");
  const accTrend = acc ? trendOf(acc) : "flat";
  const heroMood: Mood = accTrend === "up" ? "wow" : accTrend === "down" ? "think" : "happy";
  const heroTitle =
    notes[0] ??
    (today?.streak ? `Stark, ${today.streak} Tage in Folge trainiert! Weiter so.` : `Schön, dass du da bist${names[0] ? `, ${names[0]}` : ""}!`);
  const lastGame = profile.recent_games[0];

  return (
    <div class="home" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <div class="dash">
        <section class="card span-8 home-hero">
          <Coach mood={heroMood} size={72} class="big" title={heroTitle}>
            {comparison.fallback && <p class="small">Ich vergleiche deine letzten 30 Tage mit den 30 Tagen davor.</p>}
            {notes.length > 1 ? (
              <ul class="fact-list">
                {notes.slice(1).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : notes.length === 0 ? (
              <p>
                {comparison.current.total_games
                  ? "Noch keine deutlichen Veränderungen. Mit mehr analysierten Partien kann ich dir genauer sagen, wohin die Reise geht."
                  : "In diesem Zeitraum hast du noch keine Partie gespielt. Spiel ein paar Partien und lade sie hoch, dann schaue ich sie mir an."}
              </p>
            ) : null}
          </Coach>
          <WeekStrip week={calendar[calendar.length - 1]} today={localDay()} />
          <div class="today-strip">
            <Ring value={done} total={planned || 1} size={58}>
              <strong class="tnum">{planned ? `${done}/${planned}` : done}</strong>
            </Ring>
            <div class="today-text">
              <span class="kpi-label">Heute</span>
              <strong>{planned ? (done >= planned ? "Tagesplan geschafft" : `${planned - done} Übungen offen`) : done ? `${done} Übungen gelöst` : "Noch nicht trainiert"}</strong>
              <span class="small muted">
                {today?.streak ? `${today.streak} ${today.streak === 1 ? "Tag" : "Tage"} in Folge` : "Starte heute eine Serie"}
                {today?.week.done ? ` · diese Woche ${today.week.correct} von ${today.week.done} richtig` : ""}
              </span>
            </div>
            <div class="hero-actions">
              <button class="btn primary big" onClick={() => navigate({ view: "training" })}>
                <IconPlay /> {done && planned && done >= planned ? "Weiter üben" : "Tagesplan starten"}
              </button>
              {open.length > 0 && (
                <button class="btn" onClick={() => void enqueue(open)} title={`Offene Partien im Zeitraum ${period}`}>
                  {open.length} {open.length === 1 ? "Partie" : "Partien"} analysieren
                </button>
              )}
            </div>
          </div>
          <div class="hero-links">
            <button class="link-chip" onClick={() => navigate(lastGame ? { view: "analysis", gameId: lastGame.game_id } : { view: "games" })}>
              <IconBoard /> {lastGame ? `Letzte Partie gegen ${lastGame.opponent}` : "Partien"}
            </button>
            <button class="link-chip" onClick={() => navigate({ view: "games", import: true })}>
              <IconUpload /> Importieren
            </button>
            <button class="link-chip" onClick={() => navigate({ view: "board" })}>
              <IconFreeBoard /> Analysebrett
            </button>
            <span class="tile-sub hero-sub">{vsLabel}</span>
          </div>
        </section>

        <FormCard profile={profile} />

        <KpiStrip kpis={cmp.kpis} label={comparison.label} />

        <DailyPuzzle
          ex={puzzle}
          onResult={(ex, ok) => {
            void recordTrainingResult(ex, ok).then(refreshToday);
          }}
        />

        <section class="card tile span-4">
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
            <h3>Was sich verändert hat</h3>
            <span class="tile-sub">Fähigkeiten · {comparison.previous ? "gegenüber dem Zeitraum davor" : "kein Vergleichszeitraum"}</span>
          </div>
          {changeRows.length ? (
            <>
              <ChangeBars rows={changeRows} threshold={5} />
              <p class="faint small tile-foot">
                Grün: mindestens 5 Punkte besser, rot: 5 Punkte schlechter. Dahinter der aktuelle Wert von 0 bis 100. Blass: wenige Daten.
              </p>
            </>
          ) : (
            <p class="muted small">Noch keine analysierten Partien in diesem Zeitraum.</p>
          )}
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

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Aktivität</h3>
            <span class="tile-sub">letzte 16 Wochen</span>
          </div>
          <Calendar days={calendar} />
        </section>
      </div>
    </div>
  );
}
