// Static board picture for cards and lists. Many of them share one page, so a
// plain SVG (squares from the board theme's colours, the same piece set) is
// far cheaper than a full interactive board each.

const PIECES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

export interface MiniArrow {
  from: string;
  to: string;
  /** CSS colour, usually a variable. */
  color: string;
}

function squareXY(sq: string, flipped: boolean): [number, number] {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  return flipped ? [7 - file + 0.5, rank + 0.5] : [file + 0.5, 7 - rank + 0.5];
}

export function MiniBoard({
  fen,
  flipped = false,
  arrows = [],
  lastMove,
  label,
}: {
  fen: string;
  flipped?: boolean;
  arrows?: MiniArrow[];
  lastMove?: string;
  label?: string;
}) {
  const rows = fen.split(" ")[0].split("/");
  const pieces: { x: number; y: number; href: string }[] = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const name = PIECES[ch.toLowerCase()];
      if (name) {
        const color = ch === ch.toUpperCase() ? "white" : "black";
        pieces.push({ x: flipped ? 7 - f : f, y: flipped ? 7 - r : r, href: `/pieces/${color}-${name}.svg` });
      }
      f += 1;
    }
  });
  const last = lastMove && lastMove.length >= 4 ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];
  return (
    <svg class="mini-board" viewBox="0 0 8 8" role="img" aria-label={label ?? "Stellung"}>
      {Array.from({ length: 64 }, (_, i) => {
        const x = i % 8;
        const y = Math.floor(i / 8);
        return <rect key={i} x={x} y={y} width="1" height="1" style={{ fill: (x + y) % 2 ? "var(--sq-dark)" : "var(--sq-light)" }} />;
      })}
      {last.map((sq) => {
        const [cx, cy] = squareXY(sq, flipped);
        return <rect key={`l${sq}`} x={cx - 0.5} y={cy - 0.5} width="1" height="1" style={{ fill: "var(--sq-last)" }} />;
      })}
      {pieces.map((p) => (
        <image key={`${p.x}-${p.y}`} href={p.href} x={p.x} y={p.y} width="1" height="1" />
      ))}
      {arrows.map((a) => {
        const [x1, y1] = squareXY(a.from, flipped);
        const [x2, y2] = squareXY(a.to, flipped);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        // Shaft stops where the head starts; the head is a triangle at the target square's centre.
        const hx = x2 - ux * 0.42;
        const hy = y2 - uy * 0.42;
        const px = -uy * 0.24;
        const py = ux * 0.24;
        return (
          <g key={`${a.from}${a.to}`} style={{ opacity: 0.85 }}>
            <line x1={x1} y1={y1} x2={hx} y2={hy} style={{ stroke: a.color, strokeWidth: 0.18, strokeLinecap: "round" }} />
            <polygon points={`${x2},${y2} ${hx + px},${hy + py} ${hx - px},${hy - py}`} style={{ fill: a.color }} />
          </g>
        );
      })}
    </svg>
  );
}
