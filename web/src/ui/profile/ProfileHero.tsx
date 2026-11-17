// The top of the profile: who the player is in one word and one sentence,
// then the four figures everything else on the page explains.
import { trSpeed } from "../../domain/i18n";
import type { PlayerProfile } from "../../domain/profile";
import { CountUp } from "../kit";
import { Level, SplitBar, Stat } from "../viz/Bars";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${de(Math.abs(v), digits)}`;

export function ProfileHero({ profile }: { profile: PlayerProfile }) {
  const o = profile.overview;
  const rc = profile.rating;
  const speedName = rc ? trSpeed(rc.speed) : "";
  const others = Object.entries((o.ratings ?? {}) as Record<string, number>).filter(([k]) => k !== speedName);
  const diff = rc && rc.expected_score !== null ? rc.score - rc.expected_score : null;
  const accDelta = rc && profile.analyzed_games ? o.avg_accuracy - rc.typical_accuracy : null;
  const games = `${o.games.toLocaleString("de-DE")} ${o.games === 1 ? "Partie" : "Partien"}`;
  return (
    <section class="card span-12 pf-hero" id="s-ueberblick">
      <div class="pf-hero-id">
        <span class="eyebrow">
          Dein Profil · {games} · {profile.analyzed_games.toLocaleString("de-DE")} analysiert
        </span>
        {profile.style ? (
          <>
            <h2 class="pf-hero-title">
              <span>Dein Stil</span>
              {profile.style.label}
            </h2>
            <p class="pf-hero-sub">{profile.style.description}</p>
          </>
        ) : (
          <h2 class="pf-hero-title">Dein Schachprofil</h2>
        )}
      </div>
      <div class="pf-stats">
        <Stat
          label={rc ? `Wertung · ${speedName}` : "Wertung"}
          value={rc ? <CountUp value={rc.rating} /> : "–"}
          sub={
            rc ? (
              <>
                Performance <b class="tnum">{rc.performance ?? "–"}</b> · Ø Gegner <b class="tnum">{rc.avg_opponent ?? "–"}</b>
              </>
            ) : (
              "Die Partien enthalten keine Wertungszahlen."
            )
          }
        >
          {others.length > 0 && (
            <span class="stat-chips">
              {others.map(([k, v]) => (
                <span class="stat-chip" key={k}>
                  {k} <b class="tnum">{v}</b>
                </span>
              ))}
            </span>
          )}
        </Stat>
        <Stat
          label="Bilanz"
          value={o.games ? `${de(o.score_pct, 0)} %` : "–"}
          sub={
            <>
              <b class="tnum">{o.wins}</b> Siege · <b class="tnum">{o.draws}</b> Remis · <b class="tnum">{o.losses}</b> Niederlagen
            </>
          }
        >
          <SplitBar
            height={8}
            parts={[
              { key: "w", label: "Siege", value: o.wins, color: "var(--win)" },
              { key: "d", label: "Remis", value: o.draws, color: "var(--draw)" },
              { key: "l", label: "Niederlagen", value: o.losses, color: "var(--loss)" },
            ]}
          />
        </Stat>
        <Stat
          label="Punkte gegen Erwartung"
          value={diff !== null ? signed(diff) : "–"}
          tone={diff === null || Math.abs(diff) < 0.5 ? undefined : diff > 0 ? "good" : "bad"}
          sub={
            rc && rc.expected_score !== null ? (
              <>
                <b class="tnum">{de(rc.score)}</b> geholt, <b class="tnum">{de(rc.expected_score)}</b> nach Wertung erwartet
              </>
            ) : (
              "Dafür braucht es die Wertungen beider Spieler."
            )
          }
        >
          {rc && rc.expected_score !== null && <Level value={rc.score} max={Math.max(rc.rated_games, 1)} reference={rc.expected_score} tone={diff !== null && diff <= -0.5 ? "bad" : "good"} />}
        </Stat>
        <Stat
          label="Genauigkeit"
          value={profile.analyzed_games ? <CountUp value={o.avg_accuracy} format={(v) => de(v)} /> : "–"}
          sub={
            rc && accDelta !== null ? (
              <>
                <b class={`tnum ${accDelta >= 2 ? "good" : accDelta <= -2 ? "bad" : ""}`}>{signed(accDelta)}</b> {rc.reference === "opponents" ? `zu deinen Gegnern (${de(rc.typical_accuracy, 0)})` : `zum Richtwert ${de(rc.typical_accuracy, 0)} für ${rc.rating}`}
              </>
            ) : profile.analyzed_games ? (
              "über alle analysierten Partien"
            ) : (
              "Noch keine Partie analysiert."
            )
          }
        >
          {profile.analyzed_games > 0 && <Level value={o.avg_accuracy} reference={rc?.typical_accuracy} tone="accent" />}
        </Stat>
      </div>
    </section>
  );
}
