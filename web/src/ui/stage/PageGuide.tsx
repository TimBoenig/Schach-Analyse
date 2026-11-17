// Lucena explains one page, fullscreen: what it shows, how to read it and
// what to do with it. It opens by itself on the first visit and again from
// the "Erklären" button in the page header.
import { useEffect, useState } from "preact/hooks";

import { IconChevron } from "../icons";
import { type GuideId, PAGE_GUIDES } from "./guides";
import { Illus } from "./Illus";
import { Stage, StagePoint } from "./Stage";
import { currentShow, markSeen, openStage, wasSeen } from "./store";

const seenId = (id: GuideId) => `page:${id}`;

export function PageGuide({ id, onClose }: { id: GuideId; onClose: () => void }) {
  const guide = PAGE_GUIDES[id];
  const [index, setIndex] = useState(0);
  const step = guide.steps[index];
  const last = index === guide.steps.length - 1;
  const close = () => {
    markSeen(seenId(id));
    onClose();
  };
  const next = () => (last ? close() : setIndex(index + 1));
  return (
    <Stage
      steps={guide.steps.length}
      step={index}
      stepKey={`${id}-${index}`}
      kicker={`Lucena · ${guide.title}`}
      mood={step.mood ?? "happy"}
      layout={step.illus || step.points ? "split" : "center"}
      say={step.say}
      sub={<p>{step.sub}</p>}
      onBack={index > 0 ? () => setIndex(index - 1) : undefined}
      onNext={next}
      onClose={close}
      closeLabel="Schließen"
      actions={
        <button class="btn primary" onClick={next}>
          {last ? "Alles klar" : "Weiter"}
          {!last && <IconChevron />}
        </button>
      }
    >
      {(step.illus || step.points) && (
        <>
          {step.illus && <Illus kind={step.illus} />}
          {step.points && (
            <div class="stage-points">
              {step.points.map((p) => (
                <StagePoint key={p.title} title={p.title}>
                  {p.text}
                </StagePoint>
              ))}
            </div>
          )}
        </>
      )}
    </Stage>
  );
}

/**
 * Opens the page's guide once, on the first visit with something to show.
 * `ready` stays false while the page is empty or loading: an explanation of
 * charts that are not there yet would only confuse.
 */
export function usePageGuide(id: GuideId, ready: boolean): void {
  useEffect(() => {
    if (!ready || wasSeen(seenId(id)) || currentShow()) return;
    // A moment to see the page first; the guide then explains what is there.
    const t = window.setTimeout(() => {
      if (!currentShow() && !wasSeen(seenId(id))) openStage({ kind: "page", subject: id });
    }, 700);
    return () => window.clearTimeout(t);
  }, [id, ready]);
}

/** The button in a page header that brings the explanation back. */
export function GuideButton({ id }: { id: GuideId }) {
  return (
    <button class="btn ghost guide-btn" onClick={() => openStage({ kind: "page", subject: id })} title="Lucena erklärt dir diese Seite">
      <span class="orb-mini" aria-hidden="true" />
      <span class="guide-btn-text">Erklären</span>
    </button>
  );
}
