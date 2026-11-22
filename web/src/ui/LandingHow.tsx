// "So funktioniert's" on the landing page: four steps from import to training,
// next to a board that replays a short trap while Lucena comments on it.
import { Chess } from "chess.js";
import { useEffect, useMemo, useState } from "preact/hooks";

import { type Arrow, Board } from "./Board";
import { COACH_NAME, CoachAvatar } from "./Coach";
import { DEMO_LINE } from "./landingPuzzle";
import { t } from "../i18n";

const HOW: { title: string; text: string }[] = [
  {
    title: t("Partien holen"),
    text: t("Du gibst deinen Namen bei chess.com oder Lichess ein. Lucena lädt deine öffentlichen Partien direkt auf dein Gerät, ohne Anmeldung."),
  },
  {
    title: t("Jeden Zug prüfen"),
    text: t("Eine Schach-Engine läuft in deinem Browser und bewertet jeden deiner Züge, vom besten Zug bis zum Patzer. Erst ein schneller Überblick, dann gründlich."),
  },
  {
    title: t("Muster erkennen"),
    text: t("Aus vielen Partien wird dein Profil: in welcher Phase du Punkte verlierst, welche Eröffnungen dir liegen, welche Fehler sich wiederholen."),
  },
  {
    title: t("Gezielt trainieren"),
    text: t("Deine eigenen Fehlstellungen werden zu Aufgaben. Du übst genau das, was dich Partien kostet, statt zufälliger Rätsel."),
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
  const say = step ? step.say : t("So lese ich eine Partie, Zug für Zug.");

  return (
    <div class="ld-demo">
      <div class="ld-demo-board">
        <Board fen={fen} lastMove={last} badge={step?.badge} arrows={arrows} />
      </div>
      <div class="ld-say ld-demo-say" aria-live="off">
        <CoachAvatar mood={step?.badge === "Blunder" ? "sad" : step?.badge === "Best" ? "wow" : "think"} size={48} />
        <p key={ply}>{say}</p>
      </div>
      <p class="ld-demo-note">{t("Beispielpartie: die Schäferzug-Falle")}</p>
    </div>
  );
}

export function LandingHow() {
  return (
    <section class="ld-how" id="so-gehts" aria-labelledby="ld-how-title">
      <div class="ld-how-head">
        <h2 id="ld-how-title">{t("So funktioniert's: von deinen Partien zum Trainingsplan.")}</h2>
        <p class="ld-lead">{t("Vier Schritte, die meisten davon erledigt {COACH_NAME} für dich. Daneben siehst du, wie sie eine Partie liest.", { COACH_NAME })}</p>
      </div>
      <div class="ld-how-grid">
        <ol class="ld-how-steps">
          {HOW.map((h, i) => (
            <li class="ld-how-step" key={h.title}>
              <span class="ld-how-num" aria-hidden="true">
                {i + 1}
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
