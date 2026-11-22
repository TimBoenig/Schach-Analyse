// "Dein Weg": the rating as a track from where it started to the next goal,
// with the best rating so far, the pace of the last weeks and a goal the
// player sets themselves.
import { useEffect, useMemo, useState } from "preact/hooks";

import { nextMilestone, PACE_DAYS, ratingJourney } from "../../domain/profile";
import { getSetting, setSetting } from "../../storage/db";
import { IconPlay, IconReset, IconTrophy } from "../icons";
import { t, tj, dec } from "../../i18n";

export const GOAL_KEY = "goal.rating";
const GOAL_STEP = 50;

const de1 = (v: number) => v.toFixed(1).replace(".", dec());

function etaText(days: number): string {
  if (days < 21) return `${Math.max(1, Math.round(days / 7))} ${Math.round(days / 7) <= 1 ? t("Woche") : t("Wochen")}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? t("Monat") : t("Monaten")}`;
}

/**
 * The journey as one line, like a progress bar: the accent colour from the first rating up
 * to today, the goal at the far end with the only symbol on it. Start, best
 * and goal are plain dots, so no marker speaks a different visual language.
 */
function JourneyBar({ start, current, peak, goal }: { start: number; current: number; peak: number; goal: number }) {
  const lo = Math.min(start, current);
  const hi = Math.max(goal, peak, current);
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  return (
    <div class="journey-bar" role="img" aria-label={t("Start {start}, jetzt {current}, Bestwert {peak}, Ziel {goal}", { start, current, peak, goal })}>
      <div class="journey-bar-track">
        <span class="journey-bar-fill" style={{ width: pct(current) }} />
        <span class="journey-bar-start" />
        {peak > current && <span class="journey-bar-peak" style={{ left: pct(peak) }} />}
        <span class="journey-bar-goal" style={{ left: pct(goal) }}>
          <IconTrophy />
        </span>
        <span class="journey-bar-me" style={{ left: pct(current) }}>
          <span class="journey-bar-flag tnum">{current}</span>
        </span>
      </div>
      <div class="journey-bar-labels">
        <span>
          
          {tj("Start {start}", { start: <strong class="tnum">{start}</strong> })}
        </span>
        {peak > current && (
          <span class="journey-bar-now">
            
            {tj("Bestwert {peak}", { peak: <strong class="tnum">{peak}</strong> })}
          </span>
        )}
        <span>
          
          {tj("Ziel {goal}", { goal: <strong class="tnum">{goal}</strong> })}
        </span>
      </div>
    </div>
  );
}

export function Journey({ series, speed, lever }: { series: [number, number][]; speed: string; lever?: { title: string; go: () => void } | null }) {
  // Stored per time control, so a blitz goal is not held against the rapid rating.
  const [goals, setGoals] = useState<Record<string, number>>({});
  useEffect(() => {
    void getSetting<Record<string, number>>(GOAL_KEY, {}).then((g) => setGoals(g && typeof g === "object" ? g : {}));
  }, []);
  const own = goals[speed] ?? null;
  const j = useMemo(() => ratingJourney(series, own), [series, own]);
  if (!j) return null;

  const setGoal = (value: number | null) => {
    const next = { ...goals };
    if (value === null) delete next[speed];
    else next[speed] = value;
    setGoals(next);
    void setSetting(GOAL_KEY, next);
  };

  const left = j.goal - j.current;
  const pace = j.per_month;
  return (
    <div class="hm-journey">
      <div class="hm-journey-head">
        <span class="eyebrow">{t("Dein Ziel")}</span>
        <div class="journey-goal" role="group" aria-label={t("Ziel ändern")}>
          <button class="btn icon small ghost" aria-label={t("Ziel {GOAL_STEP} Punkte niedriger", { GOAL_STEP })} disabled={j.goal - GOAL_STEP <= j.current && !j.reached} onClick={() => setGoal(j.goal - GOAL_STEP)}>
            −
          </button>
          <strong class="tnum">{j.goal}</strong>
          <button class="btn icon small ghost" aria-label={t("Ziel {GOAL_STEP} Punkte höher", { GOAL_STEP })} onClick={() => setGoal(j.goal + GOAL_STEP)}>
            +
          </button>
          {own !== null && own !== nextMilestone(j.current) && (
            <button class="btn ghost small" onClick={() => setGoal(null)} title={t("Wieder das nächste runde Ziel vorschlagen")}>
              <IconReset /> Auto
            </button>
          )}
        </div>
      </div>
      <JourneyBar start={j.start} current={j.current} peak={j.peak} goal={j.goal} />
      <p class="hm-journey-text" role="status">
        {j.reached ? (
          <>
            {tj("{x} Du stehst bei {current}. Zeit für das nächste.", { x: <strong>{t("Ziel erreicht!")}</strong>, current: j.current })}
          </>
        ) : (
          <>
            
            {tj("Noch {x} bis {goal}.", { x: <strong class="tnum">{t("{left} Punkte", { left })}</strong>, goal: j.goal })}{" "}
            {j.eta_days !== null && pace !== null ? (
              <>
                
                {tj("Zuletzt {x} pro Monat ({speed}, letzte {PACE_DAYS} Tage). Bei dem Tempo in etwa {etaText}.", { x: <span class="good tnum">+{de1(pace)}</span>, speed, PACE_DAYS, etaText: <strong>{etaText(j.eta_days)}</strong> })}</>
            ) : pace !== null ? (
              <>
                
                {tj("Deine Wertung {n} ({x} pro Monat).", { n: pace <= -3 ? t("fällt gerade") : t("bewegt sich gerade kaum"), x: <span class={pace <= -3 ? "bad tnum" : "tnum"}>{pace >= 0 ? "+" : "−"}{de1(Math.abs(pace))}</span> })}
              </>
            ) : (
              t("Für ein Tempo brauche ich ein paar gewertete Partien aus den letzten Wochen.")
            )}
          </>
        )}
      </p>
      {lever && !j.reached && (
        <button class="btn small hm-lever" onClick={lever.go}>
          <IconPlay />  {t("Größter Hebel: {title}", { title: lever.title })}
        </button>
      )}
    </div>
  );
}
