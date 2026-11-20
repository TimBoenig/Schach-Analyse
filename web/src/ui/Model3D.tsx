// A small 3D object (chess piece, cup) that turns slowly and can be spun with
// the mouse or a finger. The renderer is fetched only when the first object
// scrolls into view, and nothing moves with "reduce motion" or off screen.
import { useEffect, useRef, useState } from "preact/hooks";

import type { ModelKind } from "./three/models";
import { t } from "../i18n";

type Render = (target: HTMLCanvasElement, kind: ModelKind, yaw: number, tilt: number) => boolean;

let renderer: Promise<Render> | null = null;
const loadRenderer = () => (renderer ??= import("./three/renderer").then((m) => m.renderModel));

export function Model3D({
  kind,
  size = 120,
  label,
  class: extra = "",
}: {
  kind: ModelKind;
  size?: number;
  /** Text alternative; without it the object is decoration. */
  label?: string;
  class?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const px = Math.round(size * Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = canvas.height = px;
    let render: Render | null = null;
    let raf = 0;
    let visible = false;
    let closed = false;
    let yaw = -0.5;
    let speed = still ? 0 : 0.5;
    let last = 0;
    let drag: { x: number; at: number } | null = null;

    const paint = () => {
      if (render && !render(canvas, kind, yaw, 0.2)) setGone(true);
    };
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      if (!drag) {
        yaw += speed * dt;
        // After a push the object slows down to its calm turn (or to a stop).
        const rest = still ? 0 : 0.5;
        speed += (rest - speed) * (1 - Math.exp(-dt * 1.6));
      }
      paint();
      const moving = drag || Math.abs(speed) > 0.01;
      if (visible && !document.hidden && moving) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (!raf && render && visible && !closed) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    const observer = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (!visible) return;
      if (render) return wake();
      loadRenderer()
        .then((r) => {
          if (closed) return;
          render = r;
          paint();
          wake();
        })
        .catch(() => setGone(true));
    });
    observer.observe(canvas);

    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, at: e.timeStamp };
      canvas.setPointerCapture(e.pointerId);
      wake();
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dt = Math.max(1, e.timeStamp - drag.at) / 1000;
      yaw += dx * 0.012;
      speed = Math.max(-14, Math.min(14, (dx * 0.012) / dt));
      drag = { x: e.clientX, at: e.timeStamp };
      wake();
    };
    const up = () => {
      drag = null;
      wake();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    document.addEventListener("visibilitychange", wake);

    return () => {
      closed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [kind, size]);

  // No WebGL on this device: the page simply goes without the ornament.
  if (gone) return null;
  return (
    <span class={`model3d ${extra}`} style={{ "--model-size": `${size}px` }}>
      <canvas ref={ref} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"} title={t("Zum Drehen ziehen")} />
    </span>
  );
}
