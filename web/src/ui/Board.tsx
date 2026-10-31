// Chessboard built on Lichess' chessground (GPL-3.0-or-later, see web/THIRD_PARTY.md).
// The wrapper keeps the small props interface the app used before, so every page
// (analysis, free board, training) gets chessground's dragging, animation and
// arrow drawing without knowing about its API.
import { Chess } from "chess.js";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawBrushes, DrawShape } from "@lichess-org/chessground/draw";
import type { Dests, Key } from "@lichess-org/chessground/types";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { badgeFor } from "./labels";
import type { Classification } from "../domain/types";

import "@lichess-org/chessground/assets/chessground.base.css";

const FILES = "abcdefgh";
const PROMOTIONS = ["q", "r", "b", "n"] as const;
export type Promotion = (typeof PROMOTIONS)[number];
const PIECE_NAME: Record<string, string> = { q: "queen", r: "rook", b: "bishop", n: "knight" };

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
  /** Lets the player draw arrows and circles with the right mouse button (desktop). */
  annotate?: boolean;
  /** Horizontal swipe that starts on an empty square (a piece is picked up instead). */
  onSwipe?: (direction: "left" | "right") => void;
}

// Arrow colours come from CSS custom properties, so board themes and light/dark
// mode stay in styles.css; chessground needs them as plain values for SVG attributes.
const BRUSH_VARS: Record<Arrow["kind"], { cssVar: string; opacity: number; lineWidth: number }> = {
  best: { cssVar: "--arrow-best", opacity: 0.85, lineWidth: 12 },
  hint: { cssVar: "--arrow-hint", opacity: 0.85, lineWidth: 12 },
  played: { cssVar: "--arrow-played", opacity: 0.85, lineWidth: 12 },
  user: { cssVar: "--arrow-user", opacity: 0.85, lineWidth: 12 },
  wrong: { cssVar: "--blunder", opacity: 0.85, lineWidth: 12 },
  // Second engine line: thinner and fainter, like the lichess analysis board.
  engine2: { cssVar: "--arrow-hint", opacity: 0.45, lineWidth: 7 },
  threat: { cssVar: "--blunder", opacity: 0.7, lineWidth: 9 },
};

function readBrushes(el: Element): DrawBrushes {
  const css = getComputedStyle(el);
  const color = (v: string, fallback: string) => css.getPropertyValue(v).trim() || fallback;
  const brushes: Record<string, { key: string; color: string; opacity: number; lineWidth: number }> = {
    // Brushes for the player's own drawings (right mouse button; Shift/Alt pick other colours).
    green: { key: "g", color: color("--arrow-best", "green"), opacity: 0.9, lineWidth: 10 },
    red: { key: "r", color: color("--blunder", "red"), opacity: 0.9, lineWidth: 10 },
    blue: { key: "b", color: color("--arrow-hint", "blue"), opacity: 0.9, lineWidth: 10 },
    yellow: { key: "y", color: color("--arrow-user", "orange"), opacity: 0.9, lineWidth: 10 },
  };
  for (const [kind, b] of Object.entries(BRUSH_VARS)) {
    brushes[kind] = { key: kind, color: color(b.cssVar, "gray"), opacity: b.opacity, lineWidth: b.lineWidth };
  }
  return brushes as DrawBrushes;
}

function turnOf(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function inCheck(fen: string): boolean {
  try {
    return new Chess(fen).inCheck();
  } catch {
    return false;
  }
}

/** Piece letter (FEN case) on `sq`, read straight from the placement field. */
function pieceOn(fen: string, sq: string): string | null {
  const rows = fen.split(" ")[0].split("/");
  const row = rows[8 - Number(sq[1])];
  if (!row) return null;
  let file = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) file += Number(ch);
    else {
      if (FILES[file] === sq[0]) return ch;
      file++;
    }
    if (file > FILES.indexOf(sq[0])) break;
  }
  return null;
}

function destsFor(fen: string, legalTargets?: (from: string) => string[]): Dests {
  const dests: Dests = new Map();
  if (!legalTargets) return dests;
  const white = turnOf(fen) === "white";
  for (const f of FILES) {
    for (let r = 1; r <= 8; r++) {
      const sq = f + r;
      const p = pieceOn(fen, sq);
      // Only the side to move has legal moves; skipping the rest keeps this cheap.
      if (!p || (p === p.toUpperCase()) !== white) continue;
      const to = legalTargets(sq);
      if (to.length) dests.set(sq as Key, to as Key[]);
    }
  }
  return dests;
}

function badgeShape(badge: Classification | undefined, lastMove: Props["lastMove"]): DrawShape[] {
  const href = badge ? badgeFor(badge) : null;
  if (!href || !lastMove) return [];
  // Drawn in the destination square's 100×100 box, overlapping its top-right corner.
  return [
    {
      orig: lastMove.to as Key,
      customSvg: { html: `<image href="${href}" x="58" y="-14" width="56" height="56" class="badge" />`, center: "orig" },
    },
  ];
}

export function Board({ fen, flipped = false, lastMove, arrows = [], badge, onMove, legalTargets, highlight = [], annotate = false, onSwipe }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<Api | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; white: boolean } | null>(null);
  // Latest props for chessground's callbacks, which are bound once at mount.
  const props = useRef({ fen, onMove, onSwipe });
  props.current = { fen, onMove, onSwipe };
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // Puts the board back on the position the page says it shows (after a rejected
  // or replaced move, chessground would otherwise keep the piece where it was dropped).
  const resync = () => {
    const cg = cgRef.current;
    if (cg && cg.getFen() !== props.current.fen.split(" ")[0]) cg.set({ fen: props.current.fen });
  };

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const cg = Chessground(el, {
      fen,
      coordinates: true,
      ranksPosition: "left",
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: "both",
        showDests: true,
        events: {
          after: (orig, dest) => {
            const current = props.current;
            const piece = pieceOn(current.fen, orig);
            if (piece?.toLowerCase() === "p" && (dest[1] === "8" || dest[1] === "1")) {
              setPromo({ from: orig, to: dest, white: piece === "P" });
              return;
            }
            const ok = current.onMove?.(orig, dest) ?? false;
            if (!ok) resync();
            // A page may accept a move but keep showing the old position (wrong puzzle
            // answer); check again once it has re-rendered.
            else requestAnimationFrame(resync);
          },
        },
      },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: annotate, brushes: readBrushes(el), defaultSnapToValidMove: true },
    });
    cgRef.current = cg;
    return () => {
      cg.destroy();
      cgRef.current = null;
    };
  }, []);

  useEffect(() => {
    setPromo(null);
  }, [fen]);

  // Brush colours follow the board and colour theme.
  useEffect(() => {
    const update = () => {
      const cg = cgRef.current;
      const el = wrapRef.current;
      if (cg && el) cg.set({ drawable: { brushes: readBrushes(el) } });
    };
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-board"] });
    return () => obs.disconnect();
  }, []);

  const dests = destsFor(fen, onMove ? legalTargets : undefined);
  const destKey = [...dests.entries()].map(([k, v]) => k + v.join("")).join(",");
  const shapes: DrawShape[] = [
    ...arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.kind })),
    ...badgeShape(promo ? undefined : badge, lastMove),
  ];
  const shapeKey = JSON.stringify(shapes);

  useEffect(() => {
    const cg = cgRef.current;
    if (!cg) return;
    const custom = new Map<Key, string>(highlight.map((s) => [s as Key, "hl"]));
    // set() ignores an undefined lastMove, so clear it by hand (start position).
    if (!lastMove) cg.state.lastMove = undefined;
    cg.set({
      fen,
      orientation: flipped ? "black" : "white",
      turnColor: turnOf(fen),
      check: inCheck(fen),
      lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
      highlight: { custom },
      movable: { dests, color: onMove ? "both" : undefined },
      drawable: { enabled: annotate },
    });
  }, [fen, flipped, lastMove?.from, lastMove?.to, destKey, highlight.join(","), annotate, Boolean(onMove)]);

  useEffect(() => {
    cgRef.current?.setAutoShapes(shapes);
  }, [shapeKey]);

  let promoEl = null;
  if (promo) {
    const file = FILES.indexOf(promo.to[0]);
    const col = flipped ? 7 - file : file;
    // The picker grows from the promotion square towards the board centre.
    const atTop = (promo.to[1] === "8") !== flipped;
    promoEl = (
      <div
        class="promo-overlay"
        onPointerDown={(e) => {
          e.stopPropagation();
          setPromo(null);
          resync();
        }}
      >
        {PROMOTIONS.map((p, k) => (
          <button
            key={p}
            class="promo-choice"
            style={{ left: `${col * 12.5}%`, top: `${(atTop ? k : 7 - k) * 12.5}%` }}
            aria-label={`Umwandeln in ${PIECE_NAME[p]}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              const chosen = promo;
              setPromo(null);
              const ok = props.current.onMove?.(chosen.from, chosen.to, p) ?? false;
              if (!ok) resync();
              else requestAnimationFrame(resync);
            }}
          >
            <span class={`promo-piece ${promo.white ? "white" : "black"} ${PIECE_NAME[p]}`} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      class={`board cg-board-wrap${onMove ? " interactive" : ""}`}
      role="img"
      aria-label="Schachbrett"
      onTouchStart={(e) => {
        const t = e.touches[0];
        const cg = cgRef.current;
        const key = t && cg ? cg.getKeyAtDomPos([t.clientX, t.clientY]) : undefined;
        swipeStart.current = t && !(key && cg?.state.pieces.has(key)) ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const s = swipeStart.current;
        const t = e.changedTouches[0];
        swipeStart.current = null;
        if (!s || !t || !props.current.onSwipe) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) props.current.onSwipe(dx < 0 ? "left" : "right");
      }}
    >
      <div ref={wrapRef} class="cg-wrap" />
      {promoEl}
    </div>
  );
}
