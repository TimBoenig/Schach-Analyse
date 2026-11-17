// Draws the show that is currently open on Lucena's stage, above everything
// else in the app.
import { useEffect, useState } from "preact/hooks";

import { ErrorBoundary } from "../ErrorBoundary";
import type { GuideId } from "./guides";
import { PAGE_GUIDES } from "./guides";
import { Onboarding } from "./Onboarding";
import { PageGuide } from "./PageGuide";
import { ReportStory } from "./ReportStory";
import { closeStage, type Show, subscribeStage } from "./store";
import { Tour } from "./Tour";

export function StageHost() {
  const [show, setShow] = useState<Show | null>(null);
  useEffect(() => subscribeStage(setShow), []);
  if (!show) return null;
  const key = `${show.kind}:${show.subject ?? ""}`;
  return (
    <ErrorBoundary area="Lucena" key={key}>
      {show.kind === "onboarding" && <Onboarding onClose={closeStage} />}
      {show.kind === "tour" && <Tour onClose={closeStage} start={show.step} />}
      {show.kind === "page" && show.subject && show.subject in PAGE_GUIDES && <PageGuide id={show.subject as GuideId} onClose={closeStage} />}
      {show.kind === "report" && show.subject && <ReportStory gameId={show.subject} onClose={closeStage} />}
    </ErrorBoundary>
  );
}
