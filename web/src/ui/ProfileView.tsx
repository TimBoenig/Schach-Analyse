import { useState } from "preact/hooks";

import { trSpeed } from "../domain/i18n";
import { STYLE_MIN_GAMES, type GameRef, type Insight, type PlayerProfile, type RatingContext, type SkillScore, type StyleAxis } from "../domain/profile";
import { CATEGORIES, CATEGORY_ORDER, type Category, type Exercise } from "../domain/training";
import { AreaChart, BarList, Donut, Gauge, Legend, RadarChart } from "./charts";
import type { BarRow, Segment } from "./charts";
import { navigate } from "./router";
import { CoachTip, NeedNames } from "./Coach";
import { PageHeader } from "./Layout";
import { openSection, type ProfileSection, SectionHead, SectionNav, sectionOf, STAT_SECTIONS } from "./StatsLayout";
import { FilterBar, filtersActive, useProfile } from "./useProfile";

/** Short axis names for the radar; the full names stay in the detail list. */
const RADAR_LABELS: Record<string, string> = {
  opening: "Eröffnung",
  middlegame: "Mittelspiel",
  endgame: "Endspiel",
  tactics: "Taktik",
  safety: "Sicherheit",
  conversion: "Verwertung",
  defense: "Verteidigung",
  time: "Zeit",
  consistency: "Konstanz",
};

/** First exercise category training this skill that has exercises. */
export function skillCategory(skill: string, pool: Exercise[]): Category | undefined {
  if (!skill) return undefined;
  return CATEGORY_ORDER.find((c) => CATEGORIES[c].skills.includes(skill) && pool.some((e) => e.category === c));
}

function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(digits)} %`;
}

function signed(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
}

/** Evidence line under a skill bar: uncertainty and the raw measurement when blending moved it. */
export function skillNote(s: SkillScore): string | undefined {
  if (!s.sample || s.margin === null || s.margin === undefined) return undefined;
  const raw = s.raw_score !== undefined && Math.abs(s.raw_score - s.score) >= 3 ? ` · gemessen ${Math.round(s.raw_score)}` : "";
  return `±${s.margin}${raw}`;
}

export function Examples({ refs }: { refs: GameRef[] }) {
  if (!refs.length) return null;
  return (
    <div class="examples">
      {refs.slice(0, 3).map((r) => (
        <button
          key={`${r.game_id}-${r.ply_index}`}
          class="pill accent"
          onClick={() => navigate({ view: "analysis", gameId: r.game_id, ply: r.ply_index + 1 })}
        >
          {r.label || "Beispiel ansehen"}
        </button>
      ))}
    </div>
  );
}

function Card({ title, sub, span, children }: { title: string; sub?: string; span: 4 | 6 | 12; children: preact.ComponentChildren }) {
  return (
    <section class={`card tile span-${span}`}>
      <div class="tile-head">
        <h3>{title}</h3>
        {sub && <span class="tile-sub">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function InsightList({ items, tone, empty }: { items: Insight[]; tone: "pos" | "neg"; empty: string }) {
  if (!items.length) return <p class="muted small">{empty}</p>;
  return (
    <div class="insights">
      {items.map((s) => (
        <div class={`insight ${tone}`} key={s.key}>
          <div class="t">{s.title}</div>
          <div class="small">{s.text}</div>
        </div>
      ))}
    </div>
  );
}

/** Style axes as dots on a track with their ± band. */
export function StyleAxes({ axes }: { axes: StyleAxis[] }) {
  return (
    <>
      {axes.map((a) => (
        <div class="style-axis" key={a.key}>
          <div class="labels">
            <span>{a.low_label}</span>
            <strong>{a.name}</strong>
            <span>{a.high_label}</span>
          </div>
          <div class="track" title={a.margin ? `±${a.margin} Punkte Unsicherheit` : undefined}>
            {a.margin ? (
              <div
                class="band"
                style={{ left: `${Math.max(0, a.value - a.margin)}%`, right: `${Math.max(0, 100 - a.value - a.margin)}%` }}
              />
            ) : null}
            <div class="dot" style={{ left: `${a.value}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}

function Hero({ profile }: { profile: PlayerProfile }) {
  const o = profile.overview;
  const rc: RatingContext | null = profile.rating;
  const speedName = rc ? trSpeed(rc.speed) : "";
  const others = Object.entries((o.ratings ?? {}) as Record<string, number>).filter(([k]) => k !== speedName);
  const wdl: Segment[] = [
    { label: "Siege", value: o.wins, color: "var(--win)" },
    { label: "Remis", value: o.draws, color: "var(--draw)" },
    { label: "Niederlagen", value: o.losses, color: "var(--loss)" },
  ];
  const diff = rc && rc.expected_score !== null ? rc.score - rc.expected_score : null;
  const accDelta = rc && profile.analyzed_games ? o.avg_accuracy - rc.typical_accuracy : null;
  return (
    <section class="card hero span-12">
      <div class="hero-cell">
        <div class="kpi-label">{rc ? `Wertung · ${speedName}` : "Wertung"}</div>
        <div class="kpi-big tnum">{rc ? rc.rating : "–"}</div>
        {rc ? (
          <div class="kpi-rows">
            <div>
              <span>Performance</span>
              <strong class="tnum">{rc.performance ?? "–"}</strong>
            </div>
            <div>
              <span>Ø Gegner</span>
              <strong class="tnum">{rc.avg_opponent ?? "–"}</strong>
            </div>
            {others.map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong class="tnum">{v}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div class="small muted">Die Partien enthalten keine Wertungszahlen.</div>
        )}
      </div>

      <div class="hero-cell with-chart">
        <Donut segments={wdl} center={pct(o.score_pct)} sub="Punkte" size={108} thickness={12} />
        <div class="hero-side">
          <div class="kpi-label">Bilanz</div>
          <Legend items={wdl.map((s) => ({ label: s.label, color: s.color, value: String(s.value) }))} />
          <div class="small faint">{o.games} Partien</div>
        </div>
      </div>

      <div class="hero-cell">
        <div class="kpi-label">Punkte gegen Erwartung</div>
        {rc && rc.expected_score !== null && diff !== null ? (
          <>
            <div class="kpi-big tnum">
              {rc.score.toFixed(1)}
              <span class="kpi-unit"> / {rc.expected_score.toFixed(1)}</span>
            </div>
            <div class="expect-bar" aria-hidden="true">
              <div class="fill" style={{ width: `${Math.min(100, (rc.score / Math.max(rc.rated_games, 1)) * 100)}%` }} />
              <div class="bar-ref" style={{ left: `${Math.min(100, (rc.expected_score / Math.max(rc.rated_games, 1)) * 100)}%` }} />
            </div>
            <div class="small muted">
              <span class={`pill ${diff >= 0.5 ? "win" : diff <= -0.5 ? "loss" : "draw"}`}>{signed(diff)}</span>{" "}
              {diff >= 0.5 ? "mehr als" : diff <= -0.5 ? "weniger als" : "genau wie"} nach Wertung erwartet
            </div>
          </>
        ) : (
          <div class="small muted">Ohne Wertungen beider Spieler lässt sich keine Erwartung berechnen.</div>
        )}
      </div>

      <div class="hero-cell with-chart">
        <Gauge
          value={profile.analyzed_games ? o.avg_accuracy : null}
          reference={rc?.typical_accuracy}
          label="Genauigkeit"
          size={108}
          format={(v) => v.toFixed(1)}
        />
        <div class="hero-side">
          <div class="kpi-label">Genauigkeit</div>
          {rc && accDelta !== null ? (
            <div class="small muted">
              <span class={`pill ${accDelta >= 2 ? "win" : accDelta <= -2 ? "loss" : "draw"}`}>{signed(accDelta)}</span> zum
              Richtwert {rc.typical_accuracy.toFixed(0)} für {rc.rating}
            </div>
          ) : null}
          <div class="small faint">{profile.analyzed_games} Partien analysiert</div>
          {o.form_delta !== null && o.form_delta !== undefined && (
            <div class="small muted">Form zuletzt: {signed(o.form_delta)}</div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ProfileView() {
  const { profile, usernames, loading, error, filters, setFilters } = useProfile();
  const [ratingSpeed, setRatingSpeed] = useState<string | null>(null);

  const header = (
    <>
      <PageHeader toolbar={<FilterBar filters={filters} onChange={setFilters} />} />
      <CoachTip id="profile" title="Dein Schachprofil">
        Das ist dein Steckbrief als Spieler. Ich bewerte deine Fähigkeiten von 0 bis 100 und vergleiche sie mit Spielern deiner Wertung. Blasse Werte haben noch wenige Daten, die werden mit mehr Partien genauer.
      </CoachTip>
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div>
        <PageHeader />
        <NeedNames what="baue ich dir hier dein Spielerprofil." />
      </div>
    );
  }
  if (loading && !profile) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "170px" }} />
          <div class="skeleton span-6" style={{ height: "340px" }} />
          <div class="skeleton span-6" style={{ height: "340px" }} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {header}
        <p class="error">{error}</p>
      </div>
    );
  }
  if (!profile || profile.total_games === 0) {
    return (
      <div>
        {header}
        <div class="empty">
          <p>
            Keine Partien für {usernames?.join(", ")} gefunden
            {filtersActive(filters) ? " (mit diesen Filtern)" : ""}.
          </p>
          <button class="btn primary" onClick={() => navigate({ view: "games" })}>
            Partien importieren
          </button>
        </div>
      </div>
    );
  }

  const rc = profile.rating;
  const typicalLabel = rc ? `Typisch für ${rc.rating}` : undefined;

  const radarSkills = profile.skills.filter((s) => s.sample > 0);
  const radar = radarSkills.map((s) => ({
    key: s.key,
    label: RADAR_LABELS[s.key] ?? s.name,
    value: s.score,
    typical: s.typical,
    faint: !s.reliable,
    margin: s.margin,
    raw: s.raw_score,
  }));
  const skillRows: BarRow[] = profile.skills.map((s) => ({
    label: s.name,
    value: s.sample > 0 ? s.score : null,
    reference: s.typical,
    valueText: s.sample > 0 && s.grade !== "Keine Uhrdaten" ? `${s.grade} · ${Math.round(s.score)}` : s.grade,
    faint: !s.reliable,
    note: skillNote(s),
  }));

  const monthly = (profile.trends.monthly ?? []) as { month: string; avg_accuracy: number | null; games: number }[];
  const accPoints = monthly
    .filter((m) => m.avg_accuracy !== null)
    .map((m) => ({
      label: `${m.month.slice(5, 7)}/${m.month.slice(2, 4)}`,
      value: m.avg_accuracy as number,
      detail: `${m.month.slice(5, 7)}/${m.month.slice(0, 4)} · ${m.games} ${m.games === 1 ? "Partie" : "Partien"}`,
    }));
  const ratingSeries = (profile.trends.ratings ?? {}) as Record<string, [number, number][]>;
  const speeds = Object.keys(ratingSeries).sort((a, b) => ratingSeries[b].length - ratingSeries[a].length);
  const shownSpeed = ratingSpeed && ratingSeries[ratingSpeed] ? ratingSpeed : speeds[0];
  const ratingPoints = (ratingSeries[shownSpeed] ?? []).map(([ts, r]) => {
    const d = new Date(ts * 1000);
    return {
      label: d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
      value: r,
      detail: d.toLocaleDateString("de-DE"),
    };
  });

  const sec = (id: ProfileSection) => sectionOf("profile", id);
  const sections = profile.is_empty ? [sec("ueberblick")] : STAT_SECTIONS.profile;

  return (
    <div class="profile" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}
      <SectionNav sections={sections} />

      <div class="dash">
        <SectionHead section={sec("ueberblick")} />
        <Hero profile={profile} />

        {profile.is_empty ? (
          <div class="card notice span-12">
            Noch keine deiner Partien ist analysiert. Analysiere ein paar Partien, dann erscheinen hier Fähigkeiten,
            Stärken, Schwächen und dein Trainingsplan.
          </div>
        ) : (
          <>
            <SectionHead section={sec("faehigkeiten")} />
            <Card title="Fähigkeiten-Netz" sub={rc ? "Richtwerte geschätzt" : undefined} span={6}>
              <RadarChart axes={radar} typicalLabel={typicalLabel} />
            </Card>

            <Card title="Fähigkeiten im Detail" sub="0–100 Punkte" span={6}>
              <BarList rows={skillRows} referenceLabel={typicalLabel} />
              <p class="faint small tile-foot">
                Blasse Balken beruhen auf wenigen Daten. Solche Werte gleicht die App zum Richtwert hin aus, statt sie auf 0
                oder 100 springen zu lassen; ± zeigt, wie genau ein Wert ist.
              </p>
            </Card>

            <SectionHead section={sec("staerken")} />
            <Card title="Stärken" span={6}>
              <InsightList
                items={profile.strengths}
                tone="pos"
                empty="Noch keine belastbaren Stärken. Genannt wird nur, was viele Partien klar zeigen."
              />
            </Card>

            <Card title="Schwächen" span={6}>
              <InsightList
                items={profile.weaknesses}
                tone="neg"
                empty="Keine belastbaren Schwächen. Genannt wird nur, was viele Partien klar zeigen."
              />
            </Card>

            <SectionHead section={sec("stil")} />
            {profile.style ? (
              <Card title={`Spielstil: ${profile.style.label}`} span={6}>
                <p class="small" style={{ marginTop: 0 }}>
                  {profile.style.description}
                </p>
                <StyleAxes axes={profile.style.axes} />
                {profile.style.facts.length > 0 && (
                  <ul class="facts">
                    {profile.style.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : (
              <Card title="Spielstil" span={6}>
                <p class="muted small">Der Spielstil erscheint ab {STYLE_MIN_GAMES} analysierten Partien.</p>
              </Card>
            )}

            <Card title="Wiederkehrende Muster" span={6}>
              {profile.patterns.length ? (
                <div class="insights">
                  {profile.patterns.map((p) => (
                    <div class={`insight ${p.severity === "positiv" ? "pos" : p.severity === "hoch" ? "neg" : "mid"}`} key={p.key}>
                      <div class="t">{p.title}</div>
                      <div class="small">{p.text}</div>
                      <Examples refs={p.examples} />
                    </div>
                  ))}
                </div>
              ) : (
                <p class="muted small">
                  Noch keine Muster gefunden. Ein Muster wird erst genannt, wenn genug Partien es zeigen und es kein Zufall sein kann.
                </p>
              )}
            </Card>

            <SectionHead section={sec("verlauf")} />
            <Card title="Wertungsverlauf" sub={shownSpeed} span={6}>
              {speeds.length > 1 && (
                <div class="segmented small-seg">
                  {speeds.map((sp) => (
                    <button key={sp} class={sp === shownSpeed ? "active" : ""} onClick={() => setRatingSpeed(sp)}>
                      {sp}
                    </button>
                  ))}
                </div>
              )}
              <AreaChart points={ratingPoints} format={(v) => v.toFixed(0)} />
            </Card>

            <Card title="Genauigkeit im Verlauf" sub="pro Monat" span={6}>
              <AreaChart
                points={accPoints}
                format={(v) => `${v.toFixed(0)}`}
                reference={rc ? { value: rc.typical_accuracy, label: typicalLabel as string } : null}
              />
            </Card>

            <section class="card tile span-12 next-links">
              <span class="small muted">Weiter in der Statistik:</span>
              <button class="btn small" onClick={() => openSection("moves", "phasen")}>
                Genauigkeit nach Phase
              </button>
              <button class="btn small" onClick={() => navigate({ view: "moves" })}>
                Zugbilanz
              </button>
              <button class="btn small" onClick={() => openSection("insights", "ergebnisse")}>
                Ergebnisse nach Gegner, Farbe, Bedenkzeit
              </button>
              <button class="btn small" onClick={() => navigate({ view: "openings" })}>
                Eröffnungen
              </button>
              <span class="spacer" />
              <button class="btn primary small" onClick={() => navigate({ view: "training" })}>
                Zu deinen Trainingsschwerpunkten
              </button>
            </section>
          </>
        )}
      </div>
      {rc && !profile.is_empty && (
        <p class="faint small" style={{ marginTop: "14px" }}>
          „Typisch für {rc.rating}“ sind geschätzte Richtwerte für Online-Partien in dieser Wertungsklasse. Die Erwartung
          nach Elo rechnet jede Partie mit deiner damaligen Wertung und der des Gegners.
        </p>
      )}
    </div>
  );
}
