// WebGL renderer of the studio's 3D board: lit pieces with a mirror image in
// a glossy board, soft contact shadows, glowing arrows and square marks.
// Written for this app (no 3D library) and shares the studio lighting idea of
// ui/three/renderer.ts, but in world space so the light stays put while the
// camera flies around the board.
import type { PieceSymbol } from "chess.js";

import { box, merge, STRIDE, type Material, type Mesh } from "../three/mesh";
import { lookAt, multiply, perspective, placement, screenToBoard, tiltedPlacement, type Mat4, type V3 } from "./math3d";
import { toneColor, type StudioStyle } from "./model";
import { environment, type EnvLine } from "./environments";
import { pieceMesh } from "./pieces";
import { squareXZ, xzSquare, type CameraState, type Frame } from "./timeline";
import { t } from "../../i18n";

const LIT_VERT = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor;
uniform mat4 uModel, uViewProj;
varying vec3 vN, vW, vP; varying vec4 vColor;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vP = aPos;
  vW = w.xyz;
  vN = (uModel * vec4(aNormal, 0.0)).xyz;
  vColor = aColor;
  gl_Position = uViewProj * w;
}`;

const LIT_FRAG = `
precision highp float;
varying vec3 vN, vW, vP; varying vec4 vColor;
uniform vec3 uEye, uTint, uGlow, uFogColor, uRim;
uniform vec2 uFog;
uniform float uUseTint, uMetal, uGloss, uAlpha, uDim, uWood, uSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
// Turned-wood grain: growth rings around a slightly tilted axis, wobbled by noise, plus fine pores.
vec3 woodGrain(vec3 base, vec3 p) {
  vec3 q = p + vec3(uSeed * 3.1, uSeed * 1.7, uSeed * 2.3);
  float wob = noise(q.xy * 3.0 + q.zz * 2.0) * 0.6 + noise(q.yz * 9.0) * 0.15;
  float rings = fract((length(q.xz + vec2(0.35, 0.2)) + q.y * 0.08) * 9.0 + wob);
  float band = smoothstep(0.0, 0.18, rings) * (1.0 - smoothstep(0.55, 1.0, rings));
  float pores = noise(vec2(q.y * 90.0, (q.x + q.z) * 6.0));
  float k = 0.78 + 0.22 * band - 0.06 * smoothstep(0.65, 1.0, pores);
  return base * k;
}
const vec3 KEY = vec3(-0.42, 0.78, 0.46);
const vec3 FILL = vec3(0.86, 0.32, 0.4);
const vec3 RIM = vec3(0.1, 0.42, -0.9);
vec3 room(vec3 d) {
  vec3 c = mix(vec3(0.08, 0.08, 0.1), vec3(0.4, 0.42, 0.48), smoothstep(-0.6, 0.15, d.y));
  c = mix(c, vec3(0.95, 0.96, 1.0), smoothstep(0.15, 1.0, d.y));
  float strips = smoothstep(0.6, 0.95, sin(atan(d.x, d.z) * 3.0 + 0.6));
  c += vec3(1.0, 0.98, 0.95) * 1.2 * strips * smoothstep(-0.2, 0.35, d.y);
  c += vec3(1.0, 0.97, 0.9) * 2.6 * smoothstep(0.8, 0.97, dot(d, normalize(KEY)));
  c += vec3(0.6, 0.72, 1.0) * 0.9 * smoothstep(0.75, 0.96, dot(d, normalize(FILL)));
  c += vec3(1.0) * 1.2 * smoothstep(0.6, 0.95, dot(d, normalize(RIM)));
  return c;
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 albedo = mix(vColor.rgb, uTint, uUseTint);
  // Details marked in the mesh (bishop slit, eyes) use a contrasting shade of the piece's own colour.
  if (uUseTint > 0.5 && vColor.a > 0.25) {
    float lum = dot(uTint, vec3(0.3, 0.59, 0.11));
    albedo = mix(uTint, lum > 0.3 ? uTint * 0.18 : vec3(0.72, 0.7, 0.66), 0.85);
  }
  // Pieces are turned, so rings run round them; board squares are cut planks, so the grain runs nearly straight.
  if (uWood > 0.5) albedo = woodGrain(albedo, uUseTint > 0.5 ? vP : vec3(vW.x * 0.12 + 25.0 + floor(vW.z + 4.0) * 1.7, vW.y, vW.z * 0.9));
  float metal = uMetal;
  float facing = max(dot(n, v), 0.0);
  vec3 f0 = mix(vec3(0.045), albedo, metal);
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - facing, 5.0);
  vec3 key = normalize(KEY);
  vec3 h = normalize(key + v);
  float spec = pow(max(dot(n, h), 0.0), mix(18.0, 90.0, uGloss)) * uGloss;
  vec3 light = vec3(0.24) + vec3(1.0, 0.97, 0.92) * 0.82 * max(dot(n, key), 0.0)
    + vec3(0.6, 0.7, 1.0) * 0.22 * max(dot(n, normalize(FILL)), 0.0) + vec3(0.14) * (n.y * 0.5 + 0.5);
  vec3 color = albedo * light * (1.0 - metal)
    + room(reflect(-v, n)) * fresnel * mix(0.25, 1.0, uGloss) * mix(0.75, 1.0, metal)
    + vec3(1.0, 0.98, 0.95) * spec * 0.6 + uGlow
    // Rim light: a thin bright edge so dark pieces stand out from dark squares and backgrounds.
    + uRim * pow(1.0 - facing, 3.0);
  color = color / (1.0 + color * 0.32);
  vec3 outc = pow(color, vec3(1.0 / 2.2)) * uDim;
  // Distance haze, measured from the board's centre so the board itself stays crisp.
  outc = mix(outc, uFogColor, smoothstep(uFog.x, uFog.y, length(vW.xz)));
  gl_FragColor = vec4(outc * uAlpha, uAlpha);
}`;

const FLAT_VERT = `
attribute vec3 aPos; attribute vec2 aUV;
uniform mat4 uViewProj;
varying vec2 vUV;
void main() { vUV = aUV; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

// Modes: 0 solid, 1 soft round blob (shadows, stage light), 2 square glow, 3 ring, 4 line fading to its ends.
const FLAT_FRAG = `
precision mediump float;
varying vec2 vUV;
uniform vec4 uColor; uniform float uMode, uParam;
void main() {
  float a = 1.0;
  if (uMode > 0.5 && uMode < 1.5) {
    float r = length(vUV * 2.0 - 1.0);
    a = pow(max(0.0, 1.0 - r), 1.6);
  } else if (uMode > 1.5 && uMode < 2.5) {
    vec2 d = abs(vUV - 0.5) * 2.0;
    float m = max(d.x, d.y);
    a = 0.32 + 0.68 * smoothstep(0.62, 0.98, m);
    a *= 1.0 - smoothstep(0.985, 1.0, m);
  } else if (uMode > 3.5) {
    float e = 1.0 - abs(vUV.x * 2.0 - 1.0);
    a = e * e * (1.0 - smoothstep(0.0, 1.0, abs(vUV.y * 2.0 - 1.0)) * 0.5);
  } else if (uMode > 2.5) {
    float r = length(vUV * 2.0 - 1.0);
    a = smoothstep(0.12, 0.0, abs(r - uParam)) * (1.0 - uParam * 0.6);
  }
  gl_FragColor = vec4(uColor.rgb * uColor.a * a, uColor.a * a);
}`;

export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => Math.pow(c, 2.2)) as [number, number, number];
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface GpuMesh {
  buffer: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
}

export const FOV_Y = (44 * Math.PI) / 180;

/** Camera distance at zoom 1, so the whole board fits even in a tall, narrow video. */
export function fitDistance(aspect: number, yaw = 0): number {
  const fovX = 2 * Math.atan(Math.tan(FOV_Y / 2) * aspect);
  // A board turned towards its corner is wider on screen (half the side times |cos|+|sin|), so back off with the turn.
  const a = (((yaw % 90) + 90) % 90) * (Math.PI / 180);
  const radius = 4.1 * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))) + 0.9;
  return radius / Math.tan(Math.min(fovX, FOV_Y) / 2);
}

/** `lesson`: the board sits in the left part of a wide video, the right part holds the explanation. */
export function cameraMatrix(cam: CameraState, aspect: number, lesson = false): { viewProj: Mat4; eye: V3 } {
  const pitch = (Math.min(89, Math.max(5, cam.pitch)) * Math.PI) / 180;
  const yaw = (cam.yaw * Math.PI) / 180;
  const dist = fitDistance(aspect, cam.yaw) * cam.zoom * (lesson ? 1.06 : 1);
  const target: V3 = [cam.tx, 0, cam.tz];
  const eye: V3 = [target[0] + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, target[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
  // In a tall video the board sits in the middle band, between the headline and the subtitles, so neither covers a piece.
  const shift = aspect < 0.8 ? 0.0 : 0;
  const proj = perspective(FOV_Y, aspect, 0.5, 120, shift, lesson ? 0.46 : 0);
  const viewProj = multiply(proj, lookAt(eye, target));
  // Dutch angle: the finished picture is turned about its middle (rotated in pixels, not in the stretched clip space).
  const roll = ((cam.roll ?? 0) * Math.PI) / 180;
  if (!roll) return { viewProj, eye };
  const c = Math.cos(roll);
  const sn = Math.sin(roll);
  const turn = new Float32Array(16);
  turn[0] = c;
  turn[1] = sn * aspect;
  turn[4] = (-sn) / aspect;
  turn[5] = c;
  turn[10] = 1;
  turn[15] = 1;
  return { viewProj: multiply(turn, viewProj), eye };
}

export class StudioRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private lit: WebGLProgram;
  private flat: WebGLProgram;
  private litU: Record<string, WebGLUniformLocation | null> = {};
  private flatU: Record<string, WebGLUniformLocation | null> = {};
  private pieces = new Map<PieceSymbol, GpuMesh>();
  private board: GpuMesh | null = null;
  private frame: GpuMesh | null = null;
  private boardKey = "";
  private envKey = "";
  private env: { parts: { mesh: GpuMesh; glow?: [number, number, number]; gloss: number }[]; lines: EnvLine[]; fog: [number, number]; fogColor?: string } | null = null;
  private dyn: WebGLBuffer;
  viewProj: Mat4 = new Float32Array(16);

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, stencil: true });
    if (!gl) throw new Error(t("WebGL ist auf diesem Gerät nicht verfügbar."));
    this.gl = gl;
    this.lit = this.program(LIT_VERT, LIT_FRAG, ["aPos", "aNormal", "aColor"]);
    this.flat = this.program(FLAT_VERT, FLAT_FRAG, ["aPos", "aUV"]);
    for (const n of ["uModel", "uViewProj", "uEye", "uTint", "uGlow", "uUseTint", "uMetal", "uGloss", "uAlpha", "uDim", "uFogColor", "uFog", "uRim", "uWood", "uSeed"]) this.litU[n] = gl.getUniformLocation(this.lit, n);
    for (const n of ["uViewProj", "uColor", "uMode", "uParam"]) this.flatU[n] = gl.getUniformLocation(this.flat, n);
    this.dyn = gl.createBuffer()!;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
  }

  private program(vs: string, fs: string, attribs: string[]): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
    return p;
  }

  private upload(mesh: Mesh): GpuMesh {
    const gl = this.gl;
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW);
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
    return { buffer, index, count: mesh.indices.length };
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private ensureBoard(style: StudioStyle): void {
    const key = `${style.light}${style.dark}${style.frame}`;
    if (key === this.boardKey && this.board) return;
    this.boardKey = key;
    const light: Material = { color: hexToLinear(style.light), metal: 0 };
    const dark: Material = { color: hexToLinear(style.dark), metal: 0 };
    const squares: Mesh[] = [];
    for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) squares.push(box([f - 3.5, -0.04, 3.5 - r], [1, 0.08, 1], (f + r) % 2 === 0 ? dark : light));
    const frameMat: Material = { color: hexToLinear(style.frame), metal: 0 };
    const deep = hexToLinear(style.frame).map((c) => c * 0.55) as [number, number, number];
    // Frame and plinth are rings: nothing may sit under the squares, or it would hide the mirror image.
    const ring = (outer: number, y: number, height: number, m: Material) => {
      const wd = (outer - 8) / 2;
      const c = 4 + wd / 2;
      return merge(
        box([0, y, c], [outer, height, wd], m),
        box([0, y, -c], [outer, height, wd], m),
        box([c, y, 0], [wd, height, 8], m),
        box([-c, y, 0], [wd, height, 8], m),
      );
    };
    const frame = merge(ring(8.9, -0.17, 0.32, frameMat), ring(9.15, -0.38, 0.12, { color: deep, metal: 0 }));
    this.board = this.upload(merge(...squares));
    this.frame = this.upload(frame);
  }

  private ensureEnv(style: StudioStyle): void {
    const key = `${style.environment}${style.accent}`;
    if (key === this.envKey) return;
    this.envKey = key;
    const scene = environment(style.environment, style.accent);
    this.env = scene
      ? { parts: scene.parts.map((p) => ({ mesh: this.upload(p.mesh), glow: p.glow, gloss: p.gloss ?? 0.5 })), lines: scene.lines, fog: scene.fog, fogColor: scene.fogColor }
      : null;
  }

  private piece(type: PieceSymbol): GpuMesh {
    let m = this.pieces.get(type);
    if (!m) {
      m = this.upload(pieceMesh(type));
      this.pieces.set(type, m);
    }
    return m;
  }

  private bindLit(m: GpuMesh): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.index);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 24);
  }

  private drawLit(m: GpuMesh, model: Mat4, o: { tint?: [number, number, number]; metal: number; gloss: number; alpha?: number; dim?: number; glow?: [number, number, number]; wood?: boolean; rim?: [number, number, number]; seed?: number }): void {
    const gl = this.gl;
    const u = this.litU;
    this.bindLit(m);
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniform3fv(u.uTint, o.tint ?? [1, 1, 1]);
    gl.uniform1f(u.uUseTint, o.tint ? 1 : 0);
    gl.uniform1f(u.uMetal, o.metal);
    gl.uniform1f(u.uGloss, o.gloss);
    gl.uniform1f(u.uAlpha, o.alpha ?? 1);
    gl.uniform1f(u.uDim, o.dim ?? 1);
    gl.uniform3fv(u.uGlow, o.glow ?? [0, 0, 0]);
    gl.uniform3fv(u.uRim, o.rim ?? [0, 0, 0]);
    gl.uniform1f(u.uWood, o.wood ? 1 : 0);
    gl.uniform1f(u.uSeed, o.seed ?? 0);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
  }

  private drawFlat(data: number[], color: [number, number, number], alpha: number, mode: number, param = 0): void {
    if (!data.length || alpha <= 0.002) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
    gl.disableVertexAttribArray(2);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.uniform4f(this.flatU.uColor, color[0], color[1], color[2], alpha);
    gl.uniform1f(this.flatU.uMode, mode);
    gl.uniform1f(this.flatU.uParam, param);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 5);
  }

  render(frame: Frame, style: StudioStyle): void {
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.ensureBoard(style);
    this.ensureEnv(style);
    const { viewProj, eye } = cameraMatrix(frame.camera, w / h, frame.lesson);
    this.viewProj = viewProj;
    const accent = hexToRgb(style.accent);
    const mat = style.material;
    const metal = mat === "chrome" ? 0.92 : 0;
    const gloss = mat === "matte" ? 0.3 : mat === "wood" ? 0.55 : 1;
    const wood = mat === "wood";
    const rimOf = (c: "w" | "b"): [number, number, number] => (!style.pieceRim ? [0, 0, 0] : c === "b" ? [0.32, 0.34, 0.4] : [0.1, 0.1, 0.1]);
    const tintW = hexToLinear(style.whitePiece);
    const tintB = hexToLinear(style.blackPiece);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Stage light: a soft pool of the accent colour under the board.
    gl.useProgram(this.flat);
    gl.uniformMatrix4fv(this.flatU.uViewProj, false, viewProj);
    gl.depthMask(false);
    if (!this.env) this.drawFlat(quad(0, 0, 22, -0.45), accent, 0.2, 1);
    gl.depthMask(true);

    gl.useProgram(this.lit);
    gl.uniformMatrix4fv(this.litU.uViewProj, false, viewProj);
    gl.uniform3fv(this.litU.uEye, eye);
    const fogHex = this.env?.fogColor ?? mixHex(style.bgTop, style.bgBottom, 0.6);
    gl.uniform3fv(this.litU.uFogColor, hexToRgb(fogHex));
    gl.uniform2fv(this.litU.uFog, this.env ? this.env.fog : [1e4, 2e4]);
    const pieceOpts = (p: Frame["pieces"][number]) => ({ tint: p.color === "w" ? tintW : tintB, metal, gloss, alpha: p.alpha, wood, rim: rimOf(p.color), seed: (p.x * 7.3 + p.z * 3.1) % 5 });
    const yawOf = (p: Frame["pieces"][number]) => (p.color === "b" ? Math.PI : 0);
    const modelOf = (p: Frame["pieces"][number], mirror: boolean) => {
      if (!p.tilt) return mirror ? placement([p.x, -p.y, p.z], yawOf(p), p.scale, -p.scale) : placement([p.x, p.y, p.z], yawOf(p), p.scale);
      const m = tiltedPlacement([p.x, p.y, p.z], yawOf(p), p.scale, p.tilt, p.tiltYaw ?? 0);
      if (mirror) for (const i of [1, 5, 9, 13]) m[i] = -m[i];
      return m;
    };
    // The squares go down first without depth and mark the stencil: the
    // mirror image is then painted only inside the board, on top of them.
    gl.enable(gl.STENCIL_TEST);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.depthMask(false);
    this.drawLit(this.board!, placement([0, 0, 0], 0, 1), { metal: 0, gloss: wood ? 0.6 : 0.85, wood });
    gl.depthMask(true);
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    // Flat standees are painted on top by the 2D layer; only their shadows go on the board.
    const solid = style.view !== "billboard";
    if (style.reflection && solid) {
      for (const p of frame.pieces) {
        if (p.alpha <= 0.01) continue;
        this.drawLit(this.piece(p.type), modelOf(p, true), { ...pieceOpts(p), alpha: 0.3 * p.alpha * Math.max(0, 1 - p.y * 0.8) });
      }
    }
    // The surroundings go everywhere except inside the board, where the mirror image is.
    if (this.env) {
      gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
      for (const part of this.env.parts) this.drawLit(part.mesh, placement([0, 0, 0], 0, 1), { metal: 0, gloss: part.gloss, glow: part.glow });
      if (this.env.lines.length) {
        gl.useProgram(this.flat);
        gl.uniformMatrix4fv(this.flatU.uViewProj, false, viewProj);
        gl.depthMask(false);
        const data: number[] = [];
        for (const l of this.env.lines) data.push(...lineQuad(l));
        this.drawFlat(data, accent, 0.7, 4);
        gl.depthMask(true);
        gl.useProgram(this.lit);
      }
    }
    gl.disable(gl.STENCIL_TEST);
    this.drawLit(this.frame!, placement([0, 0, 0], 0, 1), { metal: 0, gloss: 0.7, wood });

    // Board decorations, painted just above the squares.
    gl.useProgram(this.flat);
    gl.uniformMatrix4fv(this.flatU.uViewProj, false, viewProj);
    gl.depthMask(false);
    for (const p of frame.pieces) {
      if (p.alpha <= 0.01) continue;
      const lift = Math.max(0, p.y);
      this.drawFlat(quad(p.x, p.z, 1.05 + lift * 0.5, 0.004), [0, 0, 0], 0.5 * p.alpha * Math.max(0.2, 1 - lift * 0.7), 1);
    }
    if (frame.lastMove && frame.lastMove.alpha > 0) {
      for (const sq of [frame.lastMove.from, frame.lastMove.to]) {
        const [x, z] = squareXZ(sq);
        this.drawFlat(quad(x, z, 1, 0.003), accent, 0.36 * frame.lastMove.alpha, 0);
      }
    }
    for (const m of frame.marks) {
      const [x, z] = squareXZ(m.square);
      this.drawFlat(quad(x, z, 0.98, 0.005), hexToRgb(toneColor(m.tone, style)), 0.85 * m.alpha, 2);
    }
    // Squares the subtitle names: a soft glow so viewers find them.
    for (const h of frame.hints) {
      const [x, z] = squareXZ(h.square);
      this.drawFlat(quad(x, z, 1.9, 0.0045), accent, 0.55 * h.alpha, 1);
      this.drawFlat(quad(x, z, 0.98, 0.005), accent, 0.5 * h.alpha, 2);
    }
    // Threat effect: rings pulse outwards from every threatened square.
    const threatAge = frame.fx.find((f) => f.kind === "threat")?.age;
    if (threatAge !== undefined) {
      const red = hexToRgb(toneColor("bad", style));
      const fadeIn = Math.min(1, threatAge / 0.3);
      for (const sq of frame.threats) {
        const [x, z] = squareXZ(sq);
        for (const off of [0, 0.5]) {
          const k = (threatAge * 1.1 + off) % 1;
          this.drawFlat(quad(x, z, 1.9, 0.0065), red, 0.85 * (1 - k) * fadeIn, 3, 0.25 + k * 0.7);
        }
        this.drawFlat(quad(x, z, 0.98, 0.0055), red, (0.45 + 0.35 * Math.sin(threatAge * 7)) * fadeIn, 2);
      }
    }
    // Mate effect: the king's square burns red and a shock wave runs over the board.
    const mateAge = frame.fx.find((f) => f.kind === "mate")?.age;
    if (mateAge !== undefined && frame.mate) {
      const red = hexToRgb(toneColor("bad", style));
      const [x, z] = squareXZ(frame.mate.king);
      this.drawFlat(quad(x, z, 0.98, 0.0055), red, Math.min(1, mateAge / 0.2), 0);
      this.drawFlat(quad(x, z, 3.2, 0.005), red, 0.6 * Math.min(1, mateAge / 0.3), 1);
      for (const delay of [0.3, 0.55]) {
        const k = (mateAge - delay) / 1.1;
        if (k > 0 && k < 1) this.drawFlat(quad(x, z, 4 + k * 14, 0.007), red, 0.9 * (1 - k), 3, 0.3 + k * 0.62);
      }
    }
    if (frame.landing) {
      const [x, z] = squareXZ(frame.landing.square);
      this.drawFlat(quad(x, z, 1.5, 0.006), accent, 0.9 * (1 - frame.landing.k), 3, 0.35 + frame.landing.k * 0.6);
    }
    frame.arrows.forEach((a, i) => {
      if (a.progress <= 0 || a.alpha <= 0) return;
      const c = hexToRgb(a.colour ?? toneColor(a.tone, style));
      const y = 0.008 + i * 0.0015;
      this.drawFlat(arrowMesh(a.from, a.to, a.progress, 2.3, y), c, 0.16 * a.alpha, 0);
      this.drawFlat(arrowMesh(a.from, a.to, a.progress, 1, y + 0.0005), c, 0.92 * a.alpha, 0);
    });
    gl.depthMask(true);

    gl.useProgram(this.lit);
    const ordered = solid ? [...frame.pieces].sort((a, b) => b.alpha - a.alpha) : [];
    for (const p of ordered) {
      if (p.alpha <= 0.01) continue;
      this.drawLit(this.piece(p.type), modelOf(p, false), pieceOpts(p));
    }
    gl.disable(gl.BLEND);
  }

  /** The square under a point of the picture (0..1, y down), using the last rendered camera. */
  squareAt(sx: number, sy: number): string | null {
    const hit = screenToBoard(this.viewProj, sx, sy);
    return hit ? xzSquare(hit.x, hit.z) : null;
  }
}

function mixHex(a: string, b: string, k: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round((v + (y[i] - v) * k) * 255));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A thin glowing strip on the floor (neon grid), faded with distance from the board. */
function lineQuad(l: EnvLine): number[] {
  const [ax, az] = l.a;
  const [bx, bz] = l.b;
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const px = (-(bz - az) / len) * l.width;
  const pz = ((bx - ax) / len) * l.width;
  const p = (x: number, z: number, u: number, v: number) => [x, l.y, z, u, v];
  return [...p(ax + px, az + pz, 0, 0), ...p(bx + px, bz + pz, 1, 0), ...p(bx - px, bz - pz, 1, 1), ...p(ax + px, az + pz, 0, 0), ...p(bx - px, bz - pz, 1, 1), ...p(ax - px, az - pz, 0, 1)];
}

/** A flat square of `size` on the board plane, with uv 0..1. */
export function quad(x: number, z: number, size: number, y: number): number[] {
  const h = size / 2;
  const a = [x - h, y, z - h, 0, 0];
  const b = [x + h, y, z - h, 1, 0];
  const c = [x + h, y, z + h, 1, 1];
  const d = [x - h, y, z + h, 0, 1];
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

/** Arrow on the board: straight, or an L for knight jumps; `progress` grows it from its start. */
export function arrowMesh(from: string, to: string, progress: number, widthScale: number, y: number): number[] {
  const [ax, az] = squareXZ(from);
  const [bx, bz] = squareXZ(to);
  const dx = bx - ax;
  const dz = bz - az;
  const pts: [number, number][] = [[ax, az]];
  if ((Math.abs(dx) === 1 && Math.abs(dz) === 2) || (Math.abs(dx) === 2 && Math.abs(dz) === 1)) {
    // Like on a real board: first the long leg, then the short one.
    pts.push(Math.abs(dz) > Math.abs(dx) ? [ax, bz] : [bx, az]);
  }
  pts.push([bx, bz]);
  const w = 0.085 * widthScale;
  const headLen = 0.4 * Math.min(1.6, widthScale ** 0.5);
  const headW = 0.24 * Math.min(1.7, widthScale ** 0.6);
  // Start at the edge of the piece, end in the target square's centre.
  const segs = pts.slice(1).map((p, i) => ({ a: pts[i], b: p, len: Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]) }));
  const startCut = 0.3;
  const total = segs.reduce((s, x) => s + x.len, 0) - startCut;
  let remaining = Math.max(0.05, total * progress);
  const out: number[] = [];
  const push = (x: number, z: number, u: number, v: number) => out.push(x, y, z, u, v);
  let skip = startCut;
  for (let i = 0; i < segs.length && remaining > 0; i++) {
    const s = segs[i];
    const ux = (s.b[0] - s.a[0]) / s.len;
    const uz = (s.b[1] - s.a[1]) / s.len;
    const start = Math.min(skip, s.len);
    skip = Math.max(0, skip - s.len);
    const avail = s.len - start;
    if (avail <= 0) continue;
    const use = Math.min(avail, remaining);
    remaining -= use;
    const isEnd = remaining <= 1e-6;
    const sx = s.a[0] + ux * start;
    const sz = s.a[1] + uz * start;
    // Leave room for the head on the last piece; overlap corners by half a width.
    const shaftEnd = isEnd ? Math.max(0, use - headLen) : use + w;
    const ex = sx + ux * shaftEnd;
    const ez = sz + uz * shaftEnd;
    const px = -uz * w;
    const pz = ux * w;
    if (shaftEnd > 0) {
      push(sx + px, sz + pz, 0, 0);
      push(ex + px, ez + pz, 1, 0);
      push(ex - px, ez - pz, 1, 1);
      push(sx + px, sz + pz, 0, 0);
      push(ex - px, ez - pz, 1, 1);
      push(sx - px, sz - pz, 0, 1);
    }
    if (isEnd) {
      const tipX = sx + ux * use;
      const tipZ = sz + uz * use;
      const hx = tipX - ux * Math.min(headLen, use + 0.02);
      const hz = tipZ - uz * Math.min(headLen, use + 0.02);
      push(hx - uz * headW, hz + ux * headW, 0, 0);
      push(tipX, tipZ, 1, 0.5);
      push(hx + uz * headW, hz - ux * headW, 0, 1);
    }
  }
  return out;
}

