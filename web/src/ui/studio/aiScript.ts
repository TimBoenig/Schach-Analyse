// Video scripts written by an external AI chat (ChatGPT, Claude, Gemini …).
// The studio hands out a prompt that describes a small JSON format; the AI's
// answer is pasted back and turned into a project: every move checked,
// variations resolved by "go back n half-moves", unknown values replaced by
// safe defaults with a note. Pure, so it is tested headless.
import { Chess } from "chess.js";

import {
  CAMERA_LABEL,
  DEFAULT_VIDEO,
  EFFECT_LABEL,
  ENV_LABEL,
  normalizeProject,
  parseMoves,
  PLATFORM_LABEL,
  scene,
  START_FEN,
  styleFromTheme,
  THEMES,
  validFen,
  newId,
  type Badge,
  type BoardView,
  type CameraPreset,
  type Card,
  type Effect,
  type Environment,
  type Mood,
  type Platform,
  type Scene,
  type Side,
  type StudioArrow,
  type StudioMark,
  type StudioProject,
  type ThemeId,
  type Material,
  type CaptionStyle,
  type Tone,
} from "./model";
import { compile, LESSON_CHUNK, SHORT_CHUNK } from "./timeline";
import type { MusicId } from "./music";
import { fitLength, movesLabel } from "./wizard";

// ---------- German words the AI may use ----------

/** "Schräg", "schraeg", "SCHRÄG" and "schräg!" all become "schraeg". */
const word = (v: unknown): string =>
  String(v ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9!?#]/g, "");

const CAMERAS: Record<string, CameraPreset> = {
  normal: "white", standard: "white", eigeneseite: "white", hinten: "white",
  gegenueber: "black", vongegenueber: "black", gegner: "black", gegnersicht: "black",
  oben: "top", vonoben: "top", top: "top", draufsicht: "top",
  schraeg: "corner", ecke: "corner", corner: "corner", diagonal: "corner",
  seitlich: "side", seite: "side", side: "side",
  tief: "low", tiefdramatisch: "low", dramatisch: "low", low: "low",
  nah: "close", nahdran: "close", close: "close", closeup: "close",
};
const CARDS: Record<string, Card> = {
  keine: "none", none: "none",
  titel: "intro", titelkarte: "intro", intro: "intro", hook: "intro",
  frage: "question", question: "question", raetsel: "question",
  umfrage: "poll", poll: "poll", abstimmung: "poll",
  abspann: "outro", outro: "outro", ende: "outro", cta: "outro",
};
const TONES: Record<string, Tone> = {
  akzent: "accent", accent: "accent", blau: "accent", lila: "accent", neutral: "accent",
  gut: "good", good: "good", gruen: "good", verteidigung: "good", richtig: "good",
  gefahr: "bad", bad: "bad", rot: "bad", schlecht: "bad", drohung: "bad", fehler: "bad", angriff: "bad",
  idee: "idea", idea: "idea", gelb: "idea", orange: "idea", plan: "idea",
  weiss: "white", white: "white",
};
const MOODS: Record<string, Mood> = {
  froehlich: "happy", happy: "happy", freude: "happy",
  nachdenklich: "think", think: "think", denken: "think",
  begeistert: "wow", wow: "wow", staunen: "wow",
  traurig: "sad", sad: "sad",
};
const EFFECTS: Record<string, Effect> = {
  matt: "mate", schachmatt: "mate", mate: "mate", checkmate: "mate",
  drohung: "threat", threat: "threat", bedrohung: "threat",
  spotlight: "spotlight", scheinwerfer: "spotlight",
  wackeln: "shake", shake: "shake", beben: "shake",
  zoom: "zoom", reinzoomen: "zoom",
  blitz: "flash", flash: "flash",
  konfetti: "confetti", confetti: "confetti",
  zeitlupe: "slowmo", slowmo: "slowmo", slowmotion: "slowmo",
};
const ENVS: Record<string, Environment> = {
  schwebend: "void", void: "void", keine: "void", nichts: "void",
  buehne: "podium", podium: "podium", podest: "podium",
  holztisch: "table", tisch: "table", table: "table",
  neon: "neon", neonarena: "neon", arena: "neon",
  turniersaal: "hall", saal: "hall", hall: "hall", turnier: "hall",
  bibliothek: "library", library: "library",
};
const PIECE_LOOKS: Record<string, Material> = { lack: "porcelain", porzellan: "porcelain", glanz: "porcelain", matt: "matte", matte: "matte", chrom: "chrome", chrome: "chrome", metall: "chrome", holz: "wood", wood: "wood", holzfiguren: "wood" };
const CAPTIONS: Record<string, CaptionStyle> = { kasten: "box", box: "box", kontur: "outline", outline: "outline", umriss: "outline", gross: "punch", punch: "punch", fett: "punch" };
const VIEWS: Record<string, BoardView> = { "2d": "2d", flach: "2d", buch: "2d", klar: "2d", "3d": "3d", show: "3d", plastisch: "3d" };
const FONTS: Record<string, "sans" | "serif"> = { modern: "sans", sans: "sans", elegant: "serif", serif: "serif", klassisch: "serif" };
const MUSICS: Record<string, MusicId> = { keine: "none", none: "none", aus: "none", lofi: "lofi", ruhig: "lofi", spannung: "tension", tension: "tension", spannend: "tension", episch: "epic", epic: "epic" };
/** Longest texts that still fit the frame at normal text size. */
export const FIT = { title: 30, subtitle: 95, label: 22, option: 14, lesson: LESSON_CHUNK };

const PLATFORMS: Record<string, Platform> = {
  tiktok: "tiktok", reels: "reels", instagram: "reels", instagramreels: "reels", shorts: "shorts", youtubeshorts: "shorts", youtube: "youtube", youtubequer: "youtube",
};
const BADGES: Record<string, Exclude<Badge, "">> = {
  brillant: "brilliant", brilliant: "brilliant", "!!": "brilliant",
  grossartig: "great", great: "great", greatfind: "great", "!": "great",
  bester: "best", besterzug: "best", best: "best", stern: "best",
  exzellent: "excellent", excellent: "excellent", "!?": "excellent",
  gut: "good", good: "good",
  buch: "book", buchzug: "book", book: "book", theorie: "book",
  ungenau: "inaccuracy", ungenauigkeit: "inaccuracy", inaccuracy: "inaccuracy", "?!": "inaccuracy",
  fehler: "mistake", mistake: "mistake", "?": "mistake",
  verpasst: "miss", miss: "miss", verpasstergewinn: "miss",
  patzer: "blunder", blunder: "blunder", "??": "blunder",
};

// ---------- the prompt ----------

export interface PromptOptions {
  topic: string;
  platform: Platform;
  /** Seconds. */
  length: number;
  notes: string;
  /** The side the video is about; "auto" lets the AI decide. */
  side?: Side | "auto";
}

const list = (o: Record<string, unknown>) => Object.keys(o).join(", ");

const BLACK_HINTS = /(f(ü|ue)r schwarz|mit schwarz|als schwarz|for black|as black|englund|sizilian|sicilian|caro|franz(ö|oe)sisch|french defen|skandinav|scandinav|pirc|k(ö|oe)nigsindisch|king'?s indian|gr(ü|ue)nfeld|nimzo|holl(ä|ae)ndisch|dutch|aljechin|alekhine|budapest|benoni|wolga|benko|stafford|elephant|elefanten)/i;

/** Which side a script is about when the AI forgot to say: defences and traps for Black are shown from Black. */
export function guessPerspective(content: string): Side {
  return BLACK_HINTS.test(content) ? "black" : "white";
}

const LONG_RULES = `SO WIRD ES EIN GUTES LERNVIDEO
1. Ruhig und seriös, kein Entertainment-Tempo. Der Zuschauer will etwas verstehen und mitdenken.
2. Aufbau: Einstieg (was man lernt und warum es wichtig ist), dann 3 bis 5 Kapitel, dann eine Zusammenfassung mit den 3 wichtigsten Punkten, dann ein kurzer Abspann. "kleineZeile" ist der Kapitelname (z. B. "Kapitel 2: Der Plan für Weiß") und bleibt über mehrere Szenen gleich.
3. Erkläre das Warum: Pläne, Bauernstruktur, typische Fehler, die Idee hinter jedem wichtigen Zug. Zeig auch, was passiert, wenn man es falsch macht (als Variante).
4. Pro Szene meist ein Zug, höchstens zwei. Jede Szene dauert 8 bis 20 Sekunden, damit der Zuschauer den Zug sieht und die Erklärung lesen kann.
5. "untertitel" ist die Erklärung, die rechts neben dem Brett komplett stehen bleibt: 2 bis 4 ganze Sätze, höchstens ${FIT.lesson} Zeichen. *Sternchen* färben Schlüsselwörter und Felder.
6. "sprechtext" ist ausführlicher als der Untertitel: das, was ich dazu sage, etwa 2,5 Wörter pro Sekunde, passend zur Dauer.
7. Pfeile für Pläne und Drohungen, Markierungen für wichtige Felder. Effekte sparsam: höchstens spotlight, drohung, matt. Keine Konfetti-Explosion mitten in der Erklärung.
8. Kamera meist "normal" oder "oben", ruhig, ohne Drehung. Bleib bei EINER Perspektive.
9. Umfragen nur, wenn sie zum Mitdenken einladen ("Was würdest du hier spielen?"), höchstens zwei im ganzen Video.
10. Keine erfundenen Zahlen, Statistiken oder Partien. Wenn du eine berühmte Partie zeigst, nur mit den echten Zügen.
11. Schreib für Anfänger: nenn die Figur beim Namen und das Feld ("der Springer zieht nach f3", "der Läufer schlägt den Springer auf c6") statt nur Notation wie "Sf3" oder "Lxc6". Begriffe wie Gabel, Fesselung oder Rochade erklärst du beim ersten Mal in einem halben Satz.

`;

const LONG_LAYOUT = `SO SIEHT DAS VIDEO AUS (Querformat 16:9, Lernvideo)
- Links das Brett, groß und ruhig, standardmäßig flach von oben (2D) wie in einem Schachbuch.
- Rechts eine Lesespalte: oben das Kapitel ("kleineZeile") in Akzentfarbe, darunter der "titel" (höchstens 2 Zeilen, etwa ${FIT.title} Zeichen), darunter der ganze "untertitel" als Erklärung (bis 9 Zeilen, höchstens ${FIT.lesson} Zeichen), unten die bisher gespielten Züge mit dem aktuellen Zug hervorgehoben.
- Karten ("titel", "frage", "umfrage", "abspann") legen sich wie gewohnt über das ganze Bild.

`;

function LONG_EXAMPLE(platform: Platform) {
  return {
    titel: "Die Italienische Partie verstehen",
    plattform: platform,
    laenge: 240,
    perspektive: "weiss",
    look: "walnuss",
    umgebung: "bibliothek",
    design: { figuren: "holz", schrift: "elegant", musik: "lofi", untertitelStil: "kasten" },
    geschwindigkeit: 0.9,
    szenen: [
      { karte: "titel", titel: "Italienisch verstehen", untertitel: "Die Ideen hinter den ersten Zügen", sprechtext: "In diesem Video schauen wir uns an, warum die Italienische Partie seit Jahrhunderten gespielt wird und welche Pläne dahinterstecken.", dauer: 8 },
      { kleineZeile: "Kapitel 1: Das Zentrum", zug: "1. e4", titel: "Der erste Zug", untertitel: "Weiß besetzt mit *e4* das Zentrum und öffnet gleichzeitig Wege für die *Dame* und den *Läufer*. Genau diese beiden Figuren spielen gleich eine große Rolle.", sprechtext: "Der Bauer auf e4 kontrolliert d5 und f5 und gibt der Dame und dem Läufer auf f1 freie Bahn.", markierungen: ["d5 akzent", "f5 akzent"], kamera: "normal", dauer: 14 },
      { kleineZeile: "Kapitel 1: Das Zentrum", zug: "1... e5 2. Sf3", titel: "Angriff auf e5", untertitel: "Schwarz hält mit *e5* dagegen. Der Springer auf f3 greift den Bauern sofort an und entwickelt sich dabei zur Mitte.", pfeile: ["f3-e5 gefahr"], kamera: "normal", dauer: 14 },
      { kleineZeile: "Kapitel 2: Der Läufer", zug: "2... Sc6 3. Lc4", titel: "Ziel: f7", untertitel: "Der Läufer zielt auf *f7*, den schwächsten Punkt von Schwarz, weil ihn nur der König deckt.", pfeile: ["c4-f7 gefahr"], effekte: ["spotlight"], kamera: "oben", dauer: 16 },
      { karte: "abspann", titel: "Danke fürs Zuschauen", untertitel: "Im nächsten Teil: das Giuoco Piano", dauer: 6 },
    ],
  };
}

export function buildAiPrompt(o: PromptOptions): string {
  const long = o.platform === "youtube";
  const example = long ? LONG_EXAMPLE(o.platform) : {
    titel: "Matt in 4 Zügen",
    plattform: o.platform,
    laenge: 25,
    perspektive: "weiss",
    look: "nova",
    umgebung: "buehne",
    design: { figuren: "lack", untertitelStil: "kontur", schrift: "modern", musik: "spannung", textgroesse: 1 },
    szenen: [
      { karte: "titel", titel: "Fällst du darauf rein?", untertitel: "Matt in *4 Zügen*", sprechtext: "Auf diese Falle fallen viele Anfänger herein.", kamera: "normal", dauer: 2.5 },
      { zug: "1. e4 e5", titel: "Ganz normal", untertitel: "Beide Bauern gehen ins *Zentrum*.", kamera: "normal", markierungen: ["e4 akzent", "e5 akzent"], dauer: 2.5 },
      { zug: "2. Lc4", titel: "Ziel: f7", untertitel: "Der Läufer zielt auf *f7*.", sprechtext: "Der Läufer schaut schon auf f7.", kamera: "schraeg", fokus: true, pfeile: ["c4-f7 gefahr"], effekte: ["drohung"], dauer: 2.5 },
      { zug: "2... Sc6 3. Dh5", titel: "Die Dame kommt", untertitel: "Zwei Angreifer auf *f7*.", kamera: "nah", pfeile: ["h5-f7 gefahr", "c4-f7 gefahr"], effekte: ["zoom"], dauer: 3 },
      { karte: "umfrage", titel: "Was spielt Schwarz?", antworten: ["A) Sf6", "B) g6", "C) De7"], countdown: 3 },
      { zug: "3... Sf6", titel: "Der Fehler", kamera: "seitlich", bewertung: "patzer", stimmung: "traurig", dauer: 2 },
      { zug: "4. Dxf7#", titel: "Schachmatt!", kamera: "tief", effekte: ["matt", "wackeln"], zugtempo: 0.7 },
      { variante: { zurueck: 2 }, kleineZeile: "Besser", zug: "3... g6", titel: "So verteidigst du", untertitel: "*g6* vertreibt die Dame.", pfeile: ["g6-h5 gut"], bewertung: "bester", kamera: "schraeg", effekte: ["spotlight"] },
      { karte: "abspann", titel: "Folge für mehr Fallen", untertitel: "Teil 2 kommt morgen", effekte: ["konfetti"] },
    ],
  };
  return `Du schreibst das komplette Drehbuch für ${long ? "ein ruhiges, lehrreiches YouTube-Video im Querformat" : "ein kurzes Schach-Video"}, das mein Videostudio automatisch daraus baut. Antworte NUR mit einem JSON-Codeblock in genau dem Format unten, ohne Text davor oder danach.

MEIN VIDEO
- Thema: ${o.topic.trim() || "(such dir ein spannendes Thema aus)"}
${o.side === "black" ? '- Perspektive: schwarz (setz "perspektive": "schwarz")\n' : o.side === "white" ? '- Perspektive: weiss (setz "perspektive": "weiss")\n' : ""}- Plattform: ${PLATFORM_LABEL[o.platform]} (${o.platform === "youtube" ? "Querformat" : "Hochformat"})
- Ziellänge: etwa ${o.length >= 120 ? `${Math.round(o.length / 60)} Minuten (${o.length} Sekunden)` : `${o.length} Sekunden`}
${o.notes.trim() ? `- Das ist mir wichtig:\n${o.notes.trim().split("\n").map((l) => `  ${l.trim()}`).join("\n")}\n` : ""}
${long ? LONG_RULES : `SO WIRD ES FÜR ZUSCHAUER VERSTÄNDLICH
1. Die erste Szene ist ein starker Hook, der in 2 Sekunden neugierig macht. Keine erfundenen Zahlen oder Statistiken.
2. Viele Zuschauer können keine Notation lesen. Erkläre jeden wichtigen Zug in Worten ("Der Springer greift e5 an") und nenne dabei das Feld. Schreib Figuren aus ("Springer nach f3" statt "Sf3"). Felder, die im Untertitel stehen, leuchten auf dem Brett auf.
3. Höchstens eine neue Idee pro Szene. Der Zuschauer muss gleichzeitig die Züge verfolgen: Untertitel höchstens ${SHORT_CHUNK} Zeichen, ein kurzer Satz. Alles Weitere gehört in den Sprechtext, nicht ins Bild. Längere Untertitel teilt das Studio selbst in Häppchen. *Sternchen* um ein Wort färben es ein. Ein | teilt einen Untertitel in Teile, die nacheinander erscheinen.
4. Zeig jede Drohung mit einem Pfeil: rot (gefahr) für Angriffe, grün (gut) für Verteidigung.
5. Bleib bei EINER Sicht aufs Brett: "perspektive" ist die Seite, um die es geht (weiss oder schwarz, z. B. schwarz für Sizilianisch oder eine Falle für Schwarz). Die Kameras drehen sich automatisch mit. Nutze "gegenueber" nur ganz selten.
6. Jede Szene kann einen Sprechtext haben: das, was ich dazu sage (natürlich gesprochen, etwa 2,5 Wörter pro Sekunde, passend zur Dauer). Er erscheint nicht im Bild.
7. Für eigene Kamera, Text oder Pfeile pro Zug mach eine Szene pro Zug. Die Summe aller "dauer"-Werte soll ungefähr die Ziellänge ergeben.
8. Ende mit einer Abspann-Szene, die zum Folgen, Kommentieren oder Speichern auffordert.

`}WAS DAS STUDIO KANN (setz es gezielt ein, nicht in jeder Szene)
Effekte ("effekte", mehrere möglich):
- matt: Der König kippt um, eine rote Druckwelle läuft übers Brett, die Kamera fährt ran, großer Schriftzug SCHACHMATT, dumpfer Schlag. Nur in der Szene mit dem Mattzug.
- drohung: Die bedrohten Felder pulsieren rot (die Ziele der roten Pfeile, sonst die Figuren, die der gezogene Stein angreift).
- spotlight: Alles außer dem Zielfeld des Zugs wird dunkel. Für den einen Zug, auf den es ankommt.
- wackeln: Die Kamera bebt, wenn die Figur aufsetzt. Für harte Schläge.
- zoom: Schneller Zoom auf das Zielfeld.
- blitz: Kurzer heller Blitz beim Zug. Für Überraschungen.
- konfetti: Konfetti-Explosion. Für den Gewinnzug oder das Ende.
- zeitlupe: Der letzte Zug der Szene läuft langsam. Für den Schlüsselzug.
Bewertung des Zugs ("bewertung", das Symbol erscheint wie auf Analyse-Seiten über dem Zielfeld): brillant, grossartig, bester, exzellent, gut, buch, ungenau, fehler, verpasst, patzer.
Umfrage ("karte": "umfrage"): bis zu 3 Antworten als Züge, z. B. "A) Sf6". Jede Antwort bekommt auf dem Brett automatisch einen farbigen Pfeil (A blau, B orange, C lila) in derselben Farbe wie ihr Knopf, so verstehen es auch Zuschauer ohne Notation. Die Antworten müssen legale Züge in der aktuellen Stellung sein. Die nächste Szene zeigt die Auflösung.
Frage mit Countdown ("karte": "frage"): Rätsel-Frage, dann tickt der Countdown herunter.
Kameras ("kamera"): normal (hinter der eigenen Seite), schraeg, seitlich, oben (von oben, gut für Pläne), tief (tief und dramatisch), nah (nah dran), gegenueber (von der anderen Seite, selten). Dazu zoom (0.5 = nah, 1 = ganzes Brett), drehung (langsame Kamerafahrt in Grad pro Sekunde, z. B. 5 oder -5) und fokus (true = Kamera lehnt sich zum Zielfeld).
Tempo: "zugtempo" pro Szene (0.4 langsam bis 2.5 schnell), oben "geschwindigkeit" für das ganze Video (0.5 bis 2.5).
Lucena: eine KI-Kugel neben den Untertiteln mit "stimmung": froehlich, nachdenklich, begeistert, traurig.

${long ? LONG_LAYOUT : `SO SIEHT DAS VIDEO AUS (${o.platform === "youtube" ? "Querformat 16:9" : "Hochformat 9:16"}, von oben nach unten)
- Ganz oben: ein dünner Fortschrittsbalken und das Logo EndGameKing.
- "kleineZeile": kleiner farbiger Streifen über dem Titel, höchstens ${FIT.label} Zeichen (z. B. "Variante 2", "Falle", "Teil 1").
- "titel": große, fette weiße Überschrift, höchstens 2 Zeilen, also etwa ${FIT.title} Zeichen. Kurz und knackig, wie eine Schlagzeile.
- Darunter die Zug-Anzeige (z. B. "● 3. Lb5") und der Zug in Worten ("Weiß: Läufer nach b5"), beides automatisch.
- In der Mitte das Brett (3D-Show-Look, oder mit "ansicht": "2d" flach von oben).
- "untertitel": unter dem Brett, höchstens 3 Zeilen, etwa ${FIT.subtitle} Zeichen, daneben die KI-Kugel Lucena. *Sternchen*-Wörter werden in der Akzentfarbe gefärbt.
- Ganz unten bleibt Platz frei, dort liegen die Knöpfe der App. Dahin kommt nie Text.
- Karten: "titel" zeigt Überschrift und Untertitel groß vor dem Brett (für den Hook), "frage" und "umfrage" legen die Frage über das Brett, die Antwort-Knöpfe stehen in einer Reihe unter dem Brett (jede Antwort höchstens ${FIT.option} Zeichen), "abspann" ist das große Schlussbild mit Logo.
- Ein Titel oder Untertitel, der zu lang ist, wird kleiner geschrieben oder auf mehrere Bilder verteilt. Lieber zwei Szenen als eine überfüllte.

`}DESIGN ("design" oben im JSON, alles optional, passend zum Thema wählen)
- look: nova (dunkelblau mit Violett, modern), marmor (helles Marmorbrett, kühles Türkis), holz (klassisches Holzbrett mit echten Holzfiguren, warmes Orange), walnuss (dunkles Edelholz mit Holzfiguren, Goldgelb, sehr edel), turnier (grün-weiß wie Online-Schach), neon (dunkles Lila mit Chromfiguren, für Action).
- ansicht: 2d (flaches Brett von oben, am klarsten, Standard bei YouTube) oder 3d (plastisches Show-Brett, Standard bei TikTok, Reels, Shorts).
- figuren (nur 3D): lack (glänzend), matt, chrom, holz (Holz mit Maserung). Überschreibt die Figuren des Looks.
- untertitelStil: kasten (Text in dunklem Kasten, ruhig), kontur (weiße Schrift mit dicker Kontur wie TikTok), gross (sehr groß und fett, höchstens 2 Zeilen, für schnelle Videos).
- schrift: modern oder elegant (Serifen, für Geschichte und Klassiker).
- akzent: eigene Akzentfarbe als Farbcode, z. B. "#ffb84d".
- textgroesse: 0.8 bis 1.3 (1 = normal). Bei größerer Schrift passen weniger Zeichen.
- musik: keine, lofi (ruhig, zum Lernen), spannung (treibend, für Fallen), episch (groß, für Meisterpartien).
- figurenRand: true (heller Rand, Figuren besser zu unterscheiden) oder false.
Umgebungen ("umgebung"): schwebend, buehne, holztisch, neon, turniersaal, bibliothek.

SCHACH-REGELN (sehr wichtig)
- Nur legale Züge in der richtigen Reihenfolge. Prüfe jeden Zug, bevor du ihn schreibst.
- Standard-Notation, deutsch (S, L, T, D, K) oder englisch (N, B, R, Q, K), z. B. "1. e4 e5 2. Sf3" oder "3... a6".
- Eine Szene kann einen oder mehrere Züge haben ("zug"). Die Züge gehen in der Stellung weiter, in der die vorige Szene aufgehört hat.
- Variante: "variante": { "zurueck": n } geht vorher n Halbzüge zurück (1 Halbzug = ein Zug von Weiß oder Schwarz) und spielt dann die Züge dieser Szene.
- Zurück zur Hauptvariante: "hauptvariante": true springt zur Stellung, bevor die Variante begann.
- Eine besondere Startstellung (Rätsel, Endspiel) gibst du als "startstellung" (FEN) an.

ALLE FELDER
Video (oben): titel, plattform (${list(PLATFORMS)}), laenge (Sekunden), perspektive (weiss, schwarz), geschwindigkeit, zugtempo, look, umgebung, design { ansicht, figuren, untertitelStil, schrift, akzent, textgroesse, musik, figurenRand }, startstellung, einstellungen { lucena, effektTon, zuganzeige, zugInWorten, zuegeAusschreiben, felderLeuchten, fortschritt, koordinaten, kameraflug, spiegelung } (jeweils true oder false).
Szene: karte (titel, frage, umfrage, abspann oder weglassen), zug, titel, untertitel, sprechtext, kleineZeile (z. B. "Variante 1"), dauer, kamera, zoom, drehung, fokus, pfeile (z. B. "f3-e5 gefahr"), markierungen (z. B. "e5 gut"), effekte, bewertung, zugtempo, stimmung, countdown (Sekunden, bei frage und umfrage), antworten (bei umfrage), variante, hauptvariante.
Farben für Pfeile und Markierungen: gefahr (rot: Drohung, Fehler), gut (grün: gute Idee, Verteidigung), idee (gelb: Plan), akzent (Hervorhebung), weiss.

PRÜF VOR DEM ANTWORTEN
- Spiel alle Züge im Kopf nach: legal, richtige Reihenfolge, richtige Seite am Zug.
- Jeder Titel höchstens ${FIT.title} Zeichen, jeder Untertitel höchstens ${long ? FIT.lesson : SHORT_CHUNK} Zeichen.
- Die Summe der Dauern passt zur Ziellänge, und der Sprechtext jeder Szene ist in ihrer Dauer sprechbar.
- Hook, eine klare Idee pro Szene, Pfeile für jede Drohung, Abspann mit Aufforderung.

BEISPIEL (nur für das Format, schreib dein eigenes Video):
\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\``;
}

// ---------- reading the answer ----------

export interface AiImport {
  project: StudioProject | null;
  errors: string[];
  warnings: string[];
  stats: { scenes: number; moves: number; variations: number; seconds: number } | null;
}

/** Finds the JSON in an AI answer: code fences, text around it, comments, trailing commas, curly quotes. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("Kein JSON gefunden");
  t = t.slice(a, b + 1);
  const attempts = [
    t,
    t.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"),
    // Curly quotes as JSON quotes break only when the AI used them instead of ".
    t.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1").replace(/[“”„]/g, '"'),
  ];
  let last: unknown;
  for (const x of attempts) {
    try {
      return JSON.parse(x);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("JSON ist fehlerhaft");
}

type Obj = Record<string, unknown>;
/** Looks a field up under any spelling: "kleineZeile", "kleine_zeile", "Kleine Zeile". */
const field = (o: Obj, ...names: string[]): unknown => {
  const wanted = new Set(names.map(word));
  for (const [k, v] of Object.entries(o)) if (wanted.has(word(k))) return v;
  return undefined;
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const number = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".").replace(/[^\d.-]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "ja" || v === "true" ? true : v === "nein" || v === "false" ? false : null);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : typeof v === "string" ? v.split(/[,;]/) : [v]);
const SQ = /^[a-h][1-8]$/;

function arrowOf(v: unknown): StudioArrow | null {
  let from = "";
  let to = "";
  let tone: unknown = "accent";
  if (typeof v === "string") {
    const m = v.toLowerCase().match(/([a-h][1-8])\s*(?:-|–|>|->|→|\s|nach|bis)?\s*([a-h][1-8])\s*(.*)$/);
    if (!m) return null;
    [, from, to, tone] = m;
  } else if (Array.isArray(v)) {
    [from, to, tone] = [String(v[0] ?? "").toLowerCase(), String(v[1] ?? "").toLowerCase(), v[2]];
  } else if (v && typeof v === "object") {
    const o = v as Obj;
    from = String(field(o, "von", "from", "start") ?? "").toLowerCase();
    to = String(field(o, "nach", "to", "ziel", "bis") ?? "").toLowerCase();
    tone = field(o, "farbe", "tone", "color", "art");
  }
  if (!SQ.test(from) || !SQ.test(to) || from === to) return null;
  return { from, to, tone: TONES[word(tone)] ?? "accent" };
}

function markOf(v: unknown): StudioMark | null {
  let square = "";
  let tone: unknown = "accent";
  if (typeof v === "string") {
    const m = v.toLowerCase().match(/([a-h][1-8])\s*(.*)$/);
    if (!m) return null;
    [, square, tone] = m;
  } else if (Array.isArray(v)) {
    [square, tone] = [String(v[0] ?? "").toLowerCase(), v[1]];
  } else if (v && typeof v === "object") {
    const o = v as Obj;
    square = String(field(o, "feld", "square", "auf") ?? "").toLowerCase();
    tone = field(o, "farbe", "tone", "color", "art");
  }
  return SQ.test(square) ? { square, tone: TONES[word(tone)] ?? "accent" } : null;
}

export function importAiScript(input: string): AiImport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = extractJson(input);
  } catch (e) {
    return { project: null, errors: [`Die Antwort ist kein lesbares JSON (${e instanceof Error ? e.message : "Fehler"}). Bitte die KI, nur den JSON-Codeblock zu schicken.`], warnings, stats: null };
  }
  const root = (Array.isArray(raw) ? { szenen: raw } : raw) as Obj;
  const rawScenes = asList(field(root, "szenen", "scenes", "szene"));
  if (!rawScenes.length) return { project: null, errors: ["Im Skript stehen keine Szenen („szenen“)."], warnings, stats: null };

  let startFen = START_FEN;
  const sf = text(field(root, "startstellung", "startfen", "fen", "stellung"), 120);
  if (sf) {
    if (validFen(sf)) startFen = sf;
    else warnings.push("Die Startstellung (FEN) ist ungültig, ich nehme die Grundstellung.");
  }

  const perspWord = word(field(root, "perspektive", "perspective", "sicht", "seite"));
  const perspective: Side = perspWord ? (["schwarz", "black", "s", "b"].includes(perspWord) ? "black" : "white") : guessPerspective(`${text(field(root, "titel", "title"), 200)} ${JSON.stringify(rawScenes).slice(0, 4000)}`);
  if (!perspWord && perspective === "black") warnings.push("Keine Perspektive angegeben. Das Video ist für Schwarz, darum zeige ich es aus Sicht von Schwarz.");

  // The positions along the line being shown; variations cut it back, the main line is kept aside.
  let line: string[] = [startFen];
  let mainLine: string[] | null = null;
  let moveCount = 0;
  let variations = 0;
  const scenes: Scene[] = [];
  rawScenes.slice(0, 80).forEach((x, i) => {
    const n = i + 1;
    if (!x || typeof x !== "object") {
      warnings.push(`Szene ${n} ist leer und fehlt.`);
      return;
    }
    const o = x as Obj;
    const here = line[line.length - 1];
    let jump = "";
    const fen = text(field(o, "fen", "stellung"), 120);
    const variant = field(o, "variante", "variation");
    const back = number(variant && typeof variant === "object" ? field(variant as Obj, "zurueck", "back", "halbzuege") : (field(o, "zurueck", "back") ?? (typeof variant === "number" ? variant : null)));
    const toMain = bool(field(o, "hauptvariante", "zurueckzurhauptvariante", "mainline")) === true;
    if (fen) {
      if (validFen(fen)) {
        line = [fen];
        jump = fen;
      } else warnings.push(`Szene ${n}: Die FEN ist ungültig und wird ignoriert.`);
    } else if (back !== null && back > 0) {
      if (!mainLine) mainLine = line.slice();
      const keep = Math.max(1, line.length - Math.round(back));
      if (line.length - Math.round(back) < 1) warnings.push(`Szene ${n}: So weit kann ich nicht zurück, ich starte bei der ersten Stellung.`);
      line = line.slice(0, keep);
      jump = line[line.length - 1];
      variations += 1;
    } else if (toMain) {
      if (mainLine) {
        line = mainLine;
        mainLine = null;
        jump = line[line.length - 1];
      } else warnings.push(`Szene ${n}: „hauptvariante“ ohne vorherige Variante wird ignoriert.`);
    }
    const before = line[line.length - 1];

    // Moves: checked one by one, an illegal one ends the scene's moves.
    const movesText = text(field(o, "zug", "zuege", "moves", "move"), 600);
    const parsed = parseMoves(before, Array.isArray(field(o, "zuege", "moves")) ? (field(o, "zuege", "moves") as unknown[]).join(" ") : movesText);
    if (parsed.error) errors.push(`Szene ${n}: „${parsed.error}“ ist in dieser Stellung nicht möglich${parsed.moves.length ? `, nur ${movesLabel(parsed.moves, before)} wird gezeigt` : ""}.`);
    const walk = new Chess(before);
    for (const m of parsed.moves) {
      walk.move(m.san);
      line.push(walk.fen());
    }
    moveCount += parsed.moves.length;

    const cardWord = word(field(o, "karte", "card", "typ", "type"));
    const card = cardWord ? CARDS[cardWord] : "none";
    if (cardWord && !card) warnings.push(`Szene ${n}: Karte „${String(field(o, "karte", "card", "typ", "type"))}“ kenne ich nicht.`);
    const camWord = word(field(o, "kamera", "camera", "perspektive"));
    // "weiss"/"schwarz" mean a side: the video's own side is the normal view, the other one is "von gegenüber".
    const sideCam = camWord === "weiss" || camWord === "white" || camWord === "weisssicht" ? (perspective === "white" ? "white" : "black") : camWord === "schwarz" || camWord === "black" || camWord === "schwarzsicht" ? (perspective === "black" ? "white" : "black") : null;
    const camera = sideCam ?? CAMERAS[camWord] ?? (card === "outro" ? "corner" : "white");
    if (camWord && !sideCam && !CAMERAS[camWord]) warnings.push(`Szene ${n}: Kamera „${String(field(o, "kamera", "camera"))}“ kenne ich nicht, ich nehme ${CAMERA_LABEL[camera]}.`);

    const effectsRaw = field(o, "effekte", "effects", "effekt");
    const effects: Effect[] = [];
    for (const e of asList(effectsRaw)) {
      const id = EFFECTS[word(e)];
      if (id) effects.push(id);
      else warnings.push(`Szene ${n}: Effekt „${String(e).trim()}“ gibt es nicht.`);
    }
    // A mate on the board gets its animation even when the AI forgot it.
    if (effectsRaw === undefined && parsed.moves.length && walk.isCheckmate()) effects.push("mate");

    const badgeRaw = text(field(o, "bewertung", "badge", "symbol"), 30);
    const badge: Badge = BADGES[badgeRaw] ?? BADGES[word(badgeRaw)] ?? "";
    if (badgeRaw && !badge) warnings.push(`Szene ${n}: Bewertung „${badgeRaw}“ gibt es nicht.`);

    const arrows = asList(field(o, "pfeile", "arrows", "pfeil")).map(arrowOf);
    const marks = asList(field(o, "markierungen", "marks", "markierung", "felder")).map(markOf);
    if (arrows.includes(null) || marks.includes(null)) warnings.push(`Szene ${n}: Ein Pfeil oder eine Markierung war unlesbar und fehlt.`);

    const label = parsed.moves.length ? movesLabel(parsed.moves, before) : "";
    const options = asList(field(o, "antworten", "optionen", "options"))
      .map((a) => text(a, 40))
      .filter(Boolean)
      .slice(0, 3);
    const countdown = number(field(o, "countdown", "timer"));
    scenes.push(
      scene({
        moves: label,
        fen: jump && jump !== here ? jump : "",
        title: text(field(o, "titel", "title", "ueberschrift"), 120) || label,
        text: text(field(o, "untertitel", "text", "subtitle", "untertext"), 900),
        speech: text(field(o, "sprechtext", "sprecher", "voiceover", "sagen", "speech"), 1200),
        label: text(field(o, "kleinezeile", "label", "kicker", "zeile"), 40) || (back ? `Variante ${variations}` : toMain && jump ? "Zurück zur Hauptvariante" : ""),
        duration: Math.min(30, Math.max(1, number(field(o, "dauer", "duration", "sekunden")) ?? (card === "outro" ? 4 : card === "intro" ? 3 : 2.8 + parsed.moves.length * 0.6))),
        camera,
        zoom: Math.min(1.6, Math.max(0.45, number(field(o, "zoom")) ?? 1)),
        orbit: Math.min(30, Math.max(-30, number(field(o, "drehung", "orbit", "kamerafahrt")) ?? 0)),
        focus: bool(field(o, "fokus", "focus")) === true,
        arrows: arrows.filter((a): a is StudioArrow => !!a).slice(0, 12),
        marks: marks.filter((m): m is StudioMark => !!m).slice(0, 16),
        card: card ?? "none",
        options: card === "poll" ? options : [],
        countdown: card === "question" || card === "poll" ? Math.min(10, Math.max(0, countdown ?? 3)) : 0,
        mood: MOODS[word(field(o, "stimmung", "mood"))] ?? (effects.includes("mate") ? "wow" : "happy"),
        effects: [...new Set(effects)],
        badge,
        tempo: Math.min(3, Math.max(0.3, number(field(o, "zugtempo", "tempo")) ?? 1)),
      }),
    );
  });
  if (!scenes.length) return { project: null, errors: errors.length ? errors : ["Keine lesbare Szene gefunden."], warnings, stats: null };

  // ---- look and video options
  const theme = (Object.keys(THEMES) as ThemeId[]).find((t) => t === word(field(root, "look", "theme", "stil"))) ?? "nova";
  const envWord = word(field(root, "umgebung", "environment", "hintergrund"));
  const environment = ENVS[envWord] ?? "podium";
  if (envWord && !ENVS[envWord]) warnings.push(`Umgebung „${String(field(root, "umgebung", "environment"))}“ kenne ich nicht, ich nehme ${ENV_LABEL[environment]}.`);
  const design = (field(root, "design", "aussehen") ?? {}) as Obj;
  const dfield = (...names: string[]) => field(design, ...names) ?? field(root, ...names);
  const pick = <T,>(map: Record<string, T>, label: string, ...names: string[]): T | undefined => {
    const w = word(dfield(...names));
    if (!w) return undefined;
    if (!(w in map)) warnings.push(`${label} „${String(dfield(...names))}“ kenne ich nicht, ich nehme den Standard.`);
    return map[w];
  };
  const material = pick(PIECE_LOOKS, "Figuren", "figuren", "pieces", "material");
  const captionStyle = pick(CAPTIONS, "Untertitel-Stil", "untertitelstil", "captionstyle", "untertitel");
  const titleFont = pick(FONTS, "Schrift", "schrift", "font");
  const view = pick(VIEWS, "Ansicht", "ansicht", "brett", "view");
  const music = pick(MUSICS, "Musik", "musik", "music");
  const accentRaw = text(dfield("akzent", "akzentfarbe", "accent"), 12);
  const accent = /^#[0-9a-f]{6}$/i.test(accentRaw) ? accentRaw : undefined;
  if (accentRaw && !accent) warnings.push(`Akzentfarbe „${accentRaw}“ ist kein Farbcode wie #8d9aff.`);
  const textScale = number(dfield("textgroesse", "textscale", "schriftgroesse"));
  const rim = bool(dfield("figurenrand", "piecerim", "rand"));
  const settings = (field(root, "einstellungen", "settings", "optionen") ?? {}) as Obj;
  const setting = (fallback: boolean, ...names: string[]) => bool(field(settings, ...names)) ?? fallback;
  const platform = PLATFORMS[word(field(root, "plattform", "platform"))] ?? "tiktok";
  const speed = number(field(root, "geschwindigkeit", "speed", "gesamttempo"));
  const tempo = number(field(root, "zugtempo", "tempo"));
  let project: StudioProject = normalizeProject({
    id: newId("p"),
    name: text(field(root, "titel", "title", "name"), 80) || "KI-Video",
    startFen,
    scenes,
    style: {
      ...styleFromTheme(theme, { environment, coords: setting(true, "koordinaten", "coords"), reflection: setting(true, "spiegelung", "reflection") }),
      ...(material ? { material } : {}),
      ...(captionStyle ? { captionStyle } : {}),
      ...(titleFont ? { titleFont } : {}),
      // YouTube lessons default to the flat board: it is the easiest to follow for a long explanation.
      view: view ?? (platform === "youtube" ? "2d" : "3d"),
      ...(accent ? { accent } : {}),
      ...(textScale !== null ? { textScale } : {}),
      ...(rim !== null ? { pieceRim: rim } : {}),
    },
    video: {
      ...DEFAULT_VIDEO,
      format: platform === "youtube" ? "16:9" : "9:16",
      perspective,
      plainMoves: setting(true, "zuginworten", "plainmoves"),
      squareHints: setting(true, "felderleuchten", "squarehints"),
      spellMoves: setting(true, "zuegeausschreiben", "spellmoves"),
      platform,
      speed: speed ?? 1,
      // Lessons move the pieces more calmly so the viewer can follow every move.
      tempo: tempo ?? (platform === "youtube" ? 0.8 : 1),
      lucena: setting(true, "lucena", "kugel"),
      sound: setting(true, "effektTon", "ton", "sound", "sounds"),
      movePill: setting(true, "zuganzeige", "movepill"),
      progress: setting(true, "fortschritt", "progress"),
      introFly: setting(true, "kameraflug", "introfly"),
      ...(music ? { music } : {}),
      lesson: platform === "youtube" && setting(true, "lernlayout", "lesson"),
    },
    updatedAt: Date.now(),
  });
  // Texts longer than the frame holds get cut on screen, so say which scene to shorten.
  project.scenes.forEach((sc, i) => {
    const max = FIT.title / Math.max(0.8, project.style.textScale);
    if (sc.title.length > max) warnings.push(`Szene ${i + 1}: Titel ist ${sc.title.length} Zeichen lang, ins Bild passen etwa ${Math.round(max)}.`);
    const plain = sc.text.replace(/[*|]/g, "");
    if (project.video.lesson && plain.length > FIT.lesson) warnings.push(`Szene ${i + 1}: Erklärung ist lang (${plain.length} Zeichen), rechts passen etwa ${FIT.lesson}. Sie wird deshalb in Teilen nacheinander gezeigt.`);
  });
  const length = number(field(root, "laenge", "length", "dauer"));
  if (length && length >= 5 && speed === null) project = fitLength(project, length);
  const seconds = compile(project).total;
  if (length && Math.abs(seconds - length) > length * 0.3) warnings.push(`Das Video dauert ${Math.round(seconds)} s statt ${Math.round(length)} s. Mit „auf N s anpassen“ lässt es sich angleichen.`);
  return { project, errors, warnings, stats: { scenes: project.scenes.length, moves: moveCount, variations, seconds } };
}

// ---------- the other way round ----------

const rev = <T extends string>(map: Record<string, T>, value: T) => Object.keys(map).find((k) => map[k] === value) ?? value;
const TONE_WORD: Record<Tone, string> = { accent: "akzent", good: "gut", bad: "gefahr", idea: "idee", white: "weiss" };

/** The current project in the AI format, to let an AI revise it. Variations become plain position jumps (FEN). */
export function toAiScript(project: StudioProject): string {
  const out = {
    titel: project.name,
    plattform: project.video.platform,
    perspektive: project.video.perspective === "black" ? "schwarz" : "weiss",
    geschwindigkeit: project.video.speed,
    zugtempo: project.video.tempo,
    look: project.style.theme,
    umgebung: rev(ENVS, project.style.environment),
    design: {
      ansicht: project.style.view,
      figuren: rev(PIECE_LOOKS, project.style.material),
      untertitelStil: rev(CAPTIONS, project.style.captionStyle),
      schrift: rev(FONTS, project.style.titleFont),
      akzent: project.style.accent,
      textgroesse: project.style.textScale,
      figurenRand: project.style.pieceRim,
      musik: project.video.music === "file" ? "keine" : rev(MUSICS, project.video.music),
    },
    ...(project.startFen !== START_FEN ? { startstellung: project.startFen } : {}),
    szenen: project.scenes.map((s) => ({
      ...(s.card !== "none" ? { karte: rev(CARDS, s.card) } : {}),
      ...(s.fen ? { fen: s.fen } : {}),
      ...(s.moves ? { zug: s.moves } : {}),
      titel: s.title,
      ...(s.text ? { untertitel: s.text } : {}),
      ...(s.speech ? { sprechtext: s.speech } : {}),
      ...(s.label ? { kleineZeile: s.label } : {}),
      dauer: s.duration,
      kamera: rev(CAMERAS, s.camera),
      ...(s.zoom !== 1 ? { zoom: s.zoom } : {}),
      ...(s.orbit ? { drehung: s.orbit } : {}),
      ...(s.focus ? { fokus: true } : {}),
      ...(s.arrows.length ? { pfeile: s.arrows.map((a) => `${a.from}-${a.to} ${TONE_WORD[a.tone]}`) } : {}),
      ...(s.marks.length ? { markierungen: s.marks.map((m) => `${m.square} ${TONE_WORD[m.tone]}`) } : {}),
      ...(s.effects.length ? { effekte: s.effects.map((e) => rev(EFFECTS, e)) } : {}),
      ...(s.badge ? { bewertung: rev(BADGES, s.badge) } : {}),
      ...(s.tempo !== 1 ? { zugtempo: s.tempo } : {}),
      ...(s.options.length ? { antworten: s.options } : {}),
      ...(s.countdown ? { countdown: s.countdown } : {}),
      stimmung: rev(MOODS, s.mood),
    })),
  };
  return "```json\n" + JSON.stringify(out, null, 2) + "\n```";
}

/** The speaker's lines with their time in the video, to read along while recording the voice-over. */
export function speechSheet(project: StudioProject): string {
  const tl = compile(project);
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return tl.scenes
    .map((c, i) => {
      const say = c.scene.speech.trim() || c.scene.text.replace(/\*/g, "").replace(/\s*\|\s*/g, " ").trim();
      return `${fmt(c.start)}–${fmt(c.start + c.dur)}  Szene ${i + 1}${c.scene.title ? ` (${c.scene.title})` : ""}\n${say || "—"}`;
    })
    .join("\n\n");
}

export const EFFECT_IDS = Object.keys(EFFECT_LABEL) as Effect[];
