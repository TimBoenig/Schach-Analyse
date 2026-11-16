import { useEffect, useRef } from "preact/hooks";

import { playUltraBrilliant } from "./fx/ultraBrilliant";
import { fxPrefs, prefersReducedMotion } from "./fxPrefs";
import { badgeFor } from "./labels";

/**
 * Celebration over the board when the player finds a brilliant move: ring burst,
 * sparks and the badge popping in. With the "Ultra" setting the whole screen
 * joins in; devices that ask for reduced motion always get the quiet one.
 */
export function BrilliantFx({ square, flipped, san }: { square: string; flipped: boolean; san?: string }) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = flipped ? 7 - file : file;
  const y = flipped ? rank : 7 - rank;
  const ref = useRef<HTMLDivElement>(null);
  const prefs = fxPrefs();
  const ultra = prefs.brilliant === "ultra" && !prefersReducedMotion();
  // Runs once per celebration: the callers remount this component for every new move.
  useEffect(() => {
    const el = ref.current;
    if (!ultra || !el) return;
    const r = el.getBoundingClientRect();
    return playUltraBrilliant({
      x: r.left + ((x + 0.5) / 8) * r.width,
      y: r.top + ((y + 0.5) / 8) * r.height,
      shake: el.parentElement,
      sound: prefs.sound,
      san,
    });
  }, []);
  return (
    <div class={`brilliant-fx${ultra ? " ultra" : ""}`} aria-hidden="true" ref={ref}>
      <div class="brilliant-flash" />
      <div class="brilliant-spot" style={{ left: `${(x + 0.5) * 12.5}%`, top: `${(y + 0.5) * 12.5}%` }}>
        <span class="brilliant-ring" />
        <span class="brilliant-ring r2" />
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} class="brilliant-spark" style={{ "--a": `${i * 30}deg`, "--d": `${i % 2 ? 0.08 : 0}s` }} />
        ))}
      </div>
      <div class="brilliant-banner">
        <img src={badgeFor("Brilliant") ?? ""} alt="" />
        <span>Brillant!!</span>
      </div>
    </div>
  );
}
