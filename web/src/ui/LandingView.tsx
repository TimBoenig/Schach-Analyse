// The front door: what new visitors see first (at "/" on a fresh device, and
// at /hello from social media). It lets them try the product before asking for
// anything: Lucena sets a puzzle in the hero, a slider shows why many games
// beat one, the sample report and the 3D king and cup show what they get.
// Price, privacy and the person behind it are answered where a visitor looks
// for them; the founder only shows when someone opens that question.
import type { ComponentChildren } from "preact";

import { BRAND, SUPPORT_EMAIL } from "../brand";
import { COACH_NAME, CoachAvatar } from "./Coach";
import { IconBolt, IconChevron, IconShield } from "./icons";
import { MAKER, PRICE, QUOTES } from "./landing/content";
import { HeroStage } from "./landing/HeroStage";
import { CompareTable, PatternLab } from "./landing/PatternLab";
import { Privacy } from "./landing/Privacy";
import { Specimen } from "./landing/Specimen";
import { Model3D } from "./Model3D";
import { navigate } from "./router";
import { markSeen, openStage } from "./stage/store";

/** Marks the front door as seen, so the next visit at "/" opens the app. */
function openApp(): void {
  markSeen("landing");
  navigate({ view: "home" });
}

/** Lucena's guided start, fullscreen: the same one a new device gets inside the app. */
function startAnalysis(): void {
  markSeen("landing");
  openStage({ kind: "onboarding" });
}

function scrollTo(id: string): void {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

const STEPS: { title: string; text: string }[] = [
  { title: "Namen eingeben", text: "Dein Benutzername bei chess.com oder Lichess. Kein Passwort, keine Anmeldung." },
  { title: "Partien lesen lassen", text: `${COACH_NAME} lädt deine Partien und prüft jeden Zug, erst schnell, dann gründlich.` },
  { title: "Ersten Befund ansehen", text: "Nach wenigen Minuten siehst du deinen teuersten Fehler und was sich wiederholt." },
  { title: "Gezielt trainieren", text: "Aus deinen Fehlstellungen werden Aufgaben, ein paar Minuten am Tag." },
];

function Faq({ q, children, open = false }: { q: string; children: ComponentChildren; open?: boolean }) {
  return (
    <details class="ld-faq-item" open={open}>
      <summary>
        <span>{q}</span>
        <IconChevron />
      </summary>
      <div class="ld-faq-body">{children}</div>
    </details>
  );
}

export function LandingView() {
  return (
    <div class="landing">
      <header class="ld-top">
        <a class="ld-brand" href="#/hello" aria-label={BRAND}>
          <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          <span>{BRAND}</span>
        </a>
        <nav class="ld-nav" aria-label="Abschnitte">
          <button onClick={() => scrollTo("vergleich")}>Vergleich</button>
          <button onClick={() => scrollTo("datenschutz")}>Datenschutz</button>
          <button onClick={() => scrollTo("fragen")}>Fragen</button>
        </nav>
        <button class="btn ld-open" onClick={openApp}>
          Zur App
        </button>
      </header>

      <section class="ld-hero">
        <div class="ld-hero-text">
          <h1>Dein Schach hat ein Muster. Lucena findet es.</h1>
          <p class="ld-lead">
            {BRAND} liest alle deine Partien von chess.com und Lichess, findet die Fehler, die sich bei dir wiederholen, und macht daraus dein Training. Mit deinen eigenen Stellungen statt zufälliger Rätsel.
          </p>
          <div class="ld-cta-row">
            <button class="btn primary big ld-cta" onClick={startAnalysis}>
              <IconBolt />
              Meine Partien analysieren
            </button>
            <button class="btn big ld-ghost" onClick={() => scrollTo("vergleich")}>
              Warum viele Partien?
            </button>
          </div>
          <p class="ld-assure">
            <IconShield />
            <span>{PRICE.headline} Ohne Anmeldung. Die Analyse läuft auf deinem Gerät.</span>
          </p>
        </div>
        <HeroStage />
      </section>

      <section class="ld-why" id="vergleich" aria-labelledby="ld-why-title">
        <div class="ld-why-head">
          <h2 id="ld-why-title">Eine Partie zeigt dir einen Fehler. Viele Partien zeigen dir dein Muster.</h2>
          <p class="ld-lead">Die Analyse nach der Partie ist gut für den Moment. Woran du arbeiten solltest, sieht man erst über viele Partien. Wähl, wie viele Partien gelesen werden, und schau, wie sich das Bild verändert.</p>
        </div>
        <div class="ld-why-grid">
          <PatternLab />
          <CompareTable />
        </div>
      </section>

      <section class="ld-get" aria-labelledby="ld-get-title">
        <div class="ld-get-text">
          <h2 id="ld-get-title">Dein Profil, aus jeder Partie, die du gespielt hast.</h2>
          <p class="ld-lead">In welcher Phase du Punkte verlierst, welche Eröffnungen dir liegen, welcher Zug dich am meisten gekostet hat. Jede Aussage nennt, auf wie vielen Partien sie beruht.</p>
          <div class="ld-get-king">
            <Model3D kind="king" size={150} label="Schachkönig in 3D, zum Drehen ziehen" />
            <span>Zieh am König, er dreht sich.</span>
          </div>
        </div>
        <Specimen />
      </section>

      <section class="ld-league" aria-labelledby="ld-league-title">
        <div class="ld-league-cup">
          <Model3D kind="trophy" size={220} label="Pokal in 3D, zum Drehen ziehen" />
        </div>
        <div class="ld-league-text">
          <h2 id="ld-league-title">Spiel um den Pokal, gegen deine Freunde.</h2>
          <p class="ld-lead">Füge Freunde hinzu und ihr spielt eine eigene Liga. Gewertet werden Ergebnisse und Zugqualität, fair gerechnet, auch wenn einer nur Blitz und der andere Schnellschach spielt.</p>
          <ul class="ld-league-points">
            <li>Tabelle mit Spielstärke, Form und Rekorden</li>
            <li>Duell-Seite für jeden Freund: wer wo besser ist</li>
            <li>Was dir für den nächsten Platz fehlt</li>
          </ul>
        </div>
      </section>

      <section class="ld-steps" aria-labelledby="ld-steps-title">
        <h2 id="ld-steps-title">In wenigen Minuten zum ersten Befund.</h2>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span class="ld-step-no" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section class="ld-private" id="datenschutz" aria-labelledby="ld-private-title">
        <div class="ld-private-text">
          <h2 id="ld-private-title">Deine Partien gehören dir.</h2>
          <p class="ld-lead">Die Schach-Engine rechnet in deinem Browser. Ein Konto brauchst du nur, wenn du deine Analysen auf mehreren Geräten haben willst.</p>
          <a class="ld-link" href="#/rechtliches/datenschutz">
            Datenschutzerklärung lesen
          </a>
        </div>
        <Privacy />
      </section>

      {QUOTES.length > 0 && (
        <section class="ld-quotes" aria-label="Was Spieler sagen">
          {QUOTES.map((q) => (
            <blockquote key={q.who}>
              <p>{q.text}</p>
              <cite>{q.who}</cite>
            </blockquote>
          ))}
        </section>
      )}

      <section class="ld-faq" id="fragen" aria-labelledby="ld-faq-title">
        <h2 id="ld-faq-title">Fragen, bevor du loslegst</h2>
        <div class="ld-faq-list">
          <Faq q="Was kostet das?" open>
            <p>{PRICE.text}</p>
          </Faq>
          <Faq q="Brauche ich ein Konto?">
            <p>Nein. Dein Benutzername bei chess.com oder Lichess reicht. Ein Konto ist freiwillig und nur dafür da, deine Analysen auf Handy und PC gleich zu haben.</p>
          </Faq>
          <Faq q="Wie lange dauert die erste Analyse?">
            <p>Den ersten Überblick hast du nach wenigen Minuten. Danach prüft die Engine im Hintergrund gründlicher, während du dich schon umsiehst.</p>
          </Faq>
          <Faq q="Funktioniert das auf dem Handy?">
            <p>Ja. {BRAND} läuft im Browser auf Handy, Tablet und PC und lässt sich wie eine App auf den Startbildschirm legen.</p>
          </Faq>
          <Faq q="Wer steckt dahinter?">
            <div class="ld-maker">
              <span class="ld-maker-mark" aria-hidden="true">
                {MAKER.initials}
              </span>
              <div>
                <b>{MAKER.name}</b>
                <span>{MAKER.place}</span>
              </div>
            </div>
            <p>{MAKER.text}</p>
            <a class="ld-link" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </Faq>
        </div>
      </section>

      <section class="ld-final">
        <CoachAvatar mood="happy" size={96} />
        <h2>Finde heraus, was dich Punkte kostet.</h2>
        <p class="ld-lead">Namen eingeben, {COACH_NAME} holt deine Partien und zeigt dir den ersten Befund.</p>
        <button class="btn primary big ld-cta" onClick={startAnalysis}>
          Meine Partien analysieren
          <IconChevron />
        </button>
      </section>

      <footer class="ld-foot">
        <a href="#/rechtliches">Impressum</a>
        <a href="#/rechtliches/datenschutz">Datenschutz</a>
        <button onClick={openApp}>{BRAND} öffnen</button>
      </footer>
    </div>
  );
}
