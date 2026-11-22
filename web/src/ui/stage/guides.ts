// Lucena's explanation of each page, shown fullscreen on the first visit and
// from the "Erklären" button. Only how a page works stands here; the numbers
// are on the page itself.
import type { Mood } from "../coach/net";
import type { IllusKind } from "./Illus";
import type { Point } from "./script";
import { t } from "../../i18n";

export type GuideId = "home" | "games" | "analysis" | "board" | "profile" | "insights" | "moves" | "openings" | "training" | "exercises" | "progress" | "players" | "ranking";

export interface GuideStep {
  say: string;
  sub: string;
  points?: Point[];
  illus?: IllusKind;
  mood?: Mood;
}

export interface PageGuideText {
  /** Name of the page as the navigation shows it. */
  title: string;
  steps: GuideStep[];
}

export const PAGE_GUIDES: Record<GuideId, PageGuideText> = {
  home: {
    title: t("Start"),
    steps: [
      {
        say: t("Das ist dein Tag auf einen Blick."),
        sub: t("Oben steht, was heute dran ist. Darunter, wie es zuletzt lief."),
        points: [
          { title: t("Dein nächster Schritt"), text: t("Die Einheit für heute und Partien, die noch auf die Analyse warten.") },
          { title: t("Dein Ziel"), text: t("Rechts deine Wertung und der Weg zum nächsten Ziel. Mit + und − stellst du es selbst ein.") },
          { title: t("Deine Form"), text: t("Die letzten Ergebnisse und fünf Kennzahlen, jeweils mit dem Zeitraum davor verglichen. Den Zeitraum wählst du oben.") },
          { title: t("Dein Kalender"), text: t("An welchen Tagen du gespielt hast und wie es lief.") },
        ],
      },
    ],
  },
  games: {
    title: t("Partien"),
    steps: [
      {
        say: t("Hier holst du Partien und öffnest sie."),
        sub: t("Neue Partien kommen mit einem Tipp von chess.com oder Lichess. Analysiert werden sie automatisch."),
        illus: "games",
        points: [
          { title: t("Die Abzeichen"), text: t("Zeigen auf einen Blick, was in der Partie passiert ist: Glanzzüge, Fehler, Patzer.") },
          { title: t("Tippe eine Partie an"), text: t("Dann gehst du sie Zug für Zug durch und bekommst meinen Bericht mit Note.") },
        ],
      },
    ],
  },
  analysis: {
    title: t("Partie"),
    steps: [
      {
        say: t("So liest du eine analysierte Partie."),
        sub: t("Links das Brett, rechts die Züge. Jeder Zug trägt sein Urteil."),
        illus: "engine",
        points: [
          { title: t("Durch die Partie"), text: t("Pfeiltasten oder ein Wisch übers Brett. „Fehler“ unter dem Brett springt direkt zu deinen Fehlern.") },
          { title: t("Eigene Varianten"), text: t("Zieh selbst eine Figur. Ich bewerte deine Züge sofort und du kommst jederzeit zur Partie zurück.") },
          { title: t("Die Linie unter dem Brett"), text: t("Zeigt, wer wann besser stand. Jeder Knick ist ein Moment, der die Partie gedreht hat.") },
        ],
      },
      {
        say: t("Der Bericht fasst die Partie zusammen."),
        sub: t("Eine Note, der Wendepunkt, deine drei Phasen und was du daraus mitnimmst."),
        points: [
          { title: t("Die Note"), text: t("Misst deine Züge, nicht das Ergebnis. Eine verlorene Partie kann eine gute Note haben.") },
          { title: t("Im Vollbild"), text: t("Mit „Lucena erklärt die Partie“ gehe ich sie Schritt für Schritt mit dir durch: Note, Wendepunkt, dein bester und dein teuerster Zug.") },
        ],
      },
    ],
  },
  board: {
    title: t("Analysebrett"),
    steps: [
      {
        say: t("Hier probierst du Stellungen frei aus."),
        sub: t("Zieh die Figuren für beide Seiten. Ich bewerte jeden Zug sofort und zeige dir die besten Fortsetzungen der Engine."),
        illus: "engine",
        points: [
          { title: t("Aus einer Partie"), text: t("„Im Analysebrett“ auf der Partieseite bringt die gezeigte Stellung hierher.") },
          { title: t("Zurück auf Anfang"), text: t("„Startstellung“ oben stellt die Figuren neu auf.") },
        ],
      },
    ],
  },
  profile: {
    title: t("Überblick"),
    steps: [
      {
        say: t("Dein Profil in einem Bild."),
        sub: t("Oben deine Spielstärke, darunter deine Fähigkeiten, dein Stil und der Verlauf."),
        illus: "stats",
        points: [
          { title: t("Fähigkeiten"), text: t("Jede Fähigkeit steht als Wertung da, gemessen an Gegnern deiner Stärke. Die Linie zeigt, was für dich üblich wäre.") },
          { title: t("Stärken und Schwächen"), text: t("Nur was sich in genug Partien zeigt, steht hier. Jede Aussage nennt ihre Partien.") },
        ],
      },
      {
        say: t("Der Verlauf zeigt, wohin es geht."),
        sub: t("Wertung und Genauigkeit über die Zeit. Den Zeitraum stellst du direkt am Diagramm ein."),
        points: [
          { title: t("Wertung"), text: t("Eine Linie je Bedenkzeit und Plattform. Partien ohne Wertungspool, etwa gegen den Coach von chess.com, zählen nicht mit.") },
          { title: t("Genauigkeit"), text: t("Der Durchschnitt deiner Partien je Woche oder Monat, mit der Anzahl der Partien dahinter.") },
        ],
      },
    ],
  },
  insights: {
    title: t("Ergebnisse"),
    steps: [
      {
        say: t("Wo holst du Punkte, wo bleiben sie liegen?"),
        sub: t("Diese Seite schneidet deine Ergebnisse nach Gegner, Bedenkzeit, Partieverlauf und Gewohnheiten."),
        points: [
          { title: t("Vergleich mit dir selbst"), text: t("Die meisten Karten vergleichen den gewählten Zeitraum mit dem davor.") },
          { title: t("Oben einstellen"), text: t("Zeitraum, Bedenkzeit und Farbe gelten für die ganze Seite.") },
        ],
      },
    ],
  },
  moves: {
    title: t("Züge & Fehler"),
    steps: [
      {
        say: t("Jeder deiner Züge, gezählt und sortiert."),
        sub: t("Oben die Bilanz in einem Satz, darunter die Fragen dazu: wird es besser, in welcher Phase, und wo passieren die Fehler?"),
        points: [
          { title: t("Alle Zugarten"), text: t("Eine Tabelle von brillant bis Patzer. Der Balken bist du, der Strich sind deine Gegner in denselben Partien.") },
          { title: t("Verlauf"), text: t("Beste Züge und grobe Fehler pro Monat, über deine ganze Geschichte.") },
          { title: t("Wo deine Fehler passieren"), text: t("Nach Zugnummer, Figur und Stellungslage. Farbig wird nur, was klar heraussticht.") },
        ],
      },
    ],
  },
  openings: {
    title: t("Eröffnungen"),
    steps: [
      {
        say: t("Dein Repertoire, so wie du es wirklich spielst."),
        sub: t("Welche Eröffnungen du spielst, wie sie für dich laufen und wo du früh vom Buch abweichst."),
        points: [
          { title: t("Erfolg je Eröffnung"), text: t("Punkte und Genauigkeit, getrennt nach Weiß und Schwarz.") },
          { title: t("Dein Eröffnungsbaum"), text: t("Klick dich Zug für Zug durch deine eigenen Partien.") },
        ],
      },
    ],
  },
  training: {
    title: "Training",
    steps: [
      {
        say: t("Eine Einheit am Tag, gebaut aus deinen Partien."),
        sub: t("Oben steht die Einheit für heute mit ihren Teilen. Ein Knopf startet sie. Dann tritt die App zurück und es gibt nur noch das Brett und die Aufgabe."),
        illus: "training",
        points: [
          { title: t("Drei Teile"), text: t("Aufwärmen mit fälligen Wiederholungen, dann dein Hauptthema, dann gemischte Aufgaben.") },
          { title: t("Deine Woche"), text: t("Jeder Tag hat ein Thema. Deine größte Schwäche kommt am häufigsten dran.") },
          { title: t("Anpassen"), text: t("Zeit pro Tag und Schwerpunkt stellst du über „Anpassen“ ein.") },
        ],
      },
    ],
  },
  exercises: {
    title: t("Übungen"),
    steps: [
      {
        say: t("Hier übst du gezielt ein Thema."),
        sub: t("Links stehen die Bereiche, rechts öffnet sich der gewählte mit seinen Aufgaben. Ein Knopf startet zehn davon."),
        points: [
          { title: t("Der Balken zeigt deinen Stand"), text: t("Grün sitzt sicher, Blau ist im Aufbau, der Rest ist neu.") },
          { title: t("Fällig heißt: jetzt wiederholen"), text: t("Diese Aufgaben kennst du schon. Heute ist der richtige Abstand, um sie zu festigen.") },
          { title: t("Eröffnungen wählst du selbst"), text: t("Deine eigenen Linien mit korrigierten Fehlern oder eine neue aus der Bibliothek.") },
        ],
      },
    ],
  },
  progress: {
    title: t("Fortschritt"),
    steps: [
      {
        say: t("Wirkt das Training?"),
        sub: t("Hier siehst du, wie oft du trainierst, was hängen bleibt und ob es in deinen Partien ankommt."),
        points: [
          { title: t("Der Kalender"), text: t("Jedes Kästchen ist ein Tag. Je kräftiger die Farbe, desto mehr Aufgaben.") },
          { title: t("Was hängen bleibt"), text: t("Aufgaben, die du nach einer Pause wieder auf Anhieb löst.") },
          { title: t("In deinen Partien"), text: t("Ob du die geübten Fehler seltener machst. Ein Urteil gibt es erst mit genug Partien davor und danach.") },
        ],
      },
    ],
  },
  players: {
    title: t("Gegner & Freunde"),
    steps: [
      {
        say: t("Lerne deine Gegner kennen."),
        sub: t("Füge Spieler mit ihrem Namen hinzu. Ich hole ihre Partien und analysiere sie wie deine."),
        illus: "players",
        points: [
          { title: t("Freunde"), text: t("Landen in deiner Liga und im direkten Vergleich mit dir.") },
          { title: t("Gegner"), text: t("Tippe einen Spieler an: Stil, Eröffnungen und typische Fehler.") },
        ],
      },
    ],
  },
  ranking: {
    title: t("Rangliste"),
    steps: [
      {
        say: t("Deine Liga mit Freunden."),
        sub: t("Alle stehen auf einer Skala, auch wenn ihr auf verschiedenen Plattformen spielt."),
        illus: "players",
        points: [
          { title: t("Spielstärke"), text: t("Gebildet aus Ergebnissen und Zugqualität, angezeigt wie eine Wertung im Schnellschach bei chess.com.") },
          { title: t("Was wäre wenn"), text: t("Sieh nach, was dir bis zum nächsten Platz fehlt.") },
        ],
      },
    ],
  },
};
