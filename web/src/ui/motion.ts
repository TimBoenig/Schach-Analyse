// Page motion shared by every view: cards rise into place as they scroll into
// view and their bars, columns and lines grow once. Driven by one observer on
// the document, so pages need no code for it.
//
// Marks are data attributes, never classes: Preact rewrites `class` on
// re-render and would drop a class added here, hiding the card again.

const SELECTOR = ".dash > .card, .dash > .section-head, .reveal";
// Cards entering together follow one another; later ones just appear.
const STAGGER_STEPS = 6;
// Nothing may stay hidden because an observer never fired (old WebViews,
// printing, a throttled background tab).
const FAILSAFE_MS = 1600;

function show(el: Element, step = 0): void {
  if ((el as HTMLElement).dataset.in) return;
  if (step) (el as HTMLElement).dataset.rv = String(Math.min(step, STAGGER_STEPS));
  (el as HTMLElement).dataset.in = "1";
}

/** Starts the reveal motion once; does nothing where it would only get in the way. */
export function initMotion(): void {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (reduced?.matches) return;
  const root = document.documentElement;
  root.classList.add("motion");

  const io = new IntersectionObserver(
    (entries) => {
      let step = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        show(e.target, step++);
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.04 },
  );

  const seen = new WeakSet<Element>();
  const watch = (el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    io.observe(el);
    window.setTimeout(() => {
      // Only cards on screen are forced; the rest wait for their scroll.
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) show(el);
    }, FAILSAFE_MS);
  };
  const scan = (node: ParentNode) => node.querySelectorAll(SELECTOR).forEach(watch);

  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.matches(SELECTOR)) watch(n);
        scan(n);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan(document);

  // Turning reduced motion on while the app is open shows everything at once.
  reduced?.addEventListener?.("change", (e) => {
    if (e.matches) root.classList.remove("motion");
  });
  window.addEventListener("beforeprint", () => root.classList.remove("motion"));
}
