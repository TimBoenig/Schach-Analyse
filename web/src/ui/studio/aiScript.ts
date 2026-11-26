// Video scripts written by an external AI chat (ChatGPT, Claude, Gemini …).
// The studio hands out a prompt that describes a small JSON format; the AI's
// answer is pasted back and turned into a project: every move checked,
// variations resolved by "go back n half-moves", unknown values replaced by
// safe defaults with a note. Pure, so it is tested headless.
import { Chess, type Move } from "chess.js";

import {
  CAMERA_LABEL,
  DEFAULT_VIDEO,
  EFFECT_LABEL,
  ENV_LABEL,
  MAX_CAMERAS,
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
  type ReelLook,
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
import { STYLE_LABEL, type StyleId } from "./musicGen";
import { tightenEdit } from "./editTools";
import { fitLength, movesLabel } from "./wizard";
import { lang, t } from "../../i18n";

// ---------- words the AI may use (German or English) ----------

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
  angled: "corner", opposite: "black", behind: "white",
};
const CARDS: Record<string, Card> = {
  keine: "none", none: "none",
  titel: "intro", titelkarte: "intro", intro: "intro", hook: "intro", title: "intro", titlecard: "intro",
  frage: "question", question: "question", raetsel: "question",
  umfrage: "poll", poll: "poll", abstimmung: "poll",
  abspann: "outro", outro: "outro", ende: "outro", cta: "outro",
};
const TONES: Record<string, Tone> = {
  akzent: "accent", accent: "accent", blau: "accent", lila: "accent", neutral: "accent",
  gut: "good", good: "good", gruen: "good", verteidigung: "good", richtig: "good",
  gefahr: "bad", danger: "bad", red: "bad", bad: "bad", rot: "bad", schlecht: "bad", drohung: "bad", fehler: "bad", angriff: "bad",
  idee: "idea", idea: "idea", gelb: "idea", orange: "idea", plan: "idea",
  weiss: "white", white: "white",
};
const MOODS: Record<string, Mood> = {
  froehlich: "happy", happy: "happy", freude: "happy",
  nachdenklich: "think", think: "think", denken: "think", thoughtful: "think",
  begeistert: "wow", wow: "wow", staunen: "wow", excited: "wow",
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
  hitstop: "hitstop", stillstand: "hitstop", freeze: "hitstop", freezeframe: "hitstop", standbild: "hitstop", einfrieren: "hitstop",
  invert: "invert", invertieren: "invert", negativ: "invert", umkehren: "invert", inverted: "invert",
  glitch: "glitch", rgb: "glitch", rgbsplit: "glitch", chromatic: "glitch", chromaticaberration: "glitch", aberration: "glitch", farbverschiebung: "glitch",
  schraeglage: "dutch", dutch: "dutch", dutchangle: "dutch", kippen: "dutch", schief: "dutch", kamerakippen: "dutch",
  punch: "punch", punchin: "punch", einschlag: "punch", schnellerzoom: "punch",
  riser: "riser", aufbau: "riser", spannungsaufbau: "riser", heranzoomen: "riser", creep: "riser", pushin: "riser",
  whip: "whip", whippan: "whip", schwenk: "whip", wischer: "whip", wisch: "whip",
};
const ENVS: Record<string, Environment> = {
  schwebend: "void", void: "void", keine: "void", nichts: "void", floating: "void", none: "void",
  buehne: "podium", podium: "podium", podest: "podium", stage: "podium",
  holztisch: "table", tisch: "table", table: "table", woodtable: "table", woodentable: "table",
  neon: "neon", neonarena: "neon", arena: "neon",
  turniersaal: "hall", saal: "hall", hall: "hall", turnier: "hall",
  bibliothek: "library", library: "library",
};
const PIECE_LOOKS: Record<string, Material> = { lack: "porcelain", porzellan: "porcelain", glanz: "porcelain", matt: "matte", matte: "matte", chrom: "chrome", chrome: "chrome", metall: "chrome", holz: "wood", wood: "wood", holzfiguren: "wood", gloss: "porcelain", glossy: "porcelain", porcelain: "porcelain" };
const CAPTIONS: Record<string, CaptionStyle> = { kasten: "box", box: "box", kontur: "outline", outline: "outline", umriss: "outline", gross: "punch", punch: "punch", fett: "punch", big: "punch" };
const VIEWS: Record<string, BoardView> = { "2d": "2d", flach: "2d", buch: "2d", klar: "2d", "3d": "3d", show: "3d", plastisch: "3d", aufsteller: "billboard", billboard: "billboard", standees: "billboard", flat: "2d", mix: "billboard", "3d2d": "billboard", reel: "reel", schwarzweiss: "reel", mono: "reel", clip: "reel" };
/** The two cuts of the reel look ("schnittstil"): the reference-style close crop or the classic tilted overview. */
const CUT_STYLES: Record<string, ReelLook> = { nah: "close", close: "close", eng: "close", vorbild: "close", referenz: "close", reference: "close", klassisch: "classic", classic: "classic", schraeg: "classic", ueberblick: "classic", overview: "classic" };
const FONTS: Record<string, "sans" | "serif"> = { modern: "sans", sans: "sans", elegant: "serif", serif: "serif", klassisch: "serif" };
const MUSICS: Record<string, MusicId> = { calm: "lofi", keine: "none", none: "none", aus: "none", lofi: "lofi", ruhig: "lofi", spannung: "tension", tension: "tension", spannend: "tension", episch: "epic", epic: "epic", beat: "beat", phonk: "generated", generator: "generated", passend: "generated", auto: "generated" };
/** Looks under their English names (the ids stay German, they are stored in projects). */
const LOOKS: Record<string, ThemeId> = { nova: "nova", marmor: "marmor", marble: "marmor", holz: "holz", wood: "holz", walnuss: "walnuss", walnut: "walnuss", turnier: "turnier", tournament: "turnier", neon: "neon", mono: "mono", reel: "mono", schwarzweiss: "mono" };
/** Longest texts that still fit the frame at normal text size. */
export const FIT = { title: 30, subtitle: 95, label: 22, option: 14, lesson: LESSON_CHUNK };

const PLATFORMS: Record<string, Platform> = {
  tiktok: "tiktok", reels: "reels", instagram: "reels", instagramreels: "reels", shorts: "shorts", youtubeshorts: "shorts", youtube: "youtube", youtubequer: "youtube",
};
/** What kind of video the script is: an explainer (slow, with captions) or an "edit" (fast reel cuts to a beat, almost no text). */
export type VideoArt = "explain" | "edit";
const ARTS: Record<string, VideoArt> = {
  erklaerung: "explain", erklaervideo: "explain", lernvideo: "explain", explainer: "explain", explain: "explain", lehrvideo: "explain", tutorial: "explain", lesson: "explain",
  edit: "edit", editvideo: "edit", reel: "edit", clip: "edit", schnitt: "edit", schnellerclip: "edit", montage: "edit", fastedit: "edit",
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
  /** The kind of video; "auto" (the default) lets the AI decide from the topic and notes. */
  type?: VideoArt | "auto";
  /** The scenario asked for in the questions step; it decides the kind of video and adds its own brief. Wins over `type`. */
  scenario?: Scenario;
  /** The answers of the questions step. A missing answer adds nothing to the prompt. */
  answers?: PromptAnswers;
}

/** What the video is for. Edit and explainer map onto the two kinds of video; the others are explainers with their own brief. */
export type Scenario = "auto" | "edit" | "explain" | "lesson" | "opening" | "puzzle";
export const SCENARIOS: Scenario[] = ["edit", "explain", "lesson", "opening", "puzzle", "auto"];
export const scenarioArt = (s: Scenario): VideoArt | "auto" => (s === "edit" ? "edit" : s === "auto" ? "auto" : "explain");

export type Level = "beginner" | "club" | "strong";
export type Pace = "calm" | "normal" | "fast";
export type Hook = "auto" | "question" | "bold" | "result";
export type Ending = "auto" | "follow" | "question" | "part2" | "none";
export type Point = "auto" | "mate" | "sacrifice" | "blunder" | "turn";

/** The questions asked before the prompt is copied. Everything is optional; "auto" or an empty text means: the AI decides. */
export interface PromptAnswers {
  /** The user's own game (PGN) or position (FEN) the video is about. */
  game?: string;
  level?: Level;
  pace?: Pace;
  hook?: Hook;
  ending?: Ending;
  /** Edit only: the punch line. */
  point?: Point;
  /** Language of the texts in the video. */
  language?: "de" | "en";
  /** Music style the studio generates (told to the AI for pacing and mood only). */
  music?: StyleId | "auto";
  /** Explainers: write a voice-over / end with a poll. */
  voice?: boolean;
  poll?: boolean;
}

/** What the import takes from the questions when the script itself does not say. */
export interface ImportDefaults {
  /** The asked kind of video: an explicit choice wins over what the AI wrote, "auto" leaves it to the script. */
  art?: VideoArt | "auto";
  platform?: Platform;
  musicStyle?: StyleId | "auto";
  /** Make an edit short and dense as it comes in (hook start, squeezed middle, 1.3 s outro). The import dialog always does; false keeps the script as written. */
  tighten?: boolean;
}

const list = (o: Record<string, unknown>) => Object.keys(o).join(", ");
/** Fills {name} gaps of a text that was translated already. */
const sub = (s: string, p: Record<string, string | number>) => s.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m));

const BLACK_HINTS = /(f(ü|ue)r schwarz|mit schwarz|als schwarz|for black|as black|englund|sizilian|sicilian|caro|franz(ö|oe)sisch|french defen|skandinav|scandinav|pirc|k(ö|oe)nigsindisch|king'?s indian|gr(ü|ue)nfeld|nimzo|holl(ä|ae)ndisch|dutch|aljechin|alekhine|budapest|benoni|wolga|benko|stafford|elephant|elefanten)/i;

/** Which side a script is about when the AI forgot to say: defences and traps for Black are shown from Black. */
export function guessPerspective(content: string): Side {
  return BLACK_HINTS.test(content) ? "black" : "white";
}

const LONG_RULES = () => t("SO WIRD ES EIN GUTES LERNVIDEO\n1. Ruhig und seriös, kein Entertainment-Tempo. Der Zuschauer will etwas verstehen und mitdenken.\n2. Aufbau: Einstieg (was man lernt und warum es wichtig ist), dann 3 bis 5 Kapitel, dann eine Zusammenfassung mit den 3 wichtigsten Punkten, dann ein kurzer Abspann. \"kleineZeile\" ist der Kapitelname (z. B. \"Kapitel 2: Der Plan für Weiß\") und bleibt über mehrere Szenen gleich.\n3. Erkläre das Warum: Pläne, Bauernstruktur, typische Fehler, die Idee hinter jedem wichtigen Zug. Zeig auch, was passiert, wenn man es falsch macht (als Variante).\n4. Pro Szene meist ein Zug, höchstens zwei. Jede Szene dauert 8 bis 20 Sekunden, damit der Zuschauer den Zug sieht und die Erklärung lesen kann.\n5. \"untertitel\" ist die Erklärung, die rechts neben dem Brett komplett stehen bleibt: 2 bis 4 ganze Sätze, höchstens {lesson} Zeichen. *Sternchen* färben Schlüsselwörter und Felder.\n6. \"sprechtext\" ist ausführlicher als der Untertitel: das, was ich dazu sage, etwa 2,5 Wörter pro Sekunde, passend zur Dauer.\n7. Pfeile für Pläne und Drohungen, Markierungen für wichtige Felder. Effekte sparsam: höchstens spotlight, drohung, matt. Keine Konfetti-Explosion mitten in der Erklärung.\n8. Kamera meist \"normal\" oder \"oben\", ruhig, ohne Drehung. Bleib bei EINER Perspektive.\n9. Umfragen nur, wenn sie zum Mitdenken einladen (\"Was würdest du hier spielen?\"), höchstens zwei im ganzen Video.\n10. Keine erfundenen Zahlen, Statistiken oder Partien. Wenn du eine berühmte Partie zeigst, nur mit den echten Zügen.\n11. Schreib für Anfänger: nenn die Figur beim Namen und das Feld (\"der Springer zieht nach f3\", \"der Läufer schlägt den Springer auf c6\") statt nur Notation wie \"Sf3\" oder \"Lxc6\". Begriffe wie Gabel, Fesselung oder Rochade erklärst du beim ersten Mal in einem halben Satz.\n\n", { lesson: FIT.lesson });

const LONG_LAYOUT = () => t("SO SIEHT DAS VIDEO AUS (Querformat 16:9, Lernvideo)\n- Links das Brett, groß und ruhig, standardmäßig flach von oben (2D) wie in einem Schachbuch.\n- Rechts eine Lesespalte: oben das Kapitel (\"kleineZeile\") in Akzentfarbe, darunter der \"titel\" (höchstens 2 Zeilen, etwa {title} Zeichen), darunter der ganze \"untertitel\" als Erklärung (bis 9 Zeilen, höchstens {lesson} Zeichen), unten die bisher gespielten Züge mit dem aktuellen Zug hervorgehoben.\n- Karten (\"titel\", \"frage\", \"umfrage\", \"abspann\") legen sich wie gewohnt über das ganze Bild.\n\n", { title: FIT.title, lesson: FIT.lesson });

const ART_EXPLAIN = () => t("VORAB: VIDEOART\nDas ist ein Erklärvideo. Setz \"videoart\": \"erklaerung\" ganz oben ins JSON.\n\n");
const MY_VIDEO = () => t("MEIN VIDEO\n- Thema: {topic}\n{side}- Plattform: {platform} ({orient})\n- Ziellänge: etwa {len}\n{notes}");
const EFFECT_GLOSSARY = () => t("WAS DAS STUDIO KANN (setz es gezielt ein, nicht in jeder Szene)\nEffekte (\"effekte\", mehrere möglich):\n- matt: Der König kippt um, eine rote Druckwelle läuft übers Brett, die Kamera fährt ran, großer Schriftzug SCHACHMATT, dumpfer Schlag. Nur in der Szene mit dem Mattzug.\n- drohung: Die bedrohten Felder pulsieren rot (die Ziele der roten Pfeile, sonst die Figuren, die der gezogene Stein angreift).\n- spotlight: Alles außer dem Zielfeld des Zugs wird dunkel. Für den einen Zug, auf den es ankommt.\n- wackeln: Die Kamera bebt, wenn die Figur aufsetzt. Für harte Schläge.\n- zoom: Schneller Zoom auf das Zielfeld.\n- blitz: Kurzer heller Blitz beim Zug. Für Überraschungen.\n- konfetti: Konfetti-Explosion. Für den Gewinnzug oder das Ende.\n- zeitlupe: Der letzte Zug der Szene läuft langsam. Für den Schlüsselzug.\n- hitstop: Das ganze Bild friert für 0,25 Sekunden ein, genau im Moment des Aufpralls (Figur landet, Opfer, Patzer). Danach geht es weiter, oft mit schnellen Schnitten.\n- invert: Die Farben kehren sich für 0,15 Sekunden um. Für einen Patzer oder einen brillanten Zug.\n- glitch: Kurze RGB-Verschiebung an den Rändern (Chromatic Aberration) beim Aufprall.\n- schraeglage: Die Kamera kippt schräg (Dutch Angle). Für Drohungen.\n- punch: Punch-In: schneller Zoom von 1.0 auf 0.65 in einer halben Sekunde am Anfang der Szene.\n- riser: Langsames, immer schnelleres Heranzoomen bis zum Aufprall. Spannungsaufbau vor einem Opfer oder Patzer.\n- whip: Schneller Kameraschwenk mit Bewegungsunschärfe zum nächsten Winkel (beim Wechsel der \"kameras\" und beim Einstieg in die Szene).\nStärke der Effekte: Jeder Effekt hat eine Stärke von 0 bis 1 (ohne Angabe 1), damit der Höhepunkt auffällt: \"effekte\": {\"wackeln\": 0.3, \"zoom\": 0.5} (normale Schläge 0.3, Matt oder Damenopfer 1.0). Eine Liste ohne Zahlen (\"effekte\": [\"wackeln\"]) heißt Stärke 1. Mit \"intensitaet\": 0.5 bekommen alle Effekte der Szene ohne eigene Stärke diese.\nStempel (\"stempel\"): ein Wort, riesig mitten über dem Brett, 0,4 Sekunden lang im Moment des Aufpralls, z. B. \"BLUNDER\", \"SACRIFICE\", \"??\", \"MATT\" (höchstens 14 Zeichen). Sparsam einsetzen.\nMehrere Kameras pro Szene (\"kameras\": [\"nah\", \"tief\", \"oben\"]): die Winkel schalten im Takt durch, mit schnellem Schwenk dazwischen (nach einem Hitstop erst danach). So wechselst du die Kamera während eines Zugs, ohne leere Szenen zu bauen.\nBewertung des Zugs (\"bewertung\", das Symbol erscheint wie auf Analyse-Seiten über dem Zielfeld): brillant, grossartig, bester, exzellent, gut, buch, ungenau, fehler, verpasst, patzer.");
const POLL_RULES = () => t("Umfrage (\"karte\": \"umfrage\"): bis zu 3 Antworten als Züge, z. B. \"A) Sf6\". Jede Antwort bekommt auf dem Brett automatisch einen farbigen Pfeil (A blau, B orange, C lila) in derselben Farbe wie ihr Knopf, so verstehen es auch Zuschauer ohne Notation. Die Antworten müssen legale Züge in der aktuellen Stellung sein. Die nächste Szene zeigt die Auflösung.\nFrage mit Countdown (\"karte\": \"frage\"): Rätsel-Frage, dann tickt der Countdown herunter.");
const CAMERA_GLOSSARY = () => t("Kameras (\"kamera\"): normal (hinter der eigenen Seite), schraeg, seitlich, oben (von oben, gut für Pläne), tief (tief und dramatisch), nah (nah dran), gegenueber (von der anderen Seite, selten). Dazu zoom (0.5 = nah, 1 = ganzes Brett), drehung (langsame Kamerafahrt in Grad pro Sekunde, z. B. 5 oder -5) und fokus (true = Kamera lehnt sich zum Zielfeld).");
const TEMPO_RULE = () => t("Tempo: \"zugtempo\" pro Szene (0.4 langsam bis 2.5 schnell), oben \"geschwindigkeit\" für das ganze Video (0.5 bis 2.5).");
const LUCENA_RULE = () => t("Lucena: eine KI-Kugel neben den Untertiteln mit \"stimmung\": froehlich, nachdenklich, begeistert, traurig.");
const DESIGN_BLOCK = () => t("DESIGN (\"design\" oben im JSON, alles optional, passend zum Thema wählen)\n- look: nova (dunkelblau mit Violett, modern), marmor (helles Marmorbrett, kühles Türkis), holz (klassisches Holzbrett mit echten Holzfiguren, warmes Orange), walnuss (dunkles Edelholz mit Holzfiguren, Goldgelb, sehr edel), turnier (grün-weiß wie Online-Schach), neon (dunkles Lila mit Chromfiguren, für Action).\n- ansicht: 2d (flaches Brett von oben, am klarsten, Standard bei YouTube), 3d (plastisches Show-Brett, Standard bei TikTok, Reels, Shorts) oder aufsteller (3D-Brett mit flachen 2D-Figuren, die sich immer zur Kamera drehen).\n- figuren (nur 3D): lack (glänzend), matt, chrom, holz (Holz mit Maserung). Überschreibt die Figuren des Looks.\n- untertitelStil: kasten (Text in dunklem Kasten, ruhig), kontur (weiße Schrift mit dicker Kontur wie TikTok), gross (sehr groß und fett, höchstens 2 Zeilen, für schnelle Videos).\n- schrift: modern oder elegant (Serifen, für Geschichte und Klassiker).\n- akzent: eigene Akzentfarbe als Farbcode, z. B. \"#ffb84d\".\n- textgroesse: 0.8 bis 1.3 (1 = normal). Bei größerer Schrift passen weniger Zeichen.\n- musik: keine, lofi (ruhig, zum Lernen), spannung (treibend, für Fallen), episch (groß, für Meisterpartien).\n- figurenRand: true (heller Rand, Figuren besser zu unterscheiden) oder false.\nUmgebungen (\"umgebung\"): schwebend, buehne, holztisch, neon, turniersaal, bibliothek.");
const CHESS_HEAD = () => t("SCHACH-REGELN (sehr wichtig)\n- Nur legale Züge in der richtigen Reihenfolge. Prüfe jeden Zug, bevor du ihn schreibst.\n- Standard-Notation, deutsch (S, L, T, D, K) oder englisch (N, B, R, Q, K), z. B. \"1. e4 e5 2. Sf3\" oder \"3... a6\".");
const CHESS_REST = () => t("- Eine Szene kann einen oder mehrere Züge haben (\"zug\"). Die Züge gehen in der Stellung weiter, in der die vorige Szene aufgehört hat.\n- Variante: \"variante\": { \"zurueck\": n } geht vorher n Halbzüge zurück (1 Halbzug = ein Zug von Weiß oder Schwarz) und spielt dann die Züge dieser Szene.\n- Zurück zur Hauptvariante: \"hauptvariante\": true springt zur Stellung, bevor die Variante begann.\n- Eine besondere Startstellung (Rätsel, Endspiel) gibst du als \"startstellung\" (FEN) an.\n- Besser bei einer ganzen Partie: gib sie oben einmal als \"pgn\" an (Zugliste, Kopfzeilen erlaubt) und schreib in den Szenen nur \"zugNr\" statt \"zug\". zugNr zählt Halbzüge ab 1: 1 ist 1. e4, 2 ist 1... e5, 3 ist 2. Sf3, 14 ist 7... (Zug von Schwarz). \"zugNr\": 14 zeigt diesen Zug, \"zugNr\": \"14-16\" drei Züge hintereinander. Eine Szene ohne zugNr zeigt dieselbe Stellung noch einmal, z. B. aus einem neuen Kamerawinkel. Springt zugNr nach vorn oder zurück, blendet das Studio zur Stellung vor diesem Zug über. So stimmen die Züge garantiert, und du kannst dich ganz auf Schnitt, Pfeile und Drama konzentrieren.");
const ALL_FIELDS = () => t("ALLE FELDER\nVideo (oben): titel, plattform ({list}), laenge (Sekunden), perspektive (weiss, schwarz), geschwindigkeit, zugtempo, look, umgebung, design { ansicht, figuren, untertitelStil, schrift, akzent, textgroesse, musik, figurenRand }, startstellung, pgn, einstellungen { lucena, effektTon, zuganzeige, zugInWorten, zuegeAusschreiben, felderLeuchten, fortschritt, koordinaten, kameraflug, spiegelung } (jeweils true oder false).\nSzene: karte (titel, frage, umfrage, abspann oder weglassen), zug, zugNr, titel, untertitel, sprechtext, kleineZeile (z. B. \"Variante 1\"), dauer, kamera, kameras, zoom, drehung, fokus, pfeile (z. B. \"f3-e5 gefahr\"), markierungen (z. B. \"e5 gut\"), effekte, intensitaet, stempel, bewertung, zugtempo, stimmung, countdown (Sekunden, bei frage und umfrage), antworten (bei umfrage), variante, hauptvariante.\nFarben für Pfeile und Markierungen: gefahr (rot: Drohung, Fehler), gut (grün: gute Idee, Verteidigung), idee (gelb: Plan), akzent (Hervorhebung), weiss.");
const EXPLAIN_CHECK = () => t("PRÜF VOR DEM ANTWORTEN\n- Spiel alle Züge im Kopf nach: legal, richtige Reihenfolge, richtige Seite am Zug.\n- Jeder Titel höchstens {title} Zeichen, jeder Untertitel höchstens {chunk} Zeichen.\n- Die Summe der Dauern passt zur Ziellänge, und der Sprechtext jeder Szene ist in ihrer Dauer sprechbar.\n- Hook, eine klare Idee pro Szene, Pfeile für jede Drohung, Abspann mit Aufforderung.");
const EXAMPLE_WRAP = () => t("BEISPIEL (nur für das Format, schreib dein eigenes Video):\n```json\n{example}\n```");
const TASK_INTRO = () => t("Du schreibst das komplette Drehbuch für {kind}, das mein Videostudio automatisch daraus baut. Antworte NUR mit einem JSON-Codeblock in genau dem Format unten, ohne Text davor oder danach.\n\n");
const EDIT_INTRO = () => t("DEIN AUFTRAG: DU BIST DER EDITOR\nDu bist Video-Editor für Schach-Edits auf TikTok, Instagram Reels und YouTube Shorts. Du schreibst weder ein Lehrbuch noch ein Erklärvideo, sondern das Drehbuch für einen schnellen Edit im Phonk-/Anime-Edit-Stil. Mein Videostudio rendert daraus automatisch den Clip und legt Beat-Musik darunter.\n\nZIEL\n- Der Zuschauer wischt nicht weg: in der ersten Sekunde muss etwas Spannendes auf dem Brett stehen, und bis zum Schluss muss es einen Grund zum Zusehen geben (Spannungsbogen, Höhepunkt am Ende, kein Leerlauf).\n- Ein Edit erzählt EINE Pointe (Falle, Mattzug, Opfer, Patzer, Wendepunkt) mit EINEM Höhepunkt. Er erklärt nichts und lehrt nichts, er lässt den Zuschauer staunen.\n- Der Edit lebt vom Kontrast zwischen Ruhe und Aufprall, nicht von einem gleichmäßigen Tempo, das nach 10 Sekunden monoton wird. Jeder Effekt hat einen Grund: erst Spannung, dann der Schlag.\n- Nimm nur echte, bekannte Partien oder Stellungen mit korrekten Zügen (z. B. Schäfermatt, Légal-Falle, Opernpartie, Matt in 2). Keine erfundenen Partien, Zahlen oder Statistiken.\n\nSO SIEHT DER EDIT AUS\n- Schwarz-weißes Brett, schräg von der Seite, leuchtende Figuren und Felder, dicke Pfeile. Look, Ansicht und Umgebung weglassen: das Studio nimmt automatisch den Edit-Look.\n- Die Kamera ist ständig in Bewegung und fliegt zwischen den Szenen weich weiter (kein harter Schnitt beim Szenenwechsel). Harte Kamerawechsel im Takt entstehen nur innerhalb einer Szene mit \"kameras\".\n- Im Bild stehen fast nur Brett, Pfeile, Markierungen und einzelne Stempel-Wörter wie MATT. Kein \"untertitel\", kein \"sprechtext\", keine Zug-Anzeige, keine Lucena-Kugel, keine Umfragen, keine Fragekarten.\n- Den Ton macht das Studio: ein Beat mit 90 BPM (ohne Musikwunsch ein dunkler Phonk-Beat), ein Schlaggeräusch zu jedem Zug, Riser vor dem Aufprall und Einschläge bei Hitstop, Invert und Matt. Schreib keine Musik ins JSON, aber setz die Aufpralle genau dahin, wo der Beat einschlagen soll.");
const EDIT_RULES = () => t("EDIT-REGELN (diese Regeln gehen allen anderen Regeln vor)\nAUFBAU: ein Edit hat immer diese Teile in dieser Reihenfolge, dazwischen wechselst du ständig zwischen langsam, Stillstand und schnell.\n1. HOOK (erste 1,3 bis 2 Sekunden, 1 Szene): sofort auf dem Brett, kein Titel und kein Text (Ausnahme: Ist unter MEIN VIDEO ein Hook als Frage oder Behauptung gewünscht, steht ein kurzer \"titel\" von höchstens 30 Zeichen in dieser Szene). Bei \"pgn\" mit \"zugNr\" in der kritischen Stellung starten, nicht bei Zug 1, wenn die Pointe erst später kommt. Ein Pfeil auf das Ziel, eine Markierung \"gefahr\", Effekt \"punch\". Der Zuschauer soll denken: \"Was passiert hier?\"\n2. AUFBAU (1 bis 2 ruhige Szenen, zusammen 2 bis 4 Sekunden): Stellung und Idee zeigen, Pfeile auf die Drohung. In der letzten Aufbau-Szene der Effekt \"riser\" (langsames, immer schnelleres Heranzoomen).\n3. AUFPRALL (die Szene mit dem entscheidenden Zug, 1.3 bis 2 Sekunden): \"hitstop\" im Moment des Aufsetzens, dazu \"wackeln\" und ein \"stempel\" (ein Wort wie \"BLUNDER\", \"SACRIFICE\", \"??\", \"MATT\"). Bei einem Patzer dazu \"invert\", \"glitch\" und \"bewertung\": \"patzer\". ACHTUNG: \"bewertung\" brillant, grossartig oder bester und der Effekt \"zeitlupe\" machen aus einer Szene mit Zug die Show (siehe HÖHEPUNKT), die mindestens 2.6 Sekunden braucht, mit \"hitstop\" 4. Gib einem Opfer, das nur ein einzelner Schlag sein soll, deshalb keine dieser Bewertungen.\n4. NACHSPIEL (1 bis 3 schnelle Szenen mit \"dauer\": 1.3): dieselbe Stellung ohne neuen Zug (bei \"pgn\": Szene ohne zugNr), \"kameras\": [\"nah\", \"tief\", \"oben\"] (ein Winkel etwa alle 0,4 Sekunden), Effekt \"whip\" für den Schwenk und Pfeile auf die Folgen. Danach bei Bedarf wieder AUFBAU und AUFPRALL für einen zweiten Schlag. Zwischen Opfer und Matt liegen höchstens 4 bis 5 Sekunden: eine erzwungene Schlagfolge (Schlagen, Schach, Zurückschlagen) fasst du in EINE Szene mit mehreren Zügen zusammen (\"zugNr\": \"a-b\", \"dauer\": 2), statt jeden Zug einzeln zu zeigen.\n5. HÖHEPUNKT (der stärkste Moment, meist der Mattzug oder das größte Opfer, kurz vor dem Abspann): Züge mit \"bewertung\" brillant, grossartig oder bester und Züge mit \"zeitlupe\" spielt das Studio als Show (Ranzoomen, Zeitlupe, die Figur dreht sich einmal, harter Aufprall, wieder raus). Der Mattzug bekommt \"effekte\": [\"matt\", \"zeitlupe\"] (die Figuren des Mattgesetzten zerbrechen). Dauer 4 mit Hitstop (ohne Hitstop und Zeitlupe reichen 2.6). Zeitlupe nur 1- bis 2-mal im ganzen Video.\n6. ABSPANN (nur 1,3 Sekunden, ein Overlay über dem zersplitterten Brett, danach beginnt das Video von vorn): \"karte\": \"abspann\" mit kurzem \"titel\" (Aufforderung zum Folgen). Entfällt, wenn unter MEIN VIDEO ein Schluss ohne Aufruf gewünscht ist: dann endet das Video auf dem Höhepunkt.\n\nTAKT UND LÄNGEN\n- 90 BPM: ein Schlag dauert 0,67 Sekunden. Das Studio rundet jede Szene AUF ganze Schläge auf. Schreib deshalb \"dauer\" knapp unter das Vielfache: 0.6 (1 Schlag), 1.3 (2 Schläge), 2 (3 Schläge), 2.6 (4 Schläge), 4 (6 Schläge). Werte wie 1.4 oder 2.2 werden eine ganze Schlaglänge länger. Ein Mindestmaß gilt trotzdem: Eine Szene MIT Zug ist mindestens 1.3 lang (0.6 gibt es nur ohne Zug, sonst wird sie 1.3), mit 3 Kameras mindestens 1.3, mit Kameras und \"hitstop\" 2, mit Show (brillant, grossartig, bester, zeitlupe) oder Matt 2.6, mit Matt, Zeitlupe und \"hitstop\" 4.\n- Ruhige Szenen 1.3 bis 2 Sekunden, schnelle Schnitt-Szenen 1.3, Aufprall 1.3 bis 2, Höhepunkt mit Mattzug und Zeitlupe 4 (so viel Zeit braucht die Show mindestens, sonst verlängert das Studio sie selbst), Abspann 1.3 (bewusst kurz).\n- Gesamtlänge: Die Ziellänge unter MEIN VIDEO ist die Obergrenze, kein Ziel. Bis 30 Sekunden Ziel: lieber kurz und dicht, am besten 15 bis 18 Sekunden in 6 bis 12 Szenen. Bei längerem Ziel (45 bis 90 Sekunden) wiederholst du AUFBAU, AUFPRALL und NACHSPIEL für weitere Schläge (jeder Zyklus 6 bis 9 Sekunden, die Schläge steigern sich, der stärkste kommt zuletzt), statt Szenen zu strecken. \"laenge\" im JSON ist die Summe deiner \"dauer\"-Werte.\n- Pro Szene höchstens ein Zug. Der Zug beginnt sofort und dauert unter einer halben Sekunde, keine Pausen.\n\nSTÄRKEN (jeder Effekt hat eine Stärke von 0 bis 1, ohne Zahl ist es 1; normale Schläge schwach, nur der Höhepunkt voll)\n- Hook und Aufbau: \"punch\" 0.5, \"riser\" 1, sonst nichts.\n- Normaler Aufprall (Opfer, Patzer): \"hitstop\" 1, \"wackeln\" 0.4, \"glitch\" 0.6, bei Patzer oder brillantem Zug \"invert\" 1.\n- Nachspiel-Schnitte: \"whip\" 1, \"wackeln\" 0.2, sonst nichts.\n- Höhepunkt: \"matt\" 1, \"zeitlupe\" 1, \"hitstop\" 1, \"wackeln\" 1.\n- Als Objekt schreiben: \"effekte\": {\"hitstop\": 1, \"wackeln\": 0.4}. \"schraeglage\" (Kamera kippt, für Drohungen) und \"punch\" geben dem Bild zusätzlich Druck. Kein \"konfetti\", kein \"blitz\" im Edit.\n- Stempel nur an den 3 bis 4 stärksten Aufprallen, nie in den schnellen Schnitt-Szenen, höchstens 14 Zeichen. \"invert\" höchstens 2-mal im Video.\n\nPFEILE UND MARKIERUNGEN: Pfeile (dick, schwarz mit Leuchten) für Züge und Ideen, \"gefahr\" für Drohungen (rot, geschwungen). Markierungen: \"gefahr\" rot, \"gut\" grün, \"idee\" cyan, \"akzent\" blau. Ein Pfeil erscheint erst, wenn die Figur auf seinem Startfeld steht oder der gezeigte Zug gespielt ist: in einer Szene ohne neuen Zug zeichnest du nur Pfeile von Figuren, die dort schon stehen, und den Pfeil für den nächsten Zug erst in der Szene mit diesem Zug.");
const EDIT_LOOK = () => t("SCHNITT-STIL (optional, oben im JSON als \"schnittstil\")\n- \"nah\": der Look des Vorbild-Edits. Helles Brett, die Kamera klebt eng am Zug (etwa vier Felder breit) und bleibt gerade, die Felder leuchten in der Farbe der Bewertung (buch sandfarben, bester lindgrün, patzer lila, fehler orange, Drohung rot), eine Hand zieht die Figur, an den Treffern gibt es Drahtgitter-Blitze und Glasbruch. Dafür: jeder Zug in einer eigenen Szene mit \"dauer\": 1.3 und einer \"bewertung\" (buch für Eröffnungszüge, bester, grossartig, patzer, fehler), Pfeile nur für Drohungen, die erste Szene ohne Zug mit einem kurzen \"titel\" in der Pointe (dauer 2, z. B. EIN SPRINGEROPFER FÜR EIN LEICHTES MATT). Ein Eröffnungsname steht als \"titel\" in einer Szene ohne Zug.\n- \"klassisch\": das schräge graue Brett mit Überblick (Standard, wenn du nichts schreibst).");
const EDIT_FORMAT = () => t("AUSGABEFORMAT (der Import liest genau dieses JSON)\n- Antworte NUR mit einem JSON-Codeblock, ohne Text davor oder danach und ohne Kommentare im JSON.\n- Oben im JSON: \"videoart\": \"edit\", \"titel\" (nur intern, höchstens {title} Zeichen), \"plattform\" ({list}), \"laenge\" (Sekunden, die Summe aller \"dauer\"-Werte), \"perspektive\" (weiss oder schwarz, die Seite, um die es geht), \"pgn\" (die ganze Partie einmal, Zugliste, Kopfzeilen erlaubt), danach \"szenen\".\n- Jede Szene ist ein Objekt mit diesen Feldern (alle optional): zugNr, dauer, effekte, intensitaet, stempel, kameras, pfeile (z. B. \"f3-e5 gefahr\"), markierungen (z. B. \"e5 gut\"), bewertung, karte (nur \"abspann\"), titel (nur im Abspann und, wenn ein Hook als Frage oder Behauptung gewünscht ist, in der Hook-Szene).\n- Züge schreibst du nie in die Szenen, nur \"zugNr\": Halbzüge ab 1, 1 ist 1. e4, 2 ist 1... e5, 3 ist 2. Sf3, 14 ist 7... (Zug von Schwarz). \"zugNr\": 14 zeigt diesen Zug, \"zugNr\": \"14-16\" drei Züge hintereinander. Eine Szene ohne zugNr zeigt dieselbe Stellung noch einmal, z. B. aus einem neuen Winkel. Springt zugNr nach vorn oder zurück, blendet das Studio zur Stellung vor diesem Zug über. So stimmen die Züge garantiert und du konzentrierst dich auf Schnitt, Pfeile und Drama.\n- Für ein Rätsel ohne ganze Partie: oben \"startstellung\" (FEN) statt \"pgn\", und in den Szenen \"zug\" (z. B. \"1. Dh5\").\n- Bewertungen (\"bewertung\"): brillant, grossartig, bester, exzellent, gut, buch, ungenau, fehler, verpasst, patzer.");
const EDIT_CHECK = () => t("PRÜF VOR DEM ANTWORTEN\n- Gibt es einen Hook in den ersten 2 Sekunden und genau einen Höhepunkt gegen Ende?\n- Wechseln sich Ruhe, Stillstand und schnelle Schnitte ab? Sind die Stärken gestaffelt (normal schwach, Höhepunkt voll)?\n- Alle \"dauer\"-Werte sind 0.6, 1.3, 2, 2.6 oder 4. Jede Szene mit Zug hat mindestens 1.3, jede mit Show (brillant, grossartig, bester, zeitlupe) oder Matt mindestens 2.6, mit Hitstop und Matt oder Zeitlupe 4. Die Summe liegt unter der Ziellänge (bis 30 Sekunden meist 15 bis 25) und steht als \"laenge\" oben.\n- Alle Züge sind legal und in der richtigen Reihenfolge, \"zugNr\" passt zur \"pgn\" (Halbzüge ab 1, die richtige Seite am Zug).\n- Kein \"untertitel\", kein \"sprechtext\", keine Umfrage, keine Musik im JSON. Stempel höchstens 14 Zeichen, nur an den 3 bis 4 stärksten Aufprallen.\n- Nur der JSON-Codeblock als Antwort.");
const ART_AUTO = () => t("VORAB: WAS FÜR EIN VIDEO IST DAS?\nEntscheide zuerst, welche Art Video zu Thema und Wunsch passt, und schreib sie als \"videoart\" ganz oben ins JSON:\n- \"erklaerung\": ruhiges Erklärvideo mit Untertiteln und Sprechtext (Eröffnung oder Plan erklären, etwas lernen).\n- \"edit\": schneller Edit im TikTok-/Reel-Stil mit Beat-Musik, Hitstop, Glitches, Kamera-Schnitten und kaum Text (Matt-Rätsel, Falle, Opfer, Highlight, \"Siehst du das Matt?\").\nWenn Thema oder Wunsch nach kurz, knackig, viral, Edit, Reel, Shorts oder TikTok klingen, nimm \"edit\", sonst \"erklaerung\".\nBei \"edit\" gilt NUR der Block \"DEIN AUFTRAG: DU BIST DER EDITOR\" bis \"EDIT-REGELN\" direkt unten. Alles weiter unten zu Untertiteln, Sprechtext, Umfragen, Fragen, Design und Lucena ignorierst du dann.\n\n") + EDIT_INTRO() + "\n\n" + EDIT_RULES() + "\n\n" + EDIT_LOOK() + "\n\n";

// ---------- scenario briefs and the answers of the questions step ----------

const EDIT_EFFECTS = () => t("EFFEKTE IM EDIT (\"effekte\", als Liste oder als Objekt mit Stärke 0 bis 1)\n- matt: Der König kippt um, die Figuren des Mattgesetzten zerbrechen, großer Schriftzug SCHACHMATT. Nur in der Szene mit dem Mattzug.\n- hitstop: Das ganze Bild friert 0,25 Sekunden ein, genau im Moment des Aufpralls (Figur landet, Opfer, Patzer).\n- wackeln: Die Kamera bebt, wenn die Figur aufsetzt.\n- zeitlupe: Der letzte Zug der Szene läuft langsam. Für den Schlüsselzug, höchstens 1- bis 2-mal.\n- invert: Die Farben kehren sich kurz um. Für einen Patzer oder einen brillanten Zug, höchstens 2-mal.\n- glitch: Kurze RGB-Verschiebung an den Rändern beim Aufprall.\n- schraeglage: Die Kamera kippt schräg. Für Drohungen.\n- punch: schneller Punch-In am Anfang der Szene.\n- riser: immer schnelleres Heranzoomen bis zum Aufprall. Für den Spannungsaufbau.\n- whip: schneller Schwenk mit Bewegungsunschärfe zum nächsten Winkel.\n- drohung: Die bedrohten Felder pulsieren rot.\n- spotlight: Alles außer dem Zielfeld des Zugs wird dunkel.\nStempel (\"stempel\"): ein Wort, riesig über dem Brett, 0,4 Sekunden lang im Moment des Aufpralls, z. B. \"BLUNDER\", \"SACRIFICE\", \"??\", \"MATT\" (höchstens 14 Zeichen). Sparsam einsetzen.\nBewertung des Zugs (\"bewertung\"): brillant, grossartig, bester, exzellent, gut, buch, ungenau, fehler, verpasst, patzer.");
const EDIT_CAMERA = () => t("KAMERA IM EDIT\nDas Studio fährt die Kamera selbst: weich von Szene zu Szene, und es rahmt jede Szene passend zu Zug, Pfeil und Markierung. Schreib deshalb NIE \"kamera\", \"zoom\", \"drehung\" oder \"fokus\" in eine Szene und nimm den Effekt \"zoom\" nicht. Die einzige Kamerasteuerung von dir ist \"kameras\" (Winkel, die im Takt durchschalten) und die Effekte punch, riser, schraeglage und whip.\nWinkel für \"kameras\": oben (das ganze Brett), seitlich, schraeg, nah (näher dran), tief (dramatisch, von unten). Nutze höchstens 3 Winkel pro Szene.");
const SCENARIO_EXPLAIN = () => t("SZENARIO: KURZES ERKLÄRVIDEO (TikTok, Reels, Shorts)\n- EINE Idee pro Video (eine Falle, ein Plan, ein Prinzip), nicht mehr.\n- Aufbau: Hook in 2 Sekunden (Frage, Behauptung oder Ergebnis), dann 3 bis 5 Schritte mit je einem Zug und einem Satz Erklärung (4 bis 8 Sekunden pro Szene), dann die Pointe oder Auflösung, dann ein kurzer Abspann.\n- Kein Fachchinesisch: nenn Figur und Feld beim Namen, erkläre das Warum in einem Satz.\n- Pfeile für Drohungen und Pläne, Markierungen für wichtige Felder, Effekte nur an den ein, zwei Schlüsselmomenten.\n- Die ersten 2 Sekunden entscheiden: keine lange Einleitung und kein langes Titelbild, sondern sofort ein Bild und ein Satz, der neugierig macht.");
const SCENARIO_OPENING = () => t("SZENARIO: ERÖFFNUNG VORSTELLEN\n- Aufbau: Hook mit dem Namen und dem Versprechen (\"Das ist die Eröffnung, mit der du in 10 Zügen gut dastehst\"), dann die Hauptzüge Zug für Zug mit der IDEE hinter jedem Zug (Zentrum, Entwicklung, Rochade, Druck auf einen Punkt), dann 2 bis 3 typische Pläne für beide Seiten (mit Pfeilen), dann EINE bekannte Falle oder einen häufigen Fehler (als Variante mit \"variante\": { \"zurueck\": n }), am Ende eine Zusammenfassung mit den 3 wichtigsten Merksätzen.\n- Zeig nur Theoriezüge, die du sicher kennst. Wenn du dir bei einer Variante nicht sicher bist, lass sie weg, statt zu raten. Keine erfundenen Namen, Zahlen oder Statistiken (kein \"meistgespielt\" oder \"80 Prozent\").\n- Setz \"perspektive\" auf die Seite, für die die Eröffnung gedacht ist (Eröffnung für Schwarz: \"schwarz\").\n- Gib die Hauptlinie oben einmal als \"pgn\" an und nutze in den Szenen \"zugNr\".\n- Nenn den Namen der Eröffnung und der Variante im Titel der ersten Szene und in den Kapitel-Zeilen (\"kleineZeile\").");
const SCENARIO_PUZZLE = () => t("SZENARIO: RÄTSEL / TAKTIK\n- Genau ein Rätsel mit eindeutiger Lösung (Matt in 2, Gabel, Fesselung, Opfer). Prüfe die Lösung Zug für Zug, bevor du sie schreibst: jeder Zug legal, ein Matt muss wirklich Matt sein.\n- Die Stellung kommt als \"startstellung\" (FEN) oder als \"pgn\" mit \"zugNr\" vor dem Schlüsselzug.\n- Aufbau: Hook mit der Frage (\"Weiß zieht und gewinnt. Findest du es?\"), dann eine Szene mit \"karte\": \"frage\" und Countdown von 3 bis 5 Sekunden zum Mitdenken, danach die Auflösung: der Schlüsselzug mit \"bewertung\": \"brillant\", Pfeile auf die Idee, ein Satz zum Warum, dann die Folgezüge bis zum Ergebnis, dann der Abspann.\n- Falsche Alternativen darfst du als Variante zeigen (\"variante\": { \"zurueck\": n }), aber nur kurz.\n- Verrate die Lösung nicht vor der Auflösung: kein Pfeil auf den Schlüsselzug in den Szenen davor.");
const SCENARIO_LESSON = () => t("SZENARIO: YOUTUBE-LEKTION\nDas ist eine längere, ruhige Lektion. Halte dich besonders an die Lernvideo-Regeln unten: Kapitel mit gleichbleibender \"kleineZeile\", Erklärung in ganzen Sätzen rechts neben dem Brett, nach jedem Kapitel ein Merksatz, am Ende die Zusammenfassung.");

const LEVEL_TEXT = (l: Level) => l === "beginner" ? t("Anfänger (keine Notation voraussetzen, alles beim Namen nennen, Begriffe beim ersten Mal erklären)") : l === "club" ? t("Vereinsspieler (Grundlagen sind bekannt, Ideen und Pläne zählen)") : t("Fortgeschrittene (Theorie, Varianten und Feinheiten dürfen vorkommen)");
const HOOK_TEXT = (h: Exclude<Hook, "auto">) => h === "question" ? t("eine Frage an den Zuschauer (z. B. \"Siehst du das Matt?\")") : h === "bold" ? t("eine mutige Behauptung oder ein Fehler, den fast jeder macht") : t("das Ergebnis zuerst: die Pointe in den ersten Sekunden zeigen, danach erklären");
const ENDING_TEXT = (e: Exclude<Ending, "auto">) => e === "follow" ? t("Aufforderung zu folgen") : e === "question" ? t("eine Frage an die Zuschauer, die zu Kommentaren einlädt") : e === "part2" ? t("Teil 2 ankündigen") : t("kein Aufruf, das Video endet mit der Pointe");
const POINT_TEXT = (p: Exclude<Point, "auto">) => p === "mate" ? t("ein Mattzug") : p === "sacrifice" ? t("ein Opfer") : p === "blunder" ? t("ein Patzer") : t("ein Wendepunkt der Partie");
const PACE_TEXT = (p: Pace, edit: boolean) => (edit ? (p === "calm" ? t("etwas ruhiger: ruhige Szenen 2 bis 2.6 Sekunden, nur wenige schnelle Schnitte") : p === "fast" ? t("so schnell wie möglich: Szenen ohne Zug 0.6, Szenen mit Zug 1.3 Sekunden, viele schnelle Schnitte, kurzer Aufbau (eine Szene)") : t("normal: der Takt aus den Edit-Regeln")) : p === "calm" ? t("ruhig, mit Zeit zum Lesen und Nachdenken") : p === "fast" ? t("flott, kurze Szenen, kein Leerlauf") : t("normal"));
/** The audience of an edit is not taught anything: it decides how obvious the punchline has to be. */
const EDIT_LEVEL_TEXT = (l: Level) => l === "beginner" ? t("Anfänger (die Pointe muss ohne Schachwissen sofort klar sein: Pfeile und Stempel zeigen, was passiert, keine Notation im Bild)") : l === "club" ? t("Vereinsspieler (die Pointe darf eine Taktik sein, die man erst auf den zweiten Blick sieht)") : t("Fortgeschrittene (auch feine Taktiken und Stellungen mit mehreren Ideen, die Pointe darf tief liegen)");
/** An edit has no captions: a hook question or claim is one short "titel" in the hook scene, the ending is the outro card. */
const EDIT_HOOK_TEXT = (h: Exclude<Hook, "auto">) => h === "question" ? t("eine Frage an den Zuschauer als kurzer \"titel\" in der Hook-Szene (z. B. \"Siehst du das Matt?\"), das Brett steht schon in der kritischen Stellung") : h === "bold" ? t("eine mutige Behauptung als kurzer \"titel\" in der Hook-Szene (z. B. \"Das gewinnt in 3 Zügen\"), das Brett steht schon in der kritischen Stellung") : t("das Ergebnis zuerst: die Hook-Szene zeigt schon die Pointe (Stellung vor dem Matt oder dem Patzer, ein Stempel), danach springt \"zugNr\" zurück und der Edit baut die Pointe auf");
const EDIT_ENDING_TEXT = (e: Exclude<Ending, "auto">) => e === "follow" ? t("Aufforderung zu folgen als \"titel\" der Abspann-Szene") : e === "question" ? t("eine Frage an die Zuschauer als \"titel\" der Abspann-Szene (höchstens 30 Zeichen), die zu Kommentaren einlädt") : e === "part2" ? t("Teil 2 ankündigen als \"titel\" der Abspann-Szene") : t("kein Abspann: lass die Szene \"abspann\" weg, das Video endet auf dem Höhepunkt (letzte Szene ist der Mattzug oder Aufprall, \"dauer\" 4)");
const EDIT_MUSIC_HINT = (m: StyleId) => ({
  chill: t("warmer, ruhiger Lo-fi-Beat: ruhige Szenen eher 2 bis 2.6 Sekunden, Aufpralle weich (hitstop, wackeln höchstens 0.5, kein glitch), der Höhepunkt ohne harten Schlag"),
  ambient: t("Flächen ohne Schlagzeug: ruhiger, langer Aufbau, höchstens zwei Aufpralle, kein invert und kein glitch, Stempel nur beim Höhepunkt"),
  phonk: t("dunkler 808-Bass mit harten Drops: setz Aufpralle (hitstop, invert) genau auf den Beat, viele schnelle Schnitte"),
  epic: t("Pauken und Streicher: langer Spannungsaufbau mit riser, wenige Schläge dazwischen und ein gewaltiger Höhepunkt (matt voll)"),
  thriller: t("treibender Puls und Spannung: viele Drohungen (schraeglage, drohung, Pfeile auf die Gefahr), der Aufprall kommt spät und trifft hart"),
})[m];
const LANG_TEXT = (l: "de" | "en") => (l === "en" ? t("Englisch") : t("Deutsch"));

/** The answers of the questions step as lines for "MEIN VIDEO"; nothing when nothing was answered. */
function answerLines(a: PromptAnswers | undefined, edit: boolean): string {
  if (!a) return "";
  const lines: string[] = [];
  const game = (a.game ?? "").trim().slice(0, 4000);
  if (game) lines.push(edit ? t("- Der Edit handelt von dieser Partie oder Stellung (PGN oder FEN). Schreib die Züge unverändert in \"pgn\" (bei einer FEN in \"startstellung\") und erfinde keine dazu. Such darin den spannendsten Moment (Opfer, Patzer, Matt) als Pointe und schneide um ihn herum, zeig nicht die ganze Partie:\n{x}", { x: game }) : t("- Das Video handelt von dieser Partie oder Stellung (PGN oder FEN). Nimm genau diese Züge und erfinde keine dazu:\n{x}", { x: game }));
  if (a.level) lines.push(t("- Zielgruppe: {x}", { x: (edit ? EDIT_LEVEL_TEXT : LEVEL_TEXT)(a.level) }));
  if (a.pace) lines.push(t("- Tempo: {x}", { x: PACE_TEXT(a.pace, edit) }));
  if (a.hook && a.hook !== "auto") lines.push(t("- Hook: {x}", { x: (edit ? EDIT_HOOK_TEXT : HOOK_TEXT)(a.hook) }));
  if (edit && a.point && a.point !== "auto") lines.push(t("- Die Pointe des Edits ist {x}.", { x: POINT_TEXT(a.point) }));
  if (a.ending && a.ending !== "auto") lines.push(t("- Schluss: {x}", { x: (edit ? EDIT_ENDING_TEXT : ENDING_TEXT)(a.ending) }));
  if (a.music && a.music !== "auto") lines.push(edit ? t("- Musikstil: {x}. Der Takt bleibt 90 BPM, der Stil ändert Klang und Stimmung (das Studio erzeugt die Musik, schreib sie nicht ins JSON): {hint}", { x: STYLE_LABEL[a.music], hint: EDIT_MUSIC_HINT(a.music) }) : t("- Musikstil: {x} (das Studio erzeugt die Musik, schreib sie nicht ins JSON, aber richte Tempo und Stimmung der Szenen danach aus)", { x: STYLE_LABEL[a.music] }));
  if (a.language) lines.push(edit ? t("- Sprache der Texte im Video (Hook-Titel, Stempel, Abspann): {x}. Die Feldnamen im JSON bleiben wie im Format unten.", { x: LANG_TEXT(a.language) }) : t("- Sprache der Texte im Video (Titel, Stempel, Abspann, Untertitel, Sprechtext): {x}. Die Feldnamen im JSON bleiben wie im Format unten.", { x: LANG_TEXT(a.language) }));
  if (!edit && a.voice !== undefined) lines.push(a.voice ? t("- Schreib zu jeder Szene einen Sprechtext.") : t("- Kein Sprechtext, nur Untertitel."));
  if (!edit && a.poll !== undefined) lines.push(a.poll ? t("- Ende das Video mit einer Umfrage.") : t("- Keine Umfrage."));
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** The brief of a scenario that is an explainer with its own focus. */
function scenarioBrief(sc: Scenario | undefined): string {
  return sc === "explain" ? SCENARIO_EXPLAIN() : sc === "opening" ? SCENARIO_OPENING() : sc === "puzzle" ? SCENARIO_PUZZLE() : sc === "lesson" ? SCENARIO_LESSON() : "";
}

function EDIT_EXAMPLE(platform: Platform) {
  // The whole game once on top; the scenes only name half-moves. Hook in the critical position, build-up, impact with hit-stop, quick cuts on the same position, a last build-up, mate as the climax, outro (about 19 s, like the length the prompt asks for).
  return {
    videoart: "edit",
    titel: t("Siehst du das Matt?"),
    plattform: platform,
    laenge: 16.3,
    perspektive: "weiss",
    pgn: "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#",
    szenen: [
      { zugNr: 5, dauer: 1.3, effekte: { punch: 0.5 }, pfeile: ["h5-f7 akzent"], markierungen: ["f7 gefahr"] }, // hook: starts in the critical position; i18n: format words
      { dauer: 2, effekte: { schraeglage: 0.5 }, markierungen: ["f7 gefahr", "e8 idee"] }, // second build-up scene: the camera tilts; i18n: format words
      { dauer: 2, effekte: ["riser"], pfeile: ["h5-f7 akzent"], markierungen: ["f7 gefahr"] }, // build-up; i18n: format words
      { zugNr: 6, dauer: 1.3, bewertung: "patzer", stempel: "BLUNDER", effekte: { hitstop: 1, invert: 1, glitch: 0.6, wackeln: 0.4 } },
      { dauer: 1.3, kameras: ["nah", "tief", "oben"], effekte: { whip: 1, wackeln: 0.2 }, pfeile: ["h5-f7 gefahr"] }, // i18n: format words
      { dauer: 1.3, kameras: ["seitlich", "nah"], effekte: ["whip"], markierungen: ["e8 gefahr"] }, // second cut scene on the same position; i18n: format words
      { dauer: 2, effekte: ["riser"], pfeile: ["h5-f7 akzent"] }, // build-up for the climax; i18n: format words
      { zugNr: 7, dauer: 4, bewertung: "brillant", stempel: "MATT", effekte: { matt: 1, zeitlupe: 1, hitstop: 1, wackeln: 1 } },
      { karte: "abspann", titel: t("Mehr Taktik aus deinen Partien"), dauer: 1.3 },
    ],
  };
}

function LONG_EXAMPLE(platform: Platform) {
  return {
    titel: t("Die Italienische Partie verstehen"),
    plattform: platform,
    laenge: 240,
    perspektive: "weiss",
    look: "walnuss",
    umgebung: "bibliothek",
    design: { figuren: "holz", schrift: "elegant", musik: "lofi", untertitelStil: "kasten" },
    geschwindigkeit: 0.9,
    szenen: [
      { karte: "titel", titel: t("Italienisch verstehen"), untertitel: t("Die Ideen hinter den ersten Zügen"), sprechtext: t("In diesem Video schauen wir uns an, warum die Italienische Partie seit Jahrhunderten gespielt wird und welche Pläne dahinterstecken."), dauer: 8 },
      { kleineZeile: t("Kapitel 1: Das Zentrum"), zug: "1. e4", titel: t("Der erste Zug"), untertitel: t("Weiß besetzt mit *e4* das Zentrum und öffnet gleichzeitig Wege für die *Dame* und den *Läufer*. Genau diese beiden Figuren spielen gleich eine große Rolle."), sprechtext: t("Der Bauer auf e4 kontrolliert d5 und f5 und gibt der Dame und dem Läufer auf f1 freie Bahn."), markierungen: ["d5 akzent", "f5 akzent"], kamera: "normal", dauer: 14 }, // i18n: format words
      { kleineZeile: t("Kapitel 1: Das Zentrum"), zug: t("1... e5 2. Sf3"), titel: t("Angriff auf e5"), untertitel: t("Schwarz hält mit *e5* dagegen. Der Springer auf f3 greift den Bauern sofort an und entwickelt sich dabei zur Mitte."), pfeile: ["f3-e5 gefahr"], kamera: "normal", dauer: 14 },
      { kleineZeile: t("Kapitel 2: Der Läufer"), zug: t("2... Sc6 3. Lc4"), titel: t("Ziel: f7"), untertitel: t("Der Läufer zielt auf *f7*, den schwächsten Punkt von Schwarz, weil ihn nur der König deckt."), pfeile: ["c4-f7 gefahr"], effekte: ["spotlight"], kamera: "oben", dauer: 16 },
      { karte: "abspann", titel: t("Danke fürs Zuschauen"), untertitel: t("Im nächsten Teil: das Giuoco Piano"), dauer: 6 },
    ],
  };
}


// ---------- the format in the studio's language ----------
// The prompt, its example and the "revise with AI" export use German field
// names on a German page and English ones on an English page; the reader
// above accepts both.

const KEY_EN: Record<string, string> = {
  titel: "title", untertitel: "subtitle", sprechtext: "voiceover", kleineZeile: "label", dauer: "duration", kamera: "camera",
  drehung: "rotation", fokus: "focus", pfeile: "arrows", markierungen: "highlights", effekte: "effects", bewertung: "rating",
  zugtempo: "moveSpeed", stimmung: "mood", antworten: "answers", variante: "variation", zurueck: "back", hauptvariante: "mainLine",
  karte: "card", zug: "moves", szenen: "scenes", plattform: "platform", laenge: "length", perspektive: "perspective",
  geschwindigkeit: "speed", umgebung: "environment", ansicht: "view", figuren: "pieces", untertitelStil: "subtitleStyle",
  schrift: "font", akzent: "accent", textgroesse: "textSize", musik: "music", figurenRand: "pieceRim", startstellung: "startPosition",
  einstellungen: "settings", effektTon: "effectSound", zuganzeige: "moveDisplay", zugInWorten: "moveInWords",
  zuegeAusschreiben: "spellMoves", felderLeuchten: "glowSquares", fortschritt: "progress", koordinaten: "coordinates",
  kameraflug: "cameraFlight", spiegelung: "reflection", videoart: "videoType", schnittstil: "cutStyle",
  zugNr: "moveNo", kameras: "cameras", stempel: "stamp", intensitaet: "intensity",
};
// i18n: format words, not texts
const VALUE_EN: Record<string, Record<string, string>> = {
  videoart: { erklaerung: "explainer" },
  schnittstil: { nah: "close", klassisch: "classic" },
  perspektive: { weiss: "white", schwarz: "black" },
  look: { marmor: "marble", holz: "wood", walnuss: "walnut", turnier: "tournament" },
  umgebung: { schwebend: "floating", buehne: "stage", holztisch: "woodtable", turniersaal: "hall", bibliothek: "library" },
  ansicht: { aufsteller: "standees" },
  figuren: { lack: "gloss", matt: "matte", chrom: "chrome", holz: "wood" },
  untertitelStil: { kasten: "box", kontur: "outline", gross: "big" },
  musik: { keine: "none", spannung: "tension", episch: "epic", beat: "beat" },
  karte: { titel: "title", frage: "question", umfrage: "poll", abspann: "outro" },
  kamera: { schraeg: "angled", seitlich: "side", oben: "top", tief: "low", nah: "close", gegenueber: "opposite" },
  kameras: { schraeg: "angled", seitlich: "side", oben: "top", tief: "low", nah: "close", gegenueber: "opposite" },
  effekte: { matt: "mate", drohung: "threat", wackeln: "shake", blitz: "flash", konfetti: "confetti", zeitlupe: "slowmo", schraeglage: "dutch" },
  bewertung: { brillant: "brilliant", grossartig: "great", bester: "best", exzellent: "excellent", gut: "good", buch: "book", ungenau: "inaccuracy", fehler: "mistake", verpasst: "miss", patzer: "blunder" },
  stimmung: { froehlich: "happy", nachdenklich: "thoughtful", begeistert: "excited", traurig: "sad" },
};
// i18n: format words, not texts
const TONE_EN: Record<string, string> = { gefahr: "danger", gut: "good", idee: "idea", akzent: "accent", weiss: "white" };

/** Renames a script written with German field names and words for the page's language. */
function inFormatLanguage(v: unknown, key = ""): unknown {
  if (lang() !== "en") return v;
  if (Array.isArray(v)) return v.map((x) => inFormatLanguage(x, key));
  if (v && typeof v === "object") {
    // Effects with strengths are an object: its keys are effect words.
    const words = key === "effekte" ? VALUE_EN.effekte : null;
    return Object.fromEntries(Object.entries(v as Obj).map(([k, x]) => [words?.[k] ?? KEY_EN[k] ?? k, inFormatLanguage(x, k)]));
  }
  if (typeof v !== "string") return v;
  if (key === "pfeile" || key === "markierungen") return v.replace(/(\S+)$/, (w) => TONE_EN[w] ?? w);
  return VALUE_EN[key]?.[v] ?? v;
}

export function buildAiPrompt(o: PromptOptions): string {
  const long = o.platform === "youtube";
  const type = o.scenario ? scenarioArt(o.scenario) : (o.type ?? "auto");
  const example = type === "edit" ? EDIT_EXAMPLE(o.platform) : long ? LONG_EXAMPLE(o.platform) : {
    titel: t("Matt in 4 Zügen"),
    plattform: o.platform,
    laenge: 25,
    perspektive: "weiss",
    look: "nova",
    umgebung: "buehne",
    design: { figuren: "lack", untertitelStil: "kontur", schrift: "modern", musik: "spannung", textgroesse: 1 },
    szenen: [
      { karte: "titel", titel: t("Fällst du darauf rein?"), untertitel: t("Matt in *4 Zügen*"), sprechtext: t("Auf diese Falle fallen viele Anfänger herein."), kamera: "normal", dauer: 2.5 },
      { zug: "1. e4 e5", titel: t("Ganz normal"), untertitel: t("Beide Bauern gehen ins *Zentrum*."), kamera: "normal", markierungen: ["e4 akzent", "e5 akzent"], dauer: 2.5 }, // i18n: format words
      { zug: t("2. Lc4"), titel: t("Ziel: f7"), untertitel: t("Der Läufer zielt auf *f7*."), sprechtext: t("Der Läufer schaut schon auf f7."), kamera: "schraeg", fokus: true, pfeile: ["c4-f7 gefahr"], effekte: ["drohung"], dauer: 2.5 },
      { zug: t("2... Sc6 3. Dh5"), titel: t("Die Dame kommt"), untertitel: t("Zwei Angreifer auf *f7*."), kamera: "nah", pfeile: ["h5-f7 gefahr", "c4-f7 gefahr"], effekte: ["zoom"], dauer: 3 },
      { karte: "umfrage", titel: t("Was spielt Schwarz?"), antworten: [t("A) Sf6"), "B) g6", t("C) De7")], countdown: 3 },
      { zug: t("3... Sf6"), titel: t("Der Fehler"), kamera: "seitlich", bewertung: "patzer", stimmung: "traurig", dauer: 2 },
      { zug: t("4. Dxf7#"), titel: t("Schachmatt!"), kamera: "tief", effekte: ["matt", "wackeln"], zugtempo: 0.7 },
      { variante: { zurueck: 2 }, kleineZeile: t("Besser"), zug: "3... g6", titel: t("So verteidigst du"), untertitel: t("*g6* vertreibt die Dame."), pfeile: ["g6-h5 gut"], bewertung: "bester", kamera: "schraeg", effekte: ["spotlight"] },
      { karte: "abspann", titel: t("Folge für mehr Fallen"), untertitel: t("Teil 2 kommt morgen"), effekte: ["konfetti"] },
    ],
  };
  const side = o.side === "black" ? t("- Perspektive: schwarz (setz \"perspektive\": \"schwarz\")\n") : o.side === "white" ? t("- Perspektive: weiss (setz \"perspektive\": \"weiss\")\n") : "";
  const len = o.length >= 120 ? t("{0} Minuten ({length} Sekunden)", { 0: Math.round(o.length / 60), length: o.length }) : t("{length} Sekunden", { length: o.length });
  const myVideo = MY_VIDEO().replace("{topic}", () => o.topic.trim() || t("(such dir ein spannendes Thema aus)")).replace("{side}", () => side).replace("{platform}", () => PLATFORM_LABEL[o.platform]).replace("{orient}", () => (long ? t("Querformat") : t("Hochformat"))).replace("{len}", () => len).replace("{notes}", () => (o.notes.trim() ? t("- Das ist mir wichtig:\n{0}\n", { 0: o.notes.trim().split("\n").map((l) => `  ${l.trim()}`).join("\n") }) : ""));
  const exampleBlock = EXAMPLE_WRAP().replace("{example}", () => JSON.stringify(inFormatLanguage(example), null, 2));
  const limits = { title: FIT.title, list: list(PLATFORMS) };
  // An edit gets its own prompt: the explainer sections (captions, voice-over, polls, design) would pull the AI away from the edit.
  if (type === "edit") {
    return [EDIT_INTRO(), (myVideo + answerLines(o.answers, true)).trimEnd(), EDIT_RULES(), EDIT_LOOK(), EDIT_EFFECTS() + "\n\n" + EDIT_CAMERA(), CHESS_HEAD(), sub(EDIT_FORMAT(), limits), EDIT_CHECK(), exampleBlock].join("\n\n");
  }
  const prefix = type === "explain" ? ART_EXPLAIN() : ART_AUTO();
  const rules = long ? LONG_RULES() : t("SO WIRD ES FÜR ZUSCHAUER VERSTÄNDLICH\n1. Die erste Szene ist ein starker Hook, der in 2 Sekunden neugierig macht. Keine erfundenen Zahlen oder Statistiken.\n2. Viele Zuschauer können keine Notation lesen. Erkläre jeden wichtigen Zug in Worten (\"Der Springer greift e5 an\") und nenne dabei das Feld. Schreib Figuren aus (\"Springer nach f3\" statt \"Sf3\"). Felder, die im Untertitel stehen, leuchten auf dem Brett auf.\n3. Höchstens eine neue Idee pro Szene. Der Zuschauer muss gleichzeitig die Züge verfolgen: Untertitel höchstens {SHORT_CHUNK} Zeichen, ein kurzer Satz. Alles Weitere gehört in den Sprechtext, nicht ins Bild. Längere Untertitel teilt das Studio selbst in Häppchen. *Sternchen* um ein Wort färben es ein. Ein | teilt einen Untertitel in Teile, die nacheinander erscheinen.\n4. Zeig jede Drohung mit einem Pfeil: rot (gefahr) für Angriffe, grün (gut) für Verteidigung.\n5. Bleib bei EINER Sicht aufs Brett: \"perspektive\" ist die Seite, um die es geht (weiss oder schwarz, z. B. schwarz für Sizilianisch oder eine Falle für Schwarz). Die Kameras drehen sich automatisch mit. Nutze \"gegenueber\" nur ganz selten.\n6. Jede Szene kann einen Sprechtext haben: das, was ich dazu sage (natürlich gesprochen, etwa 2,5 Wörter pro Sekunde, passend zur Dauer). Er erscheint nicht im Bild.\n7. Für eigene Kamera, Text oder Pfeile pro Zug mach eine Szene pro Zug. Die Summe aller \"dauer\"-Werte soll ungefähr die Ziellänge ergeben.\n8. Ende mit einer Abspann-Szene, die zum Folgen, Kommentieren oder Speichern auffordert.\n\n", { SHORT_CHUNK });
  const layout = long ? LONG_LAYOUT() : t("SO SIEHT DAS VIDEO AUS ({0}, von oben nach unten)\n- Ganz oben: ein dünner Fortschrittsbalken und das Logo EndGameKing.\n- \"kleineZeile\": kleiner farbiger Streifen über dem Titel, höchstens {label} Zeichen (z. B. \"Variante 2\", \"Falle\", \"Teil 1\").\n- \"titel\": große, fette weiße Überschrift, höchstens 2 Zeilen, also etwa {title} Zeichen. Kurz und knackig, wie eine Schlagzeile.\n- Darunter die Zug-Anzeige (z. B. \"● 3. Lb5\") und der Zug in Worten (\"Weiß: Läufer nach b5\"), beides automatisch.\n- In der Mitte das Brett (3D-Show-Look, oder mit \"ansicht\": \"2d\" flach von oben).\n- \"untertitel\": unter dem Brett, höchstens 3 Zeilen, etwa {subtitle} Zeichen, daneben die KI-Kugel Lucena. *Sternchen*-Wörter werden in der Akzentfarbe gefärbt.\n- Ganz unten bleibt Platz frei, dort liegen die Knöpfe der App. Dahin kommt nie Text.\n- Karten: \"titel\" zeigt Überschrift und Untertitel groß vor dem Brett (für den Hook), \"frage\" und \"umfrage\" legen die Frage über das Brett, die Antwort-Knöpfe stehen in einer Reihe unter dem Brett (jede Antwort höchstens {option} Zeichen), \"abspann\" ist das große Schlussbild mit Logo.\n- Ein Titel oder Untertitel, der zu lang ist, wird kleiner geschrieben oder auf mehrere Bilder verteilt. Lieber zwei Szenen als eine überfüllte.\n\n", { 0: o.platform === "youtube" ? t("Querformat 16:9") : t("Hochformat 9:16"), label: FIT.label, title: FIT.title, subtitle: FIT.subtitle, option: FIT.option });
  return prefix + TASK_INTRO().replace("{kind}", () => (long ? t("ein ruhiges, lehrreiches YouTube-Video im Querformat") : t("ein kurzes Schach-Video"))) + myVideo + answerLines(o.answers, false) + (o.scenario === "explain" && long ? "" : scenarioBrief(o.scenario) ? scenarioBrief(o.scenario) + "\n" : "") + "\n" + rules + EFFECT_GLOSSARY() + "\n" + POLL_RULES() + "\n" + CAMERA_GLOSSARY() + "\n" + TEMPO_RULE() + "\n" + LUCENA_RULE() + "\n\n" + layout + DESIGN_BLOCK() + "\n\n" + CHESS_HEAD() + "\n" + CHESS_REST() + "\n\n" + sub(ALL_FIELDS(), limits) + "\n\n" + sub(EXPLAIN_CHECK(), { title: FIT.title, chunk: long ? FIT.lesson : SHORT_CHUNK }) + "\n\n" + exampleBlock;
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
  let tk = text.trim();
  const fence = tk.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) tk = fence[1];
  const a = tk.indexOf("{");
  const b = tk.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error(t("Kein JSON gefunden"));
  tk = tk.slice(a, b + 1);
  const attempts = [
    tk,
    tk.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"),
    // Curly quotes as JSON quotes break only when the AI used them instead of ".
    tk.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1").replace(/[“”„]/g, '"'),
  ];
  let last: unknown;
  for (const x of attempts) {
    try {
      return JSON.parse(x);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(t("JSON ist fehlerhaft"));
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
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "ja" || v === "yes" || v === "true" ? true : v === "nein" || v === "no" || v === "false" ? false : null);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : typeof v === "string" ? v.split(/[,;]/) : [v]);
const SQ = /^[a-h][1-8]$/;

function arrowOf(v: unknown): StudioArrow | null {
  let from = "";
  let to = "";
  let tone: unknown = "accent";
  if (typeof v === "string") {
    const m = v.toLowerCase().match(/([a-h][1-8])\s*(?:-|–|>|->|→|\s|nach|bis|to)?\s*([a-h][1-8])\s*(.*)$/);
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

/** "14" → 14..14, "14-16" or [14, 16] → 14..16, "7." → White's 7th move, "7..." → Black's 7th move (all as half-moves counted from 1). */
function plyRange(v: unknown): [number, number] | null {
  const nums: number[] = [];
  const take = (x: unknown) => {
    if (typeof x === "number") nums.push(Math.round(x));
    else if (typeof x === "string") {
      const str = x.trim();
      const mm = str.match(/^(\d+)\s*(\.{3}|…|\.)$/);
      if (mm) nums.push(mm[2] === "." ? Number(mm[1]) * 2 - 1 : Number(mm[1]) * 2);
      else for (const part of str.split(/\s*(?:-|–|—|bis|to|\.\.|,|;)\s*/)) if (/^\d+$/.test(part)) nums.push(Number(part));
    }
  };
  if (Array.isArray(v)) v.forEach(take);
  else take(v);
  return nums.length && nums.every((n) => Number.isFinite(n)) ? [Math.min(...nums), Math.max(...nums)] : null;
}

/** The whole game of a script: its moves and the position after every half-move (index 0 = before the first). PGN headers, comments, variations and NAGs are skipped. */
function readGame(pgn: string, start: string): { moves: Move[]; fens: string[]; error?: string } {
  let body = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, " ").replace(/;[^\n]*/g, " ").replace(/\$\d+/g, " ");
  for (let i = 0; i < 6; i++) body = body.replace(/\([^()]*\)/g, " ");
  const parsed = parseMoves(start, body);
  const fens = [start];
  const walk = new Chess(start);
  for (const m of parsed.moves) {
    walk.move(m.san);
    fens.push(walk.fen());
  }
  return { moves: parsed.moves, fens, error: parsed.error };
}

/** Which camera angle a word means; "weiss"/"schwarz" are sides: the video's own side is the normal view, the other one is "von gegenüber". */
function cameraOf(w: string, perspective: Side): CameraPreset | null {
  if (w === "weiss" || w === "white" || w === "weisssicht") return perspective === "white" ? "white" : "black";
  if (w === "schwarz" || w === "black" || w === "schwarzsicht") return perspective === "black" ? "white" : "black";
  return CAMERAS[w] ?? null;
}

/** Effect strengths: 0..1 like 0.3; a number between 10 and 100 is read as a percentage, anything from 1 to 10 as full power. */
const strength = (v: unknown): number => {
  const x = number(v);
  return x === null ? 1 : x > 1 ? (x <= 10 ? 1 : Math.min(1, x / 100)) : Math.max(0, x);
};

/**
 * The effects of a scene with their strengths. Accepted: a list ("effekte": ["wackeln"]), a list with strengths
 * ("wackeln:0.3", {"effekt": "wackeln", "staerke": 0.3}), an object ({"wackeln": 0.3}), and a number straight on the
 * scene ("wackeln": 0.3). "intensitaet" sets the strength of every effect of the scene that has none of its own.
 * A strength of 0 (or false) leaves the effect out, which also switches off the reel look's automatic ones.
 */
function readEffects(o: Obj, n: number, warnings: string[]): { effects: Effect[]; power: Partial<Record<Effect, number>>; given: boolean } {
  const raw = field(o, "effekte", "effects", "effekt");
  const entries: [unknown, unknown][] = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) entries.push(...Object.entries(raw));
  else {
    for (const e of asList(raw)) {
      if (e && typeof e === "object") {
        const eo = e as Obj;
        const name = field(eo, "effekt", "name", "art", "typ", "effect", "id");
        if (name !== undefined) entries.push([name, field(eo, "staerke", "intensitaet", "intensity", "power", "wert", "strength", "value", "level")]);
        else entries.push(...Object.entries(eo));
      } else if (typeof e === "string") {
        const m = e.match(/^\s*([^\d:=\s][^:=]*?)\s*[:=\s]\s*(\d*[.,]?\d+)\s*$/);
        entries.push(m ? [m[1], Number(m[2].replace(",", "."))] : [e, 1]);
      } else entries.push([e, 1]);
    }
  }
  // A strength straight on the scene ("wackeln": 0.3). "zoom" stays the camera's zoom there.
  for (const [k, v] of Object.entries(o)) if ((typeof v === "number" || typeof v === "boolean") && EFFECTS[word(k)] && word(k) !== "zoom") entries.push([k, v]);
  const given = raw !== undefined || entries.length > 0;
  const general = number(field(o, "intensitaet", "intensity", "staerke", "strength"));
  const effects: Effect[] = [];
  const power: Partial<Record<Effect, number>> = {};
  for (const [name, p] of entries) {
    const id = EFFECTS[word(name)];
    if (!id) {
      warnings.push(t("Szene {n}: Effekt „{1}“ gibt es nicht.", { n, 1: String(name).trim() }));
      continue;
    }
    const k = typeof p === "boolean" ? (p ? 1 : 0) : strength(p);
    if (k <= 0) power[id] = 0;
    else {
      effects.push(id);
      if (k < 1) power[id] = k;
    }
  }
  if (general !== null) for (const id of effects) if (power[id] === undefined && general < 1) power[id] = Math.max(0, strength(general));
  return { effects: [...new Set(effects)], power, given };
}

/** The words of the scenes' texts, for guessing the side: effect names such as "dutch" must not read as the Dutch Defence. */
function storyText(scenes: unknown[]): string {
  return scenes
    .map((x) => (x && typeof x === "object" ? ["titel", "title", "untertitel", "subtitle", "text", "sprechtext", "voiceover", "kleinezeile", "label"].map((k) => field(x as Obj, k)).filter((v) => typeof v === "string").join(" ") : ""))
    .join(" ")
    .slice(0, 4000);
}

export function importAiScript(input: string, defaults: ImportDefaults = {}): AiImport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = extractJson(input);
  } catch (e) {
    return { project: null, errors: [t("Die Antwort ist kein lesbares JSON ({0}). Bitte die KI, nur den JSON-Codeblock zu schicken.", { 0: e instanceof Error ? e.message : t("Fehler") })], warnings, stats: null };
  }
  const root = (Array.isArray(raw) ? { szenen: raw } : raw) as Obj;
  const rawScenes = asList(field(root, "szenen", "scenes", "szene", "scene"));
  if (!rawScenes.length) return { project: null, errors: [t("Im Skript stehen keine Szenen („szenen“).")], warnings, stats: null };

  let startFen = START_FEN;
  const sf = text(field(root, "startstellung", "startposition", "startfen", "fen", "stellung"), 120);
  if (sf) {
    if (validFen(sf)) startFen = sf;
    else warnings.push(t("Die Startstellung (FEN) ist ungültig, ich nehme die Grundstellung."));
  }
  // The whole game once on top ("pgn"); scenes then only name a half-move ("zugNr") instead of spelling out moves.
  const pgnText = text(field(root, "pgn", "partie", "game"), 12000);
  const pgnFen = pgnText.match(/\[FEN\s+"([^"]+)"\]/i)?.[1];
  if (pgnFen && !sf && validFen(pgnFen)) startFen = pgnFen;
  const game = pgnText ? readGame(pgnText, startFen) : null;
  if (game?.error) errors.push(t("Die Partie („pgn“) hat nach Halbzug {n} einen unmöglichen Zug: „{error}“. Nur die Züge davor werden benutzt.", { n: game.moves.length, error: game.error }));

  const perspWord = word(field(root, "perspektive", "perspective", "sicht", "seite"));
  const perspective: Side = perspWord ? (["schwarz", "black", "s", "b"].includes(perspWord) ? "black" : "white") : guessPerspective(`${text(field(root, "titel", "title"), 200)} ${pgnText.slice(0, 600)} ${storyText(rawScenes)}`);
  if (!perspWord && perspective === "black") warnings.push(t("Keine Perspektive angegeben. Das Video ist für Schwarz, darum zeige ich es aus Sicht von Schwarz."));

  const artWord = word(field(root, "videoart", "videotype", "art", "videokind", "kind"));
  if (artWord && !ARTS[artWord]) warnings.push(t("Videoart „{String}“ kenne ich nicht, ich nehme ein Erklärvideo.", { String: String(field(root, "videoart", "videotype", "art", "videokind", "kind")) }));
  const lookWord = word(field(root, "look", "theme", "stil"));
  // An edit is the fast black-and-white reel; so is a script that asks for the reel board without saying so.
  // What was asked for in the questions step wins over what the AI wrote (an AI that forgets "videoart" must not turn an edit into a slow explainer).
  const asked = defaults.art && defaults.art !== "auto" ? defaults.art : null;
  const edit = asked ? asked === "edit" : ARTS[artWord] === "edit" || (!artWord && (word(field((field(root, "design", "aussehen") ?? {}) as Obj, "ansicht", "brett", "view")) === "reel" || lookWord === "reel"));
  // The positions along the line being shown; variations cut it back, the main line is kept aside.
  let line: string[] = [startFen];
  let mainLine: string[] | null = null;
  let moveCount = 0;
  let variations = 0;
  const scenes: Scene[] = [];
  rawScenes.slice(0, 80).forEach((x, i) => {
    const n = i + 1;
    if (!x || typeof x !== "object") {
      warnings.push(t("Szene {n} ist leer und fehlt.", { n }));
      return;
    }
    const o = x as Obj;
    const here = line[line.length - 1];
    let jump = "";
    const fen = text(field(o, "fen", "stellung"), 120);
    const variant = field(o, "variante", "variation", "variant");
    const back = number(variant && typeof variant === "object" ? field(variant as Obj, "zurueck", "back", "halbzuege", "plies") : (field(o, "zurueck", "back") ?? (typeof variant === "number" ? variant : null)));
    const toMain = bool(field(o, "hauptvariante", "zurueckzurhauptvariante", "mainline", "backtomainline")) === true;
    if (fen) {
      if (validFen(fen)) {
        line = [fen];
        jump = fen;
      } else warnings.push(t("Szene {n}: Die FEN ist ungültig und wird ignoriert.", { n }));
    } else if (back !== null && back > 0) {
      if (!mainLine) mainLine = line.slice();
      const keep = Math.max(1, line.length - Math.round(back));
      if (line.length - Math.round(back) < 1) warnings.push(t("Szene {n}: So weit kann ich nicht zurück, ich starte bei der ersten Stellung.", { n }));
      line = line.slice(0, keep);
      jump = line[line.length - 1];
      variations += 1;
    } else if (toMain) {
      if (mainLine) {
        line = mainLine;
        mainLine = null;
        jump = line[line.length - 1];
      } else warnings.push(t("Szene {n}: „hauptvariante“ ohne vorherige Variante wird ignoriert.", { n }));
    }
    // With a game on top the scene names its half-moves ("zugNr": 14, "14-16"): the picture jumps to the position before them when the line is not there already.
    let pgnMoves: string | null = null;
    const plyRaw = field(o, "zugnr", "zugnummer", "halbzug", "ply", "moveno", "movenumber");
    if (plyRaw !== undefined && plyRaw !== null && plyRaw !== "") {
      const range = plyRange(plyRaw);
      if (!game) warnings.push(t("Szene {n}: zugNr gibt es nur mit einer ganzen Partie („pgn“) oben im Skript, ich ignoriere es.", { n }));
      else if (!range) warnings.push(t("Szene {n}: zugNr „{String}“ ist keine Zugnummer.", { n, String: String(plyRaw) }));
      else if (range[1] > game.moves.length) warnings.push(t("Szene {n}: zugNr {0} gibt es nicht, die Partie hat {1} Halbzüge.", { n, 0: range[1], 1: game.moves.length }));
      else {
        // 0 = the starting position without a move.
        const first = Math.max(1, range[0]);
        const target = game.fens[first - 1];
        if (line[line.length - 1] !== target) {
          line = [target];
          jump = target;
        }
        pgnMoves = range[1] === 0 ? "" : game.moves.slice(first - 1, Math.min(range[1], first + 7)).map((m) => m.san).join(" ");
      }
    }
    const before = line[line.length - 1];

    // Moves: checked one by one, an illegal one ends the scene's moves.
    const movesText = pgnMoves ?? text(field(o, "zug", "zuege", "moves", "move"), 600);
    const parsed = parseMoves(before, pgnMoves === null && Array.isArray(field(o, "zuege", "moves")) ? (field(o, "zuege", "moves") as unknown[]).join(" ") : movesText);
    if (parsed.error) errors.push(t("Szene {n}: „{error}“ ist in dieser Stellung nicht möglich{2}.", { n, error: parsed.error, 2: parsed.moves.length ? t(", nur {movesLabel} wird gezeigt", { movesLabel: movesLabel(parsed.moves, before) }) : "" }));
    const walk = new Chess(before);
    for (const m of parsed.moves) {
      walk.move(m.san);
      line.push(walk.fen());
    }
    moveCount += parsed.moves.length;

    const cardWord = word(field(o, "karte", "card", "typ", "type"));
    const card = cardWord ? CARDS[cardWord] : "none";
    if (cardWord && !card) warnings.push(t("Szene {n}: Karte „{String}“ kenne ich nicht.", { n, String: String(field(o, "karte", "card", "typ", "type")) }));
    const camWord = word(field(o, "kamera", "camera", "perspektive"));
    // Several angles cut through the scene on the beat ("kameras": ["nah", "tief", "oben"]).
    const cameras: CameraPreset[] = [];
    for (const c of asList(field(o, "kameras", "cameras", "winkel", "angles"))) {
      const preset = cameraOf(word(c), perspective);
      if (preset) cameras.push(preset);
      else warnings.push(t("Szene {n}: Kamera „{String}“ kenne ich nicht, ich lasse sie weg.", { n, String: String(c).trim() }));
    }
    cameras.length = Math.min(cameras.length, MAX_CAMERAS);
    const sideCam = camWord ? cameraOf(camWord, perspective) : null;
    const camera = sideCam ?? (camWord ? null : cameras[0]) ?? (card === "outro" ? "corner" : "white");
    if (camWord && !sideCam) warnings.push(t("Szene {n}: Kamera „{String}“ kenne ich nicht, ich nehme {2}.", { n, String: String(field(o, "kamera", "camera")), 2: CAMERA_LABEL[camera] }));

    const { effects, power, given } = readEffects(o, n, warnings);
    // A mate on the board gets its animation even when the AI forgot it.
    if (!given && parsed.moves.length && walk.isCheckmate()) effects.push("mate");

    const badgeRaw = text(field(o, "bewertung", "badge", "symbol", "rating"), 30);
    const badge: Badge = BADGES[badgeRaw] ?? BADGES[word(badgeRaw)] ?? "";
    if (badgeRaw && !badge) warnings.push(t("Szene {n}: Bewertung „{badgeRaw}“ gibt es nicht.", { n, badgeRaw }));

    const arrows = asList(field(o, "pfeile", "arrows", "pfeil", "arrow")).map(arrowOf);
    const marks = asList(field(o, "markierungen", "marks", "markierung", "felder", "highlights", "highlight", "squares")).map(markOf);
    if (arrows.includes(null) || marks.includes(null)) warnings.push(t("Szene {n}: Ein Pfeil oder eine Markierung war unlesbar und fehlt.", { n }));

    const label = parsed.moves.length ? movesLabel(parsed.moves, before) : "";
    const options = asList(field(o, "antworten", "optionen", "options", "answers"))
      .map((a) => text(a, 40))
      .filter(Boolean)
      .slice(0, 3);
    const countdown = number(field(o, "countdown", "timer"));
    scenes.push(
      scene({
        moves: label,
        fen: jump && jump !== here ? jump : "",
        // An edit shows no text but its stamps and the outro: a scene without a title does not fall back to the move's name.
        title: text(field(o, "titel", "title", "ueberschrift"), 120) || (edit ? "" : label),
        text: text(field(o, "untertitel", "text", "subtitle", "untertext"), 900),
        speech: text(field(o, "sprechtext", "sprecher", "voiceover", "sagen", "speech"), 1200),
        label: text(field(o, "kleinezeile", "label", "kicker", "zeile"), 40) || (back ? t("Variante {variations}", { variations }) : toMain && jump ? t("Zurück zur Hauptvariante") : ""),
        // An edit cuts every beat (two thirds of a second); the timeline rounds up to whole beats.
        duration: Math.min(30, Math.max(edit ? 0.3 : 1, number(field(o, "dauer", "duration", "sekunden")) ?? (card === "outro" ? 4 : card === "intro" ? (edit ? 1.3 : 3) : edit ? Math.max(0.6, cameras.length * 0.4) : 2.8 + parsed.moves.length * 0.6))),
        camera,
        cameras,
        stamp: text(field(o, "stempel", "stamp", "impacttext"), 14).toUpperCase(),
        power,
        // The edit's camera flies by itself: an own zoom, turn or focus of the AI only made the framing worse.
        zoom: edit ? 1 : Math.min(1.6, Math.max(0.45, number(field(o, "zoom")) ?? 1)),
        orbit: edit ? 0 : Math.min(30, Math.max(-30, number(field(o, "drehung", "orbit", "kamerafahrt", "rotation", "rotate")) ?? 0)),
        focus: edit ? false : bool(field(o, "fokus", "focus")) === true,
        arrows: arrows.filter((a): a is StudioArrow => !!a).slice(0, 12),
        marks: marks.filter((m): m is StudioMark => !!m).slice(0, 16),
        card: card ?? "none",
        options: card === "poll" ? options : [],
        countdown: card === "question" || card === "poll" ? Math.min(10, Math.max(0, countdown ?? 3)) : 0,
        mood: MOODS[word(field(o, "stimmung", "mood"))] ?? (effects.includes("mate") ? "wow" : "happy"),
        effects: [...new Set(effects)],
        badge,
        tempo: Math.min(3, Math.max(0.3, number(field(o, "zugtempo", "tempo", "movespeed")) ?? 1)),
      }),
    );
  });
  if (!scenes.length) return { project: null, errors: errors.length ? errors : [t("Keine lesbare Szene gefunden.")], warnings, stats: null };

  // ---- look and video options
  const theme = LOOKS[lookWord] ?? (Object.keys(THEMES) as ThemeId[]).find((tk) => tk === lookWord) ?? (edit ? "mono" : "nova");
  const envWord = word(field(root, "umgebung", "environment", "hintergrund"));
  const environment = ENVS[envWord] ?? (edit ? "void" : "podium");
  if (envWord && !ENVS[envWord]) warnings.push(t("Umgebung „{String}“ kenne ich nicht, ich nehme {1}.", { String: String(field(root, "umgebung", "environment")), 1: ENV_LABEL[environment] }));
  const design = (field(root, "design", "aussehen") ?? {}) as Obj;
  const dfield = (...names: string[]) => field(design, ...names) ?? field(root, ...names);
  const pick = <T,>(map: Record<string, T>, label: string, ...names: string[]): T | undefined => {
    const w = word(dfield(...names));
    if (!w) return undefined;
    if (!(w in map)) warnings.push(t("{label} „{String}“ kenne ich nicht, ich nehme den Standard.", { label, String: String(dfield(...names)) }));
    return map[w];
  };
  const material = pick(PIECE_LOOKS, t("Figuren"), "figuren", "pieces", "material");
  const captionStyle = pick(CAPTIONS, t("Untertitel-Stil"), "untertitelstil", "captionstyle", "subtitlestyle", "untertitel");
  const titleFont = pick(FONTS, t("Schrift"), "schrift", "font");
  const view = pick(VIEWS, t("Ansicht"), "ansicht", "brett", "view");
  const cutStyle = pick(CUT_STYLES, t("Schnitt-Stil"), "schnittstil", "cutstyle", "editstil", "reellook");
  const music = pick(MUSICS, t("Musik"), "musik", "music");
  const accentRaw = text(dfield("akzent", "akzentfarbe", "accent"), 12);
  const accent = /^#[0-9a-f]{6}$/i.test(accentRaw) ? accentRaw : undefined;
  if (accentRaw && !accent) warnings.push(t("Akzentfarbe „{accentRaw}“ ist kein Farbcode wie #8d9aff.", { accentRaw }));
  const textScale = number(dfield("textgroesse", "textscale", "schriftgroesse", "textsize"));
  const rim = bool(dfield("figurenrand", "piecerim", "rand"));
  const settings = (field(root, "einstellungen", "settings", "optionen") ?? {}) as Obj;
  const setting = (fallback: boolean, ...names: string[]) => bool(field(settings, ...names)) ?? fallback;
  const platform = PLATFORMS[word(field(root, "plattform", "platform"))] ?? defaults.platform ?? "tiktok";
  const speed = number(field(root, "geschwindigkeit", "speed", "gesamttempo"));
  const tempo = number(field(root, "zugtempo", "tempo", "movespeed"));
  let project: StudioProject = normalizeProject({
    id: newId("p"),
    name: text(field(root, "titel", "title", "name"), 80) || t("KI-Video"),
    startFen,
    scenes,
    style: {
      ...styleFromTheme(theme, { environment, coords: setting(true, "koordinaten", "coords", "coordinates"), reflection: setting(true, "spiegelung", "reflection") }),
      ...(material ? { material } : {}),
      ...(captionStyle ? { captionStyle } : {}),
      ...(titleFont ? { titleFont } : {}),
      // YouTube lessons default to the flat board: it is the easiest to follow for a long explanation.
      view: edit ? "reel" : (view ?? (platform === "youtube" ? "2d" : "3d")),
      ...(edit ? { titleFont: cutStyle === "close" ? ("sans" as const) : ("serif" as const) } : {}),
      ...(edit && cutStyle ? { reelLook: cutStyle } : {}),
      ...(accent ? { accent } : {}),
      ...(textScale !== null ? { textScale } : {}),
      ...(rim !== null ? { pieceRim: rim } : {}),
    },
    video: {
      ...DEFAULT_VIDEO,
      format: platform === "youtube" ? "16:9" : "9:16",
      perspective,
      plainMoves: setting(true, "zuginworten", "plainmoves", "moveinwords"),
      squareHints: setting(true, "felderleuchten", "squarehints", "glowsquares"),
      spellMoves: setting(true, "zuegeausschreiben", "spellmoves"),
      platform,
      speed: speed ?? 1,
      // Lessons move the pieces more calmly so the viewer can follow every move.
      tempo: tempo ?? (edit ? 2.4 : platform === "youtube" ? 0.8 : 1),
      lucena: setting(!edit, "lucena", "kugel", "orb"),
      sound: setting(true, "effektTon", "ton", "sound", "sounds", "effectsound"),
      movePill: setting(!edit, "zuganzeige", "movepill", "movedisplay"),
      progress: setting(true, "fortschritt", "progress"),
      // The opening flight from above takes seconds; it stays a choice for lessons only, a short clip starts on the board.
      introFly: setting(platform === "youtube" && !edit, "kameraflug", "introfly", "cameraflight"),
      ...(edit ? { music: "generated" as const } : {}),
      ...(defaults.musicStyle && defaults.musicStyle !== "auto" ? { musicStyle: defaults.musicStyle } : {}),
      ...(music ? { music } : {}),
      lesson: platform === "youtube" && setting(true, "lernlayout", "lesson"),
    },
    updatedAt: Date.now(),
  });
  // Texts longer than the frame holds get cut on screen, so say which scene to shorten.
  project.scenes.forEach((sc, i) => {
    const max = FIT.title / Math.max(0.8, project.style.textScale);
    if (sc.title.length > max) warnings.push(t("Szene {0}: Titel ist {length} Zeichen lang, ins Bild passen etwa {2}.", { 0: i + 1, length: sc.title.length, 2: Math.round(max) }));
    const plain = sc.text.replace(/[*|]/g, "");
    if (project.video.lesson && plain.length > FIT.lesson) warnings.push(t("Szene {0}: Erklärung ist lang ({length} Zeichen), rechts passen etwa {lesson}. Sie wird deshalb in Teilen nacheinander gezeigt.", { 0: i + 1, length: plain.length, lesson: FIT.lesson }));
  });
  const length = number(field(root, "laenge", "length", "dauer"));
  // An edit keeps its beat: stretching its cuts to a length would turn it back into a slow video.
  if (length && length >= 5 && speed === null && !edit) project = fitLength(project, length);
  // An edit is made short and dense whatever the AI wrote: start in the critical position with a hook,
  // the forced exchange between sacrifice and mate squeezed, the outro a 1.3 s overlay (see tightenEdit).
  // But a "laenge" the script states is a decision, not a guess: a script whose scenes fit into it keeps
  // its build-up and its durations (the Edit tab still tightens on request).
  const stated = !!length && length >= 5 && compile(project).total <= length * 1.3;
  if (edit && defaults.tighten && !stated) project = tightenEdit(project, { lang: lang() }).project;
  const seconds = compile(project).total;
  // The target length of an edit is an upper limit: a shorter edit is what was asked for.
  if (length && (edit && defaults.tighten ? seconds > length * 1.3 : Math.abs(seconds - length) > length * 0.3)) warnings.push(t("Das Video dauert {0} s statt {1} s. Mit „auf N s anpassen“ lässt es sich angleichen.", { 0: Math.round(seconds), 1: Math.round(length) }));
  return { project, errors, warnings, stats: { scenes: project.scenes.length, moves: moveCount, variations, seconds } };
}

// ---------- the other way round ----------

const rev = <T extends string>(map: Record<string, T>, value: T) => Object.keys(map).find((k) => map[k] === value) ?? value;
const TONE_WORD: Record<Tone, string> = { accent: "akzent", good: "gut", bad: "gefahr", idea: "idee", white: "weiss" };

/** The effects of a scene for the export: a plain list, or an object with strengths when some effect is not at full power. */
function effectsOut(s: Scene): string[] | Record<string, number> {
  if (!Object.keys(s.power).length) return s.effects.map((e) => rev(EFFECTS, e));
  const map: Record<string, number> = {};
  for (const e of s.effects) map[rev(EFFECTS, e)] = s.power[e] ?? 1;
  for (const [k, v] of Object.entries(s.power)) if (v === 0) map[rev(EFFECTS, k as Effect)] = 0;
  return map;
}

/** The current project in the AI format, to let an AI revise it. Variations become plain position jumps (FEN). */
export function toAiScript(project: StudioProject): string {
  const out = {
    ...(project.style.view === "reel" ? { videoart: "edit", schnittstil: project.style.reelLook === "close" ? "nah" : "klassisch" } : {}),
    titel: project.name,
    plattform: project.video.platform,
    perspektive: project.video.perspective === "black" ? "schwarz" : "weiss",
    geschwindigkeit: project.video.speed,
    zugtempo: project.video.tempo,
    look: project.style.theme,
    umgebung: rev(ENVS, project.style.environment),
    design: {
      ansicht: project.style.view === "billboard" ? "aufsteller" : project.style.view,
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
      ...(s.cameras.length ? { kameras: s.cameras.map((c) => rev(CAMERAS, c)) } : {}),
      ...(s.effects.length || Object.keys(s.power).length ? { effekte: effectsOut(s) } : {}),
      ...(s.stamp ? { stempel: s.stamp } : {}),
      ...(s.badge ? { bewertung: rev(BADGES, s.badge) } : {}),
      ...(s.tempo !== 1 ? { zugtempo: s.tempo } : {}),
      ...(s.options.length ? { antworten: s.options } : {}),
      ...(s.countdown ? { countdown: s.countdown } : {}),
      stimmung: rev(MOODS, s.mood),
    })),
  };
  return "```json\n" + JSON.stringify(inFormatLanguage(out), null, 2) + "\n```";
}

/** The speaker's lines with their time in the video, to read along while recording the voice-over. */
export function speechSheet(project: StudioProject): string {
  const tl = compile(project);
  const fmt = (tk: number) => `${Math.floor(tk / 60)}:${String(Math.floor(tk % 60)).padStart(2, "0")}`;
  return tl.scenes
    .map((c, i) => {
      const say = c.scene.speech.trim() || c.scene.text.replace(/\*/g, "").replace(/\s*\|\s*/g, " ").trim();
      return t("{fmt}–{fmt2}  Szene {2}{3}\n{4}", { fmt: fmt(c.start), fmt2: fmt(c.start + c.dur), 2: i + 1, 3: c.scene.title ? ` (${c.scene.title})` : "", 4: say || "—" });
    })
    .join("\n\n");
}

export const EFFECT_IDS = Object.keys(EFFECT_LABEL) as Effect[];
