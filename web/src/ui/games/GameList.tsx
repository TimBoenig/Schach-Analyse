// The list of games: a summary of everything the filters show, then one row
// per game grouped by month. A row names the opponent, the colour, the time
// control and the opening, shows how the winning chance went, the moves
// worth a look (brilliant, great, mistakes, blunders) and the accuracy.
import { cancelGame, enqueue, type QueueState } from "../../app/analysisService";
import { getUserColor } from "../../domain/metrics";
import type { Classification, StoredGame } from "../../domain/types";
import { IconChevron, IconPlay, IconStop } from "../icons";
import { CountUp, ResultRibbon } from "../kit";
import { accClass, badgeFor, balanceText, classLabel, formatDate, monthLabel, outcomeFor, resultText, SPEED_DE, shortOpening, streakText } from "../labels";
import { navigate } from "../router";
import { SplitBar, Stat } from "../viz/Bars";

export type AnalysisStatus = "completed" | "paused" | "not_started";

export function status(g: StoredGame): AnalysisStatus {
  return (g.summary_json?.analysis_status as AnalysisStatus) ?? "not_started";
}

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

// ---------- summary ----------

export interface Summary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracy: number | null;
  analyzed: number;
  /** Blunders over all analysed games (what the app calls "Patzer" everywhere). */
  blunders: number;
}

export function summarize(games: StoredGame[], usernames: string[]): Summary {
  const s: Summary = { games: 0, wins: 0, draws: 0, losses: 0, accuracy: null, analyzed: 0, blunders: 0 };
  let accSum = 0;
  for (const g of games) {
    const color = getUserColor(g, usernames);
    if (!color) continue;
    s.games++;
    const o = outcomeFor(g.result, color);
    if (o === "win") s.wins++;
    else if (o === "draw") s.draws++;
    else if (o === "loss") s.losses++;
    const side = g.summary_json?.[color];
    if (status(g) === "completed" && typeof side?.accuracy === "number") {
      s.analyzed++;
      accSum += side.accuracy;
      s.blunders += Number(side.Blunder ?? 0);
    }
  }
  s.accuracy = s.analyzed ? accSum / s.analyzed : null;
  return s;
}

const RIBBON_GAMES = 14;
const OUTCOME_SCORE = { win: 1, draw: 0.5, loss: 0 } as const;
const OUTCOME_WORD = { win: "Sieg", draw: "Remis", loss: "Niederlage" } as const;

/** What the newest results add up to, as the headline of the page. */
function formHeadline(recent: (keyof typeof OUTCOME_SCORE)[]): string {
  if (!recent.length) return "Deine Partien";
  const scores: number[] = recent.map((o) => OUTCOME_SCORE[o]);
  const last = scores.slice(0, 10);
  const points = last.reduce<number>((sum, v) => sum + v, 0);
  return streakText(scores) ?? `${de(points, points % 1 ? 1 : 0)} ${points === 1 ? "Punkt" : "Punkte"} aus den letzten ${last.length} Partien`;
}

/** The figures of everything the filters show, the current run and the last results as tiles. */
export function GamesSummary({ s, games, usernames, period }: { s: Summary; games: StoredGame[]; usernames: string[]; period: string }) {
  const decided = s.wins + s.draws + s.losses;
  // `games` is newest first; only decided own games count for the run.
  const recent = games
    .map((g) => ({ g, o: outcomeFor(g.result, getUserColor(g, usernames)) }))
    .filter((x): x is { g: StoredGame; o: keyof typeof OUTCOME_SCORE } => x.o !== null)
    .slice(0, RIBBON_GAMES);
  return (
    <section class="card gl-summary">
      <header class="gl-summary-head">
        <div>
          <span class="eyebrow">Deine Partien · {period}</span>
          <h2>{formHeadline(recent.map((x) => x.o))}</h2>
        </div>
        {recent.length > 0 && (
          <ResultRibbon
            games={[...recent].reverse().map(({ g, o }) => {
              const white = getUserColor(g, usernames) === "white";
              return { id: g.id, score: OUTCOME_SCORE[o], title: `${formatDate(g.date)} gegen ${white ? g.black : g.white}: ${OUTCOME_WORD[o]}` };
            })}
            onPick={(id) => navigate({ view: "analysis", gameId: id })}
          />
        )}
      </header>
      <div class="stat-row" style={{ "--cols": 4 }}>
        <Stat label="Partien" value={<CountUp value={s.games} />} sub={`${s.analyzed} davon analysiert`} />
        <Stat
          label="Punkte-Quote"
          value={decided ? `${Math.round(((s.wins + s.draws / 2) / decided) * 100)} %` : "–"}
          sub={
            <>
              <SplitBar
                height={6}
                parts={[
                  { key: "w", label: "Siege", value: s.wins, color: "var(--win)" },
                  { key: "d", label: "Remis", value: s.draws, color: "var(--draw)" },
                  { key: "l", label: "Niederlagen", value: s.losses, color: "var(--loss)" },
                ]}
              />
              {balanceText(s.wins, s.draws, s.losses)}
            </>
          }
        />
        <Stat label="Ø Genauigkeit" value={s.accuracy !== null ? de(s.accuracy) : "–"} sub={s.analyzed ? `über ${s.analyzed} analysierte Partien` : "noch keine Partie analysiert"} />
        <Stat label="Patzer pro Partie" value={s.analyzed ? de(s.blunders / s.analyzed, 2) : "–"} sub={s.analyzed ? `${s.blunders} Patzer in ${s.analyzed} Partien` : undefined} />
      </div>
    </section>
  );
}

// ---------- one row ----------

const SPARK_W = 92;
const SPARK_H = 28;

/**
 * The game at a glance: the player's winning chance move by move, green above
 * the middle line and red below it, so a thrown win or a comeback shows in the list.
 */
function GameSpark({ g, color }: { g: StoredGame; color: "white" | "black" }) {
  const moves = Array.isArray(g.moves_json) ? g.moves_json : [];
  if (moves.length < 4) return <span class="game-spark" />;
  const wp = moves.map((m) => (color === "white" ? m.win_chance_after : 1 - m.win_chance_after));
  const x = (i: number) => (i / (wp.length - 1)) * SPARK_W;
  const y = (v: number) => SPARK_H - Math.min(1, Math.max(0, v)) * SPARK_H;
  const mid = SPARK_H / 2;
  const half = (clamp: (v: number) => number) => `M0,${mid} ${wp.map((v, i) => `L${x(i).toFixed(1)},${y(clamp(v)).toFixed(1)}`).join(" ")} L${SPARK_W},${mid} Z`;
  return (
    <svg class="game-spark" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} role="img" aria-label="Verlauf deiner Gewinnchance">
      <path class="up" d={half((v) => Math.max(v, 0.5))} />
      <path class="down" d={half((v) => Math.min(v, 0.5))} />
      <line x1="0" x2={SPARK_W} y1={mid} y2={mid} />
    </svg>
  );
}

// The marks a row shows: the good surprises first, then what went wrong.
const MARKS: { key: string; keys: Classification[]; badge: Classification }[] = [
  { key: "brilliant", keys: ["Brilliant"], badge: "Brilliant" },
  { key: "great", keys: ["Great"], badge: "Great" },
  { key: "mistake", keys: ["Mistake"], badge: "Mistake" },
  { key: "miss", keys: ["Miss"], badge: "Miss" },
  { key: "blunder", keys: ["Blunder"], badge: "Blunder" },
];

function Marks({ side }: { side: Record<string, unknown> }) {
  const shown = MARKS.map((m) => ({ ...m, n: m.keys.reduce((s, k) => s + (Number(side[k]) || 0), 0) })).filter((m) => m.n > 0);
  return (
    <span class="gl-marks">
      {shown.map((m) => (
        <span class={`gl-mark ${m.key}`} key={m.key} title={`${m.n} × ${classLabel(m.badge)}`}>
          <img src={badgeFor(m.badge) ?? ""} alt="" width={16} height={16} />
          <span class="tnum">{m.n}</span>
        </span>
      ))}
    </span>
  );
}

/** Stops this game's analysis (or drops it from the queue); the rest keeps running. */
function CancelButton({ id, label }: { id: string; label: string }) {
  return (
    <button
      class="btn small ghost icon"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        cancelGame(id);
      }}
    >
      <IconStop />
    </button>
  );
}

const RES_CH = { win: "S", draw: "R", loss: "N" } as const;

export function GameRow({ g, usernames, queue }: { g: StoredGame; usernames: string[]; queue: QueueState | null }) {
  const color = getUserColor(g, usernames);
  const st = status(g);
  const side = color ? g.summary_json?.[color] : undefined;
  const acc = side?.accuracy;
  const outcome = outcomeFor(g.result, color);
  const isCurrent = queue?.current === g.id;
  const opponent = color === "white" ? { name: g.black, elo: g.black_elo } : { name: g.white, elo: g.white_elo };
  const speed = g.speed_category ? (SPEED_DE[g.speed_category] ?? g.speed_category) : null;
  const opening = shortOpening(g.opening);
  const analysed = st === "completed" && typeof acc === "number";
  return (
    <li>
      <div class={`gl-row ${outcome ?? "other"}`} role="link" tabIndex={0} onClick={() => navigate({ view: "analysis", gameId: g.id })} onKeyDown={(e) => e.key === "Enter" && navigate({ view: "analysis", gameId: g.id })}>
        <span class={`gl-res ${outcome ?? ""}`} title={outcome ? OUTCOME_WORD[outcome] : resultText(g.result)}>
          {outcome ? RES_CH[outcome] : resultText(g.result)}
        </span>
        <span class="gl-main">
          {color ? (
            <span class="gl-who">
              <strong>{opponent.name}</strong>
              {opponent.elo ? <span class="faint tnum"> {opponent.elo}</span> : null}
            </span>
          ) : (
            <span class="gl-who">
              <strong>{g.white}</strong>
              {g.white_elo ? <span class="faint tnum"> {g.white_elo}</span> : null}
              <span class="faint"> – </span>
              <strong>{g.black}</strong>
              {g.black_elo ? <span class="faint tnum"> {g.black_elo}</span> : null}
            </span>
          )}
          <span class="gl-sub">
            {color && <span class={`side-dot ${color}`} title={color === "white" ? "Du hattest Weiß" : "Du hattest Schwarz"} />}
            {/* The month header above already names the year. */}
            <span class="gl-sub-text">{[speed, formatDate(g.date).replace(/\.\d{4}$/, "."), opening].filter(Boolean).join(" · ")}</span>
          </span>
        </span>
        {analysed ? (
          <>
            <Marks side={side ?? {}} />
            {color ? <GameSpark g={g} color={color} /> : <span class="game-spark" />}
            <span class="gl-acc">
              <strong class={`tnum ${accClass(acc)}`}>{de(acc)}</strong>
              <span>Genauigkeit</span>
            </span>
          </>
        ) : (
          <span class="gl-state">
            {isCurrent ? (
              <>
                <span class="pill accent">läuft {Math.round((queue!.done / Math.max(1, queue!.total)) * 100)} %</span>
                <CancelButton id={g.id} label="Analyse abbrechen" />
              </>
            ) : queue?.queued.includes(g.id) ? (
              <>
                <span class="pill">wartet</span>
                <CancelButton id={g.id} label="Aus der Warteschlange nehmen" />
              </>
            ) : st === "completed" ? (
              <span class="pill">analysiert</span>
            ) : (
              <button
                class="btn small"
                onClick={(e) => {
                  e.stopPropagation();
                  // An explicit request goes ahead of the background queue.
                  void enqueue([g.id], { front: true });
                }}
              >
                <IconPlay /> Analysieren
              </button>
            )}
          </span>
        )}
        <span class="gl-go" aria-hidden="true">
          <IconChevron />
        </span>
      </div>
    </li>
  );
}

/**
 * The rows of one page of the list under a header per month. The header
 * counts the month in `all` (everything the filters show), so a month cut by
 * "Weitere anzeigen" still names its full number.
 */
export function GameRows({ games, all, usernames, queue }: { games: StoredGame[]; all: StoredGame[]; usernames: string[]; queue: QueueState | null }) {
  const months = new Map<string, StoredGame[]>();
  for (const g of games) {
    const m = monthLabel(g.date);
    const list = months.get(m);
    if (list) list.push(g);
    else months.set(m, [g]);
  }
  const totals = new Map<string, number>();
  for (const g of all) {
    const m = monthLabel(g.date);
    totals.set(m, (totals.get(m) ?? 0) + 1);
  }
  return (
    <>
      {[...months].map(([m, list]) => (
        <section class="gl-month" key={m}>
          <h3 class="gl-month-head">
            {m}
            <span class="faint">
              {totals.get(m) ?? list.length} {(totals.get(m) ?? list.length) === 1 ? "Partie" : "Partien"}
            </span>
          </h3>
          <ul class="gl-rows">
            {list.map((g) => (
              <GameRow key={g.id} g={g} usernames={usernames} queue={queue} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
