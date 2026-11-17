// The player's winning chance through one game: above the middle line the
// game leans their way, below it the opponent's. Key moments sit on the line
// as dots in their move colour; the turning point gets a ring and a label.
import type { KeyMoment, WinPoint } from "../../domain/profile";
import { useWidth } from "../charts";
import { CLASS_COLOR } from "../labels";

const PAD = { top: 12, right: 10, bottom: 22, left: 34 };

export function WinChart({
  points,
  plies,
  moments = [],
  turning = null,
  cursor,
  onPick,
  height = 170,
}: {
  points: WinPoint[];
  /** Half moves of the whole game, so the x axis is the same as the move list. */
  plies: number;
  moments?: KeyMoment[];
  turning?: KeyMoment | null;
  /** The half move shown on the board, drawn as a thin line. */
  cursor?: number;
  onPick?: (ply: number) => void;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(400);
  if (points.length < 2 || plies < 1) return <div class="wc wc-empty" ref={ref} />;
  const w = Math.max(240, width);
  const innerW = w - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (ply: number) => PAD.left + (ply / plies) * innerW;
  const y = (wp: number) => PAD.top + (1 - wp) * innerH;
  const mid = y(0.5);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.ply).toFixed(1)} ${y(p.wp).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const area = `${line} L${x(last.ply).toFixed(1)} ${mid} L${x(points[0].ply).toFixed(1)} ${mid} Z`;
  const id = `wc-${Math.round(width)}-${points.length}`;
  // Move numbers on the axis: a tick every 10 moves (20 half moves), fewer on long games.
  const every = plies > 160 ? 40 : 20;
  const ticks = Array.from({ length: Math.floor(plies / every) }, (_, i) => (i + 1) * every);
  const pick = (e: PointerEvent) => {
    if (!onPick) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const ply = Math.round(((e.clientX - box.left - PAD.left) / innerW) * plies);
    onPick(Math.max(0, Math.min(plies, ply)));
  };
  return (
    <div class="wc" ref={ref}>
      <svg width={w} height={height} role="img" aria-label="Deine Gewinnchance im Verlauf der Partie" onPointerDown={pick} class={onPick ? "wc-pick" : ""}>
        <defs>
          <clipPath id={`${id}-up`}>
            <rect x={0} y={0} width={w} height={mid} />
          </clipPath>
          <clipPath id={`${id}-down`}>
            <rect x={0} y={mid} width={w} height={height - mid} />
          </clipPath>
        </defs>
        {[0, 0.25, 0.75, 1].map((v) => (
          <line key={v} class="wc-grid" x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} />
        ))}
        {[1, 0.5, 0].map((v) => (
          <text key={v} class="wc-axis" x={PAD.left - 6} y={y(v)} text-anchor="end" dominant-baseline="middle">
            {Math.round(v * 100)}
          </text>
        ))}
        {ticks.map((t) => (
          <text key={t} class="wc-axis" x={x(t)} y={height - 6} text-anchor="middle">
            {t / 2}
          </text>
        ))}
        <path class="wc-area up" d={area} clip-path={`url(#${id}-up)`} />
        <path class="wc-area down" d={area} clip-path={`url(#${id}-down)`} />
        <line class="wc-mid" x1={PAD.left} x2={w - PAD.right} y1={mid} y2={mid} />
        <path class="wc-line" d={line} />
        {cursor !== undefined && cursor > 0 && <line class="wc-cursor" x1={x(cursor)} x2={x(cursor)} y1={PAD.top} y2={PAD.top + innerH} />}
        {moments.map((k) => {
          const cx = x(k.ply_index + 1);
          const cy = y(k.wp_after);
          const isTurn = turning?.ply_index === k.ply_index;
          return (
            <g
              key={k.ply_index}
              class={`wc-moment${k.by_user ? " own" : ""}${onPick ? " pick" : ""}`}
              onPointerDown={
                onPick
                  ? (e) => {
                      e.stopPropagation();
                      onPick(k.ply_index + 1);
                    }
                  : undefined
              }
            >
              <title>{`${k.move_label}: ${Math.round(k.wp_before * 100)} → ${Math.round(k.wp_after * 100)} %`}</title>
              {isTurn && <circle class="wc-turn" cx={cx} cy={cy} r={9} />}
              <circle cx={cx} cy={cy} r={k.by_user ? 5 : 4} fill={k.by_user ? (CLASS_COLOR[k.classification] ?? "var(--text-2)") : "var(--surface)"} stroke={CLASS_COLOR[k.classification] ?? "var(--text-3)"} />
            </g>
          );
        })}
        {turning && (
          <text class="wc-turn-label" x={Math.min(w - PAD.right - 4, Math.max(PAD.left + 4, x(turning.ply_index + 1)))} y={turning.wp_after > 0.5 ? y(turning.wp_after) + 22 : y(turning.wp_after) - 14} text-anchor={x(turning.ply_index + 1) > w * 0.7 ? "end" : x(turning.ply_index + 1) < w * 0.3 ? "start" : "middle"}>
            Wendepunkt
          </text>
        )}
      </svg>
    </div>
  );
}
