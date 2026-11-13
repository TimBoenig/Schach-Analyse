import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { autoAnalyze, cancelAll, cancelGame, enqueue, subscribeQueue, type QueueState } from "../app/analysisService";
import { PageHeader } from "./Layout";
import { LiveDepth } from "./LiveDepth";
import { importChesscomGames, importLichessGames, importPgnText, type ImportResult } from "../api/import";
import { parsePgnTextDetailed } from "../domain/pgn";
import { getUserColor, inDateFilter, isBulletGame } from "../domain/metrics";
import type { GameAnalysis, StoredGame } from "../domain/types";
import { gameExists, getSetting, listGames, onDataChanged, setSetting } from "../storage/db";
import { storeImported } from "../storage/rows";
import { IconPlay, IconPlus, IconStop, IconSync } from "./icons";
import { SPEED_DE, accClass, balanceText, formatDate, monthLabel, outcomeFor, resultText, shortOpening, streakText } from "./labels";
import { isTyping } from "./keys";
import { CountUp, Hero, HeroStat, ResultRibbon, WdlBar } from "./kit";
import { navigate } from "./router";
import { Coach, CoachAvatar } from "./Coach";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { useNarrow } from "./useNarrow";
import { PeriodSelect } from "./useProfile";
import { ENGINE_NAME } from "../engine/info";

type Source = "chesscom" | "lichess" | "pgn";
type Filter = "all" | "analyzed" | "open";

/** Stops this game's analysis (or drops it from the queue); the rest keeps running. */
function CancelButton({ id, label }: { id: string; label: string }) {
  return (
    <button
      class="btn small ghost"
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

function status(g: StoredGame): "completed" | "paused" | "not_started" {
  return (g.summary_json?.analysis_status as "completed" | "paused" | "not_started") ?? "not_started";
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (ids: string[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<Source>("chesscom");
  const [user, setUser] = useState("");
  const [months, setMonths] = useState("3");
  const [count, setCount] = useState("100");
  const [pgn, setPgn] = useState("");
  const [color, setColor] = useState<"" | "white" | "black">("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    void getSetting<Record<string, string>>("import.lastUser", {}).then((u) => setUser(u.chesscom ?? ""));
  }, []);

  const changeSource = async (s: Source) => {
    setSource(s);
    setResult(null);
    setError("");
    if (s !== "pgn") setUser((await getSetting<Record<string, string>>("import.lastUser", {}))[s] ?? "");
  };

  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    abort.current = new AbortController();
    const ids: string[] = [];
    const onBatch = async (games: GameAnalysis[]) => {
      ids.push(...games.map((g) => g.game_id));
      await storeImported(games);
    };
    try {
      let res: ImportResult;
      if (source === "pgn") {
        // A pasted game only shows up under "Meine Partien" once one of its player names is one of mine,
        // so the chosen colour tells us which name that is.
        const names = await getSetting<string[]>("usernames", []);
        const parsed = parsePgnTextDetailed(pgn).games;
        const known = (n: string) => names.some((x) => x.toLowerCase() === n.toLowerCase());
        const mine = new Set<string>();
        if (color) for (const g of parsed) mine.add((color === "white" ? g.metadata.white : g.metadata.black).trim());
        const anyKnown = parsed.some((g) => known(g.metadata.white) || known(g.metadata.black));
        if (!color && !anyKnown && parsed.length) {
          setError("Bitte wähle, mit welcher Farbe du gespielt hast, damit die Partie in „Meine Partien“ erscheint.");
          return;
        }
        const fresh = [...mine].filter((n) => n && n !== "?" && !known(n));
        if (fresh.length) await setSetting("usernames", [...names, ...fresh]);
        const batch = await importPgnText(pgn, gameExists, "file");
        await onBatch(batch.games);
        res = batch.result;
      } else {
        const name = user.trim();
        const last = await getSetting<Record<string, string>>("import.lastUser", {});
        await setSetting("import.lastUser", { ...last, [source]: name });
        const opts = { onBatch, signal: abort.current.signal, onProgress: (_c: number, _t: number, label: string) => setProgress(label) };
        res =
          source === "chesscom"
            ? (await importChesscomGames(name, gameExists, months === "all" ? null : Number(months), opts)).result
            : (await importLichessGames(name, gameExists, Number(count), opts)).result;
        // Remember the player as one of "my" names so the profile picks the games up.
        const names = await getSetting<string[]>("usernames", []);
        if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) await setSetting("usernames", [...names, name]);
      }
      setResult(res);
      onImported(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const readFile = async (f: File) => setPgn(await f.text());

  return (
    <dialog ref={ref} onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>Partien importieren</h3>
      <div class="segmented" style={{ marginBottom: "14px" }}>
        {(
          [
            ["chesscom", "Chess.com"],
            ["lichess", "Lichess"],
            ["pgn", "PGN"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} class={source === k ? "active" : ""} onClick={() => changeSource(k)} disabled={busy}>
            {l}
          </button>
        ))}
      </div>
      {source !== "pgn" ? (
        <>
          <label class="field">
            <span>Benutzername auf {source === "chesscom" ? "Chess.com" : "Lichess"}</span>
            <input type="text" autocapitalize="off" autocorrect="off" value={user} onInput={(e) => setUser(e.currentTarget.value)} />
          </label>
          {source === "chesscom" ? (
            <label class="field">
              <span>Zeitraum</span>
              <select value={months} onChange={(e) => setMonths(e.currentTarget.value)}>
                <option value="1">Letzter Monat</option>
                <option value="3">Letzte 3 Monate</option>
                <option value="6">Letzte 6 Monate</option>
                <option value="12">Letztes Jahr</option>
                <option value="all">Alle Partien</option>
              </select>
            </label>
          ) : (
            <label class="field">
              <span>Anzahl der letzten Partien</span>
              <select value={count} onChange={(e) => setCount(e.currentTarget.value)}>
                {["20", "50", "100", "300", "1000"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          <label class="field">
            <span>PGN einfügen (eine oder mehrere Partien)</span>
            <textarea value={pgn} onInput={(e) => setPgn(e.currentTarget.value)} placeholder='[Event "..."]' />
          </label>
          <div class="field">
            <span>Mit welcher Farbe hast du gespielt?</span>
            <div class="segmented">
              {(
                [
                  ["white", "Weiß"],
                  ["black", "Schwarz"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" class={color === k ? "active" : ""} onClick={() => setColor(color === k ? "" : k)} disabled={busy}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label class="btn" style={{ marginBottom: "12px" }}>
            PGN-Datei wählen
            <input
              type="file"
              accept=".pgn,text/plain,application/x-chess-pgn"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </label>
        </>
      )}
      {progress && <p class="small muted">{progress}</p>}
      {error && <p class="error small">{error}</p>}
      {result && (
        <div class="notice" style={{ marginBottom: "12px" }}>
          {result.imported} neue Partien importiert
          {result.already_known ? `, ${result.already_known} waren schon vorhanden` : ""}.
          {result.skipped.length > 0 && ` ${result.skipped.length} Partien (Chess960 oder Varianten) werden in der App noch nicht unterstützt.`}
        </div>
      )}
      <div class="row" style={{ justifyContent: "flex-end" }}>
        {busy ? (
          <button class="btn" onClick={() => abort.current?.abort()}>
            Abbrechen
          </button>
        ) : (
          <button class="btn" onClick={() => ref.current?.close()}>
            {result ? "Fertig" : "Schließen"}
          </button>
        )}
        <button class="btn primary" disabled={busy || (source === "pgn" ? !pgn.trim() : !user.trim())} onClick={run}>
          {busy ? "Importiere …" : "Importieren"}
        </button>
      </div>
    </dialog>
  );
}

const HIDE_BULLET_KEY = "games.hideBullet";
// Two archives: early in a month the current one alone may hold only a game or two.
const QUICK_MONTHS = 2;

/**
 * One click: fetch the newest chess.com games of the remembered player
 * (last two monthly archives, already known ones skipped) and queue them for
 * analysis right away, newest first. Returns null when no chess.com name is
 * known yet, so the caller can open the full import dialog instead.
 */
async function quickImportChesscom(onProgress: (label: string) => void, skipBullet: boolean): Promise<{ name: string; result: ImportResult; queued: number } | null> {
  const last = await getSetting<Record<string, string>>("import.lastUser", {});
  const name = (last.chesscom ?? "").trim();
  if (!name) return null;
  const fresh: GameAnalysis[] = [];
  const { result } = await importChesscomGames(name, gameExists, QUICK_MONTHS, {
    onProgress: (_c, _t, label) => onProgress(label),
    onBatch: async (games) => {
      fresh.push(...games);
      await storeImported(games);
    },
  });
  const ids = fresh
    .filter((g) => !(skipBullet && isBulletGame(g.metadata)))
    .map((g) => g.game_id);
  if (ids.length) await enqueue(ids, { front: true });
  return { name, result, queued: ids.length };
}

interface Summary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracy: number | null;
  analyzed: number;
}

function summarize(games: StoredGame[], usernames: string[]): Summary {
  const s: Summary = { games: 0, wins: 0, draws: 0, losses: 0, accuracy: null, analyzed: 0 };
  let accSum = 0;
  for (const g of games) {
    const color = getUserColor(g, usernames);
    if (!color) continue;
    s.games++;
    const o = outcomeFor(g.result, color);
    if (o === "win") s.wins++;
    else if (o === "draw") s.draws++;
    else if (o === "loss") s.losses++;
    const acc = g.summary_json?.[color]?.accuracy;
    if (status(g) === "completed" && typeof acc === "number") {
      s.analyzed++;
      accSum += acc;
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
  return streakText(scores) ?? `${String(points).replace(".", ",")} ${points === 1 ? "Punkt" : "Punkte"} aus den letzten ${last.length} Partien`;
}

/** The list's opening card: the current run, the last results as tiles and the balance of everything shown. */
function SummaryHero({ s, games, usernames }: { s: Summary; games: StoredGame[]; usernames: string[] }) {
  const decided = s.wins + s.draws + s.losses;
  // `games` is newest first; only decided own games count for the run.
  const recent = games
    .map((g) => ({ g, o: outcomeFor(g.result, getUserColor(g, usernames)) }))
    .filter((x): x is { g: StoredGame; o: keyof typeof OUTCOME_SCORE } => x.o !== null)
    .slice(0, RIBBON_GAMES);
  return (
    <Hero
      class="reveal games-hero"
      kicker={`Deine Partien · ${s.games} · ${s.analyzed} analysiert`}
      title={formHeadline(recent.map((x) => x.o))}
      sub={
        <>
          {balanceText(s.wins, s.draws, s.losses)}
          {s.accuracy !== null ? ` · Ø Genauigkeit ${s.accuracy.toFixed(1).replace(".", ",")} %` : ""}
        </>
      }
      aside={decided ? <HeroStat big={<CountUp value={((s.wins + s.draws / 2) / decided) * 100} format={(v) => `${Math.round(v)} %`} />} label="Punkte-Quote" sub="aller gezeigten Partien" /> : undefined}
    >
      <ResultRibbon
        games={[...recent].reverse().map(({ g, o }) => {
          const white = getUserColor(g, usernames) === "white";
          return { id: g.id, score: OUTCOME_SCORE[o], title: `${formatDate(g.date)} gegen ${white ? g.black : g.white}: ${OUTCOME_WORD[o]}` };
        })}
        onPick={(id) => navigate({ view: "analysis", gameId: id })}
      />
      <WdlBar wins={s.wins} draws={s.draws} losses={s.losses} />
    </Hero>
  );
}

const SPARK_W = 92;
const SPARK_H = 30;

/**
 * The game at a glance: the player's winning chance move by move, green above
 * the middle line and red below it, so a thrown win or a comeback shows in the list.
 */
function GameSpark({ g, color }: { g: StoredGame; color: "white" | "black" }) {
  const moves = Array.isArray(g.moves_json) ? g.moves_json : [];
  if (moves.length < 4) return null;
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

// Rows that take part in the opening stagger; the rest appear at once.
const STAGGER_ROWS = 10;

function GameRow({
  g,
  usernames,
  queue,
  index,
  narrow,
}: {
  g: StoredGame;
  usernames: string[];
  queue: QueueState | null;
  /** Phone: name the opponent and the outcome instead of both players and the raw result. */
  narrow: boolean;
  /** Place in the list; the first rows rise in one after another. */
  index: number;
}) {
  const color = getUserColor(g, usernames);
  const st = status(g);
  const acc = color ? g.summary_json?.[color]?.accuracy : undefined;
  const outcome = outcomeFor(g.result, color);
  const isCurrent = queue?.current === g.id;
  const isMe = (name: string) => usernames.some((u) => u.toLowerCase() === name.toLowerCase());
  // Two names with ratings do not fit a phone line; the user knows their own
  // name, so the row shows who they played and with which colour.
  const versus = narrow && color !== null;
  const opponent = color === "white" ? { name: g.black, elo: g.black_elo } : { name: g.white, elo: g.white_elo };
  return (
    <div class={`game-item ${outcome ?? ""}`} role="button" style={{ "--i": Math.min(index, STAGGER_ROWS) }} onClick={() => navigate({ view: "analysis", gameId: g.id })}>
      <div class="stripe" />
      {versus ? (
        <div class="players versus">
          <span class={`side-dot ${color}`} title={color === "white" ? "Du hattest Weiß" : "Du hattest Schwarz"} />
          <span class="versus-name">{opponent.name}</span>
          {opponent.elo ? <span class="faint versus-elo">{opponent.elo}</span> : null}
        </div>
      ) : (
        <div class="players">
          <span class="side-dot white" />
          <span class={isMe(g.white) ? "me" : ""}>
            {g.white}
            {g.white_elo ? <span class="faint player-elo"> {g.white_elo}</span> : null}
          </span>
          <span class="faint">–</span>
          <span class="side-dot black" />
          <span class={isMe(g.black) ? "me" : ""}>
            {g.black}
            {g.black_elo ? <span class="faint player-elo"> {g.black_elo}</span> : null}
          </span>
        </div>
      )}
      <div class="right">
        {acc !== undefined && st === "completed" ? (
          <>
            {color && <GameSpark g={g} color={color} />}
            <div class="acc-box">
              <div class={`acc ${accClass(acc)}`}>{acc.toFixed(1).replace(".", ",")}</div>
              <div class="acc-label">Genauigkeit</div>
            </div>
          </>
        ) : isCurrent ? (
          <span class="row" style={{ gap: "6px" }}>
            <span class="pill accent">läuft {Math.round((queue!.done / Math.max(1, queue!.total)) * 100)} %</span>
            <CancelButton id={g.id} label="Analyse abbrechen" />
          </span>
        ) : queue?.queued.includes(g.id) ? (
          <span class="row" style={{ gap: "6px" }}>
            <span class="pill">wartet</span>
            <CancelButton id={g.id} label="Aus der Warteschlange nehmen" />
          </span>
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
      </div>
      <div class="meta">
        <span class={`pill ${outcome ?? ""}`}>{versus && outcome ? OUTCOME_WORD[outcome] : resultText(g.result)}</span>
        {g.speed_category && <span>{SPEED_DE[g.speed_category] ?? g.speed_category}</span>}
        {/* The month header above already names the year. */}
        <span>{narrow ? formatDate(g.date).replace(/\.\d{4}$/, ".") : formatDate(g.date)}</span>
        {g.opening && <span class="opening">· {shortOpening(g.opening)}</span>}
      </div>
    </div>
  );
}

export function GamesView({ openImport = false }: { openImport?: boolean }) {
  const [games, setGames] = useState<StoredGame[] | null>(null);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [showImport, setShowImport] = useState(openImport);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setShowImport((v) => v || openImport), [openImport]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || isTyping(e)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [filter, setFilter] = useState<Filter>("all");
  const [speed, setSpeed] = useState("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("All Time");
  const [limit, setLimit] = useState(60);
  // Games of tracked opponents and friends live in the same store; by default the list shows only the user's own.
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [justImported, setJustImported] = useState<string[]>([]);
  const [hideBullet, setHideBulletState] = useState(false);
  const narrow = useNarrow();
  const [quick, setQuick] = useState<{ busy: boolean; text: string; error?: boolean } | null>(null);
  useEffect(() => void getSetting<boolean>(HIDE_BULLET_KEY, false).then(setHideBulletState), []);
  const setHideBullet = (v: boolean) => {
    setHideBulletState(v);
    void setSetting(HIDE_BULLET_KEY, v);
  };

  useEffect(() => subscribeQueue(setQueue), []);
  useEffect(() => {
    const load = async () => {
      setGames(await listGames());
      setUsernames(await getSetting<string[]>("usernames", []));
    };
    void load();
    return onDataChanged(() => void load());
  }, []);

  const speeds = useMemo(() => [...new Set((games ?? []).map((g) => g.speed_category).filter((v): v is string => Boolean(v)))], [games]);

  const { skipBullet } = useBulletPrefs();
  const scoped = useMemo(
    () => (scope === "mine" && usernames.length ? (games ?? []).filter((g) => getUserColor(g, usernames)) : (games ?? [])),
    [games, usernames, scope],
  );
  const othersCount = usernames.length ? (games ?? []).length - (games ?? []).filter((g) => getUserColor(g, usernames)).length : 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((g) => {
      if (filter === "analyzed" && status(g) !== "completed") return false;
      if (filter === "open" && status(g) === "completed") return false;
      if (speed !== "all" && g.speed_category !== speed) return false;
      if (hideBullet && isBulletGame(g)) return false;
      if (period !== "All Time" && !inDateFilter(g, period)) return false;
      if (q && !`${g.white} ${g.black} ${g.opening ?? ""} ${g.event}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scoped, filter, speed, search, period, hideBullet]);
  const bulletCount = useMemo(() => scoped.filter((g) => isBulletGame(g)).length, [scoped]);

  const summary = useMemo(() => summarize(filtered, usernames), [filtered, usernames]);

  const open = scoped.filter((g) => status(g) !== "completed" && !((skipBullet || hideBullet) && isBulletGame(g))).map((g) => g.id);

  const runQuick = async () => {
    setQuick({ busy: true, text: "Suche neue Partien auf chess.com …" });
    try {
      const res = await quickImportChesscom((label) => setQuick({ busy: true, text: label }), skipBullet);
      if (!res) {
        setQuick(null);
        setShowImport(true);
        return;
      }
      const { name, result, queued } = res;
      setQuick({
        busy: false,
        text: result.imported
          ? `${result.imported} neue ${result.imported === 1 ? "Partie" : "Partien"} von ${name} geholt${queued ? `, ${queued} ${queued === 1 ? "wird" : "werden"} jetzt analysiert` : ""}.`
          : `Keine neuen Partien von ${name} auf chess.com. Alles ist schon da.`,
      });
    } catch (e) {
      setQuick({ busy: false, error: true, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const busy = Boolean(queue?.current) || (queue?.queued.length ?? 0) > 0;
  const remaining = (queue?.queued.length ?? 0) + (queue?.current ? 1 : 0);

  // Month headers keep long histories scannable.
  const rows: preact.JSX.Element[] = [];
  let lastMonth = "";
  for (const g of filtered.slice(0, limit)) {
    const m = monthLabel(g.date);
    if (m !== lastMonth) {
      rows.push(
        <div class="month-head" key={`m-${m}`}>
          {m}
        </div>,
      );
      lastMonth = m;
    }
    rows.push(<GameRow key={g.id} g={g} usernames={usernames} queue={queue} index={rows.length} narrow={narrow} />);
  }

  return (
    <div>
      <PageHeader
        about={false}
        actions={
          <>
        {busy ? (
          <button class="btn" onClick={cancelAll}>
            <IconStop /> Stoppen ({remaining})
          </button>
        ) : (
          open.length > 0 && (
            <button class="btn" onClick={() => void enqueue(open)} title="Die neuesten Partien zuerst">
              <IconPlay /> Alle analysieren ({open.length})
            </button>
          )
        )}
        <button
          class="btn primary"
          onClick={() => void runQuick()}
          disabled={quick?.busy}
          title="Holt die neuesten Partien von chess.com und analysiert sie sofort"
        >
          <IconSync /> {quick?.busy ? "Hole Partien …" : "Neueste holen"}
        </button>
        <button class="btn" onClick={() => setShowImport(true)}>
          <IconPlus /> Importieren
        </button>
          </>
        }
      />

      {quick && (
        <div class={`notice${quick.error ? " error" : ""}`} role="status">
          <span>{quick.text}</span>
          {!quick.busy && (
            <button class="btn small ghost" onClick={() => setQuick(null)} aria-label="Hinweis schließen">
              OK
            </button>
          )}
        </div>
      )}

      {justImported.length > 0 && !busy && (
        <Coach
          title={`${justImported.length} neue Partien sind da!`}
          actions={
            <button
              class="btn primary"
              onClick={() => {
                void enqueue(justImported);
                setJustImported([]);
              }}
            >
              Jetzt analysieren
            </button>
          }
        >
          Soll ich sie mir gleich anschauen? Danach siehst du zu jedem Zug, wie gut er war.
        </Coach>
      )}

      {busy && queue && (
        <div class="card">
          <div class="row" style={{ justifyContent: "space-between", marginBottom: "8px" }}>
            <span>
              <strong>Analyse läuft</strong>
              <span class="muted">
                {" "}
                · {queue.current ? `${queue.done}/${queue.total} Züge · ` : ""}noch {remaining}{" "}
                {remaining === 1 ? "Partie" : "Partien"}
              </span>
            </span>
            {queue.current && (
              <button class="btn small" onClick={() => navigate({ view: "analysis", gameId: queue.current! })}>
                Ansehen
              </button>
            )}
          </div>
          <div class="progress">
            <div style={{ width: `${Math.round((queue.done / Math.max(1, queue.total)) * 100)}%` }} />
          </div>
          <LiveDepth queue={queue} />
          {queue.error && <p class="error small">{queue.error}</p>}
        </div>
      )}

      {games && games.length > 0 && usernames.length > 0 && summary.games > 0 && <SummaryHero s={summary} games={filtered} usernames={usernames} />}

      {games && games.length > 0 && (
        <div class="filters games-filters">
          <div class="segmented">
            {(
              [
                ["all", "Alle"],
                ["analyzed", "Analysiert"],
                ["open", "Offen"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} class={filter === k ? "active" : ""} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          {othersCount > 0 && (
            <select value={scope} onChange={(e) => setScope(e.currentTarget.value as "mine" | "all")} aria-label="Spieler" style={{ flex: "1 1 120px", maxWidth: "220px" }}>
              <option value="mine">Meine Partien</option>
              <option value="all">Auch andere Spieler ({othersCount})</option>
            </select>
          )}
          {speeds.length > 1 && (
            <select value={speed} onChange={(e) => setSpeed(e.currentTarget.value)} aria-label="Bedenkzeit" style={{ flex: "1 1 120px", maxWidth: "200px" }}>
              <option value="all">Alle Bedenkzeiten</option>
              {speeds.map((sp) => (
                <option key={sp} value={sp}>
                  {SPEED_DE[sp] ?? sp}
                </option>
              ))}
            </select>
          )}
          {bulletCount > 0 && (
            <label class="check-chip" title="Bullet-Partien in der Liste und in der Zusammenfassung ausblenden">
              <input type="checkbox" checked={hideBullet} onChange={(e) => setHideBullet(e.currentTarget.checked)} />
              Bullet ausblenden ({bulletCount})
            </label>
          )}
          <PeriodSelect value={period} onChange={setPeriod} />
          <input
            ref={searchRef}
            type="search"
            placeholder={narrow ? "Spieler oder Eröffnung suchen" : "Spieler oder Eröffnung suchen  ( / )"}
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: "1 1 200px", width: "auto" }}
          />
        </div>
      )}

      {games === null ? (
        <div class="game-list">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} class="skeleton" style={{ height: "64px" }} />
          ))}
        </div>
      ) : games.length === 0 ? (
        <div class="empty">
          <CoachAvatar size={96} />
          <h3>Zeig mir deine Partien!</h3>
          <p>Importiere sie von chess.com oder Lichess oder füge eine PGN ein. Ich analysiere sie dann direkt auf diesem Gerät mit {ENGINE_NAME}.</p>
          <button class="btn primary big" onClick={() => setShowImport(true)}>
            <IconPlus /> Partien importieren
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div class="empty">
          <p>Keine Partie passt zu diesen Filtern.</p>
        </div>
      ) : (
        <div class="game-list">
          {rows}
          {filtered.length > limit && (
            <button class="btn" onClick={() => setLimit((l) => l + 60)}>
              Weitere {Math.min(60, filtered.length - limit)} anzeigen
            </button>
          )}
        </div>
      )}

      {showImport && (
        <ImportDialog
          onClose={() => {
            setShowImport(false);
            if (openImport) navigate({ view: "games" }, true);
          }}
          onImported={(ids) => {
            if (!ids.length) return;
            void autoAnalyze(ids).then((queued) => !queued && setJustImported((prev) => [...new Set([...ids, ...prev])]));
          }}
        />
      )}
    </div>
  );
}
