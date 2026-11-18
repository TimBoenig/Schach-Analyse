// Puts the pieces together for one frame: timeline -> 3D board -> 2D layer.
// Used by the editor preview and, at full size, by the video export.
import { Orb } from "../coach/orb";
import { compose, type Assets, type ComposeOptions } from "./compose";
import { BADGE_FILE } from "./model";
import type { StudioProject } from "./model";
import { StudioRenderer } from "./renderer";
import { frameAt, type Frame, type Timeline } from "./timeline";

export class StudioStage {
  readonly out: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly renderer: StudioRenderer;
  private assets: Assets = { logo: null, orb: null, badges: {} };
  private orb: Orb | null = null;
  private orbCanvas: HTMLCanvasElement | null = null;

  constructor(out: HTMLCanvasElement) {
    this.out = out;
    this.ctx = out.getContext("2d")!;
    this.renderer = new StudioRenderer();
  }

  /** Logo and fonts must be loaded before the first frame, or the canvas uses fallbacks. */
  async load(): Promise<void> {
    const logo = new Image();
    logo.src = "/icons/logo.svg";
    await Promise.all([
      logo.decode().then(() => (this.assets.logo = logo)).catch(() => undefined),
      // The same move badges as the analysis page.
      ...Object.entries(BADGE_FILE).map(([kind, file]) => {
        const img = new Image();
        img.src = `${import.meta.env.BASE_URL}badges/${file}`;
        return img
          .decode()
          .then(() => (this.assets.badges[kind] = img))
          .catch(() => undefined);
      }),
      document.fonts?.load('700 40px "Geist"').catch(() => undefined),
      document.fonts?.load('500 40px "Geist"').catch(() => undefined),
      document.fonts?.load('400 40px "Instrument Serif"').catch(() => undefined),
    ]);
  }

  private ensureOrb(on: boolean): void {
    if (!on) {
      this.assets.orb = null;
      return;
    }
    if (!this.orb) {
      this.orbCanvas = document.createElement("canvas");
      this.orb = new Orb(this.orbCanvas, 160, "happy", false);
      this.orb.ignorePointer = true;
    }
    this.assets.orb = this.orbCanvas;
  }

  setSize(w: number, h: number): void {
    if (this.out.width !== w || this.out.height !== h) {
      this.out.width = w;
      this.out.height = h;
    }
    this.renderer.resize(w, h);
  }

  paint(timeline: Timeline, project: StudioProject, t: number, opts: ComposeOptions = {}): Frame | null {
    const frame = frameAt(timeline, project, t);
    if (!frame) return null;
    if (!project.video.lastMove) frame.lastMove = null;
    this.ensureOrb(project.video.lucena);
    if (this.orb) {
      this.orb.setMood(frame.mood);
      this.orb.tick(performance.now());
    }
    this.renderer.render(frame, project.style);
    compose(this.ctx, frame, project, this.renderer.canvas, this.renderer.viewProj, this.assets, opts);
    return frame;
  }

  destroy(): void {
    this.orb?.destroy();
  }
}
