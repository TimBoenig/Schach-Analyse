// The statistic you can play with: pick the conditions of a game and see how
// you score under them. It reads the profile's game facts, so it answers at once.
import { useMemo, useState } from "preact/hooks";

import { trSpeed } from "../../domain/i18n";
import {
  type ConditionPick,
  conditionResult,
  conditionValues,
  DAYPARTS,
  evidence,
  type GameFact,
  OPP_BANDS,
  OPP_GAP,
  standoutCondition,
} from "../../domain/profile";
import { IconReset, IconSpark } from "../icons";
import { ChoiceChips, CountUp, WdlBar } from "../kit";

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
