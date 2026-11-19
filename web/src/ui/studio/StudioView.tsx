// The hidden video studio: prepare a chess explainer as scenes (moves, texts,
// arrows, camera) on a 3D board and export it as a vertical video for TikTok,
// Reels or Shorts, with the EndGameKing branding in the picture.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { BRAND, FILE_PREFIX } from "../../brand";
import { navigate } from "../router";
import { StudioAudio, type AudioMix } from "./audio";
import { canExportFast, exportFast } from "./fastExport";
import { deleteClip, loadClip, saveClip, type ClipKind } from "./audioStore";
import { MUSIC_LABEL, type MusicId } from "./music";
import {
  BADGE_FILE,
  BADGE_LABEL,
  CAMERA_LABEL,
  CARD_LABEL,
  EFFECT_LABEL,
  ENV_LABEL,
  FORMAT_SIZE,
  PLATFORM_LABEL,
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
import { speechSheet } from "./aiScript";
import { download, recordVideo, videoType } from "./record";
import { autoScene, distributeScript, fitLength, movesLabel, variationScene, type Cursor, type GameTree } from "./wizard";
import { Chess } from "chess.js";
import { StudioStage } from "./stage";
import { currentId, loadProjects, saveProjects, setCurrentId } from "./store";
import { compile, type Timeline } from "./timeline";

type Tab = "szene" | "stil" | "video";
type Tool = "none" | "arrow" | "mark";

interface ExportState {
  phase: "recording" | "done" | "error";
  progress: number;
  url?: string;
  blob?: Blob;
  ext?: string;
  error?: string;
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
  const [sel, setSel] = useState(0);
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
  const scene = project.scenes[Math.min(sel, project.scenes.length - 1)];
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
  const mix = (): AudioMix => {
    const v = project.video;
    const own = clips.id === project.id ? clips : { music: null, voice: null };
    return { music: v.music, musicVolume: v.musicVolume, musicFile: own.music, voice: v.voice ? own.voice : null, voiceVolume: v.voiceVolume, effects: v.sound };
  };
  const storeClip = async (kind: ClipKind, blob: Blob, name = "") => {
    try {
      const buf = await audio().decode(await blob.arrayBuffer());
      await saveClip(project.id, kind, blob);
      setClips((c) => ({ ...(c.id === project.id ? c : { id: project.id, music: null, voice: null }), [kind]: buf }));
      setVideo(kind === "voice" ? { voice: true } : { music: "file", musicName: name });
      setAudioError("");
    } catch {
      setAudioError(kind === "voice" ? "Die Aufnahme ließ sich nicht speichern." : "Diese Datei kann der Browser nicht abspielen. Nimm MP3, M4A, WAV oder OGG.");
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
        mic.getTracks().forEach((t) => t.stop());
        setVoiceRec(null);
        if (parts.length) void storeClip("voice", new Blob(parts, { type: recorder.mimeType || "audio/webm" }));
      };
      const stop = () => recorder.state !== "inactive" && recorder.stop();
      setVoiceRec({ recorder, stop });
      setTime(0);
      recorder.start();
      setPlaying(true);
    } catch {
      setAudioError("Kein Zugriff aufs Mikrofon. Erlaub es in der Adressleiste und versuch es nochmal.");
    }
  };

  // ---- saving (debounced; quota errors are shown, not thrown)
  useEffect(() => {
    const id = window.setTimeout(() => setSaveError(!saveProjects(projects)), 400);
    return () => window.clearTimeout(id);
  }, [projects]);
  useEffect(() => setCurrentId(project.id), [project.id]);

  const update = (fn: (p: StudioProject) => StudioProject) =>
    setProjects((list) => list.map((p) => (p.id === project.id ? { ...fn(p), updatedAt: Date.now() } : p)));
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
      setGlError(e instanceof Error ? e.message : "WebGL fehlt");
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

  const paint = (t: number) => {
    const stage = stageRef.current;
    if (!stage || exp?.phase === "recording") return;
    stage.setSize(Math.round(W * previewScale), Math.round(H * previewScale));
    stage.paint(timeline, project, t, { safeZones: safe, hover: tool !== "none" && hover ? { square: hover, from: pending ?? undefined } : null });
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
      const t = playRef.current.from + (performance.now() - playRef.current.start) / 1000;
      if (t >= timeline.total) {
        setTime(timeline.total);
        setPlaying(false);
        voiceRec?.stop();
        paint(timeline.total);
        return;
      }
      paint(t);
      setTime(t);
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
      if (e.key === " ") {
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
    setSel(Math.max(0, Math.min(sel, project.scenes.length - 2)));
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
      window.alert?.("Die Datei ist kein lesbares Studio-Projekt.");
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
    const audioMix = mix();
    const progress = (k: number) => setExp((x) => (x && x.phase === "recording" ? { ...x, progress: k } : x));
    // Fast path: frames as fast as the device renders them, no waiting for the video's length.
    if (await canExportFast(W, H, project.video.fps, true)) {
      try {
        const blob = await exportFast({
          canvas: out,
          fps: project.video.fps,
          duration: timeline.total,
          paint: (t) => stage.paint(timeline, project, t),
          timeline,
          mix: audioMix,
          onProgress: progress,
          isCancelled: () => cancelRef.current,
        });
        stage.destroy();
        if (!blob) return setExp(null);
        setExp({ phase: "done", progress: 1, blob, url: URL.createObjectURL(blob), ext: "mp4" });
        return;
      } catch {
        // Some encoder setups fail late; the real-time recording below still works there.
        if (cancelRef.current) return setExp(null);
        progress(0);
      }
    }
    sounds.speakers(false);
    try {
      if (!sounds.stream) throw new Error("Ton fehlt");
      const { blob, type } = await recordVideo({
        canvas: out,
        fps: project.video.fps,
        duration: timeline.total,
        paint: (t) => stage.paint(timeline, project, t),
        audio: sounds.stream.stream,
        onStart: () => sounds.schedule(timeline, 0, audioMix),
        onProgress: progress,
        isCancelled: () => cancelRef.current,
      });
      stage.destroy();
      sounds.speakers(true);
      if (cancelRef.current) return setExp(null);
      setExp({ phase: "done", progress: 1, blob, url: URL.createObjectURL(blob), ext: type.ext });
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
  const current = timeline.scenes[sel];
  const sceneError = positions[sel]?.parsed.error;

  return (
    <div class="studio">
      <header class="studio-top">
        <button class="studio-back" onClick={() => navigate({ view: "settings" })} title="Zurück zu den Einstellungen">
          ←
        </button>
        <div class="studio-brand">
          <img src="/icons/logo.svg" alt="" width={28} height={28} />
          <span>
            {BRAND} <b>Studio</b>
          </span>
        </div>
        <select class="studio-projects" value={project.id} onChange={(e) => setProjectId(e.currentTarget.value)} aria-label="Projekt wählen">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input class="studio-name" value={project.name} onInput={(e) => update((p) => ({ ...p, name: e.currentTarget.value }))} aria-label="Name des Videos" />
        <div class="studio-top-actions">
          <button class="btn ghost studio-ai-btn" onClick={() => setDialog("ai")} title="Prompt für ChatGPT, Claude oder Gemini holen und das fertige Skript übernehmen">
            ✦ Mit KI
          </button>
          <button class="btn ghost" onClick={() => setDialog("script")} title="Skript einfügen und auf die Szenen verteilen">
            Skript
          </button>
          <button class="btn ghost" onClick={() => setDialog("new")}>
            + Neues Video
          </button>
          <details class="studio-more">
            <summary class="btn ghost" aria-label="Weitere Aktionen">
              ⋯
            </summary>
            <div class="studio-menu">
              <button onClick={() => openProject({ ...structuredClone(project), id: newId("p"), name: `${project.name} (Kopie)`, updatedAt: Date.now() })}>Duplizieren</button>
              <button onClick={exportJson}>Als Datei sichern</button>
              <button onClick={() => download(new Blob([speechSheet(project)], { type: "text/plain" }), `${FILE_PREFIX}-sprechtext-${slug(project.name)}.txt`)}>Sprechtext mit Zeiten</button>
              <label>
                Datei öffnen…
                <input type="file" accept="application/json,.json" hidden onChange={(e) => e.currentTarget.files?.[0] && void importJson(e.currentTarget.files[0])} />
              </label>
              <button class="danger" onClick={removeProject}>
                Projekt löschen
              </button>
            </div>
          </details>
          <button class="btn primary studio-export" onClick={() => void startExport()} disabled={!type || !ready}>
            Video exportieren
          </button>
        </div>
      </header>

      <aside class="studio-scenes">
        <div class="studio-col-head">
          <span>Szenen</span>
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
                    <span class="studio-scene-title">{s.title || (s.card !== "none" ? CARD_LABEL[s.card] : "Ohne Titel")}</span>
                    <span class="studio-scene-meta">
                      {s.card !== "none" && <em>{CARD_LABEL[s.card]}</em>}
                      {s.moves.trim() ? <code>{s.moves.trim()}</code> : null}
                      <span>{c ? `${c.dur.toFixed(1)} s` : ""}</span>
                    </span>
                  </span>
                </button>
                {i === sel && (
                  <span class="studio-scene-tools">
                    <button onClick={() => moveScene(i, -1)} disabled={i === 0} title="Nach oben">
                      ↑
                    </button>
                    <button onClick={() => moveScene(i, 1)} disabled={i === project.scenes.length - 1} title="Nach unten">
                      ↓
                    </button>
                    <button onClick={() => duplicateScene(i)} title="Duplizieren">
                      ⧉
                    </button>
                    <button onClick={() => removeScene(i)} disabled={project.scenes.length <= 1} title="Löschen">
                      ✕
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <button class="btn studio-add" onClick={addScene}>
          + Szene
        </button>
      </aside>

      <main class="studio-stage">
        <div class="studio-canvas-wrap" ref={wrapRef}>
          {glError ? (
            <p class="studio-gl-error">3D geht auf diesem Gerät nicht: {glError}</p>
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
              <span class="rec">● Aufnahme</span>
              <p>{timeline.scenes[sel]?.scene.speech || timeline.scenes[sel]?.scene.text || "…"}</p>
              {timeline.scenes[sel + 1]?.scene.speech && <p class="next">{timeline.scenes[sel + 1].scene.speech}</p>}
              <button onClick={voiceRec.stop}>Stopp</button>
            </div>
          )}
          {tool !== "none" && (
            <div class="studio-tool-hint">
              {tool === "arrow" ? (pending ? `Pfeil von ${pending}: jetzt das Zielfeld anklicken` : "Startfeld des Pfeils anklicken") : "Felder anklicken zum Markieren"}
              <button onClick={() => (setTool("none"), setPending(null))}>Fertig</button>
            </div>
          )}
        </div>
        <div class="studio-transport">
          <button class="studio-play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Abspielen"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <div class="studio-scrub">
            <div class="studio-segments">
              {timeline.scenes.map((c, i) => (
                <button
                  key={c.scene.id}
                  class={`${i === sel ? "on" : ""} ${c.scene.card !== "none" ? "card" : ""}`}
                  style={{ flexGrow: c.dur }}
                  onClick={() => selectScene(i)}
                  title={`Szene ${i + 1}`}
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
              aria-label="Zeit"
            />
          </div>
          <span class="studio-time">
            {fmtTime(time)} / {fmtTime(timeline.total)}
          </span>
          <div class="studio-speed" title="Tempo des ganzen Videos">
            {[0.75, 1, 1.25, 1.5].map((sp) => (
              <button key={sp} class={Math.abs(project.video.speed - sp) < 0.01 ? "on" : ""} onClick={() => setVideo({ speed: sp })}>
                {String(sp).replace(".", ",")}×
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
            aria-label="Auf Länge kürzen"
          >
            <option value="">Länge …</option>
            {[15, 30, 45, 60, 90].map((n) => (
              <option key={n} value={n}>
                auf {n} s anpassen
              </option>
            ))}
          </select>
          <label class="studio-safe" title="Zeigt, wo die App ihre Knöpfe hinlegt (nicht im Video)">
            <input type="checkbox" checked={safe} onChange={() => setSafe(!safe)} /> Sichere Zone
          </label>
        </div>
      </main>

      <aside class="studio-panel">
        <div class="studio-tabs" role="tablist">
          {(["szene", "stil", "video"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} class={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "szene" ? `Szene ${sel + 1}` : t === "stil" ? "Stil" : "Video"}
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
              tool={tool}
              tone={tone}
              style={project.style}
              onTool={(t) => {
                setTool(t);
                setPending(null);
                if (t !== "none") setTime(showcase(timeline, sel));
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
          {tab === "video" && (
            <SoundPanel
              video={project.video}
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
        {saveError && <p class="studio-warn">Speicher voll: Änderungen sind nicht gesichert. Sichere das Projekt als Datei.</p>}
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
              if (extra.length && next && !next.fen) list[sel + 1] = { ...next, fen: played.fen(), label: next.label || "Zurück zur Hauptvariante" };
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
                <h3>Video wird aufgenommen …</h3>
                <p class="muted">Das Video wird so schnell erstellt, wie dein Gerät es schafft (in alten Browsern in Echtzeit, {fmtTime(timeline.total)}). Lass diesen Tab bitte im Vordergrund.</p>
                <div class="studio-bar">
                  <span style={{ width: `${Math.round(exp.progress * 100)}%` }} />
                </div>
                <button class="btn ghost" onClick={() => (cancelRef.current = true)}>
                  Abbrechen
                </button>
              </>
            )}
            {exp.phase === "done" && exp.url && (
              <>
                <h3>Fertig!</h3>
                <video src={exp.url} controls autoplay loop playsInline class={`studio-result f${project.video.format.replace(":", "x")}`} />
                <p class="small muted">
                  {W}×{H}, {project.video.fps} fps, {exp.ext?.toUpperCase()}, {((exp.blob?.size ?? 0) / 1e6).toFixed(1)} MB
                  {exp.ext === "webm" ? " · TikTok und Instagram nehmen MP4 am liebsten: in Chrome oder Safari exportieren." : ""}
                </p>
                <div class="studio-modal-actions">
                  <button class="btn primary" onClick={() => exp.blob && download(exp.blob, `${FILE_PREFIX}-${slug(project.name)}.${exp.ext}`)}>
                    Herunterladen
                  </button>
                  <button class="btn ghost" onClick={closeExport}>
                    Schließen
                  </button>
                </div>
              </>
            )}
            {exp.phase === "error" && (
              <>
                <h3>Export fehlgeschlagen</h3>
                <p class="muted">{exp.error}</p>
                <button class="btn ghost" onClick={closeExport}>
                  Schließen
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
    return window.confirm("Dieses Video-Projekt wirklich löschen?");
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

function ToneChips({ value, style, onChange }: { value: Tone; style: StudioStyle; onChange: (t: Tone) => void }) {
  return (
    <div class="studio-tones">
      {(Object.keys(TONE_LABEL) as Tone[]).map((t) => (
        <button key={t} class={t === value ? "on" : ""} onClick={() => onChange(t)} title={TONE_LABEL[t]} style={{ "--tone": toneColor(t, style) }}>
          <span />
          {TONE_LABEL[t]}
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
  tool: Tool;
  tone: Tone;
  style: StudioStyle;
  onTool: (t: Tool) => void;
  onTone: (t: Tone) => void;
  onChange: (patch: Partial<Scene>) => void;
}) {
  const [fenOpen, setFenOpen] = useState(Boolean(scene.fen));
  useEffect(() => setFenOpen(Boolean(scene.fen)), [scene.id]);
  return (
    <div class="studio-form">
      <Field label="Karte über dem Brett">
        <Seg<Card> value={scene.card} options={(Object.keys(CARD_LABEL) as Card[]).map((c) => [c, CARD_LABEL[c]])} onChange={(card) => onChange({ card, countdown: (card === "question" || card === "poll") && !scene.countdown ? 3 : scene.countdown })} />
      </Field>
      {(scene.card === "question" || scene.card === "poll") && <Slider label="Countdown" value={scene.countdown} min={0} max={10} step={1} unit=" s" onChange={(countdown) => onChange({ countdown })} />}
      <Field
        label="Züge in dieser Szene"
        hint={error ? <span class="bad">„{error}“ ist hier kein gültiger Zug.</span> : "Deutsch oder Englisch, z. B. 1. e4 e5 2. Sf3. Leer lassen für eine Erklär-Szene ohne Zug."}
      >
        <input class={error ? "invalid" : ""} value={scene.moves} onInput={(e) => onChange({ moves: e.currentTarget.value })} placeholder="z. B. 3. Lb5" spellcheck={false} />
      </Field>
      <div class="studio-quick">
        <button onClick={onBoard}>♞ Auf dem Brett vorspielen</button>
        <button onClick={onAuto} disabled={!scene.moves.trim()} title="Untertitel, Pfeile und Markierungen aus den Zügen">
          ✦ Automatisch erklären
        </button>
      </div>
      {fenOpen ? (
        <Field label="Vorher zu dieser Stellung springen (FEN)" hint={scene.fen && !validFen(scene.fen) ? <span class="bad">Diese FEN ist ungültig.</span> : "Für „Was wäre wenn“: die Figuren blenden zur neuen Stellung über."}>
          <input value={scene.fen} onInput={(e) => onChange({ fen: e.currentTarget.value })} placeholder={START_FEN} spellcheck={false} />
        </Field>
      ) : (
        <button class="studio-link" onClick={() => setFenOpen(true)}>
          + Zu einer anderen Stellung springen
        </button>
      )}
      {scene.card === "poll" && (
        <Field label="Antworten der Umfrage" hint="z. B. „A) Lb5“. Die Zuschauer stimmen in den Kommentaren ab.">
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
      <Field label="Kleine Zeile über der Überschrift" hint="z. B. „Variante 2“ oder „Teil 1“.">
        <input value={scene.label} onInput={(e) => onChange({ label: e.currentTarget.value })} maxLength={40} />
      </Field>
      <Field label="Überschrift">
        <input value={scene.title} onInput={(e) => onChange({ title: e.currentTarget.value })} maxLength={120} />
      </Field>
      <Field label="Untertitel" hint="*Sternchen* um ein Wort färben es ein. Ein | teilt den Text in nacheinander gezeigte Teile.">
        <textarea rows={3} value={scene.text} onInput={(e) => onChange({ text: e.currentTarget.value })} maxLength={900} />
      </Field>
      <Slider label="Dauer" value={scene.duration} min={1} max={15} step={0.1} unit=" s" onChange={(duration) => onChange({ duration })} />
      {effective > scene.duration + 0.05 && <p class="studio-hint">Die Szene braucht {effective.toFixed(1)} s (Züge, Effekte oder Sprechtext), so lange läuft sie.</p>}
      <Field label="Sprechtext" hint="Was du über diese Szene sagst. Erscheint nicht im Video; die Szene läuft lang genug dafür. Unter ⋯ als Liste mit Zeiten.">
        <textarea rows={2} value={scene.speech} onInput={(e) => onChange({ speech: e.currentTarget.value })} maxLength={1200} placeholder="Optional" />
      </Field>

      <h4 class="studio-sub">Effekte</h4>
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
      <Field label="Bewertung des Zugs" hint={scene.badge ? `${BADGE_LABEL[scene.badge]}: dasselbe Zeichen wie in der Analyse, über dem Feld des letzten Zugs.` : "Dasselbe Zeichen wie in der Analyse, über dem Feld des letzten Zugs."}>
        <div class="studio-badges">
          {(Object.keys(BADGE_LABEL) as Badge[]).map((b) => (
            <button key={b || "none"} class={scene.badge === b ? "on" : ""} onClick={() => onChange({ badge: b })} title={BADGE_LABEL[b]} aria-label={BADGE_LABEL[b]}>
              {b ? <img src={`${import.meta.env.BASE_URL}badges/${BADGE_FILE[b]}`} alt="" width={30} height={30} /> : "–"}
            </button>
          ))}
        </div>
      </Field>
      <Slider label="Zugtempo dieser Szene" value={scene.tempo} min={0.3} max={3} step={0.05} unit="×" onChange={(tempo) => onChange({ tempo })} />

      <h4 class="studio-sub">Kamera</h4>
      <p class="studio-hint">Immer aus Sicht von {perspective === "black" ? "Schwarz" : "Weiß"}, änderbar unter „Video“.</p>
      <div class="studio-cams">
        {(Object.keys(CAMERA_LABEL) as CameraPreset[]).map((c) => (
          <button key={c} class={scene.camera === c ? "on" : ""} onClick={() => onChange({ camera: c })}>
            <CamIcon preset={c} />
            {CAMERA_LABEL[c]}
          </button>
        ))}
      </div>
      <details class="studio-fine">
        <summary>Feinschliff der Kamera</summary>
      <Slider label="Zoom" value={scene.zoom} min={0.45} max={1.6} step={0.05} unit="×" onChange={(zoom) => onChange({ zoom })} />
      <Slider label="Kamerafahrt (Drehung)" value={scene.orbit} min={-30} max={30} step={1} unit="°/s" onChange={(orbit) => onChange({ orbit })} />
      </details>
      <Toggle label="Auf den Zug zoomen" checked={scene.focus} onChange={(focus) => onChange({ focus })} />

      <h4 class="studio-sub">Pfeile und Felder</h4>
      <div class="studio-draw">
        <button class={tool === "arrow" ? "on" : ""} onClick={() => onTool(tool === "arrow" ? "none" : "arrow")}>
          ↗ Pfeil zeichnen
        </button>
        <button class={tool === "mark" ? "on" : ""} onClick={() => onTool(tool === "mark" ? "none" : "mark")}>
          ▣ Feld markieren
        </button>
      </div>
      <ToneChips value={tone} style={style} onChange={onTone} />
      {(scene.arrows.length > 0 || scene.marks.length > 0) && (
        <ul class="studio-annos">
          {scene.arrows.map((a, i) => (
            <li key={`a${i}`}>
              <span class="dot" style={{ background: toneColor(a.tone, style) }} />
              Pfeil {a.from} → {a.to}
              <button onClick={() => onChange({ arrows: scene.arrows.filter((_, k) => k !== i) })} aria-label="Pfeil löschen">
                ✕
              </button>
            </li>
          ))}
          {scene.marks.map((m, i) => (
            <li key={`m${i}`}>
              <span class="dot sq" style={{ background: toneColor(m.tone, style) }} />
              Feld {m.square}
              <button onClick={() => onChange({ marks: scene.marks.filter((_, k) => k !== i) })} aria-label="Markierung löschen">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {lucena && (
        <Field label="Lucenas Stimmung">
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
      <Field label="Brett" hint={style.view === "2d" ? "Flach von oben mit den Figuren der Website: am leichtesten zu verfolgen, besonders auf dem Handy. Standard für YouTube-Lernvideos." : style.view === "billboard" ? "3D-Brett mit Kamerafahrten, die Figuren sind flache Aufsteller, die sich immer zur Kamera drehen." : "Plastisches Show-Brett mit Kamerafahrten, für TikTok, Reels und Shorts."}>
        <Seg<BoardView> value={style.view} options={VIEWS.map((b) => [b, VIEW_LABEL[b]] as [BoardView, string])} onChange={(view) => onChange({ view })} />
      </Field>
      <Field label="Look">
        <div class="studio-themes">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => {
            const t = THEMES[id];
            return (
              <button key={id} class={style.theme === id ? "on" : ""} onClick={() => onChange(styleFromTheme(id, { reflection: style.reflection, coords: style.coords, titleFont: style.titleFont, pieceRim: style.pieceRim, captionStyle: style.captionStyle, textScale: style.textScale, environment: style.environment, view: style.view }))}>
                <span class="studio-swatch" style={{ background: `linear-gradient(135deg, ${t.bgTop}, ${t.bgBottom})` }}>
                  <i style={{ background: t.light }} />
                  <i style={{ background: t.dark }} />
                  <i style={{ background: t.accent }} />
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </Field>
      {isBoard3d(style.view) && <Field label="Wo das Brett steht">
        <div class="studio-envs">
          {(Object.keys(ENV_LABEL) as Environment[]).map((e) => (
            <button key={e} class={style.environment === e ? "on" : ""} onClick={() => onChange({ environment: e })}>
              <span class={`studio-env-icon env-${e}`} />
              {ENV_LABEL[e]}
            </button>
          ))}
        </div>
      </Field>}
      <h4 class="studio-sub">Farben</h4>
      <div class="studio-colours">
        {colour("Helle Felder", "light")}
        {colour("Dunkle Felder", "dark")}
        {colour("Rahmen", "frame")}
        {style.view === "3d" && colour("Weiße Figuren", "whitePiece")}
        {style.view === "3d" && colour("Schwarze Figuren", "blackPiece")}
        {colour("Akzent", "accent")}
        {colour("Hintergrund oben", "bgTop")}
        {colour("Hintergrund unten", "bgBottom")}
      </div>
      {style.view === "3d" && <Field label="Figuren">
        <Seg<Material>
          value={style.material}
          options={(Object.keys(MATERIAL_LABEL) as Material[]).map((m) => [m, MATERIAL_LABEL[m]] as [Material, string])}
          onChange={(material) => onChange({ material })}
        />
      </Field>}
      <Field label="Schrift der Überschriften">
        <Seg<"sans" | "serif">
          value={style.titleFont}
          options={[
            ["sans", "Modern"],
            ["serif", "Elegant"],
          ]}
          onChange={(titleFont) => onChange({ titleFont })}
        />
      </Field>
      <Field label="Untertitel">
        <Seg<CaptionStyle> value={style.captionStyle} options={(Object.keys(CAPTION_LABEL) as CaptionStyle[]).map((c) => [c, CAPTION_LABEL[c]] as [CaptionStyle, string])} onChange={(captionStyle) => onChange({ captionStyle })} />
      </Field>
      <Slider label="Textgröße" value={style.textScale} min={0.8} max={1.3} step={0.05} unit="×" onChange={(textScale) => onChange({ textScale })} />
      {style.view === "3d" && <Toggle label="Heller Rand an den Figuren (besser zu unterscheiden)" checked={style.pieceRim} onChange={(pieceRim) => onChange({ pieceRim })} />}
      {style.view === "3d" && <Toggle label="Spiegelung im Brett" checked={style.reflection} onChange={(reflection) => onChange({ reflection })} />}
      <Toggle label="Koordinaten am Rand" checked={style.coords} onChange={(coords) => onChange({ coords })} />
    </div>
  );
}

// ---------- video ----------

function VideoEditor({ project, type, onVideo, onStyle, onStart }: { project: StudioProject; type: string | null; onVideo: (p: Partial<StudioVideo>) => void; onStyle: (p: Partial<StudioStyle>) => void; onStart: (fen: string) => void }) {
  const v = project.video;
  return (
    <div class="studio-form">
      <Field label="Sicht aufs Brett" hint="Gilt für alle Szenen: die Kameras drehen sich mit, so bleibt die Seite im ganzen Video gleich.">
        <Seg<Side>
          value={v.perspective}
          options={[
            ["white", "Weiß unten"],
            ["black", "Schwarz unten"],
          ]}
          onChange={(perspective) => onVideo({ perspective })}
        />
      </Field>
      <Field label="Plattform" hint="Bestimmt die sichere Zone in der Vorschau und bei YouTube das Querformat.">
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
      <Field label="Format">
        <Seg<Format>
          value={v.format}
          options={[
            ["9:16", "9:16 TikTok/Reels"],
            ["1:1", "1:1"],
            ["16:9", "16:9 YouTube"],
          ]}
          onChange={(format) => onVideo({ format })}
        />
      </Field>
      <Field label="Bilder pro Sekunde">
        <Seg<30 | 60>
          value={v.fps}
          options={[
            [30, "30"],
            [60, "60 (flüssiger)"],
          ]}
          onChange={(fps) => onVideo({ fps })}
        />
      </Field>
      <Slider label="Tempo des ganzen Videos" value={v.speed} min={0.5} max={2.5} step={0.05} unit="×" onChange={(speed) => onVideo({ speed })} />
      <Slider label="Tempo nur der Figuren" value={v.tempo} min={0.4} max={2.5} step={0.05} unit="×" onChange={(tempo) => onVideo({ tempo })} />
      <h4 class="studio-sub">Im Bild</h4>
      <Toggle label={`Logo und Name ${BRAND}`} checked={v.brand} onChange={(brand) => onVideo({ brand })} />
      <Toggle label="Webadresse" checked={v.watermark} onChange={(watermark) => onVideo({ watermark })} />
      <Toggle label="Lucena spricht die Untertitel" checked={v.lucena} onChange={(lucena) => onVideo({ lucena })} />
      <Toggle label="Zug-Anzeige (z. B. 3. Lb5)" checked={v.movePill} onChange={(movePill) => onVideo({ movePill })} />
      {v.movePill && <Toggle label="Zug in Worten darunter („Weiß: Läufer von f1 nach b5“)" checked={v.plainMoves} onChange={(plainMoves) => onVideo({ plainMoves })} />}
      <Toggle label="Notation in Titeln und Untertiteln ausschreiben („Sf3“ wird „Springer f3“)" checked={v.spellMoves} onChange={(spellMoves) => onVideo({ spellMoves })} />
      <Toggle label="Felder aus dem Untertitel leuchten auf" checked={v.squareHints} onChange={(squareHints) => onVideo({ squareHints })} />
      <Toggle label="Letzten Zug hervorheben" checked={v.lastMove} onChange={(lastMove) => onVideo({ lastMove })} />
      <Toggle label="Fortschrittsbalken" checked={v.progress} onChange={(progress) => onVideo({ progress })} />
      {v.format === "16:9" && <Toggle label="Lernvideo: Brett links, Erklärung und Züge rechts" checked={v.lesson} onChange={(lesson) => onVideo({ lesson })} />}
      <Toggle label="Kamerafahrt zum Start" checked={v.introFly} onChange={(introFly) => onVideo({ introFly })} />
      <Field label="Startstellung (FEN)" hint={!validFen(project.startFen) ? <span class="bad">Ungültig, es gilt die Grundstellung.</span> : "Für Rätsel oder Endspiele; leer = Grundstellung."}>
        <input value={project.startFen === START_FEN ? "" : project.startFen} placeholder="Grundstellung" onInput={(e) => onStart(e.currentTarget.value.trim() || START_FEN)} spellcheck={false} />
      </Field>
      <p class="studio-hint">
        Export als {type ? type.toUpperCase() : "– (Browser kann nicht aufnehmen)"}. Der Export läuft meist schneller als das Video lang ist, ohne Ton für dich, aber mit Musik, deiner Stimme und den Effekt-Tönen im Video.
      </p>
    </div>
  );
}

// ---------- music and voice ----------

function SoundPanel(p: {
  video: StudioVideo;
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
      <h4 class="studio-sub">Musik</h4>
      <div class="studio-speed wrap">
        {(Object.keys(MUSIC_LABEL) as MusicId[])
          .filter((m) => m !== "file" || v.musicName)
          .map((m) => (
            <button key={m} class={v.music === m ? "on" : ""} onClick={() => p.onVideo({ music: m })}>
              {m === "file" ? `♪ ${v.musicName}` : MUSIC_LABEL[m]}
            </button>
          ))}
        <label class="btn ghost small">
          Eigene Musik …
          <input type="file" accept="audio/*" hidden onChange={(e) => e.currentTarget.files?.[0] && p.onMusicFile(e.currentTarget.files[0])} />
        </label>
      </div>
      {v.music !== "none" && <Slider label="Lautstärke Musik" value={v.musicVolume} min={0} max={1} step={0.05} unit="" onChange={(musicVolume) => p.onVideo({ musicVolume })} />}
      <p class="studio-hint">Lo-fi, Spannung und Episch macht das Studio selbst, die darfst du überall frei nutzen. Bei eigener Musik brauchst du die Rechte (auf TikTok am besten den Sound dort in der App drüberlegen).</p>

      <h4 class="studio-sub">Deine Stimme</h4>
      <div class="studio-voice">
        <button class={`btn ${p.recording ? "danger" : "primary"}`} onClick={p.onRecord}>
          {p.recording ? "■ Aufnahme stoppen" : p.hasVoice ? "● Neu einsprechen" : "● Einsprechen"}
        </button>
        <label class="btn ghost">
          Datei …
          <input type="file" accept="audio/*" hidden onChange={(e) => e.currentTarget.files?.[0] && p.onVoiceFile(e.currentTarget.files[0])} />
        </label>
        {p.hasVoice && !p.recording && (
          <button class="btn ghost" onClick={p.onRemoveVoice}>
            Löschen
          </button>
        )}
      </div>
      {p.hasVoice && (
        <>
          <Toggle label="Stimme im Video" checked={v.voice} onChange={(voice) => p.onVideo({ voice })} />
          <Slider label="Lautstärke Stimme" value={v.voiceVolume} min={0} max={1.5} step={0.05} unit="" onChange={(voiceVolume) => p.onVideo({ voiceVolume })} />
        </>
      )}
      <p class="studio-hint">Das Video läuft von vorn, über dem Bild steht dein Sprechtext. Kopfhörer helfen. Die Musik wird leiser, solange deine Stimme läuft.</p>
      <Toggle label="Effekt-Töne (Matt, Zoom, Konfetti)" checked={v.sound} onChange={(sound) => p.onVideo({ sound })} />
      {p.error && <p class="studio-warn">{p.error}</p>}
    </div>
  );
}

// ---------- new project ----------

function NewDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (p: StudioProject) => void }) {
  const [name, setName] = useState("Die Italienische Partie");
  const [moves, setMoves] = useState("1. e4 e5 2. Sf3 Sc6 3. Lc4 Lc5");
  const [pairs, setPairs] = useState(true);
  const built = useMemo(() => fromMoves(name, moves, START_FEN, pairs), [name, moves, pairs]);
  return (
    <div class="studio-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="studio-modal-card wide">
        <h3>Neues Video</h3>
        <div class="studio-templates">
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => onCreate(t.make())}>
              <b>{t.label}</b>
              <span>{t.hint}</span>
            </button>
          ))}
        </div>
        <h4 class="studio-sub">Oder aus einer Zugliste</h4>
        <div class="studio-form">
          <Field label="Titel">
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </Field>
          <Field label="Züge (PGN)" hint={built.error ? <span class="bad">Ab „{built.error}“ geht es nicht weiter.</span> : `${built.project.scenes.length - 2} Szenen mit Platzhaltertexten.`}>
            <textarea rows={3} value={moves} onInput={(e) => setMoves(e.currentTarget.value)} spellcheck={false} />
          </Field>
          <Toggle label="Weiß- und Schwarzzug in einer Szene" checked={pairs} onChange={setPairs} />
        </div>
        <div class="studio-modal-actions">
          <button class="btn primary" onClick={() => onCreate(built.project)}>
            Erstellen
          </button>
          <button class="btn ghost" onClick={onClose}>
            Abbrechen
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
        <h3>Skript auf die Szenen verteilen</h3>
        <p class="muted small">
          Sätze, die einen Zug nennen (z. B. „Mit Lb5 …“), landen bei der Szene mit diesem Zug. Die anderen verteilen sich der Reihe nach dazwischen, ein Aufruf wie „Folge für mehr“ kommt in den
          Abspann. Jede Szene bekommt genug Zeit zum Mitlesen.
        </p>
        <textarea class="wz-script" rows={10} value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Dein Skript …" />
        <div class="studio-modal-actions">
          <button class="btn primary" disabled={!text.trim()} onClick={() => onApply(text)}>
            Verteilen
          </button>
          <label class="btn ghost">
            Textdatei …
            <input type="file" accept=".txt,.md,text/plain" hidden onChange={(e) => e.currentTarget.files?.[0] && void readFile(e.currentTarget.files[0])} />
          </label>
          <button class="btn ghost" onClick={onClose}>
            Abbrechen
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
          <h3>Züge dieser Szene vorspielen</h3>
          <button class="wz-close" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </header>
        <div class="wz-body">
          <MoveRecorder
            tree={tree}
            cursor={cursor}
            allowFen={false}
            onChange={(t, c) => {
              setTree(t);
              setCursor(c);
            }}
          />
        </div>
        <footer class="wz-foot">
          <span class="wz-summary">{tree.variations.length ? `${tree.variations.length} Variante(n) werden als eigene Szenen eingefügt` : "Andere Züge nach dem Zurückgehen werden Varianten"}</span>
          <button class="btn primary" onClick={() => onApply(tree)}>
            Übernehmen
          </button>
        </footer>
      </div>
    </div>
  );
}
