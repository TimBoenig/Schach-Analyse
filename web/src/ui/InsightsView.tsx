import {
  type DeepInsights,
  type GameTypeStat,
  type MoveBucket,
  type PrecisionStats,
  type ScoreBucket,
  type ScoreStat,
} from "../domain/profile";
import { MIN_BUCKET_MOVES, MIN_GROUP_GAMES } from "../domain/profile/evidence";
import { AreaChart, BarList, ColumnChart, SquareHeatmap, StackBar } from "./charts";
import type { BarRow, Column } from "./charts";
import { trClassification } from "../domain/i18n";
import { IconSpark } from "./icons";
import { CountUp, Hero, HeroStat, WdlBar } from "./kit";
import { balanceText } from "./labels";
import { navigate } from "./router";
import { ConditionFinder } from "./stats/Lab";
import { NeedNames } from "./Coach";
import { PageHeader } from "./Layout";
import { type InsightsSection, Section, SectionHead, SectionNav, sectionOf, STAT_SECTIONS } from "./StatsLayout";
import { useNarrow } from "./useNarrow";
import { FilterBar, filtersActive, useProfile } from "./useProfile";

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
    sub: `${plural(b.games, "Partie", "Partien")}${pm(b.margin)}`,
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
      note: `${plural(b.games, "Partie", "Partien")}${pm(b.margin)}`,
      faint: b.games < MIN_GAMES,
    }));
}

const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits).replace(".", ",")}`;

function typeRows(types: GameTypeStat[], overall: number): BarRow[] {
  return types.map((t) => ({
    label: t.label,
    value: t.score_pct,
    reference: overall,
    valueText: t.score_pct !== null ? `${Math.round(t.score_pct)} %` : "–",
    note: `${plural(t.games, "Partie", "Partien")}${pm(t.margin)}${t.accuracy !== null ? ` · Genauigkeit ${Math.round(t.accuracy)} %` : ""}${t.description ? ` · ${t.description}` : ""}`,
    faint: t.games < MIN_GAMES,
  }));
}

const fmtChange = (v: number, unit: string) => (unit ? `${v.toFixed(1).replace(".", ",")} ${unit}` : v.toFixed(2).replace(".", ","));

/** Development over time: accuracy per block of games and a before/after test per metric. */
function EvolutionTiles({ d }: { d: DeepInsights }) {
  const evo = d.evolution;
  const points = evo.blocks
    .filter((b) => b.accuracy !== null)
    .map((b) => ({ label: b.label.split("–")[0], value: b.accuracy as number, detail: `${b.label} · ${plural(b.games, "Partie", "Partien")}` }));
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
      <Tile title="Deine Entwicklung" sub={evo.blocks.length ? `Genauigkeit in ${evo.blocks.length} Abschnitten deiner Partien` : undefined} span={8}>
        {points.length >= 2 ? (
          <>
            <AreaChart points={points} format={(v) => `${Math.round(v)} %`} height={200} />
            <div class="table-scroll">
              <table class="evo-table">
                <thead>
                  <tr>
                    <th>Schwere Fehler je 100 Züge</th>
                    {evo.blocks.map((b, i) => (
                      <th key={i} class="tnum">
                        {b.label.split("–")[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {phaseRow("Eröffnung", (b) => b.opening_errors)}
                  {phaseRow("Mittelspiel", (b) => b.middlegame_errors)}
                  {phaseRow("Endspiel", (b) => b.endgame_errors)}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p class="muted small">Ab etwa zehn analysierten Partien siehst du hier, wie sich dein Spiel entwickelt.</p>
        )}
      </Tile>
      <Tile title="Was sich verändert hat" sub={evo.half ? `letzte ${evo.half} gegen die ${evo.half} davor` : undefined} span={4}>
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
                <span class="change-tag small">{c.significant ? (c.improved ? "besser" : "schlechter") : "im Rauschen"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">Für einen belastbaren Vorher-nachher-Vergleich braucht es mindestens zehn analysierte Partien.</p>
        )}
        <p class="small faint tile-foot">„Besser“ oder „schlechter“ steht nur da, wo der Unterschied größer ist als normale Schwankung.</p>
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
      note: `${plural(b.games, "Partie", "Partien")}${pm(b.margin)} · erwartet ${b.expected_pct !== null ? Math.round(b.expected_pct) : "–"} %${b.avg_diff !== null ? ` · Ø ${b.avg_diff > 0 ? "+" : ""}${b.avg_diff} Elo` : ""}`,
      color: b.score_pct !== null && b.expected_pct !== null ? (b.score_pct >= b.expected_pct ? "var(--win)" : "var(--loss)") : undefined,
      faint: b.games < MIN_GAMES,
    }));
  const curve = p.curve.map((c) => ({ label: String(c.move), value: c.avg_wp, detail: `Zug ${c.move} · ${plural(c.games, "Partie", "Partien")}` }));
  const s = p.spread;
  const t = p.turnarounds;
  const resultRows: BarRow[] = s.by_result
    .filter((r) => r.games > 0)
    .map((r) => ({
      label: r.label,
      value: r.accuracy,
      valueText: r.accuracy !== null ? `${r.accuracy.toFixed(1).replace(".", ",")} %` : "–",
      note: plural(r.games, "Partie", "Partien"),
      color: r.key === "win" ? "var(--win)" : r.key === "loss" ? "var(--loss)" : "var(--draw)",
      faint: r.games < MIN_GAMES,
    }));
  return {
    expectation: (
      <Tile
        title="Gegen die Erwartung"
        sub={p.vs_expectation !== null ? `${signed(p.vs_expectation)} Prozentpunkte gegenüber der Elo-Erwartung` : "braucht Wertungen"}
        span={6}
      >
        {ratingRows.length ? (
          <>
            <BarList rows={ratingRows} referenceLabel="Elo-Erwartung" />
            <p class="small faint tile-foot">
              Grün: mehr Punkte, als die Wertungsdifferenz erwarten lässt. Aus {plural(p.rated_games, "Partie", "Partien")} mit beiden Wertungen.
            </p>
          </>
        ) : (
          <p class="muted small">Deine Partien enthalten keine Wertungen beider Spieler.</p>
        )}
      </Tile>
    ),
    curve: (
      <Tile title="Wo deine Partien kippen" sub="Ø Gewinnchance nach Zug" span={6}>
        <AreaChart points={curve} format={(v) => `${Math.round(v)} %`} domain={[0, 100]} reference={{ value: 50, label: "Ausgeglichen" }} />
        <p class="small faint tile-foot">Mittelwert über alle noch laufenden Partien, aus deiner Sicht. Fällt die Kurve, verlierst du in dieser Phase Boden.</p>
      </Tile>
    ),
    consistency: (
      <Tile title="Konstanz" sub={s.stdev !== null ? `Streuung ±${s.stdev.toFixed(1).replace(".", ",")} Punkte` : undefined} span={6}>
        <ColumnChart columns={s.histogram.map((h) => ({ label: h.label, value: h.games }))} format={(v) => String(v)} height={150} />
        {s.median !== null && (
          <p class="small tile-foot">
            Median <strong>{s.median.toFixed(1).replace(".", ",")} %</strong>, die mittlere Hälfte deiner Partien liegt zwischen{" "}
            {(s.p25 ?? 0).toFixed(0)} und {(s.p75 ?? 0).toFixed(0)} %.
          </p>
        )}
      </Tile>
    ),
    byResult: (
      <Tile title="Genauigkeit nach Ergebnis" sub="Durchschnitt" span={6}>
        <BarList rows={resultRows} />
        <p class="small faint tile-foot">Ein kleiner Abstand zwischen Sieg und Niederlage heißt: Einzelne Patzer entscheiden deine Partien.</p>
      </Tile>
    ),
    turnarounds: (
      <Tile title="Wendepunkte" sub="ab 75 % Gewinnchance" span={6}>
        {t.winning > 0 && (
          <>
            <h4>Aus {plural(t.winning, "gewonnener Stellung", "gewonnenen Stellungen")}</h4>
            <StackBar
              segments={[
                { label: "Gewonnen", value: t.converted, color: "var(--win)" },
                { label: "Remis", value: t.drawn_from_winning, color: "var(--draw)" },
                { label: "Verloren", value: t.lost_from_winning, color: "var(--loss)" },
              ]}
            />
          </>
        )}
        {t.losing > 0 && (
          <>
            <h4>Aus {plural(t.losing, "verlorener Stellung", "verlorenen Stellungen")}</h4>
            <StackBar
              segments={[
                { label: "Noch gewonnen", value: t.won_from_losing, color: "var(--win)" },
                { label: "Gerettet (Remis)", value: t.saved - t.won_from_losing, color: "var(--draw)" },
                { label: "Verloren", value: t.losing - t.saved, color: "var(--loss)" },
              ]}
            />
          </>
        )}
        {!t.winning && !t.losing && <p class="muted small">Noch keine klar entschiedenen Stellungen.</p>}
      </Tile>
    ),
    length: (
      <Tile title="Nach Partielänge" sub="Punkte-Quote" span={4}>
        <BarList rows={scoreRows(p.by_length, overall)} referenceLabel="Dein Schnitt" />
      </Tile>
    ),
    color: (
      <Tile title="Nach Farbe" sub="Punkte-Quote" span={4}>
        <BarList rows={scoreRows(p.by_color, overall)} referenceLabel="Dein Schnitt" />
        <p class="small faint tile-foot">± ist der 95-%-Bereich: So weit kann die Quote allein durch Zufall schwanken. Mehr Partien machen ihn kleiner.</p>
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
      valueText: b.per100 !== null ? `${de1(b.per100)} je 100` : "–",
      note: `${plural(b.errors, "Fehler", "Fehler")} in ${plural(b.moves, "Zug", "Zügen")}`,
      faint: b.moves < MIN_MOVES,
    }));
}

/** Errors: per game, by move number, piece, square and position; lives on "Züge & Fehler". */
export function ErrorTiles({ d }: { d: DeepInsights }) {
  const moveCols: Column[] = d.by_move_number.map((b) => ({
    label: `Zug ${b.label}`,
    value: b.per100,
    valueText: b.per100 !== null ? b.per100.toFixed(1).replace(".", ",") : undefined,
    sub: plural(b.moves, "Zug", "Züge"),
    faint: b.moves < MIN_MOVES,
  }));
  const pieceRows: BarRow[] = errorRows(d.by_piece);
  const pieceMax = Math.max(5, ...pieceRows.map((r) => r.value ?? 0)) * 1.1;
  const situationRows = errorRows(d.by_situation);
  const errorTypeRows: BarRow[] = d.errors_per_game.map((e) => ({
    label: trClassification(e.classification),
    value: e.per_game,
    valueText: `${e.per_game.toFixed(2).replace(".", ",")} pro Partie`,
  }));
  return (
    <>
        <Tile title="Fehler pro Partie" sub="Durchschnitt" span={4}>
          <BarList rows={errorTypeRows} max={Math.max(1, ...errorTypeRows.map((r) => r.value ?? 0)) * 1.15} />
          {d.punish.chances > 0 && (
            <p class="small tile-foot">
              Gegnerfehler bestraft: <strong>{d.punish.rate !== null ? Math.round(d.punish.rate) : 0} %</strong> ({d.punish.punished} von{" "}
              {d.punish.chances}).{" "}
              <button class="link-btn" onClick={() => navigate({ view: "training", tab: "uebungen", category: "chance" })}>
                Chancen nutzen üben
              </button>
            </p>
          )}
        </Tile>

        <Tile title="Wann du patzt" sub="schwere Fehler je 100 Züge" span={4}>
          <ColumnChart columns={moveCols} />
          <p class="small faint tile-foot">Buchzüge zählen nicht mit. Blasse Säulen beruhen auf wenigen Zügen.</p>
        </Tile>

        <Tile title="Fehler nach Figur" sub="schwere Fehler je 100 Züge" span={4}>
          <BarList rows={pieceRows} max={pieceMax} />
        </Tile>

        <Tile title="Fehler-Landkarte" sub={`${d.error_total} schwere Fehler`} span={6}>
          <SquareHeatmap values={d.error_squares} />
          {d.hot_squares.length > 0 && (
            <p class="small muted tile-foot">
              Am häufigsten: {d.hot_squares.map((h) => `${h.square} (${h.count})`).join(", ")}. Gezählt wird das Zielfeld
              deines Zuges.
            </p>
          )}
        </Tile>

        <Tile title="Nach Stellungslage" sub="schwere Fehler je 100 Züge" span={6}>
          <BarList rows={situationRows} max={errorMax(situationRows)} />
          <p class="small faint tile-foot">Gewinnchance vor deinem Zug, aus deiner Sicht.</p>
        </Tile>

    </>
  );
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
  const { profile, usernames, loading, error, filters, setFilters } = useProfile();
  const narrow = useNarrow();

  const header = (
    <>
      <PageHeader toolbar={<FilterBar filters={filters} onChange={setFilters} />} />
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what="zeige ich dir hier Muster aus deinen Partien." />
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
              ? "Analysiere zuerst ein paar Partien, dann zeigt dir diese Seite, wann, wo und womit du Punkte verlierst."
              : `Keine Partien gefunden${filtersActive(filters) ? " (mit diesen Filtern)" : ""}.`}
          </p>
          <button class="btn primary" onClick={() => navigate({ view: "games" })}>
            Zu den Partien
          </button>
        </div>
      </div>
    );
  }

  const overall = profile.overview.score_pct as number;
  const o = profile.overview;
  const rc = profile.rating;
  const expDiff = rc && rc.expected_score !== null ? rc.score - rc.expected_score : null;
  const scoreRef = { value: overall, label: `Dein Schnitt ${Math.round(overall)} %` };
  const afterRows: BarRow[] = d.after_result
    .filter((b) => b.games > 0)
    .map((b) => ({
      label: b.label,
      value: b.score_pct,
      reference: overall,
      valueText: b.score_pct !== null ? `${Math.round(b.score_pct)} %` : "–",
      note: `${plural(b.games, "Partie", "Partien")}${b.avg_accuracy ? ` · Genauigkeit ${Math.round(b.avg_accuracy)} %` : ""}`,
      faint: b.games < MIN_GAMES,
    }));
  const timed = d.by_daytime.reduce((s, b) => s + b.games, 0);
  const thinkCols: Column[] = d.by_think_time.map((b) => ({
    label: b.label,
    value: b.per100,
    valueText: b.per100 !== null ? de1(b.per100) : undefined,
    sub: plural(b.moves, "Zug", "Züge"),
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
    narrow ? <BarList rows={scoreRows(buckets, overall)} referenceLabel="Dein Schnitt" /> : <ColumnChart columns={scoreColumns(buckets)} max={100} reference={scoreRef} />;

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <SectionNav sections={STAT_SECTIONS.insights} />
      <div class="dash">
        <SectionHead section={sec("blick")} quiet />
        <Hero
          kicker={`Ergebnisse · ${plural(o.games, "Partie", "Partien")}`}
          title={
            <>
              Du holst <CountUp value={overall} format={(v) => `${Math.round(v)}\u00a0%`} /> der Punkte
            </>
          }
          sub={
            <>
              {balanceText(o.wins, o.draws, o.losses)}
              {expDiff !== null && Math.abs(expDiff) >= 0.5
                ? ` · ${de1(Math.abs(expDiff))} Punkte ${expDiff > 0 ? "mehr" : "weniger"}, als deine Wertung erwarten lässt`
                : expDiff !== null
                  ? " · genau so viele Punkte, wie deine Wertung erwarten lässt"
                  : ""}
            </>
          }
          aside={
            rc?.performance ? (
              <HeroStat big={<CountUp value={rc.performance} />} label="Performance" sub={`so stark waren deine Ergebnisse · Wertung ${rc.rating}`} />
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
                <IconSpark /> Dein persönliches Feedback
              </h3>
              <span class="tile-sub">aus deinen eigenen Partien berechnet</span>
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
            <h3>Das Wichtigste auf einen Blick</h3>
            <span class="tile-sub">aus {plural(profile.analyzed_games, "analysierten Partie", "analysierten Partien")}</span>
            <span class="spacer" />
            <button class="btn small" onClick={() => navigate({ view: "training" })}>
              Zum Trainingsplan
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
              Noch keine deutlichen Auffälligkeiten. Mit mehr analysierten Partien (ab etwa 20) werden die Befunde
              belastbarer.
            </p>
          )}
        </section>

        <Section section={sec("entwicklung")}>
          <EvolutionTiles d={d} />
        </Section>

        <Section section={sec("ergebnisse")}>
          {pt.expectation}
          <Tile title="Nach Partietyp" sub="Punkte-Quote" span={6}>
            {d.game_types.length ? (
              <BarList rows={typeRows(d.game_types, overall)} referenceLabel="Dein Schnitt" />
            ) : (
              <p class="muted small">Analysiere ein paar Partien, dann erkennt die App, welche Art von Partie dir liegt.</p>
            )}
          </Tile>
          <Tile title="Nach Bedenkzeit" sub="Punkte-Quote" span={4}>
            <BarList rows={typeRows(d.speeds, overall)} referenceLabel="Dein Schnitt" />
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
          <Tile title="Bedenkzeit pro Zug" sub="schwere Fehler je 100 Züge" span={6}>
            {clocked ? (
              <ColumnChart columns={thinkCols} />
            ) : (
              <p class="muted small">Deine Partien enthalten keine Uhrzeiten pro Zug ([%clk]).</p>
            )}
          </Tile>

          <Tile title="Unter Druck" sub="schwere Fehler je 100 Züge" span={6}>
            {pressureRows.length ? (
              <BarList rows={pressureRows} max={rowsMax(pressureRows)} />
            ) : (
              <p class="muted small">Für Zeitnot braucht es Uhrzeiten, für die Theorie analysierte Partien.</p>
            )}
          </Tile>

          <Tile title="Tageszeit" sub="Punkte-Quote" span={6}>
            {timed ? (
              scoreChart(d.by_daytime)
            ) : (
              <p class="muted small">Deine Partien enthalten keine Uhrzeit. Bei Chess.com und Lichess ist sie dabei.</p>
            )}
          </Tile>

          <Tile title="Wochentag" sub="Punkte-Quote" span={6}>
            {timed ? (
              scoreChart(d.by_weekday)
            ) : (
              <p class="muted small">Deine Partien enthalten keine Uhrzeit.</p>
            )}
          </Tile>

          <Tile title="Nach dem letzten Ergebnis" sub="Tilt-Check" span={6}>
            {afterRows.length ? (
              <BarList rows={afterRows} referenceLabel="Dein Schnitt" />
            ) : (
              <p class="muted small">Noch keine Partien direkt hintereinander gespielt (Abstand unter zwei Stunden).</p>
            )}
          </Tile>

          <Tile title="Partie in der Serie" sub="Punkte-Quote" span={6}>
            {d.by_session_game.some((b) => b.games) ? (
              scoreChart(d.by_session_game)
            ) : (
              <p class="muted small">Für Serien braucht es Partien mit Uhrzeit.</p>
            )}
          </Tile>
        </Section>
      </div>
    </div>
  );
}
