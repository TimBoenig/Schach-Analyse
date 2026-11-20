// Training, "Fortschritt": does the practice work? First the habit (how often),
// then the learning (what is solved, what stays), then the proof in real
// games, and last the fill level of every area and opening line.
import { useState } from "preact/hooks";

import { openingLabel } from "../../domain/profile";
import {
  activity,
  type ActivityDay,
  CATEGORIES,
  categoryOverview,
  type Direction,
  LIBRARY_GROUPS,
  logTotals,
  openingProgress,
  poolTotals,
  retention,
  STATE_LABEL,
  streak,
  trainingStart,
  trainingTrends,
  transferReport,
  type TransferRow,
  TREND_MIN_ATTEMPTS,
  weeklyRates,
} from "../../domain/training";
import { IconPlay } from "../icons";
import { CountUp, Foot } from "../kit";
import { navigate } from "../router";
import { Level, SplitBar, Stat } from "../viz/Bars";
import { TrendChart, type TrendPoint } from "../viz/TrendChart";
import { dayDate, dayShort, Ladder, pct, plural } from "./shared";
import type { TrainingState } from "./useTraining";
import { t } from "../../i18n";

const CALENDAR_WEEKS = 16;
const RATE_WEEKS = 8;
// A rate from one or two tries says nothing; such areas show no rate yet.
const RATE_MIN_ATTEMPTS = 3;
// Lines shown before "show all": the list grows with every opening played.
const OPENING_ROWS = 8;
const MONTH_SHORT = [t("Jan"), t("Feb"), t("Mär"), t("Apr"), t("Mai"), t("Jun"), t("Jul"), t("Aug"), t("Sep"), t("Okt"), t("Nov"), t("Dez")];

const comma = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

function Summary({ t: tk }: { t: TrainingState }) {
  const totals = logTotals(tk.log);
  const run = streak(tk.log, tk.today);
  const pool = poolTotals(categoryOverview(tk.pool, tk.progress, tk.today));
  return (
    <section class="card span-12 tx-sum tp-sum">
      <Stat label={t("Serie")} value={<CountUp value={run} />} sub={t("{0} in Folge{1}", { 0: run === 1 ? t("Tag") : t("Tage"), 1: totals.longest > run ? t(" · längste {longest}", { longest: totals.longest }) : "" })} />
      <Stat label={t("Aufgaben gemacht")} value={<CountUp value={totals.done} />} sub={`an ${plural(totals.days, t("Tag"), t("Tagen"))}`} />
      <Stat
        label={t("Auf Anhieb gelöst")}
        value={totals.rate === null ? "–" : <CountUp value={totals.rate} format={(v) => pct(v)} />}
        sub={totals.done ? `${totals.correct} von ${totals.done}` : t("noch keine Aufgabe")}
      />
      <Stat label={t("Sitzen sicher")} value={<CountUp value={pool.mastered} />} sub={`von ${plural(pool.total, t("Übung"), t("Übungen"))}`} tone={pool.mastered ? "good" : undefined}>
        <SplitBar
          parts={[
            { key: "mastered", label: t("Sicher"), value: pool.mastered, color: "var(--win)" },
            { key: "learning", label: t("Im Aufbau"), value: pool.learning, color: "var(--accent)" },
            { key: "fresh", label: t("Neu"), value: pool.fresh, color: "var(--surface-3)" },
          ]}
          height={8}
        />
      </Stat>
    </section>
  );
}

/** The training calendar: one square per day, darker with more exercises. */
function CalendarCard({ t: tk }: { t: TrainingState }) {
  const a = activity(tk.log, tk.today, CALENDAR_WEEKS);
  const [hover, setHover] = useState<ActivityDay | null>(null);
  const shown = hover ?? a.best;
  // A month name stands over the first week that starts in it.
  const months = a.weeks.map((w, i) => {
    const m = dayDate(w[0].date).getMonth();
    return i === 0 || dayDate(a.weeks[i - 1][0].date).getMonth() !== m ? MONTH_SHORT[m] : "";
  });
  return (
    <section class="card span-7 tp-cal">
      <header class="card-head">
        <div>
          <h3>{t("Wie oft du trainierst")}</h3>
          <p class="card-sub">
            <strong class="tnum">{plural(a.activeDays, t("Trainingstag"), t("Trainingstage"))}</strong> in den letzten {CALENDAR_WEEKS}  {t("Wochen, zusammen")} {plural(a.done, t("Aufgabe"), t("Aufgaben"))}.
          </p>
        </div>
      </header>
      <div class="tp-grid-wrap">
        <div class="tp-dow" aria-hidden="true">
          <span>{t("Mo")}</span>
          <span>{t("Mi")}</span>
          <span>{t("Fr")}</span>
          <span>{t("So")}</span>
        </div>
        <div class="tp-grid" style={{ gridTemplateColumns: `repeat(${a.weeks.length}, minmax(0, 1fr))` }} onPointerLeave={() => setHover(null)}>
          {months.map((m, i) => (
            <span key={`m${i}`} class="tp-month">
              {m}
            </span>
          ))}
          {Array.from({ length: 7 }, (_, d) =>
            a.weeks.map((w) => {
              const day = w[d];
              return (
                <i
                  key={day.date}
                  class={`tp-cell l${day.level}${day.future ? " future" : ""}${day.date === tk.today ? " today" : ""}`}
                  title={day.future ? "" : `${dayShort(day.date)}: ${day.done ? t("{correct} von {done} auf Anhieb", { correct: day.correct, done: day.done }) : t("kein Training")}`}
                  onPointerEnter={() => setHover(day.future ? null : day)}
                />
              );
            }),
          )}
        </div>
      </div>
      <div class="tp-cal-foot">
        <span class="tp-cal-info tnum">
          {shown ? (
            <>
              <strong>{dayShort(shown.date)}</strong> {shown.done ? t("{plural}, {correct} auf Anhieb{2}", { plural: plural(shown.done, t("Aufgabe"), t("Aufgaben")), correct: shown.correct, 2: hover ? "" : t(" (dein stärkster Tag)") }) : t("kein Training")}
            </>
          ) : (
            t("Noch kein Trainingstag in diesem Zeitraum.")
          )}
        </span>
        <span class="tp-scale" aria-hidden="true">
          weniger <i class="tp-cell l0" />
          <i class="tp-cell l1" />
          <i class="tp-cell l2" />
          <i class="tp-cell l3" />
          <i class="tp-cell l4" /> mehr
        </span>
      </div>
    </section>
  );
}

/** Weekly solve rate over two months plus an honest verdict on the last two weeks. */
function RateCard({ t: tk }: { t: TrainingState }) {
  const weeks = weeklyRates(tk.log, tk.today, RATE_WEEKS);
  const { overall } = trainingTrends(tk.log, tk.today);
  const points: TrendPoint[] = weeks
    .filter((w) => w.rate !== null)
    .map((w) => ({
      t: dayDate(w.start).getTime() / 1000,
      value: w.rate as number,
      label: t("Woche ab {dayShort}", { dayShort: dayShort(w.start) }),
      detail: t("{correct} von {plural} auf Anhieb", { correct: w.correct, plural: plural(w.done, t("Aufgabe"), t("Aufgaben")) }),
      weight: w.done,
    }));
  const verdict =
    overall.direction === "unknown"
      ? t("Für eine sichere Aussage brauche ich in den letzten 14 Tagen und in den 14 davor je mindestens {TREND_MIN_ATTEMPTS} Aufgaben.", { TREND_MIN_ATTEMPTS })
      : overall.direction === "flat"
        ? t("Stabil: {0}{comma} Prozentpunkte gegenüber den 14 Tagen davor, das liegt im Rahmen des Zufalls.", { 0: overall.delta! >= 0 ? "+" : "", comma: comma(overall.delta!) })
        : t("In den letzten 14 Tagen {0}: {1}{comma} Prozentpunkte.", { 0: overall.direction === "up" ? "deutlich gestiegen" : "deutlich gefallen", 1: overall.delta! > 0 ? "+" : "", comma: comma(overall.delta!) });
  return (
    <section class="card span-5 tp-rate">
      <header class="card-head">
        <div>
          <h3>{t("Lösungsquote")}</h3>
          <p class="card-sub">{t("Anteil auf Anhieb gelöst, je Woche.")}</p>
        </div>
        {overall.direction !== "unknown" && <span class={`delta ${overall.direction === "up" ? "up" : overall.direction === "down" ? "down" : ""}`}>{overall.direction === "up" ? "steigt" : overall.direction === "down" ? t("fällt") : "stabil"}</span>}
      </header>
      <TrendChart points={points} format={(v) => pct(v)} height={200} color="var(--win)" bounds={{ lo: 0, hi: 100, minSpan: 40 }} dots label={t("Lösungsquote je Woche")} />
      <p class={`tp-verdict ${overall.direction}`}>{verdict}</p>
      <Foot>
        
        {t("Jeder Punkt ist eine Woche, die Säulen dahinter zeigen, wie viele Aufgaben es waren. Wochen ohne Training fehlen. Eine Veränderung nenne ich erst, wenn sie statistisch klar ist: mit zu wenigen Aufgaben wäre jede Schwankung nur Zufall.")}
      </Foot>
    </section>
  );
}

/** How much of what was practised is still there days later (solve rate on repetitions). */
function RetentionCard({ t: tk }: { t: TrainingState }) {
  const r = retention(tk.log, tk.today);
  const rate = r.done ? (r.solved / r.done) * 100 : 0;
  return (
    <section class="card span-6 tp-keep">
      <header class="card-head">
        <div>
          <h3>{t("Was hängen bleibt")}</h3>
          <p class="card-sub">{t("Wiederholungen der letzten 4 Wochen: Aufgaben, die du nach einer Pause wieder siehst.")}</p>
        </div>
      </header>
      {r.reliable ? (
        <>
          <div class="tp-keep-main">
            <span class="tp-big tnum">{pct(rate)}</span>
            <span class="tp-keep-text">
              <strong>
                {r.solved} von {r.done}
              </strong>{" "}
              
              {t("wiederholten Aufgaben auf Anhieb gelöst")}
            </span>
          </div>
          <Level value={rate} band={(r.high - r.low) / 2} tone={r.low >= 85 ? "good" : r.high < 60 ? "bad" : "accent"} />
          <p class="tp-verdict">
            
            {t("Sicher zwischen")} {r.low} und {r.high} %.{" "}
            {r.low >= 85
              ? t("Sehr gut. Die Abstände dürfen ruhig größer werden.")
              : r.high < 60
                ? t("Zwischen den Wiederholungen geht viel verloren. Kürzere, dafür tägliche Einheiten helfen hier am meisten.")
                : t("Im Zielbereich: schwer genug, dass du etwas lernst, leicht genug, dass es hängen bleibt.")}
          </p>
        </>
      ) : (
        <p class="tn-none">
          
          {t("Noch")} {plural(Math.max(0, 8 - r.done), t("Wiederholung"), t("Wiederholungen"))}  {t("bis zu einer belastbaren Quote. Wiederholte Aufgaben zeigen, was du nach ein paar Tagen noch kannst. Das ist der eigentliche Lerneffekt.")}
        </p>
      )}
    </section>
  );
}

function transferText(row: TransferRow): string {
  if (row.verdict === null) {
    const need = Math.max(0, 10 - row.gamesAfter);
    return need > 0 ? t("noch {plural} nötig", { plural: plural(need, t("Partie"), t("Partien")) }) : t("noch zu wenige Züge");
  }
  if (row.verdict === -1) return "deutlich besser";
  if (row.verdict === 1) return "deutlich schlechter";
  return t("keine klare Änderung");
}

/** Before/after training in real games, only with enough data and a significant difference. */
function TransferCard({ t: tk }: { t: TrainingState }) {
  const report = transferReport(tk.profile?.error_series ?? [], trainingStart(Object.keys(tk.log).filter((d) => tk.log[d].done)));
  const fmt = (row: TransferRow, v: number | null) => (v === null ? "–" : row.metric === "accuracy" ? `${comma(v)} %` : comma(v));
  return (
    <section class="card span-6 tp-transfer">
      <header class="card-head">
        <div>
          <h3>{t("Kommt es in deinen Partien an?")}</h3>
          <p class="card-sub">
            {report.start ? t("Deine Partien vor und seit dem ersten Trainingstag ({0}).", { 0: report.start.split("-").reverse().join(".") }) : t("Der Vergleich beginnt mit deinem ersten Trainingstag.")}
          </p>
        </div>
      </header>
      {report.start ? (
        <div class="tp-table" role="table" aria-label={t("Vorher und nachher")}>
          <div class="tp-tr tp-th" role="row">
            <span role="columnheader">{t("Messwert")}</span>
            <span role="columnheader" class="num">
              
              {t("Vorher")}
            </span>
            <span role="columnheader" class="num">
              
              {t("Seitdem")}
            </span>
            <span role="columnheader">{t("Urteil")}</span>
          </div>
          {report.rows.map((row) => (
            <div key={row.metric} class="tp-tr" role="row">
              <span role="cell">{row.label}</span>
              <span role="cell" class="num tnum">
                {fmt(row, row.before)}
              </span>
              <span role="cell" class="num tnum">
                {fmt(row, row.after)}
              </span>
              <span role="cell" class={`tp-judge ${row.verdict === -1 ? "good" : row.verdict === 1 ? "bad" : ""}`}>
                {transferText(row)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p class="tn-none">{t("Sobald du trainierst, vergleiche ich deine Partien davor mit denen danach.")}</p>
      )}
      <Foot>
        
        {t("Fehler pro 100 eigene Züge, Genauigkeit in Prozent. Ein Urteil gibt es erst ab je 10 Partien davor und danach und nur, wenn der Unterschied statistisch klar ist. So siehst du echte Fortschritte statt Zufall.")}
      </Foot>
    </section>
  );
}

const TREND_TEXT: Record<Direction, string> = { up: "besser", down: "schlechter", flat: "stabil", unknown: "" };

function AreasCard({ t: tk }: { t: TrainingState }) {
  const rows = categoryOverview(tk.pool, tk.progress, tk.today);
  const by = new Map(rows.map((r) => [r.category, r]));
  const trends = trainingTrends(tk.log, tk.today).byCategory;
  const order = LIBRARY_GROUPS.flatMap((g) => g.categories).filter((c) => (by.get(c)?.total ?? 0) > 0);
  return (
    <section class="card span-12 tp-areas">
      <header class="card-head">
        <div>
          <h3>{t("Nach Bereich")}</h3>
          <p class="card-sub">{t("Wie oft du auf Anhieb löst und wie viel schon sicher sitzt.")}</p>
        </div>
      </header>
      <div class="tp-table tp-area-table" role="table" aria-label={t("Fortschritt nach Bereich")}>
        <div class="tp-tr tp-th" role="row">
          <span role="columnheader">{t("Bereich")}</span>
          <span role="columnheader">{t("Auf Anhieb gelöst")}</span>
          <span role="columnheader" class="num">
            
            {t("Quote")}
          </span>
          <span role="columnheader">{t("Sicher / im Aufbau / neu")}</span>
          <span />
        </div>
        {order.map((c) => {
          const r = by.get(c)!;
          const rated = r.rate !== null && r.attempts >= RATE_MIN_ATTEMPTS;
          const d = trends[c]?.direction;
          return (
            <div key={c} class="tp-tr" role="row">
              <span role="cell" class="tp-area-name">
                <strong>{CATEGORIES[c].label}</strong>
                {d === "up" || d === "down" ? (
                  <small class={d === "up" ? "good" : "bad"} title={t("Letzte 14 Tage deutlich {0} als die 14 davor", { 0: TREND_TEXT[d] })}>
                    zuletzt {TREND_TEXT[d]}
                  </small>
                ) : null}
              </span>
              <span role="cell">
                <Level value={rated ? (r.rate as number) : null} faint={r.attempts < TREND_MIN_ATTEMPTS} />
              </span>
              <span role="cell" class="num tnum" title={r.attempts ? t("{solved} von {attempts} Versuchen", { solved: r.solved, attempts: r.attempts }) : ""}>
                {rated ? pct(r.rate as number) : "–"}
              </span>
              <span role="cell" class="tp-fill">
                <SplitBar
                  parts={[
                    { key: "mastered", label: t("Sicher"), value: r.mastered, color: "var(--win)" },
                    { key: "learning", label: t("Im Aufbau"), value: r.learning, color: "var(--accent)" },
                    { key: "fresh", label: t("Neu"), value: r.fresh, color: "var(--surface-3)" },
                  ]}
                  height={8}
                />
                <small class="tnum">
                  {r.mastered} / {r.learning} / {r.fresh}
                </small>
              </span>
              <span role="cell" class="tp-act">
                <button class="btn small ghost" onClick={() => navigate({ view: "training", tab: "uebungen", category: c })} title={t("{label} üben", { label: CATEGORIES[c].label })}>
                  <IconPlay /> <span>{t("üben")}</span>
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <Foot>
        
        {t("Die Quote erscheint ab")} {RATE_MIN_ATTEMPTS}  {t("Versuchen, blasse Balken beruhen auf weniger als")} {TREND_MIN_ATTEMPTS}{t(". „Zuletzt besser“ oder „schlechter“ steht nur da, wenn die letzten 14 Tage sich klar von den 14 davor unterscheiden. Eine Übung gilt als sicher, wenn du sie dreimal hintereinander auf Anhieb gelöst hast.")}
      </Foot>
    </section>
  );
}

/** Each repertoire line and how far up the repetition ladder it is. */
function OpeningsCard({ t: tk }: { t: TrainingState }) {
  // Library lines appear once they were practised; untouched ones would only be noise.
  const rows = openingProgress(tk.pool, tk.progress, tk.today).filter((r) => !r.id.startsWith("lib:") || r.attempts > 0);
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, OPENING_ROWS);
  return (
    <section class="card span-12 tp-open">
      <header class="card-head">
        <div>
          <h3>{t("Eröffnungen")}</h3>
          <p class="card-sub">{t("Wie sicher deine Linien sitzen.")}</p>
        </div>
      </header>
      <div class="tp-table tp-open-table" role="table" aria-label={t("Eröffnungslinien")}>
        <div class="tp-tr tp-th" role="row">
          <span role="columnheader">{t("Linie")}</span>
          <span role="columnheader">{t("Stufe")}</span>
          <span role="columnheader">{t("Stand")}</span>
          <span role="columnheader" class="num">
            
            {t("Fehlerfrei")}
          </span>
        </div>
        {shown.map((r) => (
          <div key={r.id} class="tp-tr" role="row">
            <span role="cell" class="tp-area-name">
              <strong>{openingLabel(r.opening)}</strong>
              <small>
                <i class={`op-side ${r.color}`} aria-hidden="true" /> {r.color === "white" ? t("Weiß") : t("Schwarz")}
              </small>
            </span>
            <span role="cell">
              <Ladder box={r.box} />
            </span>
            <span role="cell" class={`tn-state ${r.state}`}>
              {STATE_LABEL[r.state]}
            </span>
            <span role="cell" class="num tnum">
              {r.attempts ? `${r.solved} von ${r.attempts}` : "–"}
            </span>
          </div>
        ))}
      </div>
      {rows.length > OPENING_ROWS && (
        <button class="btn small ghost tx-more" onClick={() => setAll(!all)}>
          {all ? t("Weniger zeigen") : t("Alle {length} Linien zeigen", { length: rows.length })}
        </button>
      )}
      <Foot>{t("Jede fehlerfreie Runde hebt eine Linie eine Stufe höher, ein Fehler setzt sie zurück. Ab Stufe 3 gilt sie als sicher.")}</Foot>
    </section>
  );
}

export function ProgressPage({ t: tk }: { t: TrainingState }) {
  const started = logTotals(tk.log).done > 0;
  if (!started) {
    return (
      <div class="dash tn">
        <section class="card span-12 td td-empty">
          <span class="eyebrow td-eyebrow">
            <span class="orb-mini" aria-hidden="true" />  {t("Lucena · Fortschritt")}
          </span>
          <h2 class="td-title">{t("Dein Fortschritt beginnt mit der ersten Einheit.")}</h2>
          <p class="td-sub">{t("Danach siehst du hier, wie oft du trainierst, was hängen bleibt und ob es in deinen Partien ankommt.")}</p>
          <div class="td-actions">
            <button class="btn primary big" onClick={() => navigate({ view: "training" })}>
              <IconPlay />  {t("Zur Einheit von heute")}
            </button>
          </div>
        </section>
        <AreasCard t={tk} />
      </div>
    );
  }
  return (
    <div class="dash tn">
      <Summary t={tk} />
      <CalendarCard t={tk} />
      <RateCard t={tk} />
      <RetentionCard t={tk} />
      <TransferCard t={tk} />
      <AreasCard t={tk} />
      <OpeningsCard t={tk} />
    </div>
  );
}
