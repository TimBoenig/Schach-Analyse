// Building blocks every page shares since the league look became the app's
// look: a hero with one plain sentence as its headline, a track that places
// things on one line, "what if" sliders, counting numbers and result tiles.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { useWidth } from "./charts";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Mounts with everything at zero, then lets CSS move it into place once. */
export function useEntrance(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

// ---------- counting numbers ----------

const COUNT_MS = 900;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that runs to its value: from zero when it first appears, from the
 * old value when it changes (a moved slider, another period).
 */
export function CountUp({ value, format = (v) => String(Math.round(v)), class: cls }: { value: number | null; format?: (v: number) => string; class?: string }) {
  const [shown, setShown] = useState<number | null>(reducedMotion() ? value : value === null ? null : 0);
  const from = useRef(0);
  useEffect(() => {
    if (value === null || reducedMotion()) {
      setShown(value);
      from.current = value ?? 0;
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / COUNT_MS);
      const v = start + (value - start) * easeOut(t);
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span class={`tnum${cls ? ` ${cls}` : ""}`}>{shown === null ? "–" : format(shown)}</span>;
}

// ---------- hero ----------

/** The opening card of a page: a small kicker, one sentence as the headline, an optional figure on the right. */
export function Hero({
  kicker,
  title,
  sub,
  aside,
  children,
  id,
  class: cls,
}: {
  kicker: ComponentChildren;
  title: ComponentChildren;
  sub?: ComponentChildren;
  aside?: ComponentChildren;
  children?: ComponentChildren;
  id?: string;
  class?: string;
}) {
  return (
    <section class={`card lg-hero span-12${cls ? ` ${cls}` : ""}`} id={id}>
      <div class="lg-hero-head">
        <div class="lg-hero-text">
          <span class="lg-kicker">{kicker}</span>
          <h2 class="lg-hero-title">{title}</h2>
          {sub && <p class="lg-hero-sub">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The figure beside a hero headline: one big number with what it is. */
export function HeroStat({ big, label, sub, onClick, title }: { big: ComponentChildren; label: string; sub?: ComponentChildren; onClick?: () => void; title?: string }) {
  const body = (
    <>
      <span class="lg-hero-place tnum">{big}</span>
      <span class="lg-hero-me-text">
        <strong>{label}</strong>
        {sub && <span class="faint small">{sub}</span>}
      </span>
    </>
  );
  return onClick ? (
    <button class="lg-hero-me as-button" onClick={onClick} title={title}>
      {body}
    </button>
  ) : (
    <div class="lg-hero-me" title={title}>
      {body}
    </div>
  );
}

// ---------- track ----------

export interface TrackMarker {
  id: string;
  /** Name under the dot. */
  label: string;
  /** Position on the track, in the track's own unit. */
  value: number;
  /** Number beside the name; defaults to the rounded value. */
  valueText?: string;
  /** Colour class (`tone-0` … `tone-me`, or one of the page's own). */
  tone: string;
  /** What stands in the dot; defaults to the label's first letter. */
  mark?: ComponentChildren;
  /** The player's own marker: ringed and drawn on top. */
  me?: boolean;
  /** Drawn pale: the value rests on little data. */
  faint?: boolean;
  title?: string;
}

// Height of one lane: dot, label and some air, so a lower dot never covers the label above.
const LANE = 68;
// Room one dot with its label needs, in pixels.
const MARKER_ROOM = 76;

/** Markers on one line from `min` to `max`, stacked into lanes where they would overlap. */
export function ScaleTrack({
  markers,
  min = 0,
  max = 100,
  ticks = [0, 25, 50, 75, 100],
  picked,
  onPick,
  room = MARKER_ROOM,
}: {
  markers: TrackMarker[];
  min?: number;
  max?: number;
  ticks?: number[];
  picked?: string | null;
  onPick?: (id: string) => void;
  /** Width one marker with its label needs, in pixels; raise it for long labels. */
  room?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(600);
  const on = useEntrance();
  const gap = (room / Math.max(w, 1)) * 100;
  const pct = (v: number) => clamp(((v - min) / (max - min || 1)) * 100, 0, 100);
  const lanes: number[] = [];
  const placed = markers
    .map((m) => ({ m, x: pct(m.value) }))
    .sort((a, b) => a.x - b.x)
    .map((p) => {
      let lane = lanes.findIndex((last) => p.x - last >= gap);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(p.x);
      } else lanes[lane] = p.x;
      return { ...p, lane };
    });
  return (
    <div class="lg-track" ref={ref} style={{ height: `${Math.max(1, lanes.length) * LANE + 34}px` }}>
      <div class="lg-track-line" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={t} class={`lg-track-tick${i % 2 ? " minor" : ""}`} style={{ left: `${pct(t)}%` }}>
            <span class="faint">{t}</span>
          </span>
        ))}
      </div>
      {placed.map((p) => {
        const dot = (
          <>
            <span class={`pl-avatar lg ${p.m.tone}${p.m.me ? " ring" : ""}`} aria-hidden="true">
              {p.m.mark ?? (p.m.label.trim()[0] ?? "?").toUpperCase()}
            </span>
            <span class="lg-track-label">
              {p.m.label} <strong class="tnum">{p.m.valueText ?? Math.round(p.m.value)}</strong>
            </span>
          </>
        );
        return (
          // Upper lanes paint on top, so a stem from below runs behind the labels.
          <div key={p.m.id} class={`lg-track-pos${p.m.me ? " me" : ""}${p.m.faint ? " faint" : ""}${picked === p.m.id ? " picked" : ""}`} style={{ transform: `translateX(${on ? p.x : 0}%)`, zIndex: 10 - p.lane }}>
            <div class="lg-track-dot" style={{ transform: `translate(-50%, ${p.lane * LANE}px)` }}>
              {p.lane > 0 && <span class={`lg-track-stem ${p.m.tone}`} style={{ height: `${p.lane * LANE - 22}px`, top: `${22 - p.lane * LANE}px` }} />}
              {onPick ? (
                <button class="lg-track-btn" title={p.m.title} aria-pressed={picked === p.m.id} onClick={() => onPick(p.m.id)}>
                  {dot}
                </button>
              ) : (
                dot
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- what-if slider ----------

/** One value to push around: its name, the value now and how far it moved from the real one. */
export function WhatIfSlider({
  label,
  value,
  base,
  min,
  max,
  step,
  text,
  deltaText,
  good,
  onInput,
}: {
  label: string;
  value: number;
  /** The real value; the delta badge shows once the slider leaves it. */
  base: number;
  min: number;
  max: number;
  step: number;
  text: string;
  deltaText: string;
  /** Whether the move away from `base` is an improvement. */
  good: boolean;
  onInput: (v: number) => void;
}) {
  const moved = Math.abs(value - base) >= step / 2;
  return (
    <label class="lg-slider">
      <span class="lg-slider-head">
        <span>{label}</span>
        <strong class="tnum">{text}</strong>
        {moved && <span class={`lg-slider-delta ${good ? "up" : "down"}`}>{deltaText}</span>}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={`${label} ausprobieren`} onInput={(e) => onInput(Number(e.currentTarget.value))} />
    </label>
  );
}

// ---------- results ----------

export interface RibbonGame {
  id: string;
  /** 1 win, 0.5 draw, 0 loss, null unfinished. */
  score: number | null;
  title: string;
}

const RIBBON: Record<string, { cls: string; ch: string }> = { "1": { cls: "win", ch: "S" }, "0.5": { cls: "draw", ch: "R" }, "0": { cls: "loss", ch: "N" } };

/** The last results as tiles, oldest left, each one a way into its game. */
export function ResultRibbon({ games, onPick }: { games: RibbonGame[]; onPick: (id: string) => void }) {
  const count = (s: number) => games.filter((g) => g.score === s).length;
  return (
    <div class="ar-ribbon" role="group" aria-label={`${count(1)} Siege, ${count(0.5)} Remis, ${count(0)} Niederlagen`}>
      {games.map((g, i) => {
        const r = RIBBON[String(g.score)] ?? { cls: "open", ch: "·" };
        return (
          <button key={g.id} class={`ar-ribbon-tile ${r.cls}`} style={{ "--i": i }} title={g.title} onClick={() => onPick(g.id)}>
            {r.ch}
          </button>
        );
      })}
    </div>
  );
}

// ---------- meters ----------

/** A bar that grows to its value when it appears; an optional tick marks a reference. */
export function Meter({ value, max = 100, tone = "", reference }: { value: number; max?: number; tone?: string; reference?: number | null }) {
  const on = useEntrance();
  const pct = (v: number) => clamp((v / (max || 1)) * 100, 0, 100);
  return (
    <span class={`ar-meter ${tone}`} aria-hidden="true">
      <span class="ar-meter-fill" style={{ width: `${on ? pct(value) : 0}%` }} />
      {reference !== null && reference !== undefined && <span class="ar-meter-ref" style={{ left: `${pct(reference)}%` }} />}
    </span>
  );
}

/** Wins, draws and losses as one bar whose parts slide open. */
export function WdlBar({ wins, draws, losses }: { wins: number; draws: number; losses: number }) {
  const on = useEntrance();
  const total = wins + draws + losses || 1;
  const part = (n: number) => `${on ? (n / total) * 100 : 0}%`;
  return (
    <span class="ar-wdl" role="img" aria-label={`${wins} Siege, ${draws} Remis, ${losses} Niederlagen`}>
      <span class="win" style={{ width: part(wins) }} />
      <span class="draw" style={{ width: part(draws) }} />
      <span class="loss" style={{ width: part(losses) }} />
    </span>
  );
}

/** A row of choices where one (or none) is on. */
export function ChoiceChips<T extends string>({ label, options, value, onChange }: { label: string; options: { key: T; label: string }[]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <div class="ar-choice" role="group" aria-label={label}>
      <span class="ar-choice-label small faint">{label}</span>
      {options.map((o) => (
        <button key={o.key} class={`chip${value === o.key ? " on" : ""}`} aria-pressed={value === o.key} onClick={() => onChange(value === o.key ? null : o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
