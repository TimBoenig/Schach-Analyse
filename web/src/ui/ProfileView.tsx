import { useEffect, useState } from "preact/hooks";

import { buildProfileInWorker } from "../app/profileClient";
import { trFilter } from "../domain/i18n";
import type { GameRef, PlayerProfile } from "../domain/profile";
import { getSetting, listGames, onDataChanged } from "../storage/db";
import { LineChart } from "./LineChart";
import { navigate } from "./router";

const FORMATS = ["All Formats", "Bullet", "Blitz", "Rapid", "Classical", "Daily"];
const DATES = ["All Time", "Last 30 Days", "Last 90 Days", "This Year"];
const COLORS = ["All Colors", "White", "Black"];

function scoreColor(score: number): string {
  if (score >= 70) return "var(--good)";
  if (score >= 50) return "var(--inacc)";
  if (score >= 35) return "var(--mistake)";
  return "var(--blunder)";
}

function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(digits)} %`;
}

function Examples({ refs }: { refs: GameRef[] }) {
  if (!refs.length) return null;
  return (
    <div class="row" style={{ marginTop: "6px" }}>
      {refs.slice(0, 3).map((r) => (
        <button
          key={`${r.game_id}-${r.ply_index}`}
          class="pill accent"
          style={{ border: 0 }}
          onClick={() => navigate({ view: "analysis", gameId: r.game_id, ply: r.ply_index + 1 })}
        >
          {r.label || "Beispiel ansehen"}
        </button>
      ))}
    </div>
  );
}

function Select({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o} value={o}>
          {trFilter(o)}
        </option>
      ))}
    </select>
  );
}

export function ProfileView() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [format, setFormat] = useState("All Formats");
  const [date, setDate] = useState("All Time");
  const [color, setColor] = useState("All Colors");
  const [version, setVersion] = useState(0);

  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const names = await getSetting<string[]>("usernames", []);
      if (!alive) return;
      setUsernames(names);
      if (!names.length) {
        setLoading(false);
        return;
      }
      try {
        const games = await listGames();
        const p = await buildProfileInWorker({ games, usernames: names, format, date, color });
        if (alive) {
          setProfile(p);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [format, date, color, version]);

  const header = (
    <>
      <div class="page-title">Mein Profil</div>
      <div class="filters">
        <Select value={format} options={FORMATS} onChange={setFormat} label="Bedenkzeit" />
        <Select value={date} options={DATES} onChange={setDate} label="Zeitraum" />
        <Select value={color} options={COLORS} onChange={setColor} label="Farbe" />
      </div>
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
        <div class="stat-tiles">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} class="skeleton" style={{ height: "86px" }} />
          ))}
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
          <p>Keine Partien für {usernames?.join(", ")} gefunden{format !== "All Formats" || date !== "All Time" || color !== "All Colors" ? " (mit diesen Filtern)" : ""}.</p>
          <button class="btn primary" onClick={() => navigate({ view: "games" })}>
            Partien importieren
          </button>
        </div>
      </div>
    );
  }

  const o = profile.overview;
  const monthly = (profile.trends.monthly ?? []) as { month: string; avg_accuracy: number | null; score_pct: number; games: number }[];
  const accPoints = monthly
    .filter((m) => m.avg_accuracy !== null)
    .map((m) => ({ label: `${m.month.slice(5, 7)}/${m.month.slice(2, 4)}`, value: m.avg_accuracy as number }));
  const ratingSeries = (profile.trends.ratings ?? {}) as Record<string, [number, number][]>;

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {header}

      <div class="stat-tiles" style={{ marginBottom: "14px" }}>
        <div class="stat-tile">
          <div class="label">Partien</div>
          <div class="value">{o.games}</div>
          <div class="sub">
            {o.wins} S · {o.draws} R · {o.losses} N
          </div>
        </div>
        <div class="stat-tile">
          <div class="label">Punkte-Quote</div>
          <div class="value">{pct(o.score_pct)}</div>
          <div class="sub">Siegquote {pct(o.win_rate)}</div>
        </div>
        <div class="stat-tile">
          <div class="label">Ø Genauigkeit</div>
          <div class="value">{pct(o.avg_accuracy, 1)}</div>
          <div class="sub">
            {o.form_delta !== null && o.form_delta !== undefined
              ? `Form: ${o.form_delta >= 0 ? "+" : ""}${o.form_delta.toFixed(1)} Pkt.`
              : `${profile.analyzed_games} analysiert`}
          </div>
        </div>
        <div class="stat-tile">
          <div class="label">Fehlerfreie Partien</div>
          <div class="value">{pct(o.clean_games_pct)}</div>
          <div class="sub">
            {o.brilliant_moves ?? 0} brillante · {o.great_moves ?? 0} großartige Züge
          </div>
        </div>
        {Object.entries((o.ratings ?? {}) as Record<string, number>).map(([k, v]) => (
          <div class="stat-tile" key={k}>
            <div class="label">Wertung {k}</div>
            <div class="value">{v}</div>
          </div>
        ))}
      </div>

      {profile.is_empty ? (
        <div class="card notice">
          Noch keine deiner Partien ist analysiert. Analysiere ein paar Partien, dann erscheinen hier Fähigkeiten,
          Stärken, Schwächen und dein Trainingsplan.
        </div>
      ) : (
        <div class="masonry">
          <div class="card">
            <h3>Fähigkeiten</h3>
            {profile.skills.map((s) => (
              <div class="skill" key={s.key}>
                <div class="head">
                  <span>{s.name}</span>
                  <span class="score" style={{ color: scoreColor(s.score) }}>
                    {s.grade}
                  </span>
                </div>
                <div class="bar">
                  <div style={{ width: `${Math.max(2, s.score)}%`, background: scoreColor(s.score), opacity: s.reliable ? 1 : 0.45 }} />
                </div>
              </div>
            ))}
            <p class="muted small" style={{ marginBottom: 0 }}>
              Schulnoten aus deinen analysierten Partien. Blasse Balken beruhen auf wenigen Daten.
            </p>
          </div>

          <div class="card">
            <h3>Stärken</h3>
            {profile.strengths.length ? (
              profile.strengths.map((s) => (
                <div class="insight pos" key={s.key}>
                  <div class="t">{s.title}</div>
                  <div class="small">{s.text}</div>
                </div>
              ))
            ) : (
              <p class="muted small">Noch keine klaren Stärken erkennbar.</p>
            )}
            <h3 style={{ marginTop: "16px" }}>Schwächen</h3>
            {profile.weaknesses.length ? (
              profile.weaknesses.map((s) => (
                <div class="insight neg" key={s.key}>
                  <div class="t">{s.title}</div>
                  <div class="small">{s.text}</div>
                </div>
              ))
            ) : (
              <p class="muted small">Keine auffälligen Schwächen.</p>
            )}
          </div>

          {profile.style && (
            <div class="card">
              <h3>Spielstil: {profile.style.label}</h3>
              <p class="small" style={{ marginTop: 0 }}>
                {profile.style.description}
              </p>
              {profile.style.axes.map((a) => (
                <div class="style-axis" key={a.key}>
                  <div class="labels">
                    <span>{a.low_label}</span>
                    <strong style={{ color: "var(--text)" }}>{a.name}</strong>
                    <span>{a.high_label}</span>
                  </div>
                  <div class="track">
                    <div class="dot" style={{ left: `${a.value}%` }} />
                  </div>
                </div>
              ))}
              {profile.style.facts.map((f) => (
                <div class="small muted" key={f}>
                  • {f}
                </div>
              ))}
            </div>
          )}

          <div class="card">
            <h3>Wiederkehrende Muster</h3>
            {profile.patterns.length ? (
              profile.patterns.map((p) => (
                <div class={`insight ${p.severity === "positiv" ? "pos" : p.severity === "hoch" ? "neg" : "mid"}`} key={p.key}>
                  <div class="t">{p.title}</div>
                  <div class="small">{p.text}</div>
                  <Examples refs={p.examples} />
                </div>
              ))
            ) : (
              <p class="muted small">Noch keine Muster gefunden.</p>
            )}
          </div>

          <div class="card">
            <h3>Genauigkeit im Verlauf</h3>
            <LineChart points={accPoints} format={(v) => `${v.toFixed(0)} %`} domain={[0, 100]} />
          </div>

          {Object.entries(ratingSeries).map(([speed, pts]) => (
            <div class="card" key={speed}>
              <h3>Wertung {speed}</h3>
              <LineChart
                points={pts.map(([ts, r]) => ({
                  label: new Date(ts * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
                  value: r,
                }))}
                format={(v) => v.toFixed(0)}
              />
            </div>
          ))}

          {(profile.openings_best.length > 0 || profile.openings_worst.length > 0) && (
            <div class="card">
              <h3>Eröffnungen</h3>
              {(
                [
                  ["Am erfolgreichsten", profile.openings_best],
                  ["Hier verlierst du Punkte", profile.openings_worst],
                ] as const
              ).map(([title, lines]) =>
                lines.length ? (
                  <div key={title} style={{ marginBottom: "10px" }}>
                    <div class="muted small" style={{ marginBottom: "4px" }}>
                      {title}
                    </div>
                    <table class="table">
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.name + l.color}>
                            <td>
                              {l.name} <span class="muted small">({l.color})</span>
                            </td>
                            <td class="num">{l.games}</td>
                            <td class="num">{pct(l.score_pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null,
              )}
            </div>
          )}

          <div class="card">
            <h3>Aufschlüsselung</h3>
            {(
              [
                ["Nach Farbe", profile.breakdowns.color],
                ["Nach Bedenkzeit", profile.breakdowns.speed],
                ["Nach Gegnerstärke", profile.breakdowns.opponent],
              ] as const
            ).map(([title, rows]) =>
              rows && rows.length ? (
                <table class="table" key={title} style={{ marginBottom: "10px" }}>
                  <thead>
                    <tr>
                      <th>{title}</th>
                      <th class="num">Partien</th>
                      <th class="num">Punkte</th>
                      <th class="num">Genauigkeit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rows as { label: string; games: number; score_pct: number; avg_accuracy: number }[]).map((r) => (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        <td class="num">{r.games}</td>
                        <td class="num">{pct(r.score_pct)}</td>
                        <td class="num">{r.avg_accuracy ? pct(r.avg_accuracy, 1) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null,
            )}
          </div>

          {profile.training_plan.length > 0 && (
            <div class="card">
              <h3>Dein Trainingsplan</h3>
              {profile.training_plan.map((t) => (
                <div class="insight mid" key={t.title}>
                  <div class="t">
                    {t.priority}. {t.title}
                  </div>
                  <div class="small muted">{t.reason}</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                    {t.steps.map((s) => (
                      <li class="small training-step" key={s}>
                        {s}
                      </li>
                    ))}
                  </ul>
                  <Examples refs={t.examples} />
                </div>
              ))}
              {profile.puzzles.length > 0 && (
                <button class="btn primary" onClick={() => navigate({ view: "training" })}>
                  {profile.puzzles.length} Aufgaben aus deinen Partien lösen
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
