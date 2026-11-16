// What a new user sees in the app while the first import is analysed: a
// progress pill that says the engine works in the background, and Lucena
// explaining the app in speech bubbles, one page at a time, always skippable.
import { useEffect, useState } from "preact/hooks";
import { cancelAll, subscribeQueue, type QueueState } from "../app/analysisService";
import { batchProgress } from "../domain/firstPass";
import { COACH_NAME, CoachAvatar } from "./Coach";
import { IconChevron, IconClose } from "./icons";
import { navigate, type Route } from "./router";

const GUIDE_KEY = "schach.guide.step";

/** Starts Lucena's tour (called by the guided start after an import). */
export function startGuide(): void {
  try {
    localStorage.setItem(GUIDE_KEY, "0");
  } catch {
    // Private mode: no tour, the app works the same.
  }
}

function readStep(): number | null {
  try {
    const raw = localStorage.getItem(GUIDE_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function saveStep(n: number | null): void {
  try {
    if (n === null) localStorage.removeItem(GUIDE_KEY);
    else localStorage.setItem(GUIDE_KEY, String(n));
  } catch {
    // Private mode: the tour just restarts or ends with the tab.
  }
}

export interface GuideStep {
  title: string;
  text: string;
  /** Page the step suggests trying, with the button label. */
  go?: { label: string; route: Route };
}

// Only facts about how the app works: no numbers about the user here, those
// come from the analysed games on the pages themselves.
export const GUIDE_STEPS: GuideStep[] = [
  {
    title: "Ich sehe mir gerade deine Partien an",
    text: "Erst schaue ich jede Partie kurz durch, damit du schnell Ergebnisse siehst. Danach gehe ich sie gründlicher durch und die Werte werden genauer. Du kannst die App dabei ganz normal benutzen.",
  },
  {
    title: "Deine Partien",
    text: "Jede fertig analysierte Partie bekommt Bewertungen für jeden Zug. Tipp eine an und spring direkt zu deinen Fehlern.",
    go: { label: "Partien öffnen", route: { view: "games" } },
  },
  {
    title: "Dein Profil",
    text: "Hier sammle ich Stärken und Schwächen. Jede Aussage nennt, auf wie vielen Partien sie beruht. Solange noch wenige analysiert sind, sage ich lieber nichts als etwas Falsches.",
    go: { label: "Profil ansehen", route: { view: "profile" } },
  },
  {
    title: "Deine Eröffnungen",
    text: "Welche Eröffnungen du spielst, wie sie für dich laufen und wo du früh aus dem Buch gehst.",
    go: { label: "Eröffnungen zeigen", route: { view: "openings" } },
  },
  {
    title: "Training aus deinen Fehlern",
    text: "Aus Stellungen, in denen du danebengegriffen hast, baue ich Aufgaben. Die Einheit für heute dauert nur ein paar Minuten.",
    go: { label: "Training ausprobieren", route: { view: "training" } },
  },
  {
    title: "Freunde und Liga",
    text: "Füge Freunde mit ihrem Namen bei chess.com oder Lichess hinzu. Ich vergleiche euch fair nach Zugqualität und Ergebnissen.",
    go: { label: "Freunde ansehen", route: { view: "players" } },
  },
  {
    title: "Das war's von mir",
    text: "Den Fortschritt der Analyse siehst du unten im Balken. Wenn du später neue Partien holst, analysiere ich sie automatisch mit.",
  },
];

function useQueue(): QueueState | null {
  const [q, setQ] = useState<QueueState | null>(null);
  useEffect(() => subscribeQueue(setQ), []);
  return q;
}

/** Shell overlay: background analysis pill plus Lucena's tour while it is open. */
export function Guide() {
  const q = useQueue();
  const [step, setStep] = useState<number | null>(readStep);
  const [folded, setFolded] = useState(false);

  const p = q ? batchProgress({ finished: q.finished, current: q.current, queued: q.queued.length, done: q.done, total: q.total, deeper: q.deeper }) : null;
  const running = Boolean(p && !p.idle);
  const tour = step !== null && step < GUIDE_STEPS.length ? GUIDE_STEPS[step] : null;
  if (!running && !tour) return null;

  const move = (n: number | null) => {
    const next = n !== null && n < GUIDE_STEPS.length ? n : null;
    setStep(next);
    saveStep(next);
  };
  const quick = q?.pass === "quick";
  const pct = p ? Math.round(p.fraction * 100) : 0;

  return (
    <aside class={`guide${folded ? " folded" : ""}`} aria-label={`${COACH_NAME} und Analyse`}>
      {tour && !folded && (
        <div class="guide-bubble" role="dialog" aria-live="polite" aria-label={tour.title} key={step}>
          <button class="guide-x" onClick={() => move(null)} aria-label="Erklärungen überspringen" title="Überspringen">
            <IconClose />
          </button>
          <div class="guide-title">{tour.title}</div>
          <p class="guide-text">{tour.text}</p>
          <div class="guide-actions">
            <span class="guide-count faint small">
              {step! + 1} / {GUIDE_STEPS.length}
            </span>
            <button class="ld-skip guide-skip" onClick={() => move(null)}>
              Überspringen
            </button>
            {tour.go && (
              <button
                class="btn"
                onClick={() => {
                  navigate(tour.go!.route);
                  move(step! + 1);
                }}
              >
                {tour.go.label}
              </button>
            )}
            <button class="btn primary" onClick={() => move(step! + 1)}>
              {step === GUIDE_STEPS.length - 1 ? "Fertig" : "Weiter"}
              {step! < GUIDE_STEPS.length - 1 && <IconChevron />}
            </button>
          </div>
        </div>
      )}
      <div class="guide-bar">
        <button class="guide-orb" onClick={() => setFolded((f) => !f)} aria-label={folded ? `${COACH_NAME} zeigen` : `${COACH_NAME} einklappen`} aria-expanded={!folded}>
          <CoachAvatar mood={running ? "think" : "happy"} size={44} />
        </button>
        {running && p && !folded && (
          <button class="guide-status" onClick={() => navigate({ view: "games" })} title="Zu den Partien">
            <span class="guide-status-line">
              <span class="guide-pulse" aria-hidden="true" />
              <strong>Analyse läuft im Hintergrund</strong>
            </span>
            <span class="guide-status-sub faint small">
              {q?.pass === "deep" ? "Gründliche Runde" : quick ? "Schneller Überblick" : "Analyse"} · Partie {p.index} von {p.games}
              {quick ? " · danach gründlicher" : ""}
            </span>
            <span class="guide-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Fortschritt der Analyse">
              <span style={{ width: `${pct}%` }} />
            </span>
          </button>
        )}
        {running && !folded && (
          <button class="guide-stop faint small" onClick={cancelAll} title="Analyse anhalten">
            Anhalten
          </button>
        )}
      </div>
    </aside>
  );
}
