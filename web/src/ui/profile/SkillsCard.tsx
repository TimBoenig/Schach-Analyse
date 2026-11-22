// Every skill in one table: the score from 0 to 100 as a bar with the
// reference tick, the grade in words, and for the parts of the game that can
// be read as playing strength the estimated Elo. A row opens to its evidence
// and the exercise that trains it. The web on the left shows the shape.
import { useState } from "preact/hooks";

import { ELO_SCALE_LABEL, MIN_STRENGTH_GAMES, STRENGTH_MAX, STRENGTH_MIN, typicalLabel, type PlayerProfile, type SkillScore } from "../../domain/profile";
import type { SkillStrength } from "../../domain/profile/strength";
import { CATEGORIES, CATEGORY_ORDER, type Category, type Exercise } from "../../domain/training";
import { IconChevron, IconPlay } from "../icons";
import { Foot } from "../kit";
import { navigate } from "../router";
import { Level } from "../viz/Bars";
import { Radar } from "../viz/Radar";
import { t, tj } from "../../i18n";

/** Short axis names for the web; the full names stand in the table. */
export const SKILL_SHORT: Record<string, string> = {
  opening: t("Eröffnung"),
  middlegame: t("Mittelspiel"),
  endgame: t("Endspiel"),
  tactics: t("Taktik"),
  safety: t("Sicherheit"),
  conversion: t("Verwertung"),
  defense: t("Verteidigung"),
  time: t("Zeit"),
  consistency: t("Konstanz"),
};

/** First exercise category training this skill that has exercises. */
export function skillCategory(skill: string, pool: Exercise[]): Category | undefined {
  if (!skill) return undefined;
  return CATEGORY_ORDER.find((c) => CATEGORIES[c].skills.includes(skill) && pool.some((e) => e.category === c));
}

/** "1250", "unter 100", "über 3000". */
function eloText(r: { rating: number; capped: number }): string {
  return r.capped > 0 ? t("über {STRENGTH_MAX}", { STRENGTH_MAX }) : r.capped < 0 ? t("unter {STRENGTH_MIN}", { STRENGTH_MIN }) : String(r.rating);
}

/** "18 % weniger Fehler" / "25 % mehr Fehler" / "etwa gleich viele Fehler". */
function ratioText(ratio: number): string {
  const d = Math.round((ratio - 1) * 100);
  if (Math.abs(d) < 5) return t("etwa gleich viele Fehler");
  return d < 0 ? t("{0} % weniger Fehler", { 0: -d }) : t("{d} % mehr Fehler", { d });
}

type Verdict = { tone: "good" | "bad" | "accent"; text: string; diff: number | null };

// Closer than this to the reference counts as "about the same"; a wider
// margin of the score itself widens the band, so a row is only coloured when
// the difference is more than the measurement can wobble.
const SAME_BAND = 3;

/**
 * How a skill stands against the reference (the opponents of the same games,
 * or the rough value for the rating). The score itself is absolute: at 900
 * Elo everybody hangs pieces, so 18 points can still be better than the
 * opponents. The colour of a row follows this comparison, because that is
 * the part a player can act on; the absolute grade stays in the detail.
 */
function verdictOf(s: SkillScore): Verdict {
  if (!s.sample) return { tone: "accent", text: s.grade, diff: null };
  if (s.typical === null || s.typical === undefined) return { tone: s.score >= 65 ? "good" : s.score < 50 ? "bad" : "accent", text: s.grade, diff: null };
  const diff = s.score - s.typical;
  const opp = s.typical_from === "opponents";
  if (Math.abs(diff) < Math.max(SAME_BAND, s.margin ?? 0)) return { tone: "accent", text: opp ? t("wie deine Gegner") : t("am Richtwert"), diff };
  if (opp) return { tone: diff > 0 ? "good" : "bad", text: t("{0} als deine Gegner", { 0: diff > 0 ? t("stärker") : t("schwächer") }), diff };
  return { tone: diff > 0 ? "good" : "bad", text: diff > 0 ? t("über dem Richtwert") : t("unter dem Richtwert"), diff };
}

function Detail({ skill, strength, profile }: { skill: SkillScore; strength?: SkillStrength; profile: PlayerProfile }) {
  const rc = profile.rating;
  const cat = skillCategory(skill.key, profile.exercises);
  const gap = strength && rc && !strength.capped ? strength.rating - rc.elo : null;
  return (
    <div class="sk-detail">
      <p>
        {skill.detail}
        {skill.sample > 0 && (
          <>
            {" "}
            
            {tj("Auf der festen Skala sind das {x} Punkten ({grade})", { x: <strong class="tnum">{t("{n} von 100", { n: Math.round(skill.score) })}</strong>, grade: skill.grade })}{typeof skill.typical === "number" ? (
              <>
                {tj(", {n} {x}", { n: skill.typical_from === "opponents" ? t("deine Gegner kommen in denselben Partien auf") : t("üblich für deine Wertung sind"), x: <strong class="tnum">{Math.round(skill.typical)}</strong> })}
              </>
            ) : null}
            .
          </>
        )}
        {skill.raw_score !== undefined && Math.abs(skill.raw_score - skill.score) >= 3 ? t(" Gemessen wurden {0} Punkte; weil es noch wenige Daten sind, steht der Wert näher am Vergleichswert.", { 0: Math.round(skill.raw_score) }) : ""}
      </p>
      {strength && (
        <p>
          
          {tj("Als Spielstärke gelesen: etwa {x} {x2}", { x: <strong class="tnum">{t("Elo {eloText}", { eloText: eloText(strength) })}</strong>, x2: <span class="tnum">(±{strength.margin})</span> })}
          {gap !== null && Math.abs(gap) > strength.margin ? (
            <>
              
              {tj(", das sind {x} deiner eigenen Wertung", { x: <span class={`tnum ${gap > 0 ? "good" : "bad"}`}>
                {(gap > 0 ? t("{n} Punkte über", { n: Math.abs(gap) }) : t("{n} Punkte unter", { n: Math.abs(gap) }))}
              </span> })}
            </>
          ) : gap !== null ? (
            t(", im Rahmen der Unsicherheit auf deinem Niveau")
          ) : null}
          
          {t(". Du machst hier {ratioText} als deine Gegner in denselben {games} Partien.{n}", { ratioText: ratioText(strength.error_ratio), games: strength.games, n: !strength.reliable ? t(" Noch wenige Daten, der Wert kann sich deutlich bewegen.") : "" })}
        </p>
      )}
      {cat && (
        <button class="btn small" onClick={() => navigate({ view: "training", tab: "uebungen", category: cat })}>
          <IconPlay /> {t("{label} üben", { label: CATEGORIES[cat].label })}
        </button>
      )}
    </div>
  );
}

export function SkillsCard({ profile }: { profile: PlayerProfile }) {
  const [open, setOpen] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const rc = profile.rating;
  const sm = profile.strength;
  const byKey = new Map((sm?.skills ?? []).map((s) => [s.key, s]));
  const measured = profile.skills.filter((s) => s.sample > 0);
  // Best against the reference first; skills without data close the list.
  const rows = profile.skills
    .map((s) => ({ s, v: verdictOf(s) }))
    .sort((a, b) => Number(b.s.sample > 0) - Number(a.s.sample > 0) || (b.v.diff ?? -Infinity) - (a.v.diff ?? -Infinity) || b.s.score - a.s.score);
  // The sentence above the table names what the table shows first and last:
  // the clearest plus and the clearest minus against the reference.
  const top = rows.find((r) => r.v.tone === "good" && r.v.diff !== null && r.s.reliable);
  const bottom = [...rows].reverse().find((r) => r.v.tone === "bad" && r.v.diff !== null && r.s.reliable);
  const overall = sm?.overall ?? null;
  const refLabel = rc ? typicalLabel(rc) : null;
  const hasElo = byKey.size > 0;

  return (
    <section class="card span-12 sk" id="s-faehigkeiten">
      <header class="card-head">
        <div>
          <h3>{t("Fähigkeiten")}</h3>
          <p class="card-sub">
            {overall ? (
              <>
                
                {tj("Nach Zugqualität spielst du insgesamt wie etwa {x} (±{margin}).", { x: <strong class="tnum">{t("Elo {eloText}", { eloText: eloText(overall) })}</strong>, margin: overall.margin })}{" "}
              </>
            ) : null}
            {top || bottom ? (
              <>
                {top ? (
                  <>
                    
                    {tj("Dein größtes Plus: {name}.", { name: <strong>{top.s.name}</strong> })}{" "}
                  </>
                ) : null}
                {bottom ? (
                  <>
                    
                    {tj("Am meisten Luft: {name}.", { name: <strong>{bottom.s.name}</strong> })}</>
                ) : null}
              </>
            ) : measured.length ? (
              t("Kein Teil deines Spiels hebt sich klar vom Vergleichswert ab.")
            ) : profile.analyzed_games ? (
              t("Für die Einordnung als Elo braucht es mindestens {MIN_STRENGTH_GAMES} analysierte Partien mit bekannter Gegnerwertung.", { MIN_STRENGTH_GAMES })
            ) : null}
          </p>
        </div>
      </header>
      <div class="sk-body">
        {measured.length >= 3 && (
          <div class="sk-web">
            <Radar
              spokes={measured.map((s) => ({ key: s.key, label: SKILL_SHORT[s.key] ?? s.name, value: s.score, reference: s.typical, faint: !s.reliable }))}
              active={active ?? open}
              onActive={setActive}
            />
            <div class="sk-legend">
              <span>
                <i class="sk-key me" />  {t("Du")}
              </span>
              {refLabel && (
                <span>
                  <i class="sk-key ref" /> {refLabel}
                </span>
              )}
            </div>
          </div>
        )}
        <div class={`sk-table${hasElo ? " with-elo" : ""}`} role="table" aria-label={t("Fähigkeiten")}>
          <div class="sk-row sk-head" role="row">
            <span role="columnheader">{t("Fähigkeit")}</span>
            <span role="columnheader">{t("Skala 0 bis 100")}</span>
            <span role="columnheader" class="num">
              
              {t("Punkte")}
            </span>
            {hasElo && (
              <span role="columnheader" class="num" title={ELO_SCALE_LABEL}>
                
                {t("≈ Elo")}
              </span>
            )}
            <span />
          </div>
          {rows.map(({ s, v }) => {
            const st = byKey.get(s.key);
            const has = s.sample > 0;
            const isOpen = open === s.key;
            return (
              <div key={s.key} class={`sk-item${isOpen ? " open" : ""}${active === s.key ? " active" : ""}${s.reliable ? "" : " faint"}`}>
                <button class="sk-row" role="row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.key)} onPointerEnter={() => setActive(s.key)} onPointerLeave={() => setActive(null)}>
                  <span class="sk-name" role="cell">
                    {s.name}
                    <small class={has && v.tone !== "accent" ? `sk-grade ${v.tone}` : "sk-grade"}>{v.text}</small>
                  </span>
                  <span role="cell">
                    <Level value={has ? s.score : null} reference={s.typical} tone={has ? v.tone : "quiet"} faint={!s.reliable} />
                  </span>
                  <span class="num tnum sk-score" role="cell">
                    {has ? Math.round(s.score) : "–"}
                    {has && s.margin ? <small>±{s.margin}</small> : null}
                  </span>
                  {hasElo && (
                    <span class="num tnum sk-elo" role="cell">
                      {st ? eloText(st) : ""}
                      {st ? <small>±{st.margin}</small> : null}
                    </span>
                  )}
                  <span class="sk-chevron" aria-hidden="true">
                    <IconChevron />
                  </span>
                </button>
                {isOpen && <Detail skill={s} strength={st} profile={profile} />}
              </div>
            );
          })}
        </div>
      </div>
      <Foot>
        
        {t("Jede Fähigkeit ist ein Wert von 0 bis 100 aus deinen analysierten Zügen, auf einer festen Skala für alle Spielstärken. Der Strich auf dem Balken ist der Vergleichswert{n}; die Farbe zeigt, ob du darüber (grün) oder darunter (rot) liegst. Deshalb kann ein kurzer Balken grün sein: der Wert ist niedrig, aber besser als bei deinen Gegnern. Blasse Zeilen beruhen auf wenigen Daten: solche Werte gleicht die App zum Vergleichswert hin aus, statt sie auf 0 oder 100 springen zu lassen, und ± zeigt, wie genau ein Wert ist.{n2}", { n: refLabel ? ` (${refLabel})` : "", n2: hasElo ? t(" „≈ Elo“ schätzt aus deinen Fehlern im Vergleich zu denen deiner Gegner, wie stark dieser Teil deines Spiels ist ({ELO_SCALE_LABEL}).", { ELO_SCALE_LABEL }) : "" })}
      </Foot>
    </section>
  );
}
