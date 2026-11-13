// The app's own chessboard: pieces slide between positions, can be dragged or
// tapped to move, and the board draws arrows, rings, highlights and the move badge.
// It is fully controlled: it always shows the `fen` the page passes, so a move the
// page rejects (or accepts but does not show, like a wrong puzzle answer) simply
// leaves the old position on the board.
// Geometry (placement, slides, arrow shapes) lives in board/geometry.ts.
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { badgeFor } from "./labels";
import type { Classification } from "../domain/types";
import {
  arrowGeometry,
  carryPieces,
  checkedKing,
  isWhitePiece,
  readPlacement,
  screenPos,
  snapTarget,
  squareAtFraction,
  type PlacedPiece,
} from "./board/geometry";

const PROMOTIONS = ["q", "r", "b", "n"] as const;
export type Promotion = (typeof PROMOTIONS)[number];
const PIECE_NAME: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

export interface Arrow {
  from: string;
  to: string;
  kind: "best" | "played" | "hint" | "user" | "wrong" | "engine2" | "threat";
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
  /** Rings around squares, e.g. the square of a fork the move prevented. */
  circles?: { at: string; kind: Arrow["kind"] }[];
  /** Lets the player draw arrows and circles with the right mouse button (desktop). */
  annotate?: boolean;
  /** Horizontal swipe that starts on an empty square (a piece is picked up instead). */
  onSwipe?: (direction: "left" | "right") => void;
}

type Brush = { color: string; opacity: number; width: number };

// Colours are CSS custom properties, so board themes and light/dark mode stay in
// styles.css. Widths are in squares.
const BRUSHES: Record<Arrow["kind"], Brush> = {
  best: { color: "var(--arrow-best)", opacity: 0.85, width: 0.19 },
  hint: { color: "var(--arrow-hint)", opacity: 0.85, width: 0.19 },
  played: { color: "var(--arrow-played)", opacity: 0.85, width: 0.19 },
  user: { color: "var(--arrow-user)", opacity: 0.85, width: 0.19 },
  wrong: { color: "var(--blunder)", opacity: 0.85, width: 0.19 },
  // Second engine line: thinner and fainter than the first.
  engine2: { color: "var(--arrow-hint)", opacity: 0.45, width: 0.11 },
  threat: { color: "var(--blunder)", opacity: 0.7, width: 0.14 },
};

// The player's own drawings: right mouse button; Shift/Ctrl and Alt pick other colours.
const DRAW_BRUSHES: Brush[] = [
  { color: "var(--arrow-best)", opacity: 0.9, width: 0.16 },
  { color: "var(--blunder)", opacity: 0.9, width: 0.16 },
  { color: "var(--arrow-hint)", opacity: 0.9, width: 0.16 },
  { color: "var(--arrow-user)", opacity: 0.9, width: 0.16 },
];

interface Drawing {
  from: string;
  to: string;
  brush: number;
}

interface Pick {
  square: string;
  pointerId: number;
  x: number;
  y: number;
  touch: boolean;
  /** The piece was already selected: a plain tap on it deselects it. */
  wasSelected: boolean;
  dragging: boolean;
}

function whiteToMove(fen: string): boolean {
  return fen.split(" ")[1] !== "b";
}

const pct = (n: number) => `${n * 12.5}%`;

interface ShapeProps {
  brush: Brush;
  flipped: boolean;
  /** "drawn" marks the player's own drawings. */
  cls?: string;
}

function ArrowShape({ from, to, brush, flipped, cls }: ShapeProps & { from: string; to: string }) {
  const g = arrowGeometry(from, to, flipped, brush.width);
  return (
    <g class={cls} opacity={brush.opacity}>
      <polyline
        points={g.shaft.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke-width={brush.width}
        stroke-linecap="round"
        stroke-linejoin="round"
        style={{ stroke: brush.color }}
      />
      <polygon points={g.head.map((p) => p.join(",")).join(" ")} style={{ fill: brush.color }} />
    </g>
  );
}

function Ring({ at, brush, flipped, cls }: ShapeProps & { at: string }) {
  const [c, r] = screenPos(at, flipped);
  const w = brush.width * 0.45;
  return <circle class={cls} cx={c + 0.5} cy={r + 0.5} r={0.5 - w / 2 - 0.02} fill="none" stroke-width={w} opacity={brush.opacity} style={{ stroke: brush.color }} />;
}

export function Board({ fen, flipped = false, lastMove, arrows = [], badge, onMove, legalTargets, highlight = [], circles = [], annotate = false, onSwipe }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ square: string; over: string | null; touch: boolean } | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; white: boolean } | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const pick = useRef<Pick | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const placement = readPlacement(fen);
  const white = whiteToMove(fen);
  const movable = !!onMove && !!legalTargets;
  const canPick = (sq: string) => {
    const p = placement.get(sq);
    return movable && !!p && isWhitePiece(p) === white && legalTargets!(sq).length > 0;
  };
  // Promotions list the same square once per piece.
  const dests = selected && movable && placement.has(selected) ? [...new Set(legalTargets!(selected))] : [];

  // Piece identities survive position changes so a moved piece slides (CSS transition).
  // A flip starts over with new ids: the whole board turning around should not animate.
  const ids = useRef({ next: 1, fen: "", flipped, pieces: [] as PlacedPiece[], fresh: new Set<string>() });
  const placementKey = fen.split(" ")[0];
  if (ids.current.fen !== placementKey || ids.current.flipped !== flipped) {
    const s = ids.current;
    const prev = s.flipped === flipped ? s.pieces : [];
    s.pieces = carryPieces(prev, placement, () => s.next++, s.fresh);
    s.fen = placementKey;
    s.flipped = flipped;
    s.fresh = new Set();
  }

  // A new position ends whatever the player was doing on the old one.
  useEffect(() => {
    setSelected(null);
    setPromo(null);
    setDrawings([]);
  }, [fen]);

  const toFraction = (clientX: number, clientY: number): [number, number] => {
    const rect = rootRef.current!.getBoundingClientRect();
    return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height];
  };
  const squareAt = (clientX: number, clientY: number) => {
    const [fx, fy] = toFraction(clientX, clientY);
    return squareAtFraction(fx, fy, flipped);
  };

  const tryMove = (from: string, to: string, dropped: boolean) => {
    setSelected(null);
    const piece = placement.get(from);
    if (piece?.toLowerCase() === "p" && (to[1] === "8" || to[1] === "1")) {
      setPromo({ from, to, white: piece === "P" });
      return;
    }
    // A piece dropped by hand already is on its square: no slide from where it started.
    if (dropped) ids.current.fresh = new Set([to]);
    const ok = onMove?.(from, to) ?? false;
    // The page has re-rendered by the next frame; a mark it did not use must not linger.
    if (!ok) ids.current.fresh = new Set();
    else requestAnimationFrame(() => (ids.current.fresh = new Set()));
  };

  const placeFloat = (clientX: number, clientY: number) => {
    const el = floatRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const rect = root.getBoundingClientRect();
    const size = rect.width / 8;
    // Under a finger the piece is shown larger, so it stays visible around the fingertip.
    const scale = el.classList.contains("touch") ? " scale(1.35)" : "";
    el.style.transform = `translate(${clientX - rect.left - size / 2}px, ${clientY - rect.top - size / 2}px)${scale}`;
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (promo) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (e.button === 2) {
      if (annotate && e.pointerType === "mouse" && sq) {
        const brush = (e.shiftKey || e.ctrlKey ? 1 : 0) + (e.altKey || e.metaKey ? 2 : 0);
        setDrawing({ from: sq, to: sq, brush });
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (e.button !== 0) return;
    if (drawings.length) setDrawings([]);
    if (!sq) return;
    if (selected && dests.includes(sq)) {
      tryMove(selected, sq, false);
      return;
    }
    if (canPick(sq)) {
      e.preventDefault();
      pick.current = { square: sq, pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse", wasSelected: selected === sq, dragging: false };
      setSelected(sq);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    setSelected(null);
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (drawing) {
      const [fx, fy] = toFraction(e.clientX, e.clientY);
      const to = snapTarget(drawing.from, fx * 8, fy * 8, flipped);
      if (to !== drawing.to) setDrawing({ ...drawing, to });
      return;
    }
    const p = pick.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.dragging) {
      // A small wobble while tapping is not a drag.
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < (p.touch ? 8 : 4)) return;
      p.dragging = true;
    }
    const over = squareAt(e.clientX, e.clientY);
    if (!drag || drag.over !== over) setDrag({ square: p.square, over, touch: p.touch });
    placeFloat(e.clientX, e.clientY);
  };

  // The floating piece is positioned by hand (no re-render per pointer move);
  // place it once it exists.
  const lastPointer = useRef<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    if (drag) placeFloat(...lastPointer.current);
  }, [drag !== null]);

  const onPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (drawing) {
      const d = drawing;
      setDrawing(null);
      setDrawings((list) => {
        const same = list.find((x) => x.from === d.from && x.to === d.to);
        const rest = list.filter((x) => x !== same);
        // Drawing the same shape again removes it; another colour replaces it.
        return same && same.brush === d.brush ? rest : [...rest, d];
      });
      return;
    }
    const p = pick.current;
    if (!p || p.pointerId !== e.pointerId) return;
    pick.current = null;
    setDrag(null);
    if (!p.dragging) {
      if (p.wasSelected) setSelected(null);
      return;
    }
    const to = squareAt(e.clientX, e.clientY);
    if (to && to !== p.square && legalTargets?.(p.square).includes(to)) tryMove(p.square, to, true);
    else if (to !== p.square) setSelected(null);
  };

  const cancelPick = () => {
    pick.current = null;
    setDrag(null);
    setDrawing(null);
  };

  const check = checkedKing(placement, white);
  const badgeHref = badge && lastMove && !promo ? badgeFor(badge) : null;
  const userShapes = drawing ? [...drawings.filter((d) => !(d.from === drawing.from && d.to === drawing.to)), drawing] : drawings;

  const squareMarks: JSX.Element[] = [];
  const mark = (sq: string, cls: string) => {
    const [c, r] = screenPos(sq, flipped);
    squareMarks.push(<div key={`${cls}-${sq}`} class={`sq ${cls}`} style={{ left: pct(c), top: pct(r) }} />);
  };
  if (lastMove) {
    mark(lastMove.from, "last");
    mark(lastMove.to, "last");
  }
  for (const sq of highlight) mark(sq, "hl");
  if (check) mark(check, "check");
  if (selected && movable) mark(selected, "selected");
  for (const sq of dests) mark(sq, placement.has(sq) ? "dest capture" : "dest");
  if (drag?.over && drag.over !== drag.square) mark(drag.over, drag.touch ? "over touch" : "over");

  const coords: JSX.Element[] = [];
  for (let i = 0; i < 8; i++) {
    // Ranks down the left edge, files along the bottom, in the opposite square colour.
    const rank = flipped ? i + 1 : 8 - i;
    const file = "abcdefgh"[flipped ? 7 - i : i];
    coords.push(
      <span key={`r${i}`} class={`coord rank ${i % 2 ? "on-dark" : "on-light"}`} style={{ top: pct(i) }}>
        {rank}
      </span>,
      <span key={`f${i}`} class={`coord file ${i % 2 ? "on-light" : "on-dark"}`} style={{ left: pct(i) }}>
        {file}
      </span>,
    );
  }

  let promoEl = null;
  if (promo) {
    const [col] = screenPos(promo.to, flipped);
    // The picker grows from the promotion square towards the board centre.
    const atTop = (promo.to[1] === "8") !== flipped;
    promoEl = (
      <div
        class="promo-overlay"
        onPointerDown={(e) => {
          e.stopPropagation();
          setPromo(null);
        }}
      >
        {PROMOTIONS.map((p, k) => (
          <button
            key={p}
            class="promo-choice"
            style={{ left: pct(col), top: pct(atTop ? k : 7 - k) }}
            aria-label={`Umwandeln in ${PIECE_NAME[p]}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              const chosen = promo;
              setPromo(null);
              onMove?.(chosen.from, chosen.to, p);
            }}
          >
            <span class={`promo-piece ${promo.white ? "white" : "black"} ${PIECE_NAME[p]}`} />
          </button>
        ))}
      </div>
    );
  }

  const draggedPiece = drag ? placement.get(drag.square) : undefined;

  return (
    <div
      ref={rootRef}
      class={`board${movable ? " interactive" : ""}${drag ? " is-dragging" : ""}`}
      role="img"
      aria-label="Schachbrett"
      onPointerDown={(e) => {
        lastPointer.current = [e.clientX, e.clientY];
        onPointerDown(e);
      }}
      onPointerMove={(e) => {
        lastPointer.current = [e.clientX, e.clientY];
        onPointerMove(e);
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelPick}
      onContextMenu={(e) => annotate && e.preventDefault()}
      onTouchStart={(e) => {
        const t = e.touches[0];
        const sq = t ? squareAt(t.clientX, t.clientY) : null;
        swipeStart.current = t && !(sq && placement.has(sq)) ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const s = swipeStart.current;
        const t = e.changedTouches[0];
        swipeStart.current = null;
        if (!s || !t || !onSwipe) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? "left" : "right");
      }}
    >
      <div class="board-squares" aria-hidden="true">
        {squareMarks}
        {coords}
      </div>
      <div class="board-pieces" aria-hidden="true">
        {ids.current.pieces.map((p) => {
          const [c, r] = screenPos(p.square, flipped);
          const ghost = drag?.square === p.square;
          // Pieces of the side to move show a grab cursor (the board handles the pointer events).
          const own = movable && isWhitePiece(p.piece) === white;
          return (
            <div
              key={p.id}
              class={`pc ${isWhitePiece(p.piece) ? "white" : "black"} ${PIECE_NAME[p.piece.toLowerCase()]}${own ? " own" : ""}${ghost ? " ghost" : ""}`}
              style={{ transform: `translate(${c * 100}%, ${r * 100}%)` }}
            />
          );
        })}
      </div>
      <svg class="board-shapes" viewBox="0 0 8 8" aria-hidden="true">
        {arrows.map((a, i) => (
          <ArrowShape key={`a${i}${a.kind}${a.from}${a.to}`} from={a.from} to={a.to} brush={BRUSHES[a.kind] ?? BRUSHES.hint} flipped={flipped} />
        ))}
        {circles.map((c, i) => (
          <Ring key={`c${i}${c.kind}${c.at}`} at={c.at} brush={BRUSHES[c.kind] ?? BRUSHES.hint} flipped={flipped} />
        ))}
        {userShapes.map((d) =>
          d.from === d.to ? (
            <Ring key={`u${d.from}`} cls="drawn" at={d.from} brush={DRAW_BRUSHES[d.brush]} flipped={flipped} />
          ) : (
            <ArrowShape key={`u${d.from}${d.to}`} cls="drawn" from={d.from} to={d.to} brush={DRAW_BRUSHES[d.brush]} flipped={flipped} />
          ),
        )}
        {badgeHref &&
          (() => {
            const [c, r] = screenPos(lastMove!.to, flipped);
            // Over the square's top-right corner, but kept inside the board on the edge files and ranks.
            return <image class="badge" href={badgeHref} x={Math.min(c + 0.58, 7.44)} y={Math.max(r - 0.14, 0)} width="0.56" height="0.56" />;
          })()}
      </svg>
      {draggedPiece && (
        <div
          ref={floatRef}
          class={`pc floating ${isWhitePiece(draggedPiece) ? "white" : "black"} ${PIECE_NAME[draggedPiece.toLowerCase()]}${drag?.touch ? " touch" : ""}`}
        />
      )}
      {promoEl}
    </div>
  );
}
