// What Lucena says on her stage and in which order. Only facts about how the
// app works stand here: every number about a player comes from that player's
// own games, on the screen that shows it. Pure data and rules, no DOM.
import type { Route } from "../router";
import type { GuideId } from "./guides";
import type { IllusKind } from "./Illus";
import { t } from "../../i18n";

export interface Point {
  title: string;
  text: string;
}

export interface TourStop {
  id: string;
  illus: IllusKind;
  /** Lucena's headline. */
  say: string;
  sub: string;
  points: Point[];
  /** The page the stop is about, with the label of the button that opens it. */
  go: { label: string; route: Route };
  /** That page's own guide: the stop already introduced it, so it does not open again by itself. */
  guide: GuideId;
}

export const TOUR_STOPS: TourStop[] = [
  {
    id: "games",
    illus: "games",
    say: t("Hier liegen alle deine Partien."),
    sub: t("Ich hole sie von chess.com oder Lichess und gehe jede Zug für Zug mit der Engine durch."),
    points: [
      { title: t("Jeder Zug bekommt ein Urteil"), text: t("Von brillant bis Patzer, mit dem besseren Zug daneben.") },
      { title: t("Jede Partie bekommt einen Bericht"), text: t("Mit Note, Wendepunkt und dem, was du daraus mitnimmst.") },
    ],
    go: { label: t("Partien öffnen"), route: { view: "games" } },
    guide: "games",
  },
  {
    id: "stats",
    illus: "stats",
    say: t("Die Statistik zeigt, wer du am Brett bist."),
    sub: t("Aus allen analysierten Partien lese ich Fähigkeiten, Stil, Stärken und Schwächen."),
    points: [
      { title: t("Nichts ohne Beleg"), text: t("Jede Aussage nennt, auf wie vielen Partien sie beruht. Sind es zu wenige, sage ich lieber nichts.") },
      { title: t("Vier Blickwinkel"), text: t("Überblick, Ergebnisse, Züge und Fehler, Eröffnungen.") },
    ],
    go: { label: t("Statistik ansehen"), route: { view: "profile" } },
    guide: "profile",
  },
  {
    id: "training",
    illus: "training",
    say: t("Im Training übst du genau deine Fehler."),
    sub: t("Aus Stellungen, in denen du danebengegriffen hast, baue ich Aufgaben."),
    points: [
      { title: t("Eine Einheit pro Tag"), text: t("Aufwärmen, dein Schwerpunkt, dann gemischte Aufgaben. Das dauert nur ein paar Minuten.") },
      { title: t("Fortschritt, den du siehst"), text: t("Ich merke mir, was sitzt, und frage erst nach einer Pause wieder.") },
    ],
    go: { label: t("Training ansehen"), route: { view: "training" } },
    guide: "training",
  },
  {
    id: "players",
    illus: "players",
    say: t("Mit Freunden wird daraus eine Liga."),
    sub: t("Füge Freunde mit ihrem Namen bei chess.com oder Lichess hinzu."),
    points: [
      { title: t("Fair verglichen"), text: t("Nach Zugqualität und Ergebnissen, auch wenn ihr verschiedene Bedenkzeiten spielt.") },
      { title: t("Gegner im Blick"), text: t("Wie spielt jemand, welche Eröffnungen, wo macht er Fehler?") },
    ],
    go: { label: t("Spieler ansehen"), route: { view: "players" } },
    guide: "players",
  },
];

// ---------- first start ----------

/** Where the new user plays; "none" has no account to fetch games from. */
export type SitePick = "chesscom" | "lichess" | "none";

export type OnboardStep = "hello" | "site" | "name" | "import" | "analysis" | "nosite" | `tour:${string}` | "ready";

const TOUR_STEPS: OnboardStep[] = TOUR_STOPS.map((s) => `tour:${s.id}` as const);

/**
 * The steps of the first start in order. Without an account the name, import
 * and analysis steps make no sense and are replaced by one honest screen.
 */
export function onboardPath(pick: SitePick | null): OnboardStep[] {
  const middle: OnboardStep[] = pick === "none" ? ["nosite"] : ["name", "import", "analysis"];
  return ["hello", "site", ...middle, ...TOUR_STEPS, "ready"];
}

export type ImportPhase = "idle" | "busy" | "done" | "empty" | "error";

/** The step "Zurück" leads to, or null when there is no way back from here. */
export function backStep(path: OnboardStep[], index: number, phase: ImportPhase): number | null {
  if (index <= 0) return null;
  // A running download must finish (or fail) first: its games are being stored.
  if (path[index] === "import" && phase === "busy") return null;
  // Once the games are in, the way back to the name would only fetch them again.
  if (path[index] === "analysis") return null;
  return index - 1;
}

/** Whether "Weiter" may be pressed on this step. */
export function canAdvance(step: OnboardStep, state: { pick: SitePick | null; name: string; phase: ImportPhase }): boolean {
  switch (step) {
    case "site":
      return state.pick !== null;
    case "name":
      return state.name.trim().length > 0;
    case "import":
      return state.phase === "done";
    default:
      return true;
  }
}

export function tourStop(step: OnboardStep): TourStop | undefined {
  return step.startsWith("tour:") ? TOUR_STOPS.find((s) => `tour:${s.id}` === step) : undefined;
}
