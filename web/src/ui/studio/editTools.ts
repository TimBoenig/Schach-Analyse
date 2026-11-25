// Helpers for short TikTok/Reels/Shorts edits in the studio:
//  - tightenEdit(): turns a long edit into a short, dense one (start in the critical
//    position with a hook, squeeze the forced exchange between sacrifice and mate,
//    shrink the outro to an overlay), so it can be watched to the end and looped,
//  - hookIdeas(): curiosity hooks for the top edge of the picture, German and English,
//  - captionKit(): caption, pinned-comment question, hashtags and the export tips
//    (trending audio, language test), for either language.
// Pure and without Qt-style side effects, so it is tested without a browser.
import { t, tr, type Lang } from "../../i18n";
import { displaySan, scenePositions, type Badge, type Scene, type StudioProject } from "./model";
import { compile } from "./timeline";

/** Target length of an edit: shorter, denser clips are watched to the end and looped far more often. */
export const EDIT_TARGET_SECONDS: [number, number] = [15, 18];
/** Longest stretch between the sacrifice and the mate before viewers lose interest. */
export const MIDDLE_MAX_SECONDS = 4.5;
/** An outro of an edit: just long enough to read the name, then the video loops. */
export const OUTRO_SECONDS = 1.3;

const IMPACT_BADGES: Badge[] = ["brilliant", "great", "blunder", "mistake", "miss"];

/** The scene that carries the sacrifice, the blunder or the key blow. */
export const isImpactScene = (s: Scene): boolean => s.moves.trim() !== "" && (s.stamp.trim() !== "" || IMPACT_BADGES.includes(s.badge) || s.effects.includes("hitstop") || s.effects.includes("invert"));

export interface TightenResult {
  project: StudioProject;
  /** What was changed, in the studio's language (shown to the person). */
  changes: string[];
  /** Length of the edit afterwards. */
  seconds: number;
}

export interface TightenOptions {
  /** Language of the hook text put on the first scene. */
  lang?: Lang;
  /** Hook text for the first scene (default: the first hook stamp idea). */
  hook?: string;
  /** Leave the start alone (only squeeze the middle and the outro). */
  keepStart?: boolean;
}

const total = (p: StudioProject) => compile(p).total;

/** Half-move number text of the first move of the scene: "4. Sg5" or "4... Sf6". */
export function keyMoveLabel(project: StudioProject): { label: string; side: "white" | "black" } | null {
  const positions = scenePositions(project);
  const i = project.scenes.findIndex(isImpactScene);
  if (i < 0) return null;
  const move = positions[i].parsed.moves[0];
  if (!move) return null;
  const number = Number(positions[i].before.split(" ")[5]) || 1;
  const label = move.color === "w" ? `${number}. ${displaySan(move.san)}` : `${number}... ${displaySan(move.san)}`;
  return { label, side: move.color === "w" ? "white" : "black" };
}

/** Fewer moves in less time: runs of plain move scenes become one scene whose tempo is raised until the whole middle fits. */
function squeezeMiddle(project: StudioProject, from: number, to: number, changes: string[]): StudioProject {
  const middle = project.scenes.slice(from, to);
  if (!middle.length) return project;
  const runs: Scene[] = [];
  for (const s of middle) {
    const last = runs[runs.length - 1];
    const plain = s.moves.trim() !== "" && s.card === "none" && !s.fen.trim();
    // Consecutive scenes without a jump continue each other: their moves are one forced sequence.
    if (plain && last && last.moves.trim() && s.moves.trim()) {
      runs[runs.length - 1] = { ...s, moves: `${last.moves} ${s.moves}`, cameras: [], text: "", title: "", speech: "", fen: last.fen, effects: s.effects.filter((e) => e !== "hitstop" && e !== "slowmo"), power: s.power, label: "" };
    } else runs.push({ ...s });
  }
  const measure = (scenes: Scene[]) => {
    const p = { ...project, scenes: [...project.scenes.slice(0, from), ...scenes, ...project.scenes.slice(to)] };
    const tl = compile(p);
    return { p, middle: tl.scenes.slice(from, from + scenes.length).reduce((sum, c) => sum + c.dur, 0) };
  };
  let scenes = runs.map((s) => ({ ...s, duration: 0.6 }));
  let m = measure(scenes);
  for (let tempo = 1.5; tempo <= 5 && m.middle > MIDDLE_MAX_SECONDS; tempo += 0.5) {
    scenes = scenes.map((s) => (s.moves.trim() ? { ...s, tempo: Math.max(s.tempo, tempo) } : s));
    m = measure(scenes);
  }
  // Still too long: the quick camera cuts without a move go first.
  for (let i = scenes.length - 1; i >= 0 && m.middle > MIDDLE_MAX_SECONDS; i--) {
    if (scenes[i].moves.trim() === "" && scenes[i].card === "none") {
      scenes = scenes.filter((_, k) => k !== i);
      m = measure(scenes);
    }
  }
  changes.push(t("Mittelteil zwischen Opfer und Matt auf etwa {s} Sekunden gestrafft.", { s: Math.round(m.middle * 10) / 10 }));
  return m.p;
}

/**
 * Makes an edit short and dense: starts in the critical position with a hook,
 * squeezes the sequence between sacrifice and mate to about four seconds and
 * shrinks the outro to an overlay. A project that is already tight stays as it is.
 */
export function tightenEdit(input: StudioProject, opts: TightenOptions = {}): TightenResult {
  const lang = opts.lang ?? "de";
  const changes: string[] = [];
  let project: StudioProject = { ...input, scenes: input.scenes.map((s) => ({ ...s })) };

  // 1. Start in the critical position: the build-up moves before it are left out.
  const crit = project.scenes.findIndex(isImpactScene);
  if (!opts.keepStart && crit > 0) {
    const positions = scenePositions(project);
    // The calm build-up scene right before the blow (same position, no move) stays: it is the hook's tension.
    const k = !project.scenes[crit - 1].moves.trim() && project.scenes[crit - 1].card === "none" ? crit - 1 : crit;
    const startFen = positions[k].before;
    const scenes = project.scenes.slice(k).map((s, i) => (i === 0 ? { ...s, fen: "" } : s));
    project = { ...project, startFen, scenes };
    const label = keyMoveLabel(project);
    changes.push(label ? t("Start direkt in der kritischen Stellung ({move}), {n} Anfangsszenen gestrichen.", { move: label.label, n: k }) : t("Start direkt in der kritischen Stellung, {n} Anfangsszenen gestrichen.", { n: k }));
  }

  // 2. The first picture is the hook: a text on top, a punch-in, no longer than 1.3 s before the first cut.
  const first = project.scenes[0];
  if (first && first.card !== "outro") {
    const hook = opts.hook ?? hookStamps(lang)[0];
    const wantsHook = first.card === "none" && !first.title.trim();
    const next: Scene = { ...first, title: wantsHook ? hook : first.title, duration: Math.min(first.duration, 1.3) };
    if (!next.effects.length) next.effects = ["punch"];
    if (next.effects.includes("punch") && next.power.punch === undefined) next.power = { ...next.power, punch: 0.5 };
    if (wantsHook || !first.effects.length) changes.push(t("Hook in den ersten 1,3 Sekunden: Text oben und Punch-in."));
    project = { ...project, scenes: [next, ...project.scenes.slice(1)] };
  }

  // 3. Between sacrifice and mate at most about four seconds.
  const impact = project.scenes.findIndex(isImpactScene);
  const mate = project.scenes.findIndex((s, i) => i > impact && s.effects.includes("mate"));
  if (impact >= 0 && mate > impact + 1) {
    const before = compile(project).scenes.slice(impact + 1, mate).reduce((sum, c) => sum + c.dur, 0);
    if (before > MIDDLE_MAX_SECONDS) project = squeezeMiddle(project, impact + 1, mate, changes);
  }

  // 4. The outro is a short overlay on the shattered board: then the video loops into its start.
  const outros = project.scenes.filter((s) => s.card === "outro" && s.duration > OUTRO_SECONDS);
  if (outros.length) {
    project = { ...project, scenes: project.scenes.map((s) => (s.card === "outro" ? { ...s, duration: Math.min(s.duration, OUTRO_SECONDS) } : s)) };
    changes.push(t("Abspann auf {s} Sekunden verkürzt (Overlay statt Endbild, danach beginnt das Video von vorn).", { s: OUTRO_SECONDS }));
  }

  return { project, changes, seconds: total(project) };
}

// ---------- hooks, captions and export tips ----------

/** One-word stamps that work as the first picture's hook. */
export function hookStamps(lang: Lang): string[] {
  return [tr(lang, "TÖDLICHE FALLE"), tr(lang, "KENNST DU DIE?"), tr(lang, "NICHT SCHLAGEN!")];
}

export interface HookIdea {
  kind: "curiosity" | "question" | "challenge";
  text: string;
}

/** Curiosity hooks for the top edge of the picture: they also catch viewers who do not play chess yet. */
export function hookIdeas(lang: Lang): HookIdea[] {
  return [
    { kind: "curiosity", text: tr(lang, "Warum Schwarz diesen Bauern NIE schlagen darf 💀") },
    { kind: "curiosity", text: tr(lang, "Die fieseste Schach-Falle in 10 Zügen") },
    { kind: "challenge", text: tr(lang, "Finde den Zug, der Weiß sofort gewinnen lässt") },
    { kind: "question", text: tr(lang, "Siehst du das Matt, bevor es passiert?") },
    { kind: "question", text: tr(lang, "Kennst du diese Falle?") },
    { kind: "challenge", text: tr(lang, "Das passiert, wenn du hier schlägst 😳") },
  ];
}

export interface CaptionKit {
  /** The comment question for the caption or a pinned comment. */
  question: string;
  caption: string;
  hashtags: string;
  tips: { title: string; text: string }[];
}

/** Caption, pinned-comment question and the tips for a post, in the chosen language. */
export function captionKit(lang: Lang, key: { label: string; side: "white" | "black" } | null, hook = ""): CaptionKit {
  // The side that has to answer is the one NOT playing the key move.
  const answers = key ? (key.side === "white" ? tr(lang, "Schwarz") : tr(lang, "Weiß")) : "";
  const question = key
    ? tr(lang, "Wie verteidigst du dich als {side} nach {move}? 👇", { side: answers, move: key.label })
    : tr(lang, "Hättest du die Falle gesehen? Schreib deinen Zug in die Kommentare 👇");
  const hashtags = tr(lang, "#schach #schachfalle #chess #chesstrap #chesstok #sacrifice #checkmate");
  const caption = [hook.trim(), question, hashtags].filter(Boolean).join("\n\n");
  return {
    question,
    caption,
    hashtags,
    tips: [
      {
        title: tr(lang, "Trend-Audio darunterlegen"),
        text: tr(lang, "Exportiere den Clip nur mit Soundeffekten (Musik aus) und lege in TikTok oder Instagram einen gerade trendenden Phonk- oder Bass-Drop-Sound mit 15 bis 25 % Lautstärke darunter. Der Drop sollte genau auf OPFER oder MATT fallen."),
      },
      {
        title: tr(lang, "Kommentare provozieren"),
        text: tr(lang, "Schreib die Frage in die Caption oder als angepinnten Kommentar. Schachspieler korrigieren und diskutieren gern, jeder Kommentar hilft der Reichweite."),
      },
      {
        title: tr(lang, "Sprache testen"),
        text: tr(lang, "Im Edit steht kaum Text. Poste denselben Clip auf Deutsch (weniger Konkurrenz) und auf Englisch (SACRIFICE, CHECKMATE: der Markt ist deutlich größer) und vergleiche die Reichweite."),
      },
      {
        title: tr(lang, "Kurz halten"),
        text: tr(lang, "15 bis 18 Sekunden werden häufiger bis zum Ende geschaut und geloopt als 30. Der Abspann ist nur ein Overlay, danach beginnt das Video von vorn."),
      },
    ],
  };
}

/** Whether tightening can do anything: an edit with a key blow and more than a couple of scenes. */
export function canTighten(project: StudioProject): boolean {
  return project.scenes.length >= 3 && project.scenes.some(isImpactScene);
}
