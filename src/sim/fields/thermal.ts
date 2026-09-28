import { vec3 } from 'math';
import type { Vec3 } from '../../types';
import { b3, CAT, overlapAABB, entityOfShape } from '../../physics/physics';
import { heat, ignite, douse, type Piece } from '../../destruction/structure';
import { THERMO, BURN, FABRIC_BURN, SHOCK, steelStrain, steelModulus, type Burn } from './props';
import {
  N, F_T, F_O2, F_WAT, F_SMOKE, F_STEAM, amb, brickList, lookup, hit, touch, blocked, polyBox, type Brick,
} from './grid';
import { emitters, FIRE_CLOCK, type Emitter, type FireRec } from './gas';
import { depthAt } from './water';

/* Heat in the solids: conduction across welds, convection and radiation from the gas field and from flames,
   drying, pyrolysis, flashover, thermal expansion and quench cracking. Solids run on their own compressed clock,
   matched to the charring clock (a real minute of fire per second of play would starve every exchange; half that
   keeps steel, timber and linings responding within seconds). */

export const SOLID_CLOCK = 30;
const SIGMA = 5.67e-8;
const FLASH_T = 550;               // °C upper-layer gas: ~20 kW/m² on the floor, the classic flashover criterion
const H_AIR = 10;                  // W/m²K natural convection, still air
const H_FIRE = 25;                 // …in a fire plume / hot layer
const RAD_SOURCES = 24;

export const thermalStats = { flashovers: 0, backdrafts: 0, deflagrations: 0, shocks: 0, conducted: 0 };

const recs = new WeakMap<Piece, FireRec>();
export function recOf(p: Piece): FireRec {
  let r = recs.get(p);
  if (!r) {
    r = { phi: 1, smoulder: false, moist: THERMO[p.mat].moist ?? 0, prevT: p.temp, pyro: 0, wet: 0, q: 0 };
    recs.set(p, r);
  }
  return r;
}
export const peekRec = (p: Piece): FireRec | undefined => recs.get(p);

export function burnOf(p: Piece): Burn | null {
  const f = p.root.spec.soft?.fabric;
  return (f && FABRIC_BURN[f]) || BURN[p.mat] || null;
}

const areaCache = new WeakMap<object, number>();
export function surfaceArea(p: Piece): number {
  let a = areaCache.get(p.poly);
  if (a === undefined) {
    const [mn, mx] = polyBox(p.poly);
    const x = mx[0] - mn[0], y = mx[1] - mn[1], z = mx[2] - mn[2];
    a = 2 * (x * y + y * z + z * x);
    areaCache.set(p.poly, a);
  }
  return a;
}

export function heatCap(p: Piece): number {
  const m = Number.isFinite(p.mass) && p.mass > 0 ? p.mass : p.volume * p.pm.density;
  return Math.max(1, m) * THERMO[p.mat].c;
}

/* Solid share of a member's envelope: a rolled section conducts through its steel, not its bounding box. */
function fill(p: Piece): number {
  const m = Number.isFinite(p.mass) ? p.mass : p.volume * p.pm.density;
  return Math.min(1, Math.max(0.02, m / Math.max(1e-6, p.volume * p.pm.density)));
}

/** Axial thermal strain of a member (EN 1993-1-2 for steel, linear α elsewhere). */
export function thermalStrain(p: Piece): number {
  const t = p.temp;
  if (p.mat === 'steel' || p.mat === 'metal' || p.mat === 'machine') return steelStrain(t);
  return THERMO[p.mat].alpha * (t - 20);
}

/** Stress a fully restrained member would carry from its expansion, Pa (compression positive). */
export function thermalStress(p: Piece): number {
  const kE = p.mat === 'steel' || p.mat === 'metal' || p.mat === 'machine' ? steelModulus(p.temp) : Math.max(0.05, p.heatK);
  return p.pm.eng.E * 1e9 * kE * Math.max(0, thermalStrain(p));
}

/** Flame strength 0..1 of a burning piece (oxygen-limited), 1 when the field is not tracking it. */
export function flameOf(p: Piece): number {
  const r = recs.get(p);
  if (!r) return 1;
  return r.smoulder ? 0 : Math.min(1, r.phi * (1 - 0.5 * Math.min(1, r.wet)));
}

/** Multiplier on the charring rate: pyrolysis follows the flame, a smouldering piece chars slowly. */
export function charRate(p: Piece): number {
  const r = recs.get(p);
  if (!r) return 1;
  return (r.smoulder ? 0.12 : 0.3 + 0.7 * r.phi) * (1 - 0.6 * Math.min(1, r.wet));
}

/* ---------------- emitters (rebuilt each heat tick) ---------------- */

const _aabb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

function addEmitter(p: Piece, kind: 0 | 1 | 2, q: number, mdot: number, burn: Burn | null, clock: number): void {
  if (!touch(p.curPos[0], p.curPos[1], p.curPos[2], kind === 0 ? 4 : 2, clock)) return;
  const i = lookup(p.curPos[0], p.curPos[1], p.curPos[2]);
  if (i < 0) return;
  let list = emitters.get(hit);
  if (!list) { list = []; emitters.set(hit, list); }
  list.push({ p, i, kind, q, mdot, burn, rec: recOf(p) } as Emitter);
}

export function buildEmitters(burning: ReadonlySet<Piece>, hot: ReadonlySet<Piece>, clock: number): void {
  for (const l of emitters.values()) l.length = 0;
  for (const p of burning) {
    if (p.dead || p.curPos[1] < -1) continue;
    const bp = burnOf(p);
    if (!bp) continue;
    const r = recOf(p);
    const A = Math.min(8, surfaceArea(p)) * (1 - 0.6 * p.char);
    const q = bp.hrr * 1e3 * A * FIRE_CLOCK;
    addEmitter(p, 0, q, (r.smoulder ? 0.12 : 1) * q / (bp.dH * 1e6), bp, clock);
  }
  for (const p of hot) {
    if (p.dead || p.burning) continue;
    const bp = burnOf(p);
    if (bp && p.temp > bp.pyro) {
      const r = recOf(p);
      const k = Math.min(2, (p.temp - bp.pyro) / 100);
      r.pyro = Math.min(8, surfaceArea(p)) * 0.004 * k * k * FIRE_CLOCK * (r.moist > 0.02 ? 0.3 : 1);
      addEmitter(p, 1, 0, r.pyro, bp, clock);
    } else if (p.temp > 600) addEmitter(p, 2, 0, 0, null, clock);
  }
}

/* ---------------- gas ⇄ solid exchange (per brick step) ---------------- */

const coupled = new WeakMap<Piece, number>();

function gasNear(b: Brick, near: number, f: number): number {
  const fa = b.f[f];
  if (!blocked(b, near)) return near;
  const x = near % N, y = ((near / N) | 0) % N, z = (near / (N * N)) | 0;
  let best = -1, bt = -Infinity;
  const tryI = (i: number): void => { if (!blocked(b, i) && fa[i] > bt) { bt = fa[i]; best = i; } };
  if (y < N - 1) tryI(near + N);
  if (x > 0) tryI(near - 1);
  if (x < N - 1) tryI(near + 1);
  if (z > 0) tryI(near - N * N);
  if (z < N - 1) tryI(near + N * N);
  if (y > 0) tryI(near - N);
  return best;
}

/** Convective and radiative exchange between each piece and the gas around it, and spray on it. */
export function convect(b: Brick, dt: number, clock: number): void {
  const Ta = amb[F_T];
  const warm = b.maxT > Ta + 8;
  const T = b.f[F_T], W = b.f[F_WAT], sm = b.f[F_SMOKE];
  for (const [p, r] of b.rast) {
    /* a sprinkler bulb's response lag is the services' model */
    if (!r.home || p.dead || p.svc?.part === 'sprinkler') continue;
    if (!warm && p.temp < Ta + 40 && W[r.near] < 1e-4) continue;
    const i = gasNear(b, r.near, F_T);
    if (i < 0) continue;
    coupled.set(p, clock);
    const Tg = T[i], Ts = p.temp;
    const A = surfaceArea(p);
    const eg = Math.min(0.9, 0.15 + sm[i] * 0.8);
    const tg = Tg + 273.15, ts = Ts + 273.15;
    const hr = THERMO[p.mat].eps * eg * SIGMA * (tg * tg + ts * ts) * (tg + ts);
    const Q = ((Tg > Ta + 60 ? H_FIRE : H_AIR) + hr) * A * (Tg - Ts);
    const C = heatCap(p);
    let dTs = (Q * dt * SOLID_CLOCK) / C;
    if (Math.abs(dTs) > Math.abs(Tg - Ts) * 0.5) dTs = (Tg - Ts) * 0.5;
    if (dTs > 0.05) heat(p, dTs);
    else if (dTs < -0.05) p.temp += dTs;
    const Cg = 355e3 / tg;
    const dTg = Math.min(Math.abs(Tg - Ts) * 0.3, (Math.abs(Q) * dt * FIRE_CLOCK) / Cg);
    T[i] -= Math.sign(Q) * dTg;
    const w = W[i];
    if (w > 5e-4) {
      /* droplets striking the piece: they boil off a hot surface, soak a burning one */
      const rec = recOf(p);
      rec.wet = Math.min(2, rec.wet + w * dt * 40);
      if (p.temp > 100) {
        const m = Math.min(w, w * dt * 4);
        W[i] -= m;
        p.temp -= Math.min(p.temp - 60, (m * 2.6e6 * SOLID_CLOCK) / C);
        b.f[F_STEAM][i] += m / 0.018 / (12187 / tg);
      }
      if (p.burning && rec.wet > 0.6) douse(p);
    }
  }
}

/* ---------------- heat tick (0.25 s) ---------------- */

const doneWelds = new Set<object>();
let radCursor = 0;
const radSrc: Piece[] = [];
const _d: Vec3 = [0, 0, 0];

/** Returns pieces cracked by quenching this tick; the caller fractures glass and spalls concrete. */
export function thermalTick(dt: number, burning: ReadonlySet<Piece>, hot: Set<Piece>, clock: number, rain: number, spread: boolean): Piece[] {
  const Ta = amb[F_T];
  buildEmitters(burning, hot, clock);
  doneWelds.clear();

  /* conduction across welded contacts: G = k·A/L between centres, A the weld's face times the section's fill */
  for (const p of hot) {
    if (p.dead) continue;
    const ta = THERMO[p.mat];
    for (const w of p.welds) {
      if (doneWelds.has(w)) continue;
      doneWelds.add(w);
      const q = w.a === p ? w.b : w.a;
      if (p.svc?.part === 'sprinkler' || q?.svc?.part === 'sprinkler') continue;
      const Tq = q ? q.temp : Ta;
      const dT = p.temp - Tq;
      if (Math.abs(dT) < 2) continue;
      const kq = q ? THERMO[q.mat].k : 1.5;
      const k = (2 * ta.k * kq) / (ta.k + kq);
      const L = q ? Math.max(0.1, vec3.distance(p.curPos, q.curPos)) : Math.max(0.1, Math.cbrt(p.volume) * 0.5);
      const A = w.area * Math.min(fill(p), q ? fill(q) : 1);
      const Cp = heatCap(p), Cq = q ? heatCap(q) : Infinity;
      const Ceff = q ? (Cp * Cq) / (Cp + Cq) : Cp;
      let Q = ((k * A) / L) * dT * dt * SOLID_CLOCK;
      const lim = 0.45 * Math.abs(dT) * Ceff;
      if (Math.abs(Q) > lim) Q = Math.sign(Q) * lim;
      p.temp -= Q / Cp;
      if (q) {
        if (Q > 0) heat(q, Q / Cq); else q.temp += Q / Cq;
      }
      thermalStats.conducted += Math.abs(Q);
    }
  }

  /* radiation from flames and glowing surfaces: point source, received on the projected area facing it */
  radSrc.length = 0;
  for (const p of burning) if (!p.dead && flameOf(p) > 0.1) radSrc.push(p);
  for (const p of hot) if (!p.dead && !p.burning && p.temp > 500) radSrc.push(p);
  const nr = spread ? Math.min(RAD_SOURCES, radSrc.length) : 0;
  const share = radSrc.length / Math.max(1, nr);
  for (let s = 0; s < nr; s++) {
    const src = radSrc[(radCursor + s) % radSrc.length];
    const rec = peekRec(src);
    const P = src.burning
      ? 0.3 * ((rec && rec.q > 0 ? rec.q : (burnOf(src)?.hrr ?? 150) * 1e3 * Math.min(8, surfaceArea(src)) * FIRE_CLOCK) / FIRE_CLOCK)
      : THERMO[src.mat].eps * SIGMA * ((src.temp + 273.15) ** 4 - (Ta + 273.15) ** 4) * surfaceArea(src) * 0.5;
    if (P < 2e3) continue;
    const R = Math.min(8, Math.sqrt(P / (4 * Math.PI * 2e3)));
    const c = src.curPos;
    overlapAABB([c[0] - R, c[1] - R, c[2] - R], [c[0] + R, c[1] + R, c[2] + R], CAT.structure | CAT.debris | CAT.prop, shape => {
      const e = entityOfShape(shape);
      if (!e || e.kind !== 'piece' || e === src) return;
      const q = e as Piece;
      if (q.dead || q.burning) return;
      vec3.sub(_d, q.curPos, c);
      const d = Math.max(0.4, vec3.length(_d) - 0.3 * Math.cbrt(src.volume));
      if (d > R) return;
      vec3.normalize(_d, _d);
      const flux = P / (4 * Math.PI * d * d);
      const Q = THERMO[q.mat].eps * flux * projArea(q, _d) * share;
      const dT = (Q * dt * SOLID_CLOCK) / heatCap(q);
      if (dT > 0.05) heat(q, Math.min(dT, Math.max(0, src.temp - q.temp) * 0.3));
    });
  }
  radCursor += nr;

  /* drying, flashover, quench, cooling where no gas tracks the piece */
  const cracked: Piece[] = [];
  for (const p of hot) {
    if (p.dead) continue;
    const r = recOf(p);
    if (r.moist > 0 && p.temp > 100) {
      const C = heatCap(p), m = C / THERMO[p.mat].c;
      const dm = Math.min(r.moist * m, ((p.temp - 100) * C) / 2.26e6);
      r.moist -= dm / m;
      p.temp = 100 + Math.max(0, (p.temp - 100) * C - dm * 2.26e6) / C;
    }
    if (p.burning) {
      if (r.phi < 0.08) r.smoulder = true;
      else if (r.phi > 0.3) r.smoulder = false;
      if (rain > 0 && ((p.id * 2654435761 + radCursor * 97) >>> 0) / 4294967296 < rain * 0.05 && skyward(p)) { r.wet += rain; douse(p); }
    }
    const t = coupled.get(p);
    if ((t === undefined || clock - t > 0.4) && !p.burning && p.temp > Ta) {
      const ts = p.temp + 273.15, ta = Ta + 273.15;
      const h = H_AIR + THERMO[p.mat].eps * SIGMA * (ts * ts + ta * ta) * (ts + ta) + rain * 40;
      const C = heatCap(p);
      p.temp -= Math.min(p.temp - Ta, (h * surfaceArea(p) * (p.temp - Ta) * dt * SOLID_CLOCK) / C);
    }
    const sh = SHOCK[p.mat];
    if (sh && r.prevT > sh[1] && r.prevT - p.temp > sh[0]) { cracked.push(p); thermalStats.shocks++; }
    r.prevT = p.temp;
    if (p.burning && depthAt(p.curPos[0], p.curPos[2], p.curPos[1]) > 0.08) douse(p);
  }

  /* flashover: once the hot layer under a ceiling averages past FLASH_T its radiation ignites every combustible
     beneath it, whatever it is */
  let layers = 2;
  if (spread) for (let k = 0; k < brickList.length && layers > 0; k++) {
    const b = brickList[(flashCursor + k) % brickList.length];
    if (b.maxT < FLASH_T) continue;
    layers--;
    const cols = hotLayer(b);
    if (!cols) continue;
    let lit = 0;
    for (const bb of brickList) for (const [p, r] of bb.rast) {
      if (!r.comb || !r.home || p.burning || p.dead) continue;
      const k = colKey(Math.floor(p.curPos[0]), Math.floor(p.curPos[2]));
      const floor = cols.get(k);
      if (floor !== undefined && p.curPos[1] < floor) { ignite(p); lit++; }
    }
    if (lit > 0) thermalStats.flashovers++;
  }
  flashCursor++;
  return cracked;
}
let flashCursor = 0;

const colKey = (x: number, z: number): number => (x + 4096) * 8192 + (z + 4096);
const _q: number[] = [];
const _seen = new Set<number>();
/* The hot layer round the brick's hottest cell: open cells above 150 °C connected to it (the room it fills). Returns the columns it
   covers (and the layer's underside in each) when its cells above 300 °C average past FLASH_T. */
function hotLayer(b: Brick): Map<number, number> | null {
  const T = b.f[F_T];
  let best = -1;
  for (let i = 0; i < T.length; i++) if (!blocked(b, i) && (best < 0 || T[i] > T[best])) best = i;
  if (best < 0 || T[best] < FLASH_T) return null;
  _q.length = 0; _seen.clear();
  const x0 = b.ox + (best % N), y0 = b.oy + (((best / N) | 0) % N), z0 = b.oz + ((best / (N * N)) | 0);
  const key = (x: number, y: number, z: number): number => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
  _q.push(x0, y0, z0); _seen.add(key(x0, y0, z0));
  let sum = 0, n = 0;
  const cols = new Map<number, number>();
  for (let h = 0; h < _q.length && h < 9000; h += 3) {
    const x = _q[h], y = _q[h + 1], z = _q[h + 2];
    const i = lookup(x + 0.5, y + 0.5, z + 0.5);
    if (i < 0 || blocked(hit, i)) continue;
    const t = hit.f[F_T][i];
    if (t < 150) continue;
    if (t >= 300) { sum += t; n++; }
    const c = colKey(x, z);
    cols.set(c, Math.min(cols.get(c) ?? Infinity, y));
    for (const [dx, dy, dz] of NB6) {
      const k = key(x + dx, y + dy, z + dz);
      if (_seen.has(k)) continue;
      _seen.add(k);
      _q.push(x + dx, y + dy, z + dz);
    }
  }
  if (n < 4 || sum / n < FLASH_T - 60) return null;
  return cols;
}
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function skyward(p: Piece): boolean {
  for (let y = p.curPos[1] + 1; y < p.curPos[1] + 12; y += 1) {
    const i = lookup(p.curPos[0], y, p.curPos[2]);
    if (i < 0) return true;
    if (blocked(hit, i) && !hit.rast.has(p)) return false;
  }
  return true;
}

/* Area of a piece's box seen along d. */
function projArea(p: Piece, d: Vec3): number {
  const [mn, mx] = polyBox(p.poly);
  const x = mx[0] - mn[0], y = mx[1] - mn[1], z = mx[2] - mn[2];
  const q = p.curRot;
  // rotate d into the body frame (conjugate quaternion)
  const ix = -q[0], iy = -q[1], iz = -q[2], iw = q[3];
  const tx = 2 * (iy * d[2] - iz * d[1]), ty = 2 * (iz * d[0] - ix * d[2]), tz = 2 * (ix * d[1] - iy * d[0]);
  const lx = d[0] + iw * tx + (iy * tz - iz * ty), ly = d[1] + iw * ty + (iz * tx - ix * tz), lz = d[2] + iw * tz + (ix * ty - iy * tx);
  return Math.abs(lx) * y * z + Math.abs(ly) * x * z + Math.abs(lz) * x * y;
}

export function o2At(p: Piece): number {
  const i = lookup(p.curPos[0], p.curPos[1], p.curPos[2]);
  return i < 0 ? amb[F_O2] : hit.f[F_O2][i];
}
