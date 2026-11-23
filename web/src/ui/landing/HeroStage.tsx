// The hero's stage: Lucena next to a board that plays by itself, like a short
// video. Puzzles get solved and famous games run, and every move shows the
// badge the app would give it (brilliant, best move, blunder...). Nobody has to
// click anything to see what the product does; the controls only let a visitor
// pause, step or jump to another clip.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { Board } from "../Board";
import { BrilliantFx } from "../BrilliantFx";
import { CoachAvatar } from "../Coach";
import { IconNext, IconPlay, IconPrev } from "../icons";
import { badgeFor, classLabel } from "../labels";
import { buildFrames, SCENES } from "./reel";
import { t } from "../../i18n";

const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

const IconPause = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export function HeroStage() {
  const allFrames = useMemo(() => SCENES.map(buildFrames), []);
  const reduced = useMemo(reducedMotion, []);
  const [scene, setScene] = useState(0);
  // People who ask for less motion start on the finished first clip, paused.
  const [frame, setFrame] = useState(reduced ? allFrames[0].length - 1 : 0);
  const [playing, setPlaying] = useState(!reduced);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  const frames = allFrames[scene];
  const f = frames[frame];

  // The show stops when it is scrolled out of view, so it does not run unseen.
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    const id = window.setTimeout(() => {
      if (frame < frames.length - 1) setFrame(frame + 1);
      else {
        setScene((scene + 1) % SCENES.length);
        setFrame(0);
      }
    }, f.ms);
    return () => window.clearTimeout(id);
  }, [playing, visible, scene, frame]);

  const goScene = (i: number) => {
    setScene(i);
    setFrame(0);
    setPlaying(!reduced);
  };
  const step = (d: number) => {
    setPlaying(false);
    const next = frame + d;
    if (next >= 0 && next < frames.length) return setFrame(next);
    const to = (scene + (d > 0 ? 1 : SCENES.length - 1)) % SCENES.length;
    setScene(to);
    setFrame(d > 0 ? 0 : allFrames[to].length - 1);
  };

  const badge = f.badge ? badgeFor(f.badge) : null;
  return (
    <div class={`ld-stage mood-${f.mood}`} ref={root} role="group" aria-label={t("Kurzfilm: Aufgaben und Partien, Zug für Zug bewertet")}>
      <div class="ld-stage-coach">
        <div class="ld-stage-orb">
          <CoachAvatar mood={f.mood} size={200} />
        </div>
        <p class="ld-stage-say" aria-live="off" key={`${scene}:${f.say}`}>
          {f.say}
        </p>
      </div>
      <div class="ld-stage-board">
        <Board key={scene} fen={f.fen} lastMove={f.last} badge={f.badge} />
        {f.badge === "Brilliant" && f.last && <BrilliantFx key={`${scene}:${frame}`} square={f.last.to} flipped={false} />}
      </div>
      <div class="ld-reel-tag" aria-live="polite">
        {f.label ? (
          <span class={`ld-reel-chip${f.badge ? ` q-${f.badge}` : ""}`} key={`${scene}:${frame}`}>
            {badge && <img src={badge} alt="" />}
            <b>{f.badge ? classLabel(f.badge) : t("Gespielt")}</b>
            <span>{f.label}</span>
          </span>
        ) : (
          <span class="ld-reel-chip idle">{SCENES[scene].kind === "puzzle" ? t("Aufgabe") : t("Partie")}</span>
        )}
      </div>
      <div class="ld-reel-bar">
        <div class="ld-reel-clips" role="tablist" aria-label={t("Kurzfilme")}>
          {SCENES.map((s, i) => (
            <button key={s.id} role="tab" aria-selected={i === scene} class={i === scene ? "on" : ""} onClick={() => goScene(i)}>
              <span class="ld-reel-name">{s.title}</span>
              <span class="ld-reel-prog">
                <span style={{ width: i < scene ? "100%" : i === scene ? `${(frame / (frames.length - 1)) * 100}%` : "0%" }} />
              </span>
            </button>
          ))}
        </div>
        <div class="ld-reel-ctl">
          <button class="btn small ghost" onClick={() => step(-1)} aria-label={t("Ein Zug zurück")}>
            <IconPrev />
          </button>
          <button class="btn small ghost" onClick={() => setPlaying(!playing)} aria-label={playing ? t("Anhalten") : t("Abspielen")}>
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button class="btn small ghost" onClick={() => step(1)} aria-label={t("Ein Zug vor")}>
            <IconNext />
          </button>
        </div>
      </div>
    </div>
  );
}
