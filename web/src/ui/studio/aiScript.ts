// Video scripts written by an external AI chat (ChatGPT, Claude, Gemini …).
// The studio hands out a prompt that describes a small JSON format; the AI's
// answer is pasted back and turned into a project: every move checked,
// variations resolved by "go back n half-moves", unknown values replaced by
// safe defaults with a note. Pure, so it is tested headless.
import { Chess } from "chess.js";

import {
  BADGE_LABEL,
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
  type CameraPreset,
  type Card,
  type Effect,
  type Environment,
  type Mood,
  type Platform,
  type Scene,
  type StudioArrow,
  type StudioMark,
  type StudioProject,
  type ThemeId,
  type Tone,
} from "./model";
import { compile } from "./timeline";
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
  weiss: "white", weisssicht: "white", white: "white", normal: "white", standard: "white",
  schwarz: "black", schwarzsicht: "black", black: "black",
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
const PLATFORMS: Record<string, Platform> = {
  tiktok: "tiktok", reels: "reels", instagram: "reels", instagramreels: "reels", shorts: "shorts", youtubeshorts: "shorts", youtube: "youtube", youtubequer: "youtube",
};
const BADGES = Object.keys(BADGE_LABEL).filter(Boolean) as Exclude<Badge, "">[];

// ---------- the prompt ----------

export interface PromptOptions {
  topic: string;
  platform: Platform;
  /** Seconds. */
  length: number;
  notes: string;
}

const list = (o: Record<string, unknown>) => Object.keys(o).join(", ");

export function buildAiPrompt(o: PromptOptions): string {
  const example = {
    titel: "Matt in 4 Zügen",
    plattform: o.platform,
    laenge: 20,
    look: "nova",
    umgebung: "buehne",
    szenen: [
      { karte: "titel", titel: "Fällst du darauf rein?", untertitel: "Matt in *4 Zügen*", sprechtext: "Diese Falle kostet jeden Tag tausende Partien.", kamera: "weiss", dauer: 2.5 },
      { zug: "1. e4 e5", titel: "Ganz normal", untertitel: "Beide besetzen das *Zentrum*.", kamera: "weiss", markierungen: ["e4 akzent", "e5 akzent"], dauer: 2.5 },
      { zug: "2. Lc4", titel: "Ziel: f7", untertitel: "Der Läufer zielt auf *f7*.", sprechtext: "Der Läufer schaut schon auf f7.", kamera: "schraeg", fokus: true, pfeile: ["c4-f7 gefahr"], effekte: ["drohung"], dauer: 2.5 },
      { zug: "2... Sc6 3. Dh5", titel: "Die Dame kommt", untertitel: "Zwei Angreifer auf *f7*.", kamera: "nah", pfeile: ["h5-f7 gefahr", "c4-f7 gefahr"], effekte: ["zoom"], dauer: 3 },
      { karte: "umfrage", titel: "Was spielt Schwarz?", antworten: ["A) Sf6", "B) g6", "C) De7"], countdown: 3 },
      { zug: "3... Sf6", titel: "Der Fehler", kamera: "schwarz", bewertung: "??", stimmung: "traurig", dauer: 2 },
      { zug: "4. Dxf7#", titel: "Schachmatt!", kamera: "tief", effekte: ["matt", "wackeln"], bewertung: "!!", zugtempo: 0.7 },
      { variante: { zurueck: 2 }, kleineZeile: "Besser", zug: "3... g6", titel: "So verteidigst du", pfeile: ["g6-h5 gut"], kamera: "schraeg" },
      { karte: "abspann", titel: "Folge für mehr Fallen", untertitel: "Teil 2 kommt morgen" },
    ],
  };
  return `Du schreibst das komplette Drehbuch für ein kurzes Schach-Video, das ich in meinem 3D-Videostudio automatisch erstellen lasse. Antworte NUR mit einem JSON-Codeblock in genau dem Format unten, ohne Text davor oder danach.

MEIN VIDEO
- Thema: ${o.topic.trim() || "(such dir ein spannendes Thema aus)"}
- Plattform: ${PLATFORM_LABEL[o.platform]} (Hochformat${o.platform === "youtube" ? ", hier Querformat" : ""})
- Ziellänge: etwa ${o.length} Sekunden
${o.notes.trim() ? `- Das ist mir wichtig:\n${o.notes.trim().split("\n").map((l) => `  ${l.trim()}`).join("\n")}\n` : ""}
REGELN FÜR EIN GUTES VIDEO
1. Die erste Szene ist ein starker Hook, der in 2 Sekunden neugierig macht. Keine erfundenen Zahlen oder Statistiken.
2. Kurze Untertitel (höchstens etwa 90 Zeichen). *Sternchen* um ein Wort färben es ein. Ein | teilt einen Untertitel in Teile, die nacheinander erscheinen.
3. Jede Szene kann einen eigenen Sprechtext haben: das, was ich im Video sage (natürlich gesprochen, etwa 2,5 Wörter pro Sekunde, passend zur Dauer).
4. Willst du pro Zug eine eigene Kamera, einen eigenen Text oder eigene Pfeile, mach für jeden Zug eine eigene Szene.
5. Die Summe aller "dauer"-Werte soll ungefähr die Ziellänge ergeben.
6. Ende mit einer Abspann-Szene, die zum Folgen, Kommentieren oder Speichern auffordert.

SCHACH-REGELN (sehr wichtig)
- Nur legale Züge in der richtigen Reihenfolge. Prüfe jeden Zug, bevor du ihn schreibst.
- Züge in Standard-Notation, deutsch (S, L, T, D, K) oder englisch (N, B, R, Q, K), z. B. "1. e4 e5 2. Sf3" oder "3... a6".
- Eine Szene kann einen oder mehrere Züge haben ("zug"). Die Züge gehen immer in der Stellung weiter, in der die vorige Szene aufgehört hat.
- Variante zeigen: "variante": { "zurueck": n } geht vorher n Halbzüge zurück (1 Halbzug = ein Zug von Weiß oder Schwarz) und spielt dann die Züge dieser Szene.
- Zurück zur Hauptvariante: "hauptvariante": true in der nächsten Szene springt zur Stellung, bevor die Variante begann.
- Eine besondere Startstellung (Rätsel, Endspiel) gibst du als "startstellung" (FEN) an.

FELDER
Video (oben): titel, plattform (${list(PLATFORMS)}), laenge (Sekunden), geschwindigkeit (Gesamttempo 0.5 bis 2.5, 1 = normal), zugtempo (wie schnell die Figuren ziehen, 0.4 bis 2.5), look (${Object.keys(THEMES).join(", ")}), umgebung (schwebend, buehne, holztisch, neon, turniersaal, bibliothek), startstellung, einstellungen { lucena: true/false (KI-Kugel neben den Untertiteln), ton, zuganzeige, fortschritt, koordinaten, kameraflug }.
Szene: karte (titel, frage, umfrage, abspann oder weglassen), zug, titel, untertitel, sprechtext, kleineZeile (kleine Zeile über dem Titel, z. B. "Variante 1"), dauer (Sekunden), kamera (weiss, schwarz, oben, schraeg, seitlich, tief, nah), zoom (0.5 = nah, 1 = ganzes Brett), drehung (langsame Kamerafahrt, Grad pro Sekunde, z. B. 5 oder -5), fokus (true = Kamera lehnt sich zum Zielfeld), pfeile (z. B. "f3-e5 gefahr"), markierungen (z. B. "e5 gut"), effekte, bewertung (${BADGES.join(", ")}), zugtempo (nur diese Szene), stimmung (froehlich, nachdenklich, begeistert, traurig), countdown (Sekunden, bei frage und umfrage), antworten (bei umfrage, z. B. "A) Lb5"), variante, hauptvariante.
Farben für Pfeile und Markierungen: gefahr (rot: Drohung, Fehler), gut (grün: gute Idee, Verteidigung), idee (gelb: Plan), akzent (Hervorhebung), weiss.
Effekte: matt (König kippt um, nur bei Schachmatt), drohung (bedrohte Felder pulsieren rot), spotlight (alles außer dem Zielfeld wird dunkel), wackeln (Kamera bebt beim Zug), zoom (schneller Zoom aufs Feld), blitz (heller Blitz), konfetti (für starke Züge und Siege), zeitlupe (der letzte Zug der Szene in Zeitlupe). Setz Effekte gezielt ein, nicht in jeder Szene.

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
    const camera = CAMERAS[camWord] ?? (card === "outro" ? "corner" : "white");
    if (camWord && !CAMERAS[camWord]) warnings.push(`Szene ${n}: Kamera „${String(field(o, "kamera", "camera"))}“ kenne ich nicht, ich nehme ${CAMERA_LABEL[camera]}.`);

    const effectsRaw = field(o, "effekte", "effects", "effekt");
    const effects: Effect[] = [];
    for (const e of asList(effectsRaw)) {
      const id = EFFECTS[word(e)];
      if (id) effects.push(id);
      else warnings.push(`Szene ${n}: Effekt „${String(e).trim()}“ gibt es nicht.`);
    }
    // A mate on the board gets its animation even when the AI forgot it.
    if (effectsRaw === undefined && parsed.moves.length && walk.isCheckmate()) effects.push("mate");

    const badgeRaw = text(field(o, "bewertung", "badge", "symbol"), 4);
    const badge = (BADGES as string[]).includes(badgeRaw) ? (badgeRaw as Badge) : "";
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
    style: styleFromTheme(theme, { environment, coords: setting(false, "koordinaten", "coords") }),
    video: {
      ...DEFAULT_VIDEO,
      format: platform === "youtube" ? "16:9" : "9:16",
      platform,
      speed: speed ?? 1,
      tempo: tempo ?? 1,
      lucena: setting(true, "lucena", "kugel"),
      sound: setting(true, "ton", "sound", "sounds"),
      movePill: setting(true, "zuganzeige", "movepill"),
      progress: setting(true, "fortschritt", "progress"),
      introFly: setting(true, "kameraflug", "introfly"),
    },
    updatedAt: Date.now(),
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
    geschwindigkeit: project.video.speed,
    zugtempo: project.video.tempo,
    look: project.style.theme,
    umgebung: rev(ENVS, project.style.environment),
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
      ...(s.badge ? { bewertung: s.badge } : {}),
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
