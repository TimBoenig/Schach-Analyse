// Generates static assets the PWA serves from public/:
//  - public/caissa/: single-threaded Caissa WASM build and its neural network
//    from engine/caissa/dist (no SharedArrayBuffer, so it runs on iOS Safari
//    without cross-origin isolation headers)
//  - public/openings/book.json: opening tree from the desktop app's Lichess ECO TSVs
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBookData } from "./build-book.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function copyEngine() {
  const srcDir = join(root, "engine", "caissa");
  const outDir = join(root, "public", "caissa");
  mkdirSync(outDir, { recursive: true });
  for (const f of ["caissa.js", "caissa.wasm"]) copyFileSync(join(srcDir, "dist", f), join(outDir, f));
  copyFileSync(join(srcDir, "LICENSE.txt"), join(outDir, "LICENSE.txt"));
  // The network is 76 MB: copy it only when it is missing or differs.
  const net = join(srcDir, "dist", "caissa.pnn");
  const netOut = join(outDir, "caissa.pnn");
  if (!existsSync(netOut) || statSync(netOut).size !== statSync(net).size || statSync(netOut).mtimeMs < statSync(net).mtimeMs) {
    copyFileSync(net, netOut);
  }
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

copyEngine();
copyImages();
console.log(`opening book: ${buildBook()} positions`);
