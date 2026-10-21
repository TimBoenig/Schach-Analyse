import { useState } from "preact/hooks";

import { trSpeed } from "../domain/i18n";
import type { GameRef, Insight, PlayerProfile, RatingContext } from "../domain/profile";
import { CATEGORIES, CATEGORY_ORDER, type Category, type Exercise } from "../domain/training";
import { AreaChart, BarList, Donut, Gauge, Legend, RadarChart, StackBar } from "./charts";
import type { BarRow, Segment } from "./charts";
import { qualitySegments } from "./labels";
import { navigate } from "./router";
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

const PHASES: [string, string][] = [
  ["opening", "Eröffnung"],
  ["middlegame", "Mittelspiel"],
  ["endgame", "Endspiel"],
];

/** First exercise category training this skill that has exercises. */
function skillCategory(skill: string, pool: Exercise[]): Category | undefined {
  if (!skill) return undefined;
  return CATEGORY_ORDER.find((c) => CATEGORIES[c].skills.includes(skill) && pool.some((e) => e.category === c));
}

function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(digits)} %`;
}

function signed(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
}

function Examples({ refs }: { refs: GameRef[] }) {
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
      <div class="page-title">Mein Profil</div>
      <FilterBar filters={filters} onChange={setFilters} />
    </>
  );

  if (usernames && !usernames.length) {
    return (
      <div>
        <div class="page-title">Mein Profil</div>
        <div class="empty">
          <p>Trage zuerst deine Spielernamen ein, damit die App deine Partien erkennt.</p>
          <button class="btn primary" onClick={() => navigate({ view: "settings" })}>
            Zu den Einstellungen
          </button>
        </div>
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

  const o = profile.overview;
  const rc = profile.rating;
  const typicalLabel = rc ? `Typisch für ${rc.rating}` : undefined;

  const radarSkills = profile.skills.filter((s) => s.sample > 0);
  const radar = radarSkills.map((s) => ({
    key: s.key,
    label: RADAR_LABELS[s.key] ?? s.name,
    value: s.score,
    typical: s.typical,
    faint: !s.reliable,
  }));
  const skillRows: BarRow[] = profile.skills.map((s) => ({
    label: s.name,
    value: s.sample > 0 ? s.score : null,
    reference: s.typical,
    valueText: s.grade,
    faint: !s.reliable,
  }));

  const phaseAcc = (o.phase_accuracy ?? {}) as Record<string, number>;
  const phaseRows: BarRow[] = PHASES.map(([k, name]) => ({
    label: name,
    value: phaseAcc[k] ?? null,
    reference: rc?.typical_phase_accuracy[k] ?? null,
    valueText: pct(phaseAcc[k] ?? null, 1),
  }));

  const quality = qualitySegments(o.quality_counts ?? {});

  type BRow = { label: string; games: number; score_pct: number; avg_accuracy: number; expected_pct: number | null };
  const scoreRows = (rows: BRow[] | undefined): BarRow[] =>
    (rows ?? []).map((r) => ({
      label: r.label,
      value: r.score_pct,
      reference: r.expected_pct,
      valueText: pct(r.score_pct),
      note: [
        `${r.games} ${r.games === 1 ? "Partie" : "Partien"}`,
        r.expected_pct !== null ? `erwartet ${r.expected_pct.toFixed(0)} %` : "",
        r.avg_accuracy ? `Genauigkeit ${r.avg_accuracy.toFixed(0)} %` : "",
      ]
        .filter(Boolean)
        .join(" · "),
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

  const openingRows = (lines: PlayerProfile["openings_best"]): BarRow[] =>
    lines.map((l) => ({
      label: `${l.name} (${l.color})`,
      value: l.score_pct,
      valueText: pct(l.score_pct),
      note: `${l.games} ${l.games === 1 ? "Partie" : "Partien"}${l.avg_accuracy ? ` · Genauigkeit ${l.avg_accuracy.toFixed(0)} %` : ""}`,
    }));

  return (
    <div class="profile" style={{ opacity: loading ? 0.6 : 1 }}>
      {header}

      <div class="dash">
        <Hero profile={profile} />

        {profile.is_empty ? (
          <div class="card notice span-12">
            Noch keine deiner Partien ist analysiert. Analysiere ein paar Partien, dann erscheinen hier Fähigkeiten,
            Stärken, Schwächen und dein Trainingsplan.
          </div>
        ) : (
          <>
            <Card title="Fähigkeiten-Netz" sub={rc ? "Richtwerte geschätzt" : undefined} span={6}>
              <RadarChart axes={radar} typicalLabel={typicalLabel} />
            </Card>

            <Card title="Fähigkeiten im Detail" sub="0–100 Punkte" span={6}>
              <BarList rows={skillRows} referenceLabel={typicalLabel} />
              <p class="faint small tile-foot">Blasse Balken beruhen auf wenigen Daten.</p>
            </Card>

            <Card title="Genauigkeit nach Phase" span={4}>
              <BarList rows={phaseRows} referenceLabel={typicalLabel} />
            </Card>

            <Card title="Zugqualität" sub="alle deine Züge" span={4}>
              <StackBar segments={quality} />
            </Card>

            <Card title="Nach Gegnerstärke" sub="Punkte gegen Erwartung" span={4}>
              {profile.breakdowns.opponent?.length ? (
                <BarList rows={scoreRows(profile.breakdowns.opponent)} referenceLabel="Erwartet nach Elo" />
              ) : (
                <p class="muted small">Keine Wertungszahlen in den Partien.</p>
              )}
            </Card>

            <Card title="Genauigkeit im Verlauf" sub="pro Monat" span={6}>
              <AreaChart
                points={accPoints}
                format={(v) => `${v.toFixed(0)}`}
                domain={[0, 100]}
                reference={rc ? { value: rc.typical_accuracy, label: typicalLabel as string } : null}
              />
            </Card>

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

            <Card title="Stärken" span={6}>
              <InsightList items={profile.strengths} tone="pos" empty="Noch keine klaren Stärken erkennbar." />
            </Card>

            <Card title="Schwächen" span={6}>
              <InsightList items={profile.weaknesses} tone="neg" empty="Keine auffälligen Schwächen." />
            </Card>

            {profile.style && (
              <Card title={`Spielstil: ${profile.style.label}`} span={6}>
                <p class="small" style={{ marginTop: 0 }}>
                  {profile.style.description}
                </p>
                {profile.style.axes.map((a) => (
                  <div class="style-axis" key={a.key}>
                    <div class="labels">
                      <span>{a.low_label}</span>
                      <strong>{a.name}</strong>
                      <span>{a.high_label}</span>
                    </div>
                    <div class="track">
                      <div class="dot" style={{ left: `${a.value}%` }} />
                    </div>
                  </div>
                ))}
                {profile.style.facts.length > 0 && (
                  <ul class="facts">
                    {profile.style.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            <Card title="Wiederkehrende Muster" span={profile.style ? 6 : 12}>
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
                <p class="muted small">Noch keine Muster gefunden.</p>
              )}
            </Card>

            <Card title="Nach Farbe und Bedenkzeit" sub="Punkte-Quote" span={6}>
              <h4>Farbe</h4>
              <BarList rows={scoreRows(profile.breakdowns.color)} />
              {(profile.breakdowns.speed?.length ?? 0) > 0 && (
                <>
                  <h4>Bedenkzeit</h4>
                  <BarList rows={scoreRows(profile.breakdowns.speed)} referenceLabel="Erwartet nach Elo" />
                </>
              )}
            </Card>

            <Card title="Eröffnungen" sub="Punkte-Quote · Partien" span={6}>
              {profile.openings_best.length || profile.openings_worst.length ? (
                <>
                  {profile.openings_best.length > 0 && (
                    <>
                      <h4>Am erfolgreichsten</h4>
                      <BarList rows={openingRows(profile.openings_best)} />
                    </>
                  )}
                  {profile.openings_worst.length > 0 && (
                    <>
                      <h4>Hier verlierst du Punkte</h4>
                      <BarList rows={openingRows(profile.openings_worst)} />
                    </>
                  )}
                </>
              ) : (
                <p class="muted small">Noch zu wenige Partien pro Eröffnung.</p>
              )}
            </Card>

            {profile.training_plan.length > 0 && (
              <section class="card tile span-12">
                <div class="tile-head">
                  <h3>Deine Trainingsschwerpunkte</h3>
                  <button class="btn primary small" onClick={() => navigate({ view: "training" })}>
                    Zum Tagesplan
                  </button>
                </div>
                <div class="plan">
                  {profile.training_plan.map((t) => (
                    <div class="plan-item" key={t.title}>
                      <div class="plan-num">{t.priority}</div>
                      <div class="t">{t.title}</div>
                      <div class="small muted">{t.reason}</div>
                      <ul>
                        {t.steps.map((s) => (
                          <li class="small" key={s}>
                            {s}
                          </li>
                        ))}
                      </ul>
                      <Examples refs={t.examples} />
                      {skillCategory(t.focus_skill, profile.exercises) && (
                        <button
                          class="btn small"
                          style={{ marginTop: "8px" }}
                          onClick={() =>
                            navigate({ view: "training", tab: "uebungen", category: skillCategory(t.focus_skill, profile.exercises) })
                          }
                        >
                          In der App üben
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
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
