import { PROFILE_QUESTIONS, profileCoachMessages, type ScoreBucket } from "../domain/profile";
import { AiChat } from "./AiCoach";
import { BarList, ColumnChart, SquareHeatmap } from "./charts";
import type { BarRow, Column } from "./charts";
import { IconSpark } from "./icons";
import { navigate } from "./router";
import { FilterBar, filtersActive, useProfile } from "./useProfile";

// Buckets below these sizes are drawn faint: the numbers are real but thin.
const MIN_GAMES = 4;
const MIN_MOVES = 30;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function scoreColumns(buckets: ScoreBucket[]): Column[] {
  return buckets.map((b) => ({
    label: b.label.split(" (")[0],
    value: b.games ? b.score_pct : null,
    valueText: b.score_pct !== null && b.games ? `${Math.round(b.score_pct)} %` : undefined,
    sub: plural(b.games, "Partie", "Partien"),
    faint: b.games < MIN_GAMES,
  }));
}

function Tile({ title, sub, span, children }: { title: string; sub?: string; span: 4 | 6 | 12; children: preact.ComponentChildren }) {
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

  const header = (
    <>
      <div class="page-title">Einblicke</div>
      <FilterBar filters={filters} onChange={setFilters} />
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div>
        <div class="page-title">Einblicke</div>
        <div class="empty">
          <p>Trage zuerst deine Spielernamen ein, damit die App deine Partien erkennt.</p>
          <button class="btn primary" onClick={() => navigate({ view: "settings" })}>
            Zu den Einstellungen
          </button>
        </div>
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
  const scoreRef = { value: overall, label: `Dein Schnitt ${Math.round(overall)} %` };
  const moveCols: Column[] = d.by_move_number.map((b) => ({
    label: `Zug ${b.label}`,
    value: b.per100,
    valueText: b.per100 !== null ? b.per100.toFixed(1).replace(".", ",") : undefined,
    sub: plural(b.moves, "Zug", "Züge"),
    faint: b.moves < MIN_MOVES,
  }));
  const pieceRows: BarRow[] = d.by_piece
    .filter((b) => b.moves > 0)
    .map((b) => ({
      label: b.label,
      value: b.per100,
      valueText: b.per100 !== null ? `${b.per100.toFixed(1).replace(".", ",")} je 100` : "–",
      note: `${plural(b.errors, "Fehler", "Fehler")} in ${plural(b.moves, "Zug", "Zügen")}`,
      faint: b.moves < MIN_MOVES,
    }));
  const pieceMax = Math.max(5, ...pieceRows.map((r) => r.value ?? 0)) * 1.1;
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

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <div class="dash">
        <section class="card tile span-12 facts-card">
          <div class="tile-head">
            <h3>Das Wichtigste auf einen Blick</h3>
            <span class="tile-sub">aus {plural(profile.analyzed_games, "analysierten Partie", "analysierten Partien")}</span>
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

        <Tile title="Fehler-Landkarte" sub={`${d.error_total} schwere Fehler`} span={4}>
          <SquareHeatmap values={d.error_squares} />
          {d.hot_squares.length > 0 && (
            <p class="small muted tile-foot">
              Am häufigsten: {d.hot_squares.map((h) => `${h.square} (${h.count})`).join(", ")}. Gezählt wird das Zielfeld
              deines Zuges.
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

        <Tile title="Tageszeit" sub="Punkte-Quote" span={6}>
          {timed ? (
            <ColumnChart columns={scoreColumns(d.by_daytime)} max={100} reference={scoreRef} />
          ) : (
            <p class="muted small">Deine Partien enthalten keine Uhrzeit. Bei Chess.com und Lichess ist sie dabei.</p>
          )}
        </Tile>

        <Tile title="Wochentag" sub="Punkte-Quote" span={6}>
          {timed ? (
            <ColumnChart columns={scoreColumns(d.by_weekday)} max={100} reference={scoreRef} />
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
            <ColumnChart columns={scoreColumns(d.by_session_game)} max={100} reference={scoreRef} />
          ) : (
            <p class="muted small">Für Serien braucht es Partien mit Uhrzeit.</p>
          )}
        </Tile>

        <section class="card tile span-12">
          <div class="tile-head">
            <h3>
              <IconSpark /> Frag den KI-Coach
            </h3>
            <span class="tile-sub">kennt dein Profil und diese Einblicke</span>
          </div>
          <AiChat build={(history, q) => profileCoachMessages(profile, history, q)} suggestions={PROFILE_QUESTIONS} />
        </section>
      </div>
    </div>
  );
}
