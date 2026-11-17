// Training, "Übungen": the whole pool as a library. The areas stand on the
// left with their fill level, the chosen one opens on the right with its
// numbers, one button that starts a set, and the single exercises below.
import { useState } from "preact/hooks";

import {
  CATEGORIES,
  type Category,
  type CategoryOverview,
  categoryOverview,
  dueExercises,
  estimateMinutes,
  type Exercise,
  exerciseState,
  LIBRARY_GROUPS,
  pickSession,
  poolTotals,
  SESSION_SIZE,
  startCategory,
} from "../../domain/training";
import { IconChevron, IconPlay } from "../icons";
import { CountUp, Foot } from "../kit";
import { CLASSIFICATION_DE } from "../labels";
import { useNarrow } from "../useNarrow";
import { SplitBar, Stat } from "../viz/Bars";
import { OpeningPick } from "./OpeningPick";
import { pct, plural, type StartSession, StateTag } from "./shared";
import type { TrainingState } from "./useTraining";

// Single exercises listed before "show all": enough to see what is in an area.
const ROWS = 8;

const fillParts = (c: { fresh: number; learning: number; mastered: number }) => [
  { key: "mastered", label: "Sicher", value: c.mastered, color: "var(--win)" },
  { key: "learning", label: "Im Aufbau", value: c.learning, color: "var(--accent)" },
  { key: "fresh", label: "Neu", value: c.fresh, color: "var(--surface-3)" },
];

const PHASE_DE: Record<string, string> = { opening: "in der Eröffnung", middlegame: "im Mittelspiel", endgame: "im Endspiel" };

/** One line under an exercise: when it happened and what kind of error it was. */
function sourceLine(e: Exercise): string {
  if (e.kind === "puzzle") {
    const kind = CLASSIFICATION_DE[e.classification as keyof typeof CLASSIFICATION_DE] ?? "";
    // Game dates come as 2026.11.12 or 2026-11-12, depending on the source.
    const date = e.date ? e.date.split(/[.-]/).reverse().join(".") : "";
    return [date, kind && `${kind} ${PHASE_DE[e.phase] ?? ""}`.trim()].filter(Boolean).join(" · ");
  }
  if (e.kind === "playout") return e.goal === "hold" ? "Gegen die Engine halten" : "Gegen die Engine zu Ende spielen";
  return "";
}

function Summary({ t, rows, start }: { t: TrainingState; rows: CategoryOverview[]; start: StartSession }) {
  const totals = poolTotals(rows);
  const due = dueExercises(t.pool, t.progress, t.today);
  return (
    <section class="card span-12 tx-sum">
      <Stat label="Übungen" value={<CountUp value={totals.total} />} sub="aus deinen Partien, deinen Eröffnungen und den Grundlagen">
        <SplitBar parts={fillParts(totals)} height={8} />
      </Stat>
      <Stat label="Neu" value={<CountUp value={totals.fresh} />} sub="noch nie versucht" />
      <Stat label="Im Aufbau" value={<CountUp value={totals.learning} />} sub="versucht, noch nicht sicher" />
      <Stat label="Sicher" value={<CountUp value={totals.mastered} />} sub="dreimal in Folge auf Anhieb" tone={totals.mastered ? "good" : undefined} />
      <Stat label="Heute fällig" value={<CountUp value={due.length} />} sub={due.length ? "Wiederholungen, die älteste zuerst" : "nichts offen"}>
        {due.length > 0 && (
          <button class="btn small primary" onClick={() => start({ title: "Fällige Wiederholungen", ids: due.slice(0, SESSION_SIZE) })}>
            <IconPlay /> {due.length > SESSION_SIZE ? `${SESSION_SIZE} wiederholen` : "Wiederholen"}
          </button>
        )}
      </Stat>
    </section>
  );
}

function AreaList({ rows, selected, onSelect }: { rows: CategoryOverview[]; selected: Category; onSelect: (c: Category) => void }) {
  const by = new Map(rows.map((r) => [r.category, r]));
  return (
    <nav class="card span-4 tx-areas" aria-label="Bereiche">
      {LIBRARY_GROUPS.map((g) => (
        <div key={g.key} class="tx-group">
          <span class="eyebrow">{g.label}</span>
          {g.categories.map((c) => {
            const r = by.get(c)!;
            return (
              <button key={c} class={`tx-area${selected === c ? " on" : ""}${r.total ? "" : " empty"}`} aria-current={selected === c ? "true" : undefined} onClick={() => onSelect(c)}>
                <span class="tx-area-name">
                  <strong>{CATEGORIES[c].label}</strong>
                  {r.due > 0 && <span class="tx-due tnum">{r.due} fällig</span>}
                </span>
                <span class="tx-area-n tnum">{r.total}</span>
                <span class="tx-area-bar">
                  <SplitBar parts={fillParts(r)} height={4} />
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function AreaDetail({ t, row, start }: { t: TrainingState; row: CategoryOverview; start: StartSession }) {
  const c = row.category;
  const info = CATEGORIES[c];
  const [all, setAll] = useState(false);
  // Library lines have their own picker; listing all of them here would bury the player's own lines.
  const items = t.pool.filter((e) => e.category === c && !(e.kind === "repertoire" && e.library));
  const order = pickSession(items, t.progress, t.today, items.length);
  const byId = new Map(items.map((e) => [e.id, e]));
  const set = order.slice(0, SESSION_SIZE);
  const playouts = items.filter((e) => e.kind === "playout").length;
  const shown = (all ? order : order.slice(0, ROWS)).map((id) => byId.get(id)!);

  return (
    <section class="card span-8 tx-detail" id={`cat-${c}`} key={c}>
      <header class="card-head">
        <div>
          <h3>{info.label}</h3>
          <p class="card-sub">
            {info.text}
            {c !== "basics" && playouts > 0 ? ` Davon ${plural(playouts, "Stellung", "Stellungen")} zum Ausspielen gegen die Engine.` : ""}
          </p>
        </div>
        {row.rate !== null && (
          <span class="card-tag tnum" title={`${row.solved} von ${row.attempts} Versuchen auf Anhieb gelöst`}>
            {pct(row.rate)} auf Anhieb
          </span>
        )}
      </header>

      {c === "repertoire" ? (
        <OpeningPick t={t} start={start} />
      ) : row.total === 0 ? (
        <p class="tn-none">Noch keine passenden Stellungen. Sie kommen dazu, sobald mehr Partien analysiert sind.</p>
      ) : (
        <>
          <div class="tx-go">
            <div class="tx-fill">
              <SplitBar parts={fillParts(row)} height={10} />
              <span class="tx-fill-legend tnum">
                <span>
                  <i style={{ background: "var(--win)" }} /> {row.mastered} sicher
                </span>
                <span>
                  <i style={{ background: "var(--accent)" }} /> {row.learning} im Aufbau
                </span>
                <span>
                  <i style={{ background: "var(--surface-3)" }} /> {row.fresh} neu
                </span>
              </span>
            </div>
            <button class="btn primary big" onClick={() => start({ title: info.label, ids: set })}>
              <IconPlay /> {c === "basics" ? "Alle der Reihe nach" : `${plural(set.length, "Aufgabe", "Aufgaben")} üben`}
              <small class="tnum">ca. {estimateMinutes(set, t.byId)} Min</small>
            </button>
          </div>
          <div class="tx-list">
            <span class="eyebrow">{c === "basics" ? "Lehrstellungen" : row.due ? "Als Nächstes dran: fällige zuerst, dann neue" : "Als Nächstes dran"}</span>
            {shown.map((e) => {
              const line = sourceLine(e);
              return (
                <button key={e.id} class="tn-row" onClick={() => start({ title: info.label, ids: [e.id] })}>
                  <span class="tn-row-title">
                    {e.title}
                    {line && <small>{line}</small>}
                  </span>
                  <StateTag state={exerciseState(t.progress[e.id], t.today)} />
                  <IconChevron />
                </button>
              );
            })}
            {order.length > ROWS && (
              <button class="btn small ghost tx-more" onClick={() => setAll(!all)}>
                {all ? "Weniger zeigen" : `Alle ${order.length} zeigen`}
              </button>
            )}
          </div>
        </>
      )}
      {c !== "repertoire" && row.total > 0 && (
        <Foot label="Wann gilt eine Übung als sicher?">
          Wenn du sie dreimal hintereinander auf Anhieb gelöst hast. Danach kommt sie nur noch in großen Abständen wieder (nach 1, 3, 7, 14 und 30 Tagen). Ein Fehler setzt sie zurück
          auf morgen.
        </Foot>
      )}
    </section>
  );
}

export function LibraryPage({ t, start, initial }: { t: TrainingState; start: StartSession; initial?: string }) {
  const rows = categoryOverview(t.pool, t.progress, t.today);
  const [picked, setPicked] = useState<Category | null>(null);
  const narrow = useNarrow();
  const selected = picked ?? startCategory(rows, initial);
  const row = rows.find((r) => r.category === selected)!;
  const select = (c: Category) => {
    setPicked(c);
    // On a phone the detail sits below the list: bring it into view.
    if (narrow) requestAnimationFrame(() => document.getElementById(`cat-${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div class="dash tn">
      <Summary t={t} rows={rows} start={start} />
      <AreaList rows={rows} selected={selected} onSelect={select} />
      <AreaDetail t={t} row={row} start={start} />
    </div>
  );
}
