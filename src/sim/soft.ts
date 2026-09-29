import { b3, world, CAT, stepCount, raycast, overlapAABB, entityOfShape, FIXED_DT, randomStream } from '../physics/physics';
import * as P from '../destruction/polytope';
import { live, heat, windVector, type Piece, type Root } from '../destruction/structure';
import { fx } from '../render/fx';
import { audio } from '../audio/audio';
import type { PieceSpec, Vec3 } from '../types';
import { gather, poseAt, collide } from './collide';
import { beginRopes, solveRopes, beginSheets, solveSheets } from './contacts';
import { FABRICS, DEFAULT_FABRIC, GRAIN_FABRICS, REPOSE, PRESSURE_KINDS, SHEET_KINDS, type Fabric, type FabricId, type SoftKind, type SoftSpec } from './fabric';
import { sampleField } from './fields/index';
import { beginSolids, addSolids, refreshSolids, resetSolids, solveSolids, grainLoosened } from './grains';
import { pool, freeParticles, resetParticles, ALIVE, BURNING, FROZEN, SOLID, PINNED, CUT } from './particles';
import { newGas, solveVolume, gasStep, vent, P_ATM } from './pressure';
import {
  SoftBody, buildSheet, buildRope, buildLattice, buildGrains, buildShell, shellCount, heapPoints, polyLength, integrate, solveEdges, solveBending,
  solveTethers, solvePins, solveShape, solveLimits, solveSeams, solveChain, creaseCheck, plasticYield, captureShape, crushShape, updateVelocity, pinParticle, type Pin,
} from './xpbd';

/* Hybrid bodies: cloth, netting, ropes, foam, grain, gas-filled membranes, board and paper simulated by XPBD beside
   the rigid world. Coupling runs one way per substep (rigid pieces move particles along their step motion) and back
   once per step: pin, tether and contact reactions become impulses on the pieces. A calm free-hanging body is
   frame-sliced (two rigid steps at once, fewer substeps); none is sliced or skipped by its distance from the viewer. */

export { SoftBody };
export const SUB = 4;
/** particle budget per level; later bodies are built coarser, then skipped */
export const SOFT_BUDGET = 6000;
const PIN_ALPHA = 1e-8;
const SLEEP_MOVE = 0.0022;        // m per step (0.13 m/s): a sheet rippling slower than this in a breeze may rest
const SLEEP_STEPS = 45;
const GRAIN_REST = 0.0012;
const GRAIN_FREEZE = 20;
const FIRE_TICK = 0.25;
const AIR = 1.2;
const chance = randomStream(0x50f7b0d);
/** loose paper sheets and frayed threads alive at once (oldest go first) */
const MAX_SHEETS = 24;
const MAX_THREADS = 40;
const SELF_CAP = 3000;

export const softOptions = { slicing: true, selfContact: true, ropeContact: true };

export const softBodies: SoftBody[] = [];
/** bumps whenever a body is added or removed (render relayout) */
export let softVersion = 0;
const byRoot = new Map<Root, SoftBody[]>();
export const softViewer: Vec3 = [0, 1.7, 26];
/** ms: wall time of the last step; cpu: its CPU time where the host exposes one (node), else equal to ms */
export const softPerf = { ms: 0, cpu: 0, avg: 0, peak: 0, particles: 0, awake: 0, active: 0, sliced: 0 };
const cpuClock = (globalThis as { process?: { cpuUsage?: () => { user: number; system: number } } }).process?.cpuUsage;
const cpuNow = (): number => { if (!cpuClock) return performance.now(); const u = cpuClock(); return (u.user + u.system) / 1000; };
let fireT = 0;
let flapT = 0;
let windT = 0;
let used = 0;
/** ambient breeze, m/s, when the game's wind is calmer */
let breeze = 3.2;
export function setSoftBreeze(speed: number): void { breeze = Math.max(0, speed); }

export function setSoftViewer(pos: ArrayLike<number>): void {
  softViewer[0] = pos[0]; softViewer[1] = pos[1]; softViewer[2] = pos[2];
}

const AERO_KINDS = new Set<SoftKind>(['cloth', 'net', 'balloon', 'inflatable', 'dome']);

/* ---------------- geometry helpers ---------------- */

const _l: Vec3 = [0, 0, 0];
function toLocal(out: Float64Array | Vec3, pos: ArrayLike<number>, q: ArrayLike<number>, x: number, y: number, z: number): void {
  // rotate (x - pos) by conj(q)
  const vx = x - pos[0], vy = y - pos[1], vz = z - pos[2];
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}
function toWorld(out: Float64Array | Vec3, pos: ArrayLike<number>, q: ArrayLike<number>, l: ArrayLike<number>): void {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * l[2] - qz * l[1]), ty = 2 * (qz * l[0] - qx * l[2]), tz = 2 * (qx * l[1] - qy * l[0]);
  out[0] = l[0] + qw * tx + (qy * tz - qz * ty) + pos[0];
  out[1] = l[1] + qw * ty + (qz * tx - qx * tz) + pos[1];
  out[2] = l[2] + qw * tz + (qx * ty - qy * tx) + pos[2];
}

function containsWorld(p: Piece, x: number, y: number, z: number, tol: number): boolean {
  toLocal(_l, p.curPos, p.curRot, x, y, z);
  return p.parts ? p.parts.some(q => P.contains(q.poly, _l, -tol)) : P.contains(p.poly, _l, -tol);
}

/** the piece containing a world point (the preferred one first), or null for the world */
function pieceAt(x: number, y: number, z: number, prefer: Piece | null, tol = 0.06): Piece | null {
  if (prefer && !prefer.dead && containsWorld(prefer, x, y, z, tol)) return prefer;
  let found: Piece | null = null, bestVol = 0;
  const m = tol + 0.05;
  overlapAABB([x - m, y - m, z - m], [x + m, y + m, z + m], CAT.structure | CAT.debris | CAT.prop, s => {
    const e = entityOfShape(s);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (p.dead || p.volume <= bestVol || !containsWorld(p, x, y, z, tol)) return;
    found = p; bestVol = p.volume;
  });
  return found;
}

/* ---------------- creation ---------------- */

/** Build the soft bodies carried by freshly spawned pieces (their hosts). */
export function createSoftFor(pieces: Iterable<Piece>): void {
  for (const p of pieces) {
    const s = p.root.spec.soft;
    if (!s || p.dead || p.depth > 0 || byRoot.has(p.root) || stackRoots.has(p.root)) continue;
    createSoft(s, p);
  }
}

function lohi(pts: Vec3[]): [Vec3, Vec3] {
  const a = pts[0], b = pts[1] ?? pts[0];
  return [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]];
}

export function createSoft(spec: SoftSpec, host: Piece | null): SoftBody | null {
  const kind = spec.kind;
  if (kind === 'paper') { addStack(spec, host); return null; }
  let fabId: FabricId = spec.fabric ?? DEFAULT_FABRIC[kind];
  if (kind === 'granular' && !GRAIN_FABRICS.has(fabId)) fabId = 'sand';
  const fab = FABRICS[fabId];
  const b = new SoftBody(kind, fabId, fab, host, host?.root ?? null, spec.tint);
  const room = SOFT_BUDGET - used;
  let res = spec.res ?? fab.res;
  const pts = spec.pts;
  switch (kind) {
    case 'cloth': case 'net': {
      if (pts.length < 4) return null;
      const lu = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
      const lv = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]);
      const seamW = kind === 'cloth' ? spec.seams ?? fab.panel ?? 0 : 0;
      const extra = seamW > 0 ? Math.max(0, Math.round(lu / seamW) - 1) : 0;
      const cnt = (r: number): number => (lu / r + 1 + extra) * (lv / r + 1);
      while (cnt(res) > room && res < 2) res *= 1.25;
      if (cnt(res) > room) return null;
      buildSheet(b, pts, res, seamW);
      b.selfR = Math.max(fab.radius, 0.22 * Math.min(b.resU, b.resV));
      break;
    }
    case 'rope': {
      if (pts.length < 2) return null;
      const len = polyLength(pts);
      while (len / res + 1 > room && res < 2) res *= 1.25;
      if (len / res + 1 > room) return null;
      buildRope(b, pts, res);
      if (fabId !== 'thread') b.cn = new Float32Array(b.n * 4);
      break;
    }
    case 'softbody': {
      const [lo, hi] = lohi(pts);
      const cnt = (r: number): number => (Math.round((hi[0] - lo[0]) / r) + 1) * (Math.round((hi[1] - lo[1]) / r) + 1) * (Math.round((hi[2] - lo[2]) / r) + 1);
      // at least two layers through the thinnest side
      if (!spec.res) res = Math.min(res, Math.max(0.05, Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2));
      while (cnt(res) > room && res < 1) res *= 1.2;
      if (cnt(res) > room) return null;
      buildLattice(b, lo, hi, res, res * 0.5);
      b.resU = res;
      break;
    }
    case 'granular': {
      const [lo, hi] = lohi(pts);
      let g = heapPoints(lo, hi, res, REPOSE[fabId] ?? 34, false, 1e9);
      while (g.length / 3 > room && res < 1) { res *= 1.15; g = heapPoints(lo, hi, res, REPOSE[fabId] ?? 34, false, 1e9); }
      if (g.length / 3 > room || g.length === 0) return null;
      buildGrains(b, g, res);
      b.resU = res;
      for (let i = b.p0; i < b.p0 + b.n; i++) { pool.fl[i] |= FROZEN; pool.w[i] = 0; }
      b.awake = false;
      break;
    }
    case 'balloon': case 'inflatable': case 'dome': case 'carton': {
      const [lo, hi] = lohi(pts);
      const shape = kind === 'balloon' ? 'ellipsoid' : kind === 'dome' ? 'dome' : 'box';
      // a string needs a few particles too
      const spare = kind === 'balloon' && Array.isArray(spec.pins) && spec.pins.length ? 12 : 0;
      while (shellCount(lo, hi, res, shape) + spare > room && res < 2) res *= 1.2;
      if (shellCount(lo, hi, res, shape) + spare > room) return null;
      buildShell(b, lo, hi, res, shape);
      b.selfR = Math.max(fab.radius, 0.3 * b.resU);
      setupShell(b, spec, lo, hi);
      break;
    }
  }
  used += b.n;
  b.kc = (fab.bulk ?? 0) * b.resU;
  if (kind === 'dome') pinRim(b, host, spec.tear ?? fab.tear);
  else if (kind !== 'balloon') resolvePins(b, spec, host);
  if (kind === 'rope') tieInto(b);
  computeTethers(b);
  bounds(b, 0);
  register(b);
  if (kind === 'balloon' && Array.isArray(spec.pins) && spec.pins.length) tieString(b, spec.pins[0], host);
  return b;
}

/* gas, prestretch and plasticity for the shell kinds */
function setupShell(b: SoftBody, spec: SoftSpec, lo: Vec3, hi: Vec3): void {
  const f = b.fab, kind = b.kind;
  const hx = (hi[0] - lo[0]) / 2, hy = (hi[1] - lo[1]) / 2, hz = (hi[2] - lo[2]) / 2;
  if (kind === 'carton') { captureShape(b); return; }
  const gauge = spec.gauge ?? (kind === 'balloon' ? 2000 : kind === 'dome' ? 300 : b.fabId === 'kraft' ? 20e3 : 3000);
  const R0 = kind === 'balloon' ? Math.cbrt(hx * hy * hz) : kind === 'dome' ? Math.max(hx, hz, hi[1] - lo[1]) : Math.min(hx, hy, hz);
  if (b.cSeam) for (let c = 0; c < b.nc; c++) if (b.cSeam[c]) b.cWeak[c] = 0.7;
  if (!f.prestretch) b.slack = true;
  const gas = newGas(b, gauge, spec.gas === 'helium', kind !== 'dome', R0, kind === 'balloon' ? 3 : kind === 'dome' ? 40 : 12, kind === 'dome' ? spec.blower ?? 0 : 0);
  // the fabric's strain-hardened limit: the gas cannot blow it up past this, only pressurise it
  b.eMax = new Float64Array(b.ne);
  for (let e = 0; e < b.ne; e++) b.eMax[e] = b.el[e] * (f.prestretch ? 1.01 : 1.03);
  if (f.prestretch) {
    /* latex blown up to the authored size is strain-hardened (edges lock there); the squeeze of the stretched
       rubber on the gas is the gauge pressure, fading as it shrinks back. Its edges rest at the size where gas
       and squeeze balance, so a leaking balloon shrinks smoothly instead of crumpling */
    b.eRef = b.el.slice();
    for (let e = 0; e < b.ne; e++) b.ea[e] = 1e-6;
    gas.squeeze = gauge; gas.stretch = f.prestretch;
  }
  // door seals and fabric: an air dome breathes out a little all the time
  if (kind === 'dome') gas.hole = gas.seal = gas.area0 * 2e-6;
}

/** a dome's rim is anchored all round (to what it stands on, or the ground) */
function pinRim(b: SoftBody, host: Piece | null, tear: number): void {
  let y0 = Infinity;
  for (let i = b.p0; i < b.p0 + b.n; i++) y0 = Math.min(y0, pool.x[i * 3 + 1]);
  for (let i = b.p0; i < b.p0 + b.n; i++) {
    if (pool.x[i * 3 + 1] > y0 + 1e-6) continue;
    addPin(b, i, pieceAt(pool.x[i * 3], pool.x[i * 3 + 1], pool.x[i * 3 + 2], host), tear);
  }
}

function register(b: SoftBody): void {
  softBodies.push(b);
  softVersion++;
  if (b.root) {
    const l = byRoot.get(b.root);
    if (l) l.push(b); else byRoot.set(b.root, [b]);
  }
}

function resolvePins(b: SoftBody, spec: SoftSpec, host: Piece | null): void {
  const pins = spec.pins;
  if (!pins) return;
  const X = pool.x, idx: number[] = [];
  // explicit pins find their member at the authored point: the nearest particle may sit a grid step off it
  const probe = new Map<number, Vec3>();
  const sheet = b.kind === 'cloth' || b.kind === 'net';
  if (pins === 'top') {
    if (sheet) for (let u = 0; u < b.nu; u++) idx.push(b.p0 + u);
    else if (b.kind === 'rope') idx.push(X[b.p0 * 3 + 1] >= X[(b.p0 + b.n - 1) * 3 + 1] ? b.p0 : b.p0 + b.n - 1);
  } else if (pins === 'corners') {
    if (sheet) idx.push(b.p0, b.p0 + b.nu - 1, b.p0 + b.n - 1, b.p0 + b.n - b.nu);
    else if (b.kind === 'rope') idx.push(b.p0, b.p0 + b.n - 1);
  } else if (pins === 'ends') {
    if (sheet) idx.push(b.p0, b.p0 + b.nu - 1);
    else if (b.kind === 'rope') idx.push(b.p0, b.p0 + b.n - 1);
  } else {
    for (const pt of pins) {
      let bd = Infinity;
      for (let i = b.p0; i < b.p0 + b.n; i++) bd = Math.min(bd, (X[i * 3] - pt[0]) ** 2 + (X[i * 3 + 1] - pt[1]) ** 2 + (X[i * 3 + 2] - pt[2]) ** 2);
      // a seam doubles its particles: both copies sit on the point, so both are pinned
      for (let i = b.p0; i < b.p0 + b.n; i++) {
        const d = (X[i * 3] - pt[0]) ** 2 + (X[i * 3 + 1] - pt[1]) ** 2 + (X[i * 3 + 2] - pt[2]) ** 2;
        if (d <= bd + 1e-10 && !idx.includes(i)) { idx.push(i); probe.set(i, pt); }
      }
    }
  }
  const tear = spec.tear ?? b.fab.tear;
  for (const i of idx) {
    const q = probe.get(i);
    const x = q ? q[0] : X[i * 3], y = q ? q[1] : X[i * 3 + 1], z = q ? q[2] : X[i * 3 + 2];
    addPin(b, i, pieceAt(x, y, z, host), tear);
  }
}

/** a rope tied into a piece runs a few segments inside it: those particles do not collide with it */
function tieInto(b: SoftBody): void {
  const X = pool.x;
  for (const pin of b.pins) {
    if (!pin.alive || !pin.piece) continue;
    const k0 = pin.i - b.p0;
    for (const dir of [1, -1]) for (let k = k0 + dir; k >= 0 && k < b.n; k += dir) {
      const i = b.p0 + k;
      if (!containsWorld(pin.piece, X[i * 3], X[i * 3 + 1], X[i * 3 + 2], pool.r[i] + 0.01)) break;
      if (!b.skip) b.skip = new Array(b.n).fill(null);
      b.skip[k] = pin.piece;
    }
  }
}

function addPin(b: SoftBody, i: number, piece: Piece | null, tear: number): void {
  const X = pool.x;
  const local = new Float64Array(3);
  if (piece) toLocal(local, piece.curPos, piece.curRot, X[i * 3], X[i * 3 + 1], X[i * 3 + 2]);
  else local.set([X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]);
  const w = new Float64Array([X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]);
  const pin: Pin = { i, piece, local, t0: w.slice(), t1: w.slice(), t: w.slice(), tear, f: 0, J: new Float64Array(3), alive: true };
  pinParticle(b, pin);
}

/* Geodesic rest distance from each particle to its nearest live pin along live cloth (Dijkstra). */
function computeTethers(b: SoftBody): void {
  // (a rope's chain solve already keeps it from stretching; tethers would drag it round posts past their friction)
  if (b.kind !== 'cloth' && b.kind !== 'net' && b.kind !== 'dome') return;
  const live = b.pins.filter(p => p.alive);
  if (!live.length) { b.lraPin = new Int16Array(0); return; }
  const n = b.n;
  const dist = new Float64Array(n).fill(Infinity);
  const src = new Int16Array(n).fill(-1);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < b.ne; e++) {
    if (!b.eAlive[e] || !b.eAny[e]) continue;
    const i = b.ei[e * 2] - b.p0, j = b.ei[e * 2 + 1] - b.p0;
    adj[i].push(j, e); adj[j].push(i, e);
  }
  // seams: sewn copies are zero apart
  for (let k = 0; k < b.nst; k++) {
    if (!b.stOn[k]) continue;
    const i = b.sti[k * 2] - b.p0, j = b.sti[k * 2 + 1] - b.p0;
    adj[i].push(j, -1); adj[j].push(i, -1);
  }
  const heapI: number[] = [], heapD: number[] = [];
  const push = (i: number, d: number): void => {
    heapI.push(i); heapD.push(d);
    let k = heapI.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= heapD[k]) break;
      [heapI[p], heapI[k]] = [heapI[k], heapI[p]]; [heapD[p], heapD[k]] = [heapD[k], heapD[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0];
    const li = heapI.pop()!, ld = heapD.pop()!;
    if (heapI.length) {
      heapI[0] = li; heapD[0] = ld;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < heapI.length && heapD[l] < heapD[m]) m = l;
        if (r < heapI.length && heapD[r] < heapD[m]) m = r;
        if (m === k) break;
        [heapI[m], heapI[k]] = [heapI[k], heapI[m]]; [heapD[m], heapD[k]] = [heapD[k], heapD[m]];
        k = m;
      }
    }
    return top;
  };
  b.pins.forEach((p, k) => { if (p.alive) { const i = p.i - b.p0; dist[i] = 0; src[i] = k; push(i, 0); } });
  const done = new Uint8Array(n);
  while (heapI.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    const a = adj[i];
    for (let k = 0; k < a.length; k += 2) {
      const j = a[k], d = dist[i] + (a[k + 1] >= 0 ? b.el[a[k + 1]] : 0);
      if (d < dist[j]) { dist[j] = d; src[j] = src[i]; push(j, d); }
    }
  }
  b.lraPin = src;
  b.lraD = new Float64Array(n);
  for (let i = 0; i < n; i++) b.lraD[i] = Number.isFinite(dist[i]) ? dist[i] * 1.005 + 0.002 : 0;
}

/* ---------------- ties between bodies (balloon strings, frayed yarn) ---------------- */

interface Tie { a: SoftBody; i: number; b: SoftBody; j: number; tear: number; f: number; alive: boolean }
const ties: Tie[] = [];

export function tieParticles(a: SoftBody, i: number, b: SoftBody, j: number, tear: number): void {
  ties.push({ a, i, b, j, tear, f: 0, alive: true });
  a.tied++; b.tied++;
}

function cutTie(t: Tie): void {
  if (!t.alive) return;
  t.alive = false;
  t.a.tied--; t.b.tied--;
}

function maintainTies(): void {
  for (let k = ties.length - 1; k >= 0; k--) {
    const t = ties[k];
    if (t.alive && (t.a.dead || t.b.dead || !(pool.fl[t.i] & ALIVE) || !(pool.fl[t.j] & ALIVE))) cutTie(t);
    if (!t.alive) { ties.splice(k, 1); continue; }
    // a sleeper is woken only by a partner that is really moving (a resting thread must not keep its cloth up)
    if (t.a.awake !== t.b.awake) { const aw = t.a.awake ? t.a : t.b; if (aw.vmax > 0.25 || aw.burning) { wakeSoft(t.a); wakeSoft(t.b); } }
  }
}

function solveTies(h: number, stamp: number): void {
  const X = pool.x, W = pool.w, ih2 = 1 / (h * h);
  for (const t of ties) {
    const ina = t.a.stamp === stamp, inb = t.b.stamp === stamp;
    if (!t.alive || !(ina || inb)) continue;
    // a partner not stepping now holds its end still
    const i = t.i, j = t.j, wi = ina ? W[i] : 0, wj = inb ? W[j] : 0, ws = wi + wj;
    if (ws === 0) continue;
    const i3 = i * 3, j3 = j * 3;
    const dx = X[j3] - X[i3], dy = X[j3 + 1] - X[i3 + 1], dz = X[j3 + 2] - X[i3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-12) continue;
    const s = 1 / ws;
    X[i3] += dx * s * wi; X[i3 + 1] += dy * s * wi; X[i3 + 2] += dz * s * wi;
    X[j3] -= dx * s * wj; X[j3 + 1] -= dy * s * wj; X[j3 + 2] -= dz * s * wj;
    t.f += (d / ws) * ih2;
  }
}

/** a balloon's string: from the anchor (pinned to whatever holds it) to the balloon's lowest point */
function tieString(b: SoftBody, anchor: Vec3, host: Piece | null): void {
  const X = pool.x;
  let lo = b.p0;
  for (let i = b.p0; i < b.p0 + b.n; i++) if (X[i * 3 + 1] < X[lo * 3 + 1]) lo = i;
  const end: Vec3 = [X[lo * 3], X[lo * 3 + 1], X[lo * 3 + 2]];
  const s = createSoft({ kind: 'rope', fabric: 'thread', res: Math.max(0.1, polyLength([anchor, end]) / 10), pts: [anchor, end], tint: 0xf2f2f2 }, null);
  if (!s) return;
  s.host = host; s.root = null;
  addPin(s, s.p0, pieceAt(anchor[0], anchor[1], anchor[2], host), 60);
  computeTethers(s);
  tieParticles(s, s.p0 + s.n - 1, b, lo, 25);
}

/* frayed yarn at torn woven edges: a few millimetre-thin threads hanging off the edge particles */
const frayQ: { b: SoftBody; i: number }[] = [];
const threads: SoftBody[] = [];
let fraying = false;

function queueFray(b: SoftBody, i: number): void {
  if (!fraying || !b.fab.weave || frayQ.length > 8 || !(pool.fl[i] & ALIVE)) return;
  if (frayQ.some((q) => q.b === b && q.i === i)) return;
  frayQ.push({ b, i });
}

function spawnFray(b: SoftBody, i: number): void {
  if (b.dead || !(pool.fl[i] & ALIVE) || SOFT_BUDGET - used < 8) return;
  while (threads.length >= MAX_THREADS) { const o = threads.shift()!; if (!o.dead) removeSoft(o); }
  const X = pool.x, x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
  const len = 0.04 + chance() * 0.05, a = chance() * 6.28, s = 0.3;
  const t = createSoft({ kind: 'rope', fabric: 'thread', res: len / 2, tint: b.tint, pts: [[x, y, z], [x + Math.cos(a) * len * s, y - len, z + Math.sin(a) * len * s]] }, null);
  if (!t) return;
  for (let k = 0; k < t.n; k++) { const q = (t.p0 + k) * 3; pool.v[q] = pool.v[i * 3]; pool.v[q + 1] = pool.v[i * 3 + 1]; pool.v[q + 2] = pool.v[i * 3 + 2]; }
  t.shade = b.shade;
  threads.push(t);
  tieParticles(t, t.p0, b, i, 2);
}

/* ---------------- paper stacks ---------------- */

interface Stack { host: Piece | null; local: Float64Array; left: number; tint: number }
const stacks: Stack[] = [];
const stackRoots = new Set<Root>();
const sheets: SoftBody[] = [];
const sheetQ: { x: number; y: number; z: number; vx: number; vy: number; vz: number; tint: number }[] = [];

function addStack(spec: SoftSpec, host: Piece | null): void {
  const [lo, hi] = lohi(spec.pts);
  const c: Vec3 = [(lo[0] + hi[0]) / 2, hi[1] + 0.01, (lo[2] + hi[2]) / 2];
  const local = new Float64Array(3);
  if (host) toLocal(local, host.curPos, host.curRot, c[0], c[1], c[2]); else local.set(c);
  stacks.push({ host, local, left: spec.count ?? 30, tint: spec.tint ?? FABRICS.paper.tint });
  if (host) stackRoots.add(host.root);
}

const _sp: Vec3 = [0, 0, 0];
function stackPos(s: Stack): Vec3 {
  if (s.host) toWorld(_sp, s.host.curPos, s.host.curRot, s.local); else { _sp[0] = s.local[0]; _sp[1] = s.local[1]; _sp[2] = s.local[2]; }
  return _sp;
}

/** Throw `n` sheets off a stack with velocity (vx, vy, vz) plus scatter. */
function release(s: Stack, n: number, vx: number, vy: number, vz: number, scatter: number): void {
  n = Math.min(n, s.left);
  s.left -= n;
  const p = stackPos(s);
  for (let k = 0; k < n; k++) {
    const r = (): number => (chance() * 2 - 1) * scatter;
    sheetQ.push({ x: p[0] + (chance() - 0.5) * 0.2, y: p[1] + k * 0.02, z: p[2] + (chance() - 0.5) * 0.2, vx: vx + r(), vy: vy + Math.abs(r()), vz: vz + r(), tint: s.tint });
  }
}

function maintainStacks(): void {
  for (let k = stacks.length - 1; k >= 0; k--) {
    const s = stacks[k];
    // the desk went: its papers spill
    if (s.host && s.host.dead) { release(s, 6, 0, 0.5, 0, 1.2); s.left = 0; }
    if (s.left <= 0) { if (s.host) stackRoots.delete(s.host.root); stacks.splice(k, 1); }
  }
}

/** A4 sheet, randomly turned, flung with a tumble. */
function spawnSheet(q: { x: number; y: number; z: number; vx: number; vy: number; vz: number; tint: number }): void {
  while (sheets.length >= MAX_SHEETS) {
    let k = sheets.findIndex((b) => !b.awake);
    if (k < 0) k = 0;
    const o = sheets.splice(k, 1)[0];
    if (!o.dead) removeSoft(o);
  }
  if (SOFT_BUDGET - used < 24) return;
  const w = 0.21 / 2, l = 0.297 / 2, a = chance() * 6.28, t = (chance() - 0.5) * 1.2;
  const ux = Math.cos(a), uz = Math.sin(a), ct = Math.cos(t), st = Math.sin(t);
  // u along (ux, 0, uz); v tilted out of the horizontal by t
  const vx = -uz * ct, vy = st, vz = ux * ct;
  const P = (su: number, sv: number): Vec3 => [q.x + ux * su + vx * sv, q.y + vy * sv, q.z + uz * su + vz * sv];
  const b = createSoft({ kind: 'cloth', fabric: 'paper', tint: q.tint, res: 0.075, pts: [P(-w, -l), P(w, -l), P(w, l), P(-w, l)] }, null);
  if (!b) return;
  const spin = (chance() - 0.5) * 16;
  for (let k = 0; k < b.n; k++) {
    const i = (b.p0 + k) * 3;
    const rx = pool.x[i] - q.x, rz = pool.x[i + 2] - q.z;
    pool.v[i] = q.vx - rz * spin; pool.v[i + 1] = q.vy; pool.v[i + 2] = q.vz + rx * spin;
  }
  sheets.push(b);
}

function processQueues(): void {
  if (sheetQ.length) { for (const q of sheetQ.splice(0)) spawnSheet(q); }
  if (frayQ.length) { for (const q of frayQ.splice(0)) spawnFray(q.b, q.i); }
}

/* ---------------- lifecycle ---------------- */

export function clearSoft(): void {
  for (const b of softBodies) b.dead = true;
  softBodies.length = 0;
  softVersion++;
  byRoot.clear();
  resetParticles();
  resetSolids();
  used = 0;
  fireT = 0;
  ties.length = 0; threads.length = 0; frayQ.length = 0;
  stacks.length = 0; stackRoots.clear(); sheets.length = 0; sheetQ.length = 0;
}

export function removeSoft(b: SoftBody): void {
  if (b.dead) return;
  b.dead = true;
  const k = softBodies.indexOf(b);
  if (k >= 0) softBodies.splice(k, 1);
  softVersion++;
  if (b.root) {
    const l = byRoot.get(b.root);
    if (l) { const j = l.indexOf(b); if (j >= 0) l.splice(j, 1); if (!l.length) byRoot.delete(b.root); }
  }
  for (const t of ties) if (t.a === b || t.b === b) cutTie(t);
  freeParticles(b.p0, b.n);
  used -= b.n;
}

export function wakeSoft(b: SoftBody): void {
  if (!b.awake) { b.awake = true; b.still = 0; sway.delete(b); }
}

function anyLive(root: Root): boolean {
  for (const p of live) if (p.root === root && !p.dead) return true;
  return false;
}

/* ---------------- stepping ---------------- */

const activeList: SoftBody[] = [];
const guests: SoftBody[] = [];
const groups: SoftBody[][] = [[], [], []];
const sheetList: SoftBody[] = [];
const beds: SoftBody[] = [];
const _g: Vec3 = [0, -9.81, 0];
const _wind = new Float64Array(3);
let AF = new Float64Array(3 * 1024);
let stampN = 0;

/* Every body is simulated the same way wherever the viewer is: the camera only decides what is drawn (and heard), never
   how a sheet, rope or bag moves, or it would push on the rigid world differently for a near and a far player.
   Slicing is by what the body is doing: one resting on nothing and hanging free (a flag, a curtain in a breeze) takes
   two rigid steps at once; anything touching, tied, pinned under load or holding gas steps every step. */
function periodFor(b: SoftBody): number {
  if (!softOptions.slicing || pool.fl[b.p0] & SOLID || b.tied > 0 || b.q0 || b.gas || b.bearers.length) return 1;
  if (b.kind === 'rope' || b.kind === 'dome') return 1;
  return b.n >= 40 && b.vmax < 1.5 ? 2 : 1;
}

function bounds(b: SoftBody, margin: number): void {
  const X = pool.x, FL = pool.fl, a = b.aabb;
  a[0] = a[1] = a[2] = Infinity; a[3] = a[4] = a[5] = -Infinity;
  for (let i = b.p0; i < b.p0 + b.n; i++) {
    if (!(FL[i] & ALIVE)) continue;
    const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
    if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (z < a[2]) a[2] = z;
    if (x > a[3]) a[3] = x; if (y > a[4]) a[4] = y; if (z > a[5]) a[5] = z;
  }
  if (a[0] > a[3]) { a.fill(0); return; }
  a[0] -= margin; a[1] -= margin; a[2] -= margin; a[3] += margin; a[4] += margin; a[5] += margin;
}

/** the wind this body feels: the game's wind (or a light breeze) with gusts, cut by shelter */
function windFor(b: SoftBody, out: Float64Array): number {
  const w = windVector();
  const gust = 0.65 + 0.35 * Math.sin(windT * 0.7 + b.id) * Math.sin(windT * 1.9 + 1.3);
  const ws = Math.hypot(w[0], w[1], w[2]);
  let sx: number, sy: number, sz: number;
  if (ws > breeze) { sx = w[0]; sy = w[1]; sz = w[2]; }
  else { sx = breeze * gust * 0.92; sy = 0; sz = breeze * gust * 0.38; }
  out[0] = sx * b.shelter; out[1] = sy * b.shelter; out[2] = sz * b.shelter;
  return Math.hypot(out[0], out[1], out[2]);
}

function updateShelter(b: SoftBody): void {
  const w = windVector();
  let wx = w[0], wz = w[2];
  const l = Math.hypot(wx, wz);
  if (l < 0.5) { wx = 0.92; wz = 0.38; } else { wx /= l; wz /= l; }
  const X = pool.x;
  let open = 0, rays = 0;
  // upwind rays fanned ±35° from three particles: indoors, every one meets a wall within a room's length
  for (let k = 0; k < 3; k++) {
    const i = b.p0 + Math.min(b.n - 1, Math.floor(((k + 0.5) / 3) * b.n));
    if (!(pool.fl[i] & ALIVE) || pool.fl[i] & PINNED) continue;
    rays++;
    const a = (k - 1) * 0.6, c = Math.cos(a), sn = Math.sin(a), dx = wx * c - wz * sn, dz = wx * sn + wz * c;
    const hit = raycast([X[i * 3] - dx * 0.15, X[i * 3 + 1], X[i * 3 + 2] - dz * 0.15], [-dx * 14, 0, -dz * 14], CAT.structure | CAT.prop);
    const own = hit?.entity && b.pins.some(p => p.piece === hit.entity);
    if (!hit || own) open++;
  }
  b.shelter = rays ? 0.04 + 0.96 * (open / rays) : b.shelter;
}

/* Flat-plate aerodynamics per triangle: normal pressure with a lift-producing C_N(α) plus skin friction,
   applied once per step and clamped so no vertex is pushed past the air's own velocity. A closed shell meets the
   air on both its faces, which its fabric's solidity allows for. */
function aero(b: SoftBody, dt: number): void {
  const wm = windFor(b, _wind);
  if (b.nc === 0) return;
  const X = pool.x, V = pool.v, W = pool.w, n = b.n, p0 = b.p0;
  if (AF.length < n * 3) AF = new Float64Array(n * 6);
  AF.fill(0, 0, n * 3);
  const sol = b.fab.solidity, wx0 = _wind[0], wy0 = _wind[1], wz0 = _wind[2];
  const t = windT;
  for (let c = 0; c < b.nc; c++) {
    if (!b.cAlive[c]) continue;
    const A = b.c2p[c * 4], B = b.c2p[c * 4 + 1], C = b.c2p[c * 4 + 2], D = b.c2p[c * 4 + 3];
    const x0 = X[A * 3], z0 = X[A * 3 + 2];
    const turb = wm > 0.1 ? 1 + 0.3 * Math.sin(1.7 * t + 0.45 * x0 + 0.3 * z0) : 1;
    const side = wm > 0.1 ? 0.22 * Math.sin(2.3 * t + 0.6 * z0 - 0.4 * x0) : 0;
    const wx = wx0 * turb - wz0 * side, wy = wy0 + wm * 0.12 * Math.sin(3.1 * t + 0.7 * x0), wz = wz0 * turb + wx0 * side;
    for (let tri = 0; tri < 2; tri++) {
      let i: number, j: number, k: number;
      if (b.cFlip[c]) { if (tri) { i = B; j = C; k = D; } else { i = A; j = B; k = D; } }
      else if (tri) { i = A; j = C; k = D; } else { i = A; j = B; k = C; }
      const i3 = i * 3, j3 = j * 3, k3 = k * 3;
      const ux = X[j3] - X[i3], uy = X[j3 + 1] - X[i3 + 1], uz = X[j3 + 2] - X[i3 + 2];
      const vx = X[k3] - X[i3], vy = X[k3 + 1] - X[i3 + 1], vz = X[k3 + 2] - X[i3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const n2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (n2 < 1e-9) continue;
      const area = n2 * 0.5;
      nx /= n2; ny /= n2; nz /= n2;
      const rx = (V[i3] + V[j3] + V[k3]) / 3 - wx, ry = (V[i3 + 1] + V[j3 + 1] + V[k3 + 1]) / 3 - wy, rz = (V[i3 + 2] + V[j3 + 2] + V[k3 + 2]) / 3 - wz;
      const s2 = rx * rx + ry * ry + rz * rz;
      if (s2 < 1e-6) continue;
      const s = Math.sqrt(s2);
      const vn = rx * nx + ry * ny + rz * nz;
      const sa = Math.abs(vn) / s, ca = Math.sqrt(Math.max(0, 1 - sa * sa));
      const q = 0.5 * AIR * area * s2;
      const fn = -q * sa * (1.1 + 1.4 * ca) * sol * Math.sign(vn);
      const ft = -0.5 * AIR * area * 0.02 * s;
      const fx = nx * fn + (rx - vn * nx) * ft, fy = ny * fn + (ry - vn * ny) * ft, fz = nz * fn + (rz - vn * nz) * ft;
      const a = (i - p0) * 3, bb = (j - p0) * 3, cc = (k - p0) * 3;
      AF[a] += fx / 3; AF[a + 1] += fy / 3; AF[a + 2] += fz / 3;
      AF[bb] += fx / 3; AF[bb + 1] += fy / 3; AF[bb + 2] += fz / 3;
      AF[cc] += fx / 3; AF[cc + 1] += fy / 3; AF[cc + 2] += fz / 3;
    }
  }
  for (let k = 0; k < n; k++) {
    const i = p0 + k, i3 = i * 3, w = W[i];
    if (w === 0) continue;
    let dx = AF[k * 3] * w * dt, dy = AF[k * 3 + 1] * w * dt, dz = AF[k * 3 + 2] * w * dt;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-14) continue;
    const rx = V[i3] - wx0, ry = V[i3 + 1] - wy0, rz = V[i3 + 2] - wz0;
    const cap = Math.sqrt(rx * rx + ry * ry + rz * rz) + 0.5;
    if (d2 > cap * cap) { const s = cap / Math.sqrt(d2); dx *= s; dy *= s; dz *= s; }
    V[i3] += dx; V[i3 + 1] += dy; V[i3 + 2] += dz;
  }
}

function pinTargets(b: SoftBody): void {
  for (const pin of b.pins) {
    if (!pin.alive) continue;
    const p = pin.piece;
    pin.f = 0; pin.J[0] = pin.J[1] = pin.J[2] = 0;
    if (!p) { pin.t0.set(pin.local); pin.t1.set(pin.local); continue; }
    toWorld(pin.t1, p.curPos, p.curRot, pin.local);
    if (p.movedStep === stepCount) toWorld(pin.t0, p.prevPos, p.prevRot, pin.local); else pin.t0.set(pin.t1);
  }
}

function pinLerp(b: SoftBody, t: number): void {
  for (const pin of b.pins) {
    if (!pin.alive) continue;
    pin.t[0] = pin.t0[0] + (pin.t1[0] - pin.t0[0]) * t;
    pin.t[1] = pin.t0[1] + (pin.t1[1] - pin.t0[1]) * t;
    pin.t[2] = pin.t0[2] + (pin.t1[2] - pin.t0[2]) * t;
  }
}

function dropPin(b: SoftBody, pin: Pin): void {
  pin.alive = false;
  pool.fl[pin.i] &= ~PINNED;
  b.tethersDirty = true;
}

/** Hosts that died: re-seat each pin on whatever now contains its point (a fragment), or let go. */
function maintainPins(b: SoftBody): void {
  if (b.host && b.host.dead && !b.hostGone) {
    b.hostGone = true;
    if (!b.host.demolished && b.root && !anyLive(b.root)) { removeSoft(b); return; }
  }
  for (const pin of b.pins) {
    if (!pin.alive || !pin.piece) continue;
    const p = pin.piece;
    if (p.dead) {
      const x = pin.t1[0], y = pin.t1[1], z = pin.t1[2];
      const np = pieceAt(x, y, z, null, 0.08);
      if (np) { pin.piece = np; toLocal(pin.local, np.curPos, np.curRot, x, y, z); }
      else dropPin(b, pin);
      wakeSoft(b);
    } else if (!b.awake && p.movedStep === stepCount && Math.hypot(p.curPos[0] - p.prevPos[0], p.curPos[1] - p.prevPos[1], p.curPos[2] - p.prevPos[2]) > 0.002) {
      // the host really moving takes the pin with it; a host settling by a hair under what the body left on it does not
      wakeSoft(b);
    }
  }
}

const _vel: Vec3 = [0, 0, 0];
const _com: Vec3 = [0, 0, 0];
function applyImpulse(p: Piece, jx: number, jy: number, jz: number, px: number, py: number, pz: number, dt: number, bearing = false): void {
  if (p.dead || !b3.b3Body_IsValid(p.body) || b3.b3Body_GetType(p.body) !== b3.b3BodyType.b3_dynamicBody) return;
  let j = Math.sqrt(jx * jx + jy * jy + jz * jz);
  if (j < 1e-6) return;
  b3.b3Body_GetLinearVelocity(_vel, p.body);
  // a bearing reaction may stop the piece's approach and carry its weight, not throw it off
  const cap = bearing
    ? p.mass * (Math.max(0, -(_vel[0] * jx + _vel[1] * jy + _vel[2] * jz) / j) + 9.81 * dt)
    : p.mass * (Math.hypot(_vel[0], _vel[1], _vel[2]) + 1.5);
  if (j > cap) { const s = cap / j; jx *= s; jy *= s; jz *= s; j = cap; }
  const wake = j / dt > 0.06 * p.mass * 9.81 + 150;
  if (!bearing) { b3.b3Body_ApplyLinearImpulse(p.body, [jx, jy, jz], [px, py, pz], wake); return; }
  /* A bearing patch's averaged point is rough, so its moment is applied separately and limited to a
     modest spin change (inertia from the piece's size): enough to tip a piece off an edge, not to fling it. */
  b3.b3Body_GetWorldCenterOfMass(_com, p.body);
  b3.b3Body_ApplyLinearImpulseToCenter(p.body, [jx, jy, jz], wake);
  const rx = px - _com[0], ry = py - _com[1], rz = pz - _com[2];
  let lx = ry * jz - rz * jy, ly = rz * jx - rx * jz, lz = rx * jy - ry * jx;
  const inertia = p.mass * Math.cbrt(p.volume) ** 2 * 0.17;
  const l = Math.hypot(lx, ly, lz), lim = inertia * 0.25;
  if (l > lim) { const s = lim / l; lx *= s; ly *= s; lz *= s; }
  // the foam or grain bed soaks up rocking
  b3.b3Body_GetAngularVelocity(_vel, p.body);
  lx -= _vel[0] * inertia * 0.12; ly -= _vel[1] * inertia * 0.12; lz -= _vel[2] * inertia * 0.12;
  b3.b3Body_ApplyAngularImpulse(p.body, [lx, ly, lz], false);
}

/* friction may stop a slide, never start one the other way */
function applyFriction(p: Piece, jx: number, jy: number, jz: number): void {
  if (p.dead || !b3.b3Body_IsValid(p.body) || b3.b3Body_GetType(p.body) !== b3.b3BodyType.b3_dynamicBody) return;
  const j = Math.sqrt(jx * jx + jy * jy + jz * jz);
  if (j < 1e-6) return;
  b3.b3Body_GetLinearVelocity(_vel, p.body);
  const slide = -(_vel[0] * jx + _vel[1] * jy + _vel[2] * jz) / j;
  if (slide <= 0) return;
  const s = Math.min(1, (p.mass * slide) / j);
  b3.b3Body_ApplyLinearImpulseToCenter(p.body, [jx * s, jy * s, jz * s], false);
}

function tearCheck(b: SoftBody): number {
  if (b.nc === 0) return 0;
  const X = pool.x, FL = pool.fl, lim = b.fab.strain, ref = b.eRef ?? b.el;
  let torn = 0;
  // cuts by fast pieces weaken the cells round the cut particle; a cut in a gas bag is a puncture
  if (b.cuts) {
    for (let i = b.p0; i < b.p0 + b.n; i++) if (FL[i] & CUT) {
      FL[i] &= ~CUT;
      for (const c of b.p2c[i - b.p0]) {
        if (b.gas && !b.gas.open) { killCell(b, c); torn++; } else b.cWeak[c] = Math.min(b.cWeak[c], 0.25);
      }
    }
    b.cuts = 0;
  }
  fraying = true;
  for (let e = 0; e < b.ne; e++) {
    if (!b.eAlive[e] || !b.eAny[e]) continue;
    const i = b.ei[e * 2] * 3, j = b.ei[e * 2 + 1] * 3;
    const dx = X[j] - X[i], dy = X[j + 1] - X[i + 1], dz = X[j + 2] - X[i + 2], L = ref[e] * (1 + lim * 0.2);
    if (dx * dx + dy * dy + dz * dz < L * L) continue;
    const strain = Math.sqrt(dx * dx + dy * dy + dz * dz) / ref[e] - 1;
    const c0 = b.e2c[e * 2], c1 = b.e2c[e * 2 + 1];
    const c = b.cAlive[c1] && (!b.cAlive[c0] || b.cWeak[c1] < b.cWeak[c0]) ? c1 : c0;
    if (strain > lim * b.cWeak[c] && b.cAlive[c]) { killCell(b, c); torn++; }
  }
  fraying = false;
  return torn;
}

/** stitches pulled open past their gape let go (the seam unzips; loose ends fray) */
function seamCheck(b: SoftBody): number {
  const X = pool.x, g2 = b.stGap * b.stGap;
  let n = 0;
  for (let k = 0; k < b.nst; k++) {
    if (!b.stOn[k]) continue;
    const i = b.sti[k * 2], j = b.sti[k * 2 + 1];
    const d2 = (X[i * 3] - X[j * 3]) ** 2 + (X[i * 3 + 1] - X[j * 3 + 1]) ** 2 + (X[i * 3 + 2] - X[j * 3 + 2]) ** 2;
    if (d2 > g2 || !(pool.fl[i] & ALIVE) || !(pool.fl[j] & ALIVE)) {
      b.stOn[k] = 0; n++;
      if (n % 3 === 1) { fraying = true; queueFray(b, chance() < 0.5 ? i : j); fraying = false; }
    }
  }
  if (n) b.tethersDirty = true;
  return n;
}

export function killCell(b: SoftBody, c: number): void {
  if (!b.cAlive[c]) return;
  b.cAlive[c] = 0;
  b.topo++;
  for (const e of b.c2e[c]) {
    const c0 = b.e2c[e * 2], c1 = b.e2c[e * 2 + 1];
    b.eAlive[e] = b.eAny[e] ? (b.cAlive[c0] | b.cAlive[c1]) : (b.cAlive[c0] & b.cAlive[c1]);
  }
  for (const q of b.c2b[c]) b.bAlive[q] = 0;
  const corners = b.kind === 'rope' ? 2 : 4;
  // woven cloth tears along its yarns: the cells in line with the tear are weakened, not those around it
  const weave = b.fab.weave && b.nv > 1 && b.kind === 'cloth';
  if (weave) weaveWeaken(b, c);
  for (let k = 0; k < corners; k++) {
    const p = b.c2p[c * 4 + k], cells = b.p2c[p - b.p0];
    let alive = false;
    for (const o of cells) { if (b.cAlive[o]) alive = true; if (!weave) b.cWeak[o] = Math.max(0.35, b.cWeak[o] * 0.8); }
    if (!alive) {
      pool.fl[p] &= ~ALIVE;
      pool.w[p] = 0;
      for (const pin of b.pins) if (pin.alive && pin.i === p) dropPin(b, pin);
    } else if (weave && chance() < 0.35) queueFray(b, p);
  }
  b.tethersDirty = true;
}

function weaveWeaken(b: SoftBody, c: number): void {
  const X = pool.x, nu = b.nu - 1;
  const A = b.c2p[c * 4], B = b.c2p[c * 4 + 1], C = b.c2p[c * 4 + 2], D = b.c2p[c * 4 + 3];
  const len = (i: number, j: number): number => Math.hypot(X[j * 3] - X[i * 3], X[j * 3 + 1] - X[i * 3 + 1], X[j * 3 + 2] - X[i * 3 + 2]);
  // the yarns that broke are the more stretched set; the tear runs across them
  const su = (len(A, B) + len(D, C)) / (2 * b.resU), sv = (len(A, D) + len(B, C)) / (2 * b.resV);
  const u = c % nu, v = Math.floor(c / nu);
  const alongV = su >= sv;
  const hit = (du: number, dv: number, w: number): void => {
    const uu = u + du, vv = v + dv;
    if (uu < 0 || vv < 0 || uu >= nu || vv >= b.nv - 1) return;
    const o = vv * nu + uu;
    if (b.cAlive[o]) b.cWeak[o] = Math.min(b.cWeak[o], w);
  };
  if (alongV) { hit(0, 1, 0.3); hit(0, -1, 0.3); hit(1, 0, 0.85); hit(-1, 0, 0.85); }
  else { hit(1, 0, 0.3); hit(-1, 0, 0.3); hit(0, 1, 0.85); hit(0, -1, 0.85); }
}

function killParticle(b: SoftBody, i: number): void {
  if (!(pool.fl[i] & ALIVE)) return;
  if (b.nc > 0) {
    for (const c of b.p2c[i - b.p0]) killCell(b, c);
    return;
  }
  pool.fl[i] &= ~ALIVE;
  pool.w[i] = 0;
  for (let e = 0; e < b.ne; e++) if (b.ei[e * 2] === i || b.ei[e * 2 + 1] === i) b.eAlive[e] = 0;
  for (const pin of b.pins) if (pin.alive && pin.i === i) dropPin(b, pin);
  b.topo++;
}

/** Rip a gas bag open along one of its panel seams and let the gas go (with a bang for rubber). */
function burst(b: SoftBody): void {
  const g = b.gas;
  if (!g || g.open) return;
  const X = pool.x, V = pool.v, dp = g.p - P_ATM, V0 = g.V;
  const seam: number[] = [];
  if (b.cSeam) for (let c = 0; c < b.nc; c++) if (b.cSeam[c] && b.cAlive[c]) seam.push(c);
  const list = seam.length ? seam : Array.from({ length: b.nc }, (_, c) => c);
  // unzip from a random seam cell through its seam neighbours
  const start = list[Math.floor(chance() * list.length)];
  const want = Math.max(3, Math.round(list.length * (b.fab.pop ? 0.5 : 0.2)));
  const inSeam = new Set(list), q = [start], seen = new Set([start]);
  let n = 0;
  while (q.length && n < want) {
    const c = q.shift()!;
    killCell(b, c); n++;
    for (let k = 0; k < 4; k++) for (const o of b.p2c[b.c2p[c * 4 + k] - b.p0]) if (!seen.has(o) && inSeam.has(o)) { seen.add(o); q.push(o); }
  }
  vent(b);
  // the stored energy (Δp·V) flings the shreds, limited
  let mass = 0, cx = 0, cy = 0, cz = 0;
  for (let i = b.p0; i < b.p0 + b.n; i++) { mass += pool.m[i]; cx += X[i * 3] * pool.m[i]; cy += X[i * 3 + 1] * pool.m[i]; cz += X[i * 3 + 2] * pool.m[i]; }
  cx /= mass; cy /= mass; cz /= mass;
  const sp = Math.min(b.fab.pop ? 14 : 5, Math.sqrt((2 * Math.max(0, dp) * V0) / mass) * 0.3);
  for (let i = b.p0; i < b.p0 + b.n; i++) {
    if (!(pool.fl[i] & ALIVE) || pool.w[i] === 0) continue;
    const dx = X[i * 3] - cx, dy = X[i * 3 + 1] - cy, dz = X[i * 3 + 2] - cz, l = Math.hypot(dx, dy, dz) || 1;
    V[i * 3] += (dx / l) * sp; V[i * 3 + 1] += (dy / l) * sp; V[i * 3 + 2] += (dz / l) * sp;
  }
  const pos: Vec3 = [cx, cy, cz];
  audio.snap(pos, Math.min(1, 0.3 + (dp * V0) / 400));
  fx.fabricShreds(pos, Math.min(24, 4 + n), b.tint);
  wakeSoft(b);
}

/* Wind keeps a tethered balloon or a pinned net swinging about the same pose for as long as it blows: never still,
   but going nowhere. Out past arm's length that steady sway may rest in its pose; a change in the wind (not its
   gusts), anything moving near or a load coming off wakes it. */
const SWAY = 0.12, SWAY_STEPS = 180;
const sway = new WeakMap<SoftBody, { c: Vec3; t: number }>();
function swaySettled(b: SoftBody, period: number, busy: boolean): boolean {
  if (busy || b.burning > 0 || !(AERO_KINDS.has(b.kind) || b.tied > 0 || b.pins.length)) {
    sway.delete(b);
    return false;
  }
  const a = b.aabb, c: Vec3 = [(a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2];
  const s = sway.get(b);
  if (!s || Math.hypot(c[0] - s.c[0], c[1] - s.c[1], c[2] - s.c[2]) > SWAY) { sway.set(b, { c, t: 0 }); return false; }
  s.t += period;
  return s.t > SWAY_STEPS;
}

/** the wind a body stands in without its gusts */
function baseWind(b: SoftBody): number {
  const w = windVector(), ws = Math.hypot(w[0], w[1], w[2]);
  return Math.max(ws, breeze) * b.shelter;
}

function sleepTest(b: SoftBody, windSpeed: number, period: number): void {
  const X = pool.x, SX = pool.sx, FL = pool.fl, W = pool.w, V = pool.v;
  if (b.kind === 'granular') {
    let moving = 0, active = 0;
    const r2 = GRAIN_REST * GRAIN_REST;
    for (let i = b.p0; i < b.p0 + b.n; i++) {
      if (!(FL[i] & ALIVE) || FL[i] & FROZEN) continue;
      const d2 = (X[i * 3] - SX[i * 3]) ** 2 + (X[i * 3 + 1] - SX[i * 3 + 1]) ** 2 + (X[i * 3 + 2] - SX[i * 3 + 2]) ** 2;
      if (d2 < r2) {
        if (++pool.rest[i] > GRAIN_FREEZE) { FL[i] |= FROZEN; W[i] = 0; V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0; }
        active++;
      } else { pool.rest[i] = 0; moving++; active++; }
    }
    b.moving = moving;
    // nothing has moved for half a second: jam the stragglers that keep nudging each other awake
    b.still = moving === 0 ? b.still + 1 : 0;
    if (b.still > 45 && active > 0) {
      for (let i = b.p0; i < b.p0 + b.n; i++) if (FL[i] & ALIVE) { FL[i] |= FROZEN; W[i] = 0; V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0; }
      active = 0;
    }
    if (active === 0) b.awake = false;
    return;
  }
  let m2 = 0;
  for (let i = b.p0; i < b.p0 + b.n; i++) {
    if (!(FL[i] & ALIVE)) continue;
    const d2 = (X[i * 3] - SX[i * 3]) ** 2 + (X[i * 3 + 1] - SX[i * 3 + 1]) ** 2 + (X[i * 3 + 2] - SX[i * 3 + 2]) ** 2;
    if (d2 > m2) m2 = d2;
  }
  b.moving = Math.sqrt(m2) / (FIXED_DT * period);
  // a lattice resting on a lumpy bed keeps a particle or two twitching; it is at rest well before that stops
  // (a rope resting on edges flickers by a few millimetres as its contacts come and go)
  const lim = (b.kind === 'softbody' || b.kind === 'carton' || b.kind === 'rope' ? SLEEP_MOVE * 2.5 : SLEEP_MOVE) * period;
  // a leaking bag keeps going until it has emptied
  const leaking = b.gas && !b.gas.open && (b.gas.hole > b.gas.seal || b.gas.torn > 0) && Math.abs(b.gas.leak) > 1e-7;
  if (m2 < lim * lim && b.burning === 0 && !leaking) b.still++; else b.still = 0;
  if (b.still * period > SLEEP_STEPS || swaySettled(b, period, !!leaking)) {
    b.awake = false;
    b.sleepWind = AERO_KINDS.has(b.kind) ? baseWind(b) : windSpeed;
    b.bearers.length = 0;
    const c = b.cand;
    for (let k = 0; k < c.n; k++) if (c.touched[k] && c.dyn[k] && c.ent[k]?.kind === 'piece' && !b.bearers.includes(c.ent[k] as Piece)) b.bearers.push(c.ent[k] as Piece);
    for (let i = b.p0; i < b.p0 + b.n; i++) V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0;
  }
}

/** gas temperature the bag exchanges heat with: the air round it (fields solver) or its own fabric, °C */
function envTemp(b: SoftBody): number {
  let cx = 0, cy = 0, cz = 0, t = 0, n = 0;
  for (let i = b.p0; i < b.p0 + b.n; i += 4) {
    if (!(pool.fl[i] & ALIVE)) continue;
    cx += pool.x[i * 3]; cy += pool.x[i * 3 + 1]; cz += pool.x[i * 3 + 2]; t += pool.temp[i]; n++;
  }
  if (!n) return 20;
  const air = sampleField([cx / n, cy / n, cz / n], 'T');
  return Math.max(Number.isFinite(air) ? air : 20, t / n);
}

/** One rigid step's worth of soft simulation; call after the rigid step and its structure bookkeeping. */
export function stepSoft(dt: number): void {
  const t0 = performance.now(), c0 = cpuNow();
  windT += dt;
  fireT += dt;
  flapT += dt;
  for (let k = softBodies.length - 1; k >= 0; k--) {
    const b = softBodies[k];
    b.age += dt;
    if (b.pins.length) maintainPins(b);
  }
  maintainTies();
  maintainStacks();
  b3.b3World_GetGravity(_g, world);
  activeList.length = 0;
  let sliced = 0;
  for (const b of softBodies) {
    if (b.dead) continue;
    if (!b.awake) {
      if (AERO_KINDS.has(b.kind) && Math.abs(baseWind(b) - b.sleepWind) > 1.5) wakeSoft(b);
      if (!b.awake && (stepCount + b.id) % 10 === 0 && movingNear(b)) wakeSoft(b);
      // a load taken off it (or knocked) lets it spring back
      if (!b.awake && b.bearers.length && b.bearers.some((p) => p.dead || p.movedStep >= stepCount - 1)) wakeSoft(b);
      // warm air round a gas bag expands it
      if (!b.awake && b.gas && !b.gas.open && (stepCount + b.id) % 30 === 0 && Math.abs(envTemp(b) + 273.15 - b.gas.T) > 2) wakeSoft(b);
      if (!b.awake) continue;
    }
    b.period = periodFor(b);
    if (b.period > 1) { sliced++; if ((stepCount + b.id) % b.period !== 0) continue; }
    activeList.push(b);
  }
  /* Sleeping solid bodies next to active solid ones: a fast one wakes them, otherwise they take part in the
     contacts as static guests (a resting sandbag must still carry the one on top of it); a guest particle that
     gets knocked loose wakes its body for the next step. */
  guests.length = 0;
  for (const a of activeList) {
    if (!(pool.fl[a.p0] & SOLID)) continue;
    for (const s of softBodies) {
      if (s.awake || s.dead || !(pool.fl[s.p0] & SOLID) || !overlaps(a.aabb, s.aabb, 0.2)) continue;
      if (a.vmax >= 0.25) { wakeSoft(s); s.period = 1; activeList.push(s); } else if (!guests.includes(s)) guests.push(s);
    }
  }
  for (const g of guests) {
    if (g.kind === 'granular') continue;
    for (let i = g.p0; i < g.p0 + g.n; i++) if (pool.fl[i] & ALIVE) { pool.fl[i] |= FROZEN; pool.w[i] = 0; }
  }
  // a rope moving against a resting one wakes it: asleep, it would not be there to push back
  for (let k = 0, n = activeList.length; k < n; k++) {
    const a = activeList[k];
    if (a.kind !== 'rope' || a.fabId === 'thread') continue;
    for (const s of softBodies) {
      if (s.awake || s.dead || s.kind !== 'rope' || s.fabId === 'thread' || !overlaps(a.aabb, s.aabb, 0.05)) continue;
      wakeSoft(s); s.period = 1; activeList.push(s);
    }
  }
  softPerf.active = activeList.length;
  softPerf.sliced = sliced;
  groups[0].length = groups[1].length = groups[2].length = 0;
  for (const b of activeList) groups[b.period === 1 ? 0 : b.period === 2 ? 1 : 2].push(b);
  if (groups[0].length) runGroup(groups[0], dt, SUB, dt, true);
  if (groups[1].length) runGroup(groups[1], dt * 2, 3, dt, false);
  if (groups[2].length) runGroup(groups[2], dt * 4, 3, dt, false);
  if (fireT >= FIRE_TICK) { fireT -= FIRE_TICK; fireTick(FIRE_TICK); }
  if (flapT >= 0.5) { flapT = 0; noise(); }
  processRuptures();
  processQueues();
  const ms = performance.now() - t0;
  softPerf.cpu = cpuNow() - c0;
  softPerf.ms = ms;
  softPerf.avg = softPerf.avg * 0.95 + ms * 0.05;
  softPerf.peak = Math.max(softPerf.peak * 0.995, ms);
  softPerf.particles = used;
  softPerf.awake = activeList.length;
}

/** Step one set of bodies that share a step length `dtb` (a multiple of the rigid step dt) and substep count. */
function runGroup(list: SoftBody[], dtb: number, sub: number, dt: number, near: boolean): void {
  const h = dtb / sub, stamp = ++stampN;
  let solids = false, rmax = 0, ropes = false, vmaxAll = 0;
  for (const b of list) {
    b.stamp = stamp;
    const X = pool.x, SX = pool.sx;
    for (let i = b.p0 * 3, e = (b.p0 + b.n) * 3; i < e; i++) SX[i] = X[i];
    bounds(b, 0.1);
    let v2 = 0;
    const V = pool.v;
    for (let i = b.p0 * 3, e = (b.p0 + b.n) * 3; i < e; i += 3) { const q = V[i] * V[i] + V[i + 1] * V[i + 1] + V[i + 2] * V[i + 2]; if (q > v2) v2 = q; }
    b.vmax = Math.sqrt(v2);
    if (b.vmax > vmaxAll) vmaxAll = b.vmax;
    const margin = 0.15 + Math.min(1.5, b.vmax * dtb * 2);
    gather(b.cand, b.aabb, margin);
    pinTargets(b);
    if (AERO_KINDS.has(b.kind)) {
      if ((b.shelterT -= dtb) <= 0) { b.shelterT = 2 + chance(); updateShelter(b); }
      aero(b, dtb);
    }
    if (pool.fl[b.p0] & SOLID) {
      solids = true;
      rmax = Math.max(rmax, pool.r[b.p0] * (1 + (pool.coh[b.p0] || 0)));
    }
    if (b.kind === 'rope' && b.fabId !== 'thread') ropes = true;
    if (b.tethersDirty) { b.tethersDirty = false; computeTethers(b); }
    if (b.gas && b.gas.squeeze && b.eRef) { const s = b.gas.scale; for (let e = 0; e < b.ne; e++) b.el[e] = b.eRef[e] * s; }
  }
  const skin = Math.min(0.3, 0.02 + vmaxAll * dtb * 1.5);
  const nRope = ropes && softOptions.ropeContact ? beginRopes(list, skin) : 0;
  let nSheet = 0;
  if (near && softOptions.selfContact) {
    sheetList.length = 0; beds.length = 0;
    for (const b of list) if (SHEET_KINDS.has(b.kind) && b.selfR > 0) sheetList.push(b);
    if (sheetList.length) {
      for (const g of softBodies) {
        if (g.kind !== 'granular' || g.dead) continue;
        if (sheetList.some((s) => overlaps(s.aabb, g.aabb, 0.2))) beds.push(g);
      }
      nSheet = beginSheets(sheetList, beds, skin, SELF_CAP);
    }
  }
  const anyTie = ties.length > 0;
  for (let s = 0; s < sub; s++) {
    const ta = s / sub, tb = (s + 1) / sub;
    for (const b of list) {
      poseAt(b.cand, ta, tb);
      pinLerp(b, tb);
      integrate(b, h, _g[1], b.kind === 'granular' ? 0.2 : b.kind === 'softbody' ? 1.5 : b.kind === 'carton' ? 0.8 : b.kind === 'balloon' ? 0.05 : b.kind === 'rope' ? 0.8 : 0.3);
      if (b.nst) solveSeams(b, h);
      if (b.kind === 'rope') { solveChain(b, h, _g[1]); solveEdges(b, h, b.n - 1); } else solveEdges(b, h);
      if (b.nb) solveBending(b, h, b.fab.bend);
      solveTethers(b, h);
      if (b.q0) solveShape(b, b.fab.shape ?? 0.05);
      if (b.gas) solveVolume(b, h);
      if (b.eMax) solveLimits(b);
      solvePins(b, h, PIN_ALPHA);
    }
    if (anyTie) solveTies(h, stamp);
    if (solids) {
      if (s === 0) {
        beginSolids();
        for (const b of list) if (pool.fl[b.p0] & SOLID) addSolids(b.p0, b.n);
        for (const g of guests) addSolids(g.p0, g.n);
        refreshSolids(rmax * 2, dtb);
      }
      solveSolids(h);
    }
    for (const b of list) if (b.cn) b.cn.fill(0);
    if (nRope) solveRopes();
    if (nSheet) solveSheets();
    for (const b of list) {
      const cutSpeed = SHEET_KINDS.has(b.kind) ? (b.fabId === 'latex' ? 6 : 9 + b.fab.tensile / 2500) : 1e9;
      collide(b.cand, b.p0, b.n, h, b.fab.friction, cutSpeed, b.goal, b.kc, b.cn, b.skip);
      updateVelocity(b, h, 80);
    }
  }
  if (near) for (const g of guests) {
    if (g.kind === 'granular') continue;
    let hit = false;
    for (let i = g.p0; i < g.p0 + g.n; i++) {
      if (!(pool.fl[i] & ALIVE)) continue;
      if (!(pool.fl[i] & FROZEN)) hit = true;
      pool.fl[i] &= ~FROZEN; pool.w[i] = 1 / pool.m[i];
    }
    if (hit) wakeSoft(g);
  }
  for (const t of ties) {
    if (!t.alive || (t.a.stamp !== stamp && t.b.stamp !== stamp)) continue;
    if (t.f / sub > t.tear) cutTie(t);
    t.f = 0;
  }
  let torn = 0;
  for (const b of list) {
    if (b.dead) continue;
    const c = b.cand;
    if (b.fab.crush) crushCheck(b, dtb);
    for (let k = 0; k < c.n; k++) {
      if (!c.touched[k] || !c.dyn[k] || c.JW[k] <= 0) continue;
      const e = c.ent[k];
      if (!e || e.kind !== 'piece') continue;
      const px = c.JP[k * 3] / c.JW[k], py = c.JP[k * 3 + 1] / c.JW[k], pz = c.JP[k * 3 + 2] / c.JW[k];
      applyImpulse(e as Piece, c.J[k * 3], c.J[k * 3 + 1], c.J[k * 3 + 2], px, py, pz, dt, c.bear[k] === 1);
      if (c.bear[k]) applyFriction(e as Piece, c.JF[k * 3], c.JF[k * 3 + 1], c.JF[k * 3 + 2]);
    }
    for (const pin of b.pins) {
      if (!pin.alive) continue;
      pin.f /= sub;
      if (pin.piece) applyImpulse(pin.piece, pin.J[0], pin.J[1], pin.J[2], pin.t1[0], pin.t1[1], pin.t1[2], dt);
      if (pin.f > pin.tear) {
        dropPin(b, pin);
        torn++;
      }
    }
    if (b.nst) torn += seamCheck(b);
    for (let i = b.p0; i < b.p0 + b.n; i++) if (pool.fl[i] & CUT) { b.cuts++; break; }
    const t = tearCheck(b);
    if (t || torn) tearFx(b, t + torn);
    torn = 0;
    if (b.gas && gasStep(b, dtb, envTemp(b), _g[1], !!b.host && !b.host.dead)) burst(b);
    if (b.bL && creaseCheck(b)) b.shade++;
    if (b.q0 && b.fab.plastic) plasticYield(b, b.fab.plastic, 0.5);
    bounds(b, 0);
    sleepTest(b, windFor(b, _wind), b.period);
  }
}

/** a box loaded past its crush strength by the pieces pressing on it gives way along the load */
function crushCheck(b: SoftBody, dt: number): void {
  const c = b.cand;
  let jx = 0, jy = 0, jz = 0;
  for (let k = 0; k < c.n; k++) if (c.touched[k] && c.dyn[k]) { jx += c.J[k * 3]; jy += c.J[k * 3 + 1]; jz += c.J[k * 3 + 2]; }
  const j = Math.hypot(jx, jy, jz);
  if (j < 1e-6) return;
  const F = j / dt, a = b.aabb;
  // (the box is bounded with a 0.1 m margin at this point in the step)
  const strength = b.fab.crush! * 2 * Math.max(0.1, a[3] - a[0] + a[5] - a[2] - 0.4);
  if (F <= strength) return;
  crushShape(b, jx / j, jy / j, jz / j, Math.min(0.2, (0.4 * (F - strength)) / F));
  b.shade++;
}

function overlaps(a: Float64Array, b: Float64Array, m: number): boolean {
  return a[0] - m <= b[3] && b[0] - m <= a[3] && a[1] - m <= b[4] && b[1] - m <= a[4] && a[2] - m <= b[5] && b[2] - m <= a[5];
}

function movingNear(b: SoftBody): boolean {
  let hit = false;
  const a = b.aabb, m = 0.3;
  overlapAABB([a[0] - m, a[1] - m, a[2] - m], [a[3] + m, a[4] + m, a[5] + m], CAT.structure | CAT.debris | CAT.prop | CAT.projectile, s => {
    if (hit) return;
    const e = entityOfShape(s);
    if (e && e.movedStep >= stepCount - 1 && Math.hypot(e.curPos[0] - e.prevPos[0], e.curPos[1] - e.prevPos[1], e.curPos[2] - e.prevPos[2]) > 0.002) hit = true;
  });
  return hit;
}

function tearFx(b: SoftBody, n: number): void {
  const i = b.p0 + Math.floor(b.n / 2);
  const pos: Vec3 = [pool.x[i * 3], pool.x[i * 3 + 1], pool.x[i * 3 + 2]];
  if (b.kind === 'rope') { if (b.fabId !== 'thread') audio.ropeSnap(pos, b.fabId === 'steelwire' ? 'wire' : 'rope'); }
  else audio.fabricTear(pos, Math.min(1, 0.25 + n * 0.08), b.fabId);
  if (b.fabId !== 'thread') fx.fabricShreds(pos, Math.min(24, 3 + n * 2), b.tint);
}

/* ---------------- blasts, fire ---------------- */

/** Blast wave through soft bodies: shoves particles outward, shreds fabric near the core, flash-heats it, and
    scatters the paper off desks in reach. */
export function softExplosion(pos: Vec3, radius: number, power: number, impulse: number): void {
  const X = pool.x, V = pool.v, FL = pool.fl, W = pool.w, M = pool.m;
  for (let k = softBodies.length - 1; k >= 0; k--) {
    const b = softBodies[k];
    if (b.dead) continue;
    const a = b.aabb;
    const dx = Math.max(a[0] - pos[0], 0, pos[0] - a[3]), dy = Math.max(a[1] - pos[1], 0, pos[1] - a[4]), dz = Math.max(a[2] - pos[2], 0, pos[2] - a[5]);
    if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
    wakeSoft(b);
    b.shelterT = 0;
    const sheet = b.nc > 0 && b.kind !== 'rope';
    const bulk = b.kind === 'granular' || b.kind === 'softbody';
    const shred = sheet ? power / (b.fab.tensile * 4) : 0;
    let hit = 0, rupture = false;
    fraying = true;
    for (let i = b.p0; i < b.p0 + b.n; i++) {
      if (!(FL[i] & ALIVE)) continue;
      const rx = X[i * 3] - pos[0], ry = X[i * 3 + 1] - pos[1], rz = X[i * 3 + 2] - pos[2];
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (d >= radius) continue;
      const f = 1 - d / radius, f2 = f * f;
      if (FL[i] & FROZEN) { FL[i] &= ~FROZEN; W[i] = 1 / M[i]; pool.rest[i] = 0; grainLoosened(); }
      const dv = bulk ? Math.min(35, (impulse * f2) / (b.fab.density * Math.max(0.05, b.resU))) : 70 * f2;
      const inv = d > 1e-4 ? 1 / d : 0;
      V[i * 3] += rx * inv * dv; V[i * 3 + 1] += (ry * inv + 0.35) * dv; V[i * 3 + 2] += rz * inv * dv;
      pool.temp[i] += 700 * f2;
      hit++;
      if (sheet && f2 * shred > 1 && chance() < 0.85) killParticle(b, i);
      if (b.kind === 'softbody' && GRAIN_FABRICS.has(b.fabId) && f2 * power > 25e3) rupture = true;
    }
    fraying = false;
    if (hit && sheet) tearFx(b, Math.min(12, hit >> 2));
    if (rupture) ruptures.add(b);
  }
  for (const s of stacks) {
    const p = stackPos(s);
    const rx = p[0] - pos[0], ry = p[1] - pos[1], rz = p[2] - pos[2], d = Math.hypot(rx, ry, rz);
    if (d >= radius || s.left <= 0) continue;
    const f = 1 - d / radius, v = 3 + 14 * f, inv = 1 / Math.max(d, 0.1);
    release(s, Math.ceil(2 + 10 * f), rx * inv * v, ry * inv * v + 2, rz * inv * v, 1.5 + 2 * f);
  }
}

const ruptures = new Set<SoftBody>();

/* A split sandbag becomes loose grain where it lay, keeping its motion. */
function processRuptures(): void {
  if (!ruptures.size) return;
  for (const b of ruptures) {
    if (b.dead) continue;
    const X = pool.x, V = pool.v;
    const pts: number[] = [], vel: number[] = [];
    for (let i = b.p0; i < b.p0 + b.n; i++) {
      if (!(pool.fl[i] & ALIVE)) continue;
      pts.push(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); vel.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
    }
    const res = b.resU, fabId = b.fabId, host = b.host, tint = b.tint;
    removeSoft(b);
    const g = createGrains(pts, fabId, res, host, true, tint === FABRICS[fabId].tint ? undefined : tint);
    if (!g) continue;
    for (let k = 0; k < g.n; k++) { const i = g.p0 + k; pool.v[i * 3] = vel[k * 3]; pool.v[i * 3 + 1] = vel[k * 3 + 1]; pool.v[i * 3 + 2] = vel[k * 3 + 2]; }
    fx.grainSpill([pts[0], pts[1], pts[2]], [0, 1, 0], 30, g.tint);
    audio.sandHiss([pts[0], pts[1], pts[2]], 1);
  }
  ruptures.clear();
}

/** Loose grain at explicit points (a spill, a poured column); frozen at rest unless `awake`. */
export function createGrains(pts: number[], fabric: FabricId, res: number, host: Piece | null = null, awake = true, tint?: number): SoftBody | null {
  const fabId: FabricId = GRAIN_FABRICS.has(fabric) ? fabric : 'sand';
  const n = Math.min(pts.length / 3, SOFT_BUDGET - used);
  if (n <= 0) return null;
  const b = new SoftBody('granular', fabId, FABRICS[fabId], host, host?.root ?? null, tint);
  buildGrains(b, pts.length === n * 3 ? pts : pts.slice(0, n * 3), res);
  b.resU = res;
  b.kc = (b.fab.bulk ?? 0) * res;
  used += b.n;
  if (!awake) { for (let i = b.p0; i < b.p0 + b.n; i++) { pool.fl[i] |= FROZEN; pool.w[i] = 0; } b.awake = false; }
  bounds(b, 0);
  register(b);
  return b;
}

/** Heat soft bodies in a sphere (firebombs, thermite, flash fires). */
export function softHeat(pos: Vec3, radius: number, temp: number): void {
  for (const b of softBodies) {
    const a = b.aabb;
    if (pos[0] + radius < a[0] || pos[0] - radius > a[3] || pos[1] + radius < a[1] || pos[1] - radius > a[4] || pos[2] + radius < a[2] || pos[2] - radius > a[5]) continue;
    for (let i = b.p0; i < b.p0 + b.n; i++) {
      const d = Math.hypot(pool.x[i * 3] - pos[0], pool.x[i * 3 + 1] - pos[1], pool.x[i * 3 + 2] - pos[2]);
      if (d < radius) pool.temp[i] = Math.max(pool.temp[i], temp * (1 - (0.5 * d) / radius));
    }
    wakeSoft(b);
  }
}

export function softExtinguish(): void {
  for (const b of softBodies) {
    for (let i = b.p0; i < b.p0 + b.n; i++) { pool.fl[i] &= ~BURNING; pool.temp[i] = Math.min(pool.temp[i], 60); }
    b.burning = 0;
    b.shade++;
  }
}

const _src: Piece[] = [];
let HEAT = new Float32Array(256);
function fireTick(tick: number): void {
  const X = pool.x, FL = pool.fl, T = pool.temp, CH = pool.char;
  for (let k = softBodies.length - 1; k >= 0; k--) {
    const b = softBodies[k];
    const f = b.fab;
    if (b.dead || f.ignite === undefined) continue;
    // hot and burning pieces around the body heat it
    _src.length = 0;
    const a = b.aabb, m = 0.6;
    overlapAABB([a[0] - m, a[1] - 1.5, a[2] - m], [a[3] + m, a[4] + m, a[5] + m], CAT.structure | CAT.debris | CAT.prop, s => {
      const e = entityOfShape(s);
      if (!e || e.kind !== 'piece') return;
      const p = e as Piece;
      if (!p.dead && (p.burning || p.temp > 150) && !_src.includes(p)) _src.push(p);
    });
    let hot = false;
    for (const p of _src) {
      const src = p.burning ? 850 : p.temp;
      b3.b3Body_ComputeAABB(_box, p.body);
      for (let i = b.p0; i < b.p0 + b.n; i++) {
        if (!(FL[i] & ALIVE)) continue;
        const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
        if (x < _box[0] - 0.3 || x > _box[3] + 0.3 || z < _box[2] - 0.3 || z > _box[5] + 0.3 || y < _box[1] - 0.2 || y > _box[4] + 0.8) continue;
        // flames lick up to ~0.8 m above a burning member, weakening with height
        const above = Math.max(0, y - _box[4]);
        T[i] += (src - T[i]) * 0.25 * (1 - above / 0.9);
        hot = true;
      }
    }
    if (!hot && b.burning === 0) {
      let warm = false;
      for (let i = b.p0; i < b.p0 + b.n; i++) if (T[i] > 40) { T[i] = 20 + (T[i] - 20) * 0.8; warm = true; }
      if (!warm) continue;
    }
    // flame spread along the cloth: a front moving at `spread` m/s, three times faster upward
    if (b.burning) {
      // each unburnt particle takes the strongest push from a burning neighbour, not the sum of them
      if (HEAT.length < b.n) HEAT = new Float32Array(b.n * 2);
      HEAT.fill(0, 0, b.n);
      for (let e = 0; e < b.ne; e++) {
        if (!b.eAlive[e]) continue;
        const i = b.ei[e * 2], j = b.ei[e * 2 + 1];
        const bi = FL[i] & BURNING, bj = FL[j] & BURNING;
        if (bi === bj) continue;
        const src = bi ? i : j, dst = bi ? j : i;
        const up = X[dst * 3 + 1] - X[src * 3 + 1];
        // front speed: `spread` sideways, 3× up, a third of it down; per edge length
        const v = (f.spread * (up > 0.02 ? 3 : up < -0.02 ? 0.35 : 1)) / b.el[e];
        if (v > HEAT[dst - b.p0]) HEAT[dst - b.p0] = v;
      }
      for (let k = 0; k < b.n; k++) if (HEAT[k] > 0) T[b.p0 + k] += (f.ignite - 20) * HEAT[k] * tick * 1.05;
    }
    let burning = 0, shade = false;
    const flameAt: number[] = [];
    for (let i = b.p0; i < b.p0 + b.n; i++) {
      if (!(FL[i] & ALIVE)) continue;
      if (FL[i] & BURNING) {
        CH[i] = Math.min(1, CH[i] + tick / f.burn);
        shade = true;
        if (CH[i] >= 1) { FL[i] &= ~BURNING; killParticle(b, i); continue; }
        burning++;
        if (flameAt.length < 3 && chance() < 0.3) flameAt.push(i);
      } else if (T[i] >= f.ignite && CH[i] < 1) {
        FL[i] |= BURNING; burning++; shade = true;
      } else if (T[i] > 20) {
        T[i] = 20 + (T[i] - 20) * 0.9;
        if (T[i] > 120) { CH[i] = Math.min(0.6, CH[i] + tick * 0.05); shade = true; }
      }
    }
    b.burning = burning;
    if (shade) b.shade++;
    if (!burning) continue;
    wakeSoft(b);
    for (const i of flameAt) {
      fx.flames([X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], 0.25 + 0.1 * Math.min(4, Math.sqrt(burning) / 3), 1);
      if (chance() < 0.3) audio.burn([X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], Math.min(1, burning / 60));
    }
    // and it heats what it touches
    for (let q = 0; q < b.cand.n; q++) {
      const e = b.cand.ent[q];
      if (!e || e.kind !== 'piece') continue;
      const p = e as Piece;
      if (p.dead || p.burning) continue;
      const bx = b.cand.box, o = q * 6;
      let near = 0;
      for (let i = b.p0; i < b.p0 + b.n && near < 10; i++) {
        if (!(FL[i] & BURNING)) continue;
        const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
        if (x > bx[o] - 0.3 && x < bx[o + 3] + 0.3 && z > bx[o + 2] - 0.3 && z < bx[o + 5] + 0.3 && y > bx[o + 1] - 1 && y < bx[o + 4] + 0.3) near++;
      }
      if (near) heat(p, 22 * near);
    }
  }
}
const _box: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

/* flapping canvas, hissing grain and leaking bags, a couple of times a second for the nearest few */
function noise(): void {
  let flap: SoftBody | null = null, fd = 40 * 40, grain: SoftBody | null = null, gd = 40 * 40, leak: SoftBody | null = null, ld = 30 * 30;
  for (const b of activeList) {
    const c = b.p0 + (b.n >> 1);
    const d = (pool.x[c * 3] - softViewer[0]) ** 2 + (pool.x[c * 3 + 1] - softViewer[1]) ** 2 + (pool.x[c * 3 + 2] - softViewer[2]) ** 2;
    if (AERO_KINDS.has(b.kind) && b.moving > 0.6 && d < fd) { fd = d; flap = b; }
    if (b.kind === 'granular' && b.moving > 8 && d < gd) { gd = d; grain = b; }
    if (b.gas && b.gas.leak > 1e-4 && d < ld) { ld = d; leak = b; }
  }
  if (flap) { const c = flap.p0 + (flap.n >> 1); audio.flap([pool.x[c * 3], pool.x[c * 3 + 1], pool.x[c * 3 + 2]], Math.min(1, flap.moving / 6), flap.fabId); }
  if (grain) { const c = grain.p0 + (grain.n >> 1); audio.sandHiss([pool.x[c * 3], pool.x[c * 3 + 1], pool.x[c * 3 + 2]], Math.min(1, grain.moving / 80)); }
  if (leak) { const c = leak.p0 + (leak.n >> 1); audio.gasHiss([pool.x[c * 3], pool.x[c * 3 + 1], pool.x[c * 3 + 2]], Math.min(1, leak.gas!.leak * 20)); }
}

/* ---------------- gas bags: queries and actions ---------------- */

/** Puncture a gas bag at its particle nearest `pos` with a hole of `area` m² (a slow leak, not a tear). */
export function puncture(b: SoftBody, pos: ArrayLike<number>, area: number): void {
  const g = b.gas;
  if (!g || g.open) return;
  let best = b.p0, bd = Infinity;
  for (let i = b.p0; i < b.p0 + b.n; i++) {
    const d = (pool.x[i * 3] - pos[0]) ** 2 + (pool.x[i * 3 + 1] - pos[1]) ** 2 + (pool.x[i * 3 + 2] - pos[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  g.hole += area;
  g.holeAt = best;
  wakeSoft(b);
}

/** Pump gas in (or let it out): the amount is scaled by `factor`. */
export function inflate(b: SoftBody, factor: number): void {
  if (!b.gas || b.gas.open) return;
  b.gas.n *= factor;
  wakeSoft(b);
}

/* ---------------- queries ---------------- */

export function softStats(): { bodies: number; particles: number; awake: number; burning: number; ms: number; avg: number; sheets: number; threads: number; stacks: number } {
  let burning = 0;
  for (const b of softBodies) burning += b.burning;
  return { bodies: softBodies.length, particles: used, awake: softPerf.awake, burning, ms: softPerf.ms, avg: softPerf.avg, sheets: sheets.length, threads: threads.length, stacks: stacks.length };
}

export type { SoftSpec, Fabric, FabricId, PieceSpec };
