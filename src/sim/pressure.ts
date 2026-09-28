import { pool, ALIVE } from './particles';
import type { SoftBody } from './xpbd';

/* Gas-filled membranes. The enclosed gas is an ideal gas, pV = nRT: the volume constraint is its isothermal spring,
   linearised about the current state every substep (compliance V/p, rest volume V(2 − pₐ/p)), so the membrane
   tension and the gas pressure meet wherever the fabric lets them. Once per step the gas exchanges heat with the
   air round it, leaks through its holes by compressible orifice flow (the jet pushes the shell back), is topped up
   by a blower, floats if it is lighter than the air it displaces, and bursts the shell along a seam when the
   membrane tension (Laplace: T = Δp·R/2) passes the seam strength. */

export const P_ATM = 101325;
export const R_GAS = 8.314;
const M_AIR = 0.02897;
const CD = 0.62;

export interface Gas {
  /** amount, mol; molar mass kg/mol; ratio of specific heats */
  n: number; M: number; gamma: number;
  /** gas temperature, K */
  T: number;
  /** enclosed volume now and as authored, m³; absolute pressure, Pa */
  V: number; V0: number; p: number;
  /** curvature radius at the authored size, m (membrane tension) */
  R0: number;
  /** authored gauge (the blower's set point), Pa; blower capacity, m³/s */
  gauge: number; blower: number;
  /** punctures (not torn cells), m², and the particle they are at; the leak it has by design (seals), m² */
  hole: number; holeAt: number; seal: number;
  /** torn cells' rest area, m², recomputed when the topology changes */
  torn: number; tornTopo: number;
  /** closed shell (else a dome: the ground closes it and the volume is taken from the rim plane) */
  closed: boolean;
  /** vented: burst or torn wide open, no longer holding anything */
  open: boolean;
  /** heat exchange time constant with the surrounding air, s */
  tau: number;
  /** last membrane tension N/m, leak kg/s, thrust N */
  tension: number; leak: number; thrust: number;
  /** air-supported: the rim plane height */
  rimY: number;
  area0: number;
  /** body burst this step (the caller rips it) */
  burst: boolean;
  /** rubber: the squeeze its stretched skin puts on the gas when blown up to the authored size, Pa, and the
      stretch it was blown up by (it is slack below the authored size over that) */
  squeeze: number; stretch: number;
  /** rubber: size it settles at (the balance of gas and squeeze) as a share of the authored size */
  scale: number;
}

/** membrane pressure of a rubber skin at volume V: flat over most of its range (latex), gone when unstretched */
function squeezeAt(g: Gas, V: number): number {
  if (!g.squeeze) return 0;
  const x = Math.cbrt(V / g.V0), s = 1 / g.stretch;
  return x <= s ? 0 : g.squeeze * Math.sqrt(Math.min(1, (x - s) / (1 - s)));
}

export function newGas(b: SoftBody, gauge: number, helium: boolean, closed: boolean, R0: number, tau: number, blower: number): Gas {
  const g: Gas = {
    n: 0, M: helium ? 0.004 : M_AIR, gamma: helium ? 1.66 : 1.4, T: 293.15, V: 0, V0: 0, p: P_ATM + gauge, R0, gauge, blower,
    hole: 0, holeAt: -1, seal: 0, torn: 0, tornTopo: -1, closed, open: false, tau, tension: 0, leak: 0, thrust: 0, rimY: 0, area0: 0, burst: false,
    squeeze: 0, stretch: 1, scale: 1,
  };
  b.gas = g;
  if (!closed) {
    let y = Infinity;
    for (let i = b.p0; i < b.p0 + b.n; i++) y = Math.min(y, pool.x[i * 3 + 1]);
    g.rimY = y;
  }
  g.V = g.V0 = Math.max(1e-6, volume(b, null));
  g.n = (g.p * g.V) / (R_GAS * g.T);
  let a = 0;
  if (b.cArea) for (let c = 0; c < b.nc; c++) a += b.cArea[c];
  g.area0 = a;
  return g;
}

let GR = new Float64Array(3 * 256);
let _cx = 0, _cy = 0, _cz = 0;

/** Enclosed volume by the divergence theorem over the live triangles (optionally its gradient per particle). */
export function volume(b: SoftBody, grad: Float64Array | null): number {
  const X = pool.x, g = b.gas, c2p = b.c2p, flip = b.cFlip, al = b.cAlive, p0 = b.p0;
  // reference point: the centroid (closed) or its foot on the rim plane (dome), so the open floor adds nothing
  let cx = 0, cy = 0, cz = 0, k = 0;
  for (let i = p0; i < p0 + b.n; i += 3) { cx += X[i * 3]; cy += X[i * 3 + 1]; cz += X[i * 3 + 2]; k++; }
  cx /= k; cy /= k; cz /= k;
  if (g && !g.closed) cy = g.rimY;
  _cx = cx; _cy = cy; _cz = cz;
  if (grad) grad.fill(0, 0, b.n * 3);
  let V = 0;
  for (let c = 0, nc = b.nc; c < nc; c++) {
    if (!al[c]) continue;
    const A = c2p[c * 4], B = c2p[c * 4 + 1], C = c2p[c * 4 + 2], D = c2p[c * 4 + 3];
    for (let t = 0; t < 2; t++) {
      let i: number, j: number, l: number;
      if (flip[c]) { if (t) { i = B; j = C; l = D; } else { i = A; j = B; l = D; } }
      else if (t) { i = A; j = C; l = D; } else { i = A; j = B; l = C; }
      const ax = X[i * 3] - cx, ay = X[i * 3 + 1] - cy, az = X[i * 3 + 2] - cz;
      const bx = X[j * 3] - cx, by = X[j * 3 + 1] - cy, bz = X[j * 3 + 2] - cz;
      const qx = X[l * 3] - cx, qy = X[l * 3 + 1] - cy, qz = X[l * 3 + 2] - cz;
      // (b × q), (q × a), (a × b)
      const bqx = by * qz - bz * qy, bqy = bz * qx - bx * qz, bqz = bx * qy - by * qx;
      V += ax * bqx + ay * bqy + az * bqz;
      if (!grad) continue;
      const qax = qy * az - qz * ay, qay = qz * ax - qx * az, qaz = qx * ay - qy * ax;
      const abx = ay * bz - az * by, aby = az * bx - ax * bz, abz = ax * by - ay * bx;
      const ii = (i - p0) * 3, jj = (j - p0) * 3, ll = (l - p0) * 3;
      grad[ii] += bqx; grad[ii + 1] += bqy; grad[ii + 2] += bqz;
      grad[jj] += qax; grad[jj + 1] += qay; grad[jj + 2] += qaz;
      grad[ll] += abx; grad[ll + 1] += aby; grad[ll + 2] += abz;
    }
  }
  if (grad) for (let q = 0; q < b.n * 3; q++) grad[q] /= 6;
  return V / 6;
}

/** One substep of the gas spring: a single XPBD volume constraint, linearised at the current volume. */
export function solveVolume(b: SoftBody, h: number): void {
  const g = b.gas;
  if (!g || g.open || g.n <= 0) return;
  if (GR.length < b.n * 3) GR = new Float64Array(b.n * 6);
  const V = volume(b, GR);
  if (V < g.V0 * 0.02) return;
  const W = pool.w, X = pool.x, p0 = b.p0;
  const p = (g.n * R_GAS * g.T) / V;
  // outside: the air and the rubber's squeeze. C = V − V(2 − pₒ/p) = −V(p − pₒ)/p, compliance α = V/p
  const C = (-V * (p - P_ATM - squeezeAt(g, V))) / p, at = V / (p * h * h);
  let den = at;
  for (let k = 0; k < b.n; k++) {
    const w = W[p0 + k];
    if (w === 0) continue;
    den += w * (GR[k * 3] ** 2 + GR[k * 3 + 1] ** 2 + GR[k * 3 + 2] ** 2);
  }
  const dl = -C / den;
  for (let k = 0; k < b.n; k++) {
    const i = p0 + k, w = W[i] * dl;
    if (w === 0) continue;
    X[i * 3] += GR[k * 3] * w; X[i * 3 + 1] += GR[k * 3 + 1] * w; X[i * 3 + 2] += GR[k * 3 + 2] * w;
  }
}

/** Mass flow through an orifice from pressure pu (temperature Tu) to pd, kg/s (compressible, chokes at sonic). */
export function orifice(A: number, pu: number, pd: number, Tu: number, M: number, gamma: number): number {
  if (A <= 0 || pu <= pd) return 0;
  const Rs = R_GAS / M, r = pd / pu, g = gamma;
  const crit = (2 / (g + 1)) ** (g / (g - 1));
  if (r <= crit) return CD * A * pu * Math.sqrt(g / (Rs * Tu)) * (2 / (g + 1)) ** ((g + 1) / (2 * (g - 1)));
  return CD * A * pu * Math.sqrt(((2 * g) / ((g - 1) * Rs * Tu)) * (r ** (2 / g) - r ** ((g + 1) / g)));
}

const _n = new Float64Array(3);
/** outward normal (area weighted) and centre of the torn cells, or of the puncture's particle */
function holeFrame(b: SoftBody, out: Float64Array): number {
  const X = pool.x, g = b.gas!;
  let nx = 0, ny = 0, nz = 0;
  const cells = g.holeAt >= 0 ? b.p2c[g.holeAt - b.p0] : null;
  for (let c = 0; c < b.nc; c++) {
    if (cells ? !cells.includes(c) : b.cAlive[c]) continue;
    const A = b.c2p[c * 4] * 3, B = b.c2p[c * 4 + 1] * 3, C = b.c2p[c * 4 + 2] * 3, D = b.c2p[c * 4 + 3] * 3;
    const ux = X[C] - X[A], uy = X[C + 1] - X[A + 1], uz = X[C + 2] - X[A + 2];
    const vx = X[D] - X[B], vy = X[D + 1] - X[B + 1], vz = X[D + 2] - X[B + 2];
    nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;
  }
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) return 0;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return l;
}

/**
 * Once per step: heat exchange (T_env in °C), leaks and their thrust, blower, buoyancy, membrane tension.
 * Returns true when the shell bursts.
 */
export function gasStep(b: SoftBody, dt: number, envC: number, gy: number, blowerOn: boolean): boolean {
  const g = b.gas;
  if (!g) return false;
  const X = pool.x, V = pool.v, FL = pool.fl, M = pool.m;
  if (g.tornTopo !== b.topo && b.cArea) {
    g.tornTopo = b.topo;
    let a = 0;
    for (let c = 0; c < b.nc; c++) if (!b.cAlive[c]) a += b.cArea[c];
    g.torn = a;
  }
  const Va = volume(b, null);
  g.V = Math.max(Va, g.V0 * 1e-3);
  if (g.open) { g.p = P_ATM; g.tension = 0; g.leak = 0; g.thrust = 0; return false; }
  // a shell torn this wide open, or squashed flat, holds no gas
  if (g.torn > g.area0 * 0.12 || Va < g.V0 * 0.03) { vent(b); return false; }
  const Te = envC + 273.15;
  g.T += (Te - g.T) * (1 - Math.exp(-dt / g.tau));
  g.p = (g.n * R_GAS * g.T) / g.V;
  const area = g.hole + g.torn;
  // leak (either way), limited to what would equalise this step
  const neq = (P_ATM * g.V) / (R_GAS * g.T);
  let mdot = 0;
  if (area > 0) {
    mdot = g.p >= P_ATM ? orifice(area, g.p, P_ATM, g.T, g.M, g.gamma) : -orifice(area, P_ATM, g.p, 293.15, M_AIR, 1.4);
    let dn = (mdot / g.M) * dt;
    if (Math.abs(dn) > Math.abs(g.n - neq)) dn = g.n - neq;
    g.n -= dn;
    mdot = (dn * g.M) / dt;
  }
  g.leak = mdot;
  if (blowerOn && g.blower > 0) {
    const want = ((P_ATM + g.gauge) * g.V) / (R_GAS * g.T);
    if (g.n < want) g.n = Math.min(want, g.n + ((g.blower * P_ATM) / (R_GAS * 293.15)) * dt);
    // relief dampers: warmed past twice the set point, it bleeds back down
    else if (g.p - P_ATM > 2 * g.gauge) g.n = Math.max(want, g.n - ((g.blower * P_ATM) / (R_GAS * 293.15)) * dt);
  }
  g.p = (g.n * R_GAS * g.T) / g.V;
  if (g.squeeze) {
    // the volume where the gas pressure meets air plus squeeze (bisection; both sides are monotonic)
    let lo = g.V0 / g.stretch ** 3, hi = g.V0 * 1.5;
    const nrt = g.n * R_GAS * g.T;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (nrt / m > P_ATM + squeezeAt(g, m)) lo = m; else hi = m; }
    g.scale = Math.min(1, Math.cbrt(lo / g.V0));
  }
  const dp = g.p - P_ATM;
  // Laplace: T = Δp·R/2, the radius growing with the shell
  g.tension = Math.max(0, (dp * g.R0 * Math.cbrt(g.V / g.V0)) / 2);
  let mass = 0;
  for (let i = b.p0; i < b.p0 + b.n; i++) if (FL[i] & ALIVE && pool.w[i] > 0) mass += M[i];
  if (mass <= 0) return false;
  // buoyancy of the whole closed shell: displaced air less the gas it holds
  let ay = 0;
  if (g.closed) {
    const rhoAir = (P_ATM * M_AIR) / (R_GAS * 293.15);
    ay = (-gy * (rhoAir * g.V - g.n * g.M)) / mass;
  }
  // jet thrust ṁ·v, v from Bernoulli (capped at sonic), pushing the shell away from the hole
  let tx = 0, ty = 0, tz = 0;
  g.thrust = 0;
  if (mdot > 0 && g.closed && holeFrame(b, _n) > 0) {
    const rho = (g.p * g.M) / (R_GAS * g.T);
    const v = Math.min(Math.sqrt((2 * Math.max(0, dp)) / rho), Math.sqrt((g.gamma * R_GAS * g.T) / g.M));
    const F = mdot * v;
    g.thrust = F;
    tx = (-_n[0] * F) / mass; ty = (-_n[1] * F) / mass; tz = (-_n[2] * F) / mass;
  }
  if (ay !== 0 || g.thrust > 0) {
    for (let i = b.p0; i < b.p0 + b.n; i++) {
      if (!(FL[i] & ALIVE) || pool.w[i] === 0) continue;
      V[i * 3] += tx * dt; V[i * 3 + 1] += (ty + ay) * dt; V[i * 3 + 2] += tz * dt;
    }
  }
  const seam = b.fab.seam ?? Infinity;
  const pop = b.fab.pop ?? 0;
  // rubber under tension runs from any tear (a puncture at the thick neck just leaks)
  g.burst = g.tension > seam || (pop > 0 && g.torn > 0 && g.tension > pop * seam);
  void X;
  return g.burst;
}

/** the gas escapes at once (burst, or torn wide): the shell keeps only what it held at ambient pressure */
export function vent(b: SoftBody): void {
  const g = b.gas;
  if (!g) return;
  g.open = true;
  if (g.squeeze) g.scale = 1 / g.stretch;
  g.n = (P_ATM * g.V) / (R_GAS * g.T);
  g.p = P_ATM;
}

export function gasCentroid(): [number, number, number] { return [_cx, _cy, _cz]; }
