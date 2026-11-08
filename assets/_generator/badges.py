"""Generate the move classification badges in assets/images/.

Round, coloured badges with a white glyph, in the familiar look of the big chess
sites (!!, !, star, thumbs up, check, book, ?!, ?, cross, ??). Every shape is
drawn here from scratch as plain paths, so the files carry no third-party art
and no font dependency (they also render in Qt's SVG Tiny renderer, which is why
there are no filters: the drop shadows are offset copies).

Run: python assets/_generator/badges.py
"""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "images"


# Exclamation mark: tapered bar plus dot, centred on x.
def bang(x: float, s: float = 1.0) -> str:
    w, b = 5.2 * s, 3.4 * s
    top, bottom, dot_y, r = 40 - 22 * s, 40 + 8 * s, 40 + 17 * s, 4.9 * s
    return (
        f'<path d="M{x - w:.1f} {top + w:.1f} a{w:.1f} {w:.1f} 0 0 1 {2 * w:.1f} 0 '
        f'L{x + b:.1f} {bottom:.1f} a{b:.1f} {b:.1f} 0 0 1 {-2 * b:.1f} 0 Z"/>'
        f'<circle cx="{x:.1f}" cy="{dot_y:.1f}" r="{r:.1f}"/>'
    )


# Question mark: a stroked hook plus dot, centred on x.
def quest(x: float, s: float = 1.0) -> str:
    r = 10 * s
    top = 40 - 21 * s
    sw = 8.6 * s
    stem_y = 40 + 7 * s
    return (
        f'<path fill="none" stroke-width="{sw:.1f}" stroke-linecap="round" stroke-linejoin="round" '
        f'd="M{x - r:.1f} {top + r:.1f} a{r:.1f} {r:.1f} 0 1 1 {r * 1.25:.1f} {r * 0.97:.1f} '
        f"C{x + 0.2 * r:.1f} {top + 2.25 * r:.1f} {x:.1f} {top + 2.5 * r:.1f} {x:.1f} {stem_y - 1:.1f} "
        f'L{x:.1f} {stem_y:.1f}"/>'
        f'<circle cx="{x:.1f}" cy="{40 + 17 * s:.1f}" r="{4.9 * s:.1f}"/>'
    )


STAR = (
    '<path stroke-width="3" stroke-linejoin="round" d="M40 15.5 L47.3 30.4 L63.7 32.6 L51.8 44.1 '
    'L54.7 60.4 L40 52.6 L25.3 60.4 L28.2 44.1 L16.3 32.6 L32.7 30.4 Z"/>'
)
CHECK = (
    '<path fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" '
    'd="M22 41 L34.5 53.5 L58.5 28"/>'
)
CROSS = (
    '<path fill="none" stroke-width="9" stroke-linecap="round" d="M27 27 L53 53 M53 27 L27 53"/>'
)
THUMB = (
    '<path stroke-width="2.5" stroke-linejoin="round" d="M19 37 h8 v22 h-8 Z '
    "M31 37.5 L39.5 21.5 c1.5 -3 6.5 -2.5 6.5 2 v9.5 h11.5 c3.5 0 5.8 3.2 5 6.4 "
    'l-3.8 15.2 c-0.7 2.6 -2.8 4.4 -5.5 4.4 H31 Z"/>'
)
BOOK = (
    '<path d="M38 24.5 C31 20.5 23 20 16 22 v33 c7 -2 15 -1.5 22 2.5 Z '
    'M42 24.5 C49 20.5 57 20 64 22 v33 c-7 -2 -15 -1.5 -22 2.5 Z"/>'
)

# name -> (fill colour, darker rim colour, glyph). Colours match the CSS
# variables in web/src/ui/styles.css.
BADGES = {
    "brilliant.svg": ("#1baca6", "#14837f", bang(31) + bang(49)),
    "great_find.svg": ("#5c8bb0", "#466c8a", bang(40)),
    "best_v2.svg": ("#81b64c", "#618c37", STAR),
    "excellent.svg": ("#81b64c", "#618c37", THUMB),
    "good.svg": ("#95b776", "#728f58", CHECK),
    "book.svg": ("#a88865", "#82684b", BOOK),
    "inaccuracy.svg": ("#f7c045", "#c9962a", quest(31, 0.85) + bang(52.5, 0.85)),
    "mistake.svg": ("#ffa459", "#d27b37", quest(40)),
    "missed_win.svg": ("#ff7769", "#d2564a", CROSS),
    "blunder.svg": ("#fa412d", "#c32b1b", quest(28.5, 0.82) + quest(52, 0.82)),
}


def badge(fill: str, rim: str, glyph: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">\n'
        f'  <circle cx="40" cy="40" r="37" fill="{rim}"/>\n'
        f'  <circle cx="40" cy="37.5" r="34.5" fill="{fill}"/>\n'
        f'  <g fill="#000000" stroke="#000000" opacity="0.22" transform="translate(0 2.2)">{glyph}</g>\n'
        f'  <g fill="#ffffff" stroke="#ffffff">{glyph}</g>\n'
        "</svg>\n"
    )


def main() -> None:
    for name, (fill, rim, glyph) in BADGES.items():
        (OUT / name).write_text(badge(fill, rim, glyph), encoding="utf-8")


if __name__ == "__main__":
    main()
