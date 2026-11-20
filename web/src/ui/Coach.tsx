// Lucena, the app's trainer: a friendly face that explains pages, moves and
// training results in plain words instead of bare numbers.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { Classification } from "../domain/types";
import type { Mood } from "./coach/net";
import { Orb } from "./coach/orb";
import { IconClose } from "./icons";
import { navigate } from "./router";
import { t } from "../i18n";

export const COACH_NAME = "Lucena";

export type { Mood };

/**
 * Lucena's portrait: an AI in a glass sphere. The neural network inside turns in
 * 3D and fires signals, the eyes follow the pointer, and the mood sets colour,
 * tempo and expression. With reduced motion it is a still picture.
 */
export function CoachAvatar({
  mood = "happy",
  size = 56,
}: {
  mood?: Mood;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const orb = useRef<Orb | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const o = new Orb(canvas.current, size, mood, still);
    orb.current = o;
    return () => o.destroy();
    // A new mood is handed over below, without rebuilding the network.
  }, [size]);
  useEffect(() => orb.current?.setMood(mood), [mood]);
  return (
    <canvas
      ref={canvas}
      class={`coach-avatar mood-${mood}`}
      style={{ "--coach-size": `${size}px` }}
      role="img"
      aria-label={COACH_NAME}
    />
  );
}

/** Lucena's mood for a move verdict. */
export function moodFor(c: Classification | null | undefined): Mood {
  switch (c) {
    case "Brilliant":
    case "Great":
      return "wow";
    case "Inaccuracy":
      return "think";
    case "Mistake":
    case "Miss":
    case "Blunder":
      return "sad";
    default:
      return "happy";
  }
}

/** Lucena speaking: avatar plus speech bubble. */
export function Coach({
  mood = "happy",
  title,
  children,
  actions,
  tone,
  size = 52,
  class: extra = "",
}: {
  mood?: Mood;
  title?: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  /** Colours the bubble edge, e.g. a classification colour variable. */
  tone?: string;
  size?: number;
  class?: string;
}) {
  return (
    <div class={`coach ${extra}`}>
      <CoachAvatar mood={mood} size={size} />
      <div class="coach-bubble" style={tone ? { "--tone": tone } : undefined}>
        {title && <div class="coach-title">{title}</div>}
        {children && <div class="coach-text">{children}</div>}
        {actions && <div class="coach-actions">{actions}</div>}
      </div>
    </div>
  );
}

const TIPS_KEY = "schach.tips.hidden";

function hiddenTips(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TIPS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Brings back every page intro that was closed. */
export function resetTips(): void {
  try {
    localStorage.removeItem(TIPS_KEY);
  } catch {
    // Private mode: nothing was stored either.
  }
}

/** A page intro from Lucena that explains what the page is for; closing it is remembered on this device. */
export function CoachTip({
  id,
  title,
  children,
  mood = "happy",
}: {
  id: string;
  title: string;
  children: ComponentChildren;
  mood?: Mood;
}) {
  const [hidden, setHidden] = useState(() => hiddenTips().includes(id));
  if (hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(
        TIPS_KEY,
        JSON.stringify([...new Set([...hiddenTips(), id])]),
      );
    } catch {
      // Private mode: the tip just comes back next time.
    }
  };
  return (
    <div class="coach coach-tip">
      <CoachAvatar mood={mood} size={52} />
      <div class="coach-bubble">
        <div class="coach-title">{title}</div>
        <div class="coach-text">{children}</div>
        <button
          class="coach-close"
          onClick={close}
          aria-label={t("Hinweis schließen")}
          title={t("Verstanden")}
        >
          <IconClose />
        </button>
      </div>
    </div>
  );
}

/** Shown wherever the app needs the player's names before it can say anything. */
export function NeedNames({ what }: { what: string }) {
  return (
    <div class="empty">
      <CoachAvatar size={96} mood="think" />
      <h3>{t("Wer bist du?")}</h3>
      <p>
        
        {t("Sag mir zuerst deinen Spielernamen, damit ich deine Partien erkenne. Dann")} {what}
      </p>
      <button
        class="btn primary big"
        onClick={() => navigate({ view: "settings" })}
      >
        
        {t("Namen eintragen")}
      </button>
    </div>
  );
}
