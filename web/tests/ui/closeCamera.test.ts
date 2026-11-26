// The "Nah dran" camera: every move being played must be completely in the picture, whatever the zoom effects do.
import { describe, expect, it } from "vitest";

import { closeTemplate, DEFAULT_VIDEO, FORMAT_SIZE, scene, START_FEN, styleFromTheme, type Format, type StudioProject } from "../../src/ui/studio/model";
import { reelCamera } from "../../src/ui/studio/reel";
import { compile, frameAt, squareXZ } from "../../src/ui/studio/timeline";

const project = (scenes: StudioProject["scenes"], format: Format): StudioProject => ({
  id: "p",
  name: "t",
  startFen: START_FEN,
  scenes,
  style: styleFromTheme("mono", { view: "reel", reelLook: "close", environment: "void", coords: false }),
  video: { ...DEFAULT_VIDEO, format, introFly: false, lucena: false, movePill: false },
  updatedAt: 0,
});

// Fried Liver (knight jumps, a capture across the board, castling) and then rooks, a queen and a bishop crossing the whole board.
const longGame: StudioProject["scenes"] = [
  scene({ title: "Fried Liver", duration: 2 }),
  scene({ moves: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6", duration: 2.6 }),
  scene({ moves: "4. Ng5", duration: 1.3, effects: ["zoom", "punch"] }),
  scene({ moves: "4... d5", duration: 1.3 }),
  scene({ moves: "5. exd5 Nxd5", duration: 2.6 }),
  scene({ moves: "6. Nxf7", duration: 2.6, badge: "brilliant", effects: ["slowmo", "zoom"] }),
  scene({ moves: "6... Kxf7 7. Qf3+ Ke6", duration: 2.6, effects: ["shake"] }),
  scene({ moves: "8. Nc3 Nb4 9. O-O c6", duration: 2.6, badge: "great" }),
  scene({ moves: "10. d3 Qd7 11. Bg5 Bh6 12. Bxh6 Rxh6", duration: 4 }),
];
const sweep: StudioProject["scenes"] = [
  scene({ moves: "1. h4 a5 2. Rh3 Ra6 3. Rf3 Rh6", duration: 4, effects: ["zoom"] }),
  scene({ moves: "4. Rf6", duration: 1.3 }),
  scene({ moves: "4... gxf6 5. a3 Rxh4", duration: 2.6, badge: "great", effects: ["slowmo"] }),
];

const JUMP_S = 0.2;
const JUMP_C = 1.3;

describe("close camera keeps every move in the picture", () => {
  const formats: Format[] = ["9:16", "1:1", "16:9"];
  const sets: [string, StudioProject["scenes"]][] = [
    ["Fried Liver", longGame],
    ["board crossing", sweep],
    ["template", closeTemplate().scenes],
  ];
  for (const [name, scenes] of sets) {
    for (const format of formats) {
      it(`${name} in ${format}`, () => {
        const p = project(scenes, format);
        const tl = compile(p);
        const [W, H] = FORMAT_SIZE[format];
        let moves = 0;
        const bad: string[] = [];
        const jumps: string[] = [];
        let prev = reelCamera(frameAt(tl, p, 0.01)!, W, H, "close");
        for (let tk = 0.02; tk < tl.total - 0.05; tk += 1 / 30) {
          const frame = frameAt(tl, p, tk)!;
          const cam = reelCamera(frame, W, H, "close");
          const c = Math.cos(cam.roll);
          const s = Math.sin(cam.roll);
          for (const mv of frame.shot.moves) {
            if (frame.local < mv.t0 || frame.local > mv.t1) continue;
            moves++;
            for (const sq of mv.squares) {
              const [x, z] = squareXZ(sq);
              for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
                const dx = (x + ox - cam.fx) * cam.S;
                const dz = (z + oz - cam.fz) * cam.S;
                const px = W / 2 + cam.shakeX + dx * c - dz * s;
                const py = H / 2 + cam.shakeY + dx * s + dz * c;
                if (px < 0 || px > W || py < 0 || py > H) bad.push(`${tk.toFixed(2)}s ${sq}`);
              }
            }
          }
          const mate = frame.scene.effects.includes("mate");
          if (!mate && tk > 1) {
            // Soft motion: no jump in zoom or centre from one frame to the next (the hero's close-up included).
            const dS = Math.abs(Math.log(cam.S / prev.S));
            const dC = Math.hypot(cam.fx - prev.fx, cam.fz - prev.fz);
            // A scene's first frame may jump in zoom (punch-in and zoom effects are meant to); inside a scene the picture only glides.
            if (frame.local > 0.05 && (dS > JUMP_S || dC > JUMP_C)) jumps.push(`${tk.toFixed(2)}s scene ${frame.index} dS=${dS.toFixed(2)} dC=${dC.toFixed(2)}`);
          }
          prev = cam;
        }
        expect(moves).toBeGreaterThan(20);
        expect(bad.slice(0, 5)).toEqual([]);
        expect(jumps.slice(0, 5)).toEqual([]);
      });
    }
  }
});
