// The video studio's project format: a list of scenes (moves, texts, arrows,
// camera) plus one look and one set of video options. Pure data and rules, no
// browser APIs, so templates and validation are tested headless.
import { MUSIC_LABEL, type MusicId } from "./music";
import { STYLE_IDS, type StyleId } from "./musicGen";
import { Chess, type Move } from "chess.js";

import { BRAND_DOMAIN } from "../../brand";
import { t, lang } from "../../i18n";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type Tone = "accent" | "good" | "bad" | "idea" | "white";
export type Mood = "happy" | "think" | "wow" | "sad";
export type CameraPreset = "white" | "black" | "top" | "corner" | "side" | "low" | "close";
/** A full-screen card over the board: opening title, question with countdown, or the closing call to action. */
export type Card = "none" | "intro" | "question" | "poll" | "outro";
/** Where the board stands: code-built 3D surroundings. */
export type Environment = "void" | "podium" | "table" | "neon" | "hall" | "library";
export type Platform = "tiktok" | "reels" | "shorts" | "youtube";
/** Show effects that start when the scene's moves have landed. */
export type Effect = "mate" | "threat" | "spotlight" | "shake" | "zoom" | "flash" | "confetti" | "slowmo" | "hitstop" | "invert" | "glitch" | "dutch" | "punch" | "whip" | "riser";
/** Move rating shown as the analysis page's round badge on the square the last move landed on. */
export type Badge = "" | "brilliant" | "great" | "best" | "excellent" | "good" | "book" | "inaccuracy" | "mistake" | "miss" | "blunder";
/** The side the whole video is watched from; camera presets are relative to it. */
export type Side = "white" | "black";

export interface StudioArrow {
  from: string;
  to: string;
  tone: Tone;
}
export interface StudioMark {
  square: string;
  tone: Tone;
}

export interface Scene {
  id: string;
  /** Moves of this scene in SAN, German (Sf3, Lb5, D) or English letters; move numbers are ignored. */
  moves: string;
  /** Optional position the scene jumps to before its moves (for "what if" lines). */
  fen: string;
  title: string;
  /** Subtitle; words in *stars* are drawn in the accent colour, "|" splits it into parts shown one after another. */
  text: string;
  /** Seconds; stretched automatically when the moves need longer. */
  duration: number;
  camera: CameraPreset;
  /** 1 = whole board in view, smaller = closer. */
  zoom: number;
  /** Slow turn of the camera during the scene, degrees per second. */
  orbit: number;
  /** Camera leans towards the square the scene is about. */
  focus: boolean;
  arrows: StudioArrow[];
  marks: StudioMark[];
  card: Card;
  /** Small line above the headline, e.g. "Variante 2". */
  label: string;
  /** Answers of a poll card ("A) Lb5"), shown as buttons to comment on. */
  options: string[];
  /** Seconds of a visible countdown (question and poll cards). */
  countdown: number;
  /** The length was set below what the scene naturally needs: moves and effects are played faster to fit it. */
  squeeze: boolean;
  mood: Mood;
  effects: Effect[];
  badge: Badge;
  /** What the speaker says over this scene (voice-over); not shown in the video. */
  speech: string;
  /** Speed of this scene's piece moves, 1 = normal. */
  tempo: number;
  /**
   * Camera angles that cut through the scene on the beat (empty = the scene's own `camera` all the way).
   * With a hit-stop they start after it: build-up, freeze, then fast cuts.
   */
  cameras: CameraPreset[];
  /** One loud word stamped over the picture for about 0.4 s at the impact ("BLUNDER", "??"); empty = none. */
  stamp: string;
  /** How hard each effect hits, 0..1 (missing = 1). Lets the climax stand out from the normal blows. */
  power: Partial<Record<Effect, number>>;
}

export type ThemeId = "nova" | "marmor" | "holz" | "walnuss" | "turnier" | "neon" | "mono";
export type Material = "porcelain" | "chrome" | "matte" | "wood";

/** How the subtitles sit on the video: in a dark box, as bold outlined text, or big and heavy without a box. */
export type CaptionStyle = "box" | "outline" | "punch";
/**
 * How the board is drawn: the 3D show board (TikTok, Shorts) or a flat board
 * seen from above, like in a book, which beginners and phone screens read best.
 */
export type BoardView = "3d" | "2d" | "billboard" | "reel";
/** Order of the choices in the editor. */
export const VIEWS: BoardView[] = ["2d", "billboard", "3d", "reel"];
export const VIEW_LABEL: Record<BoardView, string> = { "2d": t("2D – klar wie im Buch"), billboard: t("3D-Brett, 2D-Figuren"), "3d": t("3D – Show-Look"), reel: t("Reel – Schwarz-Weiß mit Glühen") };
/** The views with a 3D board (camera, surroundings, reflection). The reel look draws its own tilted flat board. */
export const isBoard3d = (v: BoardView) => v === "3d" || v === "billboard";
export const CAPTION_LABEL: Record<CaptionStyle, string> = { box: t("Im Kasten"), outline: t("Mit Kontur"), punch: t("Groß und fett") };
export const MATERIAL_LABEL: Record<Material, string> = { porcelain: t("Lack"), matte: t("Matt"), chrome: t("Chrom"), wood: t("Holz") };

export interface StudioStyle {
  theme: ThemeId;
  light: string;
  dark: string;
  frame: string;
  whitePiece: string;
  blackPiece: string;
  material: Material;
  bgTop: string;
  bgBottom: string;
  accent: string;
  reflection: boolean;
  coords: boolean;
  titleFont: "sans" | "serif";
  environment: Environment;
  /** Thin light edge on the pieces so black stays readable on dark squares. */
  pieceRim: boolean;
  captionStyle: CaptionStyle;
  /** Size of all texts, 1 = normal. */
  textScale: number;
  view: BoardView;
}

export type Format = "9:16" | "1:1" | "16:9";

export interface StudioVideo {
  format: Format;
  /** Whose side the board is seen from in every scene. */
  perspective: Side;
  /** Moves spelled out under the notation ("Springer nach f3") for viewers who don't read notation. */
  plainMoves: boolean;
  /** Squares named in the subtitle light up softly. */
  squareHints: boolean;
  /** Notation inside titles and subtitles is written out for beginners ("Sf3" → "Springer f3"). */
  spellMoves: boolean;
  fps: 30 | 60;
  /** Speed of the piece moves, 1 = normal. */
  tempo: number;
  /** Speed of the whole video: scenes and moves together (2 = twice as fast). */
  speed: number;
  platform: Platform;
  brand: boolean;
  watermark: boolean;
  progress: boolean;
  movePill: boolean;
  lastMove: boolean;
  lucena: boolean;
  /** Move sounds (wooden tock per move) and effect sounds (mate hit, swoosh, glitter). */
  sound: boolean;
  /** Overall volume of the whole mix. */
  volume: number;
  introFly: boolean;
  music: MusicId;
  musicVolume: number;
  /** Name of the own music file kept in the browser's audio store. */
  musicName: string;
  /** Generator: "auto" picks the style that fits the video. */
  musicStyle: StyleId | "auto";
  musicSeed: number;
  musicIntensity: number;
  /** Whether an own voice recording for this video is kept in the audio store. */
  voice: boolean;
  voiceVolume: number;
  /** Long, calm lesson for YouTube: board on the left, explanation and move list on the right. Only in 16:9. */
  lesson: boolean;
}

export interface StudioProject {
  id: string;
  name: string;
  startFen: string;
  scenes: Scene[];
  style: StudioStyle;
  video: StudioVideo;
  updatedAt: number;
}

export const THEMES: Record<ThemeId, { label: string } & Omit<StudioStyle, "theme" | "reflection" | "coords" | "titleFont" | "environment" | "pieceRim" | "captionStyle" | "textScale" | "view">> = {
  nova: { label: "Nova", light: "#d3d8e6", dark: "#4b5675", frame: "#121620", whitePiece: "#f3f1ec", blackPiece: "#1b1d24", material: "porcelain", bgTop: "#1a2140", bgBottom: "#05060a", accent: "#8d9aff" },
  marmor: { label: t("Marmor"), light: "#ece9e3", dark: "#8b909b", frame: "#26292f", whitePiece: "#f7f5f0", blackPiece: "#16171b", material: "porcelain", bgTop: "#2c313b", bgBottom: "#08090b", accent: "#3fd2ea" },
  holz: { label: t("Holz"), light: "#e9d0a5", dark: "#a5714a", frame: "#43291a", whitePiece: "#ecd3a4", blackPiece: "#3a2216", material: "wood", bgTop: "#2b1e15", bgBottom: "#0a0705", accent: "#ff9d5c" },
  walnuss: { label: t("Walnuss"), light: "#e6cfa3", dark: "#6e4a2f", frame: "#2a1a10", whitePiece: "#f0d9ae", blackPiece: "#24140c", material: "wood", bgTop: "#3a2a1f", bgBottom: "#0b0806", accent: "#ffcf70" },
  turnier: { label: t("Turnier"), light: "#eeeed2", dark: "#769656", frame: "#27301f", whitePiece: "#f6f4ee", blackPiece: "#1c1d1f", material: "porcelain", bgTop: "#1c2618", bgBottom: "#060805", accent: "#34d3a1" },
  neon: { label: "Neon", light: "#2b3050", dark: "#141729", frame: "#0a0c18", whitePiece: "#eaf6ff", blackPiece: "#40307a", material: "chrome", bgTop: "#22104a", bgBottom: "#04030b", accent: "#3fd2ea" },
  // Grey squares on pure black: the base of the reel look (colour only comes from the glow).
  mono: { label: t("Mono (Reel)"), light: "#bdbdbd", dark: "#5f5f5f", frame: "#000000", whitePiece: "#f3f3f3", blackPiece: "#1a1a1a", material: "matte", bgTop: "#000000", bgBottom: "#000000", accent: "#5b6cff" },
};

export const TONES: Record<Exclude<Tone, "accent">, string> = {
  good: "#34d3a1",
  bad: "#ff6b6b",
  idea: "#ffb84d",
  white: "#ffffff",
};
export const TONE_LABEL: Record<Tone, string> = { accent: t("Akzent"), good: t("Gut"), bad: t("Gefahr"), idea: t("Idee"), white: t("Weiß") };

export function toneColor(tone: Tone, style: StudioStyle): string {
  return tone === "accent" ? style.accent : TONES[tone];
}

export const CAMERA_LABEL: Record<CameraPreset, string> = {
  white: t("Normal"),
  black: t("Von gegenüber"),
  top: t("Von oben"),
  corner: t("Schräg"),
  side: t("Seitlich"),
  low: t("Tief & dramatisch"),
  close: t("Nah dran"),
};
export const CARD_LABEL: Record<Card, string> = { none: t("Keine"), intro: t("Titelkarte"), question: t("Frage + Countdown"), poll: t("Umfrage"), outro: t("Abspann") };
export const ENV_LABEL: Record<Environment, string> = { void: t("Schwebend"), podium: t("Bühne"), table: t("Holztisch"), neon: t("Neon-Arena"), hall: t("Turniersaal"), library: t("Bibliothek") };
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", reels: "Instagram Reels", shorts: "YouTube Shorts", youtube: t("YouTube (quer)") };
export const EFFECT_LABEL: Record<Effect, { label: string; hint: string }> = {
  mate: { label: t("Schachmatt"), hint: t("König kippt um, Druckwelle und großer Schriftzug") },
  threat: { label: t("Drohung"), hint: t("Bedrohte Felder pulsieren rot") },
  spotlight: { label: "Spotlight", hint: t("Alles außer dem wichtigen Feld wird dunkel") },
  shake: { label: t("Wackeln"), hint: t("Kamera bebt beim Aufsetzen der Figur") },
  zoom: { label: t("Zoom"), hint: t("Kamera zoomt schnell auf das Feld") },
  flash: { label: "Blitz", hint: t("Kurzer heller Blitz beim Zug") },
  confetti: { label: t("Konfetti"), hint: t("Konfetti für starke Züge und Siege") },
  slowmo: { label: t("Zeitlupe"), hint: t("Der letzte Zug der Szene läuft langsam") },
  hitstop: { label: "Hitstop", hint: t("Kompletter Stillstand für 0,25 s im Moment des Aufpralls") },
  invert: { label: t("Invertieren"), hint: t("Farben kehren sich für 0,15 s um (Patzer, Brillant)") },
  glitch: { label: "Glitch", hint: t("Kurze RGB-Verschiebung an den Rändern (Chromatic Aberration)") },
  dutch: { label: t("Schräglage"), hint: t("Kamera kippt schräg, für Drohungen") },
  punch: { label: "Punch-In", hint: t("Schneller Zoom von 1,0 auf 0,65 in einer halben Sekunde") },
  riser: { label: "Riser", hint: t("Langsames, immer schnelleres Heranzoomen bis zum Aufprall (Spannungsaufbau)") },
  whip: { label: "Whip-Pan", hint: t("Schneller Schwenk mit Bewegungsunschärfe zum nächsten Winkel") },
};

/** Seconds the picture freezes on a hit-stop. */
export const HITSTOP = 0.25;
/** Most camera angles one scene can cut through. */
export const MAX_CAMERAS = 8;

/** How hard an effect of the scene hits: 0..1, 1 when the scene says nothing. */
export const powerOf = (s: Pick<Scene, "power">, kind: Effect): number => s.power[kind] ?? 1;
export const BADGE_LABEL: Record<Badge, string> = {
  "": t("Keine"),
  brilliant: t("Brillant"),
  great: t("Großartig"),
  best: t("Bester Zug"),
  excellent: t("Exzellent"),
  good: t("Gut"),
  book: t("Buchzug"),
  inaccuracy: t("Ungenauigkeit"),
  mistake: t("Fehler"),
  miss: t("Verpasst"),
  blunder: t("Patzer"),
};
/** The analysis page's badge files (public/badges), so videos show the same symbols as the site. */
export const BADGE_FILE: Record<Exclude<Badge, "">, string> = {
  brilliant: "brilliant.svg",
  great: "great_find.svg",
  best: "best_v2.svg",
  excellent: "excellent.svg",
  good: "good.svg",
  book: "book.svg",
  inaccuracy: "inaccuracy.svg",
  mistake: "mistake.svg",
  miss: "missed_win.svg",
  blunder: "blunder.svg",
};
/** Old projects stored annotation symbols. */
export const BADGE_FROM_SYMBOL: Record<string, Exclude<Badge, "">> = { "!!": "brilliant", "!": "great", "!?": "good", "?!": "inaccuracy", "?": "mistake", "??": "blunder" };
/** Colours of the three poll answers: arrows on the board and the answer buttons match. */
export const POLL_COLOURS = ["#4da3ff", "#ffb84d", "#c77dff"] as const;
export const MOOD_LABEL: Record<Mood, string> = { happy: t("Fröhlich"), think: t("Nachdenklich"), wow: t("Begeistert"), sad: t("Traurig") };
export const FORMAT_SIZE: Record<Format, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080] };

export function styleFromTheme(theme: ThemeId, keep?: Partial<StudioStyle>): StudioStyle {
  const { label: _label, ...colours } = THEMES[theme];
  return { reflection: true, coords: true, titleFont: "sans", environment: "podium", pieceRim: true, captionStyle: "box", textScale: 1, view: "3d", ...keep, ...colours, theme };
}

export const DEFAULT_VIDEO: StudioVideo = {
  format: "9:16",
  perspective: "white",
  plainMoves: true,
  squareHints: true,
  spellMoves: true,
  fps: 30,
  tempo: 1,
  speed: 1,
  platform: "tiktok",
  brand: true,
  watermark: true,
  progress: true,
  movePill: true,
  lastMove: true,
  lucena: true,
  sound: true,
  volume: 1,
  introFly: true,
  music: "generated",
  musicVolume: 0.5,
  musicName: "",
  musicStyle: "auto",
  musicSeed: 1,
  musicIntensity: 0.65,
  voice: false,
  voiceVolume: 1,
  lesson: false,
};

let counter = 0;
export function newId(prefix = "s"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: newId(),
    moves: "",
    fen: "",
    title: "",
    text: "",
    duration: 3.5,
    camera: "white",
    zoom: 1,
    orbit: 0,
    focus: false,
    arrows: [],
    marks: [],
    card: "none",
    label: "",
    options: [],
    countdown: 0,
    squeeze: false,
    mood: "happy",
    effects: [],
    badge: "",
    speech: "",
    tempo: 1,
    cameras: [],
    stamp: "",
    power: {},
    ...over,
  };
}

// ---------- moves ----------

const TO_ENGLISH: Record<string, string> = { S: "N", L: "B", T: "R", D: "Q", K: "K" };
const TO_GERMAN: Record<string, string> = { N: "S", B: "L", R: "T", Q: "D", K: "K" };

/** Splits a move text ("1. e4 e5 2. Sf3") into SAN tokens chess.js understands. */
export function moveTokens(text: string): string[] {
  return text
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((tk) => tk.replace(/^\d+(\.+|…)/, "").replace(/^…/, "").replace(/[!?]+$/g, "").trim())
    .filter((tk) => tk && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tk))
    .map((tk) =>
      tk
        .replace(/^0-0-0/, "O-O-O")
        .replace(/^0-0/, "O-O")
        .replace(/^[SLTDK](?=[a-h1-8x])/, (p) => TO_ENGLISH[p])
        .replace(/=([SLTD])/, (_m, p: string) => `=${TO_ENGLISH[p]}`),
    );
}

/** SAN in the studio's language: German piece letters (Sf3, Lb5, Dxf7#) or English ones (Nf3, Bb5, Qxf7#). */
export function displaySan(san: string): string {
  if (lang() === "en") return san;
  return san.replace(/^[NBRQK]/, (p) => TO_GERMAN[p]).replace(/=([NBRQ])/, (_m, p: string) => `=${TO_GERMAN[p]}`);
}

const PIECE_NAME: Record<string, string> = { S: t("Springer"), N: t("Springer"), L: t("Läufer"), B: t("Läufer"), T: t("Turm"), R: t("Turm"), D: t("Dame"), Q: t("Dame"), K: t("König") };
// i18n: regex
const NOT_WORD = "A-Za-zÄÖÜäöüß0-9";
const SAN_IN_TEXT = new RegExp(`(?<![${NOT_WORD}])(?:([KDTLSNBRQ])([a-h]?[1-8]?)(x?)([a-h][1-8])|([a-h])x([a-h][1-8])|([a-h][18])=([DTLSQRBN])|(O-O-O|0-0-0|O-O|0-0))([+#]?)(?![${NOT_WORD}-])`, "g");

/**
 * Writes the notation inside a sentence out for viewers who can't read it:
 * "Sf3" → "Springer f3", "Dxf7#" → "Dame schlägt auf f7, Matt", "O-O" → "kurze Rochade".
 * Plain squares and pawn moves ("e4") stay as they are, they are already readable.
 */
export function spellNotation(text: string): string {
  return text.replace(SAN_IN_TEXT, (_all, piece: string, _from: string, takes: string, to: string, pawnFile: string, pawnTo: string, promoSq: string, promo: string, castle: string, mark: string) => {
    let out: string;
    if (piece) out = takes ? t("{0} schlägt auf {to}", { 0: PIECE_NAME[piece], to }) : `${PIECE_NAME[piece]} ${to}`;
    else if (pawnFile) out = t("Bauer schlägt auf {pawnTo}", { pawnTo });
    else if (promoSq) out = t("{square} wird {piece}", { square: promoSq, piece: PIECE_NAME[promo] });
    else out = castle.length > 3 ? t("lange Rochade") : t("kurze Rochade");
    if (mark === "#") out += t(", Matt");
    else if (mark === "+") out += t(" mit Schach");
    return out;
  });
}

export interface ParsedMoves {
  moves: Move[];
  /** Position after the moves (or the start position when there were none). */
  fen: string;
  /** The first token that is not a legal move here. */
  error?: string;
}

export function parseMoves(fen: string, text: string): ParsedMoves {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { moves: [], fen, error: t("Stellung (FEN) ist ungültig") };
  }
  const moves: Move[] = [];
  for (const token of moveTokens(text)) {
    try {
      moves.push(chess.move(token));
    } catch {
      return { moves, fen: chess.fen(), error: token };
    }
  }
  return { moves, fen: chess.fen() };
}

export function validFen(fen: string): boolean {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/** Position at the start of each scene and after it, following moves and jumps. Errors per scene. */
export function scenePositions(project: StudioProject): { before: string; after: string; parsed: ParsedMoves }[] {
  let fen = validFen(project.startFen) ? project.startFen : START_FEN;
  return project.scenes.map((s) => {
    const before = s.fen.trim() && validFen(s.fen.trim()) ? s.fen.trim() : fen;
    const parsed = parseMoves(before, s.moves);
    fen = parsed.fen;
    return { before, after: parsed.fen, parsed };
  });
}

// ---------- persistence ----------

const SQUARE = /^[a-h][1-8]$/;
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const str = (v: unknown, fallback = "", max = 400) => (typeof v === "string" ? v.slice(0, max) : fallback);
const colour = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
const TONE_IDS = ["accent", "good", "bad", "idea", "white"] as const;

/** Repairs a project read from storage or an imported file, so a broken field never breaks the studio. */
export function normalizeProject(raw: unknown): StudioProject {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const st = (r.style && typeof r.style === "object" ? r.style : {}) as Record<string, unknown>;
  const vi = (r.video && typeof r.video === "object" ? r.video : {}) as Record<string, unknown>;
  const theme = pick(st.theme, Object.keys(THEMES) as ThemeId[], "nova");
  const base = styleFromTheme(theme);
  const style: StudioStyle = {
    theme,
    light: colour(st.light, base.light),
    dark: colour(st.dark, base.dark),
    frame: colour(st.frame, base.frame),
    whitePiece: colour(st.whitePiece, base.whitePiece),
    blackPiece: colour(st.blackPiece, base.blackPiece),
    material: pick(st.material, Object.keys(MATERIAL_LABEL) as Material[], base.material),
    bgTop: colour(st.bgTop, base.bgTop),
    bgBottom: colour(st.bgBottom, base.bgBottom),
    accent: colour(st.accent, base.accent),
    reflection: st.reflection !== false,
    coords: st.coords === true,
    titleFont: pick(st.titleFont, ["sans", "serif"] as const, "sans"),
    environment: pick(st.environment, Object.keys(ENV_LABEL) as Environment[], "void"),
    pieceRim: st.pieceRim !== false,
    captionStyle: pick(st.captionStyle, Object.keys(CAPTION_LABEL) as CaptionStyle[], "box"),
    textScale: num(st.textScale, 0.8, 1.3, 1),
    // Projects from before the 2D board: YouTube lessons get the clearer flat board, short videos keep 3D.
    view: st.view === "2d" || st.view === "3d" || st.view === "billboard" || st.view === "reel" ? st.view : vi.lesson === true && vi.format === "16:9" ? "2d" : "3d",
  };
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const video: StudioVideo = {
    format: pick(vi.format, ["9:16", "1:1", "16:9"] as const, "9:16"),
    perspective: vi.perspective === "black" ? "black" : "white",
    plainMoves: bool(vi.plainMoves, true),
    squareHints: bool(vi.squareHints, true),
    spellMoves: bool(vi.spellMoves, true),
    fps: vi.fps === 60 ? 60 : 30,
    tempo: num(vi.tempo, 0.4, 2.5, 1),
    speed: num(vi.speed, 0.5, 2.5, 1),
    platform: pick(vi.platform, Object.keys(PLATFORM_LABEL) as Platform[], "tiktok"),
    brand: bool(vi.brand, true),
    watermark: bool(vi.watermark, true),
    progress: bool(vi.progress, true),
    movePill: bool(vi.movePill, true),
    lastMove: bool(vi.lastMove, true),
    lucena: bool(vi.lucena, true),
    sound: bool(vi.sound, true),
    volume: num(vi.volume, 0, 1.5, 1),
    introFly: bool(vi.introFly, true),
    music: pick(vi.music, Object.keys(MUSIC_LABEL) as MusicId[], "lofi"),
    musicVolume: num(vi.musicVolume, 0, 1, 0.5),
    musicStyle: pick(vi.musicStyle, ["auto", ...STYLE_IDS] as (StyleId | "auto")[], "auto"),
    musicSeed: Math.round(num(vi.musicSeed, 1, 999999, 1)),
    musicIntensity: num(vi.musicIntensity, 0, 1, 0.65),
    musicName: typeof vi.musicName === "string" ? vi.musicName.slice(0, 120) : "",
    voice: bool(vi.voice, false),
    voiceVolume: num(vi.voiceVolume, 0, 1.5, 1),
    lesson: bool(vi.lesson, false),
  };
  const scenes = (Array.isArray(r.scenes) ? r.scenes : []).slice(0, 80).map((x): Scene => {
    const s = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const arrows = (Array.isArray(s.arrows) ? s.arrows : [])
      .map((a) => a as Record<string, unknown>)
      .filter((a) => SQUARE.test(String(a?.from)) && SQUARE.test(String(a?.to)) && a.from !== a.to)
      .slice(0, 12)
      .map((a) => ({ from: String(a.from), to: String(a.to), tone: pick(a.tone, TONE_IDS, "accent") }));
    const marks = (Array.isArray(s.marks) ? s.marks : [])
      .map((m) => m as Record<string, unknown>)
      .filter((m) => SQUARE.test(String(m?.square)))
      .slice(0, 16)
      .map((m) => ({ square: String(m.square), tone: pick(m.tone, TONE_IDS, "accent") }));
    return scene({
      id: str(s.id, "", 60) || newId(),
      moves: str(s.moves, "", 600),
      fen: str(s.fen, "", 120),
      title: str(s.title, "", 120),
      text: str(s.text, "", 900),
      duration: num(s.duration, 0.3, 30, 3.5),
      camera: pick(s.camera, Object.keys(CAMERA_LABEL) as CameraPreset[], "white"),
      zoom: num(s.zoom, 0.45, 1.6, 1),
      orbit: num(s.orbit, -30, 30, 0),
      focus: s.focus === true,
      arrows,
      marks,
      card: pick(s.card, ["none", "intro", "question", "poll", "outro"] as const, "none"),
      label: str(s.label, "", 40),
      options: (Array.isArray(s.options) ? s.options : []).filter((o): o is string => typeof o === "string").slice(0, 3).map((o) => o.slice(0, 40)),
      countdown: num(s.countdown, 0, 10, 0),
      squeeze: s.squeeze === true,
      mood: pick(s.mood, ["happy", "think", "wow", "sad"] as const, "happy"),
      effects: [...new Set((Array.isArray(s.effects) ? s.effects : []).filter((e): e is Effect => typeof e === "string" && e in EFFECT_LABEL))],
      badge: BADGE_FROM_SYMBOL[String(s.badge)] ?? pick(s.badge, Object.keys(BADGE_LABEL) as Badge[], ""),
      speech: str(s.speech, "", 1200),
      tempo: num(s.tempo, 0.3, 3, 1),
      cameras: (Array.isArray(s.cameras) ? s.cameras : []).filter((c): c is CameraPreset => typeof c === "string" && c in CAMERA_LABEL).slice(0, MAX_CAMERAS),
      stamp: str(s.stamp, "", 14).toUpperCase(),
      power: Object.fromEntries(
        Object.entries(s.power && typeof s.power === "object" ? (s.power as Record<string, unknown>) : {})
          .filter(([k, v]) => k in EFFECT_LABEL && typeof v === "number" && Number.isFinite(v))
          .map(([k, v]) => [k, Math.min(1, Math.max(0, v as number))]),
      ),
    });
  });
  return {
    id: str(r.id, "", 60) || newId("p"),
    name: str(r.name, t("Neues Video"), 80) || t("Neues Video"),
    startFen: validFen(str(r.startFen, START_FEN, 120)) ? str(r.startFen, START_FEN, 120) : START_FEN,
    scenes: scenes.length ? scenes : [scene({ title: t("Neue Szene") })],
    style,
    video,
    updatedAt: num(r.updatedAt, 0, 1e15, Date.now()),
  };
}

// ---------- templates ----------

function project(name: string, scenes: Scene[], startFen = START_FEN, theme: ThemeId = "nova"): StudioProject {
  return { id: newId("p"), name, startFen, scenes, style: styleFromTheme(theme), video: { ...DEFAULT_VIDEO }, updatedAt: Date.now() };
}

const outro = (over: Partial<Scene> = {}) =>
  scene({
    card: "outro",
    title: t("Wie gut spielst du sie wirklich?"),
    text: t("Analysiere deine Partien kostenlos auf *{BRAND_DOMAIN}*", { BRAND_DOMAIN }),
    duration: 4,
    camera: "corner",
    orbit: 6,
    mood: "wow",
    ...over,
  });

export function spanishTemplate(): StudioProject {
  return project(t("So funktioniert die Spanische Eröffnung"), [
    scene({ card: "intro", title: t("Die Spanische Eröffnung"), text: t("Ruy López in 60 Sekunden"), duration: 3.6, camera: "white", orbit: 4, mood: "happy" }),
    scene({ moves: "1. e4 e5", title: t("Kampf ums Zentrum"), text: t("Beide Bauern besetzen sofort das *Zentrum*."), duration: 4, camera: "white", marks: [{ square: "d4", tone: "accent" }, { square: "d5", tone: "accent" }, { square: "e4", tone: "accent" }, { square: "e5", tone: "accent" }], mood: "think" }),
    scene({ moves: t("2. Sf3"), title: t("Druck auf e5"), text: t("Der Springer greift sofort den *Bauern auf e5* an."), duration: 3.8, camera: "corner", focus: true, arrows: [{ from: "f3", to: "e5", tone: "bad" }] }),
    scene({ moves: t("2... Sc6"), title: t("Druck auf e5"), text: t("Schwarz *deckt* e5 mit dem Springer."), duration: 3.6, camera: "corner", arrows: [{ from: "c6", to: "e5", tone: "good" }] }),
    scene({ moves: t("3. Lb5"), title: t("Das ist der Spanier!"), text: t("Der Läufer greift den *Verteidiger* von e5 an."), duration: 4.4, camera: "close", focus: true, arrows: [{ from: "b5", to: "c6", tone: "bad" }, { from: "c6", to: "e5", tone: "idea" }], marks: [{ square: "c6", tone: "bad" }], mood: "wow", effects: ["zoom"] }),
    scene({ title: t("Die Idee dahinter"), text: t("Fällt der Springer auf c6, wackelt e5. Weiß macht *langfristig Druck*."), duration: 4.6, camera: "top", arrows: [{ from: "b5", to: "c6", tone: "bad" }, { from: "f3", to: "e5", tone: "bad" }], marks: [{ square: "e5", tone: "bad" }], mood: "think" }),
    scene({ moves: "3... a6", title: t("Morphy-Verteidigung"), text: t("Schwarz stellt den Läufer *sofort zur Rede*."), duration: 3.8, camera: "corner", focus: true, arrows: [{ from: "a6", to: "b5", tone: "bad" }] }),
    scene({ moves: t("4. La4 Sf6"), title: t("Weiter im Plan"), text: t("Der Läufer bleibt auf der Diagonale, Schwarz greift *e4* an."), duration: 4.4, camera: "corner", arrows: [{ from: "a4", to: "c6", tone: "accent" }, { from: "f6", to: "e4", tone: "bad" }] }),
    scene({ moves: "5. O-O", title: t("König in Sicherheit"), text: t("Nimmt Schwarz auf e4, holt sich Weiß den Bauern mit *d4 und Te1* zurück."), duration: 4.8, camera: "low", orbit: -5, mood: "happy" }),
    outro(),
  ]);
}

export function scholarTemplate(): StudioProject {
  const afterQh5 = parseMoves(START_FEN, t("e4 e5 Lc4 Sc6 Dh5")).fen;
  return project(t("Matt in 4 Zügen – und wie du es verhinderst"), [
    scene({ card: "intro", title: t("Matt in 4 Zügen"), text: t("Die Falle, auf die fast jeder reinfällt"), duration: 3.4, camera: "white", orbit: 5, mood: "wow" }),
    scene({ moves: t("1. e4 e5 2. Lc4"), title: t("Ganz harmlos?"), text: t("Der Läufer zielt schon auf *f7*, den schwächsten Punkt."), duration: 4.2, camera: "corner", arrows: [{ from: "c4", to: "f7", tone: "bad" }], marks: [{ square: "f7", tone: "bad" }], mood: "think" }),
    scene({ moves: t("2... Sc6 3. Dh5"), title: t("Die Dame kommt"), text: t("Zwei Angreifer auf *f7*, nur der König deckt."), duration: 4.2, camera: "close", focus: true, effects: ["threat"], arrows: [{ from: "h5", to: "f7", tone: "bad" }, { from: "c4", to: "f7", tone: "bad" }] }),
    scene({ moves: t("3... Sf6??"), title: t("Der Fehler"), text: t("Schwarz greift die Dame an und *übersieht* das Matt."), duration: 3.6, camera: "corner", arrows: [{ from: "f6", to: "h5", tone: "idea" }], mood: "sad", badge: "blunder" }),
    scene({ moves: t("4. Dxf7#"), title: t("Schachmatt!"), text: t("Gedeckt vom Läufer kann der König die Dame *nicht schlagen*."), duration: 4.2, camera: "low", orbit: 8, focus: true, mood: "wow", effects: ["mate", "shake"] }),
    scene({ fen: afterQh5, moves: "3... g6", title: t("So verteidigst du"), text: t("*g6* vertreibt die Dame, bevor sie zuschlagen kann."), duration: 4.4, camera: "corner", arrows: [{ from: "g6", to: "h5", tone: "good" }], mood: "happy" }),
    scene({ fen: afterQh5, moves: t("3... De7"), title: t("Oder ganz solide"), text: t("*De7* deckt f7 und e5 auf einmal."), duration: 4, camera: "side", arrows: [{ from: "e7", to: "f7", tone: "good" }, { from: "e7", to: "e5", tone: "good" }], mood: "think" }),
    outro({ title: t("Fällst du auf Fallen rein?") }),
  ]);
}

export function puzzleTemplate(): StudioProject {
  const fen = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
  return project(
    t("Findest du den Zug?"),
    [
      scene({ card: "question", title: t("Weiß zieht und gewinnt"), text: t("Findest du den Zug?"), duration: 5, countdown: 3, camera: "white", orbit: 3, mood: "think" }),
      scene({ moves: t("Td8#"), title: t("Grundreihenmatt!"), text: t("Der König ist von den *eigenen Bauern* eingesperrt."), duration: 4.4, camera: "low", focus: true, arrows: [{ from: "d1", to: "d8", tone: "good" }], marks: [{ square: "f7", tone: "bad" }, { square: "g7", tone: "bad" }, { square: "h7", tone: "bad" }], mood: "wow", effects: ["mate"] }),
      outro({ title: t("Mehr Aufgaben aus deinen Partien") }),
    ],
    fen,
  );
}

/** The reel look on a trap and a fork: tilted grey board, glows, thick arrows, almost no words. */
export function reelTemplate(): StudioProject {
  const afterQh5 = parseMoves(START_FEN, "e4 e5 Bc4 Nc6 Qh5").fen;
  const fork = "r3k2r/8/8/3N4/8/8/8/4K3 w kq - 0 1";
  const base = project(
    t("Siehst du das Matt?"),
    [
      // No title card: a TikTok edit starts on the board, already moving, and lets the moves speak.
      // The opening is slower: two held shots, each with one quick push-in, like the reference's first seconds.
      scene({ fen: afterQh5, moves: "3... Nf6??", duration: 1.4, badge: "blunder" }),
      scene({ duration: 1.4, marks: [{ square: "f7", tone: "bad" }], arrows: [{ from: "h5", to: "f7", tone: "accent" }] }),
      // Then the beat cuts: one picture per beat from another distance and angle.
      scene({ duration: 0.6, marks: [{ square: "f7", tone: "bad" }], arrows: [{ from: "h5", to: "f7", tone: "accent" }] }),
      scene({ moves: "4. Qxf7#", duration: 0.6, badge: "brilliant", effects: ["mate", "slowmo"], arrows: [{ from: "h5", to: "f7", tone: "accent" }] }),
      scene({ fen: fork, moves: "Nc7+", duration: 0.6, badge: "best", effects: ["spotlight", "slowmo"], arrows: [{ from: "c7", to: "e8", tone: "bad" }, { from: "c7", to: "a8", tone: "bad" }] }),
      ...[0, 1, 2].map(() => scene({ duration: 0.6, marks: [{ square: "e8", tone: "bad" }, { square: "a8", tone: "bad" }], arrows: [{ from: "c7", to: "e8", tone: "bad" }, { from: "c7", to: "a8", tone: "bad" }] })),
      outro({ title: t("Mehr Taktik aus deinen Partien"), duration: 1.3 }),
    ],
    START_FEN,
    "mono",
  );
  return {
    ...base,
    style: styleFromTheme("mono", { view: "reel", titleFont: "serif", environment: "void" }),
    video: { ...DEFAULT_VIDEO, format: "1:1", platform: "reels", tempo: 2.4, lucena: false, movePill: false, music: "generated" },
  };
}

export function blankProject(): StudioProject {
  return project(t("Neues Video"), [scene({ card: "intro", title: t("Dein Titel"), text: t("Untertitel"), camera: "white" }), scene({ moves: "1. e4", title: t("Erster Zug"), text: t("Erkläre hier den Zug.") }), outro()]);
}

/** Builds an explainer from a move list: title card, one scene per move (or move pair), call to action. */
export function fromMoves(name: string, text: string, startFen = START_FEN, pairs = true): { project: StudioProject; error?: string } {
  const parsed = parseMoves(startFen, text);
  const scenes: Scene[] = [scene({ card: "intro", title: name || t("Neue Eröffnung"), text: t("Einfach erklärt"), duration: 3.4, orbit: 4 })];
  const cams: CameraPreset[] = ["white", "corner", "close", "side", "top"];
  const fullmove = Number(startFen.split(" ")[5]) || 1;
  const whiteFirst = (startFen.split(" ")[1] ?? "w") === "w";
  let i = 0;
  let n = 0;
  while (i < parsed.moves.length) {
    const take = pairs && parsed.moves[i].color === "w" && parsed.moves[i + 1] ? 2 : 1;
    const group = parsed.moves.slice(i, i + take);
    const label = group
      .map((m, k) => {
        const ply = i + k + (whiteFirst ? 0 : 1);
        const no = fullmove + Math.floor(ply / 2);
        return m.color === "w" ? `${no}. ${displaySan(m.san)}` : k === 0 ? `${no}... ${displaySan(m.san)}` : displaySan(m.san);
      })
      .join(" ");
    scenes.push(scene({ moves: label, title: label, text: t("Erkläre hier, worum es geht."), camera: cams[n % cams.length], focus: n % 2 === 1, duration: 3.6 + take * 0.6 }));
    i += take;
    n += 1;
  }
  scenes.push(outro());
  return { project: project(name || t("Neue Eröffnung"), scenes, startFen), error: parsed.error };
}

export const TEMPLATES: { id: string; label: string; hint: string; make: () => StudioProject }[] = [
  { id: "spanish", label: t("Eröffnung erklären"), hint: t("Beispiel: die Spanische Eröffnung, Zug für Zug"), make: spanishTemplate },
  { id: "scholar", label: t("Falle zeigen"), hint: t("Matt in 4 Zügen und die richtige Verteidigung"), make: scholarTemplate },
  { id: "puzzle", label: t("Rätsel mit Countdown"), hint: t("Stellung, Frage, 3-2-1, Lösung"), make: puzzleTemplate },
  { id: "reel", label: t("Reel-Stil"), hint: t("Schwarz-Weiß, schräge Kamera, Glühen: wie die schnellen Clips"), make: reelTemplate },
  { id: "blank", label: t("Leeres Video"), hint: t("Titel, eine Szene, Abspann"), make: blankProject },
];
