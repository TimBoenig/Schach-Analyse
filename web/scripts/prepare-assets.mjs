// Generates static assets the PWA serves from public/:
//  - public/stockfish/: single-threaded Stockfish WASM build (no SharedArrayBuffer,
//    so it runs on iOS Safari without cross-origin isolation headers)
//  - public/openings/book.json: opening tree from the desktop app's Lichess ECO TSVs
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildBookData } from "./build-book.mjs";

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

function buildBook() {
  const out = buildBookData(join(root, "..", "assets", "openings"));
  const outDir = join(root, "public", "openings");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "book.json"), JSON.stringify(out));
  return Object.keys(out).length;
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
