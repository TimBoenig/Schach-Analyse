// The start page on a phone: today's step and the form in two compact cards,
// the last games, and everything longer behind one-line folds.
import { trSpeed } from "../../domain/i18n";
import { t } from "../../i18n";
import { type KpiChange, type PlayerProfile, trendOf } from "../../domain/profile";
import { Ring } from "../charts";
import { COACH_NAME, CoachAvatar, type Mood } from "../Coach";
import { IconPlay } from "../icons";
import { CountUp, ResultRibbon } from "../kit";
import { formatDate, streakText } from "../labels";
import { navigate } from "../router";
import type { TodayTraining } from "../training/useTraining";
import { Delta } from "../viz/Range";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const RESULT_WORD = (score: number | null) => (score === 1 ? "Sieg" : score === 0 ? "Niederlage" : score === null ? "offen" : "Remis");

/** Today's training and Lucena's one sentence, on one card. */
export function PhoneToday({ mood, title, today }: { mood: Mood; title: string; today: TodayTraining | null }) {
  const planned = today?.planned ?? 0;
  const done = today?.done ?? 0;
  const finished = planned > 0 && done >= planned;
  const line = planned ? (finished ? t("Einheit geschafft") : t("{0} Aufgaben offen", { 0: planned - done })) : done ? t("{0} Aufgaben gelöst", { 0: done }) : t("Noch nicht trainiert");
  return (
    <section class="card ph-today">
      <div class="ph-today-say">
        <CoachAvatar size={28} mood={mood} />
        <p>
          <span class="eyebrow">{COACH_NAME}</span>
          {title}
        </p>
      </div>
      <div class="ph-today-row">
        <Ring value={done} total={planned || 1} size={46} thickness={5}>
          <strong class="tnum">{planned ? `${done}/${planned}` : done}</strong>
        </Ring>
        <div class="ph-today-text">
          <strong>{line}</strong>
          <small>{today?.streak ? t("{0} {1} in Folge", { 0: today.streak, 1: today.streak === 1 ? t("Tag") : t("Tage") }) : t("Starte heute eine Serie")}</small>
        </div>
        <button class="btn primary" onClick={() => navigate({ view: "training" })}>
          <IconPlay /> {finished ? "Weiter" : "Starten"}
        </button>
      </div>
    </section>
  );
}

const fmt = (k: KpiChange): string => {
  if (k.value === null) return "–";
  switch (k.key) {
    case "games":
      return String(Math.round(k.value));
    case "blunders":
      return de(k.value, 2);
    case "accuracy":
      return de(k.value, 1);
    default:
      return `${Math.round(k.value)} %`;
  }
};

/** Rating, the last results and the period's key figures in one block. */
export function PhoneForm({ profile, kpis, ratingKpi, label }: { profile: PlayerProfile; kpis: KpiChange[]; ratingKpi: KpiChange | undefined; label: string }) {
  const rc = profile.rating;
  const last = profile.recent_games.slice(0, 14);
  const streak = streakText(last.map((g) => g.score));
  const rows = kpis.filter((k) => k.key !== "rating").slice(0, 4);
  return (
    <section class="card ph-form">
      <div class="ph-form-top">
        {rc && (
          <button class="ph-rating" onClick={() => navigate({ view: "profile" })}>
            <span class="eyebrow">{t("Wertung ·")} {trSpeed(rc.speed)}</span>
            <span class="ph-rating-num">
              <strong class="tnum">
                <CountUp value={rc.rating} />
              </strong>
              {ratingKpi?.delta != null && <Delta value={Math.round(ratingKpi.delta)} />}
            </span>
          </button>
        )}
        <div class="ph-ribbon">
          <span class="eyebrow">{t("Form")}{streak ? ` · ${streak}` : ""}</span>
          {last.length > 0 && (
            <ResultRibbon
              games={[...last].reverse().map((g) => ({ id: g.game_id, score: g.score, title: t("{0} gegen {1}: {2}", { 0: formatDate(g.date), 1: g.opponent, 2: RESULT_WORD(g.score) }) }))}
              onPick={(id) => navigate({ view: "analysis", gameId: id })}
            />
          )}
        </div>
      </div>
      <div class="ph-kpis" aria-label={t("Kennzahlen {0}", { 0: label })}>
        {rows.map((k) => {
          const t = trendOf(k);
          const tone = k.key === "games" || t === "flat" ? "" : t === "up" ? " up" : " down";
          return (
            <div key={k.key} class="ph-kpi">
              <span>{k.label}</span>
              <b class="tnum">{fmt(k)}</b>
              {k.delta !== null && <small class={`delta${tone}`}>{k.delta === 0 ? "±0" : `${k.delta > 0 ? "+" : "−"}${de(Math.abs(k.delta), k.key === "blunders" ? 2 : k.key === "accuracy" ? 1 : 0)}`}</small>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
