// Soft shadows and glows for pieces, from one cached radial sprite.
//
// `ctx.shadowBlur` on a drawImage blurs the piece's whole picture again on every frame, for every piece
// (32 blurs per frame on a full board). That is what made the preview stutter on tablets, and on some
// browsers the blur of a transformed SVG picture is cut off at the picture's box, which shows up as a
// faint square behind a piece while it hops. A pre-blurred sprite costs one plain drawImage and has no box.

const sprites = new Map<string, HTMLCanvasElement>();

function sprite(rgb: string): HTMLCanvasElement {
  let c = sprites.get(rgb);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Eased to zero well inside the sprite, so no edge of it is ever visible.
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.35, `rgba(${rgb},0.55)`);
    grad.addColorStop(0.7, `rgba(${rgb},0.14)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    sprites.set(rgb, c);
  }
  return c;
}

/** A soft round blob of `rgb` ("0,0,0") centred on x, y with the given radii; `alpha` scales it. */
export function softBlob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number, rgb = "0,0,0"): void {
  if (alpha <= 0.005) return;
  const keep = ctx.globalAlpha;
  ctx.globalAlpha = keep * Math.min(1, alpha);
  ctx.drawImage(sprite(rgb), x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = keep;
}
