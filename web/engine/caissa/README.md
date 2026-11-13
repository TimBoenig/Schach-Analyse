# Caissa for the browser

The web app analyses games with [Caissa](https://github.com/Witek902/Caissa)
by Michał Witanowski (MIT license). Upstream ships native programs only, so
this folder holds the app's own WebAssembly build of **Caissa 2.0**.

| File | What it is |
| --- | --- |
| `dist/caissa.js`, `dist/caissa.wasm` | The built engine (committed, so developing and deploying need no compiler) |
| `dist/caissa.pnn` | Caissa's neural network `eval-ml-8-152B-spsa` (76 MB, unchanged from upstream) |
| `build.sh` | Rebuilds `dist/` from the pinned upstream commit |
| `caissa-wasm.patch` | The changes to the upstream sources (about 50 lines) |
| `wasm_main.cpp` | Entry points of the browser build |
| `glue.js` | Host side: Web Worker / Node wrapper around the module |
| `LICENSE.txt` | License notices, served with the engine |
| `package.json` | Marks this folder as CommonJS, so Node can run `dist/caissa.js` in tests |

`scripts/prepare-assets.mjs` copies `dist/` and `LICENSE.txt` to
`public/caissa/` before `npm run dev` and `npm run build`.

## How it differs from the native engine

- **One thread, no SharedArrayBuffer.** The page needs no cross-origin
  isolation headers, which keeps it working on iOS Safari. More CPU is used by
  running several engine workers side by side (`src/engine/pool.ts`).
- **`stop` works during a search.** With a single thread the search itself has
  to let the event loop run: every 25 ms it suspends (Emscripten Asyncify) and
  the worker reads its messages. That costs about 4 % speed.
- **`go ... movetime N` is a plain deadline.** The search runs until the
  requested depth is reached or N milliseconds are over and always reports its
  lines. Caissa's own time manager is made for playing games: it may answer
  earlier, and with a single legal move it answers without any evaluation,
  which a game analysis cannot use.
- **The network is not embedded.** The page downloads `caissa.pnn` once and
  hands it to every worker as a Blob; the worker copies it into engine memory.
- No tablebases (there is no file system to probe).

Everything else, search and evaluation included, is upstream code.

## Protocol

Web Worker: post `{ net: Blob | ArrayBuffer }` once, then UCI lines as
strings; engine output arrives as strings (one line per message). Commands
sent before the network arrived are queued.

Node (`node dist/caissa.js`): UCI on stdin/stdout, the network is read from
`dist/caissa.pnn`.

## Rebuilding

```bash
sudo apt install emscripten   # 3.1.6 on Ubuntu 24.04 was used for dist/
./build.sh
npm test                      # in web/: tests/engine/caissa.test.ts runs the build
```

To move to a newer Caissa: change tag, commit, network name and checksum in
`build.sh`, the network name in `src/engine/info.ts` (it is part of the
download address, so browsers fetch the new file), refresh the patch if it
no longer applies, and re-measure the depth presets in
`src/domain/analysisDepth.ts` (a depth number means something different for
every engine version).
