// Daily training plan: splits the player's chosen training time across the
// exercise categories that fix their biggest weaknesses, repeats exercises
// that are due again, keeps one strength sharp and adds a few tasks for the
// next real games. The plan is deterministic for a given day and input.

import type { Pattern, SkillScore } from "../profile/models";
import { CATEGORIES, CATEGORY_ORDER, type Category, type Exercise } from "./exercises";
import { isDue, isMastered, type ProgressMap } from "./progress";

export interface TrainingPrefs {
  /** Training time per day in minutes. */
  minutes: number;
  /** "auto" = follow the profile, otherwise this category gets priority. */
  focus: Category | "auto";
}

export const DEFAULT_PREFS: TrainingPrefs = { minutes: 20, focus: "auto" };
export const MINUTE_CHOICES = [10, 20, 30, 45, 60];

/** Rough time per exercise, used to fill the daily budget. */
export const EXERCISE_MINUTES: Record<Exercise["kind"], number> = { puzzle: 1.5, repertoire: 3, playout: 6 };

export interface PlanBlock {
  key: string;
  category: Category | "review";
  title: string;
  reason: string;
  minutes: number;
  exercise_ids: string[];
}

export interface DailyPlan {
  date: string;
  minutes: number;
  focus: TrainingPrefs["focus"];
  headline: string;
  blocks: PlanBlock[];
  /** Things to do in the next real games (no exercises). */
  tips: string[];
}

export interface PlanInput {
  skills: SkillScore[];
  patterns: Pattern[];
  pool: Exercise[];
  progress: ProgressMap;
  prefs: TrainingPrefs;
  today: string;
}

// Patterns that make a category more urgent than the skill score alone says.
const PATTERN_CATEGORY: Record<string, Category> = {
  hasty_errors: "blunder",
  errors_when_winning: "conversion",
  post_book_errors: "repertoire",
  missed_punish: "chance",
  time_trouble_errors: "blunder",
  hung_piece_type: "blunder",
  errors_under_pressure: "defense",
};

const PATTERN_TIPS: Record<string, string> = {
  tilt: "Nach einer Niederlage heute erst 10 Minuten Pause, bevor du die nächste Partie startest.",
  fatigue: "Spiele heute höchstens drei gewertete Partien am Stück.",
  hasty_errors: "Bevor du in deiner nächsten Partie ziehst: Schachs, Schläge, Drohungen prüfen – jedes Mal.",
  errors_when_winning: "Wenn du heute besser stehst: erst das Gegenspiel stoppen, dann gewinnen.",
  post_book_errors: "Überlege nach dem letzten Theoriezug deiner nächsten Partie bewusst einen Plan.",
  missed_punish: "Frage dich nach jedem gegnerischen Zug: Was hat sich geändert, hängt etwas?",
  time_trouble_errors: "Behalte in deiner nächsten Partie nach Zug 20 mindestens die Hälfte deiner Bedenkzeit.",
  weaker_opponents: "Nimm auch schwächere Gegner ernst: gleicher Blunder-Check wie gegen Stärkere.",
  king_safety: "Rochiere in deiner nächsten Partie früh und ziehe die Bauern vor deinem König nur mit Grund.",
};

const SKILL_TIPS: Record<string, string> = {
  time: "Spiele heute eine Partie mit mindestens 10+5 und nimm dir in kritischen Momenten bewusst Zeit.",
  consistency: "Spiele nur ausgeruht und ohne Ablenkung – lieber eine Partie weniger.",
};

// Share of the time reserved for due repetitions and for the strength block.
const REVIEW_SHARE = 0.3;
const STRENGTH_SHARE = 0.15;
// Skills the profile could not rate yet count as moderately weak.
const UNKNOWN_NEED = 0.35;

/** Deterministic pseudo-random number generator (mulberry32) seeded by a string. */
function rng(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h ^ (h >>> 13)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: string): T[] {
  const r = rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface CategoryNeed {
  category: Category;
  /** 0 (strong) .. ~2 (urgent). */
  need: number;
  reason: string;
}

/** How urgently each category should be trained, with a German reason. */
export function categoryNeeds(skills: SkillScore[], patterns: Pattern[], focus: TrainingPrefs["focus"]): CategoryNeed[] {
  const byKey = new Map(skills.map((s) => [s.key, s]));
  return CATEGORY_ORDER.map((category) => {
    const reasons: string[] = [];
    let need = 0;
    const rated = CATEGORIES[category].skills.map((k) => byKey.get(k)).filter((s): s is SkillScore => Boolean(s && s.sample > 0));
    if (rated.length) {
      for (const s of rated) {
        let n = ((100 - s.score) / 100) * (s.reliable ? 1 : 0.6);
        // Below what is typical at the player's rating weighs extra.
        if (s.typical !== null && s.typical !== undefined && s.score < s.typical) n += (s.typical - s.score) / 100;
        need += n / rated.length;
        reasons.push(`${s.name} ${Math.round(s.score)}/100${s.typical !== null && s.typical !== undefined ? ` (typisch ${Math.round(s.typical)})` : ""}`);
      }
    } else {
      need = UNKNOWN_NEED;
    }
    for (const p of patterns) {
      if (PATTERN_CATEGORY[p.key] !== category) continue;
      if (p.severity === "hoch") need += 0.3;
      else if (p.severity === "mittel") need += 0.15;
      else continue;
      reasons.push(`Muster „${p.title}“`);
    }
    if (focus === category) {
      need += 1;
      reasons.unshift("Dein gewählter Schwerpunkt");
    }
    return { category, need: Math.round(need * 1000) / 1000, reason: reasons.join(" · ") };
  }).sort((a, b) => b.need - a.need);
}

function count(minutes: number, kind: Exercise["kind"]): number {
  return Math.max(1, Math.floor(minutes / EXERCISE_MINUTES[kind] + 0.25));
}

function minutesOf(pool: Map<string, Exercise>, ids: string[]): number {
  return Math.round(ids.reduce((s, id) => s + EXERCISE_MINUTES[pool.get(id)?.kind ?? "puzzle"], 0));
}

export function buildDailyPlan({ skills, patterns, pool, progress, prefs, today }: PlanInput): DailyPlan {
  const byId = new Map(pool.map((e) => [e.id, e]));
  const used = new Set<string>();
  const blocks: PlanBlock[] = [];
  let budget = prefs.minutes;

  // 1) Repetition first: exercises that are due again, oldest first.
  const due = pool
    .filter((e) => isDue(progress[e.id], today))
    .sort((a, b) => progress[a.id].due.localeCompare(progress[b.id].due) || progress[a.id].box - progress[b.id].box);
  if (due.length) {
    const ids: string[] = [];
    let spent = 0;
    for (const e of due) {
      if (spent + EXERCISE_MINUTES[e.kind] > Math.max(prefs.minutes * REVIEW_SHARE, EXERCISE_MINUTES[e.kind])) break;
      ids.push(e.id);
      used.add(e.id);
      spent += EXERCISE_MINUTES[e.kind];
    }
    blocks.push({
      key: "review",
      category: "review",
      title: "Wiederholung",
      reason: `${due.length} ${due.length === 1 ? "Übung ist" : "Übungen sind"} wieder fällig. Wiederholen festigt, was du schon gelöst hast.`,
      minutes: minutesOf(byId, ids),
      exercise_ids: ids,
    });
    budget -= minutesOf(byId, ids);
  }

  const fresh = (category: Category) =>
    shuffled(
      pool.filter((e) => e.category === category && !used.has(e.id) && !isMastered(progress[e.id]) && !isDue(progress[e.id], today)),
      `${today}:${category}`,
    ).sort((a, b) => (progress[a.id]?.attempts ?? 0) - (progress[b.id]?.attempts ?? 0));

  const needs = categoryNeeds(skills, patterns, prefs.focus).filter((n) => fresh(n.category).length > 0);
  const strength = prefs.minutes >= 20 && needs.length > 2 ? needs[needs.length - 1] : null;
  const strengthMinutes = strength ? Math.max(3, Math.round(prefs.minutes * STRENGTH_SHARE)) : 0;
  const focusCount = prefs.minutes <= 10 ? 1 : prefs.minutes <= 30 ? 2 : 3;
  const focus = needs.filter((n) => n !== strength).slice(0, focusCount);
  const totalNeed = focus.reduce((s, n) => s + Math.max(n.need, 0.05), 0);
  const focusBudget = Math.max(budget - strengthMinutes, focus.length ? 3 : 0);

  const addBlock = (n: CategoryNeed, minutes: number, title: string, reason: string) => {
    const ids: string[] = [];
    let spent = 0;
    for (const e of fresh(n.category)) {
      if (ids.length && spent + EXERCISE_MINUTES[e.kind] > minutes + 0.5) continue;
      ids.push(e.id);
      used.add(e.id);
      spent += EXERCISE_MINUTES[e.kind];
      if (ids.length >= count(minutes, e.kind) && spent >= minutes - 0.5) break;
    }
    if (ids.length) blocks.push({ key: n.category, category: n.category, title, reason, minutes: minutesOf(byId, ids), exercise_ids: ids });
  };

  for (const n of focus) {
    const minutes = (focusBudget * Math.max(n.need, 0.05)) / totalNeed;
    addBlock(n, minutes, CATEGORIES[n.category].label, n.reason || CATEGORIES[n.category].text);
  }
  if (strength) {
    addBlock(
      strength,
      strengthMinutes,
      `Stärke halten: ${CATEGORIES[strength.category].label}`,
      `Hier bist du schon gut${strength.reason ? ` (${strength.reason})` : ""}. Ein paar Aufgaben halten das Niveau.`,
    );
  }

  const tips: string[] = [];
  for (const p of patterns) {
    if ((p.severity === "hoch" || p.severity === "mittel") && PATTERN_TIPS[p.key] && !tips.includes(PATTERN_TIPS[p.key])) tips.push(PATTERN_TIPS[p.key]);
  }
  for (const s of skills) {
    if (s.reliable && s.score < 50 && SKILL_TIPS[s.key]) tips.push(SKILL_TIPS[s.key]);
  }

  const main = blocks.filter((b) => b.category !== "review").slice(0, 2).map((b) => b.title.replace(/^Stärke halten: /, ""));
  const headline = main.length ? `Heute im Fokus: ${main.join(" und ")}` : "Heute: Wiederholung";
  return {
    date: today,
    minutes: prefs.minutes,
    focus: prefs.focus,
    headline,
    blocks,
    tips: tips.slice(0, 3),
  };
}

/** True when the stored plan no longer matches today or the preferences. */
export function planOutdated(plan: DailyPlan | null, prefs: TrainingPrefs, today: string): boolean {
  return !plan || plan.date !== today || plan.minutes !== prefs.minutes || plan.focus !== prefs.focus;
}
