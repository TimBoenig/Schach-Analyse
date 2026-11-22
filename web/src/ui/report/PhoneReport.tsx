// The game report on a phone: one small section at a time instead of a page
// of cards. The chips switch the section; the moments are cards you swipe,
// and the board follows the card you stop on. The winning-chance line is a
// picture only here: scrubbing it with a finger fought with scrolling.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { type GameReview, type Standing, winCurve } from "../../domain/profile";
import type { MoveData } from "../../domain/types";
import { COACH_NAME, CoachAvatar } from "../Coach";
import { IconChevron, IconClose, IconPlay } from "../icons";
import { badgeFor, CLASS_COLOR, classLabel } from "../labels";
import { openStage } from "../stage/store";
import { Level } from "../viz/Bars";
import { GradeBadge, ownErrors, PhaseRows, practiseGame, StandingLine } from "./ReportPanel";
import { WinChart } from "./WinChart";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const pct = (wp: number) => `${Math.round(wp * 100)} %`;

export type SheetPart = "move" | "sum" | "moments" | "course" | "phases" | "end" | "list";
type Part = SheetPart;
const PARTS: [Part, string][] = [
  ["move", "Zug"],
  ["sum", "Überblick"],
  ["moments", "Momente"],
  ["course", "Verlauf"],
  ["phases", "Phasen"],
  ["end", "Fazit"],
  ["list", "Züge"],
];

/** Swipeable cards of the moments that decided the game; the board follows the card in view. */
function Moments({ review, idx, onPeek, onJump }: { review: GameReview; idx: number; onPeek: (stop: number) => void; onJump: (stop: number) => void }) {
  const moments = [...review.key_moments].sort((a, b) => a.ply_index - b.ply_index);
  const strip = useRef<HTMLDivElement>(null);
  // Scrolls we start ourselves (the board moved by other means) must not move the board back.
  const own = useRef(false);
  const settle = useRef<number | null>(null);
  const activeAt = moments.findIndex((k) => k.ply_index + 1 === idx);
  const [shown, setShown] = useState(Math.max(0, activeAt));
  const scrollTo = (i: number, behavior: ScrollBehavior) => {
    const box = strip.current;
    const el = box?.children[Math.max(0, Math.min(moments.length - 1, i))] as HTMLElement | undefined;
    if (box && el) box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior });
  };
  useEffect(() => {
    if (activeAt < 0) return;
    setShown(activeAt);
    own.current = true;
    scrollTo(activeAt, "smooth");
    const t = window.setTimeout(() => (own.current = false), 600);
    return () => window.clearTimeout(t);
  }, [activeAt]);
  // The card nearest the middle is the one the player means.
  const onScroll = () => {
    const box = strip.current;
    if (!box) return;
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const mid = box.scrollLeft + box.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      Array.from(box.children).forEach((c, i) => {
        const el = c as HTMLElement;
        const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setShown(best);
      if (!own.current && moments[best] && moments[best].ply_index + 1 !== idx) onPeek(moments[best].ply_index + 1);
    }, 120);
  };
  if (!moments.length) return <p class="pr-note">In dieser Partie gab es keine großen Wendungen.</p>;
  return (
    <div class="pr-moments">
      <div class="pr-moments-head">
        <span class="pr-count tnum">
          {shown + 1} von {moments.length}
        </span>
        <span class="pr-moments-hint">Wische durch die Karten, das Brett folgt.</span>
        <button class="btn icon small ghost" aria-label="Voriger Moment" disabled={shown <= 0} onClick={() => scrollTo(shown - 1, "smooth")}>
          <span class="flip-x">
            <IconChevron />
          </span>
        </button>
        <button class="btn icon small ghost" aria-label="Nächster Moment" disabled={shown >= moments.length - 1} onClick={() => scrollTo(shown + 1, "smooth")}>
          <IconChevron />
        </button>
      </div>
      <div class="pr-strip" ref={strip} onScroll={onScroll}>
        {moments.map((k) => {
          const badge = badgeFor(k.classification as never);
          const up = k.wp_after >= k.wp_before;
          return (
            <button key={k.ply_index} class={`pr-card${k.by_user ? " own" : ""}${k.ply_index + 1 === idx ? " on" : ""}`} style={{ "--tone": CLASS_COLOR[k.classification] ?? "var(--text-3)" }} onClick={() => onJump(k.ply_index + 1)}>
              <span class="pr-card-top">
                {badge && <img src={badge} alt={classLabel(k.classification as never)} width={22} height={22} />}
                <strong>{k.move_label}</strong>
                <span class={`pr-swing ${up ? "up" : "down"} tnum`}>
                  {pct(k.wp_before)} <IconChevron /> {pct(k.wp_after)}
                </span>
              </span>
              <span class="pr-card-text">{k.text}</span>
              {k.by_user && k.best_move_san && <span class="pr-card-best">Besser: {k.best_move_san}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PhoneReport({
  gameId,
  review,
  moves,
  isWhite,
  names,
  speed,
  standing,
  idx,
  onJump,
  onPeek,
  details,
  part,
  onPart,
  onClose,
  moveView,
  listView,
}: {
  gameId: string;
  review: GameReview | null;
  moves: MoveData[];
  isWhite: boolean;
  names: { me: string; opp: string };
  speed: string | null;
  standing: Standing | null;
  idx: number;
  /** Tapped moment: the board moves and comes into view. */
  onJump: (stop: number) => void;
  /** Swiped to a moment: the board moves, the page stays. */
  onPeek: (stop: number) => void;
  details?: ComponentChildren;
  part: SheetPart;
  onPart: (p: SheetPart) => void;
  onClose: () => void;
  /** The shown move explained, with its engine lines. */
  moveView: ComponentChildren;
  /** The list of all moves. */
  listView: ComponentChildren;
}) {
  const errors = review ? ownErrors(review) : 0;
  const counts = review?.move_counts ?? {};
  const tiles: [string, number, string][] = [
    ["Glanzzüge", (counts.Brilliant ?? 0) + (counts.Great ?? 0), "good"],
    ["Ungenau", counts.Inaccuracy ?? 0, "warn"],
    ["Fehler", (counts.Mistake ?? 0) + (counts.Miss ?? 0), "bad"],
    ["Patzer", counts.Blunder ?? 0, "bad"],
  ];
  return (
    <div class="pr">
      <div class="pr-chips-row">
        <div class="pr-chips" role="tablist">
          {PARTS.filter(([id]) => review || id === "move" || id === "list").map(([id, label]) => (
            <button key={id} role="tab" aria-selected={part === id} class={part === id ? "on" : ""} onClick={() => onPart(id)}>
              {label}
            </button>
          ))}
        </div>
        <button class="btn icon small ghost pr-close" aria-label="Schließen" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div class="pr-body">
        {part === "move" && <div class="pr-move">{moveView}</div>}
        {part === "list" && <div class="pr-list">{listView}</div>}
        {review && part === "sum" && (
          <div class="pr-sum">
            <div class="pr-sum-top">
              <GradeBadge grade={review.grade} size="small" />
              <div class="pr-sum-text">
                <strong>{review.headline}</strong>
                <span class="faint">{review.result_text}</span>
              </div>
            </div>
            <StandingLine standing={standing} speed={speed} />
            <div class="pr-duel">
              <div class="me">
                <span>{names.me}</span>
                <Level value={review.accuracy || null} tone="accent" />
                <b class="tnum">{review.accuracy ? `${de(review.accuracy)} %` : "–"}</b>
              </div>
              <div>
                <span>{names.opp}</span>
                <Level value={review.opponent_accuracy || null} tone="quiet" />
                <b class="tnum">{review.opponent_accuracy ? `${de(review.opponent_accuracy)} %` : "–"}</b>
              </div>
            </div>
            <div class="pr-tiles">
              {tiles.map(([label, n, tone]) => (
                <div key={label} class={`pr-tile ${n ? tone : "zero"}`}>
                  <b class="tnum">{n}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div class="pr-actions">
              <button class="btn primary small" onClick={() => openStage({ kind: "report", subject: gameId })}>
                <CoachAvatar mood="happy" size={18} />
                {COACH_NAME} erklärt
              </button>
              {errors > 0 && (
                <button class="btn small" onClick={() => practiseGame(gameId)}>
                  <IconPlay /> Fehler üben
                </button>
              )}
            </div>
          </div>
        )}
        {review && part === "moments" && <Moments review={review} idx={idx} onPeek={onPeek} onJump={onJump} />}
        {review && part === "course" && (
          <div class="pr-course">
            <WinChart points={winCurve(moves, isWhite)} plies={moves.length} moments={review.key_moments} turning={review.turning_point} cursor={idx} height={132} />
            <p class="pr-note">Deine Gewinnchance nach jedem Zug.{review.turning_point ? ` Wendepunkt: ${review.turning_point.move_label}.` : ""}</p>
            {review.turning_point && (
              <button class="btn small" onClick={() => onJump(review.turning_point!.ply_index + 1)}>
                Zum Wendepunkt <IconChevron />
              </button>
            )}
          </div>
        )}
        {review && part === "phases" && <PhaseRows review={review} />}
        {review && part === "end" && (
          <div class="pr-end">
            <ul class="fd-list">
              {review.positives.map((t) => (
                <li class="fd-item pos" key={t}>
                  <span class="fd-mark" aria-hidden="true" />
                  <div>{t}</div>
                </li>
              ))}
              {review.negatives.map((t) => (
                <li class="fd-item neg" key={t}>
                  <span class="fd-mark" aria-hidden="true" />
                  <div>{t}</div>
                </li>
              ))}
            </ul>
            {review.lessons.length > 0 && (
              <div class="rp-lessons">
                <span class="eyebrow">Was du mitnehmen kannst</span>
                <ol>
                  {review.lessons.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ol>
              </div>
            )}
            <div class="rp-details">{details}</div>
          </div>
        )}
      </div>
    </div>
  );
}
