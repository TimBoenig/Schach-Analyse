# Third-party code in the web app

| Component | Use | License |
| --- | --- | --- |
| [chessground](https://github.com/lichess-org/chessground) (`@lichess-org/chessground`) | Chessboard (dragging, animation, arrows, coordinates) | GPL-3.0-or-later |
| [Caissa](https://github.com/Witek902/Caissa) 2.0 (own single-threaded WASM build, see `engine/caissa`) | Engine, served from `public/caissa/` | MIT |
| Cburnett pieces | Piece images | GPLv2+ / CC BY-SA 3.0 |

## What this means

chessground is bundled into the web app's JavaScript, so the built web app is
a combined work that must be distributed under the **GPL-3.0** (the MIT-licensed
code of this repository is compatible with that). In practice:

- Anyone who gets the web app (including visitors of the deployed site) must be
  able to get its complete source code under the GPL-3.0, for example via a
  link to this public repository.
- The rest of the repository may stay MIT; the GPL applies to the web app
  build as a whole.

The engine is no longer a GPL component: Stockfish (GPL-3.0) was replaced by
Caissa (MIT) in November 2026. The engine build also contains parts of the
Emscripten runtime, musl and LLVM's libc++ (MIT / Apache-2.0 with LLVM
exception); their notices are in `engine/caissa/LICENSE.txt`, which is served
next to the engine. What still makes the web app a GPL work is chessground.

The analysis features inspired by the lichess analysis board (live engine lines
with arrows, threat mode, side lines in the move list) are this project's own
code. No code from lila (lichess' server and site, AGPL-3.0) is copied.
