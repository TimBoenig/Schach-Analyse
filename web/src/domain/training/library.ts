// Opening library: well-known main lines and their most important sidelines,
// to learn from scratch like in a repertoire trainer. Every line is a normal
// repertoire drill (spaced repetition, learn mode with shown moves first).

import type { RepertoireExercise } from "./exercises";
import { t } from "../../i18n";

export interface LibraryLine {
  name: string;
  moves: string;
  /** What the line is about: plans, structure, typical ideas for both sides. */
  plan?: string;
}

export interface LibraryOpening {
  key: string;
  name: string;
  color: "white" | "black";
  /** Against what the opening is played, for grouping. */
  group: "1.e4 mit Weiß" | "1.d4 und andere mit Weiß" | "Gegen 1.e4" | "Gegen 1.d4"; // i18n: id
  idea: string;
  lines: LibraryLine[];
}

export const OPENING_LIBRARY: LibraryOpening[] = [
  {
    key: "italian",
    name: t("Italienische Partie"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Läufer auf c4 zielt auf f7, ruhiger Aufbau mit c3 und d3, später d4 oder Angriff am Königsflügel."),
    lines: [
      {
        name: "Giuoco Pianissimo",
        moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Nbd2 Ba7 Bb3 Re8 h3 h6 Nf1 Be6 Bxe6 Rxe6 Ng3",
        plan: t("Weiß baut ruhig auf: c3 und d3 stützen das Zentrum, der Springer wandert über d2 und f1 nach g3. Später folgt d4 oder ein Angriff am Königsflügel. Schwarz hält den Läufer mit ...a6 und ...Ba7 sicher und tauscht erst, wenn es nützt."),
      },
      {
        name: t("Zweispringerspiel"),
        moves: "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7 O-O O-O Re1 d6 c3 a6 Bb3 Na5 Bc2 c5 Nbd2 Nc6 Nf1 Re8",
        plan: t("Mit 4.d3 vermeidet Weiß die scharfen Linien und spielt auf Raum und Geduld. Schwarz zieht mit ...Na5 und ...c5 den Läufer aus der Diagonale und besetzt das Zentrum."),
      },
      {
        name: t("Evans-Gambit"),
        moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O d6 cxd4 Bb6 Nc3 Na5 Bg5 f6",
        plan: t("Weiß gibt einen Bauern für ein großes Zentrum und schnelle Entwicklung. Der Läufer c4 bleibt auf f7 gerichtet, und c3 mit d4 vertreibt den schwarzen Läufer. Schwarz muss die Figuren heil durch den Angriff bringen."),
      },
      {
        name: t("Zweispringer: 4.Sg5"),
        moves: "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5 Bd6 d4 exd3 Nxd3 Qc7",
        plan: t("Weiß gibt den Bauern d5 zurück oder behält ihn, Schwarz bekommt dafür Entwicklungsvorsprung und das Läuferpaar. Kenne die Antwort auf jeden Schritt: nach 5...Sa5 rettet Weiß mit Lb5+ den Läufer, nach ...e4 helfen Se5 und d4."),
      },
    ],
  },
  {
    key: "ruy",
    name: t("Spanische Partie"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Druck auf den Springer c6 und damit auf e5. Langfristiger Plan c3 und d4 mit Raumvorteil."),
    lines: [
      {
        name: t("Geschlossene Variante"),
        moves: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7 Nbd2 cxd4 cxd4 Nc6",
        plan: t("Weiß baut mit c3 und d4 ein Zentrum und hält die Spannung auf e5. Schwarz kontert am Damenflügel mit ...Na5 und ...c5. Das Mittelspiel dreht sich um den Druck auf e5 und die offene c-Linie."),
      },
      {
        name: t("Berliner Verteidigung"),
        moves: "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8 Nc3 Ke8 h3 Bd7 b3 h6 Bb2 b6 Rad1",
        plan: t("Früher Damentausch, aber kein Remis: Schwarz hat das Läuferpaar und eine feste Stellung, Weiß die bessere Bauernstruktur am Königsflügel (4 gegen 3 nach dem Tausch auf c6). Weiß spielt auf ein langes Endspiel mit kleinem Vorteil, Schwarz auf aktive Figuren."),
      },
      {
        name: t("Abtauschvariante"),
        moves: "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5 Nb3 Qxd1 Rxd1 Bg4 f3 Bd7 Nc3 O-O-O",
        plan: t("Weiß gibt das Läuferpaar ab und bekommt dafür die bessere Bauernstruktur: 4 Bauern gegen 3 am Königsflügel. Im Endspiel wird daraus ein Freibauer. Schwarz braucht Läuferpaar und Aktivität, um das auszugleichen."),
      },
      {
        name: t("Offene Variante"),
        moves: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4 d4 b5 Bb3 d5 dxe5 Be6 c3 Be7 Nbd2 O-O Bc2 Bf5 Nb3 Qd7 Nbd4 Nxd4 Nxd4 Bg6",
        plan: t("Schwarz nimmt den Bauern e4 und stützt den Springer mit ...d5. Dafür liegen die Figuren offen. Weiß spielt gegen den Springer auf e4 und den Bauern e5, Schwarz bekommt Aktivität und ein solides Zentrum."),
      },
    ],
  },
  {
    key: "scotch",
    name: t("Schottische Partie"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Sofort d4 öffnet das Zentrum, freies Figurenspiel statt langer Manöver."),
    lines: [
      {
        name: t("Hauptvariante 4...Lc5"),
        moves: "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4 Ne5 Be2 Qg6 O-O d6",
        plan: t("Weiß öffnet das Zentrum sofort. Läufer c5 und Dame f6 greifen d4 an, c3 stützt den Springer. Schwarz bekommt Entwicklung und Königsangriff, Weiß ein gutes Zentrum und die bessere Bauernstruktur."),
      },
      {
        name: t("Mieses-Variante 4...Sf6"),
        moves: "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6 b3 g6 Bb2 Bg7 g3",
        plan: t("Weiß gewinnt Zeit und Raum mit e5 und c4. Schwarz hat die Doppelbauern auf c6, aber das Läuferpaar. Entscheidend ist, wer die Felder in der Mitte kontrolliert."),
      },
      {
        name: t("Schottischer Vierspringer"),
        moves: "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nc3 Bb4 Nxc6 bxc6 Bd3 d5 exd5 cxd5 O-O O-O Bg5 c6 Qf3 Be7 Rae1 Be6",
        plan: t("Ruhige Mittelspielstellung mit einem Bauern auf d5 gegen d4. Weiß entwickelt mit Tempo und fesselt, Schwarz hält mit ...c6 und ...Le6 alles zusammen. Das Ziel von Weiß ist ein Angriff am Königsflügel."),
      },
    ],
  },
  {
    key: "kings-gambit",
    name: t("Königsgambit"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Weiß opfert den f-Bauern für schnelle Entwicklung und die offene f-Linie."),
    lines: [{ name: "Kieseritzky", moves: "e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5" }],
  },
  {
    key: "qgd-white",
    name: t("Damengambit"),
    color: "white",
    group: "1.d4 und andere mit Weiß", // i18n: id
    idea: t("c4 greift d5 an. Weiß bekommt das Zentrum und Druck auf der c-Linie."),
    lines: [
      {
        name: t("Abgelehntes Damengambit"),
        moves: "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5 Bxe7 Qxe7 O-O Nxc3 Rxc3 e5",
        plan: t("Klassische Hauptlinie: Weiß fesselt den Springer f6 und baut Druck auf. Schwarz tauscht Figuren, um Platz zu bekommen, und befreit sich mit ...e5. Tausche ruhig mit, wenn die Mitte gut steht."),
      },
      {
        name: t("Angenommenes Damengambit"),
        moves: "d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 Qe2 b5 Bb3 Bb7 Rd1 Nbd7 Nc3 Qb6",
        plan: t("Weiß holt den Bauern zurück und spielt auf Entwicklungsvorsprung und aktive Figuren. Der Läufer b3 und die Dame e2 zielen auf den Königsflügel. Schwarz hat die offene c-Linie und den Bauern d4 im Visier."),
      },
      {
        name: t("Slawische Verteidigung"),
        moves: "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O Nbd7 Qe2 Bg6 e4 O-O Bd3 Bh5",
        plan: t("Der Läufer c8 kommt vor ...e6 heraus. Weiß hält mit a4 den Bauern c4 unter Kontrolle und baut mit e4 das große Zentrum. Schwarz will dieses Zentrum mit ...c5 oder ...e5 angreifen."),
      },
      {
        name: t("Abtauschvariante (Minoritätsangriff)"),
        moves: "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Be7 Bd3 Nbd7 Qc2 O-O Nge2 Re8 O-O Nf8 Rab1",
        plan: t("Der Klassiker unter den Plänen: Weiß greift mit b4-b5 am Damenflügel an, um eine Schwäche auf c6 zu erzwingen (Minoritätsangriff). Schwarz hat Gegenspiel im Zentrum und am Königsflügel, mit ...Sg6 und ...Sf5."),
      },
    ],
  },
  {
    key: "london",
    name: t("Londoner System"),
    color: "white",
    group: "1.d4 und andere mit Weiß", // i18n: id
    idea: t("Fester Aufbau mit Lf4, e3, c3 und Ld3, fast gegen alles spielbar, wenig Theorie."),
    lines: [
      {
        name: t("Gegen ...d5"),
        moves: "d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3 b6 Ne5 Bb7",
        plan: t("Der Läufer kommt vor e3 heraus, das Bauerndreieck c3-d4-e3 steht fest. Weiß plant Se5 und später f4 oder einen Tausch auf d6. Wenig Theorie, aber nicht zu passiv spielen: der Springer e5 ist der Hebel."),
      },
      {
        name: t("Gegen Königsindisch-Aufbau"),
        moves: "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3 c5 c3 Qb6 Qb3 Qxb3 axb3 cxd4 exd4 Nc6",
        plan: t("Gegen den Fianchetto-Aufbau hält Weiß das Zentrum mit c3 und e3 und tauscht die Damen, wenn Schwarz auf b2 drückt. Die offene a-Linie für den Turm entschädigt für die Doppelbauern."),
      },
      {
        name: t("Gegen ...e6 und ...b6"),
        moves: "d4 Nf6 Bf4 e6 e3 Be7 Nf3 O-O h3 b6 Nbd2 Bb7 c3 d5 Bd3 Nbd7 O-O c5",
        plan: t("Weiß behält den Aufbau und rochiert kurz. Schwarz bekommt mit ...c5 sein Gegenspiel in der Mitte. Wenn Schwarz auf c5 tauscht, nimmt Weiß zurück und behält die Mitte."),
      },
    ],
  },
  {
    key: "english",
    name: t("Englische Partie"),
    color: "white",
    group: "1.d4 und andere mit Weiß", // i18n: id
    idea: t("Kontrolle von d5 vom Flügel aus, Fianchetto auf g2 und Druck auf die lange Diagonale."),
    lines: [
      {
        name: t("Umgekehrter Sizilianer"),
        moves: "c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 a3 O-O b4 Be6 Bb2 f6",
        plan: t("Wie ein Sizilianer mit einem Tempo mehr für Weiß. Weiß hat die offene c-Linie und spielt mit a3 und b4 am Damenflügel. Schwarz hält das Zentrum mit ...e5 und ...f6."),
      },
      {
        name: t("Symmetrische Variante"),
        moves: "c4 c5 Nf3 Nf6 Nc3 Nc6 g3 g6 Bg2 Bg7 O-O O-O d3 d6 a3 a6 Rb1 Rb8 b4 cxb4 axb4 b5 cxb5 axb5",
        plan: t("Beide Seiten spielen den gleichen Plan: Fianchetto, dann ein Vorstoß mit b4. Wer zuerst die Spannung löst, bekommt eine offene Linie. Wichtig ist die Kontrolle über d5 und d4."),
      },
      {
        name: t("Vierspringer mit e3"),
        moves: "c4 e5 Nc3 Nf6 Nf3 Nc6 e3 Bb4 Qc2 Bxc3 Qxc3 Qe7 a3 a5 b3 O-O Bb2 d6 Be2 Re8",
        plan: t("Ein ruhiger, solider Aufbau. Weiß hat das Läuferpaar und spielt auf Druck gegen e5 und auf Entwicklung. Schwarz hält mit ...a5 und ...d6 alles zusammen."),
      },
    ],
  },
  {
    key: "reti",
    name: t("Réti-Eröffnung"),
    color: "white",
    group: "1.d4 und andere mit Weiß", // i18n: id
    idea: t("Flexibel mit Sf3 und g3, das Zentrum wird erst später besetzt."),
    lines: [{ name: t("Königsindischer Angriff"), moves: "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4" }],
  },
  {
    key: "sicilian",
    name: t("Sizilianische Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Ungleiche Bauernstruktur: Schwarz tauscht c- gegen d-Bauern und spielt auf Gegenangriff am Damenflügel."),
    lines: [
      {
        name: t("Najdorf, englischer Angriff"),
        moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5 g5 b4 Ne2 Ne8",
        plan: t("Weiß rochiert lang und stürmt mit g4-g5 am Königsflügel, Schwarz mit ...b5-b4 am Damenflügel. Ein Rennen: Wer schneller ist, gewinnt. Der Bauer d6 bleibt schwach, aber ...e5 gibt Schwarz das Feld d5."),
      },
      {
        name: t("Drachenvariante"),
        moves: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6 Bc4 Bd7 O-O-O Rc8 Bb3 Ne5 h4 h5 Bg5 Rc5",
        plan: t("Jugoslawischer Angriff: beide rochieren auf entgegengesetzten Seiten und stürmen. Weiß mit h4 auf den Königsflügel, Schwarz mit der c-Linie und dem Läufer g7 auf der langen Diagonale. Hier zählt Wissen: ein Zug zu spät und es ist vorbei."),
      },
      {
        name: t("Gegen Alapin 2.c3"),
        moves: "e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4 Nb6 Bb5 dxe5 Nxe5 Bd7 Nxd7 Qxd7",
        plan: t("Weiß will ein großes Zentrum, Schwarz greift es mit ...Sd5 und ...d6 sofort an. Der Tausch auf e5 und d7 führt zu einer ruhigen Stellung ohne große Gefahren für Schwarz."),
      },
      {
        name: t("Scheveninger Aufbau"),
        moves: "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nf6 Nc3 d6 Be2 Be7 O-O O-O f4 Nc6 Be3 Qc7 Kh1 a6 Qe1 Nxd4 Bxd4 b5",
        plan: t("Schwarz baut eine kompakte Kleinbauernkette e6-d6. Weiß rochiert kurz und spielt f4 mit Angriff, Schwarz kontert mit ...b5 und ...Lb7. Erst die Lage klären, dann zuschlagen."),
      },
    ],
  },
  {
    key: "french",
    name: t("Französische Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Feste Kette e6–d5, Schwarz greift das weiße Zentrum mit c5 und f6 an."),
    lines: [
      {
        name: "Winawer",
        moves: "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O Bd3 Nbc6 Qh5 Ng6 Nf3 Qa5 Bd2 c4 Be2 Bd7 O-O Rac8",
        plan: t("Schwarz gibt das Läuferpaar ab und bekommt dafür Doppelbauern bei Weiß und Druck auf c3. Weiß hat Läuferpaar und Raum am Königsflügel. Das Mittelspiel ist scharf und taktisch."),
      },
      {
        name: t("Vorstoßvariante"),
        moves: "e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4 Nbd2 Bd7 Be2 Na5 O-O Ne7 Rb1 Nec6",
        plan: t("Die feste Kette e5-d4 gibt Weiß Raum am Königsflügel. Schwarz greift die Basis der Kette (d4) mit ...c5 und ...Db6 an und bindet Weiß am Damenflügel. Plan für Weiß: Königsangriff mit Sh4, f4, Dg4."),
      },
      {
        name: t("Tarrasch-Variante"),
        moves: "e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4 f6 exf6 Nxf6 Nf3 Bd6 O-O O-O",
        plan: t("Der Springer d2 vermeidet die Fesselung der Winawer. Schwarz hat nach ...f6 freies Spiel und gleicht leicht aus. Weiß bleibt mit einem kleinen Raumvorteil und spielt auf Druck in der Mitte."),
      },
      {
        name: t("Abtauschvariante"),
        moves: "e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O Bg5 Bg4 Nbd2 Nbd7 c3 c6 Qc2 Qc7",
        plan: t("Symmetrische Stellung, aber Weiß hat den ersten Zug. Es geht um kleine Vorteile: Wer die Figuren besser aufstellt, gewinnt. Eine gute Wahl für Schwarz, wenn er ohne viel Theorie spielen will."),
      },
    ],
  },
  {
    key: "caro",
    name: t("Caro-Kann-Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Solide wie Französisch, aber der weißfeldrige Läufer kommt vor e6 heraus."),
    lines: [
      {
        name: t("Klassische Variante"),
        moves: "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6 Bf4 Qa5+ Bd2 Qc7 O-O-O Ngf6 Ne4 O-O-O",
        plan: t("Schwarz holt den Läufer vor ...e6 heraus und hat danach eine felsenfeste Bauernstruktur. Weiß hat Raum und kann am Königsflügel angreifen. Schwarz kontert über die Mitte (...c5) und hat meist die bessere Bauernstruktur im Endspiel."),
      },
      {
        name: t("Vorstoßvariante"),
        moves: "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 cxd4 Nxd4 Nc6 Nd2 Nge7 N2b3 Qb6",
        plan: t("Auch hier kommt der Läufer vor ...e6 heraus. Der Vorstoß e5 gibt Weiß Raum, aber der Bauer d4 wird mit ...c5 angegriffen. Schwarz hat gutes Gegenspiel am Damenflügel."),
      },
      {
        name: t("Panov-Angriff"),
        moves: "e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7 cxd5 Nxd5 Bd3 Nc6 O-O O-O Re1 Bf6 Be4 Nxc3 bxc3",
        plan: t("Weiß bekommt ein aktives Zentrum mit Isolani auf d4 oder hängenden Bauern. Schwarz blockiert den Bauern und setzt ihn unter Druck. Typisch: Figurenspiel und Angriff gegen eine Bauernschwäche."),
      },
    ],
  },
  {
    key: "scandi",
    name: t("Skandinavische Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Sofortiger Zentrumsschlag, die Dame steht nach Da5 aktiv, einfache Pläne."),
    lines: [
      {
        name: t("Hauptvariante 3...Da5"),
        moves: "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6 Qe2 Bb4",
        plan: t("Die Dame kommt früh heraus, wird mit Sc3 vertrieben, steht auf a5 aber sicher. Schwarz entwickelt alles mit Tempo und rochiert kurz. Weiß hat einen Entwicklungsvorsprung, Schwarz die solide Struktur."),
      },
      {
        name: t("3...Dd6"),
        moves: "e4 d5 exd5 Qxd5 Nc3 Qd6 d4 Nf6 Nf3 a6 g3 Nc6 Bg2 Bg4 O-O O-O-O",
        plan: t("Die Dame auf d6 steht ruhiger, aber etwas passiv. Weiß hat Entwicklungsvorsprung und Raum. Schwarz sollte schnell fertig werden und das Läuferpaar behalten."),
      },
      {
        name: t("Moderne Variante 2...Sf6"),
        moves: "e4 d5 exd5 Nf6 d4 Nxd5 Nf3 g6 Be2 Bg7 O-O O-O c4 Nb6 Nc3 Nc6 Be3 Bg4",
        plan: t("Schwarz holt den Bauern mit einem Springer zurück und vermeidet die frühe Dame. Weiß bekommt viel Raum, aber auch Ziele. Gut für alle, die es ruhiger wollen."),
      },
    ],
  },
  {
    key: "e5-black",
    name: t("1...e5 (offene Spiele)"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Klassisch und gesund: Zentrum halten, schnell entwickeln, früh rochieren."),
    lines: [
      {
        name: t("Gegen Italienisch"),
        moves: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O a6 a4 O-O Re1 Ba7 h3 h6 Nbd2 Re8",
        plan: t("Schwarz spiegelt Weiß: schnell entwickeln, rochieren, mit ...d6 und ...Ba7 das Zentrum stützen. Der Zug ...h6 nimmt dem Läufer g5 das Feld. Bleibe geduldig, der Zeitpunkt für ...d5 kommt später."),
      },
      {
        name: t("Russische Verteidigung"),
        moves: "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7 c4 Nb4 Be2 O-O Nc3 Bf5",
        plan: t("Schwarz spielt Gegenangriff statt Verteidigung und gleicht oft einfach aus. Wichtig: erst den Springer zurücktreiben (...d6), dann e4 nehmen. Sonst wirst du taktisch überrollt."),
      },
      {
        name: t("Gegen Spanisch (Geschlossen)"),
        moves: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7",
        plan: t("Schwarz hält mit ...d6 und ...Le7 die Mitte und greift am Damenflügel mit ...b5, ...Na5 und ...c5 an. Auf d4 wird die Spannung gehalten, bis die Figuren stehen."),
      },
      {
        name: t("Gegen Schottisch"),
        moves: "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4 Ne5 Be2 Qg6 O-O d6",
        plan: t("Schwarz nimmt das Zentrum mit ...exd4 und baut Druck auf d4. Die Dame f6 greift an, der Springer e5 sichert die Zentrumsfelder. Wichtig: nicht zu gierig sein und rechtzeitig rochieren."),
      },
    ],
  },
  {
    key: "pirc",
    name: t("Pirc-Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Weiß darf das Zentrum bauen, Schwarz greift es später mit e5 oder c5 an."),
    lines: [{ name: t("Klassisches System"), moves: "e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6" }],
  },
  {
    key: "qgd-black",
    name: t("Damengambit ablehnen"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Mit e6 und d5 hält Schwarz das Zentrum stabil, Befreiung später mit c5 oder e5."),
    lines: [
      {
        name: t("Orthodoxe Verteidigung"),
        moves: "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5 Bxe7 Qxe7 O-O Nxc3 Rxc3 e5",
        plan: t("Schwarz hält das Zentrum mit ...e6 und ...d5 und befreit sich später mit ...e5 oder ...c5. Der Tausch von Figuren erleichtert die Verteidigung. Nach ...dxc4 ist es wichtig, sofort ...Sd5 zu spielen."),
      },
      {
        name: t("Gegen das Londoner System"),
        moves: "d4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6 Bg3 O-O Bd3 b6 Ne5 Bb7",
        plan: t("Schwarz greift mit ...c5 sofort das Zentrum an. Wenn Weiß passiv bleibt, bekommt Schwarz gutes Spiel. Typisch: ...Lb7 auf der langen Diagonale und Tausch gegen den weißen Läufer."),
      },
      {
        name: t("Abtauschvariante"),
        moves: "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7 e3 O-O Bd3 Nbd7 Nge2 Re8 Qc2 Nf8 O-O c6",
        plan: t("Gegen den Minoritätsangriff hält Schwarz mit ...c6 und ...Sf8-g6 die Mitte und spielt auf Gegenangriff am Königsflügel. Die Stellung ist klar, deshalb zählen Pläne mehr als Theorie."),
      },
    ],
  },
  {
    key: "kid",
    name: t("Königsindische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Weiß bekommt das Zentrum, Schwarz kontert mit e5 und greift am Königsflügel an."),
    lines: [
      {
        name: t("Klassische Variante"),
        moves: "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 Be3 f5 f3 f4 Bf2 g5",
        plan: t("Schwarz überlässt Weiß das Zentrum und schlägt zu, sobald die Bauern d5 und e4 erstarrt sind. Weiß greift am Damenflügel an (c5, b4), Schwarz am Königsflügel (f5-f4, g5-g4). Wer früher durchbricht, gewinnt: jeder Tempoverlust zählt."),
      },
      {
        name: t("Sämisch-Variante"),
        moves: "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 e5 Nge2 c6 Qd2 Nbd7 O-O-O a6 Kb1 b5",
        plan: t("Mit f3 und Le3 stützt Weiß sein Zentrum und plant lange Rochade mit Angriff am Königsflügel. Schwarz hält mit ...e5 und ...c6 dagegen und stürmt am Damenflügel mit ...b5. Wieder ein Rennen mit entgegengesetzten Flügeln."),
      },
      {
        name: t("Fianchetto-Variante"),
        moves: "d4 Nf6 c4 g6 Nc3 Bg7 Nf3 O-O g3 d6 Bg2 Nbd7 O-O e5 e4 c6 h3 Qb6 Re1 Re8",
        plan: t("Weiß verzichtet auf das große Zentrum und baut ruhig auf. Der Läufer g2 drückt auf die lange Diagonale. Schwarz hat nach ...e5 und ...c6 eine feste Stellung und gutes Gegenspiel."),
      },
    ],
  },
  {
    key: "nimzo",
    name: t("Nimzoindische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Lb4 fesselt den Springer und kämpft um e4, oft gegen das Läuferpaar getauscht."),
    lines: [
      {
        name: "Rubinstein 4.e3",
        moves: "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7 Bd3 e5",
        plan: t("Schwarz gibt den Läufer für einen Springer und beschädigt die weiße Struktur (Doppelbauern auf c). Weiß hat das Läuferpaar und kann im Zentrum aufbauen. Schwarz spielt gegen die schwachen Bauern auf c3 und c4."),
      },
      {
        name: t("Damenindisch (nach 3.Sf3)"),
        moves: "d4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7 Bg2 c6 Bc3 d5 Ne5 Nfd7 Nxd7 Nxd7 Nd2 O-O O-O",
        plan: t("Der Läufer a6 zielt auf c4. Schwarz tauscht gegen den aktiven Läufer von Weiß und erreicht ausgeglichenes Spiel. Ein Fall für Positionsspieler."),
      },
      {
        name: t("Klassisch 4.Dc2"),
        moves: "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5 Bb7 e3 d6 f3 Nbd7 Ne2 Qe8",
        plan: t("Weiß nimmt mit der Dame zurück und behält so die Bauernstruktur, gibt aber Zeit. Schwarz kontrolliert e4 mit ...b6 und ...Lb7. Das Läuferpaar von Weiß gleicht den Zeitverlust aus."),
      },
    ],
  },
  {
    key: "grunfeld",
    name: t("Grünfeld-Indische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Schwarz überlässt Weiß das große Zentrum und beschießt es mit Lg7 und c5."),
    lines: [
      {
        name: t("Abtauschvariante"),
        moves: "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Be3 Qa5 Qd2 O-O Rc1 Bg4",
        plan: t("Weiß baut ein großes Zentrum, Schwarz greift es sofort mit ...c5 und ...Lg7 an. Der Druck auf d4 und c3 entscheidet: Fällt das Zentrum, hat Schwarz gewonnen, hält es, ist Weiß im Vorteil."),
      },
      {
        name: t("Russische Variante"),
        moves: "d4 Nf6 c4 g6 Nc3 d5 Nf3 Bg7 Qb3 dxc4 Qxc4 O-O e4 Bg4 Be3 Nfd7 Qb3 Nb6 a4 a5",
        plan: t("Weiß hält die Dame aktiv und baut das Zentrum auf. Schwarz bekommt über ...Lg4 und ...Sfd7 Druck auf d4. Ein Spiel um Tempo und die Kontrolle über die Felder b6 und d5."),
      },
    ],
  },
  {
    key: "dutch",
    name: t("Holländische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("f5 kontrolliert e4 und bereitet einen Königsangriff vor."),
    lines: [{ name: t("Klassisch"), moves: "d4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6 Nc3" }],
  },
  {
    key: "vienna",
    name: t("Wiener Partie und Vierspringer"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Der Springer geht vor dem Läufer nach c3. Weiß behält die Wahl zwischen Königsgambit-Aufbau mit f4 und ruhiger Entwicklung."),
    lines: [
      {
        name: t("Wiener Gambit 3.f4"),
        moves: "e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d4 O-O Bd3 f5 exf6 Bxf6 O-O Nc6",
        plan: t("Weiß öffnet die f-Linie und baut ein großes Zentrum, Schwarz schlägt mit ...d5 zurück. Entscheidend sind die Tempi: Wer die offene f-Linie und das Zentrum besser nutzt, gewinnt. Gib nach ...Sxe4 den Bauern nicht her, sondern entwickle schnell."),
      },
      {
        name: "Frankenstein-Dracula",
        moves: "e4 e5 Nc3 Nf6 Bc4 Nxe4 Qh5 Nd6 Bb3 Nc6 Nb5 g6 Qf3 f5 Qd5 Qe7 Nxc7+ Kd8 Nxa8 b6",
        plan: t("Ein Taktik-Feuerwerk: Weiß opfert Material für Angriff, Schwarz hält mit genauen Zügen dagegen. Hier hilft nur auswendig gelerntes Wissen, denn fast jeder Zug droht Matt oder Damenverlust."),
      },
      {
        name: t("Vierspringer, Spanisch"),
        moves: "e4 e5 Nc3 Nc6 Nf3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5 Bxc3 bxc3 Qe7 Re1 Nd8 d4 Ne6",
        plan: t("Ruhiges, klassisches Spiel mit symmetrischer Struktur. Weiß hat nach dem Tausch auf c3 das Läuferpaar und den Druck gegen den Springer f6. Schwarz reagiert mit ...Sd8-g6 und baut eine feste Stellung."),
      },
    ],
  },
  {
    key: "catalan",
    name: t("Katalanische Eröffnung"),
    color: "white",
    group: "1.d4 und andere mit Weiß", // i18n: id
    idea: t("Läufer auf g2 drückt auf die lange Diagonale und gegen d5 und b7. Weiß spielt auf einen kleinen, dauerhaften Vorteil ohne viel Risiko."),
    lines: [
      {
        name: t("Offene Katalanisch"),
        moves: "d4 Nf6 c4 e6 g3 d5 Bg2 dxc4 Nf3 Be7 O-O O-O Qc2 a6 a4 Bd7 Qxc4 Bc6 Bg5 Bd5 Qd3",
        plan: t("Weiß gibt den Bauern kurz ab und holt ihn zurück, Schwarz hat die Mitte, Weiß dafür Druck auf der langen Diagonale und am Damenflügel. Wichtig ist ...Bd5 zu verhindern oder mit dem Läufer g2 zu tauschen."),
      },
      {
        name: t("Geschlossene Katalanisch"),
        moves: "d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 Qxc4 b5 Qc2 Bb7 Bd2 Be4 Qc1 Bb7 Bc3 Nbd7",
        plan: t("Weiß bekommt den Bauern zurück und baut Druck auf der langen Diagonale. Schwarz hat Raum am Damenflügel, aber Schwächen. Lerne die Ausweichmanöver der Dame, sie sind das Herz dieser Variante."),
      },
      {
        name: t("Mit Läufercheck 4...Lb4+"),
        moves: "d4 Nf6 c4 e6 g3 d5 Bg2 Bb4+ Bd2 Be7 Nf3 O-O O-O c6 Qc2 b6 Bf4 Ba6",
        plan: t("Schwarz erzwingt einen Tausch, den Weiß aber gerne annimmt. Der Läufer kommt nach f4 aktiv heraus. Schwarz spielt ...b6 und ...Lb7 oder ...La6 gegen den Bauern c4."),
      },
    ],
  },
  {
    key: "kia",
    name: t("Königsindischer Angriff"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Ein System statt viel Theorie: Sf3, g3, Lg2, d3, 0-0 und e4, fast gegen jede schwarze Antwort spielbar."),
    lines: [
      {
        name: t("Gegen Französisch"),
        moves: "e4 e6 d3 d5 Nd2 Nf6 Ngf3 c5 g3 Nc6 Bg2 Be7 O-O O-O Re1 b5 e5 Nd7 Nf1 b4 h4 a5",
        plan: t("Weiß hält das Zentrum mit e5 zusammen und greift am Königsflügel an: Sf1-h2/g3, h4-h5 und Lg2. Schwarz hat Platz am Damenflügel. Es ist ein Rennen zwischen beiden Flügeln."),
      },
      {
        name: t("Gegen Sizilianisch"),
        moves: "e4 c5 Nf3 e6 d3 Nc6 g3 g6 Bg2 Bg7 O-O Nge7 Re1 d6 c3 O-O Nbd2 b6",
        plan: t("Weiß vermeidet die offene Sizilianer-Theorie und baut ein stabiles System. Mit c3 und d4 oder einem Vorstoß mit e5 kommt später der Zentrumsdurchbruch."),
      },
      {
        name: t("Gegen Caro-Kann"),
        moves: "e4 c6 d3 d5 Nd2 e5 Ngf3 Nd7 g3 Ngf6 Bg2 Bc5 O-O O-O Qe2 Re8 c3 a5 Nb3 Bb6",
        plan: t("Schwarz baut eine feste Mitte, Weiß wartet ab und setzt später mit Sb3 und d4 oder Sh4 nach. Typische Pläne: Se1/Sf3, f4 oder Angriff mit Sh4-f5."),
      },
    ],
  },
  {
    key: "colle",
    name: t("Colle-System"),
    color: "white",
    group: "1.d4 und andere mit Weiß", // i18n: id
    idea: t("Ein fester Aufbau mit Sf3, e3, Ld3 und c3. Das Zentrum wird erst durch e4 gesprengt, ganz ohne große Theorie."),
    lines: [
      {
        name: t("Colle gegen ...d5"),
        moves: "d4 d5 Nf3 Nf6 e3 e6 Bd3 c5 c3 Nc6 Nbd2 Bd6 O-O O-O dxc5 Bxc5 e4 dxe4 Nxe4 Be7",
        plan: t("Weiß rochiert, tauscht auf c5 und stößt mit e4 durch. Das ist der Moment, in dem die Eröffnung ihr Ziel erreicht: offene Linien für die Figuren und Druck auf Schwarz' Königsflügel."),
      },
      {
        name: "Colle-Zukertort",
        moves: "d4 d5 Nf3 Nf6 e3 e6 Bd3 c5 b3 Nc6 O-O Bd6 Bb2 O-O Nbd2 b6 dxc5 bxc5 c4 Bb7",
        plan: t("Der Läufer geht nach b2 und zielt auf die lange Diagonale und e5. Mit dxc5 und c4 öffnet Weiß das Spiel und hat gute Aussichten auf e5. Schwarz hält mit ...Lb7 und ...Dc7 dagegen."),
      },
      {
        name: t("Gegen Königsindisch-Aufbau"),
        moves: "d4 Nf6 Nf3 g6 e3 Bg7 Bd3 O-O O-O d6 Nbd2 Nbd7 c3 e5 e4 exd4 cxd4 Nb6",
        plan: t("Weiß baut mit e3 und c3 auf und stößt dann mit e4 durch. Schwarz antwortet am besten mit ...e5 und greift das Zentrum an. Die Stellung ist offen und klar."),
      },
    ],
  },
  {
    key: "trompowsky",
    name: t("Trompowsky-Angriff"),
    color: "white",
    group: "1.d4 und andere mit Weiß", // i18n: id
    idea: t("Der Läufer greift sofort den Springer f6 an. Weiß wählt eine Struktur, die der Gegner nicht aus dem Lehrbuch kennt, und holt oft das Läuferpaar."),
    lines: [
      {
        name: t("Gegen 2...Se4"),
        moves: "d4 Nf6 Bg5 Ne4 Bf4 d5 e3 c5 Bd3 Qb6 Nd2 Nxd2 Kxd2 Nc6 c3 e5",
        plan: t("Der Läufer weicht nach f4 aus und bleibt aktiv. Nach dem Tausch auf d2 steht der König auf d2 unangenehm, deshalb sollte Weiß bald c3 spielen und die Mitte sichern. Schwarz hat gutes Spiel mit ...e5."),
      },
      {
        name: t("Gegen 2...e6"),
        moves: "d4 Nf6 Bg5 e6 e4 h6 Bxf6 Qxf6 Nc3 d6 Nf3 Nd7 Bd3 g5 O-O Bg7",
        plan: t("Weiß gibt den Läufer für den Springer und bekommt die Mitte. Schwarz hat das Läuferpaar und spielt gegen e4. Wer die Struktur besser versteht, gewinnt."),
      },
      {
        name: t("Gegen 2...d5"),
        moves: "d4 Nf6 Bg5 d5 Bxf6 exf6 e3 Be6 Nd2 Nd7 c3 c6 Bd3 Bd6 Qc2 O-O",
        plan: t("Schwarz bekommt das Läuferpaar, aber schwache Bauern auf f6 und f7. Weiß spielt ruhig und plant Sgf3, h3 und den Angriff auf die schwarze Struktur."),
      },
    ],
  },
  {
    key: "philidor",
    name: t("Philidor-Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Solider Bauernaufbau mit d6 und e5. Schwarz lässt Weiß etwas Raum und wartet auf den richtigen Moment für ...exd4 oder ...Sbd7 und ...c6."),
    lines: [
      {
        name: t("Hanham-Aufbau"),
        moves: "e4 d6 d4 Nf6 Nc3 Nbd7 Nf3 e5 Bc4 Be7 O-O O-O Qe2 c6 a4 Qc7 Re1 Re8",
        plan: t("Schwarz hält mit ...Sbd7, ...Le7 und ...c6 alles zusammen und wartet. Weiß hat mehr Raum und baut mit a4 und Qe2 den Druck auf. Gegenspiel kommt durch ...exd4 oder ...b5."),
      },
      {
        name: t("Abtauschvariante"),
        moves: "e4 d6 d4 Nf6 Nc3 e5 dxe5 dxe5 Qxd8+ Kxd8 Bc4 Be6 Bxe6 fxe6 Bg5 Nbd7 O-O-O Ke8",
        plan: t("Früher Damentausch, Schwarz verliert die Rochade, bekommt aber ein solides Endspiel. Weiß hat leichten Raumvorteil. Hier ist genaues Wissen wichtig, damit Schwarz nicht in taktische Probleme gerät."),
      },
      {
        name: t("Gegen 3.Lc4"),
        moves: "e4 d6 d4 Nf6 Nc3 Nbd7 Bc4 e6 Nf3 Be7 O-O O-O Qe2 c5 Rd1 Qc7",
        plan: t("Schwarz baut mit ...e6 eine feste Mitte und greift sie mit ...c5 an. Das ist eine sichere Antwort auf scharfes Spiel."),
      },
    ],
  },
  {
    key: "alekhine",
    name: t("Aljechin-Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Schwarz lockt den weißen Zentrumsbauern vor und greift ihn dann an. Der Springer springt mehrmals, dafür wird die Mitte überdehnt."),
    lines: [
      {
        name: t("Vierbauernangriff"),
        moves: "e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 f4 dxe5 fxe5 Nc6 Be3 Bf5 Nc3 e6 Nf3 Be7",
        plan: t("Weiß baut ein riesiges Zentrum, Schwarz greift es an: ...dxe5 und ...Sc6 setzen sofort Druck auf d4 und e5. Die Mitte ist scharf, deshalb zählt die Zugfolge."),
      },
      {
        name: t("Moderne Variante"),
        moves: "e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7 c4 Nb6 Nc3 O-O h3 Bh5 exd6 cxd6",
        plan: t("Weiß entwickelt ruhig, Schwarz entwickelt den Läufer vor e6 und baut Druck auf. Nach ...cxd6 ist die Struktur gesund, und Schwarz hat gutes Gegenspiel gegen d4."),
      },
      {
        name: t("Abtauschvariante"),
        moves: "e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 exd6 exd6 Nc3 Be7 Bd3 O-O Nge2 Bf6 O-O Nc6",
        plan: t("Weiß hat mehr Raum, Schwarz die gesündere Bauernstruktur. Schwarz sucht Gegenspiel gegen d4 und c4 und spielt ...Lf6 sowie ...Sc6. Geduld wird belohnt."),
      },
    ],
  },
  {
    key: "modern",
    name: t("Moderne Verteidigung"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Ein flexibler Aufbau: Lg7 und d6, das Zentrum wird erst später angegriffen. Funktioniert gegen fast jeden weißen Aufbau."),
    lines: [
      {
        name: t("Gegen 150-Angriff"),
        moves: "e4 g6 d4 Bg7 Nc3 d6 Be3 a6 Qd2 b5 f3 Nd7 Bd3 Ngf6 Nge2 Bb7",
        plan: t("Weiß rochiert lang und stürmt, Schwarz kontert mit ...a6 und ...b5 am Damenflügel. Das Spiel wird scharf, aber die Pläne sind klar."),
      },
      {
        name: t("Gegen Österreichischen Angriff"),
        moves: "e4 g6 d4 Bg7 Nc3 d6 f4 Nf6 Nf3 O-O Bd3 Na6 O-O c5 d5 Bg4",
        plan: t("Weiß spielt mit f4 auf einen schnellen Angriff. Schwarz greift mit ...c5 und ...Sa6 das Zentrum an und setzt auf ...Lg4. Wer schneller ist, gewinnt."),
      },
      {
        name: t("Klassisches System"),
        moves: "e4 g6 d4 Bg7 Nc3 d6 Nf3 Nf6 Be2 O-O O-O Bg4 Be3 Nc6 Qd2 e5 d5 Nd4",
        plan: t("Schwarz fesselt den Springer f3 und kommt mit ...e5 und ...Sd4 zum aktiven Spiel. Der Springer auf d4 ist stark, wenn Weiß ihn nicht tauschen kann."),
      },
    ],
  },
  {
    key: "slav-black",
    name: t("Slawische Verteidigung (Schwarz)"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Schwarz stützt d5 mit c6, ohne den Läufer c8 einzusperren. Danach folgt ...dxc4 oder ein Aufbau mit ...e6."),
    lines: [
      {
        name: t("Meran-System"),
        moves: "d4 d5 c4 c6 Nf3 Nf6 e3 e6 Nbd2 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 Bb7 O-O a6 e4 c5",
        plan: t("Schwarz hält den Bauern c4 nicht, gewinnt aber mit ...b5 und ...c5 Zeit. Das Spiel ist scharf und taktisch: Wer das Zentrum und den Damenflügel besser nutzt, gewinnt."),
      },
      {
        name: t("Abtauschslawisch"),
        moves: "d4 d5 c4 c6 cxd5 cxd5 Nc3 Nf6 Bf4 Nc6 e3 a6 Nf3 Bf5 Qb3 Na5 Qa4+ Qd7 Qxd7+ Nxd7",
        plan: t("Sehr symmetrische Stellung. Schwarz hat es leicht, gleicht aus, muss aber die Fallen kennen: nach Qb3 ist der Springer c6 plötzlich in Gefahr."),
      },
    ],
  },
  {
    key: "qga-black",
    name: t("Damengambit annehmen"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Schwarz nimmt den Bauern c4 und gibt ihn bald zurück. Dafür kommt er schnell zu freiem Spiel und aktiven Figuren."),
    lines: [
      {
        name: t("Mit 3.e3 e5"),
        moves: "d4 d5 c4 dxc4 e3 e5 Bxc4 exd4 exd4 Nf6 Nf3 Be7 O-O O-O Nc3 Nc6 Bg5 Bg4",
        plan: t("Schwarz greift das Zentrum sofort an und bekommt die offene e-Linie. Weiß hat einen isolierten Damenbauern, Schwarz hat Entwicklung. Das Mittelspiel ist klar und für beide spielbar."),
      },
      {
        name: t("Mit 3.Sf3 a6"),
        moves: "d4 d5 c4 dxc4 Nf3 a6 e3 Bg4 Bxc4 e6 h3 Bh5 Nc3 Nf6 g4 Bg6 Ne5 Nbd7",
        plan: t("Schwarz behält den Bauern mit ...a6 und ...b5. Weiß hat Entwicklungsvorsprung und greift mit g4 den Läufer an. Hier ist exakte Zugfolge wichtig."),
      },
      {
        name: t("Mit 3.Sf3 Sf6"),
        moves: "d4 d5 c4 dxc4 Nf3 Nf6 e3 Bg4 Bxc4 e6 h3 Bh5 Nc3 Nbd7 Qb3 Bxf3 gxf3 Nb6",
        plan: t("Der Läufer g4 wird gegen den Springer f3 getauscht und gibt Weiß Doppelbauern. Schwarz spielt ...Sb6 gegen den Läufer c4 und hat solides Spiel."),
      },
    ],
  },
  {
    key: "benoni",
    name: t("Modernes Benoni"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Schwarz akzeptiert einen Raumnachteil und baut Gegenspiel am Damenflügel und auf der e-Linie. Dynamisch und scharf."),
    lines: [
      {
        name: t("Hauptvariante"),
        moves: "d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7 Be2 O-O O-O Re8 Nd2 Na6",
        plan: t("Weiß hat ein starkes Zentrum und die Mehrheit auf dem Damenflügel, Schwarz spielt gegen e4 und mit ...b5 am Damenflügel. Ein Spiel um Tempo und Gegenangriff."),
      },
      {
        name: t("Fianchetto-Variante"),
        moves: "d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 Nf3 g6 g3 Bg7 Bg2 O-O O-O Na6 Bf4 Nc7 a4 b6",
        plan: t("Weiß verzichtet auf e4 und spielt ruhig. Schwarz spielt ...Na6-c7 und ...b5 oder ...b6 und hat gutes Spiel. Der Raum ist gleichmäßig verteilt."),
      },
      {
        name: t("Vierbauernangriff"),
        moves: "d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 f4 Bg7 Bb5+ Nfd7 a4 Qh4+ g3 Qe7 Nf3 O-O O-O",
        plan: t("Weiß baut ein riesiges Zentrum und stürmt. Schwarz greift mit ...Dh4+ und ...Sfd7 an und muss das Zentrum unter Druck setzen. Ein scharfer Test für die Zugfolge."),
      },
    ],
  },
  {
    key: "queens-indian",
    name: t("Damenindische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Schwarz kontrolliert e4 mit dem Läufer auf b7 und dem Springer f6. Eine solide, positionelle Wahl mit wenig Risiko."),
    lines: [
      {
        name: t("Hauptlinie mit g3"),
        moves: "d4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O Nc3 Ne4 Qc2 Nxc3 Qxc3 c5 Rd1 cxd4 Nxd4 Bxg2 Kxg2 Qc8",
        plan: t("Schwarz tauscht Figuren und holt sich mit ...c5 Gegenspiel. Nach dem Tausch der Läufer auf g2 ist die Stellung ausgeglichen und ruhig. Der Bauer auf d4 wird zum Ziel."),
      },
      {
        name: t("Petrosjan-Variante 4.a3"),
        moves: "d4 Nf6 c4 e6 Nf3 b6 a3 Bb7 Nc3 d5 cxd5 Nxd5 Qc2 Nxc3 bxc3 Be7 e4 O-O Bd3 c5",
        plan: t("Weiß verhindert ...Lb4 und bereitet e4 vor. Schwarz antwortet mit ...d5 und ...c5, damit das Zentrum nicht erdrückend wird."),
      },
      {
        name: t("Gegen 4.e3"),
        moves: "d4 Nf6 c4 e6 Nf3 b6 e3 Bb7 Bd3 d5 O-O Bd6 Nc3 O-O b3 Nbd7 Bb2 Qe7",
        plan: t("Weiß baut ruhig auf und lässt die Spannung zu. Schwarz spielt ...d5 und ...Ld6 und bekommt eine solide Stellung mit Gegenspiel in der Mitte."),
      },
    ],
  },
  {
    key: "bogo",
    name: t("Bogoindische Verteidigung"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Der Läufer gibt früh Schach und tauscht sich ab oder erzwingt eine Schwächung. Sehr stabil und einfach zu lernen."),
    lines: [
      {
        name: t("Hauptlinie 4.Ld2"),
        moves: "d4 Nf6 c4 e6 Nf3 Bb4+ Bd2 Qe7 g3 Nc6 Nc3 Bxc3 Bxc3 Ne4 Rc1 Nxc3 Rxc3 O-O Bg2 d6 O-O",
        plan: t("Schwarz tauscht auf c3 und zerstört die Bauernstruktur nicht, bekommt dafür aber einfache Verteidigung. Schwarz kann in Ruhe ...d6 und ...e5 spielen."),
      },
      {
        name: t("Gegen 4.Sbd2"),
        moves: "d4 Nf6 c4 e6 Nf3 Bb4+ Nbd2 b6 a3 Bxd2+ Bxd2 Bb7 e3 O-O Bd3 d6 O-O Nbd7",
        plan: t("Weiß verzichtet auf den Springer c3 und gibt Schwarz das Läuferpaar-Tauschrecht. Beide Seiten spielen ruhig. Schwarz hat eine solide Stellung mit ...Lb7 auf der langen Diagonale."),
      },
    ],
  },
  {
    key: "sveshnikov",
    name: t("Sweschnikow-Sizilianer"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Schwarz akzeptiert einen schwachen Bauern auf d6 und das Loch auf d5, bekommt dafür aktives Figurenspiel und Gegenangriff."),
    lines: [
      {
        name: t("Hauptvariante 9.Sd5"),
        moves: "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5 Nd5 Be7 Bxf6 Bxf6 c3 O-O Nc2 Bg5",
        plan: t("Weiß besetzt d5 mit einem Springer, Schwarz stört mit ...Lg5 und ...Le6. Weiß hat ein starkes Pferd auf d5, Schwarz Gegenspiel über ...f5 und am Damenflügel."),
      },
      {
        name: t("Mit 9.Lxf6 gxf6"),
        moves: "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5 Bxf6 gxf6 Nd5 f5 Bd3 Be6 c4 Bg7 cxb5 axb5 Bxb5 Rb8",
        plan: t("Schwarz bekommt Doppelbauern, aber das Läuferpaar und schnelles Spiel am Königsflügel mit ...f5. Weiß hat Raum, Schwarz Aktivität. Die Zugfolge ist scharf."),
      },
      {
        name: t("Gegen Rossolimo 3.Lb5"),
        moves: "e4 c5 Nf3 Nc6 Bb5 g6 O-O Bg7 Re1 e5 b4 cxb4 a3 d5 axb4 dxe4 Nxe5 Qd4",
        plan: t("Weiß will den Springer c6 nehmen und die Struktur beschädigen. Schwarz spielt ...g6 und ...e5 und sichert sich Raum im Zentrum. Gambits wie b4 wollen Schwarz aus dem Konzept bringen."),
      },
    ],
  },
  {
    key: "taimanov",
    name: t("Taimanow-Sizilianer"),
    color: "black",
    group: "Gegen 1.e4", // i18n: id
    idea: t("Flexibler Aufbau mit ...e6, ...Sc6 und ...Dc7. Schwarz entscheidet später, ob er ...a6, ...Sf6 oder ...Lb4 spielt."),
    lines: [
      {
        name: t("Mit Lb4"),
        moves: "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6 Qd2 Nf6 O-O-O Bb4 f3 Ne5 Nb3 d5",
        plan: t("Beide rochieren auf entgegengesetzten Seiten. Schwarz spielt ...Lb4 und ...Se5 und greift mit ...d5 sofort das Zentrum an. Wer das Tempo hält, gewinnt."),
      },
      {
        name: t("Ruhiger Aufbau"),
        moves: "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be2 a6 O-O Nf6 Be3 Bb4 Na4 Be7 c4 O-O Qd3 d6",
        plan: t("Weiß rochiert kurz und baut ein Maroczy-ähnliches Zentrum. Schwarz hat eine solide Stellung und spielt ...Sxd4 und ...b5 mit Gegenspiel."),
      },
    ],
  },
  {
    key: "benko",
    name: t("Benkö-Gambit"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Schwarz opfert einen Bauern am Damenflügel für offene Linien. Dafür bekommt er dauerhaften Druck, auch im Endspiel."),
    lines: [
      {
        name: t("Hauptlinie"),
        moves: "d4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 Bxa6 Nc3 d6 e4 Bxf1 Kxf1 g6 g3 Bg7 Kg2 O-O",
        plan: t("Weiß verliert die Rochade, Schwarz hat Türme auf den offenen Linien a und b. Schwarz hat Druck gegen b2 und a2. Das Gambit ist gut, weil der Bauernvorsprung von Weiß kaum etwas zählt."),
      },
      {
        name: t("Fianchetto-Variante"),
        moves: "d4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 g6 Nc3 Bxa6 g3 d6 Bg2 Bg7 Nf3 O-O O-O Nbd7",
        plan: t("Weiß hält den Bauern und rochiert, Schwarz hat Aktivität am Damenflügel und das Läuferpaar. Wichtig ist, Druck auf b2 und die Felder a6 bis g1 aufzubauen."),
      },
    ],
  },
  {
    key: "budapest",
    name: t("Budapester Gambit"),
    color: "black",
    group: "Gegen 1.d4", // i18n: id
    idea: t("Schwarz opfert früh einen Bauern auf e5 und erobert ihn mit Springerzügen zurück. Wenig Theorie, viel Überraschung."),
    lines: [
      {
        name: t("Adler-Variante"),
        moves: "d4 Nf6 c4 e5 dxe5 Ng4 Bf4 Nc6 Nf3 Bb4+ Nbd2 Qe7 a3 Ngxe5 axb4 Nxf3+ Nxf3 Nxb4 Bg5",
        plan: t("Weiß hat zwei Bauern mehr, aber die Struktur ist kaputt und der König steht schlecht. Schwarz hat Druck und schnelles Spiel. Die Figuren zählen mehr als die Bauern."),
      },
      {
        name: t("Rubinstein-Variante"),
        moves: "d4 Nf6 c4 e5 dxe5 Ng4 Nf3 Nc6 Bf4 Bb4+ Nbd2 Qe7 e3 Ngxe5 Nxe5 Nxe5 Be2 O-O O-O Bxd2 Qxd2 d6",
        plan: t("Weiß gibt den Bauern zurück und hat leichten Raumvorteil. Schwarz hat ein solides, ruhiges Spiel mit ...d6 und ...Sg6. Das Gambit ist hier eher eine sichere Waffe als ein Risiko."),
      },
    ],
  },
  {
    key: "bishops",
    name: t("Läuferspiel"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Der Läufer geht sofort nach c4 und zielt auf f7. Flexibler als die Italienische Partie, mit vielen Wegen zu Zentrum und Angriff."),
    lines: [
      {
        name: t("Berlin-Verteidigung"),
        moves: "e4 e5 Bc4 Nf6 d3 c6 Nf3 d5 Bb3 Bd6 Nc3 O-O O-O Nbd7 Re1 Re8",
        plan: t("Weiß hält das Zentrum und entwickelt ruhig. Schwarz greift mit ...d5 das Zentrum an. Der Läufer b3 bleibt auf der Diagonale und wartet auf den Moment für d4."),
      },
      {
        name: t("Urusov-Gambit"),
        moves: "e4 e5 Bc4 Nf6 d4 exd4 Nf3 Nc6 e5 d5 Bb5 Ne4 Nxd4 Bd7 Bxc6 bxc6 O-O Bc5 Nxc6 Bxc6",
        plan: t("Weiß opfert einen Bauern für Entwicklung und Angriff auf die schwarze Rochade. Schwarz muss Fallen vermeiden und das Material sicher festhalten. Taktisch scharf."),
      },
    ],
  },
  {
    key: "closed-sicilian",
    name: t("Geschlossener Sizilianer"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Weiß vermeidet die Theorie der offenen Sizilianer mit Sc3 und g3. Das Fianchetto zielt auf d5 und später auf einen Angriff am Königsflügel."),
    lines: [
      {
        name: t("Gegen ...g6"),
        moves: "e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 Nf6 Qd2 O-O Nge2 Rb8 O-O b5",
        plan: t("Weiß baut ruhig auf, spielt Be3 und Qd2 und bereitet f4 vor. Schwarz kontert mit ...Rb8 und ...b5 am Damenflügel. Beide Seiten greifen auf entgegengesetzten Flügeln an."),
      },
      {
        name: t("Gegen ...e6"),
        moves: "e4 c5 Nc3 Nc6 g3 e6 Bg2 Nge7 d3 d6 Be3 Nd4 Nce2 Nxe2 Nxe2 Bd7 c3 g6",
        plan: t("Schwarz hält die Mitte und tauscht Figuren, um Platz zu bekommen. Weiß behält die lange Diagonale und kann mit f4 und Sf3 Druck machen."),
      },
    ],
  },
  {
    key: "grand-prix",
    name: t("Grand-Prix-Angriff"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Mit f4 und Läufer c4 stürmt Weiß am Königsflügel. Scharf, direkt und mit klaren Plänen."),
    lines: [
      {
        name: t("Gegen ...g6"),
        moves: "e4 c5 Nc3 Nc6 f4 g6 Nf3 Bg7 Bc4 e6 f5 Nge7 fxe6 fxe6 d3 O-O O-O d5",
        plan: t("Weiß opfert nichts, sondern spielt f5 und öffnet die f-Linie. Schwarz hält mit ...d5 dagegen. Das Spiel wird scharf, wenn beide Seiten den Königsflügel angreifen."),
      },
      {
        name: t("Gegen ...d6"),
        moves: "e4 c5 Nc3 d6 f4 Nc6 Nf3 g6 Bb5 Bd7 O-O Bg7 d3 Nf6 Qe1 O-O",
        plan: t("Weiß fesselt den Springer c6 und bereitet Qe1-h4 vor. Schwarz hat ...Bd7 und ...a6 als Mittel gegen die Fesselung."),
      },
    ],
  },
  {
    key: "smith-morra",
    name: t("Smith-Morra-Gambit"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Weiß opfert einen Bauern gegen Sizilianisch für schnelle Entwicklung und offene Linien. Wenig Theorie, viel Druck."),
    lines: [
      {
        name: t("Hauptlinie"),
        moves: "e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6 O-O Nf6 Qe2 Be7 Rd1 e5",
        plan: t("Weiß hat Entwicklung für den Bauern und spielt auf Druck gegen f7 und die offene d-Linie. Schwarz muss die Figuren heil entwickeln und die Bauernmehrheit nutzen."),
      },
      {
        name: t("Gegen 3...Sf6"),
        moves: "e4 c5 d4 cxd4 c3 Nf6 e5 Nd5 cxd4 d6 Nf3 Nc6 Bc4 Nb6 Bb5 dxe5 Nxe5 Bd7",
        plan: t("Weiß nimmt den Bauern zurück und baut ein großes Zentrum. Schwarz hat Raum für Gegenspiel und greift die Mitte mit ...d6 an."),
      },
    ],
  },
  {
    key: "ponziani",
    name: t("Ponziani-Eröffnung"),
    color: "white",
    group: "1.e4 mit Weiß", // i18n: id
    idea: t("Mit c3 bereitet Weiß d4 vor. Selten gespielt, deshalb haben Gegner oft wenig Wissen, und Weiß bekommt ein gutes Zentrum."),
    lines: [
      {
        name: t("Hauptvariante"),
        moves: "e4 e5 Nf3 Nc6 c3 Nf6 d4 Nxe4 d5 Ne7 Nxe5 Ng6 Qd4 Nxe5 Qxe5 Qe7 Qxe7+ Bxe7 Bd3 Nf6",
        plan: t("Schwarz nimmt einen Bauern, verliert aber Zeit. Weiß tauscht die Damen und behält einen kleinen Vorteil im Endspiel. Wichtig sind die Zwischenzüge wie d5 und Sxe5."),
      },
      {
        name: t("Gegen 3...d5"),
        moves: "e4 e5 Nf3 Nc6 c3 d5 Qa4 f6 exd5 Qxd5 d3 Bd7 Be2 O-O-O O-O Kb8",
        plan: t("Weiß setzt mit Da4 sofort unter Druck. Schwarz hält mit ...f6 die Mitte und spielt auf schnellen Ausgleich. Die Zugfolge ist wichtig, weil Weiß sonst den Bauern d5 nicht festhalten kann."),
      },
    ],
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
    plan: l.plan,
  })),
);

/**
 * One test round for a library line: the opponent picks randomly among the
 * replies that the opening's variation tree knows at that point, so the player
 * learns to meet every branch instead of one memorised sequence. The player's own
 * moves follow the drilled line as long as it stays in the tree and otherwise
 * the book move of the branch the opponent chose.
 */
export function variedLine(openingKey: string, lineIndex: number, rng: () => number = Math.random): string[] {
  const o = OPENING_LIBRARY.find((x) => x.key === openingKey);
  const primary = o?.lines[lineIndex]?.moves.split(" ");
  if (!o || !primary) return [];
  const white = o.color === "white";
  const all = o.lines.map((l) => l.moves.split(" "));
  const path: string[] = [];
  let candidates = all;
  for (let i = 0; ; i++) {
    const alive = candidates.filter((l) => l.length > i);
    if (!alive.length) break;
    let move: string;
    if ((i % 2 === 0) === white) {
      move = alive.some((l) => l[i] === primary[i]) ? primary[i] : alive[0][i];
    } else {
      const replies = [...new Set(alive.map((l) => l[i]))];
      move = replies[Math.min(replies.length - 1, Math.floor(rng() * replies.length))];
    }
    path.push(move);
    candidates = alive.filter((l) => l[i] === move);
  }
  return path;
}
