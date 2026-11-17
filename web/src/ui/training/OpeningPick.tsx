// The player picks which opening to drill: an own line (errors from the
// games already corrected) or one from the library. Openings are never
// assigned by the daily plan.
import { useState } from "preact/hooks";

import { openingLabel } from "../../domain/profile";
import { exerciseState, isMastered, OPENING_LIBRARY, type RepertoireExercise } from "../../domain/training";
import { IconPlay } from "../icons";
import { Ladder, plural, type StartSession, StateTag } from "./shared";
import type { TrainingState } from "./useTraining";

type Source = "own" | "library";
type Side = "white" | "black";

export function OpeningPick({ t, start }: { t: TrainingState; start: StartSession }) {
  const drills = t.pool.filter((e): e is RepertoireExercise => e.kind === "repertoire");
  const own = drills.filter((d) => !d.library);
  const [source, setSource] = useState<Source>(own.length ? "own" : "library");
  const [color, setColor] = useState<Side>(own.some((d) => d.color === "white") || !own.length ? "white" : "black");
  const [picked, setPicked] = useState<string | null>(null);

  const switches = (
    <div class="op-switches">
      <div class="segmented" role="tablist" aria-label="Quelle">
        {(
          [
            ["own", `Meine Eröffnungen (${own.length})`],
            ["library", `Bibliothek (${OPENING_LIBRARY.length})`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={source === k} class={source === k ? "active" : ""} onClick={() => setSource(k)}>
            {label}
          </button>
        ))}
      </div>
      <div class="segmented" role="tablist" aria-label="Farbe">
        {(["white", "black"] as const).map((c) => (
          <button key={c} role="tab" aria-selected={color === c} class={color === c ? "active" : ""} onClick={() => setColor(c)}>
            <i class={`op-side ${c}`} aria-hidden="true" /> {c === "white" ? "Weiß" : "Schwarz"}
          </button>
        ))}
      </div>
    </div>
  );

  if (source === "own") {
    const shown = own.filter((d) => d.color === color);
    const chosen = shown.find((d) => d.id === picked) ?? shown[0];
    return (
      <div class="op">
        {switches}
        <p class="op-note">Deine übliche Linie ab Zug 1. Fehler aus deinen Partien sind schon korrigiert. Läuft eine Eröffnung bei dir schlecht, zeige ich dir zuerst die Buchzüge.</p>
        {shown.length === 0 ? (
          <p class="tn-none">Noch keine Linie mit dieser Farbe. Dafür braucht es mindestens zwei Partien mit derselben Eröffnung.</p>
        ) : (
          <div class="op-rows" role="listbox" aria-label="Eröffnung wählen">
            {shown.map((d) => {
              const p = t.progress[d.id];
              return (
                <button key={d.id} role="option" aria-selected={chosen?.id === d.id} class={`op-row${chosen?.id === d.id ? " on" : ""}`} onClick={() => setPicked(d.id)}>
                  <span class="op-name">
                    <strong>{openingLabel(d.opening)}</strong>
                    <small class="tnum">
                      {plural(d.games, "Partie", "Partien")}
                      {d.score_pct !== null ? ` · ${Math.round(d.score_pct)} % der Punkte` : ""}
                    </small>
                  </span>
                  <Ladder box={p?.box ?? 0} />
                  <StateTag state={exerciseState(p, t.today)} />
                </button>
              );
            })}
          </div>
        )}
        {chosen && (
          <div class="op-go">
            <span class="op-go-text">
              <strong>{openingLabel(chosen.opening)}</strong>
              <small>
                {chosen.moves.length} Halbzüge
                {chosen.correction ? ` · korrigiert: ${chosen.correction.best_san} statt ${chosen.correction.played_san}` : ""}
              </small>
            </span>
            <button class="btn primary" onClick={() => start({ title: openingLabel(chosen.opening), ids: [chosen.id] })}>
              <IconPlay /> Diese Eröffnung üben
            </button>
          </div>
        )}
      </div>
    );
  }

  const openings = OPENING_LIBRARY.filter((o) => o.color === color);
  const lib = new Map(drills.filter((d) => d.library).map((d) => [d.id, d]));
  return (
    <div class="op">
      {switches}
      <div class="op-lib">
        {openings.map((o) => {
          const ids = o.lines.map((_, i) => `lib:${o.key}:${i}`).filter((id) => lib.has(id));
          const sure = ids.filter((id) => isMastered(t.progress[id])).length;
          return (
            <article key={o.key} class="op-card">
              <header>
                <strong>{o.name}</strong>
                <small>{o.group}</small>
              </header>
              <p>{o.idea}</p>
              <div class="op-lines">
                {ids.map((id, i) => (
                  <button key={id} class="tn-row" onClick={() => start({ title: `${o.name}: ${o.lines[i].name}`, ids: [id] })}>
                    <span class="tn-row-title">{o.lines[i].name}</span>
                    <StateTag state={exerciseState(t.progress[id], t.today)} />
                  </button>
                ))}
              </div>
              <footer>
                <span class="tnum op-sure">
                  {sure} von {ids.length} sicher
                </span>
                <button class="btn small" onClick={() => start({ title: o.name, ids })}>
                  <IconPlay /> {ids.length === 1 ? "Linie lernen" : `Alle ${ids.length} lernen`}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
