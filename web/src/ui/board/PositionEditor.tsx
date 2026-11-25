// Position editor of the free board: set up any position from a piece palette,
// choose who moves and which castling rights exist, paste or copy a FEN, then
// hand the checked position back to the board to analyse from there.
import { useMemo, useState } from "preact/hooks";

import {
  availableCastling,
  checkPosition,
  EMPTY_CASTLING,
  parseEditorFen,
  positionFromFen,
  setPiece,
  START_FEN,
  toFen,
  type Castling,
  type EditorPosition,
  type PositionProblem,
  type Turn,
} from "../../domain/positionEditor";
import { Board } from "../Board";
import { PageHeader } from "../Layout";
import { IconFlip, IconReset } from "../icons";
import { t } from "../../i18n";

const PIECE_NAME: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PALETTE = ["K", "Q", "R", "B", "N", "P"];

/** A palette tool: a piece letter, "erase", or null (only move pieces by hand). */
type Tool = string | null;

function problemText(p: PositionProblem): string {
  switch (p) {
    case "no-white-king":
      return t("Es fehlt der weiße König.");
    case "no-black-king":
      return t("Es fehlt der schwarze König.");
    case "many-white-kings":
      return t("Es steht mehr als ein weißer König auf dem Brett.");
    case "many-black-kings":
      return t("Es steht mehr als ein schwarzer König auf dem Brett.");
    case "pawn-on-edge":
      return t("Bauern dürfen nicht auf der ersten oder achten Reihe stehen.");
    case "too-many-white-pieces":
      return t("Weiß hat mehr als 16 Figuren.");
    case "too-many-black-pieces":
      return t("Schwarz hat mehr als 16 Figuren.");
    case "too-many-white-pawns":
      return t("Weiß hat mehr als 8 Bauern.");
    case "too-many-black-pawns":
      return t("Schwarz hat mehr als 8 Bauern.");
    case "kings-touch":
      return t("Die Könige dürfen nicht nebeneinander stehen.");
    case "opponent-in-check":
      return t("Die Seite, die nicht am Zug ist, steht im Schach. Wechsle, wer am Zug ist, oder verschiebe die Figuren.");
    default:
      return t("Diese Stellung ist nicht möglich.");
  }
}

export function PositionEditor({ fen: startFen, flipped: startFlipped, onApply, onCancel }: { fen: string; flipped: boolean; onApply: (fen: string) => void; onCancel: () => void }) {
  const [pos, setPos] = useState<EditorPosition>(() => positionFromFen(startFen));
  const [tool, setTool] = useState<Tool>("Q");
  const [flipped, setFlipped] = useState(startFlipped);
  const [draft, setDraft] = useState<string | null>(null);
  const [fenError, setFenError] = useState(false);
  const [copied, setCopied] = useState(false);

  const fen = useMemo(() => toFen(pos), [pos]);
  const problems = useMemo(() => checkPosition(pos), [pos]);
  const possible = availableCastling(pos.pieces);

  const setPieces = (pieces: EditorPosition["pieces"]) => setPos((p) => ({ ...p, pieces }));
  const tap = (square: string) => {
    if (tool === null) return;
    const here = pos.pieces.get(square);
    // Tapping a piece with its own palette piece takes it away again.
    if (tool === "erase" || here === tool) setPieces(setPiece(pos.pieces, square, null));
    else setPieces(setPiece(pos.pieces, square, tool));
  };
  const move = (from: string, to: string | null) => {
    const piece = pos.pieces.get(from);
    if (!piece) return;
    const without = setPiece(pos.pieces, from, null);
    setPieces(to ? setPiece(without, to, piece) : without);
  };
  const setCastle = (key: keyof Castling, on: boolean) => setPos((p) => ({ ...p, castling: { ...p.castling, [key]: on } }));
  const setTurn = (turn: Turn) => setPos((p) => ({ ...p, turn }));
  const load = (text: string) => {
    const parsed = parseEditorFen(text);
    if (!parsed) {
      setFenError(true);
      return;
    }
    setFenError(false);
    setDraft(null);
    setPos(parsed);
  };

  const rights: { key: keyof Castling; label: string }[] = [
    { key: "K", label: t("Weiß kurz (O-O)") },
    { key: "Q", label: t("Weiß lang (O-O-O)") },
    { key: "k", label: t("Schwarz kurz (O-O)") },
    { key: "q", label: t("Schwarz lang (O-O-O)") },
  ];
  const ok = problems.length === 0;

  return (
    <div>
      <PageHeader
        actions={
          <button class="btn small" onClick={onCancel}>
            {t("Zurück zum Brett")}
          </button>
        }
      />
      <div class="analysis">
        <div class="board-area">
          <div class="player-line" style={{ gridRow: 1 }}>
            <span class="who">
              <span class={`side-dot ${pos.turn === "w" ? "white" : "black"}`} />
              <span>{pos.turn === "w" ? t("Weiß ist am Zug") : t("Schwarz ist am Zug")}</span>
            </span>
          </div>
          <div style={{ gridRow: 2, gridColumn: 2 }}>
            <Board fen={fen} flipped={flipped} edit={{ tap, move }} />
          </div>
        </div>

        <div class="side-panel">
          <div class="card">
            <h3>{t("Stellung aufbauen")}</h3>
            <p class="muted small" style={{ marginTop: 0 }}>
              {t("Wähle eine Figur und tippe auf ein Feld, um sie zu setzen. Figuren auf dem Brett kannst du ziehen; ziehst du sie neben das Brett, verschwinden sie.")}
            </p>
            {(["white", "black"] as const).map((side) => (
              <div class="pe-palette" key={side}>
                {PALETTE.map((letter) => {
                  const l = side === "white" ? letter : letter.toLowerCase();
                  return (
                    <button
                      key={l}
                      class={`pe-tool${tool === l ? " on" : ""}`}
                      aria-pressed={tool === l}
                      aria-label={`${side === "white" ? t("Weiß") : t("Schwarz")} ${PIECE_NAME[l.toLowerCase()]}`}
                      onClick={() => setTool(tool === l ? null : l)}
                    >
                      <span class={`promo-piece ${side} ${PIECE_NAME[l.toLowerCase()]}`} />
                    </button>
                  );
                })}
              </div>
            ))}
            <div class="row" style={{ marginTop: "10px" }}>
              <button class={`btn small${tool === "erase" ? " on" : ""}`} aria-pressed={tool === "erase"} onClick={() => setTool(tool === "erase" ? null : "erase")}>
                {t("Radierer")}
              </button>
              <button
                class="btn small"
                onClick={() => {
                  setPos({ pieces: new Map(), turn: "w", castling: EMPTY_CASTLING });
                  setDraft(null);
                }}
              >
                {t("Brett leeren")}
              </button>
              <button class="btn small" onClick={() => load(START_FEN)}>
                <IconReset /> {t("Grundstellung")}
              </button>
              <button class="btn small" onClick={() => setFlipped((f) => !f)} aria-label={t("Brett drehen")}>
                <IconFlip />
              </button>
            </div>
          </div>

          <div class="card">
            <h3>{t("Wer ist am Zug?")}</h3>
            <div class="row">
              <button class={`btn small${pos.turn === "w" ? " on" : ""}`} aria-pressed={pos.turn === "w"} onClick={() => setTurn("w")}>
                {t("Weiß")}
              </button>
              <button class={`btn small${pos.turn === "b" ? " on" : ""}`} aria-pressed={pos.turn === "b"} onClick={() => setTurn("b")}>
                {t("Schwarz")}
              </button>
            </div>
            <h3 style={{ marginTop: "14px" }}>{t("Rochaderechte")}</h3>
            <div class="pe-rights">
              {rights.map(({ key, label }) => (
                <label key={key} class={possible[key] ? "" : "muted"}>
                  <input type="checkbox" checked={pos.castling[key] && possible[key]} disabled={!possible[key]} onChange={(e) => setCastle(key, (e.target as HTMLInputElement).checked)} /> {label}
                </label>
              ))}
            </div>
            <p class="muted small" style={{ marginBottom: 0 }}>
              {t("Rochade geht nur, wenn König und Turm auf ihren Ausgangsfeldern stehen.")}
            </p>
          </div>

          <div class="card">
            <h3>FEN</h3>
            <form
              class="fen-form"
              onSubmit={(e) => {
                e.preventDefault();
                load(draft ?? fen);
              }}
            >
              <input type="text" value={draft ?? fen} aria-label="FEN" onInput={(e) => setDraft((e.target as HTMLInputElement).value)} />
              <button class="btn" type="submit">
                {t("Laden")}
              </button>
            </form>
            {fenError && <p class="error small">{t("Das ist keine FEN: Ich brauche acht Reihen mit je acht Feldern.")}</p>}
            <div class="row" style={{ marginTop: "10px" }}>
              <button
                class="btn small"
                onClick={() => {
                  void navigator.clipboard?.writeText(fen).then(() => setCopied(true)).catch(() => undefined);
                  window.setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? t("Kopiert") : t("FEN kopieren")}
              </button>
            </div>
          </div>

          <div class="card">
            {ok ? (
              <p class="muted small" style={{ marginTop: 0 }}>
                {t("Die Stellung ist gültig.")}
              </p>
            ) : (
              <ul class="pe-problems" role="alert">
                {problems.map((p) => (
                  <li key={p} class="error small">
                    {problemText(p)}
                  </li>
                ))}
              </ul>
            )}
            <button class="btn primary" disabled={!ok} onClick={() => onApply(fen)}>
              {t("Ab hier analysieren")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
