import { hashKey, SpatialHash } from './hash';
import { pool, ALIVE, FROZEN } from './particles';

/* Contacts between solid particles (grains, softbody lattices — which also keeps a lattice from folding
   through itself — within and across bodies): position-level push-out
   with Coulomb friction on the substep's relative slide (points do not roll, so friction alone sets the
   angle of repose) and a short-range cohesion for damp soil. Frozen particles are static until pushed. */

export const hash = new SpatialHash();
let ids = new Int32Array(1024);
let count = 0;
/** candidate pairs within reach + skin, reused across substeps and steps until particles move half the skin */
let pairs = new Int32Array(4096);
let npairs = 0;

export function beginSolids(): void { count = 0; }
export function addSolids(p0: number, n: number): void {
  if (count + n > ids.length) { const g = new Int32Array((count + n) * 2); g.set(ids); ids = g; }
  const FL = pool.fl;
  for (let i = p0; i < p0 + n; i++) if (FL[i] & ALIVE) ids[count++] = i;
}
export function solidCount(): number { return count; }

let BX = new Float64Array(3 * 1024);
let SK = new Float32Array(1024);
let builtSig = -1, builtCount = -1;
/** a jammed grain was knocked loose: its jammed neighbours are not in the pair list, so rebuild */
let loosened = false;
export function grainLoosened(): void { loosened = true; }

/**
 * Pair list for this step. Each grain gets its own skin, from how far it can travel this step (`dt`), so a
 * slumping face does not inflate the list for the whole heap (jammed pairs stay: a grain woken mid-step must still
 * find its bed). The list is kept while no grain can reach past half its skin this step and none was knocked loose.
 */
export function refreshSolids(reach: number, dt: number): void {
  let sig = 0;
  for (let k = 0; k < count; k++) sig = (sig * 31 + ids[k]) | 0;
  const X = pool.x, V = pool.v, FL = pool.fl, R = pool.r;
  if (sig === builtSig && count === builtCount && !loosened) {
    let ok = true;
    for (let k = 0; k < count && ok; k++) {
      const i = ids[k];
      if (FL[i] & FROZEN) continue;
      // what it has moved since, plus what it may move this step, must stay inside half its skin
      const dx = X[i * 3] - BX[k * 3], dy = X[i * 3 + 1] - BX[k * 3 + 1], dz = X[i * 3 + 2] - BX[k * 3 + 2];
      const go = (Math.hypot(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]) + 9.81 * dt) * dt * 1.2;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) + go > SK[k] * 0.5) ok = false;
    }
    if (ok) return;
  }
  loosened = false;
  builtSig = sig; builtCount = count;
  if (BX.length < count * 3) { BX = new Float64Array(count * 6); SK = new Float32Array(count * 2); }
  let smax = 0;
  for (let k = 0; k < count; k++) {
    const i = ids[k];
    BX[k * 3] = X[i * 3]; BX[k * 3 + 1] = X[i * 3 + 1]; BX[k * 3 + 2] = X[i * 3 + 2];
    const v = Math.hypot(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
    SK[k] = FL[i] & FROZEN ? 0.05 * R[i] : Math.min(0.5, 0.5 * R[i] + (v + 9.81 * dt) * dt * 2);
    if (SK[k] > smax) smax = SK[k];
  }
  buildSolids(reach, smax);
}

export function resetSolids(): void { builtSig = -1; builtCount = -1; npairs = 0; loosened = false; }

/** reach: largest contact (incl. cohesion) distance; smax: the largest grain skin */
function buildSolids(reach: number, smax: number): void {
  const cell = reach + 2 * smax;
  hash.build(ids, count, pool.x, cell);
  const X = pool.x, FL = pool.fl, R = pool.r, CO = pool.coh;
  const st = hash.start, items = hash.items, inv = hash.inv;
  if (SLOT.length < pool.cap) SLOT = new Int32Array(pool.cap);
  for (let k = 0; k < count; k++) SLOT[ids[k]] = k;
  npairs = 0;
  for (let k = 0; k < count; k++) {
    const i = ids[k];
    const i3 = i * 3;
    const cx = Math.floor(X[i3] * inv), cy = Math.floor(X[i3 + 1] * inv), cz = Math.floor(X[i3 + 2] * inv);
    for (let c = 0; c < 27; c++) {
      const hk = hashKey(cx + (c % 3) - 1, cy + ((c / 3) | 0) % 3 - 1, cz + ((c / 9) | 0) - 1);
      for (let s = st[hk], e = st[hk + 1]; s < e; s++) {
        const j = items[s];
        if (j <= i) continue;
        const j3 = j * 3;
        const dx = X[i3] - X[j3], dy = X[i3 + 1] - X[j3 + 1], dz = X[i3 + 2] - X[j3 + 2];
        const lim = (R[i] + R[j]) * (1 + Math.max(CO[i], CO[j])) + SK[k] + SK[SLOT[j]];
        if (dx * dx + dy * dy + dz * dz >= lim * lim) continue;
        if (npairs * 2 + 2 > pairs.length) { const g = new Int32Array(pairs.length * 2); g.set(pairs); pairs = g; }
        pairs[npairs * 2] = i; pairs[npairs * 2 + 1] = j; npairs++;
      }
    }
  }
}
let SLOT = new Int32Array(1024);

const UNFREEZE = 0.45;
let DX = new Float64Array(3 * 1024);
let NC = new Float32Array(1024);
let DF = new Float64Array(3 * 1024);
let FM = new Float64Array(1024);
let NP = new Float32Array(1024);

/* Jacobi with constraint averaging (Macklin et al. 2014): push-outs gathered from one snapshot and divided
   by each particle's contact count (Gauss-Seidel friction in dense piles let one contact's push masquerade
   as another's slip and the heap boiled). Friction is summed instead, capped at the largest single
   contact's correction: averaged, it only cancelled a share of the slip and piles crept flat. */
export function solveSolids(h: number, relax = 1): number {
  const X = pool.x, PX = pool.px, W = pool.w, M = pool.m, R = pool.r, FL = pool.fl, MU = pool.mu, CO = pool.coh;
  if (NC.length < pool.cap) { DX = new Float64Array(pool.cap * 3); NC = new Float32Array(pool.cap); DF = new Float64Array(pool.cap * 3); FM = new Float64Array(pool.cap); NP = new Float32Array(pool.cap); }
  for (let k = 0; k < count; k++) { const i = ids[k]; DX[i * 3] = DX[i * 3 + 1] = DX[i * 3 + 2] = 0; DF[i * 3] = DF[i * 3 + 1] = DF[i * 3 + 2] = 0; NC[i] = 0; FM[i] = 0; NP[i] = 0; }
  let touching = 0;
  for (let q = 0; q < npairs; q++) {
    let i = pairs[q * 2], j = pairs[q * 2 + 1];
    // keep the frozen one (if any) as j
    if (FL[i] & FROZEN) { const t = i; i = j; j = t; }
    if (FL[i] & FROZEN) continue;
    const i3 = i * 3, j3 = j * 3;
    const frozenJ = FL[j] & FROZEN;
    const dx = X[i3] - X[j3], dy = X[i3 + 1] - X[j3 + 1], dz = X[i3 + 2] - X[j3 + 2];
    const rr = R[i] + R[j];
    const coh = Math.max(CO[i], CO[j]);
    const reach = rr * (1 + coh);
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= reach * reach || d2 < 1e-14) continue;
    const d = Math.sqrt(d2);
    let pen = rr - d;
    if (pen < 0) pen *= 0.15; // cohesion: a weak pull back toward contact
    else if (frozenJ) {
      // only a real blow wakes a jammed grain: resting weight on it must not (Jacobi contacts are a little soft)
      const hit = -((X[i3] - PX[i3]) * dx + (X[i3 + 1] - PX[i3 + 1]) * dy + (X[i3 + 2] - PX[i3 + 2]) * dz) / d;
      if (pen > UNFREEZE * R[j] || hit > 0.6 * h) { FL[j] &= ~FROZEN; W[j] = 1 / M[j]; pool.rest[j] = 0; loosened = true; }
    }
    const wi = W[i], wj = W[j], ws = wi + wj;
    if (ws === 0) continue;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    const si = wi / ws, sj = wj / ws;
    DX[i3] += nx * pen * si; DX[i3 + 1] += ny * pen * si; DX[i3 + 2] += nz * pen * si; NC[i]++;
    DX[j3] -= nx * pen * sj; DX[j3 + 1] -= ny * pen * sj; DX[j3 + 2] -= nz * pen * sj; NC[j]++;
    touching++;
    if (pen <= 0) continue;
    NP[i]++; NP[j]++;
    // slip of i over j this substep
    const rx = X[i3] - PX[i3] - (X[j3] - PX[j3]), ry = X[i3 + 1] - PX[i3 + 1] - (X[j3 + 1] - PX[j3 + 1]), rz = X[i3 + 2] - PX[i3 + 2] - (X[j3 + 2] - PX[j3 + 2]);
    const rn = rx * nx + ry * ny + rz * nz;
    const tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-12) continue;
    const lim = 0.5 * (MU[i] + MU[j]) * pen;
    const kf = tl <= lim ? 1 : lim / tl;
    const fi = kf * si, fj = kf * sj;
    DF[i3] -= tx * fi; DF[i3 + 1] -= ty * fi; DF[i3 + 2] -= tz * fi;
    DF[j3] += tx * fj; DF[j3 + 1] += ty * fj; DF[j3 + 2] += tz * fj;
    const mi = tl * fi, mj = tl * fj;
    if (mi > FM[i]) FM[i] = mi;
    if (mj > FM[j]) FM[j] = mj;
  }
  for (let k = 0; k < count; k++) {
    const i = ids[k], n = NC[i];
    if (n === 0 || W[i] === 0) continue;
    const s = relax / n;
    const dx = DX[i * 3] * s, dy = DX[i * 3 + 1] * s, dz = DX[i * 3 + 2] * s;
    X[i * 3] += dx; X[i * 3 + 1] += dy; X[i * 3 + 2] += dz;
    // a deep overlap (spawned inside, rammed in by a piece) separates without firing the grain off
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz), cap = R[i] * 0.25;
    if (dl > cap) { const e = 1 - cap / dl; PX[i * 3] += dx * e; PX[i * 3 + 1] += dy * e; PX[i * 3 + 2] += dz * e; }
    const fl = Math.sqrt(DF[i * 3] ** 2 + DF[i * 3 + 1] ** 2 + DF[i * 3 + 2] ** 2);
    if (fl < 1e-14) continue;
    // a sphere perched on one or two neighbours rolls off; points cannot roll, so they get less grip there
    const f = Math.min(1, FM[i] / fl) * (NP[i] > 1 ? 1 : 0.5);
    X[i * 3] += DF[i * 3] * f; X[i * 3 + 1] += DF[i * 3 + 1] * f; X[i * 3 + 2] += DF[i * 3 + 2] * f;
  }
  return touching;
}
