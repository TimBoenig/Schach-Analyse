import { useState } from "preact/hooks";

import {
  type FirstMoveStat,
  type MoveChoice,
  OPENING_QUESTIONS,
  type OpeningStat,
  openingLabel,
  profileCoachMessages,
} from "../domain/profile";
import { AiChat, coachDetail } from "./AiCoach";
import { BarList, Legend, StackBar } from "./charts";
import type { BarRow } from "./charts";
import { IconSpark } from "./icons";
import { formatDate } from "./labels";
import { navigate } from "./router";
import { FilterBar, filtersActive, useProfile } from "./useProfile";

// Openings with fewer games than this are drawn faint: real numbers, thin evidence.
const MIN_GAMES = 3;
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

function OpeningTable({ lines, overallWp }: { lines: OpeningStat[]; overallWp: number | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!lines.length) return <p class="muted small">Noch keine Partien mit dieser Farbe.</p>;
  const shown = all ? lines : lines.slice(0, ROWS);
  return (
    <div class="op-table">
      {shown.map((o) => {
        const isOpen = open === o.name;
        const meta = [
          plural(o.games, "Partie", "Partien"),
          o.opening_accuracy !== null ? `Genauigkeit ${Math.round(o.opening_accuracy)} %` : null,
          o.wp_after_opening !== null ? `danach ${Math.round(o.wp_after_opening)} % Gewinnchance` : null,
        ].filter(Boolean);
        return (
          <div key={o.name} class={`op-row${isOpen ? " open" : ""}${o.games < MIN_GAMES ? " thin" : ""}`}>
            <button class="op-head" onClick={() => setOpen(isOpen ? null : o.name)} aria-expanded={isOpen}>
              <span class="op-name">
                {openingLabel(o.name)}
                {o.eco && <span class="op-eco">{o.eco}</span>}
              </span>
              <span class={`op-score tnum ${scoreClass(o.score_pct)}`}>{pctText(o.score_pct)}</span>
              <span class="op-bar">
                <StackBar
                  height={8}
                  legend={false}
                  segments={[
                    { label: "Siege", value: o.wins, color: "var(--win)" },
                    { label: "Remis", value: o.draws, color: "var(--draw)" },
                    { label: "Niederlagen", value: o.losses, color: "var(--loss)" },
                  ]}
                />
              </span>
              <span class="op-meta faint small">{meta.join(" · ")}</span>
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

export function OpeningsView() {
  const { profile, usernames, loading, error, filters, setFilters } = useProfile();

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
  const wpRows: BarRow[] = [...o.white, ...o.black]
    .filter((l) => l.wp_after_opening !== null)
    .sort((a, b) => b.games - a.games)
    .slice(0, 8)
    .map((l) => ({
      label: `${openingLabel(l.name)} (${l.color === "white" ? "Weiß" : "Schwarz"})`,
      value: l.wp_after_opening,
      reference: 50,
      valueText: pctText(l.wp_after_opening),
      note: plural(l.analyzed, "analysierte Partie", "analysierte Partien"),
      faint: l.analyzed < MIN_GAMES,
    }));

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <div class="dash">
        <section class="card tile span-12 facts-card">
          <div class="tile-head">
            <h3>Das Wichtigste zu deinen Eröffnungen</h3>
            <span class="tile-sub">aus {plural(profile.total_games, "Partie", "Partien")}</span>
          </div>
          {o.facts.length ? (
            <ol class="fact-list">
              {o.facts.map((f) => (
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

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>
              <span class="side-dot white" /> Mit Weiß
            </h3>
            <span class="tile-sub">Punkte-Quote · antippen für Details</span>
          </div>
          <OpeningTable lines={o.white} overallWp={o.wp_after_opening} />
        </section>

        <section class="card tile span-6">
          <div class="tile-head">
            <h3>
              <span class="side-dot black" /> Mit Schwarz
            </h3>
            <span class="tile-sub">Punkte-Quote · antippen für Details</span>
          </div>
          <OpeningTable lines={o.black} overallWp={o.wp_after_opening} />
        </section>

        <section class="card tile span-4">
          <div class="tile-head">
            <h3>Dein erster Zug mit Weiß</h3>
            <span class="tile-sub">Punkte-Quote</span>
          </div>
          {o.white_first.length ? (
            <BarList rows={choiceRows(o.white_first, "1. ", overall)} referenceLabel="Dein Schnitt" />
          ) : (
            <p class="muted small">Noch keine Partien mit Weiß.</p>
          )}
        </section>

        <section class="card tile span-4">
          <div class="tile-head">
            <h3>Deine Antworten mit Schwarz</h3>
            <span class="tile-sub">Punkte-Quote</span>
          </div>
          <BlackReplies vs={o.black_vs} overall={overall} />
        </section>

        <section class="card tile span-4">
          <div class="tile-head">
            <h3>Stellung nach der Eröffnung</h3>
            <span class="tile-sub">deine Gewinnchance</span>
          </div>
          {wpRows.length ? (
            <>
              <BarList rows={wpRows} referenceLabel="Ausgeglichen" />
              <p class="small faint tile-foot">Gemessen nach deinem letzten Eröffnungszug. Über 50 % stehst du besser.</p>
            </>
          ) : (
            <p class="muted small">Analysiere ein paar Partien, dann siehst du, wie du aus der Eröffnung kommst.</p>
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
