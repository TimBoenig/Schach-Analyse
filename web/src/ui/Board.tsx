import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

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
const PROMOTIONS = ["q", "r", "b", "n"] as const;
export type Promotion = (typeof PROMOTIONS)[number];

// A pointer has to travel this far (in squares) before a press becomes a drag,
// so a slightly shaky tap on a tablet still counts as a tap.
const DRAG_START = 0.18;
const MOVE_ANIMATION_MS = 170;

export interface Arrow {
  from: string;
  to: string;
  kind: "best" | "played" | "hint" | "user" | "wrong";
}

interface Props {
  fen: string;
  flipped?: boolean;
  lastMove?: { from: string; to: string } | null;
  arrows?: Arrow[];
  /** Badge drawn on the destination square of the last move. */
  badge?: Classification;
  /** Enables tap- and drag-to-move; return true if the move was accepted. */
  onMove?: (from: string, to: string, promotion?: Promotion) => boolean;
  /** Squares the selected piece may move to (for tap-to-move hints). */
  legalTargets?: (from: string) => string[];
  highlight?: string[];
  /** Lets the player draw arrows and circles with the right mouse button (desktop). */
  annotate?: boolean;
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

function squareAt(x: number, y: number, flipped: boolean): string | null {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return flipped ? FILES[7 - col] + (row + 1) : FILES[col] + (8 - row);
}

function pieceAt(grid: (string | null)[][], sq: string): string | null {
  return grid[8 - Number(sq[1])]?.[FILES.indexOf(sq[0])] ?? null;
}

const pieceHref = (piece: string) =>
  `${import.meta.env.BASE_URL}pieces/${piece === piece.toUpperCase() ? "white" : "black"}-${PIECE_FILE[piece.toLowerCase()]}.svg`;

function arrowLine(a: Arrow, flipped: boolean, key: string | number) {
  const [x1, y1] = squareXY(a.from, flipped);
  const [x2, y2] = squareXY(a.to, flipped);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Stop short so the arrow head sits inside the target square.
  const ex = x2 + 0.5 - (dx / len) * 0.3;
  const ey = y2 + 0.5 - (dy / len) * 0.3;
  return <line key={key} x1={x1 + 0.5} y1={y1 + 0.5} x2={ex} y2={ey} class={`arrow arrow-${a.kind}`} marker-end={`url(#ah-${a.kind})`} />;
}

interface Drag {
  from: string;
  piece: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  /** The piece was already selected when pressed: a plain tap deselects it. */
  wasSelected: boolean;
}

export function Board({ fen, flipped = false, lastMove, arrows = [], badge, onMove, legalTargets, highlight = [], annotate = false }: Props) {
  const grid = useMemo(() => parseBoard(fen), [fen]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; white: boolean } | null>(null);
  const [marks, setMarks] = useState<{ arrows: Arrow[]; circles: string[] }>({ arrows: [], circles: [] });
  const drawFrom = useRef<string | null>(null);
  const prevGrid = useRef(grid);
  const dropped = useRef(false);

  useEffect(() => {
    setSelected(null);
    setPromo(null);
    setMarks({ arrows: [], circles: [] });
  }, [fen]);

  // Slide the moved piece from its origin, so stepping through a game reads like a replay.
  useLayoutEffect(() => {
    const before = prevGrid.current;
    prevGrid.current = grid;
    if (dropped.current) {
      dropped.current = false;
      return;
    }
    if (!lastMove || before === grid || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const moved = pieceAt(grid, lastMove.to);
    if (!moved || pieceAt(before, lastMove.from) === null || pieceAt(grid, lastMove.from) !== null) return;
    const el = svgRef.current?.querySelector<SVGImageElement>(`[data-sq="${lastMove.to}"]`);
    if (!el?.animate) return;
    const [fx, fy] = squareXY(lastMove.from, flipped);
    const [tx, ty] = squareXY(lastMove.to, flipped);
    el.animate([{ transform: `translate(${fx - tx}px, ${fy - ty}px)` }, { transform: "translate(0px, 0px)" }], {
      duration: MOVE_ANIMATION_MS,
      easing: "cubic-bezier(.2,.7,.3,1)",
    });
  }, [grid]);

  const targets = selected && legalTargets ? legalTargets(selected) : [];

  const toBoard = (e: PointerEvent): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * 8, ((e.clientY - rect.top) / rect.height) * 8];
  };

  const movable = (sq: string) => Boolean(onMove && pieceAt(grid, sq) && (legalTargets?.(sq).length ?? 0) > 0);

  const attempt = (from: string, to: string): boolean => {
    if (!onMove) return false;
    const piece = pieceAt(grid, from);
    if (piece?.toLowerCase() === "p" && (to[1] === "8" || to[1] === "1")) {
      setPromo({ from, to, white: piece === "P" });
      return true;
    }
    return onMove(from, to);
  };

  const tap = (sq: string) => {
    if (!onMove) return;
    if (selected && selected !== sq && targets.includes(sq)) {
      attempt(selected, sq);
      setSelected(null);
      return;
    }
    setSelected(selected === sq ? null : movable(sq) ? sq : null);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (promo) return;
    const [x, y] = toBoard(e);
    const sq = squareAt(x, y, flipped);
    if (!sq) return;
    if (e.button === 2) {
      if (annotate) drawFrom.current = sq;
      return;
    }
    if (e.button !== 0) return;
    if (marks.arrows.length || marks.circles.length) setMarks({ arrows: [], circles: [] });
    if (!onMove) return;
    const piece = pieceAt(grid, sq);
    if (piece && movable(sq)) {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setDrag({ from: sq, piece, pointerId: e.pointerId, startX: x, startY: y, x, y, moved: false, wasSelected: selected === sq });
      setSelected(sq);
      // Keep the page from scrolling while a piece is held.
      e.preventDefault();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const [x, y] = toBoard(e);
    const moved = drag.moved || Math.hypot(x - drag.startX, y - drag.startY) > DRAG_START;
    setDrag({ ...drag, x, y, moved });
  };

  const onPointerUp = (e: PointerEvent) => {
    const [x, y] = toBoard(e);
    const sq = squareAt(x, y, flipped);
    if (e.button === 2) {
      const from = drawFrom.current;
      drawFrom.current = null;
      if (!annotate || !from || !sq) return;
      setMarks((m) => {
        if (from === sq) {
          const has = m.circles.includes(sq);
          return { ...m, circles: has ? m.circles.filter((c) => c !== sq) : [...m.circles, sq] };
        }
        const has = m.arrows.some((a) => a.from === from && a.to === sq);
        return { ...m, arrows: has ? m.arrows.filter((a) => !(a.from === from && a.to === sq)) : [...m.arrows, { from, to: sq, kind: "user" }] };
      });
      return;
    }
    if (drag && e.pointerId === drag.pointerId) {
      const d = drag;
      setDrag(null);
      if (d.moved) {
        if (sq && sq !== d.from && legalTargets?.(d.from).includes(sq)) {
          dropped.current = true;
          attempt(d.from, sq);
          setSelected(null);
        }
        return;
      }
      if (d.wasSelected) setSelected(null);
      return;
    }
    if (sq) tap(sq);
  };

  const squares = [];
  const pieces = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const file = flipped ? 7 - x : x;
      const rank = flipped ? y + 1 : 8 - y;
      const sq = FILES[file] + rank;
      const light = (file + rank) % 2 === 1;
      const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
      const piece = grid[8 - rank][file];
      squares.push(
        <g key={sq}>
          <rect x={x} y={y} width={1} height={1} class={light ? "sq-light" : "sq-dark"} />
          {isLast && <rect x={x} y={y} width={1} height={1} class="sq-last" />}
          {highlight.includes(sq) && <rect x={x} y={y} width={1} height={1} class="sq-hl" />}
          {selected === sq && <rect x={x} y={y} width={1} height={1} class="sq-sel" />}
          {drag?.moved && squareAt(drag.x, drag.y, flipped) === sq && targets.includes(sq) && (
            <rect x={x + 0.03} y={y + 0.03} width={0.94} height={0.94} class="sq-drop" />
          )}
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
      if (piece) {
        const lifted = drag?.moved && drag.from === sq;
        pieces.push(
          <image
            key={sq + piece}
            data-sq={sq}
            href={pieceHref(piece)}
            x={x}
            y={y}
            width={1}
            height={1}
            class={`piece${lifted ? " lifted" : ""}${promo?.from === sq ? " lifted" : ""}`}
          />,
        );
      }
      if (targets.includes(sq)) {
        pieces.push(
          <circle key={`t${sq}`} cx={x + 0.5} cy={y + 0.5} r={piece ? 0.45 : 0.15} class={piece ? "target-capture" : "target-dot"} />,
        );
      }
    }
  }

  const badgeIcon = badge ? badgeFor(badge) : null;
  let badgeEl = null;
  if (badgeIcon && lastMove && !drag?.moved) {
    const [bx, by] = squareXY(lastMove.to, flipped);
    badgeEl = <image href={badgeIcon} x={Math.min(7.5, bx + 0.62)} y={Math.max(0, by - 0.12)} width={0.5} height={0.5} class="badge" />;
  }

  let promoEl = null;
  if (promo) {
    const [px, py] = squareXY(promo.to, flipped);
    // The picker grows from the promotion square towards the board centre.
    const down = py === 0;
    promoEl = (
      <g class="promo">
        <rect x={0} y={0} width={8} height={8} class="promo-shade" onPointerUp={() => setPromo(null)} />
        {PROMOTIONS.map((p, i) => {
          const yy = down ? py + i : py - i;
          return (
            <g
              key={p}
              class="promo-choice"
              onPointerUp={(e) => {
                e.stopPropagation();
                setPromo(null);
                onMove?.(promo.from, promo.to, p);
              }}
            >
              <rect x={px + 0.04} y={yy + 0.04} width={0.92} height={0.92} rx={0.46} />
              <image href={pieceHref(promo.white ? p.toUpperCase() : p)} x={px + 0.08} y={yy + 0.08} width={0.84} height={0.84} />
            </g>
          );
        })}
      </g>
    );
  }

  return (
    <svg
      ref={svgRef}
      class={`board${drag?.moved ? " dragging" : ""}${onMove ? " interactive" : ""}`}
      viewBox="0 0 8 8"
      role="img"
      aria-label="Schachbrett"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={promo ? undefined : onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onContextMenu={(e) => annotate && e.preventDefault()}
    >
      <defs>
        {(["best", "played", "hint", "user", "wrong"] as const).map((k) => (
          <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class={`arrow-head-${k}`} />
          </marker>
        ))}
      </defs>
      {squares}
      {marks.circles.map((c) => {
        const [cx, cy] = squareXY(c, flipped);
        return <circle key={`c${c}`} cx={cx + 0.5} cy={cy + 0.5} r={0.44} class="mark-circle" />;
      })}
      {pieces}
      {arrows.map((a, i) => arrowLine(a, flipped, i))}
      {marks.arrows.map((a, i) => arrowLine(a, flipped, `u${i}`))}
      {badgeEl}
      {drag?.moved && (
        <image href={pieceHref(drag.piece)} x={drag.x - 0.55} y={drag.y - 0.6} width={1.1} height={1.1} class="piece drag-ghost" />
      )}
      {promoEl}
    </svg>
  );
}
