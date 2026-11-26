// Builds small static landing pages in public/<slug>/index.html and the sitemap.
// Why: the app lives behind "#/" routes, which search engines treat as one page,
// so each question people actually search for gets its own crawlable URL.
// Run: node scripts/build-seo-pages.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
// Keep in step with src/brand.ts (this script runs in plain Node, without the TS build).
const SITE = "https://endgameking.com";
const BRAND = "EndGameKing";

const pages = [
  {
    slug: "schachpartien-analysieren",
    title: "Schachpartien analysieren – kostenlos, chess.com & Lichess",
    description: "Eigene Schachpartien von chess.com und Lichess kostenlos analysieren: Fehler, Patzer und Muster erkennen. Die Engine rechnet in deinem Browser, ohne Konto.",
    h1: "Schachpartien analysieren: kostenlos, ohne Konto",
    intro: "Du gibst deinen Benutzernamen bei chess.com oder Lichess ein, EndGameKing lädt deine Partien und prüft sie Zug für Zug mit einer Schach-Engine. Das Ergebnis ist nicht nur eine Bewertungskurve pro Partie, sondern ein Bild über viele Partien hinweg.",
    sections: [
      ["Was bei der Analyse herauskommt", "Jeder Zug wird als Bestzug, gut, Ungenauigkeit, Fehler oder Patzer eingeordnet. Daraus entstehen deine Genauigkeit pro Partie, deine teuersten Fehler und eine Auswertung nach Spielphase: Eröffnung, Mittelspiel, Endspiel."],
      ["Muster statt Einzelfehler", "Ein einzelner Patzer sagt wenig. Wiederholt sich derselbe Fehlertyp, etwa übersehene Gabeln, zu frühe Damenzüge oder verpatzte Endspiele, zeigt das Profil es dir mit Beispielen aus deinen eigenen Partien."],
      ["Läuft auf deinem Gerät", "Die Engine arbeitet direkt im Browser. Deine Partien verlassen dein Gerät nur, wenn du freiwillig ein Konto anlegst, um sie auf mehreren Geräten zu nutzen. Es gibt kein Abo und keine Werbung."],
    ],
  },
  {
    slug: "schach-eroeffnungen-analysieren",
    title: "Schach-Eröffnungen analysieren – dein eigener Eröffnungsbaum",
    description: "Finde heraus, welche Eröffnungen bei dir funktionieren und wo du Punkte verlierst. Eigener Eröffnungsbaum aus deinen Partien von chess.com und Lichess, kostenlos.",
    h1: "Schach-Eröffnungen analysieren: was bei dir wirklich funktioniert",
    intro: "Eröffnungsbücher zeigen, was Großmeister spielen. EndGameKing zeigt, was bei dir passiert: Aus deinen Partien entsteht ein Eröffnungsbaum mit Ergebnis und Genauigkeit für jede Variante, die du tatsächlich gespielt hast.",
    sections: [
      ["Eröffnungen mit Ergebnis", "Für Weiß und Schwarz getrennt siehst du, wie oft du eine Eröffnung gespielt hast, wie sie ausging und wie genau du gespielt hast. So erkennst du Lieblingseröffnungen, die dir mehr schaden als nützen."],
      ["Wo du die Theorie verlässt", "Der Baum markiert die Stelle, an der du von der gängigen Theorie abweichst und dort regelmäßig Vorteil abgibst. Genau dort lohnt sich das Lernen am meisten."],
      ["Gezielt nachbessern", "Aus den schwächsten Varianten werden Trainingsaufgaben mit deinen eigenen Stellungen, damit du dieselbe Falle nicht ein drittes Mal erwischst."],
    ],
  },
  {
    slug: "schach-training-aus-eigenen-partien",
    title: "Schach trainieren mit deinen eigenen Partien – Tagesplan",
    description: "Statt zufälliger Aufgaben: Schach-Training aus deinen eigenen Fehlern. Tagesplan, Wiederholung und Fortschritt, kostenlos und ohne Werbung.",
    h1: "Schach trainieren mit deinen eigenen Fehlern",
    intro: "Zufällige Taktikaufgaben verbessern vieles, aber selten genau das, was dir fehlt. EndGameKing baut dein Training aus den Stellungen, in denen du in echten Partien danebengegriffen hast.",
    sections: [
      ["Aufgaben aus deinen Partien", "Jede Aufgabe stammt aus einer Partie, die du gespielt hast: Du siehst die Stellung, findest den besseren Zug und erfährst, warum dein eigener Zug nicht reichte."],
      ["Kurzer Tagesplan", "Ein paar Minuten am Tag genügen: Aufwärmen, Hauptteil, gemischte Wiederholung. Aufgaben, die du verpasst hast, kommen in wachsenden Abständen zurück, bis sie sitzen."],
      ["Fortschritt, den du siehst", "Genauigkeit, Fehlerquote und Eröffnungsergebnisse entwickeln sich über die Wochen sichtbar. So merkst du, ob das Training wirkt."],
    ],
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function page(p) {
  const url = `${SITE}/${p.slug}/`;
  const others = pages.filter((o) => o.slug !== p.slug).map((o) => `<li><a href="/${o.slug}/">${esc(o.h1.split(":")[0])}</a></li>`).join("");
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: p.title,
    url,
    description: p.description,
    inLanguage: "de",
    isPartOf: { "@id": `${SITE}/#website` },
  };
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0a0c11">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/png" sizes="64x64" href="/icons/favicon.png">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_DE">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:image" content="${SITE}/icons/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
body{margin:0;background:#0a0c11;color:#e8eaf2;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}
main{max-width:720px;margin:0 auto;padding:48px 20px 64px}
h1{font-size:32px;line-height:1.2;margin:0 0 16px}
h2{font-size:21px;margin:32px 0 8px}
a{color:#8d9aff}
.cta{display:inline-block;margin:28px 0 8px;background:#8d9aff;color:#0a0c11;font-weight:600;text-decoration:none;padding:13px 24px;border-radius:12px}
footer{margin-top:40px;color:#a3a9bd;font-size:14px}
</style>
</head>
<body>
<main>
<p><a href="/">${BRAND}</a></p>
<h1>${esc(p.h1)}</h1>
<p>${esc(p.intro)}</p>
${p.sections.map(([h, t]) => `<h2>${esc(h)}</h2>\n<p>${esc(t)}</p>`).join("\n")}
<a class="cta" href="/">Jetzt kostenlos ausprobieren</a>
<p>Kostenlos, ohne Werbung, ohne Kreditkarte. Unterstützt chess.com und Lichess.</p>
<footer>
<p>Mehr dazu:</p>
<ul>${others}</ul>
<p><a href="/#/rechtliches">Impressum</a> · <a href="/#/rechtliches/datenschutz">Datenschutz</a></p>
</footer>
</main>
</body>
</html>
`;
}

for (const p of pages) {
  mkdirSync(`${PUBLIC}${p.slug}`, { recursive: true });
  writeFileSync(`${PUBLIC}${p.slug}/index.html`, page(p));
}

const urls = [`${SITE}/`, ...pages.map((p) => `${SITE}/${p.slug}/`)];
writeFileSync(
  `${PUBLIC}sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u, i) => `  <url>\n    <loc>${u}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>${i === 0 ? "1.0" : "0.7"}</priority>\n  </url>`)
    .join("\n")}\n</urlset>\n`,
);
console.log(`Wrote ${pages.length} pages and the sitemap.`);
