// Moves the player tries on the board, each with the engine's verdict.
import type { MoveData } from "../domain/types";
import { badgeFor, classLabel, formatEval } from "./labels";

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Winning chance before/after a move from the mover's view, plus the time it took. */
export function MoveFacts({ move }: { move: MoveData }) {
  const white = move.fen_before.split(" ")[1] === "w";
  const before = Math.round((white ? move.win_chance_before : 1 - move.win_chance_before) * 100);
  const after = Math.round((white ? move.win_chance_after : 1 - move.win_chance_after) * 100);
  const delta = after - before;
  return (
    <div class="move-facts small">
      <span title="Gewinnchance aus Sicht des Ziehenden">
        Gewinnchance {before} % → <strong>{after} %</strong>{" "}
        <span class={delta <= -10 ? "neg" : delta >= 3 ? "pos" : "faint"}>
          ({delta > 0 ? "+" : delta < 0 ? "−" : "±"}
          {Math.abs(delta)})
        </span>
      </span>
      {move.time_spent !== null && move.time_spent !== undefined && <span class="faint">· {formatSeconds(move.time_spent)} Bedenkzeit</span>}
    </div>
  );
}

/** Numbered SAN moves of a line with a small verdict badge on each judged move. */
export function LineMoves({
  startFen,
  sans,
  verdicts,
  cursor,
  onPick,
}: {
  startFen: string;
  sans: string[];
  verdicts: (MoveData | null | undefined)[];
  /** Number of moves currently shown on the board (highlights that move). */
  cursor?: number;
  onPick?: (n: number) => void;
}) {
  if (!sans.length) return null;
  const parts = startFen.split(" ");
  let num = Number(parts[5]) || 1;
  let white = parts[1] === "w";
  return (
    <div class="line-moves">
      {sans.map((san, k) => {
        const label = white ? `${num}.` : k === 0 ? `${num}...` : "";
        if (!white) num++;
        white = !white;
        const v = verdicts[k];
        const badge = v ? badgeFor(v.classification) : null;
        const body = (
          <>
            {label && <span class="faint">{label}</span>}
            {san}
            {v === undefined ? <span class="dot-wait" title="Engine rechnet" /> : badge ? <img src={badge} alt={classLabel(v!.classification)} /> : null}
          </>
        );
        return onPick ? (
          <button key={k} class={`line-move${cursor === k + 1 ? " active" : ""}`} onClick={() => onPick(k + 1)}>
            {body}
          </button>
        ) : (
          <span key={k} class={`line-move${cursor === undefined ? (k === sans.length - 1 ? " active" : "") : cursor === k + 1 ? " active" : ""}`}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

/** Verdict on the newest tried move: class, explanation, winning chance and the better move. */
export function VerdictCard({ san, verdict }: { san: string; verdict: MoveData | null | undefined }) {
  if (verdict === undefined) {
    return (
      <div class="verdict pending small muted">
        <span class="dot-wait" /> Stockfish bewertet {san} …
      </div>
    );
  }
  if (!verdict) return null;
  const badge = badgeFor(verdict.classification);
  const better = verdict.best_move && verdict.best_move.slice(0, 4) !== verdict.uci.slice(0, 4) ? verdict.multi_pvs[0] : null;
  return (
    <div class={`verdict cls-${verdict.classification.toLowerCase()}`}>
      {badge && <img src={badge} alt="" />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>{san}</strong> <span class="muted">· {classLabel(verdict.classification)}</span>
        <div class="small">{verdict.explanation}</div>
        <MoveFacts move={verdict} />
        {better?.pv_san && !verdict.explanation.includes("Besser war") && (
          <div class="small muted" style={{ marginTop: "2px" }}>
            Besser war {better.pv_san.split(" ")[0]} ({formatEval(verdict.eval_before_cp, verdict.eval_before_mate)})
          </div>
        )}
      </div>
    </div>
  );
}
