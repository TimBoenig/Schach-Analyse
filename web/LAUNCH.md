# Launch-Checkliste EndGameKing

Stand: 2026-11-24. Häkchen = im Code erledigt und per Test abgesichert (`tests/app/seo.test.ts`, `tests/ui/touchGuards.test.ts`).

## Im Code erledigt

- [x] Titel, Beschreibung, Canonical, Open Graph, Twitter-Card mit Vorschaubild (`public/icons/og-image.png`, 1200×630)
- [x] `robots.txt`, `sitemap.xml` (nur `/`: Hash-Routen wie `#/profil` sind für Google keine eigenen Seiten)
- [x] JSON-LD (WebSite, WebApplication, kostenlos) – ohne Bewertungen oder Zitate
- [x] Crawlbarer Text im ausgelieferten HTML (`<div id="app">` in `index.html`); die App ersetzt ihn beim Start
- [x] Drei statische Themenseiten (`/schachpartien-analysieren/` u. a., erzeugt von `scripts/build-seo-pages.mjs`), in Sitemap und Startseite verlinkt
- [x] Favicon, Apple-Touch-Icon, PWA-Manifest mit `id`, Kategorien, maskable Icon
- [x] 404-Seite (`public/404.html`, `noindex`)
- [x] Impressum und Datenschutzerklärung (`#/rechtliches`), verlinkt im Footer und auf der Startseite
- [x] Sicherheits-Header (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- [x] Lange Browser-Caches für `/assets/*` (Dateinamen mit Hash) und Schriften
- [x] Schrift-Preload gegen Layout-Sprünge; keine Tracker, keine Cookies, keine Analytics (nichts einzuwilligen)

## Nur du kannst das (Reihenfolge empfohlen)

1. **Hauptadresse festlegen.** In Vercel (Project → Settings → Domains) leitet `endgameking.com` derzeit mit 308 auf `www.endgameking.com` weiter. Canonical, Sitemap, Open Graph und E-Mail-Links im Code nennen aber `endgameking.com` ohne www. Eines von beiden muss angepasst werden, sonst widersprechen sich Weiterleitung und Canonical. Empfehlung: `www` → `endgameking.com` umleiten (die Apex-Adresse als Hauptadresse).
2. **Alte Adresse umleiten.** Wenn Schritt 1 sitzt: `schach-analyse.vercel.app` per Redirect auf `https://endgameking.com` (Domains → Edit → Redirect), damit es keine doppelten Inhalte gibt.
3. **Google Search Console:** Property „Domain“ `endgameking.com` anlegen, per DNS-TXT bestätigen (bei Vercel-DNS in Domains → DNS Records), danach `https://endgameking.com/sitemap.xml` einreichen und die Startseite per „URL-Prüfung“ zur Indexierung anfordern. Bing Webmaster Tools kann die Property aus der Search Console importieren.
4. **E-Mail-Domain:** In Resend `endgameking.com` verifizieren (SPF/DKIM-Einträge), dann in Supabase (Auth → SMTP) den Absender auf eine Adresse der eigenen Domain umstellen. `support@endgameking.com` muss Post empfangen können (steht im Impressum).
5. **Supabase:** Auth → URL Configuration: Site URL `https://endgameking.com` und Redirect-URLs für die neue Domain eintragen.
6. **Vorschau testen** (nach dem Deploy): Link in WhatsApp/Discord/LinkedIn einfügen, Google „Rich Results Test“ und PageSpeed Insights auf `https://endgameking.com/` laufen lassen.
7. **Echte Stimmen:** Zitate auf der Startseite erst eintragen (`src/ui/landing/content.ts`, `QUOTES`), wenn echte Nutzer zugestimmt haben.

## Bewusst nicht gemacht

- **hreflang DE/EN:** Die Sprache wird in der App gewählt und nicht über die Adresse unterschieden. Ohne eigene URLs je Sprache (z. B. `/en/`) wäre ein hreflang-Tag falsch. Das wäre ein eigener größerer Schritt.
- **Eigene indexierbare Seiten für Impressum/Datenschutz/Funktionen:** brauchen echte Pfade statt Hash-Routen; lohnt sich, sobald es Inhalte wie Ratgeber oder Eröffnungsseiten gibt.
- **Analytics:** keine eingebaut. Falls gewünscht: Vercel Web Analytics ist cookiefrei, braucht aber einen Satz in der Datenschutzerklärung und eine CSP-Anpassung.
