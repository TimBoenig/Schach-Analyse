// Classic endgame positions every club player should be able to play out
// against the engine. Goals were checked with Stockfish 17.1 (depth 22):
// every "mate"/"promote" position is a forced win, the Philidor position a draw.

import type { PlayoutExercise } from "./exercises";

const basic = (
  key: string,
  title: string,
  fen: string,
  goal: PlayoutExercise["goal"],
  maxMoves: number,
  text: string,
): PlayoutExercise => ({
  id: `b:${key}`,
  kind: "playout",
  category: "basics",
  title,
  fen,
  goal,
  max_moves: maxMoves,
  text,
});

export const BASIC_ENDGAMES: PlayoutExercise[] = [
  basic(
    "kqk",
    "Matt mit der Dame",
    "8/8/8/4k3/8/8/8/4K2Q w - - 0 1",
    "mate",
    12,
    "Setze in höchstens 12 Zügen matt. Enge den König mit der Dame ein (Springerabstand) und hole deinen König dazu. Vorsicht vor Patt!",
  ),
  basic(
    "krrk",
    "Treppenmatt mit zwei Türmen",
    "8/8/8/4k3/8/8/8/R3K2R w - - 0 1",
    "mate",
    15,
    "Die Türme drängen den König abwechselnd Reihe für Reihe an den Rand. Matt in höchstens 15 Zügen.",
  ),
  basic(
    "krk",
    "Matt mit dem Turm",
    "8/8/8/4k3/8/8/8/R3K3 w - - 0 1",
    "mate",
    25,
    "Der Turm schneidet den König ab, dein König nimmt die Opposition ein. Matt in höchstens 25 Zügen.",
  ),
  basic(
    "kpk-6th",
    "Bauernendspiel: König vor dem Bauern",
    "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1",
    "promote",
    8,
    "Steht dein König vor dem Bauern auf der 6. Reihe, gewinnst du immer. Bringe den Bauern sicher zur Dame.",
  ),
  basic(
    "kpk-tempo",
    "Opposition mit Reservetempo",
    "8/8/4k3/8/8/4K3/4P3/8 w - - 0 1",
    "promote",
    15,
    "Gehe mit dem König voran und nutze den Bauernzug als Reservetempo, um die Opposition zu gewinnen. Mach eine Dame daraus.",
  ),
  basic(
    "lucena",
    "Lucena-Stellung (Brückenbau)",
    "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    "promote",
    15,
    "Die wichtigste Gewinnstellung im Turmendspiel: Bringe den Turm auf die 4. Reihe, baue eine Brücke gegen die Schachs und verwandle den Bauern.",
  ),
  basic(
    "philidor",
    "Philidor-Verteidigung",
    "4k3/8/r7/4PK2/8/8/8/4R3 b - - 0 1",
    "hold",
    15,
    "Du verteidigst mit Schwarz. Halte den Turm auf der 6. Reihe (von dir aus die dritte), bis der Bauer vorrückt – dann gib Schachs von hinten. Halte 15 Züge das Remis.",
  ),
];
