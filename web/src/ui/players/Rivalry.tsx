// You against one player: the face-off on top of their page, who is better
// where, how your duel has gone, where your games tip over, and how your next
// game most likely starts.
import { useState } from "preact/hooks";

import type { DuelGame, DuelInsights, HeadToHead, Matchup, MatchupRow, OpeningPreview, PreviewLine } from "../../domain/players";
import { PHASE_DE } from "../../domain/players";
import type { PlayerProfile } from "../../domain/profile";
import { useWidth } from "../charts";
import { formatDate, SPEED_DE } from "../labels";
import { navigate } from "../router";
import { Avatar, de, formatFactor, pct0, plural } from "./common";

function ratingLine(p: PlayerProfile | null): string {
  const r = p?.rating;
  return r ? `${r.rating} · ${SPEED_DE[r.speed] ?? r.speed}` : "";
}

/** The top of a player's page: you and them face to face, the score between you and the forecast. */
export function FaceOff({
  name,
  tone,
  h2h,
  matchup,
  them,
  mine,
  duel,
}: {
  name: string;
  tone: string;
  h2h: HeadToHead;
  matchup: Matchup | null;
  them: PlayerProfile;
  mine: PlayerProfile | null;
  duel: DuelInsights | null;
}) {
  const p = matchup?.prediction ?? null;
  // The same (time-control fair) accuracy as in the comparison below, raw only without one.
  const fair = matchup?.rows.find((r) => r.key === "accuracy" && r.them !== null) ?? null;
  const accThem = fair ? fair.them : them.analyzed_games ? them.overview.avg_accuracy : null;
  const accMe = fair ? fair.me : mine?.analyzed_games ? mine.overview.avg_accuracy : null;
  const lead = h2h.wins === h2h.losses ? null : h2h.wins > h2h.losses ? "me" : "them";
  const s = duel?.streak;
  // Both ratings in the same time control as the comparison below; each
  // player's own main time control only when there is no shared one (a Rapid
  // 1484 next to a Blitz 1458 compared nothing).
  const elo = p?.elo?.from === "Wertung" ? p.elo : null;
  const myRating = elo ? `${elo.me} · ${elo.speed}` : ratingLine(mine);
  const theirRating = elo ? `${elo.them} · ${elo.speed}` : ratingLine(them);
  return (
    <section class="card rv-hero span-12">
      <div class="rv-hero-row">
        <div class={`rv-side${lead === "me" ? " lead" : ""}`}>
          <Avatar name="Du" tone="tone-me" size="xl" ring={lead === "me"} />
          <strong>Du</strong>
          <span class="faint small">{myRating}</span>
        </div>
        <div class="rv-score">
          {h2h.games ? (
            <>
              <div class="rv-big tnum" aria-label={`${h2h.wins} Siege, ${h2h.draws} Remis, ${h2h.losses} Niederlagen`}>
                <span class={lead === "me" ? "on" : ""}>{h2h.wins}</span>
                <span class="faint">:</span>
                <span class={lead === "them" ? "on" : ""}>{h2h.losses}</span>
              </div>
              <span class="faint small">
                {plural(h2h.games, "Partie", "Partien")}
                {h2h.draws ? ` · ${h2h.draws} Remis` : ""} · du holst {pct0(h2h.score_pct)}
              </span>
            </>
          ) : (
            <>
              <div class="rv-big tnum faint">– : –</div>
              <span class="faint small">Ihr habt noch nicht gegeneinander gespielt</span>
            </>
          )}
          {s && (
            <span class={`rv-streak ${s.who}`}>
              {s.who === "me" ? `Du hast die letzten ${s.count} gewonnen` : `${name} hat die letzten ${s.count} gewonnen`}
            </span>
          )}
        </div>
        <div class={`rv-side${lead === "them" ? " lead" : ""}`}>
          <Avatar name={name} tone={tone} size="xl" ring={lead === "them"} />
          <strong>{name}</strong>
          <span class="faint small">{theirRating}</span>
        </div>
      </div>
      {p && (
        <div class="rv-forecast">
          <div class="rv-forecast-head">
            <span class="kpi-label">Prognose für eure nächste Partie</span>
            <span>
              <strong class="tnum">{pct0(p.pct)}</strong> <span class="muted small">der Punkte für dich</span>
            </span>
          </div>
          <div class="rv-forecast-bar" role="img" aria-label={`Prognose ${Math.round(p.pct)} Prozent für dich, wahrscheinlich ${Math.round(p.low)} bis ${Math.round(p.high)} Prozent`}>
            <span class="rv-fc-me tone-me" style={{ width: `${p.pct}%` }} />
            <span class={`rv-fc-them ${tone}`} />
            <span class="rv-fc-band" style={{ left: `${p.low}%`, width: `${Math.max(1, p.high - p.low)}%` }} />
            <span class="rv-fc-mid" />
          </div>
          <div class="rv-forecast-labels faint small">
            <span>Du</span>
            <span>
              wahrscheinlich {Math.round(p.low)}–{Math.round(p.high)} %
            </span>
            <span>{name}</span>
          </div>
          <p class="faint small" style={{ margin: "6px 0 0" }}>
            {p.basis}
            {p.elo_pct !== null ? ` Nach Wertung wären es ${pct0(p.elo_pct)}; die zählt aber nicht, weil neue oder selten genutzte Konten oft weit danebenliegen.` : ""}
          </p>
        </div>
      )}
      <div class="rv-hero-stats">
        <div>
          <span class="kpi-label">Bilanz von {name}</span>
          <strong class="tnum">{pct0(them.overview.score_pct)}</strong>
          <span class="faint small">aus {plural(them.total_games, "Partie", "Partien")}</span>
        </div>
        <div title={fair ? "nach Bedenkzeit bereinigt, wie im Vergleich darunter" : undefined}>
          <span class="kpi-label">Genauigkeit</span>
          <strong class="tnum">{accThem === null ? "–" : `${de(accThem, 1)} %`}</strong>
          <span class="faint small">{accThem === null ? "noch nichts analysiert" : accMe === null ? "" : `du ${de(accMe, 1)} %`}</span>
        </div>
        <div>
          <span class="kpi-label">Analysiert</span>
          <strong class="tnum">{them.analyzed_games}</strong>
          <span class="faint small">von {plural(them.total_games, "Partie", "Partien")}</span>
        </div>
      </div>
    </section>
  );
}

function rowValue(key: string, v: number | null): string {
  if (v === null) return "–";
  if (key === "accuracy") return `${de(v, 1)} %`;
  return formatFactor(key, v);
}

function verdict(r: MatchupRow, name: string): { text: string; cls: string } {
  if (r.key === "rating") return { text: "nur Info", cls: "" };
  if (r.p_me === null) return { text: "zu wenig Daten", cls: "" };
  if (r.edge === "me") return { text: r.sure ? "klar du" : "eher du", cls: "me" };
  if (r.edge === "them") return { text: r.sure ? `klar ${name}` : `eher ${name}`, cls: "them" };
  return { text: "offen", cls: "" };
}

/** Who is better where, row by row, with how sure that is. */
export function TaleOfTape({ name, tone, matchup }: { name: string; tone: string; matchup: Matchup }) {
  const rows = matchup.rows.filter((r) => r.p_me !== null);
  const missing = matchup.rows.filter((r) => r.p_me === null).length;
  return (
    <section class="card tile span-12 rv-tape">
      <div class="tile-head">
        <h3>Wer ist wo besser?</h3>
        <span class="tile-sub">{rows.length ? `du vorn: ${matchup.ahead} · ${name} vorn: ${matchup.behind} · offen: ${matchup.even}` : "Vergleich"}</span>
      </div>
      {rows.length ? (
        <div class="rv-tape-rows">
          {rows.map((r) => {
            const v = verdict(r, name);
            const pMe = (r.p_me as number) * 100;
            return (
              <div class="rv-tape-row" key={r.key} title={`Wahrscheinlichkeit, dass du hier besser bist: ${Math.round(pMe)} %`}>
                <span class={`rv-val tnum${r.edge === "me" ? " lead" : ""}`}>{rowValue(r.key, r.me)}</span>
                <span class="rv-mid">
                  <span class="rv-label">
                    <span>{r.label}</span>
                    <span class={`rv-verdict ${v.cls} ${v.cls === "them" ? tone : ""}`}>{v.text}</span>
                  </span>
                  {r.key !== "rating" && (
                    <span class="lg-tug">
                      <span class="lg-tug-a tone-me" style={{ width: `${pMe}%` }} />
                      <span class={`lg-tug-b ${tone}`} />
                    </span>
                  )}
                </span>
                <span class={`rv-val them tnum${r.edge === "them" ? " lead" : ""}`}>{rowValue(r.key, r.them)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p class="muted small">Analysiere Partien von dir und {name} (je mindestens 5), dann vergleicht die App Genauigkeit, Patzer und Fähigkeiten.</p>
      )}
      {rows.length > 0 && (
        <p class="faint small tile-foot">
          Links du, rechts {name}. Balken: Wahrscheinlichkeit, wer hier wirklich besser ist, „klar“ ab 95 %.{missing ? ` ${plural(missing, "Wert", "Werte")} ohne genug Daten.` : ""}
          {matchup.notes.length ? ` ${matchup.notes.join(" ")}` : ""}
        </p>
      )}
    </section>
  );
}

const RESULT: Record<number, { cls: string; ch: string }> = { 1: { cls: "win", ch: "S" }, 0.5: { cls: "draw", ch: "R" }, 0: { cls: "loss", ch: "N" } };

/** The duel over time: the running balance and the latest games. */
const STORY_GAMES = 6;

export function DuelStory({ name, duel }: { name: string; duel: DuelInsights }) {
  const [ref, w] = useWidth<HTMLDivElement>(520);
  const [all, setAll] = useState(false);
  const games = duel.games;
  if (!games.length) return null;
  const h = 150;
  const pad = { l: 30, r: 10, t: 12, b: 12 };
  const lo = Math.min(0, ...duel.balance);
  const hi = Math.max(0, ...duel.balance);
  const span = Math.max(2, hi - lo);
  const sx = (i: number) => pad.l + (games.length === 1 ? 0.5 : i / (games.length - 1)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (v - lo) / span) * (h - pad.t - pad.b);
  let d = `M${sx(0).toFixed(1)},${sy(0).toFixed(1)}`;
  duel.balance.forEach((v, i) => {
    d += `L${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
  });
  const area = `${d}L${sx(games.length - 1).toFixed(1)},${sy(0).toFixed(1)}Z`;
  const newest = [...games].reverse();
  const last = all ? newest : newest.slice(0, STORY_GAMES);
  const now = duel.balance[duel.balance.length - 1];
  return (
    <section class="card tile span-7 rv-story">
      <div class="tile-head">
        <h3>Euer Duell-Verlauf</h3>
        <span class="tile-sub">{now === 0 ? "ausgeglichen" : now > 0 ? `du ${now} Siege vorn` : `${name} ${-now} Siege vorn`}</span>
      </div>
      <div ref={ref} class="rv-story-plot">
        <svg width={w} height={h} role="img" aria-label="Siege minus Niederlagen nach jeder Partie">
          <line class="zero" x1={pad.l} x2={w - pad.r} y1={sy(0)} y2={sy(0)} />
          <text class="axis" x={pad.l - 6} y={sy(hi) + 4} text-anchor="end">
            {hi > 0 ? `+${hi}` : hi}
          </text>
          {lo < 0 && (
            <text class="axis" x={pad.l - 6} y={sy(lo) + 4} text-anchor="end">
              {lo}
            </text>
          )}
          <path class="area" d={area} />
          <path class="line" d={d} />
          {games.map((g, i) => (
            <circle key={g.id || i} class={`dot ${RESULT[g.score]?.cls ?? "draw"}`} cx={sx(i)} cy={sy(duel.balance[i])} r={games.length > 40 ? 2.4 : 3.6} />
          ))}
        </svg>
      </div>
      <p class="faint small" style={{ margin: "2px 0 10px" }}>
        Linie: deine Siege minus Niederlagen nach jeder Partie, von der ersten bis heute.
      </p>
      <div class="rv-games">
        {last.map((g) => (
          <DuelGameRow key={g.id} g={g} name={name} />
        ))}
      </div>
      {newest.length > STORY_GAMES && (
        <button class="btn ghost small tile-foot-btn" onClick={() => setAll(!all)}>
          {all ? "Weniger zeigen" : `Alle ${newest.length} Partien zeigen`}
        </button>
      )}
    </section>
  );
}

function DuelGameRow({ g, name }: { g: DuelGame; name: string }) {
  const r = RESULT[g.score] ?? RESULT[0.5];
  return (
    <button class="rv-game" onClick={() => g.id && navigate({ view: "analysis", gameId: g.id })}>
      <span class={`op-result ${r.cls}`}>{r.ch}</span>
      <span class="rv-game-main">
        <span>
          {g.color === "white" ? "Du mit Weiß" : "Du mit Schwarz"}
          {g.opening && <span class="faint"> · {g.opening.split(":")[0]}</span>}
        </span>
        <span class="faint small">
          {formatDate(g.date)}
          {g.speed ? ` · ${SPEED_DE[g.speed] ?? g.speed}` : ""}
          {g.decisive ? ` · kippte im Zug ${g.decisive.move} (${PHASE_DE[g.decisive.phase]})` : ""}
        </span>
      </span>
      {g.my_acc !== null && (
        <span class="rv-game-acc tnum small" title={`Genauigkeit: du ${de(g.my_acc, 1)} %, ${name} ${g.their_acc === null ? "–" : `${de(g.their_acc, 1)} %`}`}>
          {Math.round(g.my_acc)}
          <span class="faint"> : </span>
          {g.their_acc === null ? "–" : Math.round(g.their_acc)}
        </span>
      )}
    </button>
  );
}

/** Where your games tip over: the phase of the deciding error, who errs first, and how both play against each other. */
export function TippingCard({ name, tone, duel }: { name: string; tone: string; duel: DuelInsights }) {
  const decisive = duel.decisive;
  const max = Math.max(1, ...decisive.flatMap((d) => [d.me, d.them]));
  const fe = duel.first_error;
  const feTotal = fe.me + fe.them;
  const a = duel.accuracy;
  const decided = decisive.reduce((s, d) => s + d.me + d.them, 0);
  return (
    <section class="card tile span-5 rv-tip">
      <div class="tile-head">
        <h3>Wo eure Partien kippen</h3>
        <span class="tile-sub">{plural(duel.analyzed, "analysierte Partie", "analysierte Partien")}</span>
      </div>
      {decided ? (
        <div class="rv-phases">
          <div class="rv-phase-head faint small">
            <span>dein Patzer entschied</span>
            <span />
            <span>Patzer von {name}</span>
          </div>
          {decisive.map((d) => (
            <div class="rv-phase" key={d.phase}>
              <span class="rv-phase-bar left">
                <span class="tone-me" style={{ width: `${(d.me / max) * 100}%` }} />
                <b class="tnum">{d.me || ""}</b>
              </span>
              <span class="rv-phase-label">{PHASE_DE[d.phase]}</span>
              <span class="rv-phase-bar right">
                <span class={tone} style={{ width: `${(d.them / max) * 100}%` }} />
                <b class="tnum">{d.them || ""}</b>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p class="muted small">Sobald entschiedene Partien zwischen euch analysiert sind, siehst du hier, in welcher Phase sie kippen.</p>
      )}
      {feTotal > 0 && (
        <div class="rv-first">
          <span class="small">Den ersten groben Fehler macht</span>
          <div class="lg-tug">
            <span class="lg-tug-a tone-me" style={{ width: `${(fe.me / feTotal) * 100}%` }} />
            <span class={`lg-tug-b ${tone}`} />
          </div>
          <span class="faint small tnum">
            du {fe.me}× · {name} {fe.them}×
          </span>
        </div>
      )}
      {a.mine !== null && (
        <div class="rv-acc small">
          <span>
            Du: <strong class="tnum">{de(a.mine, 1)} %</strong> gegen {name}
            {a.my_usual !== null ? <span class="faint"> (sonst {de(a.my_usual, 1)} %)</span> : null}
          </span>
          {a.theirs !== null && (
            <span>
              {name}: <strong class="tnum">{de(a.theirs, 1)} %</strong> gegen dich
              {a.their_usual !== null ? <span class="faint"> (sonst {de(a.their_usual, 1)} %)</span> : null}
            </span>
          )}
        </div>
      )}
      {duel.facts.length > 0 && (
        <div class="insights" style={{ marginTop: "10px" }}>
          {duel.facts.map((f) => (
            <div class="insight mid" key={f}>
              <div class="small">{f}</div>
            </div>
          ))}
        </div>
      )}
      <p class="faint small tile-foot">Entscheidend ist der Zug, nach dem der Verlierer nie mehr ausgleichen konnte. Sätze erscheinen erst ab 8 Fällen und 95 % Sicherheit.</p>
    </section>
  );
}

function PreviewRow({ l, name, mine }: { l: PreviewLine; name: string; mine: "white" | "black" }) {
  const myMove = mine === "white" ? l.first : l.reply;
  const line = `1. ${l.first} ${l.reply}`;
  return (
    <div class={`rv-line${l.edge ? ` edge-${l.edge}` : ""}`}>
      <span class="rv-line-top">
        <strong class="rv-moves">{line}</strong>
        <span class="pill tnum">{pct0(l.chance * 100)}</span>
      </span>
      {l.name && <span class="small">{l.name}</span>}
      <span class="faint small">
        Du {l.mine ? `${pct0(l.mine.score_pct)} aus ${l.mine.games}` : "noch nie"} · {name} {l.theirs ? `${pct0(l.theirs.score_pct)} aus ${l.theirs.games}` : "noch nie"}
      </span>
      {l.edge && <span class={`pill ${l.edge === "me" ? "win" : "loss"}`}>{l.edge === "me" ? `liegt dir (${myMove})` : `liegt ${name}`}</span>}
    </div>
  );
}

/** How your next game most likely starts, with both records in those lines. */
export function NextGameCard({ name, preview }: { name: string; preview: OpeningPreview }) {
  if (!preview.as_white.length && !preview.as_black.length) return null;
  return (
    <section class="card tile span-12 rv-next">
      <div class="tile-head">
        <h3>So beginnt eure nächste Partie wahrscheinlich</h3>
        <span class="tile-sub">aus euren Eröffnungen gegen alle</span>
      </div>
      <div class="rv-next-cols">
        {(["white", "black"] as const).map((c) => {
          const lines = c === "white" ? preview.as_white : preview.as_black;
          return (
            <div key={c}>
              <h4>{c === "white" ? "Du mit Weiß" : "Du mit Schwarz"}</h4>
              {lines.length ? (
                lines.map((l) => <PreviewRow key={`${l.first}${l.reply}`} l={l} name={name} mine={c} />)
              ) : (
                <p class="muted small">Zu wenige Partien für eine Vorschau.</p>
              )}
            </div>
          );
        })}
      </div>
      <p class="faint small tile-foot">Prozent: wie oft eure Partie so beginnt, wenn ihr beide spielt wie sonst. „Liegt dir“ nur, wenn eine Bilanz ab 8 Partien klar von 50 % abweicht.</p>
    </section>
  );
}

