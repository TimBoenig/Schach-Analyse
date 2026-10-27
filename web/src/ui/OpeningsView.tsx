import { useState } from "preact/hooks";

import {
  type FirstMoveStat,
  type MoveChoice,
  OPENING_QUESTIONS,
  type OpeningStat,
  openingLabel,
  profileCoachMessages,
} from "../domain/profile";
import { MIN_LINE_GAMES, scoreDeviation } from "../domain/profile/evidence";
import { AiChat, coachDetail } from "./AiCoach";
import { BarList, Legend, StackBar } from "./charts";
import type { BarRow } from "./charts";
import { IconSpark } from "./icons";
import { formatDate } from "./labels";
import { navigate } from "./router";
import { FilterBar, filtersActive, useProfile } from "./useProfile";

// Openings with fewer games than this are drawn faint: real numbers, thin evidence.
const MIN_GAMES = MIN_LINE_GAMES;
const ROWS = 8;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pctText = (v: number | null) => (v === null ? "–" : `${Math.round(v)} %`);
const moveNo = (v: number | null) => (v === null ? "–" : `Zug ${Math.round(v)}`);

const RESULT_LEGEND = [
  { label: "Siege", color: "var(--win)" },
  { label: "Remis", color: "var(--draw)" },
  { label: "Niederlagen", color: "var(--loss)" },
];

function scoreClass(v: number | null): string {
  if (v === null) return "";
  return v >= 55 ? "good" : v < 45 ? "bad" : "";
}

function OpeningDetail({ o, overallWp }: { o: OpeningStat; overallWp: number | null }) {
  return (
    <div class="op-detail">
      <div class="op-kpis">
        <div>
          <span class="faint small">Theorie verlassen</span>
          <strong>{moveNo(o.book_exit_move)}</strong>
        </div>
        <div>
          <span class="faint small">Erster schwerer Fehler</span>
          <strong>{moveNo(o.first_error_move)}</strong>
        </div>
        <div>
          <span class="faint small">Gewinnchance danach</span>
          <strong class={scoreClass(o.wp_after_opening)}>{pctText(o.wp_after_opening)}</strong>
          {overallWp !== null && o.wp_after_opening !== null && (
            <span class="faint small">Schnitt {Math.round(overallWp)} %</span>
          )}
        </div>
        <div>
          <span class="faint small">Bilanz</span>
          <strong>
            {o.wins} / {o.draws} / {o.losses}
          </strong>
          <span class="faint small">S / R / N</span>
        </div>
      </div>
      {o.variations.length > 0 && (
        <p class="small muted op-vars">
          Varianten: {o.variations.map((v) => `${v.name.split(": ")[1] ?? v.name} (${v.games})`).join(" · ")}
        </p>
      )}
      {o.analyzed === 0 && (
        <p class="small faint" style={{ margin: "0 0 8px" }}>
          Analysiere diese Partien, um Genauigkeit, Gewinnchance und Fehler zu sehen.
        </p>
      )}
      <div class="op-games">
        {o.recent.map((g) => (
          <button key={g.id} class="op-game" onClick={() => navigate({ view: "analysis", gameId: g.id })}>
            <span class={`op-result ${g.score === 1 ? "win" : g.score === 0 ? "loss" : g.score === 0.5 ? "draw" : ""}`}>
              {g.score === 1 ? "S" : g.score === 0 ? "N" : g.score === 0.5 ? "R" : "–"}
            </span>
            <span class="op-opp">
              {g.opponent || "Gegner"}
              {g.opp_rating > 0 && <span class="faint"> {g.opp_rating}</span>}
            </span>
            <span class="faint small">{formatDate(g.date)}</span>
            <span class="tnum small op-acc">{g.accuracy !== null ? `${g.accuracy.toFixed(1)}` : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type SortKey = "games" | "score" | "wp" | "error";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "games", label: "Partien" },
  { key: "score", label: "Punkte" },
  { key: "wp", label: "Nach Eröffnung" },
  { key: "error", label: "1. Fehler" },
];

function sortValue(o: OpeningStat, key: SortKey): number {
  if (key === "games") return o.games;
  if (key === "score") return o.score_pct ?? -1;
  if (key === "wp") return o.wp_after_opening ?? -1;
  // Earliest first error is the most urgent, so it sorts to the top.
  return o.first_error_move === null ? -999 : -o.first_error_move;
}

/** One table per colour: every opening on one line, sortable, details on tap. */
function OpeningTable({ lines, overallWp }: { lines: OpeningStat[]; overallWp: number | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<SortKey>("games");
  if (!lines.length) return <p class="muted small">Noch keine Partien mit dieser Farbe.</p>;
  const sorted = [...lines].sort((a, b) => sortValue(b, sort) - sortValue(a, sort) || b.games - a.games);
  const shown = all ? sorted : sorted.slice(0, ROWS);
  return (
    <div class="rep-table" role="table">
      <div class="rep-row rep-header" role="row">
        <span>Eröffnung</span>
        {SORTS.map((c) => (
          <button key={c.key} class={`rep-sort${sort === c.key ? " on" : ""} col-${c.key}`} onClick={() => setSort(c.key)} aria-pressed={sort === c.key}>
            {c.label}
            {sort === c.key ? " ↓" : ""}
          </button>
        ))}
      </div>
      {shown.map((o) => {
        const isOpen = open === o.name;
        return (
          <div key={o.name} class={`rep-item${isOpen ? " open" : ""}${o.games < MIN_GAMES ? " thin" : ""}`}>
            <button class="rep-row" role="row" onClick={() => setOpen(isOpen ? null : o.name)} aria-expanded={isOpen}>
              <span class="rep-name">
                <span class="op-name">
                  {openingLabel(o.name)}
                  {o.eco && <span class="op-eco">{o.eco}</span>}
                </span>
                <StackBar
                  height={6}
                  legend={false}
                  segments={[
                    { label: "Siege", value: o.wins, color: "var(--win)" },
                    { label: "Remis", value: o.draws, color: "var(--draw)" },
                    { label: "Niederlagen", value: o.losses, color: "var(--loss)" },
                  ]}
                />
              </span>
              <span class="tnum col-games">{o.games}</span>
              <span class={`tnum col-score strong ${scoreClass(o.score_pct)}`}>{pctText(o.score_pct)}</span>
              <span class={`tnum col-wp ${scoreClass(o.wp_after_opening)}`}>{pctText(o.wp_after_opening)}</span>
              <span class="tnum col-error faint">{o.first_error_move !== null ? `Zug ${Math.round(o.first_error_move)}` : "–"}</span>
            </button>
            {isOpen && <OpeningDetail o={o} overallWp={overallWp} />}
          </div>
        );
      })}
      {lines.length > ROWS && (
        <button class="btn small ghost" onClick={() => setAll(!all)}>
          {all ? "Weniger anzeigen" : `Alle ${lines.length} anzeigen`}
        </button>
      )}
      <Legend items={RESULT_LEGEND} />
    </div>
  );
}

const choiceRows = (list: MoveChoice[], prefix: string, overall: number | null): BarRow[] =>
  list.slice(0, 6).map((c) => ({
    label: `${prefix}${c.san}`,
    value: c.score_pct,
    reference: overall,
    valueText: pctText(c.score_pct),
    note: plural(c.games, "Partie", "Partien"),
    faint: c.games < MIN_GAMES,
  }));

function BlackReplies({ vs, overall }: { vs: FirstMoveStat[]; overall: number | null }) {
  if (!vs.length) return <p class="muted small">Noch keine Partien mit Schwarz.</p>;
  return (
    <div class="op-vs">
      {vs.slice(0, 4).map((v) => (
        <div key={v.san}>
          <div class="op-vs-head">
            <strong>Gegen 1. {v.san}</strong>
            <span class="faint small">
              {plural(v.games, "Partie", "Partien")} · {pctText(v.score_pct)}
            </span>
          </div>
          <BarList rows={choiceRows(v.replies, "1… ", overall)} />
        </div>
      ))}
    </div>
  );
}

const COLOR_KEY = "schach.openings.color";

function savedColor(): "white" | "black" {
  try {
    return localStorage.getItem(COLOR_KEY) === "black" ? "black" : "white";
  } catch {
    return "white";
  }
}

export function OpeningsView() {
  const { profile, usernames, loading, error, filters, setFilters } = useProfile();
  const [savedPick, setColor] = useState<"white" | "black">(savedColor);
  const [showAllFacts, setShowAllFacts] = useState(false);
  // A colour chosen in the shared filter bar wins, so switch and filter never disagree.
  const filterColor = filters.color === "White" ? "white" : filters.color === "Black" ? "black" : null;
  const color = filterColor ?? savedPick;
  const pickColor = (c: "white" | "black") => {
    setColor(c);
    if (filterColor) setFilters({ ...filters, color: c === "white" ? "White" : "Black" });
    try {
      localStorage.setItem(COLOR_KEY, c);
    } catch {
      // Remembering the tab is a convenience only.
    }
  };

  const header = (
    <>
      <div class="page-title">Eröffnungen</div>
      <FilterBar filters={filters} onChange={setFilters} />
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div>
        <div class="page-title">Eröffnungen</div>
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
          <div class="skeleton span-12" style={{ height: "120px" }} />
          {[0, 1].map((k) => (
            <div key={k} class="skeleton span-6" style={{ height: "420px" }} />
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
  const o = profile?.openings;
  if (!profile || !o || (!o.white.length && !o.black.length)) {
    return (
      <div>
        {header}
        <div class="empty">
          <p>{`Keine Partien gefunden${filtersActive(filters) ? " (mit diesen Filtern)" : ""}.`}</p>
          <button class="btn primary" onClick={() => navigate({ view: "games", import: true })}>
            Partien importieren
          </button>
        </div>
      </div>
    );
  }

  const overall = (profile.overview.score_pct as number | undefined) ?? null;
  const lines = color === "white" ? o.white : o.black;
  const games = lines.reduce((n, l) => n + l.games, 0);
  const points = lines.reduce((n, l) => n + l.wins + l.draws / 2, 0);
  const weighted = (pick: (l: OpeningStat) => number | null) => {
    const withValue = lines.filter((l) => pick(l) !== null && l.analyzed > 0);
    const w = withValue.reduce((n, l) => n + l.analyzed, 0);
    return w ? withValue.reduce((n, l) => n + (pick(l) as number) * l.analyzed, 0) / w : null;
  };
  const wpAfter = weighted((l) => l.wp_after_opening);
  const bookExit = weighted((l) => l.book_exit_move);
  // Only an opening that scores clearly above 50 % counts as the strongest.
  const best = lines
    .filter((l) => scoreDeviation(l, 50) > 0)
    .sort((a, b) => (b.score_pct as number) - (a.score_pct as number))[0];
  const facts = showAllFacts ? o.facts : o.facts.slice(0, 3);

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <div class="dash">
        <section class="card tile span-12 facts-card">
          <div class="tile-head">
            <h3>Das Wichtigste zu deinen Eröffnungen</h3>
            <span class="tile-sub">aus {plural(profile.total_games, "Partie", "Partien")}</span>
            <span class="spacer" />
            {o.facts.length > 3 && (
              <button class="btn small ghost" onClick={() => setShowAllFacts(!showAllFacts)}>
                {showAllFacts ? "Weniger" : `Alle ${o.facts.length} Befunde`}
              </button>
            )}
          </div>
          {facts.length ? (
            <ol class="fact-list">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
          ) : (
            <p class="muted small" style={{ margin: 0 }}>
              Noch keine deutlichen Unterschiede zwischen deinen Eröffnungen. Ab etwa drei Partien je Eröffnung werden die
              Befunde belastbar.
            </p>
          )}
        </section>

        <div class="span-12 color-switch-row">
          <div class="segmented color-switch" role="tablist" aria-label="Farbe">
            {(["white", "black"] as const).map((c) => (
              <button key={c} role="tab" aria-selected={color === c} class={color === c ? "active" : ""} onClick={() => pickColor(c)}>
                <span class={`side-dot ${c}`} /> Mit {c === "white" ? "Weiß" : "Schwarz"}
                <span class="faint small"> {(c === "white" ? o.white : o.black).reduce((n, l) => n + l.games, 0)}</span>
              </button>
            ))}
          </div>
        </div>

        <section class="card kpi-strip op-strip span-12" aria-label="Kennzahlen dieser Farbe">
          <div class="kpi-cell">
            <div class="kpi-label">Partien</div>
            <div class="kpi-value tnum">{games}</div>
            <div class="small faint">{plural(lines.length, "Eröffnung", "Eröffnungen")}</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-label">Punkte-Quote</div>
            <div class={`kpi-value tnum ${scoreClass(games ? (points / games) * 100 : null)}`}>{games ? `${Math.round((points / games) * 100)} %` : "–"}</div>
            <div class="small faint">mit {color === "white" ? "Weiß" : "Schwarz"}</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-label">Nach der Eröffnung</div>
            <div class={`kpi-value tnum ${scoreClass(wpAfter)}`}>{pctText(wpAfter)}</div>
            <div class="small faint">deine Ø Gewinnchance</div>
          </div>
          <div class="kpi-cell">
            <div class="kpi-label">Theorie verlassen</div>
            <div class="kpi-value tnum">{bookExit !== null ? `Zug ${Math.round(bookExit)}` : "–"}</div>
            <div class="small faint">{best ? `Stärkste: ${openingLabel(best.name)}` : "im Schnitt"}</div>
          </div>
        </section>

        <section class="card tile span-8">
          <div class="tile-head">
            <h3>Dein Repertoire mit {color === "white" ? "Weiß" : "Schwarz"}</h3>
            <span class="tile-sub">Spalten antippen zum Sortieren · Zeile für Details</span>
          </div>
          <OpeningTable key={color} lines={lines} overallWp={o.wp_after_opening} />
        </section>

        <section class="card tile span-4">
          <div class="tile-head">
            <h3>{color === "white" ? "Dein erster Zug" : "Deine Antworten"}</h3>
            <span class="tile-sub">Punkte-Quote</span>
          </div>
          {color === "white" ? (
            o.white_first.length ? (
              <BarList rows={choiceRows(o.white_first, "1. ", overall)} referenceLabel="Dein Schnitt" />
            ) : (
              <p class="muted small">Noch keine Partien mit Weiß.</p>
            )
          ) : (
            <BlackReplies vs={o.black_vs} overall={overall} />
          )}
        </section>

        <section class="card tile span-12">
          <div class="tile-head">
            <h3>
              <IconSpark /> Frag den KI-Coach zu deinem Repertoire
            </h3>
            <span class="tile-sub">kennt deine Eröffnungen und Ergebnisse</span>
          </div>
          <AiChat build={(history, q) => profileCoachMessages(profile, history, q, coachDetail())} suggestions={OPENING_QUESTIONS} />
        </section>
      </div>
    </div>
  );
}
