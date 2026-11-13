// Legal page (#/rechtliches): Impressum, privacy notice and licences. A site
// that is published in Germany needs the first two; the third is required by
// the GPL of chessground (source must be reachable).
import type { JSX } from "preact";

import { BRAND, SUPPORT_EMAIL } from "../brand";
import { PageHeader } from "./Layout";
import { navigate, type LegalTab } from "./router";
import { ENGINE_NAME, ENGINE_VERSION } from "../engine/info";

/**
 * Operator details for the Impressum (§ 5 DDG, § 18 MStV). The address must be
 * one where post and court documents reach the operator ("ladungsfähig").
 */
export const OPERATOR = {
  name: "Tim Bönig",
  street: "Katzbachstraße 23",
  city: "22547 Hamburg",
  email: SUPPORT_EMAIL,
};

const SOURCE_URL = "https://github.com/TimBoenig/Schach-Analyse";

function Mail() {
  return <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>;
}

function Address() {
  return (
    <p>
      {OPERATOR.name}
      <br />
      {OPERATOR.street}
      <br />
      {OPERATOR.city}
      <br />
      Deutschland
    </p>
  );
}

function Impressum() {
  return (
    <section class="card legal-text">
      <h2>Impressum</h2>
      <p>Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</p>
      <Address />
      <h3>Kontakt</h3>
      <p>
        E-Mail: <Mail />
      </p>
      <h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3>
      <p>
        {OPERATOR.name}, Anschrift wie oben.
      </p>
      <h3>Haftung für Inhalte</h3>
      <p>
        {BRAND} ist ein privates, kostenloses Angebot ohne Werbung. Bewertungen, Einstufungen und Trainingsvorschläge
        entstehen automatisch durch eine Schach-Engine. Sie sind Hilfsmittel und ohne Gewähr für Richtigkeit und
        Vollständigkeit.
      </p>
      <h3>Haftung für Links</h3>
      <p>
        Für Inhalte verlinkter Seiten (zum Beispiel chess.com, Lichess, GitHub) sind ausschließlich deren Betreiber
        verantwortlich. Zum Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar. Werden uns solche bekannt,
        entfernen wir den Link umgehend.
      </p>
      <h3>Urheberrecht</h3>
      <p>
        Der Quellcode steht unter der GNU General Public License v3 (siehe Lizenzen). Schachpartien und Ergebnisse
        stammen von den jeweiligen Spielern und Plattformen.
      </p>
    </section>
  );
}

function Datenschutz() {
  return (
    <section class="card legal-text">
      <h2>Datenschutzerklärung</h2>
      <p>
        Kurz gesagt: Die App läuft auf deinem Gerät. Ohne Konto verlässt nichts außer deinen Abrufen bei chess.com oder
        Lichess dein Gerät. Es gibt keine Werbung, kein Tracking, keine Cookies und keine Analyse-Dienste.
      </p>

      <h3>1. Verantwortlicher</h3>
      <Address />
      <p>
        E-Mail: <Mail />
      </p>

      <h3>2. Aufruf der Website (Hosting)</h3>
      <p>
        Die Seite wird von Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA, ausgeliefert. Beim Aufruf
        verarbeitet Vercel technisch notwendige Daten: IP-Adresse, Zeitpunkt, aufgerufene Datei, Browser und
        Betriebssystem. Das ist nötig, um die Seite auszuliefern und vor Angriffen zu schützen (Art. 6 Abs. 1 lit. f
        DSGVO). Die Protokolle speichert Vercel nur für kurze Zeit. Vercel ist nach dem EU-US Data Privacy Framework
        zertifiziert; zusätzlich gilt ein Auftragsverarbeitungsvertrag mit EU-Standardvertragsklauseln. Die
        Namensauflösung der Domain (DNS) läuft über Cloudflare, Inc., USA, ebenfalls nach dem Data Privacy Framework
        zertifiziert.
      </p>

      <h3>3. Daten auf deinem Gerät</h3>
      <p>
        Partien, Analysen, Einstellungen und Trainingsfortschritt speichert die App im Speicher deines Browsers
        (IndexedDB, localStorage, Offline-Cache). Die Engine-Analyse läuft ebenfalls lokal. Diese Speicherung ist
        unbedingt nötig, damit die App tut, was du von ihr willst (§ 25 Abs. 2 Nr. 2 TDDDG). Darum gibt es kein
        Cookie-Banner. Du kannst alles unter Einstellungen → Daten & Export herunterladen oder löschen, oder die
        Website-Daten im Browser entfernen.
      </p>

      <h3>4. Import von chess.com und Lichess</h3>
      <p>
        Wenn du Partien importierst oder Freunde hinzufügst, ruft dein Browser die öffentlichen Schnittstellen von
        chess.com (Chess.com, LLC, USA) bzw. Lichess (lichess.org, Frankreich) direkt auf. Dabei sehen diese Dienste deine
        IP-Adresse und den eingegebenen Benutzernamen; es gelten ihre Datenschutzbestimmungen. Die Abrufe startest du
        selbst (Art. 6 Abs. 1 lit. b DSGVO).
      </p>

      <h3>5. Daten anderer Spieler</h3>
      <p>
        Fügst du Freunde oder Gegner hinzu, lädt die App deren öffentlich einsehbare Partien und Benutzernamen und wertet
        sie für dich aus. Das geschieht auf deinem Gerät und, falls du ein Konto nutzt, in deiner Sicherung. Grundlage
        ist das berechtigte Interesse, öffentlich zugängliche Partien zu analysieren (Art. 6 Abs. 1 lit. f DSGVO). Wer
        nicht möchte, dass seine Partien hier ausgewertet werden, kann sich unter <Mail /> melden.
      </p>

      <h3>6. Konto und Synchronisierung (freiwillig)</h3>
      <p>
        Legst du ein Konto an, speichern wir deine E-Mail-Adresse, optional einen Anzeigenamen, ein gehashtes Passwort
        und eine kompakte Kopie deiner Partien, Analysen und Einstellungen. Zweck ist die Sicherung und der Abgleich
        zwischen deinen Geräten (Art. 6 Abs. 1 lit. b DSGVO). Anbieter ist Supabase Inc., USA, mit Servern in
        Frankfurt am Main (EU); es gilt ein Auftragsverarbeitungsvertrag mit EU-Standardvertragsklauseln. Die Daten
        bleiben gespeichert, bis du sie löschst. Unter Einstellungen → Konto kannst du die Online-Daten oder das ganze
        Konto jederzeit selbst sofort löschen.
      </p>

      <h3>7. E-Mails</h3>
      <p>
        Für Bestätigungs-, Anmelde- und Passwort-Links schicken wir dir E-Mails an die angegebene Adresse
        (Art. 6 Abs. 1 lit. b DSGVO). Der Versand läuft über Resend (Plus Five Five, Inc., USA) auf Grundlage eines
        Auftragsverarbeitungsvertrags mit EU-Standardvertragsklauseln. Newsletter oder Werbung verschicken wir nicht.
      </p>

      <h3>8. Kontakt per E-Mail</h3>
      <p>
        Schreibst du an <Mail />, verarbeiten wir deine Adresse und Nachricht, um dir zu antworten (Art. 6 Abs. 1 lit. f
        DSGVO). Wir löschen sie, sobald die Anfrage erledigt ist und keine Aufbewahrungspflicht besteht.
      </p>

      <h3>9. Deine Rechte</h3>
      <p>
        Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der
        Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage
        berechtigter Interessen (Art. 21). Eine kurze E-Mail an <Mail /> genügt. Du kannst dich außerdem bei einer
        Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel beim Hamburgischen Beauftragten für Datenschutz und
        Informationsfreiheit.
      </p>

      <h3>10. Keine automatisierten Entscheidungen</h3>
      <p>
        Die Engine-Bewertungen dienen nur deinem Training. Es gibt keine automatisierten Entscheidungen mit rechtlicher
        Wirkung und kein Profiling zu Werbezwecken.
      </p>
      <p class="faint small">Stand: November 2026</p>
    </section>
  );
}

function Lizenzen() {
  return (
    <section class="card legal-text">
      <h2>Lizenzen und Quellcode</h2>
      <p>
        Diese App ist freie Software. Der vollständige Quellcode steht unter{" "}
        <a href={SOURCE_URL} target="_blank" rel="noopener">
          {SOURCE_URL.replace("https://", "")}
        </a>
        . Weil sie GPL-Komponenten enthält, wird die Web-App als Ganzes unter der GNU General Public License v3
        weitergegeben.
      </p>
      <ul>
        <li>
          <strong>{ENGINE_NAME}</strong> {ENGINE_VERSION} (Schach-Engine) von Michał Witanowski – MIT-Lizenz,{" "}
          <a href="https://github.com/Witek902/Caissa" target="_blank" rel="noopener">
            github.com/Witek902/Caissa
          </a>
          ,{" "}
          <a href={`${import.meta.env.BASE_URL}caissa/LICENSE.txt`} target="_blank" rel="noopener">
            Lizenztext
          </a>
        </li>
        <li>
          <strong>chessground</strong> (Schachbrett) – GPL-3.0-or-later, von Lichess
        </li>
        <li>
          <strong>Cburnett-Figuren</strong> – GPLv2+ / CC BY-SA 3.0
        </li>
        <li>
          <strong>chess.js</strong>, <strong>Preact</strong>, <strong>supabase-js</strong> – BSD/MIT
        </li>
        <li>
          <strong>Geist</strong> und <strong>Instrument Serif</strong> (Schriften) – SIL Open Font License
        </li>
      </ul>
      <p class="faint small">
        {BRAND} ist kein Angebot von chess.com oder Lichess und steht mit ihnen nicht in Verbindung.
      </p>
    </section>
  );
}

const TABS: [LegalTab, string, () => JSX.Element][] = [
  ["impressum", "Impressum", Impressum],
  ["datenschutz", "Datenschutz", Datenschutz],
  ["lizenzen", "Lizenzen", Lizenzen],
];

export function LegalView({ tab }: { tab: LegalTab }) {
  const Body = (TABS.find(([t]) => t === tab) ?? TABS[0])[2];
  return (
    <div>
      <PageHeader />
      <div class="segmented" role="tablist" style={{ marginBottom: "14px" }}>
        {TABS.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            class={t === tab ? "active" : ""}
            onClick={() => navigate({ view: "legal", tab: t }, true)}
          >
            {label}
          </button>
        ))}
      </div>
      <Body />
    </div>
  );
}
