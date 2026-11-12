// "Zugbilanz": every kind of move over all analyzed games, with charts,
// a comparison with the opponents and the player's best moments.

import { useState } from "preact/hooks";

import { type MoveTally, SERIOUS_CLASSES, sumOf, TOP_CLASSES } from "../domain/profile";
import { MIN_BUCKET_MOVES } from "../domain/profile/evidence";
import { AreaChart, BarList, type BarRow, monthStart, StackBar } from "./charts";
import { Coach, NeedNames } from "./Coach";
import { ErrorTiles } from "./InsightsView";
import { CountUp, Hero, HeroStat } from "./kit";
import { PageHeader } from "./Layout";
import { type MovesSection, Section, SectionHead, SectionNav, sectionOf, STAT_SECTIONS } from "./StatsLayout";
import { formatDate, detailSegments } from "./labels";
import { ClassBadge, ClassTiles, monthName, TallyLegend, VersusBars } from "./MoveTally";
import { navigate } from "./router";
import { BlunderCostBlock } from "./stats/Lab";
import { FilterBar, filtersActive, useProfile } from "./useProfile";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

const HIGHLIGHTS_SHOWN = 8;
// A month enters the trend lines from this many moves (about four games);
// thinner months would only add noise.
const MIN_TREND_MOVES = 120;
const PHASES: [string, string][] = [
  ["opening", "Eröffnung"],
  ["middlegame", "Mittelspiel"],
  ["endgame", "Endspiel"],
];
const PHASE_IN: Record<string, string> = { opening: "in der Eröffnung", middlegame: "im Mittelspiel", endgame: "im Endspiel" };

/** Mike's one-sentence summary of the tally. */
function headline(t: MoveTally): { mood: "wow" | "happy" | "think"; text: string } {
  const b = t.counts.Brilliant;
  const g = t.counts.Great;
  if (b) {
    return {
      mood: "wow",
      text: `${plural(b, "brillanter Zug", "brillante Züge")} und ${plural(g, "großartiger", "großartige")} in ${plural(t.games, "Partie", "Partien")}. Schau sie dir unten noch einmal an!`,
    };
  }
  if (g) {
    return {
      mood: "happy",
      text: `Noch kein brillanter Zug, aber schon ${plural(g, "großartiger Fund", "großartige Funde")}. Brillant wird ein Zug, wenn du dafür sauber Material opferst.`,
    };
  }
  return {
    mood: "think",
    text: `${Math.round((sumOf(t.counts, TOP_CLASSES) / (t.moves || 1)) * 100)} % deiner Züge sind schon der beste Zug. Der erste Glanzzug kommt bestimmt.`,
  };
}

function Records({ t }: { t: MoveTally }) {
  const r = t.records;
  const items: [string, string, string][] = [
    ["Partien mit Brillanz", String(r.games_with_brilliant), `von ${t.games}`],
    ["Meiste Brillanz in einer Partie", String(r.most_brilliant), r.most_brilliant === 1 ? "Zug" : "Züge"],
    ["Partien ohne Patzer", String(r.blunder_free_games), `${Math.round((r.blunder_free_games / t.games) * 100)} %`],
    ["Längste Serie ohne Patzer", String(r.longest_blunder_free), r.longest_blunder_free === 1 ? "Partie" : "Partien"],
    ["Aktuelle Serie ohne Patzer", String(r.current_blunder_free), r.current_blunder_free === 1 ? "Partie" : "Partien"],
  ];
  return (
    <div class="records">
      {items.map(([label, value, sub]) => (
        <div class="record" key={label}>
          <div class="kpi-label">{label}</div>
          <div class="record-v tnum">
            {value} <span class="faint small">{sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MovesView() {
  const { profile, usernames, loading, error, filters, setFilters } = useProfile();
  const [allHighlights, setAllHighlights] = useState(false);

  const header = (
    <>
      <PageHeader toolbar={<FilterBar filters={filters} onChange={setFilters} />} />
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what="zähle ich hier alle deine Züge, von brillant bis Patzer." />
      </div>
    );
  }
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "220px" }} />
          <div class="skeleton span-6" style={{ height: "300px" }} />
          <div class="skeleton span-6" style={{ height: "300px" }} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {header}
        <p class="error">{error}</p>
      </div>
    );
  }
  const t = profile?.moves;
  if (!profile || !t) {
    return (
      <div>
        {header}
        <Coach mood="think" title="Noch nichts zu zählen">
          {profile?.total_games
            ? filtersActive(filters)
              ? "In diesem Zeitraum ist keine Partie analysiert. Wähle oben einen anderen Filter."
              : "Analysiere zuerst ein paar Partien, dann zähle ich hier jeden brillanten Zug und jeden Patzer."
            : "Importiere deine Partien und lass sie analysieren."}
        </Coach>
        <button class="btn primary" style={{ marginTop: "12px" }} onClick={() => navigate({ view: "games" })}>
          Zu den Partien
        </button>
      </div>
    );
  }

  const h = headline(t);
  const topShare = t.moves ? (sumOf(t.counts, TOP_CLASSES) / t.moves) * 100 : 0;
  const blundersPerGame = t.games ? t.counts.Blunder / t.games : 0;
  const segments = detailSegments(t.counts);
  const sec = (id: MovesSection) => sectionOf("moves", id);
  const rc = profile.rating;
  const typicalLabel = rc ? `Typisch für ${rc.rating}` : undefined;
  const phaseAcc = (profile.overview.phase_accuracy ?? {}) as Record<string, number>;
  const phaseRows: BarRow[] = PHASES.map(([k, name]) => ({
    label: name,
    value: phaseAcc[k] ?? null,
    reference: rc?.typical_phase_accuracy[k] ?? null,
    valueText: phaseAcc[k] !== undefined ? `${de(phaseAcc[k])} %` : "–",
  }));
  // Monthly trend as two lines instead of stacked shares: the share of top
  // moves and the rate of serious errors are what actually tell progress.
  const months = t.months.filter((m) => m.moves >= MIN_TREND_MOVES);
  const monthPoint = (m: (typeof months)[number], v: number) => ({
    label: monthName(m.key),
    value: v,
    t: monthStart(m.key),
    detail: `${monthName(m.key, true)} · ${plural(m.moves, "Zug", "Züge")}${m.moves < MIN_BUCKET_MOVES ? " · wenige Daten" : ""}`,
  });
  const topPoints = months.map((m) => monthPoint(m, (sumOf(m.counts, TOP_CLASSES) / m.moves) * 100));
  const errPoints = months.map((m) => monthPoint(m, (sumOf(m.counts, SERIOUS_CLASSES) / m.moves) * 100));

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <SectionNav sections={STAT_SECTIONS.moves} />
      <div class="dash">
        <SectionHead section={sec("bilanz")} quiet />
        <Hero
          kicker={`Zugbilanz · ${plural(t.moves, "Zug", "Züge")} aus ${plural(t.games, "analysierten Partie", "analysierten Partien")}`}
          title={
            <>
              <CountUp value={topShare} /> von 100 Zügen sind <em>der beste Zug</em>
            </>
          }
          sub={h.text}
          aside={<HeroStat big={<CountUp value={blundersPerGame} format={(v) => de(v, 2)} />} label="Patzer pro Partie" sub={`${t.counts.Blunder} in ${plural(t.games, "Partie", "Partien")}`} />}
        >
          <div class="tally-share">
            <StackBar segments={segments} height={18} legend={false} />
          </div>
          <ClassTiles tally={t} />
          <BlunderCostBlock facts={profile.facts} />
        </Hero>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Du gegen deine Gegner</h3>
            <span class="tile-sub">dieselben Partien</span>
          </div>
          {t.opponents ? (
            <VersusBars
              a={{ label: "Du", moves: t.moves, counts: t.counts }}
              b={{ label: "Gegner", moves: t.opponents.moves, counts: t.opponents.counts }}
              keys={["Brilliant", "Great", "Best", "Inaccuracy", "Mistake", "Miss", "Blunder"]}
            />
          ) : (
            <p class="muted small">Für die Gegner fehlen gespeicherte Bewertungen.</p>
          )}
        </section>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Was die Zahlen zeigen</h3>
            <span class="tile-sub">nur was viele Züge klar belegen</span>
          </div>
          {t.findings.length ? (
            <div class="insights">
              {t.findings.map((f) => (
                <div class={`insight ${f.tone}`} key={f.key}>
                  <div class="t">{f.title}</div>
                  <div class="small">{f.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <p class="muted small">
              Noch kein klarer Unterschied zu den Gegnern, zwischen den Partiephasen oder zu früher. Genannt wird nur, was mindestens{" "}
              {MIN_BUCKET_MOVES} Züge pro Gruppe zeigen und kein Zufall sein kann.
            </p>
          )}
        </section>

        <Section section={sec("verlauf")}>
          <section class="card tile span-12">
            <div class="tile-head">
              <h3>Zugqualität im Verlauf</h3>
              <span class="tile-sub">pro Monat · Monate ab {MIN_TREND_MOVES} Zügen</span>
            </div>
            {months.length >= 2 ? (
              <div class="trend-pair">
                <div>
                  <div class="kpi-label">Bester Zug oder besser</div>
                  <AreaChart points={topPoints} format={(v) => `${Math.round(v)} %`} height={170} />
                </div>
                <div>
                  <div class="kpi-label">Grobe Fehler je 100 Züge</div>
                  <AreaChart points={errPoints} format={(v) => de(v)} height={170} color="var(--blunder)" />
                </div>
              </div>
            ) : (
              <p class="muted small">Für einen Verlauf braucht es analysierte Partien aus mindestens zwei Monaten.</p>
            )}
            <p class="small faint tile-foot">Links soll die Kurve steigen, rechts fallen. Grobe Fehler sind Fehler, verpasste Chancen und Patzer.</p>
          </section>
        </Section>

        <Section section={sec("phasen")}>
          <section class="card tile span-6">
            <div class="tile-head">
              <h3>Genauigkeit nach Phase</h3>
            </div>
            <BarList rows={phaseRows} referenceLabel={typicalLabel} />
          </section>

          <section class="card tile span-6">
            <div class="tile-head">
              <h3>Nach Partiephase</h3>
              <span class="tile-sub">alle Bewertungen je Phase</span>
            </div>
            <div class="phase-tally">
              {t.phases
                .filter((p) => p.moves)
                .map((p) => {
                  const serious = sumOf(p.counts, SERIOUS_CLASSES);
                  return (
                    <div key={p.key} style={{ opacity: p.moves < MIN_BUCKET_MOVES ? 0.55 : 1 }}>
                      <div class="bar-head">
                        <span class="bar-label">{p.label}</span>
                        <span class="faint small tnum">{plural(p.moves, "Zug", "Züge")}</span>
                      </div>
                      <StackBar segments={detailSegments(p.counts)} legend={false} height={12} />
                      <div class="bar-note">
                        {de((serious / p.moves) * 100)} grobe Fehler pro 100 Züge {PHASE_IN[p.key] ?? ""}
                        {p.counts.Brilliant + p.counts.Great ? ` · ${p.counts.Brilliant + p.counts.Great} Glanzzüge` : ""}
                      </div>
                    </div>
                  );
                })}
            </div>
            <TallyLegend />
          </section>
        </Section>

        {profile.deep && (
          <Section section={sec("fehler")}>
            <ErrorTiles d={profile.deep} />
          </Section>
        )}

        <Section section={sec("glanz")}>
          <section class="card tile span-12">
            <div class="tile-head">
              <h3>Rekorde</h3>
            </div>
            <Records t={t} />
          </section>

          <section class="card tile span-6">
            <div class="tile-head">
              <h3>Deine Glanzzüge</h3>
              <span class="tile-sub">brillant und großartig · neueste zuerst</span>
            </div>
            {t.highlights.length ? (
              <div class="op-games">
                {t.highlights.slice(0, allHighlights ? undefined : HIGHLIGHTS_SHOWN).map((m) => (
                  <button
                    key={`${m.game_id}-${m.ply_index}`}
                    class="op-game hl-move"
                    onClick={() => navigate({ view: "analysis", gameId: m.game_id, ply: m.ply_index + 1 })}
                  >
                    <ClassBadge c={m.classification} size={22} />
                    <span class="op-opp">
                      <strong>{m.move}</strong>
                      <span class="faint"> gegen {m.opponent}</span>
                    </span>
                    <span class="faint small">{formatDate(m.date)}</span>
                    <span class="small op-acc">{PHASE_IN[m.phase]?.replace(/^(in der|im) /, "") ?? ""}</span>
                  </button>
                ))}
                {t.highlights.length > HIGHLIGHTS_SHOWN && (
                  <button class="btn small tile-foot-btn" onClick={() => setAllHighlights((v) => !v)}>
                    {allHighlights ? "Weniger anzeigen" : `Alle ${t.highlights.length} anzeigen`}
                  </button>
                )}
              </div>
            ) : (
              <p class="muted small">
                Noch keine brillanten oder großartigen Züge. Sie erscheinen hier, sobald du einen findest.
              </p>
            )}
          </section>

          <section class="card tile span-6">
            <div class="tile-head">
              <h3>Deine glänzendsten Partien</h3>
              <span class="tile-sub">meiste Glanzzüge</span>
            </div>
            {t.top_games.length ? (
              <div class="op-games">
                {t.top_games.map((g) => (
                  <button key={g.game_id} class="op-game hl-game" onClick={() => navigate({ view: "analysis", gameId: g.game_id })}>
                    <span class="hl-count">
                      {g.brilliant > 0 && (
                        <span>
                          <ClassBadge c="Brilliant" size={16} /> {g.brilliant}
                        </span>
                      )}
                      {g.great > 0 && (
                        <span>
                          <ClassBadge c="Great" size={16} /> {g.great}
                        </span>
                      )}
                    </span>
                    <span class="op-opp">gegen {g.opponent}</span>
                    <span class="faint small">{formatDate(g.date)}</span>
                    <span class="small op-acc tnum">{de(g.accuracy, 0)} %</span>
                  </button>
                ))}
              </div>
            ) : (
              <p class="muted small">Sobald eine Partie einen Glanzzug hat, steht sie hier.</p>
            )}
          </section>
        </Section>
      </div>
    </div>
  );
}
