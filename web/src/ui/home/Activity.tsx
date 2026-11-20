// Activity as a real calendar: one row per week (Monday first, newest at the
// bottom), the day number in each cell and the month at its first day, so
// "when was that" can be read off directly. The fill says how much was
// played, a small dot how it went. Tapping a day names its games.
import { useMemo, useState } from "preact/hooks";

import { activityCalendar, type CalendarDay, type DailyRow } from "../../domain/profile";
import { Foot } from "../kit";
import { t, tj } from "../../i18n";

const CAL_SPANS = [4, 8, 16] as const;
const CAL_WEEKDAYS = [t("Mo"), t("Di"), t("Mi"), t("Do"), t("Fr"), t("Sa"), t("So")];
const CAL_MONTHS = [t("Jan"), t("Feb"), t("Mär"), t("Apr"), t("Mai"), t("Jun"), t("Jul"), t("Aug"), t("Sep"), t("Okt"), t("Nov"), t("Dez")];
const calLevel = (n: number) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

function dayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" });
}

function dayText(d: CalendarDay): string {
  if (!d.games) return t("{dayLong}: keine Partie", { dayLong: dayLong(d.day) });
  const wdl = [d.wins && `${d.wins} S`, d.draws && `${d.draws} R`, d.losses && `${d.losses} N`].filter(Boolean).join(" · ");
  return `${dayLong(d.day)}: ${d.games} ${d.games === 1 ? t("Partie") : t("Partien")}${wdl ? ` (${wdl})` : ""}${d.score_pct !== null ? t(", {0} % Punkte", { 0: Math.round(d.score_pct) }) : ""}`;
}

/** `daily` is the full history; the span switch cuts the last 4, 8 or 16 weeks. */
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
    <div class={`cal cal-w${weeks}`}>
      <div class="cal-top">
        <p class="cal-total">
          {tj("{total} {n} an {active} von {length} Tagen", { total: <strong class="tnum">{total}</strong>, n: total === 1 ? t("Partie") : t("Partien"), active: <strong class="tnum">{active}</strong>, length: flat.length })}
        </p>
        <div class="segmented small-seg" role="group" aria-label={t("Zeitraum der Aktivität")}>
          {CAL_SPANS.map((w) => (
            <button key={w} class={weeks === w ? "active" : ""} aria-pressed={weeks === w} onClick={() => setWeeks(w)}>
              {t("{w} Wo.", { w })}
            </button>
          ))}
        </div>
      </div>
      <div class="cal-grid" role="grid" aria-label={t("{total} Partien an {active} Tagen in den letzten {weeks} Wochen", { total, active, weeks })}>
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
              const tone = d.score_pct === null ? "" : d.score_pct >= 60 ? " good" : d.score_pct <= 40 ? " bad" : " even";
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
                  {d.games > 0 && <span class="cal-dot" />}
                </button>
              );
            }),
          ];
        })}
      </div>
      <p class="small cal-detail" role="status">
        {shown ? (
          dayText(shown)
        ) : (
          <span class="muted">
            {t("{n}{n2}", { n: lastPlayed ? t("Zuletzt {dayLong}", { dayLong: dayLong(lastPlayed.day) }) : t("Noch keine Partie in diesen Wochen"), n2: busiest && busiest.games > 1 ? t(" · meiste: {games} am {dayLong}", { games: busiest.games, dayLong: dayLong(busiest.day) }) : "" })}
          </span>
        )}
      </p>
      <div class="cal-key" aria-hidden="true">
        <span>
          
          {t("weniger")}{" "}<i class="l1" />
          <i class="l2" />
          <i class="l3" />
          <i class="l4" />  {t("mehr Partien")}
        </span>
        <span>
          <i class="dot good" /> {" "}{t("gut gepunktet")}{" "}<i class="dot bad" />  {t("schwacher Tag")}
        </span>
      </div>
      <Foot>{t("Tippe einen Tag an. {n}", { n: note ?? t("Regelmäßig wenige Partien mit Nachbereitung bringen mehr als seltene Serien.") })}</Foot>
    </div>
  );
}
