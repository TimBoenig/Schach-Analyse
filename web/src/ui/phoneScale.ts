import { t } from "../i18n";
// How much fits on a phone screen. The pages are drawn for a 390 px wide
// phone; "Kompakt" lays them out on a wider virtual screen (a smaller
// initial-scale), so everything shrinks together and more is visible at once.
export type PhoneScale = "compact" | "normal" | "large";

export const PHONE_SCALES: Record<PhoneScale, { label: string; scale: number }> = {
  compact: { label: "Kompakt", scale: 0.86 },
  normal: { label: "Normal", scale: 1 },
  large: { label: t("Groß"), scale: 1.1 },
};

const KEY = "schach.phoneScale";

export function readPhoneScale(): PhoneScale {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "compact" || v === "normal" || v === "large") return v;
  } catch {
    // Storage blocked: the default applies.
  }
  return "compact";
}

/** Tablets and desktops keep their size; only phones (short side under 600 px) are scaled. */
const isPhone = () => Math.min(screen.width, screen.height) < 600;

export function applyPhoneScale(pick: PhoneScale = readPhoneScale()): void {
  if (!isPhone()) return;
  const meta = document.querySelector('meta[name="viewport"]');
  meta?.setAttribute("content", `width=device-width, initial-scale=${PHONE_SCALES[pick].scale}, user-scalable=no, viewport-fit=cover`);
}

export function setPhoneScale(pick: PhoneScale): void {
  try {
    localStorage.setItem(KEY, pick);
  } catch {
    // The choice then only lasts until the next start.
  }
  applyPhoneScale(pick);
}

export const onPhone = isPhone;
