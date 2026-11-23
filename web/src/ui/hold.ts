import { useEffect, useRef } from "preact/hooks";

/**
 * Press-and-hold for a step button: one step on press, and when the finger
 * stays down the steps repeat quickly until it lets go or `step` reports that
 * there is nothing left (it returns false), so holding never jumps to the end
 * but stops there.
 */
export function useHoldRepeat(step: () => boolean | void, { delay = 380, every = 85 }: { delay?: number; every?: number } = {}) {
  const latest = useRef(step);
  latest.current = step;
  const timer = useRef<number | null>(null);
  // A pointer press already stepped; the click that follows it must not step again.
  const pointerUsed = useRef(false);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const run = () => {
    if (latest.current() === false) return stop();
    timer.current = window.setTimeout(run, every);
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      pointerUsed.current = true;
      stop();
      if (latest.current() === false) return;
      timer.current = window.setTimeout(run, delay);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: Event) => e.preventDefault(),
    // Keyboard (Enter/Space) arrives as a click without a pointer press.
    onClick: () => {
      if (pointerUsed.current) pointerUsed.current = false;
      else latest.current();
    },
  };
}
