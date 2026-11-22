/** True while the user types in a field, so single-key shortcuts stay out of the way. */
import { t } from "../i18n";

export function isTyping(e: KeyboardEvent): boolean {
  const tk = e.target as HTMLElement | null;
  if (!tk) return false;
  const tag = tk.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tk.isContentEditable;
}

/** "⌘" on Apple devices, "Strg" elsewhere (German keyboards). */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : t("Strg");
