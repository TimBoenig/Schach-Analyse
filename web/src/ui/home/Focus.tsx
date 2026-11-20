// "Deine Baustellen": the three weakest areas of the period, each with how it
// moved against the period before and one tap into the matching exercises.
import type { PeriodComparison, PlayerProfile } from "../../domain/profile";
import { CATEGORIES, CATEGORY_ORDER, type Category, type Exercise } from "../../domain/training";
import { IconPlay } from "../icons";
import { InsightText } from "../kit";
import { navigate } from "../router";
import { Delta } from "../viz/Range";
import { t } from "../../i18n";

/** The exercise area that trains a skill, if the pool holds exercises for it. */
export function skillCategory(skill: string, pool: Exercise[]): Category | undefined {
  return CATEGORY_ORDER.find((c) => CATEGORIES[c].skills.includes(skill) && pool.some((e) => e.category === c));
}

export function FocusCard({ current, cmp, label }: { current: PlayerProfile; cmp: PeriodComparison; label: string }) {
  const focus = current.weaknesses.slice(0, 3);
  return (
    <section class="card span-5 hm-focus">
      <header class="card-head">
        <div>
          <h3>{t("Deine Baustellen")}</h3>
          <p class="card-sub">{t("Was dich gerade am meisten kostet ·")} {label}</p>
        </div>
      </header>
      {focus.length ? (
        <ol class="hm-focus-list">
          {focus.map((w, i) => {
            const change = cmp.skills.find((s) => s.key === w.key);
            const cat = skillCategory(w.key, current.exercises);
            return (
              <li key={w.key}>
                <span class="hm-focus-n tnum">{i + 1}</span>
                <div class="hm-focus-body">
                  <div class="hm-focus-head">
                    <strong>{w.title}</strong>
                    {change?.delta !== null && change?.delta !== undefined && <Delta value={Math.round(change.delta)} />}
                  </div>
                  <div class="hm-focus-text">
                    <InsightText text={w.text} />
                  </div>
                  {cat && (
                    <button class="btn small ghost" onClick={() => navigate({ view: "training", tab: "uebungen", category: cat })}>
                      <IconPlay /> {CATEGORIES[cat].label}  {t("üben")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p class="muted small">
          {current.analyzed_games ? t("Keine klare Schwäche in diesem Zeitraum.") : t("Analysiere Partien aus diesem Zeitraum, dann erscheinen hier deine Baustellen.")}
        </p>
      )}
    </section>
  );
}
