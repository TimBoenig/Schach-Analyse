// Builds the static landing pages that search engines can index
// (public/<slug>.html, served at /<slug> by Vercel's cleanUrls) and the
// sitemap. The app itself is a single-page app with #/ routes, which Google
// treats as one page; these pages give each search intent its own address,
// title and text. Run: node scripts/build-seo-pages.mjs
// Rule as everywhere: nothing invented (no ratings, no user numbers, no quotes).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
// Keep in step with src/brand.ts (this script runs in plain Node, without the TS build).
const BRAND = "EndGameKing";
const SITE_URL = "https://endgameking.com";
const OG_IMAGE = `${SITE_URL}/icons/og-image.png`;

const PAGES = [
  {
    slug: "schachanalyse",
    title: "Schachanalyse kostenlos – Partien online analysieren",
    description:
      "Schachanalyse ohne Limit: Partien von chess.com und Lichess prüfen, Fehler erkennen und gezielt trainieren. Die Engine rechnet auf deinem Gerät.",
    label: "Schachanalyse",
    h1: "Schachanalyse kostenlos und ohne Limit",
    lead: "Eine gute Schachanalyse zeigt nicht nur, welchen Zug du in einer Partie verpasst hast, sondern was sich über viele Partien wiederholt. Genau das macht EndGameKing.",
    sections: [
      {
        h: "Was eine Partieanalyse leisten sollte",
        p: [
          "Die Schach-Engine bewertet jede Stellung und nennt den besten Zug. Für den Alltag reicht das nicht: Wer 200 Partien spielt, will wissen, in welcher Phase er Punkte verschenkt, welche Eröffnungen nicht laufen und welche Art von Fehler am teuersten ist.",
          "EndGameKing prüft jede deiner Partien Zug für Zug und fasst die Ergebnisse zu einem Profil zusammen. Es zeigt Stärken und Schwächen in Eröffnung, Mittelspiel und Endspiel, deine teuersten Fehler und die Muster, die sich wiederholen.",
        ],
      },
      {
        h: "So läuft die Analyse bei EndGameKing",
        ol: [
          "Benutzernamen bei chess.com oder Lichess eingeben, ohne Passwort und ohne Anmeldung.",
          "Die Partien werden geladen und mit der Engine Caissa geprüft, erst schnell, dann gründlich.",
          "Du siehst dein Profil, deine Eröffnungen und deinen teuersten Fehler.",
          "Aus deinen eigenen Fehlstellungen entstehen Aufgaben für ein tägliches Training.",
        ],
      },
      {
        h: "Läuft auf deinem Gerät",
        p: [
          "Die Engine ist als WebAssembly in die Seite eingebaut und rechnet in deinem Browser. Deine Partien werden dafür nicht an einen Analyse-Server geschickt. Nach dem ersten Laden funktioniert die App auch offline und lässt sich auf dem Handy oder iPad als App installieren.",
        ],
      },
    ],
    faq: [
      ["Ist die Schachanalyse wirklich kostenlos?", "Ja. Analyse, Statistik, Training und Liga kosten nichts: kein Abo, keine Werbung, keine Kreditkarte, unbegrenzt viele Partien."],
      ["Brauche ich ein Konto?", "Nein. Ein Konto ist nur nötig, wenn du Partien zwischen mehreren Geräten abgleichen willst."],
      ["Welche Engine wird benutzt?", "Caissa, eine quelloffene Schach-Engine (MIT-Lizenz), die als WebAssembly im Browser läuft."],
    ],
  },
  {
    slug: "schachpartien-analysieren",
    title: "Schachpartien analysieren – Schritt für Schritt erklärt",
    description:
      "Schachpartien analysieren, die eigenen Fehler finden und daraus lernen: So gehst du vor und so hilft dir EndGameKing, ohne Anmeldung.",
    label: "Partien analysieren",
    h1: "Schachpartien analysieren: so findest du deine echten Fehler",
    lead: "Die meisten Spieler schauen sich nach einer Niederlage den größten Patzer an und machen weiter. Wer seine Partien systematisch analysiert, findet die Fehler, die er immer wieder macht.",
    sections: [
      {
        h: "Schritt 1: Partien sammeln",
        p: [
          "Je mehr Partien, desto verlässlicher das Bild. Ein einzelner Patzer sagt wenig, aber zehn ähnliche Fehler in zwanzig Partien sind ein Muster. EndGameKing lädt deine Partien direkt von chess.com oder Lichess, du gibst nur deinen Benutzernamen ein.",
        ],
      },
      {
        h: "Schritt 2: Jeden Zug bewerten lassen",
        p: [
          "Die Engine vergleicht deinen Zug mit dem besten Zug der Stellung. Der Unterschied ist der Verlust, und er wird als Genauigkeit, Ungenauigkeit, Fehler oder Patzer eingeordnet. Entscheidende Stellungen prüft EndGameKing noch einmal tiefer.",
        ],
      },
      {
        h: "Schritt 3: Muster erkennen",
        p: [
          "Wichtig ist nicht der einzelne Zug, sondern die Frage, wo du Punkte verlierst: in der Eröffnung, im Endspiel, unter Zeitdruck oder mit einer bestimmten Farbe. EndGameKing sortiert deine Fehler nach Phase, Eröffnung und Art und zeigt, was dich am meisten kostet.",
        ],
      },
      {
        h: "Schritt 4: Gezielt üben",
        p: [
          "Aus deinen Fehlstellungen entstehen Aufgaben: die Stellung, in der du danebengegriffen hast, und die Frage nach dem besseren Zug. Ein kurzer Tagesplan wiederholt Aufgaben nach festen Abständen, damit sie hängenbleiben.",
        ],
      },
    ],
    faq: [
      ["Wie viele Partien brauche ich für eine sinnvolle Analyse?", "Für erste Hinweise reichen etwa zwanzig Partien. EndGameKing zeigt Aussagen erst, wenn genug Partien dahinterstehen, und markiert unsichere Werte."],
      ["Kann ich auch eine einzelne Partie als PGN analysieren?", "Ja, PGN-Dateien lassen sich importieren und Zug für Zug mit der Engine durchgehen."],
      ["Wie lange dauert die Analyse?", "Das hängt von Gerät und Partienzahl ab. Die schnelle Runde liefert nach wenigen Minuten erste Ergebnisse, die gründliche läuft danach weiter."],
    ],
  },
  {
    slug: "chess-com-analyse",
    title: "chess.com Partien analysieren – unbegrenzt und kostenlos",
    description:
      "chess.com Partien kostenlos analysieren: Benutzername eingeben, alle Partien laden, Fehlermuster und Eröffnungen auswerten. Ohne Limit.",
    label: "chess.com Analyse",
    h1: "chess.com Partien analysieren, ohne Limit",
    lead: "Du spielst auf chess.com und willst mehr wissen als die Genauigkeit einer einzelnen Partie? EndGameKing lädt deine Partien und wertet sie gemeinsam aus.",
    sections: [
      {
        h: "So holst du deine chess.com Partien",
        ol: [
          "EndGameKing öffnen und „Partien importieren“ wählen.",
          "Deinen chess.com Benutzernamen eingeben. Ein Passwort ist nicht nötig, es werden nur öffentliche Partien gelesen.",
          "Zeitraum wählen und starten. Mit „Neueste holen“ lädst du später nur neue Partien nach.",
        ],
      },
      {
        h: "Was du über deine Partien erfährst",
        p: [
          "Blitz, Schnellschach und Tagesschach lassen sich getrennt betrachten. Du siehst deine Wertungsentwicklung, deine Ergebnisse mit Weiß und Schwarz, deine häufigsten Eröffnungen und die Stellen, an denen du Punkte verlierst.",
          "Dazu kommt ein Profil mit Stärken und Schwächen, ein Eröffnungsbaum aus deinen eigenen Partien und ein Trainingsplan, der bei deinen schwächsten Bereichen ansetzt.",
        ],
      },
      {
        h: "Wo EndGameKing sich von der Analyse auf chess.com unterscheidet",
        p: [
          "Die Partieanalyse auf chess.com betrachtet eine Partie nach der anderen. EndGameKing legt alle Partien übereinander und sucht, was sich wiederholt. Die Engine rechnet dabei auf deinem Gerät, es gibt kein Tageslimit.",
          "EndGameKing ist ein unabhängiges Projekt und steht in keiner Verbindung zu chess.com.",
        ],
      },
    ],
    faq: [
      ["Brauche ich meinen chess.com Login?", "Nein. EndGameKing liest nur öffentlich abrufbare Partien über deinen Benutzernamen."],
      ["Gibt es ein Limit für die Zahl der Analysen?", "Nein. Die Analyse läuft auf deinem Gerät und hat kein Tageslimit."],
      ["Kann ich Freunde von chess.com vergleichen?", "Ja. Du kannst Freunde und Gegner anlegen und eine Rangliste und einen Direktvergleich ansehen."],
    ],
  },
  {
    slug: "lichess-analyse",
    title: "Lichess Partien analysieren – Fehlermuster erkennen",
    description:
      "Lichess Partien analysieren und daraus ein persönliches Profil bauen: Stärken, Schwächen, Eröffnungen und Training. Kostenlos, ohne Anmeldung.",
    label: "Lichess Analyse",
    h1: "Lichess Partien analysieren und Muster finden",
    lead: "Lichess zeigt dir jede Partie einzeln. EndGameKing wertet alle deine Lichess-Partien zusammen aus und zeigt, wo du regelmäßig Punkte verlierst.",
    sections: [
      {
        h: "Lichess Partien importieren",
        p: [
          "Gib deinen Lichess-Benutzernamen ein, mehr braucht es nicht. EndGameKing lädt deine öffentlichen Partien und prüft sie mit der Engine. Wer auf Lichess und chess.com spielt, kann beide Konten zusammen auswerten.",
        ],
      },
      {
        h: "Was dabei herauskommt",
        ul: [
          "Profil mit Stärken und Schwächen je Spielphase",
          "Eröffnungen mit eigenem Eröffnungsbaum und den Stellen, an denen du aus dem Repertoire fällst",
          "Zugbilanz: welche Art von Zügen dir gelingt und welche nicht",
          "Die teuersten Fehler und der Trainingsplan dazu",
        ],
      },
      {
        h: "Offline und ohne Werbung",
        p: [
          "Die Engine rechnet in deinem Browser, die App funktioniert nach dem ersten Laden auch ohne Internet. Es gibt keine Werbung und keine Tracker.",
          "EndGameKing ist ein unabhängiges Projekt und steht in keiner Verbindung zu Lichess.",
        ],
      },
    ],
    faq: [
      ["Kann ich Lichess und chess.com gemeinsam auswerten?", "Ja. Beide Quellen landen im selben Profil, die Wertungen werden je Plattform getrennt geführt."],
      ["Muss ich mich bei Lichess anmelden?", "Nein, es werden nur öffentliche Partien über den Benutzernamen geladen."],
    ],
  },
  {
    slug: "schach-training",
    title: "Schach verbessern: Training aus deinen eigenen Fehlern",
    description:
      "Schach verbessern mit Aufgaben aus den eigenen Partien statt zufälligen Rätseln: Tagesplan, Wiederholung und Fortschritt. Kostenlos.",
    label: "Schach Training",
    h1: "Schach verbessern mit Aufgaben aus deinen eigenen Partien",
    lead: "Zufällige Taktikaufgaben trainieren, was ein Aufgabenbuch für wichtig hält. Wer besser werden will, übt besser das, was in den eigenen Partien schiefgeht.",
    sections: [
      {
        h: "Aufgaben aus deinen Fehlstellungen",
        p: [
          "EndGameKing macht aus deinen analysierten Partien Übungen: Blunder-Check, Chancen nutzen, Eröffnungsfehler, Endspiel-Aufgaben, Vorteil verwerten und zähe Verteidigung. Jede Aufgabe ist eine Stellung, die du selbst auf dem Brett hattest.",
        ],
      },
      {
        h: "Ein kurzer Tagesplan",
        p: [
          "Du wählst, wie viel Zeit du hast. Der Tagesplan verteilt sie auf deine schwächsten Bereiche, wiederholt fällige Aufgaben und hält eine Stärke warm. Wiederholt wird nach festen Abständen von 1, 3, 7, 14 und 30 Tagen, damit gelöste Aufgaben nicht wieder vergessen werden.",
        ],
      },
      {
        h: "Endspiele und Eröffnungen",
        p: [
          "Endspiel-Grundlagen und Gewinnstellungen spielst du gegen die Engine zu Ende. Für deine Eröffnungen übst du die eigene Hauptvariante, in der typische Fehler durch den Engine-Zug ersetzt sind.",
        ],
      },
    ],
    faq: [
      ["Wie viel Zeit brauche ich am Tag?", "Das bestimmst du selbst. Der Tagesplan richtet sich nach der Zeit, die du einstellst."],
      ["Kostet das Training etwas?", "Nein. Training, Analyse und Statistik sind kostenlos und ohne Werbung."],
    ],
  },
  {
    slug: "schach-eroeffnungen-analyse",
    title: "Eröffnungen analysieren – dein Repertoire auswerten",
    description:
      "Schach-Eröffnungen aus den eigenen Partien auswerten: Ergebnisse, Eröffnungsbaum und die Stellen, an denen du Punkte verlierst. Kostenlos.",
    label: "Eröffnungen",
    h1: "Eröffnungen analysieren: welche laufen, welche nicht",
    lead: "Du spielst seit Jahren dieselben Eröffnungen, aber läuft das Repertoire wirklich? Die eigenen Partien geben die Antwort.",
    sections: [
      {
        h: "Dein Eröffnungsbaum",
        p: [
          "EndGameKing baut aus deinen Partien einen Eröffnungsbaum: welche Züge du in welcher Stellung spielst und wie die Partien ausgehen. Du siehst auf einen Blick, wo dein Repertoire Lücken hat.",
        ],
      },
      {
        h: "Eröffnungen mit Ergebnis",
        p: [
          "Je Eröffnung zeigt die Auswertung deine Partien und Ergebnisse, getrennt nach Weiß und Schwarz. So erkennst du, welche Eröffnung dir Punkte bringt und welche dich Punkte kostet.",
        ],
      },
      {
        h: "Vom Fehler zur Aufgabe",
        p: [
          "Stellen, in denen du früh aus der Theorie fällst oder einen Fehler machst, werden zu Trainingsaufgaben. So übst du genau die Varianten, die in deinen Partien vorkommen.",
        ],
      },
    ],
    faq: [
      ["Brauche ich dafür eine Analyse jeder Partie?", "Die Ergebnisse je Eröffnung stehen schon nach dem Import fest, die Bewertung der Züge kommt mit der Analyse dazu."],
      ["Gibt es ein Eröffnungsbuch?", "Ja, ein Eröffnungsbuch ist in die App eingebaut und funktioniert auch offline."],
    ],
  },
  {
    slug: "ueber-endgameking",
    title: "Über EndGameKing – Schachanalyse aus Hamburg",
    description:
      "EndGameKing ist ein unabhängiges Schachanalyse-Projekt aus Hamburg: kostenlos, ohne Werbung, die Engine rechnet auf deinem Gerät.",
    label: "Über EndGameKing",
    h1: "Über EndGameKing",
    lead: "EndGameKing ist eine kostenlose Schachanalyse-App für Spieler von chess.com und Lichess. Sie entsteht in Hamburg und wird von einer einzelnen Person gebaut.",
    sections: [
      {
        h: "Die Idee",
        p: [
          "Wer wissen will, welchen Zug er in einer Partie verpasst hat, findet überall Antworten. EndGameKing beantwortet die größere Frage: Woran muss ich insgesamt arbeiten? Dafür werden alle Partien zusammen ausgewertet.",
        ],
      },
      {
        h: "Was dahintersteckt",
        ul: [
          "Engine: Caissa, quelloffen (MIT-Lizenz), als WebAssembly im Browser",
          "Daten: Partien liegen auf deinem Gerät, ein Konto ist freiwillig",
          "Kosten: derzeit keine, keine Werbung, keine Tracker",
          "Plattformen: im Browser, als App auf Handy, iPad und PC installierbar",
        ],
      },
      {
        h: "Kontakt",
        p: [
          "Fragen, Ideen und Fehlermeldungen gehen an support@endgameking.com. Betreiber und Anschrift stehen im Impressum.",
        ],
      },
    ],
    faq: [
      ["Wer steckt hinter EndGameKing?", "Tim Bönig aus Hamburg. Das Projekt ist unabhängig und gehört zu keinem Konzern."],
      ["Wie unterscheidet sich EndGameKing von chess.com und Lichess?", "Beide zeigen eine Partie nach der anderen. EndGameKing wertet alle Partien zusammen aus und baut daraus Profil und Training."],
    ],
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function body(sec) {
  let out = `<h2>${esc(sec.h)}</h2>\n`;
  for (const p of sec.p ?? []) out += `<p>${esc(p)}</p>\n`;
  if (sec.ol) out += `<ol>${sec.ol.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>\n`;
  if (sec.ul) out += `<ul>${sec.ul.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>\n`;
  return out;
}

function render(page) {
  const url = `${SITE_URL}/${page.slug}`;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#page`, url, name: page.title, description: page.description, inLanguage: "de", isPartOf: { "@id": `${SITE_URL}/#website` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: BRAND, item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: page.label, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: page.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
  };
  const nav = PAGES.filter((p) => p.slug !== page.slug)
    .map((p) => `<li><a href="/${p.slug}">${esc(p.label)}</a></li>`)
    .join("");
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="theme-color" content="#0a0c11" />
    <link rel="canonical" href="${url}" />
    <link rel="icon" type="image/svg+xml" href="/icons/logo.svg" />
    <link rel="icon" type="image/png" sizes="64x64" href="/icons/favicon.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta property="og:site_name" content="${BRAND}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="de_DE" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(page.title)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <link rel="stylesheet" href="/seo.css" />
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </head>
  <body>
    <header class="top"><a class="brand" href="/">&#9818; ${BRAND}</a><a class="cta small" href="/">Zur App</a></header>
    <main>
      <nav class="crumbs" aria-label="Brotkrumen"><a href="/">${BRAND}</a> &rsaquo; ${esc(page.label)}</nav>
      <h1>${esc(page.h1)}</h1>
      <p class="lead">${esc(page.lead)}</p>
      <p><a class="cta" href="/">Partien jetzt analysieren</a></p>
${page.sections.map(body).join("")}      <h2>Häufige Fragen</h2>
${page.faq.map(([q, a]) => `      <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
      <p><a class="cta" href="/">Kostenlos starten</a></p>
      <nav class="more" aria-label="Weitere Themen"><h2>Mehr zu EndGameKing</h2><ul>${nav}</ul></nav>
    </main>
    <footer><a href="/#/rechtliches">Impressum</a> &middot; <a href="/#/rechtliches/datenschutz">Datenschutz</a> &middot; ${BRAND}.com</footer>
  </body>
</html>
`;
}

for (const page of PAGES) writeFileSync(`${PUBLIC}${page.slug}.html`, render(page));

const urls = [`${SITE_URL}/`, ...PAGES.map((p) => `${SITE_URL}/${p.slug}`)];
writeFileSync(
  `${PUBLIC}sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u, i) => `  <url>\n    <loc>${u}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${i === 0 ? "1.0" : "0.8"}</priority>\n  </url>`).join("\n")}
</urlset>
`,
);
console.log(`Wrote ${PAGES.length} pages and the sitemap to ${PUBLIC}`);
