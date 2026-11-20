// The league on the start page: your place among your friends on the same
// track as the league page, one tap away from the full table.
import { useEffect, useMemo, useState } from "preact/hooks";

import { loadPlayers } from "../../app/players";
import { statsFormat } from "../../domain/analysisDepth";
import { trFilter } from "../../domain/i18n";
import { PAGE_PERIODS } from "../../domain/periods";
import { withoutBots } from "../../domain/metrics";
import { buildRanking, comparisonPeriod, eloText, playerUsernames, rankedFriends, type Ranking, type StrengthEstimate, type TrackedPlayer } from "../../domain/players";
import { lichessBlitzToElo } from "../../domain/profile/fide";
import type { StoredGame } from "../../domain/types";
import { IconPlayers, IconTrophy } from "../icons";
import { ScaleTrack } from "../kit";
import { profileFor, toneOf } from "../players/common";
import { navigate } from "../router";
import { useBulletPrefs } from "../useAnalysisPrefs";
import { useNarrow } from "../useNarrow";
import { t } from "../../i18n";

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
    const group = [{ id: "ich", name: t("Du"), is_me: true, usernames: me }, ...friends.map((p) => ({ id: p.id, name: p.name, is_me: false, usernames: playerUsernames(p) }))];
    const timer = window.setTimeout(() => {
      // The league page's default period, so both show the same place.
      const date = comparisonPeriod(
        games,
        group.map((g) => g.usernames),
        fmt,
        PAGE_PERIODS.league,
      );
      const human = withoutBots(games);
      Promise.all(group.map((g) => profileFor(human, g.usernames, fmt, date)))
        .then((profiles) => {
          if (alive) setRanking(buildRanking(group.map((g, i) => ({ ...g, profile: profiles[i] })), games, { format: fmt, date }));
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
          <h3>{t("Starte deine eigene Liga")}</h3>
          <p class="small muted">{t("Füge Freunde mit ihrem Namen von Lichess oder Chess.com hinzu. Die App vergleicht euch fair, simuliert euer Turnier und zeigt dir, was dir zum nächsten Platz fehlt.")}</p>
        </div>
        <button class="btn" onClick={() => navigate({ view: "players" })}>
          <IconPlayers />  {t("Freunde hinzufügen")}
        </button>
      </section>
    );
  }
  const ranked = ranking?.rows.filter((r) => r.strength !== null) ?? [];
  const mine = ranked.find((r) => r.is_me);
  if (!ranking || !mine || ranked.length < 2) return null;
  // The shown numbers are Elo strengths (see fide.ts), so gaps are their differences.
  const elo = (r: (typeof ranked)[number]) => lichessBlitzToElo((r.strength as StrengthEstimate).value);
  const i = ranked.indexOf(mine);
  const above = i > 0 ? ranked[i - 1] : null;
  const below = ranked[i + 1] ?? null;
  const values = ranked.map(elo);
  const min = Math.floor((Math.min(...values) - 40) / 50) * 50;
  const max = Math.max(min + 100, Math.ceil((Math.max(...values) + 40) / 50) * 50);
  const step = Math.max(50, Math.ceil((max - min) / 4 / 50) * 50);
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  return (
    <section class="card tile span-12 league-teaser">
      <div class="tile-head">
        <h3>
          
          {t("Deine Liga: Platz")} {mine.rank} von {ranked.length}
        </h3>
        <span class="tile-sub">
          {above ? t("{0} Elo hinter {name}", { 0: elo(above) - elo(mine), name: above.name }) : t("du führst")}
          {below ? t(" · {0} vor {name}", { 0: elo(mine) - elo(below), name: below.name }) : ""}
          {` · ${trFilter(ranking.period)}`}
        </span>
        <span class="spacer" />
        <button class="btn small" onClick={() => navigate({ view: "players", tab: "rangliste" })}>
          <IconTrophy />  {t("Zur Liga")}
        </button>
      </div>
      <ScaleTrack
        markers={ranked.map((r) => ({ id: r.id, label: r.name, value: elo(r), valueText: eloText((r.strength as StrengthEstimate).value), tone: r.is_me ? "tone-me" : toneOf(players, r.id), me: r.is_me }))}
        min={min}
        max={max}
        ticks={ticks}
        onPick={(id) => navigate(id === "ich" ? { view: "players", tab: "rangliste" } : { view: "players", playerId: id })}
        // Phones: a standings list instead of dots stacked in lanes.
        rows={narrow}
      />
    </section>
  );
}
