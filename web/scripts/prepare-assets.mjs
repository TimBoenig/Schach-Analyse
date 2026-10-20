// Generates static assets the PWA serves from public/:
//  - public/stockfish/: single-threaded Stockfish WASM build (no SharedArrayBuffer,
//    so it runs on iOS Safari without cross-origin isolation headers)
//  - public/openings/book.json: opening tree from the desktop app's Lichess ECO TSVs
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Chess } from "chess.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function copyStockfish() {
  const pkgDir = dirname(require.resolve("stockfish/package.json"));
  const srcDir = join(pkgDir, "src");
  const outDir = join(root, "public", "stockfish");
  mkdirSync(outDir, { recursive: true });
  const base = readdirSync(srcDir).find((f) => /^stockfish-.*-lite-single-.*\.js$/.test(f));
  if (!base) throw new Error("lite-single Stockfish build not found in " + srcDir);
  const stem = base.slice(0, -3);
  copyFileSync(join(srcDir, base), join(outDir, "stockfish.js"));
  copyFileSync(join(srcDir, stem + ".wasm"), join(outDir, "stockfish.wasm"));
  copyFileSync(join(pkgDir, "Copying.txt"), join(outDir, "COPYING.txt"));
}

// Position key without move counters and en-passant field; must match
// bookKey() in src/domain/book.ts.
export function bookKey(fen) {
  return fen.split(" ").slice(0, 3).join(" ");
}

function buildBook() {
  const tsvDir = join(root, "..", "assets", "openings");
  const nodes = new Map(); // key -> { openings: Map<eco|name>, children: Set<san> }
  const node = (key) => {
    let n = nodes.get(key);
    if (!n) nodes.set(key, (n = { openings: [], children: new Set() }));
    return n;
  };
  for (const file of readdirSync(tsvDir).filter((f) => f.endsWith(".tsv")).sort()) {
    for (const line of readFileSync(join(tsvDir, file), "utf8").split("\n")) {
      const [eco, name, pgn] = line.split("\t");
      if (!pgn || eco === "eco") continue;
      const board = new Chess();
      let prev = node(bookKey(board.fen()));
      prev.openings.push([eco, name]);
      for (const san of pgn.trim().split(/\s+/).filter((t) => !t.endsWith("."))) {
        try {
          board.move(san);
        } catch {
          break;
        }
        prev.children.add(san);
        const cur = node(bookKey(board.fen()));
        cur.openings.push([eco, name]);
        prev = cur;
      }
    }
  }
  const out = {};
  for (const [key, n] of nodes) {
    // Most specific (longest) name wins, like LocalBookManager.process_move.
    const best = n.openings.reduce((a, b) => (b[1].length > a[1].length ? b : a), n.openings[0]);
    out[key] = [best[0], best[1], [...n.children].sort()];
  }
  const outDir = join(root, "public", "openings");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "book.json"), JSON.stringify(out));
  return nodes.size;
}

// Cburnett pieces (GPLv2+/CC BY-SA 3.0) and classification badges stay in
// their own folders next to their notices, as in the desktop app.
function copyImages() {
  const pieceSrc = join(root, "..", "assets", "pieces");
  const pieceOut = join(root, "public", "pieces");
  mkdirSync(pieceOut, { recursive: true });
  for (const f of readdirSync(pieceSrc)) copyFileSync(join(pieceSrc, f), join(pieceOut, f));
  const imgSrc = join(root, "..", "assets", "images");
  const imgOut = join(root, "public", "badges");
  mkdirSync(imgOut, { recursive: true });
  for (const f of readdirSync(imgSrc).filter((f) => f.endsWith(".svg"))) copyFileSync(join(imgSrc, f), join(imgOut, f));
}

copyStockfish();
copyImages();
console.log(`opening book: ${buildBook()} positions`);
