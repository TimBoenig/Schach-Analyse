import { useState } from "preact/hooks";

export interface Point {
  label: string;
  value: number;
}

interface Props {
  points: Point[];
  format: (v: number) => string;
  height?: number;
  /** Fixed y-domain (e.g. 0..100 for accuracy); otherwise padded data range. */
  domain?: [number, number];
}

/** Single-series line chart with recessive grid and a tap/hover readout. */
export function LineChart({ points, format, height = 180, domain }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p class="muted small">Noch zu wenige Daten für einen Verlauf.</p>;
  const W = 600;
  const H = height;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const vals = points.map((p) => p.value);
  let [lo, hi] = domain ?? [Math.min(...vals), Math.max(...vals)];
  if (!domain) {
    const pad = Math.max(1, (hi - lo) * 0.1);
    lo -= pad;
    hi += pad;
  }
  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const h = hover !== null ? points[hover] : null;

  const pick = (e: PointerEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div style={{ position: "relative" }}>
      <svg
        class="chart"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        role="img"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line class="grid-line" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text x={padL - 6} y={y(t) + 4} text-anchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} x={x(i)} y={H - 6} text-anchor="middle">
              {p.label}
            </text>
          ) : null,
        )}
        <path class="line" d={path} />
        {h && hover !== null && (
          <>
            <line class="grid-line" x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} />
            <circle cx={x(hover)} cy={y(h.value)} r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <div
          class="pill"
          style={{
            position: "absolute",
            top: "0",
            left: `${(x(hover) / W) * 100}%`,
            transform: "translateX(-50%)",
            background: "var(--surface-2)",
            color: "var(--text)",
            pointerEvents: "none",
          }}
        >
          {h.label}: {format(h.value)}
        </div>
      )}
    </div>
  );
}
