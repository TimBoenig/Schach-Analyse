// The video studio's project format: a list of scenes (moves, texts, arrows,
// camera) plus one look and one set of video options. Pure data and rules, no
// browser APIs, so templates and validation are tested headless.
import { Chess, type Move } from "chess.js";

import { BRAND_DOMAIN } from "../../brand";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type Tone = "accent" | "good" | "bad" | "idea" | "white";
export type Mood = "happy" | "think" | "wow" | "sad";
export type CameraPreset = "white" | "black" | "top" | "corner" | "side" | "low" | "close";
/** A full-screen card over the board: opening title, question with countdown, or the closing call to action. */
export type Card = "none" | "intro" | "question" | "outro";

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
  /** Subtitle; words in *stars* are drawn in the accent colour. */
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
  /** Seconds of a visible countdown (question cards). */
  countdown: number;
  mood: Mood;
}

export type ThemeId = "nova" | "marmor" | "holz" | "turnier" | "neon";
export type Material = "porcelain" | "chrome" | "matte";

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
}

export type Format = "9:16" | "1:1" | "16:9";

export interface StudioVideo {
  format: Format;
  fps: 30 | 60;
  /** Speed of the piece moves, 1 = normal. */
  tempo: number;
  brand: boolean;
  watermark: boolean;
  progress: boolean;
  movePill: boolean;
  lastMove: boolean;
  lucena: boolean;
  sound: boolean;
  introFly: boolean;
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

export const THEMES: Record<ThemeId, { label: string } & Omit<StudioStyle, "theme" | "reflection" | "coords" | "titleFont">> = {
  nova: { label: "Nova", light: "#d3d8e6", dark: "#4b5675", frame: "#121620", whitePiece: "#f3f1ec", blackPiece: "#1b1d24", material: "porcelain", bgTop: "#1a2140", bgBottom: "#05060a", accent: "#8d9aff" },
  marmor: { label: "Marmor", light: "#ece9e3", dark: "#8b909b", frame: "#26292f", whitePiece: "#f7f5f0", blackPiece: "#16171b", material: "porcelain", bgTop: "#2c313b", bgBottom: "#08090b", accent: "#3fd2ea" },
  holz: { label: "Holz", light: "#e9d0a5", dark: "#a5714a", frame: "#43291a", whitePiece: "#f4eadb", blackPiece: "#2a1a12", material: "matte", bgTop: "#2b1e15", bgBottom: "#0a0705", accent: "#ff9d5c" },
  turnier: { label: "Turnier", light: "#eeeed2", dark: "#769656", frame: "#27301f", whitePiece: "#f6f4ee", blackPiece: "#1c1d1f", material: "porcelain", bgTop: "#1c2618", bgBottom: "#060805", accent: "#34d3a1" },
  neon: { label: "Neon", light: "#2b3050", dark: "#141729", frame: "#0a0c18", whitePiece: "#eaf6ff", blackPiece: "#40307a", material: "chrome", bgTop: "#22104a", bgBottom: "#04030b", accent: "#3fd2ea" },
};

export const TONES: Record<Exclude<Tone, "accent">, string> = {
  good: "#34d3a1",
  bad: "#ff6b6b",
  idea: "#ffb84d",
  white: "#ffffff",
};
export const TONE_LABEL: Record<Tone, string> = { accent: "Akzent", good: "Gut", bad: "Gefahr", idea: "Idee", white: "Weiß" };

export function toneColor(tone: Tone, style: StudioStyle): string {
  return tone === "accent" ? style.accent : TONES[tone];
}

export const CAMERA_LABEL: Record<CameraPreset, string> = {
  white: "Weiß-Sicht",
  black: "Schwarz-Sicht",
  top: "Von oben",
  corner: "Schräg",
  side: "Seitlich",
  low: "Tief & dramatisch",
  close: "Nah dran",
};
export const CARD_LABEL: Record<Card, string> = { none: "Keine", intro: "Titelkarte", question: "Frage + Countdown", outro: "Abspann" };
export const MOOD_LABEL: Record<Mood, string> = { happy: "Fröhlich", think: "Nachdenklich", wow: "Begeistert", sad: "Traurig" };
export const FORMAT_SIZE: Record<Format, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080] };

export function styleFromTheme(theme: ThemeId, keep?: Partial<StudioStyle>): StudioStyle {
  const { label: _label, ...colours } = THEMES[theme];
  return { reflection: true, coords: false, titleFont: "sans", ...keep, ...colours, theme };
}

export const DEFAULT_VIDEO: StudioVideo = {
  format: "9:16",
  fps: 30,
  tempo: 1,
  brand: true,
  watermark: true,
  progress: true,
  movePill: true,
  lastMove: true,
  lucena: true,
  sound: true,
  introFly: true,
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
    countdown: 0,
    mood: "happy",
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
    .map((t) => t.replace(/^\d+\.+/, "").replace(/[!?]+$/g, "").trim())
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .map((t) =>
      t
        .replace(/^0-0-0/, "O-O-O")
        .replace(/^0-0/, "O-O")
        .replace(/^[SLTDK](?=[a-h1-8x])/, (p) => TO_ENGLISH[p])
        .replace(/=([SLTD])/, (_m, p: string) => `=${TO_ENGLISH[p]}`),
    );
}

/** SAN with German piece letters, as the app shows moves (Sf3, Lb5, Dxf7#). */
export function germanSan(san: string): string {
  return san.replace(/^[NBRQK]/, (p) => TO_GERMAN[p]).replace(/=([NBRQ])/, (_m, p: string) => `=${TO_GERMAN[p]}`);
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
    return { moves: [], fen, error: "Stellung (FEN) ist ungültig" };
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
    material: pick(st.material, ["porcelain", "chrome", "matte"] as const, base.material),
    bgTop: colour(st.bgTop, base.bgTop),
    bgBottom: colour(st.bgBottom, base.bgBottom),
    accent: colour(st.accent, base.accent),
    reflection: st.reflection !== false,
    coords: st.coords === true,
    titleFont: pick(st.titleFont, ["sans", "serif"] as const, "sans"),
  };
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const video: StudioVideo = {
    format: pick(vi.format, ["9:16", "1:1", "16:9"] as const, "9:16"),
    fps: vi.fps === 60 ? 60 : 30,
    tempo: num(vi.tempo, 0.4, 2.5, 1),
    brand: bool(vi.brand, true),
    watermark: bool(vi.watermark, true),
    progress: bool(vi.progress, true),
    movePill: bool(vi.movePill, true),
    lastMove: bool(vi.lastMove, true),
    lucena: bool(vi.lucena, true),
    sound: bool(vi.sound, true),
    introFly: bool(vi.introFly, true),
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
      text: str(s.text, "", 300),
      duration: num(s.duration, 1, 30, 3.5),
      camera: pick(s.camera, Object.keys(CAMERA_LABEL) as CameraPreset[], "white"),
      zoom: num(s.zoom, 0.45, 1.6, 1),
      orbit: num(s.orbit, -30, 30, 0),
      focus: s.focus === true,
      arrows,
      marks,
      card: pick(s.card, ["none", "intro", "question", "outro"] as const, "none"),
      countdown: num(s.countdown, 0, 10, 0),
      mood: pick(s.mood, ["happy", "think", "wow", "sad"] as const, "happy"),
    });
  });
  return {
    id: str(r.id, "", 60) || newId("p"),
    name: str(r.name, "Neues Video", 80) || "Neues Video",
    startFen: validFen(str(r.startFen, START_FEN, 120)) ? str(r.startFen, START_FEN, 120) : START_FEN,
    scenes: scenes.length ? scenes : [scene({ title: "Neue Szene" })],
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
    title: "Wie gut spielst du sie wirklich?",
    text: `Analysiere deine Partien kostenlos auf *${BRAND_DOMAIN}*`,
    duration: 4,
    camera: "corner",
    orbit: 6,
    mood: "wow",
    ...over,
  });

export function spanishTemplate(): StudioProject {
  return project("So funktioniert die Spanische Eröffnung", [
    scene({ card: "intro", title: "Die Spanische Eröffnung", text: "Ruy López in 60 Sekunden", duration: 3.6, camera: "white", orbit: 4, mood: "happy" }),
    scene({ moves: "1. e4 e5", title: "Kampf ums Zentrum", text: "Beide Bauern besetzen sofort das *Zentrum*.", duration: 4, camera: "white", marks: [{ square: "d4", tone: "accent" }, { square: "d5", tone: "accent" }, { square: "e4", tone: "accent" }, { square: "e5", tone: "accent" }], mood: "think" }),
    scene({ moves: "2. Sf3", title: "Druck auf e5", text: "Der Springer greift sofort den *Bauern auf e5* an.", duration: 3.8, camera: "corner", focus: true, arrows: [{ from: "f3", to: "e5", tone: "bad" }] }),
    scene({ moves: "2... Sc6", title: "Druck auf e5", text: "Schwarz *deckt* e5 mit dem Springer.", duration: 3.6, camera: "corner", arrows: [{ from: "c6", to: "e5", tone: "good" }] }),
    scene({ moves: "3. Lb5", title: "Das ist der Spanier!", text: "Der Läufer greift den *Verteidiger* von e5 an.", duration: 4.4, camera: "close", focus: true, arrows: [{ from: "b5", to: "c6", tone: "bad" }, { from: "c6", to: "e5", tone: "idea" }], marks: [{ square: "c6", tone: "bad" }], mood: "wow" }),
    scene({ title: "Die Idee dahinter", text: "Fällt der Springer auf c6, wackelt e5. Weiß macht *langfristig Druck*.", duration: 4.6, camera: "top", arrows: [{ from: "b5", to: "c6", tone: "bad" }, { from: "f3", to: "e5", tone: "bad" }], marks: [{ square: "e5", tone: "bad" }], mood: "think" }),
    scene({ moves: "3... a6", title: "Morphy-Verteidigung", text: "Schwarz stellt den Läufer *sofort zur Rede*.", duration: 3.8, camera: "black", focus: true, arrows: [{ from: "a6", to: "b5", tone: "bad" }] }),
    scene({ moves: "4. La4 Sf6", title: "Weiter im Plan", text: "Der Läufer bleibt auf der Diagonale, Schwarz greift *e4* an.", duration: 4.4, camera: "corner", arrows: [{ from: "a4", to: "c6", tone: "accent" }, { from: "f6", to: "e4", tone: "bad" }] }),
    scene({ moves: "5. O-O", title: "König in Sicherheit", text: "Nimmt Schwarz auf e4, holt sich Weiß den Bauern mit *d4 und Te1* zurück.", duration: 4.8, camera: "low", orbit: -5, mood: "happy" }),
    outro(),
  ]);
}

export function scholarTemplate(): StudioProject {
  const afterQh5 = parseMoves(START_FEN, "e4 e5 Lc4 Sc6 Dh5").fen;
  return project("Matt in 4 Zügen – und wie du es verhinderst", [
    scene({ card: "intro", title: "Matt in 4 Zügen", text: "Die Falle, auf die fast jeder reinfällt", duration: 3.4, camera: "white", orbit: 5, mood: "wow" }),
    scene({ moves: "1. e4 e5 2. Lc4", title: "Ganz harmlos?", text: "Der Läufer zielt schon auf *f7*, den schwächsten Punkt.", duration: 4.2, camera: "corner", arrows: [{ from: "c4", to: "f7", tone: "bad" }], marks: [{ square: "f7", tone: "bad" }], mood: "think" }),
    scene({ moves: "2... Sc6 3. Dh5", title: "Die Dame kommt", text: "Zwei Angreifer auf *f7*, nur der König deckt.", duration: 4.2, camera: "close", focus: true, arrows: [{ from: "h5", to: "f7", tone: "bad" }, { from: "c4", to: "f7", tone: "bad" }] }),
    scene({ moves: "3... Sf6??", title: "Der Fehler", text: "Schwarz greift die Dame an und *übersieht* das Matt.", duration: 3.6, camera: "black", arrows: [{ from: "f6", to: "h5", tone: "idea" }], mood: "sad" }),
    scene({ moves: "4. Dxf7#", title: "Schachmatt!", text: "Gedeckt vom Läufer kann der König die Dame *nicht schlagen*.", duration: 4.2, camera: "low", orbit: 8, focus: true, mood: "wow" }),
    scene({ fen: afterQh5, moves: "3... g6", title: "So verteidigst du", text: "*g6* vertreibt die Dame, bevor sie zuschlagen kann.", duration: 4.4, camera: "corner", arrows: [{ from: "g6", to: "h5", tone: "good" }], mood: "happy" }),
    scene({ fen: afterQh5, moves: "3... De7", title: "Oder ganz solide", text: "*De7* deckt f7 und e5 auf einmal.", duration: 4, camera: "black", arrows: [{ from: "e7", to: "f7", tone: "good" }, { from: "e7", to: "e5", tone: "good" }], mood: "think" }),
    outro({ title: "Fällst du auf Fallen rein?" }),
  ]);
}

export function puzzleTemplate(): StudioProject {
  const fen = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
  return project(
    "Findest du den Zug?",
    [
      scene({ card: "question", title: "Weiß zieht und gewinnt", text: "Findest du den Zug?", duration: 5, countdown: 3, camera: "white", orbit: 3, mood: "think" }),
      scene({ moves: "Td8#", title: "Grundreihenmatt!", text: "Der König ist von den *eigenen Bauern* eingesperrt.", duration: 4.4, camera: "low", focus: true, arrows: [{ from: "d1", to: "d8", tone: "good" }], marks: [{ square: "f7", tone: "bad" }, { square: "g7", tone: "bad" }, { square: "h7", tone: "bad" }], mood: "wow" }),
      outro({ title: "Mehr Aufgaben aus deinen Partien" }),
    ],
    fen,
  );
}

export function blankProject(): StudioProject {
  return project("Neues Video", [scene({ card: "intro", title: "Dein Titel", text: "Untertitel", camera: "white" }), scene({ moves: "1. e4", title: "Erster Zug", text: "Erkläre hier den Zug." }), outro()]);
}

/** Builds an explainer from a move list: title card, one scene per move (or move pair), call to action. */
export function fromMoves(name: string, text: string, startFen = START_FEN, pairs = true): { project: StudioProject; error?: string } {
  const parsed = parseMoves(startFen, text);
  const scenes: Scene[] = [scene({ card: "intro", title: name || "Neue Eröffnung", text: "Einfach erklärt", duration: 3.4, orbit: 4 })];
  const cams: CameraPreset[] = ["white", "corner", "close", "black", "side", "top"];
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
        return m.color === "w" ? `${no}. ${germanSan(m.san)}` : k === 0 ? `${no}... ${germanSan(m.san)}` : germanSan(m.san);
      })
      .join(" ");
    scenes.push(scene({ moves: label, title: label, text: "Erkläre hier, worum es geht.", camera: cams[n % cams.length], focus: n % 2 === 1, duration: 3.6 + take * 0.6 }));
    i += take;
    n += 1;
  }
  scenes.push(outro());
  return { project: project(name || "Neue Eröffnung", scenes, startFen), error: parsed.error };
}

export const TEMPLATES: { id: string; label: string; hint: string; make: () => StudioProject }[] = [
  { id: "spanish", label: "Eröffnung erklären", hint: "Beispiel: die Spanische Eröffnung, Zug für Zug", make: spanishTemplate },
  { id: "scholar", label: "Falle zeigen", hint: "Matt in 4 Zügen und die richtige Verteidigung", make: scholarTemplate },
  { id: "puzzle", label: "Rätsel mit Countdown", hint: "Stellung, Frage, 3-2-1, Lösung", make: puzzleTemplate },
  { id: "blank", label: "Leeres Video", hint: "Titel, eine Szene, Abspann", make: blankProject },
];
