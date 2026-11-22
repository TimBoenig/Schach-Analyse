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
import { LangToggle } from "./LangSwitch";
import { navigate } from "./router";
import { markSeen, openStage } from "./stage/store";
import { t } from "../i18n";

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
  { title: t("Namen eingeben"), text: t("Dein Benutzername bei chess.com oder Lichess. Kein Passwort, keine Anmeldung.") },
  { title: t("Partien lesen lassen"), text: t("{COACH_NAME} lädt deine Partien und prüft jeden Zug, erst schnell, dann gründlich.", { COACH_NAME }) },
  { title: t("Ersten Befund ansehen"), text: t("Nach wenigen Minuten siehst du deinen teuersten Fehler und was sich wiederholt.") },
  { title: t("Gezielt trainieren"), text: t("Aus deinen Fehlstellungen werden Aufgaben, ein paar Minuten am Tag.") },
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
        <nav class="ld-nav" aria-label={t("Abschnitte")}>
          <button onClick={() => scrollTo("vergleich")}>{t("Vergleich")}</button>
          <button onClick={() => scrollTo("datenschutz")}>{t("Datenschutz")}</button>
          <button onClick={() => scrollTo("fragen")}>{t("Fragen")}</button>
        </nav>
        <LangToggle class="ld-lang" />
        <button class="btn ld-open" onClick={openApp}>
          {t("Zur App")}
        </button>
      </header>

      <section class="ld-hero">
        <div class="ld-hero-text">
          <h1>{t("Dein Schach hat ein Muster. {COACH_NAME} findet es.", { COACH_NAME })}</h1>
          <p class="ld-lead">
            {t("{BRAND} liest alle deine Partien von chess.com und Lichess, findet die Fehler, die sich bei dir wiederholen, und macht daraus dein Training. Mit deinen eigenen Stellungen statt zufälliger Rätsel.", { BRAND })}
          </p>
          <div class="ld-cta-row">
            <button class="btn primary big ld-cta" onClick={startAnalysis}>
              <IconBolt />
              {t("Meine Partien analysieren")}
            </button>
            <button class="btn big ld-ghost" onClick={() => scrollTo("vergleich")}>
              {t("Warum viele Partien?")}
            </button>
          </div>
          <p class="ld-assure">
            <IconShield />
            <span>{t("Kostenlos. Ohne Anmeldung. Die Analyse läuft auf deinem Gerät.")}</span>
          </p>
        </div>
        <HeroStage />
      </section>

      <section class="ld-why" id="vergleich" aria-labelledby="ld-why-title">
        <div class="ld-why-head">
          <h2 id="ld-why-title">{t("Eine Partie zeigt dir einen Fehler. Viele Partien zeigen dir dein Muster.")}</h2>
          <p class="ld-lead">{t("Die Analyse nach der Partie ist gut für den Moment. Woran du arbeiten solltest, sieht man erst über viele Partien. Wähl, wie viele Partien gelesen werden, und schau, wie sich das Bild verändert.")}</p>
        </div>
        <div class="ld-why-grid">
          <PatternLab />
          <CompareTable />
        </div>
      </section>

      <section class="ld-get" aria-labelledby="ld-get-title">
        <div class="ld-get-text">
          <h2 id="ld-get-title">{t("Dein Profil, aus jeder Partie, die du gespielt hast.")}</h2>
          <p class="ld-lead">{t("In welcher Phase du Punkte verlierst, welche Eröffnungen dir liegen, welcher Zug dich am meisten gekostet hat. Jede Aussage nennt, auf wie vielen Partien sie beruht.")}</p>
          <div class="ld-get-king">
            <Model3D kind="king" size={150} label={t("Schachkönig in 3D, zum Drehen ziehen")} />
            <span>{t("Zieh am König, er dreht sich.")}</span>
          </div>
        </div>
        <Specimen />
      </section>

      <section class="ld-league" aria-labelledby="ld-league-title">
        <div class="ld-league-cup">
          <Model3D kind="trophy" size={220} label={t("Pokal in 3D, zum Drehen ziehen")} />
        </div>
        <div class="ld-league-text">
          <h2 id="ld-league-title">{t("Spiel um den Pokal, gegen deine Freunde.")}</h2>
          <p class="ld-lead">{t("Füge Freunde hinzu und ihr spielt eine eigene Liga. Gewertet werden Ergebnisse und Zugqualität, fair gerechnet, auch wenn einer nur Blitz und der andere Schnellschach spielt.")}</p>
          <ul class="ld-league-points">
            <li>{t("Tabelle mit Spielstärke, Form und Rekorden")}</li>
            <li>{t("Duell-Seite für jeden Freund: wer wo besser ist")}</li>
            <li>{t("Was dir für den nächsten Platz fehlt")}</li>
          </ul>
        </div>
      </section>

      <section class="ld-steps" aria-labelledby="ld-steps-title">
        <h2 id="ld-steps-title">{t("In wenigen Minuten zum ersten Befund.")}</h2>
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
          <h2 id="ld-private-title">{t("Deine Partien gehören dir.")}</h2>
          <p class="ld-lead">{t("Die Schach-Engine rechnet in deinem Browser. Ein Konto brauchst du nur, wenn du deine Analysen auf mehreren Geräten haben willst.")}</p>
          <a class="ld-link" href="#/rechtliches/datenschutz">
            {t("Datenschutzerklärung lesen")}
          </a>
        </div>
        <Privacy />
      </section>

      {QUOTES.length > 0 && (
        <section class="ld-quotes" aria-label={t("Was Spieler sagen")}>
          {QUOTES.map((q) => (
            <blockquote key={q.who}>
              <p>{q.text}</p>
              <cite>{q.who}</cite>
            </blockquote>
          ))}
        </section>
      )}

      <section class="ld-faq" id="fragen" aria-labelledby="ld-faq-title">
        <h2 id="ld-faq-title">{t("Fragen, bevor du loslegst")}</h2>
        <div class="ld-faq-list">
          <Faq q={t("Was kostet das?")} open>
            <p>{PRICE.text}</p>
          </Faq>
          <Faq q={t("Brauche ich ein Konto?")}>
            <p>{t("Nein. Dein Benutzername bei chess.com oder Lichess reicht. Ein Konto ist freiwillig und nur dafür da, deine Analysen auf Handy und PC gleich zu haben.")}</p>
          </Faq>
          <Faq q={t("Wie lange dauert die erste Analyse?")}>
            <p>{t("Den ersten Überblick hast du nach wenigen Minuten. Danach prüft die Engine im Hintergrund gründlicher, während du dich schon umsiehst.")}</p>
          </Faq>
          <Faq q={t("Funktioniert das auf dem Handy?")}>
            <p>{t("Ja. {BRAND} läuft im Browser auf Handy, Tablet und PC und lässt sich wie eine App auf den Startbildschirm legen.", { BRAND })}</p>
          </Faq>
          <Faq q={t("Wer steckt dahinter?")}>
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
        <h2>{t("Finde heraus, was dich Punkte kostet.")}</h2>
        <p class="ld-lead">{t("Namen eingeben, {COACH_NAME} holt deine Partien und zeigt dir den ersten Befund.", { COACH_NAME })}</p>
        <button class="btn primary big ld-cta" onClick={startAnalysis}>
          {t("Meine Partien analysieren")}
          <IconChevron />
        </button>
      </section>

      <footer class="ld-foot">
        <a href="#/rechtliches">{t("Impressum")}</a>
        <a href="#/rechtliches/datenschutz">{t("Datenschutz")}</a>
        <button onClick={openApp}>{t("{BRAND} öffnen", { BRAND })}</button>
      </footer>
    </div>
  );
}
