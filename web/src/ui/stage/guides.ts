// Lucena's explanation of each page, shown fullscreen on the first visit and
// from the "Erklären" button. Only how a page works stands here; the numbers
// are on the page itself.
import type { Mood } from "../coach/net";
import type { IllusKind } from "./Illus";
import type { Point } from "./script";

export type GuideId = "home" | "games" | "analysis" | "profile" | "insights" | "moves" | "openings" | "training" | "exercises" | "progress" | "players" | "ranking";

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
    title: "Start",
    steps: [
      {
        say: "Das ist dein Tag auf einen Blick.",
        sub: "Oben steht, was heute dran ist. Darunter, wie es zuletzt lief.",
        points: [
          { title: "Dein nächster Schritt", text: "Die Einheit für heute oder neue Partien, die auf dich warten." },
          { title: "Deine Form", text: "Wertung, Genauigkeit und Ergebnisse der letzten Wochen im Vergleich zu davor." },
          { title: "Dein Kalender", text: "An welchen Tagen du gespielt und trainiert hast." },
        ],
      },
    ],
  },
  games: {
    title: "Partien",
    steps: [
      {
        say: "Hier holst du Partien und öffnest sie.",
        sub: "Neue Partien kommen mit einem Tipp von chess.com oder Lichess. Analysiert werden sie automatisch.",
        illus: "games",
        points: [
          { title: "Die Abzeichen", text: "Zeigen auf einen Blick, was in der Partie passiert ist: Glanzzüge, Fehler, Patzer." },
          { title: "Tippe eine Partie an", text: "Dann gehst du sie Zug für Zug durch und bekommst meinen Bericht mit Note." },
        ],
      },
    ],
  },
  analysis: {
    title: "Partie",
    steps: [
      {
        say: "So liest du eine analysierte Partie.",
        sub: "Links das Brett, rechts die Züge. Jeder Zug trägt sein Urteil.",
        illus: "engine",
        points: [
          { title: "Pfeile auf dem Brett", text: "Grün ist der beste Zug, orange der gespielte. Mit den Pfeiltasten gehst du durch die Partie." },
          { title: "Die Linie unter dem Brett", text: "Zeigt, wer wann besser stand. Jeder Knick ist ein Moment, der die Partie gedreht hat." },
        ],
      },
      {
        say: "Der Bericht fasst die Partie zusammen.",
        sub: "Eine Note, der Wendepunkt, deine drei Phasen und was du daraus mitnimmst.",
        points: [
          { title: "Die Note", text: "Misst deine Züge, nicht das Ergebnis. Eine verlorene Partie kann eine gute Note haben." },
          { title: "Im Vollbild", text: "Mit „Bericht mit Lucena“ gehe ich die Partie Schritt für Schritt mit dir durch." },
        ],
      },
    ],
  },
  profile: {
    title: "Überblick",
    steps: [
      {
        say: "Dein Profil in einem Bild.",
        sub: "Oben deine Spielstärke, darunter deine Fähigkeiten, dein Stil und der Verlauf.",
        illus: "stats",
        points: [
          { title: "Fähigkeiten", text: "Jede Fähigkeit steht als Wertung da, gemessen an Gegnern deiner Stärke. Die Linie zeigt, was für dich üblich wäre." },
          { title: "Stärken und Schwächen", text: "Nur was sich in genug Partien zeigt, steht hier. Jede Aussage nennt ihre Partien." },
        ],
      },
      {
        say: "Der Verlauf zeigt, wohin es geht.",
        sub: "Wertung und Genauigkeit über die Zeit. Den Zeitraum stellst du direkt am Diagramm ein.",
        points: [
          { title: "Wertung", text: "Eine Linie je Bedenkzeit und Plattform. Partien ohne Wertungspool, etwa gegen den Coach von chess.com, zählen nicht mit." },
          { title: "Genauigkeit", text: "Der Durchschnitt deiner Partien je Woche oder Monat, mit der Anzahl der Partien dahinter." },
        ],
      },
    ],
  },
  insights: {
    title: "Ergebnisse",
    steps: [
      {
        say: "Wo holst du Punkte, wo bleiben sie liegen?",
        sub: "Diese Seite schneidet deine Ergebnisse nach Gegner, Bedenkzeit, Partieverlauf und Gewohnheiten.",
        points: [
          { title: "Vergleich mit dir selbst", text: "Die meisten Karten vergleichen den gewählten Zeitraum mit dem davor." },
          { title: "Oben einstellen", text: "Zeitraum, Bedenkzeit und Farbe gelten für die ganze Seite." },
        ],
      },
    ],
  },
  moves: {
    title: "Züge & Fehler",
    steps: [
      {
        say: "Jeder deiner Züge, gezählt und sortiert.",
        sub: "Oben die Bilanz in einer Zeile, darunter die Fragen dazu: wann, wo und womit passieren Fehler?",
        points: [
          { title: "Die Bilanz", text: "Wie viele deiner Züge gut, ungenau oder falsch waren. Tippe eine Sorte an, um nur sie zu sehen." },
          { title: "Was dich Punkte kostet", text: "Fehler nach Partiephase, Zeit auf der Uhr und Figur. Die größte Baustelle steht oben." },
        ],
      },
    ],
  },
  openings: {
    title: "Eröffnungen",
    steps: [
      {
        say: "Dein Repertoire, so wie du es wirklich spielst.",
        sub: "Welche Eröffnungen du spielst, wie sie für dich laufen und wo du früh vom Buch abweichst.",
        points: [
          { title: "Erfolg je Eröffnung", text: "Punkte und Genauigkeit, getrennt nach Weiß und Schwarz." },
          { title: "Dein Eröffnungsbaum", text: "Klick dich Zug für Zug durch deine eigenen Partien." },
        ],
      },
    ],
  },
  training: {
    title: "Training",
    steps: [
      {
        say: "Eine Einheit am Tag, gebaut aus deinen Partien.",
        sub: "Oben startest du die Einheit für heute. Darunter steht, warum genau diese Aufgaben dran sind.",
        illus: "training",
        points: [
          { title: "Drei Teile", text: "Aufwärmen, dein Schwerpunkt, dann gemischte Aufgaben." },
          { title: "Dein Schwerpunkt", text: "Kommt aus dem, was dich in deinen Partien am meisten kostet." },
        ],
      },
    ],
  },
  exercises: {
    title: "Übungen",
    steps: [
      {
        say: "Hier übst du gezielt ein Thema.",
        sub: "Jede Karte ist ein Thema mit Aufgaben aus deinen eigenen Partien.",
        points: [
          { title: "Empfohlen steht oben", text: "Die Themen, in denen du zuletzt die meisten Fehler gemacht hast." },
          { title: "Dein Stand je Thema", text: "Wie viele Aufgaben es gibt und wie viele du schon sicher löst." },
        ],
      },
    ],
  },
  progress: {
    title: "Fortschritt",
    steps: [
      {
        say: "Wirkt das Training?",
        sub: "Hier siehst du, wie oft du trainierst, was hängen bleibt und ob es in deinen Partien ankommt.",
        points: [
          { title: "Behalten", text: "Aufgaben, die du nach einer Pause wieder richtig löst." },
          { title: "Übertragen", text: "Ob du die geübten Fehler in neuen Partien seltener machst." },
        ],
      },
    ],
  },
  players: {
    title: "Gegner & Freunde",
    steps: [
      {
        say: "Lerne deine Gegner kennen.",
        sub: "Füge Spieler mit ihrem Namen hinzu. Ich hole ihre Partien und analysiere sie wie deine.",
        illus: "players",
        points: [
          { title: "Freunde", text: "Landen in deiner Liga und im direkten Vergleich mit dir." },
          { title: "Gegner", text: "Tippe einen Spieler an: Stil, Eröffnungen und typische Fehler." },
        ],
      },
    ],
  },
  ranking: {
    title: "Rangliste",
    steps: [
      {
        say: "Deine Liga mit Freunden.",
        sub: "Alle stehen auf einer Skala, auch wenn ihr auf verschiedenen Plattformen spielt.",
        illus: "players",
        points: [
          { title: "Spielstärke", text: "Gebildet aus Ergebnissen und Zugqualität, angezeigt wie eine Wertung im Schnellschach bei chess.com." },
          { title: "Was wäre wenn", text: "Sieh nach, was dir bis zum nächsten Platz fehlt." },
        ],
      },
    ],
  },
};
