// The two things the league page opens with: what the league is in two sentences,
// and the duel against one friend (who is favoured, what the direct games say).
import { useEffect, useMemo, useState } from "preact/hooks";

import { duelOverview, type DuelCall, type HeadToHead, MIN_RATED_GAMES, type Ranking, type RankRow } from "../../domain/players";
import { Foot } from "../kit";
import { IconSwords } from "../icons";
import { navigate } from "../router";
import { Avatar, de } from "./common";
import { t } from "../../i18n";

type Tones = Record<string, string>;

export function LeagueExplainer() {
  return (
    <section class="lg-intro" aria-label={t("So funktioniert die Liga")}>
      <strong>{t("So funktioniert die Liga")}</strong>
      <p>
        {t("Für jeden von euch schätzt die App aus den eigenen Partien eine Spielstärke (Elo): wie gut die Ergebnisse gegen die jeweiligen Gegner waren und wie wenige Fehler dabei passiert sind. Wer die höhere Zahl hat, steht weiter oben, und ab {MIN_RATED_GAMES} gewerteten Partien bekommt jeder einen Platz.", { MIN_RATED_GAMES })}
      </p>
    </section>
  );
}

const pct = (v: number) => `${Math.round(v)} %`;

/** The headline of the duel call, from the player's own point of view. */
function headline(call: DuelCall, name: string): string {
  switch (call) {
    case "clear-a":
      return t("Du bist klarer Favorit gegen {name}", { name });
    case "slight-a":
      return t("Du hast leichte Vorteile gegen {name}", { name });
    case "even":
      return t("Du und {name} seid auf Augenhöhe", { name });
    case "slight-b":
      return t("{name} hat leichte Vorteile gegen dich", { name });
    case "clear-b":
      return t("{name} ist klarer Favorit gegen dich", { name });
  }
}

/** Ranked players first, strongest on top, so the closest challenge is the first chip. */
const byStrength = (a: RankRow, b: RankRow) => (b.strength?.value ?? -Infinity) - (a.strength?.value ?? -Infinity);

export function DuelHub({
  ranking,
  tones,
  h2hOf,
  onBattle,
  foeId,
  onFoe,
}: {
  ranking: Ranking;
  tones: Tones;
  h2hOf: (a: string, b: string) => HeadToHead | null;
  /** Opens the round-by-round battle of the same two. */
  onBattle: (mine: string, foe: string) => void;
  foeId: string | null;
  onFoe: (id: string) => void;
}) {
  const me = ranking.rows.find((r) => r.is_me) ?? null;
  const foes = useMemo(() => ranking.rows.filter((r) => !r.is_me).sort(byStrength), [ranking]);
  const foe = foes.find((r) => r.id === foeId) ?? foes[0] ?? null;
  const h2h = me && foe ? h2hOf(me.id, foe.id) : null;
  const view = me && foe ? duelOverview(me.strength, foe.strength, h2h) : null;
  const [shown, setShown] = useState(0);
  // The bar grows from the middle each time a friend is picked.
  useEffect(() => {
    setShown(0);
    const id = requestAnimationFrame(() => setShown(1));
    return () => cancelAnimationFrame(id);
  }, [foe?.id]);
  if (!me || !foe) return null;
  const mine = view ? view.score_a : 50;
  return (
    <section class="card duel-hub" aria-label={t("Duell mit einem Freund")}>
      <div class="duel-head">
        <h2>
          <IconSwords />  {t("Duell mit einem Freund")}
        </h2>
        <span class="faint small">{t("Wähle jemanden und sieh, wer gewinnt")}</span>
      </div>
      <div class="duel-chips" role="group" aria-label={t("Freund wählen")}>
        {foes.map((r) => (
          <button key={r.id} class={`chip member${r.id === foe.id ? " on" : ""}`} aria-pressed={r.id === foe.id} onClick={() => onFoe(r.id)}>
            <Avatar name={r.name} tone={tones[r.id] ?? "tone-0"} size="sm" /> {r.name}
          </button>
        ))}
      </div>
      <div class="lg-battle-score duel-vs">
        <div class={`lg-battle-side${view && view.score_a > 50 ? " win" : ""}`}>
          <Avatar name={me.name} tone="tone-me" size="xl" ring={Boolean(view && view.score_a > 50)} />
          <strong>{t("Du")}</strong>
          {view && <span class="faint small tnum">Elo {me.strength?.elo}</span>}
        </div>
        <div class="lg-battle-result">
          <span class="duel-vs-mark">{t("gegen")}</span>
        </div>
        <div class={`lg-battle-side${view && view.score_a < 50 ? " win" : ""}`}>
          <Avatar name={foe.name} tone={tones[foe.id] ?? "tone-0"} size="xl" ring={Boolean(view && view.score_a < 50)} />
          <strong>{foe.name}</strong>
          {view && <span class="faint small tnum">Elo {foe.strength?.elo}</span>}
        </div>
      </div>
      {view ? (
        <>
          <div class="lg-tug big" title={t("Erwartete Punkte pro Partie")}>
            <span class={`lg-tug-a tone-me`} style={{ width: `${shown ? mine : 50}%` }}>
              <span class="tnum">{pct(mine)}</span>
            </span>
            <span class={`lg-tug-b ${tones[foe.id] ?? "tone-0"}`}>
              <span class="tnum">{pct(100 - mine)}</span>
            </span>
          </div>
          <p class="battle-verdict duel-call">{headline(view.call, foe.name)}</p>
          <p class="small muted duel-note">
            {t("Die Prozent sind die Punkte, die jede Seite in einer Partie im Schnitt holt (Sieg 1, Remis ½).")}{" "}
            {view.record
              ? t("Bisher gegeneinander: {wins} Siege, {draws} Remis, {losses} Niederlagen aus {games} Partien.", { wins: view.record.wins, draws: view.record.draws, losses: view.record.losses, games: view.record.games })
              : t("Ihr habt noch nicht gegeneinander gespielt, die Prognose beruht auf euren Partien gegen andere.")}
            {Math.abs(view.elo_gap) >= 1 && " " + (view.elo_gap > 0 ? t("Dein Vorsprung: {n} Elo.", { n: de(view.elo_gap, 0) }) : t("{name} liegt {n} Elo vor dir.", { name: foe.name, n: de(-view.elo_gap, 0) }))}
          </p>
        </>
      ) : (
        <p class="battle-verdict">
          {me.strength
            ? t("Von {name} gibt es noch zu wenige gewertete Partien ({MIN_RATED_GAMES} sind nötig), darum noch keine Prognose.", { name: foe.name, MIN_RATED_GAMES })
            : t("Von dir gibt es noch zu wenige gewertete Partien ({MIN_RATED_GAMES} sind nötig), darum noch keine Prognose.", { MIN_RATED_GAMES })}
        </p>
      )}
      <div class="duel-actions">
        <button class="btn primary" onClick={() => onBattle(me.id, foe.id)}>
          <IconSwords />  {t("Battle in 8 Runden ansehen")}
        </button>
        <button class="btn ghost" onClick={() => navigate({ view: "players", playerId: foe.id })}>
          {t("Profil von {name}", { name: foe.name })}
        </button>
      </div>
      <Foot label={t("Wie sicher ist das?")}>{t("Das ist eine Prognose aus den Spielstärken beider, kein Ergebnis: in einer einzelnen Partie entscheidet auch der Tag. Je mehr Partien ihr gespielt habt, desto sicherer wird sie.")}</Foot>
    </section>
  );
}
