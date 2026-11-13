// The app's Caissa WASM build run as a Node child process for tests.
import { spawn } from "node:child_process";
import { join } from "node:path";

import type { UciTransport } from "../src/engine/uci";

// The build output is CommonJS (see engine/caissa/package.json), so run it from
// there rather than from public/ (an ESM scope).
export const ENGINE_JS = join(__dirname, "..", "engine", "caissa", "dist", "caissa.js");

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
