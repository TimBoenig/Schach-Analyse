import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { enqueue } from "../app/analysisService";
import { isBulletGame, statsFormat } from "../domain/analysisDepth";
import { addPlayer, importPlayerGames, loadPlayers, removePlayer, updatePlayer } from "../app/players";
import { getUserColor } from "../domain/metrics";
import {
  buildMatchup,
  qualityGames,
  speedFairness,
  buildScoutReport,
  duelInsights,
  frequentOpponents,
  headToHead,
  mainSource,
  MIN_LINE_GAMES,
  type AccountSource,
  type HeadToHead,
  type OpeningPick,
  openingPreview,
  orderPlayers,
  playerUsernames,
  type ScoutReport,
  type ScoutTip,
  type SharedOpening,
  sharedOpenings,
  SOURCE_LABELS,
  type TrackedPlayer,
} from "../domain/players";
import { dailyActivity, type PlayerProfile } from "../domain/profile";
import { localDay } from "../domain/training";
import type { StoredGame } from "../domain/types";
import { getSetting, listGames, onDataChanged } from "../storage/db";
import { PageHeader } from "./Layout";
import { AreaChart, BarList, RadarChart, ratingSeriesPoints, StackBar } from "./charts";
import type { BarRow } from "./charts";
import { Calendar, FormStats, RecentGames } from "./HomeView";
import { ClassTiles, VersusBars } from "./MoveTally";
import { StyleAxes } from "./ProfileView";
import { IconEye, IconPlay, IconPlus, IconSync, IconTrash } from "./icons";
import { loadedAgo, SPEED_DE } from "./labels";
import { navigate, toHash } from "./router";
import { CoachAvatar, CoachTip } from "./Coach";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { FORMATS, formatOptionLabel } from "./useProfile";
import { AnalyzeFriends, Avatar, de, gamesOf, pct0, PlayerFilters, plural, profileFor, RefreshAll, toneOf, useQueue } from "./players/common";
import { LeaguePage } from "./players/League";
import { DuelStory, FaceOff, NextGameCard, TaleOfTape, TippingCard } from "./players/Rivalry";

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

const SECTIONS: [string, boolean, string][] = [
  ["Freunde", true, "in Rangliste und Vergleich"],
  ["Gegner", false, "zum Ausspähen vor der Partie"],
];

/** Summary strip on top of the player list: who you track and how you fare against them. */
function PlayersHero({ cards, onAdd, players, games }: { cards: PlayerCardData[]; onAdd: () => void; players: TrackedPlayer[]; games: StoredGame[] }) {
  const t = cards.reduce((a, c) => ({ w: a.w + c.h2h.wins, d: a.d + c.h2h.draws, l: a.l + c.h2h.losses }), { w: 0, d: 0, l: 0 });
  const n = t.w + t.d + t.l;
  const friends = cards.filter((c) => c.player.friend).length;
  return (
    <section class="card players-hero">
      <div class="players-hero-stats">
        <div>
          <span class="players-hero-num tnum">{cards.length}</span>
          <span class="faint small">Spieler</span>
        </div>
        <div>
          <span class="players-hero-num tnum">{friends}</span>
          <span class="faint small">Freunde</span>
        </div>
        <div>
          <span class="players-hero-num tnum">{n ? pct0(((t.w + t.d / 2) / n) * 100) : "–"}</span>
          <span class="faint small">{n ? `deine Punkte aus ${plural(n, "Direktpartie", "Direktpartien")}` : "noch keine Direktpartie"}</span>
        </div>
      </div>
      <div class="players-hero-actions">
        <button class="btn primary" onClick={onAdd}>
          <IconPlus /> Spieler hinzufügen
        </button>
        <RefreshAll players={players.filter((p) => !p.hidden)} />
        <AnalyzeFriends players={players} games={games} />
      </div>
    </section>
  );
}

/** Win/draw/loss split as one bar, readable at a glance. */
function H2HBar({ h, name }: { h: HeadToHead; name: string }) {
  if (!h.games) return <span class="faint small">Noch keine Partie gegen {name}</span>;
  const n = h.wins + h.draws + h.losses || 1;
  return (
    <div class="h2h-bar-wrap">
      <div class="h2h-bar" aria-hidden="true">
        <span class="w" style={{ flex: h.wins / n }} />
        <span class="d" style={{ flex: h.draws / n }} />
        <span class="l" style={{ flex: h.losses / n }} />
      </div>
      <H2HLine h={h} name={name} />
    </div>
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
        <>
          <PlayersHero cards={cards.shown} onAdd={() => setAdding(null)} players={players} games={games} />
          {SECTIONS.map(([title, isFriend, sub]) => {
            const list = cards.shown.filter((c) => c.player.friend === isFriend);
            if (!list.length) return null;
            return (
              <section class="players-section" key={title}>
                <div class="section-head">
                  <h2>{title}</h2>
                  <span class="pill tnum">{list.length}</span>
                  <span class="faint small">{sub}</span>
                </div>
                <div class="player-grid">
                  {list.map((c) => (
            <button key={c.player.id} class="card player-card" onClick={() => navigate({ view: "players", playerId: c.player.id })}>
              <div class="player-card-head">
                <Avatar name={c.player.name} tone={toneOf(players, c.player.id)} size="lg" />
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
              <H2HBar h={c.h2h} name={c.player.name} />
              {c.player.accounts.some((a) => a.source !== "other") && (
                <span class="faint small">{loadedAgo(c.player.imported_at)}</span>
              )}
            </button>
                  ))}
                </div>
              </section>
            );
          })}
          {cards.shown.length === 0 && <p class="muted small">Alle Spieler sind ausgeblendet.</p>}
        </>
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

type DetailSection = "compare" | "beat" | "profile";

// The player page used to be one long scroll of 15 cards; three tabs keep each view short.
const DETAIL_SECTIONS: [DetailSection, (name: string) => string][] = [
  ["compare", () => "Vergleich"],
  ["beat", (name) => `Gegen ${name}`],
  ["profile", () => "Profil"],
];

/** Openings you both play with the same colour: who scores better in them. */
function SharedOpeningsCard({ name, rows }: { name: string; rows: SharedOpening[] }) {
  return (
    <section class="card tile span-6">
      <div class="tile-head">
        <h3>Gemeinsame Eröffnungen</h3>
        <span class="tile-sub">deine Punkte gegen die von {name}</span>
      </div>
      {rows.length ? (
        <div class="shared-ops">
          {rows.map((o) => (
            <div class="shared-op" key={`${o.color}${o.name}`}>
              <div class="shared-op-head">
                <strong>{o.name}</strong>
                <span class="faint small">mit {o.color === "white" ? "Weiß" : "Schwarz"}</span>
                <span class="spacer" />
                <span class={`pill ${o.better === "me" ? "win" : o.better === "them" ? "loss" : ""}`}>
                  {o.better === "me" ? "du klar besser" : o.better === "them" ? `${name} klar besser` : "ähnlich"}
                </span>
              </div>
              <div class="shared-op-vals small">
                <span>
                  Du <strong class="tnum">{pct0(o.mine.score_pct)}</strong> <span class="faint">({o.mine.games})</span>
                </span>
                <span>
                  {name} <strong class="tnum">{pct0(o.theirs.score_pct)}</strong> <span class="faint">({o.theirs.games})</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p class="muted small">Ihr habt noch keine Eröffnung, die ihr beide mit derselben Farbe mindestens {MIN_LINE_GAMES} Mal gespielt habt.</p>
      )}
    </section>
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
  const [section, setSection] = useState<DetailSection | null>(null);
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
  // Take both players' mix of time controls out of accuracy and blunders.
  const fairness = useMemo(() => {
    const f = speedFairness([qualityGames(games, me, fmt, date), qualityGames(games, names, fmt, date)]);
    return f.applied ? ([f.adjust[0], f.adjust[1]] as const) : null;
  }, [games, me, namesKey, fmt, date]);
  const matchup = useMemo(
    () => (data ? buildMatchup(data.mine, data.them, h2h, sameSite, fairness ? [fairness[0], fairness[1]] : null) : null),
    [data, h2h, sameSite, fairness],
  );
  const duel = useMemo(() => (player && me.length ? duelInsights(games, me, names, player.name, fmt, date) : null), [games, me, namesKey, player?.name, fmt, date]);
  const preview = useMemo(() => (data?.mine ? openingPreview(data.mine, data.them) : null), [data]);
  const tone = toneOf(players, id);
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

  // Friends open on the comparison, opponents on how to beat them.
  const shown: DetailSection = section ?? (player.friend ? "compare" : "beat");

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
          <FaceOff name={player.name} tone={tone} h2h={h2h} matchup={matchup} them={them} mine={data.mine} duel={duel} />

          <div class="span-12 detail-tabs">
            <div class="segmented full" role="tablist">
              {DETAIL_SECTIONS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={shown === k} class={shown === k ? "active" : ""} onClick={() => setSection(k)}>
                  {label(player.name)}
                </button>
              ))}
            </div>
          </div>

          {shown === "compare" && (
            <>
              {matchup && <TaleOfTape name={player.name} tone={tone} matchup={matchup} />}
              {duel && duel.games.length > 0 && <DuelStory name={player.name} duel={duel} />}
              {duel && duel.games.length > 0 && <TippingCard name={player.name} tone={tone} duel={duel} />}
              {preview && <NextGameCard name={player.name} preview={preview} />}
              {radar.length >= 3 && (
                <section class="card tile span-6">
                  <div class="tile-head">
                    <h3>Fähigkeiten im Vergleich</h3>
                    <span class="tile-sub">0–100 Punkte</span>
                  </div>
                  <RadarChart axes={radar} ownLabel={player.name} compare={data.mine ? "Du" : undefined} />
                </section>
              )}
              <FriendDetails part="compare" name={player.name} them={them} mine={data.mine} games={theirGames} names={names} />
              {data.mine && <SharedOpeningsCard name={player.name} rows={sharedOpenings(data.mine, them)} />}
            </>
          )}

          {shown === "beat" && (
            <>
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

            </>
          )}

          {shown === "profile" && <FriendDetails part="profile" name={player.name} them={them} mine={data.mine} games={theirGames} names={names} />}
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
  part,
  name,
  them,
  mine,
  games,
  names,
}: {
  part: "compare" | "profile";
  name: string;
  them: PlayerProfile;
  mine: PlayerProfile | null;
  games: StoredGame[];
  names: string[];
}) {
  const [speed, setSpeed] = useState<string | null>(null);
  const daily = useMemo(() => dailyActivity(games, names), [games, names.join("|")]);
  const t = them.moves;
  const m = mine?.moves ?? null;

  const ratingSeries = (them.trends.ratings ?? {}) as Record<string, [number, number][]>;
  const speeds = Object.keys(ratingSeries).sort((a, b) => ratingSeries[b].length - ratingSeries[a].length);
  const shown = speed && ratingSeries[speed] ? speed : speeds[0];
  const ratingPoints = ratingSeriesPoints(ratingSeries[shown] ?? []);

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

  if (part === "compare") {
    return (
      <>
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
      </>
    );
  }

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

      <section class="card tile span-6">
        <div class="tile-head">
          <h3>Aktivität von {name}</h3>
          <span class="tile-sub">Partien pro Tag</span>
        </div>
        <Calendar daily={daily} today={localDay()} note="Nur Partien, die in der App gespeichert sind." />
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
        <PageHeader />
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "180px" }} />
        </div>
      </div>
    );
  }
  if (playerId) return <PlayerDetail id={playerId} players={players} games={games} me={me} />;
  return (
    <div>
      <PageHeader />
      {!me.length && (
        <div class="notice" style={{ marginBottom: "14px" }}>
          Trag unter Einstellungen › Allgemein deine eigenen Spielernamen ein, damit Direktvergleich und Rangliste dich erkennen.
        </div>
      )}
      {tab !== "rangliste" && (
        <CoachTip id="players" title="Deine Gegner und Freunde">
          Füge Gegner oder Freunde hinzu, dann lade ich ihre Partien und schreibe dir einen Bericht: Was spielen sie, wo sind sie stark und wie packst du sie am besten?
        </CoachTip>
      )}
      {tab === "rangliste" ? <LeaguePage players={players} games={games} me={me} /> : <PlayerList players={players} games={games} me={me} />}
    </div>
  );
}
