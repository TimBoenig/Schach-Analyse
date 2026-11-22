import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { autoAnalyze, cancelAll, enqueue, subscribeQueue, type QueueState } from "../app/analysisService";
import { PageHeader } from "./Layout";
import { LiveDepth } from "./LiveDepth";
import { importPgnText, type ImportResult } from "../api/import";
import { importAccount } from "../app/accountImport";
import { accountNameFor } from "../domain/accountName";
import { parsePgnTextDetailed } from "../domain/pgn";
import { extractGameTimestamp, getUserColor, inDateFilter, isBulletGame } from "../domain/metrics";
import { trFilter } from "../domain/i18n";
import { PAGE_PERIODS, settleByCount } from "../domain/periods";
import type { GameAnalysis, StoredGame } from "../domain/types";
import { gameExists, getSetting, listGames, onDataChanged, setSetting } from "../storage/db";
import { storeImported } from "../storage/rows";
import { IconPlay, IconPlus, IconStop, IconSync } from "./icons";
import { GameRows, GamesSummary, status, summarize } from "./games/GameList";
import { SPEED_DE } from "./labels";
import { isTyping } from "./keys";
import { navigate } from "./router";
import { CoachAvatar } from "./Coach";
import { GuideButton, usePageGuide } from "./stage/PageGuide";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { useNarrow } from "./useNarrow";
import { PeriodSelect } from "./useProfile";
import { ENGINE_NAME } from "../engine/info";

type Source = "chesscom" | "lichess" | "pgn";
type Filter = "all" | "analyzed" | "open";

/** The player's own account on a site, as the stored games show it (see accountNameFor). */
async function suggestedName(site: "chesscom" | "lichess"): Promise<string> {
  const [last, usernames, stored] = await Promise.all([
    getSetting<Record<string, string>>("import.lastUser", {}),
    getSetting<string[]>("usernames", []),
    listGames(),
  ]);
  return accountNameFor(site, stored, usernames, last[site]);
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
    void suggestedName("chesscom").then(setUser);
  }, []);

  const changeSource = async (s: Source) => {
    setSource(s);
    setResult(null);
    setError("");
    if (s !== "pgn") setUser(await suggestedName(s));
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
        const done = await importAccount(source, user, {
          months: months === "all" ? null : Number(months),
          count: Number(count),
          signal: abort.current.signal,
          onProgress: setProgress,
        });
        ids.push(...done.games.map((g) => g.game_id));
        res = done.result;
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
          {result.imported === 1 ? "1 neue Partie" : `${result.imported} neue Partien`} importiert
          {result.already_known ? `, ${result.already_known} ${result.already_known === 1 ? "war" : "waren"} schon vorhanden` : ""}.
          {result.skipped.length > 0 &&
            ` ${result.skipped.length === 1 ? "1 Partie (Chess960 oder Variante) wird" : `${result.skipped.length} Partien (Chess960 oder Varianten) werden`} in der App noch nicht unterstützt.`}
          {failedMonthsNote(result)}
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
function failedMonthsNote(r: ImportResult): string {
  const n = r.failed_months ?? 0;
  return n ? ` ${n === 1 ? "Ein Monat konnte" : `${n} Monate konnten`} nicht geladen werden; hol die Partien später noch einmal, dann kommen die fehlenden dazu.` : "";
}

async function quickImportChesscom(onProgress: (label: string) => void, skipBullet: boolean): Promise<{ name: string; result: ImportResult; queued: number } | null> {
  const name = await suggestedName("chesscom");
  if (!name) return null;
  const { result, games: fresh } = await importAccount("chesscom", name, { months: QUICK_MONTHS, onProgress });
  const ids = fresh
    .filter((g) => !(skipBullet && isBulletGame(g.metadata)))
    .map((g) => g.game_id);
  if (ids.length) await enqueue(ids, { front: true });
  return { name, result, queued: ids.length };
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
  // null = the page default (last 30 days, widened when they hold too few games).
  const [pickedPeriod, setPeriod] = useState<string | null>(null);
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
  usePageGuide("games", Boolean(games?.length && usernames.length));
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

  const period = useMemo(() => pickedPeriod ?? settleByCount(PAGE_PERIODS.games, scoped.map((g) => extractGameTimestamp(g))), [pickedPeriod, scoped]);
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
  // Games the period hides, so a list that starts on the last 30 days never looks like lost games.
  const hiddenOlder = useMemo(() => (period === "All Time" ? 0 : scoped.filter((g) => !inDateFilter(g, period)).length), [scoped, period]);
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
          : result.found === 0 && !result.failed_months
            ? `${name} hat auf chess.com in den letzten zwei Monaten keine Partien. Ist das dein Name dort? Über „Importieren“ kannst du ihn ändern.`
            : `Keine neuen Partien von ${name} auf chess.com.${result.failed_months ? "" : " Alles ist schon da."}`,
      });
      if (result.failed_months) setQuick((q) => q && { ...q, text: q.text + failedMonthsNote(result) });
    } catch (e) {
      setQuick({ busy: false, error: true, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const busy = Boolean(queue?.current) || (queue?.queued.length ?? 0) > 0;
  const remaining = (queue?.queued.length ?? 0) + (queue?.current ? 1 : 0);

  return (
    <div>
      <PageHeader
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
        {games && games.length > 0 && <GuideButton id="games" />}
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
        <div class="notice gl-fresh" role="status">
          <span class="orb-mini" aria-hidden="true" />
          <span>
            <strong>
              {justImported.length} {justImported.length === 1 ? "neue Partie ist" : "neue Partien sind"} da.
            </strong>{" "}
            Soll ich sie gleich analysieren? Danach siehst du zu jedem Zug, wie gut er war.
          </span>
          <button
            class="btn primary small"
            onClick={() => {
              void enqueue(justImported);
              setJustImported([]);
            }}
          >
            <IconPlay /> Jetzt analysieren
          </button>
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
          <LiveDepth queue={queue} />
          {queue.error && <p class="error small">{queue.error}</p>}
        </div>
      )}

      {games && games.length > 0 && usernames.length > 0 && summary.games > 0 && <GamesSummary s={summary} games={filtered} usernames={usernames} period={trFilter(period)} />}

      {games && games.length > 0 && (
        <div class="gl-filters">
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
            <select value={scope} onChange={(e) => setScope(e.currentTarget.value as "mine" | "all")} aria-label="Spieler">
              <option value="mine">Meine Partien</option>
              <option value="all">Auch andere Spieler ({othersCount})</option>
            </select>
          )}
          {speeds.length > 1 && (
            <select value={speed} onChange={(e) => setSpeed(e.currentTarget.value)} aria-label="Bedenkzeit">
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
            class="gl-search"
          />
        </div>
      )}

      {games === null ? (
        <div class="gl-list">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} class="skeleton" style={{ height: "58px" }} />
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
          {hiddenOlder > 0 && (
            <button class="btn" onClick={() => setPeriod("All Time")}>
              {hiddenOlder} ältere {hiddenOlder === 1 ? "Partie" : "Partien"} zeigen
            </button>
          )}
        </div>
      ) : (
        <div class="gl-list">
          <GameRows games={filtered.slice(0, limit)} all={filtered} usernames={usernames} queue={queue} />
          {filtered.length > limit && (
            <button class="btn" onClick={() => setLimit((l) => l + 60)}>
              Weitere {Math.min(60, filtered.length - limit)} anzeigen
            </button>
          )}
          {filtered.length <= limit && hiddenOlder > 0 && (
            <p class="faint small" style={{ textAlign: "center" }}>
              {trFilter(period)}. {hiddenOlder} ältere {hiddenOlder === 1 ? "Partie ist" : "Partien sind"} ausgeblendet.{" "}
              <button class="link-btn" onClick={() => setPeriod("All Time")}>
                Alle zeigen
              </button>
            </p>
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
