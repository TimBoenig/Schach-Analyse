// "Verlauf": rating and accuracy over the whole history. The page's period
// filter does not cut these two charts (three months of a profile showed two
// lonely month dots here); they bring their own span and step.
import { useMemo, useState } from "preact/hooks";

import type { RatingContext } from "../../domain/profile";
import { typicalLabel } from "../../domain/profile";
import { accuracyHistory, bucketLabel, type DayRow, dayStart, defaultRange, rangeChoices, ratingHistory, type RatingSeries } from "../../domain/profile/history";
import type { StoredGame } from "../../domain/types";
import { Foot } from "../kit";
import { type ProfileFilters, useAllTimeProfile } from "../useProfile";
import { Delta, RangeChips } from "../viz/Range";
import { TrendChart, type TrendPoint } from "../viz/TrendChart";
import { t, locale, dec } from "../../i18n";

const DAY = 86400;
const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", dec());
const dateText = (tk: number) => new Date(tk * 1000).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString(locale())} ${n === 1 ? one : many}`;

interface Trends {
  ratings: Record<string, RatingSeries>;
  daily: DayRow[];
}

export function TrendSection({ games, usernames, filters, excludeBullet, rating }: { games: StoredGame[]; usernames: string[]; filters: ProfileFilters; excludeBullet: boolean; rating: RatingContext | null }) {
  const full = useAllTimeProfile(games, usernames, filters, excludeBullet);
  // Rating lines and daily accuracy over every game; null while the worker still builds them.
  const trends = useMemo((): Trends | null => {
    if (full.loading) return null;
    const tk = (full.profile?.trends ?? {}) as { ratings?: Record<string, RatingSeries>; daily?: DayRow[] };
    return { ratings: tk.ratings ?? {}, daily: tk.daily ?? [] };
  }, [full]);
  const [pool, setPool] = useState<string | null>(null);
  const [range, setRange] = useState<string | null>(null);

  // The line with the most games opens first.
  const pools = useMemo(() => (trends ? Object.keys(trends.ratings).sort((a, b) => trends.ratings[b].length - trends.ratings[a].length) : []), [trends]);
  const shownPool = pool && trends?.ratings[pool] ? pool : pools[0];
  const series = (shownPool && trends?.ratings[shownPool]) || [];

  // Both charts share one span, measured over everything the section holds.
  const spanDays = useMemo(() => {
    if (!trends) return 0;
    const times = [...Object.values(trends.ratings).flatMap((s) => s.map(([tk]) => tk)), ...trends.daily.map((d) => dayStart(d.day))];
    return times.length ? (Math.max(...times) - Math.min(...times)) / DAY : 0;
  }, [trends]);
  const choices = rangeChoices(spanDays);
  const current = choices.find((c) => c.key === range) ?? defaultRange(choices);

  const rh = useMemo(() => ratingHistory(series, current.days), [series, current.days]);
  const ah = useMemo(() => (trends ? accuracyHistory(trends.daily, current.days) : null), [trends, current.days]);

  const ratingPoints: TrendPoint[] = (rh?.points ?? []).map((p) => ({ t: p.t, value: p.value, label: dateText(p.t), detail: plural(p.games, t("Partie an dem Tag"), t("Partien an dem Tag")) }));
  const accPoints: TrendPoint[] = (ah?.points ?? []).map((p) => ({ t: p.t, value: p.value, label: bucketLabel(p.key, p.bucket), detail: plural(p.games, t("Partie"), t("Partien")), weight: p.games }));
  const step = ah ? { day: t("pro Tag"), week: t("pro Woche"), month: t("pro Monat"), quarter: t("pro Quartal") }[ah.bucket] : "";
  const spanText = current.text;
  // Best and weakest step of the span; a step with a single game is too thin to name.
  const solid = (ah?.points ?? []).filter((p) => p.games >= 3);
  const best = solid.length ? solid.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const worst = solid.length ? solid.reduce((a, b) => (b.value < a.value ? b : a)) : null;

  return (
    <>
      <div class="span-12 sec-head" id="s-verlauf">
        <div>
          <h2>{t("Verlauf")}</h2>
          <p>{t("Wertung und Genauigkeit über deine ganze Geschichte, unabhängig vom Zeitraum oben.")}</p>
        </div>
        <RangeChips choices={choices} value={current.key} onChange={setRange} />
      </div>

      <section class="card span-7 tr">
        <header class="card-head">
          <div>
            <h3>{t("Wertung")}</h3>
            {rh ? (
              <p class="tr-figure">
                <strong class="tnum">{rh.last}</strong>
                <Delta value={rh.change} />
                <span class="faint">{spanText}</span>
              </p>
            ) : (
              <p class="card-sub">{trends ? t("Keine gewerteten Partien in diesem Zeitraum.") : t("Lädt …")}</p>
            )}
          </div>
          {pools.length > 3 ? (
            <select class="tr-pool" value={shownPool} onChange={(e) => setPool((e.target as HTMLSelectElement).value)} aria-label={t("Bedenkzeit und Plattform")}>
              {pools.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : pools.length > 1 ? (
            <div class="segmented small-seg" role="group" aria-label={t("Bedenkzeit und Plattform")}>
              {pools.map((p) => (
                <button key={p} class={p === shownPool ? "active" : ""} aria-pressed={p === shownPool} onClick={() => setPool(p)}>
                  {p}
                </button>
              ))}
            </div>
          ) : null}
        </header>
        <TrendChart points={ratingPoints} label={t("Wertung {0}", { 0: shownPool ?? "" })} bounds={{ lo: 0, minSpan: 100 }} />
        {rh && rh.points.length > 1 && (
          <dl class="tr-facts">
            <div>
              <dt>{t("Bestwert")}</dt>
              <dd class="tnum">
                {rh.peak.value} <span class="faint">{dateText(rh.peak.t)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("Tiefstwert")}</dt>
              <dd class="tnum">
                {rh.low.value} <span class="faint">{dateText(rh.low.t)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("Gewertete Partien")}</dt>
              <dd class="tnum">{rh.games.toLocaleString(locale())}</dd>
            </div>
          </dl>
        )}
        <Foot>
          
          {t("Ein Punkt je Spieltag: die Wertung nach der letzten Partie des Tages. Jede Bedenkzeit und Plattform hat ihre eigene Linie, weil deren Wertungen nicht vergleichbar sind. Partien ohne eigene Wertungsliste (etwa gegen den Coach von chess.com) und Partien gegen Bots zählen nicht mit. In den ersten Partien eines Kontos und nach langen Pausen springt die Wertung stärker, weil die Plattform sie dann noch einpendelt.")}
        </Foot>
      </section>

      <section class="card span-5 tr">
        <header class="card-head">
          <div>
            <h3>{t("Genauigkeit")}</h3>
            {ah ? (
              <p class="tr-figure">
                <strong class="tnum">{de(ah.average)}</strong>
                <span class="faint">
                  {t("Ø {spanText} · {n}", { spanText, n: plural(ah.games, t("Partie"), t("Partien")) })}
                </span>
              </p>
            ) : (
              <p class="card-sub">{trends ? t("Noch keine analysierten Partien in diesem Zeitraum.") : t("Lädt …")}</p>
            )}
          </div>
          {step && <span class="card-tag">{step}</span>}
        </header>
        <TrendChart points={accPoints} label={t("Genauigkeit")} color="var(--win)" dots format={(v) => de(v, v % 1 ? 1 : 0)} bounds={{ lo: 0, hi: 100, minSpan: 20 }} reference={rating ? { value: rating.typical_accuracy, label: typicalLabel(rating) } : null} />
        {best && worst && best.key !== worst.key && (
          <dl class="tr-facts">
            <div>
              <dt>{t("Bester Abschnitt")}</dt>
              <dd class="tnum">
                {de(best.value)} <span class="faint">{bucketLabel(best.key, best.bucket)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("Schwächster Abschnitt")}</dt>
              <dd class="tnum">
                {de(worst.value)} <span class="faint">{bucketLabel(worst.key, worst.bucket)}</span>
              </dd>
            </div>
          </dl>
        )}
        <Foot>
          
          {t("Der Durchschnitt deiner analysierten Partien je Abschnitt; jede Partie zählt gleich. Die Säulen am unteren Rand zeigen, wie viele Partien dahinterstehen; bester und schwächster Abschnitt nennen nur Abschnitte mit mindestens 3 Partien. Je kürzer der Zeitraum, desto feiner die Abschnitte: Tage, Wochen, Monate oder Quartale.")}
        </Foot>
      </section>
    </>
  );
}
