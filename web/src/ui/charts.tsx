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
}

export function RadarChart({ axes, typicalLabel }: { axes: RadarAxis[]; typicalLabel?: string }) {
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
  const hasTypical = axes.some((a) => a.typical !== null && a.typical !== undefined);
  const h = hover !== null ? axes[hover] : null;
  const hp = hover !== null ? pt(hover, axes[hover].value) : null;

  return (
    <div ref={ref} class="chart-wrap">
      {n >= 3 && (
        <svg class="chart" width={w} height={H} role="img" aria-label="Netzdiagramm deiner Fähigkeiten">
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
          {hasTypical && (
            <polygon class="radar-typical" points={poly(axes.map((a) => a.typical ?? 0))} />
          )}
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
          {h.typical !== null && h.typical !== undefined && (
            <span class="faint"> · typisch {Math.round(h.typical)}</span>
          )}
        </Tip>
      )}
      <Legend
        items={[
          { label: "Du", color: "var(--accent)" },
          ...(hasTypical ? [{ label: typicalLabel ?? "Typisch", color: "var(--text-3)", dashed: true }] : []),
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
  const h = hover !== null ? segments[hover] : null;
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
  format = (v: number) => v.toFixed(1),
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
}: {
  rows: BarRow[];
  max?: number;
  min?: number;
  referenceLabel?: string;
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
            { label: "Du", color: rows[0]?.color ?? "var(--accent)" },
            { label: referenceLabel, color: "var(--text-3)", dashed: true },
          ]}
        />
      )}
    </div>
  );
}

// ---------- stacked distribution bar ----------

export function StackBar({ segments, height = 14 }: { segments: Segment[]; height?: number }) {
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
    </div>
  );
}

// ---------- line / area chart ----------

export interface Point {
  label: string;
  value: number;
  detail?: string;
}

export function AreaChart({
  points,
  format,
  height = 190,
  domain,
  reference,
}: {
  points: Point[];
  format: (v: number) => string;
  height?: number;
  domain?: [number, number];
  reference?: { value: number; label: string } | null;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p class="muted small">Noch zu wenige Daten für einen Verlauf.</p>;
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
  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const ticks = [lo, (lo + hi) / 2, hi];
  const maxLabels = Math.max(2, Math.floor((W - padL) / 64));
  const labelEvery = Math.max(1, Math.ceil(points.length / maxLabels));
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const h = hover !== null ? points[hover] : null;
  const gid = `g${Math.round(height)}${points.length}`;

  const pick = (e: PointerEvent) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - padL) / (W - padL - padR)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div ref={ref} class="chart-wrap">
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
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
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
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} x={x(i)} y={H - 6} text-anchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
              {p.label}
            </text>
          ) : null,
        )}
        <path d={area} fill={`url(#${gid})`} />
        {reference && <line class="ref-line" x1={padL} x2={W - padR} y1={y(reference.value)} y2={y(reference.value)} />}
        <path class="line" d={line} />
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
