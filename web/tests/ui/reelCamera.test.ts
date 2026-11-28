// The planned reel camera (reelRig.ts): it never flies somewhere and straight back, glides without jumps (the cutting looks cut only
// at scene changes), and keeps every move in the picture in all five cuts. Plus the three newer cuts in the AI format.
import { beforeAll, describe, expect, it } from "vitest";

import { importAiScript, toAiScript } from "../../src/ui/studio/aiScript";
import { closeTemplate, FORMAT_SIZE, REEL_LOOKS, reelTemplate, type Format, type ReelLook, type StudioProject } from "../../src/ui/studio/model";
import { reelCamera } from "../../src/ui/studio/reel";
import { GRAMMAR, visibleHeight } from "../../src/ui/studio/reelRig";
import { compile, frameAt, squareXZ } from "../../src/ui/studio/timeline";
import { setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";

beforeAll(() => setLangNow("de", EN));

const as = (p: StudioProject, look: ReelLook, format: Format): StudioProject => ({ ...p, style: { ...p.style, view: "reel", reelLook: look }, video: { ...p.video, format } });

/** Turning points of one camera channel (moves smaller than `noise` ignored). */
function swings(values: number[], noise: number): { k: number; v: number }[] {
  const ext = [{ k: 0, v: values[0] }];
  let dir = 0;
  let last = 0;
  for (let k = 1; k < values.length; k++) {
    const d = values[k] - values[last];
    if ((dir >= 0 && d > 0) || (dir <= 0 && d < 0)) {
      dir = d > 0 ? 1 : -1;
      last = k;
    } else if (Math.abs(d) > noise) {
      ext.push({ k: last, v: values[last] });
      dir = -dir;
      last = k;
    }
  }
  ext.push({ k: last, v: values[last] });
  return ext;
}

describe("the planned reel camera", () => {
  const sets: [string, () => StudioProject][] = [
    ["close template", closeTemplate],
    ["reel template", reelTemplate],
  ];
  for (const look of REEL_LOOKS) {
    for (const [name, make] of sets) {
      it(`${look}: ${name} never goes there and back, glides, keeps the moves in the picture`, () => {
        for (const format of ["9:16", "16:9"] as Format[]) {
          const p = as(make(), look, format);
          const tl = compile(p);
          const [W, H] = FORMAT_SIZE[format];
          const Hv = visibleHeight(W, H, look);
          const dt = 1 / 30;
          const xs: number[] = [];
          const zs: number[] = [];
          const ls: number[] = [];
          const times: number[] = [];
          const out: string[] = [];
          const jumps: string[] = [];
          let prev = reelCamera(frameAt(tl, p, 0.01)!, W, H, look);
          for (let tk = 0.01 + dt; tk < tl.total - 0.05; tk += dt) {
            const f = frameAt(tl, p, tk)!;
            const cam = reelCamera(f, W, H, look);
            xs.push(cam.fx);
            zs.push(cam.fz);
            ls.push(Math.log(cam.S));
            times.push(tk);
            const c = Math.cos(cam.roll);
            const s = Math.sin(cam.roll);
            for (const mv of f.shot.moves) {
              if (f.local < mv.t0 || f.local > mv.t1) continue;
              for (const sq of mv.squares) {
                const [x, z] = squareXZ(sq);
                const dx = (x - cam.fx) * cam.S;
                const dz = (z - cam.fz) * cam.S;
                const px = W / 2 + dx * c - dz * s;
                const py = H / 2 + dx * s + dz * c;
                if (px < 0 || px > W || py < (H - Hv) / 2 || py > (H + Hv) / 2) out.push(`${tk.toFixed(2)} ${sq}`);
              }
            }
            const mate = f.scene.effects.includes("mate");
            const sceneStart = f.local < 0.05;
            const dS = Math.abs(Math.log(cam.S / prev.S));
            const dC = Math.hypot(cam.fx - prev.fx, cam.fz - prev.fz);
            // Only the cutting looks may jump, and only where a scene starts (or a zoom effect snaps in).
            const mayCut = GRAMMAR[look].cuts && (sceneStart || f.scene.effects.includes("zoom") || f.index === 0);
            if (!mate && !mayCut && (dS > 0.16 || dC > 0.75)) jumps.push(`${tk.toFixed(2)} dS=${dS.toFixed(2)} dC=${dC.toFixed(2)}`);
            prev = cam;
          }
          // There and back: a move of a square or more, then back at least half of it within 1.6 s. That was the jerky camera.
          const back: string[] = [];
          for (const [label, v, size] of [["x", xs, 1], ["z", zs, 1], ["zoom", ls, 0.25]] as const) {
            const e = swings(v, size * 0.3);
            for (let i = 2; i < e.length; i++) {
              const a = e[i - 1].v - e[i - 2].v;
              const b = e[i].v - e[i - 1].v;
              const quick = times[e[i].k] - times[e[i - 2].k] < 1.6;
              const inMate = frameAt(tl, p, times[e[i - 1].k])!.scene.effects.includes("mate");
              if (Math.abs(a) >= size && Math.abs(b) >= 0.5 * Math.abs(a) && quick && !inMate) back.push(`${format} ${label} @${times[e[i - 1].k].toFixed(2)} ${a.toFixed(2)}/${b.toFixed(2)}`);
            }
          }
          expect(back).toEqual([]);
          expect(jumps.slice(0, 3)).toEqual([]);
          expect(out.slice(0, 3)).toEqual([]);
        }
      });
    }
  }

  it("cuts hard in neon and comic, and glides everywhere else", () => {
    const count = (look: ReelLook) => {
      const p = as(closeTemplate(), look, "9:16");
      const tl = compile(p);
      let cuts = 0;
      let prev = reelCamera(frameAt(tl, p, 0.01)!, 1080, 1920, look);
      for (let tk = 0.05; tk < tl.total; tk += 1 / 30) {
        const cam = reelCamera(frameAt(tl, p, tk)!, 1080, 1920, look);
        if (Math.abs(Math.log(cam.S / prev.S)) > 0.2 || Math.hypot(cam.fx - prev.fx, cam.fz - prev.fz) > 1) cuts++;
        prev = cam;
      }
      return cuts;
    };
    expect(count("neon")).toBeGreaterThanOrEqual(3);
    expect(count("comic")).toBeGreaterThanOrEqual(3);
    for (const look of ["classic", "close", "cinema"] as ReelLook[]) expect(count(look)).toBe(0);
  });
});

describe("the newer cuts in the AI format", () => {
  it("reads kino, neon and comic (and their English words), writes them back, and keeps unknown words out", () => {
    const script = (extra: object) => JSON.stringify({ videoart: "edit", pgn: "1. e4 e5", szenen: [{ zugNr: "1-2" }], ...extra });
    const read = (extra: object) => importAiScript(script(extra)).project!.style.reelLook;
    expect([read({ schnittstil: "kino" }), read({ schnittstil: "neon" }), read({ schnittstil: "comic" }), read({ cutStyle: "cinema" })]).toEqual(["cinema", "neon", "comic", "cinema"]);
    for (const word of ["kino", "neon", "comic"]) {
      const p = importAiScript(script({ schnittstil: word })).project!;
      expect(importAiScript(toAiScript(p)).project!.style.reelLook).toBe(p.style.reelLook);
    }
  });
});
