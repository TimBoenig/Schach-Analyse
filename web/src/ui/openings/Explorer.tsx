// Opening explorer over the player's own games: a board, the moves played in
// the position with how they turned out, and the games that went through it.
// Like an online opening explorer, but every number is from the player's games.
import { Chess } from "chess.js";
import { useEffect, useMemo, useState } from "preact/hooks";

import { bookKey, type BookData, loadBookData } from "../../domain/book";
import { fenAfter, movesText, type OpeningNode, openingLabel, openingMain, type TreeGame } from "../../domain/profile";
import { MIN_LINE_GAMES } from "../../domain/profile/evidence";
import { type Arrow, Board } from "../Board";
import { StackBar } from "../charts";
import { formatDate } from "../labels";
import { navigate } from "../router";

const pctText = (v: number | null) => (v === null ? "–" : `${Math.round(v)} %`);

function scoreClass(v: number | null): string {
  if (v === null) return "";
  return v >= 55 ? "good" : v < 45 ? "bad" : "";
}

/** Walks the tree along `path`; stops where the path leaves it. */
export function walk(root: OpeningNode, path: string[]): OpeningNode[] {
  const out = [root];
  for (const san of path) {
    const next = out[out.length - 1].children.find((c) => c.san === san);
    if (!next) break;
    out.push(next);
  }
  return out;
}

function moveSquares(fen: string, san: string): { from: string; to: string } | null {
  try {
    const m = new Chess(fen).move(san);
    return { from: m.from, to: m.to };
  } catch {
    return null;
  }
}

let book: BookData | null = null;

function useBook(): BookData | null {
  const [data, setData] = useState<BookData | null>(book);
  useEffect(() => {
    if (book) return;
    let alive = true;
    loadBookData().then((d) => {
      book = d;
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** Name of the deepest book position along the path, e.g. "Italienische Partie · Giuoco Piano". */
function openingAt(data: BookData | null, path: string[]): { eco: string; main: string; variation: string } | null {
  if (!data) return null;
  const board = new Chess();
  let found: [string, string] | null = null;
  for (const san of path) {
    try {
      board.move(san);
    } catch {
      break;
    }
    const node = data[bookKey(board.fen())];
    if (node) found = [node[0], node[1]];
  }
  if (!found) return null;
  const [eco, name] = found;
  const main = openingMain(name);
  const variation = name.slice(main.length).replace(/^[:,]\s*/, "");
  return { eco, main: openingLabel(main), variation };
}

function GameRow({ g }: { g: TreeGame }) {
  return (
    <button class="op-game" onClick={() => navigate({ view: "analysis", gameId: g.id })}>
      <span class={`op-result ${g.score === 1 ? "win" : g.score === 0 ? "loss" : g.score === 0.5 ? "draw" : ""}`}>
        {g.score === 1 ? "S" : g.score === 0 ? "N" : g.score === 0.5 ? "R" : "–"}
      </span>
      <span class="op-opp">
        {g.opponent || "Gegner"}
        {g.opp_rating > 0 && <span class="faint"> {g.opp_rating}</span>}
      </span>
      <span class="faint small">{formatDate(g.date)}</span>
      <span />
    </button>
  );
}

export function Explorer({
  root,
  color,
  path,
  onPath,
}: {
  root: OpeningNode;
  color: "white" | "black";
  path: string[];
  onPath: (path: string[]) => void;
}) {
  const data = useBook();
  const nodes = walk(root, path);
  const here = nodes[nodes.length - 1];
  const at = nodes.slice(1).map((n) => n.san);
  const fen = useMemo(() => fenAfter(at), [at.join(" ")]);
  const name = useMemo(() => openingAt(data, at), [data, at.join(" ")]);
  const userToMove = (at.length % 2 === 0) === (color === "white");
  const kids = here.children;
  const total = kids.reduce((n, c) => n + c.games, 0);

  const arrows: Arrow[] = [];
  kids.slice(0, 3).forEach((c, i) => {
    const sq = moveSquares(fen, c.san);
    if (sq) arrows.push({ ...sq, kind: c.leak ? "wrong" : i === 0 ? "hint" : "engine2" });
  });
  const leak = kids.find((c) => c.leak && c.better);
  if (leak?.better) {
    const sq = moveSquares(fen, leak.better);
    if (sq) arrows.push({ ...sq, kind: "best" });
  }

  const go = (san: string) => onPath([...at, san]);
  const onMove = (from: string, to: string) => {
    const hit = kids.find((c) => c.uci.slice(0, 4) === from + to);
    if (hit) go(hit.san);
    return Boolean(hit);
  };
  const legalTargets = (from: string) => {
    try {
      return new Chess(fen).moves({ square: from as never, verbose: true }).map((m) => m.to);
    } catch {
      return [];
    }
  };

  return (
    <div class="explorer">
      <div class="explorer-board">
        <Board
          fen={fen}
          flipped={color === "black"}
          lastMove={here.uci ? { from: here.uci.slice(0, 2), to: here.uci.slice(2, 4) } : null}
          arrows={arrows}
          onMove={onMove}
          legalTargets={legalTargets}
        />
        <div class="explorer-nav">
          <button class="btn small ghost" onClick={() => onPath([])} disabled={!at.length} aria-label="Zum Anfang">
            ⏮
          </button>
          <button class="btn small ghost" onClick={() => onPath(at.slice(0, -1))} disabled={!at.length} aria-label="Einen Zug zurück">
            ◀
          </button>
          <button class="btn small ghost" onClick={() => kids[0] && go(kids[0].san)} disabled={!kids.length} aria-label="Häufigster Zug">
            ▶
          </button>
          <span class="spacer" />
          <button class="btn small" onClick={() => navigate({ view: "board", fen })}>
            Am Brett untersuchen
          </button>
        </div>
      </div>

      <div class="explorer-side">
        <div class="explorer-crumbs" aria-label="Zugfolge">
          <button class={`crumb${at.length ? "" : " on"}`} onClick={() => onPath([])}>
            Start
          </button>
          {at.map((san, i) => (
            <button key={i} class={`crumb${i === at.length - 1 ? " on" : ""}`} onClick={() => onPath(at.slice(0, i + 1))}>
              {movesText([san], i)}
            </button>
          ))}
        </div>

        <div class="explorer-head">
          <div>
            <div class="explorer-name">
              {name ? name.main : at.length ? "Eigene Wege" : "Ausgangsstellung"}
              {name?.eco && <span class="op-eco">{name.eco}</span>}
            </div>
            <div class="small faint">
              {name?.variation || (at.length ? "Abseits der bekannten Theorie" : "Alle deine Partien mit dieser Farbe")}
            </div>
          </div>
          <div class="explorer-score">
            <strong class={`tnum ${scoreClass(here.score_pct)}`}>{pctText(here.score_pct)}</strong>
            <span class="small faint">{here.games === 1 ? "1 Partie" : `${here.games} Partien`}</span>
          </div>
        </div>
        <StackBar
          height={8}
          legend={false}
          segments={[
            { label: "Siege", value: here.wins, color: "var(--win)" },
            { label: "Remis", value: here.draws, color: "var(--draw)" },
            { label: "Niederlagen", value: here.losses, color: "var(--loss)" },
          ]}
        />

        <div class="explorer-label">{userToMove ? "Was du hier spielst" : "Was deine Gegner hier spielen"}</div>
        {kids.length ? (
          <div class="explorer-moves" role="table">
            {kids.map((c) => (
              <button key={c.san} class={`explorer-move${c.games < 2 ? " thin" : ""}${c.leak ? " leak" : ""}`} role="row" onClick={() => go(c.san)}>
                <span class="em-san">
                  {movesText([c.san], at.length)}
                  {c.book && <span class="em-book" title="Eröffnungstheorie">Theorie</span>}
                </span>
                <span class="tnum em-games">
                  {c.games}
                  <span class="faint"> · {Math.round((c.games / (total || 1)) * 100)} %</span>
                </span>
                <span class="em-bar">
                  <StackBar
                    height={6}
                    legend={false}
                    segments={[
                      { label: "Siege", value: c.wins, color: "var(--win)" },
                      { label: "Remis", value: c.draws, color: "var(--draw)" },
                      { label: "Niederlagen", value: c.losses, color: "var(--loss)" },
                    ]}
                  />
                </span>
                <span class={`tnum em-score ${scoreClass(c.games >= MIN_LINE_GAMES ? c.score_pct : null)}`}>{pctText(c.score_pct)}</span>
                {c.user && c.judged > 0 && !c.book && (
                  <span class={`em-note small${c.leak ? " bad" : " faint"}`}>
                    {c.leak ? "⚠ " : ""}
                    {c.errors ? `Fehler in ${c.errors} von ${c.judged}` : `fehlerfrei in ${c.judged}`}
                    {c.better && c.errors * 2 >= c.judged ? ` · besser ${c.better}` : ""}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p class="small muted" style={{ margin: "6px 0 0" }}>
            {here.games > 1
              ? "Ab hier gehen deine Partien eigene Wege."
              : "Diese Stellung kam nur in einer Partie vor, weiter verzweige ich nicht."}
          </p>
        )}

        {here.recent.length > 0 && (
          <div class="explorer-games">
            <div class="explorer-label">Partien mit dieser Stellung</div>
            <div class="op-games">
              {here.recent.map((g) => (
                <GameRow key={g.id} g={g} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
