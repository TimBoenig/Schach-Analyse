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
import { t, tj } from "../../i18n";

// Single exercises listed before "show all": enough to see what is in an area.
const ROWS = 8;

const fillParts = (c: { fresh: number; learning: number; mastered: number }) => [
  { key: "mastered", label: t("Sicher"), value: c.mastered, color: "var(--win)" },
  { key: "learning", label: t("Im Aufbau"), value: c.learning, color: "var(--accent)" },
  { key: "fresh", label: t("Neu"), value: c.fresh, color: "var(--surface-3)" },
];

const PHASE_DE: Record<string, string> = { opening: t("in der Eröffnung"), middlegame: t("im Mittelspiel"), endgame: t("im Endspiel") };

/** One line under an exercise: when it happened and what kind of error it was. */
function sourceLine(e: Exercise): string {
  if (e.kind === "puzzle") {
    const kind = CLASSIFICATION_DE[e.classification as keyof typeof CLASSIFICATION_DE] ?? "";
    // Game dates come as 2026.11.12 or 2026-11-12, depending on the source.
    const date = e.date ? e.date.split(/[.-]/).reverse().join(".") : "";
    return [date, kind && `${kind} ${PHASE_DE[e.phase] ?? ""}`.trim()].filter(Boolean).join(" · ");
  }
  if (e.kind === "playout") return e.goal === "hold" ? t("Gegen die Engine halten") : t("Gegen die Engine zu Ende spielen");
  return "";
}

function Summary({ t: tk, rows, start }: { t: TrainingState; rows: CategoryOverview[]; start: StartSession }) {
  const totals = poolTotals(rows);
  const due = dueExercises(tk.pool, tk.progress, tk.today);
  return (
    <section class="card span-12 tx-sum">
      <Stat label={t("Übungen")} value={<CountUp value={totals.total} />} sub={t("aus deinen Partien, deinen Eröffnungen und den Grundlagen")}>
        <SplitBar parts={fillParts(totals)} height={8} />
      </Stat>
      <Stat label={t("Neu")} value={<CountUp value={totals.fresh} />} sub={t("noch nie versucht")} />
      <Stat label={t("Im Aufbau")} value={<CountUp value={totals.learning} />} sub={t("versucht, noch nicht sicher")} />
      <Stat label={t("Sicher")} value={<CountUp value={totals.mastered} />} sub={t("dreimal in Folge auf Anhieb")} tone={totals.mastered ? "good" : undefined} />
      <Stat label={t("Heute fällig")} value={<CountUp value={due.length} />} sub={due.length ? t("Wiederholungen, die älteste zuerst") : t("nichts offen")}>
        {due.length > 0 && (
          <button class="btn small primary" onClick={() => start({ title: t("Fällige Wiederholungen"), ids: due.slice(0, SESSION_SIZE) })}>
            <IconPlay /> {due.length > SESSION_SIZE ? t("{SESSION_SIZE} wiederholen", { SESSION_SIZE }) : t("Wiederholen")}
          </button>
        )}
      </Stat>
    </section>
  );
}

function AreaList({ rows, selected, onSelect }: { rows: CategoryOverview[]; selected: Category; onSelect: (c: Category) => void }) {
  const by = new Map(rows.map((r) => [r.category, r]));
  return (
    <nav class="card span-4 tx-areas" aria-label={t("Bereiche")}>
      {LIBRARY_GROUPS.map((g) => (
        <div key={g.key} class="tx-group">
          <span class="eyebrow">{g.label}</span>
          {g.categories.map((c) => {
            const r = by.get(c)!;
            return (
              <button key={c} class={`tx-area${selected === c ? " on" : ""}${r.total ? "" : " empty"}`} aria-current={selected === c ? "true" : undefined} onClick={() => onSelect(c)}>
                <span class="tx-area-name">
                  <strong>{CATEGORIES[c].label}</strong>
                  {r.due > 0 && <span class="tx-due tnum">{t("{due} fällig", { due: r.due })}</span>}
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

function AreaDetail({ t: tk, row, start }: { t: TrainingState; row: CategoryOverview; start: StartSession }) {
  const c = row.category;
  const info = CATEGORIES[c];
  const [all, setAll] = useState(false);
  // Library lines have their own picker; listing all of them here would bury the player's own lines.
  const items = tk.pool.filter((e) => e.category === c && !(e.kind === "repertoire" && e.library));
  const order = pickSession(items, tk.progress, tk.today, items.length);
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
            {t("{text}{n}", { text: info.text, n: c !== "basics" && playouts > 0 ? t(" Davon {plural} zum Ausspielen gegen die Engine.", { plural: plural(playouts, t("Stellung"), t("Stellungen")) }) : "" })}
          </p>
        </div>
        {row.rate !== null && (
          <span class="card-tag tnum" title={t("{solved} von {attempts} Versuchen auf Anhieb gelöst", { solved: row.solved, attempts: row.attempts })}>
            {t("{n} auf Anhieb", { n: pct(row.rate) })}
          </span>
        )}
      </header>

      {c === "repertoire" ? (
        <OpeningPick t={tk} start={start} />
      ) : row.total === 0 ? (
        <p class="tn-none">{t("Noch keine passenden Stellungen. Sie kommen dazu, sobald mehr Partien analysiert sind.")}</p>
      ) : (
        <>
          <div class="tx-go">
            <div class="tx-fill">
              <SplitBar parts={fillParts(row)} height={10} />
              <span class="tx-fill-legend tnum">
                <span>
                  <i style={{ background: "var(--win)" }} /> {t("{mastered} sicher", { mastered: row.mastered })}</span>
                <span>
                  <i style={{ background: "var(--accent)" }} /> {t("{learning} im Aufbau", { learning: row.learning })}
                </span>
                <span>
                  <i style={{ background: "var(--surface-3)" }} /> {t("{fresh} neu", { fresh: row.fresh })}</span>
              </span>
            </div>
            <button class="btn primary big" onClick={() => start({ title: info.label, ids: set })}>
              <IconPlay /> {tj("{n}{x}", { n: c === "basics" ? t("Alle der Reihe nach") : t("{plural} üben", { plural: plural(set.length, t("Aufgabe"), t("Aufgaben")) }), x: <small class="tnum">{t("ca. {estimateMinutes} Min", { estimateMinutes: estimateMinutes(set, tk.byId) })}</small> })}
            </button>
          </div>
          <div class="tx-list">
            <span class="eyebrow">{c === "basics" ? t("Lehrstellungen") : row.due ? t("Als Nächstes dran: fällige zuerst, dann neue") : t("Als Nächstes dran")}</span>
            {shown.map((e) => {
              const line = sourceLine(e);
              return (
                <button key={e.id} class="tn-row" onClick={() => start({ title: info.label, ids: [e.id] })}>
                  <span class="tn-row-title">
                    {e.title}
                    {line && <small>{line}</small>}
                  </span>
                  <StateTag state={exerciseState(tk.progress[e.id], tk.today)} />
                  <IconChevron />
                </button>
              );
            })}
            {order.length > ROWS && (
              <button class="btn small ghost tx-more" onClick={() => setAll(!all)}>
                {all ? t("Weniger zeigen") : t("Alle {length} zeigen", { length: order.length })}
              </button>
            )}
          </div>
        </>
      )}
      {c !== "repertoire" && row.total > 0 && (
        <Foot label={t("Wann gilt eine Übung als sicher?")}>
          
          {t("Wenn du sie dreimal hintereinander auf Anhieb gelöst hast. Danach kommt sie nur noch in großen Abständen wieder (nach 1, 3, 7, 14 und 30 Tagen). Ein Fehler setzt sie zurück auf morgen.")}
        </Foot>
      )}
    </section>
  );
}

export function LibraryPage({ t: tk, start, initial }: { t: TrainingState; start: StartSession; initial?: string }) {
  const rows = categoryOverview(tk.pool, tk.progress, tk.today);
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
      <Summary t={tk} rows={rows} start={start} />
      <AreaList rows={rows} selected={selected} onSelect={select} />
      <AreaDetail t={tk} row={row} start={start} />
    </div>
  );
}
