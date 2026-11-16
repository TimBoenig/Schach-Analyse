// The page visitors from social media land on (#/hallo): who we are in one
// screen, a short hands-on intro with Lucena, and one tap into the real app at
// every point. It shows no numbers about anybody: everything on it is either a
// fact about the app or clearly marked as an example.
import { Chess, type Square } from "chess.js";
import { useMemo, useState } from "preact/hooks";

import { BRAND } from "../brand";
import type { Classification } from "../domain/types";
import { type Arrow, Board } from "./Board";
import { COACH_NAME, CoachAvatar, type Mood } from "./Coach";
import { IconBolt, IconChevron, IconCpu, IconInsights, IconPlayers, IconTraining, IconTrophy } from "./icons";
import { PUZZLE_FEN, PUZZLE_HINT } from "./landingPuzzle";
import { Model3D } from "./Model3D";
import { navigate } from "./router";


const STEPS = ["Hallo", "Rätsel", "Was ich kann", "Los"] as const;

type Speed = "bullet" | "blitz" | "rapid" | "daily";
const SPEEDS: { key: Speed; label: string; mood: Mood; reply: string }[] = [
  { key: "bullet", label: "Bullet", mood: "wow", reply: "Schnelle Hände! Bullet blende ich auf Wunsch aus, damit Mausrutscher deine Statistik nicht verzerren." },
  { key: "blitz", label: "Blitz", mood: "happy", reply: "Blitz ist perfekt: genug Partien für klare Muster, genug Zeit für echte Entscheidungen." },
  { key: "rapid", label: "Schnellschach", mood: "think", reply: "Schön, mit Bedenkzeit. Da sehe ich besonders gut, wo du rechnest und wo du dich verrechnest." },
  { key: "daily", label: "Fernschach", mood: "think", reply: "Ganz in Ruhe. Dann schauen wir vor allem auf Eröffnungen und Pläne statt auf die Uhr." },
];

const SKILLS: { id: string; title: string; icon: () => preact.JSX.Element; mood: Mood; text: string }[] = [
  {
    id: "analyse",
    title: "Jede Partie analysieren",
    icon: IconCpu,
    mood: "think",
    text: "Ich hole deine Partien von chess.com oder Lichess und gehe jeden Zug mit einer Schach-Engine durch. Direkt auf deinem Gerät, ohne Wartezeit auf einem Server.",
  },
  {
    id: "profil",
    title: "Dein Profil erkennen",
    icon: IconInsights,
    mood: "happy",
    text: "Aus vielen Partien lese ich Stärken und Schwächen: Eröffnungen, Taktik, Endspiele, Zeitnot. Ein Urteil gibt es erst, wenn genug Partien dafür sprechen.",
  },
  {
    id: "training",
    title: "Gezielt trainieren",
    icon: IconTraining,
    mood: "wow",
    text: "Aus deinen eigenen Fehlern baue ich Aufgaben. Du übst genau die Stellungen, in denen du wirklich Punkte verlierst.",
  },
  {
    id: "liga",
    title: "Mit Freunden messen",
    icon: IconPlayers,
    mood: "happy",
    text: "Füge Freunde hinzu und ihr spielt in einer eigenen Liga: fair verglichen nach Zugqualität, nicht nur nach Wertung.",
  },
];

// German piece letters, so Lucena says "Td8#" like a German scoresheet.
const deSan = (san: string) => san.replace(/[RNBQ]/g, (c) => ({ R: "T", N: "S", B: "L", Q: "D" })[c] ?? c);

function openApp(): void {
  navigate({ view: "home" });
}

/** The mate-in-one board: try a move, Lucena reacts, a hint follows after two misses. */
function Puzzle({ onSolved }: { onSolved: () => void }) {
  const [fen, setFen] = useState(PUZZLE_FEN);
  const [last, setLast] = useState<{ from: string; to: string } | null>(null);
  const [badge, setBadge] = useState<Classification | undefined>();
  const [misses, setMisses] = useState(0);
  const [mood, setMood] = useState<Mood>("think");
  const [say, setSay] = useState("Weiß zieht und setzt matt. Findest du den Zug? Tippe eine Figur an oder zieh sie.");
  const solved = badge === "Brilliant";
  const game = useMemo(() => new Chess(fen), [fen]);

  const onMove = (from: string, to: string): boolean => {
    if (solved) return false;
    const g = new Chess(PUZZLE_FEN);
    let move;
    try {
      move = g.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    setFen(g.fen());
    setLast({ from, to });
    if (g.isCheckmate()) {
      setBadge("Brilliant");
      setMood("wow");
      setSay(`${deSan(move.san)}! Schachmatt. Genau so ein Zug bekommt bei mir dieses Abzeichen.`);
      onSolved();
    } else {
      setBadge("Mistake");
      setMood("sad");
      const n = misses + 1;
      setMisses(n);
      setSay(n >= 2 ? "Fast! Schau auf die Grundreihe: der König kommt nicht raus, seine eigenen Bauern stehen im Weg." : `${deSan(move.san)} ist noch kein Matt. Versuch es nochmal.`);
      window.setTimeout(() => {
        setFen(PUZZLE_FEN);
        setLast(null);
        setBadge(undefined);
        setMood("think");
      }, 1100);
    }
    return true;
  };

  const arrows: Arrow[] = misses >= 2 && !solved ? [{ ...PUZZLE_HINT, kind: "hint" }] : [];
  return (
    <div class="ld-puzzle">
      <div class="ld-board">
        <Board
          fen={fen}
          lastMove={last}
          badge={badge}
          arrows={arrows}
          onMove={solved ? undefined : onMove}
          legalTargets={(sq) => game.moves({ square: sq as Square, verbose: true }).map((m) => m.to)}
        />
      </div>
      <div class="ld-say" aria-live="polite">
        <CoachAvatar mood={mood} size={56} />
        <p>{say}</p>
      </div>
    </div>
  );
}

/** Lucena's guided tour: four short steps, each one asks for a tap. */
function Intro() {
  const [step, setStep] = useState(0);
  const [speed, setSpeed] = useState<Speed | null>(null);
  const [solved, setSolved] = useState(false);
  const [skill, setSkill] = useState<string | null>(null);
  const [seen, setSeen] = useState<string[]>([]);

  const pickedSpeed = SPEEDS.find((s) => s.key === speed);
  const pickedSkill = SKILLS.find((s) => s.id === skill);
  const mood: Mood = step === 0 ? (pickedSpeed?.mood ?? "happy") : step === 2 ? (pickedSkill?.mood ?? "happy") : step === 3 ? "wow" : "think";
  const canNext = step === 0 ? Boolean(speed) : step === 1 ? solved : step === 2 ? seen.length >= 2 : false;

  return (
    <section class="ld-intro" id="einfuehrung" aria-label={`Einführung mit ${COACH_NAME}`}>
      <ol class="ld-steps" aria-label="Schritte">
        {STEPS.map((s, i) => (
          <li key={s} class={i === step ? "on" : i < step ? "done" : ""}>
            <button onClick={() => i < step && setStep(i)} disabled={i > step} aria-current={i === step ? "step" : undefined}>
              <span class="ld-step-dot">{i + 1}</span>
              <span class="ld-step-label">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div class="ld-stage" key={step}>
        {step === 0 && (
          <div class="ld-chat">
            <div class="ld-lucena-big">
              <CoachAvatar mood={mood} size={132} />
            </div>
            <h2>Hi, ich bin {COACH_NAME}.</h2>
            <p class="ld-lead">Ich bin die KI, die deine Partien liest. Erzähl mir kurz: was spielst du am liebsten?</p>
            <div class="ld-chips" role="group" aria-label="Lieblingstempo">
              {SPEEDS.map((s) => (
                <button key={s.key} class={`ld-chip${speed === s.key ? " on" : ""}`} aria-pressed={speed === s.key} onClick={() => setSpeed(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            {pickedSpeed && (
              <p class="ld-reply" aria-live="polite">
                {pickedSpeed.reply}
              </p>
            )}
          </div>
        )}

        {step === 1 && <Puzzle onSolved={() => setSolved(true)} />}

        {step === 2 && (
          <div class="ld-skills-wrap">
            <div class="ld-say">
              <CoachAvatar mood={mood} size={56} />
              <p>{pickedSkill ? pickedSkill.text : "Das kann ich für dich tun. Tippe auf eine Karte."}</p>
            </div>
            <div class="ld-skills">
              {SKILLS.map((s) => (
                <button
                  key={s.id}
                  class={`ld-skill${skill === s.id ? " on" : ""}${seen.includes(s.id) ? " seen" : ""}`}
                  aria-pressed={skill === s.id}
                  onClick={() => {
                    setSkill(s.id);
                    setSeen((v) => (v.includes(s.id) ? v : [...v, s.id]));
                  }}
                >
                  <span class="ld-skill-icon">
                    <s.icon />
                  </span>
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div class="ld-chat">
            <div class="ld-lucena-big">
              <CoachAvatar mood="wow" size={132} />
            </div>
            <h2>{solved ? "Starker Zug vorhin." : "Bereit?"} Jetzt deine Partien.</h2>
            <p class="ld-lead">Gib deinen Namen von chess.com oder Lichess ein, ich lade deine Partien und lege los. Kostenlos, ohne Anmeldung.</p>
            <div class="ld-cta-row">
              <button class="btn primary big ld-cta" onClick={() => navigate({ view: "games", import: true })}>
                Meine Partien laden
                <IconChevron />
              </button>
              <button class="btn big" onClick={openApp}>
                Erst umschauen
              </button>
            </div>
          </div>
        )}
      </div>

      {step < 3 && (
        <div class="ld-next">
          <button class="ld-skip" onClick={openApp}>
            Einführung überspringen
          </button>
          <button class="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Weiter
            <IconChevron />
          </button>
        </div>
      )}
    </section>
  );
}

const FEATURES: { icon: () => preact.JSX.Element; title: string; text: string }[] = [
  { icon: IconCpu, title: "Engine auf deinem Gerät", text: "Die Analyse läuft im Browser. Deine Partien bleiben bei dir, auch offline." },
  { icon: IconInsights, title: "Statistiken mit Beleg", text: "Jede Aussage nennt, auf wie vielen Partien sie beruht. Kein Raten aus drei Spielen." },
  { icon: IconTraining, title: "Training aus deinen Fehlern", text: "Tägliche Einheiten mit Aufgaben aus deinen eigenen Partien." },
  { icon: IconTrophy, title: "Liga mit Freunden", text: "Vergleiche dich fair mit deinen Freunden, nach Zugqualität und Ergebnissen." },
];

export function LandingView() {
  return (
    <div class="landing">
      <header class="ld-top">
        <a class="ld-brand" href="#/hallo" aria-label={BRAND}>
          <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          <span>{BRAND}</span>
        </a>
        <button class="btn primary ld-open" onClick={openApp}>
          Zur App
          <IconChevron />
        </button>
      </header>

      <section class="ld-hero">
        <div class="ld-hero-glow" aria-hidden="true" />
        <div class="ld-hero-text">
          <p class="ld-kicker">Dein persönlicher Schach-Coach</p>
          <h1>
            Finde heraus, <em>warum</em> du verlierst.
          </h1>
          <p class="ld-lead">{BRAND} analysiert deine Partien von chess.com und Lichess, zeigt dir deine echten Stärken und Schwächen und trainiert genau das, was dich Punkte kostet.</p>
          <div class="ld-cta-row">
            <a class="btn primary big ld-cta" href="#einfuehrung" onClick={(e) => { e.preventDefault(); document.getElementById("einfuehrung")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
              <IconBolt />
              60 Sekunden mit {COACH_NAME}
            </a>
            <button class="btn big" onClick={openApp}>
              Direkt zur App
            </button>
          </div>
          <p class="ld-fine">Kostenlos · ohne Anmeldung · läuft im Browser</p>
        </div>
        <div class="ld-hero-art" aria-hidden="true">
          <div class="ld-orbit">
            <CoachAvatar mood="happy" size={220} />
          </div>
          <Model3D kind="king" size={120} class="ld-king" />
        </div>
      </section>

      <Intro />

      <section class="ld-features" aria-label="Was dich erwartet">
        {FEATURES.map((f) => (
          <div class="ld-feature" key={f.title}>
            <span class="ld-skill-icon">
              <f.icon />
            </span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      <section class="ld-final">
        <Model3D kind="trophy" size={110} />
        <h2>Bereit für deine erste Analyse?</h2>
        <button class="btn primary big ld-cta" onClick={openApp}>
          {BRAND} öffnen
          <IconChevron />
        </button>
      </section>

      <footer class="ld-foot faint small">
        <a href="#/rechtliches">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a>
      </footer>
    </div>
  );
}
