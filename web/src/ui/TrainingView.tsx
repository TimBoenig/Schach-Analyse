import { useMemo, useState } from "preact/hooks";

import { openingLabel, profileCoachMessages, TRAINING_QUESTIONS } from "../domain/profile";
import {
  addDays,
  CATEGORIES,
  CATEGORY_ORDER,
  type Category,
  categoryProgress,
  type Exercise,
  isDue,
  isMastered,
  MINUTE_CHOICES,
  type PlanBlock,
  streak,
  summarizeTraining,
} from "../domain/training";
import { AiChat, coachDetail } from "./AiCoach";
import { ColumnChart, type Column } from "./charts";
import { IconPlay, IconSpark } from "./icons";
import { navigate, type TrainingTab } from "./router";
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
          <h3>{done ? "Geschafft!" : "Nichts zu tun"}</h3>
          {done > 0 && (
            <p>
              {solved} von {done} {done === 1 ? "Übung" : "Übungen"} auf Anhieb gelöst.{" "}
              {solved < done ? "Die anderen kommen morgen zur Wiederholung." : "Sauber!"}
            </p>
          )}
          <button class="btn primary" onClick={onExit}>
            Zurück zur Übersicht
          </button>
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

function Tabs({ tab }: { tab: TrainingTab }) {
  const items: [TrainingTab, string][] = [
    ["heute", "Heute"],
    ["uebungen", "Übungen"],
    ["fortschritt", "Fortschritt"],
  ];
  return (
    <div class="segmented">
      {items.map(([k, label]) => (
        <button key={k} class={tab === k ? "active" : ""} onClick={() => navigate({ view: "training", tab: k }, true)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function blockDone(b: PlanBlock, t: TrainingState): number {
  return b.exercise_ids.filter((id) => t.progress[id]?.last === t.today).length;
}

function TodayTab({ t, start }: { t: TrainingState; start: (s: SessionSpec) => void }) {
  const plan = t.plan;
  if (!plan) return null;
  const blocks = plan.blocks.filter((b) => b.exercise_ids.some((id) => t.byId.has(id)));
  const total = blocks.reduce((s, b) => s + b.exercise_ids.length, 0);
  const done = blocks.reduce((s, b) => s + blockDone(b, t), 0);
  const open = blocks.flatMap((b) => b.exercise_ids.filter((id) => t.byId.has(id) && t.progress[id]?.last !== t.today));
  const days = streak(t.log, t.today);
  const today = t.log[t.today];

  return (
    <div class="dash">
      <section class="card tile span-12 plan-hero">
        <div class="plan-hero-main">
          <div class="kpi-label">Dein Plan für heute · {plan.minutes} Minuten</div>
          <h2 class="plan-headline">{plan.headline}</h2>
          <div class="progress plan-progress">
            <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <div class="small muted">
            {done} von {total} Übungen erledigt
            {today ? ` · ${today.correct} auf Anhieb gelöst` : ""}
          </div>
          <div class="row" style={{ marginTop: "12px" }}>
            {open.length > 0 ? (
              <button class="btn primary" onClick={() => start({ title: "Training von heute", ids: open })}>
                <IconPlay /> {done ? "Weiter trainieren" : "Training starten"}
              </button>
            ) : (
              <span class="feedback-ok">Plan für heute erledigt. Stark!</span>
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
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIES[c].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

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

      {t.profile && !t.profile.is_empty && (
        <section class="card tile span-12">
          <div class="tile-head">
            <h3>
              <IconSpark /> Frag den KI-Coach
            </h3>
            <span class="tile-sub">kennt deinen Plan und deinen Trainingsstand</span>
          </div>
          <AiChat
            build={(history, q) =>
              profileCoachMessages(
                t.profile!,
                history,
                q,
                coachDetail(),
                summarizeTraining(t.pool, t.progress, t.log, t.today, plan.headline),
              )
            }
            suggestions={TRAINING_QUESTIONS}
          />
        </section>
      )}
    </div>
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
      <section class="card tile span-12">
        <div class="tile-head">
          <h3>Nach Bereich</h3>
          <span class="tile-sub">Erfolgsquote und sicher beherrschte Übungen</span>
        </div>
        <div class="cat-table">
          {stats.map((s) => (
            <div key={s.category} class="cat-row">
              <span class="cat-name">{CATEGORIES[s.category].label}</span>
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

  const header = (
    <div class="page-title">
      Training
      <span class="spacer" />
      <Tabs tab={tab} />
    </div>
  );

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
        <div class="page-title">Training</div>
        <div class="empty">
          <p>Trage zuerst deine Spielernamen ein. Dann baut die App aus deinen Partien Übungen und einen Trainingsplan.</p>
          <button class="btn primary" onClick={() => navigate({ view: "settings" })}>
            Zu den Einstellungen
          </button>
        </div>
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
