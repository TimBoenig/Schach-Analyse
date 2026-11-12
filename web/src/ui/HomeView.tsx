import { useEffect, useMemo, useState } from "preact/hooks";

import { enqueue } from "../app/analysisService";
import { trFilter, trSpeed } from "../domain/i18n";
import { getUserColor, inDateFilter, isBulletGame } from "../domain/metrics";
import {
  activityCalendar,
  type CalendarDay,
  comparePeriods,
  type DailyRow,
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
import { syncAvailable } from "../storage/sync";
import { Journey } from "./home/Journey";
import { LeagueTeaser } from "./home/LeagueTeaser";
import { HomeNudge } from "./HomeNudge";
import { CountUp, Hero, HeroStat, ResultRibbon } from "./kit";
import { PageHeader } from "./Layout";
import { AreaChart, ChangeBars, type ChangeRow, monthStart, Ring } from "./charts";
import { CoachAvatar, COACH_NAME, type Mood } from "./Coach";
import { IconBoard, IconFreeBoard, IconPlay, IconUpload } from "./icons";
import { formatDate, shortOpening, streakText } from "./labels";
import { navigate } from "./router";
import { PuzzleRunner } from "./training/Runners";
import { loadFullProfile, loadTodayTraining, loadTrainingProgress, recordTrainingResult, type TodayTraining } from "./training/useTraining";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { useProfile } from "./useProfile";

// One tap for the periods that matter day to day; the filter bar below has the rest.
const QUICK: [string, string][] = [
  ["Last 7 Days", "7 Tage"],
  ["Last 14 Days", "14 Tage"],
  ["Last 30 Days", "30 Tage"],
  ["Last 90 Days", "3 Monate"],
  ["All Time", "Alles"],
];

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

function kpiFormat(k: KpiChange): (v: number) => string {
  switch (k.key) {
    case "games":
    case "rating":
      return (v) => String(Math.round(v));
    case "blunders":
      return (v) => de(v, 2);
    case "accuracy":
      return (v) => de(v, 1);
    default:
      return (v) => `${Math.round(v)} %`;
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

const RESULT_WORD = (score: number | null) => (score === 1 ? "Sieg" : score === 0 ? "Niederlage" : score === null ? "offen" : "Remis");

/** The last results as tiles and the period's key figures, each with its change. */
function FormCard({ profile, kpis, label }: { profile: PlayerProfile; kpis: KpiChange[]; label: string }) {
  const last = profile.recent_games.slice(0, 12);
  const streak = streakText(last.map((g) => g.score));
  return (
    <section class="card tile span-12 form-card">
      <div class="tile-head">
        <h3>Deine Form</h3>
        <span class="tile-sub">
          letzte {last.length} Partien{streak ? ` · ${streak}` : ""}
        </span>
        <span class="spacer" />
        <span class="tile-sub">Kennzahlen: {label}</span>
      </div>
      {last.length ? (
        <ResultRibbon
          games={[...last].reverse().map((g) => ({ id: g.game_id, score: g.score, title: `${formatDate(g.date)} gegen ${g.opponent}: ${RESULT_WORD(g.score)}` }))}
          onPick={(id) => navigate({ view: "analysis", gameId: id })}
        />
      ) : (
        <p class="muted small">Keine Partien in diesem Zeitraum.</p>
      )}
      <div class="ar-stat-row" aria-label={`Kennzahlen ${label}`}>
        {kpis.map((k) => {
          const t = trendOf(k);
          return (
            <div class="ar-stat" key={k.key}>
              <span class="kpi-label">{k.label}</span>
              <span class="ar-stat-value">
                <CountUp value={k.value} format={kpiFormat(k)} />
              </span>
              <span class="small">
                {k.delta !== null ? (
                  <>
                    <span class={`pill ${k.key === "games" ? "draw" : t === "up" ? "win" : t === "down" ? "loss" : "draw"}`}>{deltaText(k)}</span>{" "}
                    <span class="faint">vorher {k.previous === null ? "–" : kpiFormat(k)(k.previous)}</span>
                  </>
                ) : (
                  <span class="faint">kein Vergleich</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
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

const CAL_SPANS = [4, 8, 16] as const;
const CAL_WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const CAL_MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const calLevel = (n: number) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

function dayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" });
}

function dayText(d: CalendarDay): string {
  if (!d.games) return `${dayLong(d.day)}: keine Partie`;
  const wdl = [d.wins && `${d.wins} S`, d.draws && `${d.draws} R`, d.losses && `${d.losses} N`].filter(Boolean).join(" · ");
  return `${dayLong(d.day)}: ${d.games} ${d.games === 1 ? "Partie" : "Partien"}${wdl ? ` (${wdl})` : ""}${d.score_pct !== null ? `, ${Math.round(d.score_pct)} % Punkte` : ""}`;
}

/**
 * Activity as a real calendar: one row per week (Monday first, newest at the
 * bottom), the day number in each cell and the month at its first day, so
 * "when was that" can be read off directly. Tapping a day shows its games.
 * `daily` is the full history; the span picker cuts the last 4/8/16 weeks.
 */
export function Calendar({ daily, today, note }: { daily: DailyRow[]; today: string; note?: string }) {
  const [weeks, setWeeks] = useState<number>(8);
  const [picked, setPicked] = useState<string | null>(null);
  const days = useMemo(() => activityCalendar(daily, today, weeks), [daily, today, weeks]);
  const flat = days.flat().filter((d) => !d.future);
  const total = flat.reduce((s, d) => s + d.games, 0);
  const active = flat.filter((d) => d.games > 0).length;
  const busiest = flat.reduce<CalendarDay | null>((b, d) => (d.games > (b?.games ?? 0) ? d : b), null);
  const lastPlayed = [...flat].reverse().find((d) => d.games > 0) ?? null;
  const shown = flat.find((d) => d.day === picked) ?? null;
  return (
    <>
      <div class="segmented small-seg cal-spans" role="group" aria-label="Zeitraum der Aktivität">
        {CAL_SPANS.map((w) => (
          <button key={w} class={weeks === w ? "active" : ""} onClick={() => setWeeks(w)}>
            {w} Wochen
          </button>
        ))}
      </div>
      <div class="cal-grid" role="grid" aria-label={`${total} Partien an ${active} Tagen in den letzten ${weeks} Wochen`}>
        <span />
        {CAL_WEEKDAYS.map((w) => (
          <span key={w} class="cal-wd">
            {w}
          </span>
        ))}
        {days.map((week) => {
          const first = week.find((d) => d.day.endsWith("-01"));
          const label = first ?? (week === days[0] ? week[0] : null);
          return [
            <span key={`m${week[0].day}`} class="cal-month">
              {label ? CAL_MONTHS[Number(label.day.slice(5, 7)) - 1] : ""}
            </span>,
            ...week.map((d) => {
              const tone = d.score_pct === null ? "" : d.score_pct >= 60 ? " good" : d.score_pct <= 40 ? " bad" : "";
              return (
                <button
                  key={d.day}
                  type="button"
                  disabled={d.future}
                  class={`cal-day l${calLevel(d.games)}${tone}${d.day === today ? " today" : ""}${d.future ? " future" : ""}${picked === d.day ? " on" : ""}`}
                  title={dayText(d)}
                  aria-label={dayText(d)}
                  onClick={() => setPicked(picked === d.day ? null : d.day)}
                >
                  <span class="cal-num">{Number(d.day.slice(8, 10))}</span>
                  {d.games > 0 && <span class="cal-n tnum">{d.games}</span>}
                </button>
              );
            }),
          ];
        })}
      </div>
      <p class="small cal-detail">
        {shown ? (
          dayText(shown)
        ) : (
          <span class="muted">
            {total} Partien an {active} von {flat.length} Tagen
            {lastPlayed ? ` · zuletzt ${dayLong(lastPlayed.day)}` : ""}
            {busiest && busiest.games > 1 ? ` · meiste: ${busiest.games} am ${dayLong(busiest.day)}` : ""}
          </span>
        )}
      </p>
      <p class="small faint tile-foot">
        Zahl unten rechts = Partien an dem Tag, grüner Rand = gut gepunktet, roter Rand = schwacher Tag. Tippe einen Tag an.{" "}
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
  // The rating journey looks at the whole history, whatever period is picked above.
  const [full, setFull] = useState<PlayerProfile | null>(null);

  const refreshToday = () => void loadTodayTraining().then(setToday).catch(() => setToday(null));
  useEffect(() => {
    refreshToday();
    void loadTrainingProgress().then(setProgress).catch(() => setProgress({}));
  }, []);

  const names = usernames ?? [];
  useEffect(() => {
    if (!profile) return;
    if (filters.date === "All Time" && filters.color === "All Colors" && filters.format === "All Formats") setFull(profile);
    else void loadFullProfile().then(setFull).catch(() => setFull(null));
  }, [profile]);
  const { skipBullet } = useBulletPrefs();
  const daily = useMemo(() => dailyActivity(games, names), [games, usernames]);
  const calendar = useMemo(() => activityCalendar(daily, localDay(), 1), [daily]);
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
          {syncAvailable() && (
            <p class="small muted" style={{ marginBottom: 0 }}>
              Schon ein Konto?{" "}
              <button class="link-btn" onClick={() => navigate({ view: "account" })}>
                Anmelden und alles zurückholen
              </button>
            </p>
          )}
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
      t: monthStart(w.week),
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
  const rc = profile.rating;
  const ratingKpi = cmp.kpis.find((k) => k.key === "rating");
  const fullRc = full?.rating ?? null;
  const journeySeries = fullRc ? (((full?.trends.ratings ?? {}) as Record<string, [number, number][]>)[trSpeed(fullRc.speed)] ?? []) : [];
  const topWeakness = (full ?? comparison.current).weaknesses[0];
  const leverCat = topWeakness ? skillCategory(topWeakness.key, (full ?? comparison.current).exercises) : undefined;
  const lever = topWeakness ? { title: topWeakness.title, go: () => navigate(leverCat ? { view: "training", tab: "uebungen", category: leverCat } : { view: "training" }) } : null;

  return (
    <div class="home" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <HomeNudge games={games.length} />
      <div class="dash">
        <Hero
          class="home-hero"
          kicker={
            <span class="home-kicker">
              <CoachAvatar size={26} mood={heroMood} /> {COACH_NAME} · {vsLabel}
            </span>
          }
          title={heroTitle}
          sub={
            notes.length > 1
              ? notes.slice(1, 3).join(" ")
              : notes.length === 0
                ? comparison.current.total_games
                  ? "Noch keine deutlichen Veränderungen. Mit mehr analysierten Partien kann ich dir genauer sagen, wohin die Reise geht."
                  : "In diesem Zeitraum hast du noch keine Partie gespielt. Spiel ein paar Partien und lade sie hoch, dann schaue ich sie mir an."
                : undefined
          }
          aside={
            rc ? (
              <HeroStat
                big={<CountUp value={rc.rating} />}
                label={`Wertung ${trSpeed(rc.speed)}`}
                sub={ratingKpi?.delta ? `${ratingKpi.delta > 0 ? "+" : "−"}${Math.abs(Math.round(ratingKpi.delta))} · ${comparison.label}` : comparison.label}
                onClick={() => navigate({ view: "profile" })}
                title="Zu deinem Profil"
              />
            ) : acc?.value != null ? (
              <HeroStat big={<CountUp value={acc.value} format={(v) => de(v, 1)} />} label="Genauigkeit" sub={comparison.label} onClick={() => navigate({ view: "profile" })} />
            ) : undefined
          }
        >
          {journeySeries.length >= 2 && fullRc && <Journey series={journeySeries} speed={trSpeed(fullRc.speed)} lever={lever} />}
          <div class="home-today">
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
            <WeekStrip week={calendar[calendar.length - 1]} today={localDay()} />
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
          </div>
        </Hero>

        <FormCard profile={profile} kpis={cmp.kpis} label={comparison.label} />

        <LeagueTeaser games={games} me={names} />

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
            <span class="tile-sub">Partien pro Tag</span>
          </div>
          <Calendar daily={daily} today={localDay()} />
        </section>
      </div>
    </div>
  );
}
