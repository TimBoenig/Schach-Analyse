// The training area: the session of the day, the exercise library and the
// progress page. A running session replaces all three (focus mode).
import { useState } from "preact/hooks";

import { CATEGORIES, type Category, gameExercises, pickSession } from "../domain/training";
import { NeedNames } from "./Coach";
import { PageHeader } from "./Layout";
import { navigate, type TrainingTab } from "./router";
import type { GuideId } from "./stage/guides";
import { GuideButton, usePageGuide } from "./stage/PageGuide";
import { LibraryPage } from "./training/Library";
import { ProgressPage } from "./training/Progress";
import { Session } from "./training/Session";
import type { SessionSpec } from "./training/shared";
import { TodayPage } from "./training/Today";
import { useTraining } from "./training/useTraining";

const GUIDE: Record<TrainingTab, GuideId> = { heute: "training", uebungen: "exercises", fortschritt: "progress" };
// Route part of a link that practises one game: #/training/uebungen/partie-<game id>.
const GAME_PREFIX = "partie-";

export function TrainingView({ tab = "heute", category }: { tab?: TrainingTab; category?: string }) {
  const t = useTraining();
  const [session, setSession] = useState<SessionSpec | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);
  const ready = !t.loading && !t.error && Boolean(t.usernames?.length) && !session;
  usePageGuide(GUIDE[tab], ready);

  // "Fehler üben" in a game report: the exercises made from that game, in move order.
  const fromGame = category?.startsWith(GAME_PREFIX) ? category.slice(GAME_PREFIX.length) : null;
  const [noGameExercises, setNoGameExercises] = useState(false);
  if (!autoStarted && !t.loading && fromGame) {
    setAutoStarted(true);
    const ids = gameExercises(t.pool, fromGame);
    if (ids.length) setSession({ title: "Fehler aus dieser Partie", ids });
    else setNoGameExercises(true);
  }

  // A link from the statistics ("Blunder-Check üben") starts that area at once.
  // Openings are the exception: they are the player's own choice, so the link
  // only opens the picker.
  if (!autoStarted && !t.loading && category && category in CATEGORIES && t.pool.length) {
    setAutoStarted(true);
    if (category !== "repertoire") {
      const ids = pickSession(
        t.pool.filter((e) => e.category === category),
        t.progress,
        t.today,
      );
      if (ids.length) setSession({ title: CATEGORIES[category as Category].label, ids });
    }
  }

  if (session) {
    return <Session spec={session} t={t} onExit={() => setSession(null)} />;
  }

  const header = <PageHeader actions={ready ? <GuideButton id={GUIDE[tab]} /> : undefined} />;

  if (t.loading) {
    return (
      <div>
        {header}
        <div class="dash">
          <div class="skeleton span-12" style={{ height: "300px" }} />
          <div class="skeleton span-8" style={{ height: "190px" }} />
          <div class="skeleton span-4" style={{ height: "190px" }} />
        </div>
      </div>
    );
  }
  if (t.usernames && !t.usernames.length) {
    return (
      <div>
        {header}
        <NeedNames what="baue ich dir aus deinen Partien Übungen und einen Trainingsplan." />
      </div>
    );
  }
  if (t.error) {
    return (
      <div>
        {header}
        <p class="error">{t.error}</p>
      </div>
    );
  }

  return (
    <div>
      {header}
      {t.profile?.is_empty && tab !== "heute" && (
        <div class="card notice tn-notice">
          <span>Noch keine Partie analysiert: Endspiel-Grundlagen und Eröffnungen kannst du schon üben. Aufgaben aus deinen Fehlern kommen dazu, sobald Partien analysiert sind.</span>
          <button class="btn small" onClick={() => navigate({ view: "games" })}>
            Zu den Partien
          </button>
        </div>
      )}
      {noGameExercises && (
        <div class="card notice tn-notice">
          <span>Aus dieser Partie steht gerade keine Übung in deiner Bibliothek. Hier sind die übrigen Bereiche.</span>
          <button class="btn small" onClick={() => setNoGameExercises(false)}>
            Ausblenden
          </button>
        </div>
      )}
      {tab === "heute" && <TodayPage t={t} start={setSession} />}
      {tab === "uebungen" && <LibraryPage t={t} start={setSession} initial={category} />}
      {tab === "fortschritt" && <ProgressPage t={t} />}
    </div>
  );
}
