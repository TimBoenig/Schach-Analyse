// "Dein Weg": the rating as a track from where it started to the next goal,
// with the best rating so far, the pace of the last weeks and a goal the
// player sets themselves.
import { useEffect, useMemo, useState } from "preact/hooks";

import { nextMilestone, PACE_DAYS, ratingJourney } from "../../domain/profile";
import { getSetting, setSetting } from "../../storage/db";
import { IconPlay, IconReset, IconTrophy } from "../icons";

export const GOAL_KEY = "goal.rating";
const GOAL_STEP = 50;

const de1 = (v: number) => v.toFixed(1).replace(".", ",");

function etaText(days: number): string {
  if (days < 21) return `${Math.max(1, Math.round(days / 7))} ${Math.round(days / 7) <= 1 ? "Woche" : "Wochen"}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "Monat" : "Monaten"}`;
}

/**
 * The journey as one line, like a progress bar: gold from the first rating up
 * to today, the goal at the far end with the only symbol on it. Start, best
 * and goal are plain dots, so no marker speaks a different visual language.
 */
function JourneyBar({ start, current, peak, goal }: { start: number; current: number; peak: number; goal: number }) {
  const lo = Math.min(start, current);
  const hi = Math.max(goal, peak, current);
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  return (
    <div class="journey-bar" role="img" aria-label={`Start ${start}, jetzt ${current}, Bestwert ${peak}, Ziel ${goal}`}>
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
          Start <strong class="tnum">{start}</strong>
        </span>
        {peak > current && (
          <span class="journey-bar-now">
            Bestwert <strong class="tnum">{peak}</strong>
          </span>
        )}
        <span>
          Ziel <strong class="tnum">{goal}</strong>
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
    <div class="ar-block journey">
      <div class="ar-block-head">
        <strong>Dein Weg zu {j.goal}</strong>
        <span class="faint small">Wertung {speed}</span>
      </div>
      <JourneyBar start={j.start} current={j.current} peak={j.peak} goal={j.goal} />
      <div class={`ar-answer${j.reached ? " on" : ""}`} role="status">
        <p>
          {j.reached ? (
            <>
              <strong>Ziel erreicht!</strong> Du stehst bei {j.current}. Zeit für das nächste.
            </>
          ) : (
            <>
              Noch <strong class="tnum">{left} Punkte</strong> bis {j.goal}.{" "}
              {j.eta_days !== null && pace !== null ? (
                <span class="journey-pace">
                  In den letzten {PACE_DAYS} Tagen ging es um <span class="pos tnum">+{de1(pace)}</span> pro Monat nach oben. Bei dem Tempo bist du in etwa{" "}
                  <strong>{etaText(j.eta_days)}</strong> da.
                </span>
              ) : pace !== null ? (
                <>
                  Deine Wertung {pace <= -3 ? "fällt gerade" : "bewegt sich gerade kaum"} (<span class={pace <= -3 ? "neg tnum" : "tnum"}>{pace >= 0 ? "+" : "−"}{de1(Math.abs(pace))}</span> pro Monat).
                  {lever ? ` Dein größter Hebel: ${lever.title}.` : ""}
                </>
              ) : (
                "Für ein Tempo brauche ich ein paar gewertete Partien aus den letzten Wochen."
              )}
            </>
          )}
        </p>
        <div class="journey-goal" role="group" aria-label="Ziel ändern">
          <button class="btn icon small" aria-label={`Ziel ${GOAL_STEP} Punkte niedriger`} disabled={j.goal - GOAL_STEP <= j.current && !j.reached} onClick={() => setGoal(j.goal - GOAL_STEP)}>
            −
          </button>
          <span class="tnum">
            Ziel <strong>{j.goal}</strong>
          </span>
          <button class="btn icon small" aria-label={`Ziel ${GOAL_STEP} Punkte höher`} onClick={() => setGoal(j.goal + GOAL_STEP)}>
            +
          </button>
          {own !== null && own !== nextMilestone(j.current) && (
            <button class="btn ghost small" onClick={() => setGoal(null)} title="Wieder das nächste runde Ziel vorschlagen">
              <IconReset /> Auto
            </button>
          )}
          {lever && !j.reached && (
            <button class="btn small" onClick={lever.go}>
              <IconPlay /> Daran arbeiten
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
