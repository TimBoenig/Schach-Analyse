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
