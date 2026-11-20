// Training, "Heute": one answer to "what do I do now?". The session of the
// day with its three parts stands on top, the week under it, and only then
// the longer view: what the player is working on and what to watch for in
// the next games.
import { useState } from "preact/hooks";

import {
  CATEGORIES,
  CATEGORY_ORDER,
  type Category,
  dueExercises,
  estimateMinutes,
  logTotals,
  MINUTE_CHOICES,
  type PlanBlock,
  SESSION_SIZE,
  sessionParts,
  streak,
  summarizeTraining,
  themeLabel,
  weekView,
} from "../../domain/training";
import { Ring } from "../charts";
import { IconChevron, IconOpenings, IconPlay, IconSettings, IconSync } from "../icons";
import { CountUp, Foot } from "../kit";
import { Examples } from "../profile/Findings";
import { skillCategory } from "../profile/SkillsCard";
import { navigate } from "../router";
import { Stat } from "../viz/Bars";
import { dayLong, pct, plural, type StartSession, weekdayShort } from "./shared";
import type { TrainingState } from "./useTraining";
import { t } from "../../i18n";

/** Why a part of the session is there: the plan's own reason for its block. */
function partReason(key: string, blocks: PlanBlock[]): string {
  if (key === "warmup") return blocks.find((b) => b.category === "review")?.reason ?? "";
  if (key === "main") return blocks.find((b) => b.category !== "review")?.reason ?? "";
  return t("Gemischte Aufgaben sind im Moment schwerer, bleiben aber besser hängen: In der Partie sagt dir auch niemand, welche Art Stellung kommt.");
}

function SessionCard({ t: tk, start }: { t: TrainingState; start: StartSession }) {
  const plan = tk.plan!;
  const [tune, setTune] = useState(false);
  // Plans saved before openings became the player's choice may still list drills.
  const assigned = (id: string) => tk.byId.has(id) && tk.byId.get(id)!.kind !== "repertoire";
  const blocks = plan.blocks.map((b) => ({ ...b, exercise_ids: b.exercise_ids.filter(assigned) })).filter((b) => b.exercise_ids.length > 0);
  const isOpen = (id: string) => tk.byId.has(id) && tk.progress[id]?.last !== tk.today;
  // Warm-up, main theme, then the rest mixed: see sessionParts.
  const openParts = sessionParts(blocks, isOpen);
  const allParts = sessionParts(blocks, (id) => tk.byId.has(id));
  const open = openParts.flatMap((p) => p.ids);
  const total = allParts.reduce((s, p) => s + p.ids.length, 0);
  const done = total - open.length;
  const today = tk.log[tk.today];
  const firstOpen = allParts.findIndex((p) => p.ids.some(isOpen));
  // "Heute im Fokus: A und B": the lead goes into the small line, the topic is the headline.
  const cut = plan.headline.indexOf(": ");
  const lead = cut > 0 ? plan.headline.slice(0, cut) : "";
  const topic = cut > 0 ? plan.headline.slice(cut + 2) : plan.headline;

  if (!total) {
    return (
      <section class="card span-12 td td-empty">
        <span class="eyebrow td-eyebrow">
          <span class="orb-mini" aria-hidden="true" />  {t("Lucena ·")} {dayLong(tk.today)}
        </span>
        <h2 class="td-title">{t("Für deinen Tagesplan brauche ich analysierte Partien.")}</h2>
        <p class="td-sub">
          
          {t("Die Aufgaben entstehen aus Stellungen, in denen du danebengegriffen hast. Sobald Partien analysiert sind, steht hier jeden Tag eine Einheit. Eröffnungen und Endspiel-Grundlagen kannst du schon jetzt üben.")}
        </p>
        <div class="td-actions">
          <button class="btn primary big" onClick={() => navigate({ view: "games" })}>
            
            {t("Zu den Partien")}
          </button>
          <button class="btn big" onClick={() => navigate({ view: "training", tab: "uebungen" })}>
            
            {t("Übungen ansehen")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="card span-12 td">
      <div class="td-main">
        <div class="td-text">
          <span class="eyebrow td-eyebrow">
            <span class="orb-mini" aria-hidden="true" />  {t("Lucena ·")} {dayLong(tk.today)}
            {open.length && lead ? ` · ${lead}` : ""}
          </span>
          <h2 class="td-title">{open.length ? topic : t("Für heute bist du fertig.")}</h2>
          <p class="td-sub">
            {open.length ? (
              <>
                {done ? t("Noch {plural}", { plural: plural(open.length, t("Aufgabe"), t("Aufgaben")) }) : plural(open.length, t("Aufgabe"), t("Aufgaben"))}  {t("· etwa")} {estimateMinutes(open, tk.byId)}  {t("Minuten · alle aus deinen eigenen Partien")}
              </>
            ) : (
              <>
                {today ? t("{correct} von {done} auf Anhieb gelöst. ", { correct: today.correct, done: today.done }) : ""}
                
                {t("Morgen stelle ich dir eine neue Einheit zusammen. Wenn du weitermachen willst: In den Übungen wartet mehr.")}
              </>
            )}
          </p>
          <div class="td-actions">
            {open.length > 0 ? (
              <button class="btn primary big" onClick={() => start({ title: t("Einheit von heute"), ids: open, parts: openParts })}>
                <IconPlay /> {done ? t("Einheit fortsetzen") : t("Einheit starten")}
              </button>
            ) : (
              <button class="btn primary big" onClick={() => navigate({ view: "training", tab: "uebungen" })}>
                
                {t("Weiter üben")}
              </button>
            )}
            <button class={`btn big td-tune-btn${tune ? " on" : ""}`} aria-expanded={tune} onClick={() => setTune(!tune)}>
              <IconSettings />  {t("Anpassen")}
            </button>
          </div>
        </div>
        <div class="td-ring">
          <Ring value={done} total={total} size={148} thickness={11}>
            <strong class="tnum">
              <CountUp value={done} />
            </strong>
            <small>von {total} erledigt</small>
          </Ring>
        </div>
      </div>

      {tune && (
        <div class="td-tune">
          <div class="td-tune-field">
            <span class="eyebrow">{t("Zeit pro Tag")}</span>
            <div class="segmented" role="radiogroup" aria-label={t("Zeit pro Tag")}>
              {MINUTE_CHOICES.map((m) => (
                <button key={m} role="radio" aria-checked={tk.prefs.minutes === m} class={tk.prefs.minutes === m ? "active" : ""} onClick={() => tk.setPrefs({ ...tk.prefs, minutes: m })}>
                  {m}  {t("Min")}
                </button>
              ))}
            </div>
          </div>
          <label class="td-tune-field">
            <span class="eyebrow">{t("Schwerpunkt")}</span>
            <select value={tk.prefs.focus} onChange={(e) => tk.setPrefs({ ...tk.prefs, focus: e.currentTarget.value as Category | "auto" })}>
              <option value="auto">{t("Automatisch aus deinen Partien")}</option>
              {CATEGORY_ORDER.filter((c) => c !== "repertoire").map((c) => (
                <option key={c} value={c}>
                  {CATEGORIES[c].label}
                </option>
              ))}
            </select>
          </label>
          <button class="btn ghost td-rebuild" onClick={tk.rebuild} title={t("Stellt die Einheit mit anderen Aufgaben neu zusammen")}>
            <IconSync />  {t("Andere Aufgaben")}
          </button>
        </div>
      )}

      <ol class="td-steps" aria-label={t("Ablauf der Einheit")}>
        {allParts.map((p, i) => {
          const n = p.ids.length;
          const d = p.ids.filter((id) => !isOpen(id)).length;
          const state = d >= n ? "done" : i === firstOpen ? "cur" : "todo";
          const reason = partReason(p.key, blocks);
          return (
            <li key={p.key} class={`td-step ${state}`}>
              <span class="td-step-mark" aria-hidden="true">
                {state === "done" ? "✓" : i + 1}
              </span>
              <div class="td-step-body">
                <span class="td-step-kind">{p.key === "main" ? t("Hauptthema") : p.key === "warmup" ? t("Aufwärmen") : t("Gemischt")}</span>
                <strong class="td-step-title">{p.key === "warmup" ? p.sub : p.key === "mix" ? p.sub || p.title : p.title}</strong>
                <span class="td-step-meta tnum">
                  {d} von {plural(n, t("Aufgabe"), t("Aufgaben"))}  {t("· etwa")} {estimateMinutes(p.ids, tk.byId)}  {t("Min")}
                </span>
                <span class="td-step-bar" aria-hidden="true">
                  <i style={{ width: `${(d / n) * 100}%` }} />
                </span>
                {reason && <p class="td-step-why">{reason}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The week at a glance: theme per day, which days were trained, and the weekly target. */
function WeekCard({ t: tk }: { t: TrainingState }) {
  if (!tk.week) return null;
  const w = weekView(tk.week, tk.log, tk.today);
  return (
    <section class="card span-8 tw">
      <header class="card-head">
        <div>
          <h3>{t("Deine Woche")}</h3>
          <p class="card-sub">
            <strong class="tnum">
              {w.trained} von {w.target}
            </strong>{" "}
            
            {t("Trainingstagen.")}{" "}
            {w.missing === 0 ? t("Wochenziel erreicht.") : w.reachable ? t("Noch {plural} bis zum Wochenziel.", { plural: plural(w.missing, t("Tag"), t("Tage")) }) : t("Das Wochenziel ist diese Woche nicht mehr zu schaffen. Jede Einheit zählt trotzdem.")}
          </p>
        </div>
      </header>
      <ol class="tw-days">
        {w.days.map((d) => (
          <li key={d.date} class={`tw-day ${d.state}${d.isToday ? " today" : ""}`} aria-current={d.isToday ? "date" : undefined}>
            <span class="tw-dow">{weekdayShort(d.date)}</span>
            <span class="tw-mark" aria-hidden="true">
              {d.state === "done" ? "✓" : ""}
            </span>
            <span class="tw-theme">{themeLabel(d.theme)}</span>
            <span class="tw-n tnum">{d.done ? `${d.correct} / ${d.done}` : d.isToday ? "heute" : d.state === "missed" ? "frei" : ""}</span>
          </li>
        ))}
      </ol>
      <Foot label={t("Wie entsteht die Woche?")}>
        
        {t("Deine größte Schwäche kommt dreimal pro Woche dran, die zweite zweimal, die dritte einmal, nie zweimal am Stück. Sonntag ist Wiederholung. Verteiltes, gemischtes Üben bleibt nachweislich besser hängen als alles an einem Tag. Unter einem trainierten Tag steht, wie viele Aufgaben du auf Anhieb gelöst hast.")}
      </Foot>
    </section>
  );
}

function RhythmCard({ t: tk, start }: { t: TrainingState; start: StartSession }) {
  const days = streak(tk.log, tk.today);
  const totals = logTotals(tk.log);
  const week = summarizeTraining([], {}, tk.log, tk.today).week;
  const due = dueExercises(tk.pool, tk.progress, tk.today);
  return (
    <section class="card span-4 tn-rhythm">
      <Stat label={t("Serie")} value={<CountUp value={days} />} sub={totals.longest > days ? t("{0} in Folge · längste Serie {longest}", { 0: days === 1 ? t("Tag") : t("Tage"), longest: totals.longest }) : t("{0} in Folge", { 0: days === 1 ? t("Tag") : t("Tage") })} />
      <Stat
        label={t("Letzte 7 Tage")}
        value={<CountUp value={week.done} />}
        sub={week.done ? t("{0} · {pct} auf Anhieb", { 0: week.done === 1 ? t("Aufgabe") : t("Aufgaben"), pct: pct((week.correct / week.done) * 100) }) : t("Aufgaben")}
      />
      <Stat label={t("Wiederholungen fällig")} value={<CountUp value={due.length} />} sub={due.length ? t("Sie sitzen noch nicht sicher.") : t("Nichts offen.")}>
        {due.length > 0 && (
          <button class="btn small" onClick={() => start({ title: t("Fällige Wiederholungen"), ids: due.slice(0, SESSION_SIZE) })}>
            <IconPlay />  {t("Jetzt wiederholen")}
          </button>
        )}
      </Stat>
    </section>
  );
}

/** The longer-term priorities from the profile, each with its steps and examples from the player's own games. */
function FocusCard({ t: tk }: { t: TrainingState }) {
  const items = tk.profile?.training_plan ?? [];
  const [open, setOpen] = useState<string | null>(items[0]?.title ?? null);
  if (!items.length) return null;
  const pool = tk.profile?.exercises ?? [];
  return (
    <section class="card span-7 tf">
      <header class="card-head">
        <div>
          <h3>{t("Woran du arbeitest")}</h3>
          <p class="card-sub">{t("Deine Schwerpunkte für die nächsten Wochen, nach Dringlichkeit.")}</p>
        </div>
      </header>
      <div class="tf-list">
        {items.map((it) => {
          const cat = skillCategory(it.focus_skill, pool);
          const isOpen = open === it.title;
          return (
            <div key={it.title} class={`tf-item${isOpen ? " open" : ""}`}>
              <button class="tf-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.title)}>
                <span class="tf-num tnum">{it.priority}</span>
                <span class="tf-text">
                  <strong>{it.title}</strong>
                  <small>{it.reason}</small>
                </span>
                <IconChevron />
              </button>
              {isOpen && (
                <div class="tf-body">
                  <ul>
                    {it.steps.map((st) => (
                      <li key={st}>{st}</li>
                    ))}
                  </ul>
                  <Examples refs={it.examples} />
                  {cat && (
                    <button class="btn small" onClick={() => navigate({ view: "training", tab: "uebungen", category: cat })}>
                      <IconPlay /> {CATEGORIES[cat].label}  {t("üben")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TipsCard({ tips, wide }: { tips: string[]; wide: boolean }) {
  if (!tips.length) return null;
  return (
    <section class={`card ${wide ? "span-12" : "span-5"} tt`}>
      <header class="card-head">
        <div>
          <h3>{t("Für deine nächsten Partien")}</h3>
          <p class="card-sub">{t("Kein Üben, sondern Vorsätze: aus den Mustern, die in deinen Partien wiederkehren.")}</p>
        </div>
      </header>
      <ol class="tt-list">
        {tips.map((tip, i) => (
          <li key={tip}>
            <span class="tt-num tnum" aria-hidden="true">
              {i + 1}
            </span>
            {tip}
          </li>
        ))}
      </ol>
    </section>
  );
}

function OpeningsLink() {
  return (
    <button class="card span-12 tl" onClick={() => navigate({ view: "training", tab: "uebungen", category: "repertoire" })}>
      <span class="tl-icon" aria-hidden="true">
        <IconOpenings />
      </span>
      <span class="tl-text">
        <strong>{t("Eröffnung lernen")}</strong>
        <small>{t("Eröffnungen teile ich dir nie zu. Du wählst selbst: deine eigenen Linien mit korrigierten Fehlern oder eine neue aus der Bibliothek.")}</small>
      </span>
      <IconChevron />
    </button>
  );
}

export function TodayPage({ t: tk, start }: { t: TrainingState; start: StartSession }) {
  if (!tk.plan) return null;
  const hasFocus = Boolean(tk.profile?.training_plan.length);
  return (
    <div class="dash tn">
      <SessionCard t={tk} start={start} />
      <WeekCard t={tk} />
      <RhythmCard t={tk} start={start} />
      <FocusCard t={tk} />
      <TipsCard tips={tk.plan.tips} wide={!hasFocus} />
      <OpeningsLink />
    </div>
  );
}
