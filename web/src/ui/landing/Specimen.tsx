// The landing page's hero: what a player gets, before they type anything. A
// sample report in three views (weaknesses, one game, the training plan)
// that turns by itself until someone picks a view. It is plainly marked as
// an example: the numbers belong to an invented profile, never to a person.
import { useEffect, useRef, useState } from "preact/hooks";

import { COACH_NAME, CoachAvatar, type Mood } from "../Coach";
import { IconGames, IconInsights, IconTraining } from "../icons";
import { t } from "../../i18n";

type View = "weak" | "game" | "plan";

const VIEWS: { key: View; label: string; icon: () => preact.JSX.Element }[] = [
  { key: "weak", label: t("Schwächen"), icon: IconInsights },
  { key: "game", label: t("Eine Partie"), icon: IconGames },
  { key: "plan", label: t("Training"), icon: IconTraining },
];

// The invented sample player: 140 rapid and blitz games.
const PHASES = [
  { label: t("Eröffnung"), value: 86 },
  { label: t("Mittelspiel"), value: 77 },
  { label: t("Endspiel"), value: 61 },
];

const PATTERNS = [
  { label: t("Turmendspiele nicht gehalten"), games: 14 },
  { label: t("Figur nach Abtausch hängen gelassen"), games: 9 },
  { label: t("Gegen Sizilianisch früh schlechter"), games: 7 },
];

// The sample game: the user's winning chances, one value per move pair.
const CURVE = [52, 55, 54, 58, 57, 60, 63, 61, 64, 66, 69, 68, 71, 70, 72, 74, 73, 71, 18, 22, 20, 17, 15, 12, 10, 8];
const TURN = 18;

const PLAN = [
  { day: "Mo", done: true },
  { day: "Di", done: true },
  { day: "Mi", done: true },
  { day: "Do", today: true },
  { day: "Fr" },
  { day: "Sa" },
  { day: "So" },
];

const SESSION = [
  { label: t("Aufwärmen"), detail: t("3 Aufgaben, schon gelöst, zur Wiederholung") },
  { label: t("Schwerpunkt Turmendspiele"), detail: t("5 Stellungen aus deinen eigenen Partien") },
  { label: t("Gemischt"), detail: t("4 Aufgaben aus allen Bereichen") },
];

const SAY: Record<View, { mood: Mood; text: string }> = {
  weak: { mood: "think", text: t("Im Endspiel lässt du die meisten Punkte liegen. 14 Turmendspiele hast du nicht gehalten.") },
  game: { mood: "sad", text: t("Zug 19, Txe5?? Du standest bei 71 %, danach bei 18 %. Besser war Sd5.") },
  plan: { mood: "happy", text: t("Diese Woche üben wir Turmendspiele. Heute fünf Stellungen aus deinen Partien.") },
};

const reduced = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function Weak() {
  return (
    <div class="sp-weak">
      <div class="sp-sub">{t("Genauigkeit nach Partiephase")}</div>
      <div class="sp-bars">
        {PHASES.map((p, i) => (
          <div class={`sp-bar${i === PHASES.length - 1 ? " low" : ""}`} key={p.label}>
            <span class="sp-bar-label">{p.label}</span>
            <span class="sp-bar-track">
              <span style={{ "--to": `${p.value}%`, "--i": i } as Record<string, string | number>} />
            </span>
            <b class="tnum">{p.value} %</b>
          </div>
        ))}
      </div>
      <div class="sp-sub">{t("Was sich wiederholt")}</div>
      <ul class="sp-patterns">
        {PATTERNS.map((p) => (
          <li key={p.label}>
            <span>{p.label}</span>
            <b class="tnum">{t("{games} Partien", { games: p.games })}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Game() {
  const w = 300;
  const h = 120;
  const x = (i: number) => (i / (CURVE.length - 1)) * w;
  const y = (v: number) => h - (v / 100) * h;
  const line = CURVE.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <div class="sp-game">
      <div class="sp-sub">{t("Deine Gewinnchance in der Partie gegen M. Weber")}</div>
      <svg class="sp-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={t("Gewinnchance fällt in Zug 19 von 71 auf 18 Prozent")}>
        <line x1="0" x2={w} y1={h / 2} y2={h / 2} class="sp-mid" />
        <path d={area} class="sp-area" />
        <path d={line} class="sp-line" />
        <line x1={x(TURN)} x2={x(TURN)} y1="0" y2={h} class="sp-turn" />
        <circle cx={x(TURN)} cy={y(CURVE[TURN])} r="4.5" class="sp-dot" />
      </svg>
      <div class="sp-moves">
        <div class="sp-move bad">
          <span class="sp-move-no tnum">19.</span>
          <b>{t("Txe5??")}</b>
          <span>{t("Patzer")}</span>
          <span class="tnum sp-move-wp">{t("71 % auf 18 %")}</span>
        </div>
        <div class="sp-move good">
          <span class="sp-move-no tnum">19.</span>
          <b>{t("Sd5!")}</b>
          <span>{t("Besser")}</span>
          <span class="tnum sp-move-wp">{t("hält 70 %")}</span>
        </div>
      </div>
    </div>
  );
}

function Plan() {
  return (
    <div class="sp-plan">
      <div class="sp-week" aria-label={t("Wochenplan: drei Tage erledigt, heute Donnerstag")}>
        {PLAN.map((d) => (
          <span key={d.day} class={d.done ? "done" : d.today ? "today" : ""}>
            {d.day}
          </span>
        ))}
      </div>
      <div class="sp-sub">{t("Heute, etwa 10 Minuten")}</div>
      <ol class="sp-session">
        {SESSION.map((s, i) => (
          <li key={s.label} class={i === 1 ? "focus" : ""}>
            <b>{s.label}</b>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Specimen() {
  const [view, setView] = useState<View>("weak");
  const touched = useRef(false);

  useEffect(() => {
    if (reduced() || touched.current) return;
    const t = window.setTimeout(() => {
      if (touched.current) return;
      setView((v) => VIEWS[(VIEWS.findIndex((x) => x.key === v) + 1) % VIEWS.length].key);
    }, 6500);
    return () => window.clearTimeout(t);
  }, [view]);

  const pick = (v: View) => {
    touched.current = true;
    setView(v);
  };
  const say = SAY[view];

  return (
    <figure class="specimen" aria-label={t("Beispiel eines Berichts")}>
      <div class="sp-head">
        <div class="sp-tabs" role="tablist" aria-label={t("Ansicht des Beispielberichts")}>
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" id={`sp-tab-${v.key}`} aria-selected={view === v.key} aria-controls="sp-panel" class="sp-tab" onClick={() => pick(v.key)}>
              <v.icon />
              <span>{v.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="sp-panel" id="sp-panel" role="tabpanel" aria-labelledby={`sp-tab-${view}`} key={view}>
        {view === "weak" ? <Weak /> : view === "game" ? <Game /> : <Plan />}
      </div>
      <div class="sp-say">
        <CoachAvatar mood={say.mood} size={44} />
        <p key={view}>
          <b>{COACH_NAME}</b> {say.text}
        </p>
      </div>
      <figcaption class="sp-note">{t("Beispielprofil mit erfundenen Zahlen. Deins entsteht aus deinen Partien.")}</figcaption>
    </figure>
  );
}
