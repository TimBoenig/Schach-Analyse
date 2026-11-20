// Opening library: well-known main lines and their most important sidelines,
// to learn from scratch like in a repertoire trainer. Every line is a normal
// repertoire drill (spaced repetition, learn mode with shown moves first).

import type { RepertoireExercise } from "./exercises";
import { t } from "../../i18n";

export interface LibraryLine {
  name: string;
  moves: string;
}

export interface LibraryOpening {
  key: string;
  name: string;
  color: "white" | "black";
  /** Against what the opening is played, for grouping. */
  group: "1.e4 mit Weiß" | "1.d4 und andere mit Weiß" | "Gegen 1.e4" | "Gegen 1.d4";
  idea: string;
  lines: LibraryLine[];
}

export const OPENING_LIBRARY: LibraryOpening[] = [
  {
    key: "italian",
    name: t("Italienische Partie"),
    color: "white",
    group: "1.e4 mit Weiß",
    idea: t("Läufer auf c4 zielt auf f7, ruhiger Aufbau mit c3 und d3, später d4 oder Angriff am Königsflügel."),
    lines: [
      { name: "Giuoco Pianissimo", moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6" },
      { name: t("Zweispringerspiel"), moves: "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7 O-O O-O Re1 d6 c3" },
      { name: t("Evans-Gambit"), moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O" },
    ],
  },
  {
    key: "ruy",
    name: t("Spanische Partie"),
    color: "white",
    group: "1.e4 mit Weiß",
    idea: t("Druck auf den Springer c6 und damit auf e5. Langfristiger Plan c3 und d4 mit Raumvorteil."),
    lines: [
      { name: t("Geschlossene Variante"), moves: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3" },
      { name: t("Berliner Verteidigung"), moves: "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8" },
    ],
  },
  {
    key: "scotch",
    name: t("Schottische Partie"),
    color: "white",
    group: "1.e4 mit Weiß",
    idea: t("Sofort d4 öffnet das Zentrum, freies Figurenspiel statt langer Manöver."),
    lines: [{ name: t("Hauptvariante 4...Lc5"), moves: "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4" }],
  },
  {
    key: "kings-gambit",
    name: t("Königsgambit"),
    color: "white",
    group: "1.e4 mit Weiß",
    idea: t("Weiß opfert den f-Bauern für schnelle Entwicklung und die offene f-Linie."),
    lines: [{ name: "Kieseritzky", moves: "e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5" }],
  },
  {
    key: "qgd-white",
    name: t("Damengambit"),
    color: "white",
    group: "1.d4 und andere mit Weiß",
    idea: t("c4 greift d5 an. Weiß bekommt das Zentrum und Druck auf der c-Linie."),
    lines: [
      { name: t("Abgelehntes Damengambit"), moves: "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3" },
      { name: t("Angenommenes Damengambit"), moves: "d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6" },
      { name: t("Slawische Verteidigung"), moves: "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O" },
    ],
  },
  {
    key: "london",
    name: t("Londoner System"),
    color: "white",
    group: "1.d4 und andere mit Weiß",
    idea: t("Fester Aufbau mit Lf4, e3, c3 und Ld3, fast gegen alles spielbar, wenig Theorie."),
    lines: [
      { name: t("Gegen ...d5"), moves: "d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3" },
      { name: t("Gegen Königsindisch-Aufbau"), moves: "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3 c5 c3" },
    ],
  },
  {
    key: "english",
    name: t("Englische Partie"),
    color: "white",
    group: "1.d4 und andere mit Weiß",
    idea: t("Kontrolle von d5 vom Flügel aus, Fianchetto auf g2 und Druck auf die lange Diagonale."),
    lines: [{ name: t("Umgekehrter Sizilianer"), moves: "c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6 O-O Be7" }],
  },
  {
    key: "reti",
    name: t("Réti-Eröffnung"),
    color: "white",
    group: "1.d4 und andere mit Weiß",
    idea: t("Flexibel mit Sf3 und g3, das Zentrum wird erst später besetzt."),
    lines: [{ name: t("Königsindischer Angriff"), moves: "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4" }],
  },
  {
    key: "sicilian",
    name: t("Sizilianische Verteidigung"),
    color: "black",
    group: "Gegen 1.e4",
    idea: t("Ungleiche Bauernstruktur: Schwarz tauscht c- gegen d-Bauern und spielt auf Gegenangriff am Damenflügel."),
    lines: [
      { name: t("Najdorf, englischer Angriff"), moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7" },
      { name: t("Drachenvariante"), moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6" },
      { name: t("Gegen Alapin 2.c3"), moves: "e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6" },
    ],
  },
  {
    key: "french",
    name: t("Französische Verteidigung"),
    color: "black",
    group: "Gegen 1.e4",
    idea: t("Feste Kette e6–d5, Schwarz greift das weiße Zentrum mit c5 und f6 an."),
    lines: [
      { name: "Winawer", moves: "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O" },
      { name: t("Vorstoßvariante"), moves: "e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4" },
    ],
  },
  {
    key: "caro",
    name: t("Caro-Kann-Verteidigung"),
    color: "black",
    group: "Gegen 1.e4",
    idea: t("Solide wie Französisch, aber der weißfeldrige Läufer kommt vor e6 heraus."),
    lines: [
      { name: t("Klassische Variante"), moves: "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3" },
      { name: t("Vorstoßvariante"), moves: "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3" },
    ],
  },
  {
    key: "scandi",
    name: t("Skandinavische Verteidigung"),
    color: "black",
    group: "Gegen 1.e4",
    idea: t("Sofortiger Zentrumsschlag, die Dame steht nach Da5 aktiv, einfache Pläne."),
    lines: [{ name: t("Hauptvariante 3...Da5"), moves: "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6" }],
  },
  {
    key: "e5-black",
    name: t("1...e5 (offene Spiele)"),
    color: "black",
    group: "Gegen 1.e4",
    idea: t("Klassisch und gesund: Zentrum halten, schnell entwickeln, früh rochieren."),
    lines: [
      { name: t("Gegen Italienisch"), moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O a6 a4 O-O" },
      { name: t("Russische Verteidigung"), moves: "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7" },
    ],
  },
  {
    key: "pirc",
    name: t("Pirc-Verteidigung"),
    color: "black",
    group: "Gegen 1.e4",
    idea: t("Weiß darf das Zentrum bauen, Schwarz greift es später mit e5 oder c5 an."),
    lines: [{ name: t("Klassisches System"), moves: "e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6" }],
  },
  {
    key: "qgd-black",
    name: t("Damengambit ablehnen"),
    color: "black",
    group: "Gegen 1.d4",
    idea: t("Mit e6 und d5 hält Schwarz das Zentrum stabil, Befreiung später mit c5 oder e5."),
    lines: [
      { name: t("Orthodoxe Verteidigung"), moves: "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3" },
      { name: t("Gegen das Londoner System"), moves: "d4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O" },
    ],
  },
  {
    key: "kid",
    name: t("Königsindische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4",
    idea: t("Weiß bekommt das Zentrum, Schwarz kontert mit e5 und greift am Königsflügel an."),
    lines: [{ name: t("Klassische Variante"), moves: "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7" }],
  },
  {
    key: "nimzo",
    name: t("Nimzoindische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4",
    idea: t("Lb4 fesselt den Springer und kämpft um e4, oft gegen das Läuferpaar getauscht."),
    lines: [
      { name: t("Rubinstein 4.e3"), moves: "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6" },
      { name: t("Damenindisch (nach 3.Sf3)"), moves: "d4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7" },
    ],
  },
  {
    key: "grunfeld",
    name: t("Grünfeld-Indische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4",
    idea: t("Schwarz überlässt Weiß das große Zentrum und beschießt es mit Lg7 und c5."),
    lines: [{ name: t("Abtauschvariante"), moves: "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Be3" }],
  },
  {
    key: "dutch",
    name: t("Holländische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4",
    idea: t("f5 kontrolliert e4 und bereitet einen Königsangriff vor."),
    lines: [{ name: t("Klassisch"), moves: "d4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6 Nc3" }],
  },
];

/** Every line of the library as a drill (ids start with "lib:"). */
export const LIBRARY_DRILLS: RepertoireExercise[] = OPENING_LIBRARY.flatMap((o) =>
  o.lines.map((l, i) => ({
    id: `lib:${o.key}:${i}`,
    kind: "repertoire" as const,
    category: "repertoire" as const,
    title: `${o.name}: ${l.name}`,
    color: o.color,
    opening: `${o.name}: ${l.name}`,
    moves: l.moves.split(" "),
    correction: null,
    games: 0,
    score_pct: null,
    library: o.key,
    idea: o.idea,
  })),
);
