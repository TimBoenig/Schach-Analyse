import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { enqueue, subscribeQueue, type QueueState } from "../app/analysisService";
import { buildProfileInWorker } from "../app/profileClient";
import { isBulletGame, statsFormat } from "../domain/analysisDepth";
import { addPlayer, importAllPlayers, importPlayerGames, loadPlayers, removePlayer, updatePlayer } from "../app/players";
import { getUserColor } from "../domain/metrics";
import {
  buildMatchup,
  buildRanking,
  buildScoutReport,
  frequentOpponents,
  headToHead,
  mainSource,
  type Matchup,
  type MatchupRow,
  MIN_LINE_GAMES,
  type AccountSource,
  type HeadToHead,
  type OpeningPick,
  orderPlayers,
  playerUsernames,
  rankedFriends,
  type Ranking,
  type RankRow,
  type ScoutReport,
  type ScoutTip,
  SOURCE_LABELS,
  type TrackedPlayer,
} from "../domain/players";
import { activityCalendar, dailyActivity, type PlayerProfile } from "../domain/profile";
import { localDay } from "../domain/training";
import type { StoredGame } from "../domain/types";
import { getSetting, listGames, onDataChanged } from "../storage/db";
import { AreaChart, BarList, Donut, Legend, RadarChart, StackBar } from "./charts";
import type { BarRow, Segment } from "./charts";
import { Calendar, FormStats, RecentGames } from "./HomeView";
import { ClassTiles, VersusBars } from "./MoveTally";
import { StyleAxes } from "./ProfileView";
import { IconEye, IconEyeOff, IconPlay, IconPlus, IconSync, IconTrash } from "./icons";
import { formatDate, loadedAgo, SPEED_DE } from "./labels";
import { navigate, toHash } from "./router";
import { CoachAvatar, CoachTip } from "./Coach";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { FORMATS, formatOptionLabel, PeriodSelect } from "./useProfile";

// Analysing on a tablet takes a while per game; the newest games say the most.
const ANALYZE_BATCH = 20;

const RADAR_LABELS: Record<string, string> = {
  opening: "Eröffnung",
  middlegame: "Mittelspiel",
  endgame: "Endspiel",
  tactics: "Taktik",
  safety: "Sicherheit",
  conversion: "Verwertung",
  defense: "Verteidigung",
  time: "Zeit",
  consistency: "Konstanz",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pct0 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "–" : `${Math.round(v)} %`);
const de = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${de(Math.abs(v), digits)}`;

function gamesOf(all: StoredGame[], names: string[]): StoredGame[] {
  return all.filter((g) => getUserColor(g, names));
}

/** Profile for one set of usernames; only their games travel to the worker. */
function profileFor(all: StoredGame[], names: string[], format: string, date: string): Promise<PlayerProfile> {
  return buildProfileInWorker({ games: gamesOf(all, names), usernames: names, format, date, color: "All Colors" });
}

/** Changes only when a game is added, removed or re-analysed. */
const gamesSignature = (games: StoredGame[]) => games.map((g) => `${g.id}:${g.updated_at}`).join("|");

function useData() {
  const [players, setPlayers] = useState<TrackedPlayer[] | null>(null);
  const [games, setGames] = useState<StoredGame[]>([]);
  const [me, setMe] = useState<string[]>([]);
  const signature = useRef("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [p, g, u] = await Promise.all([loadPlayers(), listGames(), getSetting<string[]>("usernames", [])]);
      if (!alive) return;
      setPlayers(p);
      // Settings changes (like hiding a friend) also fire a data change. Keeping
      // the same games array then spares every profile from being rebuilt.
      const sig = gamesSignature(g);
      if (sig !== signature.current) {
        signature.current = sig;
        setGames(g);
      }
      setMe((prev) => (prev.join("\n") === u.join("\n") ? prev : u));
    };
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { players, games, me };
}

function useQueue(): QueueState | null {
  const [q, setQ] = useState<QueueState | null>(null);
  useEffect(() => subscribeQueue(setQ), []);
  return q;
}

/** Format and period only: the colour filter would flip meaning between players. */
function PlayerFilters({
  format,
  date,
  onFormat,
  onDate,
}: {
  format: string;
  date: string;
  onFormat: (v: string) => void;
  onDate: (v: string) => void;
}) {
  const { excludeBullet } = useBulletPrefs();
  return (
    <div class="filters">
      <select value={format} onChange={(e) => onFormat(e.currentTarget.value)} aria-label="Bedenkzeit">
        {FORMATS.map((f) => (
          <option key={f} value={f}>
            {formatOptionLabel(f, excludeBullet)}
          </option>
        ))}
      </select>
      <PeriodSelect value={date} onChange={onDate} />
    </div>
  );
}

// ---------- add player ----------

type AddSource = AccountSource;

function AddPlayerDialog({
  initial,
  onClose,
}: {
  initial?: { username: string; source: AddSource };
  onClose: (added?: TrackedPlayer) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<AddSource>(initial?.source ?? "lichess");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [name, setName] = useState("");
  const [friend, setFriend] = useState(true);
  const [count, setCount] = useState("100");
  const [months, setMonths] = useState("3");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const added = useRef<TrackedPlayer | undefined>(undefined);

  useEffect(() => ref.current?.showModal(), []);

  const run = async () => {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const player = await addPlayer({ name, accounts: [{ source, username }], friend });
      added.current = player;
      if (source !== "other") {
        const { result } = await importPlayerGames(player, {
          // "all" loads the whole history (lichess without max, every chess.com archive).
          count: count === "all" ? null : Number(count),
          months: months === "all" ? null : Number(months),
          signal: abort.current.signal,
          onProgress: setProgress,
        });
        setProgress(`${result.imported} neue Partien geladen${result.already_known ? `, ${result.already_known} waren schon da` : ""}.`);
      }
      ref.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} onClose={() => onClose(added.current)}>
      <h3 style={{ marginTop: 0 }}>Spieler hinzufügen</h3>
      <div class="segmented" style={{ marginBottom: "14px" }}>
        {(
          [
            ["lichess", "Lichess"],
            ["chesscom", "Chess.com"],
            ["other", "Nur meine Partien"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} class={source === k ? "active" : ""} onClick={() => setSource(k)} disabled={busy}>
            {l}
          </button>
        ))}
      </div>
      <label class="field">
        <span>{source === "other" ? "Name in deinen Partien" : `Benutzername auf ${SOURCE_LABELS[source]}`}</span>
        <input type="text" autocapitalize="off" autocorrect="off" value={username} onInput={(e) => setUsername(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>Anzeigename (optional)</span>
        <input type="text" value={name} placeholder={username || "z. B. Max"} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      {source === "lichess" && (
        <label class="field">
          <span>Letzte Partien laden</span>
          <select value={count} onChange={(e) => setCount(e.currentTarget.value)}>
            {["50", "100", "200", "500"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="all">Alle (gesamte Zeit)</option>
          </select>
        </label>
      )}
      {source === "chesscom" && (
        <label class="field">
          <span>Zeitraum laden</span>
          <select value={months} onChange={(e) => setMonths(e.currentTarget.value)}>
            <option value="1">Letzter Monat</option>
            <option value="3">Letzte 3 Monate</option>
            <option value="6">Letzte 6 Monate</option>
            <option value="12">Letztes Jahr</option>
            <option value="all">Gesamte Zeit</option>
          </select>
        </label>
      )}
      {source === "other" && (
        <p class="small muted" style={{ marginTop: 0 }}>
          Nutzt nur die Partien, die schon in der App sind (z. B. deine Partien gegen diese Person oder eine importierte PGN).
        </p>
      )}
      <label class="toggle-row">
        <input type="checkbox" checked={friend} onChange={(e) => setFriend(e.currentTarget.checked)} />
        <span>
          <strong>In die Freundes-Rangliste aufnehmen</strong>
          <small class="faint">Ohne Haken nur als Gegner zum Ausspionieren.</small>
        </span>
      </label>
      {progress && <p class="small muted">{progress}</p>}
      {error && <p class="error small">{error}</p>}
      <div class="row" style={{ justifyContent: "flex-end", marginTop: "12px" }}>
        {busy ? (
          <button class="btn" onClick={() => abort.current?.abort()}>
            Abbrechen
          </button>
        ) : (
          <button class="btn" onClick={() => ref.current?.close()}>
            Schließen
          </button>
        )}
        <button class="btn primary" disabled={busy || !username.trim()} onClick={run}>
          {busy ? "Lade Partien …" : source === "other" ? "Hinzufügen" : "Hinzufügen und Partien laden"}
        </button>
      </div>
    </dialog>
  );
}

// ---------- player list ----------

interface PlayerCardData {
  player: TrackedPlayer;
  games: number;
  analyzed: number;
  rating: string;
  h2h: HeadToHead;
}

function cardData(p: TrackedPlayer, all: StoredGame[], me: string[]): PlayerCardData {
  const names = playerUsernames(p);
  const theirs = gamesOf(all, names);
  // `all` is newest first, so the first rated game holds the current rating.
  let rating = "";
  for (const g of theirs) {
    const c = getUserColor(g, names);
    const elo = c === "white" ? g.white_elo : g.black_elo;
    if (elo) {
      rating = `${elo}${g.speed_category ? ` · ${SPEED_DE[g.speed_category] ?? g.speed_category}` : ""}`;
      break;
    }
  }
  return {
    player: p,
    games: theirs.length,
    analyzed: theirs.filter((g) => g.summary_json?.analysis_status === "completed").length,
    rating,
    h2h: headToHead(all, me, names),
  };
}

/** Loads new games for all given players in one go. */
function RefreshAll({ players, label = "Alle aktualisieren" }: { players: TrackedPlayer[]; label?: string }) {
  const [busy, setBusy] = useState("");
  const online = players.filter((p) => p.accounts.some((a) => a.source !== "other"));
  if (online.length < 2) return null;
  const run = async () => {
    setBusy("Lade Partien …");
    const { imported, failed } = await importAllPlayers(online, { onProgress: setBusy });
    setBusy(
      `${plural(imported, "neue Partie", "neue Partien")} geladen${failed.length ? `, nicht erreichbar: ${failed.join(", ")}` : ""}.`,
    );
    window.setTimeout(() => setBusy(""), failed.length ? 6000 : 3000);
  };
  return (
    <span class="refresh-all">
      <button class="btn" disabled={Boolean(busy)} onClick={() => void run()} title="Neue Partien aller Spieler von Lichess und Chess.com laden">
        <IconSync /> {label}
      </button>
      {busy && <span class="small muted" role="status">{busy}</span>}
    </span>
  );
}

/**
 * Queues every not yet analysed game of the friends (all shown players when
 * nobody is marked as friend). The queue runs the newest games first.
 */
function AnalyzeFriends({ players, games }: { players: TrackedPlayer[]; games: StoredGame[] }) {
  const queue = useQueue();
  const { skipBullet } = useBulletPrefs();
  const shown = players.filter((p) => !p.hidden);
  const friends = shown.some((p) => p.friend) ? shown.filter((p) => p.friend) : shown;
  const open = useMemo(() => {
    const names = friends.flatMap(playerUsernames);
    return gamesOf(games, names)
      .filter((g) => g.summary_json?.analysis_status !== "completed" && !(skipBullet && isBulletGame(g)))
      .map((g) => g.id);
  }, [games, friends.map((p) => p.id).join("|"), skipBullet]);
  const inQueue = new Set([...(queue?.queued ?? []), ...(queue?.current ? [queue.current] : [])]);
  const waiting = open.filter((id) => !inQueue.has(id));
  const running = open.length - waiting.length;
  if (!open.length) return null;
  const who = friends.length === shown.length && !shown.some((p) => p.friend) ? "aller Spieler" : "deiner Freunde";
  return (
    <button
      class="btn"
      disabled={!waiting.length}
      onClick={() => void enqueue(waiting)}
      title={`Alle noch nicht analysierten Partien ${who}, die neuesten zuerst${skipBullet ? ", ohne Bullet" : ""}`}
    >
      <IconPlay />{" "}
      {waiting.length
        ? `Neue Partien ${who} analysieren (${waiting.length})`
        : `Analyse läuft (${plural(running, "Partie", "Partien")})`}
    </button>
  );
}

function H2HLine({ h, name }: { h: HeadToHead; name: string }) {
  if (!h.games) return <span class="faint small">Noch keine Partie gegen {name}</span>;
  return (
    <span class="small">
      Du gegen {name}: <strong class="tnum">{h.wins}</strong> S · <strong class="tnum">{h.draws}</strong> R ·{" "}
      <strong class="tnum">{h.losses}</strong> N
    </span>
  );
}

function PlayerList({ players, games, me }: { players: TrackedPlayer[]; games: StoredGame[]; me: string[] }) {
  const [adding, setAdding] = useState<{ username: string; source: AddSource } | null | undefined>(undefined);
  const cards = useMemo(() => orderPlayers(players.map((p) => cardData(p, games, me))), [players, games, me]);
  const suggestions = useMemo(
    () => frequentOpponents(games, me, players.flatMap(playerUsernames)).slice(0, 6),
    [games, me, players],
  );
  const sourceOf = (username: string): AddSource => {
    const g = games.find((x) => [x.white, x.black].some((n) => n.toLowerCase() === username.toLowerCase()));
    return g?.source === "lichess" || g?.source === "chesscom" ? g.source : "other";
  };

  return (
    <>
      {players.length === 0 ? (
        <div class="empty">
          <CoachAvatar size={88} mood="think" />
          <h3>Noch keine Spieler</h3>
          <p>
            Füge Freunde oder Gegner mit ihrem Lichess- oder Chess.com-Namen hinzu. Die App lädt ihre Partien, zeigt dir,
            mit welchen Eröffnungen und Taktiken du sie schlägst, und vergleicht euch in einer Rangliste.
          </p>
          <button class="btn primary" onClick={() => setAdding(null)}>
            <IconPlus /> Spieler hinzufügen
          </button>
        </div>
      ) : (
        <div class="player-grid">
          {cards.shown.map((c) => (
            <button key={c.player.id} class="card player-card" onClick={() => navigate({ view: "players", playerId: c.player.id })}>
              <div class="player-card-head">
                <span class="player-avatar" aria-hidden="true">
                  {c.player.name.slice(0, 1).toUpperCase()}
                </span>
                <span class="player-card-name">
                  <strong>{c.player.name}</strong>
                  <span class="faint small">
                    {c.player.accounts.map((a) => `${SOURCE_LABELS[a.source]}: ${a.username}`).join(" · ")}
                  </span>
                </span>
                {c.player.friend && <span class="pill accent">Freund</span>}
              </div>
              <div class="player-card-stats">
                <span>
                  <strong class="tnum">{c.games}</strong>
                  <span class="faint small"> Partien</span>
                </span>
                <span>
                  <strong class="tnum">{c.analyzed}</strong>
                  <span class="faint small"> analysiert</span>
                </span>
                {c.rating && (
                  <span>
                    <strong class="tnum">{c.rating}</strong>
                  </span>
                )}
              </div>
              <H2HLine h={c.h2h} name={c.player.name} />
              {c.player.accounts.some((a) => a.source !== "other") && (
                <span class="faint small">{loadedAgo(c.player.imported_at)}</span>
              )}
            </button>
          ))}
          {cards.shown.length === 0 && <p class="muted small">Alle Spieler sind ausgeblendet.</p>}
        </div>
      )}

      {cards.hidden.length > 0 && (
        <details class="card tile hidden-players">
          <summary>
            <strong>Ausgeblendet</strong>
            <span class="faint small"> · {plural(cards.hidden.length, "Spieler", "Spieler")}, nicht in Rangliste und Vergleich</span>
          </summary>
          <div class="suggest-list">
            {cards.hidden.map((c) => (
              <div class="suggest-row" key={c.player.id}>
                <a href={toHash({ view: "players", playerId: c.player.id })}>
                  <strong>{c.player.name}</strong>
                  <span class="faint small">
                    {" "}
                    · {plural(c.games, "Partie", "Partien")}
                    {c.player.friend ? " · Freund" : ""}
                  </span>
                </a>
                <button class="btn small" onClick={() => void updatePlayer(c.player.id, { hidden: false })}>
                  <IconEye /> Einblenden
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {suggestions.length > 0 && (
        <section class="card tile">
          <div class="tile-head">
            <h3>Deine häufigsten Gegner</h3>
            <span class="tile-sub">aus deinen Partien</span>
          </div>
          <div class="suggest-list">
            {suggestions.map((s) => (
              <div class="suggest-row" key={s.username}>
                <span>
                  <strong>{s.username}</strong>
                  <span class="faint small">
                    {" "}
                    · {plural(s.games, "Partie", "Partien")} · du holst {pct0(s.score_pct)}
                  </span>
                </span>
                <button class="btn small" onClick={() => setAdding({ username: s.username, source: sourceOf(s.username) })}>
                  <IconPlus /> Hinzufügen
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {players.length > 0 && (
        <div class="row" style={{ justifyContent: "center", marginTop: "6px", flexWrap: "wrap", gap: "8px" }}>
          <button class="btn primary" onClick={() => setAdding(null)}>
            <IconPlus /> Spieler hinzufügen
          </button>
          <RefreshAll players={players.filter((p) => !p.hidden)} />
          <AnalyzeFriends players={players} games={games} />
        </div>
      )}

      {adding !== undefined && (
        <AddPlayerDialog
          initial={adding ?? undefined}
          onClose={(p) => {
            setAdding(undefined);
            if (p) navigate({ view: "players", playerId: p.id });
          }}
        />
      )}
    </>
  );
}

// ---------- ranking ----------

function formatFactor(key: string, v: number | null): string {
  if (v === null) return "–";
  switch (key) {
    case "rating":
    case "activity":
      return String(Math.round(v));
    case "expectation":
      return signed(v);
    case "blunders":
      return de(v, 2);
    case "score":
    case "accuracy":
    case "h2h":
      return `${de(v, v >= 99.95 ? 0 : 1)} %`;
    default:
      return String(Math.round(v));
  }
}

const MEDALS = ["gold", "silver", "bronze"];

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span class="rank-badge none">–</span>;
  return <span class={`rank-badge ${MEDALS[rank - 1] ?? ""}`}>{rank}</span>;
}

function RankingTable({ ranking, factor }: { ranking: Ranking; factor: string }) {
  const f = ranking.factors.find((x) => x.key === factor);
  const rows = [...ranking.rows].sort((a, b) => {
    if (factor === "overall") return (a.rank ?? Infinity) - (b.rank ?? Infinity);
    return (a.cells[factor]?.rank ?? Infinity) - (b.cells[factor]?.rank ?? Infinity) || (a.rank ?? Infinity) - (b.rank ?? Infinity);
  });
  const cols = ["rating", "accuracy", "expectation", "blunders", "h2h"];
  return (
    <div class="table-scroll">
      <table class="table rank-table">
        <thead>
          <tr>
            <th>Platz</th>
            <th>Spieler</th>
            <th class="num">{f ? f.label : "Gesamt"}</th>
            {factor === "overall" &&
              cols.map((k) => (
                <th class="num wide-only" key={k}>
                  {ranking.factors.find((x) => x.key === k)?.label}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cell = factor === "overall" ? null : r.cells[factor];
            const rank = factor === "overall" ? r.rank : (cell?.rank ?? null);
            return (
              <tr key={r.id} class={r.is_me ? "me" : ""} onClick={() => !r.is_me && navigate({ view: "players", playerId: r.id })}>
                <td>
                  <RankBadge rank={rank} />
                </td>
                <td>
                  <strong>{r.name}</strong>
                  <div class="faint small">
                    {plural(r.games, "Partie", "Partien")} · {r.analyzed} analysiert
                  </div>
                </td>
                <td class="num">
                  {factor === "overall" ? (
                    <div class="rank-score">
                      <div class="bar-track">
                        <div class="bar-fill" style={{ width: `${Math.max(2, r.overall ?? 0)}%` }} />
                      </div>
                      <strong>{r.overall === null ? "–" : Math.round(r.overall)}</strong>
                    </div>
                  ) : (
                    <>
                      <strong>{formatFactor(factor, cell?.value ?? null)}</strong>
                      {cell?.note && <div class="faint small">{cell.note}</div>}
                    </>
                  )}
                </td>
                {factor === "overall" &&
                  cols.map((k) => (
                    <td class={`num wide-only${r.cells[k]?.rank === 1 ? " lead" : ""}`} key={k}>
                      {formatFactor(k, r.cells[k]?.value ?? null)}
                    </td>
                  ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Leaders({ ranking }: { ranking: Ranking }) {
  const items = ranking.factors
    .map((f) => {
      const best = ranking.rows.filter((r) => r.cells[f.key]?.rank === 1);
      return { f, best };
    })
    .filter((x) => x.best.length > 0);
  if (!items.length) return <p class="muted small">Für den Vergleich fehlen noch Daten.</p>;
  return (
    <div class="leaders">
      {items.map(({ f, best }) => (
        <div class="leader" key={f.key} title={f.hint}>
          <span class="faint small">{f.label}</span>
          <strong>{best.map((b) => b.name).join(", ")}</strong>
          <span class="tnum small muted">{formatFactor(f.key, best[0].cells[f.key].value)}</span>
        </div>
      ))}
    </div>
  );
}

function Podium({ rows }: { rows: RankRow[] }) {
  const top = rows.filter((r) => r.rank !== null).slice(0, 3);
  if (!top.length) return null;
  // Second, first, third like a real podium.
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  return (
    <div class="podium">
      {order.map((r) => (
        <div key={r.id} class={`podium-step p${r.rank}${r.is_me ? " me" : ""}`}>
          <span class="player-avatar big" aria-hidden="true">
            {r.name.slice(0, 1).toUpperCase()}
          </span>
          <strong>{r.name}</strong>
          <span class="tnum small muted">{r.overall === null ? "–" : `${Math.round(r.overall)} Punkte`}</span>
          <div class="podium-block">{r.rank}</div>
        </div>
      ))}
    </div>
  );
}

/** Who takes part in the ranking: one tap hides or shows a friend, and it stays that way. */
function RankingMembers({ friends }: { friends: TrackedPlayer[] }) {
  const hidden = friends.filter((p) => p.hidden);
  return (
    <div class="rank-members">
      <span class="small muted">Im Vergleich:</span>
      <div class="chips">
        <span class="chip member on me" title="Du bist immer dabei">
          Du
        </span>
        {friends.map((p) => (
          <button
            key={p.id}
            class={`chip member${p.hidden ? "" : " on"}`}
            aria-pressed={!p.hidden}
            title={p.hidden ? `${p.name} wieder in die Rangliste aufnehmen` : `${p.name} in Rangliste und Vergleich ausblenden`}
            onClick={() => void updatePlayer(p.id, { hidden: !p.hidden })}
          >
            {p.hidden ? <IconEyeOff /> : <IconEye />} {p.name}
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

function RankingPanel({ players, games, me }: { players: TrackedPlayer[]; games: StoredGame[]; me: string[] }) {
  const [format, setFormat] = useState("All Formats");
  const [date, setDate] = useState("All Time");
  const [factor, setFactor] = useState("overall");
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const allFriends = players.filter((p) => p.friend);
  const friends = rankedFriends(players);
  const { excludeBullet, ready } = useBulletPrefs();
  const fmt = statsFormat(format, excludeBullet);
  // Profiles per player and filter, so hiding or showing a friend only re-ranks
  // and needs no new profile from the worker. Cleared when the games change.
  const cache = useRef<{ games: StoredGame[]; map: Map<string, Promise<PlayerProfile>> }>({ games, map: new Map() });
  const groupKey = friends.map((p) => `${p.id}=${playerUsernames(p).join(",")}=${p.name}`).join("|");

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
    const group = [
      ...(me.length ? [{ id: "ich", name: "Du", is_me: true, usernames: me }] : []),
      ...friends.map((p) => ({ id: p.id, name: p.name, is_me: false, usernames: playerUsernames(p) })),
    ];
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

  if (!allFriends.length) {
    return (
      <div class="empty">
        <CoachAvatar size={88} mood="think" />
        <h3>Noch keine Freunde in der Rangliste</h3>
        <p>Füge Freunde hinzu (Haken „In die Freundes-Rangliste aufnehmen“), dann vergleicht die App euch nach Wertung, Genauigkeit, Patzern, Fähigkeiten und Direktvergleich.</p>
        <button class="btn primary" onClick={() => navigate({ view: "players" })}>
          Zu den Spielern
        </button>
      </div>
    );
  }

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <div class="rank-toolbar">
        <PlayerFilters format={format} date={date} onFormat={setFormat} onDate={setDate} />
        <RefreshAll players={friends} label="Freunde aktualisieren" />
        <AnalyzeFriends players={friends} games={games} />
      </div>
      <RankingMembers friends={allFriends} />
      {error && <p class="error">{error}</p>}
      {!friends.length ? (
        <div class="empty">
          <CoachAvatar size={72} mood="think" />
          <h3>Alle Freunde sind ausgeblendet</h3>
          <p>Tippe oben auf einen Namen, um ihn wieder in die Rangliste aufzunehmen.</p>
        </div>
      ) : !ranking ? (
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "220px" }} />
          <div class="skeleton span-12" style={{ height: "300px" }} />
        </div>
      ) : (
        <div class="dash">
          <section class="card tile span-12">
            <div class="tile-head">
              <h3>Wer ist der Beste?</h3>
              <span class="tile-sub">Gesamtwertung aus {ranking.factors.length} Faktoren</span>
            </div>
            <Podium rows={ranking.rows} />
          </section>

          <section class="card tile span-12">
            <div class="tile-head">
              <h3>Rangliste</h3>
              <select class="factor-select" value={factor} onChange={(e) => setFactor(e.currentTarget.value)} aria-label="Faktor">
                <option value="overall">Gesamtwertung</option>
                {(["Ergebnisse", "Spielqualität", "Fähigkeiten", "Sonstiges"] as const).map((grp) => (
                  <optgroup key={grp} label={grp}>
                    {ranking.factors
                      .filter((f) => f.group === grp)
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {f.key === "rating" && ranking.rating_speed ? ` (${ranking.rating_speed})` : ""}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <p class="small muted" style={{ marginTop: 0 }}>
              {factor === "overall"
                ? "Jeder Faktor vergibt Punkte nach der Wahrscheinlichkeit, wirklich besser als die anderen zu sein (Messunsicherheit eingerechnet): ein knapper Vorsprung aus wenigen Partien bringt kaum mehr als die Hälfte, ein klarer fast 100. Die Gesamtwertung ist der gewichtete Schnitt; Genauigkeit, Über Erwartung und Direktvergleich zählen am stärksten."
                : ranking.factors.find((f) => f.key === factor)?.hint}
            </p>
            <RankingTable ranking={ranking} factor={factor} />
          </section>

          <section class="card tile span-12">
            <div class="tile-head">
              <h3>Wer ist wo vorn?</h3>
              <span class="tile-sub">Bester je Faktor</span>
            </div>
            <Leaders ranking={ranking} />
          </section>
          {ranking.notes.length > 0 && (
            <div class="span-12">
              {ranking.notes.map((n) => (
                <p class="faint small" key={n} style={{ margin: "0 0 6px" }}>
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- duel ----------

function duelValue(key: string, v: number | null): string {
  if (v === null) return "–";
  if (key === "accuracy") return `${de(v, 1)} %`;
  return formatFactor(key, v);
}

function verdict(r: MatchupRow, name: string): { text: string; cls: string } {
  if (r.p_me === null) return { text: "zu wenig Daten", cls: "" };
  if (r.edge === "me") return { text: r.sure ? "klar du" : "eher du", cls: "duel-me" };
  if (r.edge === "them") return { text: r.sure ? `klar ${name}` : `eher ${name}`, cls: "duel-them" };
  return { text: "offen", cls: "" };
}

/** You against the player: forecast for the next game and who leads where, with how sure that is. */
function Duel({ name, matchup }: { name: string; matchup: Matchup }) {
  const p = matchup.prediction;
  const rows = matchup.rows.filter((r) => r.p_me !== null);
  const missing = matchup.rows.filter((r) => r.p_me === null).length;
  return (
    <section class="card tile span-12 duel">
      <div class="tile-head">
        <h3>Du gegen {name}</h3>
        <span class="tile-sub">
          {rows.length ? `Du vorn: ${matchup.ahead} · ${name} vorn: ${matchup.behind} · offen: ${matchup.even}` : "Vergleich"}
        </span>
      </div>
      <div class="duel-grid">
        <div class="duel-forecast">
          <div class="kpi-label">Prognose für eure nächste Partie</div>
          {p ? (
            <>
              <div class="kpi-big tnum">{pct0(p.pct)}</div>
              <div class="small muted">
                erwartete Punkte für dich · wahrscheinlich {Math.round(p.low)}–{Math.round(p.high)} %
              </div>
              <div class="duel-band" role="img" aria-label={`Prognose ${Math.round(p.pct)} Prozent, Bereich ${Math.round(p.low)} bis ${Math.round(p.high)} Prozent`}>
                <div class="duel-band-range" style={{ left: `${p.low}%`, width: `${Math.max(1, p.high - p.low)}%` }} />
                <div class="duel-band-mid" />
                <div class="duel-band-mark" style={{ left: `${p.pct}%` }} />
              </div>
              <div class="duel-band-labels faint small">
                <span>{name} gewinnt</span>
                <span>ausgeglichen</span>
                <span>du gewinnst</span>
              </div>
              <p class="faint small" style={{ margin: "8px 0 0" }}>
                {p.basis}
                {p.elo_pct !== null && p.h2h_games > 0 ? ` Die Wertung allein sagt ${pct0(p.elo_pct)}.` : ""}
              </p>
            </>
          ) : (
            <p class="muted small">
              Für eine Prognose fehlen vergleichbare Wertungen (gleiche Plattform) oder Partien gegeneinander.
            </p>
          )}
        </div>
        <div class="duel-rows">
          {rows.length ? (
            rows.map((r) => {
              const v = verdict(r, name);
              const pMe = (r.p_me as number) * 100;
              return (
                <div class="duel-row" key={r.key} title={`Wahrscheinlichkeit, dass du hier besser bist: ${Math.round(pMe)} %`}>
                  <span class={`duel-val tnum${r.edge === "me" ? " lead" : ""}`}>{duelValue(r.key, r.me)}</span>
                  <div class="duel-mid">
                    <div class="duel-label">
                      <span>{r.label}</span>
                      <span class={`duel-verdict ${v.cls}`}>{v.text}</span>
                    </div>
                    <div class="duel-tug">
                      <div class="duel-tug-me" style={{ width: `${pMe}%` }} />
                    </div>
                  </div>
                  <span class={`duel-val tnum them${r.edge === "them" ? " lead" : ""}`}>{duelValue(r.key, r.them)}</span>
                </div>
              );
            })
          ) : (
            <p class="muted small">Analysiere Partien von dir und {name} (je mindestens 5), dann vergleicht die App Genauigkeit, Patzer und Fähigkeiten.</p>
          )}
          {rows.length > 0 && (
            <div class="duel-legend faint small">
              <span>
                <span class="vs-key duel-me-key" /> du (links)
              </span>
              <span>
                <span class="vs-key duel-them-key" /> {name} (rechts)
              </span>
              <span>Balken = Wahrscheinlichkeit, wer wirklich besser ist{missing ? ` · ${plural(missing, "Wert", "Werte")} ohne genug Daten` : ""}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- player detail ----------

const KIND_CLASS: Record<string, string> = {
  Eröffnung: "accent",
  Taktik: "loss",
  Strategie: "",
  Zeit: "draw",
  Psychologie: "win",
};

function TipList({ tips, numbered }: { tips: ScoutTip[]; numbered?: boolean }) {
  return (
    <div class="plan">
      {tips.map((t, i) => (
        <div class={`plan-item${numbered ? "" : " no-num"}`} key={t.key}>
          {numbered && <div class="plan-num">{i + 1}</div>}
          <span class={`pill ${KIND_CLASS[t.kind] ?? ""}`}>{t.kind}</span>
          <div class="t" style={{ marginTop: "6px" }}>
            {t.title}
          </div>
          <div class="small muted">{t.text}</div>
        </div>
      ))}
    </div>
  );
}

function PickList({ picks, empty }: { picks: OpeningPick[]; empty: string }) {
  if (!picks.length) return <p class="muted small">{empty}</p>;
  return (
    <div class="picks">
      {picks.map((p, i) => (
        <div class={`pick${i === 0 && p.value >= 5 ? " top" : ""}`} key={p.key}>
          <div class="pick-head">
            <strong>{p.title}</strong>
            {i === 0 && p.value >= 5 && <span class="pill accent">Empfehlung</span>}
            <span class="spacer" />
            <span class={`pill ${p.their_score_pct !== null && p.their_score_pct <= 40 ? "win" : p.their_score_pct !== null && p.their_score_pct >= 60 ? "loss" : "draw"}`}>
              holt {pct0(p.their_score_pct)}
            </span>
          </div>
          <div class="small muted">{p.text}</div>
        </div>
      ))}
    </div>
  );
}

function Repertoire({ report }: { report: ScoutReport }) {
  const total = report.their_first_moves.reduce((s, m) => s + m.games, 0);
  return (
    <>
      <h4>Mit Weiß eröffnet {report.name} mit</h4>
      {report.their_first_moves.length ? (
        <div class="move-chips">
          {report.their_first_moves.slice(0, 5).map((m) => (
            <span class="pill" key={m.san}>
              1. {m.san} · {pct0(total ? (m.games / total) * 100 : null)}
            </span>
          ))}
        </div>
      ) : (
        <p class="muted small">Keine Weißpartien.</p>
      )}
      <h4>Mit Schwarz antwortet {report.name}</h4>
      {report.their_replies.length ? (
        <div class="reply-list">
          {report.their_replies.slice(0, 4).map((v) => (
            <div key={v.san} class="small">
              <strong>auf 1. {v.san}</strong>
              <span class="muted"> mit {v.replies.slice(0, 3).map((r) => `1… ${r.san} (${r.games})`).join(", ")}</span>
            </div>
          ))}
        </div>
      ) : (
        <p class="muted small">Keine Schwarzpartien.</p>
      )}
    </>
  );
}

function PlayerDetail({ id, players, games, me }: { id: string; players: TrackedPlayer[]; games: StoredGame[]; me: string[] }) {
  const player = players.find((p) => p.id === id);
  const [format, setFormat] = useState("All Formats");
  const [date, setDate] = useState("All Time");
  const [data, setData] = useState<{ them: PlayerProfile; mine: PlayerProfile | null } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const queue = useQueue();
  const names = player ? playerUsernames(player) : [];
  // Settings such as hiding the player hand over a new object; only a change of
  // usernames needs new profiles.
  const namesKey = names.join("\n");
  const { excludeBullet, skipBullet, ready } = useBulletPrefs();
  const fmt = statsFormat(format, excludeBullet);

  useEffect(() => {
    if (!player || !ready) return;
    let alive = true;
    setLoading(true);
    Promise.all([profileFor(games, names, fmt, date), me.length ? profileFor(games, me, fmt, date) : Promise.resolve(null)])
      .then(([them, mine]) => {
        if (!alive) return;
        setData({ them, mine });
        setError("");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [namesKey, games, me, fmt, date, ready]);

  const h2h = useMemo(() => headToHead(games, me, names, fmt, date), [games, me, namesKey, fmt, date]);
  const report = useMemo(
    () => (data && player ? buildScoutReport(player.name, data.them, data.mine, h2h) : null),
    [data, player?.name, h2h],
  );
  // Lichess and Chess.com ratings only compare when both mostly play on the same site.
  const sameSite = useMemo(() => {
    const a = mainSource(games, me);
    return Boolean(a) && a !== "file" && a === mainSource(games, names);
  }, [games, me, namesKey]);
  const matchup = useMemo(() => (data ? buildMatchup(data.mine, data.them, h2h, sameSite) : null), [data, h2h, sameSite]);
  // The time control the two mostly play each other in, to offer tips just for it.
  const duelSpeed = useMemo(() => {
    const all = headToHead(games, me, names);
    const by = new Map<string, number>();
    for (const g of all.recent) if (g.speed) by.set(g.speed, (by.get(g.speed) ?? 0) + 1);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && all.games >= 3 && top[1] / all.games >= 0.6 && FORMATS.includes(top[0]) && !(excludeBullet && top[0] === "Bullet") ? top[0] : null;
  }, [games, me, namesKey, excludeBullet]);

  if (!player) {
    return (
      <div class="empty">
        <p>Diesen Spieler gibt es nicht mehr.</p>
        <button class="btn primary" onClick={() => navigate({ view: "players" })}>
          Zu den Spielern
        </button>
      </div>
    );
  }

  const theirGames = gamesOf(games, names);
  const open = theirGames
    .filter((g) => g.summary_json?.analysis_status !== "completed" && !(skipBullet && isBulletGame(g)))
    .map((g) => g.id);
  const queued = new Set([...(queue?.queued ?? []), ...(queue?.current ? [queue.current] : [])]);
  const running = open.filter((g) => queued.has(g)).length;
  const online = player.accounts.some((a) => a.source !== "other");

  const refresh = async (all = false) => {
    setBusy(all ? "Lade die gesamte Spielhistorie …" : "Lade Partien …");
    try {
      const { result, failed } = await importPlayerGames(player, {
        onProgress: setBusy,
        ...(all ? { count: null, months: null } : {}),
      });
      const missed = failed.map((a) => `${SOURCE_LABELS[a.source]}: ${a.username}`).join(", ");
      setBusy(`${plural(result.imported, "neue Partie", "neue Partien")} geladen.${missed ? ` Nicht erreichbar: ${missed}.` : ""}`);
      window.setTimeout(() => setBusy(""), missed ? 6000 : 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  const them = data?.them;
  const rc = them?.rating;
  const wdl = (o: { wins: number; draws: number; losses: number }): Segment[] => [
    { label: "Siege", value: o.wins, color: "var(--win)" },
    { label: "Remis", value: o.draws, color: "var(--draw)" },
    { label: "Niederlagen", value: o.losses, color: "var(--loss)" },
  ];
  const radar = (report?.skills ?? []).map((s) => {
    const sk = them?.skills.find((x) => x.key === s.key);
    return {
      key: s.key,
      label: RADAR_LABELS[s.key] ?? s.name,
      value: s.them,
      compare: s.me,
      faint: !s.reliable,
      margin: sk?.margin ?? null,
      raw: sk?.raw_score ?? null,
    };
  });

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <div class="page-title">
        <button class="btn small ghost" onClick={() => navigate({ view: "players" })} aria-label="Zurück">
          ←
        </button>
        {player.name}
        {player.friend && <span class="pill accent">Freund</span>}
        {player.hidden && <span class="pill">Ausgeblendet</span>}
        <span class="spacer" />
        {online && (
          <button class="btn" disabled={Boolean(busy)} onClick={() => void refresh()}>
            <IconSync /> Partien laden
          </button>
        )}
        {online && (
          <button
            class="btn"
            disabled={Boolean(busy)}
            onClick={() => void refresh(true)}
            title="Alle Partien seit Kontoeröffnung laden, nicht nur die neuesten. Bereits geladene werden übersprungen."
          >
            <IconSync /> Gesamte Zeit laden
          </button>
        )}
        {open.length > 0 && (
          <button
            class="btn"
            disabled={running > 0}
            onClick={() => void enqueue(open.slice(0, ANALYZE_BATCH))}
            title="Die neuesten Partien zuerst"
          >
            <IconPlay /> {running > 0 ? `Analyse läuft (${running})` : `${Math.min(open.length, ANALYZE_BATCH)} analysieren`}
          </button>
        )}
      </div>
      {busy && <p class="small muted">{busy}</p>}
      {player.hidden && (
        <div class="notice row" style={{ marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
          <span>{player.name} ist ausgeblendet und zählt nicht in der Rangliste.</span>
          <button class="btn small" onClick={() => void updatePlayer(player.id, { hidden: false })}>
            <IconEye /> Wieder einblenden
          </button>
        </div>
      )}

      <PlayerFilters format={format} date={date} onFormat={setFormat} onDate={setDate} />
      {duelSpeed && format !== duelSpeed && (
        <p class="small muted duel-speed-hint">
          Ihr spielt meist {formatOptionLabel(duelSpeed, false)} gegeneinander.{" "}
          <button class="btn small" onClick={() => setFormat(duelSpeed)}>
            Tipps nur für {formatOptionLabel(duelSpeed, false)}
          </button>
        </p>
      )}
      {error && <p class="error">{error}</p>}

      {!data || !report || !them ? (
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "150px" }} />
          <div class="skeleton span-12" style={{ height: "260px" }} />
        </div>
      ) : them.total_games === 0 ? (
        <div class="empty">
          <p>
            Noch keine Partien von {player.name}
            {format !== "All Formats" || date !== "All Time" ? " in diesem Zeitraum" : ""}.{" "}
            {online ? "Lade die Partien von Lichess oder Chess.com." : "Importiere eine PGN mit Partien dieser Person."}
          </p>
          {online && (
            <button class="btn primary" disabled={Boolean(busy)} onClick={() => void refresh()}>
              <IconSync /> Partien laden
            </button>
          )}
        </div>
      ) : (
        <div class="dash">
          <section class="card hero span-12">
            <div class="hero-cell">
              <div class="kpi-label">{rc ? `Wertung · ${SPEED_DE[rc.speed] ?? rc.speed}` : "Wertung"}</div>
              <div class="kpi-big tnum">{rc ? rc.rating : "–"}</div>
              <div class="small muted">
                {plural(them.total_games, "Partie", "Partien")} · {them.analyzed_games} analysiert
              </div>
            </div>
            <div class="hero-cell with-chart">
              <Donut segments={wdl(them.overview as { wins: number; draws: number; losses: number })} center={pct0(them.overview.score_pct)} sub="Punkte" size={96} thickness={11} />
              <div class="hero-side">
                <div class="kpi-label">Bilanz von {player.name}</div>
                <Legend items={wdl(them.overview as { wins: number; draws: number; losses: number }).map((s) => ({ label: s.label, color: s.color, value: String(s.value) }))} />
              </div>
            </div>
            <div class="hero-cell with-chart">
              <Donut segments={wdl(h2h)} center={h2h.games ? pct0(h2h.score_pct) : "–"} sub="deine Punkte" size={96} thickness={11} />
              <div class="hero-side">
                <div class="kpi-label">Direktvergleich</div>
                {h2h.games ? (
                  <Legend items={wdl(h2h).map((s) => ({ label: s.label, color: s.color, value: String(s.value) }))} />
                ) : (
                  <div class="small muted">Ihr habt noch nicht gegeneinander gespielt.</div>
                )}
              </div>
            </div>
            <div class="hero-cell">
              <div class="kpi-label">Genauigkeit</div>
              <div class="kpi-big tnum">{them.analyzed_games ? de(them.overview.avg_accuracy, 1) : "–"}</div>
              <div class="small muted">
                {data.mine && data.mine.analyzed_games && them.analyzed_games
                  ? `Du: ${de(data.mine.overview.avg_accuracy, 1)}`
                  : them.analyzed_games
                    ? ""
                    : "Partien analysieren, um sie zu sehen"}
              </div>
            </div>
          </section>

          {matchup && <Duel name={player.name} matchup={matchup} />}

          <section class="card tile span-12">
            <div class="tile-head">
              <h3>So schlägst du {player.name}</h3>
              <span class="tile-sub">aus {plural(them.total_games, "Partie", "Partien")} von {player.name}</span>
            </div>
            {report.plan.length ? (
              <TipList tips={report.plan} numbered />
            ) : (
              <p class="muted small">Noch keine klare Schwachstelle erkennbar. Mehr Partien laden oder analysieren hilft.</p>
            )}
            {them.analyzed_games < 3 && (
              <div class="notice" style={{ marginTop: "12px" }}>
                <div class="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    Eröffnungstipps kommen schon aus den Ergebnissen. Für Taktik- und Strategietipps braucht die App analysierte
                    Partien von {player.name}.
                  </span>
                  {open.length > 0 && running === 0 && (
                    <button class="btn primary small" onClick={() => void enqueue(open.slice(0, ANALYZE_BATCH))}>
                      <IconPlay /> {Math.min(open.length, ANALYZE_BATCH)} analysieren
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <section class="card tile span-6">
            <div class="tile-head">
              <h3>Du hast Weiß</h3>
              <span class="tile-sub">{player.name} mit Schwarz</span>
            </div>
            <PickList picks={report.as_white} empty={`Keine Eröffnung, in der ${player.name} mit Schwarz klar schwach punktet (gezählt ab ${MIN_LINE_GAMES} Partien pro Eröffnung).`} />
          </section>

          <section class="card tile span-6">
            <div class="tile-head">
              <h3>Du hast Schwarz</h3>
              <span class="tile-sub">{player.name} mit Weiß</span>
            </div>
            <PickList picks={report.as_black} empty={`Keine Antwort, gegen die ${player.name} mit Weiß klar schwach punktet (gezählt ab ${MIN_LINE_GAMES} Partien pro Antwort).`} />
          </section>

          {radar.length >= 3 && (
            <section class="card tile span-6">
              <div class="tile-head">
                <h3>Fähigkeiten im Vergleich</h3>
                <span class="tile-sub">0–100 Punkte</span>
              </div>
              <RadarChart axes={radar} ownLabel={player.name} compare={data.mine ? "Du" : undefined} />
            </section>
          )}

          {report.cautions.length > 0 && (
            <section class="card tile span-6">
              <div class="tile-head">
                <h3>Vorsicht</h3>
                <span class="tile-sub">Stärken von {player.name}</span>
              </div>
              <div class="insights">
                {report.cautions.map((c) => (
                  <div class="insight neg" key={c.key}>
                    <div class="t">{c.title}</div>
                    <div class="small">{c.text}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section class="card tile span-6">
            <div class="tile-head">
              <h3>Repertoire von {player.name}</h3>
            </div>
            <Repertoire report={report} />
          </section>

          <section class="card tile span-6">
            <div class="tile-head">
              <h3>So verliert {player.name}</h3>
              <span class="tile-sub">{plural(them.overview.losses, "Niederlage", "Niederlagen")}</span>
            </div>
            {report.losses.length ? (
              <StackBar
                segments={report.losses.map((l, i) => ({
                  label: `${l.label} (${Math.round(l.pct)} %)`,
                  value: l.count,
                  color: ["var(--loss)", "var(--mistake)", "var(--inacc)", "var(--draw)"][i] ?? "var(--draw)",
                }))}
              />
            ) : (
              <p class="muted small">Keine Niederlagen in diesen Partien.</p>
            )}
          </section>

          <FriendDetails name={player.name} them={them} mine={data.mine} games={theirGames} names={names} />

          {h2h.recent.length > 0 && (
            <section class="card tile span-6">
              <div class="tile-head">
                <h3>Eure Partien</h3>
                <span class="tile-sub">neueste zuerst</span>
              </div>
              <div class="op-games">
                {h2h.recent.slice(0, 8).map((g) => (
                  <button key={g.id} class="op-game" onClick={() => navigate({ view: "analysis", gameId: g.id })}>
                    <span class={`op-result ${g.score === 1 ? "win" : g.score === 0 ? "loss" : "draw"}`}>
                      {g.score === 1 ? "S" : g.score === 0 ? "N" : "R"}
                    </span>
                    <span class="op-opp">
                      {g.color === "white" ? "Du mit Weiß" : "Du mit Schwarz"}
                      {g.opening && <span class="faint"> · {g.opening.split(":")[0]}</span>}
                    </span>
                    <span class="faint small">{formatDate(g.date)}</span>
                    <span class="small op-acc">{SPEED_DE[g.speed] ?? ""}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <PlayerSettings player={player} />
    </div>
  );
}

const PHASES: [string, string][] = [
  ["opening", "Eröffnung"],
  ["middlegame", "Mittelspiel"],
  ["endgame", "Endspiel"],
];

/** More about a friend: move tally, rating and accuracy history, activity, style and newest games. */
function FriendDetails({
  name,
  them,
  mine,
  games,
  names,
}: {
  name: string;
  them: PlayerProfile;
  mine: PlayerProfile | null;
  games: StoredGame[];
  names: string[];
}) {
  const [speed, setSpeed] = useState<string | null>(null);
  const calendar = useMemo(() => activityCalendar(dailyActivity(games, names), localDay(), 16), [games, names.join("|")]);
  const t = them.moves;
  const m = mine?.moves ?? null;

  const ratingSeries = (them.trends.ratings ?? {}) as Record<string, [number, number][]>;
  const speeds = Object.keys(ratingSeries).sort((a, b) => ratingSeries[b].length - ratingSeries[a].length);
  const shown = speed && ratingSeries[speed] ? speed : speeds[0];
  const ratingPoints = (ratingSeries[shown] ?? []).map(([ts, r]) => {
    const d = new Date(ts * 1000);
    return { label: d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }), value: r, detail: d.toLocaleDateString("de-DE") };
  });

  const theirPhase = (them.overview.phase_accuracy ?? {}) as Record<string, number>;
  const myPhase = (mine?.analyzed_games ? mine.overview.phase_accuracy ?? {} : {}) as Record<string, number>;
  // Accuracy has a 10 % floor per move, so 0 only means "no moves in this phase".
  const known = (v: number | undefined) => (v ? v : null);
  const phaseRows: BarRow[] = PHASES.map(([k, label]) => ({
    label,
    value: known(theirPhase[k]),
    reference: known(myPhase[k]),
    valueText: theirPhase[k] ? `${de(theirPhase[k], 1)} %` : "–",
  }));
  const weekly = (them.trends.weekly ?? []) as { week: string; avg_accuracy: number | null }[];

  return (
    <>
      <section class="card tile span-6">
        <div class="tile-head">
          <h3>Zugbilanz von {name}</h3>
          <span class="tile-sub">{t ? `aus ${plural(t.games, "analysierten Partie", "analysierten Partien")}` : ""}</span>
        </div>
        {t ? (
          <ClassTiles tally={t} keys={["Brilliant", "Great", "Best", "Inaccuracy", "Mistake", "Blunder"]} compact />
        ) : (
          <p class="muted small">Analysiere Partien von {name}, dann siehst du hier brillante Züge, Fehler und Patzer.</p>
        )}
      </section>

      <section class="card tile span-6">
        <div class="tile-head">
          <h3>{name} und du</h3>
          <span class="tile-sub">Zugbewertungen im Vergleich</span>
        </div>
        {t && m ? (
          <VersusBars
            a={{ label: name, moves: t.moves, counts: t.counts }}
            b={{ label: "Du", moves: m.moves, counts: m.counts }}
            keys={["Brilliant", "Great", "Best", "Inaccuracy", "Mistake", "Blunder"]}
          />
        ) : (
          <p class="muted small">Der Vergleich erscheint, sobald von euch beiden Partien analysiert sind.</p>
        )}
      </section>

      {ratingPoints.length > 1 && (
        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Wertungsverlauf</h3>
            <span class="tile-sub">{shown}</span>
          </div>
          {speeds.length > 1 && (
            <div class="segmented small-seg">
              {speeds.map((sp) => (
                <button key={sp} class={sp === shown ? "active" : ""} onClick={() => setSpeed(sp)}>
                  {sp}
                </button>
              ))}
            </div>
          )}
          <AreaChart points={ratingPoints} format={(v) => v.toFixed(0)} />
        </section>
      )}

      {them.analyzed_games > 0 && (
        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Genauigkeit nach Phase</h3>
            <span class="tile-sub">{mine?.analyzed_games ? "Strich: deine Werte" : ""}</span>
          </div>
          <BarList rows={phaseRows} ownLabel={name} referenceLabel={mine?.analyzed_games ? "Du" : undefined} />
          <FormStats weekly={weekly} />
        </section>
      )}

      <section class="card tile span-6">
        <div class="tile-head">
          <h3>Aktivität von {name}</h3>
          <span class="tile-sub">letzte 16 Wochen</span>
        </div>
        <Calendar days={calendar} note="Nur Partien, die in der App gespeichert sind." />
      </section>

      {them.style && (
        <section class="card tile span-6">
          <div class="tile-head">
            <h3>Spielstil: {them.style.label}</h3>
          </div>
          <StyleAxes axes={them.style.axes} />
        </section>
      )}

      <section class="card tile span-6">
        <div class="tile-head">
          <h3>Neueste Partien von {name}</h3>
        </div>
        <RecentGames profile={them} />
      </section>
    </>
  );
}

function PlayerSettings({ player }: { player: TrackedPlayer }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <section class="card tile player-settings">
      <div class="tile-head">
        <h3>Spieler verwalten</h3>
      </div>
      <label class="toggle-row">
        <input type="checkbox" checked={player.friend} onChange={(e) => void updatePlayer(player.id, { friend: e.currentTarget.checked })} />
        <span>
          <strong>Freund</strong>
          <small class="faint">Freunde werden in der Rangliste mit dir verglichen und bekommen eine ausführlichere Seite.</small>
        </span>
      </label>
      <label class="toggle-row">
        <input type="checkbox" checked={player.hidden} onChange={(e) => void updatePlayer(player.id, { hidden: e.currentTarget.checked })} />
        <span>
          <strong>In Rangliste und Vergleich ausblenden</strong>
          <small class="faint">
            {player.name} bleibt gespeichert, zählt aber nicht in der Rangliste und steht in der Spielerliste unter „Ausgeblendet“.
            Diese Seite bleibt erreichbar.
          </small>
        </span>
      </label>
      <div class="row" style={{ marginTop: "10px", flexWrap: "wrap", gap: "8px" }}>
        {confirm ? (
          <>
            <button
              class="btn"
              onClick={() => void removePlayer(player.id).then(() => navigate({ view: "players" }))}
            >
              Nur Spieler entfernen
            </button>
            <button
              class="btn danger"
              onClick={() => void removePlayer(player.id, { deleteGames: true }).then(() => navigate({ view: "players" }))}
            >
              <IconTrash /> Spieler und Partien löschen
            </button>
            <button class="btn ghost" onClick={() => setConfirm(false)}>
              Abbrechen
            </button>
          </>
        ) : (
          <button class="btn" onClick={() => setConfirm(true)}>
            <IconTrash /> Entfernen
          </button>
        )}
      </div>
      {confirm && (
        <p class="faint small">Beim Löschen bleiben Partien erhalten, an denen du oder ein anderer Spieler beteiligt seid.</p>
      )}
    </section>
  );
}

// ---------- page ----------

export function PlayersView({ playerId, tab }: { playerId?: string; tab?: "rangliste" }) {
  const { players, games, me } = useData();
  if (!players) {
    return (
      <div>
        <div class="page-title">Spieler</div>
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "180px" }} />
        </div>
      </div>
    );
  }
  if (playerId) return <PlayerDetail id={playerId} players={players} games={games} me={me} />;
  return (
    <div>
      <div class="page-title">
        Spieler
        <span class="spacer" />
        <div class="segmented">
          <button class={tab !== "rangliste" ? "active" : ""} onClick={() => navigate({ view: "players" })}>
            Gegner & Freunde
          </button>
          <button class={tab === "rangliste" ? "active" : ""} onClick={() => navigate({ view: "players", tab: "rangliste" })}>
            Rangliste
          </button>
        </div>
      </div>
      {!me.length && (
        <div class="notice" style={{ marginBottom: "14px" }}>
          Trag in den Einstellungen deine eigenen Spielernamen ein, damit Direktvergleich und Rangliste dich erkennen.
        </div>
      )}
      <CoachTip id={tab === "rangliste" ? "ranking" : "players"} title={tab === "rangliste" ? "Wer ist der Beste?" : "Deine Gegner und Freunde"}>
        {tab === "rangliste"
          ? "Ich vergleiche dich mit deinen Freunden in 15 Bereichen, von Genauigkeit bis Zeitmanagement. Knappe Vorsprünge aus wenigen Partien zählen kaum, klare Vorsprünge voll. Daraus entsteht die Gesamtwertung."
          : "Füge Gegner oder Freunde hinzu, dann lade ich ihre Partien und schreibe dir einen Bericht: Was spielen sie, wo sind sie stark und wie packst du sie am besten?"}
      </CoachTip>
      {tab === "rangliste" ? <RankingPanel players={players} games={games} me={me} /> : <PlayerList players={players} games={games} me={me} />}
    </div>
  );
}
