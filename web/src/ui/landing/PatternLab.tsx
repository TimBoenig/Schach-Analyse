// "Eine Partie oder viele": the comparison at the heart of the page. Buttons
// read 1, 10, 40 or 150 games of an invented player; the squares are the
// games, the bars show where the costly moves fall, and Lucena only names a
// pattern once enough games back it (the app's own evidence rule).
import { useState } from "preact/hooks";

import { BRAND } from "../../brand";
import { COACH_NAME, CoachAvatar, type Mood } from "../Coach";
import { MIN_GAMES, PHASE_LABEL, PHASES, readSample, SAMPLE_STEPS } from "./patternSample";
import { t } from "../../i18n";

function verdict(n: number, pattern: ReturnType<typeof readSample>["pattern"]): { mood: Mood; text: string } {
  if (n === 1) return { mood: "sad", text: t("Nach einer Partie sieht es so aus, als wäre die Eröffnung dein Problem. Das ist ein Zufall, kein Muster.") };
  if (!pattern) return { mood: "think", text: t("Noch zu wenig. Unter {min} Partien sage ich lieber nichts, als dich auf eine falsche Spur zu setzen.", { min: MIN_GAMES }) };
  if (n < SAMPLE_STEPS[SAMPLE_STEPS.length - 1]) return { mood: "think", text: t("Jetzt zeichnet sich etwas ab: {motif}, in {games} Partien.", { motif: pattern.motif, games: pattern.games }) };
  return { mood: "wow", text: t("Klar belegt: Die meisten Punkte verlierst du im Endspiel. {motif}, in {games} von {n} Partien. Das trainieren wir.", { motif: pattern.motif, games: pattern.games, n }) };
}

export function PatternLab() {
  const [step, setStep] = useState(0);
  const n = SAMPLE_STEPS[step];
  const reading = readSample(n);
  const say = verdict(n, reading.pattern);
  const top = PHASES.reduce((a, b) => (reading.share[b] > reading.share[a] ? b : a));

  return (
    <figure class="ld-lab" aria-label={t("Beispiel: was eine und was viele Partien zeigen")}>
      <div class="ld-lab-control">
        <span id="ld-lab-label">{t("Gelesene Partien")}</span>
        <div class="ld-lab-steps" role="radiogroup" aria-labelledby="ld-lab-label">
          {SAMPLE_STEPS.map((s, i) => (
            <button key={s} role="radio" aria-checked={i === step} class={i === step ? "on" : ""} onClick={() => setStep(i)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div class="ld-lab-games" aria-hidden="true">
        {reading.games.map((g, i) => (
          <i key={i} class={`g-${g.result}`} style={{ "--i": i }} />
        ))}
      </div>

      <div class="ld-lab-bars">
        {PHASES.map((p) => (
          <div class={`ld-lab-bar${p === top ? " top" : ""}`} key={p}>
            <span>{PHASE_LABEL[p]}</span>
            <span class="ld-lab-track">
              <span style={{ width: `${Math.round(reading.share[p] * 100)}%` }} />
            </span>
            <b class="tnum">{Math.round(reading.share[p] * 100)} %</b>
          </div>
        ))}
        <p class="ld-lab-axis">{t("Anteil der teuren Züge nach Partiephase")}</p>
      </div>

      <div class="ld-lab-say">
        <CoachAvatar mood={say.mood} size={44} />
        <p aria-live="polite">
          <b>{COACH_NAME}</b> {say.text}
        </p>
      </div>
      <figcaption class="ld-note">{t("Beispielspieler mit erfundenen Partien. Jedes Kästchen ist eine Partie: grün gewonnen, grau remis, rot verloren.")}</figcaption>
    </figure>
  );
}

const ROWS: { what: string; them: string | boolean; us: string | boolean }[] = [
  { what: t("Bewertet jeden Zug einer Partie"), them: true, us: true },
  { what: t("Liest alle deine Partien zusammen"), them: false, us: true },
  { what: t("Zeigt, welcher Fehler sich wiederholt und wie oft"), them: false, us: true },
  { what: t("Sagt, wie viele Partien hinter einer Aussage stehen"), them: false, us: true },
  { what: t("Aufgaben aus deinen eigenen Stellungen"), them: false, us: true },
  { what: t("Fairer Vergleich mit Freunden, auch bei anderer Bedenkzeit"), them: false, us: true },
  { what: t("Kosten"), them: t("je nach Seite mit Abo-Grenzen"), us: t("kostenlos") },
];

function Cell({ v }: { v: string | boolean }) {
  if (typeof v === "string") return <span class="ld-cmp-text">{v}</span>;
  return v ? (
    <span class="ld-cmp-yes" aria-label={t("ja")}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </span>
  ) : (
    <span class="ld-cmp-no" aria-label={t("nein")}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 8h8" />
      </svg>
    </span>
  );
}

/** Feature by feature: the usual review after a game next to this app. */
export function CompareTable() {
  return (
    <table class="ld-cmp">
      <caption class="sr-only">{t("Vergleich: Analyse nach der Partie und {BRAND}", { BRAND })}</caption>
      <thead>
        <tr>
          <th scope="col">
            <span class="sr-only">{t("Funktion")}</span>
          </th>
          <th scope="col">{t("Analyse nach der Partie")}</th>
          <th scope="col" class="us">
            {BRAND}
          </th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.what}>
            <th scope="row">{r.what}</th>
            <td>
              <Cell v={r.them} />
            </td>
            <td class="us">
              <Cell v={r.us} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
