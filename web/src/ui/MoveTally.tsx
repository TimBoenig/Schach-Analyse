// Building blocks for the move tally ("Zugbilanz"): one tile per kind of move,
// a side-by-side comparison per 100 moves and month names. Used on the
// "Züge & Fehler" page and on a friend's page.

import { type MoveTally, TALLY_CLASSES, type TallyClass } from "../domain/profile";
import { Legend, type Segment } from "./charts";
import { badgeFor, CLASS_COLOR, classLabel, detailSegments } from "./labels";
import { t, locale, dec } from "../i18n";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", dec());

/** "0,4" per game, but "1 von 9 Partien" when the kind is rare. */
export function perGameText(count: number, games: number, gamesWith: number): string {
  if (!count) return t("noch keiner");
  const pg = count / games;
  return pg >= 0.95 ? t("Ø {de} pro Partie", { de: de(pg) }) : t("in {gamesWith} von {games} Partien", { gamesWith, games });
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
  onPick,
}: {
  tally: MoveTally;
  keys?: readonly TallyClass[];
  compact?: boolean;
  /** Returns what a tap on a tile does, or nothing for a tile that stays plain. */
  onPick?: (key: TallyClass) => (() => void) | undefined;
}) {
  return (
    <div class={`cls-tiles${compact ? " compact" : ""}`}>
      {tally.classes
        .filter((c) => keys.includes(c.key))
        .map((c) => {
          const pick = c.count ? onPick?.(c.key) : undefined;
          const body = (
            <>
              <div class="cls-tile-head">
                <ClassBadge c={c.key} />
                <span>{classLabel(c.key)}</span>
              </div>
              <div class="cls-tile-count tnum">{c.count.toLocaleString(locale())}</div>
              <div class="cls-tile-sub">{perGameText(c.count, tally.games, c.games_with)}</div>
            </>
          );
          const shared = { class: "cls-tile", key: c.key, style: { "--tone": CLASS_COLOR[c.key] } };
          return pick ? (
            <button {...shared} onClick={pick} title={t("Diese Züge ansehen")}>
              {body}
            </button>
          ) : (
            <div {...shared} title={t("{de} pro 100 Züge", { de: de(c.per_100) })}>
              {body}
            </div>
          );
        })}
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
              <div class="vs-line" title={t("{label}: {1} von {moves} Zügen", { label: a.label, 1: a.counts[k], moves: a.moves })}>
                <div class="vs-track">
                  <div class="vs-fill" style={{ width: `${Math.max(ra ? 2 : 0, (ra / top) * 100)}%` }} />
                </div>
                <span class="tnum">{de(ra, digits)}</span>
              </div>
              <div class="vs-line other" title={t("{label}: {1} von {moves} Zügen", { label: b.label, 1: b.counts[k], moves: b.moves })}>
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
          <span class="vs-key" /> {t("{label} (oben, kräftig)", { label: a.label })}
        </span>
        <span>
          <span class="vs-key other" /> {t("{label} (unten, blass)", { label: b.label })}
        </span>
      </div>
      <p class="faint small" style={{ margin: "2px 0 0" }}>
        
        {t("Werte pro 100 Züge. Jede Zeile hat ihren eigenen Maßstab, damit auch seltene Züge sichtbar bleiben.")}
      </p>
    </div>
  );
}

const MONTHS_SHORT = [t("Jan"), t("Feb"), t("Mär"), t("Apr"), t("Mai"), t("Jun"), t("Jul"), t("Aug"), t("Sep"), t("Okt"), t("Nov"), t("Dez")];

/** "2026-03" -> "Mär 26", or "Mär 2026" with `long`. */
export function monthName(key: string, long = false): string {
  const [y, m] = key.split("-").map(Number);
  return long ? `${MONTHS_SHORT[m - 1]} ${y}` : `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

/** Legend for the eight tally colour groups. */
export function TallyLegend() {
  const segs: Segment[] = detailSegments({});
  return <Legend items={segs.map((s) => ({ label: s.label, color: s.color }))} />;
}
