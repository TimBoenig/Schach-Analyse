// The league on the start page: your place among your friends on the same
// track as the league page, one tap away from the full table.
import { useEffect, useMemo, useState } from "preact/hooks";

import { loadPlayers } from "../../app/players";
import { statsFormat } from "../../domain/analysisDepth";
import { buildRanking, playerUsernames, rankedFriends, type Ranking, type TrackedPlayer } from "../../domain/players";
import type { StoredGame } from "../../domain/types";
import { IconPlayers, IconTrophy } from "../icons";
import { ScaleTrack } from "../kit";
import { de, profileFor, toneOf } from "../players/common";
import { navigate } from "../router";
import { useBulletPrefs } from "../useAnalysisPrefs";
import { useNarrow } from "../useNarrow";

// The start page comes first: friends' profiles are built once it has settled.
const START_DELAY_MS = 900;

export function LeagueTeaser({ games, me }: { games: StoredGame[]; me: string[] }) {
  const [players, setPlayers] = useState<TrackedPlayer[] | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const { excludeBullet, ready } = useBulletPrefs();
  const narrow = useNarrow();
  useEffect(() => {
    void loadPlayers().then(setPlayers);
  }, [games]);
  const friends = useMemo(() => rankedFriends(players ?? []), [players]);
  const key = friends.map((p) => `${p.id}=${playerUsernames(p).join(",")}`).join("|");

  useEffect(() => {
    if (!friends.length || !me.length || !ready) return;
    let alive = true;
    const fmt = statsFormat("All Formats", excludeBullet);
    const group = [{ id: "ich", name: "Du", is_me: true, usernames: me }, ...friends.map((p) => ({ id: p.id, name: p.name, is_me: false, usernames: playerUsernames(p) }))];
    const timer = window.setTimeout(() => {
      Promise.all(group.map((g) => profileFor(games, g.usernames, fmt, "All Time")))
        .then((profiles) => {
          if (alive) setRanking(buildRanking(group.map((g, i) => ({ ...g, profile: profiles[i] })), games, { format: fmt, date: "All Time" }));
        })
        // The teaser is an extra: without a ranking the card simply stays out.
        .catch(() => undefined);
    }, START_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [key, games, me.join(","), excludeBullet, ready]);

  if (!players) return null;
  if (!friends.length) {
    return (
      <section class="card tile span-12 league-teaser empty-teaser">
        <span class="league-teaser-icon" aria-hidden="true">
          <IconTrophy />
        </span>
        <div class="league-teaser-text">
          <h3>Starte deine eigene Liga</h3>
          <p class="small muted">Füge Freunde mit ihrem Namen von Lichess oder Chess.com hinzu. Die App vergleicht euch fair, simuliert euer Turnier und zeigt dir, was dir zum nächsten Platz fehlt.</p>
        </div>
        <button class="btn" onClick={() => navigate({ view: "players" })}>
          <IconPlayers /> Freunde hinzufügen
        </button>
      </section>
    );
  }
  const ranked = ranking?.rows.filter((r) => r.overall !== null) ?? [];
  const mine = ranked.find((r) => r.is_me);
  if (!ranking || !mine || ranked.length < 2) return null;
  const above = ranked.filter((r) => (r.overall as number) > (mine.overall as number)).pop();
  const below = ranked.find((r) => (r.overall as number) < (mine.overall as number));
  return (
    <section class="card tile span-12 league-teaser">
      <div class="tile-head">
        <h3>
          Deine Liga: Platz {mine.rank} von {ranked.length}
        </h3>
        <span class="tile-sub">
          {above ? `${de((above.overall as number) - (mine.overall as number), 1)} Punkte hinter ${above.name}` : "du führst"}
          {below ? ` · ${de((mine.overall as number) - (below.overall as number), 1)} vor ${below.name}` : ""}
        </span>
        <span class="spacer" />
        <button class="btn small" onClick={() => navigate({ view: "players", tab: "rangliste" })}>
          <IconTrophy /> Zur Liga
        </button>
      </div>
      <ScaleTrack
        markers={ranked.map((r) => ({ id: r.id, label: r.name, value: r.overall as number, tone: r.is_me ? "tone-me" : toneOf(players, r.id), me: r.is_me }))}
        onPick={(id) => navigate(id === "ich" ? { view: "players", tab: "rangliste" } : { view: "players", playerId: id })}
        // Phones: a standings list instead of dots stacked in lanes.
        rows={narrow}
      />
    </section>
  );
}
