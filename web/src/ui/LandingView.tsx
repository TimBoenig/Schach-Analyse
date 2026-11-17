// The page visitors from social media land on (#/hello): who we are in one
// screen, how the app works, and one tap into Lucena's guided start or the
// app itself at every point.
import { BRAND } from "../brand";
import { COACH_NAME, CoachAvatar } from "./Coach";
import { IconBolt, IconChevron, IconCpu, IconInsights, IconTraining, IconTrophy } from "./icons";
import { LandingHow } from "./LandingHow";
import { Model3D } from "./Model3D";
import { navigate } from "./router";
import { openStage } from "./stage/store";

function openApp(): void {
  navigate({ view: "home" });
}

/** Lucena's guided start, fullscreen: the same one a new device gets inside the app. */
function startWithLucena(): void {
  openStage({ kind: "onboarding" });
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
        <a class="ld-brand" href="#/hello" aria-label={BRAND}>
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
            <button class="btn primary big ld-cta" onClick={startWithLucena}>
              <IconBolt />
              Mit {COACH_NAME} loslegen
            </button>
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

      <LandingHow />

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
        <div class="ld-cta-row">
          <button class="btn primary big ld-cta" onClick={startWithLucena}>
            Mit {COACH_NAME} loslegen
            <IconChevron />
          </button>
          <button class="btn big" onClick={openApp}>
            {BRAND} öffnen
          </button>
        </div>
      </section>

      <footer class="ld-foot faint small">
        <a href="#/rechtliches">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a>
      </footer>
    </div>
  );
}
