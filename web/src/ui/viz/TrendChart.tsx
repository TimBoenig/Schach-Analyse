// A time series as a line: true to time on the x axis (a quiet month is as
// wide as a busy one), round numbers on the y axis, and a crosshair that
// tells the value under the finger. Drawn in real pixels so labels keep
// their size on every screen.
import { useState } from "preact/hooks";

import { useWidth } from "../charts";
import { nearestIndex, timeTicks, valueScale } from "./scale";
import { t } from "../../i18n";

export interface TrendPoint {
  /** Epoch seconds. */
  t: number;
  value: number;
  /** Headline of the tooltip: the day, week or month the point stands for. */
  label: string;
  /** Second tooltip line, e.g. "12 Partien". */
  detail?: string;
  /** Size of the point's sample; drawn as a quiet column behind the line. */
  weight?: number;
}

export interface TrendChartProps {
  points: TrendPoint[];
  format?: (v: number) => string;
  height?: number;
  /** Colour of line and area (a CSS colour or variable). */
  color?: string;
  /** A level to compare with, drawn as a dashed line with its name. */
  reference?: { value: number; label: string } | null;
  /** Clamp for the value axis (an accuracy stays within 0..100) and its smallest span. */
  bounds?: { lo?: number; hi?: number; minSpan?: number };
  /** Draw a dot on every point (for a handful of buckets), not only under the crosshair. */
  dots?: boolean;
  /** Name of the series for screen readers. */
  label: string;
}

const PAD = { top: 14, right: 14, bottom: 26, left: 44 };

/**
 * Where the name of the reference line goes: at its left or right end, just
 * above or below it, wherever the data line keeps the most room. Pinned to
 * the left it sat on the first points of every line that starts near the
 * reference.
 */
function placeLabel(text: string, refY: number, xs: number[], ys: number[], left: number, right: number): { x: number; y: number; anchor: "start" | "end" } {
  // 11 px text is about 6 px per character.
  const width = text.length * 6 + 6;
  const options = [
    { x: left, y: refY - 6, anchor: "start" as const, from: left, to: left + width, mid: refY - 10 },
    { x: right, y: refY - 6, anchor: "end" as const, from: right - width, to: right, mid: refY - 10 },
    { x: left, y: refY + 14, anchor: "start" as const, from: left, to: left + width, mid: refY + 10 },
    { x: right, y: refY + 14, anchor: "end" as const, from: right - width, to: right, mid: refY + 10 },
  ];
  // The line's height at a given x, read off the segment that spans it.
  const lineAt = (px: number): number => {
    if (px <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (px <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (px - xs[i - 1])) / (xs[i] - xs[i - 1] || 1);
    return ys[ys.length - 1];
  };
  const room = (o: (typeof options)[number]) => {
    let min = Infinity;
    for (let px = o.from; px <= o.to; px += 6) min = Math.min(min, Math.abs(lineAt(px) - o.mid));
    return min;
  };
  return options.reduce((best, o) => (room(o) > room(best) + 2 ? o : best));
}

export function TrendChart({ points, format = (v) => String(Math.round(v)), height = 230, color = "var(--accent)", reference, bounds, dots = false, label }: TrendChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div class="trend trend-empty" ref={ref} style={{ height: `${height}px` }}>
        <p class="muted small">{points.length ? t("Erst ein Messpunkt. Mit dem nächsten wird daraus eine Linie.") : t("Noch keine Daten für diesen Zeitraum.")}</p>
      </div>
    );
  }

  const w = Math.max(240, width);
  const innerW = w - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const values = points.map((p) => p.value);
  const scale = valueScale(reference ? [...values, reference.value] : values, 4, bounds);
  const x = (tk: number) => PAD.left + (t1 > t0 ? (tk - t0) / (t1 - t0) : 0.5) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - scale.min) / (scale.max - scale.min)) * innerH;
  const xs = points.map((p) => x(p.t));
  const ys = points.map((p) => y(p.value));
  const line = points.map((_, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${PAD.top + innerH} L${xs[0].toFixed(1)} ${PAD.top + innerH} Z`;
  const ticks = timeTicks(t0, t1, Math.max(2, Math.floor(innerW / 72)));
  const maxWeight = Math.max(0, ...points.map((p) => p.weight ?? 0));
  const barW = Math.max(3, Math.min(22, (innerW / points.length) * 0.5));
  const gradient = `trend-fill-${label.replace(/[^a-z0-9]/gi, "")}`;

  const refLabel = reference ? placeLabel(`${reference.label} ${format(reference.value)}`, y(reference.value), xs, ys, PAD.left + 6, w - PAD.right - 6) : null;

  const onMove = (e: PointerEvent) => {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    setHover(nearestIndex(xs, e.clientX - box.left));
  };
  const h = hover !== null && hover < points.length ? hover : null;
  const last = points.length - 1;
  // The tooltip stays inside the chart: it hangs left of the point near the right edge.
  const tipLeft = h !== null && xs[h] > w - 150;

  return (
    <div class="trend" ref={ref}>
      <svg width={w} height={height} role="img" aria-label={t("{label}: von {format} auf {format2}", { label, format: format(values[0]), format2: format(values[last]) })} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color={color} stop-opacity="0.26" />
            <stop offset="1" stop-color={color} stop-opacity="0" />
          </linearGradient>
        </defs>
        {scale.ticks.map((v) => (
          <g key={v}>
            <line class="trend-grid" x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} />
            <text class="trend-axis" x={PAD.left - 8} y={y(v)} text-anchor="end" dominant-baseline="middle">
              {format(v)}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text key={tick.t} class="trend-axis" x={x(tick.t)} y={height - 7} text-anchor="middle">
            {tick.label}
          </text>
        ))}
        {maxWeight > 0 &&
          points.map((p, i) =>
            p.weight ? <rect key={p.t} class={`trend-weight${h === i ? " on" : ""}`} x={xs[i] - barW / 2} width={barW} y={PAD.top + innerH - (p.weight / maxWeight) * innerH * 0.3} height={(p.weight / maxWeight) * innerH * 0.3} rx={2} /> : null,
          )}
        {reference && <line class="trend-ref" x1={PAD.left} x2={w - PAD.right} y1={y(reference.value)} y2={y(reference.value)} />}
        <path class="trend-area" d={area} fill={`url(#${gradient})`} />
        <path class="trend-line" d={line} stroke={color} />
        {dots && points.map((p, i) => <circle key={p.t} class="trend-dot" cx={xs[i]} cy={ys[i]} r={3} stroke={color} />)}
        {/* Drawn after the line, with a halo, so it stays readable where the line crosses it. */}
        {refLabel && reference && (
          <text class="trend-ref-label" x={refLabel.x} y={refLabel.y} text-anchor={refLabel.anchor}>
            {reference.label} {format(reference.value)}
          </text>
        )}
        <circle class="trend-end" cx={xs[last]} cy={ys[last]} r={4.5} fill={color} />
        {h !== null && (
          <g>
            <line class="trend-cross" x1={xs[h]} x2={xs[h]} y1={PAD.top} y2={PAD.top + innerH} />
            <circle class="trend-hover" cx={xs[h]} cy={ys[h]} r={5.5} stroke={color} />
          </g>
        )}
      </svg>
      {h !== null && (
        <div class={`trend-tip${tipLeft ? " left" : ""}`} style={{ left: `${xs[h]}px`, top: `${Math.max(4, ys[h] - 12)}px` }} role="status">
          <strong class="tnum">{format(points[h].value)}</strong>
          <span>{points[h].label}</span>
          {points[h].detail && <span class="faint">{points[h].detail}</span>}
        </div>
      )}
    </div>
  );
}
