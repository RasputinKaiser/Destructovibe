/* Collapse replay: a bounded recording of every structure piece that moved in the last ~12 s, played back with the
   simulation frozen and a free orbit camera.

   Recording: every other physics step (30 Hz) each live piece whose body moved since the last sample appends
   (frame, position, rotation) to its own track. Samples cost 32 B; the window shrinks when the total passes CAP, so
   memory is bounded (~13 MB) however big the collapse. Fragments born mid-window are tied to the piece whose death
   made them (same root, died this frame, nearest): before their birth they ride that parent's recorded motion at
   their birth offset, so the replay shows the intact member flying, then breaking. A piece that fractures while at
   rest has no track and its fragments simply sit assembled in its place until they move.

   Playback writes each tracked piece's pose into its physics mirror (cur/prev pose) and its render instance, then lets
   syncMeshes carry detail, rebar and ropes along; the real bodies are never touched and every pose is put back when
   the replay closes. Blasts recorded in the window are re-fired as visuals and sound when the playhead crosses them. */
import * as THREE from 'three';
import type { Vec3 } from '../types';
import { live, syncMeshes, type Piece } from '../destruction/structure';
import { setPieceTransform } from '../destruction/batches';
import { stepCount, FIXED_DT } from '../physics/physics';
import { input } from '../core/input';
import { fx } from './fx';
import { audio } from '../audio/audio';

const EVERY = 2;
const FRAME_DT = EVERY * FIXED_DT;
const WINDOW = Math.round(12 / FRAME_DT);
/** samples kept at most (32 B each) */
const CAP = 400_000;
const STRIDE = 8;
const SPEEDS = [0.25, 0.5, 1] as const;
const HIDE_Y = -5000;

interface Track {
  p: Piece;
  buf: Float32Array;
  /** sample index range [start, end) in buf */
  start: number;
  end: number;
  /** first frame it existed, or -Infinity for pieces already there when recording began */
  born: number;
  death: number;
  parent: Track | null;
  /** pose in the parent's frame at birth: px py pz qx qy qz qw */
  rel: Float32Array | null;
  cursor: number;
}

interface Blast { f: number; pos: Vec3; r: number }

export interface ReplayView {
  t: number;
  span: number;
  speed: number;
  paused: boolean;
  pieces: number;
}

const tracks = new Map<Piece, Track>();
let known = new WeakSet<Piece>();
let dying: Track[] = [];
const blasts: Blast[] = [];
let F = 0;
let minF = 0;
let lastStep = -1;
let total = 0;
let recording = true;
let sinceCompact = 0;
/** activity (samples) per frame, a ring over the window */
const activity = new Int32Array(WINDOW + 64);

/* ---------------- recording ---------------- */

function newTrack(p: Piece, fresh: boolean): Track {
  const tr: Track = { p, buf: new Float32Array(STRIDE * 8), start: 0, end: 0, born: fresh ? F : -Infinity, death: -1, parent: null, rel: null, cursor: 0 };
  tracks.set(p, tr);
  known.add(p);
  if (fresh) adopt(tr);
  return tr;
}

/* Tie a fragment to the member whose death made it: same root, died this frame or the last, nearest. */
function adopt(tr: Track): void {
  const c = tr.p.curPos;
  let best: Track | null = null, bd = Infinity;
  for (const d of dying) {
    if (d.p.root !== tr.p.root || d.end <= d.start) continue;
    const o = (d.end - 1) * STRIDE;
    const dist = Math.hypot(d.buf[o + 1] - c[0], d.buf[o + 2] - c[1], d.buf[o + 3] - c[2]);
    const reach = 0.6 + Math.cbrt(Math.max(1e-4, d.p.volume)) * 1.8;
    if (dist < reach && dist < bd) { bd = dist; best = d; }
  }
  if (!best) return;
  const o = (best.end - 1) * STRIDE;
  const b = best.buf;
  tr.parent = best;
  tr.rel = new Float32Array(7);
  // rel = inverse(parent) * child
  qConj(_qa, b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
  qRot(_va, _qa, c[0] - b[o + 1], c[1] - b[o + 2], c[2] - b[o + 3]);
  const r = tr.p.curRot;
  qMul(_qb, _qa[0], _qa[1], _qa[2], _qa[3], r[0], r[1], r[2], r[3]);
  tr.rel.set([_va[0], _va[1], _va[2], _qb[0], _qb[1], _qb[2], _qb[3]]);
}

function push(tr: Track, f: number, pos: ArrayLike<number>, rot: ArrayLike<number>): void {
  if ((tr.end + 1) * STRIDE > tr.buf.length) {
    if (tr.start > (tr.end - tr.start)) {
      tr.buf.copyWithin(0, tr.start * STRIDE, tr.end * STRIDE);
      tr.end -= tr.start; tr.cursor = Math.max(0, tr.cursor - tr.start); tr.start = 0;
    } else {
      const nb = new Float32Array(tr.buf.length * 2);
      nb.set(tr.buf.subarray(0, tr.end * STRIDE));
      tr.buf = nb;
    }
  }
  const o = tr.end * STRIDE, b = tr.buf;
  b[o] = f;
  b[o + 1] = pos[0]; b[o + 2] = pos[1]; b[o + 3] = pos[2];
  b[o + 4] = rot[0]; b[o + 5] = rot[1]; b[o + 6] = rot[2]; b[o + 7] = rot[3];
  tr.end++;
  total++;
}

/** After each physics step. */
function recordStep(): void {
  if (!recording || playing) return;
  if (stepCount % EVERY !== 0) return;
  F++;
  for (const tr of tracks.values()) if (tr.death < 0 && tr.p.dead) { tr.death = F; dying.push(tr); }
  let n = 0;
  for (const p of live) {
    if (p.movedStep <= lastStep) continue;
    let tr = tracks.get(p);
    if (!tr) tr = newTrack(p, !known.has(p));
    push(tr, F, p.curPos, p.curRot);
    n++;
  }
  lastStep = stepCount;
  activity[F % activity.length] = n;
  if (dying.length) dying = dying.filter(t => t.death >= F - 1);
  if (++sinceCompact >= 30 || total > CAP) { sinceCompact = 0; compact(); }
}

/* Drop what fell out of the window (keeping one anchor sample before it) and whole tracks that no longer matter. */
function compact(): void {
  minF = Math.max(minF, F - WINDOW);
  while (total > CAP && minF < F - 30) {
    minF += 15;
    trim();
  }
  trim();
}

function trim(): void {
  for (const [p, tr] of tracks) {
    const b = tr.buf;
    while (tr.start + 1 < tr.end && b[(tr.start + 1) * STRIDE] <= minF) { tr.start++; total--; }
    const lastF = b[(tr.end - 1) * STRIDE];
    const gone = tr.death >= 0 ? tr.death < minF : tr.end - tr.start <= 1 && lastF <= minF && tr.born < minF;
    if (gone) {
      total -= tr.end - tr.start;
      tracks.delete(p);
    }
    if (tr.born !== -Infinity && tr.born < minF) { tr.born = -Infinity; tr.parent = null; tr.rel = null; }
  }
}

function noteBlast(pos: Vec3, radius: number): void {
  if (!recording || playing) return;
  blasts.push({ f: F + 1, pos: [pos[0], pos[1], pos[2]], r: radius });
  while (blasts.length && blasts[0].f < F - WINDOW) blasts.shift();
  if (blasts.length > 64) blasts.shift();
}

function reset(): void {
  tracks.clear();
  known = new WeakSet();
  for (const p of live) known.add(p);
  dying = [];
  blasts.length = 0;
  F = 0; minF = 0; total = 0; lastStep = stepCount;
  activity.fill(0);
  if (playing) playing = false;
}

/* ---------------- quaternion helpers ---------------- */

const _qa = [0, 0, 0, 1], _qb = [0, 0, 0, 1], _va = [0, 0, 0];
function qConj(o: number[], x: number, y: number, z: number, w: number): void { o[0] = -x; o[1] = -y; o[2] = -z; o[3] = w; }
function qMul(o: number[], ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number): void {
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
}
function qRot(o: number[], q: number[], vx: number, vy: number, vz: number): void {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  o[0] = vx + qw * tx + (qy * tz - qz * ty);
  o[1] = vy + qw * ty + (qz * tx - qx * tz);
  o[2] = vz + qw * tz + (qx * ty - qy * tx);
}

/* ---------------- playback ---------------- */

let playing = false;
let t = 0, t0 = 0, t1 = 0;
let speedIx = 1;
let paused = false;
let endHold = 0;
let lastT = 0;
const saved = new Map<Piece, Float64Array>();
const orbit = { yaw: 0, pitch: 0.35, dist: 20, focus: new THREE.Vector3() };
const _cam = new THREE.Vector3();

/* Pose of a track at frame time tt into out[0..6]; false when the piece did not exist yet (and has no parent). */
function poseAt(tr: Track, tt: number, out: Float32Array | number[], depth = 0): boolean {
  if (tt < tr.born) {
    if (!tr.parent || !tr.rel || depth > 8) return false;
    if (!poseAt(tr.parent, tt, _pp, depth + 1)) return false;
    const r = tr.rel;
    _qp[0] = _pp[3]; _qp[1] = _pp[4]; _qp[2] = _pp[5]; _qp[3] = _pp[6];
    qRot(_va, _qp, r[0], r[1], r[2]);
    out[0] = _pp[0] + _va[0]; out[1] = _pp[1] + _va[1]; out[2] = _pp[2] + _va[2];
    qMul(_qb, _qp[0], _qp[1], _qp[2], _qp[3], r[3], r[4], r[5], r[6]);
    out[3] = _qb[0]; out[4] = _qb[1]; out[5] = _qb[2]; out[6] = _qb[3];
    return true;
  }
  const b = tr.buf;
  if (tr.end <= tr.start) return false;
  // cursor: the last sample at or before tt
  let i = Math.min(Math.max(tr.cursor, tr.start), tr.end - 1);
  if (b[i * STRIDE] > tt) {
    let lo = tr.start, hi = i;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m * STRIDE] <= tt) lo = m; else hi = m - 1; }
    i = lo;
  } else while (i + 1 < tr.end && b[(i + 1) * STRIDE] <= tt) i++;
  tr.cursor = i;
  const o = i * STRIDE;
  if (i + 1 < tr.end && b[o] <= tt) {
    const o2 = o + STRIDE;
    // a piece that rested between samples starts moving only over the last frame before the next one
    const u = Math.min(1, Math.max(0, tt - (b[o2] - 1)));
    if (u > 0) { lerpPose(out, b, o, o2, u); return true; }
  }
  for (let k = 0; k < 7; k++) out[k] = b[o + 1 + k];
  return true;
}

const _pp = new Float32Array(7), _qp = [0, 0, 0, 1];
function lerpPose(out: Float32Array | number[], b: Float32Array, o: number, o2: number, u: number): void {
  for (let k = 1; k <= 3; k++) out[k - 1] = b[o + k] + (b[o2 + k] - b[o + k]) * u;
  let x2 = b[o2 + 4], y2 = b[o2 + 5], z2 = b[o2 + 6], w2 = b[o2 + 7];
  const x1 = b[o + 4], y1 = b[o + 5], z1 = b[o + 6], w1 = b[o + 7];
  if (x1 * x2 + y1 * y2 + z1 * z2 + w1 * w2 < 0) { x2 = -x2; y2 = -y2; z2 = -z2; w2 = -w2; }
  let x = x1 + (x2 - x1) * u, y = y1 + (y2 - y1) * u, z = z1 + (z2 - z1) * u, w = w1 + (w2 - w1) * u;
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l; y /= l; z /= l; w /= l;
  out[3] = x; out[4] = y; out[5] = z; out[6] = w;
}

const _pose = new Float32Array(7);
function apply(tt: number): void {
  for (const tr of tracks.values()) {
    const p = tr.p;
    if (p.dead) continue;
    const vis = poseAt(tr, tt, _pose);
    if (!vis) { _pose[0] = p.curPos[0]; _pose[1] = HIDE_Y; _pose[2] = p.curPos[2]; }
    p.curPos[0] = p.prevPos[0] = _pose[0];
    p.curPos[1] = p.prevPos[1] = _pose[1];
    p.curPos[2] = p.prevPos[2] = _pose[2];
    if (vis) {
      p.curRot[0] = p.prevRot[0] = _pose[3];
      p.curRot[1] = p.prevRot[1] = _pose[4];
      p.curRot[2] = p.prevRot[2] = _pose[5];
      p.curRot[3] = p.prevRot[3] = _pose[6];
    }
    setPieceTransform(p.gfx, p.curPos, p.curRot, 1);
  }
  syncMeshes(1);
}

function firstActive(): number {
  const from = Math.max(minF, 1);
  for (let f = from; f <= F; f++) if (activity[f % activity.length] > 0) return f;
  return from;
}

function start(camera: THREE.Camera): boolean {
  if (playing || F - minF < 10 || !tracks.size) return false;
  compact();
  let a = firstActive();
  if (blasts.length) a = Math.min(a, blasts[0].f);
  t0 = Math.max(minF + 1, a - Math.round(0.6 / FRAME_DT));
  t1 = F;
  t = t0;
  lastT = t0 - 1e-3;
  paused = false;
  endHold = 0;
  saved.clear();
  // aim the orbit at the blasts in the window, else at what moved near the player (a mill wheel across the site
  // must not pull the focus away), weighted toward the big pieces
  let wx = 0, wy = 0, wz = 0, ws = 0;
  for (const b of blasts) if (b.f >= t0) { wx += b.pos[0]; wy += b.pos[1]; wz += b.pos[2]; ws++; }
  if (!ws) {
    for (const tr of tracks.values()) {
      if (tr.end - tr.start < 3) continue;
      const o = tr.start * STRIDE;
      if (Math.hypot(tr.buf[o + 1] - camera.position.x, tr.buf[o + 3] - camera.position.z) > 60) continue;
      const w = Math.min(4, Math.cbrt(tr.p.volume) + 0.05);
      wx += tr.buf[o + 1] * w; wy += tr.buf[o + 2] * w; wz += tr.buf[o + 3] * w; ws += w;
    }
  }
  for (const tr of tracks.values()) {
    const p = tr.p;
    if (p.dead) continue;
    const s = new Float64Array(14);
    s.set(p.curPos, 0); s.set(p.prevPos, 3); s.set(p.curRot, 6); s.set(p.prevRot, 10);
    saved.set(p, s);
  }
  _cam.copy(camera.position);
  if (ws > 0) orbit.focus.set(wx / ws, Math.max(1, wy / ws), wz / ws);
  else orbit.focus.copy(_cam).add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(15));
  const off = _cam.clone().sub(orbit.focus);
  const d = off.length() || 1;
  orbit.dist = Math.min(40, Math.max(10, d));
  orbit.yaw = Math.atan2(off.x, off.z);
  orbit.pitch = Math.min(1.2, Math.max(0.12, Math.asin(Math.min(1, Math.max(-1, off.y / d)))));
  playing = true;
  apply(t);
  return true;
}

function stop(): void {
  if (!playing) return;
  playing = false;
  for (const [p, s] of saved) {
    if (p.dead) continue;
    for (let k = 0; k < 3; k++) { p.curPos[k] = s[k]; p.prevPos[k] = s[3 + k]; }
    for (let k = 0; k < 4; k++) { p.curRot[k] = s[6 + k]; p.prevRot[k] = s[10 + k]; }
    setPieceTransform(p.gfx, p.curPos, p.curRot, 1);
  }
  saved.clear();
  for (const tr of tracks.values()) tr.cursor = tr.end - 1;
  syncMeshes(1);
}

/* Once per rendered frame while playing: controls, playhead, poses, camera. Returns false once closed. */
function update(dt: number, camera: THREE.PerspectiveCamera): void {
  if (!playing) return;
  const p = input.pressed;
  if (p.has('Space')) paused = !paused;
  for (let k = 0; k < SPEEDS.length; k++) if (p.has(`Digit${k + 1}`)) speedIx = k;
  if (p.has('KeyR')) { t = t0; lastT = t0 - 1e-3; endHold = 0; }
  const scrub = (p.has('ArrowRight') ? 1 : 0) - (p.has('ArrowLeft') ? 1 : 0);
  if (scrub) { t = Math.min(t1, Math.max(t0, t + scrub / FRAME_DT)); lastT = t - 1e-3; }
  if (!paused) {
    if (t >= t1) {
      endHold += dt;
      if (endHold > 1.5) { t = t0; lastT = t0 - 1e-3; endHold = 0; }
    } else t = Math.min(t1, t + (dt * SPEEDS[speedIx]) / FRAME_DT);
  }
  if (t > lastT) {
    for (const b of blasts) if (b.f > lastT && b.f <= t) { fx.explosion(b.pos, b.r); audio.explosion(b.pos, b.r / 3); }
  }
  lastT = t;
  apply(t);

  // orbit: mouse turns, wheel zooms, WASD / Q E move the focus
  orbit.yaw -= input.mouseDX * 0.0035;
  orbit.pitch = Math.min(1.45, Math.max(-0.1, orbit.pitch + input.mouseDY * 0.0035));
  if (input.wheel) orbit.dist = Math.min(120, Math.max(3, orbit.dist * Math.pow(1.12, input.wheel)));
  const d = input.down;
  const f = (d.has('KeyW') ? 1 : 0) - (d.has('KeyS') ? 1 : 0), s = (d.has('KeyD') ? 1 : 0) - (d.has('KeyA') ? 1 : 0);
  const u = (d.has('KeyE') ? 1 : 0) - (d.has('KeyQ') ? 1 : 0);
  const v = Math.max(4, orbit.dist * 0.8) * dt;
  const sy = Math.sin(orbit.yaw), cy = Math.cos(orbit.yaw);
  orbit.focus.x += (-sy * f + cy * s) * v;
  orbit.focus.z += (-cy * f - sy * s) * v;
  orbit.focus.y = Math.max(0, orbit.focus.y + u * v);
  const cp = Math.cos(orbit.pitch);
  camera.position.set(orbit.focus.x + sy * cp * orbit.dist, orbit.focus.y + Math.sin(orbit.pitch) * orbit.dist, orbit.focus.z + cy * cp * orbit.dist);
  camera.position.y = Math.max(0.3, camera.position.y);
  camera.lookAt(orbit.focus);
}

function view(): ReplayView | null {
  if (!playing) return null;
  let pieces = 0;
  for (const tr of tracks.values()) if (!tr.p.dead) pieces++;
  return { t: (t - t0) * FRAME_DT, span: (t1 - t0) * FRAME_DT, speed: SPEEDS[speedIx], paused, pieces };
}

function stats(): { tracks: number; samples: number; bytes: number; seconds: number; blasts: number } {
  let bytes = 0;
  for (const tr of tracks.values()) bytes += tr.buf.byteLength + (tr.rel ? 28 : 0);
  return { tracks: tracks.size, samples: total, bytes, seconds: (F - minF) * FRAME_DT, blasts: blasts.length };
}

export const replay = {
  recordStep,
  noteBlast,
  reset,
  start,
  stop,
  update,
  view,
  stats,
  get playing(): boolean { return playing; },
  get recording(): boolean { return recording; },
  setRecording(on: boolean): void { recording = on; if (!on) reset(); },
  /** test hook: jump the playhead to a fraction of the recording */
  seek(frac: number): void { if (playing) { t = t0 + (t1 - t0) * Math.min(1, Math.max(0, frac)); lastT = t; apply(t); } },
};
