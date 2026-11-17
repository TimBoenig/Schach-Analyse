// The last games as a short list: result, opponent, when and what, and how
// accurately the player moved. One tap opens the game.
import { trSpeed } from "../../domain/i18n";
import type { PlayerProfile } from "../../domain/profile";
import { accClass, formatDate, shortOpening } from "../labels";
import { navigate } from "../router";

const de = (v: number) => v.toFixed(1).replace(".", ",");

const RESULT: Record<string, { cls: string; ch: string; word: string }> = {
  "1": { cls: "win", ch: "S", word: "Sieg" },
  "0.5": { cls: "draw", ch: "R", word: "Remis" },
  "0": { cls: "loss", ch: "N", word: "Niederlage" },
};

export function RecentGames({ profile, limit = 6 }: { profile: PlayerProfile; limit?: number }) {
  const games = profile.recent_games.slice(0, limit);
  if (!games.length) return <p class="muted small">Keine Partien in diesem Zeitraum.</p>;
  return (
    <ul class="recent">
      {games.map((g) => {
        const r = RESULT[String(g.score)] ?? { cls: "open", ch: "·", word: "offen" };
        return (
          <li key={g.game_id}>
            <button class="recent-item" onClick={() => navigate({ view: "analysis", gameId: g.game_id })}>
              <span class={`recent-res ${r.cls}`} title={r.word} aria-label={r.word}>
                {r.ch}
              </span>
              <span class="recent-main">
                <span class="recent-who">
                  <strong>{g.opponent}</strong>
                  {g.opp_rating ? <span class="faint tnum"> {g.opp_rating}</span> : null}
                </span>
                <span class="recent-sub">
                  {formatDate(g.date)} · {trSpeed(g.speed)}
                  {shortOpening(g.opening) ? ` · ${shortOpening(g.opening)}` : ""}
                </span>
              </span>
              <span class="recent-acc">
                {g.accuracy !== null ? <strong class={`tnum ${accClass(g.accuracy)}`}>{de(g.accuracy)}</strong> : <span class="faint">offen</span>}
                <span class="recent-blunders">{g.accuracy === null ? "nicht analysiert" : g.blunders ? `${g.blunders} Patzer` : "ohne Patzer"}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
