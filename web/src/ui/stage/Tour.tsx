// Lucena's walk through the four areas, opened from the sidebar at any time.
// The first start (Onboarding.tsx) plays the same stops after the import.
import { useState } from "preact/hooks";

import { IconChevron } from "../icons";
import { navigate } from "../router";
import { Illus } from "./Illus";
import { TOUR_STOPS } from "./script";
import { Stage, StagePoint } from "./Stage";

export function Tour({ onClose, start = 0 }: { onClose: () => void; start?: number }) {
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), TOUR_STOPS.length - 1));
  const stop = TOUR_STOPS[index];
  const last = index === TOUR_STOPS.length - 1;
  const next = () => (last ? onClose() : setIndex(index + 1));
  return (
    <Stage
      steps={TOUR_STOPS.length}
      step={index}
      stepKey={stop.id}
      mood="happy"
      say={stop.say}
      sub={<p>{stop.sub}</p>}
      onBack={index > 0 ? () => setIndex(index - 1) : undefined}
      onNext={next}
      onClose={onClose}
      closeLabel="Schließen"
      actions={
        <>
          <button
            class="btn"
            onClick={() => {
              onClose();
              navigate(stop.go.route);
            }}
          >
            {stop.go.label}
          </button>
          <button class="btn primary" onClick={next}>
            {last ? "Fertig" : "Weiter"}
            {!last && <IconChevron />}
          </button>
        </>
      }
    >
      <Illus kind={stop.illus} />
      <div class="stage-points">
        {stop.points.map((p) => (
          <StagePoint key={p.title} title={p.title}>
            {p.text}
          </StagePoint>
        ))}
      </div>
    </Stage>
  );
}
