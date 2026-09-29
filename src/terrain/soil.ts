import { SOILS, SURFACES, type SoilId, type SoilProfile } from './spec.ts';
import { fieldHeight, naturalAt, undulation, type TerrainData } from './raster.ts';

export { SOILS, type SoilId };

/* Soil in and on the heightfield. Every sample carries a column: the intact ground (strata laid down from the
   natural surface, the datum, to bedrock) up to `ti`, and on it a layer of loose soil (spoil, ejecta, slumped
   material: thickness `L`, mass `lm`, dominant kind `lt`). The heightfield is ti + L.

     loose soil   runs: wherever it stands steeper than its angle of repose over a neighbour it spills toward it
                  (8 neighbours, flux in proportion to the excess, half the excess at most per step: a stable,
                  exactly mass-conserving relaxation)
     intact soil  stands on its strength: at a steep face (≥ ~24° over its toe) the Rankine active thrust down the
                  face, P(z) = ∫ (σv·Ka − 2c·√Ka) dz through the layers (with the surcharge of what is founded on or
                  heaped at the crest), decides it; where P > 0 a wedge fails on the Culmann plane at (β + φ)/2
                  from the depth of greatest thrust, and the soil above it becomes loose (bulking by its swell) and
                  runs. A clay face stands on its undrained strength c_u first and softens toward its drained
                  strength (c′, φ′) the longer it stands (and when shaken); damp sand stands briefly on suction;
                  dry sand and gravel stand on nothing
     particles    clods in flight (tipped from a bucket, thrown out of a crater) fall ballistically and are laid
                  back into the heightfield where they land
     ceilings     the ground never rises into what lies on it: a body resting on the soil caps the samples under it
                  (`cap`, set by the terrain from the physics). Loose soil that would stand above a cap (a slip's
                  bulking, a rim, a dent's heave, spoil running in) is held under the body (`hold`: the voids and the
                  edges of what lies there) and laid again, and runs, when the cap lifts

   Work is confined to an active list (cells changed and their neighbours, and faces still standing) processed
   first-in first-out under a fixed budget of cell visits per step, in the same order every run: deterministic,
   independent of frame rate or machine speed.

   Soil properties (moist, typical of UK urban ground; round figures):
     density and swell: Caterpillar Performance Handbook, 'Weights of materials' (bank vs loose kg/m³); angle of
     repose: Al-Hashemi & Al-Amoudi, Powder Technology 330 (2018), review of granular repose angles; strength:
     Craig's Soil Mechanics (8th ed.) / Das, Principles of Geotechnical Engineering: firm clay c_u 40-75 kPa,
     c′ 5-10 kPa, φ′ 20-25° (London Clay); medium-dense sand φ′ 32-36°; sandy gravel φ′ 36-42°; made ground
     c′ ≈ 0-5, φ′ 28-32°; critical height of an unsupported cut Hc = 4c/(γ√Ka) (Rankine; Terzaghi 1943);
     ultimate bearing q ≈ 9·c_u for clay (Skempton 1951), 0.3-1 MPa for granular soils. */

export interface SoilProps {
  /** in-situ (bank) bulk density at its natural moisture, kg/m³ */
  rho: number;
  /** bulking when dug: loose volume = bank volume × (1 + swell) */
  swell: number;
  /** angle of repose of the loose material, degrees */
  repose: number;
  /** drained friction angle φ′ of the intact soil, degrees */
  phi: number;
  /** short-term (undrained, or suction) cohesion, kPa */
  cu: number;
  /** long-term drained cohesion c′, kPa */
  c: number;
  /** seconds for a standing face to soften from cu toward c′ (game time: days of pore-pressure change, compressed) */
  tau: number;
  /** cohesive: stands at φ = 0 on c_u in the short term (clay) */
  undrained: boolean;
  /** resistance to an impact driving into it, kPa (ultimate bearing) */
  qu: number;
  /** natural moisture content (fraction of dry mass) */
  w: number;
  /** colour, sRGB */
  color: number;
}

export const SOIL: Record<SoilId, SoilProps> = {
  topsoil: { rho: 1450, swell: 0.43, repose: 35, phi: 28, cu: 12, c: 2, tau: 20, undrained: false, qu: 250, w: 0.22, color: 0x4d3828 },
  clay: { rho: 1950, swell: 0.25, repose: 40, phi: 23, cu: 50, c: 7, tau: 45, undrained: true, qu: 450, w: 0.28, color: 0x9a6a3e },
  sand: { rho: 1800, swell: 0.12, repose: 33, phi: 34, cu: 3, c: 0, tau: 10, undrained: false, qu: 600, w: 0.08, color: 0xcdb07a },
  gravel: { rho: 1950, swell: 0.12, repose: 38, phi: 38, cu: 0, c: 0, tau: 1, undrained: false, qu: 1000, w: 0.05, color: 0x958b7a },
  fill: { rho: 1800, swell: 0.3, repose: 37, phi: 30, cu: 8, c: 1, tau: 12, undrained: false, qu: 400, w: 0.12, color: 0x5f5852 },
  rock: { rho: 2300, swell: 0.5, repose: 40, phi: 40, cu: 800, c: 300, tau: 1e9, undrained: false, qu: 5000, w: 0.05, color: 0x9a968e },
};

/** made ground over London Clay on terrace gravel: the default under a city site */
export const URBAN_SOIL: SoilProfile = {
  layers: [
    { soil: 'topsoil', thick: 0.3, vary: 0.3 },
    { soil: 'fill', thick: 1.1, vary: 0.5 },
    { soil: 'sand', thick: 0.6, vary: 1.4 },
    { soil: 'clay', thick: 5, vary: 0.3 },
    { soil: 'gravel', thick: 3.5, vary: 0.4 },
    { soil: 'rock', thick: Infinity },
  ],
};

const G = 9.81, DEG = Math.PI / 180;
const NS = SOILS.length;
const P = SOILS.map((s) => SOIL[s]);
const TAN_REPOSE = P.map((p) => Math.tan(p.repose * DEG));
/** loose (bulked) density of each kind */
export const RHO_LOOSE = P.map((p) => p.rho / (1 + p.swell));
const FILL = SOILS.indexOf('fill'), TOPSOIL = SOILS.indexOf('topsoil');
const BOUND = new Set(['asphalt', 'concrete', 'paving', 'setts'].map((s) => SURFACES.indexOf(s as never)));
/** datum for column masses, m */
const DATUM = -80;
/** share of the excess over repose moved per step (≤ 0.5 is stable) */
const RELAX = 0.35;
/** steps between re-checks of a standing face */
const CHECK = 12;
/** cell visits per step */
export const BUDGET = 4000;
const DT = 1 / 60;
const NONE = 0, CHANGED = 1, KEEP = 2;

export interface Particles { x: Float64Array; y: Float64Array; z: Float64Array; vx: Float64Array; vy: Float64Array; vz: Float64Array; m: Float64Array; t: Uint8Array; n: number }

export interface SoilState {
  n: number; cell: number; half: number;
  /** layers and their kinds; `base` holds each layer's base depth below the datum, (nl − 1) per sample */
  nl: number; types: Uint8Array; base: Float32Array;
  /** the datum: natural ground, the level the strata are measured down from */
  ref: Float32Array;
  /** the ground as built */
  hb: Float32Array;
  /** top of the intact ground */
  ti: Float64Array;
  /** loose soil on it: thickness (m), mass (kg/m²), dominant kind */
  L: Float64Array; lm: Float64Array; lt: Uint8Array;
  /** surcharge on the ground from what is founded on it, kPa */
  q: Float32Array;
  /** highest the ground may stand at each sample (the underside of what rests on it; Infinity: nothing) */
  cap: Float32Array;
  /** loose soil held under a cap, kg/m², and its dominant kind; the samples holding any */
  hold: Float64Array; ht: Uint8Array; holds: Set<number>;
  /** seconds a steep face has stood (softening its strength) */
  soft: Float32Array;
  /** step of a face's last check, and whether it was standing then */
  chk: Int32Array; stand: Uint8Array;
  /** local strength factor */
  vary: Float32Array;
  /** active cells: a FIFO ring, each cell at most once */
  ring: Int32Array; head: number; count: number; flag: Uint8Array;
  step: number;
  /** cells changed since last taken: i0, i1, j0, j1 (i0 > i1: none) */
  box: [number, number, number, number];
  parts: Particles;
  /** failures since last taken: cell, mass (kg) */
  events: number[];
  stats: { visits: number; moved: number; fails: number; dents: number; held: number };
  rng: number;
}

const OFF_I = [1, -1, 0, 0, 1, -1, 1, -1], OFF_J = [0, 0, 1, -1, 1, 1, -1, -1];

/* ---------------- set-up ---------------- */

export function initSoil(d: TerrainData, profile: SoilProfile = d.spec.soil ?? URBAN_SOIL): SoilState {
  const n = d.n, N = n * n, spec = d.spec;
  const layers = profile.layers.slice(0, 6);
  const nl = layers.length, nb = nl - 1;
  const types = new Uint8Array(layers.map((l) => SOILS.indexOf(l.soil)));
  const base = new Float32Array(N * Math.max(1, nb)), ref = new Float32Array(N), vary = new Float32Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = i + n * j, x = -d.half + i * d.cell, z = -d.half + j * d.cell;
    ref[k] = Math.max(d.h[k], naturalAt(spec, x, z));
    // topsoil is stripped under sealed and engineered ground
    const sealed = BOUND.has(d.mat[k]) || d.eng[k] === 1;
    let depth = 0;
    for (let l = 0; l < nb; l++) {
      const L0 = layers[l];
      let t = L0.thick * (1 + (L0.vary ?? 0) * undulation(spec.seed + 101 + 17 * l, x, z, 13));
      if (types[l] === TOPSOIL && sealed) t = 0;
      depth += Math.max(0, t);
      base[k * nb + l] = depth;
    }
    vary[k] = 0.8 + 0.4 * hash(spec.seed, i, j);
  }
  const cap = 1024;
  const s: SoilState = {
    n, cell: d.cell, half: d.half, nl, types, base, ref, hb: new Float32Array(d.h), ti: Float64Array.from(d.h),
    L: new Float64Array(N), lm: new Float64Array(N), lt: new Uint8Array(N), q: new Float32Array(N),
    cap: new Float32Array(N).fill(Infinity), hold: new Float64Array(N), ht: new Uint8Array(N), holds: new Set(), soft: new Float32Array(N),
    chk: new Int32Array(N).fill(-1e9), stand: new Uint8Array(N), vary,
    ring: new Int32Array(N), head: 0, count: 0, flag: new Uint8Array(N), step: 0, box: [1, 0, 1, 0],
    parts: { x: new Float64Array(cap), y: new Float64Array(cap), z: new Float64Array(cap), vx: new Float64Array(cap), vy: new Float64Array(cap), vz: new Float64Array(cap), m: new Float64Array(cap), t: new Uint8Array(cap), n: 0 },
    events: [], stats: { visits: 0, moved: 0, fails: 0, dents: 0, held: 0 }, rng: (spec.seed * 2654435761) >>> 0 || 1,
  };
  return s;
}

function hash(seed: number, x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function rand(s: SoilState): number {
  let x = s.rng;
  x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  s.rng = x || 1;
  return x / 4294967296;
}

/* ---------------- columns ---------------- */

/** kind of the stratum at `dep` m below the datum of sample k (made ground above it) */
export function soilAt(s: SoilState, k: number, dep: number): number {
  if (dep < 0) return FILL;
  const nb = s.nl - 1;
  for (let l = 0; l < nb; l++) if (dep < s.base[k * nb + l]) return s.types[l];
  return s.types[s.nl - 1];
}

/** Mass per m² of intact ground in sample k's column between levels y0 < y1, added by kind into `acc`. */
function column(s: SoilState, k: number, y0: number, y1: number, acc: Float64Array | null): number {
  if (y1 <= y0) return 0;
  let m = 0;
  const r = s.ref[k];
  if (y1 > r) {
    const a = Math.max(y0, r), dm = (y1 - a) * P[FILL].rho;
    m += dm; if (acc) acc[FILL] += dm;
    if (y0 >= r) return m;
    y1 = r;
  }
  let top = r - y1;
  const bot = r - y0, nb = s.nl - 1;
  for (let l = 0; l < s.nl && top < bot; l++) {
    const b = l < nb ? s.base[k * nb + l] : Infinity;
    if (b <= top) continue;
    const e = Math.min(b, bot), t = s.types[l], dm = (e - top) * P[t].rho;
    m += dm; if (acc) acc[t] += dm;
    top = e;
  }
  return m;
}

function dominant(acc: Float64Array): number {
  let best = 0;
  for (let t = 1; t < NS; t++) if (acc[t] > acc[best]) best = t;
  return best;
}

/** loose (bucket) volume of a mass tally */
export function looseVolume(acc: Float64Array): number {
  let v = 0;
  for (let t = 0; t < NS; t++) v += acc[t] / RHO_LOOSE[t];
  return v;
}

function mark(s: SoilState, k: number): void {
  const i = k % s.n, j = (k - i) / s.n, b = s.box;
  if (b[0] > b[1]) { b[0] = b[1] = i; b[2] = b[3] = j; return; }
  if (i < b[0]) b[0] = i; if (i > b[1]) b[1] = i;
  if (j < b[2]) b[2] = j; if (j > b[3]) b[3] = j;
}

/** the heightfield from the column, and what changed */
function put(d: TerrainData, s: SoilState, k: number): void {
  d.h[k] = s.ti[k] + s.L[k];
  mark(s, k);
}

/** Something else moved the ground (a piece freed from it, a slab broken out): the intact top follows. */
function sync(d: TerrainData, s: SoilState, k: number): void {
  if (Math.abs(d.h[k] - (s.ti[k] + s.L[k])) > 1e-3) {
    if (d.h[k] < s.ti[k]) { s.ti[k] = d.h[k]; s.L[k] = 0; s.lm[k] = 0; }
    else s.ti[k] = d.h[k] - s.L[k];
  }
}

export function activate(s: SoilState, k: number): void {
  if (s.flag[k]) return;
  s.flag[k] = 1;
  s.ring[(s.head + s.count) % s.ring.length] = k;
  s.count++;
}

function around(s: SoilState, k: number, force = false): void {
  const n = s.n, i = k % n;
  for (let q = -1; q < 8; q++) {
    const m = q < 0 ? k : k + OFF_I[q] + n * OFF_J[q];
    if (q >= 0 && (i + OFF_I[q] < 0 || i + OFF_I[q] >= n || m < 0 || m >= n * n)) continue;
    if (force) s.chk[m] = -1e9;
    activate(s, m);
  }
}

const inner = (s: SoilState, i: number, j: number) => i >= 1 && j >= 1 && i <= s.n - 2 && j <= s.n - 2;

/** Take `dz` m off the top of sample k (loose soil first); the mass taken, by kind, into `acc`. */
function take(d: TerrainData, s: SoilState, k: number, dz: number, acc: Float64Array): number {
  if (!(dz > 0)) return 0;
  sync(d, s, k);
  let m = 0;
  const a = Math.min(dz, s.L[k]);
  if (a > 0) {
    const dm = (a * s.lm[k]) / s.L[k];
    acc[s.lt[k]] += dm; m += dm;
    s.L[k] -= a; s.lm[k] -= dm;
    if (s.L[k] < 1e-9) { s.L[k] = 0; s.lm[k] = 0; }
  }
  const r = dz - a;
  if (r > 0) { m += column(s, k, s.ti[k] - r, s.ti[k], acc); s.ti[k] -= r; }
  put(d, s, k);
  return m;
}

/** Lay `mass` kg/m² of loose soil of kind t on sample k; what would stand above its cap is held under it. */
function lay(d: TerrainData, s: SoilState, k: number, mass: number, t: number): void {
  if (!(mass > 0)) return;
  sync(d, s, k);
  const fit = Math.max(0, s.cap[k] - s.ti[k] - s.L[k]) * RHO_LOOSE[t];
  if (fit < mass) {
    const over = mass - fit;
    if (over > s.hold[k]) s.ht[k] = t;
    s.hold[k] += over;
    s.holds.add(k);
    s.stats.held += over * s.cell * s.cell;
    mass = fit;
  }
  if (mass > 0) {
    s.L[k] += mass / RHO_LOOSE[t];
    if (mass > s.lm[k]) s.lt[k] = t;
    s.lm[k] += mass;
    put(d, s, k);
  }
  around(s, k);
}

/** Held soil laid again as far as its cap now allows. */
function release(d: TerrainData, s: SoilState, k: number): boolean {
  const t = s.ht[k], m = Math.min(s.hold[k], Math.max(0, s.cap[k] - s.ti[k] - s.L[k]) * RHO_LOOSE[t]);
  if (m < 1e-6) return false;
  s.hold[k] -= m;
  if (s.hold[k] < 1e-9) { s.L[k] += s.hold[k] / RHO_LOOSE[t]; s.lm[k] += s.hold[k]; s.hold[k] = 0; s.holds.delete(k); }
  s.L[k] += m / RHO_LOOSE[t];
  if (m > s.lm[k]) s.lt[k] = t;
  s.lm[k] += m;
  put(d, s, k);
  return true;
}

/* ---------------- relaxation ---------------- */

const ex = new Float64Array(8);

/** Loose soil at k steeper than its repose over a neighbour spills toward it. */
function flow(d: TerrainData, s: SoilState, k: number): boolean {
  const n = s.n, t = s.lt[k], tn = TAN_REPOSE[t], hk = s.ti[k] + s.L[k];
  let tot = 0, mx = 0;
  for (let q = 0; q < 8; q++) {
    const m = k + OFF_I[q] + n * OFF_J[q], mi = m % n, mj = (m - mi) / n;
    ex[q] = 0;
    if (!inner(s, mi, mj) || d.hole[m]) continue;
    const e = hk - (s.ti[m] + s.L[m]) - tn * s.cell * (q < 4 ? 1 : Math.SQRT2);
    // nothing runs in under what lies on the ground
    if (e > 1e-4 && s.cap[m] - (s.ti[m] + s.L[m]) > 1e-4) { ex[q] = e; tot += e; if (e > mx) mx = e; }
  }
  if (mx <= 0) return false;
  const a0 = Math.min(s.L[k], 0.5 * RELAX * mx);
  if (a0 < 2e-5) return false;
  const rho = s.lm[k] / s.L[k];
  let a = 0;
  for (let q = 0; q < 8; q++) {
    if (ex[q] <= 0) continue;
    const m = k + OFF_I[q] + n * OFF_J[q];
    sync(d, s, m);
    const b = Math.min((a0 * ex[q]) / tot, s.cap[m] - (s.ti[m] + s.L[m])), bm = b * rho;
    if (!(b > 0)) continue;
    if (bm > s.lm[m]) s.lt[m] = t;
    s.L[m] += b; s.lm[m] += bm;
    put(d, s, m);
    a += b;
  }
  if (a <= 0) return false;
  s.L[k] -= a; s.lm[k] -= a * rho;
  if (s.L[k] < 1e-9) { s.L[k] = 0; s.lm[k] = 0; }
  put(d, s, k);
  s.stats.moved += a * s.cell * s.cell;
  return true;
}

/** A steep face of intact ground at k: does it stand? */
function face(d: TerrainData, s: SoilState, k: number): number {
  const n = s.n;
  if (s.step - s.chk[k] < CHECK) return s.stand[k] ? KEEP : NONE;
  // engineered ground (pit sides, platforms) as built is retained
  if (d.eng[k] && s.ti[k] > s.hb[k] - 0.05) { s.stand[k] = 0; return NONE; }
  const y0 = s.ti[k];
  let dir = -1, steep = 0;
  for (let q = 0; q < 8; q++) {
    const m = k + OFF_I[q] + n * OFF_J[q], mi = m % n, mj = (m - mi) / n;
    if (!inner(s, mi, mj) || d.hole[m]) continue;
    const sl = (y0 - (s.ti[m] + s.L[m])) / (s.cell * (q < 4 ? 1 : Math.SQRT2));
    if (sl > steep) { steep = sl; dir = q; }
  }
  const was = s.stand[k], last = s.chk[k];
  s.chk[k] = s.step;
  if (dir < 0 || steep < 0.45) { s.stand[k] = 0; return NONE; }
  // down the face to its toe
  const di = OFF_I[dir], dj = OFF_J[dir], step = s.cell * (dir < 4 ? 1 : Math.SQRT2);
  let i = k % n, j = (k - i) / n, yt = y0, run = 0;
  for (let st = 0; st < 16; st++) {
    const ni = i + di, nj = j + dj;
    if (!inner(s, ni, nj)) break;
    const m = ni + n * nj, yn = s.ti[m] + s.L[m];
    if ((yt - yn) / step < 0.36) break;
    i = ni; j = nj; yt = yn; run += step;
  }
  const H = y0 - yt;
  if (H < 0.15 || run <= 0) { s.stand[k] = 0; return NONE; }
  const beta = Math.atan2(H, run);
  const soft = s.soft[k] + (was && last > -1e8 ? (s.step - last) * DT : 0);
  s.soft[k] = soft;
  const slab = BOUND.has(d.mat[k]) && y0 > s.hb[k] - 0.05 ? 0.25 : 0;
  const ns = Math.min(40, Math.max(2, Math.ceil(H / 0.1))), dz = H / ns;
  // what bears on the crest: founded load, and loose soil heaped on it
  let sv = s.q[k] + (s.L[k] > 0 ? (s.lm[k] * G) / 1000 : 0);
  let pa = 0, worst = 0, zf = 0, phiF = 0, tauMax = 0;
  for (let st = 0; st < ns; st++) {
    const zm = (st + 0.5) * dz, t = soilAt(s, k, s.ref[k] - (y0 - zm)), p = P[t];
    // stronger ground also softens slower: a cut fails in lengths, not all along at once
    const w = Math.exp(-soft / (p.tau * s.vary[k] * s.vary[k]));
    if (p.tau < 1e6) tauMax = Math.max(tauMax, p.tau * s.vary[k] * s.vary[k]);
    let c = (p.c + (p.cu - p.c) * w) * s.vary[k];
    const phi = (p.undrained ? p.phi * (1 - w) : p.phi) * DEG;
    if (zm < slab) c += 250;
    const gam = (p.rho * G) / 1000;
    let sa: number;
    if (beta <= phi + 0.01) sa = -1;
    else {
      // an inclined face stands taller than a vertical one: Culmann's critical height scales with this
      const g = beta > 1.55 ? 1 : (Math.sin(beta) * (1 - Math.sin(phi))) / (1 - Math.cos(beta - phi));
      const ka = Math.tan(Math.PI / 4 - phi / 2) ** 2;
      sa = (sv + gam * dz * 0.5) * ka - 2 * c * g * Math.sqrt(ka);
    }
    sv += gam * dz;
    pa += sa * dz;
    if (pa > worst) { worst = pa; zf = (st + 1) * dz; phiF = phi; }
  }
  if (worst > 0 && zf >= 0.1) {
    wedge(d, s, k, dir, zf, beta, phiF);
    s.stand[k] = 0;
    return CHANGED;
  }
  if (soft > 4 * tauMax) { s.stand[k] = 0; return NONE; }
  s.stand[k] = 1;
  return KEEP;
}

const acc0 = new Float64Array(NS);

/** The wedge behind a failing face: from `zf` below the crest at k, the Culmann plane rises back into the ground
    at (β + φ)/2; the soil above it breaks up (bulks) and runs. */
function wedge(d: TerrainData, s: SoilState, k: number, dir: number, zf: number, beta: number, phi: number): void {
  const n = s.n, ta = Math.tan((beta + phi) / 2), bi = -OFF_I[dir], bj = -OFF_J[dir], step = s.cell * (dir < 4 ? 1 : Math.SQRT2);
  const yb = s.ti[k] - zf;
  let i = k % n, j = (k - i) / n, x = 0, total = 0;
  for (let st = 0; st < 14; st++) {
    if (!inner(s, i, j)) break;
    const m = i + n * j;
    if (d.hole[m] || (d.eng[m] && s.ti[m] > s.hb[m] - 0.05)) break;
    const yp = yb + x * ta, top = s.ti[m];
    if (top - yp < 0.02) break;
    acc0.fill(0);
    const mass = column(s, m, yp, top, acc0);
    s.ti[m] = yp;
    put(d, s, m);
    lay(d, s, m, mass, dominant(acc0));
    around(s, m, true);
    total += mass;
    i += bi; j += bj; x += step;
  }
  // the ground beside a slip is disturbed by it
  for (const [pi, pj] of [[-OFF_J[dir], OFF_I[dir]], [OFF_J[dir], -OFF_I[dir]]]) {
    const ki = (k % n) + pi, kj = (k - (k % n)) / n + pj;
    if (!inner(s, ki, kj)) continue;
    const m = ki + n * kj;
    s.soft[m] += 4;
    s.chk[m] = -1e9;
    activate(s, m);
  }
  s.stats.fails++;
  if (s.events.length < 64) s.events.push(k, total * s.cell * s.cell);
}

function visit(d: TerrainData, s: SoilState, k: number): number {
  const n = s.n, i = k % n, j = (k - i) / n;
  if (!inner(s, i, j) || d.hole[k]) return NONE;
  sync(d, s, k);
  const rel = s.hold[k] > 0 && release(d, s, k);
  if (s.L[k] > 0 && flow(d, s, k)) return CHANGED;
  const r = face(d, s, k);
  return rel && r === NONE ? CHANGED : r;
}

/** One step of the soil: clods in flight, then the active cells, at most `budget` of them. */
export function soilStep(d: TerrainData, s: SoilState, budget = BUDGET): number {
  s.step++;
  particles(d, s);
  const todo = Math.min(budget, s.count), R = s.ring.length;
  for (let v = 0; v < todo; v++) {
    const k = s.ring[s.head];
    s.head = (s.head + 1) % R;
    s.count--;
    s.flag[k] = 0;
    const r = visit(d, s, k);
    if (r === CHANGED) around(s, k);
    else if (r === KEEP) activate(s, k);
  }
  s.stats.visits += todo;
  return todo;
}

/** Cells changed since the last call (sample index ranges), or null. */
export function takeBox(s: SoilState): [number, number, number, number] | null {
  const b = s.box;
  if (b[0] > b[1]) return null;
  const out: [number, number, number, number] = [b[0], b[1], b[2], b[3]];
  b[0] = 1; b[1] = 0;
  return out;
}

export function isSealed(d: TerrainData, s: SoilState, k: number): boolean { return BOUND.has(d.mat[k]) && s.ti[k] > s.hb[k] - 0.05 && s.L[k] < 0.05; }

export function busy(s: SoilState): boolean { return s.count > 0 || s.parts.n > 0; }

/* ---------------- edits ---------------- */

const cellOf = (s: SoilState, v: number) => Math.round((v + s.half) / s.cell);

function disc(s: SoilState, x: number, z: number, r: number, f: (k: number, rr: number) => void): void {
  const n = s.n;
  const i0 = Math.max(1, Math.floor((x - r + s.half) / s.cell)), i1 = Math.min(n - 2, Math.ceil((x + r + s.half) / s.cell));
  const j0 = Math.max(1, Math.floor((z - r + s.half) / s.cell)), j1 = Math.min(n - 2, Math.ceil((z + r + s.half) / s.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const rr = Math.hypot(-s.half + i * s.cell - x, -s.half + j * s.cell - z);
    if (rr < r) f(i + n * j, rr);
  }
}

/** A bucket's bite: a paraboloid `depth` deep over a disc of radius r. Mass taken (kg), by kind into `acc`. */
export function digSoil(d: TerrainData, s: SoilState, x: number, z: number, r: number, depth: number, acc: Float64Array, sealed = false): number {
  let m = 0;
  disc(s, x, z, r, (k, rr) => {
    if (d.hole[k]) return;
    let dz = depth * (1 - (rr / r) ** 2);
    // teeth skid on an unbroken pavement: only what lies on it comes up
    if (sealed && BOUND.has(d.mat[k]) && s.ti[k] > s.hb[k] - 0.05) dz = Math.min(dz, s.L[k]);
    m += take(d, s, k, dz, acc) * s.cell * s.cell;
    around(s, k, true);
  });
  // the cut's new faces are checked at once
  disc(s, x, z, r + 2 * s.cell, (k) => { s.chk[k] = -1e9; activate(s, k); });
  return m;
}

/** Lay `mass` kg of loose soil of kind t over a disc of radius r (heaped to the middle); it runs to its repose. */
export function heapSoil(d: TerrainData, s: SoilState, x: number, z: number, r: number, mass: number, t: number): number {
  let w = 0;
  const rr0 = Math.max(r, s.cell * 0.75);
  disc(s, x, z, rr0, (k, rr) => { if (!d.hole[k]) w += 1 - (rr / rr0) ** 2; });
  if (w <= 0) {
    const k = Math.min(s.n - 2, Math.max(1, cellOf(s, x))) + s.n * Math.min(s.n - 2, Math.max(1, cellOf(s, z)));
    lay(d, s, k, mass / (s.cell * s.cell), t);
    return mass;
  }
  disc(s, x, z, rr0, (k, rr) => { if (!d.hole[k]) lay(d, s, k, (mass * (1 - (rr / rr0) ** 2)) / w / (s.cell * s.cell), t); });
  return mass;
}

/** The ceilings over [x0, x1] × [z0, z1] from what rests on the ground there: `fill` calls `put` with each body's
    footprint and underside. Samples under a footprint may stand no higher than its underside, and those round it a
    cell out only a little higher (0.5 m per m out: the heightfield's triangles are a cell wide, and a sample just
    outside tilts the one under the body's edge). A sample whose cap lifts is woken, so held soil comes back out. */
export function ceilings(s: SoilState, x0: number, x1: number, z0: number, z1: number, fill: (put: (a0: number, a1: number, b0: number, b1: number, y: number) => void) => void): void {
  const n = s.n, c = s.cell;
  const i0 = Math.max(0, Math.floor((x0 + s.half) / c)), i1 = Math.min(n - 1, Math.ceil((x1 + s.half) / c));
  const j0 = Math.max(0, Math.floor((z0 + s.half) / c)), j1 = Math.min(n - 1, Math.ceil((z1 + s.half) / c));
  if (i1 < i0 || j1 < j0) return;
  const w = i1 - i0 + 1, old = new Float32Array(w * (j1 - j0 + 1));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = i + n * j; old[i - i0 + w * (j - j0)] = s.cap[k]; s.cap[k] = Infinity; }
  fill((a0, a1, b0, b1, y) => {
    const ii0 = Math.max(i0, Math.ceil((a0 - c + s.half) / c)), ii1 = Math.min(i1, Math.floor((a1 + c + s.half) / c));
    const jj0 = Math.max(j0, Math.ceil((b0 - c + s.half) / c)), jj1 = Math.min(j1, Math.floor((b1 + c + s.half) / c));
    for (let j = jj0; j <= jj1; j++) for (let i = ii0; i <= ii1; i++) {
      const x = -s.half + i * c, z = -s.half + j * c, k = i + n * j;
      const v = y + 0.5 * Math.max(0, a0 - x, x - a1, b0 - z, z - b1);
      if (v < s.cap[k]) s.cap[k] = v;
    }
  });
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j;
    if (s.cap[k] > old[i - i0 + w * (j - j0)] + 1e-3) around(s, k);
  }
}

/** The samples holding soil under a cap, grouped into blocks of `size` × `size` samples: block → its sample-index box
    (i0, i1, j0, j1), in block order. */
export function heldBlocks(s: SoilState, size: number): Map<number, [number, number, number, number]> {
  const n = s.n, bn = Math.ceil(n / size), out = new Map<number, [number, number, number, number]>();
  for (const k of s.holds) {
    const i = k % n, j = (k - i) / n, t = Math.floor(i / size) + bn * Math.floor(j / size), b = out.get(t);
    if (!b) { out.set(t, [i, i, j, j]); continue; }
    if (i < b[0]) b[0] = i; if (i > b[1]) b[1] = i;
    if (j < b[2]) b[2] = j; if (j > b[3]) b[3] = j;
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** Sample-index box of the active cells and the clods in flight (none: [1, 0, 1, 0]); a cell rises only there. */
export function activeBox(s: SoilState): [number, number, number, number] {
  const n = s.n, b: [number, number, number, number] = [1, 0, 1, 0], R = s.ring.length;
  const add = (i: number, j: number) => {
    if (b[0] > b[1]) { b[0] = b[1] = i; b[2] = b[3] = j; return; }
    if (i < b[0]) b[0] = i; if (i > b[1]) b[1] = i;
    if (j < b[2]) b[2] = j; if (j > b[3]) b[3] = j;
  };
  for (let v = 0; v < s.count; v++) { const k = s.ring[(s.head + v) % R], i = k % n; add(i, (k - i) / n); }
  const p = s.parts;
  for (let q = 0; q < p.n; q++) add(Math.min(n - 1, Math.max(0, cellOf(s, p.x[q]))), Math.min(n - 1, Math.max(0, cellOf(s, p.z[q]))));
  return b;
}

/** A body set into the ground at samples `ks`, its underside at `ys`: the soil above that at each is pushed out of its
    way onto the samples round them (held under the body where it lies over them). Returns the kg moved. */
export function displace(d: TerrainData, s: SoilState, ks: readonly number[], ys: readonly number[]): number {
  const acc = new Float64Array(NS), n = s.n, cellA = s.cell * s.cell, set = new Set(ks);
  let mass = 0;
  for (let q = 0; q < ks.length; q++) {
    const k = ks[q];
    if (d.hole[k]) continue;
    sync(d, s, k);
    const dz = s.ti[k] + s.L[k] - ys[q];
    if (dz > 1e-3) { mass += take(d, s, k, dz, acc) * cellA; around(s, k, true); }
  }
  if (mass <= 0) return 0;
  const ring: number[] = [];
  for (const k of ks) {
    const i = k % n, j = (k - i) / n;
    for (let q = 0; q < 8; q++) {
      const ni = i + OFF_I[q], nj = j + OFF_J[q], m = ni + n * nj;
      if (!inner(s, ni, nj) || d.hole[m] || set.has(m)) continue;
      set.add(m);
      ring.push(m);
    }
  }
  const t = dominant(acc), to = ring.length ? ring : ks.filter((k) => !d.hole[k]);
  for (const k of to) lay(d, s, k, mass / to.length / cellA, t);
  return mass;
}

/** Ground shaken (a blast nearby): steep faces within r lose strength as if they had stood `sec` longer. */
export function shake(d: TerrainData, s: SoilState, x: number, z: number, r: number, sec: number): void {
  disc(s, x, z, r, (k, rr) => {
    s.soft[k] += sec * (1 - rr / r);
    s.chk[k] = -1e9;
    if (s.stand[k] || s.L[k] > 0) activate(s, k);
  });
  void d;
}

export interface CraterSoil { mass: number; bowl: number; rim: number; thrown: number; i0: number; i1: number; j0: number; j1: number }

/** A crater's bowl (a paraboloid R wide, D deep) and the soil it throws out: a third into the rim, most of the rest
    as an ejecta blanket thinning as (r/R)⁻³ out to 3.5 R in rays (McGetchin, Settle & Head 1973), some as clods in
    flight. Every kilogram taken out is laid back. */
export function craterSoil(d: TerrainData, s: SoilState, px: number, pz: number, py: number, R: number, D: number): CraterSoil {
  const acc = new Float64Array(NS);
  let mass = 0;
  disc(s, px, pz, R, (k, rr) => {
    if (d.hole[k]) return;
    mass += take(d, s, k, D * (1 - (rr / R) ** 2), acc) * s.cell * s.cell;
    around(s, k, true);
  });
  const t = dominant(acc), out = 3.5 * R;
  const seed = Math.floor(px * 7.3 + pz * 13.1) | 0;
  const ray = (x: number, z: number) => {
    const a = Math.atan2(z - pz, x - px);
    return 0.45 + 1.1 * hash(seed, Math.floor(((a + Math.PI) / (2 * Math.PI)) * 23), 3);
  };
  const cellA = s.cell * s.cell;
  const mRim = 0.35 * mass, mFly = mass > 50 ? 0.08 * mass : 0, mBlanket = mass - mRim - mFly;
  // rim: a raised lip just outside the bowl
  let wr = 0, wb = 0;
  disc(s, px, pz, out, (k, rr) => {
    if (rr >= R && rr < 1.35 * R) wr += Math.sin((Math.PI * (rr - R)) / (0.35 * R));
    if (rr >= 0.95 * R) wb += (rr / R) ** -3 * ray(-s.half + (k % s.n) * s.cell, -s.half + Math.floor(k / s.n) * s.cell);
  });
  let laid = 0;
  disc(s, px, pz, out, (k, rr) => {
    let m = 0;
    if (wr > 0 && rr >= R && rr < 1.35 * R) m += (mRim * Math.sin((Math.PI * (rr - R)) / (0.35 * R))) / wr;
    if (wb > 0 && rr >= 0.95 * R) m += (mBlanket * (rr / R) ** -3 * ray(-s.half + (k % s.n) * s.cell, -s.half + Math.floor(k / s.n) * s.cell)) / wb;
    if (m > 0) { lay(d, s, k, m / cellA, t); laid += m; }
  });
  // what the weights could not place (a crater at the edge of the map) goes into the rim
  const left = mass - mFly - laid;
  if (left > 1e-6) heapSoil(d, s, px + R * 1.1, pz, R * 0.3, left, t);
  // clods: launched at ~45° to land 1.5-5 R out
  const nc = mFly > 0 ? Math.min(160, Math.max(16, Math.round(mFly / 8))) : 0;
  for (let c = 0; c < nc; c++) {
    const az = rand(s) * Math.PI * 2, el = (35 + 20 * rand(s)) * DEG, range = R * (1.5 + 3.5 * rand(s) ** 1.5);
    const v = Math.sqrt((G * range) / Math.sin(2 * el));
    spawn(s, d, px + Math.cos(az) * R * 0.3, py + 0.2, pz + Math.sin(az) * R * 0.3, v * Math.cos(el) * Math.cos(az), v * Math.sin(el), v * Math.cos(el) * Math.sin(az), mFly / nc, t);
  }
  disc(s, px, pz, out + s.cell, (k) => { s.chk[k] = -1e9; activate(s, k); });
  const n = s.n;
  return {
    mass, bowl: mass, rim: mRim, thrown: mFly,
    i0: Math.max(0, cellOf(s, px - out) - 1), i1: Math.min(n - 1, cellOf(s, px + out) + 1),
    j0: Math.max(0, cellOf(s, pz - out) - 1), j1: Math.min(n - 1, cellOf(s, pz + out) + 1),
  };
}

/** A heavy body driven into the ground over [x0, x1] × [z0, z1] by `depth`: the soil it displaces heaves into a
    ring round it. Returns the mass displaced (kg). */
export function dentSoil(d: TerrainData, s: SoilState, x0: number, x1: number, z0: number, z1: number, depth: number): number {
  const n = s.n, acc = new Float64Array(NS), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const w = Math.max(s.cell, 0.35 * Math.min(hx, hz) * 2);
  const i0 = Math.max(1, Math.floor((x0 - w + s.half) / s.cell)), i1 = Math.min(n - 2, Math.ceil((x1 + w + s.half) / s.cell));
  const j0 = Math.max(1, Math.floor((z0 - w + s.half) / s.cell)), j1 = Math.min(n - 2, Math.ceil((z1 + w + s.half) / s.cell));
  let mass = 0;
  const ring: number[] = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j, x = -s.half + i * s.cell, z = -s.half + j * s.cell;
    if (d.hole[k]) continue;
    const ux = Math.abs(x - cx) / Math.max(hx, 1e-3), uz = Math.abs(z - cz) / Math.max(hz, 1e-3);
    if (ux <= 1 && uz <= 1) {
      // a dish under the body, deepest in the middle
      const f = 1 - 0.5 * Math.max(ux, uz) ** 2;
      mass += take(d, s, k, depth * f, acc) * s.cell * s.cell;
    } else ring.push(k);
  }
  if (mass <= 0) return 0;
  const t = dominant(acc);
  if (!ring.length) { heapSoil(d, s, cx, cz, Math.max(hx, hz) + w, mass, t); return mass; }
  for (const k of ring) lay(d, s, k, mass / ring.length / (s.cell * s.cell), t);
  s.stats.dents++;
  return mass;
}

/* ---------------- clods in flight ---------------- */

/** A clod of `m` kg of kind t in flight; laid straight into the ground where it would land if too many fly. */
export function spawn(s: SoilState, d: TerrainData, x: number, y: number, z: number, vx: number, vy: number, vz: number, m: number, t: number): void {
  const p = s.parts;
  if (p.n >= p.x.length) { landAt(d, s, x + vx * 0.3, z + vz * 0.3, m, t); return; }
  const i = p.n++;
  p.x[i] = x; p.y[i] = y; p.z[i] = z; p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz; p.m[i] = m; p.t[i] = t;
}

function landAt(d: TerrainData, s: SoilState, x: number, z: number, m: number, t: number): void {
  const n = s.n;
  const i = Math.min(n - 2, Math.max(1, cellOf(s, x))), j = Math.min(n - 2, Math.max(1, cellOf(s, z)));
  lay(d, s, i + n * j, m / (s.cell * s.cell), t);
}

function particles(d: TerrainData, s: SoilState): void {
  const p = s.parts;
  for (let i = 0; i < p.n; i++) {
    p.vy[i] -= G * DT;
    // a clod's drag: small at these speeds, but it keeps a stream from a bucket together
    const k = 1 - 0.02 * DT * Math.hypot(p.vx[i], p.vy[i], p.vz[i]);
    p.vx[i] *= k; p.vy[i] *= k; p.vz[i] *= k;
    p.x[i] += p.vx[i] * DT; p.y[i] += p.vy[i] * DT; p.z[i] += p.vz[i] * DT;
    const lim = s.half - s.cell;
    const gx = Math.max(-lim, Math.min(lim, p.x[i])), gz = Math.max(-lim, Math.min(lim, p.z[i]));
    if (p.y[i] <= fieldHeight(d, gx, gz) || p.y[i] < -60) {
      landAt(d, s, gx, gz, p.m[i], p.t[i]);
      const last = --p.n;
      if (i !== last) {
        p.x[i] = p.x[last]; p.y[i] = p.y[last]; p.z[i] = p.z[last]; p.vx[i] = p.vx[last]; p.vy[i] = p.vy[last]; p.vz[i] = p.vz[last]; p.m[i] = p.m[last]; p.t[i] = p.t[last];
      }
      i--;
    }
  }
}

/* ---------------- loads carried ---------------- */

/** Spoil carried in a bucket, as the renderer draws it: the mouth's centre (world) and rotation from its spawn frame
    (its open side +y there), half extents, how full (0-1, heaped at 1) and the soil's colour. */
export interface CarryView { pos: number[]; rot: number[]; hx: number; hz: number; fill: number; color: number }
export const carriers = new Set<() => CarryView | null>();

/* ---------------- queries ---------------- */

/** Total soil mass (kg) above the datum, loose and intact, including clods in flight (conservation checks). */
export function totalMass(s: SoilState): number {
  let m = 0;
  const N = s.n * s.n;
  for (let k = 0; k < N; k++) m += column(s, k, DATUM, s.ti[k], null) + s.lm[k] + s.hold[k];
  m *= s.cell * s.cell;
  for (let i = 0; i < s.parts.n; i++) m += s.parts.m[i];
  return m;
}

/** The kind of soil at the surface of sample k: its loose layer, or the stratum laid bare. */
export function surfaceSoil(s: SoilState, k: number): number {
  if (s.L[k] > 0.03) return s.lt[k];
  return soilAt(s, k, s.ref[k] - s.ti[k] + 0.02);
}

export function soilIndex(id: SoilId): number { return SOILS.indexOf(id); }
export const soilProps = (t: number): SoilProps => P[t];
