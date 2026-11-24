// Start: the day at a glance. On top what Lucena sees in the period and the
// next step for today, beside it the rating and its goal; then the form of
// the last games, the position of the day, the weak spots, and the longer
// view (form curve, changes, last games, calendar).
import { useEffect, useMemo, useState } from "preact/hooks";

import { enqueue } from "../app/analysisService";
import { trFilter, trSpeed } from "../domain/i18n";
import { getUserColor, inDateFilter, isBulletGame } from "../domain/metrics";
import { comparePeriods, dailyActivity, focusNotes, type PlayerProfile, trendOf } from "../domain/profile";
import { CATEGORIES, localDay, type ProgressMap, type PuzzleExercise, puzzleOfTheDay } from "../domain/training";
import { Calendar } from "./home/Activity";
import { FocusCard, skillCategory } from "./home/Focus";
import { FormCurveCard } from "./home/FormCurve";
import { FormCard, HomeHero, RatingCard } from "./home/HomeTop";
import { PhoneForm, PhoneToday } from "./home/PhoneHome";
import { Fold } from "./Fold";
import { MoreMenu } from "./MoreMenu";
import { IconBoard, IconFreeBoard, IconPlay, IconSpark, IconUpload } from "./icons";
import { openStage } from "./stage/store";
import { Journey } from "./home/Journey";
import { LeagueTeaser } from "./home/LeagueTeaser";
import { RecentGames } from "./home/Recent";
import { Welcome } from "./home/Welcome";
import { HomeNudge } from "./HomeNudge";
import { Foot } from "./kit";
import { PageHeader } from "./Layout";
import { ChangeBars, type ChangeRow } from "./charts";
import type { Mood } from "./Coach";
import { navigate } from "./router";
import { GuideButton, usePageGuide } from "./stage/PageGuide";
import { PuzzleRunner } from "./training/Runners";
import { loadFullProfile, loadTodayTraining, loadTrainingProgress, recordTrainingResult, type TodayTraining } from "./training/useTraining";
import { Section, type StatSection } from "./StatsLayout";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { useNarrow } from "./useNarrow";
import { useProfile } from "./useProfile";
import { t, locale } from "../i18n";

// One tap for the periods that matter day to day.
const QUICK: [string, string][] = [
  ["Last 7 Days", t("7 Tage")],
  ["Last 30 Days", t("30 Tage")],
  ["Last 90 Days", t("3 Monate")],
  ["Last 365 Days", t("1 Jahr")],
  ["All Time", t("Alles")],
];

// The four cards of the longer view; on phones they fold into this one heading.
const HOME_TRENDS: StatSection = { id: "entwicklung", title: t("Entwicklung"), sub: t("Formkurve, Veränderungen und Kalender"), cards: [] };

const TODAY_LABEL = () => new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });

/** One puzzle from the player's own games per day, solvable right here. */
function DailyPuzzle({ ex, onResult }: { ex: PuzzleExercise | null; onResult: (ex: PuzzleExercise, ok: boolean) => void }) {
  return (
    <section class="card span-7 hm-puzzle">
      <header class="card-head">
        <div>
          <h3>{t("Stellung des Tages")}</h3>
          <p class="card-sub">{t("Aus deinen eigenen Partien · jeden Tag eine neue")}</p>
        </div>
      </header>
      {ex ? (
        <PuzzleRunner
          key={ex.id}
          ex={ex}
          onResult={(ok) => onResult(ex, ok)}
          onNext={() => navigate({ view: "training", tab: "uebungen", category: ex.category })}
          nextLabel={t("Mehr {label} üben", { label: CATEGORIES[ex.category].label })}
        />
      ) : (
        <p class="muted small">
          
          {t("Sobald ein paar Partien analysiert sind, wartet hier jeden Tag eine Stellung, in der du danebengegriffen hast. Findest du diesmal den besten Zug?")}
        </p>
      )}
    </section>
  );
}

export function HomeView() {
  const { profile, comparison, games, usernames, loading, error, filters, setFilters } = useProfile({ page: "home", compare: true });
  const narrow = useNarrow();
  const [today, setToday] = useState<TodayTraining | null>(null);
  const [progress, setProgress] = useState<ProgressMap | null>(null);
  // The rating goal and the daily puzzle look at the whole history, whatever period is picked above.
  const [full, setFull] = useState<PlayerProfile | null>(null);
  usePageGuide("home", Boolean(profile && comparison));

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
  const open = useMemo(
    () => games.filter((g) => getUserColor(g, names) && g.summary_json?.analysis_status !== "completed" && inDateFilter(g, filters.date) && !(skipBullet && isBulletGame(g))).map((g) => g.id),
    [games, usernames, filters.date, skipBullet],
  );
  // Picked once the progress is known, then kept for the visit so solving it
  // (which masters nothing yet) never swaps the board under the player.
  const [puzzleId, setPuzzleId] = useState<string | null>(null);
  const puzzle = useMemo(() => {
    if (!profile || !progress) return null;
    const pool = (full ?? profile).exercises;
    const kept = puzzleId ? pool.find((e): e is PuzzleExercise => e.id === puzzleId && e.kind === "puzzle") : undefined;
    return kept ?? puzzleOfTheDay(pool, progress, localDay());
  }, [profile, full, progress, puzzleId]);
  useEffect(() => {
    if (puzzle && puzzle.id !== puzzleId) setPuzzleId(puzzle.id);
  }, [puzzle]);

  const header = (
    <PageHeader
      class="home-head"
      tabs={false}
      title={
        <span class="home-greeting">
          <span>{names[0] ? t("Hallo {0}!", { 0: names[0] }) : t("Start")}</span>
          <span class="home-date">{TODAY_LABEL()}</span>
        </span>
      }
      toolbar={
        <div class="segmented small-seg" role="group" aria-label={t("Zeitraum")}>
          {QUICK.map(([k, l]) => (
            <button key={k} class={filters.date === k ? "active" : ""} aria-pressed={filters.date === k} title={trFilter(k)} onClick={() => setFilters({ ...filters, date: k })}>
              {l}
            </button>
          ))}
        </div>
      }
      actions={
        profile ? (
          narrow ? (
            <MoreMenu
              label={t("Mehr")}
              items={[
                profile.recent_games[0] && { label: t("Letzte Partie ansehen"), icon: <IconBoard />, onSelect: () => navigate({ view: "analysis", gameId: profile.recent_games[0].game_id }) },
                { label: t("Partien importieren"), icon: <IconUpload />, onSelect: () => navigate({ view: "games", import: true }) },
                { label: t("Analysebrett"), icon: <IconFreeBoard />, onSelect: () => navigate({ view: "board" }) },
                open.length > 0 && { label: t("{0} {1} analysieren", { 0: open.length, 1: open.length === 1 ? t("Partie") : t("Partien") }), icon: <IconPlay />, divider: true, onSelect: () => void enqueue(open) },
                { label: t("Seite erklären"), icon: <IconSpark />, divider: true, onSelect: () => openStage({ kind: "page", subject: "home" }) },
              ]}
            />
          ) : (
            <GuideButton id="home" />
          )
        ) : undefined
      }
    />
  );

  if (usernames && !usernames.length) return <Welcome />;
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-8" style={{ height: "260px" }} />
          <div class="skeleton span-4" style={{ height: "260px" }} />
          <div class="skeleton span-12" style={{ height: "150px" }} />
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
  const vsLabel = comparison.previous ? t("{label} im Vergleich zu davor", { label: comparison.label }) : comparison.label;
  const acc = cmp.kpis.find((k) => k.key === "accuracy");
  const accTrend = acc ? trendOf(acc) : "flat";
  const heroMood: Mood = accTrend === "up" ? "wow" : accTrend === "down" ? "think" : "happy";
  const heroTitle =
    notes[0] ??
    (today?.streak ? (today.streak === 1 ? t("Deine Trainingsserie läuft, bleib dran!") : t("Stark, {streak} Tage in Folge trainiert! Weiter so.", { streak: today.streak })) : t("Schön, dass du da bist{0}!", { 0: names[0] ? `, ${names[0]}` : "" }));
  const heroSub =
    notes.length > 1
      ? notes.slice(1, 3).join(" ")
      : notes.length === 0
        ? comparison.current.total_games
          ? t("Noch keine deutlichen Veränderungen. Mit mehr analysierten Partien kann ich dir genauer sagen, wohin die Reise geht.")
          : t("In diesem Zeitraum hast du noch keine Partie gespielt. Spiel ein paar Partien und lade sie hoch, dann schaue ich sie mir an.")
        : undefined;
  const lastGame = profile.recent_games[0];
  const topWeakness = (full ?? comparison.current).weaknesses[0];
  const leverCat = topWeakness ? skillCategory(topWeakness.key, (full ?? comparison.current).exercises) : undefined;
  const lever = topWeakness ? { title: topWeakness.title, go: () => navigate(leverCat ? { view: "training", tab: "uebungen", category: leverCat } : { view: "training" }) } : null;

  const changeRows: ChangeRow[] = cmp.skills.map((s) => ({ label: s.name, delta: s.delta, valueText: String(Math.round(s.score)), faint: !s.reliable }));
  const changesCard = (
    <section class="card span-5 hm-changes">
      <header class="card-head">
        <div>
          <h3>{t("Was sich verändert hat")}</h3>
          <p class="card-sub">{t("Deine Fähigkeiten · {n}", { n: comparison.previous ? t("gegenüber dem Zeitraum davor") : t("kein Vergleichszeitraum") })}</p>
        </div>
      </header>
      {changeRows.length ? (
        <>
          <ChangeBars rows={changeRows} threshold={5} />
          <Foot>{t("Farbig ab 5 Punkten Veränderung. Dahinter der aktuelle Wert von 0 bis 100. Blass: noch wenige Daten.")}</Foot>
        </>
      ) : (
        <p class="muted small">{t("Noch keine analysierten Partien in diesem Zeitraum.")}</p>
      )}
    </section>
  );
  const curveCard = <FormCurveCard profile={profile} period={acc} label={comparison.label} class="span-7" />;
  const recentCard = (
    <section class="card span-7 hm-recent">
      <header class="card-head">
        <div>
          <h3>{t("Letzte Partien")}</h3>
          <p class="card-sub">{t("Antippen öffnet die Partie mit Bericht")}</p>
        </div>
        <button class="btn small" onClick={() => navigate({ view: "games" })}>
          
          {t("Alle Partien")}
        </button>
      </header>
      <RecentGames profile={profile} limit={8} />
    </section>
  );
  const activityCard = (
    <section class="card span-5 hm-activity">
      <header class="card-head">
        <div>
          <h3>{t("Dein Kalender")}</h3>
          <p class="card-sub">{t("Partien pro Tag, diese Woche ganz unten")}</p>
        </div>
      </header>
      <Calendar daily={daily} today={localDay()} />
    </section>
  );

  if (narrow) {
    const seriesFull = full?.rating ? (((full.trends.ratings ?? {}) as Record<string, [number, number][]>)[trSpeed(full.rating.speed)] ?? []) : [];
    return (
      <div class="home phone-home" style={{ opacity: loading ? 0.6 : 1 }}>
        {header}
        <HomeNudge games={games.length} />
        <div class="ph-stack">
          <PhoneToday mood={heroMood} title={heroTitle} today={today} />
          <PhoneForm profile={profile} kpis={cmp.kpis} ratingKpi={cmp.kpis.find((k) => k.key === "rating")} label={comparison.label} />
          <section class="card ph-recent">
            <header class="ph-recent-head">
              <h3>{t("Letzte Partien")}</h3>
              <button class="btn small ghost" onClick={() => navigate({ view: "games" })}>
                {t("Alle")}
              </button>
            </header>
            <RecentGames profile={profile} limit={4} />
          </section>
          {full?.rating && seriesFull.length >= 2 && (
            <Fold title={t("Dein Ziel")} sub={`${full.rating.rating} · ${trSpeed(full.rating.speed)}`}>
              <div class="card">
                <Journey series={seriesFull} speed={trSpeed(full.rating.speed)} lever={lever} />
              </div>
            </Fold>
          )}
          <Fold title={t("Stellung des Tages")} sub={t("Aus deinen Partien")}>
            <DailyPuzzle ex={puzzle} onResult={(ex, ok) => void recordTrainingResult(ex, ok).then(refreshToday)} />
          </Fold>
          <Fold title={t("Deine Baustellen")} sub={topWeakness ? topWeakness.title : undefined}>
            <FocusCard current={comparison.current} cmp={cmp} label={comparison.label} />
          </Fold>
          <Fold title={t("Liga")} sub={t("Du gegen deine Freunde")}>
            <LeagueTeaser games={games} me={names} />
          </Fold>
          <Fold title={t("Entwicklung")} sub={t("Formkurve, Veränderungen, Kalender")}>
            <div class="ph-stack">
              {curveCard}
              {changesCard}
              {activityCard}
            </div>
          </Fold>
        </div>
      </div>
    );
  }

  return (
    <div class="home" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <HomeNudge games={games.length} />
      <div class="dash hm">
        <HomeHero
          mood={heroMood}
          kicker={vsLabel}
          title={heroTitle}
          sub={heroSub}
          today={today}
          open={open.length}
          onAnalyse={() => void enqueue(open)}
          lastGame={lastGame ? { id: lastGame.game_id, opponent: lastGame.opponent } : null}
        />
        <RatingCard profile={profile} full={full} ratingKpi={cmp.kpis.find((k) => k.key === "rating")} accuracy={acc} period={comparison.label} lever={lever} />
        <FormCard profile={profile} kpis={cmp.kpis} label={comparison.label} />
        <LeagueTeaser games={games} me={names} />
        <DailyPuzzle ex={puzzle} onResult={(ex, ok) => void recordTrainingResult(ex, ok).then(refreshToday)} />
        <FocusCard current={comparison.current} cmp={cmp} label={comparison.label} />
        {narrow ? (
          // Phones: the games come first, the longer view folds into one section.
          <>
            {recentCard}
            <Section section={HOME_TRENDS} phoneOnly>
              {curveCard}
              {changesCard}
              {activityCard}
            </Section>
          </>
        ) : (
          <>
            {curveCard}
            {changesCard}
            {recentCard}
            {activityCard}
          </>
        )}
      </div>
    </div>
  );
}
