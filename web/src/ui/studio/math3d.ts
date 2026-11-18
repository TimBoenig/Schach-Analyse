// Small 4x4 matrix helpers for the studio camera (column-major, like WebGL).
export type Mat4 = Float32Array;
export type V3 = [number, number, number];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/**
 * Perspective projection. `shiftY` moves the picture up or down on screen
 * (a lens shift) without changing the perspective, so the board can sit a
 * little lower in a tall video and leave room for a headline.
 */
export function perspective(fovY: number, aspect: number, near: number, far: number, shiftY = 0, shiftX = 0): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[8] = shiftX;
  m[9] = shiftY;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(eye: V3, target: V3, up: V3 = [0, 1, 0]): Mat4 {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0];
  m[4] = x[1];
  m[8] = x[2];
  m[1] = y[0];
  m[5] = y[1];
  m[9] = y[2];
  m[2] = z[0];
  m[6] = z[1];
  m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}

/** Translation, rotation about the vertical axis and scale (y may differ, e.g. -1 for a mirror image). */
export function placement(pos: V3, yaw: number, scale: number, scaleY = scale): Mat4 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const m = new Float32Array(16);
  m[0] = c * scale;
  m[2] = -s * scale;
  m[5] = scaleY;
  m[8] = s * scale;
  m[10] = c * scale;
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
  m[15] = 1;
  return m;
}

/** Projects a world point to normalised screen coordinates (0..1, y down). Null behind the camera. */
export function toScreen(viewProj: Mat4, p: V3): { x: number; y: number } | null {
  const x = viewProj[0] * p[0] + viewProj[4] * p[1] + viewProj[8] * p[2] + viewProj[12];
  const y = viewProj[1] * p[0] + viewProj[5] * p[1] + viewProj[9] * p[2] + viewProj[13];
  const w = viewProj[3] * p[0] + viewProj[7] * p[1] + viewProj[11] * p[2] + viewProj[15];
  if (w <= 1e-6) return null;
  return { x: (x / w + 1) / 2, y: (1 - y / w) / 2 };
}

export function invert(m: Mat4): Mat4 | null {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (Math.abs(det) < 1e-12) return null;
  for (let i = 0; i < 16; i++) inv[i] /= det;
  return inv;
}

/** Where a click at screen point (0..1, y down) meets the board plane y = 0. */
export function screenToBoard(viewProj: Mat4, sx: number, sy: number): { x: number; z: number } | null {
  const inv = invert(viewProj);
  if (!inv) return null;
  const nx = sx * 2 - 1;
  const ny = 1 - sy * 2;
  const unproject = (nz: number): V3 => {
    const x = inv[0] * nx + inv[4] * ny + inv[8] * nz + inv[12];
    const y = inv[1] * nx + inv[5] * ny + inv[9] * nz + inv[13];
    const z = inv[2] * nx + inv[6] * ny + inv[10] * nz + inv[14];
    const w = inv[3] * nx + inv[7] * ny + inv[11] * nz + inv[15];
    return [x / w, y / w, z / w];
  };
  const a = unproject(-1);
  const b = unproject(1);
  const dy = b[1] - a[1];
  if (Math.abs(dy) < 1e-9) return null;
  const t = -a[1] / dy;
  if (t < 0) return null;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t };
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Like `placement`, then tipped over by `tilt` radians towards the board direction `tiltYaw` (0 = +z), pivoting on its base. */
export function tiltedPlacement(pos: V3, yaw: number, scale: number, tilt: number, tiltYaw: number, scaleY = scale): Mat4 {
  const ry = (a: number): Mat4 => {
    const m = new Float32Array(16);
    m[0] = Math.cos(a);
    m[2] = -Math.sin(a);
    m[5] = 1;
    m[8] = Math.sin(a);
    m[10] = Math.cos(a);
    m[15] = 1;
    return m;
  };
  const rx = new Float32Array(16);
  rx[0] = 1;
  rx[5] = Math.cos(tilt);
  rx[6] = Math.sin(tilt);
  rx[9] = -Math.sin(tilt);
  rx[10] = Math.cos(tilt);
  rx[15] = 1;
  const tip = multiply(ry(tiltYaw), multiply(rx, ry(-tiltYaw)));
  const m = multiply(tip, placement([0, 0, 0], yaw, scale, scaleY));
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
  return m;
}
