// What the games show beyond the numbers: strengths and weaknesses that hold
// up over many games, the playing style on its axes, and patterns that keep
// coming back, each with the games that show it.
import { useState } from "preact/hooks";

import { STYLE_MIN_GAMES, type GameRef, type Insight, type Pattern, type PlayerProfile, type StyleAxis } from "../../domain/profile";
import { InsightText } from "../kit";
import { navigate } from "../router";
import { t } from "../../i18n";

export function Examples({ refs }: { refs: GameRef[] }) {
  if (!refs.length) return null;
  return (
    <div class="examples">
      {refs.slice(0, 3).map((r) => (
        <button key={`${r.game_id}-${r.ply_index}`} class="pill accent" onClick={() => navigate({ view: "analysis", gameId: r.game_id, ply: r.ply_index + 1 })}>
          {r.label || t("Beispiel ansehen")}
        </button>
      ))}
    </div>
  );
}

function FindingList({ items, tone, empty }: { items: Insight[]; tone: "pos" | "neg"; empty: string }) {
  if (!items.length) return <p class="muted small">{empty}</p>;
  return (
    <ul class="fd-list">
      {items.map((s) => (
        <li class={`fd-item ${tone}`} key={s.key}>
          <span class="fd-mark" aria-hidden="true" />
          <div>
            <strong>{s.title}</strong>
            <InsightText text={s.text} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StrengthsCard({ profile }: { profile: PlayerProfile }) {
  return (
    <section class="card span-12 fd" id="s-staerken">
      <div class="fd-cols">
        <div>
          <h3 class="fd-title pos">{t("Stärken")}</h3>
          <FindingList items={profile.strengths} tone="pos" empty={t("Noch keine belastbaren Stärken. Genannt wird nur, was viele Partien klar zeigen.")} />
        </div>
        <div>
          <h3 class="fd-title neg">{t("Schwächen")}</h3>
          <FindingList items={profile.weaknesses} tone="neg" empty={t("Keine belastbaren Schwächen. Genannt wird nur, was viele Partien klar zeigen.")} />
        </div>
      </div>
    </section>
  );
}

/** Style axes as dots on a track with their ± band. */
export function StyleAxes({ axes }: { axes: StyleAxis[] }) {
  return (
    <div class="axes">
      {axes.map((a) => (
        <div class="axis" key={a.key} title={a.margin ? t("{name}: ±{margin} Punkte Unsicherheit", { name: a.name, margin: a.margin }) : a.name}>
          <span class={`axis-end${a.value < 45 ? " on" : ""}`}>{a.low_label}</span>
          <div class="axis-track">
            {a.margin ? <span class="axis-band" style={{ left: `${Math.max(0, a.value - a.margin)}%`, right: `${Math.max(0, 100 - a.value - a.margin)}%` }} /> : null}
            <span class="axis-dot" style={{ left: `${a.value}%` }} />
          </div>
          <span class={`axis-end right${a.value > 55 ? " on" : ""}`}>{a.high_label}</span>
        </div>
      ))}
    </div>
  );
}

// The first patterns are the strongest; the rest wait behind one tap so the
// card stays as tall as the style next to it.
const PATTERNS_SHOWN = 3;

function PatternList({ patterns }: { patterns: Pattern[] }) {
  const [all, setAll] = useState(false);
  if (!patterns.length) return <p class="muted small">{t("Noch keine Muster gefunden. Ein Muster wird erst genannt, wenn genug Partien es zeigen und es kein Zufall sein kann.")}</p>;
  const shown = all ? patterns : patterns.slice(0, PATTERNS_SHOWN);
  return (
    <>
    <ul class="fd-list">
      {shown.map((p) => (
        <li class={`fd-item ${p.severity === "positiv" ? "pos" : p.severity === "hoch" ? "neg" : "mid"}`} key={p.key}>
          <span class="fd-mark" aria-hidden="true" />
          <div>
            <strong>{p.title}</strong>
            <InsightText text={p.text} />
            <Examples refs={p.examples} />
          </div>
        </li>
      ))}
    </ul>
    {patterns.length > PATTERNS_SHOWN && (
      <button class="btn small ghost fd-more" onClick={() => setAll(!all)} aria-expanded={all}>
        {all ? t("Weniger zeigen") : t("{0} weitere Muster zeigen", { 0: patterns.length - PATTERNS_SHOWN })}
      </button>
    )}
    </>
  );
}

export function StyleCard({ profile }: { profile: PlayerProfile }) {
  const style = profile.style;
  return (
    <section class="card span-12 fd" id="s-stil">
      <div class="fd-cols">
        <div>
          <h3 class="fd-title">{style ? t("Spielstil: {label}", { label: style.label }) : t("Spielstil")}</h3>
          {style ? (
            <>
              <StyleAxes axes={style.axes} />
              {style.facts.length > 0 && (
                <ul class="facts">
                  {style.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p class="muted small">{t("Der Spielstil erscheint ab {STYLE_MIN_GAMES} analysierten Partien.", { STYLE_MIN_GAMES })}</p>
          )}
        </div>
        <div>
          <h3 class="fd-title">{t("Wiederkehrende Muster")}</h3>
          <PatternList patterns={profile.patterns} />
        </div>
      </div>
    </section>
  );
}
