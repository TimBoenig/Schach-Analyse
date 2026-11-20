// "Fehler": when, with which piece and in which kind of position the serious
// errors happen (one card, three views), where on the board they land, and
// what a blunder costs in points.
import { useMemo, useState } from "preact/hooks";

import { type BlunderCost, blunderCost, type DeepInsights, type ErrorBucket, errorExtremes, type GameFact, pointsAtCleanShare } from "../../domain/profile";
import { MIN_BUCKET_MOVES } from "../../domain/profile/evidence";
import { SquareHeatmap } from "../charts";
import { IconReset } from "../icons";
import { Foot, WhatIfSlider } from "../kit";
import { Level } from "../viz/Bars";
import { de, plural } from "./shared";
import { t, tj } from "../../i18n";

type LensKey = "number" | "piece" | "situation";

interface Lens {
  key: LensKey;
  tab: string;
  /** "Zug 21–30", "mit dem Springer": how a slice is named in the sentence below the bars. */
  name: (label: string) => string;
  note: string;
  buckets: (d: DeepInsights) => ErrorBucket[];
}

const LENSES: Lens[] = [
  { key: "number", tab: t("Zugnummer"), name: (l) => t("in den Zügen {l}", { l }), note: t("Buchzüge zählen nicht mit."), buckets: (d) => d.by_move_number },
  { key: "piece", tab: t("Figur"), name: (l) => t("bei der Figur {l}", { l }), note: t("Gezählt wird die Figur, die du gezogen hast."), buckets: (d) => d.by_piece },
  // The label carries its threshold in brackets ("Klar besser (ab 70 %)"); the sentence needs only the name.
  { key: "situation", tab: t("Stellungslage"), name: (l) => t("in der Lage „{0}“", { 0: l.split(" (")[0] }), note: t("Die Lage ist deine Gewinnchance vor dem Zug, aus deiner Sicht."), buckets: (d) => d.by_situation },
];

function LensCard({ d }: { d: DeepInsights }) {
  const [key, setKey] = useState<LensKey>("number");
  const lens = LENSES.find((l) => l.key === key)!;
  const buckets = lens.buckets(d).filter((b) => b.moves > 0);
  const max = Math.max(...buckets.map((b) => (b.errors / b.moves) * 100), 1) * 1.12;
  const { high, low } = errorExtremes(buckets);
  return (
    <section class="card span-7 mv-lens">
      <header class="card-head">
        <div>
          <h3>{t("Wo deine Fehler passieren")}</h3>
          <p class="card-sub">{t("Grobe Fehler je 100 Züge.")}</p>
        </div>
        <div class="segmented small-seg" role="group" aria-label={t("Aufteilung")}>
          {LENSES.map((l) => (
            <button key={l.key} class={l.key === key ? "active" : ""} aria-pressed={l.key === key} onClick={() => setKey(l.key)}>
              {l.tab}
            </button>
          ))}
        </div>
      </header>
      {buckets.length ? (
        <div class="mv-lens-rows" key={key}>
          {buckets.map((b) => {
            const per100 = (b.errors / b.moves) * 100;
            const thin = b.moves < MIN_BUCKET_MOVES;
            return (
              <div key={b.label} class={`mv-lens-row${thin ? " thin" : ""}${high?.bucket === b ? " high" : ""}${low?.bucket === b ? " low" : ""}`}>
                <span class="mv-lens-label">{b.label}</span>
                <Level value={per100} max={max} tone={high?.bucket === b ? "bad" : low?.bucket === b ? "good" : "quiet"} faint={thin} />
                <b class="tnum">{de(per100)}</b>
                <small class="tnum">
                  {t("{errors} in {n}", { errors: b.errors, n: plural(b.moves, t("Zug"), t("Zügen")) })}
                </small>
              </div>
            );
          })}
        </div>
      ) : (
        <p class="tn-none">{t("Dafür fehlen noch analysierte Züge.")}</p>
      )}
      {buckets.length > 0 && (
        <p class="mv-lens-say">
          {high ? (
            <>
              {tj("{x} {n}: {n2} je 100 Züge, sonst {n3}.", { x: <b class="bad">{t("Klar am meisten")}</b>, n: lens.name(high.bucket.label), n2: de(high.per_100), n3: de(high.rest_per_100) })}{" "}
            </>
          ) : null}
          {low ? (
            <>
              {tj("{x} {n}: {n2}, sonst {n3}.", { x: <b class="good">{t("Klar am wenigsten")}</b>, n: lens.name(low.bucket.label), n2: de(low.per_100), n3: de(low.rest_per_100) })}</>
          ) : null}
          {!high && !low ? t("Hier hebt sich nichts klar ab: die Unterschiede zwischen den Zeilen könnten Zufall sein.") : null}
        </p>
      )}
      <Foot>
        
        {t("Grobe Fehler sind Fehler, verpasste Chancen und Patzer. {note} Farbig wird eine Zeile nur, wenn ihr Abstand zu allen anderen zusammen kein Zufall sein kann; blasse Zeilen beruhen auf weniger als {MIN_BUCKET_MOVES} Zügen.", { note: lens.note, MIN_BUCKET_MOVES })}
      </Foot>
    </section>
  );
}

function MapCard({ d }: { d: DeepInsights }) {
  return (
    <section class="card span-5 mv-map">
      <header class="card-head">
        <div>
          <h3>{t("Fehler-Landkarte")}</h3>
          <p class="card-sub">{t("Auf welchen Feldern deine groben Fehler landen.")}</p>
        </div>
        <span class="card-tag tnum">{plural(d.error_total, t("Fehler"), t("Fehler"))}</span>
      </header>
      <div class="mv-map-board">
        <SquareHeatmap values={d.error_squares} />
      </div>
      {d.hot_squares.length > 0 && (
        <p class="mv-map-say">
          
          {t("Am häufigsten:")}{" "}
          {d.hot_squares.map((h, i) => (
            <span key={h.square}>
              {i > 0 ? ", " : ""}
              <strong>{h.square}</strong> ({h.count})
            </span>
          ))}
          
          {t(". Gezählt wird das Zielfeld deines Zuges.")}
        </p>
      )}
    </section>
  );
}

// How far below the real share of clean games the slider may go.
const SLIDER_ROOM = 0.3;

/** What blunders cost: points in games without and with one, and what more clean games would bring. */
function CostCard({ facts }: { facts: GameFact[] }) {
  const cost: BlunderCost | null = useMemo(() => blunderCost(facts), [facts]);
  const [share, setShare] = useState<number | null>(null);
  if (!cost || cost.clean.score_pct === null || cost.dirty.score_pct === null) return null;
  const base = cost.clean_share;
  const value = share ?? base;
  const now = pointsAtCleanShare(cost, base) as number;
  const then = pointsAtCleanShare(cost, value) as number;
  const moved = Math.abs(value - base) >= 0.005;
  const delta = then - now;
  return (
    <section class="card span-12 mv-cost">
      <header class="card-head">
        <div>
          <h3>{t("Was dich Patzer kosten")}</h3>
          <p class="card-sub">{t("Deine Punkte in Partien ohne Patzer und in Partien mit mindestens einem.")}</p>
        </div>
        {cost.clear && (
          <span class="card-tag tnum">
            {t("−{n} Prozentpunkte", { n: de(cost.clean.score_pct - cost.dirty.score_pct, 0) })}
          </span>
        )}
      </header>
      <div class="mv-cost-body">
        <div class="mv-cost-rows">
          <div class="mv-cost-row">
            <span>{t("Ohne Patzer")}</span>
            <Level value={cost.clean.score_pct} tone="good" />
            <b class="tnum">{de(cost.clean.score_pct, 0)} %</b>
            <small class="tnum">{plural(cost.clean.games, t("Partie"), t("Partien"))}</small>
          </div>
          <div class="mv-cost-row">
            <span>{t("Mit Patzer")}</span>
            <Level value={cost.dirty.score_pct} tone="bad" />
            <b class="tnum">{de(cost.dirty.score_pct, 0)} %</b>
            <small class="tnum">{plural(cost.dirty.games, t("Partie"), t("Partien"))}</small>
          </div>
        </div>
        <div class="mv-cost-try">
          <WhatIfSlider
            label={t("Partien ohne Patzer")}
            value={value}
            base={base}
            min={Math.max(0, Math.round((base - SLIDER_ROOM) * 100) / 100)}
            max={1}
            step={0.01}
            text={`${de(value * 100, 0)} %`}
            deltaText={`${value >= base ? "+" : "−"}${de(Math.abs(value - base) * 100, 0)}`}
            good={value > base}
            onInput={(v) => setShare(Math.abs(v - base) < 0.005 ? null : v)}
          />
          <div class={`mv-cost-answer${moved ? " on" : ""}`} role="status">
            {moved ? (
              <>
                <p>
                  
                  {tj("Bleiben {x} statt {n} % deiner Partien ohne Patzer, holst du aus 100 Partien {x2} statt {n2} {x3}, wenn beide Arten von Partien so ausgehen wie bisher.", { x: <strong>{de(value * 100, 0)} %</strong>, n: de(base * 100, 0), x2: <strong class="tnum">{t("{n} Punkte", { n: de(then) })}</strong>, n2: de(now), x3: <span class={`tnum ${delta >= 0 ? "good" : "bad"}`}>
                    ({delta >= 0 ? "+" : "−"}
                    {de(Math.abs(delta))})
                  </span> })}
                </p>
                <button class="btn ghost small" onClick={() => setShare(null)}>
                  <IconReset />  {t("Zurück")}
                </button>
              </>
            ) : (
              <p>
                {tj("{x} deiner analysierten Partien bleiben ohne Patzer. {n}", { x: <strong>{de(base * 100, 0)} %</strong>, n: cost.clear ? t("Schieb den Regler und sieh, was mehr saubere Partien bringen würden.") : t("Der Abstand zwischen beiden Gruppen ist noch nicht belastbar; mit mehr analysierten Partien wird er es.") })}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ErrorSection({ deep, facts }: { deep: DeepInsights | null; facts: GameFact[] }) {
  return (
    <>
      <div class="span-12 sec-head" id="s-fehler">
        <div>
          <h2>{t("Fehler")}</h2>
          <p>{t("Wann, womit und in welcher Lage du patzt, und was es dich kostet.")}</p>
        </div>
      </div>
      {deep && <LensCard d={deep} />}
      {deep && <MapCard d={deep} />}
      <CostCard facts={facts} />
    </>
  );
}
