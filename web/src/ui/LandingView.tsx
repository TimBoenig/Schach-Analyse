// The page visitors from social media land on (#/hallo): who we are in one
// screen, a short hands-on intro with Lucena, and one tap into the real app at
// every point. The only numbers about a person are the visitor's own, counted
// from the games they just imported.
import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { autoAnalyze } from "../app/analysisService";
import { importAccount, type Site } from "../app/accountImport";
import { BRAND } from "../brand";
import { type FirstLook, firstLook } from "../domain/firstLook";
import type { Classification } from "../domain/types";
import { type Arrow, Board } from "./Board";
import { COACH_NAME, CoachAvatar, type Mood } from "./Coach";
import { IconBolt, IconChevron, IconCpu, IconInsights, IconTraining, IconTrophy } from "./icons";
import { PUZZLE_FEN, PUZZLE_HINT } from "./landingPuzzle";
import { Model3D } from "./Model3D";
import { navigate } from "./router";
import { getSetting } from "../storage/db";


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

const STEPS = ["Hallo", "Dein Name", "Deine Partien", "Los"] as const;

type Pick = Site | "none";
const SITES: { key: Pick; label: string }[] = [
  { key: "chesscom", label: "chess.com" },
  { key: "lichess", label: "Lichess" },
  { key: "none", label: "Noch nirgends" },
];
const SITE_LABEL: Record<Site, string> = { chesscom: "chess.com", lichess: "Lichess" };

type Load = { phase: "idle" } | { phase: "busy"; label: string; found: number } | { phase: "done"; look: FirstLook; queued: boolean } | { phase: "error"; message: string };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

/**
 * Lucena's guided start: where do you play, what's your name, then the visitor's
 * own games arrive while they solve a puzzle, and Lucena sums up what it found.
 * Everything he says about the visitor comes from their imported games.
 */
function Intro() {
  const [step, setStep] = useState(0);
  const [site, setSite] = useState<Pick | null>(null);
  const [name, setName] = useState("");
  const [load, setLoad] = useState<Load>({ phase: "idle" });
  const [solved, setSolved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLElement>(null);

  useEffect(() => {
    void getSetting<Record<string, string>>("import.lastUser", {}).then((u) => {
      const known = (["chesscom", "lichess"] as const).find((s) => u[s]);
      if (known) setName((n) => n || u[known]);
    });
  }, []);
  useEffect(() => {
    if (step === 1) window.setTimeout(() => input.current?.focus({ preventScroll: true }), 350);
    // On phones a new step starts at the top of the card, not half-scrolled.
    if (step > 0) top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const pickSite = (s: Pick) => {
    setSite(s);
    window.setTimeout(() => setStep(s === "none" ? 2 : 1), 450);
  };

  const fetchGames = async () => {
    if (site !== "chesscom" && site !== "lichess") return;
    const who = name.trim();
    if (!who) return;
    setStep(2);
    setLoad({ phase: "busy", label: "Suche dein Konto …", found: 0 });
    let found = 0;
    try {
      const { games } = await importAccount(site, who, {
        months: 3,
        count: 100,
        onProgress: (label) => setLoad({ phase: "busy", label, found }),
        onStored: (batch) => {
          found += batch.length;
          setLoad((l) => (l.phase === "busy" ? { ...l, found } : l));
        },
      });
      const look = firstLook(games, who);
      const queued = games.length ? await autoAnalyze(games.map((g) => g.game_id)).catch(() => false) : false;
      setLoad({ phase: "done", look, queued });
    } catch (e) {
      setLoad({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const noAccount = site === "none";
  const busy = load.phase === "busy";
  const done = load.phase === "done";
  const look = done ? load.look : null;
  const mood: Mood =
    step === 0 ? (site ? "wow" : "happy")
    : step === 1 ? (name.trim() ? "happy" : "think")
    : step === 2 ? (load.phase === "error" || (look && !look.games) ? "sad" : done || solved ? "wow" : "think")
    : "wow";

  let say: string;
  if (noAccount) say = solved ? "Stark! Leg dir ein Konto bei chess.com oder Lichess an, spiel ein paar Partien, und ich analysiere jede davon." : "Kein Problem. Dann zeig mir kurz, was du draufhast:";
  else if (load.phase === "error") say = load.message;
  else if (busy) say = `${load.label} ${load.found ? `${plural(load.found, "Partie", "Partien")} gefunden.` : ""} Löse solange dieses Rätsel:`;
  else if (look && !look.games) say = `Ich habe bei ${SITE_LABEL[site as Site]} unter „${name.trim()}“ in den letzten Monaten keine Partien gefunden. Stimmt der Name?`;
  else if (look)
    say = `${plural(look.games, "Partie", "Partien")} geladen: ${plural(look.wins, "Sieg", "Siege")}, ${plural(look.draws, "Remis", "Remis")}, ${plural(look.losses, "Niederlage", "Niederlagen")}. ${
      load.phase === "done" && load.queued ? "Ich gehe jetzt jeden Zug mit der Engine durch, das läuft im Hintergrund weiter." : "Jetzt kannst du sie analysieren lassen."
    }`;
  else say = "Löse solange dieses Rätsel:";

  const canNext = step === 2 && (noAccount ? solved : done && Boolean(look?.games));

  return (
    <section class="ld-intro" id="einfuehrung" ref={top} aria-label={`Einführung mit ${COACH_NAME}`}>
      <ol class="ld-steps" aria-label="Schritte">
        {STEPS.map((s, i) => (
          <li key={s} class={i === step ? "on" : i < step ? "done" : ""}>
            <button onClick={() => i < step && !busy && setStep(i)} disabled={i > step} aria-current={i === step ? "step" : undefined}>
              <span class="ld-step-dot">{i + 1}</span>
              <span class="ld-step-label">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div class="ld-stage" key={step}>
        {step === 0 && (
          <div class="ld-chat">
            <div class="ld-mike-big">
              <CoachAvatar mood={mood} size={132} />
            </div>
            <h2>Hi, ich bin {COACH_NAME}.</h2>
            <p class="ld-lead">Ich bin die KI, die deine Partien liest und dir sagt, woran du wirklich Punkte verlierst. Wo spielst du?</p>
            <div class="ld-chips" role="group" aria-label="Wo spielst du?">
              {SITES.map((s) => (
                <button key={s.key} class={`ld-chip${site === s.key ? " on" : ""}`} aria-pressed={site === s.key} onClick={() => pickSite(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <form
            class="ld-chat"
            onSubmit={(e) => {
              e.preventDefault();
              void fetchGames();
            }}
          >
            <div class="ld-mike-big">
              <CoachAvatar mood={mood} size={110} />
            </div>
            <h2>Wie heißt du bei {SITE_LABEL[site as Site]}?</h2>
            <p class="ld-lead">Ich hole deine öffentlichen Partien der letzten Monate. Sie bleiben auf deinem Gerät, ein Konto bei uns brauchst du nicht.</p>
            <div class="ld-name">
              <input
                ref={input}
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder="Dein Benutzername"
                autocomplete="username"
                autocapitalize="off"
                spellcheck={false}
                enterkeyhint="go"
                aria-label={`Benutzername bei ${SITE_LABEL[site as Site]}`}
              />
              <button class="btn primary big ld-cta" type="submit" disabled={!name.trim()}>
                Partien holen
                <IconChevron />
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div class="ld-loadstep">
            <div class="ld-say" aria-live="polite">
              <CoachAvatar mood={mood} size={56} />
              <div class="ld-say-body">
                <p>{say}</p>
                {busy && <div class="ld-progress" aria-hidden="true"><span /></div>}
                {look && look.games > 0 && (
                  <div class="ld-wdl" aria-hidden="true">
                    <span class="w" style={{ flex: look.wins || 0.001 }} />
                    <span class="d" style={{ flex: look.draws || 0.001 }} />
                    <span class="l" style={{ flex: look.losses || 0.001 }} />
                  </div>
                )}
                {(load.phase === "error" || (look && !look.games)) && (
                  <button class="btn" onClick={() => { setLoad({ phase: "idle" }); setStep(1); }}>
                    Namen ändern
                  </button>
                )}
              </div>
            </div>
            <Puzzle onSolved={() => setSolved(true)} />
          </div>
        )}

        {step === 3 && (
          <div class="ld-chat">
            <div class="ld-mike-big">
              <CoachAvatar mood="wow" size={132} />
            </div>
            <h2>{noAccount ? "Bis bald am Brett." : "Dein Profil wartet."}</h2>
            <p class="ld-lead">
              {noAccount
                ? "Schau dich schon mal um. Sobald du Partien hast, holst du sie mit einem Tipp."
                : "Je mehr Partien die Engine durchgeht, desto genauer werden deine Stärken und Schwächen. Du kannst schon jetzt reinschauen."}
            </p>
            <div class="ld-cta-row">
              <button class="btn primary big ld-cta" onClick={openApp}>
                {noAccount ? `${BRAND} öffnen` : "Mein Profil ansehen"}
                <IconChevron />
              </button>
              {!noAccount && (
                <button class="btn big" onClick={() => navigate({ view: "games" })}>
                  Meine Partien
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {step < 3 && (
        <div class="ld-next">
          <button class="ld-skip" onClick={openApp}>
            Einführung überspringen
          </button>
          {step === 2 && (
            <button class="btn primary" disabled={!canNext} onClick={() => setStep(3)}>
              Weiter
              <IconChevron />
            </button>
          )}
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
              Mit {COACH_NAME} loslegen
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
