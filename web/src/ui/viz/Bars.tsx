// Small measuring pieces shared by the rebuilt pages: a slim meter with a
// reference tick, and a bar split into parts.
import type { ComponentChildren } from "preact";
import { locale, dec } from "../../i18n";

/** 0..max as a slim bar; `reference` is a tick on the same scale (what would be usual). */
export function Level({ value, max = 100, tone = "accent", reference, faint, band }: { value: number | null; max?: number; tone?: "accent" | "good" | "bad" | "quiet"; reference?: number | null; faint?: boolean; band?: number | null }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <span class={`level tone-${tone}${faint ? " faint" : ""}`} aria-hidden="true">
      {value !== null && <span class="level-fill" style={{ width: pct(value) }} />}
      {value !== null && band ? <span class="level-band" style={{ left: pct(value - band), width: pct(2 * band) }} /> : null}
      {typeof reference === "number" && <span class="level-ref" style={{ left: pct(reference) }} />}
    </span>
  );
}

export interface Part {
  key: string;
  label: string;
  value: number;
  /** CSS colour. */
  color: string;
}

/** One bar cut into parts by share; parts of zero take no room. */
export function SplitBar({ parts, height = 10, onPick, picked }: { parts: Part[]; height?: number; onPick?: (key: string) => void; picked?: string | null }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <span class="split split-empty" style={{ height: `${height}px` }} />;
  return (
    <span class="split" style={{ height: `${height}px` }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span
            key={p.key}
            class={`split-part${picked && picked !== p.key ? " dim" : ""}`}
            style={{ flexGrow: p.value, background: p.color }}
            title={`${p.label}: ${p.value.toLocaleString(locale())} (${((p.value / total) * 100).toFixed(1).replace(".", dec())} %)`}
            onClick={onPick ? () => onPick(p.key) : undefined}
          />
        ))}
    </span>
  );
}

/** A figure with its name above and a line of context below: the cell of every summary row. */
export function Stat({ label, value, sub, tone, children, title }: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: "good" | "bad"; children?: ComponentChildren; title?: string }) {
  return (
    <div class="stat" title={title}>
      <span class="stat-label">{label}</span>
      <span class={`stat-value tnum${tone ? ` ${tone}` : ""}`}>{value}</span>
      {children}
      {sub && <span class="stat-sub">{sub}</span>}
    </div>
  );
}
