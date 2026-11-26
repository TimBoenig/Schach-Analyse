// Arrows in a short edit: rare, and only where they mean something (at most about one scene in seven, with three scenes between two of them).
//
// An arrow on every move reads as a lesson, not as an edit: the picture is busy, and the one arrow that matters (the threat, the
// tactic, the key move) is lost between the rest. An AI script often gives every scene an arrow anyway, so the import (and the Edit
// tab's "tighten") thins them out: an arrow stays only on an important moment, never on two scenes right after each other, and never
// merely repeats the move the piece is making in that very scene anyway.
// Pure: takes a project, returns the project.
import { scenePositions, type Scene, type StudioArrow, type StudioProject } from "./model";

/** At most this share of the scenes (but at least one) keeps arrows. */
export const ARROW_SHARE = 0.15;
/** Scenes that must lie between two scenes with (different) arrows. */
export const ARROW_GAP = 3;
/** Arrows kept in one scene. */
export const ARROWS_PER_SCENE = 2;

const KEY_BADGES = new Set(["brilliant", "great", "blunder", "mistake", "miss"]);

const arrowKey = (a: StudioArrow) => `${a.from}${a.to}${a.tone}`;
const sameArrows = (a: Scene, b: Scene) => a.arrows.length === b.arrows.length && a.arrows.every((x, i) => arrowKey(x) === arrowKey(b.arrows[i]));

/** How much a moment deserves an arrow: a threat or a key move high, an ordinary move none. */
export function arrowWorth(s: Scene, index: number): number {
  let worth = 0;
  if (s.arrows.some((a) => a.tone === "bad")) worth += 3;
  if (s.effects.includes("mate")) worth += 3;
  if (s.effects.includes("threat")) worth += 2;
  if (s.stamp.trim() || s.effects.includes("hitstop") || s.effects.includes("invert")) worth += 2;
  if (KEY_BADGES.has(s.badge)) worth += 2;
  if (s.effects.includes("spotlight")) worth += 1;
  // A calm scene without a move is where a threat is pointed out.
  if (!s.moves.trim() && s.card === "none") worth += 1;
  // The hook is allowed one arrow on the target.
  if (index === 0) worth += 1;
  return worth;
}

export interface ThinResult {
  project: StudioProject;
  /** How many arrows were taken away, how many scenes keep some. */
  removed: number;
  kept: number;
}

export function thinArrows(input: StudioProject): ThinResult {
  const positions = scenePositions(input);
  // 1. An arrow that only repeats the move of its own scene is redundant: the piece flies there anyway.
  let scenes: Scene[] = input.scenes.map((s, i) => {
    const own = new Set(positions[i].parsed.moves.map((m) => `${m.from}${m.to}`));
    const arrows = s.arrows.filter((a) => !(own.has(`${a.from}${a.to}`) && a.tone !== "bad")).sort((a, b) => Number(b.tone === "bad") - Number(a.tone === "bad")).slice(0, ARROWS_PER_SCENE);
    return { ...s, arrows };
  });
  const before = input.scenes.reduce((n, s) => n + s.arrows.length, 0);
  // 2. Pick the scenes that deserve their arrows: worth first, then the earlier scene; each keeps its distance to the ones picked before.
  const withArrows = scenes.map((s, i) => ({ s, i })).filter((x) => x.s.arrows.length);
  const cap = Math.max(1, Math.ceil(scenes.length * ARROW_SHARE));
  const picked: number[] = [];
  for (const { s, i } of [...withArrows].sort((a, b) => arrowWorth(b.s, b.i) - arrowWorth(a.s, a.i) || a.i - b.i)) {
    if (arrowWorth(s, i) <= 0 || picked.length >= cap) continue;
    // The same arrows over neighbouring scenes are one continuing arrow, not a new one.
    const clash = picked.some((j) => Math.abs(j - i) <= ARROW_GAP && !(Math.abs(j - i) === 1 && sameArrows(scenes[j], s)));
    if (!clash) picked.push(i);
  }
  scenes = scenes.map((s, i) => (picked.includes(i) || !s.arrows.length ? s : { ...s, arrows: [] }));
  const after = scenes.reduce((n, s) => n + s.arrows.length, 0);
  return { project: after === before ? input : { ...input, scenes }, removed: before - after, kept: picked.length };
}
