// Personal training plan derived from weak skills and detected patterns
// (port of src/backend/analysis/profile/training.py).

import { trMotif } from "../i18n";
import type { Pattern, SkillScore, TrainingItem } from "./models";
import { fmtDe } from "./num";
import { t } from "../../i18n";

const SKILL_PLANS: Record<string, [string, string[]]> = {
  safety: [
    t("Blunder-Check zur Gewohnheit machen"),
    [
      t("Vor jedem Zug drei Fragen: Welche Schachs, Schläge und Drohungen hat mein Gegner danach?"),
      t("Prüfe nach jedem gegnerischen Zug, welche deiner Figuren angegriffen oder ungedeckt sind."),
      t("Spiele für zwei Wochen nur Schnellschach (mind. 10 Minuten), um den Check zu verinnerlichen."),
      t("Löse im Bereich 'Eigene Fehler' die Stellungen, in denen du Material eingestellt hast."),
    ],
  ],
  tactics: [
    t("Taktisches Sehen schärfen"),
    [
      t("Täglich 15–20 Minuten Taktikaufgaben (z. B. chess.com Puzzles oder Lichess Puzzle-Themen)."),
      t("Nach jedem gegnerischen Zug fragen: 'Was ist jetzt anders – hängt etwas, steht etwas auf einer Linie?'"),
      t("Trainiere gezielt Motive, die du selten findest: {motifs}."),
      t("Wiederhole die Stellungen aus 'Eigene Fehler', in denen du eine Chance verpasst hast."),
    ],
  ],
  opening: [
    t("Eröffnungsrepertoire festigen"),
    [
      t("Beschränke dich auf ein Repertoire: eine Eröffnung mit Weiß, je eine Antwort auf 1.e4 und 1.d4."),
      t("Lerne zu jeder Eröffnung die typischen Pläne und Bauernstrukturen, nicht nur die Züge."),
      t("Schau dir nach jeder Partie an, wo du die Theorie verlassen hast (Explorer-Ansicht)."),
      t("Arbeite zuerst an deiner schwächsten Eröffnung: {worst_opening}."),
    ],
  ],
  middlegame: [
    t("Mittelspiel: Pläne statt Einzelzüge"),
    [
      t("Formuliere in jeder ruhigen Stellung einen Plan: schwächste gegnerische Figur, beste Felder für deine Figuren."),
      t("Spiele kommentierte Meisterpartien in deiner Eröffnung nach und rate den nächsten Zug."),
      t("Analysiere deine Mittelspielfehler mit der Engine – welche Idee hast du übersehen?"),
    ],
  ],
  endgame: [
    t("Endspieltechnik aufbauen"),
    [
      t("Lerne die Grundendspiele: Opposition, Quadratregel, Lucena- und Philidor-Stellung."),
      t("Übe Turmendspiele – sie kommen in deinen Partien am häufigsten vor."),
      t("Spiele gewonnene Endspiele aus deinen Partien gegen die Engine zu Ende."),
      t("Aktiviere im Endspiel deinen König frühzeitig."),
    ],
  ],
  conversion: [
    t("Gewinnstellungen sicher verwerten"),
    [
      t("In Gewinnstellungen: Figuren tauschen, Bauern behalten, Gegenspiel verhindern."),
      t("Nimm dir bei klarem Vorteil bewusst mehr Zeit – die meisten Rückschläge entstehen durch Hast."),
      t("Spiele Stellungen mit +3 aus deinen Partien gegen die Engine zu Ende."),
    ],
  ],
  defense: [
    t("Zähe Verteidigung trainieren"),
    [
      t("Gib schlechtere Stellungen nicht verloren: suche aktives Gegenspiel statt passiver Verteidigung."),
      t("Stelle dem Gegner praktische Probleme: Komplikationen, Festungsideen, Dauerschach."),
      t("Lerne typische Remis-Festungen (falsche Läufer + Randbauer, Turm gegen Turm + Bauer)."),
    ],
  ],
  time: [
    t("Zeiteinteilung verbessern"),
    [
      t("Faustregel: nach 20 Zügen sollte noch mindestens die Hälfte der Bedenkzeit übrig sein."),
      t("Spiele Eröffnungszüge, die du kennst, zügig – investiere die Zeit in kritische Momente."),
      t("In Zeitnot: einfache, sichere Züge statt tiefer Berechnung; nutze das Inkrement."),
    ],
  ],
  consistency: [
    t("Konstanter spielen"),
    [
      t("Feste Routine vor jeder Partie: ausgeruht spielen, keine Partien 'nebenbei'."),
      t("Begrenze Sessions auf wenige Partien und mache nach Niederlagen eine Pause."),
      t("Nutze in jeder Partie denselben Denkprozess (Drohungen, Kandidatenzüge, Blunder-Check)."),
    ],
  ],
};

const PATTERN_PLANS: Record<string, [string, string[]]> = {
  tilt: [
    t("Tilt vermeiden"),
    [
      t("Nach einer Niederlage: mindestens 10 Minuten Pause, bevor die nächste Partie startet."),
      t("Lege dir eine Stopp-Regel fest, z. B. zwei Niederlagen in Folge = Session beenden."),
    ],
  ],
  hasty_errors: [
    t("Langsamer ziehen in kritischen Momenten"),
    [
      t("Setz dich auf die Hände: Erst ziehen, wenn der Blunder-Check abgeschlossen ist."),
      t("Spiele ein paar Partien mit längerer Bedenkzeit, um ruhiger zu werden."),
    ],
  ],
  errors_when_winning: [
    t("Konzentration halten, wenn du besser stehst"),
    [
      t("Frage dich in Gewinnstellungen: 'Was ist das einzige, womit der Gegner noch zurückkommen kann?'"),
      t("Kein 'Hoffnungsschach' des Gegners zulassen – erst Gegenspiel stoppen, dann gewinnen."),
    ],
  ],
  fatigue: [
    t("Kürzere Spiel-Sessions"),
    [t("Spiele maximal 3 Partien am Stück; deine Genauigkeit sinkt danach messbar.")],
  ],
  post_book_errors: [
    t("Pläne nach der Eröffnung kennen"),
    [
      t("Schau dir für deine Haupteröffnungen 3–5 Meisterpartien bis Zug 25 an."),
      t("Notiere dir für jede Eröffnung die typischen Pläne für beide Seiten."),
    ],
  ],
};

export function buildTrainingPlan(
  skills: SkillScore[],
  patterns: Pattern[],
  stats: Record<string, any>,
  worstOpening = "",
): TrainingItem[] {
  const items: TrainingItem[] = [];
  const themes = (stats.tactical_themes ?? {}) as Record<string, number>;
  const themeKeys = Object.keys(themes);
  const rare = themeKeys.length
    ? [...themeKeys].sort((a, b) => themes[a] - themes[b]).slice(0, 2)
    : ["fork", "pin"];
  const motifs = rare.map((m) => trMotif(m)).join(", ");

  const reliable = skills.filter((s) => s.reliable).sort((a, b) => a.score - b.score);
  for (const s of reliable.slice(0, 3)) {
    if (s.score >= 70 || !(s.key in SKILL_PLANS)) continue;
    const [title, steps] = SKILL_PLANS[s.key];
    items.push({
      priority: 0,
      title,
      reason: `${s.name}: ${fmtDe(s.score, 0)}/100 (${s.grade}) – ${s.detail}.`,
      steps: steps.map((st) =>
        st
          .replace("{motifs}", motifs)
          .replace("{worst_opening}", worstOpening || t("deine häufigste Eröffnung")),
      ),
      focus_skill: s.key,
      examples: [],
    });
  }

  for (const p of patterns) {
    if ((p.severity !== "hoch" && p.severity !== "mittel") || !(p.key in PATTERN_PLANS)) continue;
    const [title, steps] = PATTERN_PLANS[p.key];
    items.push({
      priority: 0,
      title,
      reason: p.text,
      steps: [...steps],
      focus_skill: "",
      examples: p.examples.slice(0, 5),
    });
    if (items.length >= 6) break;
  }

  items.forEach((item, i) => {
    item.priority = i + 1;
  });
  return items;
}
