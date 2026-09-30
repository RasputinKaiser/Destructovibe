import type { Vec3 } from '../types';

/* A snapped overhead conductor: each half hangs from its insulator and falls, swinging down to lie on whatever ground is
   under it. A light chain of nodes (Verlet, fixed link lengths), anchored to the insulator's piece, colliding with the
   ground surface only: it moves no bodies and nothing it does depends on who watches. It stops being stepped once it
   lies still, until its insulator moves or an arc at its end kicks it. */

export const TAIL_NODES = 16;
const G = 9.81;
const DAMP = 0.985;           // air drag and the strands' own damping: a swing dies in a few seconds
const ITERS = 8;
const R = 0.012;              // conductor radius: it rests this far over the ground
const SLEEP = 1.5e-4;         // m per step under which a node counts as still
const SLEEP_STEPS = 45;
const STICK = 0.004;           // m per step (0.24 m/s) under which a node on the ground stays put

export interface Tail {
  x: Float32Array;            // node positions, node 0 on the insulator
  px: Float32Array;           // positions last step
  seg: number;                // link length, m
  awake: boolean;
  still: number;              // steps it has been still
  grounded: boolean;          // its free end lies on the ground
  gy: Float32Array;           // ground height under each node, sampled where gs holds (the terrain query is not free)
  gs: Float32Array;           // x, z each node's ground was sampled at
}

/** A tail from `anchor` running `len` m straight toward `toward`. */
export function makeTail(anchor: ArrayLike<number>, toward: ArrayLike<number>, len: number): Tail {
  const n = TAIL_NODES, x = new Float32Array(n * 3);
  let dx = toward[0] - anchor[0], dy = toward[1] - anchor[1], dz = toward[2] - anchor[2];
  const d = Math.hypot(dx, dy, dz) || 1;
  dx /= d; dy /= d; dz /= d;
  const seg = Math.max(0.05, len) / (n - 1);
  for (let i = 0; i < n; i++) { x[i * 3] = anchor[0] + dx * seg * i; x[i * 3 + 1] = anchor[1] + dy * seg * i; x[i * 3 + 2] = anchor[2] + dz * seg * i; }
  return { x, px: x.slice(), seg, awake: true, still: 0, grounded: false, gy: new Float32Array(n).fill(NaN), gs: new Float32Array(n * 2) };
}

/** One physics step: node 0 follows the insulator at `anchor` (null: the insulator is gone and the whole length
 *  falls); the rest fall, keep their link lengths and rest on the ground (`ground(x, z)`), sliding with friction. */
export function stepTail(t: Tail, anchor: ArrayLike<number> | null, dt: number, ground: (x: number, z: number) => number): void {
  const { x, px } = t, n = TAIL_NODES;
  if (!t.awake) {
    if (!anchor) return;
    const ax = anchor[0] - x[0], ay = anchor[1] - x[1], az = anchor[2] - x[2];
    if (ax * ax + ay * ay + az * az < 1e-6) return;
    t.awake = true; t.still = 0;
  }
  const i0 = anchor ? 1 : 0;
  if (anchor) { x[0] = anchor[0]; x[1] = anchor[1]; x[2] = anchor[2]; px[0] = x[0]; px[1] = x[1]; px[2] = x[2]; }
  const g = G * dt * dt;
  let moved = 0;
  for (let i = i0; i < n; i++) {
    const o = i * 3;
    const vx = (x[o] - px[o]) * DAMP, vy = (x[o + 1] - px[o + 1]) * DAMP, vz = (x[o + 2] - px[o + 2]) * DAMP;
    px[o] = x[o]; px[o + 1] = x[o + 1]; px[o + 2] = x[o + 2];
    x[o] += vx; x[o + 1] += vy - g; x[o + 2] += vz;
  }
  for (let k = 0; k < ITERS; k++) {
    for (let i = 0; i < n - 1; i++) {
      const a = i * 3, b = a + 3;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-6, e = (d - t.seg) / d;
      if (i === 0 && anchor) { x[b] -= dx * e; x[b + 1] -= dy * e; x[b + 2] -= dz * e; }
      else { const h = 0.5 * e; x[a] += dx * h; x[a + 1] += dy * h; x[a + 2] += dz * h; x[b] -= dx * h; x[b + 1] -= dy * h; x[b + 2] -= dz * h; }
    }
  }
  t.grounded = false;
  for (let i = i0; i < n; i++) {
    const o = i * 3;
    /* resample the ground only once the node has moved a quarter metre across it */
    const dx = x[o] - t.gs[i * 2], dz = x[o + 2] - t.gs[i * 2 + 1];
    if (!(dx * dx + dz * dz < 0.0625)) { t.gy[i] = ground(x[o], x[o + 2]); t.gs[i * 2] = x[o]; t.gs[i * 2 + 1] = x[o + 2]; }
    const gy = t.gy[i] + R;
    if (x[o + 1] < gy) {
      x[o + 1] = gy;
      /* lying on the ground: a slow creep is held by static friction, a slide loses most of its speed */
      const sx = x[o] - px[o], sz = x[o + 2] - px[o + 2];
      if (sx * sx + sz * sz < STICK * STICK) { x[o] = px[o]; x[o + 2] = px[o + 2]; }
      else { px[o] += sx * 0.6; px[o + 2] += sz * 0.6; }
      if (px[o + 1] < gy) px[o + 1] = gy;
      if (i === n - 1) t.grounded = true;
    } else if (i === n - 1 && x[o + 1] < gy + 0.05) t.grounded = true;
    moved = Math.max(moved, Math.abs(x[o] - px[o]) + Math.abs(x[o + 1] - px[o + 1]) + Math.abs(x[o + 2] - px[o + 2]));
  }
  t.still = moved < SLEEP ? t.still + 1 : 0;
  if (t.still > SLEEP_STEPS) t.awake = false;
}

/** Throw the last few nodes (an arc at the end blowing it about): `v` m/s along `dir`, fading back along the tail. */
export function kickTail(t: Tail, dir: Vec3, v: number, dt: number): void {
  const n = TAIL_NODES;
  for (let k = 0; k < 4; k++) {
    const o = (n - 1 - k) * 3, f = v * dt * (1 - k / 4);
    t.px[o] -= dir[0] * f; t.px[o + 1] -= dir[1] * f; t.px[o + 2] -= dir[2] * f;
  }
  t.awake = true; t.still = 0;
}

/** The free end and the direction it points in. */
export function tailEnd(t: Tail, pos: Vec3, dir: Vec3): void {
  const o = (TAIL_NODES - 1) * 3, q = o - 3, x = t.x;
  pos[0] = x[o]; pos[1] = x[o + 1]; pos[2] = x[o + 2];
  const dx = x[o] - x[q], dy = x[o + 1] - x[q + 1], dz = x[o + 2] - x[q + 2], d = Math.hypot(dx, dy, dz) || 1;
  dir[0] = dx / d; dir[1] = dy / d; dir[2] = dz / d;
}
