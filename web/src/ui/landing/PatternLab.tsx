// "Viele Partien zeigen dein Muster": the squares are the games of an invented
// player. When the section scrolls into view they are read one after another,
// the bars show where the costly moves fall, and Lucena only names a pattern
// once enough games back it (the app's own evidence rule). There is no way to
// pick a single game: one game proves nothing and would only look like junk.
import { useEffect, useRef, useState } from "preact/hooks";

import { COACH_NAME, CoachAvatar, type Mood } from "../Coach";
import { IconReset } from "../icons";
import { MIN_GAMES, PHASE_LABEL, PHASES, readSample, SAMPLE_SIZE } from "./patternSample";
import { t } from "../../i18n";

const START_AT = 8;
const READ_MS = 4200;

function verdict(n: number, pattern: ReturnType<typeof readSample>["pattern"]): { mood: Mood; text: string } {
  if (n < MIN_GAMES) return { mood: "think", text: t("Ich lese noch. Unter {min} Partien nenne ich kein Muster, sonst setze ich dich auf eine falsche Spur.", { min: MIN_GAMES }) };
  if (!pattern) return { mood: "think", text: t("Noch nichts, was sich oft genug wiederholt.") };
  if (n < SAMPLE_SIZE) return { mood: "think", text: t("Jetzt zeichnet sich etwas ab: {motif}, in {games} Partien.", { motif: pattern.motif, games: pattern.games }) };
  return { mood: "wow", text: t("Klar belegt: Die meisten Punkte verlierst du im Endspiel. {motif}, in {games} von {n} Partien. Das trainieren wir.", { motif: pattern.motif, games: pattern.games, n }) };
}

export function PatternLab() {
  const [n, setN] = useState(SAMPLE_SIZE);
  const root = useRef<HTMLElement>(null);
  const raf = useRef(0);

  const run = () => {
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / READ_MS);
      setN(Math.round(START_AT + (SAMPLE_SIZE - START_AT) * (1 - (1 - p) ** 2)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    setN(START_AT);
    raf.current = requestAnimationFrame(tick);
  };

  // Shows the finished picture first (no script, reduced motion) and counts up once when seen.
  useEffect(() => {
    const el = root.current;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        run();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const reading = readSample(n);
  const say = verdict(n, reading.pattern);
  const top = PHASES.reduce((a, b) => (reading.share[b] > reading.share[a] ? b : a));
  const all = readSample(SAMPLE_SIZE);

  return (
    <figure class="ld-lab" ref={root} aria-label={t("Beispiel: was viele Partien zeigen")}>
      <div class="ld-lab-head">
        <span class="ld-lab-count tnum">
          <b>{n}</b> {t("Partien gelesen")}
        </span>
        <span class="ld-lab-count tnum">
          <b>{reading.costly}</b> {t("teure Züge")}
        </span>
        <button class="btn small ghost" onClick={run} aria-label={t("Noch einmal ablaufen lassen")}>
          <IconReset /> {t("Nochmal")}
        </button>
      </div>

      <div class="ld-lab-games" aria-hidden="true">
        {all.games.map((g, i) => (
          <i key={i} class={`g-${g.result}${i < n ? " read" : ""}`} />
        ))}
      </div>

      <div class="ld-lab-bars">
        {PHASES.map((p) => (
          <div class={`ld-lab-bar${p === top && n >= MIN_GAMES ? " top" : ""}`} key={p}>
            <span>{PHASE_LABEL[p]}</span>
            <span class="ld-lab-track">
              <span style={{ width: `${Math.round(reading.share[p] * 100)}%` }} />
            </span>
            <b class="tnum">{Math.round(reading.share[p] * 100)} %</b>
          </div>
        ))}
        <p class="ld-lab-axis">{t("Anteil der teuren Züge nach Partiephase")}</p>
      </div>

      {reading.motifs.length > 0 && (
        <ul class="ld-lab-motifs">
          {reading.motifs.map((m) => (
            <li key={m.motif}>
              <span>{m.motif}</span>
              <b class="tnum">{t("{games} Partien", { games: m.games })}</b>
            </li>
          ))}
        </ul>
      )}

      <div class="ld-lab-say">
        <CoachAvatar mood={say.mood} size={44} />
        <p aria-live="off">
          <b>{COACH_NAME}</b> {say.text}
        </p>
      </div>
      <figcaption class="ld-note">{t("Beispielspieler mit erfundenen Partien. Jedes Kästchen ist eine Partie: grün gewonnen, grau remis, rot verloren.")}</figcaption>
    </figure>
  );
}
