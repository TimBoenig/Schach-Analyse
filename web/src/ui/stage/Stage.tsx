// The frame of every fullscreen moment with Lucena: she fills the screen,
// says one thing at a time, and the user moves on with one clear button.
// The shows themselves (first start, tour, page guides, game report) only
// hand in what she says and what stands beside her.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { BRAND } from "../../brand";
import { COACH_NAME, CoachAvatar, type Mood } from "../Coach";
import { IconBack, IconClose } from "../icons";
import { isTyping } from "../keys";
import { useNarrow } from "../useNarrow";
import { t } from "../../i18n";

const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

// Characters per tick and tick length: a headline of 40 characters is written
// in well under a second, so the typing never holds anyone up.
const TYPE_STEP = 2;
const TYPE_MS = 16;

/**
 * Text that writes itself. The part still to come is already in the layout
 * (invisible), so nothing jumps while the line grows.
 */
export function Typed({ text }: { text: string }) {
  const [n, setN] = useState(() => (reducedMotion() ? text.length : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setN(text.length);
      return;
    }
    setN(0);
    const timer = window.setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          window.clearInterval(timer);
          return v;
        }
        return v + TYPE_STEP;
      });
    }, TYPE_MS);
    return () => window.clearInterval(timer);
  }, [text]);
  const shown = Math.min(n, text.length);
  return (
    <span class="typed" aria-label={text}>
      <span aria-hidden="true">{text.slice(0, shown)}</span>
      {shown < text.length && (
        <span class="typed-rest" aria-hidden="true">
          {text.slice(shown)}
        </span>
      )}
    </span>
  );
}

/** One named part of a longer show, for the labelled progress line on top. */
export interface StagePhase {
  label: string;
  /** How far this part is, 0 to 1; real progress where there is one (games found, games analysed). */
  fill: number;
  /** Short live detail after the label, e.g. "87" games or "40 %". */
  detail?: string;
  /** Work without a known end is running: the bar pulses instead of filling. */
  busy?: boolean;
}

export interface StageProps {
  /** Named parts instead of plain segments: the current one is spelled out. */
  phases?: StagePhase[];
  /** Index of the part the current step belongs to. */
  phase?: number;
  /** Number of segments in the progress line on top; leave out for a single screen. */
  steps?: number;
  /** Index of the current segment. */
  step?: number;
  mood?: Mood;
  /** "center": Lucena alone in the middle. "split": she speaks on the left, content on the right. */
  layout?: "center" | "split";
  kicker?: string;
  /** What Lucena says: one sentence, written out letter by letter. */
  say: string;
  /** A calmer second line under it. */
  sub?: ComponentChildren;
  /** What she shows: choices, a form, a chart, a board. */
  children?: ComponentChildren;
  /** The buttons at the bottom right; the main one last. */
  actions?: ComponentChildren;
  onBack?: () => void;
  /** Enter and the right arrow key do the same as the main button. */
  onNext?: () => void;
  onClose: () => void;
  closeLabel?: string;
  /** Changes with every step, so speech and content come in again. */
  stepKey?: string | number;
}

export function Stage({
  phases,
  phase = 0,
  steps,
  step = 0,
  mood = "happy",
  layout = "split",
  kicker = COACH_NAME,
  say,
  sub,
  children,
  actions,
  onBack,
  onNext,
  onClose,
  closeLabel = t("Überspringen"),
  stepKey,
}: StageProps) {
  const narrow = useNarrow();
  const root = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onBack, onNext, onClose });
  handlers.current = { onBack, onNext, onClose };

  // The page behind must not scroll or take keys while the stage is up.
  useEffect(() => {
    document.documentElement.classList.add("stage-open");
    return () => document.documentElement.classList.remove("stage-open");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlers.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        h.onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Keys never reach the app's own shortcuts behind the stage.
      e.stopPropagation();
      if (isTyping(e)) return;
      const onControl = e.target instanceof HTMLElement && Boolean(e.target.closest("button, a, [role='button'], summary"));
      if (e.key === "ArrowRight" || (e.key === "Enter" && !onControl)) {
        if (!h.onNext) return;
        e.preventDefault();
        h.onNext();
      } else if (e.key === "ArrowLeft" && h.onBack) {
        e.preventDefault();
        h.onBack();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // A new step starts at its top and hands the keyboard to the stage.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelector<HTMLElement>(".stage-body")?.scrollTo?.(0, 0);
    if (!el.contains(document.activeElement) || !(document.activeElement instanceof HTMLInputElement)) el.focus({ preventScroll: true });
  }, [stepKey]);

  return (
    <div class={`stage stage-${layout}`} role="dialog" aria-modal="true" aria-label={`${COACH_NAME}: ${say}`} tabIndex={-1} ref={root}>
      <div class="stage-bg" aria-hidden="true">
        <span class="stage-blob a" />
        <span class="stage-blob b" />
        <span class="stage-grid" />
      </div>
      <header class="stage-top">
        <div class="stage-brand">
          <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          <span>{BRAND}</span>
        </div>
        {phases && phases.length > 1 ? (
          <ol class="stage-phases" aria-label={t("Teil {0} von {1}: {2}", { 0: phase + 1, 1: phases.length, 2: t(phases[phase]?.label ?? "") })}>
            {phases.map((p, i) => (
              <li key={p.label} data-state={i < phase ? "done" : i === phase ? "on" : "todo"} data-busy={p.busy ? "" : undefined}>
                <span class="stage-phase-bar">
                  <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, p.fill))})` }} />
                </span>
                <span class="stage-phase-label">
                  {t(p.label)}
                  {p.detail && <span class="tnum"> ({p.detail})</span>}
                </span>
              </li>
            ))}
          </ol>
        ) : steps !== undefined && steps > 1 && (
          <ol class="stage-progress" aria-label={t("Schritt {0} von {steps}", { 0: step + 1, steps })}>
            {Array.from({ length: steps }, (_, i) => (
              <li key={i} data-state={i < step ? "done" : i === step ? "on" : "todo"} />
            ))}
          </ol>
        )}
        <button class="stage-close" onClick={onClose}>
          <span>{closeLabel}</span>
          <IconClose />
        </button>
      </header>
      <div class="stage-body">
        <section class="stage-speaker">
          <div class="stage-orb">
            <span class="stage-orb-halo" aria-hidden="true" />
            <CoachAvatar mood={mood} size={narrow ? 132 : 208} />
          </div>
          <div class="stage-speech" key={stepKey} aria-live="polite">
            <div class="stage-kicker">{kicker}</div>
            <h1 class="stage-say">
              <Typed text={say} />
            </h1>
            {sub && <div class="stage-sub">{sub}</div>}
          </div>
        </section>
        {children && (
          <section class="stage-content" key={stepKey}>
            {children}
          </section>
        )}
      </div>
      <footer class="stage-foot">
        {onBack ? (
          <button class="stage-back" onClick={onBack}>
            <IconBack />
            
            {t("Zurück")}
          </button>
        ) : (
          <span />
        )}
        <div class="stage-actions">{actions}</div>
      </footer>
    </div>
  );
}

/** One fact with its own headline inside the stage's content area. */
export function StagePoint({ icon, title, children }: { icon?: ComponentChildren; title: string; children?: ComponentChildren }) {
  return (
    <div class="stage-point">
      {icon && <span class="stage-point-icon">{icon}</span>}
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}
