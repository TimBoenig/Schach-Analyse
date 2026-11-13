// Small SVG chart kit for the dashboards. Charts draw in real pixels (measured
// with a ResizeObserver) so labels keep a readable size on phone and iPad alike,
// instead of shrinking with a scaled viewBox.
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export function useWidth<T extends HTMLElement>(fallback = 320): [preact.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Closes an open tooltip when the user taps elsewhere. */
function useDismiss(active: boolean, close: () => void, ref: preact.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [active]);
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; value?: string }[] }) {
  return (
    <div class="legend">
      {items.map((it) => (
        <span key={it.label} class="legend-item">
          <span
            class={`legend-key${it.dashed ? " dashed" : ""}`}
            style={it.dashed ? { borderColor: it.color } : { background: it.color }}
          />
          {it.label}
          {it.value !== undefined && <strong class="tnum">{it.value}</strong>}
        </span>
      ))}
    </div>
  );
}

function Tip({ x, y, children }: { x: number; y: number; children: ComponentChildren }) {
  return (
    <div class="chart-tip" style={{ left: `${x}px`, top: `${y}px` }}>
      {children}
    </div>
  );
}

// ---------- radar ----------

export interface RadarAxis {
  key: string;
  label: string;
  value: number; // 0..100
  typical?: number | null;
  faint?: boolean;
  /** ± uncertainty in points; drawn as a band around the value. */
  margin?: number | null;
  /** Value before blending with the prior, shown in the tooltip when it differs. */
  raw?: number | null;
  /** Second player's value on this axis (see `compare`). */
  compare?: number | null;
}

export function RadarChart({
  axes,
  typicalLabel,
  ownLabel = "Du",
  compare,
}: {
  axes: RadarAxis[];
  typicalLabel?: string;
  ownLabel?: string;
  /** Name of the second series drawn from `axis.compare`. */
  compare?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  useDismiss(hover !== null, () => setHover(null), ref);
  // Leave room for the longest axis label on both sides; narrower on phones.
  const labelSpace = w < 420 ? 86 : 94;
  const r = Math.max(60, Math.min(w / 2 - labelSpace, 170));
  const H = Math.round(2 * r + 64);
  const cx = w / 2;
  const cy = H / 2 + 2;
  const n = axes.length;
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i: number, v: number): [number, number] => [
    cx + Math.cos(ang(i)) * r * (v / 100),
    cy + Math.sin(ang(i)) * r * (v / 100),
  ];
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, Math.max(3, v)).join(",")).join(" ");
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const hasTypical = !compare && axes.some((a) => a.typical !== null && a.typical !== undefined);
  // With two players the band would hide the second outline.
  const hasBand = !compare && axes.some((a) => a.margin);
  const hasCompare = Boolean(compare) && axes.some((a) => a.compare !== null && a.compare !== undefined);
  // Ring between value - margin and value + margin (even-odd cuts out the inner part).
  const band = hasBand
    ? `M${poly(axes.map((a) => clamp(a.value + (a.margin ?? 0))))}Z M${poly(axes.map((a) => clamp(a.value - (a.margin ?? 0))))}Z`
    : "";
  // The axes can change under a resting mouse (filters, a finished analysis), so
  // a stale index must not be read.
  const h = hover !== null && hover < axes.length ? axes[hover] : null;
  const hp = h && hover !== null ? pt(hover, h.value) : null;

  return (
    <div ref={ref} class="chart-wrap">
      {n >= 3 && (
        <svg class="chart" width={w} height={H} role="img" aria-label="Netzdiagramm der Fähigkeiten">
          {[25, 50, 75, 100].map((ring) => (
            <polygon key={ring} class="radar-ring" points={poly(axes.map(() => ring))} />
          ))}
          {axes.map((a, i) => {
            const [x2, y2] = pt(i, 100);
            const cos = Math.cos(ang(i));
            const lx = cx + cos * (r + 12);
            const ly = cy + Math.sin(ang(i)) * (r + 12) + Math.sin(ang(i)) * 6;
            return (
              <g key={a.key}>
                <line class="grid-line" x1={cx} y1={cy} x2={x2} y2={y2} />
                <text
                  x={lx}
                  y={ly + 4}
                  text-anchor={Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end"}
                  class={`radar-label${hover === i ? " on" : ""}${w < 420 ? " sm" : ""}`}
                >
                  {a.label}
                </text>
              </g>
            );
          })}
          {hasBand && <path class="radar-band" d={band} fill-rule="evenodd" />}
          {hasTypical && (
            <polygon class="radar-typical" points={poly(axes.map((a) => a.typical ?? 0))} />
          )}
          {hasCompare && <polygon class="radar-compare" points={poly(axes.map((a) => a.compare ?? 0))} />}
          <polygon class="radar-area" points={poly(axes.map((a) => a.value))} />
          {axes.map((a, i) => {
            const [x, y] = pt(i, Math.max(3, a.value));
            return (
              <g key={a.key} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                <circle cx={x} cy={y} r={16} fill="transparent" />
                <circle
                  cx={x}
                  cy={y}
                  r={hover === i ? 6 : 4.5}
                  class="radar-dot"
                  style={{ opacity: a.faint ? 0.5 : 1 }}
                />
              </g>
            );
          })}
        </svg>
      )}
      {h && hp && (
        <Tip x={hp[0]} y={hp[1] - 12}>
          <strong>{h.label}</strong> {Math.round(h.value)}
          {h.margin ? <span> ±{h.margin}</span> : null}
          {hasCompare && h.compare !== null && h.compare !== undefined && (
            <span class="faint">
              {" "}
              · {compare} {Math.round(h.compare)}
            </span>
          )}
          {hasTypical && h.typical !== null && h.typical !== undefined && (
            <span class="faint"> · typisch {Math.round(h.typical)}</span>
          )}
          {h.raw !== null && h.raw !== undefined && Math.abs(h.raw - h.value) >= 3 && (
            <span class="faint"> · gemessen {Math.round(h.raw)}</span>
          )}
        </Tip>
      )}
      <Legend
        items={[
          { label: ownLabel, color: "var(--accent)" },
          ...(hasCompare ? [{ label: compare as string, color: "var(--great)" }] : []),
          ...(hasTypical ? [{ label: typicalLabel ?? "Typisch", color: "var(--text-3)", dashed: true }] : []),
          ...(hasBand ? [{ label: "Unsicherheit", color: "var(--accent-soft)" }] : []),
        ]}
      />
    </div>
  );
}

// ---------- donut ----------

export interface Segment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  center,
  sub,
  size = 132,
  thickness = 14,
}: {
  segments: Segment[];
  center: string;
  sub?: string;
  size?: number;
  thickness?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const shown = segments.filter((s) => s.value > 0);
  // 2px surface gap between segments (only when there is more than one).
  const gap = shown.length > 1 ? 2 : 0;
  let acc = 0;
  const h = hover !== null ? (segments[hover] ?? null) : null;
  return (
    <div class="donut" style={{ width: `${size}px`, height: `${size}px` }} onPointerLeave={() => setHover(null)}>
      <svg width={size} height={size} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={r} class="donut-track" stroke-width={thickness} />
        {total > 0 &&
          segments.map((s, i) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                stroke-width={hover === i ? thickness + 3 : thickness}
                stroke-dasharray={`${Math.max(0.01, len - gap)} ${c - Math.max(0.01, len - gap)}`}
                stroke-dashoffset={-acc}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                style={{ transition: "stroke-width .15s" }}
              />
            );
            acc += len;
            return el;
          })}
      </svg>
      <div class="donut-center">
        <div class="v tnum">{h ? h.value : center}</div>
        <div class="s">{h ? h.label : sub}</div>
      </div>
    </div>
  );
}

// ---------- ring gauge ----------

export function Gauge({
  value,
  reference,
  size = 132,
  thickness = 12,
  color = "var(--accent)",
  label,
  format = (v: number) => v.toFixed(1).replace(".", ","),
}: {
  value: number | null;
  reference?: number | null;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
  format?: (v: number) => string;
}) {
  const r = (size - thickness) / 2 - 3;
  const cx = size / 2;
  // 270° arc, open at the bottom.
  const start = 135;
  const sweep = 270;
  const arc = (from: number, to: number) => {
    const a0 = ((start + (from / 100) * sweep) * Math.PI) / 180;
    const a1 = ((start + (to / 100) * sweep) * Math.PI) / 180;
    const large = ((to - from) / 100) * sweep > 180 ? 1 : 0;
    return `M${cx + r * Math.cos(a0)},${cx + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cx + r * Math.sin(a1)}`;
  };
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const refAng = reference !== null && reference !== undefined ? ((start + (reference / 100) * sweep) * Math.PI) / 180 : null;
  return (
    <div class="donut" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size} role="img" aria-label={label}>
        <path d={arc(0, 100)} class="gauge-track" stroke-width={thickness} />
        {v > 0.5 && <path d={arc(0, v)} fill="none" stroke={color} stroke-width={thickness} stroke-linecap="round" />}
        {refAng !== null && (
          <line
            class="gauge-ref"
            x1={cx + (r - thickness / 2 - 4) * Math.cos(refAng)}
            y1={cx + (r - thickness / 2 - 4) * Math.sin(refAng)}
            x2={cx + (r + thickness / 2 + 4) * Math.cos(refAng)}
            y2={cx + (r + thickness / 2 + 4) * Math.sin(refAng)}
          />
        )}
      </svg>
      <div class="donut-center">
        <div class="v tnum">{value === null ? "–" : format(value)}</div>
        {label && <div class="s">{label}</div>}
      </div>
    </div>
  );
}

// ---------- horizontal bars with a reference marker ----------

export interface BarRow {
  label: string;
  value: number | null;
  reference?: number | null;
  valueText?: string;
  note?: string;
  color?: string;
  faint?: boolean;
}

export function BarList({
  rows,
  max = 100,
  min = 0,
  referenceLabel,
  ownLabel = "Du",
}: {
  rows: BarRow[];
  max?: number;
  min?: number;
  referenceLabel?: string;
  /** Legend name of the bars when a reference is shown (another player's page). */
  ownLabel?: string;
}) {
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100))}%`;
  const hasRef = rows.some((r) => r.reference !== null && r.reference !== undefined);
  return (
    <div class="bar-list">
      {rows.map((r) => (
        <div class="bar-row" key={r.label}>
          <div class="bar-head">
            <span class="bar-label">{r.label}</span>
            <span class="bar-value tnum">
              {r.valueText ?? (r.value !== null ? Math.round(r.value) : "–")}
            </span>
          </div>
          <div class="bar-track">
            {r.value !== null && (
              <div
                class="bar-fill"
                style={{ width: pos(Math.max(min + (max - min) * 0.015, r.value)), background: r.color ?? "var(--accent)", opacity: r.faint ? 0.45 : 1 }}
              />
            )}
            {r.reference !== null && r.reference !== undefined && <div class="bar-ref" style={{ left: pos(r.reference) }} />}
          </div>
          {r.note && <div class="bar-note">{r.note}</div>}
        </div>
      ))}
      {hasRef && referenceLabel && (
        <Legend
          items={[
            { label: ownLabel, color: rows[0]?.color ?? "var(--accent)" },
            { label: referenceLabel, color: "var(--text-3)", dashed: true },
          ]}
        />
      )}
    </div>
  );
}

// ---------- diverging change bars ----------

export interface ChangeRow {
  label: string;
  /** Change against the comparison period; null when there is nothing to compare. */
  delta: number | null;
  /** Current value, shown beside the change. */
  valueText?: string;
  faint?: boolean;
}

/**
 * Changes around a zero line, biggest gain on top: better for "what got
 * better or worse" than two bars per row that differ by a hair.
 */
export function ChangeBars({ rows, threshold = 0, unit = "" }: { rows: ChangeRow[]; threshold?: number; unit?: string }) {
  const shown = [...rows].sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  const span = Math.max(10, ...shown.map((r) => Math.abs(r.delta ?? 0)));
  return (
    <div class="change-bars">
      {shown.map((r) => {
        const d = r.delta;
        const tone = d === null ? "" : d >= threshold && d > 0 ? "up" : d <= -threshold && d < 0 ? "down" : "flat";
        const w = d === null ? 0 : (Math.abs(d) / span) * 50;
        return (
          <div class={`change-row ${tone}${r.faint ? " faint" : ""}`} key={r.label}>
            <span class="change-label">{r.label}</span>
            <span class="change-track" aria-hidden="true">
              <span class="change-zero" />
              {d !== null && d !== 0 && (
                <span class="change-fill" style={d > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
              )}
            </span>
            <span class="change-value tnum">
              {d === null ? "neu" : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(Math.round(d))}${unit}`}
              {r.valueText && <span class="faint"> · {r.valueText}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- stacked distribution bar ----------

export function StackBar({ segments, height = 14, legend = true }: { segments: Segment[]; height?: number; legend?: boolean }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <div class="stack-bar" style={{ height: `${height}px` }} onPointerLeave={() => setHover(null)}>
        {segments.map((s, i) =>
          s.value > 0 ? (
            <div
              key={s.label}
              style={{ flexGrow: s.value, background: s.color, opacity: hover === null || hover === i ? 1 : 0.4 }}
              onPointerEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      {legend && (
        <div class="stack-legend">
          {segments.map((s, i) => (
            <div key={s.label} class={`stack-legend-row${hover === i ? " on" : ""}`}>
              <span class="legend-key" style={{ background: s.color }} />
              <span class="lbl">{s.label}</span>
              <span class="tnum cnt">{s.value}</span>
              <span class="tnum faint pct">{Math.round((s.value / total) * 100)} %</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- line / area chart ----------

export interface Point {
  label: string;
  value: number;
  detail?: string;
  /** Time of the point (epoch seconds); enables the chart's own period chips. */
  t?: number;
}

const RANGES: [string, number][] = [
  ["1 M", 31],
  ["3 M", 92],
  ["6 M", 183],
  ["1 J", 366],
];

/**
 * Period chips for a time series: only spans shorter than the data are
 * offered, measured back from the newest point (not from today, so an old
 * history still shows its last months instead of an empty chart).
 */
export function rangeOptions(points: Point[]): [string, number][] {
  const ts = points.map((p) => p.t).filter((t): t is number => typeof t === "number");
  if (ts.length < 3) return [];
  const span = (Math.max(...ts) - Math.min(...ts)) / 86400;
  return RANGES.filter(([, days]) => days < span);
}

export function clipRange(points: Point[], days: number | null): Point[] {
  if (!days) return points;
  const ts = points.map((p) => p.t ?? 0);
  const end = Math.max(...ts);
  return points.filter((p) => p.t === undefined || p.t >= end - days * 86400);
}

/**
 * Horizontal position of each point, 0..1. Dated points sit at their time, so
 * a quiet month is not squeezed into one step between two busy days and the
 * date labels mean what they say; undated points are spread evenly.
 */
export function xFractions(points: Point[]): number[] {
  const n = points.length;
  const first = points[0]?.t;
  const last = points[n - 1]?.t;
  const timed = n > 1 && points.every((p) => typeof p.t === "number") && (last as number) > (first as number);
  return points.map((p, i) => (timed ? ((p.t as number) - (first as number)) / ((last as number) - (first as number)) : n > 1 ? i / (n - 1) : 0));
}

/** Points that get an axis label: at least `gap` pixels apart, the newest always. */
export function labelIndices(xs: number[], gap = 64): Set<number> {
  const out = new Set<number>(xs.length ? [xs.length - 1] : []);
  const end = xs[xs.length - 1];
  let prev = -Infinity;
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i] - prev >= gap && end - xs[i] >= gap) {
      out.add(i);
      prev = xs[i];
    }
  }
  return out;
}

export function AreaChart({
  points: allPoints,
  format,
  height = 190,
  domain,
  reference,
  color,
  label = "Du",
}: {
  points: Point[];
  format: (v: number) => string;
  height?: number;
  domain?: [number, number];
  reference?: { value: number; label: string } | null;
  /** Series colour; defaults to the accent. */
  color?: string;
  /** Legend name of the line when a reference is drawn. */
  label?: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<number | null>(null);
  const options = rangeOptions(allPoints);
  const active = options.some(([, d]) => d === range) ? range : null;
  const points = clipRange(allPoints, active);
  if (allPoints.length < 2) return <p class="muted small">Noch zu wenige Daten für einen Verlauf.</p>;
  const chips = options.length ? (
    <div class="segmented small-seg chart-range" role="group" aria-label="Zeitraum des Diagramms">
      {options.map(([l, d]) => (
        <button key={l} class={active === d ? "active" : ""} onClick={() => setRange(d)}>
          {l}
        </button>
      ))}
      <button class={active === null ? "active" : ""} onClick={() => setRange(null)}>
        Alle
      </button>
    </div>
  ) : null;
  if (points.length < 2)
    return (
      <div ref={ref} class="chart-wrap">
        {chips}
        <p class="muted small">In diesem Zeitraum zu wenige Daten für einen Verlauf.</p>
      </div>
    );
  const H = height;
  const padL = 38;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const vals = points.map((p) => p.value).concat(reference ? [reference.value] : []);
  let [lo, hi] = domain ?? [Math.min(...vals), Math.max(...vals)];
  if (!domain) {
    const pad = Math.max(5, (hi - lo) * 0.15);
    lo = Math.floor((lo - pad) / 10) * 10;
    hi = Math.ceil((hi + pad) / 10) * 10;
  }
  const fracs = xFractions(points);
  const x = (i: number) => padL + fracs[i] * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelled = labelIndices(points.map((_, i) => x(i)));
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const h = hover !== null ? (points[hover] ?? null) : null;
  const gid = `g${Math.round(height)}${points.length}${(color ?? "").replace(/[^a-z]/gi, "")}`;

  const pick = (e: PointerEvent) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (!Number.isFinite(px)) return setHover(null);
    // Nearest point by position (points are spaced by time, not evenly).
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };

  return (
    <div ref={ref} class="chart-wrap" style={color ? ({ "--series": color } as preact.JSX.CSSProperties) : undefined}>
      <svg
        class="chart"
        width={W}
        height={H}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        role="img"
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--series, var(--accent))" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--series, var(--accent))" stop-opacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line class="grid-line" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text x={padL - 6} y={y(t) + 4} text-anchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          labelled.has(i) ? (
            <text key={i} x={x(i)} y={H - 6} text-anchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {p.label}
            </text>
          ) : null,
        )}
        <path class="area-fill" d={area} fill={`url(#${gid})`} />
        {reference && <line class="ref-line" x1={padL} x2={W - padR} y1={y(reference.value)} y2={y(reference.value)} />}
        <path class="line" d={line} pathLength={1} />
        {points.length <= 24 &&
          points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3" class="line-dot" />)}
        {h && hover !== null && (
          <>
            <line class="grid-line" x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} />
            <circle cx={x(hover)} cy={y(h.value)} r="5.5" class="line-dot on" />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <Tip x={Math.max(70, Math.min(W - 70, x(hover)))} y={Math.max(18, y(h.value) - 14)}>
          <strong>{format(h.value)}</strong> <span class="faint">{h.detail ?? h.label}</span>
        </Tip>
      )}
      {chips}
      {reference && (
        <Legend
          items={[
            { label, color: color ?? "var(--accent)" },
            { label: reference.label, color: "var(--text-3)", dashed: true },
          ]}
        />
      )}
    </div>
  );
}

// ---------- vertical columns ----------

export interface Column {
  label: string;
  value: number | null;
  valueText?: string;
  sub?: string;
  /** Thin evidence: drawn faint and marked in the tooltip. */
  faint?: boolean;
}

// Width one column needs so its number does not touch its neighbours'.
const COLUMN_LABEL_ROOM = 34;

export function ColumnChart({
  columns,
  max,
  height = 170,
  reference,
  format = (v: number) => String(Math.round(v)),
}: {
  columns: Column[];
  max?: number;
  height?: number;
  reference?: { value: number; label: string } | null;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const vals = columns.map((c) => c.value ?? 0).concat(reference ? [reference.value] : []);
  const top = max ?? Math.max(1, ...vals) * 1.15;
  const h = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  // Many columns on a phone: the numbers above them would run into each
  // other, so only the touched column (or the last one) carries its number.
  const dense = width / Math.max(1, columns.length) < COLUMN_LABEL_ROOM;
  const lastFilled = columns.reduce((last, c, i) => (c.value !== null ? i : last), -1);
  const labelled = hover ?? lastFilled;
  return (
    <div class={`columns-wrap${dense ? " dense" : ""}`} ref={ref}>
      <div class="columns" style={{ height: `${height}px` }} onPointerLeave={() => setHover(null)}>
        {reference && <div class="columns-ref" style={{ bottom: h(reference.value) }} />}
        {columns.map((c, i) => (
          <div
            key={c.label}
            class={`column${hover === i ? " on" : ""}${dense && labelled === i ? " labelled" : ""}`}
            onPointerEnter={() => setHover(i)}
            onPointerDown={() => setHover(i)}
          >
            <span class="column-value tnum">{c.value === null ? "–" : (c.valueText ?? format(c.value))}</span>
            <div class="column-bar" style={{ height: c.value === null ? "0" : h(c.value), opacity: c.faint ? 0.4 : 1 }} />
          </div>
        ))}
      </div>
      <div class="column-labels">
        {columns.map((c, i) => (
          <div key={c.label} class={hover === i ? "on" : ""}>
            <span>{c.label}</span>
            {c.sub && <span class="faint">{c.sub}</span>}
          </div>
        ))}
      </div>
      {reference && (
        <Legend
          items={[
            { label: "Du", color: "var(--accent)" },
            { label: reference.label, color: "var(--text-3)", dashed: true },
          ]}
        />
      )}
    </div>
  );
}

// ---------- board heatmap ----------

const FILES = "abcdefgh";

/** 8×8 heatmap, one hue light → dark; `values[0]` is a1, `values[63]` h8. */
export function SquareHeatmap({ values, flipped = false, unit = "Fehler" }: { values: number[]; flipped?: boolean; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row : 7 - row;
      const file = flipped ? 7 - col : col;
      const i = rank * 8 + file;
      const v = values[i] ?? 0;
      const dark = (rank + file) % 2 === 0;
      cells.push(
        <div
          key={i}
          class={`heat-cell${dark ? " dark" : ""}${hover === i ? " on" : ""}`}
          onPointerEnter={() => setHover(i)}
          onPointerDown={() => setHover(i)}
        >
          {v > 0 && <div class="heat" style={{ opacity: 0.18 + 0.82 * (v / max) }} />}
          {v > 0 && v / max >= 0.5 && <span class="heat-n tnum">{v}</span>}
          {col === 0 && <span class="heat-rank">{rank + 1}</span>}
          {row === 7 && <span class="heat-file">{FILES[file]}</span>}
        </div>,
      );
    }
  }
  const h = hover !== null ? hover : null;
  return (
    <div class="heatmap-wrap" onPointerLeave={() => setHover(null)}>
      <div class="heatmap" role="img" aria-label="Felder, auf denen deine Fehler landen">
        {cells}
      </div>
      <div class="heat-scale">
        <span>{h !== null ? `${FILES[h % 8]}${Math.floor(h / 8) + 1}: ${values[h] ?? 0} ${unit}` : "Wenige"}</span>
        <div class="heat-ramp" aria-hidden="true" />
        <span>{h !== null ? "" : `Viele (${max})`}</span>
      </div>
    </div>
  );
}

// ---------- sparkline ----------

/** Tiny trend line without axes or hover (start page cards). */
export function Sparkline({ values, width = 120, height = 34, color = "var(--accent)" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg class="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`${d} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="3" fill={color} />
    </svg>
  );
}

/** Progress ring (done of total), e.g. today's exercises. */
export function Ring({ value, total, size = 64, thickness = 7, children }: { value: number; total: number; size?: number; thickness?: number; children?: ComponentChildren }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const f = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <div class="ring" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} class="donut-track" stroke-width={thickness} />
        {f > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            stroke-width={thickness}
            stroke-linecap="round"
            stroke-dasharray={`${c * f} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div class="ring-center">{children}</div>
    </div>
  );
}

/** Local start of a "YYYY-MM" or "YYYY-MM-DD" key in epoch seconds (series `t`). */
export function monthStart(key: string): number | undefined {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1)).getTime() / 1000 : undefined;
}

/**
 * Rating history [epoch, rating] as chart points. Axis labels carry the year
 * once the history spans more than one, otherwise "03.04." from two years
 * looked like the same day.
 */
const p2 = (n: number) => String(n).padStart(2, "0");

export function ratingSeriesPoints(series: [number, number][]): Point[] {
  const multiYear = series.length > 1 && new Date(series[0][0] * 1000).getFullYear() !== new Date(series[series.length - 1][0] * 1000).getFullYear();
  return series.map(([ts, r]) => {
    const d = new Date(ts * 1000);
    return {
      label: multiYear ? `${p2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}` : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`,
      value: r,
      detail: d.toLocaleDateString("de-DE"),
      t: ts,
    };
  });
}
