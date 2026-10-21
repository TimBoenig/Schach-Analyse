# Schach Analyse – Web-App (PWA)

Browser-Version von Chess Analyzer Pro für iPad, iPhone und Android. Läuft als
installierbare Progressive Web App: Stockfish rechnet als WebAssembly lokal auf
dem Gerät, Partien liegen in IndexedDB, und die App funktioniert nach dem
ersten Laden auch offline. Optional gleicht ein Supabase-Konto Partien und
Einstellungen zwischen Geräten ab.

## Installieren auf iPad / iPhone

1. Die veröffentlichte Adresse in **Safari** öffnen.
2. **Teilen** → **Zum Home-Bildschirm**.
3. Die App startet danach im Vollbild und offline.

## Training

Die Seite **Training** baut aus den eigenen Partien Übungen und einen
Tagesplan:

- **Übungen**: Blunder-Check, Chancen nutzen, Eröffnungsfehler, Endspiel-
  Aufgaben, Vorteil verwerten und Zähe Verteidigung (Stellungen aus eigenen
  Partien, `src/domain/training/exercises.ts`), Repertoire üben (die eigene
  Hauptvariante je Eröffnung, typische Fehler durch den Engine-Zug ersetzt)
  sowie Endspiel-Grundlagen und Gewinnstellungen, die gegen Stockfish zu Ende
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
npm test           # Vitest (Domänenlogik, Stockfish, Speicher, Sync)
npm run build      # Typecheck + Produktions-Build nach dist/
```

`scripts/prepare-assets.mjs` läuft vor `dev` und `build` und kopiert die
Stockfish-WASM-Datei, das Eröffnungsbuch (aus `../assets/openings`), die
Figuren und die Zug-Symbole nach `public/`. Diese Dateien sind generiert und
nicht eingecheckt.

## Sync (optional)

Ohne Umgebungsvariablen läuft die App rein lokal. Für den Abgleich:

```
VITE_SUPABASE_URL=https://<projekt>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

lokal in `.env.local`, auf Vercel als Projekt-Umgebungsvariablen. Die Datenbank
braucht die Tabelle `public.sync_records` mit Row Level Security
(`auth.uid() = user_id`). Abgeglichen wird last-writer-wins auf `updated_at`;
Löschungen werden als Tombstones übertragen. Engine-Bewertungen bleiben auf dem
Gerät.

In Supabase unter *Authentication → URL Configuration* die **Site URL** auf die
veröffentlichte Adresse setzen, sonst führen Bestätigungsmails auf `localhost`.

## Deployment (Vercel)

Root Directory `web`, Framework Vite, Build `npm run build`, Output `dist`.
„Include files outside the root directory“ muss an sein, weil der Build
`../assets` liest.

## Unterschiede zur Desktop-App

- Kein Chess960 (chess.js unterstützt es nicht).
- Stockfish 17.1 *lite* (single-threaded, kleineres Netz), damit es ohne
  besondere Server-Header auch auf iOS läuft. Etwas schwächer als die
  Desktop-Engine.
- Der KI-Coach läuft direkt aus dem Browser; nicht jeder Anbieter erlaubt das
  (CORS). Die Datenmenge pro Frage ist in den Einstellungen wählbar, damit auch
  kleine lokale Modelle mit kurzem Kontext funktionieren.

## Lizenzen

- Stockfish: GPLv3, wird als eigene Datei ausgeliefert (`stockfish/COPYING.txt`).
- Figuren (Cburnett): CC BY-SA 3.0 / GPLv2+.
- Eröffnungsdaten (lichess-org/chess-openings): CC0.
