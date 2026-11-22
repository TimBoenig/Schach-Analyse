// A compact skills web: the player's shape, the reference shape as a dashed
// line, and one axis lit up when its row in the table next to it is hovered.
import { t } from "../../i18n";

export interface RadarSpoke {
  key: string;
  label: string;
  /** 0..100. */
  value: number;
  /** Reference value on the same scale (dashed shape), if known. */
  reference?: number | null;
  /** Drawn pale: too little data to trust. */
  faint?: boolean;
}

const RINGS = [25, 50, 75, 100];

export function Radar({ spokes, size = 260, active, onActive }: { spokes: RadarSpoke[]; size?: number; active?: string | null; onActive?: (key: string | null) => void }) {
  const n = spokes.length;
  if (n < 3) return null;
  // Room around the web for the axis names.
  const padX = 62;
  const padY = 26;
  const w = size + padX * 2;
  const h = size + padY * 2;
  const cx = w / 2;
  const cy = h / 2;
  const r = size / 2;
  const angle = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const at = (i: number, v: number): [number, number] => [cx + Math.cos(angle(i)) * r * (v / 100), cy + Math.sin(angle(i)) * r * (v / 100)];
  const shape = (pick: (s: RadarSpoke) => number) =>
    spokes
      .map((s, i) => at(i, Math.max(4, pick(s))))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
  const hasRef = spokes.every((s) => typeof s.reference === "number");
  return (
    <svg class="radar" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("Fähigkeiten: {0}", { 0: spokes.map((s) => `${s.label} ${Math.round(s.value)}`).join(", ") })}>
      {RINGS.map((ring) => (
        <polygon key={ring} class={`radar-ring${ring === 100 ? " outer" : ""}`} points={spokes.map((_, i) => at(i, ring).map((c) => c.toFixed(1)).join(",")).join(" ")} />
      ))}
      {spokes.map((s, i) => {
        const [x, y] = at(i, 100);
        return <line key={s.key} class="radar-spoke" x1={cx} y1={cy} x2={x} y2={y} />;
      })}
      {hasRef && <polygon class="radar-ref" points={shape((s) => s.reference as number)} />}
      <polygon class="radar-shape" points={shape((s) => s.value)} />
      {spokes.map((s, i) => {
        const [x, y] = at(i, Math.max(4, s.value));
        const [lx, ly] = at(i, 100);
        const cos = Math.cos(angle(i));
        const sin = Math.sin(angle(i));
        const on = active === s.key;
        return (
          <g key={s.key} class={`radar-axis${on ? " on" : ""}${s.faint ? " faint" : ""}`} onPointerEnter={() => onActive?.(s.key)} onPointerLeave={() => onActive?.(null)}>
            <circle class="radar-dot" cx={x} cy={y} r={on ? 5 : 3.2} />
            <text class="radar-label" x={lx + cos * 10} y={ly + sin * 12} text-anchor={Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end"} dominant-baseline={Math.abs(sin) < 0.2 ? "middle" : sin > 0 ? "hanging" : "auto"}>
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
