// The hero's stage: Lucena, large, next to a board the visitor can play on.
// She sets a mate in one, follows the pointer with her eyes and reacts to the
// move that was played: the product's core (a coach reading your moves) in ten
// seconds, before anyone types a name.
import { Chess, type Square } from "chess.js";
import { useMemo, useState } from "preact/hooks";

import { type Arrow, Board } from "../Board";
import { COACH_NAME, CoachAvatar, type Mood } from "../Coach";
import { IconReset } from "../icons";
import { PUZZLE_FEN, PUZZLE_HINT } from "../landingPuzzle";
import { lang, t } from "../../i18n";

type State = { fen: string; last: { from: string; to: string } | null; misses: number; solved: boolean; wrong: string | null };

// German piece letters, as a German player reads the move (T for Turm, not R).
const DE: Record<string, string> = { Q: "D", R: "T", B: "L", N: "S" };
const germanSan = (san: string) => (lang() === "de" ? san.replace(/[QRBN]/g, (c) => DE[c]) : san);

const START: State = { fen: PUZZLE_FEN, last: null, misses: 0, solved: false, wrong: null };

function speech(s: State): { mood: Mood; text: string } {
  if (s.solved) return { mood: "wow", text: t("Matt. Stark gesehen! Genau so gehe ich durch deine Partien: Zug für Zug, und ich merke mir, was du übersiehst.") };
  if (s.wrong && s.misses >= 2) return { mood: "think", text: t("{move} setzt nicht matt. Der Pfeil zeigt dir den Weg: Die letzte Reihe ist offen.", { move: s.wrong }) };
  if (s.wrong) return { mood: "sad", text: t("{move} setzt noch nicht matt. Schau dir den schwarzen König an: Seine Bauern sperren ihn ein.", { move: s.wrong }) };
  return { mood: "happy", text: t("Hallo, ich bin {COACH_NAME}. Probier es aus: Weiß zieht und setzt in einem Zug matt.", { COACH_NAME }) };
}

export function HeroStage() {
  const [s, setS] = useState<State>(START);
  const game = useMemo(() => new Chess(s.fen), [s.fen]);
  const say = speech(s);

  const onMove = (from: string, to: string): boolean => {
    if (s.solved) return false;
    const trial = new Chess(PUZZLE_FEN);
    let move;
    try {
      move = trial.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    if (trial.isCheckmate()) {
      setS({ fen: trial.fen(), last: { from, to }, misses: s.misses, solved: true, wrong: null });
      return true;
    }
    // A wrong move is shown for a moment by its name, the board stays on the task.
    setS({ ...s, misses: s.misses + 1, wrong: germanSan(move.san), last: null });
    return false;
  };

  const arrows: Arrow[] = !s.solved && s.misses >= 2 ? [{ ...PUZZLE_HINT, kind: "hint" }] : [];

  return (
    <div class={`ld-stage mood-${say.mood}`}>
      <div class="ld-stage-coach">
        <div class="ld-stage-orb">
          <CoachAvatar mood={say.mood} size={200} />
        </div>
        <p class="ld-stage-say" aria-live="polite" key={say.text}>
          {say.text}
        </p>
      </div>
      <div class="ld-stage-board">
        <Board
          fen={s.fen}
          lastMove={s.last}
          badge={s.solved ? "Best" : undefined}
          arrows={arrows}
          onMove={onMove}
          legalTargets={(from) => (s.solved ? [] : game.moves({ square: from as Square, verbose: true }).map((m) => m.to))}
        />
      </div>
      <div class="ld-stage-foot">
        <span>{s.solved ? t("Gelöst") : s.misses ? (s.misses === 1 ? t("1 Versuch") : t("{n} Versuche", { n: s.misses })) : t("Zieh eine Figur oder tippe sie an")}</span>
        {(s.solved || s.misses > 0) && (
          <button class="btn small ghost" onClick={() => setS(START)}>
            <IconReset /> {t("Nochmal")}
          </button>
        )}
      </div>
    </div>
  );
}
