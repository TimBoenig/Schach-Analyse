// Own minimal WebGL renderer for the site's 3D objects (about 200 lines instead
// of a 150 kB 3D library). ONE hidden WebGL canvas serves every object on the
// page: each is rendered there and copied into its own 2D canvas, so the
// browser's limit on WebGL contexts is never an issue. Loaded on demand.
import { bounds, STRIDE, type Mesh } from "./mesh";
import { modelMesh, type ModelKind } from "./models";

const VERT = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor;
uniform float uYaw, uTilt, uCenter, uScale, uDist;
varying vec3 vN, vP; varying vec4 vColor;
vec3 turn(vec3 p) {
  float c = cos(uYaw), s = sin(uYaw);
  p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  c = cos(uTilt); s = sin(uTilt);
  return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}
void main() {
  vec3 p = turn((aPos - vec3(0.0, uCenter, 0.0)) * uScale);
  p.z -= uDist;
  vN = turn(aNormal); vP = p; vColor = aColor;
  float f = 1.0 / tan(0.5 * 0.5), near = 0.5, far = 20.0;
  gl_Position = vec4(p.x * f, p.y * f, p.z * (far + near) / (near - far) + 2.0 * far * near / (near - far), -p.z);
}`;

// Studio lighting made of formulas: a soft sky, a large key light, a cool fill
// and a rim light. Metals mirror this "room", porcelain is lit by it.
const FRAG = `
precision mediump float;
varying vec3 vN, vP; varying vec4 vColor;
const vec3 KEY = vec3(-0.485, 0.686, 0.543);
const vec3 FILL = vec3(0.873, 0.218, 0.436);
const vec3 RIM = vec3(0.0, 0.287, -0.958);
vec3 room(vec3 d) {
  vec3 c = mix(vec3(0.3, 0.22, 0.14), vec3(0.55, 0.57, 0.62), smoothstep(-0.5, 0.1, d.y));
  c = mix(c, vec3(1.05, 1.06, 1.1), smoothstep(0.1, 1.0, d.y));
  // Tall light strips around the room give round metal its bright streaks.
  float strips = smoothstep(0.55, 0.95, sin(atan(d.x, d.z) * 3.0 + 0.6));
  c += vec3(1.0, 0.98, 0.94) * 1.5 * strips * smoothstep(-0.35, 0.25, d.y);
  c *= 1.0 - 0.75 * smoothstep(0.35, 0.9, sin(atan(d.x, d.z) * 3.0 + 3.6)) * smoothstep(0.7, 0.0, abs(d.y));
  c += vec3(1.0, 0.96, 0.88) * 3.0 * smoothstep(0.78, 0.96, dot(d, KEY));
  c += vec3(0.6, 0.72, 1.0) * 1.1 * smoothstep(0.72, 0.95, dot(d, FILL));
  c += vec3(1.0) * 1.6 * smoothstep(0.55, 0.95, dot(d, RIM));
  return c;
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vP);
  if (dot(n, v) < 0.0) n = -n;
  vec3 albedo = vColor.rgb;
  float metal = vColor.a;
  float facing = max(dot(n, v), 0.0);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - facing, 5.0);
  vec3 light = vec3(0.26) + vec3(1.0, 0.97, 0.92) * 0.85 * max(dot(n, KEY), 0.0) + vec3(0.6, 0.7, 1.0) * 0.25 * max(dot(n, FILL), 0.0)
    + vec3(0.12) * (n.y * 0.5 + 0.5);
  vec3 color = albedo * light * (1.0 - metal) + room(reflect(-v, n)) * fresnel * mix(0.7, 1.0, metal);
  color = color / (1.0 + color * 0.35);
  gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}`;

interface Loaded {
  buffer: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
  center: number;
  scale: number;
}

let canvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let uniforms: Record<string, WebGLUniformLocation | null> = {};
let loaded = new Map<ModelKind, Loaded>();
let failed = false;

function init(): boolean {
  if (gl) return true;
  if (failed) return false;
  canvas = document.createElement("canvas");
  const ctx = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!ctx) {
    failed = true;
    return false;
  }
  const compile = (type: number, source: string) => {
    const shader = ctx.createShader(type)!;
    ctx.shaderSource(shader, source);
    ctx.compileShader(shader);
    return shader;
  };
  const program = ctx.createProgram()!;
  ctx.attachShader(program, compile(ctx.VERTEX_SHADER, VERT));
  ctx.attachShader(program, compile(ctx.FRAGMENT_SHADER, FRAG));
  ["aPos", "aNormal", "aColor"].forEach((name, i) => ctx.bindAttribLocation(program, i, name));
  ctx.linkProgram(program);
  if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
    failed = true;
    return false;
  }
  ctx.useProgram(program);
  uniforms = {};
  for (const name of ["uYaw", "uTilt", "uCenter", "uScale", "uDist"]) uniforms[name] = ctx.getUniformLocation(program, name);
  ctx.enable(ctx.DEPTH_TEST);
  ctx.clearColor(0, 0, 0, 0);
  // The browser may take the context away (tab in the background, driver reset): start over next time.
  canvas.addEventListener("webglcontextlost", () => {
    gl = null;
    loaded = new Map();
  });
  gl = ctx;
  return true;
}

function load(kind: ModelKind): Loaded {
  let entry = loaded.get(kind);
  if (entry) return entry;
  const mesh: Mesh = modelMesh(kind);
  const b = bounds(mesh);
  const buffer = gl!.createBuffer()!;
  gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
  gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl!.STATIC_DRAW);
  const index = gl!.createBuffer()!;
  gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, index);
  gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl!.STATIC_DRAW);
  // Every model is framed the same way: its height fills the picture.
  entry = { buffer, index, count: mesh.indices.length, center: (b.minY + b.maxY) / 2, scale: 2 / Math.max(b.maxY - b.minY, b.radius * 2.6) };
  loaded.set(kind, entry);
  return entry;
}

/**
 * Renders a model and copies it into `target` (a square 2D canvas).
 * Returns false when WebGL is not available.
 */
export function renderModel(target: HTMLCanvasElement, kind: ModelKind, yaw: number, tilt: number): boolean {
  if (!init() || !gl || !canvas) return false;
  const px = target.width;
  if (canvas.width < px || canvas.height < px) {
    canvas.width = canvas.height = Math.max(px, canvas.width);
  }
  const m = load(kind);
  gl.viewport(0, 0, px, px);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, px, px);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.buffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.index);
  const bytes = STRIDE * 4;
  for (let i = 0; i < 3; i++) gl.enableVertexAttribArray(i);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bytes, 24);
  gl.uniform1f(uniforms.uYaw, yaw);
  gl.uniform1f(uniforms.uTilt, tilt);
  gl.uniform1f(uniforms.uCenter, m.center);
  gl.uniform1f(uniforms.uScale, m.scale);
  gl.uniform1f(uniforms.uDist, 4.6);
  gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
  const out = target.getContext("2d");
  if (!out) return false;
  out.clearRect(0, 0, px, px);
  // WebGL's origin is bottom-left: the rendered square sits at the bottom of the shared canvas.
  out.drawImage(canvas, 0, canvas.height - px, px, px, 0, 0, px, px);
  return true;
}
