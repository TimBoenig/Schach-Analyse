// Visual blocks of the openings page: repertoire cards with the opening's
// typical position, the repertoire map (how often vs. how well) and the
// theory timeline (where theory ends and where the first serious error comes).
import { useState } from "preact/hooks";

import { movesText, type OpeningStat, openingLabel } from "../../domain/profile";
import { MIN_LINE_GAMES } from "../../domain/profile/evidence";
import { StackBar, useWidth } from "../charts";
import { MiniBoard } from "./MiniBoard";

const pctText = (v: number | null) => (v === null ? "–" : `${Math.round(v)} %`);

export function scoreTone(v: number | null, games: number): "good" | "bad" | "mid" | "thin" {
  if (v === null || games < MIN_LINE_GAMES) return "thin";
  return v >= 55 ? "good" : v < 45 ? "bad" : "mid";
}

const TONE_COLOR = { good: "var(--win)", bad: "var(--loss)", mid: "var(--draw)", thin: "var(--text-3)" } as const;

/** Score as a ring: the share of points the player took in this opening. */
function ScoreRing({ value, tone }: { value: number | null; tone: keyof typeof TONE_COLOR }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <svg class="score-ring" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} style={{ fill: "none", stroke: "var(--surface-3)", strokeWidth: 6 }} />
      <circle
        cx="28"
        cy="28"
        r={r}
        transform="rotate(-90 28 28)"
        style={{ fill: "none", stroke: TONE_COLOR[tone], strokeWidth: 6, strokeLinecap: "round", strokeDasharray: `${(c * v) / 100} ${c}` }}
      />
      <text x="28" y="32.5" text-anchor="middle" class="score-ring-text">
        {value === null ? "–" : Math.round(value)}
      </text>
    </svg>
  );
}

export function OpeningCard({ o, selected, onSelect }: { o: OpeningStat; selected: boolean; onSelect: () => void }) {
  const tone = scoreTone(o.score_pct, o.games);
  return (
    <button class={`rep-card tone-${tone}${selected ? " selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <div class="rep-card-board">
        <MiniBoard fen={o.fen} flipped={o.color === "black"} label={`Typische Stellung: ${openingLabel(o.name)}`} />
      </div>
      <div class="rep-card-body">
        <div class="rep-card-top">
          <div class="rep-card-title">
            <strong>{openingLabel(o.name)}</strong>
            <span class="small faint">
              {o.eco && <span class="op-eco">{o.eco}</span>} {o.games === 1 ? "1 Partie" : `${o.games} Partien`}
            </span>
          </div>
          <ScoreRing value={o.score_pct} tone={tone} />
        </div>
        <div class="rep-card-line small muted">{movesText(o.line.slice(0, 8)) || "–"}</div>
        <StackBar
          height={6}
          legend={false}
          segments={[
            { label: "Siege", value: o.wins, color: "var(--win)" },
            { label: "Remis", value: o.draws, color: "var(--draw)" },
            { label: "Niederlagen", value: o.losses, color: "var(--loss)" },
          ]}
        />
        <div class="rep-card-foot small faint">
          <span>
            {o.wins} S · {o.draws} R · {o.losses} N
          </span>
          {o.book_exit_move !== null && <span>Theorie bis Zug {Math.round(o.book_exit_move)}</span>}
        </div>
      </div>
    </button>
  );
}

// ---------- repertoire map ----------

const QUADRANTS = [
  { x: "right", y: "top", label: "Stützen", hint: "oft gespielt, läuft gut" },
  { x: "right", y: "bottom", label: "Baustellen", hint: "oft gespielt, läuft schlecht" },
  { x: "left", y: "top", label: "Geheimtipps", hint: "selten, läuft gut" },
  { x: "left", y: "bottom", label: "Nebenschauplätze", hint: "selten, läuft schlecht" },
] as const;

/**
 * Scatter of the repertoire: frequency (log scale) against score. Openings
 * with few games are drawn hollow, since their score is still mostly chance.
 */
export function RepertoireMap({
  lines,
  average,
  selected,
  onSelect,
}: {
  lines: OpeningStat[];
  average: number | null;
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<string | null>(null);
  const h = w < 480 ? 260 : 360;
  const pad = { l: 38, r: 16, t: 14, b: 30 };
  const shown = lines.filter((l) => l.score_pct !== null);
  const maxGames = Math.max(2, ...shown.map((l) => l.games));
  // Splits frequent from rare at the median game count (at least the evidence bar).
  const split = Math.max(MIN_LINE_GAMES, [...shown].sort((a, b) => a.games - b.games)[Math.floor(shown.length / 2)]?.games ?? 1);
  const x = (g: number) => pad.l + (Math.log(g) / Math.log(maxGames * 1.25)) * (w - pad.l - pad.r);
  const y = (s: number) => pad.t + (1 - s / 100) * (h - pad.t - pad.b);
  const rad = (g: number) => Math.min(22, 5 + Math.sqrt(g) * 2.4);
  const xs = Math.min(x(split), w - pad.r - 40);
  // Labels for the most played openings, skipping any that would overlap one already placed.
  type Spot = { x: number; y: number; anchor: "start" | "end" | "middle" };
  const labelled = new Map<string, Spot>();
  // Bubbles and the quadrant captions count as taken space too.
  const boxes: [number, number, number, number][] = shown.map((l) => {
    const r = rad(l.games);
    const cx = x(l.games);
    const cy = y(l.score_pct as number);
    return [cx - r, cy - r, cx + r, cy + r];
  });
  boxes.push([w - pad.r - 90, pad.t, w - pad.r, pad.t + 22], [pad.l, pad.t, pad.l + 100, pad.t + 22]);
  for (const l of [...shown].sort((a, b) => b.games - a.games).slice(0, w < 480 ? 4 : 7)) {
    const cx = x(l.games);
    const cy = y(l.score_pct as number);
    const r = rad(l.games);
    const tw = openingLabel(l.name).length * 6.6;
    const spots: Spot[] = [
      { x: cx + r + 6, y: cy + 4, anchor: "start" },
      { x: cx - r - 6, y: cy + 4, anchor: "end" },
      { x: cx, y: cy + r + 14, anchor: "middle" },
      { x: cx, y: cy - r - 6, anchor: "middle" },
    ];
    for (const spot of spots) {
      const left = spot.anchor === "start" ? spot.x : spot.anchor === "end" ? spot.x - tw : spot.x - tw / 2;
      const box: [number, number, number, number] = [left, spot.y - 12, left + tw, spot.y + 4];
      if (box[0] < pad.l || box[2] > w - pad.r) continue;
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      labelled.set(l.name, spot);
      break;
    }
  }
  const ticks = [1, 2, 5, 10, 20, 50, 100, 200, 500].filter((t) => t <= maxGames * 1.25);
  const active = hover ?? selected;

  return (
    <div class="rep-map" ref={ref}>
      <svg width={w} height={h} role="img" aria-label="Repertoire-Landkarte: Häufigkeit gegen Punkte-Quote">
        <rect x={xs} y={pad.t} width={w - pad.r - xs} height={y(50) - pad.t} class="rep-map-q good" />
        <rect x={xs} y={y(50)} width={w - pad.r - xs} height={h - pad.b - y(50)} class="rep-map-q bad" />
        {[0, 25, 50, 75, 100].map((s) => (
          <g key={s}>
            <line x1={pad.l} x2={w - pad.r} y1={y(s)} y2={y(s)} class={s === 50 ? "rep-map-mid" : "rep-map-grid"} />
            <text x={pad.l - 8} y={y(s) + 4} text-anchor="end" class="chart-axis">
              {s}
            </text>
          </g>
        ))}
        {average !== null && (
          <line x1={pad.l} x2={w - pad.r} y1={y(average)} y2={y(average)} class="rep-map-avg">
            <title>Dein Schnitt {Math.round(average)} %</title>
          </line>
        )}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={h - 10} text-anchor="middle" class="chart-axis">
            {t}
          </text>
        ))}
        {QUADRANTS.map((q) => (
          <text
            key={q.label}
            x={q.x === "right" ? w - pad.r - 8 : pad.l + 8}
            y={q.y === "top" ? pad.t + 16 : h - pad.b - 8}
            text-anchor={q.x === "right" ? "end" : "start"}
            class="rep-map-qlabel"
          >
            {q.label}
          </text>
        ))}
        {[...shown]
          .sort((a, b) => b.games - a.games)
          .map((l) => {
            const tone = scoreTone(l.score_pct, l.games);
            const cx = x(l.games);
            const cy = y(l.score_pct as number);
            const r = rad(l.games);
            const isActive = active === l.name;
            return (
              <g
                key={l.name}
                class={`rep-dot${isActive ? " on" : ""}`}
                onClick={() => onSelect(l.name)}
                onPointerEnter={() => setHover(l.name)}
                onPointerLeave={() => setHover(null)}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  style={{
                    fill: tone === "thin" ? "transparent" : TONE_COLOR[tone],
                    fillOpacity: 0.55,
                    stroke: tone === "thin" ? "var(--text-3)" : TONE_COLOR[tone],
                    strokeWidth: isActive ? 3 : 1.5,
                    strokeDasharray: tone === "thin" ? "3 3" : undefined,
                  }}
                />
                {(labelled.has(l.name) || isActive) && (
                  <text
                    x={labelled.get(l.name)?.x ?? (cx > w * 0.7 ? cx - r - 6 : cx + r + 6)}
                    y={labelled.get(l.name)?.y ?? cy + 4}
                    text-anchor={labelled.get(l.name)?.anchor ?? (cx > w * 0.7 ? "end" : "start")}
                    class="rep-dot-label"
                  >
                    {openingLabel(l.name)}
                  </text>
                )}
                <title>
                  {openingLabel(l.name)}: {pctText(l.score_pct)} aus {l.games} {l.games === 1 ? "Partie" : "Partien"}
                </title>
              </g>
            );
          })}
      </svg>
      <div class="rep-map-axes small faint">
        <span>↑ Punkte-Quote in %</span>
        <span>Partien (log.) →</span>
      </div>
      <div class="legend">
        <span class="legend-item">
          <span class="legend-key" style={{ background: "var(--win)", borderRadius: "50%" }} />
          ab {MIN_LINE_GAMES} Partien
        </span>
        <span class="legend-item">
          <span class="legend-key dashed" style={{ borderColor: "var(--text-3)", borderRadius: "50%" }} />
          noch zu wenige Partien
        </span>
        {average !== null && (
          <span class="legend-item">
            <span class="legend-key dashed" style={{ borderColor: "var(--text-3)" }} />
            dein Schnitt {Math.round(average)} %
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- theory timeline ----------

/** Where theory ends and the first serious error comes, per opening (analyzed games). */
export function TheoryTimeline({ lines, onSelect }: { lines: OpeningStat[]; onSelect: (name: string) => void }) {
  const rows = lines.filter((l) => l.book_exit_move !== null || l.first_error_move !== null).slice(0, 8);
  if (!rows.length) {
    return <p class="muted small">Analysiere ein paar Partien, dann zeige ich dir, wann du die Theorie verlässt und wann der erste Fehler kommt.</p>;
  }
  const maxMove = Math.max(20, ...rows.map((r) => Math.max(r.book_exit_move ?? 0, r.first_error_move ?? 0) + 2));
  const pos = (m: number) => `${Math.min(100, (m / maxMove) * 100)}%`;
  return (
    <div class="theory">
      {rows.map((l) => {
        const book = l.book_exit_move;
        const err = l.first_error_move;
        const early = book !== null && err !== null && err <= book + 2;
        return (
          <button key={l.name} class={`theory-row${l.games < MIN_LINE_GAMES ? " thin" : ""}`} onClick={() => onSelect(l.name)}>
            <span class="theory-name">{openingLabel(l.name)}</span>
            <span class="theory-track">
              {book !== null && <span class="theory-book" style={{ width: pos(book) }} />}
              {book !== null && err !== null && (
                <span
                  class={`theory-gap${early ? " early" : ""}`}
                  style={{ left: pos(Math.min(book, err)), width: `calc(${pos(Math.abs(err - book))})` }}
                />
              )}
              {err !== null && <span class={`theory-err${early ? " early" : ""}`} style={{ left: pos(err) }} title={`Erster schwerer Fehler: Zug ${Math.round(err)}`} />}
            </span>
            <span class="theory-val small tnum">
              {book !== null ? Math.round(book) : "–"} / <span class={early ? "bad" : ""}>{err !== null ? Math.round(err) : "–"}</span>
            </span>
          </button>
        );
      })}
      <div class="theory-scale small faint">
        <span>Zug 1</span>
        <span>Zug {Math.round(maxMove / 2)}</span>
        <span>Zug {maxMove}</span>
      </div>
      <div class="legend">
        <span class="legend-item">
          <span class="legend-key" style={{ background: "var(--book)" }} />
          Theorie
        </span>
        <span class="legend-item">
          <span class="legend-key" style={{ background: "var(--blunder)", borderRadius: "50%" }} />
          erster schwerer Fehler (Ø)
        </span>
      </div>
    </div>
  );
}
