/**
 * Tim wants the page never to zoom, on any device. The viewport meta and CSS
 * (touch-action) cover most browsers; iOS Safari ignores user-scalable, so its
 * pinch gesture events are cancelled here, and on a computer Ctrl + wheel and
 * Ctrl + / - / 0 are swallowed. The browser's own menu zoom can't be stopped.
 */
export function blockZoom(): void {
  const stop = (e: Event) => e.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, stop, { passive: false });
  document.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0", "_"].includes(e.key)) e.preventDefault();
  });
  // Two-finger touch moves (pinch) on browsers that deliver them as plain touch events.
  document.addEventListener("touchmove", (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
}
