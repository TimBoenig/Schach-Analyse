// The player picks which opening to drill: an own line (errors from the
// games already corrected) or one from the library. Openings are never
// assigned by the daily plan.
import { useState } from "preact/hooks";

import { openingLabel } from "../../domain/profile";
import { exerciseState, isMastered, OPENING_LIBRARY, type RepertoireExercise } from "../../domain/training";
import { IconPlay } from "../icons";
import { Ladder, plural, type StartSession, StateTag } from "./shared";
import type { TrainingState } from "./useTraining";
import { t } from "../../i18n";

type Source = "own" | "library";
type Side = "white" | "black";

export function OpeningPick({ t: tk, start }: { t: TrainingState; start: StartSession }) {
  const drills = tk.pool.filter((e): e is RepertoireExercise => e.kind === "repertoire");
  const own = drills.filter((d) => !d.library);
  const [source, setSource] = useState<Source>(own.length ? "own" : "library");
  const [color, setColor] = useState<Side>(own.some((d) => d.color === "white") || !own.length ? "white" : "black");
  const [picked, setPicked] = useState<string | null>(null);

  const switches = (
    <div class="op-switches">
      <div class="segmented" role="tablist" aria-label={t("Quelle")}>
        {(
          [
            ["own", t("Meine Eröffnungen ({length})", { length: own.length })],
            ["library", t("Bibliothek ({length})", { length: OPENING_LIBRARY.length })],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={source === k} class={source === k ? "active" : ""} onClick={() => setSource(k)}>
            {label}
          </button>
        ))}
      </div>
      <div class="segmented" role="tablist" aria-label={t("Farbe")}>
        {(["white", "black"] as const).map((c) => (
          <button key={c} role="tab" aria-selected={color === c} class={color === c ? "active" : ""} onClick={() => setColor(c)}>
            <i class={`op-side ${c}`} aria-hidden="true" /> {c === "white" ? t("Weiß") : t("Schwarz")}
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
        <p class="op-note">{t("Deine übliche Linie ab Zug 1. Fehler aus deinen Partien sind schon korrigiert. Läuft eine Eröffnung bei dir schlecht, zeige ich dir zuerst die Buchzüge.")}</p>
        {shown.length === 0 ? (
          <p class="tn-none">{t("Noch keine Linie mit dieser Farbe. Dafür braucht es mindestens zwei Partien mit derselben Eröffnung.")}</p>
        ) : (
          <div class="op-rows" role="listbox" aria-label={t("Eröffnung wählen")}>
            {shown.map((d) => {
              const p = tk.progress[d.id];
              return (
                <button key={d.id} role="option" aria-selected={chosen?.id === d.id} class={`op-row${chosen?.id === d.id ? " on" : ""}`} onClick={() => setPicked(d.id)}>
                  <span class="op-name">
                    <strong>{openingLabel(d.opening)}</strong>
                    <small class="tnum">
                      {t("{n}{n2}", { n: plural(d.games, t("Partie"), t("Partien")), n2: d.score_pct !== null ? t(" · {0} % der Punkte", { 0: Math.round(d.score_pct) }) : "" })}
                    </small>
                  </span>
                  <Ladder box={p?.box ?? 0} />
                  <StateTag state={exerciseState(p, tk.today)} />
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
                {t("{length} Halbzüge{n}", { length: chosen.moves.length, n: chosen.correction ? t(" · korrigiert: {best_san} statt {played_san}", { best_san: chosen.correction.best_san, played_san: chosen.correction.played_san }) : "" })}
              </small>
            </span>
            <button class="btn primary" onClick={() => start({ title: openingLabel(chosen.opening), ids: [chosen.id] })}>
              <IconPlay />  {t("Diese Eröffnung üben")}
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
          const sure = ids.filter((id) => isMastered(tk.progress[id])).length;
          return (
            <article key={o.key} class="op-card">
              <header>
                <strong>{o.name}</strong>
                <small>{t(o.group)}</small>
              </header>
              <p>{o.idea}</p>
              <details class="op-plans">
                <summary>{t("Pläne der Varianten")}</summary>
                {o.lines.map((l) => l.plan && (
                  <p key={l.name} class="small">
                    <strong>{l.name}:</strong> {l.plan}
                  </p>
                ))}
              </details>
              <div class="op-lines">
                {ids.map((id, i) => (
                  <button key={id} class="tn-row" onClick={() => start({ title: `${o.name}: ${o.lines[i].name}`, ids: [id] })}>
                    <span class="tn-row-title">
                      {o.lines[i].name}
                      <small class="muted tnum"> · {t("{n} Züge", { n: Math.ceil(o.lines[i].moves.split(" ").length / 2) })}</small>
                    </span>
                    <StateTag state={exerciseState(tk.progress[id], tk.today)} />
                  </button>
                ))}
              </div>
              <footer>
                <span class="tnum op-sure">
                  {t("{sure} von {length} sicher", { sure, length: ids.length })}</span>
                <button class="btn small" onClick={() => start({ title: o.name, ids })}>
                  <IconPlay /> {ids.length === 1 ? t("Linie lernen") : t("Alle {length} lernen", { length: ids.length })}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
