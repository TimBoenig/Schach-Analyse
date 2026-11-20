// "So funktioniert's" on the landing page: four steps from import to training,
// next to a board that replays a short trap while Lucena comments on it.
import { Chess } from "chess.js";
import { useEffect, useMemo, useState } from "preact/hooks";

import { type Arrow, Board } from "./Board";
import { COACH_NAME, CoachAvatar } from "./Coach";
import { IconCpu, IconInsights, IconTraining } from "./icons";
import { DEMO_LINE } from "./landingPuzzle";
import { t } from "../i18n";

const HOW: { title: string; text: string; icon: () => preact.JSX.Element }[] = [
  {
    title: t("Partien holen"),
    text: t("Du gibst deinen Namen bei chess.com oder Lichess ein. Ich lade deine öffentlichen Partien direkt auf dein Gerät, ohne Anmeldung."),
    icon: () => <span class="ld-how-num">1</span>,
  },
  {
    title: t("Jeden Zug prüfen"),
    text: t("Eine Schach-Engine läuft in deinem Browser und bewertet jeden deiner Züge, vom besten Zug bis zum Patzer. Erst ein schneller Überblick, dann gründlich."),
    icon: IconCpu,
  },
  {
    title: t("Muster erkennen"),
    text: t("Aus vielen Partien wird dein Profil: in welcher Phase du Punkte verlierst, welche Eröffnungen dir liegen, welche Fehler sich wiederholen."),
    icon: IconInsights,
  },
  {
    title: t("Gezielt trainieren"),
    text: t("Deine eigenen Fehlstellungen werden zu Aufgaben. Du übst genau das, was dich Partien kostet, statt zufälliger Rätsel."),
    icon: IconTraining,
  },
];

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Demo() {
  // ply = moves played so far; it loops with a pause at the end.
  const [ply, setPly] = useState(reduced() ? DEMO_LINE.length : 0);
  useEffect(() => {
    if (reduced()) return;
    const tk = window.setTimeout(() => setPly((p) => (p >= DEMO_LINE.length ? 0 : p + 1)), ply === 0 ? 900 : ply >= DEMO_LINE.length ? 4200 : 2100);
    return () => window.clearTimeout(tk);
  }, [ply]);

  const { fen, last } = useMemo(() => {
    const g = new Chess();
    let lastMove: { from: string; to: string } | null = null;
    for (const s of DEMO_LINE.slice(0, ply)) {
      const m = g.move(s.san);
      lastMove = { from: m.from, to: m.to };
    }
    return { fen: g.fen(), last: lastMove };
  }, [ply]);
  const step = ply > 0 ? DEMO_LINE[ply - 1] : null;
  const arrows: Arrow[] = step?.arrow ? [{ ...step.arrow, kind: "threat" }] : [];
  const say = step ? step.say : t("Schau zu, wie ich eine Partie lese.");

  return (
    <div class="ld-demo">
      <div class="ld-demo-board">
        <Board fen={fen} lastMove={last} badge={step?.badge} arrows={arrows} />
      </div>
      <div class="ld-say ld-demo-say" aria-live="off">
        <CoachAvatar mood={step?.badge === "Blunder" ? "sad" : step?.badge === "Best" ? "wow" : "think"} size={48} />
        <p key={ply}>{say}</p>
      </div>
      <p class="ld-fine ld-demo-note">{t("Beispielpartie zur Veranschaulichung")}</p>
    </div>
  );
}

export function LandingHow() {
  return (
    <section class="ld-how" aria-labelledby="ld-how-title">
      <div class="ld-how-head">
        <p class="ld-kicker">{t("So funktioniert's")}</p>
        <h2 id="ld-how-title">{t("Von deinen Partien zu deinem Trainingsplan.")}</h2>
        <p class="ld-lead">{t("{COACH_NAME} liest jede deiner Partien wie ein Trainer, der nie müde wird, und erzählt dir nur, was sich in vielen Partien wirklich zeigt.", { COACH_NAME })}</p>
      </div>
      <div class="ld-how-grid">
        <ol class="ld-how-steps">
          {HOW.map((h) => (
            <li class="ld-how-step" key={h.title}>
              <span class="ld-skill-icon">
                <h.icon />
              </span>
              <div>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Demo />
      </div>
    </section>
  );
}
