// Small pieces the three training pages share.
import { type ExerciseState, type SessionPart, STATE_LABEL } from "../../domain/training";
import { t } from "../../i18n";

/** What a session runs: a title and the exercises, optionally in the parts of the daily plan. */
export interface SessionSpec {
  title: string;
  ids: string[];
  /** Ordered parts of the daily session (warm-up, main theme, mixed); absent for single-topic sessions. */
  parts?: SessionPart[];
}

export type StartSession = (spec: SessionSpec) => void;

const WEEKDAY = [t("So"), t("Mo"), t("Di"), t("Mi"), t("Do"), t("Fr"), t("Sa")];
const WEEKDAY_LONG = [t("Sonntag"), t("Montag"), t("Dienstag"), t("Mittwoch"), t("Donnerstag"), t("Freitag"), t("Samstag")];
const MONTH = [t("Januar"), t("Februar"), t("März"), t("April"), t("Mai"), t("Juni"), t("Juli"), t("August"), t("September"), t("Oktober"), t("November"), t("Dezember")];

/** Local Date of a "YYYY-MM-DD" day key (noon, so a time change never shifts the day). */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export const weekdayShort = (day: string): string => WEEKDAY[dayDate(day).getDay()];

/** "Dienstag, 17. November". */
export function dayLong(day: string): string {
  const d = dayDate(day);
  return `${WEEKDAY_LONG[d.getDay()]}, ${d.getDate()}. ${MONTH[d.getMonth()]}`;
}

/** "17.11." */
export function dayShort(day: string): string {
  const d = dayDate(day);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const pct = (v: number): string => `${Math.round(v)} %`;

/** The state of an exercise as a quiet word with a dot in its colour. */
export function StateTag({ state }: { state: ExerciseState }) {
  return <span class={`tn-state ${state}`}>{STATE_LABEL[state]}</span>;
}

/** Five steps of the repetition ladder; from the third on a line counts as safe. */
export function Ladder({ box, max = 5 }: { box: number; max?: number }) {
  return (
    <span class="tn-ladder" role="img" aria-label={t("Stufe {box} von {max}", { box, max })}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} class={i < box ? "on" : ""} />
      ))}
    </span>
  );
}
