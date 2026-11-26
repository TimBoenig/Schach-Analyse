// Puts the pieces together for one frame: timeline -> 3D board -> 2D layer.
// Used by the editor preview and, at full size, by the video export.
import { Orb } from "../coach/orb";
import { compose, type Assets, type ComposeOptions } from "./compose";
import { drawStandees, FlatBoard, pieceKey } from "./flat";
import { BADGE_FILE } from "./model";
import type { BoardView, StudioProject } from "./model";
import { StudioRenderer } from "./renderer";
import { paintReel, reelSquareAt, type ReelView } from "./reel";
import { paintImpact } from "./impact";
import { frameAt, type Frame, type Timeline } from "./timeline";

export class StudioStage {
  readonly out: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly renderer: StudioRenderer;
  private assets: Assets = { logo: null, orb: null, badges: {}, pieces: {} };
  /** The flat board, made on first use. */
  private flat: FlatBoard | null = null;
  private lastView: BoardView = "3d";
  private reelView: ReelView | null = null;
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
      // The site's own 2D pieces: the flat board and the move symbols (figurines) in texts.
      ...(["w", "b"] as const).flatMap((c) =>
        (["p", "n", "b", "r", "q", "k"] as const).map((tk) => {
          const img = new Image();
          img.src = `${import.meta.env.BASE_URL}pieces/${pieceKey(c, tk)}.svg`;
          return img
            .decode()
            .then(() => (this.assets.pieces[pieceKey(c, tk)] = img))
            .catch(() => undefined);
        }),
      ),
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
    this.flat?.resize(w, h);
  }

  /** The square under a point of the picture (0..1, y down), in whichever board was painted last. */
  squareAt(sx: number, sy: number): string | null {
    if (this.lastView === "reel") return this.reelView ? reelSquareAt(this.reelView, sx, sy) : null;
    return this.lastView === "2d" && this.flat ? this.flat.squareAt(sx, sy) : this.renderer.squareAt(sx, sy);
  }

  paint(timeline: Timeline, project: StudioProject, tk: number, opts: ComposeOptions = {}): Frame | null {
    const frame = frameAt(timeline, project, tk);
    if (!frame) return null;
    if (!project.video.lastMove) frame.lastMove = null;
    this.ensureOrb(project.video.lucena);
    if (this.orb) {
      this.orb.setMood(frame.mood);
      // Video time, not wall time: the fast export paints frames quicker than real time.
      this.orb.tick(tk * 1000);
    }
    this.lastView = project.style.view;
    if (project.style.view === "reel") {
      // Its own tilted board in one 2D layer: no GL pass, no flat canvas.
      this.reelView = paintReel(this.ctx, frame, project, this.assets);
    } else if (project.style.view === "2d") {
      if (!this.flat) this.flat = new FlatBoard();
      this.flat.resize(this.out.width, this.out.height);
      this.flat.render(frame, project.style, this.assets.pieces);
      compose(this.ctx, frame, project, this.flat.canvas, this.flat.viewProj, this.assets, opts);
    } else {
      this.renderer.render(frame, project.style);
      const sprites = project.style.view === "billboard" ? (ctx: CanvasRenderingContext2D) => drawStandees(ctx, frame, this.renderer.viewProj, this.assets.pieces) : undefined;
      compose(this.ctx, frame, project, this.renderer.canvas, this.renderer.viewProj, this.assets, opts, sprites);
    }
    // Whip blur, RGB split, invert flash and the stamped word go over every look.
    paintImpact(this.ctx, frame, project.style.view === "reel" && project.style.reelLook === "close");
    return frame;
  }

  destroy(): void {
    this.orb?.destroy();
  }
}
