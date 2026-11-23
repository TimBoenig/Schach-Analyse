// On a phone the grey explanation under a card title is hidden; the title shows
// an info mark and a tap on it unfolds the text. One listener serves every
// card: it flips `data-open` on the description next to the tapped title.
// (An attribute, not a class: Preact rewrites class names on re-render.)
export function initInfoTips(): void {
  document.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    const h = t?.closest(".card-head h3");
    if (!h || !window.matchMedia?.("(max-width: 640px)").matches) return;
    const sub = h.nextElementSibling;
    if (!sub?.classList.contains("card-sub")) return;
    if (sub.hasAttribute("data-open")) sub.removeAttribute("data-open");
    else sub.setAttribute("data-open", "");
  });
}
