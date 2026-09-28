import { SpatialHash, hashKey } from './hash';
import { pool, ALIVE, FROZEN } from './particles';
import type { SoftBody } from './xpbd';

/* Contacts between soft bodies that are not grain: rope segments as capsules (a rope against itself and against
   other ropes, so wraps, hitches and knots hold by friction), and sheet particles as spheres (cloth on cloth, a
   sheet folding onto itself, balloons against each other, a membrane settling on a grain heap). Candidate pairs are
   gathered once per step with a skin and resolved every substep, Gauss-Seidel, with Coulomb friction on the
   relative slide of the contact points over the substep. A pair that crossed during the substep is pushed back
   to the side it came from (judged from the previous positions). */

const segHash = new SpatialHash();
let segA = new Int32Array(512), segB = new Int32Array(512), segBody = new Int32Array(512), segK = new Int32Array(512);
let segR = new Float32Array(512);
let MID = new Float64Array(1536);
let segIds = new Int32Array(512);
let nseg = 0;
let rpairs = new Int32Array(2048);
let segList: SoftBody[] = [];
let nrp = 0;

function growSeg(n: number): void {
  if (segA.length >= n) return;
  const k = n * 2;
  const g = <T extends Int32Array | Float32Array | Float64Array>(a: T, m: number): T => { const b = new (a.constructor as new (n: number) => T)(k * m); b.set(a); return b; };
  segA = g(segA, 1); segB = g(segB, 1); segBody = g(segBody, 1); segK = g(segK, 1); segR = g(segR, 1); MID = g(MID, 3); segIds = g(segIds, 1);
}

/** Collect the live segments of these ropes and their candidate pairs for this step. */
export function beginRopes(list: SoftBody[], skin: number): number {
  nseg = 0; nrp = 0;
  segList = list;
  const X = pool.x;
  let lmax = 0, rmax = 0;
  for (let bi = 0; bi < list.length; bi++) {
    const b = list[bi];
    if (b.kind !== 'rope' || b.fabId === 'thread') continue;
    growSeg(nseg + b.nc);
    for (let c = 0; c < b.nc; c++) {
      if (!b.cAlive[c]) continue;
      const i = b.c2p[c * 4], j = b.c2p[c * 4 + 1];
      segA[nseg] = i; segB[nseg] = j; segBody[nseg] = bi; segK[nseg] = c; segR[nseg] = pool.r[i];
      MID[nseg * 3] = (X[i * 3] + X[j * 3]) / 2; MID[nseg * 3 + 1] = (X[i * 3 + 1] + X[j * 3 + 1]) / 2; MID[nseg * 3 + 2] = (X[i * 3 + 2] + X[j * 3 + 2]) / 2;
      const l = Math.hypot(X[j * 3] - X[i * 3], X[j * 3 + 1] - X[i * 3 + 1], X[j * 3 + 2] - X[i * 3 + 2]);
      if (l > lmax) lmax = l;
      if (segR[nseg] > rmax) rmax = segR[nseg];
      segIds[nseg] = nseg;
      nseg++;
    }
  }
  if (nseg < 2) return 0;
  const reach = lmax + 2 * rmax + skin;
  segHash.build(segIds, nseg, MID, reach);
  const st = segHash.start, items = segHash.items, inv = segHash.inv;
  for (let s = 0; s < nseg; s++) {
    const cx = Math.floor(MID[s * 3] * inv), cy = Math.floor(MID[s * 3 + 1] * inv), cz = Math.floor(MID[s * 3 + 2] * inv);
    for (let c = 0; c < 27; c++) {
      const hk = hashKey(cx + (c % 3) - 1, cy + ((c / 3) | 0) % 3 - 1, cz + ((c / 9) | 0) - 1);
      for (let q = st[hk], e = st[hk + 1]; q < e; q++) {
        const t = items[q];
        if (t <= s) continue;
        // neighbours along one rope share an end or sit on its bending links
        if (segBody[t] === segBody[s] && Math.abs(segK[t] - segK[s]) <= 2) continue;
        const dx = MID[s * 3] - MID[t * 3], dy = MID[s * 3 + 1] - MID[t * 3 + 1], dz = MID[s * 3 + 2] - MID[t * 3 + 2];
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        if (nrp * 2 + 2 > rpairs.length) { const g = new Int32Array(rpairs.length * 2); g.set(rpairs); rpairs = g; }
        rpairs[nrp * 2] = s; rpairs[nrp * 2 + 1] = t; nrp++;
      }
    }
  }
  return nrp;
}

let _s = 0, _t = 0;
/** closest points between segments p1→q1 and p2→q2 (Ericson), parameters in _s, _t */
function closest(p1x: number, p1y: number, p1z: number, d1x: number, d1y: number, d1z: number,
  p2x: number, p2y: number, p2z: number, d2x: number, d2y: number, d2z: number): void {
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-14 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  _s = s; _t = t;
}

/** One substep of rope-rope capsule contacts. */
export function solveRopes(): number {
  const X = pool.x, PX = pool.px, W = pool.w, MU = pool.mu;
  let hits = 0;
  for (let q = 0; q < nrp; q++) {
    const s = rpairs[q * 2], t = rpairs[q * 2 + 1];
    const i = segA[s], j = segB[s], k = segA[t], l = segB[t];
    const i3 = i * 3, j3 = j * 3, k3 = k * 3, l3 = l * 3;
    closest(X[i3], X[i3 + 1], X[i3 + 2], X[j3] - X[i3], X[j3 + 1] - X[i3 + 1], X[j3 + 2] - X[i3 + 2],
      X[k3], X[k3 + 1], X[k3 + 2], X[l3] - X[k3], X[l3 + 1] - X[k3 + 1], X[l3 + 2] - X[k3 + 2]);
    const a = _s, b = _t;
    const px = X[i3] + (X[j3] - X[i3]) * a, py = X[i3 + 1] + (X[j3 + 1] - X[i3 + 1]) * a, pz = X[i3 + 2] + (X[j3 + 2] - X[i3 + 2]) * a;
    const qx = X[k3] + (X[l3] - X[k3]) * b, qy = X[k3 + 1] + (X[l3 + 1] - X[k3 + 1]) * b, qz = X[k3 + 2] + (X[l3 + 2] - X[k3 + 2]) * b;
    let nx = px - qx, ny = py - qy, nz = pz - qz;
    const rr = segR[s] + segR[t];
    const d2 = nx * nx + ny * ny + nz * nz;
    // quick out: apart now and not crossed since the substep began (the far side is checked cheaply below)
    const ox = PX[i3] + (PX[j3] - PX[i3]) * a - PX[k3] - (PX[l3] - PX[k3]) * b;
    const oy = PX[i3 + 1] + (PX[j3 + 1] - PX[i3 + 1]) * a - PX[k3 + 1] - (PX[l3 + 1] - PX[k3 + 1]) * b;
    const oz = PX[i3 + 2] + (PX[j3 + 2] - PX[i3 + 2]) * a - PX[k3 + 2] - (PX[l3 + 2] - PX[k3 + 2]) * b;
    // passed through each other this substep: close then, close now, on the other side
    const crossed = d2 < rr * rr * 4 && nx * ox + ny * oy + nz * oz < 0 && ox * ox + oy * oy + oz * oz < rr * rr * 9;
    if (d2 >= rr * rr && !crossed) continue;
    let dist: number;
    if (crossed) {
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (ol < 1e-9) continue;
      nx = ox / ol; ny = oy / ol; nz = oz / ol;
      dist = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz;
    } else {
      dist = Math.sqrt(d2);
      if (dist < 1e-9) continue;
      nx /= dist; ny /= dist; nz /= dist;
    }
    const pen = rr - dist;
    if (pen <= 0) continue;
    const wi = W[i] * (1 - a), wj = W[j] * a, wk = W[k] * (1 - b), wl = W[l] * b;
    const den = wi * (1 - a) + wj * a + wk * (1 - b) + wl * b;
    if (den < 1e-12) continue;
    const dl = pen / den;
    X[i3] += nx * wi * dl; X[i3 + 1] += ny * wi * dl; X[i3 + 2] += nz * wi * dl;
    X[j3] += nx * wj * dl; X[j3 + 1] += ny * wj * dl; X[j3 + 2] += nz * wj * dl;
    X[k3] -= nx * wk * dl; X[k3 + 1] -= ny * wk * dl; X[k3 + 2] -= nz * wk * dl;
    X[l3] -= nx * wl * dl; X[l3 + 1] -= ny * wl * dl; X[l3 + 2] -= nz * wl * dl;
    hits++;
    // each rope rests on the other: its chain slides or holds there by friction as on any surface
    const mu0 = Math.sqrt(MU[i] * MU[k]);
    mark(segList[segBody[s]], a < 0.5 ? i : j, nx, ny, nz, mu0);
    mark(segList[segBody[t]], b < 0.5 ? k : l, -nx, -ny, -nz, mu0);
    // friction: relative slide of the two contact points over this substep
    const rx = (X[i3] - PX[i3]) * (1 - a) + (X[j3] - PX[j3]) * a - (X[k3] - PX[k3]) * (1 - b) - (X[l3] - PX[l3]) * b;
    const ry = (X[i3 + 1] - PX[i3 + 1]) * (1 - a) + (X[j3 + 1] - PX[j3 + 1]) * a - (X[k3 + 1] - PX[k3 + 1]) * (1 - b) - (X[l3 + 1] - PX[l3 + 1]) * b;
    const rz = (X[i3 + 2] - PX[i3 + 2]) * (1 - a) + (X[j3 + 2] - PX[j3 + 2]) * a - (X[k3 + 2] - PX[k3 + 2]) * (1 - b) - (X[l3 + 2] - PX[l3 + 2]) * b;
    const rn = rx * nx + ry * ny + rz * nz;
    let tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-12) continue;
    const mu = Math.sqrt(MU[i] * MU[k]), lim = mu * pen;
    if (tl > lim) { const f = lim / tl; tx *= f; ty *= f; tz *= f; }
    const g = 1 / den;
    X[i3] -= tx * wi * g; X[i3 + 1] -= ty * wi * g; X[i3 + 2] -= tz * wi * g;
    X[j3] -= tx * wj * g; X[j3 + 1] -= ty * wj * g; X[j3 + 2] -= tz * wj * g;
    X[k3] += tx * wk * g; X[k3 + 1] += ty * wk * g; X[k3 + 2] += tz * wk * g;
    X[l3] += tx * wl * g; X[l3 + 1] += ty * wl * g; X[l3 + 2] += tz * wl * g;
  }
  return hits;
}

function mark(b: SoftBody, i: number, nx: number, ny: number, nz: number, mu: number): void {
  const cn = b.cn;
  if (!cn) return;
  const q = (i - b.p0) * 4;
  cn[q] = nx; cn[q + 1] = ny; cn[q + 2] = nz; cn[q + 3] = mu;
}

/* ---------------- sheet particles ---------------- */

const ptHash = new SpatialHash();
let pid = new Int32Array(1024), pbody = new Int32Array(1024), plocal = new Int32Array(1024);
let pr = new Float32Array(1024), pex = new Float32Array(1024);
let spairs = new Int32Array(4096);
let nsp = 0, npt = 0;
let restOf: (Float32Array | null)[] = [];

function growPt(n: number): void {
  if (pid.length >= n) return;
  const k = n * 2;
  const g = <T extends Int32Array | Float32Array>(a: T): T => { const b = new (a.constructor as new (n: number) => T)(k); b.set(a); return b; };
  pid = g(pid); pbody = g(pbody); plocal = g(plocal); pr = g(pr); pex = g(pex);
}

/**
 * Collect sheet particles of these bodies (plus the grain of `beds`, as static contact) and their candidate pairs.
 * Within one body, particles closer than a couple of grid steps at rest are never paired (they are neighbours).
 */
export function beginSheets(list: SoftBody[], beds: SoftBody[], skin: number, cap: number): number {
  npt = 0; nsp = 0;
  restOf.length = 0;
  let rmax = 0;
  const FL = pool.fl;
  for (const b of list) {
    if (npt >= cap) break;
    const bi = restOf.length;
    restOf.push(b.rest0);
    growPt(npt + b.n);
    const ex = 2.2 * Math.max(b.resU, b.resV || b.resU);
    for (let k = 0; k < b.n; k++) {
      const i = b.p0 + k;
      if (!(FL[i] & ALIVE)) continue;
      pid[npt] = i; pbody[npt] = bi; plocal[npt] = k; pr[npt] = b.selfR; pex[npt] = ex;
      if (b.selfR > rmax) rmax = b.selfR;
      npt++;
    }
  }
  const nSheet = npt;
  for (const g of beds) {
    growPt(npt + g.n);
    for (let k = 0; k < g.n; k++) {
      const i = g.p0 + k;
      if (!(FL[i] & ALIVE)) continue;
      pid[npt] = i; pbody[npt] = -1; plocal[npt] = k; pr[npt] = pool.r[i]; pex[npt] = 0;
      if (pool.r[i] > rmax) rmax = pool.r[i];
      npt++;
    }
  }
  if (nSheet === 0 || npt < 2) return 0;
  const reach = 2 * rmax + skin;
  ptHash.build(pid, npt, pool.x, reach);
  // hash items are particle ids; map back to list slots
  if (SLOT.length < pool.cap) SLOT = new Int32Array(pool.cap);
  for (let k = 0; k < npt; k++) SLOT[pid[k]] = k;
  const X = pool.x, st = ptHash.start, items = ptHash.items, inv = ptHash.inv;
  for (let a = 0; a < nSheet; a++) {
    const i = pid[a], i3 = i * 3;
    const cx = Math.floor(X[i3] * inv), cy = Math.floor(X[i3 + 1] * inv), cz = Math.floor(X[i3 + 2] * inv);
    for (let c = 0; c < 27; c++) {
      const hk = hashKey(cx + (c % 3) - 1, cy + ((c / 3) | 0) % 3 - 1, cz + ((c / 9) | 0) - 1);
      for (let q = st[hk], e = st[hk + 1]; q < e; q++) {
        const j = items[q];
        const bslot = SLOT[j];
        if (bslot < nSheet && bslot <= a) continue;
        if (pbody[bslot] === pbody[a]) {
          const r = restOf[pbody[a]];
          if (!r) continue;
          const u = plocal[a] * 3, v = plocal[bslot] * 3;
          const ex = pex[a];
          if ((r[u] - r[v]) ** 2 + (r[u + 1] - r[v + 1]) ** 2 + (r[u + 2] - r[v + 2]) ** 2 < ex * ex) continue;
        }
        const j3 = j * 3, lim = pr[a] + pr[bslot] + skin;
        if ((X[i3] - X[j3]) ** 2 + (X[i3 + 1] - X[j3 + 1]) ** 2 + (X[i3 + 2] - X[j3 + 2]) ** 2 > lim * lim) continue;
        if (nsp * 2 + 2 > spairs.length) { const g = new Int32Array(spairs.length * 2); g.set(spairs); spairs = g; }
        spairs[nsp * 2] = a; spairs[nsp * 2 + 1] = bslot; nsp++;
      }
    }
  }
  return nsp;
}

let SLOT = new Int32Array(1024);

/** One substep of sheet point contacts. */
export function solveSheets(): number {
  const X = pool.x, PX = pool.px, W = pool.w, MU = pool.mu, FL = pool.fl;
  let hits = 0;
  for (let q = 0; q < nsp; q++) {
    const a = spairs[q * 2], b = spairs[q * 2 + 1];
    const i = pid[a], j = pid[b];
    const wi = W[i], wj = FL[j] & FROZEN ? 0 : W[j], ws = wi + wj;
    if (ws === 0) continue;
    const i3 = i * 3, j3 = j * 3;
    let nx = X[i3] - X[j3], ny = X[i3 + 1] - X[j3 + 1], nz = X[i3 + 2] - X[j3 + 2];
    const ox = PX[i3] - PX[j3], oy = PX[i3 + 1] - PX[j3 + 1], oz = PX[i3 + 2] - PX[j3 + 2];
    const rr = pr[a] + pr[b];
    const d2 = nx * nx + ny * ny + nz * nz;
    const crossed = d2 < rr * rr * 4 && nx * ox + ny * oy + nz * oz < 0 && ox * ox + oy * oy + oz * oz < rr * rr * 4;
    if (d2 >= rr * rr && !crossed) continue;
    let dist: number;
    if (crossed) {
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (ol < 1e-9) continue;
      const tx = nx, ty = ny, tz = nz;
      nx = ox / ol; ny = oy / ol; nz = oz / ol;
      dist = tx * nx + ty * ny + tz * nz;
    } else {
      dist = Math.sqrt(d2);
      if (dist < 1e-9) continue;
      nx /= dist; ny /= dist; nz /= dist;
    }
    const pen = rr - dist;
    if (pen <= 0) continue;
    const si = wi / ws, sj = wj / ws;
    X[i3] += nx * pen * si; X[i3 + 1] += ny * pen * si; X[i3 + 2] += nz * pen * si;
    X[j3] -= nx * pen * sj; X[j3 + 1] -= ny * pen * sj; X[j3 + 2] -= nz * pen * sj;
    // overlap the pair did not close this substep (they started in each other) separates without speed
    const into = ((PX[i3] - PX[j3]) - (X[i3] - X[j3] - nx * pen)) * nx + ((PX[i3 + 1] - PX[j3 + 1]) - (X[i3 + 1] - X[j3 + 1] - ny * pen)) * ny + ((PX[i3 + 2] - PX[j3 + 2]) - (X[i3 + 2] - X[j3 + 2] - nz * pen)) * nz;
    const over = pen - Math.max(0, into);
    if (over > 0) {
      PX[i3] += nx * over * si; PX[i3 + 1] += ny * over * si; PX[i3 + 2] += nz * over * si;
      PX[j3] -= nx * over * sj; PX[j3 + 1] -= ny * over * sj; PX[j3 + 2] -= nz * over * sj;
    }
    hits++;
    const rx = X[i3] - PX[i3] - (X[j3] - PX[j3]), ry = X[i3 + 1] - PX[i3 + 1] - (X[j3 + 1] - PX[j3 + 1]), rz = X[i3 + 2] - PX[i3 + 2] - (X[j3 + 2] - PX[j3 + 2]);
    const rn = rx * nx + ry * ny + rz * nz;
    let tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-12) continue;
    const lim = 0.5 * (MU[i] + MU[j]) * pen;
    if (tl > lim) { const f = lim / tl; tx *= f; ty *= f; tz *= f; }
    X[i3] -= tx * si; X[i3 + 1] -= ty * si; X[i3 + 2] -= tz * si;
    X[j3] += tx * sj; X[j3 + 1] += ty * sj; X[j3 + 2] += tz * sj;
  }
  return hits;
}

export function contactStats(): { segs: number; ropePairs: number; sheetPts: number; sheetPairs: number } {
  return { segs: nseg, ropePairs: nrp, sheetPts: npt, sheetPairs: nsp };
}
