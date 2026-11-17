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
  { key: "number", tab: "Zugnummer", name: (l) => `in den Zügen ${l}`, note: "Buchzüge zählen nicht mit.", buckets: (d) => d.by_move_number },
  { key: "piece", tab: "Figur", name: (l) => `bei der Figur ${l}`, note: "Gezählt wird die Figur, die du gezogen hast.", buckets: (d) => d.by_piece },
  // The label carries its threshold in brackets ("Klar besser (ab 70 %)"); the sentence needs only the name.
  { key: "situation", tab: "Stellungslage", name: (l) => `in der Lage „${l.split(" (")[0]}“`, note: "Die Lage ist deine Gewinnchance vor dem Zug, aus deiner Sicht.", buckets: (d) => d.by_situation },
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
          <h3>Wo deine Fehler passieren</h3>
          <p class="card-sub">Grobe Fehler je 100 Züge.</p>
        </div>
        <div class="segmented small-seg" role="group" aria-label="Aufteilung">
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
                  {b.errors} in {plural(b.moves, "Zug", "Zügen")}
                </small>
              </div>
            );
          })}
        </div>
      ) : (
        <p class="tn-none">Dafür fehlen noch analysierte Züge.</p>
      )}
      {buckets.length > 0 && (
        <p class="mv-lens-say">
          {high ? (
            <>
              <b class="bad">Klar am meisten</b> {lens.name(high.bucket.label)}: {de(high.per_100)} je 100 Züge, sonst {de(high.rest_per_100)}.{" "}
            </>
          ) : null}
          {low ? (
            <>
              <b class="good">Klar am wenigsten</b> {lens.name(low.bucket.label)}: {de(low.per_100)}, sonst {de(low.rest_per_100)}.
            </>
          ) : null}
          {!high && !low ? "Hier hebt sich nichts klar ab: die Unterschiede zwischen den Zeilen könnten Zufall sein." : null}
        </p>
      )}
      <Foot>
        Grobe Fehler sind Fehler, verpasste Chancen und Patzer. {lens.note} Farbig wird eine Zeile nur, wenn ihr Abstand zu allen anderen zusammen kein Zufall sein kann; blasse Zeilen beruhen auf
        weniger als {MIN_BUCKET_MOVES} Zügen.
      </Foot>
    </section>
  );
}

function MapCard({ d }: { d: DeepInsights }) {
  return (
    <section class="card span-5 mv-map">
      <header class="card-head">
        <div>
          <h3>Fehler-Landkarte</h3>
          <p class="card-sub">Auf welchen Feldern deine groben Fehler landen.</p>
        </div>
        <span class="card-tag tnum">{plural(d.error_total, "Fehler", "Fehler")}</span>
      </header>
      <div class="mv-map-board">
        <SquareHeatmap values={d.error_squares} />
      </div>
      {d.hot_squares.length > 0 && (
        <p class="mv-map-say">
          Am häufigsten:{" "}
          {d.hot_squares.map((h, i) => (
            <span key={h.square}>
              {i > 0 ? ", " : ""}
              <strong>{h.square}</strong> ({h.count})
            </span>
          ))}
          . Gezählt wird das Zielfeld deines Zuges.
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
          <h3>Was dich Patzer kosten</h3>
          <p class="card-sub">Deine Punkte in Partien ohne Patzer und in Partien mit mindestens einem.</p>
        </div>
        {cost.clear && (
          <span class="card-tag tnum">
            −{de(cost.clean.score_pct - cost.dirty.score_pct, 0)} Prozentpunkte
          </span>
        )}
      </header>
      <div class="mv-cost-body">
        <div class="mv-cost-rows">
          <div class="mv-cost-row">
            <span>Ohne Patzer</span>
            <Level value={cost.clean.score_pct} tone="good" />
            <b class="tnum">{de(cost.clean.score_pct, 0)} %</b>
            <small class="tnum">{plural(cost.clean.games, "Partie", "Partien")}</small>
          </div>
          <div class="mv-cost-row">
            <span>Mit Patzer</span>
            <Level value={cost.dirty.score_pct} tone="bad" />
            <b class="tnum">{de(cost.dirty.score_pct, 0)} %</b>
            <small class="tnum">{plural(cost.dirty.games, "Partie", "Partien")}</small>
          </div>
        </div>
        <div class="mv-cost-try">
          <WhatIfSlider
            label="Partien ohne Patzer"
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
                  Bleiben <strong>{de(value * 100, 0)} %</strong> statt {de(base * 100, 0)} % deiner Partien ohne Patzer, holst du aus 100 Partien{" "}
                  <strong class="tnum">{de(then)} Punkte</strong> statt {de(now)}{" "}
                  <span class={`tnum ${delta >= 0 ? "good" : "bad"}`}>
                    ({delta >= 0 ? "+" : "−"}
                    {de(Math.abs(delta))})
                  </span>
                  , wenn beide Arten von Partien so ausgehen wie bisher.
                </p>
                <button class="btn ghost small" onClick={() => setShare(null)}>
                  <IconReset /> Zurück
                </button>
              </>
            ) : (
              <p>
                <strong>{de(base * 100, 0)} %</strong> deiner analysierten Partien bleiben ohne Patzer.{" "}
                {cost.clear ? "Schieb den Regler und sieh, was mehr saubere Partien bringen würden." : "Der Abstand zwischen beiden Gruppen ist noch nicht belastbar; mit mehr analysierten Partien wird er es."}
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
          <h2>Fehler</h2>
          <p>Wann, womit und in welcher Lage du patzt, und was es dich kostet.</p>
        </div>
      </div>
      {deep && <LensCard d={deep} />}
      {deep && <MapCard d={deep} />}
      <CostCard facts={facts} />
    </>
  );
}
