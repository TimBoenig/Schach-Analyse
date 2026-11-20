// "Verlauf": the share of top moves and the rate of serious errors per month,
// over the whole history. The page's period does not cut these lines; a
// 90-day page would leave three dots.
import { useMemo, useState } from "preact/hooks";

import { lastMonths, MIN_TREND_MOVES, monthlyQuality, type MonthQuality, type PlayerProfile, SERIOUS_CLASSES, spanQuality, sumOf, TOP_CLASSES } from "../../domain/profile";
import { defaultRange, rangeChoices } from "../../domain/profile/history";
import { monthStart } from "../charts";
import { Foot } from "../kit";
import { monthName } from "../MoveTally";
import { RangeChips } from "../viz/Range";
import { TrendChart, type TrendPoint } from "../viz/TrendChart";
import { de, plural } from "./shared";
import { t } from "../../i18n";

// A line of monthly points needs at least half a year to be worth a shorter view.
const MIN_RANGE_DAYS = 183;
const DAY = 86400;

export function QualityTrend({ full, loading }: { full: PlayerProfile | null; loading: boolean }) {
  const [range, setRange] = useState<string | null>(null);
  const tally = full?.moves ?? null;
  const months = useMemo(() => (tally ? monthlyQuality(tally.months) : []), [tally]);

  const spanDays = months.length ? ((monthStart(months[months.length - 1].key) ?? 0) - (monthStart(months[0].key) ?? 0)) / DAY + 30 : 0;
  const choices = rangeChoices(spanDays).filter((c) => c.days === null || c.days >= MIN_RANGE_DAYS);
  const current = choices.find((c) => c.key === range) ?? defaultRange(choices);
  const shown = lastMonths(months, current.days);
  const span = spanQuality(shown);
  const o = tally?.opponents;

  const points = (pick: (m: MonthQuality) => number): TrendPoint[] =>
    shown.map((m) => ({ t: monthStart(m.key) ?? 0, value: pick(m), label: monthName(m.key, true), detail: `${plural(m.moves, t("Zug"), t("Züge"))} in ${plural(m.games, t("Partie"), t("Partien"))}`, weight: m.moves }));
  const reference = (keys: typeof TOP_CLASSES) => (o && o.moves ? { value: (sumOf(o.counts, keys) / o.moves) * 100, label: t("Ø deiner Gegner") } : null);

  const empty = loading ? t("Lädt …") : t("Für einen Verlauf braucht es mindestens zwei Monate mit je {MIN_TREND_MOVES} analysierten Zügen.", { MIN_TREND_MOVES });

  return (
    <>
      <div class="span-12 sec-head" id="s-verlauf">
        <div>
          <h2>{t("Verlauf")}</h2>
          <p>{t("Werden deine Züge besser? Pro Monat über deine ganze Geschichte, unabhängig vom Zeitraum oben.")}</p>
        </div>
        <RangeChips choices={choices} value={current.key} onChange={setRange} />
      </div>

      <section class="card span-6 tr">
        <header class="card-head">
          <div>
            <h3>{t("Bester Zug oder besser")}</h3>
            {span && shown.length > 1 ? (
              <p class="tr-figure">
                <strong class="tnum">{de(span.top_pct, 0)} %</strong>
                <span class="faint">
                  {current.text} · {plural(span.moves, t("Zug"), t("Züge"))}
                </span>
              </p>
            ) : (
              <p class="card-sub">{empty}</p>
            )}
          </div>
          <span class="card-tag">soll steigen</span>
        </header>
        <TrendChart points={points((m) => m.top_pct)} label={t("Anteil bester Züge")} color="var(--win)" dots format={(v) => `${Math.round(v)} %`} bounds={{ lo: 0, hi: 100, minSpan: 16 }} reference={reference(TOP_CLASSES)} />
        {span?.best_top && (
          <dl class="tr-facts">
            <div>
              <dt>{t("Bester Monat")}</dt>
              <dd class="tnum">
                {de(span.best_top.top_pct, 0)} % <span class="faint">{monthName(span.best_top.key, true)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("Monate im Bild")}</dt>
              <dd class="tnum">{span.months}</dd>
            </div>
          </dl>
        )}
      </section>

      <section class="card span-6 tr">
        <header class="card-head">
          <div>
            <h3>{t("Grobe Fehler je 100 Züge")}</h3>
            {span && shown.length > 1 ? (
              <p class="tr-figure">
                <strong class="tnum">{de(span.serious_per_100)}</strong>
                <span class="faint">
                  {current.text} · {plural(span.games, t("Partie"), t("Partien"))}
                </span>
              </p>
            ) : (
              <p class="card-sub">{empty}</p>
            )}
          </div>
          <span class="card-tag">soll fallen</span>
        </header>
        <TrendChart points={points((m) => m.serious_per_100)} label={t("Grobe Fehler je 100 Züge")} color="var(--loss)" dots format={(v) => de(v)} bounds={{ lo: 0, minSpan: 4 }} reference={reference(SERIOUS_CLASSES)} />
        {span?.fewest_errors && (
          <dl class="tr-facts">
            <div>
              <dt>{t("Sauberster Monat")}</dt>
              <dd class="tnum">
                {de(span.fewest_errors.serious_per_100)} <span class="faint">{monthName(span.fewest_errors.key, true)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("Monate im Bild")}</dt>
              <dd class="tnum">{span.months}</dd>
            </div>
          </dl>
        )}
      </section>

      <div class="span-12 mv-trend-foot">
        <Foot>
          
          {t("Ein Punkt je Kalendermonat mit mindestens")} {MIN_TREND_MOVES}  {t("analysierten Zügen (etwa vier Partien); dünnere Monate würden nur Zacken beitragen. Die Säulen am unteren Rand zeigen, wie viele Züge hinter einem Monat stehen. Grobe Fehler sind Fehler, verpasste Chancen und Patzer. Die gestrichelte Linie ist der Wert deiner Gegner über alle diese Partien.")}
        </Foot>
      </div>
    </>
  );
}
