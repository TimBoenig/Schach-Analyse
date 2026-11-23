// The friends ranking as a league: the track of points, who would win a
// tournament tonight, what it takes to climb a place (with a live "what if"),
// every pairing in a crosstable, the strengths matrix, form and records.
//
// Everything here reads the ranking's estimates with their uncertainty, so the
// page keeps the comparison's rules: the rating counts for nothing, and a gap
// is only called a lead when chance cannot explain it.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { updatePlayer } from "../../app/players";
import { statsFormat } from "../../domain/analysisDepth";
import { PAGE_PERIODS } from "../../domain/periods";
import {
  type Archetype,
  type Area,
  AREA_LABEL,
  AREAS,
  areaTable,
  archetypes,
  type Battle,
  buildBattle,
  buildCrosstable,
  buildRanking,
  climbPlan,
  type ClimbPlan,
  comparisonPeriod,
  type CrossCell,
  crossHighlights,
  type Crosstable,
  expectedPoints,
  eloText,
  FORM_DAYS,
  type FormRow,
  type GroupPoint,
  groupForm,
  groupMomentum,
  groupRecords,
  type GroupRecord,
  type GroupStanding,
  groupStanding,
  type HeadToHead,
  MIN_PAIR_GAMES,
  MIN_RATED_GAMES,
  MOMENTUM_WEEKS,
  type MomentumRow,
  pairForecast,
  PLAN_GAMES,
  playerUsernames,
  probStronger,
  qualityMap,
  type QualityMap,
  rankedFriends,
  type RankCell,
  type Ranking,
  type RankRow,
  rivalOf,
  simulateTournament,
  type StrengthEstimate,
  type Tournament,
  type TrackedPlayer,
  whatIf,
} from "../../domain/players";
import { ELO_SCALE_LABEL, lichessBlitzToElo } from "../../domain/profile/fide";
import { filterGames, parsePlayedAt, withoutBots } from "../../domain/metrics";
import type { PlayerProfile } from "../../domain/profile";
import type { StoredGame } from "../../domain/types";
import { useWidth } from "../charts";
import { Foot, ScaleTrack, type TrackMarker, useEntrance, WhatIfSlider } from "../kit";
import { CoachAvatar } from "../Coach";
import { IconBolt, IconChevron, IconCrown, IconEye, IconEyeOff, IconFilter, IconFlame, IconReset, IconRise, IconShield, IconSpark, IconStar, IconSwords, IconTrophy } from "../icons";
import { SPEED_DE } from "../labels";
import { navigate, toHash } from "../router";
import { Section, SectionJump, type StatSection } from "../StatsLayout";
import { trFilter } from "../../domain/i18n";
import { useBulletPrefs } from "../useAnalysisPrefs";
import { useNarrow } from "../useNarrow";
import { formatOptionLabel } from "../useProfile";
import { DuelHub, LeagueExplainer } from "./LeagueDuel";
import { AnalyzeFriends, Avatar, de, formatFactor, half, pct0, PlayerFilters, plural, profileFor, RefreshAll, signed, toneOf, Who } from "./common";
import { t, tj, lang, locale } from "../../i18n";

export const LEAGUE_SECTIONS: StatSection[] = [
  { id: "duelle", title: t("Duelle"), sub: t("Du gegen deine Freunde, Runde für Runde"), cards: [t("Kreuztabelle"), t("Auffällig"), t("Battle-Arena")] },
  { id: "liga", title: t("Liga"), sub: t("Stand, Turnierchancen und dein Weg nach oben"), cards: [t("Liga-Spur"), t("Was wäre wenn"), t("Tabelle"), t("Turnier"), t("Überholen")] },
  { id: "staerken", title: t("Stärken"), sub: t("wer wo vorn liegt und wer mehr aus dem eigenen Spiel macht"), cards: [t("Stärken-Matrix"), t("Spielqualität gegen Ergebnis"), t("Spielertypen")] },
  { id: "form", title: t("Form"), sub: t("wer gerade besser spielt"), cards: [t("Formkurve"), t("Formtabelle")] },
  { id: "rekorde", title: t("Rekorde"), sub: t("die Ruhmeshalle eurer Gruppe"), cards: [t("Ruhmeshalle")] },
];

type Tones = Record<string, string>;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const winPct = (p: number) => (p > 0 && p < 0.005 ? "<1 %" : pct0(p * 100));

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- members ----------

/** Who takes part in the ranking: one tap hides or shows a friend, and it stays that way. */
function RankingMembers({ friends, tones }: { friends: TrackedPlayer[]; tones: Tones }) {
  const hidden = friends.filter((p) => p.hidden);
  return (
    <div class="rank-members">
      <span class="small muted">{t("Im Vergleich:")}</span>
      <div class="chips">
        <span class="chip member on me" title={t("Du bist immer dabei")}>
          <Avatar name="Du" tone="tone-me" size="sm" />  {t("Du")}
        </span>
        {friends.map((p) => (
          <button
            key={p.id}
            class={`chip member${p.hidden ? "" : " on"}`}
            aria-pressed={!p.hidden}
            title={p.hidden ? t("{name} wieder in die Rangliste aufnehmen", { name: p.name }) : t("{name} in Rangliste und Vergleich ausblenden", { name: p.name })}
            onClick={() => void updatePlayer(p.id, { hidden: !p.hidden })}
          >
            {p.hidden ? <IconEyeOff /> : <Avatar name={p.name} tone={tones[p.id] ?? "tone-0"} size="sm" />} {p.name}
            {!p.hidden && <IconEye />}
          </button>
        ))}
        {hidden.length > 1 && (
          <button class="chip" onClick={() => void Promise.all(hidden.map((p) => updatePlayer(p.id, { hidden: false })))}>
            
            {t("Alle einblenden")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- hero: the league track and "what if" ----------

/** A value of the common scale as the shown Elo number, for axes and gaps. */
const eloOf = (v: number) => lichessBlitzToElo(v);
const eloLabel = (v: number) => eloText(v);
const strengthOf = (r: RankRow) => r.strength?.value ?? null;

/** Track bounds on the shown Elo scale: the group's 95 % ranges, rounded out to 50. */
function trackBounds(rows: RankRow[]): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(...rows.map((r) => r.strength?.elo_low ?? Infinity));
  const hi = Math.max(...rows.map((r) => r.strength?.elo_high ?? -Infinity));
  const min = Math.floor((lo - 25) / 50) * 50;
  const max = Math.max(min + 100, Math.ceil((hi + 25) / 50) * 50);
  const step = Math.max(50, Math.ceil((max - min) / 4 / 50) * 50);
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  return { min, max, ticks };
}

/** "Platz 2" when sure, "Platz 1–3" otherwise. */
const placeRange = (r: RankRow) => (r.odds && r.odds.low !== r.odds.high ? `${r.odds.low}–${r.odds.high}` : String(r.rank ?? "–"));

/** Every ranked player on one line, at their shown Elo strength. */
function Track({ rows, value, tones }: { rows: RankRow[]; value: (r: RankRow) => number | null; tones: Tones }) {
  const b = trackBounds(rows);
  const markers: TrackMarker[] = rows.map((r) => {
    const v = value(r) ?? 0;
    return { id: r.id, label: r.name, value: clamp(eloOf(v), b.min, b.max), valueText: eloLabel(v), tone: tones[r.id], me: r.is_me };
  });
  return <ScaleTrack markers={markers} min={b.min} max={b.max} ticks={b.ticks} />;
}

function WhatIf({ me, sim, onSim, ranking }: { me: RankRow; sim: Sim; onSim: (s: Sim) => void; ranking: Ranking }) {
  const s = me.strength as StrengthEstimate;
  const base = Math.round(expectedPoints(s, PLAN_GAMES) * 2) / 2;
  const points = sim.points ?? base;
  const cut = sim.cut ?? 0;
  const changed = sim.points !== undefined || sim.cut !== undefined;
  const result = whatIf(ranking, me.id, points, cut);
  const delta = result ? eloOf(result.value) - eloOf(s.value) : 0;
  return (
    <div class="lg-whatif">
      <div class="lg-sliders">
        <WhatIfSlider
          label={t("Punkte aus deinen nächsten {PLAN_GAMES} Partien", { PLAN_GAMES })}
          value={points}
          base={base}
          min={0}
          max={PLAN_GAMES}
          step={0.5}
          text={`${de(points, points % 1 ? 1 : 0)} / ${PLAN_GAMES}`}
          deltaText={signed(points - base, 1)}
          good={points > base}
          onInput={(v) => onSim({ ...sim, points: Math.abs(v - base) < 0.25 ? undefined : v })}
        />
        {s.quality && s.quality.weight > 0.02 && (
          <WhatIfSlider
            label={t("Weniger Fehler pro Zug")}
            value={cut * 100}
            base={0}
            min={0}
            max={50}
            step={1}
            text={`−${Math.round(cut * 100)} %`}
            deltaText={`${Math.round(cut * 100)} %`}
            good={cut > 0}
            onInput={(v) => onSim({ ...sim, cut: v < 0.5 ? undefined : v / 100 })}
          />
        )}
      </div>
      <div class={`lg-whatif-result${changed ? " on" : ""}`} role="status">
        {changed && result ? (
          <>
            <span>
              
              {tj("Damit wärst du auf {x}{n} mit {x2} {x3}{n2}.", { x: <strong>{t("Platz {rank}", { rank: result.rank })}</strong>, n: result.rank !== me.rank && me.rank !== null ? t(" statt {rank}", { rank: me.rank }) : "", x2: <strong class="tnum">{t("Elo {eloLabel}", { eloLabel: eloLabel(result.value) })}</strong>, x3: <span class={`tnum ${delta >= 0 ? "pos" : "neg"}`}>({signed(delta, 0)})</span>, n2: result.passed.length ? t(", vor {passed}", { passed: result.passed.join(t(" und ")) }) : "" })}</span>
            <button class="btn ghost small" onClick={() => onSim({})}>
              <IconReset />  {t("Zurück")}
            </button>
          </>
        ) : (
          <span class="muted">
            
            {t("Schieb die Regler und sieh live, wo du landest. Erwartet sind bei deiner Stärke etwa {n} Punkte aus {PLAN_GAMES} Partien gegen deine üblichen Gegner; die anderen bleiben, wie sie sind.", { n: de(base, base % 1 ? 1 : 0), PLAN_GAMES })}
          </span>
        )}
      </div>
    </div>
  );
}

type Sim = { points?: number; cut?: number };

function LeagueHero({ ranking, tones, tournament, sim, onSim }: { ranking: Ranking; tones: Tones; tournament: Tournament | null; sim: Sim; onSim: (s: Sim) => void }) {
  const ranked = ranking.rows.filter((r) => r.strength !== null);
  const me = ranked.find((r) => r.is_me) ?? null;
  const [open, setOpen] = useState(false);
  const simValue = useMemo(() => (me && (sim.points !== undefined || sim.cut !== undefined) ? whatIf(ranking, me.id, sim.points ?? expectedPoints(me.strength as StrengthEstimate, PLAN_GAMES), sim.cut ?? 0) : null), [ranking, me, sim]);
  if (!ranked.length) return null;
  const value = (r: RankRow) => (simValue && r.is_me ? simValue.value : strengthOf(r));
  const leader = ranked[0];
  const lead = leader.strength as StrengthEstimate;
  const title = leader.is_me ? t("Du führst die Liga an") : t("{name} führt die Liga an", { name: leader.name });
  const win = (id: string) => tournament?.rows.find((tk) => tk.id === id)?.win ?? null;
  const i = me ? ranked.indexOf(me) : -1;
  const above = i > 0 ? ranked[i - 1] : null;
  const below = me && i < ranked.length - 1 ? ranked[i + 1] : null;
  const pAbove = me && above ? probStronger(above.strength as StrengthEstimate, me.strength as StrengthEstimate) : null;
  const pBelow = me && below ? probStronger(me.strength as StrengthEstimate, below.strength as StrengthEstimate) : null;
  const lw = win(leader.id);
  return (
    <section class="card lg-hero span-12" id="lg-hero">
      <div class="lg-hero-head">
        <div class="lg-hero-lead">
          <span class="lg-hero-mark" aria-hidden="true">
            <IconTrophy />
          </span>
          <div>
          <span class="lg-kicker">{t("Liga · {n}", { n: plural(ranked.length, t("Spieler"), t("Spieler")) })}</span>
          <h2 class="lg-hero-title">{title}</h2>
          <p class="lg-hero-sub">
            
            {t("Spielstärke Elo {eloLabel} (geschätzt zwischen {elo_low} und {elo_high}){n}", { eloLabel: eloLabel(lead.value), elo_low: lead.elo_low, elo_high: lead.elo_high, n: lw !== null ? t(" · gewinnt {winPct} der simulierten Turniere", { winPct: winPct(lw) }) : "" })}
          </p>
          </div>
        </div>
        {me && (
          <div class="lg-hero-me">
            <span class="lg-hero-place tnum">{me.rank}.</span>
            <span class="lg-hero-me-text">
              <strong>{t("Dein Platz{n}", { n: me.odds && me.odds.low !== me.odds.high ? t(" (sicher: {placeRange})", { placeRange: placeRange(me) }) : "" })}</strong>
              <span class="faint small">
                {t("{n}{n2}", { n: above ? t("{0} hinter {name} (zu {winPct} wirklich stärker)", { 0: eloOf(strengthOf(above) as number) - eloOf(strengthOf(me) as number), name: above.name, winPct: winPct(pAbove as number) }) : t("niemand vor dir"), n2: below ? t(" · {0} vor {name} (zu {winPct} sicher)", { 0: eloOf(strengthOf(me) as number) - eloOf(strengthOf(below) as number), name: below.name, winPct: winPct(pBelow as number) }) : "" })}
              </span>
            </span>
          </div>
        )}
      </div>
      <Track rows={ranked} value={value} tones={tones} />
      {me && (
        <>
          <button class={`lg-whatif-toggle${open || simValue ? " on" : ""}`} onClick={() => setOpen(!(open || simValue))} aria-expanded={open || Boolean(simValue)}>
            <IconSpark />  {tj("Was wäre wenn?{x}", { x: <span class="faint small">  {t("Ergebnisse und Fehler verschieben und den Platz live sehen")}</span> })}
          </button>
          {(open || simValue) && <WhatIf me={me} sim={sim} onSim={onSim} ranking={ranking} />}
        </>
      )}
    </section>
  );
}

// ---------- table ----------

/**
 * " (roh 71,0 %)" when the time-control correction moved a value: the league
 * shows corrected values, the player's profile the raw one, and both should
 * be readable side by side.
 */
function rawNote(key: string, cell: RankCell | undefined): string {
  if (!cell || cell.raw === null || cell.raw === undefined || cell.value === null) return "";
  const raw = formatFactor(key, cell.raw);
  return raw === formatFactor(key, cell.value) ? "" : t(" (roh {raw})", { raw });
}

function rawTitle(label: string, key: string, cell: RankCell | undefined): string {
  const note = rawNote(key, cell);
  return note ? t("{label}, nach Bedenkzeit bereinigt{note}", { label, note }) : label;
}

/** Where a player's strength comes from: results and move quality, each with its weight. */
/** The verdict names "Du"/"You" like any player; fix the verb for the second person. */
function verdictForYou(text: string): string {
  // i18n: grammar
  if (lang() === "en") return text.replace(/^You wins /, "You win ").replace(" You is ", " you are ");
  // i18n: grammar
  return text.replace(/^Du gewinnt /, "Du gewinnst ").replace(" liegt aber Du ", " liegst aber du ");
}

export function Breakdown({ row }: { row: RankRow }) {
  const s = row.strength;
  if (!s) return <p class="muted small">{t("Noch zu wenig gewertete Partien für eine Spielstärke.")}</p>;
  const q = s.quality;
  const wq = q?.weight ?? 0;
  const parts = [
    {
      key: "results",
      label: t("Ergebnisse"),
      value: s.results.value,
      se: s.results.se,
      weight: 1 - wq,
      note: t("{half} aus {games} gegen Ø Elo {eloLabel}", { half: half(s.results.points), games: s.results.games, eloLabel: eloLabel(s.results.avg_opp) }),
      cls: "g-res",
    },
    ...(q
      ? [
          {
            key: "quality",
            label: t("Zugqualität"),
            value: q.value,
            se: Math.hypot(q.se, q.k_sd),
            weight: wq,
            note: t("{de}× so viele Fehler pro Zug wie die Gegner · {plural}", { de: de(q.error_ratio, 2), plural: plural(q.games, t("Analyse"), t("Analysen")) }),
            cls: "g-qual",
          },
        ]
      : []),
  ];
  return (
    <div class="breakdown">
      <div class="breakdown-bar" role="img" aria-label={t("Anteile an der Spielstärke")}>
        {parts.map((p) => (
          <span key={p.key} class={p.cls} style={{ width: `${p.weight * 100}%` }} title={`${p.label}: ${pct0(p.weight * 100)}`} />
        ))}
      </div>
      <div class="breakdown-rows">
        {parts.map((p) => (
          <div class="breakdown-row" key={p.key}>
            <span class={`dot ${p.cls}`} />
            <span>{p.label}</span>
            <span class="faint small">{p.note}</span>
            <span class="tnum small muted">{t("zählt {n}", { n: pct0(p.weight * 100) })}</span>
            <strong class="tnum">
              {eloLabel(p.value)} <span class="faint small">±{Math.round(eloOf(p.value + 1.96 * p.se) - eloOf(p.value))}</span>
            </strong>
          </div>
        ))}
      </div>
      <p class="faint small" style={{ margin: "6px 0 0" }}>
        {t("{n}{n2}", { n: q
          ? t("Beide Werte sind Spielstärken auf derselben Elo-Skala aus denselben Gegnern. Je genauer ein Wert, desto mehr zählt er.")
          : t("Zugqualität zählt ab 5 analysierten Partien mit gewertetem Gegner."), n2: row.bot_games ? t(" {plural} draußen.", { plural: plural(row.bot_games, t("Partie gegen einen Computer bleibt"), t("Partien gegen Computer bleiben")) }) : "" })}
      </p>
    </div>
  );
}

/** The 95 % range of a strength on the track's scale: a band with the estimate as a tick. */
function RangeBar({ row, bounds, tone, on }: { row: RankRow; bounds: { min: number; max: number }; tone: string; on: boolean }) {
  const s = row.strength;
  if (!s) return <span class="lg-bar lg-ci none" />;
  const pos = (v: number) => clamp(((v - bounds.min) / (bounds.max - bounds.min)) * 100, 0, 100);
  const a = pos(s.elo_low);
  const b = pos(s.elo_high);
  return (
    <span class="lg-bar lg-ci" title={t("95 %: Elo {elo_low}–{elo_high}", { elo_low: s.elo_low, elo_high: s.elo_high })}>
      <span class={`band ${tone}`} style={{ left: `${a}%`, width: `${Math.max(2, b - a)}%`, opacity: on ? undefined : 0 }} />
      <i class={tone} style={{ left: `${pos(eloOf(s.value))}%` }} />
    </span>
  );
}

function Standings({ ranking, tones, types }: { ranking: Ranking; tones: Tones; types: Record<string, Archetype> }) {
  const [open, setOpen] = useState<string | null>(null);
  const on = useEntrance();
  const ranked = ranking.rows.filter((r) => r.strength);
  const bounds = ranked.length ? trackBounds(ranked) : { min: 800, max: 1600 };
  return (
    <section class="card tile span-7 lg-table">
      <div class="tile-head">
        <h3>{t("Tabelle")}</h3>
        <span class="tile-sub">{t("Spielstärke als Elo ({ELO_SCALE_LABEL}) mit 95-%-Spanne · {trFilter} · antippen für die Herkunft", { ELO_SCALE_LABEL, trFilter: trFilter(ranking.period) })}</span>
      </div>
      <ol class="lg-rows">
        {ranking.rows.map((r, i) => {
          const isOpen = open === r.id;
          const tk = types[r.id];
          return (
            <li key={r.id} class={`lg-row${r.is_me ? " me" : ""}${isOpen ? " open" : ""}`} style={{ "--i": i } as Record<string, number>}>
              <button class="lg-row-main" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                <span class={`lg-rank r${r.rank ?? 0}`} title={r.odds ? t("Platz {placeRange} in 90 % der möglichen Reihenfolgen", { placeRange: placeRange(r) }) : undefined}>
                  {r.rank ?? "–"}
                </span>
                <Avatar name={r.name} tone={tones[r.id]} ring={r.is_me} />
                <span class="lg-row-name">
                  <strong>{r.name}</strong>
                  <span class="faint small">
                    {r.strength === null
                      ? t("zu wenig Partien ({rated_games}/{MIN_RATED_GAMES})", { rated_games: r.rated_games, MIN_RATED_GAMES })
                      : `${r.odds && r.odds.low !== r.odds.high ? t("Platz {placeRange} möglich", { placeRange: placeRange(r) }) : t("Platz sicher")}${tk && tk.title !== "Noch offen" ? ` · ${tk.title}` : ""}`}
                  </span>
                </span>
                <span class="lg-row-stats">
                  <span title={rawTitle(t("Genauigkeit"), "accuracy", r.cells.accuracy)}>
                    <span class="faint">{t("Gen.")}</span> {formatFactor("accuracy", r.cells.accuracy?.value ?? null)}
                  </span>
                  <span title={rawTitle(t("Patzer pro Partie"), "blunders", r.cells.blunders)}>
                    <span class="faint">{t("Patzer")}</span> {formatFactor("blunders", r.cells.blunders?.value ?? null)}
                  </span>
                  <span title={t("Gewertete Partien gegen Menschen im Zeitraum")}>
                    <span class="faint">{t("Partien")}</span> {r.rated_games}
                  </span>
                </span>
                <span class="lg-row-score">
                  <RangeBar row={r} bounds={bounds} tone={tones[r.id]} on={on} />
                  <strong class="tnum" title={r.strength ? t("Elo {elo_low}–{elo_high} (95 %)", { elo_low: r.strength.elo_low, elo_high: r.strength.elo_high }) : undefined}>
                    {r.strength ? r.strength.elo : "–"}
                  </strong>
                </span>
              </button>
              {isOpen && (
                <div class="lg-row-detail">
                  <p class="faint small lg-row-basis">
                    
                    {t("Grundlage: {n} gegen Menschen, {analyzed} analysiert{n2}{n3}", { n: plural(r.rated_games, t("gewertete Partie"), t("gewertete Partien")), analyzed: r.analyzed, n2: r.strength ? t(" · 95 %: Elo {elo_low}–{elo_high}", { elo_low: r.strength.elo_low, elo_high: r.strength.elo_high }) : "", n3: r.odds ? t(" · Platz {placeRange} in 90 % der möglichen Reihenfolgen, Platz 1 zu {winPct}", { placeRange: placeRange(r), winPct: winPct(r.odds.first) }) : "" })}
                  </p>
                  <Breakdown row={r} />
                  {!r.is_me && (
                    <a class="btn small" href={toHash({ view: "players", playerId: r.id })}>
                      <IconSwords />  {t("Du gegen {name}", { name: r.name })}
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <Foot>
        
        {t("Jeder wird nur an den eigenen Partien gemessen: Ergebnisse gegen die Wertung der Gegner und die Fehler pro Zug im Vergleich zu ihnen. Wer dazukommt oder ausgeblendet wird, ändert an der Reihenfolge der anderen nichts. Die eigene Wertung zählt nicht.")}
      </Foot>
    </section>
  );
}

function TournamentCard({ t: tk, tones }: { t: Tournament | null; tones: Tones }) {
  const on = useEntrance();
  if (!tk) {
    return (
      <section class="card tile span-5 lg-cup">
        <div class="tile-head">
          <h3>{t("Wer gewinnt euer Turnier?")}</h3>
        </div>
        <p class="muted small">{t("Ab drei Spielern mit Spielstärke simuliert die App hier ein Turnier jeder gegen jeden.")}</p>
      </section>
    );
  }
  const max = Math.max(...tk.rows.map((r) => r.win), 0.0001);
  return (
    <section class="card tile span-5 lg-cup">
      <div class="tile-head">
        <h3>
          <IconTrophy />  {t("Wer gewinnt euer Turnier?")}
        </h3>
        <span class="tile-sub">{t("{n}-mal gespielt", { n: tk.runs.toLocaleString(locale()) })}</span>
      </div>
      <p class="small muted" style={{ marginTop: 0 }}>
        
        {t("Jeder gegen jeden, Hin- und Rückrunde: {n} pro Spieler.", { n: plural(tk.games_each, t("Partie"), t("Partien")) })}
      </p>
      <div class="lg-cup-rows">
        {tk.rows.map((r, i) => (
          <div class={`lg-cup-row${r.is_me ? " me" : ""}`} key={r.id}>
            <span class="lg-cup-name">
              <Avatar name={r.name} tone={tones[r.id]} size="sm" />
              <strong>{r.name}</strong>
            </span>
            <span class="lg-cup-bar" aria-hidden="true">
              <span class={tones[r.id]} style={{ transform: `scaleX(${on ? r.win / max : 0})`, transitionDelay: `${i * 70}ms` }} />
            </span>
            <strong class="tnum lg-cup-pct">{winPct(r.win)}</strong>
            <span class="faint small lg-cup-sub tnum">
              
              {t("Podest {n} · Ø {n2} von {games_each}", { n: winPct(r.podium), n2: de(r.expected, 1), games_each: tk.games_each })}
            </span>
          </div>
        ))}
      </div>
      <Foot>
        
        {t("Jeder Durchgang zieht zuerst eure wahre Stärke aus der Unsicherheit und würfelt dann jede Partie nach der Elo-Formel aus; eure direkten Partien gehen gedämpft ein. {n} enden remis.", { n: pct0(tk.draw_rate * 100) })}
      </Foot>
    </section>
  );
}

// ---------- climbing ----------

function ClimbCard({ plan, onTry }: { plan: ClimbPlan | null; onTry: (s: Sim) => void }) {
  if (!plan || plan.rank === null) return null;
  const tk = plan.target;
  const ch = plan.chaser;
  return (
    <section class="card tile span-12 lg-climb">
      <div class="tile-head">
        <h3>
          <IconRise /> {tk ? t("So überholst du {name}", { name: tk.name }) : t("Du stehst ganz oben")}
        </h3>
        <span class="tile-sub">{tk ? t("{gap_elo} Elo-Punkte bis Platz {rank}", { gap_elo: plan.gap_elo, rank: tk.rank }) : t("jetzt heißt es: verteidigen")}</span>
      </div>
      <div class="lg-climb-grid">
        <div>
          {!tk ? (
            <p class="small muted">{t("Niemand liegt vor dir. Rechts siehst du, wer am nächsten dran ist.")}</p>
          ) : (
            <>
              {plan.p_already !== null && plan.p_already >= 0.2 && (
                <p class="small" style={{ marginTop: 0 }}>
                  
                  {t("Der Abstand liegt im Rahmen der Unsicherheit: zu {n} bist du schon jetzt der Stärkere. Mehr Partien klären das.", { n: winPct(plan.p_already) })}
                </p>
              )}
              <div class="lg-levers">
                <div class="lg-lever">
                  <span class="lg-lever-label">
                    <strong>{t("Ergebnisse")}</strong>
                    <span class="faint small tnum">
                      {plan.points === null
                        ? t("selbst {PLAN_GAMES} aus {PLAN_GAMES2} reichen nicht", { PLAN_GAMES, PLAN_GAMES2: PLAN_GAMES })
                        : t("{half} aus den nächsten {PLAN_GAMES} Partien (erwartet {half2})", { half: half(plan.points), PLAN_GAMES, half2: half(Math.round(plan.points_expected * 2) / 2) })}
                    </span>
                  </span>
                  {plan.points !== null && (
                    <button class="btn ghost small" onClick={() => onTry({ points: plan.points as number })}>
                      
                      {t("Ausprobieren")}
                    </button>
                  )}
                </div>
                <div class="lg-lever">
                  <span class="lg-lever-label">
                    <strong>{t("Zugqualität")}</strong>
                    <span class="faint small tnum">
                      {plan.error_cut === null ? t("allein nicht genug (oder noch zu wenig analysiert)") : t("{0} % weniger verschenkte Gewinnchance pro Zug", { 0: Math.ceil(plan.error_cut * 100) })}
                    </span>
                  </span>
                  {plan.error_cut !== null && (
                    <button class="btn ghost small" onClick={() => onTry({ cut: Math.ceil(plan.error_cut! * 100) / 100 })}>
                      
                      {t("Ausprobieren")}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div class="lg-climb-guard">
          <h4>{ch ? t("Hinter dir: {name}", { name: ch.name }) : t("Hinter dir")}</h4>
          {ch ? (
            <p class="small">
              {tj("{gap_elo} Elo-Punkte zurück, du bist zu {n} wirklich stärker. {n2}", { gap_elo: <strong class="tnum">{ch.gap_elo}</strong>, n: winPct(ch.p_ahead), n2: ch.points !== null
                ? t("Mit {half} aus {PLAN_GAMES} Partien wäre {name} an dir vorbei.", { half: half(ch.points), PLAN_GAMES, name: ch.name })
                : t("Selbst mit {PLAN_GAMES} Siegen in Folge käme {name} nicht an dir vorbei.", { PLAN_GAMES, name: ch.name }) })}
            </p>
          ) : (
            <p class="small muted">{t("Niemand: du bist Letzter. Von hier geht es nur nach oben.")}</p>
          )}
        </div>
      </div>
      <Foot>
        
        {t("Gerechnet mit genau dem Modell der Tabelle: neue Partien gegen Gegner auf deinem üblichen Niveau kommen zu deinen bisherigen dazu.")}
      </Foot>
    </section>
  );
}

// ---------- duels ----------

/** Win or loss tint over the cell, stronger the further the score is from 50 %. */
const heatOf = (pct: number | null) => {
  if (pct === null) return undefined;
  const d = (pct - 50) / 50;
  const mix = Math.round(Math.min(1, Math.abs(d)) * 50);
  const c = `color-mix(in srgb, var(${d >= 0 ? "--win" : "--loss"}) ${mix}%, transparent)`;
  return { backgroundImage: `linear-gradient(${c}, ${c})` };
};

function CrosstableCard({
  cross,
  tones,
  forecast,
  onPick,
}: {
  cross: Crosstable;
  tones: Tones;
  forecast: (a: string, b: string) => number | null;
  onPick: (a: string, b: string) => void;
}) {
  const [mode, setMode] = useState<"results" | "forecast">("results");
  const ms = cross.members;
  return (
    <section class="card tile span-7 lg-cross">
      <div class="tile-head">
        <h3>{t("Kreuztabelle")}</h3>
        <div class="segmented small-seg" role="tablist">
          <button class={mode === "results" ? "active" : ""} onClick={() => setMode("results")}>
            
            {t("Ergebnisse")}
          </button>
          <button class={mode === "forecast" ? "active" : ""} onClick={() => setMode("forecast")}>
            
            {t("Prognose")}
          </button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="lg-cross-table">
          <thead>
            <tr>
              <th />
              {ms.map((m) => (
                <th key={m.id} title={m.name}>
                  <Avatar name={m.name} tone={tones[m.id]} size="sm" />
                </th>
              ))}
              <th class="num">{mode === "results" ? t("Gesamt") : ""}</th>
            </tr>
          </thead>
          <tbody>
            {ms.map((row, i) => (
              <tr key={row.id} class={row.is_me ? "me" : ""}>
                <th scope="row">
                  <Who name={row.name} tone={tones[row.id]} />
                </th>
                {ms.map((col, j) => {
                  if (i === j) return <td key={col.id} class="diag" />;
                  if (mode === "forecast") {
                    const p = forecast(row.id, col.id);
                    return (
                      <td key={col.id}>
                        <button class="lg-cell" style={heatOf(p === null ? null : p * 100)} onClick={() => onPick(row.id, col.id)} title={t("{name} gegen {name2}: erwartet {pct0} der Punkte", { name: row.name, name2: col.name, pct0: pct0(p === null ? null : p * 100) })}>
                          {p === null ? "·" : Math.round(p * 100)}
                        </button>
                      </td>
                    );
                  }
                  const c = cross.cells[i][j] as CrossCell;
                  if (!c.games) {
                    return (
                      <td key={col.id}>
                        <button class="lg-cell empty" onClick={() => onPick(row.id, col.id)} title={t("{name} und {name2} haben noch nicht gegeneinander gespielt", { name: row.name, name2: col.name })}>
                          ·
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={col.id}>
                      <button
                        class="lg-cell"
                        style={heatOf(c.score_pct)}
                        onClick={() => onPick(row.id, col.id)}
                        title={t("{name} gegen {name2}: {wins} Siege, {draws} Remis, {losses} Niederlagen", { name: row.name, name2: col.name, wins: c.wins, draws: c.draws, losses: c.losses })}
                      >
                        <strong class="tnum">{half(c.points)}</strong>
                        <small class="tnum">/{c.games}</small>
                      </button>
                    </td>
                  );
                })}
                <td class="num total tnum">
                  {mode === "results" && cross.totals[i].games ? (
                    <>
                      <strong>{half(cross.totals[i].points)}</strong>
                      <span class="faint">/{cross.totals[i].games}</span>
                    </>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Foot>
        {mode === "results"
          ? t("Punkte der Zeile gegen die Spalte aus {plural}. Tippe auf ein Feld: dann battlen die beiden unten.", { plural: plural(cross.total_games, t("direkten Partie"), t("direkten Partien")) })
          : t("Erwartete Punkte der Zeile gegen die Spalte in Prozent, aus eurem Spiel ohne Wertung und den direkten Partien.")}
      </Foot>
    </section>
  );
}

function HighlightsCard({ cross, tones }: { cross: Crosstable; tones: Tones }) {
  const list = crossHighlights(cross);
  const vsName = (p: { name: string; is_me: boolean }) => (p.is_me ? "dich" : p.name);
  const lines = list.map((h) => {
    const c = h.cell;
    const score = t("{half} aus {games}", { half: half(c.points), games: c.games });
    switch (h.kind) {
      case "nemesis":
        return {
          key: h.kind,
          icon: <IconShield />,
          title: t("Dein Angstgegner"),
          who: h.b,
          text: t("Gegen {name} holst du nur {score} ({pct0}). {3}", { name: h.b.name, score, pct0: pct0(c.score_pct), 3: h.clear ? t("Das ist klar mehr als Pech.") : t("Das kann noch Zufall sein.") }),
        };
      case "favorite":
        return {
          key: h.kind,
          icon: <IconStar />,
          title: t("Dein Lieblingsgegner"),
          who: h.b,
          text: t("Gegen {name} holst du {score} ({pct0}). {3}", { name: h.b.name, score, pct0: pct0(c.score_pct), 3: h.clear ? t("Klar kein Zufall.") : t("Ob das so bleibt, zeigen die nächsten Partien.") }),
        };
      case "rivalry":
        return {
          key: h.kind,
          icon: <IconSwords />,
          title: t("Engste Rivalität"),
          who: h.a,
          text: t("{0} gegen {vsName}: {half} : {half2} nach {plural}.", { 0: h.a.is_me ? t("Du") : h.a.name, vsName: vsName(h.b), half: half(c.points), half2: half(c.games - c.points), plural: plural(c.games, t("Partie"), t("Partien")) }),
        };
      default:
        return {
          key: h.kind,
          icon: <IconFlame />,
          title: t("Heißeste Serie"),
          who: h.a,
          text: t("{0} die letzten {count} Partien gegen {vsName} gewonnen.", { 0: h.a.is_me ? t("Du hast") : t("{name} hat", { name: h.a.name }), count: c.streak?.count, vsName: vsName(h.b) }),
        };
    }
  });
  return (
    <section class="card tile span-5 lg-highlights">
      <div class="tile-head">
        <h3>{t("Auffällig")}</h3>
        <span class="tile-sub">{t("ab {MIN_PAIR_GAMES} Partien je Paarung", { MIN_PAIR_GAMES })}</span>
      </div>
      {lines.length ? (
        <div class="lg-hl-list">
          {lines.map((l) => (
            <div class="lg-hl" key={l.key}>
              <span class={`lg-hl-icon ${tones[l.who.id]}`}>{l.icon}</span>
              <span>
                <strong>{l.title}</strong>
                <span class="small muted">{l.text}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p class="muted small">{t("Spielt mehr direkte Partien gegeneinander, dann zeigt sich hier, wer wem liegt.")}</p>
      )}
    </section>
  );
}

const MARGIN_TEXT: Record<string, string> = { knapp: "knapp", deutlich: "deutlich", klar: "klar" };

function battleValue(key: string, v: number | null): string {
  if (v === null) return "–";
  if (key === "accuracy") return `${de(v, 1)} %`;
  return formatFactor(key, v);
}

/** Two players of the group, round by round: who wins which area, and the battle overall. */
function BattleArena({
  ranking,
  h2hOf,
  tones,
  pair,
  onPair,
}: {
  ranking: Ranking;
  h2hOf: (a: string, b: string) => HeadToHead | null;
  tones: Tones;
  pair: [string, string] | null;
  onPair: (p: [string, string]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const me = ranking.rows.find((r) => r.is_me) ?? ranking.rows[0];
  const ids = ranking.rows.map((r) => r.id);
  const a = pair && ids.includes(pair[0]) ? pair[0] : (me?.id ?? "");
  const b = pair && ids.includes(pair[1]) && pair[1] !== a ? pair[1] : (rivalOf(ranking, a)?.id ?? "");
  const battle: Battle | null = useMemo(() => buildBattle(ranking, a, b, h2hOf(a, b)), [ranking, a, b, h2hOf]);
  if (ranking.rows.length < 2 || !battle) return null;
  const label = new Map(ranking.factors.map((f) => [f.key, f.label]));
  const an = battle.a.name;
  const bn = battle.b.name;
  const power = battle.power_a;
  const pick = (value: string, side: 0 | 1, other: string, aria: string) => (
    <select class="factor-select" value={value} onChange={(e) => onPair(side === 0 ? [e.currentTarget.value, b] : [a, e.currentTarget.value])} aria-label={aria}>
      {ranking.rows
        .filter((r) => r.id !== other)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
    </select>
  );
  return (
    <section class="card tile span-12 lg-battle" id="lg-battle">
      <div class="tile-head">
        <h3>
          <IconSwords />  {t("Battle-Arena")}
        </h3>
        <span class="tile-sub">{t("8 Runden, ohne Wertung")}</span>
      </div>
      <div class="battle-pick">
        {pick(a, 0, b, t("Spieler links"))}
        <button class="btn ghost small" onClick={() => onPair([b, a])} title={t("Seiten tauschen")}>
          ⇄
        </button>
        {pick(b, 1, a, t("Spieler rechts"))}
      </div>
      <div class="lg-battle-score">
        <div class={`lg-battle-side${battle.leader === "a" ? " win" : ""}`}>
          <Avatar name={an} tone={tones[a]} size="xl" ring={battle.leader === "a"} />
          <strong>{an}</strong>
        </div>
        <div class="lg-battle-result">
          <div class="lg-battle-big tnum">
            {battle.wins_a}
            <span class="faint">:</span>
            {battle.wins_b}
          </div>
          <span class="faint small">{t("Runden{n}", { n: battle.draws ? t(" · {draws} offen", { draws: battle.draws }) : "" })}</span>
        </div>
        <div class={`lg-battle-side${battle.leader === "b" ? " win" : ""}`}>
          <Avatar name={bn} tone={tones[b]} size="xl" ring={battle.leader === "b"} />
          <strong>{bn}</strong>
        </div>
      </div>
      {power !== null && (
        <div class="lg-tug big" title={t("Gewichteter Schnitt der Wahrscheinlichkeit, in den Runden besser zu sein")}>
          <span class={`lg-tug-a ${tones[a]}`} style={{ width: `${power}%` }}>
            <span class="tnum">{Math.round(power)}</span>
          </span>
          <span class={`lg-tug-b ${tones[b]}`}>
            <span class="tnum">{Math.round(100 - power)}</span>
          </span>
        </div>
      )}
      <p class="battle-verdict">{verdictForYou(battle.verdict)}</p>
      <div class="lg-rounds">
        {battle.rounds.map((r, i) => {
          const pa = r.p_a === null ? null : r.p_a * 100;
          const isOpen = open === r.key;
          return (
            <div class={`lg-round${r.key === battle.decisive ? " decisive" : ""}${r.winner ? ` w-${r.winner}` : ""}`} key={r.key}>
              <button class="lg-round-head" onClick={() => setOpen(isOpen ? null : r.key)} aria-expanded={isOpen}>
                <span class="faint small tnum">R{i + 1}</span>
                <span class="lg-round-name">
                  {r.label}
                  <span class="faint small"> · {de(r.weight, 0)} %</span>
                </span>
                <span class={`lg-round-chip ${r.winner ?? "none"} ${r.winner === "a" ? tones[a] : r.winner === "b" ? tones[b] : ""}`}>
                  {r.winner === null ? t("keine Daten") : r.winner === "draw" ? "offen" : `${r.winner === "a" ? an : bn} ${MARGIN_TEXT[r.margin as string]}`}
                </span>
              </button>
              {pa !== null && (
                <div class="lg-tug" title={t("{an}: {1} % Wahrscheinlichkeit, hier besser zu sein", { an, 1: Math.round(pa) })}>
                  <span class={`lg-tug-a ${tones[a]}`} style={{ width: `${pa}%` }} />
                  <span class={`lg-tug-b ${tones[b]}`} />
                </div>
              )}
              {isOpen && (
                <div class="battle-detail">
                  {r.factors.map((f) => (
                    <div class="battle-factor" key={f.key}>
                      <span class="tnum">{battleValue(f.key, f.a)}</span>
                      <span class="small muted">
                        {t("{n}{n2}", { n: label.get(f.key) ?? f.key, n2: f.p_a !== null ? t(" · {0} % für {an}", { 0: Math.round(f.p_a * 100), an }) : "" })}
                      </span>
                      <span class="tnum">{battleValue(f.key, f.b)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Foot>
        
        {t("Eine Runde gewinnt, wer dort mit mindestens 65 % Wahrscheinlichkeit wirklich besser ist (ab 80 % deutlich, ab 95 % klar); darunter bleibt sie offen. Tippe auf eine Runde für die Werte.")}
      </Foot>
    </section>
  );
}

// ---------- strengths ----------

function GroupLine({ g, kind }: { g: GroupPoint; kind: "edge" | "learn" }) {
  const mine = formatFactor(g.key, g.mine);
  const other = formatFactor(g.key, g.other);
  return (
    <button class={`insight group-line ${kind === "edge" ? "pos" : "mid"}`} onClick={() => navigate({ view: "players", playerId: g.other_id })}>
      <div class="t">{g.label}</div>
      <div class="small">
        {kind === "edge" ? (
          <>
            
            {tj("Du {mine}, am nächsten dran: {other_name} {other}", { mine: <strong class="tnum">{mine}</strong>, other_name: g.other_name, other: <span class="tnum">{other}</span> })}
          </>
        ) : (
          <>
            {tj("{other_name} {other}, du {mine}. Schau dir die Partien von {other_name2} an.", { other_name: g.other_name, other: <strong class="tnum">{other}</strong>, mine: <span class="tnum">{mine}</span>, other_name2: g.other_name })}</>
        )}
      </div>
    </button>
  );
}

/** Every player's parts of the game on the shown Elo scale, marked where one stands out against the player's own level. */
function StrengthMatrix({ ranking, tones, standing }: { ranking: Ranking; tones: Tones; standing: GroupStanding | null }) {
  const table = useMemo(() => areaTable(ranking), [ranking]);
  const leaderOf = (area: Area) => table.leaders.find((l) => l.area === area);
  return (
    <section class="card tile span-12 lg-matrix">
      <div class="tile-head">
        <h3>
          <IconCrown />  {t("Stärken-Matrix")}
        </h3>
        <span class="tile-sub">{t("jeder Bereich als Elo-Spielstärke, gemessen an den eigenen Zügen")}</span>
      </div>
      <div class="table-scroll">
        <table class="lg-matrix-table">
          <thead>
            <tr>
              <th />
              <th>{t("Gesamt")}</th>
              {AREAS.map((a) => (
                <th key={a}>{AREA_LABEL[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranking.rows.map((r) => (
              <tr key={r.id} class={r.is_me ? "me" : ""}>
                <th scope="row">
                  <Who name={r.name} tone={tones[r.id]} />
                </th>
                <td>
                  <span class={`lg-heat${r.strength ? "" : " none"}`}>{r.strength ? eloLabel(r.strength.value) : "–"}</span>
                </td>
                {AREAS.map((a) => {
                  const c = table.cells[r.id]?.[a];
                  const lead = leaderOf(a);
                  const crown = lead?.id === r.id;
                  const off = c ? Math.round(c.offset / 10) * 10 : 0;
                  return (
                    <td key={a}>
                      <span
                        class={`lg-heat${c ? "" : " none"}${c?.stands_out === 1 ? " hi" : ""}${c?.stands_out === -1 ? " lo" : ""}`}
                        title={
                          c
                            ? t("{name} · {1}: Elo {eloLabel}, {3}{off} gegenüber dem eigenen Schnitt{5}{6}", { name: r.name, 1: AREA_LABEL[a], eloLabel: eloLabel(c.value), 3: off >= 0 ? "+" : "", off, 5: c.stands_out === 1 ? t(" (klare Stärke)") : c.stands_out === -1 ? t(" (klare Schwäche)") : "", 6: crown ? t(" · Bester der Gruppe (zu {winPct} gegen jeden)", { winPct: winPct(lead.p) }) : "" })
                            : t("zu wenig analysierte Partien")
                        }
                      >
                        {c ? (off === 0 ? "±0" : signed(off, 0)) : "–"}
                        {crown && <span class="lg-crown clear">♛</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="faint small" style={{ margin: "8px 0 0" }}>
        
        {t("Die Zahlen sagen, wie viele Elo ein Bereich über oder unter der eigenen Spielstärke liegt (Fehler pro Zug in dem Bereich gegen die eigenen Fehler insgesamt, vorsichtig zur Mitte gezogen). Hell: klare Stärke, gedämpft: klare Schwäche, jeweils erst bei 95 % Sicherheit. ♛: Bester der Gruppe in dem Bereich, wenn das zu 80 % gegen jeden feststeht.")}
      </p>
      {standing && standing.members >= 2 && (
        <div class="group-cols lg-standing">
          <div>
            <h4>{t("Hier bist du klar vorn")}</h4>
            {standing.edges.length ? (
              <div class="insights">
                {standing.edges.map((g) => (
                  <GroupLine key={g.key} g={g} kind="edge" />
                ))}
              </div>
            ) : (
              <p class="muted small">{t("Noch kein Bereich, in dem du sicher besser als alle bist.")}</p>
            )}
          </div>
          <div>
            <h4>{t("Hier kannst du dir etwas abschauen")}</h4>
            {standing.learn.length ? (
              <div class="insights">
                {standing.learn.map((g) => (
                  <GroupLine key={g.key} g={g} kind="learn" />
                ))}
              </div>
            ) : (
              <p class="muted small">{t("Kein Freund ist dir irgendwo sicher voraus.")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function QualityMapCard({ map, tones }: { map: QualityMap | null; tones: Tones }) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  if (!map) {
    return (
      <section class="card tile span-7">
        <div class="tile-head">
          <h3>{t("Zugqualität gegen Ergebnis")}</h3>
        </div>
        <p class="muted small">{t("Sobald Spieler genug analysierte Partien haben, zeigt diese Karte, wer mehr (oder weniger) Punkte holt, als die eigenen Züge wert sind.")}</p>
      </section>
    );
  }
  const h = clamp(Math.round(w * 0.66), 250, 360);
  const pad = { l: 46, r: 14, t: 14, b: 34 };
  // Both axes on the same Elo scale, so the diagonal means "scores what the moves are worth".
  const vals = map.points.flatMap((p) => [eloOf(p.x - p.x_se), eloOf(p.x + p.x_se), eloOf(p.y - p.y_se), eloOf(p.y + p.y_se)]);
  const span = Math.max(60, Math.max(...vals) - Math.min(...vals));
  const v0 = Math.min(...vals) - span * 0.1;
  const v1 = Math.max(...vals) + span * 0.1;
  const sx = (v: number) => pad.l + ((v - v0) / (v1 - v0)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v - v0) / (v1 - v0)) * (h - pad.t - pad.b);
  const step = Math.max(10, Math.round((v1 - v0) / 4 / 10) * 10);
  const ticks: number[] = [];
  for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) ticks.push(v);
  return (
    <section class="card tile span-7 lg-map">
      <div class="tile-head">
        <h3>{t("Zugqualität gegen Ergebnis")}</h3>
        <span class="tile-sub">{t("Spielstärke aus den Zügen (→) gegen Spielstärke aus den Ergebnissen (↑)")}</span>
      </div>
      <div ref={ref} class="lg-map-plot">
        <svg width={w} height={h} role="img" aria-label={t("Streudiagramm: Spielstärke aus Zügen gegen Spielstärke aus Ergebnissen")}>
          {ticks.map((v) => (
            <g key={`t${v}`}>
              <line class="grid" x1={sx(v)} x2={sx(v)} y1={pad.t} y2={h - pad.b} />
              <text class="axis" x={sx(v)} y={h - pad.b + 16} text-anchor="middle">
                {v}
              </text>
              <line class="grid" x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} />
              <text class="axis" x={pad.l - 6} y={sy(v) + 4} text-anchor="end">
                {v}
              </text>
            </g>
          ))}
          <line class="mean" x1={sx(v0)} y1={sy(v0)} x2={sx(v1)} y2={sy(v1)} />
          <text class="corner" x={pad.l + 6} y={pad.t + 14}>
            
            {t("Holt mehr, als die Züge wert sind")}
          </text>
          <text class="corner" x={w - pad.r - 6} y={h - pad.b - 8} text-anchor="end">
            
            {t("Lässt Punkte liegen")}
          </text>
          {map.points.map((p) => {
            const x = eloOf(p.x);
            const y = eloOf(p.y);
            return (
              <g key={p.id} class={`pt ${tones[p.id]}${p.is_me ? " me" : ""}`}>
                <line class="err" x1={sx(eloOf(p.x - p.x_se))} x2={sx(eloOf(p.x + p.x_se))} y1={sy(y)} y2={sy(y)} />
                <line class="err" x1={sx(x)} x2={sx(x)} y1={sy(eloOf(p.y - p.y_se))} y2={sy(eloOf(p.y + p.y_se))} />
                <circle cx={sx(x)} cy={sy(y)} r={13} />
                <text class="ini" x={sx(x)} y={sy(y) + 4} text-anchor="middle">
                  {p.name.slice(0, 1).toUpperCase()}
                </text>
                <text class="name" x={sx(x) + (sx(x) > w - 90 ? -18 : 18)} y={sy(y) + 4} text-anchor={sx(x) > w - 90 ? "end" : "start"}>
                  {p.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {map.findings.length > 0 && (
        <div class="insights" style={{ marginTop: "8px" }}>
          {map.findings.map((f) => (
            <div class={`insight ${f.kind === "fighter" ? "pos" : "mid"}`} key={f.id}>
              <div class="small">{f.text}</div>
            </div>
          ))}
        </div>
      )}
      <Foot>
        
        {t("Auf der Diagonale holt jemand genau die Punkte, die die Züge wert sind. Striche: ±1 Standardfehler. Ein Satz darunter erst, wenn der Abstand zur Diagonale zu 95 % kein Zufall ist; jeder wird dabei nur mit sich selbst verglichen.{n}", { n: map.missing.length ? t(" Ohne beide Werte: {missing}.", { missing: map.missing.join(", ") }) : "" })}
      </Foot>
    </section>
  );
}

function TypesCard({ ranking, types, tones }: { ranking: Ranking; types: Record<string, Archetype>; tones: Tones }) {
  return (
    <section class="card tile span-5 lg-types">
      <div class="tile-head">
        <h3>{t("Spielertypen")}</h3>
        <span class="tile-sub">{t("was jeden im eigenen Spiel auszeichnet")}</span>
      </div>
      <div class="lg-type-list">
        {ranking.rows.map((r) => {
          const tk = types[r.id];
          if (!tk) return null;
          return (
            <div class="lg-type" key={r.id}>
              <Avatar name={r.name} tone={tones[r.id]} />
              <span>
                <strong>{tk.title}</strong>
                <span class="faint small">
                  {t("{name}{n}{n2}{n3}", { name: r.name, n: tk.area && tk.offset !== null ? t(" · {0} {signed} Elo über dem eigenen Schnitt", { 0: AREA_LABEL[tk.area], signed: signed(Math.round(tk.offset / 10) * 10, 0) }) : "", n2: tk.weak ? t(" · Baustelle: {weak}", { weak: tk.weak }) : "", n3: tk.practice === "fighter" ? t(" · holt mehr, als die Züge wert sind") : tk.practice === "unlucky" ? t(" · lässt Punkte liegen") : "" })}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <Foot>
        
        {t("Ein Titel gibt es nur für einen Bereich, der zu 95 % über dem eigenen Niveau liegt; zwei Freunde können denselben Titel tragen. „Allrounder“: mindestens vier Bereiche genau gemessen und keiner fällt heraus. „Noch offen“: zu wenig analysierte Partien.")}
      </Foot>
    </section>
  );
}

// ---------- form ----------

const SHORT_DATE = (tk: number) => new Date(tk * 1000).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });

/** Spans the form curve offers, in weeks. */
const FORM_SPANS: [string, number][] = [
  ["8 W", 8],
  ["12 W", 12],
  ["6 M", 26],
  ["1 J", 52],
];

function FormRace({ rows, tones, span, onSpan, dataWeeks }: { rows: MomentumRow[]; tones: Tones; span: number; onSpan: (weeks: number) => void; dataWeeks: number }) {
  const [focus, setFocus] = useState<string | null>(null);
  // Spans the history can fill, plus the first one that covers all of it.
  const cover = FORM_SPANS.find(([, w]) => w >= dataWeeks)?.[1] ?? FORM_SPANS[FORM_SPANS.length - 1][1];
  const spans = FORM_SPANS.filter(([, w]) => w <= cover || w === span);
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const vals = rows.flatMap((r) => r.weeks.map((wk) => wk.smooth)).filter((v): v is number => v !== null);
  const weeks = rows[0]?.weeks ?? [];
  const h = clamp(Math.round(w * 0.55), 220, 340);
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const lo = vals.length ? Math.floor(Math.min(...vals) - 1) : 70;
  const hi = vals.length ? Math.ceil(Math.max(...vals) + 1) : 90;
  const n = Math.max(1, weeks.length - 1);
  const sx = (i: number) => pad.l + (i / n) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (h - pad.t - pad.b);
  const path = (r: MomentumRow) => {
    let d = "";
    let pen = false;
    r.weeks.forEach((wk, i) => {
      if (wk.smooth === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${sx(i).toFixed(1)},${sy(wk.smooth).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  // About five date labels, the newest always, none crowding it.
  const labelStep = Math.max(1, Math.ceil(weeks.length / 5));
  const step = Math.max(1, Math.round((hi - lo) / 4));
  const yt: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yt.push(v);
  return (
    <section class="card tile span-7 lg-race">
      <div class="tile-head">
        <h3>{t("Formkurve")}</h3>
        <span class="tile-sub">{t("Genauigkeit pro Woche, fair nach Bedenkzeit")}</span>
      </div>
      <div class="segmented small-seg chart-range" role="group" aria-label={t("Zeitraum der Formkurve")}>
        {spans.map(([l, w]) => (
          <button key={l} class={span === w ? "active" : ""} onClick={() => onSpan(w)}>
            {l}
          </button>
        ))}
      </div>
      {vals.length ? (
        <>
          <div ref={ref} class="lg-race-plot">
            <svg width={w} height={h} role="img" aria-label={t("Genauigkeit pro Woche je Spieler")}>
              {yt.map((v) => (
                <g key={v}>
                  <line class="grid" x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} />
                  <text class="axis" x={pad.l - 6} y={sy(v) + 4} text-anchor="end">
                    {v}
                  </text>
                </g>
              ))}
              {weeks.map((wk, i) =>
                (i % labelStep === 0 && weeks.length - 1 - i >= labelStep / 2) || i === weeks.length - 1 ? (
                  <text key={wk.start} class="axis" x={sx(i)} y={h - 8} text-anchor="middle">
                    {SHORT_DATE(wk.start)}
                  </text>
                ) : null,
              )}
              {rows.map((r) => (
                <g key={r.id} class={`ln ${tones[r.id]}${focus && focus !== r.id ? " dim" : ""}${r.is_me ? " me" : ""}`}>
                  <path d={path(r)} />
                  {r.weeks.map((wk, i) =>
                    wk.smooth !== null && wk.accuracy !== null ? (
                      <circle key={i} cx={sx(i)} cy={sy(wk.smooth)} r={2.6}>
                        <title>{t("{name}, Woche ab {SHORT_DATE}: {de} % (Schnitt über drei Wochen), {plural} in der Woche", { name: r.name, SHORT_DATE: SHORT_DATE(wk.start), de: de(wk.smooth, 1), plural: plural(wk.games, t("Partie"), t("Partien")) })}</title>
                      </circle>
                    ) : null,
                  )}
                </g>
              ))}
            </svg>
          </div>
          <div class="lg-race-legend">
            {rows.map((r) => (
              <button key={r.id} class={`chip${focus === r.id ? " on" : ""}`} onClick={() => setFocus(focus === r.id ? null : r.id)}>
                <span class={`lg-key ${tones[r.id]}`} /> {r.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p class="muted small">{t("In diesem Zeitraum gibt es noch zu wenige analysierte Partien für eine Formkurve.")}</p>
      )}
      <Foot>{t("Gleitender Schnitt über drei Wochen. Tippe auf einen Namen, um ihn hervorzuheben.")}</Foot>
    </section>
  );
}

const RESULT_CHAR: Record<string, string> = { win: "S", draw: "R", loss: "N" };

function FormTable({ rows, tones, ratings }: { rows: MomentumRow[]; tones: Tones; ratings: FormRow[] }) {
  // Players with a real comparison first; an open trend says nothing about form.
  const order = [...rows].sort((a, b) => Number(a.trend === null) - Number(b.trend === null) || (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  return (
    <section class="card tile span-5 lg-formtable">
      <div class="tile-head">
        <h3>{t("Wer ist in Form?")}</h3>
        <span class="tile-sub">{t("letzte 30 Tage gegen davor")}</span>
      </div>
      <div class="lg-form-rows">
        {order.map((r) => {
          const rating = ratings.find((x) => x.id === r.id);
          return (
            <div class={`lg-form-row${r.is_me ? " me" : ""}`} key={r.id}>
              <Who name={r.name} tone={tones[r.id]} />
              <span class="lg-last" aria-label={t("Letzte Ergebnisse: {0}", { 0: r.last.map((o) => RESULT_CHAR[o]).join(" ") })}>
                {r.last.map((o, i) => (
                  <span key={i} class={`lg-res ${o}`}>
                    {RESULT_CHAR[o]}
                  </span>
                ))}
              </span>
              <span class={`lg-trend ${r.trend ?? "none"}`}>
                {r.trend === "up" ? `↑ ${signed(r.delta as number)}` : r.trend === "down" ? `↓ ${signed(r.delta as number)}` : r.trend === "flat" ? "stabil" : "offen"}
              </span>
              <span class="faint small lg-form-sub">
                {t("{n}{n2}", { n: r.streak && r.streak.count >= 3
                  ? t("{count} {1} in Folge", { count: r.streak.count, 1: r.streak.kind === "win" ? t("Siege") : r.streak.kind === "loss" ? t("Niederlagen") : t("Remis") })
                  : t("{n} zuletzt", { n: (r.recent.games === 1 ? t("1 Analyse") : t("{n} Analysen", { n: r.recent.games })) }), n2: rating ? t(" · Wertung {signed} ({1})", { signed: signed(rating.delta, 0), 1: SPEED_DE[rating.speed] ?? rating.speed }) : "" })}
              </span>
            </div>
          );
        })}
      </div>
      <Foot>
        
        {t("↑ und ↓ nur, wenn der Unterschied in der fairen Genauigkeit mit 95 % kein Zufall ist (je mindestens 10 analysierte Partien); sonst „stabil“, mit weniger Partien „offen“. Wertung: letzte {FORM_DAYS} Tage.", { FORM_DAYS })}
      </Foot>
    </section>
  );
}

// ---------- records ----------

const RECORD_ICON: Record<string, () => preact.JSX.Element> = {
  peak: IconBolt,
  best_game: IconStar,
  streak: IconFlame,
  comeback: IconRise,
  mate: IconSwords,
  upset: IconCrown,
  clean: IconShield,
  duel: IconSpark,
};

/** Columns that fill every row about evenly: 7 records as 4 + 3, not 5 + 2. */
const fameColumns = (n: number) => (n <= 5 ? Math.max(1, n) : Math.ceil(n / Math.ceil(n / 5)));

function HallOfFame({ records, tones }: { records: GroupRecord[]; tones: Tones }) {
  const set = records.filter((r) => r.holder);
  const open = records.filter((r) => !r.holder);
  return (
    <section class="card tile span-12 lg-fame">
      <div class="tile-head">
        <h3>
          <IconTrophy />  {t("Ruhmeshalle")}
        </h3>
        <span class="tile-sub">{t("nur was wirklich selten ist · bei Gleichstand zählt, wer zuerst da war")}</span>
      </div>
      {set.length ? (
        <div class="lg-fame-grid" style={{ "--cols": fameColumns(set.length) } as Record<string, number>}>
          {set.map((r) => {
            const Icon = RECORD_ICON[r.key] ?? IconTrophy;
            const holder = r.holder as NonNullable<GroupRecord["holder"]>;
            const body = (
              <>
                <span class="lg-fame-top">
                  <span class={`lg-fame-icon k-${r.key}`}>
                    <Icon />
                  </span>
                  <span class="lg-fame-title">{r.title}</span>
                </span>
                <strong class="lg-fame-value">{r.text}</strong>
                <span class="lg-fame-who">
                  <Avatar name={holder.name} tone={tones[holder.id]} size="sm" />
                  <strong>{holder.name}</strong>
                </span>
                <span class="faint small">{r.detail}</span>
                <span class="faint small">
                  {r.runner_up ? `${r.tied ? t("Eingestellt") : t("Dahinter")}: ${r.runner_up.name}, ${r.runner_up.text}` : t("Bisher der Einzige über der Hürde")}
                </span>
              </>
            );
            return r.game_id ? (
              <button key={r.key} class={`lg-fame-card${holder.is_me ? " me" : ""}`} onClick={() => navigate({ view: "analysis", gameId: r.game_id as string })} title={t("Partie öffnen")}>
                {body}
              </button>
            ) : (
              <div key={r.key} class={`lg-fame-card${holder.is_me ? " me" : ""}`}>
                {body}
              </div>
            );
          })}
        </div>
      ) : (
        <p class="muted small">{t("Noch hat niemand eine der Hürden geschafft. Rekorde gibt es hier nur für Seltenes, nicht für Alltägliches.")}</p>
      )}
      {open.length > 0 && (
        <p class="faint small" style={{ margin: "10px 0 0" }}>
          
          {t("Noch offen: {n}.", { n: open.map((r) => `${r.title} (${r.bar})`).join(" · ") })}</p>
      )}
    </section>
  );
}

// ---------- explanation ----------

/** How the strength is made, in plain words, with the numbers behind it. */
function ScoringCard({ ranking }: { ranking: Ranking }) {
  return (
    <details class="card tile span-12 rank-explain">
      <summary>
        <span>
          <strong>{t("So funktioniert das Ranking")}</strong>
          <span class="faint small">  {t("· eine Spielstärke pro Spieler, mit ehrlicher Unsicherheit")}</span>
        </span>
        <span class="rank-explain-chev" aria-hidden="true" />
      </summary>
      <p class="small muted">
        
        {t("Jeder bekommt eine Elo-Zahl, nur aus den eigenen Partien im Zeitraum. Sie liegt auf der {ELO_SCALE_LABEL}: Wer dort Rapid spielt, kann sie direkt mit der eigenen Wertung vergleichen, Lichess-Wertungen werden umgerechnet. Anders als bei FIDE gibt es keine Untergrenze bei 1400, auch Einsteiger bekommen ihren eigenen Wert. Niemand wird an der Gruppe gemessen: kommt ein Freund dazu oder wird ausgeblendet, bleibt die Reihenfolge der anderen gleich.", { ELO_SCALE_LABEL })}
      </p>
      <div class="scoring">
        <div class="scoring-group">
          <div class="scoring-head">
            <span class="dot g-res" />
            <strong>{t("Ergebnisse")}</strong>
          </div>
          <div class="scoring-row">
            <span>{t("Leistung gegen die Gegner")}</span>
            <span class="faint small">
              
              {t("Die Elo, bei der deine Punkte genau der Erwartung gegen deine tatsächlichen Gegner entsprechen. Lichess- und Chess.com-Wertungen in jeder Bedenkzeit werden vorher auf eine Skala umgerechnet (ChessGoals-Umfrage).")}
            </span>
          </div>
          <div class="scoring-row">
            <span>{t("Direktvergleich")}</span>
            <span class="faint small">
              
              {t("Eine Partie gegen einen Freund zählt genau wie jede andere gewertete Partie, also einmal. Als Extra für ein Duell (Prognose, Turnier) geht er gedämpft ein: 10 direkte Partien verschieben die Prognose um etwa ein Sechstel ihrer Überraschung, 50 um die Hälfte.")}
            </span>
          </div>
        </div>
        <div class="scoring-group">
          <div class="scoring-head">
            <span class="dot g-qual" />
            <strong>{t("Zugqualität")}</strong>
          </div>
          <div class="scoring-row">
            <span>{t("Fehler im Vergleich zum Gegner")}</span>
            <span class="faint small">
              
              {t("Verschenkte Gewinnchance pro Zug, geteilt durch die des Gegners in derselben Partie: gleiche Engine, gleiche Tiefe, gleiche Bedenkzeit, deshalb fair. Doppelt so viele Fehler wie ein Gegner entsprechen etwa 590 Punkten weniger auf der Lichess-Skala.")}
            </span>
          </div>
          <div class="scoring-row">
            <span>{t("Gewicht")}</span>
            <span class="faint small">
              
              {t("Beide Teile werden nach ihrer Genauigkeit gemischt. Zugqualität sieht nicht alles (Zeit, Nerven, praktische Chancen), deshalb zählt sie bei vielen Partien weniger als die Ergebnisse, bei wenigen hilft sie stark.")}
            </span>
          </div>
        </div>
        <div class="scoring-group">
          <div class="scoring-head">
            <span class="dot g-misc" />
            <strong>{t("Was nicht zählt")}</strong>
          </div>
          <div class="scoring-row">
            <span>{t("Bots, eigene Wertung")}</span>
            <span class="faint small">
              
              {t("Partien gegen Computer (Lichess-KI, BOT-Konten, Engines) bleiben draußen. Die eigene Wertung zählt nicht, nur die der Gegner: neue Konten liegen oft Hunderte Punkte daneben.")}
            </span>
          </div>
          <div class="scoring-row">
            <span>{t("Zu wenig Daten")}</span>
            <span class="faint small">{t("Eine Spielstärke gibt es ab {MIN_RATED_GAMES} gewerteten Partien gegen Menschen. Darunter steht „–“, statt eine Zahl zu erfinden.", { MIN_RATED_GAMES })}</span>
          </div>
        </div>
      </div>
      <p class="faint small" style={{ margin: "8px 0 0" }}>
        
        {t("Jede Zahl hat eine 95-%-Spanne. „Platz 1–3 möglich“ heißt: in 90 % der Reihenfolgen, die zu den Daten passen, landet der Spieler auf Platz 1 bis 3. Turnier, Überhol-Rechner und Prognosen rechnen mit genau diesen Werten und Unsicherheiten; dieselbe Gruppe bekommt immer dieselben Zahlen.")}
      </p>
      {ranking.notes.map((n) => (
        <p class="faint small" key={n} style={{ margin: "6px 0 0" }}>
          {n}
        </p>
      ))}
    </details>
  );
}

// ---------- page ----------

export function LeaguePage({ players, games, me }: { players: TrackedPlayer[]; games: StoredGame[]; me: string[] }) {
  const [format, setFormat] = useState("All Formats");
  // null = the league's default period (90 days, widened when too few games are analysed).
  const [pickedDate, setDate] = useState<string | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sim, setSim] = useState<Sim>({});
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [foeId, setFoeId] = useState<string | null>(null);
  const allFriends = players.filter((p) => p.friend);
  const friends = rankedFriends(players);
  const { excludeBullet, ready } = useBulletPrefs();
  const narrow = useNarrow();
  // Games against computers never count in the league (their ratings are no human yardstick).
  const human = useMemo(() => withoutBots(games), [games]);
  const fmt = statsFormat(format, excludeBullet);
  // Profiles per player and filter, so hiding or showing a friend only re-ranks
  // and needs no new profile from the worker. Cleared when the games change.
  const cache = useRef<{ games: StoredGame[]; map: Map<string, Promise<PlayerProfile>> }>({ games, map: new Map() });
  const groupKey = friends.map((p) => `${p.id}=${playerUsernames(p).join(",")}=${p.name}`).join("|");
  const group = useMemo(
    () => [
      ...(me.length ? [{ id: "ich", name: t("Du"), is_me: true, usernames: me }] : []),
      ...friends.map((p) => ({ id: p.id, name: p.name, is_me: false, usernames: playerUsernames(p) })),
    ],
    [groupKey, me],
  );
  const date = useMemo(() => pickedDate ?? comparisonPeriod(games, group.map((g) => g.usernames), fmt, PAGE_PERIODS.league), [pickedDate, games, group, fmt]);
  const tones = useMemo(() => Object.fromEntries([["ich", "tone-me"], ...allFriends.map((p) => [p.id, toneOf(players, p.id)])]) as Tones, [players]);

  useEffect(() => {
    if (!friends.length || !ready) return;
    let alive = true;
    setLoading(true);
    if (cache.current.games !== games) cache.current = { games, map: new Map() };
    const map = cache.current.map;
    const profileOf = (names: string[]) => {
      const key = `${names.join(",")}|${fmt}|${date}`;
      let p = map.get(key);
      if (!p) {
        p = profileFor(human, names, fmt, date);
        p.catch(() => map.delete(key));
        map.set(key, p);
      }
      return p;
    };
    Promise.all(group.map((g) => profileOf(g.usernames)))
      .then((profiles) => {
        if (!alive) return;
        setRanking(buildRanking(group.map((g, i) => ({ ...g, profile: profiles[i] })), games, { format: fmt, date }));
        setError("");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [groupKey, games, me, fmt, date, ready]);

  // A new ranking (other filter, new games) starts the simulator afresh.
  useEffect(() => setSim({}), [ranking]);

  const cross = useMemo(() => buildCrosstable(group, human, fmt, date), [group, human, fmt, date]);
  const h2hOf = useMemo(() => {
    const index = new Map(cross.members.map((m, i) => [m.id, i]));
    return (a: string, b: string): HeadToHead | null => {
      const i = index.get(a);
      const j = index.get(b);
      const c = i === undefined || j === undefined ? null : cross.cells[i][j];
      return c && c.games ? { games: c.games, wins: c.wins, draws: c.draws, losses: c.losses, score_pct: c.score_pct, recent: [] } : null;
    };
  }, [cross]);
  const view = useMemo(() => {
    if (!ranking) return null;
    const mine = ranking.rows.find((r) => r.is_me) ?? null;
    return {
      tournament: simulateTournament(ranking, h2hOf),
      types: archetypes(ranking),
      plan: mine ? climbPlan(ranking, mine.id) : null,
      qmap: qualityMap(ranking),
      standing: groupStanding(ranking),
    };
  }, [ranking, h2hOf]);
  const [formSpan, setFormSpan] = useState(MOMENTUM_WEEKS);
  // Weeks back to the group's oldest game, so the curve offers no empty spans.
  const dataWeeks = useMemo(() => {
    let oldest = Infinity;
    for (const g of group) for (const [game] of filterGames(human, g.usernames)) oldest = Math.min(oldest, parsePlayedAt(game) ?? Infinity);
    return Number.isFinite(oldest) ? Math.ceil((Date.now() / 1000 - oldest) / (7 * 86400)) : 0;
  }, [group, human]);
  const momentum = useMemo(() => (ranking ? groupMomentum(group, human, { format: fmt, date, effects: ranking.speed_effects }) : []), [ranking, group, human, fmt, date]);
  // The curve's own span; the trend table keeps its fixed 30-day windows.
  const curve = useMemo(
    () => (ranking ? (formSpan === MOMENTUM_WEEKS ? momentum : groupMomentum(group, human, { format: fmt, date, effects: ranking.speed_effects, weeks: formSpan })) : []),
    [ranking, momentum, formSpan, group, human, fmt, date],
  );
  const records = useMemo(() => groupRecords(group, games, fmt, date), [group, games, fmt, date]);
  const ratingForm = useMemo(() => groupForm(group, human), [group, human]);
  const forecast = useMemo(() => (ranking ? (a: string, b: string) => (ranking.rows.some((r) => r.id === a) && ranking.rows.some((r) => r.id === b) ? (pairForecast(ranking, a, b, h2hOf(a, b))?.p ?? null) : null) : () => null), [ranking, h2hOf]);

  if (!allFriends.length) {
    return (
      <div class="empty">
        <CoachAvatar size={88} mood="think" />
        <h3>{t("Noch keine Freunde in der Liga")}</h3>
        <p>{t("Füge Freunde hinzu (Haken „In die Freundes-Rangliste aufnehmen“), dann schätzt die App eure Spielstärke aus euren eigenen Partien (Ergebnisse gegen die Gegner und Zugqualität), simuliert euer Turnier und ihr könnt gegeneinander battlen.")}</p>
        <button class="btn primary" onClick={() => navigate({ view: "players" })}>
          
          {t("Zu den Spielern")}
        </button>
      </div>
    );
  }

  const toolbar = (
    <>
      <div class="rank-toolbar">
        <PlayerFilters format={format} date={date} onFormat={setFormat} onDate={setDate} />
        <RefreshAll players={friends} label={t("Freunde aktualisieren")} />
        <AnalyzeFriends players={friends} games={games} short />
      </div>
      <RankingMembers friends={allFriends} tones={tones} />
    </>
  );

  return (
    <div class="league" style={{ opacity: loading && !ranking ? 0.6 : 1 }}>
      {narrow ? (
        // Phones: filters, refresh and the member chips fold into one line above the league.
        <details class="filter-fold league-fold">
          <summary>
            <IconFilter />
            <span class="filter-fold-text">
              {t("{n} · {n2} Spieler", { n: [format !== "All Formats" || excludeBullet ? formatOptionLabel(format, excludeBullet) : t("Alle Partien"), trFilter(date)].join(" · "), n2: friends.length + 1 })}
            </span>
            <span class="filter-fold-hint">{t("Anpassen")}</span>
            <IconChevron />
          </summary>
          {toolbar}
        </details>
      ) : (
        toolbar
      )}
      {error && <p class="error">{error}</p>}
      {!friends.length ? (
        <div class="empty">
          <CoachAvatar size={72} mood="think" />
          <h3>{t("Alle Freunde sind ausgeblendet")}</h3>
          <p>{t("Tippe oben auf einen Namen, um die Person wieder in die Rangliste aufzunehmen.")}</p>
        </div>
      ) : !ranking || !view ? (
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "260px" }} />
          <div class="skeleton span-7" style={{ height: "320px" }} />
          <div class="skeleton span-5" style={{ height: "320px" }} />
        </div>
      ) : (
        <>
          <LeagueExplainer />
          <DuelHub
            ranking={ranking}
            tones={tones}
            h2hOf={h2hOf}
            foeId={foeId}
            onFoe={setFoeId}
            onBattle={(mine, foe) => {
              setPair([mine, foe]);
              scrollToId("lg-battle");
            }}
          />
          <SectionJump sections={LEAGUE_SECTIONS} />
          <div class={`dash${loading ? " busy" : ""}`}>
            <Section section={LEAGUE_SECTIONS[0]} defaultOpen>
              <CrosstableCard
                cross={cross}
                tones={tones}
                forecast={forecast}
                onPick={(a, b) => {
                  setPair([a, b]);
                  scrollToId("lg-battle");
                }}
              />
              <HighlightsCard cross={cross} tones={tones} />
              <BattleArena ranking={ranking} h2hOf={h2hOf} tones={tones} pair={pair} onPair={setPair} />
            </Section>

            <Section section={LEAGUE_SECTIONS[1]} defaultOpen>
              {/* The table is what a phone visit is for, so it comes first there. */}
              {narrow && <Standings ranking={ranking} tones={tones} types={view.types} />}
              <LeagueHero ranking={ranking} tones={tones} tournament={view.tournament} sim={sim} onSim={setSim} />
              {!narrow && <Standings ranking={ranking} tones={tones} types={view.types} />}
              <TournamentCard t={view.tournament} tones={tones} />
              <ClimbCard
                plan={view.plan}
                onTry={(changes) => {
                  setSim(changes);
                  scrollToId("lg-hero");
                }}
              />
            </Section>

            <Section section={LEAGUE_SECTIONS[2]}>
              <StrengthMatrix ranking={ranking} tones={tones} standing={view.standing} />
              <QualityMapCard map={view.qmap} tones={tones} />
              <TypesCard ranking={ranking} types={view.types} tones={tones} />
            </Section>

            <Section section={LEAGUE_SECTIONS[3]}>
              <FormRace rows={curve} tones={tones} span={formSpan} onSpan={setFormSpan} dataWeeks={dataWeeks} />
              <FormTable rows={momentum} tones={tones} ratings={ratingForm} />
            </Section>

            <Section section={LEAGUE_SECTIONS[4]}>
              <HallOfFame records={records} tones={tones} />
              <ScoringCard ranking={ranking} />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
