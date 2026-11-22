// A running training session. The app steps back (no sidebar, no tab bar):
// one position, one progress line, one way out. Between the parts of the
// daily plan and at the end Lucena takes the whole screen for a moment.
import { useEffect, useMemo, useState } from "preact/hooks";

import { type Exercise, type RepertoireExercise, sessionResult, streak } from "../../domain/training";
import { CountUp } from "../kit";
import { IconChevron, IconClose, IconPlay } from "../icons";
import { navigate } from "../router";
import { Stage } from "../stage/Stage";
import { PlayoutRunner, PuzzleRunner, RepertoireRunner } from "./Runners";
import { plural, type SessionSpec } from "./shared";
import type { TrainingState } from "./useTraining";
import { t, tj } from "../../i18n";

/**
 * Lines the player does not know yet start in learn mode with the book moves
 * shown: never solved, just failed, or an own opening that scores badly.
 */
function needsLearning(ex: RepertoireExercise, p: TrainingState["progress"][string] | undefined): boolean {
  if (!p || p.solved === 0 || p.box === 0) return true;
  return !ex.library && ex.score_pct !== null && ex.score_pct < 45 && p.box < 2;
}

/** While a session runs the shell hides its navigation, so nothing competes with the board. */
function useFocusMode(): void {
  useEffect(() => {
    document.documentElement.classList.add("focus-mode");
    window.scrollTo(0, 0);
    return () => document.documentElement.classList.remove("focus-mode");
  }, []);
}

export function Session({ spec, t: tk, onExit }: { spec: SessionSpec; t: TrainingState; onExit: () => void }) {
  useFocusMode();
  const parts = useMemo(() => spec.parts ?? [{ key: "all", title: spec.title, sub: "", ids: spec.ids }], [spec]);
  const exercises = useMemo(
    () => parts.flatMap((p) => p.ids.map((id) => ({ ex: tk.byId.get(id), part: p.key }))).filter((x): x is { ex: Exercise; part: string } => Boolean(x.ex)),
    [spec],
  );
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  // A short break between the parts of the daily session, so its structure is felt.
  const [pause, setPause] = useState<string | null>(null);
  const cur = exercises[index];
  const ex = cur?.ex;
  const partIndex = cur ? parts.findIndex((p) => p.key === cur.part) : parts.length;
  const staged = parts.length > 1;

  if (!ex) {
    const r = sessionResult(parts, results);
    const days = streak(tk.log, tk.today);
    const say = r.verdict === "none" ? t("Hier gibt es gerade nichts zu tun.") : r.verdict === "perfect" ? t("Perfekt. Alles auf Anhieb gelöst.") : r.verdict === "good" ? t("Geschafft. Das war eine starke Einheit.") : t("Geschafft. Genau dafür üben wir.");
    const titles = r.missed.map((id) => tk.byId.get(id)?.title).filter((s): s is string => Boolean(s));
    return (
      <Stage
        kicker={t("Lucena · Training")}
        mood={r.verdict === "perfect" || r.verdict === "good" ? "wow" : r.verdict === "mixed" ? "happy" : "think"}
        layout={r.done ? "split" : "center"}
        say={say}
        sub={
          r.done ? (
            <p>
              
              {tj("Du hast {x} auf Anhieb gelöst. {n}", { x: <strong>{t("{solved} von {n}", { solved: r.solved, n: plural(r.done, t("Aufgabe"), t("Aufgaben")) })}</strong>, n: r.missed.length ? t("Was nicht saß, frage ich morgen noch einmal, so bleibt es hängen.") : t("Ich frage sie in größeren Abständen wieder ab.") })}
            </p>
          ) : (
            <p>{t("Alle Aufgaben dieser Auswahl sind für heute erledigt.")}</p>
          )
        }
        onNext={onExit}
        onClose={onExit}
        closeLabel={t("Schließen")}
        actions={
          <>
            {r.done > 0 && (
              <button
                class="btn ghost"
                onClick={() => {
                  onExit();
                  navigate({ view: "training", tab: "fortschritt" });
                }}
              >
                
                {t("Fortschritt ansehen")}
              </button>
            )}
            <button class="btn primary" onClick={onExit}>
              
              {t("Zur Übersicht")}
            </button>
          </>
        }
      >
        {r.done > 0 && (
          <>
            <div class="stage-stats">
              <div class="stage-stat good">
                <b>
                  <CountUp value={r.solved} />
                </b>
                <span>{t("auf Anhieb gelöst")}</span>
              </div>
              <div class={`stage-stat${r.missed.length ? " bad" : ""}`}>
                <b>
                  <CountUp value={r.missed.length} />
                </b>
                <span>{r.missed.length === 1 ? t("kommt morgen wieder") : t("kommen morgen wieder")}</span>
              </div>
              <div class="stage-stat">
                <b>
                  <CountUp value={days} />
                </b>
                <span>{days === 1 ? t("Tag in Folge") : t("Tage in Folge")}</span>
              </div>
            </div>
            {staged && (
              <div class="stage-panel ts-sum">
                {r.parts.map((p) => (
                  <div key={p.key} class="ts-sum-row">
                    <span class="ts-sum-name">
                      <strong>{p.title}</strong>
                      {p.sub && <small>{p.sub}</small>}
                    </span>
                    <span class="ts-sum-bar" aria-hidden="true">
                      <i style={{ width: `${(p.solved / p.done) * 100}%` }} />
                    </span>
                    <span class="tnum ts-sum-n">
                      {p.solved} / {p.done}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {titles.length > 0 && (
              <p class="stage-note">
                
                {t("Morgen wieder dabei: {n}{n2}.", { n: titles.slice(0, 4).join(", "), n2: titles.length > 4 ? t(" und {0} weitere", { 0: titles.length - 4 }) : "" })}</p>
            )}
          </>
        )}
      </Stage>
    );
  }

  if (pause) {
    const p = parts.find((x) => x.key === pause)!;
    const before = parts[parts.indexOf(p) - 1];
    const prevIds = before ? before.ids.filter((id) => id in results) : [];
    const prevOk = prevIds.filter((id) => results[id]).length;
    const resume = () => setPause(null);
    return (
      <Stage
        kicker={t("Lucena · Teil {0} von {length}", { 0: parts.indexOf(p) + 1, length: parts.length })}
        mood="happy"
        layout="center"
        steps={parts.length}
        step={parts.indexOf(p)}
        say={t("Weiter mit: {title}", { title: p.title })}
        sub={
          <p>
            {before && prevIds.length ? (
              <>
                {tj("{title}: {x} auf Anhieb.", { title: before.title, x: <strong>{t("{prevOk} von {length}", { prevOk, length: prevIds.length })}</strong> })}{" "}
              </>
            ) : null}
            {t("{n}{n2}.", { n: p.sub ? `${p.sub}, ` : "", n2: plural(p.ids.length, t("Aufgabe"), t("Aufgaben")) })}</p>
        }
        onNext={resume}
        onClose={resume}
        closeLabel={t("Weiter")}
        actions={
          <button class="btn primary" onClick={resume}>
            <IconPlay />  {t("Weiter")}
          </button>
        }
      />
    );
  }

  const props = {
    onResult: (ok: boolean) => {
      setResults((r) => ({ ...r, [ex.id]: ok }));
      tk.record(ex, ok);
    },
    onNext: () => {
      const nxt = exercises[index + 1];
      if (nxt && staged && nxt.part !== cur.part) setPause(nxt.part);
      setIndex((i) => i + 1);
      window.scrollTo(0, 0);
    },
    nextLabel: index + 1 < exercises.length ? t("Nächste Aufgabe") : t("Fertig"),
  };
  const part = parts[partIndex];

  return (
    <div class="ts">
      <header class="ts-bar">
        <button class="btn ghost small ts-exit" onClick={onExit} title={t("Einheit beenden. Was du gelöst hast, bleibt gespeichert.")}>
          <IconClose /> <span>{t("Beenden")}</span>
        </button>
        <div class="ts-title">
          <strong>{spec.title}</strong>
          {staged && part && (
            <span>
              
              {t("Teil {n} von {length}", { n: partIndex + 1, length: parts.length })} <IconChevron /> {part.title}
            </span>
          )}
        </div>
        <span class="ts-count tnum" aria-label={t("Aufgabe {0} von {length}", { 0: index + 1, length: exercises.length })}>
          {index + 1}
          <small> / {exercises.length}</small>
        </span>
      </header>
      <div class="ts-track" role="progressbar" aria-valuemin={0} aria-valuemax={exercises.length} aria-valuenow={index} aria-label={t("Fortschritt der Einheit")}>
        {parts.map((p) => {
          const ids = p.ids.filter((id) => tk.byId.has(id));
          if (!ids.length) return null;
          return (
            <div key={p.key} class={`ts-part${p.key === cur.part ? " on" : ""}`} style={{ flexGrow: ids.length }}>
              <div class="ts-ticks">
                {ids.map((id) => (
                  <i key={id} class={id === ex.id ? "cur" : id in results ? (results[id] ? "ok" : "miss") : ""} />
                ))}
              </div>
              {staged && <span class="ts-part-name">{p.title}</span>}
            </div>
          );
        })}
      </div>
      <div class="ts-run">
        {ex.kind === "puzzle" && <PuzzleRunner key={ex.id} ex={ex} {...props} />}
        {ex.kind === "repertoire" && <RepertoireRunner key={ex.id} ex={ex} learn={needsLearning(ex, tk.progress[ex.id])} {...props} />}
        {ex.kind === "playout" && <PlayoutRunner key={ex.id} ex={ex} {...props} />}
      </div>
    </div>
  );
}
