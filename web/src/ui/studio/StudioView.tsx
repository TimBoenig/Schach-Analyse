// The hidden video studio: prepare a chess explainer as scenes (moves, texts,
// arrows, camera) on a 3D board and export it as a vertical video for TikTok,
// Reels or Shorts, with the EndGameKing branding in the picture.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { BRAND, FILE_PREFIX } from "../../brand";
import { navigate } from "../router";
import { StudioAudio, mixHasSound, type AudioMix } from "./audio";
import { canExportFast, exportFast } from "./fastExport";
import { deleteClip, loadClip, saveClip, type ClipKind } from "./audioStore";
import { MUSIC_LABEL, type MusicId } from "./music";
import { STYLE_HINT, STYLE_IDS, STYLE_LABEL, generateMusic, planKey, planMusic, type GenSpec, type StyleId } from "./musicGen";
import {
  BADGE_FILE,
  BADGE_LABEL,
  CAMERA_LABEL,
  CARD_LABEL,
  EFFECT_LABEL,
  ENV_LABEL,
  FORMAT_SIZE,
  MAX_CAMERAS,
  PLATFORM_LABEL,
  powerOf,
  fromMoves,
  MOOD_LABEL,
  newId,
  normalizeProject,
  scene as makeScene,
  scenePositions,
  START_FEN,
  styleFromTheme,
  TEMPLATES,
  THEMES,
  TONE_LABEL,
  toneColor,
  validFen,
  type Badge,
  type CameraPreset,
  type Card,
  type Effect,
  type Environment,
  type Format,
  type Platform,
  type Material,
  type Mood,
  type Scene,
  type Side,
  type StudioProject,
  type StudioStyle,
  type StudioVideo,
  type ThemeId,
  type Tone,
  CAPTION_LABEL,
  VIEW_LABEL,
  VIEWS,
  isBoard3d,
  type BoardView,
  MATERIAL_LABEL,
  type CaptionStyle,
} from "./model";
import { Assistant, MoveRecorder } from "./Assistant";
import { AiImport } from "./AiImport";
import { EditHelp } from "./EditHelp";
import { speechSheet } from "./aiScript";
import { download, recordVideo, videoType } from "./record";
import { autoScene, distributeScript, fitLength, movesLabel, variationScene, type Cursor, type GameTree } from "./wizard";
import { Chess } from "chess.js";
import { StudioStage } from "./stage";
import { currentId, loadProjects, saveProjects, setCurrentId } from "./store";
import { compile, REEL_BEAT, type Timeline } from "./timeline";
import { t, dec, changeStudioLang, LANG_NAMES, LANGS, siteLang, studioSetting, type StudioLang } from "../../i18n";

type Tab = "szene" | "stil" | "video" | "edit";
type Tool = "none" | "arrow" | "mark";

interface ExportState {
  phase: "recording" | "done" | "error";
  progress: number;
  url?: string;
  blob?: Blob;
  ext?: string;
  error?: string;
  /** What the finished file carries: AAC/Opus sound track, "recorded" (real-time capture), nothing (silent mix) or lost (sound was wanted but could not be encoded). */
  sound?: "aac" | "opus" | "recorded" | "none" | "lost";
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Moment of a scene that shows its finished state (moves done, arrows drawn). */
function showcase(timeline: Timeline, index: number): number {
  const c = timeline.scenes[index];
  if (!c) return 0;
  return c.start + Math.min(c.dur - 0.05, c.annotate + 0.9);
}

export function StudioView() {
  const [projects, setProjects] = useState<StudioProject[]>(loadProjects);
  const [projectId, setProjectId] = useState<string>(() => {
    const id = currentId();
    return projects.find((p) => p.id === id)?.id ?? projects[0].id;
  });
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const [selRaw, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>("szene");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<Tool>("none");
  const [tone, setTone] = useState<Tone>("accent");
  const [pending, setPending] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [safe, setSafe] = useState(true);
  const [dialog, setDialog] = useState<"new" | "templates" | "script" | "board" | "ai" | null>(null);
  const [exp, setExp] = useState<ExportState | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<StudioStage | null>(null);
  const soundsRef = useRef<StudioAudio | null>(null);
  const [ready, setReady] = useState(false);
  const timeline = useMemo(() => compile(project), [project]);
  const positions = useMemo(() => scenePositions(project), [project]);
  // The index can be stale for a moment (another project with fewer scenes): always edit the scene that is shown.
  const sel = Math.min(selRaw, project.scenes.length - 1);
  const scene = project.scenes[sel];
  const playRef = useRef({ start: 0, from: 0 });
  const cancelRef = useRef(false);

  // ---- music and own voice (kept in IndexedDB, decoded once per project)
  const [clips, setClips] = useState<{ id: string; music: AudioBuffer | null; voice: AudioBuffer | null }>({ id: "", music: null, voice: null });
  const [voiceRec, setVoiceRec] = useState<{ recorder: MediaRecorder; stop: () => void } | null>(null);
  const [audioError, setAudioError] = useState("");
  const audio = () => (soundsRef.current ??= new StudioAudio());
  useEffect(() => {
    let live = true;
    const id = project.id;
    void (async () => {
      const decode = async (kind: ClipKind) => {
        const blob = await loadClip(id, kind);
        if (!blob) return null;
        try {
          return await audio().decode(await blob.arrayBuffer());
        } catch {
          return null;
        }
      };
      const [music, voice] = [await decode("music"), await decode("voice")];
      if (live) setClips({ id, music, voice });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  // ---- generated soundtrack: rendered for this very video, kept while nothing that matters changes
  const GEN_RATE = 44100;
  const plan = useMemo(() => planMusic(project, timeline, GEN_RATE), [project, timeline]);
  const key = planKey(plan);
  const [gen, setGen] = useState<{ key: string; buf: AudioBuffer } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [previewing, setPreviewing] = useState<StyleId | null>(null);
  const previewRef = useRef<AudioBufferSourceNode | null>(null);
  const renderGen = async (spec: GenSpec): Promise<AudioBuffer> => {
    const g = await generateMusic(spec);
    const buf = audio().ctx.createBuffer(2, g.left.length, spec.rate);
    buf.copyToChannel(g.left as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(g.right as Float32Array<ArrayBuffer>, 1);
    return buf;
  };
  useEffect(() => {
    if (project.video.music !== "generated" || gen?.key === key) return;
    let live = true;
    // A short pause, so dragging a slider does not start a render for every step.
    const timer = setTimeout(() => {
      setGenBusy(true);
      renderGen(plan)
        .then((buf) => live && setGen({ key, buf }))
        .catch(() => undefined)
        .finally(() => live && setGenBusy(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, project.video.music]);
  const stopPreview = () => {
    try {
      previewRef.current?.stop();
    } catch {
      // already over
    }
    previewRef.current = null;
    setPreviewing(null);
  };
  /** Twelve seconds of a style with a drop at 8 s, to hear what it sounds like. */
  const preview = async (style: StyleId) => {
    if (previewing === style) return stopPreview();
    stopPreview();
    setPreviewing(style);
    try {
      const reel = project.style.view === "reel";
      const spec: GenSpec = { style, seed: project.video.musicSeed, intensity: project.video.musicIntensity, duration: 12, rate: GEN_RATE, bpm: reel ? 90 : undefined, cues: [{ t: 8, kind: "drop" }] };
      const buf = await renderGen(spec);
      const ctx = audio().ctx as AudioContext;
      await ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.9 * project.video.musicVolume * 1.4;
      src.connect(g).connect(ctx.destination);
      src.onended = () => previewRef.current === src && stopPreview();
      previewRef.current = src;
      src.start();
    } catch {
      setPreviewing(null);
    }
  };
  const mix = (genBuf: AudioBuffer | null = gen?.key === key ? gen.buf : null): AudioMix => {
    const v = project.video;
    const own = clips.id === project.id ? clips : { music: null, voice: null };
    return { music: v.music, musicVolume: v.musicVolume, musicFile: own.music, musicGen: genBuf, voice: v.voice ? own.voice : null, voiceVolume: v.voiceVolume, effects: v.sound, master: v.volume };
  };
  const storeClip = async (kind: ClipKind, blob: Blob, name = "") => {
    try {
      const buf = await audio().decode(await blob.arrayBuffer());
      await saveClip(project.id, kind, blob);
      setClips((c) => ({ ...(c.id === project.id ? c : { id: project.id, music: null, voice: null }), [kind]: buf }));
      setVideo(kind === "voice" ? { voice: true } : { music: "file", musicName: name });
      setAudioError("");
    } catch {
      setAudioError(kind === "voice" ? t("Die Aufnahme ließ sich nicht speichern.") : t("Diese Datei kann der Browser nicht abspielen. Nimm MP3, M4A, WAV oder OGG."));
    }
  };
  const removeVoice = () => {
    void deleteClip(project.id, "voice");
    setClips((c) => ({ ...c, voice: null }));
    setVideo({ voice: false });
  };
  const startVoice = async () => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const recorder = new MediaRecorder(mic);
      const parts: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
      recorder.onstop = () => {
        mic.getTracks().forEach((tk) => tk.stop());
        setVoiceRec(null);
        if (parts.length) void storeClip("voice", new Blob(parts, { type: recorder.mimeType || "audio/webm" }));
      };
      const stop = () => recorder.state !== "inactive" && recorder.stop();
      setVoiceRec({ recorder, stop });
      setTime(0);
      recorder.start();
      setPlaying(true);
    } catch {
      setAudioError(t("Kein Zugriff aufs Mikrofon. Erlaub es in der Adressleiste und versuch es nochmal."));
    }
  };

  // ---- saving (debounced; quota errors are shown, not thrown)
  useEffect(() => {
    const id = window.setTimeout(() => setSaveError(!saveProjects(projects)), 400);
    return () => window.clearTimeout(id);
  }, [projects]);
  const firstProject = useRef(true);
  useEffect(() => {
    setCurrentId(project.id);
    // Another project: start at its first scene instead of the old position.
    if (firstProject.current) firstProject.current = false;
    else {
      setPlaying(false);
      setSel(0);
      setTime(0);
      setPending(null);
    }
  }, [project.id]);
  // A shorter video must not leave the playhead beyond its end.
  useEffect(() => {
    if (time > timeline.total) setTime(timeline.total);
  }, [timeline.total]);

  // Undo and redo: a snapshot of the project before each burst of changes (typing in a field is one burst).
  const history = useRef<{ id: string; past: StudioProject[]; future: StudioProject[]; at: number }>({ id: project.id, past: [], future: [], at: 0 });
  if (history.current.id !== project.id) history.current = { id: project.id, past: [], future: [], at: 0 };
  const update = (fn: (p: StudioProject) => StudioProject) => {
    const h = history.current;
    const now = Date.now();
    if (!h.past.length || now - h.at > 700) {
      h.past.push(project);
      if (h.past.length > 80) h.past.shift();
    }
    h.at = now;
    h.future = [];
    setProjects((list) => list.map((p) => (p.id === project.id ? { ...fn(p), updatedAt: now } : p)));
  };
  const travel = (from: "past" | "future") => {
    const h = history.current;
    const target = h[from].pop();
    if (!target) return;
    h[from === "past" ? "future" : "past"].push(project);
    h.at = 0;
    setPlaying(false);
    setSel((i) => Math.min(i, target.scenes.length - 1));
    setProjects((list) => list.map((p) => (p.id === project.id ? { ...target, updatedAt: Date.now() } : p)));
  };
  const undo = () => travel("past");
  const redo = () => travel("future");
  const updateScene = (patch: Partial<Scene>, index = sel) =>
    update((p) => ({ ...p, scenes: p.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  const setStyle = (patch: Partial<StudioStyle>) => update((p) => ({ ...p, style: { ...p.style, ...patch } }));
  const setVideo = (patch: Partial<StudioVideo>) => update((p) => ({ ...p, video: { ...p.video, ...patch } }));

  // ---- stage setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const stage = new StudioStage(canvas);
      stageRef.current = stage;
      void stage.load().then(() => setReady(true));
      return () => stage.destroy();
    } catch (e) {
      setGlError(e instanceof Error ? e.message : t("WebGL fehlt"));
    }
  }, []);
  useEffect(() => () => soundsRef.current?.close(), []);

  // Preview at the size it is shown (sharp on retina, light on the GPU).
  const [W, H] = FORMAT_SIZE[project.video.format];
  const [box, setBox] = useState({ w: 400, h: 700 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = Math.min(box.w / W, box.h / H);
  const view = { w: Math.max(50, Math.floor(W * fit)), h: Math.max(50, Math.floor(H * fit)) };
  const previewScale = Math.min(1, (Math.min(window.devicePixelRatio || 1, 2) * view.w) / W);

  const paint = (tk: number) => {
    const stage = stageRef.current;
    if (!stage || exp?.phase === "recording") return;
    stage.setSize(Math.round(W * previewScale), Math.round(H * previewScale));
    stage.paint(timeline, project, tk, { safeZones: safe, hover: tool !== "none" && hover ? { square: hover, from: pending ?? undefined } : null });
  };

  useEffect(() => {
    if (!playing && ready) paint(time);
  });

  // ---- playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    playRef.current = { start: performance.now(), from: time >= timeline.total - 0.05 ? 0 : time };
    // While the voice is being recorded the speakers stay quiet, so the microphone hears only the voice.
    if (!voiceRec) {
      audio().speakers(true);
      audio().schedule(timeline, playRef.current.from, mix());
    }
    const loop = () => {
      const tk = playRef.current.from + (performance.now() - playRef.current.start) / 1000;
      if (tk >= timeline.total) {
        setTime(timeline.total);
        setPlaying(false);
        voiceRec?.stop();
        paint(timeline.total);
        return;
      }
      paint(tk);
      setTime(tk);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      soundsRef.current?.cancel();
      voiceRec?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline]);

  // Selected scene follows the playhead while playing.
  useEffect(() => {
    if (!playing) return;
    const i = timeline.scenes.findIndex((c) => time >= c.start && time < c.start + c.dur);
    if (i >= 0 && i !== sel) setSel(i);
  }, [time, playing]);

  const selectScene = (i: number) => {
    setPlaying(false);
    setSel(i);
    setPending(null);
    setTime(showcase(timeline, i));
  };

  // ---- keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") selectScene(Math.min(project.scenes.length - 1, sel + 1));
      else if (e.key === "ArrowLeft") selectScene(Math.max(0, sel - 1));
      else if (e.key === "Escape") {
        setTool("none");
        setPending(null);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  // ---- drawing on the board
  const squareFromEvent = (e: MouseEvent): string | null => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return null;
    const r = canvas.getBoundingClientRect();
    return stage.squareAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const onBoardClick = (e: MouseEvent) => {
    if (tool === "none") return;
    const sq = squareFromEvent(e);
    if (!sq) return;
    if (tool === "mark") {
      const has = scene.marks.some((m) => m.square === sq);
      updateScene({ marks: has ? scene.marks.filter((m) => m.square !== sq) : [...scene.marks, { square: sq, tone }] });
      return;
    }
    if (!pending) return setPending(sq);
    if (pending !== sq) {
      const exists = scene.arrows.some((a) => a.from === pending && a.to === sq);
      updateScene({ arrows: exists ? scene.arrows.filter((a) => !(a.from === pending && a.to === sq)) : [...scene.arrows, { from: pending, to: sq, tone }] });
    }
    setPending(null);
  };

  // ---- scenes
  const addScene = () => {
    const base = scene;
    const fresh = makeScene({ camera: base.camera, title: base.card === "none" ? base.title : "", mood: base.mood });
    update((p) => ({ ...p, scenes: [...p.scenes.slice(0, sel + 1), fresh, ...p.scenes.slice(sel + 1)] }));
    setSel(sel + 1);
  };
  const moveScene = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= project.scenes.length) return;
    update((p) => {
      const list = p.scenes.slice();
      [list[i], list[j]] = [list[j], list[i]];
      return { ...p, scenes: list };
    });
    setSel(j);
  };
  const duplicateScene = (i: number) => {
    update((p) => ({ ...p, scenes: [...p.scenes.slice(0, i + 1), { ...p.scenes[i], id: newId(), moves: "" }, ...p.scenes.slice(i + 1)] }));
    setSel(i + 1);
  };
  const removeScene = (i: number) => {
    if (project.scenes.length <= 1) return;
    update((p) => ({ ...p, scenes: p.scenes.filter((_, k) => k !== i) }));
    // Removing a scene above the selected one keeps the same scene selected.
    setSel(Math.max(0, Math.min(i < sel ? sel - 1 : sel, project.scenes.length - 2)));
  };

  // ---- projects
  const openProject = (p: StudioProject) => {
    setProjects((list) => [p, ...list]);
    setProjectId(p.id);
    setSel(0);
    setTime(0);
    setDialog(null);
  };
  const removeProject = () => {
    if (!confirmDelete()) return;
    const rest = projects.filter((p) => p.id !== project.id);
    const next = rest.length ? rest : [TEMPLATES[0].make()];
    setProjects(next);
    setProjectId(next[0].id);
    setSel(0);
  };
  const exportJson = () => download(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), `${FILE_PREFIX}-studio-${slug(project.name)}.json`);
  const importJson = async (file: File) => {
    try {
      const p = normalizeProject(JSON.parse(await file.text()));
      openProject({ ...p, id: newId("p"), updatedAt: Date.now() });
    } catch {
      window.alert?.(t("Die Datei ist kein lesbares Studio-Projekt."));
    }
  };

  // ---- export
  const startExport = async () => {
    setPlaying(false);
    const out = document.createElement("canvas");
    let stage: StudioStage;
    try {
      stage = new StudioStage(out);
      await stage.load();
    } catch (e) {
      setExp({ phase: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    stage.setSize(W, H);
    cancelRef.current = false;
    setExp({ phase: "recording", progress: 0 });
    const sounds = audio();
    // The generated music is rendered for this exact video first (a few seconds), so the file always carries the current track.
    let genBuf = gen?.key === key ? gen.buf : null;
    if (project.video.music === "generated" && !genBuf) {
      try {
        genBuf = await renderGen(plan);
      } catch {
        genBuf = null;
      }
    }
    const audioMix = mix(genBuf);
    let soundResult: ExportState["sound"] = mixHasSound(audioMix, timeline) ? "recorded" : "none";
    const progress = (k: number) => setExp((x) => (x && x.phase === "recording" ? { ...x, progress: k } : x));
    // Fast path: frames as fast as the device renders them, no waiting for the video's length.
    if (await canExportFast(W, H, project.video.fps, true)) {
      try {
        const blob = await exportFast({
          canvas: out,
          fps: project.video.fps,
          duration: timeline.total,
          paint: (tk) => stage.paint(timeline, project, tk),
          timeline,
          mix: audioMix,
          onProgress: progress,
          onAudio: ({ codec }) => (soundResult = codec !== "none" ? codec : mixHasSound(audioMix, timeline) ? "lost" : "none"),
          isCancelled: () => cancelRef.current,
        });
        stage.destroy();
        if (!blob) return setExp(null);
        setExp({ phase: "done", progress: 1, blob, url: URL.createObjectURL(blob), ext: "mp4", sound: soundResult });
        return;
      } catch {
        // Some encoder setups fail late; the real-time recording below still works there.
        if (cancelRef.current) return setExp(null);
        progress(0);
      }
    }
    sounds.speakers(false);
    try {
      if (!sounds.stream) throw new Error(t("Ton fehlt"));
      const { blob, type } = await recordVideo({
        canvas: out,
        fps: project.video.fps,
        duration: timeline.total,
        paint: (tk) => stage.paint(timeline, project, tk),
        audio: sounds.stream.stream,
        onStart: () => sounds.schedule(timeline, 0, audioMix),
        onProgress: progress,
        isCancelled: () => cancelRef.current,
      });
      stage.destroy();
      sounds.speakers(true);
      if (cancelRef.current) return setExp(null);
      setExp({ phase: "done", progress: 1, blob, url: URL.createObjectURL(blob), ext: type.ext, sound: soundResult });
    } catch (e) {
      sounds.speakers(true);
      setExp({ phase: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const closeExport = () => {
    if (exp?.url) URL.revokeObjectURL(exp.url);
    setExp(null);
  };

  const type = useMemo(() => videoType(), []);
  const hasSound = mixHasSound(mix(), timeline);
  const current = timeline.scenes[sel];
  const sceneError = positions[sel]?.parsed.error;

  return (
    <div class="studio">
      <header class="studio-top">
        <button class="studio-back" onClick={() => navigate({ view: "settings" })} title={t("Zurück zu den Einstellungen")}>
          ←
        </button>
        <div class="studio-brand">
          <img src="/icons/logo.svg" alt="" width={28} height={28} />
          <span>
            {BRAND} <b>{t("Studio")}</b>
          </span>
        </div>
        <select class="studio-projects" value={project.id} onChange={(e) => setProjectId(e.currentTarget.value)} aria-label={t("Projekt wählen")}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input class="studio-name" value={project.name} onInput={(e) => update((p) => ({ ...p, name: e.currentTarget.value }))} aria-label={t("Name des Videos")} />
        <div class="studio-history" role="group" aria-label={t("Rückgängig und Wiederholen")}>
          <button onClick={undo} disabled={!history.current.past.length} title={t("Rückgängig (Strg+Z)")} aria-label={t("Rückgängig (Strg+Z)")}>
            ↶
          </button>
          <button onClick={redo} disabled={!history.current.future.length} title={t("Wiederholen (Strg+Umschalt+Z)")} aria-label={t("Wiederholen (Strg+Umschalt+Z)")}>
            ↷
          </button>
        </div>
        <div class="studio-top-actions">
          <button class="btn ghost studio-ai-btn" onClick={() => setDialog("ai")} title={t("Prompt für ChatGPT, Claude oder Gemini holen und das fertige Skript übernehmen")}>
            
            {t("✦ Mit KI")}
          </button>
          <button class="btn ghost" onClick={() => setDialog("new")}>
            
            {t("+ Neues Video")}
          </button>
          <details class="studio-more">
            <summary class="btn ghost" aria-label={t("Weitere Aktionen")}>
              ⋯
            </summary>
            <div class="studio-menu">
              <button onClick={() => setDialog("script")}>{t("Skript einfügen")}</button>
              <div class="studio-menu-lang">
                <StudioLangSelect />
              </div>
              <button onClick={() => openProject({ ...structuredClone(project), id: newId("p"), name: t("{name} (Kopie)", { name: project.name }), updatedAt: Date.now() })}>{t("Duplizieren")}</button>
              <button onClick={exportJson}>{t("Als Datei sichern")}</button>
              <button onClick={() => download(new Blob([speechSheet(project)], { type: "text/plain" }), `${FILE_PREFIX}-sprechtext-${slug(project.name)}.txt`)}>{t("Sprechtext mit Zeiten")}</button>
              <label>
                
                {t("Datei öffnen…")}
                <input type="file" accept="application/json,.json" hidden onChange={(e) => e.currentTarget.files?.[0] && void importJson(e.currentTarget.files[0])} />
              </label>
              <button class="danger" onClick={removeProject}>
                
                {t("Projekt löschen")}
              </button>
            </div>
          </details>
          <span class={`studio-soundbadge ${hasSound ? "on" : "off"}`} title={hasSound ? t("Dieses Video wird mit Ton exportiert (Musik, Stimme, Zug- und Effekt-Töne).") : t("Dieses Video hätte keinen Ton: Musik, Stimme und Töne sind aus oder ganz leise.")}>
            {hasSound ? t("🔊 Ton an") : t("🔇 Kein Ton")}
          </span>
          <button class="btn primary studio-export" onClick={() => void startExport()} disabled={!type || !ready}>
            
            {t("Video exportieren")}
          </button>
        </div>
      </header>

      <aside class="studio-scenes">
        <div class="studio-col-head">
          <span>{t("Szenen")}</span>
          <span class="faint">{fmtTime(timeline.total)}</span>
        </div>
        <ol>
          {project.scenes.map((s, i) => {
            const c = timeline.scenes[i];
            const err = positions[i]?.parsed.error;
            return (
              <li key={s.id} class={`studio-scene ${i === sel ? "on" : ""} ${err ? "bad" : ""}`}>
                <button class="studio-scene-main" onClick={() => selectScene(i)}>
                  <span class="studio-scene-no">{i + 1}</span>
                  <span class="studio-scene-body">
                    <span class="studio-scene-title">{s.title || (s.card !== "none" ? CARD_LABEL[s.card] : t("Ohne Titel"))}</span>
                    <span class="studio-scene-meta">
                      {s.card !== "none" && <em>{CARD_LABEL[s.card]}</em>}
                      {s.moves.trim() ? <code>{s.moves.trim()}</code> : null}
                      <span>{c ? `${c.dur.toFixed(1)} s` : ""}</span>
                    </span>
                  </span>
                </button>
                {i === sel && (
                  <span class="studio-scene-tools">
                    <button onClick={() => moveScene(i, -1)} disabled={i === 0} title={t("Nach oben")}>
                      ↑
                    </button>
                    <button onClick={() => moveScene(i, 1)} disabled={i === project.scenes.length - 1} title={t("Nach unten")}>
                      ↓
                    </button>
                    <button onClick={() => duplicateScene(i)} title={t("Duplizieren")}>
                      ⧉
                    </button>
                    <button onClick={() => removeScene(i)} disabled={project.scenes.length <= 1} title={t("Löschen")}>
                      ✕
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <button class="btn studio-add" onClick={addScene}>
          
          {t("+ Szene")}
        </button>
      </aside>

      <main class="studio-stage">
        <div class="studio-canvas-wrap" ref={wrapRef}>
          {glError ? (
            <p class="studio-gl-error">{t("3D geht auf diesem Gerät nicht: {glError}", { glError })}</p>
          ) : (
            <canvas
              ref={canvasRef}
              class={`studio-canvas ${tool !== "none" ? "drawing" : ""}`}
              style={{ width: `${view.w}px`, height: `${view.h}px` }}
              onClick={onBoardClick}
              onMouseMove={(e) => tool !== "none" && setHover(squareFromEvent(e))}
              onMouseLeave={() => setHover(null)}
            />
          )}
          {voiceRec && (
            <div class="studio-prompter">
              <span class="rec">{t("● Aufnahme")}</span>
              <p>{timeline.scenes[sel]?.scene.speech || timeline.scenes[sel]?.scene.text || "…"}</p>
              {timeline.scenes[sel + 1]?.scene.speech && <p class="next">{timeline.scenes[sel + 1].scene.speech}</p>}
              <button onClick={voiceRec.stop}>{t("Stopp")}</button>
            </div>
          )}
          {tool !== "none" && (
            <div class="studio-tool-hint">
              {tool === "arrow" ? (pending ? t("Pfeil von {pending}: jetzt das Zielfeld anklicken", { pending }) : t("Startfeld des Pfeils anklicken")) : t("Felder anklicken zum Markieren")}
              <button onClick={() => (setTool("none"), setPending(null))}>{t("Fertig")}</button>
            </div>
          )}
        </div>
        <div class="studio-transport">
          <div class="studio-scrub">
            <div class="studio-segments">
              {timeline.scenes.map((c, i) => (
                <button
                  key={c.scene.id}
                  class={`${i === sel ? "on" : ""} ${c.scene.card !== "none" ? "card" : ""} ${c.mate ? "mate" : ""} ${c.hit !== null ? "hit" : ""}`}
                  style={{ flexGrow: c.dur }}
                  onClick={() => selectScene(i)}
                  title={t("Szene {0}", { 0: i + 1 })}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={timeline.total}
              step={0.01}
              value={time}
              onInput={(e) => {
                setPlaying(false);
                setTime(Number(e.currentTarget.value));
              }}
              aria-label={t("Zeit")}
            />
          </div>
          <div class="studio-controls">
            <button class="studio-play" onClick={() => setPlaying(!playing)} aria-label={playing ? t("Pause") : t("Abspielen")} title={t("Leertaste")}>
              {playing ? "❚❚" : "▶"}
            </button>
            <span class="studio-time">
              {fmtTime(time)} / {fmtTime(timeline.total)}
            </span>
            {project.style.view === "reel" && (
              <span class={`studio-len ${timeline.total <= 18.5 ? "ok" : timeline.total <= 22 ? "warn" : "long"}`} title={t("Kurze, dichte Edits werden häufiger bis zum Ende geschaut und geloopt. Der Tab „Edit“ kürzt automatisch.")}>
                {timeline.total <= 18.5 ? t("Ideale Länge") : t("Ideal: 15 bis 18 s")}
              </span>
            )}
            <span class="studio-controls-gap" />
            <div class="studio-speed" title={t("Tempo des ganzen Videos")}>
              {[0.75, 1, 1.25, 1.5].map((sp) => (
                <button key={sp} class={Math.abs(project.video.speed - sp) < 0.01 ? "on" : ""} onClick={() => setVideo({ speed: sp })}>
                  {String(sp).replace(".", dec())}×
                </button>
              ))}
            </div>
            <select
              class="studio-fit"
              value=""
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                if (v) update((p) => fitLength(p, v));
                e.currentTarget.value = "";
              }}
              aria-label={t("Auf Länge kürzen")}
            >
              <option value="">{t("Länge …")}</option>
              {[15, 30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {t("auf {n} s anpassen", { n })}
                </option>
              ))}
            </select>
            <label class="studio-safe" title={t("Zeigt, wo die App ihre Knöpfe hinlegt (nicht im Video)")}>
              <input type="checkbox" checked={safe} onChange={() => setSafe(!safe)} /> {t("Sichere Zone")}
            </label>
          </div>
        </div>
      </main>

      <aside class="studio-panel">
        <div class="studio-tabs" role="tablist">
          {(["szene", "stil", "video", "edit"] as Tab[]).map((tk) => (
            <button key={tk} role="tab" aria-selected={tab === tk} class={tab === tk ? "on" : ""} onClick={() => setTab(tk)}>
              {tk === "szene" ? t("Szene {0}", { 0: sel + 1 }) : tk === "stil" ? t("Stil") : tk === "edit" ? t("Edit") : t("Video")}
            </button>
          ))}
        </div>
        <div class="studio-panel-body">
          {tab === "szene" && scene && (
            <SceneEditor
              scene={scene}
              error={sceneError}
              lucena={project.video.lucena}
              perspective={project.video.perspective}
              effective={current?.dur ?? scene.duration}
              minimum={current?.minDur ?? 1}
              speed={Math.max(0.3, project.video.speed || 1)}
              beat={project.style.view === "reel" ? REEL_BEAT : 0}
              tool={tool}
              tone={tone}
              style={project.style}
              onTool={(tk) => {
                setTool(tk);
                setPending(null);
                if (tk !== "none") setTime(showcase(timeline, sel));
              }}
              onTone={setTone}
              onChange={updateScene}
              onBoard={() => setDialog("board")}
              onAuto={() => {
                const pos = positions[sel];
                const r = pos ? autoScene(pos.before, scene.moves) : null;
                if (r) updateScene({ text: r.text, arrows: r.arrows, marks: r.marks });
              }}
            />
          )}
          {tab === "stil" && <StyleEditor style={project.style} onChange={setStyle} />}
          {tab === "edit" && (
            <EditHelp
              project={project}
              onProject={(next) => {
                update(() => next);
                setSel(0);
              }}
              onFirstTitle={(title) => updateScene({ title }, 0)}
            />
          )}
          {tab === "video" && (
            <SoundPanel
              video={project.video}
              plan={{ style: plan.style, bpm: plan.bpm ?? 0, auto: plan.auto }}
              busy={genBusy}
              previewing={previewing}
              onPreview={(s) => void preview(s)}
              hasVoice={!!(clips.id === project.id && clips.voice)}
              recording={!!voiceRec}
              error={audioError}
              onVideo={setVideo}
              onMusicFile={(f) => void storeClip("music", f, f.name)}
              onVoiceFile={(f) => void storeClip("voice", f)}
              onRecord={() => (voiceRec ? voiceRec.stop() : void startVoice())}
              onRemoveVoice={removeVoice}
            />
          )}
          {tab === "video" && <VideoEditor project={project} type={type?.ext ?? null} onVideo={setVideo} onStyle={setStyle} onStart={(fen) => update((p) => ({ ...p, startFen: fen }))} />}
        </div>
        {saveError && <p class="studio-warn">{t("Speicher voll: Änderungen sind nicht gesichert. Sichere das Projekt als Datei.")}</p>}
      </aside>

      {dialog === "new" && <Assistant onClose={() => setDialog(null)} onCreate={openProject} onTemplates={() => setDialog("templates")} onAi={() => setDialog("ai")} />}
      {dialog === "ai" && (
        <AiImport
          current={project}
          onClose={() => setDialog(null)}
          onCreate={openProject}
          onReplace={(p) => {
            update((old) => ({ ...p, id: old.id, updatedAt: Date.now() }));
            setSel(0);
            setTime(0);
            setDialog(null);
          }}
        />
      )}
      {dialog === "templates" && <NewDialog onClose={() => setDialog(null)} onCreate={openProject} />}
      {dialog === "script" && (
        <ScriptDialog
          onClose={() => setDialog(null)}
          onApply={(text) => {
            update((p) => distributeScript(p, text));
            setDialog(null);
          }}
        />
      )}
      {dialog === "board" && scene && positions[sel] && (
        <SceneBoard
          fen={positions[sel].before}
          moves={positions[sel].parsed.moves.map((m) => m.san)}
          onClose={() => setDialog(null)}
          onApply={(tree) => {
            const played = new Chess(tree.startFen);
            const ms = tree.main.map((san) => played.move(san));
            const extra = tree.variations
              .filter((v) => v.moves.length)
              .map((v, i) => {
                const base = new Chess(tree.startFen);
                for (const san of tree.main.slice(0, v.from)) base.move(san);
                return variationScene(base.fen(), v.moves, i + 1);
              });
            update((p) => {
              const list = p.scenes.slice();
              list[sel] = { ...list[sel], moves: movesLabel(ms, tree.startFen) };
              // After the variations the next scene jumps back to the main line.
              const next = list[sel + 1];
              if (extra.length && next && !next.fen) list[sel + 1] = { ...next, fen: played.fen(), label: next.label || t("Zurück zur Hauptvariante") };
              list.splice(sel + 1, 0, ...extra);
              return { ...p, scenes: list };
            });
            setDialog(null);
          }}
        />
      )}
      {exp && (
        <div class="studio-modal" role="dialog" aria-modal="true">
          <div class="studio-modal-card">
            {exp.phase === "recording" && (
              <>
                <h3>{t("Video wird aufgenommen …")}</h3>
                <p class="muted">{t("Das Video wird so schnell erstellt, wie dein Gerät es schafft (in alten Browsern in Echtzeit, {fmtTime}). Lass diesen Tab bitte im Vordergrund.", { fmtTime: fmtTime(timeline.total) })}</p>
                <div class="studio-bar">
                  <span style={{ width: `${Math.round(exp.progress * 100)}%` }} />
                </div>
                <button class="btn ghost" onClick={() => (cancelRef.current = true)}>
                  
                  {t("Abbrechen")}
                </button>
              </>
            )}
            {exp.phase === "done" && exp.url && (
              <>
                <h3>{t("Fertig!")}</h3>
                <video src={exp.url} controls autoplay loop playsInline class={`studio-result f${project.video.format.replace(":", "x")}`} />
                <p class="small muted">
                  {t("{W}×{H}, {fps} fps, {n}, {n2} MB{n3}", { W, H, fps: project.video.fps, n: exp.ext?.toUpperCase(), n2: ((exp.blob?.size ?? 0) / 1e6).toFixed(1), n3: exp.ext === "webm" ? t(" · TikTok und Instagram nehmen MP4 am liebsten: in Chrome oder Safari exportieren.") : "" })}
                </p>
                <p class={`small ${exp.sound === "lost" || exp.sound === "none" ? "studio-warn" : "muted"}`}>
                  {exp.sound === "aac" || exp.sound === "opus" || exp.sound === "recorded"
                    ? t("🔊 Mit Ton ({n}). Zum Prüfen oben im Video den Lautsprecher aufdrehen.", { n: exp.sound === "aac" ? "AAC" : exp.sound === "opus" ? "Opus" : "AAC/Opus" }) + (exp.sound === "opus" ? " " + t("TikTok und Instagram mögen Opus im MP4 nicht immer: am besten in Chrome auf Windows, Mac oder Android exportieren (dort gibt es AAC).") : "")
                    : exp.sound === "lost"
                      ? t("⚠ Der Ton ließ sich in diesem Browser nicht in die Datei schreiben. Probier Chrome oder Edge.")
                      : t("🔇 Dieses Video hat keinen Ton: Musik, Stimme und Töne sind aus. Schalte sie im Tab Video unter Ton ein und exportier neu.")}
                </p>
                <div class="studio-modal-actions">
                  <button class="btn primary" onClick={() => exp.blob && download(exp.blob, `${FILE_PREFIX}-${slug(project.name)}.${exp.ext}`)}>
                    
                    {t("Herunterladen")}
                  </button>
                  <button class="btn ghost" onClick={closeExport}>
                    
                    {t("Schließen")}
                  </button>
                </div>
              </>
            )}
            {exp.phase === "error" && (
              <>
                <h3>{t("Export fehlgeschlagen")}</h3>
                <p class="muted">{exp.error}</p>
                <button class="btn ghost" onClick={closeExport}>
                  
                  {t("Schließen")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function confirmDelete(): boolean {
  try {
    return window.confirm(t("Dieses Video-Projekt wirklich löschen?"));
  } catch {
    return true;
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c] ?? c)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "video"
  );
}

// ---------- small form parts ----------

function Field({ label, hint, children }: { label: string; hint?: ComponentChildren; children: ComponentChildren }) {
  return (
    <label class="studio-field">
      <span class="studio-label">{label}</span>
      {children}
      {hint && <span class="studio-hint">{hint}</span>}
    </label>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="segmented studio-seg">
      {options.map(([v, l]) => (
        <button key={String(v)} class={v === value ? "active" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="studio-toggle">
      <input type="checkbox" checked={checked} onChange={() => onChange(!checked)} />
      <span class="studio-switch" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label class="studio-field">
      <span class="studio-label">
        {label} <b>{`${Number.isInteger(step) ? value : value.toFixed(step < 0.1 ? 2 : 1)}${unit}`}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number(e.currentTarget.value))} />
    </label>
  );
}

function ToneChips({ value, style, onChange }: { value: Tone; style: StudioStyle; onChange: (tk: Tone) => void }) {
  return (
    <div class="studio-tones">
      {(Object.keys(TONE_LABEL) as Tone[]).map((tk) => (
        <button key={tk} class={tk === value ? "on" : ""} onClick={() => onChange(tk)} title={TONE_LABEL[tk]} style={{ "--tone": toneColor(tk, style) }}>
          <span />
          {TONE_LABEL[tk]}
        </button>
      ))}
    </div>
  );
}

// ---------- scene editor ----------

function SceneEditor({
  scene,
  error,
  lucena,
  perspective,
  effective,
  minimum,
  speed,
  beat,
  tool,
  tone,
  style,
  onTool,
  onTone,
  onChange,
  onBoard,
  onAuto,
}: {
  onBoard: () => void;
  onAuto: () => void;
  scene: Scene;
  error?: string;
  lucena: boolean;
  perspective: Side;
  effective: number;
  minimum: number;
  speed: number;
  beat: number;
  tool: Tool;
  tone: Tone;
  style: StudioStyle;
  onTool: (tk: Tool) => void;
  onTone: (tk: Tone) => void;
  onChange: (patch: Partial<Scene>) => void;
}) {
  const [fenOpen, setFenOpen] = useState(Boolean(scene.fen));
  useEffect(() => setFenOpen(Boolean(scene.fen)), [scene.id]);
  return (
    <div class="studio-form">
      <Field label={t("Karte über dem Brett")}>
        <Seg<Card> value={scene.card} options={(Object.keys(CARD_LABEL) as Card[]).map((c) => [c, CARD_LABEL[c]])} onChange={(card) => onChange({ card, countdown: (card === "question" || card === "poll") && !scene.countdown ? 3 : scene.countdown })} />
      </Field>
      {(scene.card === "question" || scene.card === "poll") && <Slider label={t("Countdown")} value={scene.countdown} min={0} max={10} step={1} unit=" s" onChange={(countdown) => onChange({ countdown })} />}
      <Field
        label={t("Züge in dieser Szene")}
        hint={error ? <span class="bad">{t("„{error}“ ist hier kein gültiger Zug.", { error })}</span> : t("Deutsch oder Englisch, z. B. 1. e4 e5 2. Sf3. Leer lassen für eine Erklär-Szene ohne Zug.")}
      >
        <input class={error ? "invalid" : ""} value={scene.moves} onInput={(e) => onChange({ moves: e.currentTarget.value })} placeholder={t("z. B. 3. Lb5")} spellcheck={false} />
      </Field>
      <div class="studio-quick">
        <button onClick={onBoard}>{t("♞ Auf dem Brett vorspielen")}</button>
        <button onClick={onAuto} disabled={!scene.moves.trim()} title={t("Untertitel, Pfeile und Markierungen aus den Zügen")}>
          
          {t("✦ Automatisch erklären")}
        </button>
      </div>
      {fenOpen ? (
        <Field label={t("Vorher zu dieser Stellung springen (FEN)")} hint={scene.fen && !validFen(scene.fen) ? <span class="bad">{t("Diese FEN ist ungültig.")}</span> : t("Für „Was wäre wenn“: die Figuren blenden zur neuen Stellung über.")}>
          <input value={scene.fen} onInput={(e) => onChange({ fen: e.currentTarget.value })} placeholder={START_FEN} spellcheck={false} />
        </Field>
      ) : (
        <button class="studio-link" onClick={() => setFenOpen(true)}>
          
          {t("+ Zu einer anderen Stellung springen")}
        </button>
      )}
      {scene.card === "poll" && (
        <Field label={t("Antworten der Umfrage")} hint={t("z. B. „A) Lb5“. Die Zuschauer stimmen in den Kommentaren ab.")}>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              value={scene.options[i] ?? ""}
              placeholder={`${String.fromCharCode(65 + i)}) …`}
              onInput={(e) => {
                const options = [0, 1, 2].map((k) => (k === i ? e.currentTarget.value : scene.options[k] ?? "")).filter((o, k) => o.trim() || k < i);
                onChange({ options });
              }}
            />
          ))}
        </Field>
      )}
      <Field label={t("Kleine Zeile über der Überschrift")} hint={t("z. B. „Variante 2“ oder „Teil 1“.")}>
        <input value={scene.label} onInput={(e) => onChange({ label: e.currentTarget.value })} maxLength={40} />
      </Field>
      <Field label={t("Überschrift")}>
        <input value={scene.title} onInput={(e) => onChange({ title: e.currentTarget.value })} maxLength={120} />
      </Field>
      <Field label={t("Untertitel")} hint={t("*Sternchen* um ein Wort färben es ein. Ein | teilt den Text in nacheinander gezeigte Teile.")}>
        <textarea rows={3} value={scene.text} onInput={(e) => onChange({ text: e.currentTarget.value })} maxLength={900} />
      </Field>
      {/* The slider shows the length the scene really plays (real seconds, tempo included). Below the scene's natural length it plays moves and effects faster. */}
      <Slider
        label={t("Dauer")}
        value={effective}
        min={beat || 0.5}
        max={Math.max(15, Math.ceil(effective))}
        step={beat || 0.1}
        unit=" s"
        onChange={(real) => onChange({ duration: real * speed, squeeze: real < minimum - 1e-6 })}
      />
      {scene.squeeze && effective < minimum - 1e-6 && <p class="studio-hint">{t("Gestaucht: Züge und Effekte laufen schneller, damit die Szene {n} s dauert (natürlich {m} s).", { n: effective.toFixed(1), m: minimum.toFixed(1) })}</p>}
      <Field label={t("Sprechtext")} hint={t("Was du über diese Szene sagst. Erscheint nicht im Video; die Szene läuft lang genug dafür. Unter ⋯ als Liste mit Zeiten.")}>
        <textarea rows={2} value={scene.speech} onInput={(e) => onChange({ speech: e.currentTarget.value })} maxLength={1200} placeholder={t("Optional")} />
      </Field>

      <h4 class="studio-sub">{t("Effekte")}</h4>
      <div class="studio-fx">
        {(Object.keys(EFFECT_LABEL) as Effect[]).map((fx) => {
          const on = scene.effects.includes(fx);
          return (
            <button key={fx} class={on ? "on" : ""} title={EFFECT_LABEL[fx].hint} onClick={() => onChange({ effects: on ? scene.effects.filter((x) => x !== fx) : [...scene.effects, fx] })}>
              <span class={`studio-fx-icon fx-${fx}`} aria-hidden="true" />
              {EFFECT_LABEL[fx].label}
            </button>
          );
        })}
      </div>
      {scene.effects.length > 0 && <p class="studio-hint">{scene.effects.map((fx) => EFFECT_LABEL[fx].hint).join(" · ")}</p>}
      {scene.effects.length > 0 && (
        <details class="studio-fine">
          <summary>{t("Stärke der Effekte")}</summary>
          {scene.effects.map((fx) => (
            <Slider key={fx} label={EFFECT_LABEL[fx].label} value={powerOf(scene, fx)} min={0} max={1} step={0.05} unit="" onChange={(v) => onChange({ power: { ...scene.power, [fx]: v } })} />
          ))}
        </details>
      )}
      <Field label={t("Stempel")} hint={t("Ein Wort, riesig über dem Brett, 0,4 s lang im Moment des Aufpralls, z. B. BLUNDER oder ??.")}>
        <input value={scene.stamp} maxLength={14} onInput={(e) => onChange({ stamp: e.currentTarget.value.toUpperCase() })} placeholder={t("Optional")} spellcheck={false} />
      </Field>
      <Field label={t("Bewertung des Zugs")} hint={scene.badge ? t("{0}: dasselbe Zeichen wie in der Analyse, über dem Feld des letzten Zugs.", { 0: BADGE_LABEL[scene.badge] }) : t("Dasselbe Zeichen wie in der Analyse, über dem Feld des letzten Zugs.")}>
        <div class="studio-badges">
          {(Object.keys(BADGE_LABEL) as Badge[]).map((b) => (
            <button key={b || "none"} class={scene.badge === b ? "on" : ""} onClick={() => onChange({ badge: b })} title={BADGE_LABEL[b]} aria-label={BADGE_LABEL[b]}>
              {b ? <img src={`${import.meta.env.BASE_URL}badges/${BADGE_FILE[b]}`} alt="" width={30} height={30} /> : "–"}
            </button>
          ))}
        </div>
      </Field>
      <Slider label={t("Zugtempo dieser Szene")} value={scene.tempo} min={0.3} max={3} step={0.05} unit="×" onChange={(tempo) => onChange({ tempo })} />

      <h4 class="studio-sub">{t("Kamera")}</h4>
      <p class="studio-hint">{t("Immer aus Sicht von {n}, änderbar unter „Video“.", { n: perspective === "black" ? t("Schwarz") : t("Weiß") })}</p>
      <div class="studio-cams">
        {(Object.keys(CAMERA_LABEL) as CameraPreset[]).map((c) => (
          <button key={c} class={scene.camera === c ? "on" : ""} onClick={() => onChange({ camera: c })}>
            <CamIcon preset={c} />
            {CAMERA_LABEL[c]}
          </button>
        ))}
      </div>
      <Field label={t("Kameras im Takt")} hint={t("Die Szene schaltet der Reihe nach durch diese Winkel, mit schnellem Schwenk dazwischen (nach einem Hitstop erst danach). Leer = nur die Kamera oben.")}>
        <div class="studio-stamp-cams">
          {scene.cameras.map((c, i) => (
            <button key={`${c}${i}`} class="on" onClick={() => onChange({ cameras: scene.cameras.filter((_, k) => k !== i) })} title={t("Entfernen")}>
              {i + 1}. {CAMERA_LABEL[c]} ✕
            </button>
          ))}
          {scene.cameras.length < MAX_CAMERAS && (
            <select value="" onChange={(e) => e.currentTarget.value && onChange({ cameras: [...scene.cameras, e.currentTarget.value as CameraPreset] })} aria-label={t("Winkel hinzufügen")}>
              <option value="">{t("+ Winkel")}</option>
              {(Object.keys(CAMERA_LABEL) as CameraPreset[]).map((c) => (
                <option key={c} value={c}>
                  {CAMERA_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </div>
      </Field>
      <details class="studio-fine">
        <summary>{t("Feinschliff der Kamera")}</summary>
      <Slider label={t("Zoom")} value={scene.zoom} min={0.45} max={1.6} step={0.05} unit="×" onChange={(zoom) => onChange({ zoom })} />
      <Slider label={t("Kamerafahrt (Drehung)")} value={scene.orbit} min={-30} max={30} step={1} unit="°/s" onChange={(orbit) => onChange({ orbit })} />
      </details>
      <Toggle label={t("Auf den Zug zoomen")} checked={scene.focus} onChange={(focus) => onChange({ focus })} />

      <h4 class="studio-sub">{t("Pfeile und Felder")}</h4>
      <div class="studio-draw">
        <button class={tool === "arrow" ? "on" : ""} onClick={() => onTool(tool === "arrow" ? "none" : "arrow")}>
          
          {t("↗ Pfeil zeichnen")}
        </button>
        <button class={tool === "mark" ? "on" : ""} onClick={() => onTool(tool === "mark" ? "none" : "mark")}>
          
          {t("▣ Feld markieren")}
        </button>
      </div>
      <ToneChips value={tone} style={style} onChange={onTone} />
      {(scene.arrows.length > 0 || scene.marks.length > 0) && (
        <ul class="studio-annos">
          {scene.arrows.map((a, i) => (
            <li key={`a${i}`}>
              <span class="dot" style={{ background: toneColor(a.tone, style) }} />
              
              {t("Pfeil {from} → {to}", { from: a.from, to: a.to })}
              <button onClick={() => onChange({ arrows: scene.arrows.filter((_, k) => k !== i) })} aria-label={t("Pfeil löschen")}>
                ✕
              </button>
            </li>
          ))}
          {scene.marks.map((m, i) => (
            <li key={`m${i}`}>
              <span class="dot sq" style={{ background: toneColor(m.tone, style) }} />
              
              {t("Feld {square}", { square: m.square })}
              <button onClick={() => onChange({ marks: scene.marks.filter((_, k) => k !== i) })} aria-label={t("Markierung löschen")}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {lucena && (
        <Field label={t("Lucenas Stimmung")}>
          <Seg<Mood> value={scene.mood} options={(Object.keys(MOOD_LABEL) as Mood[]).map((m) => [m, MOOD_LABEL[m]])} onChange={(mood) => onChange({ mood })} />
        </Field>
      )}
    </div>
  );
}

function CamIcon({ preset }: { preset: CameraPreset }) {
  // Tiny sketches of where the camera stands relative to the board.
  const paths: Record<CameraPreset, string> = {
    white: "M4 14h16l-3-7H7z",
    black: "M7 17h10l3-7H4z",
    top: "M6 6h12v12H6z",
    corner: "M12 5l8 6-8 6-8-6z",
    side: "M3 15h18l-2-5H5z",
    low: "M2 16h20l-6-3H8z",
    close: "M5 18h14l-2-11H7z",
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={paths[preset]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
    </svg>
  );
}

// ---------- style ----------

function StyleEditor({ style, onChange }: { style: StudioStyle; onChange: (p: Partial<StudioStyle>) => void }) {
  const colour = (label: string, key: keyof StudioStyle) => (
    <label class="studio-colour">
      <input type="color" value={style[key] as string} onInput={(e) => onChange({ [key]: e.currentTarget.value } as Partial<StudioStyle>)} />
      <span>{label}</span>
    </label>
  );
  return (
    <div class="studio-form">
      <Field label={t("Brett")} hint={style.view === "2d" ? t("Flach von oben mit den Figuren der Website: am leichtesten zu verfolgen, besonders auf dem Handy. Standard für YouTube-Lernvideos.") : style.view === "reel" ? t("Schwarz-Weiß auf Schwarz, immer schräg und in Bewegung: harte Schnitte, Blitze, Glühen in Rot, Grün und Cyan, dicke Pfeile und runde Bewertungs-Symbole. Fast ohne Text, wie die schnellen Schach-Clips.") : style.view === "billboard" ? t("3D-Brett mit Kamerafahrten, die Figuren sind flache Aufsteller, die sich immer zur Kamera drehen.") : t("Plastisches Show-Brett mit Kamerafahrten, für TikTok, Reels und Shorts.")}>
        <Seg<BoardView> value={style.view} options={VIEWS.map((b) => [b, VIEW_LABEL[b]] as [BoardView, string])} onChange={(view) => onChange(view === "reel" && style.theme !== "mono" ? styleFromTheme("mono", { reflection: style.reflection, coords: style.coords, titleFont: "serif", pieceRim: style.pieceRim, captionStyle: style.captionStyle, textScale: style.textScale, environment: style.environment, view }) : { view })} />
      </Field>
      <Field label={t("Look")}>
        <div class="studio-themes">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => {
            const tk = THEMES[id];
            return (
              <button key={id} class={style.theme === id ? "on" : ""} onClick={() => onChange(styleFromTheme(id, { reflection: style.reflection, coords: style.coords, titleFont: style.titleFont, pieceRim: style.pieceRim, captionStyle: style.captionStyle, textScale: style.textScale, environment: style.environment, view: style.view }))}>
                <span class="studio-swatch" style={{ background: `linear-gradient(135deg, ${tk.bgTop}, ${tk.bgBottom})` }}>
                  <i style={{ background: tk.light }} />
                  <i style={{ background: tk.dark }} />
                  <i style={{ background: tk.accent }} />
                </span>
                {tk.label}
              </button>
            );
          })}
        </div>
      </Field>
      {isBoard3d(style.view) && <Field label={t("Wo das Brett steht")}>
        <div class="studio-envs">
          {(Object.keys(ENV_LABEL) as Environment[]).map((e) => (
            <button key={e} class={style.environment === e ? "on" : ""} onClick={() => onChange({ environment: e })}>
              <span class={`studio-env-icon env-${e}`} />
              {ENV_LABEL[e]}
            </button>
          ))}
        </div>
      </Field>}
      <h4 class="studio-sub">{t("Farben")}</h4>
      <div class="studio-colours">
        {t("{colour}{colour2}{colour3}{n}{n2}{colour4}{colour5}{colour6}", { colour: colour(t("Helle Felder"), "light"), colour2: colour(t("Dunkle Felder"), "dark"), colour3: colour(t("Rahmen"), "frame"), n: style.view === "3d" && colour(t("Weiße Figuren"), "whitePiece"), n2: style.view === "3d" && colour(t("Schwarze Figuren"), "blackPiece"), colour4: colour(t("Akzent"), "accent"), colour5: colour(t("Hintergrund oben"), "bgTop"), colour6: colour(t("Hintergrund unten"), "bgBottom") })}
      </div>
      {style.view === "3d" && <Field label={t("Figuren")}>
        <Seg<Material>
          value={style.material}
          options={(Object.keys(MATERIAL_LABEL) as Material[]).map((m) => [m, MATERIAL_LABEL[m]] as [Material, string])}
          onChange={(material) => onChange({ material })}
        />
      </Field>}
      <Field label={t("Schrift der Überschriften")}>
        <Seg<"sans" | "serif">
          value={style.titleFont}
          options={[
            ["sans", t("Modern")],
            ["serif", t("Elegant")],
          ]}
          onChange={(titleFont) => onChange({ titleFont })}
        />
      </Field>
      <Field label={t("Untertitel")}>
        <Seg<CaptionStyle> value={style.captionStyle} options={(Object.keys(CAPTION_LABEL) as CaptionStyle[]).map((c) => [c, CAPTION_LABEL[c]] as [CaptionStyle, string])} onChange={(captionStyle) => onChange({ captionStyle })} />
      </Field>
      <Slider label={t("Textgröße")} value={style.textScale} min={0.8} max={1.3} step={0.05} unit="×" onChange={(textScale) => onChange({ textScale })} />
      {style.view === "3d" && <Toggle label={t("Heller Rand an den Figuren (besser zu unterscheiden)")} checked={style.pieceRim} onChange={(pieceRim) => onChange({ pieceRim })} />}
      {style.view === "3d" && <Toggle label={t("Spiegelung im Brett")} checked={style.reflection} onChange={(reflection) => onChange({ reflection })} />}
      <Toggle label={t("Koordinaten am Rand")} checked={style.coords} onChange={(coords) => onChange({ coords })} />
    </div>
  );
}

// ---------- video ----------

function VideoEditor({ project, type, onVideo, onStyle, onStart }: { project: StudioProject; type: string | null; onVideo: (p: Partial<StudioVideo>) => void; onStyle: (p: Partial<StudioStyle>) => void; onStart: (fen: string) => void }) {
  const v = project.video;
  return (
    <div class="studio-form">
      <Field label={t("Sicht aufs Brett")} hint={t("Gilt für alle Szenen: die Kameras drehen sich mit, so bleibt die Seite im ganzen Video gleich.")}>
        <Seg<Side>
          value={v.perspective}
          options={[
            ["white", t("Weiß unten")],
            ["black", t("Schwarz unten")],
          ]}
          onChange={(perspective) => onVideo({ perspective })}
        />
      </Field>
      <Field label={t("Plattform")} hint={t("Bestimmt die sichere Zone in der Vorschau und bei YouTube das Querformat.")}>
        <select
          class="studio-select"
          value={v.platform}
          onChange={(e) => {
            const platform = e.currentTarget.value as Platform;
            const wasYoutube = v.platform === "youtube";
            onVideo({ platform, format: platform === "youtube" ? "16:9" : v.format === "16:9" ? "9:16" : v.format, ...(platform === "youtube" ? { lesson: true } : {}) });
            // Lessons start with the clear 2D board, short videos with the 3D show look; both can be changed in Stil.
            if (platform === "youtube" && !wasYoutube) onStyle({ view: "2d" });
            else if (platform !== "youtube" && wasYoutube) onStyle({ view: "3d" });
          }}
        >
          {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Format")}>
        <Seg<Format>
          value={v.format}
          options={[
            ["9:16", t("9:16 TikTok/Reels")],
            ["1:1", "1:1"],
            ["16:9", t("16:9 YouTube")],
          ]}
          onChange={(format) => onVideo({ format })}
        />
      </Field>
      <Field label={t("Bilder pro Sekunde")}>
        <Seg<30 | 60>
          value={v.fps}
          options={[
            [30, "30"],
            [60, t("60 (flüssiger)")],
          ]}
          onChange={(fps) => onVideo({ fps })}
        />
      </Field>
      <Slider label={t("Tempo des ganzen Videos")} value={v.speed} min={0.5} max={2.5} step={0.05} unit="×" onChange={(speed) => onVideo({ speed })} />
      <Slider label={t("Tempo nur der Figuren")} value={v.tempo} min={0.4} max={2.5} step={0.05} unit="×" onChange={(tempo) => onVideo({ tempo })} />
      <h4 class="studio-sub">{t("Im Bild")}</h4>
      <Toggle label={t("Logo und Name {BRAND}", { BRAND })} checked={v.brand} onChange={(brand) => onVideo({ brand })} />
      <Toggle label={t("Webadresse")} checked={v.watermark} onChange={(watermark) => onVideo({ watermark })} />
      <Toggle label={t("Lucena spricht die Untertitel")} checked={v.lucena} onChange={(lucena) => onVideo({ lucena })} />
      <Toggle label={t("Zug-Anzeige (z. B. 3. Lb5)")} checked={v.movePill} onChange={(movePill) => onVideo({ movePill })} />
      {v.movePill && <Toggle label={t("Zug in Worten darunter („Weiß: Läufer von f1 nach b5“)")} checked={v.plainMoves} onChange={(plainMoves) => onVideo({ plainMoves })} />}
      <Toggle label={t("Notation in Titeln und Untertiteln ausschreiben („Sf3“ wird „Springer f3“)")} checked={v.spellMoves} onChange={(spellMoves) => onVideo({ spellMoves })} />
      <Toggle label={t("Felder aus dem Untertitel leuchten auf")} checked={v.squareHints} onChange={(squareHints) => onVideo({ squareHints })} />
      <Toggle label={t("Letzten Zug hervorheben")} checked={v.lastMove} onChange={(lastMove) => onVideo({ lastMove })} />
      <Toggle label={t("Fortschrittsbalken")} checked={v.progress} onChange={(progress) => onVideo({ progress })} />
      {v.format === "16:9" && <Toggle label={t("Lernvideo: Brett links, Erklärung und Züge rechts")} checked={v.lesson} onChange={(lesson) => onVideo({ lesson })} />}
      <Toggle label={t("Kamerafahrt zum Start")} checked={v.introFly} onChange={(introFly) => onVideo({ introFly })} />
      <Field label={t("Startstellung (FEN)")} hint={!validFen(project.startFen) ? <span class="bad">{t("Ungültig, es gilt die Grundstellung.")}</span> : t("Für Rätsel oder Endspiele; leer = Grundstellung.")}>
        <input value={project.startFen === START_FEN ? "" : project.startFen} placeholder={t("Grundstellung")} onInput={(e) => onStart(e.currentTarget.value.trim() || START_FEN)} spellcheck={false} />
      </Field>
      <p class="studio-hint">
        
        {t("Export als {n}. Der Export läuft meist schneller als das Video lang ist, ohne Ton für dich, aber mit Musik, deiner Stimme und den Effekt-Tönen im Video.", { n: type ? type.toUpperCase() : t("– (Browser kann nicht aufnehmen)") })}
      </p>
    </div>
  );
}

// ---------- music and voice ----------

function SoundPanel(p: {
  video: StudioVideo;
  plan: { style: StyleId; bpm: number; auto: boolean };
  busy: boolean;
  previewing: StyleId | null;
  onPreview: (style: StyleId) => void;
  hasVoice: boolean;
  recording: boolean;
  error: string;
  onVideo: (patch: Partial<StudioVideo>) => void;
  onMusicFile: (f: File) => void;
  onVoiceFile: (f: File) => void;
  onRecord: () => void;
  onRemoveVoice: () => void;
}) {
  const v = p.video;
  return (
    <div class="studio-form studio-sound">
      <Slider label={t("Gesamtlautstärke")} value={v.volume} min={0} max={1.5} step={0.05} unit="" onChange={(volume) => p.onVideo({ volume })} />
      <h4 class="studio-sub">{t("Musik")}</h4>
      <div class="studio-speed wrap">
        {(Object.keys(MUSIC_LABEL) as MusicId[])
          .filter((m) => m !== "file" || v.musicName)
          .map((m) => (
            <button key={m} class={v.music === m ? "on" : ""} onClick={() => p.onVideo({ music: m })}>
              {m === "file" ? `♪ ${v.musicName}` : MUSIC_LABEL[m]}
            </button>
          ))}
        <label class="btn ghost small">
          
          {t("Eigene Musik …")}
          <input type="file" accept="audio/*" hidden onChange={(e) => e.currentTarget.files?.[0] && p.onMusicFile(e.currentTarget.files[0])} />
        </label>
      </div>
      {v.music === "generated" && (
        <div class="studio-gen">
          <div class="studio-speed wrap">
            <button class={v.musicStyle === "auto" ? "on" : ""} onClick={() => p.onVideo({ musicStyle: "auto" })}>
              {t("Automatisch")}
            </button>
          </div>
          {STYLE_IDS.map((s) => (
            <div key={s} class={`studio-genstyle ${v.musicStyle === s ? "on" : ""}`}>
              <button class="studio-genpick" onClick={() => p.onVideo({ musicStyle: s })}>
                <b>{STYLE_LABEL[s]}</b>
                <span>{STYLE_HINT[s]}</span>
              </button>
              <button class="btn ghost small" onClick={() => p.onPreview(s)} aria-label={t("Vorhören")}>
                {p.previewing === s ? "■" : "▶"}
              </button>
            </div>
          ))}
          <p class="studio-hint">
            {t("Spielt: {style}, {bpm} BPM{auto}. Die Musik passt Tempo, Drops und Länge an dein Video an.", { style: STYLE_LABEL[p.plan.style], bpm: p.plan.bpm, auto: p.plan.auto ? t(" (automatisch gewählt)") : "" })}
          </p>
          <Slider label={t("Intensität")} value={v.musicIntensity} min={0} max={1} step={0.05} unit="" onChange={(musicIntensity) => p.onVideo({ musicIntensity })} />
          <button class="btn ghost" onClick={() => p.onVideo({ musicSeed: 1 + Math.floor(Math.random() * 99999) })}>
            {t("🎲 Neue Variante")}
          </button>
          {p.busy && <p class="studio-hint">{t("Musik wird für dein Video erzeugt …")}</p>}
        </div>
      )}
      {v.music !== "none" && <Slider label={t("Lautstärke Musik")} value={v.musicVolume} min={0} max={1} step={0.05} unit="" onChange={(musicVolume) => p.onVideo({ musicVolume })} />}
      <p class="studio-hint">{t("Alle Musik macht das Studio selbst, die darfst du überall frei nutzen. Bei eigener Musik brauchst du die Rechte (auf TikTok am besten den Sound dort in der App drüberlegen).")}</p>

      <h4 class="studio-sub">{t("Deine Stimme")}</h4>
      <div class="studio-voice">
        <button class={`btn ${p.recording ? "danger" : "primary"}`} onClick={p.onRecord}>
          {p.recording ? t("■ Aufnahme stoppen") : p.hasVoice ? t("● Neu einsprechen") : t("● Einsprechen")}
        </button>
        <label class="btn ghost">
          
          {t("Datei …")}
          <input type="file" accept="audio/*" hidden onChange={(e) => e.currentTarget.files?.[0] && p.onVoiceFile(e.currentTarget.files[0])} />
        </label>
        {p.hasVoice && !p.recording && (
          <button class="btn ghost" onClick={p.onRemoveVoice}>
            
            {t("Löschen")}
          </button>
        )}
      </div>
      {p.hasVoice && (
        <>
          <Toggle label={t("Stimme im Video")} checked={v.voice} onChange={(voice) => p.onVideo({ voice })} />
          <Slider label={t("Lautstärke Stimme")} value={v.voiceVolume} min={0} max={1.5} step={0.05} unit="" onChange={(voiceVolume) => p.onVideo({ voiceVolume })} />
        </>
      )}
      <p class="studio-hint">{t("Das Video läuft von vorn, über dem Bild steht dein Sprechtext. Kopfhörer helfen. Die Musik wird leiser, solange deine Stimme läuft.")}</p>
      <Toggle label={t("Töne (Züge, Matt, Zoom, Konfetti)")} checked={v.sound} onChange={(sound) => p.onVideo({ sound })} />
      {p.error && <p class="studio-warn">{p.error}</p>}
    </div>
  );
}

// ---------- new project ----------

function NewDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (p: StudioProject) => void }) {
  const [name, setName] = useState(t("Die Italienische Partie"));
  const [moves, setMoves] = useState(t("1. e4 e5 2. Sf3 Sc6 3. Lc4 Lc5"));
  const [pairs, setPairs] = useState(true);
  const built = useMemo(() => fromMoves(name, moves, START_FEN, pairs), [name, moves, pairs]);
  return (
    <div class="studio-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="studio-modal-card wide">
        <h3>{t("Neues Video")}</h3>
        <div class="studio-templates">
          {TEMPLATES.map((tk) => (
            <button key={tk.id} onClick={() => onCreate(tk.make())}>
              <b>{tk.label}</b>
              <span>{tk.hint}</span>
            </button>
          ))}
        </div>
        <h4 class="studio-sub">{t("Oder aus einer Zugliste")}</h4>
        <div class="studio-form">
          <Field label={t("Titel")}>
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </Field>
          <Field label={t("Züge (PGN)")} hint={built.error ? <span class="bad">{t("Ab „{error}“ geht es nicht weiter.", { error: built.error })}</span> : t("{0} Szenen mit Platzhaltertexten.", { 0: built.project.scenes.length - 2 })}>
            <textarea rows={3} value={moves} onInput={(e) => setMoves(e.currentTarget.value)} spellcheck={false} />
          </Field>
          <Toggle label={t("Weiß- und Schwarzzug in einer Szene")} checked={pairs} onChange={setPairs} />
        </div>
        <div class="studio-modal-actions">
          <button class="btn primary" onClick={() => onCreate(built.project)}>
            
            {t("Erstellen")}
          </button>
          <button class="btn ghost" onClick={onClose}>
            
            {t("Abbrechen")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScriptDialog({ onClose, onApply }: { onClose: () => void; onApply: (text: string) => void }) {
  const [text, setText] = useState("");
  const readFile = async (file: File) => setText((await file.text()).slice(0, 20000));
  return (
    <div class="studio-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="studio-modal-card wide">
        <h3>{t("Skript auf die Szenen verteilen")}</h3>
        <p class="muted small">
          
          {t("Sätze, die einen Zug nennen (z. B. „Mit Lb5 …“), landen bei der Szene mit diesem Zug. Die anderen verteilen sich der Reihe nach dazwischen, ein Aufruf wie „Folge für mehr“ kommt in den Abspann. Jede Szene bekommt genug Zeit zum Mitlesen.")}
        </p>
        <textarea class="wz-script" rows={10} value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder={t("Dein Skript …")} />
        <div class="studio-modal-actions">
          <button class="btn primary" disabled={!text.trim()} onClick={() => onApply(text)}>
            
            {t("Verteilen")}
          </button>
          <label class="btn ghost">
            
            {t("Textdatei …")}
            <input type="file" accept=".txt,.md,text/plain" hidden onChange={(e) => e.currentTarget.files?.[0] && void readFile(e.currentTarget.files[0])} />
          </label>
          <button class="btn ghost" onClick={onClose}>
            
            {t("Abbrechen")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SceneBoard({ fen, moves, onClose, onApply }: { fen: string; moves: string[]; onClose: () => void; onApply: (tree: GameTree) => void }) {
  const [tree, setTree] = useState<GameTree>({ startFen: fen, main: moves, variations: [], keyPly: -1 });
  const [cursor, setCursor] = useState<Cursor>({ line: "main", ply: moves.length });
  return (
    <div class="studio-modal" role="dialog" aria-modal="true">
      <div class="studio-modal-card wizard">
        <header class="wz-head">
          <h3>{t("Züge dieser Szene vorspielen")}</h3>
          <button class="wz-close" onClick={onClose} aria-label={t("Schließen")}>
            ✕
          </button>
        </header>
        <div class="wz-body">
          <MoveRecorder
            tree={tree}
            cursor={cursor}
            allowFen={false}
            onChange={(tk, c) => {
              setTree(tk);
              setCursor(c);
            }}
          />
        </div>
        <footer class="wz-foot">
          <span class="wz-summary">{tree.variations.length ? t("{length} Variante(n) werden als eigene Szenen eingefügt", { length: tree.variations.length }) : t("Andere Züge nach dem Zurückgehen werden Varianten")}</span>
          <button class="btn primary" onClick={() => onApply(tree)}>
            
            {t("Übernehmen")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Language of the studio and of the videos it makes (titles, subtitles, move
 * names, notation, the AI prompt). "Automatic" follows the site language, so a
 * German site can still produce English videos. Changing it reloads the page.
 */
function StudioLangSelect() {
  const setting = studioSetting();
  return (
    <select
      class="studio-lang"
      value={setting}
      onChange={(e) => changeStudioLang(e.currentTarget.value as StudioLang)}
      aria-label={t("Sprache des Studios und der Videos")}
      title={t("Sprache des Studios und der Videos")}
    >
      <option value="auto">{t("Video: wie die Website ({name})", { name: LANG_NAMES[siteLang()] })}</option>
      {LANGS.map((l) => (
        <option key={l} value={l} lang={l}>
          {t("Video: {name}", { name: LANG_NAMES[l] })}
        </option>
      ))}
    </select>
  );
}
