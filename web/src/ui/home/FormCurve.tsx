// The weekly form curve: accuracy per week as a line against what is usual
// at the player's strength, with three figures under it.
import { formSummary, type KpiChange, type PlayerProfile, typicalLabel } from "../../domain/profile";
import { monthStart } from "../charts";
import { formatDate } from "../labels";
import { Stat } from "../viz/Bars";
import { Delta } from "../viz/Range";
import { TrendChart, type TrendPoint } from "../viz/TrendChart";
import { t, dec } from "../../i18n";

const de1 = (v: number) => v.toFixed(1).replace(".", dec());

export interface WeekRow {
  week: string;
  games: number;
  avg_accuracy: number | null;
  score_pct: number;
}

/**
 * Figures under a weekly form curve. With `period` (the page's accuracy
 * comparison) the first figure repeats exactly what the page headline says,
 * so the card never contradicts it; without, it compares four-week windows.
 */
export function FormStats({ weekly, period }: { weekly: { week: string; avg_accuracy: number | null }[]; period?: KpiChange | null }) {
  const f = formSummary(weekly);
  if (f.weeks < 2) return null;
  const shown = period && period.value !== null ? { label: t("Im Zeitraum"), value: period.value, diff: period.delta, vs: t("zum Zeitraum davor") } : null;
  const recent = shown ?? { label: t("Letzte 4 Wochen"), value: f.recent, diff: f.recent !== null && f.previous !== null ? f.recent - f.previous : null, vs: t("zu den 4 Wochen davor") };
  const trend = f.trend_per_month;
  return (
    <div class="stat-row three">
      <Stat
        label={recent.label}
        value={recent.value !== null ? `${de1(recent.value)} %` : "–"}
        sub={
          recent.diff !== null ? (
            <>
              <Delta value={Number(recent.diff.toFixed(1))} /> {recent.vs}
            </>
          ) : undefined
        }
      />
      <Stat
        label={shown ? t("Richtung im Zeitraum") : t("Richtung")}
        value={trend === null ? "–" : trend >= 1 ? "steigend" : trend <= -1 ? "fallend" : "stabil"}
        tone={trend === null ? undefined : trend >= 1 ? "good" : trend <= -1 ? "bad" : undefined}
        sub={trend !== null ? t("{0}{de1} Punkte pro Monat", { 0: trend >= 0 ? "+" : "−", de1: de1(Math.abs(trend)) }) : undefined}
      />
      <Stat label={t("Beste Woche")} value={f.best ? `${de1(f.best.accuracy)} %` : "–"} sub={f.best ? `ab ${formatDate(f.best.week.replace(/-/g, "."))}` : undefined} />
    </div>
  );
}

export function weekPoints(weekly: WeekRow[]): TrendPoint[] {
  return weekly
    .filter((w) => w.avg_accuracy !== null)
    .map((w) => ({
      t: monthStart(w.week) ?? 0,
      value: w.avg_accuracy as number,
      label: t("Woche ab {formatDate}", { formatDate: formatDate(w.week.replace(/-/g, ".")) }),
      detail: t("{games} {1} · {2} % Punkte", { games: w.games, 1: w.games === 1 ? t("Partie") : t("Partien"), 2: Math.round(w.score_pct) }),
      weight: w.games,
    }));
}

export function FormCurveCard({ profile, period, label, class: cls = "span-6" }: { profile: PlayerProfile; period?: KpiChange | null; label: string; class?: string }) {
  const weekly = (profile.trends.weekly ?? []) as WeekRow[];
  const points = weekPoints(weekly);
  return (
    <section class={`card ${cls} hm-curve`}>
      <header class="card-head">
        <div>
          <h3>{t("Formkurve")}</h3>
          <p class="card-sub">{t("Deine Genauigkeit pro Woche · {label}", { label })}</p>
        </div>
      </header>
      {points.length >= 2 ? (
        <>
          <TrendChart
            points={points}
            format={(v) => v.toFixed(0)}
            height={200}
            dots={points.length <= 12}
            bounds={{ lo: 0, hi: 100, minSpan: 15 }}
            reference={profile.rating ? { value: profile.rating.typical_accuracy, label: typicalLabel(profile.rating) } : null}
            label={t("Genauigkeit pro Woche")}
          />
          <FormStats weekly={weekly} period={period} />
        </>
      ) : (
        <p class="muted small">{t("Für eine Kurve braucht es analysierte Partien aus mindestens zwei Wochen in diesem Zeitraum.")}</p>
      )}
    </section>
  );
}
