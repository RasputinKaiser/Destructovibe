import {
  N, N3, NF, ADV, F_T, F_SMOKE, F_DARK, F_O2, F_CH4, F_C3H8, F_FUEL, F_STEAM, F_CO, F_WAT, F_U, F_V, F_W, F_P, F_BURN, F_PK,
  amb, type Brick,
} from './grid';
import type { Burn } from './props';
import type { Piece } from '../../destruction/structure';

/* One brick's gas step on a padded (18³) copy: sources, chemistry, buoyancy, a few Jacobi sweeps of pressure
   projection, diffusion, then semi-Lagrangian advection back into the brick. Neighbouring bricks supply the halo;
   where there is none the open air (wind, ambient composition, zero pressure) does. */

export const NP = N + 2, NP3 = NP * NP * NP;
const SX = 1, SY = NP, SZ = NP * NP;

/** Fires run on a compressed clock (timber chars a real minute per second of play); rates of heat release,
 * oxygen use, pyrolysis and wall losses are sped up by this, transport runs in real time. */
export const FIRE_CLOCK = 6;
const X_EXT = 0.125, X_FULL = 0.17;     // O₂ at which flaming dies / is fully ventilated (LOI of timber ~ 0.14–0.16)
const H_WALL = 12;                      // W/m²K gas → room surfaces, net of what the linings radiate back
const DIFF = 0.06;                      // m²/s turbulent diffusivity in still air
const LMIX = 0.3;                       // m, mixing length
const ITER = 6;
const VFALL = 4;                        // m/s sprinkler droplet terminal speed
const EVAP = 1.5;                       // 1/s droplet evaporation per 100 K of superheat
const T_MAX = 2000;
const FLAME_HOLD = 0.25;             // s a burnt-out cell stays a flame front for its neighbours
const FRONT_AGE = 0.5;               // s a newly lit cell counts as the passing front (> the 0.25 s longest brick step)
/* molar LHV (J/mol), O₂ demand (mol/mol), H₂O made, autoignition °C, LEL, UEL. The pyrolysate stands for timber
   volatiles (CO, CH₄, formaldehyde, tars): flammable roughly 7–70 %, igniting unaided near CO's 609 °C. */
const CH4 = { lhv: 802e3, o2: 2, h2o: 2, ait: 537, lel: 0.05, uel: 0.15 };
const C3H8 = { lhv: 2044e3, o2: 5, h2o: 4, ait: 470, lel: 0.021, uel: 0.095 };
const PYRO = { lhv: 520e3, o2: 1, h2o: 1, ait: 600, lel: 0.07, uel: 0.7 };

export interface FireRec { phi: number; smoulder: boolean; moist: number; prevT: number; pyro: number; wet: number; q: number }

export interface Emitter {
  p: Piece;
  i: number;                // brick voxel at the piece's origin
  kind: 0 | 1 | 2;          // 0 burning, 1 pyrolysing only, 2 hot surface (ignition source only)
  q: number;                // W, heat release it would have fully ventilated (fire clock)
  mdot: number;             // kg/s volatiles released
  burn: Burn | null;
  rec: FireRec;
}
export const emitters = new Map<Brick, Emitter[]>();
export const sparks: { x: number; y: number; z: number; t: number }[] = [];

/** premixed burning this step, for the deflagration bookkeeping */
export const defl = { E: 0, x: 0, y: 0, z: 0, pyro: 0, n: 0, cov: 0 };
export const gasStats = { heatW: 0, o2Use: 0 };

export const pad: Float32Array[] = [];
for (let i = 0; i < NF; i++) pad.push(new Float32Array(NP3));
const mask = new Uint8Array(NP3);
const pign = new Uint8Array(NP3);
const S = new Float32Array(NP3);
const tmp = new Float32Array(NP3);
const burn0 = new Float32Array(NP3);
const SY2 = 1 << 20;
const AIR_OFFS = [0, SY, SX, -SX, SZ, -SZ, SY2];
const air = new Int32Array(8);
const kc = new Float32Array(NP3);
const nbits = new Uint8Array(NP3);
const ncount = new Uint8Array(NP3);
const openList = new Int32Array(N3);
const active = new Int8Array(ADV.length);
const actList = new Int32Array(ADV.length);
const padAct: Float32Array[] = [];
const outAct: Float32Array[] = [];
const POP = Array.from({ length: 64 }, (_, b) => (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1) + ((b >> 3) & 1) + ((b >> 4) & 1) + ((b >> 5) & 1));
const budgetIn = new Float64Array(9);

export let pour: (x: number, y: number, z: number, kg: number) => void = () => {};
export function setPour(f: typeof pour): void { pour = f; }

function gather(b: Brick): void {
  const nb = b.nb;
  const self = nb[13]!;
  for (let z = -1; z <= N; z++) {
    const nz = z < 0 ? 0 : z >= N ? 2 : 1, lz = z - (nz - 1) * N;
    for (let y = -1; y <= N; y++) {
      const ny = y < 0 ? 0 : y >= N ? 2 : 1, ly = y - (ny - 1) * N;
      const below = b.oy + y < 0;
      let pi = NP * (y + 1 + NP * (z + 1));
      if (!below && nz === 1 && ny === 1) {
        /* interior row: bulk copy, then the two halo ends */
        const i0 = N * (ly + N * lz);
        for (let f = 0; f < NF; f++) {
          const src = self.f[f], dst = pad[f];
          for (let x = 0; x < N; x++) dst[pi + 1 + x] = src[i0 + x];
        }
        const occ = self.occ, por = self.por, ign = self.ign;
        for (let x = 0; x < N; x++) { mask[pi + 1 + x] = occ[i0 + x] > 16 || por[i0 + x] >= 3 ? 1 : 0; pign[pi + 1 + x] = ign[i0 + x]; }
        haloCell(nb[0 + 3 * (ny + 3 * nz)], pi, N - 1, ly, lz, false);
        haloCell(nb[2 + 3 * (ny + 3 * nz)], pi + N + 1, 0, ly, lz, false);
        continue;
      }
      for (let x = -1; x <= N; x++, pi++) {
        const nx = x < 0 ? 0 : x >= N ? 2 : 1, lx = x - (nx - 1) * N;
        haloCell(nb[nx + 3 * (ny + 3 * nz)], pi, lx, ly, lz, below);
      }
    }
  }
}

function haloCell(o: Brick | null, pi: number, lx: number, ly: number, lz: number, below: boolean): void {
  if (below) {
    mask[pi] = 1; pign[pi] = 0;
    for (let f = 0; f < NF; f++) pad[f][pi] = amb[f];
  } else if (o) {
    const i = lx + N * (ly + N * lz);
    mask[pi] = o.occ[i] > 16 || o.por[i] >= 3 ? 1 : 0;
    pign[pi] = o.ign[i];
    for (let f = 0; f < NF; f++) pad[f][pi] = o.f[f][i];
  } else {
    mask[pi] = 0; pign[pi] = 0;
    for (let f = 0; f < NF; f++) pad[f][pi] = amb[f];
  }
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const flammable = (ch4: number, c3h8: number, fu: number, o2: number): boolean =>
  o2 >= 0.1 && ch4 / CH4.lel + c3h8 / C3H8.lel + fu / PYRO.lel >= 1 && ch4 / CH4.uel + c3h8 / C3H8.uel + fu / PYRO.uel <= 1;

/* solid somewhere above the cell in its brick (and halo): burning under a ceiling rather than in the open */
function covered(pi: number): boolean {
  for (let j = pi + SY; j < NP3; j += SY) if (mask[j]) return true;
  return false;
}

/* nearest open cell to pi that is inside the brick (its neighbours then stay within the padded block) */
function openNear(pi: number): number {
  if (!mask[pi]) return pi;
  for (const o of NEAR) { const j = pi + o; if (inner(j) && !mask[j]) return j; }
  return -1;
}
const NEAR = [SY, SX, -SX, SZ, -SZ, 2 * SY, -SY];
function inner(j: number): boolean {
  const x = j % NP, y = ((j / NP) | 0) % NP, z = (j / (NP * NP)) | 0;
  return x > 0 && x <= N && y > 0 && y <= N && z > 0 && z <= N;
}

function sourceFires(b: Brick, dt: number): void {
  const list = emitters.get(b);
  if (!list) return;
  const pT = pad[F_T], pO2 = pad[F_O2], pFu = pad[F_FUEL];
  for (const e of list) {
    if (e.p.dead) continue;
    const i = e.i, x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
    const pj = openNear(x + 1 + NP * (y + 1 + NP * (z + 1)));
    if (pj < 0) continue;
    pign[pj] = 1;
    if (e.kind === 2) continue;
    const up = mask[pj + SY] ? pj : pj + SY;
    /* glowing embers and flame stand out from the piece's surface on every side */
    pign[up] = 1; pign[pj + SX] = 1; pign[pj - SX] = 1; pign[pj + SZ] = 1; pign[pj - SZ] = 1;
    const Tv = pT[pj], Tabs = Tv + 273.15, n = 12187 / Tabs, C = 355e3 / Tabs;
    const bp = e.burn;
    let burnt = 0;
    if (e.kind === 0) {
      /* a flame draws its air from all round it, not from the one cell it sits in */
      let nc = 0, o2s = 0;
      for (const o of AIR_OFFS) {
        if (o === SY2 && (up === pj || !inner(up))) continue;
        const c = o === SY2 ? up + SY : pj + o;
        if (mask[c]) continue;
        air[nc++] = c;
        o2s += pO2[c];
      }
      const o2 = nc ? o2s / nc : 0;
      const target = clamp((o2 - X_EXT) / (X_FULL - X_EXT), 0, 1);
      e.rec.phi += (target - e.rec.phi) * Math.min(1, dt / 0.8);
      const qmax = (Math.max(0, o2 - 0.06) * nc * n * 0.032 * 13.1e6 * 1.5) / dt;
      const Q = Math.min(e.q * e.rec.phi, qmax);
      e.rec.q = Q;
      burnt = e.q > 0 ? Q / e.q : 0;
      const h = 0.7 * Q * dt;
      pT[pj] = Math.min(T_MAX, Tv + (h * 0.6) / C);
      pT[up] = Math.min(T_MAX, pT[up] + (h * 0.4) / (355e3 / (pT[up] + 273.15)));
      S[pj] += (h * 0.6) / C / Tabs / dt;
      S[up] += (h * 0.4) / C / Tabs / dt;
      const dO2 = (Q * dt) / 13.1e6 / 0.032 / n;
      if (o2s > 0) for (let q = 0; q < nc; q++) { const c = air[q]; pO2[c] = Math.max(0, pO2[c] - (dO2 * pO2[c]) / o2s); }
      pad[F_STEAM][pj] += (0.5 * e.mdot * burnt * dt) / 0.018 / n;
      gasStats.heatW += Q;
    }
    const m = e.mdot * dt;
    const dx = Math.min(0.5, (m * (1 - burnt)) / 0.03 / n);
    if (dx > 0) {
      /* volatiles displace what was there: the voxel stays a mixture, never more than all fuel */
      const keep = 1 - dx;
      pO2[pj] *= keep; pad[F_CH4][pj] *= keep; pad[F_C3H8][pj] *= keep; pFu[pj] = pFu[pj] * keep + dx; pad[F_STEAM][pj] *= keep; pad[F_CO][pj] *= keep;
    }
    if (bp) {
      const vit = 1 - burnt;
      const soot = bp.soot * m * (e.kind === 0 ? 1 + 2 * vit : 0.3) * 1000;
      pad[F_SMOKE][pj] += soot;
      pad[F_DARK][pj] += soot * (e.kind === 0 ? bp.dark : 0);
      pad[F_CO][pj] += (bp.co * m * (1 + 8 * vit)) / 0.028 / n;
    }
  }
}

/** Advance brick `b` by dt. Returns true when anything in it is off ambient. */
export function stepBrick(b: Brick, dt: number): boolean {
  gather(b);
  S.fill(0);
  let expanding = false;
  for (const s of sparks) {
    const x = Math.floor(s.x) - b.ox, y = Math.floor(s.y) - b.oy, z = Math.floor(s.z) - b.oz;
    if (x >= 0 && x < N && y >= 0 && y < N && z >= 0 && z < N) {
      /* an arc against a wall lights the air beside it */
      const j = openNear(x + 1 + NP * (y + 1 + NP * (z + 1)));
      if (j >= 0) pign[j] = 1;
    }
  }
  sourceFires(b, dt);
  const pT = pad[F_T], pO2 = pad[F_O2], pM = pad[F_CH4], pPr = pad[F_C3H8], pFu = pad[F_FUEL], pSt = pad[F_STEAM], pCo = pad[F_CO];
  const pWa = pad[F_WAT], pU = pad[F_U], pV = pad[F_V], pW = pad[F_W], pP = pad[F_P], pB = pad[F_BURN], pK = pad[F_PK];
  const Ta = amb[F_T];
  burn0.set(pB);
  const damp = Math.exp(-0.35 * dt);
  const kPk = Math.exp(-dt / 0.4);

  /* chemistry, droplets, wall losses, buoyancy */
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
    let pi = 1 + NP * (y + 1 + NP * (z + 1));
    for (let x = 0; x < N; x++, pi++) {
      if (mask[pi]) continue;
      let T = pT[pi];
      const Tabs = T + 273.15, n = 12187 / Tabs, C = 355e3 / Tabs;
      let q = 0, qc = 0;
      const wv = pWa[pi];
      if (wv > 1e-6) {
        if (T > 40) {
          const m = Math.min(wv, wv * dt * EVAP * ((T - 40) / 100));
          pWa[pi] -= m;
          q -= m * (2.26e6 + 335e3);
          pSt[pi] += m / 0.018 / n;
        }
        if (mask[pi - SY]) {
          const m = pWa[pi] * Math.min(1, VFALL * dt);
          pWa[pi] -= m;
          pour(b.ox + x + 0.5, b.oy + y, b.oz + z + 0.5, m);
        }
      }
      let ch4 = pM[pi], c3 = pPr[pi], fu = pFu[pi], o2 = pO2[pi];
      const fuel = ch4 + c3 + fu;
      if (fuel > 2e-4 && o2 > 0.02) {
        const pre = flammable(ch4, c3, fu, o2);
        let lit = pB[pi] > 0;
        /* a passing front also tears through the rich layer above the flammable band, burning it as far as its own
           oxygen goes (the rest mixes and burns in the fireball after) */
        const front = burn0[pi + SX] > 0.03 || burn0[pi - SX] > 0.03 || burn0[pi + SY] > 0.03 || burn0[pi - SY] > 0.03 || burn0[pi + SZ] > 0.03 || burn0[pi - SZ] > 0.03;
        const ait = fu > ch4 + c3 ? PYRO.ait : c3 > ch4 ? C3H8.ait : CH4.ait;
        if (!lit && ((pre && (pign[pi] || T > ait || front)) || (front && o2 >= 0.05 && ch4 / CH4.lel + c3 / C3H8.lel + fu / PYRO.lel >= 1))) {
          lit = true;
          pB[pi] = 1e-3;
        }
        /* outside the premixed range fuel still burns where it meets a flame, an ember or hot enough air, at the
           rate it mixes: the diffusion flame at a smouldering room's opening, rollover under a ceiling */
        /* an ember lights a mixture that is already flammable; it can only hold a diffusion flame with enough air */
        const hotMix = !lit && ((pign[pi] && o2 > 0.12) || T > ait);
        if (lit || hotMix) {
          const need = CH4.o2 * ch4 + C3H8.o2 * c3 + PYRO.o2 * fu;
          const rate = lit ? Math.min(1, dt / 0.06) : Math.min(1, dt / 2.5);
          const f = rate * Math.min(1, Math.max(0, o2 - 0.02) / need);
          const d1 = ch4 * f, d2 = c3 * f, d3 = fu * f;
          ch4 -= d1; c3 -= d2; fu -= d3;
          o2 = Math.max(0, o2 - need * f);
          pSt[pi] += CH4.h2o * d1 + C3H8.h2o * d2 + PYRO.h2o * d3;
          if (need > o2) pCo[pi] += 0.05 * d3;
          qc = n * (CH4.lhv * d1 + C3H8.lhv * d2 + PYRO.lhv * d3);
          q += qc;
          /* only a front burning through a mixture it found premixed is a deflagration: a cell that has been alight
             longer is a standing flame fed as fast as fuel reaches it (a fire's plume), however much heat it gives */
          if (lit && pB[pi] < FRONT_AGE) {
            defl.E += qc; defl.x += qc * (b.ox + x + 0.5); defl.y += qc * (b.oy + y + 0.5); defl.z += qc * (b.oz + z + 0.5);
            defl.pyro += n * PYRO.lhv * d3; defl.n++;
            if (covered(pi)) defl.cov += qc;
          }
          pM[pi] = ch4; pPr[pi] = c3; pFu[pi] = fu; pO2[pi] = o2;
        }
        if (pB[pi] > 0) pB[pi] = (ch4 + c3 + fu < 0.004 || o2 < 0.03) && pB[pi] > FLAME_HOLD ? 0 : pB[pi] + dt;
      } else if (pB[pi] > 0) pB[pi] = pB[pi] > FLAME_HOLD ? 0 : pB[pi] + dt;
      if (q !== 0) {
        const T1 = clamp(T + q / C, Ta - 30, T_MAX);
        if (qc > 0) { S[pi] += (T1 - T) / Tabs / dt; if (pB[pi] > 0 && S[pi] * dt > 0.3) expanding = true; }
        T = T1;
      }
      const ns = mask[pi + SX] + mask[pi - SX] + mask[pi + SY] + mask[pi - SY] + mask[pi + SZ] + mask[pi - SZ];
      if (ns && T > Ta + 0.5) T -= Math.min(0.5, (H_WALL * ns * dt * FIRE_CLOCK) / C) * 0.7 * (T - Ta);
      pT[pi] = T;
      const ay = 9.81 * ((T - Ta) / (T + 273.15) + 0.45 * pM[pi] - 0.52 * pPr[pi] + 0.38 * pSt[pi]);
      pV[pi] = (pV[pi] + ay * dt) * damp;
      pU[pi] *= damp; pW[pi] *= damp;
      pK[pi] *= kPk;
    }
  }

  /* open interior cells and their open neighbours (bits +x −x +y −y +z −z) */
  let no = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
    let pi = 1 + NP * (y + 1 + NP * (z + 1));
    for (let x = 0; x < N; x++, pi++) {
      if (mask[pi]) continue;
      const bits = (mask[pi + SX] ? 0 : 1) | (mask[pi - SX] ? 0 : 2) | (mask[pi + SY] ? 0 : 4) | (mask[pi - SY] ? 0 : 8) | (mask[pi + SZ] ? 0 : 16) | (mask[pi - SZ] ? 0 : 32);
      nbits[pi] = bits;
      ncount[pi] = POP[bits];
      openList[no++] = pi;
    }
  }

  /* which fields differ from the open air anywhere in reach: the rest need no transport */
  const uA = amb[F_U], wA = amb[F_W];
  let anyActive = false;
  for (let k = 0; k < ADV.length; k++) {
    const f = ADV[k], a = pad[f], ref = f === F_U ? uA : f === F_W ? wA : amb[f];
    const eps = f === F_T ? 0.05 : f === F_O2 ? 1e-5 : f >= F_U ? 1e-3 : 1e-7;
    let on = 0;
    for (let j = 0; j < NP3; j++) { const d = a[j] - ref; if (d > eps || d < -eps) { on = 1; break; } }
    active[k] = on;
    if (on && f < F_U) anyActive = true;
  }
  /* the projection turns any buoyancy or expansion into flow in every direction */
  if (anyActive) for (let k = 0; k < ADV.length; k++) if (ADV[k] >= F_U) active[k] = 1;
  if (!anyActive) {
    for (const f of ADV) b.f[f].fill(f === F_U ? uA : f === F_W ? wA : amb[f]);
    b.f[F_WAT].fill(0); b.f[F_P].fill(0); b.f[F_BURN].fill(0);
    let pk = false;
    for (let i = 0; i < N3; i++) { const v = b.f[F_PK][i] * kPk; b.f[F_PK][i] = v; if (v > 50) pk = true; }
    b.maxT = Ta; b.content = pk;
    b.ign.fill(0);
    return pk;
  }

  /* pressure projection: ∇²φ = ∇·u − S by Gauss–Seidel, u −= ∇φ; walls are no-flux, the open air round the region φ = 0 */
  for (let n = 0; n < no; n++) {
    const pi = openList[n], bits = nbits[pi];
    const u = pU[pi], v = pV[pi], w = pW[pi];
    tmp[pi] = ((bits & 1 ? (u + pU[pi + SX]) * 0.5 : 0) - (bits & 2 ? (u + pU[pi - SX]) * 0.5 : 0)
      + (bits & 4 ? (v + pV[pi + SY]) * 0.5 : 0) - (bits & 8 ? (v + pV[pi - SY]) * 0.5 : 0)
      + (bits & 16 ? (w + pW[pi + SZ]) * 0.5 : 0) - (bits & 32 ? (w + pW[pi - SZ]) * 0.5 : 0)) - S[pi];
  }
  for (let it = 0; it < ITER; it++) {
    for (let n = 0; n < no; n++) {
      const pi = openList[n], bits = nbits[pi], c = ncount[pi];
      if (!c) { pP[pi] = 0; continue; }
      pP[pi] = ((bits & 1 ? pP[pi + SX] : 0) + (bits & 2 ? pP[pi - SX] : 0) + (bits & 4 ? pP[pi + SY] : 0) + (bits & 8 ? pP[pi - SY] : 0)
        + (bits & 16 ? pP[pi + SZ] : 0) + (bits & 32 ? pP[pi - SZ] : 0) - tmp[pi]) / c;
    }
  }
  for (let n = 0; n < no; n++) {
    const pi = openList[n], bits = nbits[pi], p0 = pP[pi];
    let u = pU[pi] - ((bits & 1 ? pP[pi + SX] : p0) - (bits & 2 ? pP[pi - SX] : p0)) * 0.5;
    let v = pV[pi] - ((bits & 4 ? pP[pi + SY] : p0) - (bits & 8 ? pP[pi - SY] : p0)) * 0.5;
    let w = pW[pi] - ((bits & 16 ? pP[pi + SZ] : p0) - (bits & 32 ? pP[pi - SZ] : p0)) * 0.5;
    if ((!(bits & 1) && u > 0) || (!(bits & 2) && u < 0)) u = 0;
    if ((!(bits & 4) && v > 0) || (!(bits & 8) && v < 0)) v = 0;
    if ((!(bits & 16) && w > 0) || (!(bits & 32) && w < 0)) w = 0;
    pU[pi] = clamp(u, -14, 14); pV[pi] = clamp(v, -14, 14); pW[pi] = clamp(w, -14, 14);
  }

  /* turbulent diffusion between open neighbours: eddy diffusivity grows with the local flow (mixing length ~0.3 m),
     so jets and plumes stir a room in seconds while still air barely mixes */
  const kd = Math.min(0.16, (DIFF + LMIX * 6) * dt);
  for (let j = 0; j < NP3; j++) {
    const u = pU[j], v = pV[j], w = pW[j];
    kc[j] = Math.min(0.16, (DIFF + LMIX * Math.sqrt(u * u + v * v + w * w)) * dt) * 0.5;
  }
  for (let k = 0; k < 9; k++) {
    if (!active[k]) continue;
    const a = pad[ADV[k]];
    for (let n = 0; n < no; n++) {
      const pi = openList[n], bits = nbits[pi], c = a[pi], kk = kc[pi];
      tmp[pi] = c + ((bits & 1 ? (a[pi + SX] - c) * (kk + kc[pi + SX]) : 0) + (bits & 2 ? (a[pi - SX] - c) * (kk + kc[pi - SX]) : 0)
        + (bits & 4 ? (a[pi + SY] - c) * (kk + kc[pi + SY]) : 0) + (bits & 8 ? (a[pi - SY] - c) * (kk + kc[pi - SY]) : 0)
        + (bits & 16 ? (a[pi + SZ] - c) * (kk + kc[pi + SZ]) : 0) + (bits & 32 ? (a[pi - SZ] - c) * (kk + kc[pi - SZ]) : 0));
    }
    for (let n = 0; n < no; n++) { const pi = openList[n]; a[pi] = tmp[pi]; }
  }

  /* species budget going in, where a flame front is expanding the gas: the brick's own content plus what its halo
     can push across the faces this step */
  for (let k = 1; k < 9; k++) {
    budgetIn[k] = -1;
    if (!expanding || k === 3 || !active[k]) continue;
    const a = pad[ADV[k]];
    let tot = 0;
    for (let n = 0; n < no; n++) tot += a[openList[n]];
    for (let q = 0; q < N; q++) for (let r = 0; r < N; r++) {
      tot += inflow(a, 0 + NP * (q + 1 + NP * (r + 1)), pU, 1, dt, kd) + inflow(a, NP - 1 + NP * (q + 1 + NP * (r + 1)), pU, -1, dt, kd)
        + inflow(a, q + 1 + NP * NP * (r + 1), pV, 1, dt, kd) + inflow(a, q + 1 + NP * (NP - 1 + NP * (r + 1)), pV, -1, dt, kd)
        + inflow(a, q + 1 + NP * (r + 1), pW, 1, dt, kd) + inflow(a, q + 1 + NP * (r + 1 + NP * (NP - 1)), pW, -1, dt, kd);
      /* …less what its own boundary layer carries out */
      tot -= outflow(a, 1 + NP * (q + 1 + NP * (r + 1)), -SX, pU, -1, dt, kd) + outflow(a, NP - 2 + NP * (q + 1 + NP * (r + 1)), SX, pU, 1, dt, kd)
        + outflow(a, q + 1 + NP * (1 + NP * (r + 1)), -SY, pV, -1, dt, kd) + outflow(a, q + 1 + NP * (NP - 2 + NP * (r + 1)), SY, pV, 1, dt, kd)
        + outflow(a, q + 1 + NP * (r + 1 + NP), -SZ, pW, -1, dt, kd) + outflow(a, q + 1 + NP * (r + 1 + NP * (NP - 2)), SZ, pW, 1, dt, kd);
    }
    budgetIn[k] = tot;
  }

  /* semi-Lagrangian advection (backtrace ≤ one cell), trilinear over open cells only */
  let nAct = 0;
  for (let k = 0; k < ADV.length; k++) if (active[k]) { actList[nAct] = k; padAct[nAct] = pad[ADV[k]]; outAct[nAct] = b.f[ADV[k]]; nAct++; }
  let content = false, maxT = Ta;
  const bf = b.f;
  const nA = ADV.length;
  for (let k = 0; k < nA; k++) if (!active[k]) { const f = ADV[k]; bf[f].fill(f === F_U ? uA : f === F_W ? wA : amb[f]); }
  const wet = active[0] >= 0 && hasAny(pWa);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) {
    let pi = 1 + NP * (y + 1 + NP * (z + 1)), i = N * (y + N * z);
    for (let x = 0; x < N; x++, pi++, i++) {
      if (mask[pi]) {
        for (let q = 0; q < nAct; q++) { const k = actList[q]; bf[ADV[k]][i] = k >= 9 ? 0 : pad[ADV[k]][pi]; }
        bf[F_WAT][i] = 0; bf[F_P][i] = 0; bf[F_BURN][i] = 0; bf[F_PK][i] = pK[pi];
        continue;
      }
      const bx = x + 1 - clamp(pU[pi] * dt, -0.999, 0.999), by = y + 1 - clamp(pV[pi] * dt, -0.999, 0.999), bz = z + 1 - clamp(pW[pi] * dt, -0.999, 0.999);
      if (corners(bx, by, bz) >= 1e-3) {
        const inv = 1 / csum;
        const i0 = ci[0], i1 = ci[1], i2 = ci[2], i3 = ci[3], i4 = ci[4], i5 = ci[5], i6 = ci[6], i7 = ci[7];
        const w0 = cw[0] * inv, w1 = cw[1] * inv, w2 = cw[2] * inv, w3 = cw[3] * inv, w4 = cw[4] * inv, w5 = cw[5] * inv, w6 = cw[6] * inv, w7 = cw[7] * inv;
        for (let q = 0; q < nAct; q++) {
          const a = padAct[q];
          outAct[q][i] = a[i0] * w0 + a[i1] * w1 + a[i2] * w2 + a[i3] * w3 + a[i4] * w4 + a[i5] * w5 + a[i6] * w6 + a[i7] * w7;
        }
      } else {
        for (let q = 0; q < nAct; q++) { const f = ADV[actList[q]]; bf[f][i] = pad[f][pi]; }
      }
      bf[F_WAT][i] = wet ? sampleOne(pWa, bx, y + 1 - clamp((pV[pi] - VFALL) * dt, -0.999, 0.999), bz, pi) : 0;
      bf[F_P][i] = pP[pi]; bf[F_BURN][i] = pB[pi]; bf[F_PK][i] = pK[pi];
      const T = bf[F_T][i];
      if (T > maxT) maxT = T;
      if (!content && (T > Ta + 2 || bf[F_SMOKE][i] > 0.004 || bf[F_CH4][i] + bf[F_C3H8][i] + bf[F_FUEL][i] > 3e-4 || bf[F_CO][i] > 2e-5 ||
        bf[F_STEAM][i] > 5e-4 || bf[F_WAT][i] > 1e-5 || bf[F_O2][i] < 0.205 || pB[pi] > 0 || pK[pi] > 50)) content = true;
    }
  }
  /* backtracing through a strongly diverging flow (an expanding flame) copies whatever it lands on into every cell
     it feeds: never let a species come out of a step with more than its brick and halo held going in */
  for (let k = 1; k < 9; k++) {
    if (budgetIn[k] < 0) continue;
    const a = bf[ADV[k]];
    let s = 0;
    for (let i = 0; i < N3; i++) s += a[i];
    const cap = budgetIn[k];
    if (s > cap + 1e-6) {
      const r = cap / s;
      for (let i = 0; i < N3; i++) a[i] *= r;
    }
  }
  b.maxT = maxT;
  b.content = content;
  b.ign.fill(0);
  return content;
}

const cw = new Float32Array(8);
const ci = new Int32Array(8);
function corners(px: number, py: number, pz: number): number {
  const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
  const fx = px - x0, fy = py - y0, fz = pz - z0;
  const b0 = x0 + NP * (y0 + NP * z0);
  let s = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2;
    const j = b0 + dx + dy * SY + dz * SZ;
    ci[c] = j;
    const w = mask[j] ? 0 : (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    cw[c] = w;
    s += w;
  }
  csum = s;
  return s;
}
let csum = 0;

function inflow(a: Float32Array, j: number, v: Float32Array, sgn: number, dt: number, kd: number): number {
  if (mask[j]) return 0;
  const vn = sgn * v[j];
  return a[j] * Math.min(1, (vn > 0 ? vn * dt : 0) + kd);
}

function outflow(a: Float32Array, j: number, off: number, v: Float32Array, sgn: number, dt: number, kd: number): number {
  if (mask[j] || mask[j + off]) return 0;
  const vn = sgn * v[j];
  return a[j] * Math.min(1, (vn > 0 ? vn * dt : 0) + kd);
}

function hasAny(a: Float32Array): boolean {
  for (let j = 0; j < NP3; j++) if (a[j] > 1e-7) return true;
  return false;
}

function sampleOne(a: Float32Array, px: number, py: number, pz: number, self: number): number {
  const s = corners(px, py, pz);
  if (s < 1e-3) return a[self];
  return (a[ci[0]] * cw[0] + a[ci[1]] * cw[1] + a[ci[2]] * cw[2] + a[ci[3]] * cw[3] + a[ci[4]] * cw[4] + a[ci[5]] * cw[5] + a[ci[6]] * cw[6] + a[ci[7]] * cw[7]) / s;
}

/** Faces of `b` whose boundary layer carries something out into unallocated space, as neighbour offsets. */
export function spill(b: Brick): [number, number, number][] {
  const res: [number, number, number][] = [];
  const f = b.f, Ta = amb[F_T];
  const busy = (i: number): boolean => f[F_T][i] > Ta + 30 || f[F_SMOKE][i] > 0.15 || f[F_CH4][i] + f[F_C3H8][i] + f[F_FUEL][i] > 0.004 || f[F_BURN][i] > 0;
  const faces: [number, number, number, (a: number, c: number) => number][] = [
    [-1, 0, 0, (a, c) => N * (a + N * c)], [1, 0, 0, (a, c) => N - 1 + N * (a + N * c)],
    [0, -1, 0, (a, c) => a + N * N * c], [0, 1, 0, (a, c) => a + N * (N - 1 + N * c)],
    [0, 0, -1, (a, c) => a + N * c], [0, 0, 1, (a, c) => a + N * (c + N * (N - 1))],
  ];
  for (const [dx, dy, dz, idx] of faces) {
    if (b.nb[dx + 1 + 3 * (dy + 1 + 3 * (dz + 1))] || b.by + dy < 0) continue;
    let hitN = 0;
    for (let a = 0; a < N && hitN < 3; a++) for (let c = 0; c < N; c++) if (busy(idx(a, c))) { hitN++; if (hitN >= 3) break; }
    if (hitN >= 3) res.push([dx, dy, dz]);
  }
  return res;
}

export function n3(): number { return N3; }
