import { vec3 } from 'math';
import type { Vec3 } from '../../types';
import { b3, raycast, randomStream, stepCount, FIXED_DT } from '../../physics/physics';
import { heat, ignite, pieceOf, burningPieces, type Piece } from '../../destruction/structure';
import { flammable } from '../../destruction/materials';
import { addHeat, addSmoke, addGas, spark, sampleField } from '../../sim/fields/index';
import { heatCap, surfaceArea } from '../../sim/fields/thermal';
import { THERMO } from '../../sim/fields/props';
import { groundAt } from '../../terrain/terrain';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { NO_HIT, piecesNear } from '../tools/common';

/* Burning liquid fuel, shared by the flamethrower and the firebomb: globs in flight on a ballistic path with drag,
   a share of each that clings where it lands (thickened fuel sticks to walls and ceilings, petrol mostly runs off),
   the rest running down to a pool that spreads to a film and burns at the fuel's mass-loss rate. Burning fuel heats
   what it touches (flame contact) and what faces it (radiation) through the solids' own heat capacity, so timber
   catches in seconds, masonry only spalls, and steel warms slowly; the flame's heat and soot go into the gas field.
   Unlit fuel (a wet shot) lies until a flame, a burning member or hot gas reaches it, then flashes over the slick. */

export interface FuelKind {
  name: string;
  /** kg/m³ */ rho: number;
  /** effective heat of combustion, J/kg */ dHc: number;
  /** mass-loss rate of a large pool, kg/m²·s */ burn: number;
  /** film a spill spreads to on a flat surface, m */ film: number;
  /** share of a glob that clings to a steep face instead of running down */ stick: number;
  /** soot yield, kg/kg */ soot: number;
  /** evaporation of an unlit film, kg/m²·s */ evap: number;
  /** share of a lit glob's mass that burns off per second in flight */ airBurn: number;
}

/* Thickened flamethrower fuel (gasoline gelled with ~4-6 % M4 thickener): sticky, slow to burn, very sooty. */
/* Gel does not run out to a film: it lies in gobs a few mm thick and burns for minutes where it lands (TM 3-376A). */
export const GEL: FuelKind = { name: 'thickened fuel', rho: 800, dHc: 42e6, burn: 0.04, film: 0.003, stick: 0.75, soot: 0.1, evap: 1e-4, airBurn: 0.12 };
/* Petrol (a Molotov): runs off walls, spreads thin, burns hot and fast. SFPE: 0.055 kg/m²·s, 43.7 MJ/kg. */
export const PETROL: FuelKind = { name: 'petrol', rho: 740, dHc: 43.7e6, burn: 0.055, film: 0.001, stick: 0.15, soot: 0.04, evap: 8e-4, airBurn: 0.25 };

const MAX_GLOBS = 160, MAX_SPLATS = 72, MAX_POOLS = 44;
const TICK = 0.2;
/* flame contact flux on what the fire engulfs (large hydrocarbon pool fires: 50-150 kW/m²), and the radiated share */
const CONTACT = 70e3, CHI_R = 0.35;
const POOL_MAX = 9;            // m²: one pool record; more fuel there thickens it or starts a neighbour
const SPREAD = 1.4;            // m/s the flame runs across an unlit slick

interface Glob { pos: Vec3; vel: Vec3; kg: number; kind: FuelKind; lit: boolean; age: number; drag: number; seen?: Vec3 }
interface Patch {
  pos: Vec3; n: Vec3; kg: number; kind: FuelKind; lit: boolean; host: Piece | null; lp: Vec3 | null;
  pool: boolean; area: number; tick: number; burnt: number; litAt: number;
}

const globs: Glob[] = [];
const patches: Patch[] = [];
const rnd = randomStream(0xf1a3e);
let now = 0;
let fxT = 0;
export const fuelStats = { released: 0, burnt: 0, splats: 0, pools: 0, ignitions: 0, peakMW: 0, MW: 0 };

export function clearFuel(): void {
  globs.length = 0;
  patches.length = 0;
  now = 0;
  for (const k of Object.keys(fuelStats) as (keyof typeof fuelStats)[]) fuelStats[k] = 0;
}

/** A glob of fuel leaving a nozzle or a broken bottle. drag: 1/m (quadratic, per unit mass). */
export function launchFuel(pos: Vec3, vel: Vec3, kg: number, kind: FuelKind, lit: boolean, drag: number): void {
  if (kg <= 0) return;
  if (globs.length >= MAX_GLOBS) globs.shift();
  globs.push({ pos: [...pos], vel: [...vel], kg, kind, lit, age: 0, drag });
  fuelStats.released += kg;
}

export function fuelInFlight(): number { return globs.length; }
export function fuelBurning(): number { let n = 0; for (const p of patches) if (p.lit) n++; return n; }
export function fuelPatches(): readonly { pos: Vec3; kg: number; lit: boolean; pool: boolean; area: number }[] { return patches; }

const _o: Vec3 = [0, 0, 0], _d: Vec3 = [0, 0, 0];

/** One physics step: flight, landing, burning, heating, spread. */
export function fuelStep(dt: number): void {
  now += dt;
  for (let i = globs.length - 1; i >= 0; i--) {
    const g = globs[i];
    g.age += dt;
    const s = vec3.length(g.vel);
    g.vel[0] -= g.drag * s * g.vel[0] * dt;
    g.vel[1] -= (g.drag * s * g.vel[1] + 9.81) * dt;
    g.vel[2] -= g.drag * s * g.vel[2] * dt;
    vec3.scale(_d, g.vel, dt);
    const hit = raycast(g.pos, _d, NO_HIT);
    if (g.lit) {
      const burnt = g.kg * Math.min(1, g.kind.airBurn * dt);
      g.kg -= burnt;
      fuelStats.burnt += burnt;
      if ((stepCount + i) % 6 === 0) addHeat(g.pos, (burnt / dt) * g.kind.dHc * 0.6, dt * 6);
    }
    if (hit) {
      globs.splice(i, 1);
      land(g, hit.point as Vec3, hit.normal as Vec3, pieceOf(hit.entity));
      continue;
    }
    vec3.add(g.pos, g.pos, _d);
    const gy = groundAt(g.pos[0], g.pos[2]);
    if (g.pos[1] <= gy || g.age > 4 || g.kg < 1e-4) {
      globs.splice(i, 1);
      if (g.pos[1] <= gy + 0.05 && g.kg >= 1e-4) land(g, [g.pos[0], gy, g.pos[2]], [0, 1, 0], null);
    }
  }
  for (const p of patches) {
    p.tick -= dt;
    if (p.tick > 0) continue;
    p.tick += TICK;
    tickPatch(p, TICK);
  }
  for (let i = patches.length - 1; i >= 0; i--) if (patches[i].kg < 2e-3) patches.splice(i, 1);
  let MW = 0;
  for (const p of patches) if (p.lit) MW += (burnRate(p) * p.kind.dHc) / 1e6;
  fuelStats.MW = MW;
  fuelStats.peakMW = Math.max(fuelStats.peakMW, MW);
}

const burnRate = (p: Patch): number => p.kind.burn * p.area;

/* A glob reaches a surface: what clings stays there, the rest runs down to the floor below. */
function land(g: Glob, point: Vec3, n: Vec3, host: Piece | null): void {
  const up = n[1];
  if (up > 0.55) { addPatch(point, n, g.kg, g.kind, g.lit, host, true); return; }
  const cling = g.kg * (up < -0.5 ? g.kind.stick * 0.8 : g.kind.stick);
  if (cling > 1e-4) addPatch(point, n, cling, g.kind, g.lit, host, false);
  const rest = g.kg - cling;
  if (rest < 1e-4) return;
  vec3.set(_o, point[0] + n[0] * 0.06, point[1] + n[1] * 0.06, point[2] + n[2] * 0.06);
  const down = raycast(_o, [0, -30, 0], NO_HIT);
  const gy = groundAt(_o[0], _o[2]);
  if (down && down.point[1] >= gy - 0.01) addPatch(down.point as Vec3, down.normal as Vec3, rest, g.kind, g.lit, pieceOf(down.entity), true);
  else if (Number.isFinite(gy)) addPatch([_o[0], gy, _o[2]], [0, 1, 0], rest, g.kind, g.lit, null, true);
}

function addPatch(point: Vec3, n: Vec3, kg: number, kind: FuelKind, lit: boolean, host: Piece | null, pool: boolean): void {
  if (host && (host.dead || host.fade > 0)) host = null;
  let best: Patch | null = null, bd = Infinity;
  for (const p of patches) {
    if (p.pool !== pool || p.host !== host || p.kind !== kind) continue;
    const reach = pool ? Math.max(0.5, Math.sqrt(p.area / Math.PI)) : 0.35;
    const d = vec3.distance(p.pos, point);
    if (d < reach && d < bd && (pool ? p.area < POOL_MAX : true)) { best = p; bd = d; }
  }
  if (!best && patches.length >= (pool ? MAX_POOLS + MAX_SPLATS : MAX_SPLATS + MAX_POOLS)) {
    // full: the nearest of its kind takes the fuel
    for (const p of patches) { const d = vec3.distance(p.pos, point); if (p.pool === pool && d < bd) { best = p; bd = d; } }
  }
  if (best) {
    const w = kg / (best.kg + kg);
    for (let k = 0; k < 3; k++) best.pos[k] += (point[k] - best.pos[k]) * w;
    best.kg += kg;
    if (lit && !best.lit) light(best);
    spreadTo(best);
    return;
  }
  const p: Patch = {
    pos: [...point], n: [...n], kg, kind, lit: false, host, lp: null, pool, area: 0, tick: rnd() * TICK, burnt: 0, litAt: -1,
  };
  if (host) { p.lp = [0, 0, 0]; b3.b3Body_GetLocalPoint(p.lp, host.body, point); }
  spreadTo(p);
  patches.push(p);
  if (pool) fuelStats.pools++; else fuelStats.splats++;
  if (lit) light(p);
}

/* the film it spreads to: a pool out to its film thickness (up to POOL_MAX), a splat as a thicker smear */
function spreadTo(p: Patch): void {
  const film = p.pool ? p.kind.film : p.kind.film * 2;
  p.area = Math.min(p.pool ? POOL_MAX : 1.2, Math.max(0.02, p.kg / (p.kind.rho * film)));
}

function light(p: Patch): void {
  if (p.lit) return;
  p.lit = true;
  p.litAt = now;
  fuelStats.ignitions++;
  if (p.pool && p.area > 0.8) audio.firebomb(p.pos);
}

/* Heat a solid's exposed skin: q'' W/m² over area A for dt, into the thermal penetration depth of its material
   (δ ≈ 2√(α·10 s), a few mm in timber and masonry, the whole section in thin steel). */
export function heatSkin(q: Piece, flux: number, A: number, dt: number): void {
  const th = THERMO[q.mat];
  const alpha = th.k / (Math.max(100, q.pm.density) * th.c);
  const delta = 2 * Math.sqrt(alpha * 10);
  const skin = Math.max(1, q.pm.density * th.c * A * delta);
  const C = Math.min(heatCap(q), skin);
  // a surface heated by flux q'' cannot run hotter than the temperature at which it re-radiates all of it (ε 0.9)
  const cap = Math.pow(flux / (0.9 * 5.67e-8), 0.25) - 273;
  heat(q, Math.min((flux * A * dt) / C, Math.max(0, cap - q.temp)));
}

const _near: Vec3 = [0, 0, 0];
function tickPatch(p: Patch, dt: number): void {
  // stuck to a member: ride with it; the member gone, the fuel falls away
  if (p.host) {
    if (p.host.dead) {
      p.host = null; p.lp = null;
      if (!p.pool || p.pos[1] > groundAt(p.pos[0], p.pos[2]) + 0.1) {
        const g: Glob = { pos: [...p.pos], vel: [0, -1, 0], kg: p.kg, kind: p.kind, lit: p.lit, age: 0, drag: 0.03 };
        p.kg = 0;
        globs.push(g);
        return;
      }
    } else if (p.lp) b3.b3Body_GetWorldPoint(p.pos, p.host.body, p.lp);
  }
  if (!p.lit) {
    // a flame, an ember or hot gas at the slick lights it
    if (sampleField(p.pos, 'T') > 280 || sampleField(p.pos, 'flame') > 0) light(p);
    else {
      for (const b of burningPieces()) if (!b.dead && vec3.distance(b.curPos, p.pos) < 0.6 + Math.cbrt(b.volume)) { light(p); break; }
    }
    if (!p.lit) {
      const e = Math.min(p.kg, p.kind.evap * p.area * dt);
      if (e > 0) { p.kg -= e; addGas([p.pos[0], p.pos[1] + 0.3, p.pos[2]], e / dt, 'propane', dt); }
      return;
    }
  }
  const m = Math.min(p.kg, burnRate(p) * dt);
  p.kg -= m;
  p.burnt += m;
  fuelStats.burnt += m;
  if (p.pool && p.kg < p.kind.rho * p.kind.film * p.area) spreadTo(p);
  const Q = (m / dt) * p.kind.dHc;
  const R = Math.sqrt(p.area / Math.PI), D = 2 * R;
  // Heskestad flame height, m (Q in kW)
  const Hf = Math.max(0.3, 0.235 * Math.pow(Q / 1e3, 0.4) - 1.02 * D);
  vec3.set(_near, p.pos[0] + p.n[0] * 0.2, p.pos[1] + Math.max(0.2, p.n[1] * Hf * 0.4), p.pos[2] + p.n[2] * 0.2);
  // the plume's heat and soot go in up the flame's own height, not into one cell
  const cells = Math.max(1, Math.min(4, Math.ceil(Hf)));
  for (let c = 0; c < cells; c++) {
    const h: Vec3 = [_near[0], _near[1] + c, _near[2]];
    // a flame's gases run ~1000-1200 °C: past that the cell is already all flame and more heat goes up and away
    if (sampleField(h, 'T') < 1050) addHeat(h, (Q * (1 - CHI_R)) / cells, dt);
    addSmoke(h, ((m / dt) * p.kind.soot * 1000) / cells, 0.95, dt);
  }
  spark(_near, dt * 1.5);
  const reach = R + Math.max(1.2, Hf * 0.6);
  for (const { p: q, d, cp } of piecesNear(_near, reach)) {
    if (q.dead) continue;
    const inFlame = d < R + 0.3 || (p.host === q);
    const flux = inFlame ? CONTACT : (CHI_R * Q) / (4 * Math.PI * Math.max(0.25, d * d));
    const A = inFlame ? Math.min(surfaceArea(q) * 0.5, p.area + D * Hf * 0.5) : Math.min(surfaceArea(q) / 6, 2);
    heatSkin(q, flux, A, dt);
    if (inFlame && flammable(q.pm) && q.pm.explosive) ignite(q);
    void cp;
  }
  // the flame runs across a neighbouring slick
  for (const o of patches) {
    if (o.lit || o === p) continue;
    const d = vec3.distance(o.pos, p.pos) - R - Math.sqrt(o.area / Math.PI);
    if (d < SPREAD * (now - p.litAt + dt)) light(o);
  }
}

/* Water on burning fuel: a straight stream scatters it, a fog knocks the flame down. */
export function douseFuel(pos: Vec3, r: number): void {
  for (const p of patches) {
    if (!p.lit || vec3.distance(p.pos, pos) > r + Math.sqrt(p.area / Math.PI)) continue;
    p.lit = false;
    fx.dust(p.pos, 1, 0xe8eef2);
  }
}

/** Once per rendered frame: flames on the stream and the fires, their light. */
export function syncFuel(dt: number): void {
  for (const g of globs) {
    const from = g.seen ??= [g.pos[0] - g.vel[0] / 60, g.pos[1] - g.vel[1] / 60, g.pos[2] - g.vel[2] / 60];
    fx.fuelGlob(from, g.pos, g.vel, g.lit, g.age);
    vec3.copy(from, g.pos);
  }
  fxT -= dt;
  if (fxT > 0) return;
  fxT = 0.2;
  let lx = 0, ly = 0, lz = 0, lw = 0;
  for (const p of patches) {
    const Q = p.lit ? burnRate(p) * p.kind.dHc : 0;
    const R = Math.sqrt(p.area / Math.PI);
    const Hf = p.lit ? Math.max(0.3, 0.235 * Math.pow(Q / 1e3, 0.4) - 2.04 * R) : 0;
    fx.fuelFire(p.pos, Math.max(0.25, R * 1.6), Hf, p.lit);
    if (p.lit) { lx += p.pos[0] * Q; ly += (p.pos[1] + Hf * 0.5) * Q; lz += p.pos[2] * Q; lw += Q; audio.burn(p.pos, Math.min(1.5, Q / 1e6)); }
  }
  for (const g of globs) if (g.lit) { const w = 5e4; lx += g.pos[0] * w; ly += g.pos[1] * w; lz += g.pos[2] * w; lw += w; }
  if (lw > 0) fx.fireLight([lx / lw, ly / lw, lz / lw], lw / 1e6);
}

/** Headless/test view. */
export function fuelDebug(): { globs: number; patches: { pos: Vec3; kg: number; lit: boolean; pool: boolean; area: number; host: boolean }[] } {
  return { globs: globs.length, patches: patches.map(p => ({ pos: [...p.pos] as Vec3, kg: p.kg, lit: p.lit, pool: p.pool, area: p.area, host: !!p.host })) };
}

export const FUEL_DT = FIXED_DT;
