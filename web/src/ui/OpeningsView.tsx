import { Chess } from "chess.js";
import { useRef, useState } from "preact/hooks";

import {
  type FirstMoveStat,
  LEAK_MIN_JUDGED,
  type MoveChoice,
  movesText,
  type OpeningLeak,
  type OpeningStat,
  openingLabel,
} from "../domain/profile";
import { MIN_LINE_GAMES, scoreDeviation } from "../domain/profile/evidence";
import { PageHeader } from "./Layout";
import { BarList, Legend } from "./charts";
import type { BarRow } from "./charts";
import { formatDate } from "./labels";
import { navigate } from "./router";
import { Coach, NeedNames } from "./Coach";
import { CountUp, Hero, HeroStat } from "./kit";
import { Explorer } from "./openings/Explorer";
import { type MiniArrow, MiniBoard } from "./openings/MiniBoard";
import { OpeningCard, RepertoireMap, TheoryTimeline } from "./openings/Repertoire";
import { FilterBar, filtersActive, useProfile } from "./useProfile";

// Openings with fewer games than this are drawn faint: real numbers, thin evidence.
const MIN_GAMES = MIN_LINE_GAMES;

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

function OpeningDetail({ o, overallWp, onClose }: { o: OpeningStat; overallWp: number | null; onClose: () => void }) {
  const [games, setGames] = useState(false);
  return (
    <div class="op-detail">
      <div class="op-detail-head">
        <strong>
          {openingLabel(o.name)}
          {o.eco && <span class="op-eco">{o.eco}</span>}
        </strong>
        <span class="small faint">
          {plural(o.games, "Partie", "Partien")} · {pctText(o.score_pct)} Punkte
        </span>
        <span class="spacer" />
        <span class="op-detail-actions">
          <button class="btn small ghost" onClick={() => setGames(!games)}>
            {games ? "Partien ausblenden" : "Partien zeigen"}
          </button>
          <button class="btn small ghost" onClick={onClose} aria-label="Eröffnung abwählen">
            ✕
          </button>
        </span>
      </div>
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
      {games && (
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
            <span class="tnum small op-acc">{g.accuracy !== null ? `${g.accuracy.toFixed(1).replace(".", ",")}` : ""}</span>
          </button>
        ))}
      </div>
      )}
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


type SortKey = "games" | "best" | "worst" | "error";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "games", label: "Häufigste" },
  { key: "best", label: "Beste" },
  { key: "worst", label: "Schwächste" },
  { key: "error", label: "Früher Fehler" },
];

function sortLines(lines: OpeningStat[], key: SortKey): OpeningStat[] {
  // Thin openings sort behind solid ones for best/worst: a 1:0 is no "best opening".
  const solid = (o: OpeningStat) => (o.games >= MIN_GAMES ? 1 : 0);
  const v = (o: OpeningStat): number => {
    if (key === "games") return o.games;
    if (key === "best") return solid(o) * 1000 + (o.score_pct ?? -1);
    if (key === "worst") return solid(o) * 1000 - (o.score_pct ?? 101);
    return o.first_error_move === null ? -999 : -o.first_error_move;
  };
  return [...lines].sort((a, b) => v(b) - v(a) || b.games - a.games || a.name.localeCompare(b.name));
}

const CARDS = 6;

function squares(fen: string, san: string | null): { from: string; to: string } | null {
  if (!san) return null;
  try {
    const m = new Chess(fen).move(san);
    return { from: m.from, to: m.to };
  } catch {
    return null;
  }
}

function Leaks({ leaks, color, onShow }: { leaks: OpeningLeak[]; color: "white" | "black"; onShow: (path: string[]) => void }) {
  if (!leaks.length) {
    return (
      <Coach mood="happy" size={44} title="Keine wiederkehrenden Fehlzüge">
        Ich melde mich hier, sobald du denselben Zug in mindestens {LEAK_MIN_JUDGED} analysierten Partien spielst und er deutlich oft ein Fehler ist.
      </Coach>
    );
  }
  return (
    <div class="leaks">
      {leaks.map((l) => {
        const ply = l.path.length - 1;
        const played = squares(l.fen, l.san);
        const better = squares(l.fen, l.better);
        const arrows: MiniArrow[] = [];
        if (played) arrows.push({ ...played, color: "var(--blunder)" });
        if (better) arrows.push({ ...better, color: "var(--arrow-best)" });
        return (
          <button key={l.path.join(" ")} class="leak" onClick={() => onShow(l.path)}>
            <span class="leak-board">
              <MiniBoard fen={l.fen} flipped={color === "black"} arrows={arrows} />
            </span>
            <span class="leak-body">
              <span class="small faint leak-path">{ply ? `Nach ${movesText(l.path.slice(0, -1))}` : "Erster Zug"}</span>
              <strong>
                <span class="bad">{movesText([l.san], ply)}</span>
                {l.better && (
                  <>
                    {" "}
                    statt <span class="good">{movesText([l.better], ply)}</span>
                  </>
                )}
              </strong>
              <span class="small muted">
                Fehler in {l.errors} von {l.judged} Partien · danach {pctText(l.score_pct)} Punkte
              </span>
            </span>
          </button>
        );
      })}
      <button class="btn small" onClick={() => navigate({ view: "training", tab: "uebungen", category: "repertoire" })}>
        Repertoire trainieren
      </button>
    </div>
  );
}

export function OpeningsView() {
  const { profile, usernames, loading, error, filters, setFilters } = useProfile();
  const [savedPick, setColor] = useState<"white" | "black">(savedColor);
  const [showAllFacts, setShowAllFacts] = useState(false);
  const [sort, setSort] = useState<SortKey>("games");
  const [allCards, setAllCards] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const explorerRef = useRef<HTMLElement>(null);
  // A colour chosen in the shared filter bar wins, so switch and filter never disagree.
  const filterColor = filters.color === "White" ? "white" : filters.color === "Black" ? "black" : null;
  const color = filterColor ?? savedPick;
  const pickColor = (c: "white" | "black") => {
    setColor(c);
    setSelected(null);
    setPath([]);
    if (filterColor) setFilters({ ...filters, color: c === "white" ? "White" : "Black" });
    try {
      localStorage.setItem(COLOR_KEY, c);
    } catch {
      // Remembering the tab is a convenience only.
    }
  };
  const showInTree = (p: string[], name: string | null = null) => {
    setSelected(name);
    setPath(p);
    explorerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const header = <PageHeader toolbar={<FilterBar filters={filters} onChange={setFilters} />} />;

  if (usernames && !usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what="zeige ich dir, welche Eröffnungen dir liegen." />
      </div>
    );
  }
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "160px" }} />
          <div class="skeleton span-12" style={{ height: "300px" }} />
          <div class="skeleton span-12" style={{ height: "480px" }} />
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
  const colorDe = color === "white" ? "Weiß" : "Schwarz";
  const lines = color === "white" ? o.white : o.black;
  const games = lines.reduce((n, l) => n + l.games, 0);
  const points = lines.reduce((n, l) => n + l.wins + l.draws / 2, 0);
  const scorePct = games ? (points / games) * 100 : null;
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
  // …and only one clearly below 50 % as the one that costs points.
  const worst = lines
    .filter((l) => scoreDeviation(l, 50) < 0)
    .sort((a, b) => (a.score_pct as number) - (b.score_pct as number))[0];
  const facts = showAllFacts ? o.facts : o.facts.slice(0, 3);
  const sorted = sortLines(lines, sort);
  const cards = allCards ? sorted : sorted.slice(0, CARDS);
  const chosen = lines.find((l) => l.name === selected) ?? null;
  const leaks = o.tree.leaks.filter((l) => l.color === color).slice(0, 4);
  const mood = scorePct === null ? "think" : scorePct >= 55 ? "wow" : scorePct < 45 ? "think" : "happy";

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <div class="dash">
        <Hero
          class="op-arena"
          kicker={`Eröffnungen mit ${colorDe} · ${plural(games, "Partie", "Partien")}`}
          title={
            best ? (
              <>
                <em>Deine Waffe mit {colorDe}:</em> {openingLabel(best.name)}
              </>
            ) : worst ? (
              <>
                <em>Dein Sorgenkind mit {colorDe}:</em> {openingLabel(worst.name)}
              </>
            ) : (
              `Dein Repertoire mit ${colorDe}`
            )
          }
          sub={
            best || worst ? (
              <>
                {best && `${pctText(best.score_pct)} der Punkte aus ${plural(best.games, "Partie", "Partien")}. `}
                {worst && `${best ? "Am meisten kostet dich" : "Hier holst du nur"} ${best ? `${openingLabel(worst.name)}: ` : ""}${pctText(worst.score_pct)} aus ${plural(worst.games, "Partie", "Partien")}.`}
              </>
            ) : (
              `Noch sticht keine Eröffnung klar heraus. Ab etwa ${MIN_GAMES} Partien je Eröffnung werden die Befunde belastbar.`
            )
          }
          aside={<HeroStat big={<CountUp value={scorePct} format={(v) => `${Math.round(v)} %`} />} label="Punkte-Quote" sub={`mit ${colorDe}`} />}
        >
          <div class="op-arena-bar">
            <div class="segmented color-switch" role="tablist" aria-label="Farbe">
              {(["white", "black"] as const).map((c) => (
                <button key={c} role="tab" aria-selected={color === c} class={color === c ? "active" : ""} onClick={() => pickColor(c)}>
                  <span class={`side-dot ${c}`} /> Mit {c === "white" ? "Weiß" : "Schwarz"}
                  <span class="faint small"> {(c === "white" ? o.white : o.black).reduce((n, l) => n + l.games, 0)}</span>
                </button>
              ))}
            </div>
            {best && (
              <button class="chip" onClick={() => showInTree(best.line, best.name)}>
                Waffe im Baum zeigen
              </button>
            )}
            {worst && (
              <button class="chip" onClick={() => showInTree(worst.line, worst.name)}>
                Sorgenkind im Baum zeigen
              </button>
            )}
          </div>
          <div class="ar-stat-row">
            <div class="ar-stat">
              <span class="kpi-label">Eröffnungen</span>
              <span class="ar-stat-value">
                <CountUp value={lines.length} />
              </span>
              <span class="small faint">{lines.filter((l) => l.games >= MIN_GAMES).length} mit genug Partien</span>
            </div>
            <div class="ar-stat">
              <span class="kpi-label">Nach der Eröffnung</span>
              <span class={`ar-stat-value ${scoreClass(wpAfter)}`}>
                <CountUp value={wpAfter} format={(v) => `${Math.round(v)} %`} />
              </span>
              <span class="small faint">deine Ø Gewinnchance</span>
            </div>
            <div class="ar-stat">
              <span class="kpi-label">Theorie verlassen</span>
              <span class="ar-stat-value">
                <CountUp value={bookExit} format={(v) => `Zug ${Math.round(v)}`} />
              </span>
              <span class="small faint">im Schnitt</span>
            </div>
            <div class="ar-stat">
              <span class="kpi-label">Baustellen</span>
              <span class={`ar-stat-value${leaks.length ? " bad" : ""}`}>
                <CountUp value={leaks.length} />
              </span>
              <span class="small faint">{leaks.length ? "Züge, die immer wieder schiefgehen" : "keine wiederkehrenden Fehler"}</span>
            </div>
          </div>
          {facts.length > 0 && (
            <div class="op-arena-facts">
              <Coach mood={mood} size={48} title="Das Wichtigste zu deinen Eröffnungen">
                <ol class="fact-list compact">
                  {facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ol>
              </Coach>
              {o.facts.length > 3 && (
                <button class="btn small ghost" onClick={() => setShowAllFacts(!showAllFacts)}>
                  {showAllFacts ? "Weniger" : `Alle ${o.facts.length} Befunde`}
                </button>
              )}
            </div>
          )}
        </Hero>

        <section class="card tile span-12">
          <div class="tile-head">
            <h3>Dein Repertoire mit {colorDe}</h3>
            <span class="spacer" />
            <div class="segmented small-seg rep-sort-seg" role="tablist" aria-label="Sortierung">
              {SORTS.map((s) => (
                <button key={s.key} role="tab" aria-selected={sort === s.key} class={sort === s.key ? "active" : ""} onClick={() => setSort(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {lines.length ? (
            <div class="rep-cards">
              {cards.map((l) => (
                <OpeningCard key={l.name} o={l} selected={selected === l.name} onSelect={() => showInTree(l.line, l.name)} />
              ))}
            </div>
          ) : (
            <p class="muted small">Noch keine Partien mit dieser Farbe.</p>
          )}
          <div class="rep-cards-foot">
            <Legend items={RESULT_LEGEND} />
            {lines.length > CARDS && (
              <button class="btn small ghost" onClick={() => setAllCards(!allCards)}>
                {allCards ? "Weniger anzeigen" : `Alle ${lines.length} Eröffnungen`}
              </button>
            )}
          </div>
        </section>

        <section class="card tile span-12" ref={explorerRef} id="eroeffnungsbaum">
          <div class="tile-head">
            <h3>Dein Eröffnungsbaum</h3>
            <span class="tile-sub">Zug antippen oder am Brett ziehen · nur deine eigenen Partien</span>
          </div>
          {chosen && <OpeningDetail o={chosen} overallWp={o.wp_after_opening} onClose={() => setSelected(null)} />}
          <Explorer root={o.tree[color]} color={color} path={path} onPath={setPath} />
        </section>

        <section class="card tile span-7">
          <div class="tile-head">
            <h3>Repertoire-Landkarte</h3>
            <span class="tile-sub">Wie oft und wie gut · Punkt antippen</span>
          </div>
          <RepertoireMap lines={lines} average={scorePct} selected={selected} onSelect={(n) => showInTree(lines.find((l) => l.name === n)?.line ?? [], n)} />
        </section>

        <section class="card tile span-5">
          <div class="tile-head">
            <h3>Deine Baustellen</h3>
            <span class="tile-sub">Züge, die immer wieder schiefgehen</span>
          </div>
          <Leaks leaks={leaks} color={color} onShow={(p) => showInTree(p)} />
        </section>

        <section class="card tile span-7">
          <div class="tile-head">
            <h3>Theorie und erster Fehler</h3>
            <span class="tile-sub">Zug, in dem du die Theorie verlässt / Ø erster schwerer Fehler</span>
          </div>
          <TheoryTimeline lines={sortLines(lines, "games")} onSelect={(n) => showInTree(lines.find((l) => l.name === n)?.line ?? [], n)} />
        </section>

        <section class="card tile span-5">
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

      </div>
    </div>
  );
}
