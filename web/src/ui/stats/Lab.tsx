// The statistics you can play with: pick the conditions of a game and see how
// you score under them, and push the share of blunder-free games to see what
// blunders cost. Both read the profile's game facts, so they answer at once.
import { useMemo, useState } from "preact/hooks";

import { trSpeed } from "../../domain/i18n";
import {
  type BlunderCost,
  blunderCost,
  type ConditionPick,
  conditionResult,
  conditionValues,
  DAYPARTS,
  evidence,
  type GameFact,
  OPP_BANDS,
  OPP_GAP,
  pointsAtCleanShare,
  standoutCondition,
} from "../../domain/profile";
import { IconReset, IconSpark } from "../icons";
import { ChoiceChips, CountUp, Meter, WdlBar, WhatIfSlider } from "../kit";

const de = (v: number, digits = 0) => v.toFixed(digits).replace(".", ",");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const COLOR_LABEL = { white: "Weiß", black: "Schwarz" } as const;

/** The picked conditions in words, e.g. "Mit Weiß · Blitz · abends · gegen Stärkere". */
function pickText(pick: ConditionPick): string {
  const parts: string[] = [];
  if (pick.color) parts.push(`mit ${COLOR_LABEL[pick.color]}`);
  if (pick.speed) parts.push(trSpeed(pick.speed));
  if (pick.daypart) parts.push(DAYPARTS.find((d) => d.key === pick.daypart)!.label.toLowerCase());
  if (pick.opp) parts.push(`gegen ${OPP_BANDS.find((b) => b.key === pick.opp)!.label}`);
  return parts.join(" · ");
}

export function ConditionFinder({ facts }: { facts: GameFact[] }) {
  const [pick, setPick] = useState<ConditionPick>({});
  const [note, setNote] = useState("");
  const result = useMemo(() => conditionResult(facts, pick), [facts, pick]);
  const speeds = conditionValues(facts, "speed");
  const dayparts = new Set(conditionValues(facts, "daypart"));
  const bands = new Set(conditionValues(facts, "opp"));
  const active = Object.values(pick).some(Boolean);
  const set = (patch: ConditionPick) => {
    setNote("");
    setPick({ ...pick, ...patch });
  };
  const standout = (direction: 1 | -1) => {
    const found = standoutCondition(facts, direction);
    setPick(found?.pick ?? {});
    setNote(found ? "" : `Keine Lage hebt sich klar vom Rest ab. Dafür braucht es mindestens ${evidence.MIN_GROUP_GAMES} Partien je Lage und einen Abstand, der kein Zufall sein kann.`);
  };

  const gap = result.score_pct !== null && result.rest_pct !== null ? result.score_pct - result.rest_pct : null;
  const verdict =
    !active || result.score_pct === null
      ? null
      : result.verdict === 1
        ? { cls: "pos", text: "Klar besser als sonst." }
        : result.verdict === -1
          ? { cls: "neg", text: "Klar schlechter als sonst." }
          : result.verdict === 0
            ? { cls: "", text: "Der Abstand zu sonst kann Zufall sein." }
            : { cls: "", text: `Zu wenige Partien für ein Urteil (ab ${evidence.MIN_GROUP_GAMES} je Seite).` };

  return (
    <div class="ar-block finder">
      <div class="ar-block-head">
        <strong>Wann spielst du am besten?</strong>
        <span class="faint small">Lage zusammenstellen und live sehen, wie du dann punktest</span>
      </div>
      <div class="finder-grid">
        <div class="finder-picks">
          <ChoiceChips label="Farbe" value={pick.color ?? null} onChange={(color) => set({ color })} options={(["white", "black"] as const).map((c) => ({ key: c, label: COLOR_LABEL[c] }))} />
          {speeds.length > 1 && <ChoiceChips label="Bedenkzeit" value={pick.speed ?? null} onChange={(speed) => set({ speed })} options={speeds.map((s) => ({ key: s, label: trSpeed(s) }))} />}
          {dayparts.size > 1 && (
            <ChoiceChips label="Tageszeit" value={pick.daypart ?? null} onChange={(daypart) => set({ daypart })} options={DAYPARTS.filter((d) => dayparts.has(d.key)).map((d) => ({ key: d.key, label: d.label }))} />
          )}
          {bands.size > 1 && (
            <ChoiceChips label="Gegner" value={pick.opp ?? null} onChange={(opp) => set({ opp })} options={OPP_BANDS.filter((b) => bands.has(b.key)).map((b) => ({ key: b.key, label: b.label }))} />
          )}
          <div class="finder-auto">
            <button class="btn small" onClick={() => standout(1)}>
              <IconSpark /> Meine beste Lage
            </button>
            <button class="btn small" onClick={() => standout(-1)}>
              Meine schwächste Lage
            </button>
            {active && (
              <button class="btn ghost small" onClick={() => set({ color: null, speed: null, daypart: null, opp: null })}>
                <IconReset /> Zurück
              </button>
            )}
          </div>
        </div>
        <div class={`finder-result${active ? " on" : ""}`} role="status">
          <span class="kpi-label">{active ? pickText(pick) : "Alle Partien"}</span>
          <span class="finder-score">
            <CountUp value={result.score_pct} format={(v) => `${Math.round(v)} %`} />
            {gap !== null && active && <span class={`lg-slider-delta ${gap >= 0 ? "up" : "down"}`}>{gap >= 0 ? "+" : "−"}{de(Math.abs(gap))} zu sonst</span>}
          </span>
          <WdlBar wins={result.wins} draws={result.draws} losses={result.losses} />
          <span class="small muted">
            {result.games ? `${plural(result.games, "Partie", "Partien")}: ${result.wins} S · ${result.draws} R · ${result.losses} N` : "Keine Partie in dieser Lage."}
            {result.range && active ? ` · wahrscheinlich ${de(result.range[0])}–${de(result.range[1])} %` : ""}
          </span>
          {verdict && <strong class={`small ${verdict.cls}`}>{verdict.text}</strong>}
          {note && <span class="small muted">{note}</span>}
        </div>
      </div>
      <p class="faint small finder-foot">
        Stärkere und Schwächere: ab {OPP_GAP} Wertungspunkten Abstand. Verglichen wird immer mit allen übrigen Partien.
      </p>
    </div>
  );
}

const SLIDER_ROOM = 0.3;

/** What a blunder-free game is worth: both scores side by side and a slider on their mix. */
export function BlunderCostBlock({ facts }: { facts: GameFact[] }) {
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
    <div class="ar-block blunder-cost">
      <div class="ar-block-head">
        <strong>Was kosten dich Patzer?</strong>
        <span class="faint small">Punkte in Partien ohne und mit Patzer</span>
      </div>
      <div class="cost-rows">
        <div class="cost-row">
          <span>Ohne Patzer</span>
          <Meter value={cost.clean.score_pct} tone="tone-win" />
          <strong class="tnum">{de(cost.clean.score_pct)} %</strong>
          <span class="faint small">{plural(cost.clean.games, "Partie", "Partien")}</span>
        </div>
        <div class="cost-row">
          <span>Mit Patzer</span>
          <Meter value={cost.dirty.score_pct} tone="tone-loss" />
          <strong class="tnum">{de(cost.dirty.score_pct)} %</strong>
          <span class="faint small">{plural(cost.dirty.games, "Partie", "Partien")}</span>
        </div>
      </div>
      <div class="lg-sliders one">
        <WhatIfSlider
          label="Partien ohne Patzer"
          value={value}
          base={base}
          min={Math.max(0, Math.round((base - SLIDER_ROOM) * 100) / 100)}
          max={1}
          step={0.01}
          text={`${de(value * 100)} %`}
          deltaText={`${value >= base ? "+" : "−"}${de(Math.abs(value - base) * 100)}`}
          good={value > base}
          onInput={(v) => setShare(Math.abs(v - base) < 0.005 ? null : v)}
        />
      </div>
      <div class={`ar-answer${moved ? " on" : ""}`} role="status">
        {moved ? (
          <>
            <p>
              Bleiben <strong>{de(value * 100)} %</strong> statt {de(base * 100)} % deiner Partien ohne Patzer, holst du aus 100 Partien{" "}
              <strong class="tnum">{de(then)} Punkte</strong> statt {de(now)} <span class={`tnum ${delta >= 0 ? "pos" : "neg"}`}>({delta >= 0 ? "+" : "−"}{de(Math.abs(delta), 1)})</span>, wenn beide Arten von Partien so ausgehen wie bisher.
            </p>
            <button class="btn ghost small" onClick={() => setShare(null)}>
              <IconReset /> Zurück
            </button>
          </>
        ) : (
          <p>
            <strong>{de(base * 100)} %</strong> deiner analysierten Partien bleiben ohne Patzer.{" "}
            {cost.clear
              ? `Ein Patzer kostet dich im Schnitt ${de(cost.clean.score_pct - cost.dirty.score_pct)} Prozentpunkte. Schieb den Regler und sieh, was mehr saubere Partien bringen.`
              : "Der Abstand zwischen beiden ist noch nicht belastbar; mit mehr analysierten Partien wird er es."}
          </p>
        )}
      </div>
    </div>
  );
}
