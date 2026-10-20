import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { cancelAll, enqueue, subscribeQueue, type QueueState } from "../app/analysisService";
import { importChesscomGames, importLichessGames, importPgnText, type ImportResult } from "../api/import";
import { getUserColor } from "../domain/metrics";
import type { GameAnalysis, StoredGame } from "../domain/types";
import { deleteGame, gameExists, getSetting, listGames, onDataChanged, putGames, setSetting } from "../storage/db";
import { toStoredGame } from "../storage/rows";
import { IconPlay, IconPlus, IconStop, IconTrash } from "./icons";
import { SPEED_DE, formatDate, resultText } from "./labels";
import { navigate } from "./router";

type Source = "chesscom" | "lichess" | "pgn";
type Filter = "all" | "analyzed" | "open";

function status(g: StoredGame): "completed" | "paused" | "not_started" {
  return (g.summary_json?.analysis_status as "completed" | "paused" | "not_started") ?? "not_started";
}

async function storeBatch(games: GameAnalysis[]): Promise<void> {
  // Newest games get the newest timestamp so they sort to the top.
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

export function GamesView() {
  const [games, setGames] = useState<StoredGame[] | null>(null);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (games ?? []).filter((g) => {
      if (filter === "analyzed" && status(g) !== "completed") return false;
      if (filter === "open" && status(g) === "completed") return false;
      if (q && !`${g.white} ${g.black} ${g.opening ?? ""} ${g.event}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [games, filter, search]);

  const open = (games ?? []).filter((g) => status(g) !== "completed").map((g) => g.id);
  const busy = Boolean(queue?.current) || (queue?.queued.length ?? 0) > 0;
  const remaining = (queue?.queued.length ?? 0) + (queue?.current ? 1 : 0);

  return (
    <div>
      <div class="page-title">
        Partien
        <span class="spacer" />
        {busy ? (
          <button class="btn" onClick={cancelAll}>
            <IconStop /> Analyse stoppen ({remaining})
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
          <div class="row" style={{ justifyContent: "space-between", marginBottom: "6px" }}>
            <span>
              Analysiere Partie {queue.current ? `(${queue.done}/${queue.total} Züge)` : ""} · noch {remaining} in der
              Warteschlange
            </span>
            {queue.current && (
              <button class="btn" onClick={() => navigate({ view: "analysis", gameId: queue.current! })}>
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

      {games && games.length > 0 && (
        <div class="row" style={{ marginBottom: "12px" }}>
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
          <input type="search" placeholder="Spieler oder Eröffnung suchen" value={search} onInput={(e) => setSearch(e.currentTarget.value)} style={{ flex: 1, minWidth: "180px", width: "auto" }} />
        </div>
      )}

      {games === null ? (
        <div class="empty">Lade …</div>
      ) : games.length === 0 ? (
        <div class="empty">
          <p>Noch keine Partien. Importiere deine Partien von Chess.com, Lichess oder als PGN.</p>
          <button class="btn primary" onClick={() => setShowImport(true)}>
            <IconPlus /> Partien importieren
          </button>
        </div>
      ) : (
        <div class="game-list">
          {filtered.slice(0, limit).map((g) => {
            const color = getUserColor(g, usernames);
            const st = status(g);
            const acc = color ? g.summary_json?.[color]?.accuracy : undefined;
            const res = g.result;
            const outcome = color && res !== "*" ? (res === "1/2-1/2" ? "draw" : (res === "1-0") === (color === "white") ? "win" : "loss") : null;
            const isCurrent = queue?.current === g.id;
            return (
              <div class="game-item" key={g.id} role="button" onClick={() => navigate({ view: "analysis", gameId: g.id })}>
                <div class="players">
                  {g.white}
                  {g.white_elo ? <span class="muted"> ({g.white_elo})</span> : null} – {g.black}
                  {g.black_elo ? <span class="muted"> ({g.black_elo})</span> : null}
                </div>
                <div class="right">
                  {acc !== undefined && st === "completed" ? (
                    <div class="acc">{acc.toFixed(1)}</div>
                  ) : isCurrent ? (
                    <span class="pill accent">läuft {Math.round((queue!.done / Math.max(1, queue!.total)) * 100)} %</span>
                  ) : queue?.queued.includes(g.id) ? (
                    <span class="pill">wartet</span>
                  ) : st === "completed" ? (
                    <span class="pill">analysiert</span>
                  ) : (
                    <button
                      class="btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        enqueue([g.id]);
                      }}
                    >
                      Analysieren
                    </button>
                  )}
                </div>
                <div class="meta">
                  <span class={`pill ${outcome === "win" ? "win" : outcome === "loss" ? "loss" : ""}`}>{resultText(res)}</span>
                  {g.speed_category && <span>{SPEED_DE[g.speed_category] ?? g.speed_category}</span>}
                  <span>{formatDate(g.date)}</span>
                  {g.opening && <span>· {g.opening}</span>}
                  <button
                    class="btn icon danger"
                    style={{ minHeight: "32px", width: "32px", marginLeft: "auto", background: "none", border: 0 }}
                    aria-label="Partie löschen"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Partie ${g.white} – ${g.black} löschen?`)) void deleteGame(g.id);
                    }}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length > limit && (
            <button class="btn" onClick={() => setLimit((l) => l + 60)}>
              Weitere {Math.min(60, filtered.length - limit)} anzeigen
            </button>
          )}
        </div>
      )}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImported={(ids) => ids.length && setJustImported((prev) => [...new Set([...ids, ...prev])])}
        />
      )}
    </div>
  );
}
