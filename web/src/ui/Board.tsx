import { useMemo, useState } from "preact/hooks";

import { badgeFor } from "./labels";
import type { Classification } from "../domain/types";

const FILES = "abcdefgh";
const PIECE_FILE: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export interface Arrow {
  from: string;
  to: string;
  kind: "best" | "played" | "hint";
}

interface Props {
  fen: string;
  flipped?: boolean;
  lastMove?: { from: string; to: string } | null;
  arrows?: Arrow[];
  /** Badge drawn on the destination square of the last move. */
  badge?: Classification;
  /** Enables tap-to-move; return true if the move was accepted. */
  onMove?: (from: string, to: string) => boolean;
  /** Squares the selected piece may move to (for tap-to-move hints). */
  legalTargets?: (from: string) => string[];
  highlight?: string[];
}

function parseBoard(fen: string): (string | null)[][] {
  const rows = fen.split(" ")[0].split("/");
  if (rows.length !== 8) return Array.from({ length: 8 }, () => Array<string | null>(8).fill(null));
  return rows.map((row) => {
    const out: (string | null)[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
      else out.push(ch);
    }
    return out;
  });
}

function squareXY(square: string, flipped: boolean): [number, number] {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return flipped ? [7 - file, rank] : [file, 7 - rank];
}

export function Board({ fen, flipped = false, lastMove, arrows = [], badge, onMove, legalTargets, highlight = [] }: Props) {
  const grid = useMemo(() => parseBoard(fen), [fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const targets = selected && legalTargets ? legalTargets(selected) : [];

  const tap = (sq: string) => {
    if (!onMove) return;
    if (selected && selected !== sq && targets.includes(sq)) {
      onMove(selected, sq);
      setSelected(null);
      return;
    }
    const piece = grid[8 - Number(sq[1])]?.[FILES.indexOf(sq[0])];
    setSelected(piece && (legalTargets?.(sq).length ?? 0) > 0 ? sq : null);
  };

  const squares = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const file = flipped ? 7 - x : x;
      const rank = flipped ? y + 1 : 8 - y;
      const sq = FILES[file] + rank;
      const light = (file + rank) % 2 === 1;
      const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
      const piece = grid[8 - rank][file];
      squares.push(
        <g key={sq} onClick={() => tap(sq)}>
          <rect x={x} y={y} width={1} height={1} class={light ? "sq-light" : "sq-dark"} />
          {isLast && <rect x={x} y={y} width={1} height={1} class="sq-last" />}
          {highlight.includes(sq) && <rect x={x} y={y} width={1} height={1} class="sq-hl" />}
          {selected === sq && <rect x={x} y={y} width={1} height={1} class="sq-sel" />}
          {piece && (
            <image
              href={`${import.meta.env.BASE_URL}pieces/${piece === piece.toUpperCase() ? "white" : "black"}-${PIECE_FILE[piece.toLowerCase()]}.svg`}
              x={x}
              y={y}
              width={1}
              height={1}
            />
          )}
          {targets.includes(sq) && <circle cx={x + 0.5} cy={y + 0.5} r={piece ? 0.45 : 0.15} class={piece ? "target-capture" : "target-dot"} />}
          {x === 0 && (
            <text x={0.04} y={y + 0.2} class={light ? "coord-dark" : "coord-light"}>
              {rank}
            </text>
          )}
          {y === 7 && (
            <text x={x + 0.82} y={7.95} class={light ? "coord-dark" : "coord-light"}>
              {FILES[file]}
            </text>
          )}
        </g>,
      );
    }
  }

  const badgeIcon = badge ? badgeFor(badge) : null;
  let badgeEl = null;
  if (badgeIcon && lastMove) {
    const [bx, by] = squareXY(lastMove.to, flipped);
    badgeEl = <image href={badgeIcon} x={bx + 0.62} y={by - 0.12} width={0.5} height={0.5} class="badge" />;
  }

  return (
    <svg class="board" viewBox="0 0 8 8" role="img" aria-label="Schachbrett">
      <defs>
        {(["best", "played", "hint"] as const).map((k) => (
          <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class={`arrow-head-${k}`} />
          </marker>
        ))}
      </defs>
      {squares}
      {arrows.map((a, i) => {
        const [x1, y1] = squareXY(a.from, flipped);
        const [x2, y2] = squareXY(a.to, flipped);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        // Stop short so the arrow head sits inside the target square.
        const ex = x2 + 0.5 - (dx / len) * 0.3;
        const ey = y2 + 0.5 - (dy / len) * 0.3;
        return (
          <line key={i} x1={x1 + 0.5} y1={y1 + 0.5} x2={ex} y2={ey} class={`arrow arrow-${a.kind}`} marker-end={`url(#ah-${a.kind})`} />
        );
      })}
      {badgeEl}
    </svg>
  );
}
