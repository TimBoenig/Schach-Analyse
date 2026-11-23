// What makes the league feel alive: who moved since the last visit, and the
// next goal as a short ladder with the chance of each step.
//
// Movement and the ladder only read the ranking's finished numbers; the
// Elo, places and chances are the table's own.
import { useEffect, useMemo } from "preact/hooks";

import {
  advanceSnapshots,
  type ClimbPlan,
  type Movement,
  MIN_RATED_GAMES,
  movements,
  PLAN_GAMES,
  type Ranking,
  type RankRow,
  type Snapshot,
  type SnapshotPair,
  snapshotOf,
  type StrengthEstimate,
  probStronger,
} from "../../domain/players";
import { CountUp, Foot, useEntrance } from "../kit";
import { IconFlame, IconRise, IconShield } from "../icons";
import { locale, t, tj } from "../../i18n";
import { Avatar, half, pct0 } from "./common";

const STORE_KEY = "schach.league.visits";

type Store = Record<string, SnapshotPair>;

function readStore(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(scope: string, pair: SnapshotPair) {
  try {
    const store = readStore();
    store[scope] = pair;
    // A few filters are enough; the oldest scopes drop out first.
    const keys = Object.keys(store);
    for (const k of keys.slice(0, Math.max(0, keys.length - 12))) delete store[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Private mode or blocked storage: the league simply shows no movement.
  }
}

export interface LeagueMoves {
  byId: Record<string, Movement>;
  /** When the compared visit was (null: no earlier visit yet). */
  since: number | null;
}

/**
 * Movement against the last visit, per filter. Remembered only on this
 * device (movement is a convenience, not data).
 */
export function useLeagueMoves(ranking: Ranking | null, scope: string): LeagueMoves {
  const { next, now } = useMemo(() => {
    if (!ranking) return { next: null, now: null };
    const snap = snapshotOf(ranking.rows, Date.now());
    const pair = readStore()[scope] ?? { current: null, previous: null };
    return { next: advanceSnapshots(pair, snap), now: snap as Snapshot };
  }, [ranking, scope]);
  useEffect(() => {
    if (next) writeStore(scope, next);
  }, [next, scope]);
  return useMemo(() => {
    if (!next || !now) return { byId: {}, since: null };
    return { byId: movements(next.previous, now), since: next.previous?.at ?? null };
  }, [next, now]);
}

const DAY_MS = 86400 * 1000;

/** "seit gestern", "seit 18.11." — short, because it sits in a row. */
export function sinceText(since: number | null, now = Date.now()): string {
  if (since === null) return "";
  const days = Math.floor((now - since) / DAY_MS);
  if (days <= 0) return t("seit heute früh");
  if (days === 1) return t("seit gestern");
  return t("seit {date}", { date: new Date(since).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" }) });
}

/** ▲2, ▼1, NEU or nothing: a place change in one glance. */
export function MoveChip({ move }: { move: Movement | undefined }) {
  if (!move) return null;
  if (move.isNew) return <span class="lg-move new" title={t("Neu in der Liga")}>{t("NEU")}</span>;
  if (!move.places) return null;
  const up = move.places > 0;
  const n = Math.abs(move.places);
  const eloPart = move.elo ? ` · ${move.elo > 0 ? "+" : "−"}${Math.abs(move.elo)} Elo` : "";
  return (
    <span class={`lg-move ${up ? "up" : "down"}`} title={(up ? t("{n} Plätze gewonnen", { n }) : t("{n} Plätze verloren", { n })) + eloPart}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      {n}
      <span class="sr-only">{up ? t("Plätze gewonnen") : t("Plätze verloren")}</span>
    </span>
  );
}

/** Elo moved but no place changed: a quiet number next to the Elo. */
export function EloDelta({ move }: { move: Movement | undefined }) {
  if (!move || move.elo === null || move.elo === 0) return null;
  return <span class={`lg-elo-delta tnum ${move.elo > 0 ? "pos" : "neg"}`}>{`${move.elo > 0 ? "+" : "−"}${Math.abs(move.elo)}`}</span>;
}

/** One line for the hero: how the user moved since the earlier visit. */
export function MoveSummary({ move, since }: { move: Movement | undefined; since: number | null }) {
  if (!move || since === null || move.isNew) return null;
  const parts: string[] = [];
  if (move.places) parts.push(move.places > 0 ? t("{n} Plätze hoch", { n: Math.abs(move.places) }) : t("{n} Plätze runter", { n: Math.abs(move.places) }));
  if (move.elo) parts.push(`${move.elo > 0 ? "+" : "−"}${Math.abs(move.elo)} Elo`);
  if (!parts.length) return <span class="lg-move-sum">{t("Unverändert {since}", { since: sinceText(since) })}</span>;
  const up = (move.places ?? 0) > 0 || (!move.places && (move.elo ?? 0) > 0);
  return (
    <span class={`lg-move-sum ${up ? "up" : "down"}`}>
      {parts.join(" · ")} {sinceText(since)}
    </span>
  );
}

// ---------- next goal ----------

const ratio = (v: number, lo: number, hi: number) => (hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0);

/** The players above `me`, nearest first, with the Elo still missing and the chance they are really stronger. */
function ladderAbove(ranked: RankRow[], me: RankRow) {
  const i = ranked.indexOf(me);
  const mine = me.strength as StrengthEstimate;
  return ranked
    .slice(0, i)
    .reverse()
    .map((r) => ({ row: r, gap: (r.strength as StrengthEstimate).elo - mine.elo, p: probStronger(r.strength as StrengthEstimate, mine) }));
}

/**
 * The next goal in one card: how far to the player above as a bar that fills,
 * the steps beyond it, the quickest lever and who is catching up from behind.
 */
export function LeagueGoal({
  ranking,
  tones,
  plan,
  moves,
  onTry,
}: {
  ranking: Ranking;
  tones: Record<string, string>;
  plan: ClimbPlan | null;
  moves: LeagueMoves;
  onTry: (s: { points?: number; cut?: number }) => void;
}) {
  const on = useEntrance();
  const me = ranking.rows.find((r) => r.is_me) ?? null;
  const ranked = ranking.rows.filter((r) => r.strength !== null);
  const mineMove = me ? moves.byId[me.id] : undefined;
  const steps = useMemo(() => (me?.strength ? ladderAbove(ranked, me) : []), [ranking]);
  if (!me) return null;

  // Not ranked yet: the goal is the games that put you on the table.
  if (!me.strength) {
    const left = Math.max(0, MIN_RATED_GAMES - me.rated_games);
    return (
      <section class="card tile span-12 lg-goal">
        <div class="tile-head">
          <h3>
            <IconFlame /> {t("Dein nächstes Ziel")}
          </h3>
          <span class="tile-sub">{t("Platz in der Liga")}</span>
        </div>
        <p class="lg-goal-line">{t("Noch {n} gewertete Partien, dann steigst du in die Tabelle ein.", { n: left })}</p>
        <div class="lg-goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={MIN_RATED_GAMES} aria-valuenow={me.rated_games}>
          <i style={{ width: on ? `${ratio(me.rated_games, 0, MIN_RATED_GAMES) * 100}%` : "0%" }} />
        </div>
        <span class="faint small tnum">{t("{n} von {m} Partien gegen Menschen im Zeitraum", { n: me.rated_games, m: MIN_RATED_GAMES })}</span>
      </section>
    );
  }

  const mine = me.strength;
  const first = steps.length === 0;
  const near = steps[0] ?? null;
  const below = ranked[ranked.indexOf(me) + 1] ?? null;
  const ch = plan?.chaser ?? null;
  const fill = near ? ratio(mine.elo, below ? (below.strength as StrengthEstimate).elo : mine.elo - Math.max(25, near.gap), (near.row.strength as StrengthEstimate).elo) : 1;
  const shown = steps.slice(0, 4);

  return (
    <section class={`card tile span-12 lg-goal${first ? " lead" : ""}`}>
      <div class="tile-head">
        <h3>
          {first ? <IconShield /> : <IconRise />} {first ? t("Dein Ziel: die Spitze halten") : t("Dein nächstes Ziel")}
        </h3>
        <span class="tile-sub">{first ? t("Platz 1 verteidigen") : t("Platz {rank}", { rank: (me.rank ?? 1) - 1 })}</span>
      </div>
      {first ? (
        <p class="lg-goal-line">
          {ch ? t("{name} liegt {gap} Elo hinter dir: zu {p} bist du wirklich stärker.", { name: ch.name, gap: ch.gap_elo, p: pct0(ch.p_ahead * 100) }) : t("Niemand liegt hinter dir.")}
        </p>
      ) : (
        <p class="lg-goal-line">
          {tj("Noch {gap} Elo bis {name}", { gap: <CountUp class="lg-goal-num" value={near!.gap} />, name: near!.row.name })}
        </p>
      )}
      <div class="lg-goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)} title={t("Weg zum nächsten Platz")}>
        <i style={{ width: on ? `${Math.max(4, fill * 100)}%` : "0%" }} />
      </div>
      {mineMove && moves.since !== null && !mineMove.isNew && (mineMove.places || mineMove.elo) ? (
        <p class={`lg-goal-moved ${(mineMove.places ?? 0) > 0 || (!mineMove.places && (mineMove.elo ?? 0) > 0) ? "up" : "down"}`}>
          <MoveSummary move={mineMove} since={moves.since} />
        </p>
      ) : null}
      {shown.length > 0 && (
        <ol class="lg-ladder">
          {shown
            .slice()
            .reverse()
            .map((s, i) => (
              <li key={s.row.id} class="lg-step" style={{ "--i": i } as Record<string, number>}>
                <span class="lg-step-rank tnum">{s.row.rank}</span>
                <Avatar name={s.row.name} tone={tones[s.row.id] ?? "tone-0"} size="sm" />
                <span class="lg-step-name">
                  <strong>{s.row.name}</strong>
                  <span class="faint small">{t("zu {p} wirklich stärker", { p: pct0(s.p * 100) })}</span>
                </span>
                <span class="lg-step-gap tnum">+{s.gap}</span>
              </li>
            ))}
          <li class="lg-step me">
            <span class="lg-step-rank tnum">{me.rank}</span>
            <Avatar name="Du" tone="tone-me" size="sm" ring />
            <span class="lg-step-name">
              <strong>{t("Du")}</strong>
              <span class="faint small tnum">{t("Elo {n}", { n: mine.elo })}</span>
            </span>
            <span class="lg-step-gap tnum">{t("hier")}</span>
          </li>
        </ol>
      )}
      {plan && plan.target && (plan.points !== null || plan.error_cut !== null) && (
        <div class="lg-goal-ways">
          {plan.points !== null && (
            <button class="btn ghost small" onClick={() => onTry({ points: plan.points as number })}>
              {t("{p} aus {n} Partien", { p: half(plan.points), n: PLAN_GAMES })}
            </button>
          )}
          {plan.error_cut !== null && (
            <button class="btn ghost small" onClick={() => onTry({ cut: Math.ceil((plan.error_cut as number) * 100) / 100 })}>
              {t("{p} % weniger Fehler", { p: Math.ceil((plan.error_cut as number) * 100) })}
            </button>
          )}
          <span class="faint small">{t("Antippen und oben ausprobieren")}</span>
        </div>
      )}
      <Foot>{t("Die Schritte sind die Plätze der Tabelle mit deren Elo-Abstand. Die Prozentzahl sagt, wie sicher der Abstand mehr ist als Zufall. Die Bewegung vergleicht mit deinem letzten Besuch auf diesem Gerät, nur unter den Spielern, die damals auch dabei waren.")}</Foot>
    </section>
  );
}
