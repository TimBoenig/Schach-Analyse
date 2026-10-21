// Stockfish WASM (lite, single-threaded) run as a Node child process for tests.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { UciTransport } from "../src/engine/uci";

// The npm package is CommonJS, so run its copy rather than public/ (an ESM scope).
const SF_DIR = join(__dirname, "..", "node_modules", "stockfish", "src");
export const ENGINE_JS = join(SF_DIR, readdirSync(SF_DIR).find((f) => /lite-single.*\.js$/.test(f)) ?? "missing.js");

export function nodeTransport(): UciTransport {
  const child = spawn(process.execPath, [ENGINE_JS], { stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  return {
    send: (cmd) => child.stdin.write(cmd + "\n"),
    onLine: (cb) =>
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          cb(buf.slice(0, i).trim());
          buf = buf.slice(i + 1);
        }
      }),
    terminate: () => child.kill(),
  };
}
