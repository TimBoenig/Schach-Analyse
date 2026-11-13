# EndGameKing – Web-App (PWA)

Browser-Version von Chess Analyzer Pro für iPad, iPhone und Android. Läuft als
installierbare Progressive Web App: die Engine Caissa rechnet als WebAssembly lokal auf
dem Gerät, Partien liegen in IndexedDB, und die App funktioniert nach dem
ersten Laden auch offline. Optional gleicht ein Supabase-Konto Partien und
Einstellungen zwischen Geräten ab.

## Installieren auf iPad / iPhone

1. <https://endgameking.com> in **Safari** öffnen.
2. **Teilen** → **Zum Home-Bildschirm**.
3. Die App startet danach im Vollbild und offline.

## Startseite, Zeitraum und Export

- **Start** (`#/`) ist das tägliche Dashboard: Mike mit dem wichtigsten Befund, „Heute“ (Tagesplan-Ring, Serie,
  Wochenquote), „Deine Form“ (letzte zehn Ergebnisse als Kette, Wertung mit Verlauf, Genauigkeit zuletzt), Vergleich des
  gewählten Zeitraums mit dem Zeitraum davor, die **Stellung des Tages** (eine Aufgabe aus den eigenen Partien, direkt
  auf der Startseite lösbar, zählt in den Trainingsfortschritt), Baustellen, ein Wegweiser zu den Statistik-Seiten,
  Formkurve, Fähigkeiten-Trends, letzte Partien und Aktivitätskalender. Bei „Gesamter Zeitraum“ vergleicht sie die
  letzten 30 Tage.
- **Statistiken**: Profil, Zugbilanz, Einblicke und Eröffnungen sind über Reiter verbunden. Profil und Einblicke sind in
  Abschnitte gegliedert, eine Sprungleiste bleibt oben stehen. Jede Kennzahl hat genau einen Platz
  (`web/src/ui/StatsLayout.tsx`, `STAT_SECTIONS`); die Befehlspalette findet jede Karte über ihren Namen.
- **Zeitraum**: Start, Profil, Einblicke, Eröffnungen und Partien filtern nach 7/14/30/90 Tagen, 6/12 Monaten,
  diesem Jahr oder einem eigenen Von–bis-Zeitraum. Maßgeblich ist das Spieldatum aus der PGN, nicht das Importdatum.
  Die Auswahl wird gespeichert.
- **Export** (Einstellungen → Export & Datensicherung, Start → Exportieren, Befehlspalette): eine JSON-Datei mit allen
  Partien samt analysierten Zügen, Partie-Auswertungen, dem kompletten Profil (Statistiken, Fähigkeiten, Eröffnungen,
  Einblicke, Trainingsplan) und Trainingsfortschritt. Dazu CSV (Excel, `;`) und PGN.
  Eine JSON-Sicherung lässt sich wieder einspielen; Einstellungen ergänzen dabei nur Fehlendes.
- **KI-Export** (Einstellungen → Für KI exportieren, Befehlspalette): eine Markdown-Datei zum Hochladen in ChatGPT,
  Claude oder Gemini (`src/domain/aiExport.ts`). Sie beginnt mit dem Auftrag samt gewünschter Gliederung und einer
  Legende, dann folgen das ganze Profil als Tabellen und je Partie (Nummer P001 = neueste) die teuersten eigenen Züge
  mit FEN, besserem Zug, Engine-Linie und konkreter Begründung sowie kommentierte Notation. „Kompakt“ passt in kleine
  Kontextfenster.

## Spieler und Freundes-Rangliste

- **Spieler** (`#/spieler`): Gegner und Freunde mit ihrem Lichess- oder Chess.com-Namen anlegen (oder nur aus vorhandenen
  Partien). Ihre Partien landen im normalen Speicher, ihre Namen aber nie bei den eigenen; die Partienliste zeigt
  standardmäßig nur die eigenen Partien. Häufige Gegner aus den eigenen Partien lassen sich mit einem Tipp hinzufügen.
- **Gegnerbericht** (`#/spieler/<id>`, `src/domain/players/scout.ts`): „So schlägst du …“ mit Eröffnungen für Weiß und
  Schwarz (wo der Gegner schlecht punktet, verrechnet mit dem eigenen Ergebnis), Taktik- und Strategietipps aus den
  Fähigkeiten, Zeitverlusten, Farb- und Bedenkzeitlücken, Tilt und Fehlerphasen, Warnungen vor Stärken, Fähigkeiten-Netz
  im Vergleich und Direktvergleich. Eröffnungstipps brauchen keine Analyse, der Rest analysierte Partien.
- **Rangliste** (`#/spieler/rangliste`, `ranking.ts`): du und deine Freunde (einzelne Freunde lassen sich oben über
  die Chips „Im Vergleich“ oder auf ihrer Seite ausblenden, ohne sie zu entfernen) nach 15 Faktoren (Wertung, Punkte über
  Elo-Erwartung, Punkte-Quote, Direktvergleich, Genauigkeit, Patzer, acht Fähigkeiten, Aktivität). Jeder Faktor vergibt
  Punkte nach Platz, die Gesamtwertung ist der gewichtete Schnitt.
- **Fähigkeitswerte** werden mit wenig Daten zum Richtwert der Wertung (sonst 50) hin ausgeglichen
  (`settleSkills`) und tragen eine ±-Unsicherheit, die das Netzdiagramm als Band zeigt.

## Training

Die Seite **Training** baut aus den eigenen Partien Übungen und einen
Tagesplan:

- **Übungen**: Blunder-Check, Chancen nutzen, Eröffnungsfehler, Endspiel-
  Aufgaben, Vorteil verwerten und Zähe Verteidigung (Stellungen aus eigenen
  Partien, `src/domain/training/exercises.ts`), Repertoire üben (die eigene
  Hauptvariante je Eröffnung, typische Fehler durch den Engine-Zug ersetzt)
  sowie Endspiel-Grundlagen und Gewinnstellungen, die gegen die Engine zu Ende
  gespielt werden (`basics.ts`, `playout.ts`).
- **Tagesplan** (`plan.ts`): verteilt die gewählte Zeit auf die schwächsten
  Bereiche (Fähigkeiten, Muster, Wertungs-Richtwerte), wiederholt fällige
  Übungen und hält eine Stärke warm.
- **Fortschritt** (`progress.ts`): Leitner-Wiederholung (1, 3, 7, 14, 30 Tage),
  Serie und Erfolgsquote pro Bereich. Alles liegt in den Einstellungen und
  wird mit synchronisiert.

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest (Domänenlogik, Engine, Speicher, Sync)
npm run build      # Typecheck + Produktions-Build nach dist/
```

`scripts/prepare-assets.mjs` läuft vor `dev` und `build` und kopiert die
Engine (aus `engine/caissa/dist`), das Eröffnungsbuch (aus `../assets/openings`),
die Figuren und die Zug-Symbole nach `public/`. Diese Kopien sind generiert und
nicht eingecheckt.

## Engine

Die App rechnet mit [Caissa](https://github.com/Witek902/Caissa) 2.0 (MIT-Lizenz).
Caissa gibt es nicht fertig für den Browser; der WebAssembly-Build dieser App
liegt samt Bauanleitung in [`engine/caissa`](engine/caissa/README.md). Die
fertigen Dateien (`dist/caissa.js`, `caissa.wasm`, Netz `caissa.pnn`) sind
eingecheckt, zum Entwickeln und Deployen braucht man also kein Emscripten.

## Konto und Sync (optional)

Ohne Konto läuft die App rein lokal. Mit Konto (Seite **Konto**, `#/konto`, links unten in der Seitenleiste bzw.
unter „Mehr“) sind Profil, Statistiken, Zugbilanz, Eröffnungen, Freunde, Training und Einstellungen auf allen
Geräten gleich:

- **Anmelden, Registrieren, Passwort vergessen/ändern** über Supabase Auth (Passwörter nur als Hash beim
  Anmeldedienst, mindestens 8 Zeichen mit Zahl oder Sonderzeichen). Links aus den Mails führen zurück auf `#/konto`.
- **Kompakter Abgleich** (`src/storage/compact.ts`): Online liegen pro Partie nur Metadaten, PGN, Auswertung und pro
  Zug Bewertung, Einstufung, Engine-Zug, kurze Bestvariante und die erste Zeile jeder Engine-Linie, gzip-komprimiert
  (etwa 2–4 KB statt rund 100 KB). Stellungen, Uhrzeiten und Taktik baut das empfangende Gerät aus der PGN neu auf.
  Lange Varianten und der Rechen-Cache bleiben auf dem Gerät. Ältere, volle Online-Einträge werden einmalig kompakt
  neu hochgeladen; ein neuerer kompakter Eintrag überschreibt nie die vollständigen Linien derselben Analyse.
- Abgleich beim Start, 20 s nach lokalen Änderungen, beim Zurückkehren in die App und alle 2 Minuten.
- **Online-Daten löschen** entfernt alle Zeilen des Kontos; lokale Daten bleiben.

Einrichtung:

```
VITE_SUPABASE_URL=https://<projekt>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

lokal in `.env.local`, auf Vercel als Projekt-Umgebungsvariablen. Die Datenbank braucht die Tabelle
`public.sync_records` mit Row Level Security (`auth.uid() = user_id` für select, insert, update und delete).
Abgeglichen wird last-writer-wins auf `updated_at`; Löschungen werden als Tombstones übertragen.

In Supabase unter *Authentication → URL Configuration* die **Site URL** auf die veröffentlichte Adresse setzen,
sonst führen Bestätigungsmails auf `localhost`.

Kostenlose Supabase-Projekte werden nach einer Woche ohne Zugriff pausiert; dann scheitern Anmeldung und Abgleich.
Der Workflow `.github/workflows/supabase-keepalive.yml` fragt die Datenbank alle drei Tage einmal an. Er braucht die
Repository-Secrets `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY` und tut ohne sie nichts.

## Deployment (Vercel)

Root Directory `web`, Framework Vite, Build `npm run build`, Output `dist`.
„Include files outside the root directory“ muss an sein, weil der Build
`../assets` liest.

## Unterschiede zur Desktop-App

- Kein Chess960 (chess.js unterstützt es nicht).
- Caissa 2.0 als single-threaded WebAssembly-Build, damit es ohne besondere
  Server-Header auch auf iOS läuft; mehr Rechenleistung kommt über mehrere
  Engines nebeneinander. Das Netz der Engine (76 MB) wird bei der ersten
  Analyse einmal geladen und danach offline aus dem Cache bedient.

## Lizenzen

- Caissa (Engine): MIT, Lizenztext wird mit ausgeliefert (`caissa/LICENSE.txt`).
- Brett: eigener Code (`src/ui/Board.tsx`), keine GPL-Bestandteile mehr, siehe `THIRD_PARTY.md`.
- Figuren (Cburnett): CC BY-SA 3.0, unverändert genutzt.
- Eröffnungsdaten (lichess-org/chess-openings): CC0.
