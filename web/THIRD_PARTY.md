# Third-party code in the web app

| Component | Use | License |
| --- | --- | --- |
| [Caissa](https://github.com/Witek902/Caissa) 2.0 (own single-threaded WASM build, see `engine/caissa`) | Engine, served from `public/caissa/` | MIT |
| Cburnett pieces (Colin M. L. Burnett, Wikimedia Commons) | Piece images in `public/pieces/`, unmodified | CC BY-SA 3.0 (also offered as GPLv2+; used under CC BY-SA) |
| [chess.js](https://github.com/jhlywa/chess.js) | Move generation, PGN/FEN | BSD-2-Clause |
| [Preact](https://preactjs.com) | UI | MIT |
| [supabase-js](https://github.com/supabase/supabase-js) (+ tslib 0BSD, phoenix, iceberg-js MIT) | Optional cloud sync | MIT |
| Workbox (through vite-plugin-pwa) | Service worker | MIT |
| Geist, Instrument Serif | Fonts in `public/fonts/` | SIL OFL 1.1 |
| [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) | Opening names | CC0 |
| Chess Analyzer Pro (imutkarsht) | Origin of this repository; accuracy and classification logic were ported from it | MIT |

## What this means

No GPL code is part of the web app any more, so it can be distributed without
publishing its source. Each component above only asks for its copyright and
licence notice to be kept; the licences page of the app (`#/rechtliches/lizenzen`)
lists them, and `caissa/LICENSE.txt` is served next to the engine.

- **Engine:** Stockfish (GPL-3.0) was replaced by Caissa (MIT) in November 2026.
  The engine build also contains parts of the Emscripten runtime, musl and LLVM's
  libc++ (MIT / Apache-2.0 with LLVM exception); their notices are in
  `engine/caissa/LICENSE.txt`. The Caissa-Nets repository (network file) has no
  licence file of its own; the author ships the network with the MIT engine.
- **Board:** chessground (GPL-3.0) was replaced by the app's own board
  (`src/ui/Board.tsx`, `src/ui/board/geometry.ts`) in November 2026. No
  chessground code was copied; the board was written from scratch.
- **Pieces:** CC BY-SA 3.0 needs attribution and applies its share-alike rule
  only to changed versions of the images. Keep the files unmodified (or replace
  them with an own set) and keep the attribution on the licences page.

Features inspired by the lichess analysis board (live engine lines with arrows,
threat mode, side lines in the move list) are this project's own code. No code
from lila (lichess' server and site, AGPL-3.0) is copied.

The Python desktop app in the repository root is separate and still uses
Stockfish and PyQt6 (both GPL); it is not part of the web app.
