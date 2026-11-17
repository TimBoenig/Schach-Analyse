// The top of the start page: Lucena's one sentence about the period and the
// next step for today on the left, the rating with its goal on the right,
// and the form of the last games across the full width below.
import type { ComponentChildren } from "preact";

import { trSpeed } from "../../domain/i18n";
import { type KpiChange, type PlayerProfile, trendOf } from "../../domain/profile";
import { Ring } from "../charts";
import { CoachAvatar, COACH_NAME, type Mood } from "../Coach";
import { IconBoard, IconFreeBoard, IconPlay, IconUpload } from "../icons";
import { CountUp, ResultRibbon } from "../kit";
import { formatDate, streakText } from "../labels";
import { navigate } from "../router";
import type { TodayTraining } from "../training/useTraining";
import { Stat } from "../viz/Bars";
import { Delta } from "../viz/Range";
import { Journey } from "./Journey";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

export function HomeHero({
  mood,
  kicker,
  title,
  sub,
  today,
  open,
  onAnalyse,
  lastGame,
}: {
  mood: Mood;
  kicker: string;
  title: string;
  sub?: string;
  today: TodayTraining | null;
  open: number;
  onAnalyse: () => void;
  lastGame: { id: string; opponent: string } | null;
}) {
  const planned = today?.planned ?? 0;
  const done = today?.done ?? 0;
  const finished = planned > 0 && done >= planned;
  return (
    <section class="card span-8 hm-hero">
      <div class="hm-kicker">
        <CoachAvatar size={36} mood={mood} />
        <span class="eyebrow">
          {COACH_NAME} · {kicker}
        </span>
      </div>
      <h2 class="hm-title">{title}</h2>
      {sub && <p class="hm-sub">{sub}</p>}
      <div class="hm-today">
        <Ring value={done} total={planned || 1} size={56} thickness={6}>
          <strong class="tnum">{planned ? `${done}/${planned}` : done}</strong>
        </Ring>
        <div class="hm-today-text">
          <span class="eyebrow">Heute</span>
          <strong>{planned ? (finished ? "Einheit geschafft" : `${planned - done} Aufgaben offen`) : done ? `${done} Aufgaben gelöst` : "Noch nicht trainiert"}</strong>
          <span class="small muted">
            {today?.streak ? `${today.streak} ${today.streak === 1 ? "Tag" : "Tage"} in Folge` : "Starte heute eine Serie"}
            {today?.week.done ? ` · diese Woche ${today.week.correct} von ${today.week.done} richtig` : ""}
          </span>
        </div>
        <div class="hm-today-actions">
          <button class="btn primary" onClick={() => navigate({ view: "training" })}>
            <IconPlay /> {finished ? "Weiter üben" : "Einheit starten"}
          </button>
          {open > 0 && (
            <button class="btn" onClick={onAnalyse}>
              {open} {open === 1 ? "Partie" : "Partien"} analysieren
            </button>
          )}
        </div>
      </div>
      <div class="hm-links">
        <button class="link-chip" onClick={() => navigate(lastGame ? { view: "analysis", gameId: lastGame.id } : { view: "games" })}>
          <IconBoard /> {lastGame ? `Letzte Partie gegen ${lastGame.opponent}` : "Partien"}
        </button>
        <button class="link-chip" onClick={() => navigate({ view: "games", import: true })}>
          <IconUpload /> Importieren
        </button>
        <button class="link-chip" onClick={() => navigate({ view: "board" })}>
          <IconFreeBoard /> Analysebrett
        </button>
      </div>
    </section>
  );
}

/** The rating of the main time control, its change in the period and the way to the next goal. */
export function RatingCard({
  profile,
  full,
  ratingKpi,
  accuracy,
  period,
  lever,
}: {
  profile: PlayerProfile;
  full: PlayerProfile | null;
  ratingKpi: KpiChange | undefined;
  accuracy: KpiChange | undefined;
  period: string;
  lever: { title: string; go: () => void } | null;
}) {
  const rc = profile.rating;
  const fullRc = full?.rating ?? null;
  const series = fullRc ? (((full?.trends.ratings ?? {}) as Record<string, [number, number][]>)[trSpeed(fullRc.speed)] ?? []) : [];
  let figure: ComponentChildren;
  if (rc) {
    figure = (
      <>
        <span class="eyebrow">Wertung · {trSpeed(rc.speed)}</span>
        <div class="hm-rating-num">
          <strong class="tnum">
            <CountUp value={rc.rating} />
          </strong>
          {ratingKpi?.delta !== null && ratingKpi?.delta !== undefined && <Delta value={Math.round(ratingKpi.delta)} />}
          <span class="faint small">{period}</span>
        </div>
      </>
    );
  } else if (accuracy?.value != null) {
    figure = (
      <>
        <span class="eyebrow">Genauigkeit</span>
        <div class="hm-rating-num">
          <strong class="tnum">
            <CountUp value={accuracy.value} format={(v) => de(v)} />
          </strong>
          <span class="faint small">{period}</span>
        </div>
      </>
    );
  } else return null;
  return (
    <section class="card span-4 hm-rating">
      <button class="hm-rating-top" onClick={() => navigate({ view: "profile" })} title="Zu deinem Profil">
        {figure}
      </button>
      {series.length >= 2 && fullRc ? (
        <Journey series={series} speed={trSpeed(fullRc.speed)} lever={lever} />
      ) : (
        <p class="small muted">Sobald ein paar gewertete Partien da sind, zeige ich dir hier den Weg zu deinem nächsten Ziel.</p>
      )}
    </section>
  );
}

const RESULT_WORD = (score: number | null) => (score === 1 ? "Sieg" : score === 0 ? "Niederlage" : score === null ? "offen" : "Remis");

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

const deltaDigits = (k: KpiChange) => (k.key === "blunders" ? 2 : k.key === "accuracy" ? 1 : 0);

/** The change rounded the way the figure is shown, so "+0,0" never appears. */
function deltaText(k: KpiChange): { text: string; zero: boolean } {
  const d = Number((k.delta ?? 0).toFixed(deltaDigits(k)));
  return { text: d === 0 ? "±0" : `${d > 0 ? "+" : "−"}${de(Math.abs(d), deltaDigits(k))}`, zero: d === 0 };
}

/** The last results as tiles and the period's key figures, each with its change. */
export function FormCard({ profile, kpis: all, label }: { profile: PlayerProfile; kpis: KpiChange[]; label: string }) {
  const last = profile.recent_games.slice(0, 14);
  // The rating has its own card beside the hero.
  const kpis = all.filter((k) => k.key !== "rating");
  const streak = streakText(last.map((g) => g.score));
  return (
    <section class="card span-12 hm-form">
      <header class="card-head">
        <div>
          <h3>Deine Form</h3>
          <p class="card-sub">
            {last.length === 1 ? "Letzte Partie" : `Letzte ${last.length} Partien`}
            {streak ? ` · ${streak}` : ""} · Kennzahlen {label}, jeweils gegenüber dem Zeitraum davor
          </p>
        </div>
        {last.length > 0 && (
          <ResultRibbon
            games={[...last].reverse().map((g) => ({ id: g.game_id, score: g.score, title: `${formatDate(g.date)} gegen ${g.opponent}: ${RESULT_WORD(g.score)}` }))}
            onPick={(id) => navigate({ view: "analysis", gameId: id })}
          />
        )}
      </header>
      <div class="stat-row many" style={{ "--cols": kpis.length }} aria-label={`Kennzahlen ${label}`}>
        {kpis.map((k) => {
          const t = trendOf(k);
          const d = deltaText(k);
          // A falling blunder rate is the good direction, so the chip follows the verdict, not the sign.
          const tone = k.key === "games" || t === "flat" ? "" : t === "up" ? " up" : " down";
          return (
            <Stat
              key={k.key}
              label={k.label}
              value={k.value !== null ? <CountUp value={k.value} format={kpiFormat(k)} /> : "–"}
              sub={
                k.delta !== null ? (
                  <>
                    <span class={`delta${d.zero ? "" : tone}`}>{d.text}</span> vorher{" "}
                    {k.previous === null ? "–" : kpiFormat(k)(k.previous)}
                  </>
                ) : (
                  "kein Vergleich"
                )
              }
            />
          );
        })}
      </div>
    </section>
  );
}
