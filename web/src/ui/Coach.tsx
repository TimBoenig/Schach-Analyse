// Mike, the app's trainer: a friendly face that explains pages, moves and
// training results in plain words instead of bare numbers.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import type { Classification } from "../domain/types";
import { IconClose } from "./icons";
import { navigate } from "./router";

export const COACH_NAME = "Mike";

export type Mood = "happy" | "think" | "wow" | "sad";

const MOUTH: Record<Mood, string> = {
  happy: "M50 69 Q60 78 70 69",
  think: "M52 71 Q58 68 67 70",
  wow: "M55 68 Q60 66 65 68 Q66 75 60 76 Q54 75 55 68 Z",
  sad: "M51 73 Q60 67 69 73",
};

const BROWS: Record<Mood, [string, string]> = {
  happy: ["M44 47 Q50 44 55 46", "M65 46 Q70 44 76 47"],
  think: ["M44 48 Q50 47 55 48", "M65 44 Q70 41 76 44"],
  wow: ["M44 44 Q50 40 55 43", "M65 43 Q70 40 76 44"],
  sad: ["M44 48 Q50 47 55 43", "M65 43 Q70 47 76 48"],
};

/** Mike's portrait; the mood changes brows and mouth. */
export function CoachAvatar({ mood = "happy", size = 56 }: { mood?: Mood; size?: number }) {
  const [b1, b2] = BROWS[mood];
  return (
    <svg class="coach-avatar" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={COACH_NAME}>
      <defs>
        <clipPath id="coach-clip">
          <circle cx="60" cy="60" r="60" />
        </clipPath>
        <linearGradient id="coach-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8fc35a" />
          <stop offset="1" stop-color="#5d8f3a" />
        </linearGradient>
      </defs>
      <g clip-path="url(#coach-clip)">
        <rect width="120" height="120" fill="url(#coach-bg)" />
        <path d="M60 22 L96 60 L60 98 L24 60 Z" fill="#ffffff" opacity="0.08" />
        {/* shirt and collar */}
        <path d="M12 124 C16 98 36 88 60 88 C84 88 104 98 108 124 Z" fill="#2f3b4a" />
        <path d="M47 89 L60 104 L73 89 L67 86 L60 95 L53 86 Z" fill="#f4f1ea" />
        <circle cx="88" cy="100" r="2.6" fill="#8fc35a" />
        <path d="M85.6 103 h4.8 l1.6 5 h-8 Z" fill="#8fc35a" />
        {/* neck, ears, head */}
        <path d="M51 74 h18 v16 q-9 6 -18 0 Z" fill="#e2ad83" />
        <circle cx="34" cy="58" r="6.5" fill="#efbf95" />
        <circle cx="86" cy="58" r="6.5" fill="#efbf95" />
        <ellipse cx="60" cy="56" rx="26" ry="29" fill="#f6cfa6" />
        {/* hair */}
        <path d="M33 54 C29 30 44 20 61 20 C79 20 92 30 87 54 C85 44 80 38 72 37 C64 31 49 32 41 40 C37 44 35 48 33 54 Z" fill="#5a3a26" />
        <path d="M41 40 C47 33 58 31 66 34 C58 36 50 38 44 44 Z" fill="#6e4a32" />
        {/* brows, eyes, cheeks, mouth */}
        <path d={b1} stroke="#4a2f1f" stroke-width="3" stroke-linecap="round" fill="none" />
        <path d={b2} stroke="#4a2f1f" stroke-width="3" stroke-linecap="round" fill="none" />
        <circle cx="50" cy="56" r="3.6" fill="#2a2522" />
        <circle cx="70" cy="56" r="3.6" fill="#2a2522" />
        <circle cx="51.2" cy="54.8" r="1.1" fill="#fff" />
        <circle cx="71.2" cy="54.8" r="1.1" fill="#fff" />
        <circle cx="44" cy="66" r="4.5" fill="#f19a8b" opacity="0.35" />
        <circle cx="76" cy="66" r="4.5" fill="#f19a8b" opacity="0.35" />
        <path d="M58 60 Q60 64 62 60" stroke="#d99a73" stroke-width="2" fill="none" stroke-linecap="round" />
        <path
          d={MOUTH[mood]}
          stroke="#7a3b2e"
          stroke-width="3"
          stroke-linecap="round"
          fill={mood === "wow" ? "#7a3b2e" : "none"}
        />
      </g>
    </svg>
  );
}

/** Mike's mood for a move verdict. */
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

/** Mike speaking: avatar plus speech bubble. */
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

/** A page intro from Mike that explains what the page is for; closing it is remembered on this device. */
export function CoachTip({ id, title, children, mood = "happy" }: { id: string; title: string; children: ComponentChildren; mood?: Mood }) {
  const [hidden, setHidden] = useState(() => hiddenTips().includes(id));
  if (hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(TIPS_KEY, JSON.stringify([...new Set([...hiddenTips(), id])]));
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
        <button class="coach-close" onClick={close} aria-label="Hinweis schließen" title="Verstanden">
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
      <h3>Wer bist du?</h3>
      <p>Sag mir zuerst deinen Spielernamen, damit ich deine Partien erkenne. Dann {what}</p>
      <button class="btn primary big" onClick={() => navigate({ view: "settings" })}>
        Namen eintragen
      </button>
    </div>
  );
}
