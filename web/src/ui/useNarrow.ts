import { useEffect, useState } from "preact/hooks";

/** Phone widths: below this a page shows the compact layout (folded sections, rows instead of columns). */
export const NARROW_MAX = 640;

const QUERY = `(max-width: ${NARROW_MAX}px)`;

const matches = (): boolean => typeof window !== "undefined" && Boolean(window.matchMedia?.(QUERY).matches);

/** True on phone-sized screens; follows rotation and window resizes. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
