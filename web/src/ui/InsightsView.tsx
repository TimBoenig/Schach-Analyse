import {
  type DeepInsights,
  type GameTypeStat,
  type MoveBucket,
  type PrecisionStats,
  type ScoreBucket,
  type ScoreStat,
} from "../domain/profile";
import { MIN_BUCKET_MOVES, MIN_GROUP_GAMES } from "../domain/profile/evidence";
import { AreaChart, BarList, ColumnChart, StackBar } from "./charts";
import type { BarRow, Column } from "./charts";
import { IconSpark } from "./icons";
import { CountUp, Foot, Hero, HeroStat, WdlBar } from "./kit";
import { balanceText } from "./labels";
import { navigate } from "./router";
import { ConditionFinder } from "./stats/Lab";
import { NeedNames } from "./Coach";
import { PageHeader } from "./Layout";
import { GuideButton, usePageGuide } from "./stage/PageGuide";
import { type InsightsSection, Section, SectionHead, SectionJump, sectionOf, STAT_SECTIONS } from "./StatsLayout";
import { useNarrow } from "./useNarrow";
import { FilterBar, filtersActive, useProfile } from "./useProfile";
import { t, tj } from "../i18n";

// Buckets below these sizes are drawn faint: the numbers are real but too thin
// for conclusions (the same limits the findings use).
const MIN_GAMES = MIN_GROUP_GAMES;
const MIN_MOVES = MIN_BUCKET_MOVES;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "± 12" for a 95 % margin, shown next to a sample size so thin numbers read as such. */
const pm = (margin: number | null) => (margin !== null ? ` · ±${Math.round(margin)}` : "");

function scoreColumns(buckets: (ScoreBucket | ScoreStat)[]): Column[] {
  return buckets.map((b) => ({
    label: b.label.split(" (")[0],
    value: b.games ? b.score_pct : null,
    valueText: b.score_pct !== null && b.games ? `${Math.round(b.score_pct)} %` : undefined,
    sub: `${plural(b.games, t("Partie"), t("Partien"))}${pm(b.margin)}`,
    faint: b.games < MIN_GAMES,
  }));
}

/** Score buckets as horizontal bars against the overall score (easier to compare than lone columns). */
function scoreRows(buckets: (ScoreBucket | ScoreStat)[], overall: number): BarRow[] {
  return buckets
    .filter((b) => b.games > 0)
    .map((b) => ({
      label: b.label.split(" (")[0],
      value: b.score_pct,
      reference: overall,
      valueText: b.score_pct !== null ? `${Math.round(b.score_pct)} %` : "–",
      note: `${plural(b.games, t("Partie"), t("Partien"))}${pm(b.margin)}`,
      faint: b.games < MIN_GAMES,
    }));
}

const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits).replace(".", ",")}`;

function typeRows(types: GameTypeStat[], overall: number): BarRow[] {
  return types.map((tk) => ({
    label: tk.label,
    value: tk.score_pct,
    reference: overall,
    valueText: tk.score_pct !== null ? `${Math.round(tk.score_pct)} %` : "–",
    note: `${plural(tk.games, t("Partie"), t("Partien"))}${pm(tk.margin)}${tk.accuracy !== null ? t(" · Genauigkeit {0} %", { 0: Math.round(tk.accuracy) }) : ""}${tk.description ? ` · ${tk.description}` : ""}`,
    faint: tk.games < MIN_GAMES,
  }));
}

const fmtChange = (v: number, unit: string) => (unit ? `${v.toFixed(1).replace(".", ",")} ${unit}` : v.toFixed(2).replace(".", ","));

/** Development over time: accuracy per block of games and a before/after test per metric. */
function EvolutionTiles({ d }: { d: DeepInsights }) {
  const evo = d.evolution;
  const points = evo.blocks
    .filter((b) => b.accuracy !== null)
    .map((b) => ({ label: b.label.split("–")[0], value: b.accuracy as number, detail: `${b.label} · ${plural(b.games, t("Partie"), t("Partien"))}` }));
  const phaseRow = (label: string, pick: (b: (typeof evo.blocks)[number]) => number | null) => (
    <tr>
      <th>{label}</th>
      {evo.blocks.map((b, i) => {
        const v = pick(b);
        const prev = i > 0 ? pick(evo.blocks[i - 1]) : null;
        const tone = v !== null && prev !== null ? (v < prev - 0.5 ? "ok" : v > prev + 0.5 ? "bad" : "") : "";
        return (
          <td key={i} class={`tnum ${tone}`}>
            {v !== null ? v.toFixed(1).replace(".", ",") : "–"}
          </td>
        );
      })}
    </tr>
  );
  return (
    <>
      <Tile title={t("Deine Entwicklung")} sub={evo.blocks.length ? t("Genauigkeit in {length} Abschnitten deiner Partien", { length: evo.blocks.length }) : undefined} span={8}>
        {points.length >= 2 ? (
          <>
            <AreaChart points={points} format={(v) => `${Math.round(v)} %`} height={200} />
            <div class="table-scroll">
              <table class="evo-table">
                <thead>
                  <tr>
                    <th>{t("Schwere Fehler je 100 Züge")}</th>
                    {evo.blocks.map((b, i) => (
                      <th key={i} class="tnum">
                        {b.label.split("–")[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t("{phaseRow}{phaseRow2}{phaseRow3}", { phaseRow: phaseRow(t("Eröffnung"), (b) => b.opening_errors), phaseRow2: phaseRow(t("Mittelspiel"), (b) => b.middlegame_errors), phaseRow3: phaseRow(t("Endspiel"), (b) => b.endgame_errors) })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p class="muted small">{t("Ab etwa zehn analysierten Partien siehst du hier, wie sich dein Spiel entwickelt.")}</p>
        )}
      </Tile>
      <Tile title={t("Was sich verändert hat")} sub={evo.half ? t("letzte {half} gegen die {half2} davor", { half: evo.half, half2: evo.half }) : undefined} span={4}>
        {evo.changes.length ? (
          <ul class="change-list">
            {evo.changes.map((c) => (
              <li key={c.key} class={c.significant ? (c.improved ? "up" : "down") : "flat"}>
                <span class="change-icon" aria-hidden="true">
                  {c.significant ? (c.improved ? "▲" : "▼") : "•"}
                </span>
                <span class="change-label">
                  {c.label}
                  <span class="faint small">
                    {fmtChange(c.earlier, c.unit)} → {fmtChange(c.recent, c.unit)}
                  </span>
                </span>
                <span class="change-tag small">{c.significant ? (c.improved ? "besser" : "schlechter") : t("im Rauschen")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">{t("Für einen belastbaren Vorher-nachher-Vergleich braucht es mindestens zehn analysierte Partien.")}</p>
        )}
        <Foot>{t("„Besser“ oder „schlechter“ steht nur da, wo der Unterschied größer ist als normale Schwankung.")}</Foot>
      </Tile>

    </>
  );
}

/** Score against the Elo expectation, game curve, consistency and turnarounds, as separate tiles for the sections. */
function precisionTiles(p: PrecisionStats, overall: number) {
  const ratingRows: BarRow[] = p.by_rating_diff
    .filter((b) => b.games > 0)
    .map((b) => ({
      label: b.label,
      value: b.score_pct,
      reference: b.expected_pct,
      valueText: b.score_pct !== null ? `${Math.round(b.score_pct)} %` : "–",
      note: t("{plural}{pm} · erwartet {2} %{3}", { plural: plural(b.games, t("Partie"), t("Partien")), pm: pm(b.margin), 2: b.expected_pct !== null ? Math.round(b.expected_pct) : "–", 3: b.avg_diff !== null ? t(" · Ø {0}{avg_diff} Elo", { 0: b.avg_diff > 0 ? "+" : "", avg_diff: b.avg_diff }) : "" }),
      color: b.score_pct !== null && b.expected_pct !== null ? (b.score_pct >= b.expected_pct ? "var(--win)" : "var(--loss)") : undefined,
      faint: b.games < MIN_GAMES,
    }));
  const curve = p.curve.map((c) => ({ label: String(c.move), value: c.avg_wp, detail: t("Zug {move} · {plural}", { move: c.move, plural: plural(c.games, t("Partie"), t("Partien")) }) }));
  const s = p.spread;
  const tk = p.turnarounds;
  const resultRows: BarRow[] = s.by_result
    .filter((r) => r.games > 0)
    .map((r) => ({
      label: r.label,
      value: r.accuracy,
      valueText: r.accuracy !== null ? `${r.accuracy.toFixed(1).replace(".", ",")} %` : "–",
      note: plural(r.games, t("Partie"), t("Partien")),
      color: r.key === "win" ? "var(--win)" : r.key === "loss" ? "var(--loss)" : "var(--draw)",
      faint: r.games < MIN_GAMES,
    }));
  return {
    expectation: (
      <Tile
        title={t("Gegen die Erwartung")}
        sub={p.vs_expectation !== null ? t("{signed} Prozentpunkte gegenüber der Elo-Erwartung", { signed: signed(p.vs_expectation) }) : t("braucht Wertungen")}
        span={6}
      >
        {ratingRows.length ? (
          <>
            <BarList rows={ratingRows} referenceLabel={t("Elo-Erwartung")} />
            <Foot>
              
              {t("Grün: mehr Punkte, als die Wertungsdifferenz erwarten lässt. Aus {n} mit beiden Wertungen.", { n: plural(p.rated_games, t("Partie"), t("Partien")) })}
            </Foot>
          </>
        ) : (
          <p class="muted small">{t("Deine Partien enthalten keine Wertungen beider Spieler.")}</p>
        )}
      </Tile>
    ),
    curve: (
      <Tile title={t("Wo deine Partien kippen")} sub={t("Ø Gewinnchance nach Zug")} span={6}>
        <AreaChart points={curve} format={(v) => `${Math.round(v)} %`} domain={[0, 100]} reference={{ value: 50, label: t("Ausgeglichen") }} />
        <Foot>{t("Mittelwert über alle noch laufenden Partien, aus deiner Sicht. Fällt die Kurve, verlierst du in dieser Phase Boden.")}</Foot>
      </Tile>
    ),
    consistency: (
      <Tile title={t("Konstanz")} sub={s.stdev !== null ? t("Streuung ±{0} Punkte", { 0: s.stdev.toFixed(1).replace(".", ",") }) : undefined} span={6}>
        <ColumnChart columns={s.histogram.map((h) => ({ label: h.label, value: h.games }))} format={(v) => String(v)} height={150} />
        {s.median !== null && (
          <p class="small tile-foot">
            
            {tj("Median {x}, die mittlere Hälfte deiner Partien liegt zwischen {n} und {n2} %.", { x: <strong>{s.median.toFixed(1).replace(".", ",")} %</strong>, n: (s.p25 ?? 0).toFixed(0), n2: (s.p75 ?? 0).toFixed(0) })}</p>
        )}
      </Tile>
    ),
    byResult: (
      <Tile title={t("Genauigkeit nach Ergebnis")} sub={t("Durchschnitt")} span={6}>
        <BarList rows={resultRows} />
        <Foot>{t("Ein kleiner Abstand zwischen Sieg und Niederlage heißt: Einzelne Patzer entscheiden deine Partien.")}</Foot>
      </Tile>
    ),
    turnarounds: (
      <Tile title={t("Wendepunkte")} sub={t("ab 75 % Gewinnchance")} span={6}>
        {tk.winning > 0 && (
          <>
            <h4>{t("Aus {n}", { n: plural(tk.winning, t("gewonnener Stellung"), t("gewonnenen Stellungen")) })}</h4>
            <StackBar
              segments={[
                { label: t("Gewonnen"), value: tk.converted, color: "var(--win)" },
                { label: t("Remis"), value: tk.drawn_from_winning, color: "var(--draw)" },
                { label: t("Verloren"), value: tk.lost_from_winning, color: "var(--loss)" },
              ]}
            />
          </>
        )}
        {tk.losing > 0 && (
          <>
            <h4>{t("Aus {n}", { n: plural(tk.losing, t("verlorener Stellung"), t("verlorenen Stellungen")) })}</h4>
            <StackBar
              segments={[
                { label: t("Noch gewonnen"), value: tk.won_from_losing, color: "var(--win)" },
                { label: t("Gerettet (Remis)"), value: tk.saved - tk.won_from_losing, color: "var(--draw)" },
                { label: t("Verloren"), value: tk.losing - tk.saved, color: "var(--loss)" },
              ]}
            />
          </>
        )}
        {!tk.winning && !tk.losing && <p class="muted small">{t("Noch keine klar entschiedenen Stellungen.")}</p>}
      </Tile>
    ),
    length: (
      <Tile title={t("Nach Partielänge")} sub={t("Punkte-Quote")} span={4}>
        <BarList rows={scoreRows(p.by_length, overall)} referenceLabel={t("Dein Schnitt")} />
      </Tile>
    ),
    color: (
      <Tile title={t("Nach Farbe")} sub={t("Punkte-Quote")} span={4}>
        <BarList rows={scoreRows(p.by_color, overall)} referenceLabel={t("Dein Schnitt")} />
        <Foot>{t("± ist der 95-%-Bereich: So weit kann die Quote allein durch Zufall schwanken. Mehr Partien machen ihn kleiner.")}</Foot>
      </Tile>
    ),
  };
}

const de1 = (v: number) => v.toFixed(1).replace(".", ",");
const errorMax = (rows: BarRow[]) => Math.max(5, ...rows.map((r) => r.value ?? 0)) * 1.1;

function errorRows(buckets: MoveBucket[]): BarRow[] {
  return buckets
    .filter((b) => b.moves > 0)
    .map((b) => ({
      label: b.label,
      value: b.per100,
      valueText: b.per100 !== null ? t("{de1} je 100", { de1: de1(b.per100) }) : "–",
      note: `${plural(b.errors, t("Fehler"), t("Fehler"))} in ${plural(b.moves, t("Zug"), t("Zügen"))}`,
      faint: b.moves < MIN_MOVES,
    }));
}

function Tile({ title, sub, span, children }: { title: string; sub?: string; span: 4 | 6 | 8 | 12; children: preact.ComponentChildren }) {
  return (
    <section class={`card tile span-${span}`}>
      <div class="tile-head">
        <h3>{title}</h3>
        {sub && <span class="tile-sub">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

export function InsightsView() {
  const { profile, usernames, loading, error, filters, setFilters } = useProfile({ page: "insights" });
  const narrow = useNarrow();
  const ready = Boolean(profile && profile.total_games > 0);
  usePageGuide("insights", ready);

  const header = <PageHeader toolbar={<FilterBar filters={filters} onChange={setFilters} />} actions={ready ? <GuideButton id="insights" /> : undefined} />;

  if (usernames && !usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what={t("zeige ich dir hier Muster aus deinen Partien.")} />
      </div>
    );
  }
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "140px" }} />
          {[0, 1, 2].map((k) => (
            <div key={k} class="skeleton span-4" style={{ height: "320px" }} />
          ))}
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
  const d = profile?.deep;
  if (!profile || !d) {
    return (
      <div>
        {header}
        <div class="empty">
          <p>
            {profile && profile.total_games
              ? t("Analysiere zuerst ein paar Partien, dann zeigt dir diese Seite, wann, wo und womit du Punkte verlierst.")
              : t("Keine Partien gefunden{0}.", { 0: filtersActive(filters) ? t(" (mit diesen Filtern)") : "" })}
          </p>
          <button class="btn primary" onClick={() => navigate({ view: "games" })}>
            
            {t("Zu den Partien")}
          </button>
        </div>
      </div>
    );
  }

  const overall = profile.overview.score_pct as number;
  const o = profile.overview;
  const rc = profile.rating;
  const expDiff = rc && rc.expected_score !== null ? rc.score - rc.expected_score : null;
  const scoreRef = { value: overall, label: t("Dein Schnitt {0} %", { 0: Math.round(overall) }) };
  const afterRows: BarRow[] = d.after_result
    .filter((b) => b.games > 0)
    .map((b) => ({
      label: b.label,
      value: b.score_pct,
      reference: overall,
      valueText: b.score_pct !== null ? `${Math.round(b.score_pct)} %` : "–",
      note: `${plural(b.games, t("Partie"), t("Partien"))}${b.avg_accuracy ? t(" · Genauigkeit {0} %", { 0: Math.round(b.avg_accuracy) }) : ""}`,
      faint: b.games < MIN_GAMES,
    }));
  const timed = d.by_daytime.reduce((s, b) => s + b.games, 0);
  const thinkCols: Column[] = d.by_think_time.map((b) => ({
    label: b.label,
    value: b.per100,
    valueText: b.per100 !== null ? de1(b.per100) : undefined,
    sub: plural(b.moves, t("Zug"), t("Züge")),
    faint: b.moves < MIN_MOVES,
  }));
  const clocked = d.by_think_time.some((b) => b.moves > 0);
  const pressureRows = [...errorRows(d.time_trouble), ...errorRows(d.after_book)];
  const rowsMax = errorMax;

  const sec = (id: InsightsSection) => sectionOf("insights", id);
  const pt = precisionTiles(d.precision, overall);
  // Seven weekdays as columns leave no room for "32 Partien · ±16" under each
  // on a phone; there the same buckets are rows with the note beside them.
  const scoreChart = (buckets: (ScoreBucket | ScoreStat)[]) =>
    narrow ? <BarList rows={scoreRows(buckets, overall)} referenceLabel={t("Dein Schnitt")} /> : <ColumnChart columns={scoreColumns(buckets)} max={100} reference={scoreRef} />;

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <SectionJump sections={STAT_SECTIONS.insights} />
      <div class="dash">
        <SectionHead section={sec("blick")} quiet />
        <Hero
          kicker={t("Ergebnisse · {plural}", { plural: plural(o.games, t("Partie"), t("Partien")) })}
          title={
            <>
              
              {t("Du holst")} <CountUp value={overall} format={(v) => `${Math.round(v)}\u00a0%`} />  {t("der Punkte")}
            </>
          }
          sub={
            <>
              {t("{balanceText}{n}", { balanceText: balanceText(o.wins, o.draws, o.losses), n: expDiff !== null && Math.abs(expDiff) >= 0.5
                ? (expDiff > 0 ? t(" · {de1} Punkte mehr, als deine Wertung erwarten lässt", { de1: de1(Math.abs(expDiff)) }) : t(" · {de1} Punkte weniger, als deine Wertung erwarten lässt", { de1: de1(Math.abs(expDiff)) }))
                : expDiff !== null
                  ? t(" · genau so viele Punkte, wie deine Wertung erwarten lässt")
                  : "" })}
            </>
          }
          aside={
            rc?.performance ? (
              <HeroStat big={<CountUp value={rc.performance} />} label={t("Performance")} sub={t("so stark waren deine Ergebnisse · Wertung {rating}", { rating: rc.rating })} />
            ) : undefined
          }
        >
          <WdlBar wins={o.wins} draws={o.draws} losses={o.losses} />
          {profile.facts.length > 0 && <ConditionFinder facts={profile.facts} />}
        </Hero>
        {d.feedback.length > 0 && (
          <section class="card tile span-12 feedback-card">
            <div class="tile-head">
              <h3>
                <IconSpark />  {t("Dein persönliches Feedback")}
              </h3>
              <span class="tile-sub">{t("aus deinen eigenen Partien berechnet")}</span>
            </div>
            <ul class="feedback-list">
              {d.feedback.map((f) => (
                <li key={f.title + f.text} class={`tone-${f.tone}`}>
                  <strong>{f.title}</strong> {f.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section class="card tile span-12 facts-card">
          <div class="tile-head">
            <h3>{t("Das Wichtigste auf einen Blick")}</h3>
            <span class="tile-sub">{t("aus {n}", { n: plural(profile.analyzed_games, t("analysierten Partie"), t("analysierten Partien")) })}</span>
            <span class="spacer" />
            <button class="btn small" onClick={() => navigate({ view: "training" })}>
              
              {t("Zum Trainingsplan")}
            </button>
          </div>
          {d.facts.length ? (
            <ol class="fact-list">
              {d.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
          ) : (
            <p class="muted small" style={{ margin: 0 }}>
              
              {t("Noch keine deutlichen Auffälligkeiten. Mit mehr analysierten Partien (ab etwa 20) werden die Befunde belastbarer.")}
            </p>
          )}
        </section>

        <Section section={sec("entwicklung")}>
          <EvolutionTiles d={d} />
        </Section>

        <Section section={sec("ergebnisse")}>
          {pt.expectation}
          <Tile title={t("Nach Partietyp")} sub={t("Punkte-Quote")} span={6}>
            {d.game_types.length ? (
              <BarList rows={typeRows(d.game_types, overall)} referenceLabel={t("Dein Schnitt")} />
            ) : (
              <p class="muted small">{t("Analysiere ein paar Partien, dann erkennt die App, welche Art von Partie dir liegt.")}</p>
            )}
          </Tile>
          <Tile title={t("Nach Bedenkzeit")} sub={t("Punkte-Quote")} span={4}>
            <BarList rows={typeRows(d.speeds, overall)} referenceLabel={t("Dein Schnitt")} />
          </Tile>
          {pt.color}
          {pt.length}
        </Section>

        <Section section={sec("verlauf")}>
          {pt.curve}
          {pt.turnarounds}
          {pt.consistency}
          {pt.byResult}
        </Section>

        <Section section={sec("gewohnheiten")}>
          <Tile title={t("Bedenkzeit pro Zug")} sub={t("schwere Fehler je 100 Züge")} span={6}>
            {clocked ? (
              <ColumnChart columns={thinkCols} />
            ) : (
              <p class="muted small">{t("Deine Partien enthalten keine Uhrzeiten pro Zug ([%clk]).")}</p>
            )}
          </Tile>

          <Tile title={t("Unter Druck")} sub={t("schwere Fehler je 100 Züge")} span={6}>
            {pressureRows.length ? (
              <BarList rows={pressureRows} max={rowsMax(pressureRows)} />
            ) : (
              <p class="muted small">{t("Für Zeitnot braucht es Uhrzeiten, für die Theorie analysierte Partien.")}</p>
            )}
          </Tile>

          <Tile title={t("Tageszeit")} sub={t("Punkte-Quote")} span={6}>
            {timed ? (
              scoreChart(d.by_daytime)
            ) : (
              <p class="muted small">{t("Deine Partien enthalten keine Uhrzeit. Bei Chess.com und Lichess ist sie dabei.")}</p>
            )}
          </Tile>

          <Tile title={t("Wochentag")} sub={t("Punkte-Quote")} span={6}>
            {timed ? (
              scoreChart(d.by_weekday)
            ) : (
              <p class="muted small">{t("Deine Partien enthalten keine Uhrzeit.")}</p>
            )}
          </Tile>

          <Tile title={t("Nach dem letzten Ergebnis")} sub={t("Tilt-Check")} span={6}>
            {afterRows.length ? (
              <BarList rows={afterRows} referenceLabel={t("Dein Schnitt")} />
            ) : (
              <p class="muted small">{t("Noch keine Partien direkt hintereinander gespielt (Abstand unter zwei Stunden).")}</p>
            )}
          </Tile>

          <Tile title={t("Partie in der Serie")} sub={t("Punkte-Quote")} span={6}>
            {d.by_session_game.some((b) => b.games) ? (
              scoreChart(d.by_session_game)
            ) : (
              <p class="muted small">{t("Für Serien braucht es Partien mit Uhrzeit.")}</p>
            )}
          </Tile>
        </Section>
      </div>
    </div>
  );
}
