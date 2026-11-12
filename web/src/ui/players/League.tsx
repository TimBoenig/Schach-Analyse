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
import {
  type Archetype,
  BATTLE_ROUNDS,
  type Battle,
  buildBattle,
  buildCrosstable,
  buildRanking,
  climbPlan,
  type ClimbPlan,
  type CrossCell,
  crossHighlights,
  type Crosstable,
  crowns,
  archetypes,
  FORM_DAYS,
  type FormRow,
  type GroupPoint,
  groupForm,
  groupMomentum,
  MOMENTUM_WEEKS,
  groupRecords,
  type GroupRecord,
  type GroupStanding,
  groupStanding,
  LARGE_EFFORT,
  type HeadToHead,
  type Lever,
  MIN_PAIR_GAMES,
  type MomentumRow,
  pairForecast,
  playerUsernames,
  qualityMap,
  type QualityMap,
  rankedFriends,
  type Ranking,
  type RankRow,
  ranksOf,
  rescore,
  rivalOf,
  simulateTournament,
  SMALL_EFFORT,
  type Tournament,
  type TrackedPlayer,
} from "../../domain/players";
import { filterGames, parsePlayedAt } from "../../domain/metrics";
import type { PlayerProfile } from "../../domain/profile";
import type { StoredGame } from "../../domain/types";
import { useWidth } from "../charts";
import { ScaleTrack, type TrackMarker, useEntrance, WhatIfSlider } from "../kit";
import { CoachAvatar } from "../Coach";
import { IconBolt, IconCrown, IconEye, IconEyeOff, IconFlame, IconReset, IconRise, IconShield, IconSpark, IconStar, IconSwords, IconTrophy } from "../icons";
import { SPEED_DE } from "../labels";
import { navigate, toHash } from "../router";
import { SectionHead, SectionNav, type StatSection } from "../StatsLayout";
import { useBulletPrefs } from "../useAnalysisPrefs";
import { AnalyzeFriends, Avatar, de, formatFactor, half, pct0, PlayerFilters, plural, profileFor, RefreshAll, signed, toneOf, Who } from "./common";

export const LEAGUE_SECTIONS: StatSection[] = [
  { id: "liga", title: "Liga", sub: "Stand, Turnierchancen und dein Weg nach oben", cards: ["Liga-Spur", "Was wäre wenn", "Tabelle", "Turnier", "Überholen"] },
  { id: "duelle", title: "Duelle", sub: "jeder gegen jeden", cards: ["Kreuztabelle", "Auffällig", "Battle-Arena"] },
  { id: "staerken", title: "Stärken", sub: "wer wo vorn liegt und wer mehr aus dem eigenen Spiel macht", cards: ["Stärken-Matrix", "Spielqualität gegen Ergebnis", "Spielertypen"] },
  { id: "form", title: "Form", sub: "wer gerade besser spielt", cards: ["Formkurve", "Formtabelle"] },
  { id: "rekorde", title: "Rekorde", sub: "die Ruhmeshalle eurer Gruppe", cards: ["Ruhmeshalle"] },
];

type Tones = Record<string, string>;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const winPct = (p: number) => (p > 0 && p < 0.005 ? "<1 %" : pct0(p * 100));
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- members ----------

/** Who takes part in the ranking: one tap hides or shows a friend, and it stays that way. */
function RankingMembers({ friends, tones }: { friends: TrackedPlayer[]; tones: Tones }) {
  const hidden = friends.filter((p) => p.hidden);
  return (
    <div class="rank-members">
      <span class="small muted">Im Vergleich:</span>
      <div class="chips">
        <span class="chip member on me" title="Du bist immer dabei">
          <Avatar name="Du" tone="tone-me" size="sm" /> Du
        </span>
        {friends.map((p) => (
          <button
            key={p.id}
            class={`chip member${p.hidden ? "" : " on"}`}
            aria-pressed={!p.hidden}
            title={p.hidden ? `${p.name} wieder in die Rangliste aufnehmen` : `${p.name} in Rangliste und Vergleich ausblenden`}
            onClick={() => void updatePlayer(p.id, { hidden: !p.hidden })}
          >
            {p.hidden ? <IconEyeOff /> : <Avatar name={p.name} tone={tones[p.id] ?? "tone-0"} size="sm" />} {p.name}
            {!p.hidden && <IconEye />}
          </button>
        ))}
        {hidden.length > 1 && (
          <button class="chip" onClick={() => void Promise.all(hidden.map((p) => updatePlayer(p.id, { hidden: false })))}>
            Alle einblenden
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- hero: the league track and "what if" ----------

const SIM_KEYS: { key: string; label: string; down: number; up: number; step: number; digits: number }[] = [
  { key: "accuracy", label: "Genauigkeit", down: 5, up: 10, step: 0.1, digits: 1 },
  { key: "blunders", label: "Patzer pro Partie", down: 1.5, up: 1, step: 0.01, digits: 2 },
  { key: "expectation", label: "Über Erwartung", down: 15, up: 25, step: 0.5, digits: 1 },
];

function bounds(key: string, base: number, down: number, up: number): [number, number] {
  if (key === "blunders") return [Math.max(0, base - down), base + up];
  if (key === "accuracy") return [Math.max(0, base - down), Math.min(100, base + up)];
  return [base - down, base + up];
}

/** Every ranked player on one line from 0 to 100 points. */
function Track({ rows, overall, tones }: { rows: RankRow[]; overall: (r: RankRow) => number | null; tones: Tones }) {
  const markers: TrackMarker[] = rows.map((r) => ({ id: r.id, label: r.name, value: clamp(overall(r) ?? 0, 0, 100), tone: tones[r.id], me: r.is_me }));
  return <ScaleTrack markers={markers} />;
}

function WhatIf({
  me,
  sim,
  onSim,
  result,
}: {
  me: RankRow;
  sim: Record<string, number>;
  onSim: (s: Record<string, number>) => void;
  result: { overall: number | null; rank: number | null; passed: string[] };
}) {
  const keys = SIM_KEYS.filter((k) => me.cells[k.key]?.value !== null && me.cells[k.key]?.value !== undefined);
  if (!keys.length) return null;
  const changed = Object.keys(sim).length > 0;
  const delta = result.overall !== null && me.overall !== null ? result.overall - me.overall : 0;
  return (
    <div class="lg-whatif">
      <div class="lg-sliders">
        {keys.map((k) => {
          const base = me.cells[k.key].value as number;
          const [lo, hi] = bounds(k.key, base, k.down, k.up);
          const value = clamp(sim[k.key] ?? base, lo, hi);
          return (
            <WhatIfSlider
              key={k.key}
              label={k.label}
              value={value}
              base={base}
              min={lo}
              max={hi}
              step={k.step}
              text={formatFactor(k.key, value)}
              deltaText={signed(value - base, k.digits)}
              good={k.key === "blunders" ? value < base : value > base}
              onInput={(v) => {
                const next = { ...sim };
                if (Math.abs(v - base) < k.step / 2) delete next[k.key];
                else next[k.key] = v;
                onSim(next);
              }}
            />
          );
        })}
      </div>
      <div class={`lg-whatif-result${changed ? " on" : ""}`} role="status">
        {changed ? (
          <>
            <span>
              Damit wärst du auf <strong>Platz {result.rank ?? "–"}</strong>
              {result.rank !== me.rank && me.rank !== null ? ` statt ${me.rank}` : ""} mit{" "}
              <strong class="tnum">{result.overall === null ? "–" : Math.round(result.overall)}</strong> Punkten{" "}
              <span class={`tnum ${delta >= 0 ? "pos" : "neg"}`}>({signed(delta, 0)})</span>
              {result.passed.length ? `, vor ${result.passed.join(" und ")}` : ""}.
            </span>
            <button class="btn ghost small" onClick={() => onSim({})}>
              <IconReset /> Zurück
            </button>
          </>
        ) : (
          <span class="muted">Schieb deine Werte und sieh live, wo du landest. Die anderen bleiben, wie sie sind.</span>
        )}
      </div>
    </div>
  );
}

function LeagueHero({
  ranking,
  tones,
  tournament,
  sim,
  onSim,
}: {
  ranking: Ranking;
  tones: Tones;
  tournament: Tournament | null;
  sim: Record<string, number>;
  onSim: (s: Record<string, number>) => void;
}) {
  const me = ranking.rows.find((r) => r.is_me && r.overall !== null) ?? null;
  const ranked = ranking.rows.filter((r) => r.overall !== null);
  const [open, setOpen] = useState(false);
  const scores = useMemo(() => (me && Object.keys(sim).length ? rescore(ranking, me.id, sim) : null), [ranking, me, sim]);
  const ranks = useMemo(() => (scores ? ranksOf(scores) : null), [scores]);
  if (!ranked.length) return null;
  const overall = (r: RankRow) => scores?.get(r.id) ?? r.overall;
  const leader = ranked[0];
  const leaders = ranked.filter((r) => r.rank === 1);
  const title = leaders.length > 1 ? `${leaders.map((r) => r.name).join(" und ")} teilen sich die Spitze` : leader.is_me ? "Du führst die Liga an" : `${leader.name} führt die Liga an`;
  const win = (id: string) => tournament?.rows.find((t) => t.id === id)?.win ?? null;
  const above = me ? ranked.filter((r) => (r.overall as number) > (me.overall as number)).pop() : null;
  const below = me ? ranked.find((r) => (r.overall as number) < (me.overall as number)) : null;
  const result = {
    overall: me ? (scores?.get(me.id) ?? me.overall) : null,
    rank: me ? (ranks?.get(me.id) ?? me.rank) : null,
    // Who you would pass with the simulated values.
    passed: me && scores ? ranked.filter((r) => !r.is_me && (r.overall as number) > (me.overall as number) && (scores.get(r.id) ?? 0) < (scores.get(me.id) ?? 0)).map((r) => r.name) : [],
  };
  const lw = win(leader.id);
  return (
    <section class="card lg-hero span-12" id="lg-hero">
      <div class="lg-hero-head">
        <div>
          <span class="lg-kicker">
            Liga · {plural(ranked.length, "Spieler", "Spieler")}
          </span>
          <h2 class="lg-hero-title">{title}</h2>
          <p class="lg-hero-sub">
            {Math.round(leader.overall as number)} von 100 Punkten
            {lw !== null && leaders.length === 1 ? ` · gewinnt ${winPct(lw)} der simulierten Turniere` : ""}
          </p>
        </div>
        {me && (
          <div class="lg-hero-me">
            <span class="lg-hero-place tnum">{me.rank}.</span>
            <span class="lg-hero-me-text">
              <strong>Dein Platz</strong>
              <span class="faint small">
                {above ? `${de((above.overall as number) - (me.overall as number), 1)} hinter ${above.name}` : "niemand vor dir"}
                {below ? ` · ${de((me.overall as number) - (below.overall as number), 1)} vor ${below.name}` : ""}
              </span>
            </span>
          </div>
        )}
      </div>
      <Track rows={ranked} overall={overall} tones={tones} />
      {me && (
        <>
          <button class={`lg-whatif-toggle${open || scores ? " on" : ""}`} onClick={() => setOpen(!(open || scores))} aria-expanded={open || Boolean(scores)}>
            <IconSpark /> Was wäre wenn?
            <span class="faint small"> Deine Werte verschieben und den Platz live sehen</span>
          </button>
          {(open || scores) && <WhatIf me={me} sim={sim} onSim={onSim} result={result} />}
        </>
      )}
    </section>
  );
}

// ---------- table ----------

const GROUP_CLASS: Record<string, string> = { Ergebnisse: "g-res", Spielqualität: "g-qual", Fähigkeiten: "g-skill", Sonstiges: "g-misc" };

/** Where a player's overall points come from: one segment per factor, sized by what it brought. */
export function Breakdown({ ranking, row }: { ranking: Ranking; row: RankRow }) {
  const byKey = new Map(ranking.factors.map((f) => [f.key, f]));
  if (!row.breakdown.length) return <p class="muted small">Noch zu wenig Daten für eine Aufschlüsselung.</p>;
  return (
    <div class="breakdown">
      <div class="breakdown-bar" role="img" aria-label={`${Math.round(row.overall ?? 0)} von 100 Punkten`}>
        {row.breakdown.map((c) => (
          <span key={c.key} class={GROUP_CLASS[byKey.get(c.key)?.group ?? "Sonstiges"]} style={{ width: `${c.value}%` }} title={`${byKey.get(c.key)?.label}: ${de(c.value, 1)} Punkte`} />
        ))}
      </div>
      <div class="breakdown-rows">
        {row.breakdown.map((c) => {
          const f = byKey.get(c.key);
          return (
            <div class="breakdown-row" key={c.key}>
              <span class={`dot ${GROUP_CLASS[f?.group ?? "Sonstiges"]}`} />
              <span>{f?.label}</span>
              <span class="faint small tnum">{formatFactor(c.key, row.cells[c.key]?.value ?? null)}</span>
              <span class="tnum small muted">
                {Math.round(c.points)} × {de(c.share, 0)} %
              </span>
              <strong class="tnum">{de(c.value, 1)}</strong>
            </div>
          );
        })}
      </div>
      {row.missing.length > 0 && (
        <p class="faint small" style={{ margin: "6px 0 0" }}>
          Ohne Daten: {row.missing.map((k) => byKey.get(k)?.label).join(", ")}. Ihr Gewicht verteilt sich auf die übrigen Faktoren.
        </p>
      )}
    </div>
  );
}

function Standings({ ranking, tones, types }: { ranking: Ranking; tones: Tones; types: Record<string, Archetype> }) {
  const [open, setOpen] = useState<string | null>(null);
  const on = useEntrance();
  return (
    <section class="card tile span-7 lg-table">
      <div class="tile-head">
        <h3>Tabelle</h3>
        <span class="tile-sub">Gesamtwertung, 0–100 Punkte · antippen für die Herkunft</span>
      </div>
      <ol class="lg-rows">
        {ranking.rows.map((r, i) => {
          const isOpen = open === r.id;
          const t = types[r.id];
          return (
            <li key={r.id} class={`lg-row${r.is_me ? " me" : ""}${isOpen ? " open" : ""}`} style={{ "--i": i } as Record<string, number>}>
              <button class="lg-row-main" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen} disabled={r.overall === null}>
                <span class={`lg-rank r${r.rank ?? 0}`}>{r.rank ?? "–"}</span>
                <Avatar name={r.name} tone={tones[r.id]} ring={r.is_me} />
                <span class="lg-row-name">
                  <strong>{r.name}</strong>
                  <span class="faint small">{t && t.title !== "Neu dabei" ? t.title : r.overall === null ? "zu wenig Daten" : "Neu dabei"}</span>
                </span>
                <span class="lg-row-stats">
                  <span title="Genauigkeit">
                    <span class="faint">Gen.</span> {formatFactor("accuracy", r.cells.accuracy?.value ?? null)}
                  </span>
                  <span title="Patzer pro Partie">
                    <span class="faint">Patzer</span> {formatFactor("blunders", r.cells.blunders?.value ?? null)}
                  </span>
                  <span title="Punkte über der Erwartung">
                    <span class="faint">Erw.</span> {formatFactor("expectation", r.cells.expectation?.value ?? null)}
                  </span>
                </span>
                <span class="lg-row-score">
                  <span class="lg-bar">
                    <span class={tones[r.id]} style={{ transform: `scaleX(${on ? (r.overall ?? 0) / 100 : 0})` }} />
                  </span>
                  <strong class="tnum">{r.overall === null ? "–" : Math.round(r.overall)}</strong>
                </span>
              </button>
              {isOpen && (
                <div class="lg-row-detail">
                  <p class="faint small lg-row-basis">
                    Grundlage: {plural(r.games, "Partie", "Partien")}, davon {r.analyzed} analysiert
                  </p>
                  <Breakdown ranking={ranking} row={r} />
                  {!r.is_me && (
                    <a class="btn small" href={toHash({ view: "players", playerId: r.id })}>
                      <IconSwords /> Du gegen {r.name}
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p class="faint small tile-foot">
        Die Wertung zählt hier nicht: Punkte gibt es nur für das, was ihr am Brett zeigt. 50 heißt so stark wie der Schnitt der Gruppe, und wer nur zufällig vorn liegt, kommt kaum darüber.
      </p>
    </section>
  );
}

function TournamentCard({ t, tones }: { t: Tournament | null; tones: Tones }) {
  const on = useEntrance();
  if (!t) {
    return (
      <section class="card tile span-5 lg-cup">
        <div class="tile-head">
          <h3>Wer gewinnt euer Turnier?</h3>
        </div>
        <p class="muted small">Ab drei Spielern mit Gesamtwertung simuliert die App hier ein Turnier jeder gegen jeden.</p>
      </section>
    );
  }
  const max = Math.max(...t.rows.map((r) => r.win), 0.0001);
  return (
    <section class="card tile span-5 lg-cup">
      <div class="tile-head">
        <h3>
          <IconTrophy /> Wer gewinnt euer Turnier?
        </h3>
        <span class="tile-sub">{t.runs.toLocaleString("de-DE")}-mal gespielt</span>
      </div>
      <p class="small muted" style={{ marginTop: 0 }}>
        Jeder gegen jeden, Hin- und Rückrunde: {plural(t.games_each, "Partie", "Partien")} pro Spieler.
      </p>
      <div class="lg-cup-rows">
        {t.rows.map((r, i) => (
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
              Podest {winPct(r.podium)} · Ø {de(r.expected, 1)} von {t.games_each}
            </span>
          </div>
        ))}
      </div>
      <p class="faint small tile-foot">
        Jede Partie wird aus eurem Spiel ohne Wertung und euren direkten Partien ausgewürfelt, {pct0(t.draw_rate * 100)} enden remis.
      </p>
    </section>
  );
}

// ---------- climbing ----------

const LEVER_UNIT: Record<string, (v: number) => string> = {
  accuracy: (v) => `${de(v, 1)} %`,
  blunders: (v) => de(v, 2),
  expectation: (v) => signed(v),
  h2h: (v) => `${de(v, 0)} %`,
};
const leverValue = (key: string, v: number) => (LEVER_UNIT[key] ?? ((x: number) => String(Math.round(x))))(v);
const leverDelta = (l: Lever) => (l.key === "blunders" ? signed(l.delta, 2) : l.key === "accuracy" || l.key === "expectation" ? signed(l.delta, 1) : signed(l.delta, 0));
const effortLevel = (e: number) => (e <= SMALL_EFFORT ? 1 : e <= LARGE_EFFORT ? 2 : 3);
const EFFORT_TEXT = ["", "kleiner Schritt", "machbar", "großer Schritt"];

function LeverRow({ l, onTry }: { l: Lever; onTry?: () => void }) {
  return (
    <div class="lg-lever">
      <span class="lg-lever-label">
        <strong>{l.label}</strong>
        <span class="faint small tnum">
          {leverValue(l.key, l.from)} → {leverValue(l.key, l.to)}
        </span>
      </span>
      <span class="lg-lever-delta tnum">{leverDelta(l)}</span>
      <span class={`lg-effort e${effortLevel(l.effort)}`}>{EFFORT_TEXT[effortLevel(l.effort)]}</span>
      {onTry && (
        <button class="btn ghost small" onClick={onTry}>
          Ausprobieren
        </button>
      )}
    </div>
  );
}

function ClimbCard({ plan, onTry }: { plan: ClimbPlan | null; onTry: (changes: Record<string, number>) => void }) {
  if (!plan || plan.rank === null) return null;
  const t = plan.target;
  const ch = plan.chaser;
  return (
    <section class="card tile span-12 lg-climb">
      <div class="tile-head">
        <h3>
          <IconRise /> {t ? `So überholst du ${t.name}` : "Du stehst ganz oben"}
        </h3>
        <span class="tile-sub">
          {t ? `${de(plan.gap, 1)} Punkte bis Platz ${t.rank}` : "jetzt heißt es: verteidigen"}
        </span>
      </div>
      <div class="lg-climb-grid">
        <div>
          {!t ? (
            <p class="small muted">Niemand liegt vor dir. Rechts siehst du, wer am nächsten dran ist.</p>
          ) : (
            <>
              {plan.levers.length > 0 && (
                <>
                  <p class="small muted" style={{ marginTop: 0 }}>
                    Jede dieser Änderungen reicht allein, wenn alles andere bleibt, wie es ist:
                  </p>
                  <div class="lg-levers">
                    {plan.levers.map((l) => (
                      <LeverRow key={l.key} l={l} onTry={() => onTry({ [l.key]: l.to })} />
                    ))}
                  </div>
                </>
              )}
              {plan.combo && (
                <div class={plan.levers.length ? "lg-combo" : undefined}>
                  <p class="small muted" style={{ marginTop: 0 }}>
                    {plan.levers.length ? "Oder auf drei Bereiche verteilt, jeder Schritt machbar:" : "Eine Änderung allein reicht nicht. Zusammen klappt es:"}
                  </p>
                  <div class="lg-levers">
                    {plan.combo.map((l) => (
                      <LeverRow key={l.key} l={l} />
                    ))}
                  </div>
                  <button class="btn small" style={{ marginTop: "10px" }} onClick={() => onTry(Object.fromEntries(plan.combo!.map((l) => [l.key, l.to])))}>
                    <IconSpark /> Im Simulator ausprobieren
                  </button>
                </div>
              )}
              {!plan.levers.length && !plan.combo && (
                <p class="small muted">
                  {t.name} liegt so weit vorn, dass auch große Sprünge in Genauigkeit, Patzern und Ergebnissen zusammen nicht reichen. Bleib dran: jede analysierte Partie macht die Werte genauer.
                </p>
              )}
            </>
          )}
        </div>
        <div class="lg-climb-guard">
          <h4>{ch ? `Hinter dir: ${ch.name}` : "Hinter dir"}</h4>
          {ch ? (
            <p class="small">
              <strong class="tnum">{de(ch.gap, 1)}</strong> Punkte zurück.{" "}
              {ch.lever
                ? `Schon mit ${ch.lever.label} ${leverValue(ch.lever.key, ch.lever.to)} statt ${leverValue(ch.lever.key, ch.lever.from)} wäre ${ch.name} an dir vorbei.`
                : `Mit einer einzelnen Änderung kommt ${ch.name} nicht an dir vorbei.`}
            </p>
          ) : (
            <p class="small muted">Niemand: du bist Letzter. Von hier geht es nur nach oben.</p>
          )}
        </div>
      </div>
      <p class="faint small tile-foot">Gerechnet mit denselben Regeln wie die Tabelle: wer dort sicherer besser ist, bekommt mehr Punkte. „Kleiner Schritt“ heißt: weniger als der übliche Abstand zwischen euch.</p>
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
        <h3>Kreuztabelle</h3>
        <div class="segmented small-seg" role="tablist">
          <button class={mode === "results" ? "active" : ""} onClick={() => setMode("results")}>
            Ergebnisse
          </button>
          <button class={mode === "forecast" ? "active" : ""} onClick={() => setMode("forecast")}>
            Prognose
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
              <th class="num">{mode === "results" ? "Gesamt" : ""}</th>
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
                        <button class="lg-cell" style={heatOf(p === null ? null : p * 100)} onClick={() => onPick(row.id, col.id)} title={`${row.name} gegen ${col.name}: erwartet ${pct0(p === null ? null : p * 100)} der Punkte`}>
                          {p === null ? "·" : Math.round(p * 100)}
                        </button>
                      </td>
                    );
                  }
                  const c = cross.cells[i][j] as CrossCell;
                  if (!c.games) {
                    return (
                      <td key={col.id}>
                        <button class="lg-cell empty" onClick={() => onPick(row.id, col.id)} title={`${row.name} und ${col.name} haben noch nicht gegeneinander gespielt`}>
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
                        title={`${row.name} gegen ${col.name}: ${c.wins} Siege, ${c.draws} Remis, ${c.losses} Niederlagen`}
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
      <p class="faint small tile-foot">
        {mode === "results"
          ? `Punkte der Zeile gegen die Spalte aus ${plural(cross.total_games, "direkten Partie", "direkten Partien")}. Tippe auf ein Feld: dann battlen die beiden unten.`
          : "Erwartete Punkte der Zeile gegen die Spalte in Prozent, aus eurem Spiel ohne Wertung und den direkten Partien."}
      </p>
    </section>
  );
}

function HighlightsCard({ cross, tones }: { cross: Crosstable; tones: Tones }) {
  const list = crossHighlights(cross);
  const vsName = (p: { name: string; is_me: boolean }) => (p.is_me ? "dich" : p.name);
  const lines = list.map((h) => {
    const c = h.cell;
    const score = `${half(c.points)} aus ${c.games}`;
    switch (h.kind) {
      case "nemesis":
        return {
          key: h.kind,
          icon: <IconShield />,
          title: "Dein Angstgegner",
          who: h.b,
          text: `Gegen ${h.b.name} holst du nur ${score} (${pct0(c.score_pct)}). ${h.clear ? "Das ist klar mehr als Pech." : "Das kann noch Zufall sein."}`,
        };
      case "favorite":
        return {
          key: h.kind,
          icon: <IconStar />,
          title: "Dein Lieblingsgegner",
          who: h.b,
          text: `Gegen ${h.b.name} holst du ${score} (${pct0(c.score_pct)}). ${h.clear ? "Klar kein Zufall." : "Ob das so bleibt, zeigen die nächsten Partien."}`,
        };
      case "rivalry":
        return {
          key: h.kind,
          icon: <IconSwords />,
          title: "Engste Rivalität",
          who: h.a,
          text: `${h.a.is_me ? "Du" : h.a.name} gegen ${vsName(h.b)}: ${half(c.points)} : ${half(c.games - c.points)} nach ${plural(c.games, "Partie", "Partien")}.`,
        };
      default:
        return {
          key: h.kind,
          icon: <IconFlame />,
          title: "Heißeste Serie",
          who: h.a,
          text: `${h.a.is_me ? "Du hast" : `${h.a.name} hat`} die letzten ${c.streak?.count} Partien gegen ${vsName(h.b)} gewonnen.`,
        };
    }
  });
  return (
    <section class="card tile span-5 lg-highlights">
      <div class="tile-head">
        <h3>Auffällig</h3>
        <span class="tile-sub">ab {MIN_PAIR_GAMES} Partien je Paarung</span>
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
        <p class="muted small">Spielt mehr direkte Partien gegeneinander, dann zeigt sich hier, wer wem liegt.</p>
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
          <IconSwords /> Battle-Arena
        </h3>
        <span class="tile-sub">8 Runden, ohne Wertung</span>
      </div>
      <div class="battle-pick">
        {pick(a, 0, b, "Spieler links")}
        <button class="btn ghost small" onClick={() => onPair([b, a])} title="Seiten tauschen">
          ⇄
        </button>
        {pick(b, 1, a, "Spieler rechts")}
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
          <span class="faint small">Runden{battle.draws ? ` · ${battle.draws} offen` : ""}</span>
        </div>
        <div class={`lg-battle-side${battle.leader === "b" ? " win" : ""}`}>
          <Avatar name={bn} tone={tones[b]} size="xl" ring={battle.leader === "b"} />
          <strong>{bn}</strong>
        </div>
      </div>
      {power !== null && (
        <div class="lg-tug big" title="Gewichteter Schnitt der Wahrscheinlichkeit, in den Runden besser zu sein">
          <span class={`lg-tug-a ${tones[a]}`} style={{ width: `${power}%` }}>
            <span class="tnum">{Math.round(power)}</span>
          </span>
          <span class={`lg-tug-b ${tones[b]}`}>
            <span class="tnum">{Math.round(100 - power)}</span>
          </span>
        </div>
      )}
      <p class="battle-verdict">{battle.verdict.replace(/^Du gewinnt /, "Du gewinnst ")}</p>
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
                  {r.winner === null ? "keine Daten" : r.winner === "draw" ? "offen" : `${r.winner === "a" ? an : bn} ${MARGIN_TEXT[r.margin as string]}`}
                </span>
              </button>
              {pa !== null && (
                <div class="lg-tug" title={`${an}: ${Math.round(pa)} % Wahrscheinlichkeit, hier besser zu sein`}>
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
                        {label.get(f.key) ?? f.key}
                        {f.p_a !== null ? ` · ${Math.round(f.p_a * 100)} % für ${an}` : ""}
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
      <p class="faint small tile-foot">
        Eine Runde gewinnt, wer dort mit mindestens 65 % Wahrscheinlichkeit wirklich besser ist (ab 80 % deutlich, ab 95 % klar); darunter bleibt sie offen. Tippe auf eine Runde für die Werte.
      </p>
    </section>
  );
}

// ---------- strengths ----------

const ROUND_SHORT: Record<string, string> = {
  results: "Ergebnisse",
  precision: "Präzision",
  blunders: "Patzer",
  opening: "Eröffnung",
  tactics: "Taktik",
  endgame: "Endspiel",
  nerves: "Nerven",
  h2h: "Duelle",
};

// Monochrome intensity: the brighter, the more likely the best in the group.
const heat = (v: number) => `color-mix(in srgb, var(--text) ${Math.round((v / 100) ** 1.5 * 36)}%, transparent)`;

function roundPoints(r: RankRow, factors: string[]): number | null {
  return avg(factors.map((k) => r.cells[k]?.points).filter((v): v is number => v !== null && v !== undefined));
}

function GroupLine({ g, kind }: { g: GroupPoint; kind: "edge" | "learn" }) {
  const mine = formatFactor(g.key, g.mine);
  const other = formatFactor(g.key, g.other);
  return (
    <button class={`insight group-line ${kind === "edge" ? "pos" : "mid"}`} onClick={() => navigate({ view: "players", playerId: g.other_id })}>
      <div class="t">{g.label}</div>
      <div class="small">
        {kind === "edge" ? (
          <>
            Du <strong class="tnum">{mine}</strong>, am nächsten dran: {g.other_name} <span class="tnum">{other}</span>
          </>
        ) : (
          <>
            {g.other_name} <strong class="tnum">{other}</strong>, du <span class="tnum">{mine}</span>. Schau dir die Partien von {g.other_name} an.
          </>
        )}
      </div>
    </button>
  );
}

/** Your two best areas with your place in each: what is closest to a lead. */
function nearestLeads(ranking: Ranking) {
  const me = ranking.rows.find((r) => r.is_me);
  if (!me) return [];
  return BATTLE_ROUNDS.map((d) => {
    const pts = roundPoints(me, d.factors);
    if (pts === null) return null;
    const place = 1 + ranking.rows.filter((r) => r !== me && (roundPoints(r, d.factors) ?? -1) > pts).length;
    return { label: d.label, pts, place };
  })
    .filter((x): x is { label: string; pts: number; place: number } => x !== null)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 2);
}

function StrengthMatrix({ ranking, tones, standing }: { ranking: Ranking; tones: Tones; standing: GroupStanding | null }) {
  const crownList = crowns(ranking);
  const near = standing?.edges.length ? [] : nearestLeads(ranking);
  return (
    <section class="card tile span-12 lg-matrix">
      <div class="tile-head">
        <h3>
          <IconCrown /> Stärken-Matrix
        </h3>
        <span class="tile-sub">Punkte je Bereich: die Chance, dort besser als die anderen zu sein</span>
      </div>
      <div class="table-scroll">
        <table class="lg-matrix-table">
          <thead>
            <tr>
              <th />
              {BATTLE_ROUNDS.map((d) => (
                <th key={d.key} title={d.label}>
                  {ROUND_SHORT[d.key] ?? d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranking.rows.map((r) => (
              <tr key={r.id} class={r.is_me ? "me" : ""}>
                <th scope="row">
                  <Who name={r.name} tone={tones[r.id]} />
                </th>
                {BATTLE_ROUNDS.map((d) => {
                  const v = roundPoints(r, d.factors);
                  const crown = crownList.find((c) => c.key === d.key && c.holder_id === r.id);
                  return (
                    <td key={d.key}>
                      <span
                        class={`lg-heat${v === null ? " none" : ""}${v !== null && v >= 65 ? " hi" : ""}`}
                        style={v === null ? undefined : { backgroundImage: `linear-gradient(${heat(v)}, ${heat(v)})` }}
                        title={v === null ? "keine Daten" : `${r.name} · ${d.label}: ${Math.round(v)} Punkte${crown ? ` · Krone „${crown.title}“ (${crown.clear ? "klar" : "knapp"})` : ""}`}
                      >
                        {v === null ? "–" : Math.round(v)}
                        {crown && <span class={`lg-crown${crown.clear ? " clear" : ""}`}>♛</span>}
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
        50 heißt: so gut wie der Schnitt der Gruppe. ♛ markiert den Besten je Bereich, golden, wenn der Vorsprung klar ist.
      </p>
      {standing && standing.members >= 2 && (
        <div class="group-cols lg-standing">
          <div>
            <h4>Hier bist du klar vorn</h4>
            {standing.edges.length ? (
              <div class="insights">
                {standing.edges.map((g) => (
                  <GroupLine key={g.key} g={g} kind="edge" />
                ))}
              </div>
            ) : (
              <p class="muted small">
                Noch kein Bereich, in dem du sicher besser als alle bist.
                {near.length > 0 && ` Am nächsten dran: ${near.map((n) => `${n.label} (Platz ${n.place}, ${Math.round(n.pts)} Punkte)`).join(" und ")}.`}
              </p>
            )}
          </div>
          <div>
            <h4>Hier kannst du dir etwas abschauen</h4>
            {standing.learn.length ? (
              <div class="insights">
                {standing.learn.map((g) => (
                  <GroupLine key={g.key} g={g} kind="learn" />
                ))}
              </div>
            ) : (
              <p class="muted small">Kein Freund ist dir irgendwo sicher voraus.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const QUADRANT: Record<string, string> = { strong: "Stark", fighter: "Kämpfer", unlucky: "Lässt Punkte liegen", growing: "Im Aufbau" };

function QualityMapCard({ map, tones }: { map: QualityMap | null; tones: Tones }) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  if (!map) {
    return (
      <section class="card tile span-7">
        <div class="tile-head">
          <h3>Spielqualität gegen Ergebnis</h3>
        </div>
        <p class="muted small">Ab drei Spielern mit Genauigkeit und gewerteten Partien zeigt diese Karte, wer mehr (oder weniger) aus dem eigenen Spiel macht.</p>
      </section>
    );
  }
  const h = clamp(Math.round(w * 0.66), 250, 360);
  const pad = { l: 42, r: 14, t: 14, b: 34 };
  const xs = map.points.flatMap((p) => [p.x - p.x_se, p.x + p.x_se]);
  const ys = map.points.flatMap((p) => [p.y - p.y_se, p.y + p.y_se]);
  const spanX = Math.max(4, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(8, Math.max(...ys) - Math.min(...ys));
  const x0 = Math.min(...xs) - spanX * 0.12;
  const x1 = Math.max(...xs) + spanX * 0.12;
  const y0 = Math.min(...ys) - spanY * 0.12;
  const y1 = Math.max(...ys) + spanY * 0.12;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const ticks = (a: number, b: number, n: number) => {
    const step = Math.max(1, Math.round((b - a) / n));
    const out: number[] = [];
    for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v);
    return out;
  };
  return (
    <section class="card tile span-7 lg-map">
      <div class="tile-head">
        <h3>Spielqualität gegen Ergebnis</h3>
        <span class="tile-sub">Genauigkeit gegen Punkte über der Erwartung</span>
      </div>
      <div ref={ref} class="lg-map-plot">
        <svg width={w} height={h} role="img" aria-label="Streudiagramm: Genauigkeit gegen Ergebnis über Erwartung">
          {ticks(x0, x1, 5).map((v) => (
            <g key={`x${v}`}>
              <line class="grid" x1={sx(v)} x2={sx(v)} y1={pad.t} y2={h - pad.b} />
              <text class="axis" x={sx(v)} y={h - pad.b + 16} text-anchor="middle">
                {v} %
              </text>
            </g>
          ))}
          {ticks(y0, y1, 4).map((v) => (
            <g key={`y${v}`}>
              <line class="grid" x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} />
              <text class="axis" x={pad.l - 6} y={sy(v) + 4} text-anchor="end">
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}
          <line class="mean" x1={sx(map.x_mean)} x2={sx(map.x_mean)} y1={pad.t} y2={h - pad.b} />
          <line class="mean" x1={pad.l} x2={w - pad.r} y1={sy(map.y_mean)} y2={sy(map.y_mean)} />
          <text class="corner" x={w - pad.r - 6} y={pad.t + 14} text-anchor="end">
            Stark
          </text>
          <text class="corner" x={pad.l + 6} y={pad.t + 14}>
            Kämpfer
          </text>
          <text class="corner" x={w - pad.r - 6} y={h - pad.b - 8} text-anchor="end">
            Lässt Punkte liegen
          </text>
          <text class="corner" x={pad.l + 6} y={h - pad.b - 8}>
            Im Aufbau
          </text>
          {map.points.map((p) => (
            <g key={p.id} class={`pt ${tones[p.id]}${p.is_me ? " me" : ""}`}>
              <line class="err" x1={sx(p.x - p.x_se)} x2={sx(p.x + p.x_se)} y1={sy(p.y)} y2={sy(p.y)} />
              <line class="err" x1={sx(p.x)} x2={sx(p.x)} y1={sy(p.y - p.y_se)} y2={sy(p.y + p.y_se)} />
              <circle cx={sx(p.x)} cy={sy(p.y)} r={13} />
              <text class="ini" x={sx(p.x)} y={sy(p.y) + 4} text-anchor="middle">
                {p.name.slice(0, 1).toUpperCase()}
              </text>
              <text class="name" x={sx(p.x) + (sx(p.x) > w - 90 ? -18 : 18)} y={sy(p.y) + 4} text-anchor={sx(p.x) > w - 90 ? "end" : "start"}>
                {p.name}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div class="lg-map-legend faint small">
        {map.points
          .filter((p) => p.quadrant)
          .map((p) => (
            <span key={p.id}>
              {p.name}: {QUADRANT[p.quadrant as string]}
            </span>
          ))}
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
      <p class="faint small tile-foot">
        Striche: ±1 Standardfehler. Eine Ecke zählt erst, wenn jemand auf beiden Achsen mehr als das vom Gruppenschnitt (gestrichelt) entfernt ist; ein Satz darunter erst bei 95 % Sicherheit.
        {map.missing.length ? ` Ohne Werte: ${map.missing.join(", ")}.` : ""}
      </p>
    </section>
  );
}

const AREA_LABEL: Record<string, string> = Object.fromEntries(BATTLE_ROUNDS.map((d) => [d.key, d.label]));

function TypesCard({ ranking, types, tones }: { ranking: Ranking; types: Record<string, Archetype>; tones: Tones }) {
  return (
    <section class="card tile span-5 lg-types">
      <div class="tile-head">
        <h3>Spielertypen</h3>
        <span class="tile-sub">wofür jeder in der Gruppe steht</span>
      </div>
      <div class="lg-type-list">
        {ranking.rows.map((r) => {
          const t = types[r.id];
          if (!t) return null;
          return (
            <div class="lg-type" key={r.id}>
              <Avatar name={r.name} tone={tones[r.id]} />
              <span>
                <strong>{t.title}</strong>
                <span class="faint small">
                  {r.name}
                  {t.area && t.points !== null ? ` · ${AREA_LABEL[t.area]} ${Math.round(t.points)} Punkte` : ""}
                  {t.weak ? ` · Baustelle: ${t.weak}` : ""}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <p class="faint small tile-foot">Ein Titel gibt es ab 65 Punkten in einem Bereich, eine Baustelle bei 35 oder weniger.</p>
    </section>
  );
}

// ---------- form ----------

const SHORT_DATE = (t: number) => new Date(t * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

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
        <h3>Formkurve</h3>
        <span class="tile-sub">Genauigkeit pro Woche, fair nach Bedenkzeit</span>
      </div>
      <div class="segmented small-seg chart-range" role="group" aria-label="Zeitraum der Formkurve">
        {spans.map(([l, w]) => (
          <button key={l} class={span === w ? "active" : ""} onClick={() => onSpan(w)}>
            {l}
          </button>
        ))}
      </div>
      {vals.length ? (
        <>
          <div ref={ref} class="lg-race-plot">
            <svg width={w} height={h} role="img" aria-label="Genauigkeit pro Woche je Spieler">
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
                        <title>{`${r.name}, Woche ab ${SHORT_DATE(wk.start)}: ${de(wk.smooth, 1)} % (Schnitt über drei Wochen), ${plural(wk.games, "Partie", "Partien")} in der Woche`}</title>
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
        <p class="muted small">In diesem Zeitraum gibt es noch zu wenige analysierte Partien für eine Formkurve.</p>
      )}
      <p class="faint small tile-foot">Gleitender Schnitt über drei Wochen. Tippe auf einen Namen, um ihn hervorzuheben.</p>
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
        <h3>Wer ist in Form?</h3>
        <span class="tile-sub">letzte 30 Tage gegen davor</span>
      </div>
      <div class="lg-form-rows">
        {order.map((r) => {
          const rating = ratings.find((x) => x.id === r.id);
          return (
            <div class={`lg-form-row${r.is_me ? " me" : ""}`} key={r.id}>
              <Who name={r.name} tone={tones[r.id]} />
              <span class="lg-last" aria-label={`Letzte Ergebnisse: ${r.last.map((o) => RESULT_CHAR[o]).join(" ")}`}>
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
                {r.streak && r.streak.count >= 3
                  ? `${r.streak.count} ${r.streak.kind === "win" ? "Siege" : r.streak.kind === "loss" ? "Niederlagen" : "Remis"} in Folge`
                  : `${plural(r.recent.games, "Analyse", "Analysen")} zuletzt`}
                {rating ? ` · Wertung ${signed(rating.delta, 0)} (${SPEED_DE[rating.speed] ?? rating.speed})` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <p class="faint small tile-foot">
        ↑ und ↓ nur, wenn der Unterschied in der fairen Genauigkeit mit 95 % kein Zufall ist (je mindestens 10 analysierte Partien); sonst „stabil“, mit weniger Partien „offen“. Wertung: letzte {FORM_DAYS} Tage.
      </p>
    </section>
  );
}

// ---------- records ----------

const RECORD_ICON: Record<string, () => preact.JSX.Element> = {
  best_game: IconStar,
  brilliant: IconSpark,
  streak: IconFlame,
  comeback: IconRise,
  quick: IconBolt,
  upset: IconCrown,
  clean: IconShield,
};

/** Columns that fill every row about evenly: 7 records as 4 + 3, not 5 + 2. */
const fameColumns = (n: number) => (n <= 5 ? Math.max(1, n) : Math.ceil(n / Math.ceil(n / 5)));

function HallOfFame({ records, tones }: { records: GroupRecord[]; tones: Tones }) {
  return (
    <section class="card tile span-12 lg-fame">
      <div class="tile-head">
        <h3>
          <IconTrophy /> Ruhmeshalle
        </h3>
        <span class="tile-sub">bei Gleichstand zählt, wer zuerst da war</span>
      </div>
      {records.length ? (
        <div class="lg-fame-grid" style={{ "--cols": fameColumns(records.length) } as Record<string, number>}>
          {records.map((r) => {
            const Icon = RECORD_ICON[r.key] ?? IconTrophy;
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
                  <Avatar name={r.holder.name} tone={tones[r.holder.id]} size="sm" />
                  <strong>{r.holder.name}</strong>
                </span>
                <span class="faint small">{r.detail}</span>
              </>
            );
            return r.game_id ? (
              <button key={r.key} class={`lg-fame-card${r.holder.is_me ? " me" : ""}`} onClick={() => navigate({ view: "analysis", gameId: r.game_id as string })} title="Partie öffnen">
                {body}
              </button>
            ) : (
              <div key={r.key} class={`lg-fame-card${r.holder.is_me ? " me" : ""}`}>
                {body}
              </div>
            );
          })}
        </div>
      ) : (
        <p class="muted small">Noch keine Rekorde: dafür braucht es gewonnene und analysierte Partien.</p>
      )}
    </section>
  );
}

// ---------- explanation ----------

/** Every factor with its share of the total, so nobody has to guess what counts. */
function ScoringCard({ ranking }: { ranking: Ranking }) {
  const groups = ["Ergebnisse", "Spielqualität", "Fähigkeiten", "Sonstiges"] as const;
  return (
    <details class="card tile span-12 rank-explain">
      <summary>
        <span>
          <strong>So funktioniert das Ranking</strong>
          <span class="faint small"> · 15 Bereiche, Gewichte und Regeln</span>
        </span>
        <span class="rank-explain-chev" aria-hidden="true" />
      </summary>
      <p class="small muted">
        Ich vergleiche dich mit deinen Freunden in 15 Bereichen, von Genauigkeit bis Zeitmanagement. Knappe Vorsprünge aus wenigen Partien zählen kaum, klare Vorsprünge voll. Daraus entsteht die Gesamtwertung.
      </p>
      <div class="scoring">
        {groups.map((g) => {
          const fs = ranking.factors.filter((f) => f.group === g);
          const sum = fs.reduce((t, f) => t + f.weight, 0);
          return (
            <div class="scoring-group" key={g}>
              <div class="scoring-head">
                <span class={`dot ${GROUP_CLASS[g]}`} />
                <strong>{g}</strong>
                <span class="tnum">{de(sum, 0)} %</span>
              </div>
              {fs.map((f) => (
                <div class={`scoring-row${f.weight ? "" : " off"}`} key={f.key} title={f.hint}>
                  <span>{f.label}</span>
                  <span class="tnum">{f.weight ? `${de(f.weight, f.weight % 1 ? 1 : 0)} %` : "nur Info"}</span>
                  <span class="faint small">{f.hint}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p class="faint small" style={{ margin: "8px 0 0" }}>
        Jeder Faktor vergibt 0–100 Punkte: die Wahrscheinlichkeit, wirklich besser als die anderen zu sein. Ein knapper Vorsprung aus wenigen Partien bringt kaum mehr als 50, ein klarer fast 100. Fehlt einem Spieler ein Faktor, verteilt sich dessen Gewicht auf die übrigen. Die Wertung zählt nicht: neue Konten liegen oft Hunderte Punkte daneben, und Partien mit noch springender Wertung fließen auch nicht in „Über Erwartung“ ein.
      </p>
      <p class="faint small" style={{ margin: "6px 0 0" }}>
        Turnier, Überhol-Rechner und Prognosen rechnen mit genau diesen Punkten und Unsicherheiten. Das Turnier würfelt jede Partie 5.000-mal aus; dieselbe Gruppe bekommt immer dieselben Zahlen.
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
  const [date, setDate] = useState("All Time");
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sim, setSim] = useState<Record<string, number>>({});
  const [pair, setPair] = useState<[string, string] | null>(null);
  const allFriends = players.filter((p) => p.friend);
  const friends = rankedFriends(players);
  const { excludeBullet, ready } = useBulletPrefs();
  const fmt = statsFormat(format, excludeBullet);
  // Profiles per player and filter, so hiding or showing a friend only re-ranks
  // and needs no new profile from the worker. Cleared when the games change.
  const cache = useRef<{ games: StoredGame[]; map: Map<string, Promise<PlayerProfile>> }>({ games, map: new Map() });
  const groupKey = friends.map((p) => `${p.id}=${playerUsernames(p).join(",")}=${p.name}`).join("|");
  const group = useMemo(
    () => [
      ...(me.length ? [{ id: "ich", name: "Du", is_me: true, usernames: me }] : []),
      ...friends.map((p) => ({ id: p.id, name: p.name, is_me: false, usernames: playerUsernames(p) })),
    ],
    [groupKey, me],
  );
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
        p = profileFor(games, names, fmt, date);
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

  const cross = useMemo(() => buildCrosstable(group, games, fmt, date), [group, games, fmt, date]);
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
    for (const g of group) for (const [game] of filterGames(games, g.usernames)) oldest = Math.min(oldest, parsePlayedAt(game) ?? Infinity);
    return Number.isFinite(oldest) ? Math.ceil((Date.now() / 1000 - oldest) / (7 * 86400)) : 0;
  }, [group, games]);
  const momentum = useMemo(() => (ranking ? groupMomentum(group, games, { format: fmt, date, effects: ranking.speed_effects }) : []), [ranking, group, games, fmt, date]);
  // The curve's own span; the trend table keeps its fixed 30-day windows.
  const curve = useMemo(
    () => (ranking ? (formSpan === MOMENTUM_WEEKS ? momentum : groupMomentum(group, games, { format: fmt, date, effects: ranking.speed_effects, weeks: formSpan })) : []),
    [ranking, momentum, formSpan, group, games, fmt, date],
  );
  const records = useMemo(() => groupRecords(group, games, fmt, date), [group, games, fmt, date]);
  const ratingForm = useMemo(() => groupForm(group, games), [group, games]);
  const forecast = useMemo(() => (ranking ? (a: string, b: string) => (ranking.rows.some((r) => r.id === a) && ranking.rows.some((r) => r.id === b) ? pairForecast(ranking, a, b, h2hOf(a, b)).p : null) : () => null), [ranking, h2hOf]);

  if (!allFriends.length) {
    return (
      <div class="empty">
        <CoachAvatar size={88} mood="think" />
        <h3>Noch keine Freunde in der Liga</h3>
        <p>Füge Freunde hinzu (Haken „In die Freundes-Rangliste aufnehmen“), dann vergleicht die App euch nach Ergebnissen, Genauigkeit, Patzern, Fähigkeiten und Direktvergleich, simuliert euer Turnier und ihr könnt gegeneinander battlen.</p>
        <button class="btn primary" onClick={() => navigate({ view: "players" })}>
          Zu den Spielern
        </button>
      </div>
    );
  }

  return (
    <div class="league" style={{ opacity: loading && !ranking ? 0.6 : 1 }}>
      <div class="rank-toolbar">
        <PlayerFilters format={format} date={date} onFormat={setFormat} onDate={setDate} />
        <RefreshAll players={friends} label="Freunde aktualisieren" />
        <AnalyzeFriends players={friends} games={games} short />
      </div>
      <RankingMembers friends={allFriends} tones={tones} />
      {error && <p class="error">{error}</p>}
      {!friends.length ? (
        <div class="empty">
          <CoachAvatar size={72} mood="think" />
          <h3>Alle Freunde sind ausgeblendet</h3>
          <p>Tippe oben auf einen Namen, um die Person wieder in die Rangliste aufzunehmen.</p>
        </div>
      ) : !ranking || !view ? (
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "260px" }} />
          <div class="skeleton span-7" style={{ height: "320px" }} />
          <div class="skeleton span-5" style={{ height: "320px" }} />
        </div>
      ) : (
        <>
          <SectionNav sections={LEAGUE_SECTIONS} />
          <div class={`dash${loading ? " busy" : ""}`}>
            <SectionHead section={LEAGUE_SECTIONS[0]} />
            <LeagueHero ranking={ranking} tones={tones} tournament={view.tournament} sim={sim} onSim={setSim} />
            <Standings ranking={ranking} tones={tones} types={view.types} />
            <TournamentCard t={view.tournament} tones={tones} />
            <ClimbCard
              plan={view.plan}
              onTry={(changes) => {
                setSim(changes);
                scrollToId("lg-hero");
              }}
            />

            <SectionHead section={LEAGUE_SECTIONS[1]} />
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

            <SectionHead section={LEAGUE_SECTIONS[2]} />
            <StrengthMatrix ranking={ranking} tones={tones} standing={view.standing} />
            <QualityMapCard map={view.qmap} tones={tones} />
            <TypesCard ranking={ranking} types={view.types} tones={tones} />

            <SectionHead section={LEAGUE_SECTIONS[3]} />
            <FormRace rows={curve} tones={tones} span={formSpan} onSpan={setFormSpan} dataWeeks={dataWeeks} />
            <FormTable rows={momentum} tones={tones} ratings={ratingForm} />

            <SectionHead section={LEAGUE_SECTIONS[4]} />
            <HallOfFame records={records} tones={tones} />
            <ScoringCard ranking={ranking} />
          </div>
        </>
      )}
    </div>
  );
}
