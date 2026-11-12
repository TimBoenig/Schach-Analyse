// Legal page (#/rechtliches): Impressum, privacy notice and licences. A site
// that is published in Germany needs the first two; the third is required by
// the GPL of chessground and Stockfish (source must be reachable).
import type { JSX } from "preact";

import { BRAND } from "../brand";
import { PageHeader } from "./Layout";
import { navigate, type LegalTab } from "./router";

/**
 * Operator details for the Impressum (§ 5 DDG). Fill these in before the site
 * goes public; while a field is empty the page shows a visible placeholder.
 */
export const OPERATOR = {
  name: "",
  street: "",
  city: "",
  email: "",
};

const SOURCE_URL = "https://github.com/TimBoenig/Schach-Analyse";

function Field({ value, label }: { value: string; label: string }) {
  return value ? <>{value}</> : <span class="placeholder-field">[{label} eintragen]</span>;
}

function Impressum() {
  return (
    <section class="card legal-text">
      <h2>Impressum</h2>
      <p>Angaben gemäß § 5 DDG</p>
      <p>
        <Field value={OPERATOR.name} label="Vor- und Nachname" />
        <br />
        <Field value={OPERATOR.street} label="Straße und Hausnummer" />
        <br />
        <Field value={OPERATOR.city} label="PLZ und Ort" />
      </p>
      <p>
        Kontakt: <Field value={OPERATOR.email} label="E-Mail-Adresse" />
      </p>
      <p>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: siehe oben.</p>
      <h3>Haftung</h3>
      <p>
        Bewertungen, Einstufungen und Trainingsvorschläge entstehen automatisch durch eine Schach-Engine und sind
        Hilfsmittel, keine Garantie für Richtigkeit. Für Inhalte verlinkter Seiten (chess.com, Lichess) sind deren
        Betreiber verantwortlich.
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
        Lichess dein Gerät. Es gibt keine Werbung, kein Tracking und keine Analyse-Cookies.
      </p>
      <h3>Verantwortlicher</h3>
      <p>
        <Field value={OPERATOR.name} label="Name" />, <Field value={OPERATOR.email} label="E-Mail" /> (siehe{" "}
        <a href="#/rechtliches">Impressum</a>).
      </p>
      <h3>Daten auf deinem Gerät</h3>
      <p>
        Partien, Analysen, Einstellungen und Trainingsfortschritt speichert die App im Browser-Speicher (IndexedDB,
        localStorage) auf deinem Gerät. Die Engine-Analyse läuft ebenfalls lokal. Du kannst alles unter Einstellungen →
        Daten & Export herunterladen oder löschen.
      </p>
      <h3>Hosting</h3>
      <p>
        Die Seite wird über Vercel Inc. ausgeliefert. Beim Aufruf verarbeitet Vercel technisch notwendige Daten wie
        IP-Adresse und Zeitpunkt, um die Seite bereitzustellen und vor Missbrauch zu schützen (Art. 6 Abs. 1 lit. f
        DSGVO). Vercel ist nach dem EU-US Data Privacy Framework zertifiziert.
      </p>
      <h3>Import von chess.com und Lichess</h3>
      <p>
        Wenn du Partien importierst, ruft dein Browser die öffentlichen Schnittstellen von chess.com bzw. Lichess direkt
        mit dem eingegebenen Benutzernamen ab. Dabei gelten deren Datenschutzbestimmungen.
      </p>
      <h3>Konto und Synchronisierung (freiwillig)</h3>
      <p>
        Legst du ein Konto an, speichern wir deine E-Mail-Adresse, ein gehashtes Passwort und eine kompakte Kopie deiner
        Partien, Analysen und Einstellungen bei Supabase Inc. auf Servern in Frankfurt (EU). Zweck ist die Sicherung und
        der Abgleich zwischen deinen Geräten (Art. 6 Abs. 1 lit. b DSGVO). Für Bestätigungs- und Anmeldelinks erhältst
        du E-Mails an diese Adresse. Du kannst Online-Daten und Konto jederzeit selbst unter Einstellungen → Konto
        löschen.
      </p>
      <h3>Deine Rechte</h3>
      <p>
        Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und
        Widerspruch sowie das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.
      </p>
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
          <strong>Stockfish</strong> (Schach-Engine) – GPL-3.0, stockfishchess.org
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
