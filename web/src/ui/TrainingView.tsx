import { useMemo, useState } from "preact/hooks";

import { openingLabel } from "../domain/profile";
import {
  addDays,
  CATEGORIES,
  CATEGORY_ORDER,
  type Category,
  categoryProgress,
  type Exercise,
  interleave,
  isDue,
  isMastered,
  MINUTE_CHOICES,
  type Direction,
  openingProgress,
  type PlanBlock,
  trainingTrends,
  TREND_MIN_ATTEMPTS,
  weeklyRates,
  type RepertoireExercise,
  retention,
  streak,
  themeLabel,
  trainingStart,
  transferReport,
  type TransferRow,
} from "../domain/training";
import { PageHeader } from "./Layout";
import { ColumnChart, type Column } from "./charts";
import { IconPlay } from "./icons";
import { navigate, type TrainingTab } from "./router";
import { Coach, NeedNames } from "./Coach";
import { Examples, skillCategory } from "./ProfileView";
import { PlayoutRunner, PuzzleRunner, RepertoireRunner } from "./training/Runners";
import { type TrainingState, useTraining } from "./training/useTraining";

const SESSION_SIZE = 10;
const WEEKDAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

interface SessionSpec {
  title: string;
  ids: string[];
}

function Session({ spec, t, onExit }: { spec: SessionSpec; t: TrainingState; onExit: () => void }) {
  const exercises = useMemo(() => spec.ids.map((id) => t.byId.get(id)).filter((e): e is Exercise => Boolean(e)), [spec]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const ex = exercises[index];
  const solved = Object.values(results).filter(Boolean).length;

  const header = (
    <div class="page-title">
      <button class="btn small ghost" onClick={onExit}>
        ← Zurück
      </button>
      <span class="session-title">{spec.title}</span>
      <span class="spacer" />
      {ex && (
        <span class="pill accent tnum">
          {index + 1} / {exercises.length}
        </span>
      )}
    </div>
  );

  if (!ex) {
    const done = Object.keys(results).length;
    return (
      <div>
        {header}
        <div class="card session-done">
          <Coach
            mood={done && solved / done >= 0.7 ? "wow" : done ? "happy" : "think"}
            size={72}
            class="big"
            title={done ? (solved === done ? "Perfekt, alles gelöst!" : "Geschafft, gut gemacht!") : "Hier gibt es gerade nichts zu tun."}
            actions={
              <button class="btn primary big" onClick={onExit}>
                Zurück zur Übersicht
              </button>
            }
          >
            {done > 0 && (
              <p>
                Du hast {solved} von {done} {done === 1 ? "Übung" : "Übungen"} auf Anhieb gelöst.{" "}
                {solved < done ? "Die anderen schauen wir uns morgen noch einmal an, so bleibt es hängen." : "Sauber!"}
              </p>
            )}
          </Coach>
        </div>
      </div>
    );
  }

  const props = {
    onResult: (ok: boolean) => {
      setResults((r) => ({ ...r, [ex.id]: ok }));
      t.record(ex, ok);
    },
    onNext: () => setIndex((i) => i + 1),
    nextLabel: index + 1 < exercises.length ? "Nächste Übung" : "Fertig",
  };
  return (
    <div>
      {header}
      <div class="progress session-progress">
        <div style={{ width: `${(index / exercises.length) * 100}%` }} />
      </div>
      {ex.kind === "puzzle" && <PuzzleRunner key={ex.id} ex={ex} {...props} />}
      {ex.kind === "repertoire" && <RepertoireRunner key={ex.id} ex={ex} {...props} />}
      {ex.kind === "playout" && <PlayoutRunner key={ex.id} ex={ex} {...props} />}
    </div>
  );
}

function blockDone(b: PlanBlock, t: TrainingState): number {
  return b.exercise_ids.filter((id) => t.progress[id]?.last === t.today).length;
}

/** The player picks which of their openings to drill; the daily plan never assigns one. */
function OpeningPick({ t, start }: { t: TrainingState; start: (s: SessionSpec) => void }) {
  const drills = t.pool.filter((e): e is RepertoireExercise => e.kind === "repertoire");
  const [color, setColor] = useState<"white" | "black">(drills.some((d) => d.color === "white") ? "white" : "black");
  const shown = drills.filter((d) => d.color === color);
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = shown.find((d) => d.id === picked) ?? shown[0];
  if (!drills.length) return null;
  return (
    <section class="card tile span-12 opening-pick">
      <div class="tile-head">
        <h3>Eröffnung üben</h3>
        <span class="tile-sub">freiwillig · du wählst</span>
      </div>
      <p class="small muted" style={{ marginTop: 0 }}>
        Such dir aus, welche deiner Eröffnungen du heute festigen willst. Du spielst deine übliche Linie ab Zug 1, Fehler aus deinen Partien sind schon korrigiert.
      </p>
      <div class="segmented" role="tablist" style={{ marginBottom: "12px" }}>
        {(["white", "black"] as const).map((c) => (
          <button key={c} role="tab" aria-selected={color === c} class={color === c ? "active" : ""} disabled={!drills.some((d) => d.color === c)} onClick={() => setColor(c)}>
            Mit {c === "white" ? "Weiß" : "Schwarz"}
          </button>
        ))}
      </div>
      <div class="opening-chips">
        {shown.map((d) => {
          const p = t.progress[d.id];
          return (
            <button key={d.id} class={`opening-chip${chosen?.id === d.id ? " on" : ""}`} onClick={() => setPicked(d.id)}>
              <span class="opening-chip-name">{openingLabel(d.opening)}</span>
              <span class="opening-chip-meta tnum">
                {d.games} Partien{d.score_pct !== null ? ` · ${Math.round(d.score_pct)} %` : ""}
                {p ? (isMastered(p) ? " · sicher" : isDue(p, t.today) ? " · fällig" : "") : " · neu"}
              </span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <div class="row tile-foot">
          <span class="small muted">
            {chosen.moves.length} Halbzüge{chosen.correction ? ` · korrigiert: ${chosen.correction.best_san} statt ${chosen.correction.played_san}` : ""}
          </span>
          <span class="spacer" />
          <button class="btn small primary" onClick={() => start({ title: openingLabel(chosen.opening), ids: [chosen.id] })}>
            <IconPlay /> Diese Eröffnung üben
          </button>
        </div>
      )}
    </section>
  );
}

function TodayTab({ t, start }: { t: TrainingState; start: (s: SessionSpec) => void }) {
  const plan = t.plan;
  if (!plan) return null;
  // Plans saved before openings became the player's choice may still list drills.
  const assigned = (id: string) => t.byId.has(id) && t.byId.get(id)!.kind !== "repertoire";
  const blocks = plan.blocks
    .map((b) => ({ ...b, exercise_ids: b.exercise_ids.filter(assigned) }))
    .filter((b) => b.exercise_ids.length > 0);
  const total = blocks.reduce((s, b) => s + b.exercise_ids.length, 0);
  const done = blocks.reduce((s, b) => s + blockDone(b, t), 0);
  // Mixed across blocks (interleaved practice), not block after block.
  const open = interleave(blocks.map((b) => b.exercise_ids.filter((id) => t.byId.has(id) && t.progress[id]?.last !== t.today)));
  const days = streak(t.log, t.today);
  const today = t.log[t.today];

  return (
    <div class="dash">
      <section class="card tile span-12 plan-hero">
        <div class="plan-hero-main">
          <Coach mood={open.length ? "happy" : "wow"} size={64} class="big" title={open.length ? plan.headline : "Plan für heute erledigt. Stark!"}>
            <span class="small">Dein Plan für heute · {plan.minutes} Minuten. Ich habe die Übungen aus deinen eigenen Partien ausgesucht.</span>
          </Coach>
          <div class="progress plan-progress">
            <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <div class="small muted">
            {done} von {total} Übungen erledigt
            {today ? ` · ${today.correct} auf Anhieb gelöst` : ""}
          </div>
          <div class="row" style={{ marginTop: "12px" }}>
            {open.length > 0 ? (
              <button class="btn primary big" onClick={() => start({ title: "Training von heute", ids: open })}>
                <IconPlay /> {done ? "Weiter trainieren" : "Training starten"}
              </button>
            ) : (
              <span class="feedback-ok">Komm morgen wieder, dann habe ich neue Aufgaben für dich.</span>
            )}
            <button class="btn ghost small" onClick={t.rebuild}>
              Plan neu erstellen
            </button>
          </div>
        </div>
        <div class="plan-hero-side">
          <div class="streak">
            <span class="kpi-big tnum">{days}</span>
            <span class="small muted">{days === 1 ? "Tag" : "Tage"} in Folge</span>
          </div>
          <label class="field compact">
            <span>Zeit pro Tag</span>
            <select
              value={String(t.prefs.minutes)}
              onChange={(e) => t.setPrefs({ ...t.prefs, minutes: Number(e.currentTarget.value) })}
            >
              {MINUTE_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m} Minuten
                </option>
              ))}
            </select>
          </label>
          <label class="field compact">
            <span>Schwerpunkt</span>
            <select
              value={t.prefs.focus}
              onChange={(e) => t.setPrefs({ ...t.prefs, focus: e.currentTarget.value as Category | "auto" })}
            >
              <option value="auto">Automatisch aus deinen Partien</option>
              {CATEGORY_ORDER.filter((c) => c !== "repertoire").map((c) => (
                <option key={c} value={c}>
                  {CATEGORIES[c].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <WeekStrip t={t} />

      <OpeningPick t={t} start={start} />

      {blocks.map((b) => {
        const n = b.exercise_ids.length;
        const d = blockDone(b, t);
        const rest = b.exercise_ids.filter((id) => t.byId.has(id) && t.progress[id]?.last !== t.today);
        return (
          <section key={b.key} class={`card tile span-4 block-card${d >= n ? " done" : ""}`}>
            <div class="tile-head">
              <h3>{b.title}</h3>
              <span class="tile-sub">ca. {b.minutes} Min.</span>
            </div>
            <p class="small muted block-reason">{b.reason}</p>
            <div class="progress">
              <div style={{ width: `${(d / n) * 100}%` }} />
            </div>
            <div class="row tile-foot">
              <span class="small tnum">
                {d} / {n}
              </span>
              <span class="spacer" />
              {rest.length > 0 ? (
                <button class="btn small primary" onClick={() => start({ title: b.title, ids: rest })}>
                  Starten
                </button>
              ) : (
                <span class="small feedback-ok">Erledigt</span>
              )}
            </div>
          </section>
        );
      })}

      {plan.tips.length > 0 && (
        <section class="card tile span-12">
          <div class="tile-head">
            <h3>Für deine nächsten Partien</h3>
            <span class="tile-sub">aus deinen Mustern</span>
          </div>
          <ul class="tip-list">
            {plan.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      )}

      <FocusPlan t={t} />
    </div>
  );
}

/** The week at a glance: theme per day, which days were trained, and the weekly target. */
function WeekStrip({ t }: { t: TrainingState }) {
  const week = t.week;
  if (!week) return null;
  const trained = week.days.filter((d) => t.log[d.date]?.done).length;
  return (
    <section class="card tile span-12 week-card">
      <div class="tile-head">
        <h3>Deine Trainingswoche</h3>
        <span class="tile-sub tnum">
          {trained} von {week.target_days} Trainingstagen
        </span>
      </div>
      <div class="plan-week">
        {week.days.map((d) => {
          const [y, m, day] = d.date.split("-").map(Number);
          const log = t.log[d.date];
          const state = d.date === t.today ? " today" : log?.done ? " done" : d.date < t.today ? " missed" : "";
          return (
            <div key={d.date} class={`plan-day${state}`}>
              <span class="week-dow">{WEEKDAY[new Date(y, m - 1, day).getDay()]}</span>
              <span class="week-theme">{themeLabel(d.theme)}</span>
              <span class="week-state small tnum">{log?.done ? `${log.correct}/${log.done}` : d.date === t.today ? "heute" : ""}</span>
            </div>
          );
        })}
      </div>
      <p class="small faint tile-foot">
        Deine größte Schwäche kommt dreimal pro Woche dran, die zweite zweimal, die dritte einmal – nie zweimal am Stück. Sonntag ist
        Wiederholung. Verteiltes, gemischtes Üben bleibt nachweislich besser hängen als alles an einem Tag.
      </p>
    </section>
  );
}

/** The longer-term training priorities from the profile, with steps and examples from the player's own games. */
function FocusPlan({ t }: { t: TrainingState }) {
  const items = t.profile?.training_plan ?? [];
  if (!items.length) return null;
  const pool = t.profile?.exercises ?? [];
  return (
    <>
      <div class="section-head span-12">
        <h2>Deine Trainingsschwerpunkte</h2>
        <span class="tile-sub">woran du über die nächsten Wochen arbeiten solltest</span>
      </div>
      <section class="card tile span-12">
        <div class="plan">
          {items.map((it) => {
            const cat = skillCategory(it.focus_skill, pool);
            return (
              <div class="plan-item" key={it.title}>
                <div class="plan-num">{it.priority}</div>
                <div class="t">{it.title}</div>
                <div class="small muted">{it.reason}</div>
                <ul>
                  {it.steps.map((st) => (
                    <li class="small" key={st}>
                      {st}
                    </li>
                  ))}
                </ul>
                <Examples refs={it.examples} />
                {cat && (
                  <button
                    class="btn small"
                    style={{ marginTop: "8px" }}
                    onClick={() => navigate({ view: "training", tab: "uebungen", category: cat })}
                  >
                    <IconPlay /> In der App üben
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/** Up to SESSION_SIZE exercises of a category: due first, then unseen, then the rest (mastered last). */
function categorySession(c: Category, t: TrainingState): string[] {
  const items = t.pool.filter((e) => e.category === c);
  const rank = (e: Exercise) => {
    const p = t.progress[e.id];
    if (isDue(p, t.today)) return 0;
    if (!p) return 1;
    if (isMastered(p)) return 3;
    return 2;
  };
  return [...items].sort((a, b) => rank(a) - rank(b)).slice(0, SESSION_SIZE).map((e) => e.id);
}

// Puzzle categories first as equal tiles, then the two lists side by side.
const TILE_ORDER: Category[] = ["blunder", "chance", "opening", "endgame", "conversion", "defense"];
const LIST_ORDER: Category[] = ["repertoire", "basics"];

function ExercisesTab({ t, start }: { t: TrainingState; start: (s: SessionSpec) => void }) {
  const stats = new Map(categoryProgress(t.pool, t.progress).map((s) => [s.category, s]));
  const card = (c: Category, list: boolean) => {
    const s = stats.get(c)!;
    const info = CATEGORIES[c];
    const items = list ? t.pool.filter((e) => e.category === c) : [];
    const playouts = t.pool.filter((e) => e.category === c && e.kind === "playout").length;
    return (
      <section key={c} id={`cat-${c}`} class={`card tile ${list ? "span-6" : "span-4"} cat-card`}>
        <div class="tile-head">
          <h3>{info.label}</h3>
          <span class="tile-sub">
            {s.total} {s.total === 1 ? "Übung" : "Übungen"}
            {s.mastered ? ` · ${s.mastered} sicher` : ""}
            {s.rate !== null ? ` · ${Math.round(s.rate)} % gelöst` : ""}
          </span>
        </div>
        <p class="small muted" style={{ marginTop: 0 }}>
          {info.text}
          {!list && playouts > 0 ? ` Davon ${playouts} zum Ausspielen gegen die Engine.` : ""}
        </p>
        {s.total > 0 && (
          <div class="progress">
            <div style={{ width: `${(s.mastered / s.total) * 100}%` }} />
          </div>
        )}
        {items.length > 0 && (
          <div class="ex-list">
            {items.map((e) => {
              const p = t.progress[e.id];
              return (
                <button key={e.id} class="ex-row" onClick={() => start({ title: info.label, ids: [e.id] })}>
                  <span class="ex-row-title">
                    {e.kind === "repertoire" ? openingLabel(e.opening) : e.title}
                    {e.kind === "repertoire" && <span class="faint"> · {e.color === "white" ? "Weiß" : "Schwarz"}</span>}
                  </span>
                  <span class={`ex-state${isMastered(p) ? " ok" : p && p.box === 0 ? " bad" : ""}`}>
                    {!p ? "neu" : isMastered(p) ? "sicher" : isDue(p, t.today) ? "fällig" : p.box === 0 ? "wiederholen" : "geübt"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div class="row tile-foot">
          {s.total === 0 ? (
            <span class="small faint">
              {c === "repertoire" ? "Braucht mindestens zwei Partien mit derselben Eröffnung." : "Noch keine passenden Stellungen. Analysiere mehr Partien."}
            </span>
          ) : (
            <button class="btn small primary" onClick={() => start({ title: info.label, ids: categorySession(c, t) })}>
              {list ? "Alle der Reihe nach" : `${Math.min(SESSION_SIZE, s.total)} ${s.total === 1 ? "Aufgabe" : "Aufgaben"} üben`}
            </button>
          )}
        </div>
      </section>
    );
  };
  return (
    <div class="dash">
      {TILE_ORDER.map((c) => card(c, false))}
      {LIST_ORDER.map((c) => card(c, true))}
    </div>
  );
}

function ProgressTab({ t }: { t: TrainingState }) {
  const stats = categoryProgress(t.pool, t.progress).filter((s) => s.total > 0);
  const days = Array.from({ length: 14 }, (_, i) => addDays(t.today, i - 13));
  const columns: Column[] = days.map((d) => {
    const log = t.log[d];
    const [y, m, day] = d.split("-").map(Number);
    return {
      label: `${WEEKDAY[new Date(y, m - 1, day).getDay()]} ${day}.`,
      value: log?.done ?? 0,
      valueText: log ? `${log.correct}/${log.done}` : "",
      sub: undefined,
    };
  });
  const allDays = Object.values(t.log);
  const totalDone = allDays.reduce((s, d) => s + d.done, 0);
  const totalCorrect = allDays.reduce((s, d) => s + d.correct, 0);
  const mastered = stats.reduce((s, c) => s + c.mastered, 0);
  const due = t.pool.filter((e) => isDue(t.progress[e.id], t.today)).length;
  const trends = trainingTrends(t.log, t.today);
  return (
    <div class="dash">
      <section class="card hero span-12">
        <div class="hero-cell">
          <div class="kpi-label">Serie</div>
          <div class="kpi-big tnum">{streak(t.log, t.today)}</div>
          <div class="small muted">Tage in Folge</div>
        </div>
        <div class="hero-cell">
          <div class="kpi-label">Übungen gesamt</div>
          <div class="kpi-big tnum">{totalDone}</div>
          <div class="small muted">{totalDone ? `${Math.round((totalCorrect / totalDone) * 100)} % auf Anhieb gelöst` : "noch keine"}</div>
        </div>
        <div class="hero-cell">
          <div class="kpi-label">Sicher beherrscht</div>
          <div class="kpi-big tnum">{mastered}</div>
          <div class="small muted">von {t.pool.length} Übungen</div>
        </div>
        <div class="hero-cell">
          <div class="kpi-label">Heute fällig</div>
          <div class="kpi-big tnum">{due}</div>
          <div class="small muted">Wiederholungen</div>
        </div>
      </section>
      <section class="card tile span-12">
        <div class="tile-head">
          <h3>Letzte 14 Tage</h3>
          <span class="tile-sub">gelöst / gemacht</span>
        </div>
        <ColumnChart columns={columns} max={Math.max(5, ...columns.map((c) => c.value ?? 0)) * 1.2} height={140} />
      </section>
      <TrendCard t={t} />
      <RetentionCard t={t} />
      <TransferCard t={t} />
      <OpeningProgressCard t={t} />
      <section class="card tile span-12">
        <div class="tile-head">
          <h3>Nach Bereich</h3>
          <span class="tile-sub">Erfolgsquote und sicher beherrschte Übungen</span>
        </div>
        <div class="cat-table">
          {stats.map((s) => (
            <div key={s.category} class="cat-row">
              <span class="cat-name">
                {CATEGORIES[s.category].label} <TrendMark d={trends.byCategory[s.category]?.direction} />
              </span>
              <span class="tnum small">{s.rate !== null ? `${Math.round(s.rate)} %` : "–"}</span>
              <div class="progress">
                <div style={{ width: `${(s.mastered / s.total) * 100}%` }} />
              </div>
              <span class="tnum small muted">
                {s.mastered}/{s.total}
              </span>
            </div>
          ))}
        </div>
        <p class="small faint tile-foot">
          Eine Übung gilt als sicher, wenn du sie dreimal hintereinander auf Anhieb gelöst hast. Danach kommt sie nur noch in
          großen Abständen (1, 3, 7, 14, 30 Tage) wieder.
        </p>
      </section>
    </div>
  );
}

const TREND_TEXT: Record<Direction, string> = {
  up: "besser",
  down: "schlechter",
  flat: "stabil",
  unknown: "",
};

/** Arrow next to an area, only when the change passed the significance test. */
function TrendMark({ d }: { d?: Direction }) {
  if (!d || d === "unknown" || d === "flat") return null;
  return <span class={`trend-mark ${d}`} title={`Letzte 14 Tage deutlich ${TREND_TEXT[d]} als die 14 davor`}>{d === "up" ? "▲" : "▼"}</span>;
}

/** Weekly solve rate over two months plus an honest verdict on the last two weeks. */
function TrendCard({ t }: { t: TrainingState }) {
  const weeks = weeklyRates(t.log, t.today, 8);
  const { overall } = trainingTrends(t.log, t.today);
  if (!weeks.some((w) => w.done)) return null;
  const columns: Column[] = weeks.map((w) => {
    const [, m, d] = w.start.split("-").map(Number);
    return {
      label: `${d}.${m}.`,
      value: w.rate,
      valueText: w.rate !== null ? `${Math.round(w.rate)} %` : "",
      sub: w.done ? `${w.done}` : undefined,
      faint: w.done > 0 && w.done < 10,
    };
  });
  const verdict =
    overall.direction === "unknown"
      ? `Für eine sichere Aussage brauche ich in den letzten und den 14 Tagen davor je mindestens ${TREND_MIN_ATTEMPTS} Übungen.`
      : overall.direction === "flat"
        ? `Deine Lösungsquote ist stabil (${overall.delta! >= 0 ? "+" : ""}${overall.delta} Prozentpunkte, im Rahmen des Zufalls).`
        : `Deine Lösungsquote ist in den letzten 14 Tagen ${overall.direction === "up" ? "deutlich gestiegen" : "deutlich gefallen"}: ${overall.delta! > 0 ? "+" : ""}${overall.delta} Prozentpunkte.`;
  return (
    <section class="card tile span-12">
      <div class="tile-head">
        <h3>Entwicklung</h3>
        <span class="tile-sub">Lösungsquote je Woche · Zahl darunter = Übungen</span>
      </div>
      <ColumnChart columns={columns} max={100} height={140} />
      <p class={`small tile-foot trend-verdict ${overall.direction}`}>{verdict}</p>
    </section>
  );
}

const OPENING_STATE: Record<string, string> = { new: "neu", due: "fällig", mastered: "sicher", learning: "im Aufbau" };

/** Each repertoire line and how far along the repetition boxes it is. */
function OpeningProgressCard({ t }: { t: TrainingState }) {
  const rows = openingProgress(t.pool, t.progress, t.today);
  if (!rows.length) return null;
  return (
    <section class="card tile span-12">
      <div class="tile-head">
        <h3>Eröffnungen</h3>
        <span class="tile-sub">wie sicher sitzen deine Linien</span>
      </div>
      <div class="cat-table">
        {rows.map((r) => (
          <div key={r.id} class="cat-row">
            <span class="cat-name">
              {openingLabel(r.opening)} <span class="faint">· {r.color === "white" ? "Weiß" : "Schwarz"}</span>
            </span>
            <span class={`tnum small ex-state${r.state === "mastered" ? " ok" : r.state === "due" ? " bad" : ""}`}>{OPENING_STATE[r.state]}</span>
            <div class="box-steps" aria-label={`Stufe ${r.box} von 5`}>
              {[1, 2, 3, 4, 5].map((b) => (
                <span key={b} class={b <= r.box ? "on" : ""} />
              ))}
            </div>
            <span class="tnum small muted">{r.attempts ? `${r.solved}/${r.attempts}` : "–"}</span>
          </div>
        ))}
      </div>
      <p class="small faint tile-foot">Jede fehlerfreie Runde hebt eine Linie eine Stufe höher, ein Fehler setzt sie zurück. Ab Stufe 3 gilt sie als sicher.</p>
    </section>
  );
}

/** How much of what was practised is still there days later (solve rate on repetitions). */
function RetentionCard({ t }: { t: TrainingState }) {
  const r = retention(t.log, t.today);
  return (
    <section class="card tile span-6">
      <div class="tile-head">
        <h3>Behalten</h3>
        <span class="tile-sub">Wiederholungen, letzte 4 Wochen</span>
      </div>
      {r.reliable ? (
        <>
          <div class="kpi-big tnum">{Math.round((r.solved / r.done) * 100)} %</div>
          <p class="small muted" style={{ marginTop: "4px" }}>
            {r.solved} von {r.done} wiederholten Übungen auf Anhieb gelöst (sicher zwischen {r.low} und {r.high} %).{" "}
            {r.low >= 85
              ? "Sehr gut – die Abstände dürfen ruhig größer werden."
              : r.high < 60
                ? "Viel geht zwischen den Wiederholungen verloren. Kürzere, dafür tägliche Einheiten helfen hier am meisten."
                : "Im Zielbereich: schwer genug, dass du etwas lernst, leicht genug, dass es hängen bleibt."}
          </p>
        </>
      ) : (
        <p class="small muted">
          Noch {Math.max(0, 8 - r.done)} Wiederholungen bis zu einer belastbaren Quote. Wiederholte Übungen zeigen, was du nach ein paar Tagen
          noch kannst – das ist der eigentliche Lerneffekt.
        </p>
      )}
    </section>
  );
}

function transferText(row: TransferRow): string {
  if (row.verdict === null) {
    const need = Math.max(0, 10 - row.gamesAfter);
    return need > 0 ? `noch ${need} analysierte Partien seit Trainingsbeginn nötig` : "noch zu wenige Züge für einen Vergleich";
  }
  if (row.verdict === -1) return "deutlich besser";
  if (row.verdict === 1) return "deutlich schlechter";
  return "keine klare Änderung";
}

/** Before/after training in real games, only with enough data and a significant difference. */
function TransferCard({ t }: { t: TrainingState }) {
  const report = transferReport(t.profile?.error_series ?? [], trainingStart(Object.keys(t.log).filter((d) => t.log[d].done)));
  if (!report.start) return null;
  const fmt = (row: TransferRow, v: number | null) => (v === null ? "–" : row.metric === "accuracy" ? `${v.toFixed(1)} %` : v.toFixed(1));
  return (
    <section class="card tile span-6">
      <div class="tile-head">
        <h3>Wirkt das Training?</h3>
        <span class="tile-sub">deine Partien vor und seit {report.start.split("-").reverse().join(".")}</span>
      </div>
      <div class="transfer-table">
        {report.rows.map((row) => (
          <div key={row.metric} class="transfer-row">
            <span class="small">{row.label}</span>
            <span class="tnum small muted">
              {fmt(row, row.before)} → {fmt(row, row.after)}
            </span>
            <span class={`small ${row.verdict === -1 ? "feedback-ok" : row.verdict === 1 ? "feedback-bad" : "faint"}`}>{transferText(row)}</span>
          </div>
        ))}
      </div>
      <p class="small faint tile-foot">
        Fehler pro 100 eigene Züge. Eine Änderung zählt erst ab je 10 Partien und wenn sie statistisch klar ist – so siehst du echte
        Fortschritte statt Zufall.
      </p>
    </section>
  );
}

export function TrainingView({ tab = "heute", category }: { tab?: TrainingTab; category?: string }) {
  const t = useTraining();
  const [session, setSession] = useState<SessionSpec | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  // Deep link from Profil/Einblicke: #/training/uebungen/<category> starts that category.
  if (!autoStarted && !t.loading && category && category in CATEGORIES && t.pool.length) {
    setAutoStarted(true);
    const ids = categorySession(category as Category, t);
    if (ids.length) setSession({ title: CATEGORIES[category as Category].label, ids });
  }

  if (session) {
    return (
      <Session
        spec={session}
        t={t}
        onExit={() => {
          setSession(null);
          if (category) navigate({ view: "training", tab: "uebungen" }, true);
        }}
      />
    );
  }

  const header = <PageHeader about={false} />;

  if (t.loading) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "170px" }} />
          {[0, 1, 2].map((k) => (
            <div key={k} class="skeleton span-4" style={{ height: "170px" }} />
          ))}
        </div>
      </div>
    );
  }
  if (t.usernames && !t.usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what="baue ich dir aus deinen Partien Übungen und einen Trainingsplan." />
      </div>
    );
  }
  if (t.error) {
    return (
      <div>
        {header}
        <p class="error">{t.error}</p>
      </div>
    );
  }

  return (
    <div>
      {header}
      {t.profile?.is_empty && (
        <div class="card notice" style={{ marginBottom: "14px" }}>
          Noch keine Partie analysiert: Du kannst schon Endspiel-Grundlagen und dein Repertoire üben. Aufgaben aus deinen
          Fehlern kommen dazu, sobald Partien analysiert sind.{" "}
          <button class="btn small" onClick={() => navigate({ view: "games" })}>
            Zu den Partien
          </button>
        </div>
      )}
      {tab === "heute" && <TodayTab t={t} start={setSession} />}
      {tab === "uebungen" && <ExercisesTab t={t} start={setSession} />}
      {tab === "fortschritt" && <ProgressTab t={t} />}
    </div>
  );
}
