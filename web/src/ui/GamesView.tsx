import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { cancelAll, enqueue, subscribeQueue, type QueueState } from "../app/analysisService";
import { importChesscomGames, importLichessGames, importPgnText, type ImportResult } from "../api/import";
import { getUserColor } from "../domain/metrics";
import type { GameAnalysis, StoredGame } from "../domain/types";
import { gameExists, getSetting, listGames, onDataChanged, putGames, setSetting } from "../storage/db";
import { toStoredGame } from "../storage/rows";
import { Donut, Gauge, Legend } from "./charts";
import type { Segment } from "./charts";
import { IconGames, IconPlay, IconPlus, IconStop } from "./icons";
import { SPEED_DE, accClass, formatDate, monthLabel, outcomeFor, resultText, shortOpening } from "./labels";
import { isTyping } from "./keys";
import { navigate } from "./router";

type Source = "chesscom" | "lichess" | "pgn";
type Filter = "all" | "analyzed" | "open";

function status(g: StoredGame): "completed" | "paused" | "not_started" {
  return (g.summary_json?.analysis_status as "completed" | "paused" | "not_started") ?? "not_started";
}

async function storeBatch(games: GameAnalysis[]): Promise<void> {
  // The list sorts by date played; the save time only orders games within one batch.
  const now = Date.now() / 1000;
  await putGames(games.map((g, i) => toStoredGame(g, now - i / 1000)));
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (ids: string[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<Source>("chesscom");
  const [user, setUser] = useState("");
  const [months, setMonths] = useState("3");
  const [count, setCount] = useState("100");
  const [pgn, setPgn] = useState("");
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
      await storeBatch(games);
    };
    try {
      let res: ImportResult;
      if (source === "pgn") {
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

function SummaryStrip({ s }: { s: Summary }) {
  const decided = s.wins + s.draws + s.losses;
  const wdl: Segment[] = [
    { label: "Siege", value: s.wins, color: "var(--win)" },
    { label: "Remis", value: s.draws, color: "var(--draw)" },
    { label: "Niederlagen", value: s.losses, color: "var(--loss)" },
  ];
  return (
    <section class="card hero summary-hero">
      <div class="hero-cell">
        <div class="kpi-label">Deine Partien</div>
        <div class="kpi-big tnum">{s.games}</div>
        <div class="small muted">{s.analyzed} analysiert</div>
      </div>
      <div class="hero-cell with-chart">
        <Donut
          segments={wdl}
          center={decided ? `${Math.round(((s.wins + s.draws / 2) / decided) * 100)} %` : "–"}
          sub="Punkte"
          size={96}
          thickness={11}
        />
        <div class="hero-side">
          <div class="kpi-label">Bilanz</div>
          <Legend items={wdl.map((x) => ({ label: x.label, color: x.color, value: String(x.value) }))} />
        </div>
      </div>
      <div class="hero-cell with-chart">
        <Gauge value={s.accuracy} size={96} thickness={10} label="Genauigkeit" />
        <div class="hero-side">
          <div class="kpi-label">Ø Genauigkeit</div>
          <div class="small muted">über deine analysierten Partien</div>
        </div>
      </div>
    </section>
  );
}

function GameRow({
  g,
  usernames,
  queue,
}: {
  g: StoredGame;
  usernames: string[];
  queue: QueueState | null;
}) {
  const color = getUserColor(g, usernames);
  const st = status(g);
  const acc = color ? g.summary_json?.[color]?.accuracy : undefined;
  const outcome = outcomeFor(g.result, color);
  const isCurrent = queue?.current === g.id;
  const isMe = (name: string) => usernames.some((u) => u.toLowerCase() === name.toLowerCase());
  return (
    <div class={`game-item ${outcome ?? ""}`} role="button" onClick={() => navigate({ view: "analysis", gameId: g.id })}>
      <div class="stripe" />
      <div class="players">
        <span class="side-dot white" />
        <span class={isMe(g.white) ? "me" : ""}>
          {g.white}
          {g.white_elo ? <span class="faint"> {g.white_elo}</span> : null}
        </span>
        <span class="faint">–</span>
        <span class="side-dot black" />
        <span class={isMe(g.black) ? "me" : ""}>
          {g.black}
          {g.black_elo ? <span class="faint"> {g.black_elo}</span> : null}
        </span>
      </div>
      <div class="right">
        {acc !== undefined && st === "completed" ? (
          <>
            <div class={`acc ${accClass(acc)}`}>{acc.toFixed(1)}</div>
            <div class="acc-label">Genauigkeit</div>
          </>
        ) : isCurrent ? (
          <span class="pill accent">läuft {Math.round((queue!.done / Math.max(1, queue!.total)) * 100)} %</span>
        ) : queue?.queued.includes(g.id) ? (
          <span class="pill">wartet</span>
        ) : st === "completed" ? (
          <span class="pill">analysiert</span>
        ) : (
          <button
            class="btn small"
            onClick={(e) => {
              e.stopPropagation();
              enqueue([g.id]);
            }}
          >
            <IconPlay /> Analysieren
          </button>
        )}
      </div>
      <div class="meta">
        <span class={`pill ${outcome ?? ""}`}>{resultText(g.result)}</span>
        {g.speed_category && <span>{SPEED_DE[g.speed_category] ?? g.speed_category}</span>}
        <span>{formatDate(g.date)}</span>
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
  const [limit, setLimit] = useState(60);
  const [justImported, setJustImported] = useState<string[]>([]);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (games ?? []).filter((g) => {
      if (filter === "analyzed" && status(g) !== "completed") return false;
      if (filter === "open" && status(g) === "completed") return false;
      if (speed !== "all" && g.speed_category !== speed) return false;
      if (q && !`${g.white} ${g.black} ${g.opening ?? ""} ${g.event}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [games, filter, speed, search]);

  const summary = useMemo(() => summarize(filtered, usernames), [filtered, usernames]);

  const open = (games ?? []).filter((g) => status(g) !== "completed").map((g) => g.id);
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
    rows.push(<GameRow key={g.id} g={g} usernames={usernames} queue={queue} />);
  }

  return (
    <div>
      <div class="page-title">
        Partien
        <span class="spacer" />
        {busy ? (
          <button class="btn" onClick={cancelAll}>
            <IconStop /> Stoppen ({remaining})
          </button>
        ) : (
          open.length > 0 && (
            <button class="btn" onClick={() => enqueue(open)}>
              <IconPlay /> Alle analysieren ({open.length})
            </button>
          )
        )}
        <button class="btn primary" onClick={() => setShowImport(true)}>
          <IconPlus /> Importieren
        </button>
      </div>

      {justImported.length > 0 && !busy && (
        <div class="notice" style={{ marginBottom: "12px" }}>
          <div class="row" style={{ justifyContent: "space-between" }}>
            <span>{justImported.length} neue Partien sind bereit.</span>
            <button
              class="btn primary"
              onClick={() => {
                enqueue(justImported);
                setJustImported([]);
              }}
            >
              Jetzt analysieren
            </button>
          </div>
        </div>
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
          {queue.error && <p class="error small">{queue.error}</p>}
        </div>
      )}

      {games && games.length > 0 && usernames.length > 0 && summary.games > 0 && <SummaryStrip s={summary} />}

      {games && games.length > 0 && (
        <div class="filters">
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
          <input
            ref={searchRef}
            type="search"
            placeholder="Spieler oder Eröffnung suchen  ( / )"
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
          <div class="empty-icon">
            <IconGames />
          </div>
          <h3>Noch keine Partien</h3>
          <p>Importiere deine Partien von Chess.com oder Lichess, oder füge eine PGN ein. Stockfish analysiert sie dann direkt auf diesem Gerät.</p>
          <button class="btn primary" onClick={() => setShowImport(true)}>
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
          onImported={(ids) => ids.length && setJustImported((prev) => [...new Set([...ids, ...prev])])}
        />
      )}
    </div>
  );
}
