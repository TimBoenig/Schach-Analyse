// "Dein Weg": the rating as a track from where it started to the next goal,
// with the best rating so far, the pace of the last weeks and a goal the
// player sets themselves.
import { useEffect, useMemo, useState } from "preact/hooks";

import { nextMilestone, PACE_DAYS, ratingJourney } from "../../domain/profile";
import { getSetting, setSetting } from "../../storage/db";
import { IconCrown, IconPlay, IconReset, IconTrophy } from "../icons";
import { ScaleTrack, type TrackMarker } from "../kit";

export const GOAL_KEY = "goal.rating";
const GOAL_STEP = 50;
// Round numbers the track's ticks may step in, smallest that keeps them readable.
const TICK_STEPS = [25, 50, 100, 200, 400];
const MAX_TICKS = 7;

const de1 = (v: number) => v.toFixed(1).replace(".", ",");

function etaText(days: number): string {
  if (days < 21) return `${Math.max(1, Math.round(days / 7))} ${Math.round(days / 7) <= 1 ? "Woche" : "Wochen"}`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "Monat" : "Monaten"}`;
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

  const lo = Math.min(j.start, j.current);
  const step = TICK_STEPS.find((s) => (j.goal - lo) / s <= MAX_TICKS - 2) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const min = Math.floor((lo - step / 2) / step) * step;
  const max = Math.ceil((Math.max(j.goal, j.peak) + step / 2) / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max; t += step) ticks.push(t);

  const markers: TrackMarker[] = [
    { id: "start", label: "Start", value: j.start, tone: "tone-quiet", mark: <IconPlay />, title: "Deine erste Wertung in dieser Bedenkzeit" },
    ...(j.peak > j.current ? [{ id: "peak", label: "Bestwert", value: j.peak, tone: "tone-b", mark: <IconCrown />, title: "Deine höchste Wertung bisher" }] : []),
    { id: "goal", label: "Ziel", value: j.goal, tone: j.reached ? "tone-win" : "tone-d", mark: <IconTrophy />, title: "Dein Ziel" },
    { id: "me", label: "Du", value: j.current, tone: "tone-me", me: true },
  ];

  const left = j.goal - j.current;
  const pace = j.per_month;
  return (
    <div class="ar-block journey">
      <div class="ar-block-head">
        <strong>Dein Weg zu {j.goal}</strong>
        <span class="faint small">Wertung {speed}</span>
      </div>
      <ScaleTrack markers={markers} min={min} max={max} ticks={ticks} />
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
                <>
                  In den letzten {PACE_DAYS} Tagen ging es um <span class="pos tnum">+{de1(pace)}</span> pro Monat nach oben. Bei dem Tempo bist du in etwa{" "}
                  <strong>{etaText(j.eta_days)}</strong> da.
                </>
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
