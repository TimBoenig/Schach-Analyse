// The opening of the shown position, e.g. "C50 Italienische Partie · Giuoco Piano",
// and whether the game is still in known theory there.
import { type BookData, openingOf } from "../domain/book";
import { openingParts } from "../domain/profile";

/** Number of the move that led to the position `fen`. */
function moveNumber(fen: string): number {
  const [, turn, , , , full] = fen.split(" ");
  const n = Number(full) || 1;
  return turn === "b" ? n : Math.max(1, n - 1);
}

export function OpeningLine({ fens, book }: { fens: string[]; book: BookData | null }) {
  const at = openingOf(book, fens);
  if (!at) return null;
  const { main, variation } = openingParts(at.name);
  const inBook = at.index === fens.length - 1;
  return (
    <div class="opening-line" title={at.name}>
      <span class="opening-eco">{at.eco}</span>
      <span class="opening-name">
        <strong>{main}</strong>
        {variation && <span class="muted"> · {variation}</span>}
      </span>
      <span class={`opening-state${inBook ? " in" : ""}`}>{inBook ? "Theorie" : `Theorie bis Zug ${moveNumber(fens[at.index])}`}</span>
    </div>
  );
}
