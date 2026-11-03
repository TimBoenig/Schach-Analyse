// Building blocks for the move tally ("Zugbilanz"): one tile per kind of move,
// a side-by-side comparison per 100 moves and monthly 100 % columns. Used on
// the Zugbilanz page, in the profile and on a friend's page.

import { useState } from "preact/hooks";

import { type MoveTally, TALLY_CLASSES, type TallyBlock, type TallyClass } from "../domain/profile";
import { MIN_BUCKET_MOVES } from "../domain/profile/evidence";
import { Legend, type Segment } from "./charts";
import { badgeFor, CLASS_COLOR, classLabel, detailSegments } from "./labels";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

/** "0,4" per game, but "1 von 9 Partien" when the kind is rare. */
function perGameText(count: number, games: number, gamesWith: number): string {
  if (!count) return "noch keiner";
  const pg = count / games;
  return pg >= 0.95 ? `Ø ${de(pg)} pro Partie` : `in ${gamesWith} von ${games} Partien`;
}

export function ClassBadge({ c, size = 22 }: { c: TallyClass; size?: number }) {
  const src = badgeFor(c);
  return src ? <img class="cls-badge" src={src} alt="" width={size} height={size} /> : null;
}

/** One tile per classification: badge, name, total and how often per game. */
export function ClassTiles({
  tally,
  keys = TALLY_CLASSES,
  compact = false,
}: {
  tally: MoveTally;
  keys?: readonly TallyClass[];
  compact?: boolean;
}) {
  return (
    <div class={`cls-tiles${compact ? " compact" : ""}`}>
      {tally.classes
        .filter((c) => keys.includes(c.key))
        .map((c) => (
          <div class="cls-tile" key={c.key} style={{ "--tone": CLASS_COLOR[c.key] }} title={`${de(c.per_100)} pro 100 Züge`}>
            <div class="cls-tile-head">
              <ClassBadge c={c.key} />
              <span>{classLabel(c.key)}</span>
            </div>
            <div class="cls-tile-count tnum">{c.count.toLocaleString("de-DE")}</div>
            <div class="cls-tile-sub">{perGameText(c.count, tally.games, c.games_with)}</div>
          </div>
        ))}
    </div>
  );
}

export interface VersusSide {
  label: string;
  moves: number;
  counts: Record<TallyClass, number>;
}

/**
 * Per class, two bars per 100 moves (A solid in the class colour, B faint).
 * Each row has its own scale: a best-move share of 50 % and a brilliant rate of
 * 0.2 % would otherwise never fit one axis; the numbers carry the magnitude.
 */
export function VersusBars({ a, b, keys = TALLY_CLASSES }: { a: VersusSide; b: VersusSide; keys?: readonly TallyClass[] }) {
  const rate = (s: VersusSide, k: TallyClass) => (s.moves ? (s.counts[k] / s.moves) * 100 : 0);
  return (
    <div class="vs-bars">
      {keys.map((k) => {
        const ra = rate(a, k);
        const rb = rate(b, k);
        const top = Math.max(ra, rb) || 1;
        const digits = Math.max(ra, rb) < 1 ? 2 : 1;
        return (
          <div class="vs-row" key={k} style={{ "--tone": CLASS_COLOR[k] }}>
            <div class="vs-label">
              <ClassBadge c={k} size={18} />
              <span>{classLabel(k)}</span>
            </div>
            <div class="vs-pair">
              <div class="vs-line" title={`${a.label}: ${a.counts[k]} von ${a.moves} Zügen`}>
                <div class="vs-track">
                  <div class="vs-fill" style={{ width: `${Math.max(ra ? 2 : 0, (ra / top) * 100)}%` }} />
                </div>
                <span class="tnum">{de(ra, digits)}</span>
              </div>
              <div class="vs-line other" title={`${b.label}: ${b.counts[k]} von ${b.moves} Zügen`}>
                <div class="vs-track">
                  <div class="vs-fill" style={{ width: `${Math.max(rb ? 2 : 0, (rb / top) * 100)}%` }} />
                </div>
                <span class="tnum">{de(rb, digits)}</span>
              </div>
            </div>
          </div>
        );
      })}
      <div class="vs-legend small">
        <span>
          <span class="vs-key" /> {a.label} (oben, kräftig)
        </span>
        <span>
          <span class="vs-key other" /> {b.label} (unten, blass)
        </span>
      </div>
      <p class="faint small" style={{ margin: "2px 0 0" }}>
        Werte pro 100 Züge. Jede Zeile hat ihren eigenen Maßstab, damit auch seltene Züge sichtbar bleiben.
      </p>
    </div>
  );
}

const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function monthName(key: string, long = false): string {
  const [y, m] = key.split("-").map(Number);
  return long ? `${MONTHS_SHORT[m - 1]} ${y}` : `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

/**
 * One 100 % column per month in the tally colours. Months with fewer than
 * MIN_BUCKET_MOVES moves are drawn faint: real, but too thin to read a trend from.
 */
export function MonthColumns({ months, max = 12 }: { months: TallyBlock[]; max?: number }) {
  const shown = months.slice(-max);
  const [hover, setHover] = useState<number | null>(null);
  const segs = shown.map((m) => detailSegments(m.counts));
  const active = hover ?? shown.length - 1;
  const cur = shown[active];
  const curSegs = segs[active];
  return (
    <div class="month-cols">
      <div class="month-cols-plot" onPointerLeave={() => setHover(null)}>
        {shown.map((m, i) => {
          const total = segs[i].reduce((s, x) => s + x.value, 0) || 1;
          return (
            <div
              key={m.key}
              class={`month-col${i === active ? " on" : ""}${m.moves < MIN_BUCKET_MOVES ? " faint" : ""}`}
              onPointerEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
              aria-label={`${monthName(m.key, true)}: ${segs[i].map((s) => `${s.label} ${s.value}`).join(", ")}`}
            >
              {[...segs[i]].reverse().map((s) =>
                s.value ? <div key={s.label} style={{ flexGrow: s.value / total, background: s.color }} /> : null,
              )}
            </div>
          );
        })}
      </div>
      <div class="month-cols-labels">
        {shown.map((m, i) => (
          <span key={m.key} class={i === active ? "on" : ""}>
            {monthName(m.key)}
          </span>
        ))}
      </div>
      {cur && (
        <div class="month-cols-detail small">
          <strong>{monthName(cur.key, true)}</strong>
          <span class="faint">
            {" "}
            · {cur.games} {cur.games === 1 ? "Partie" : "Partien"} · {cur.moves} Züge
            {cur.moves < MIN_BUCKET_MOVES ? " · wenige Daten" : ""}
          </span>
          <div class="month-cols-values">
            {curSegs
              .filter((s) => s.value)
              .map((s) => (
                <span key={s.label}>
                  <span class="legend-key" style={{ background: s.color }} />
                  {s.label} <strong class="tnum">{s.value}</strong>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Legend for the eight tally colour groups. */
export function TallyLegend() {
  const segs: Segment[] = detailSegments({});
  return <Legend items={segs.map((s) => ({ label: s.label, color: s.color }))} />;
}
