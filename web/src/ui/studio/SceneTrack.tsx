// The timeline under the preview: one block per scene, as wide as the scene is long, like the track of a
// video editor. A click selects the scene; dragging a block's right edge (or the arrow keys on it) changes
// how long the scene plays, in real seconds, on the beat grid in the reel look.
import { useRef, useState } from "preact/hooks";

import { CARD_LABEL } from "./model";
import type { Timeline } from "./timeline";
import { dec, t } from "../../i18n";

/** Longest scene the track lets you drag to. */
const MAX_SECONDS = 30;

export interface SceneTrackProps {
  timeline: Timeline;
  sel: number;
  /** Seconds of one beat in the reel look (lengths snap to it), 0 = free in 0.1 s steps. */
  beat: number;
  onSelect: (i: number) => void;
  /** New real length of scene i in seconds. */
  onResize: (i: number, seconds: number) => void;
}

/** The length a drag lands on: on the grid, never below one step or beyond the maximum. */
export function snapLength(seconds: number, beat: number): number {
  const step = beat || 0.1;
  const min = beat || 0.5;
  const v = Math.round(seconds / step) * step;
  return Math.round(Math.min(MAX_SECONDS, Math.max(min, v)) * 1000) / 1000;
}

const fmt = (s: number) => `${s.toFixed(1).replace(".", dec())} s`;

export function SceneTrack({ timeline, sel, beat, onSelect, onResize }: SceneTrackProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; x0: number; d0: number; pxPerSecond: number; last: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const step = beat || 0.1;

  const start = (e: PointerEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    const width = ref.current?.getBoundingClientRect().width ?? 0;
    if (!width || !timeline.total) return;
    const d0 = timeline.scenes[i].dur;
    // The scale stays the one from the start of the drag, so the edge follows the pointer even while the whole track grows.
    drag.current = { i, x0: e.clientX, d0, pxPerSecond: width / timeline.total, last: d0 };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect(i);
    setLive(i);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const v = snapLength(d.d0 + (e.clientX - d.x0) / d.pxPerSecond, beat);
    if (Math.abs(v - d.last) < 1e-6) return;
    d.last = v;
    onResize(d.i, v);
  };
  const end = () => {
    drag.current = null;
    setLive(null);
  };

  return (
    <div class={`studio-track ${live !== null ? "dragging" : ""}`} ref={ref} role="list" aria-label={t("Zeitleiste der Szenen")}>
      {timeline.scenes.map((c, i) => {
        const label = c.scene.moves.trim() || c.scene.title.trim() || (c.scene.card !== "none" ? CARD_LABEL[c.scene.card] : "");
        return (
          <div
            key={c.scene.id}
            role="listitem"
            class={`studio-clip ${i === sel ? "on" : ""} ${c.scene.card !== "none" ? "is-card" : ""} ${c.mate ? "mate" : ""} ${c.hit !== null ? "hit" : ""} ${c.scene.leadIn ? "lead" : ""}`}
            style={{ flexGrow: c.dur }}
          >
            <button class="studio-clip-main" onClick={() => onSelect(i)} title={`${t("Szene {0}", { 0: i + 1 })} · ${fmt(c.dur)}${label ? ` · ${label}` : ""}`}>
              <span class="studio-clip-no">{i + 1}</span>
              <span class="studio-clip-len">{fmt(c.dur)}</span>
              {label && <span class="studio-clip-label">{label}</span>}
            </button>
            <span
              class="studio-clip-edge"
              role="slider"
              tabIndex={0}
              aria-label={t("Länge von Szene {0}", { 0: i + 1 })}
              aria-valuenow={Math.round(c.dur * 10) / 10}
              aria-valuemin={beat || 0.5}
              aria-valuemax={MAX_SECONDS}
              title={t("Ziehen ändert die Länge")}
              onPointerDown={(e) => start(e, i)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={(e) => {
                const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                onResize(i, snapLength(c.dur + dir * step, beat));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
