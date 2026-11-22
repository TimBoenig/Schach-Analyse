// The front door: what new visitors see first (at "/" on a fresh device, and
// at /hello from social media). It shows the product before asking for
// anything, says plainly what it costs, where the data stays and who builds
// it, and leads into Lucena's guided start with one button.
import { BRAND, SUPPORT_EMAIL } from "../brand";
import { COACH_NAME } from "./Coach";
import { IconBolt, IconChevron, IconCloud, IconCpu, IconInsights, IconShield, IconTraining, IconTrophy } from "./icons";
import { MAKER, PRICE, QUOTES } from "./landing/content";
import { Specimen } from "./landing/Specimen";
import { LandingHow } from "./LandingHow";
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

const BENEFITS: { icon: () => preact.JSX.Element; title: string; text: string }[] = [
  { icon: IconInsights, title: "Muster statt Einzelpartien", text: "Aus all deinen Partien wird ein Profil: in welcher Phase du Punkte verlierst, welche Eröffnungen dir liegen, welche Fehler wiederkommen." },
  { icon: IconTraining, title: "Aufgaben aus deinen Stellungen", text: "Wo du danebengegriffen hast, wird eine Aufgabe. Sie kommt wieder, bis sie sitzt. Ein paar Minuten am Tag reichen." },
  { icon: IconShield, title: "Nur was belegt ist", text: "Jede Aussage nennt, auf wie vielen Partien sie beruht. Sind es zu wenige, sagt Lucena lieber nichts." },
  { icon: IconTrophy, title: "Liga mit Freunden", text: "Vergleiche dich fair mit Freunden, nach Zugqualität und Ergebnissen, auch bei verschiedenen Bedenkzeiten." },
];

const COMPARE = {
  them: ["Zeigt eine Partie auf einmal", "Markiert Patzer, das Muster suchst du selbst", "Rätsel aus fremden Partien"],
  us: ["Liest alle deine Partien zusammen", "Zeigt, was sich wiederholt und wie oft", "Aufgaben aus deinen eigenen Stellungen, mit Wochenplan"],
};

export function LandingView() {
  return (
    <div class="landing">
      <header class="ld-top">
        <a class="ld-brand" href="#/hello" aria-label={BRAND}>
          <img src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          <span>{BRAND}</span>
        </a>
        <nav class="ld-nav" aria-label="Abschnitte">
          <button onClick={() => scrollTo("so-gehts")}>So funktioniert's</button>
          <button onClick={() => scrollTo("datenschutz")}>Datenschutz</button>
          <button onClick={() => scrollTo("preis")}>Preis</button>
        </nav>
        <button class="btn ld-open" onClick={openApp}>
          Zur App
        </button>
      </header>

      <section class="ld-hero">
        <div class="ld-hero-text">
          <h1>Trainiere die Fehler, die du wirklich machst.</h1>
          <p class="ld-lead">
            {BRAND} liest alle deine Partien von chess.com und Lichess, findet die Fehler, die sich bei dir wiederholen, und baut daraus dein tägliches Training. Keine zufälligen Rätsel, sondern deine eigenen Stellungen.
          </p>
          <div class="ld-cta-row">
            <button class="btn primary big ld-cta" onClick={startAnalysis}>
              <IconBolt />
              Meine Partien analysieren
            </button>
            <button class="btn big ld-ghost" onClick={() => scrollTo("so-gehts")}>
              So funktioniert's
            </button>
          </div>
          <p class="ld-assure">
            <IconShield />
            <span>Kostenlos und ohne Anmeldung. Die Analyse läuft auf deinem Gerät.</span>
          </p>
        </div>
        <Specimen />
      </section>

      <section class="ld-problem" aria-labelledby="ld-problem-title">
        <h2 id="ld-problem-title">Du schaust dir nach jeder Partie die Analyse an. Und weißt trotzdem nicht, woran du arbeiten sollst.</h2>
        <p class="ld-lead">Eine Analyse zeigt dir eine Partie. Deine Schwächen zeigen sich erst über viele: dasselbe Endspiel, dieselbe Eröffnung, dieselbe übersehene Gabel. Genau dort setzt {COACH_NAME} an.</p>
        <div class="ld-compare">
          <div class="ld-col them">
            <h3>Analyse nach der Partie</h3>
            <ul>
              {COMPARE.them.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div class="ld-col us">
            <h3>{BRAND}</h3>
            <ul>
              {COMPARE.us.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section class="ld-benefits" aria-label="Was du bekommst">
        {BENEFITS.map((b) => (
          <div class="ld-benefit" key={b.title}>
            <span class="ld-icon">
              <b.icon />
            </span>
            <h3>{b.title}</h3>
            <p>{b.text}</p>
          </div>
        ))}
      </section>

      <LandingHow />

      <section class="ld-private" id="datenschutz" aria-labelledby="ld-private-title">
        <div class="ld-private-text">
          <h2 id="ld-private-title">Deine Partien bleiben auf deinem Gerät.</h2>
          <p class="ld-lead">Die Schach-Engine rechnet in deinem Browser. Wir sehen weder deine Partien noch deine Fehler, und du brauchst kein Konto.</p>
          <ul class="ld-facts">
            <li>
              <IconCpu />
              <span>
                <b>Analyse im Browser.</b> Sie läuft auch offline weiter, wenn die Partien einmal geladen sind.
              </span>
            </li>
            <li>
              <IconShield />
              <span>
                <b>Kein Passwort, kein Konto.</b> Dein Benutzername bei chess.com oder Lichess reicht, wir lesen nur öffentliche Partien.
              </span>
            </li>
            <li>
              <IconCloud />
              <span>
                <b>Konto nur, wenn du willst.</b> Damit hast du deine Analysen auf allen Geräten, gespeichert in Frankfurt.
              </span>
            </li>
          </ul>
          <a class="ld-link" href="#/rechtliches/datenschutz">
            Datenschutzerklärung lesen
          </a>
        </div>
        <div class="ld-flow" aria-hidden="true">
          <div class="ld-node">chess.com und Lichess</div>
          <span class="ld-pipe" />
          <div class="ld-node device">
            <b>Dein Gerät</b>
            <span>Engine, Statistik, Training</span>
          </div>
          <span class="ld-pipe cut" />
          <div class="ld-node off">Unser Server bekommt nichts davon</div>
        </div>
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

      <section class="ld-trust">
        <div class="ld-price" id="preis">
          <h2>Was kostet das?</h2>
          <p class="ld-price-big">{PRICE.headline}</p>
          <p>{PRICE.text}</p>
          <ul>
            {PRICE.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div class="ld-maker">
          <h2>Wer dahintersteckt</h2>
          <div class="ld-maker-who">
            <span class="ld-maker-mark" aria-hidden="true">
              {MAKER.initials}
            </span>
            <div>
              <b>{MAKER.name}</b>
              <span>{MAKER.place}</span>
            </div>
          </div>
          <p>{MAKER.text}</p>
          <div class="ld-maker-links">
            <a class="ld-link" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            <a class="ld-link" href={MAKER.source} target="_blank" rel="noopener">
              Quellcode auf GitHub
            </a>
          </div>
        </div>
      </section>

      <section class="ld-final">
        <h2>Finde heraus, was dich Punkte kostet.</h2>
        <p class="ld-lead">Benutzername eingeben, {COACH_NAME} holt deine Partien und zeigt dir nach wenigen Minuten den ersten Befund.</p>
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
