import type { Vec3 } from '../../types';
import { fx } from '../../render/fx';
import { explode, windVector, type Piece } from '../../destruction/structure';
import {
  N, N3, F_T, F_SMOKE, F_DARK, F_O2, F_CH4, F_C3H8, F_FUEL, F_STEAM, F_CO, F_WAT, F_U, F_V, F_W, F_P, F_BURN, F_PK,
  amb, bricks, brickList, allocBrick, freeBrick, clearBricks, linkNeighbours, touch, lookup, hit, blocked, refreshOcc, scanBrick,
  type Brick,
} from './grid';
import { stepBrick, spill, emitters, sparks, defl, setPour, gasStats, FIRE_CLOCK, CH4, C3H8, PYRO, FLAME_MEMORY } from './gas';
import { convect, thermalTick, thermalStats, SOLID_CLOCK } from './thermal';
import { addWaterAt, stepWater, clearWater, waterStats, tiles } from './water';
import { survey as blastSurvey, pso, POWER_PER_KG, type Survey } from './blast';

export { thermalStrain, thermalStress, flameOf, charRate, recOf, surfaceArea } from './thermal';
export { loadFactors, paneLoad, glassRange, glassBreaks, paneCapacity, inRoom, vent, pso, iso, cr, POWER_PER_KG, type Survey } from './blast';
export { isFragile } from './grid';
export { depthAt, tiles as waterTiles, CELL as WATER_CELL, TN as WATER_TN } from './water';
export { FIRE_CLOCK, SOLID_CLOCK };

/* The multiphysics field around the action: gas (temperature, smoke, species, flow) in sparse bricks, shallow
   water on the surfaces, heat in the solids. Everything idles to nothing when nothing burns, leaks or blows. */

export type Species = 'methane' | 'propane' | 'steam' | 'co' | 'smoke' | 'air';

/* own stream: the field's jitter must not perturb the game's seeded randomness */
const RS0 = 0x2545f491;
let rs = RS0;
const rnd = (): number => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };

const FIELD_DT = 0.1;
const BUDGET_MS = 1.4;
const BRICK_MS = 4;             // a brick step's typical cost (16³ voxels of gas, convection)
const SPILL_CAP = 14;
const RETIRE = 4;
const MOL: Record<Species, number> = { methane: 0.016, propane: 0.044, steam: 0.018, co: 0.028, smoke: 0, air: 0.029 };

let clock = 0;
let cursor = 0;
let smokeT = 0;
let waterT = 0;
let rain = 0;
let deflT = -1;
let deflCool = 0;
let frontIdle = 0;
let frontRate = 0, frontBase = 0;
let credit = 0;
const pending: Brick[] = [];

export const fieldCost = { ms: 0, steps: 0, brickSteps: 0, peak: 0, blastMs: 0, blasts: 0, heatMs: 0, brickMax: 0 };
export const fieldCounters = thermalStats;

setPour((x, y, z, kg) => addWaterAt(x, y, z, kg));

function openVoxel(x: number, y: number, z: number): number {
  let i = lookup(x, y, z);
  if (i < 0) return -1;
  if (!blocked(hit, i)) return i;
  for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
    i = lookup(x + dx, y + dy, z + dz);
    if (i >= 0 && !blocked(hit, i)) return i;
  }
  return -1;
}

const molDensity = (T: number): number => 12187 / (T + 273.15);

/** Release gas at a rate (kg/s) for dt seconds (one physics step by default). Methane rises, propane pools. The
 * gas displaces the air it lands in. Services' leak accumulation feeds this. */
export function addGas(pos: Vec3, kgPerS: number, species: Species, dt = 1 / 60): void {
  if (!(kgPerS > 0)) return;
  touch(pos[0], pos[1], pos[2], 2, clock);
  const i = openVoxel(pos[0], pos[1], pos[2]);
  if (i < 0) return;
  const f = hit.f, m = kgPerS * dt;
  if (species === 'smoke') { f[F_SMOKE][i] += m * 1000; return; }
  const dx = Math.min(0.9, m / MOL[species] / molDensity(f[F_T][i]));
  const keep = 1 - dx;
  for (const k of [F_O2, F_CH4, F_C3H8, F_FUEL, F_STEAM, F_CO]) f[k][i] *= keep;
  if (species === 'methane') f[F_CH4][i] += dx;
  else if (species === 'propane') f[F_C3H8][i] += dx;
  else if (species === 'steam') f[F_STEAM][i] += dx;
  else if (species === 'co') f[F_CO][i] += dx;
  else f[F_O2][i] += dx * amb[F_O2];
}

/** Smoke (g/s of soot, blackness 0..1) and sensible heat (W) into the gas, e.g. from burning cloth. */
export function addSmoke(pos: Vec3, gPerS: number, dark: number, dt = 1 / 60): void {
  touch(pos[0], pos[1], pos[2], 2, clock);
  const i = openVoxel(pos[0], pos[1], pos[2]);
  if (i < 0) return;
  hit.f[F_SMOKE][i] += gPerS * dt;
  hit.f[F_DARK][i] += gPerS * dt * dark;
}
export function addHeat(pos: Vec3, watts: number, dt = 1 / 60): void {
  touch(pos[0], pos[1], pos[2], 2, clock);
  const i = openVoxel(pos[0], pos[1], pos[2]);
  if (i < 0) return;
  const T = hit.f[F_T][i];
  hit.f[F_T][i] = Math.min(2000, T + (watts * dt * FIRE_CLOCK * (T + 273.15)) / 355e3);
}

/** Spray (kg/s of droplets) from `pos` along `dir`: it falls through the gas, boils off in hot layers, cools and
 * soaks what it lands on and collects as surface water. Sprinkler heads and burst water pipes feed this. */
export function addWaterSpray(pos: Vec3, dir: Vec3, kgPerS: number, dt = 1 / 60): void {
  if (!(kgPerS > 0)) return;
  touch(pos[0], pos[1], pos[2], 2, clock);
  const m = kgPerS * dt;
  const spots = 5;
  for (let s = 0; s < spots; s++) {
    const a = (s / spots) * Math.PI * 2, r = s === 0 ? 0 : 1.1;
    const x = pos[0] + dir[0] * 0.6 + Math.cos(a) * r, y = pos[1] + dir[1] * 0.6, z = pos[2] + dir[2] * 0.6 + Math.sin(a) * r;
    const i = openVoxel(x, y, z);
    if (i >= 0) hit.f[F_WAT][i] += m / spots;
    else addWaterAt(x, y, z, m / spots);
  }
}

/** Bulk water onto the surface below (burst main, tank): it runs downhill, pools and pours off edges. */
export function addWater(pos: Vec3, kgPerS: number, dt = 1 / 60): void {
  addWaterAt(pos[0], pos[1], pos[2], kgPerS * dt);
}

/** An electric arc, spark or pilot flame: ignites a flammable mixture in its voxel for `life` seconds. */
export function spark(pos: Vec3, life = 0.3): void {
  touch(pos[0], pos[1], pos[2], 2, clock);
  sparks.push({ x: pos[0], y: pos[1], z: pos[2], t: life });
}

export function setRain(r: number): void { rain = Math.max(0, Math.min(1, r)); }

/** Field value at a point (ambient where nothing is tracked). */
export function sampleField(pos: ArrayLike<number>, f: 'T' | 'smoke' | 'dark' | 'o2' | 'methane' | 'propane' | 'fuel' | 'steam' | 'co' | 'water' | 'p' | 'flame' | 'blast' | 'u' | 'v' | 'w'): number {
  const k = { T: F_T, smoke: F_SMOKE, dark: F_DARK, o2: F_O2, methane: F_CH4, propane: F_C3H8, fuel: F_FUEL, steam: F_STEAM, co: F_CO, water: F_WAT, p: F_P, flame: F_BURN, blast: F_PK, u: F_U, v: F_V, w: F_W }[f];
  const i = lookup(pos[0], pos[1], pos[2]);
  if (i < 0) return f === 'u' || f === 'w' ? 0 : amb[k];
  if (k === F_P) return (hit.f[F_P][i] * 353) / (hit.f[F_T][i] + 273.15) / FIELD_DT;
  /* below zero F_BURN is a burnt-out cell's memory of its flame, not flame */
  if (k === F_BURN) return Math.max(0, hit.f[k][i]);
  return hit.f[k][i];
}

/** Heat exchange, pyrolysis, drying, flashover and quench (called on the structure's 0.25 s heat tick). */
export function fieldsHeatTick(dt: number, burning: ReadonlySet<Piece>, hot: Set<Piece>, spread = true): Piece[] {
  if (!burning.size && !hot.size && !brickList.length) return [];
  const t0 = performance.now();
  const r = thermalTick(dt, burning, hot, clock, rain, spread);
  fieldCost.heatMs += performance.now() - t0;
  return r;
}

/** Blast survey round a charge (see blast.ts), timed. */
export function survey(pos: Vec3, radius: number, power: number, gasPower = power, cloud = false): Survey {
  const s = blastSurvey(pos, radius, power, gasPower, cloud);
  fieldCost.blastMs += s.ms;
  fieldCost.blasts++;
  return s;
}

export function fieldsActive(): boolean {
  return brickList.length > 0 || tiles.size > 0;
}

export function stepFields(dt: number): void {
  if (!brickList.length && !tiles.size && !sparks.length) return;
  const t0 = performance.now();
  clock += dt;
  const w = windVector();
  amb[F_U] = Math.max(-12, Math.min(12, w[0]));
  amb[F_W] = Math.max(-12, Math.min(12, w[2]));
  amb[F_T] = 20 - 3 * rain;
  for (let i = sparks.length - 1; i >= 0; i--) if ((sparks[i].t -= dt) <= 0) sparks.splice(i, 1);
  linkNeighbours();

  /* round robin under a work budget: an overloaded field runs slow (bigger steps, up to 0.25 s) rather than
     stalling the frame; quiet bricks tick at 2 Hz until they retire. The budget counts brick steps at their nominal
     cost, not wall time, so the field (and the fire and blasts it feeds back) replays identically on any machine. */
  const nb = brickList.length;
  /* credit: a step too short for a brick banks its share for the next */
  credit = Math.min(credit + BUDGET_MS / BRICK_MS, Math.max(1, (4 * BUDGET_MS) / BRICK_MS));
  let k = 0, rescans = 1;
  for (; k < nb; k++) {
    const b = brickList[(cursor + k) % nb];
    const since = clock - b.last;
    const period = b.content || (emitters.get(b)?.length ?? 0) > 0 ? FIELD_DT : 0.5;
    if (since < period) continue;
    if (credit < 1) break;
    const bdt = Math.min(0.25, since);
    b.last = clock;
    if (b.rescan < 0) { b.rescan = clock + 2 + rnd(); scanBrick(b); }
    else if (clock >= b.rescan && rescans > 0) { rescans--; b.rescan = clock + 2 + rnd(); scanBrick(b); }
    refreshOcc(b, 12);
    const tb = performance.now();
    const busy = stepBrick(b, bdt) || (emitters.get(b)?.length ?? 0) > 0;
    const bt = performance.now() - tb;
    credit -= 1;
    fieldCost.brickMax = Math.max(fieldCost.brickMax, bt);
    convect(b, bdt, clock);
    fieldCost.brickSteps++;
    b.idle = busy ? 0 : b.idle + bdt;
    if (b.idle > RETIRE) pending.push(b);
    else if (brickList.length < SPILL_CAP) for (const [dx, dy, dz] of spill(b)) if (b.by + dy <= 2) allocBrick(b.bx + dx, b.by + dy, b.bz + dz, clock, false);
  }
  cursor = nb ? (cursor + k) % nb : 0;
  if (pending.length) {
    for (const b of pending.splice(0)) { emitters.delete(b); freeBrick(b); }
    linkNeighbours();
  }
  deflagrations(dt);

  smokeT -= dt;
  if (smokeT <= 0) { smokeT = 0.1; emitSmoke(); }
  waterT += dt;
  if (waterT >= 0.05) { stepWater(waterT, rain); waterT = 0; }

  const ms = performance.now() - t0;
  fieldCost.ms += ms;
  fieldCost.steps++;
  fieldCost.peak = Math.max(fieldCost.peak, ms);
}

/* A premixed flame front's heat, gathered until it stops spreading (0.6 s at most, the time a turbulent front
   takes to cross a room), then dealt as one blast at its centroid: 18 kJ of explode power per m³ of
   methane-equivalent burnt, amplified by the room it is in. Fuel that was mostly smoke-layer pyrolysate burning
   when air got in is a backdraft.
   A fire or a lit leak keeps lighting fresh fuel as it arrives (a pile's volatiles, a jet's gas drifting into new
   cells): fronts at a steady rate, which is a standing flame burning as fast as it is fed. Only a burst well above
   that running rate (FRONT_TAU mean) burnt a mixture that had gathered, and only that is a deflagration. */
const FRONT_TAU = 8, BURST = 4;
const ev = { E: 0, x: 0, y: 0, z: 0, pyro: 0, cov: 0 };
function deflagrations(dt: number): void {
  if (defl.E > 0) {
    ev.E += defl.E; ev.x += defl.x; ev.y += defl.y; ev.z += defl.z; ev.pyro += defl.pyro; ev.cov += defl.cov;
    if (deflT < 0) { deflT = 0; frontBase = frontRate; }
  }
  frontRate += (defl.E / dt - frontRate) * Math.min(1, dt / FRONT_TAU);
  /* bricks step every 0.1-0.25 s, not every frame: the front is still going until none has burnt for longer */
  frontIdle = defl.n > 0 ? 0 : frontIdle + dt;
  const burning = frontIdle < 0.3;
  defl.E = defl.x = defl.y = defl.z = defl.pyro = defl.n = defl.cov = 0;
  deflCool -= dt;
  if (deflT < 0) return;
  deflT += dt;
  if (burning && deflT < 0.6) return;
  /* the burn that follows a deflagration (the fireball rolling out, the rest of the layer catching) is flame, not
     a second blast */
  if (deflCool > 0) { deflT = -1; ev.E = ev.x = ev.y = ev.z = ev.pyro = ev.cov = 0; return; }
  const E = ev.E, deflT0 = deflT;
  deflT = -1;
  if (E > 1.5e6 && E > BURST * frontBase * deflT0) {
    deflCool = 4;
    const pos: Vec3 = [ev.x / E, ev.y / E, ev.z / E];
    const V = E / 35.8e6;
    /* the blast is bounded by the fuel that burnt (~4 % TNT equivalence under a ceiling); what burnt in the open
       expanded as it went, a flash fire at a tenth of that (TNO multi-energy class 2-3), below which there is no
       blast at all */
    const cov = Math.min(1, ev.cov / E), k = 0.1 + 0.9 * cov;
    const power = Math.min(160e3, 18e3 * V * k);
    thermalStats.deflagrations++;
    if (ev.pyro > 0.5 * E) thermalStats.backdrafts++;
    fx.fire(pos, 2.5, Math.min(4, 1 + Math.cbrt(V) * 2));
    for (const h of deflHooks) h(pos, V, ev.pyro > 0.5 * E);
    /* what it throws is the gas pressure's impulse on loose things, not the point charge's: tens of kPa held for tens
       of ms under a ceiling is ~10³ Pa·s however little fuel made it */
    if (power >= 1.5e3) explode(pos, Math.min(10, Math.max(3, 2 + 1.5 * Math.cbrt(V * 10 * k))), power, Math.min(6000, Math.max(150, 600 * cov * cov, 700 * V * k)), 1.2, undefined, 0);
  }
  ev.E = ev.x = ev.y = ev.z = ev.pyro = ev.cov = 0;
}

const deflHooks: ((pos: Vec3, m3: number, backdraft: boolean) => void)[] = [];
/** Called when a premixed flame front in the gas field deflagrates (m³ of methane-equivalent burnt). */
export function onDeflagration(cb: (pos: Vec3, m3: number, backdraft: boolean) => void): void {
  if (!deflHooks.includes(cb)) deflHooks.push(cb);
}

/** Mean fraction of a species over the open voxels in a box, and the open volume sampled (m³). */
export function meanIn(min: ArrayLike<number>, max: ArrayLike<number>, species: 'methane' | 'propane' | 'smoke' | 'co' | 'o2'): { mean: number; vol: number } {
  const k = { methane: F_CH4, propane: F_C3H8, smoke: F_SMOKE, co: F_CO, o2: F_O2 }[species];
  let s = 0, n = 0;
  for (let z = Math.floor(min[2]); z < max[2]; z++) for (let y = Math.max(0, Math.floor(min[1])); y < max[1]; y++) for (let x = Math.floor(min[0]); x < max[0]; x++) {
    const i = lookup(x + 0.5, y + 0.5, z + 0.5);
    if (i < 0) { s += amb[k]; n++; continue; }
    if (blocked(hit, i)) continue;
    s += hit.f[k][i]; n++;
  }
  return { mean: n ? s / n : amb[k], vol: n };
}

/** Stir a box toward its mean (share k per call, conservative over its open cells): for callers that run a
 * process on a compressed clock (a leak filling a room 40× fast) whose mixing the grid cannot resolve in time. */
export function mixIn(min: ArrayLike<number>, max: ArrayLike<number>, species: 'methane' | 'propane', k: number): void {
  const f = species === 'methane' ? F_CH4 : F_C3H8;
  const { mean } = meanIn(min, max, species);
  for (let z = Math.floor(min[2]); z < max[2]; z++) for (let y = Math.max(0, Math.floor(min[1])); y < max[1]; y++) for (let x = Math.floor(min[0]); x < max[0]; x++) {
    const i = lookup(x + 0.5, y + 0.5, z + 0.5);
    if (i < 0 || blocked(hit, i)) continue;
    hit.f[f][i] += (mean - hit.f[f][i]) * k;
  }
}

/** Explosion: fireball heat, soot and CO into the gas, the overpressure pulse shown on the pressure field. */
export function fieldsBlast(pos: Vec3, radius: number, power: number, s: Survey | null): void {
  const W = Math.max(0.01, power / POWER_PER_KG);
  const cw = Math.cbrt(W);
  touch(pos[0], pos[1], pos[2], 4, clock);
  linkNeighbours();
  const rf = 1.6 * cw, rp = Math.min(12, radius * 1.6);
  for (let z = Math.floor(pos[2] - rp); z <= pos[2] + rp; z++) for (let y = Math.max(0, Math.floor(pos[1] - rp)); y <= pos[1] + rp; y++) for (let x = Math.floor(pos[0] - rp); x <= pos[0] + rp; x++) {
    const i = lookup(x + 0.5, y + 0.5, z + 0.5);
    if (i < 0 || blocked(hit, i)) continue;
    const dx = x + 0.5 - pos[0], dy = y + 0.5 - pos[1], dz = z + 0.5 - pos[2], d = Math.hypot(dx, dy, dz);
    if (d > rp) continue;
    const f = hit.f;
    f[F_PK][i] = Math.max(f[F_PK][i], pso(Math.max(d, 0.3) / (s ? s.cw : cw)));
    if (d < rf) {
      f[F_T][i] = Math.max(f[F_T][i], 1500 - 900 * (d / rf));
      // a high explosive's own soot is a brief dark flash in the fireball; what lingers is lofted dust (grey-tan)
      f[F_SMOKE][i] += 0.6; f[F_DARK][i] += 0.12; f[F_CO][i] += 0.01;
      f[F_O2][i] = Math.max(0, f[F_O2][i] - 0.04);
    }
    const k = Math.max(0, 1 - d / rp) * 14 / Math.max(0.5, d);
    f[F_U][i] += dx * k; f[F_V][i] += dy * k; f[F_W][i] += dz * k;
  }
  for (const b of brickList) if (Math.abs(b.ox + 8 - pos[0]) < 8 + rp && Math.abs(b.oz + 8 - pos[2]) < 8 + rp) b.rescan = 0;
}

/* ---------------- dispersed fuel clouds (thermobaric) ---------------- */

export interface Cloud { min: Vec3; max: Vec3; cells: number; x: number; kg: number }

/** Throw `kg` of fuel (as propane-equivalent vapour and droplets) out through the open air round `pos` at the
 * dispersal concentration `x` (mole fraction), breadth-first through open cells out to `rMax`: walls hold it in, an
 * opening lets it through, and a room too small for it takes it richer. */
export function disperseFuel(pos: Vec3, kg: number, x: number, rMax: number, side?: Vec3): Cloud {
  const r = Math.ceil(rMax);
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) touch(pos[0] + dx, pos[1], pos[2] + dz, 2, clock);
  touch(pos[0], pos[1] + r, pos[2], 2, clock);
  linkNeighbours();
  const cloud: Cloud = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], cells: 0, x, kg };
  let sx = Math.floor(pos[0]), sy = Math.max(0, Math.floor(pos[1])), sz = Math.floor(pos[2]);
  let i0 = lookup(sx + 0.5, sy + 0.5, sz + 0.5);
  if (i0 < 0 || blocked(hit, i0)) {
    /* the burst is in a wall's cell: start on the side it came from */
    const order: number[][] = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
    if (side) order.sort((a, b) => (b[0] * side[0] + b[1] * side[1] + b[2] * side[2]) - (a[0] * side[0] + a[1] * side[1] + a[2] * side[2]));
    for (const [dx, dy, dz] of order) {
      const i = lookup(sx + dx + 0.5, sy + dy + 0.5, sz + dz + 0.5);
      if (i >= 0 && !blocked(hit, i)) { sx += dx; sy += dy; sz += dz; i0 = i; break; }
    }
    if (i0 < 0 || blocked(hit, i0)) return cloud;
  }
  const key = (a: number, b: number, c: number): number => ((a + 2048) * 4096 + (b + 2048)) * 4096 + (c + 2048);
  const seen = new Set<number>([key(sx, sy, sz)]);
  const q: number[] = [sx, sy, sz];
  const cells: number[] = [];
  for (let h = 0; h < q.length; h += 3) {
    const cx = q[h], cy = q[h + 1], cz = q[h + 2];
    cells.push(cx, cy, cz);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (ny < 0 || Math.hypot(nx + 0.5 - pos[0], ny + 0.5 - pos[1], nz + 0.5 - pos[2]) > rMax) continue;
      const k = key(nx, ny, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      const i = lookup(nx + 0.5, ny + 0.5, nz + 0.5);
      if (i < 0 || blocked(hit, i)) continue;
      q.push(nx, ny, nz);
    }
  }
  /* moles to place, and the cells they need at x; the nearest cells take it first */
  let mol = kg / MOL.propane;
  const perCell = (T: number): number => molDensity(T);
  const n = cells.length / 3;
  let need = 0;
  for (let c = 0; c < n && need < mol; c++) { lookup(cells[3 * c] + 0.5, cells[3 * c + 1] + 0.5, cells[3 * c + 2] + 0.5); need += perCell(20) * x; }
  const xs = need < mol && n > 0 ? Math.min(0.9, (mol / (n * perCell(20)))) : x;
  for (let c = 0; c < n && mol > 1e-6; c++) {
    const cx = cells[3 * c], cy = cells[3 * c + 1], cz = cells[3 * c + 2];
    const i = lookup(cx + 0.5, cy + 0.5, cz + 0.5);
    if (i < 0) continue;
    const f = hit.f, nm = molDensity(f[F_T][i]);
    const dx = Math.min(xs, mol / nm);
    const keep = 1 - dx;
    for (const k of [F_O2, F_CH4, F_C3H8, F_FUEL, F_STEAM, F_CO]) f[k][i] *= keep;
    f[F_C3H8][i] += dx;
    mol -= dx * nm;
    cloud.cells++;
    cloud.min[0] = Math.min(cloud.min[0], cx); cloud.min[1] = Math.min(cloud.min[1], cy); cloud.min[2] = Math.min(cloud.min[2], cz);
    cloud.max[0] = Math.max(cloud.max[0], cx + 1); cloud.max[1] = Math.max(cloud.max[1], cy + 1); cloud.max[2] = Math.max(cloud.max[2], cz + 1);
  }
  cloud.x = xs;
  return cloud;
}

export interface CloudBurn { premixed: number; diffusion: number; x: number; y: number; z: number; cells: number; covered: number; left: number }

/** Light everything burnable in a box at once (a cloud's initiator): the share of each cell inside its flammable
 * limits burns as a premixed front (J, `premixed`), the rest as far as the cell's oxygen goes (`diffusion`); the
 * products go into the cell (heat, steam, soot, CO) and the cell keeps the memory of a flame, so the gas that is
 * left, and what drifts back in, burns on as a standing fireball rather than a second front. */
export function burnCloud(min: Vec3, max: Vec3): CloudBurn {
  const out: CloudBurn = { premixed: 0, diffusion: 0, x: 0, y: 0, z: 0, cells: 0, covered: 0, left: 0 };
  for (let z = Math.floor(min[2]); z < max[2]; z++) for (let y = Math.max(0, Math.floor(min[1])); y < max[1]; y++) for (let x = Math.floor(min[0]); x < max[0]; x++) {
    const i = lookup(x + 0.5, y + 0.5, z + 0.5);
    if (i < 0 || blocked(hit, i)) continue;
    const f = hit.f;
    const ch4 = f[F_CH4][i], c3 = f[F_C3H8][i], fu = f[F_FUEL][i], o2 = f[F_O2][i];
    if (ch4 + c3 + fu < 1e-4) continue;
    const T = f[F_T][i], n = molDensity(T), C = 355e3 / (T + 273.15);
    const pre = ch4 / CH4.lel + c3 / C3H8.lel + fu / PYRO.lel >= 1 && ch4 / CH4.uel + c3 / C3H8.uel + fu / PYRO.uel <= 1;
    const need = CH4.o2 * ch4 + C3H8.o2 * c3 + PYRO.o2 * fu;
    const k = Math.min(1, Math.max(0, o2 - 0.01) / need);
    const d1 = ch4 * k, d2 = c3 * k, d3 = fu * k;
    const q = n * (CH4.lhv * d1 + C3H8.lhv * d2 + PYRO.lhv * d3);
    f[F_CH4][i] -= d1; f[F_C3H8][i] -= d2; f[F_FUEL][i] -= d3;
    f[F_O2][i] = Math.max(0, o2 - need * k);
    f[F_STEAM][i] += CH4.h2o * d1 + C3H8.h2o * d2 + PYRO.h2o * d3;
    if (k < 1) { f[F_CO][i] += 0.1 * (c3 - d2 + ch4 - d1); f[F_SMOKE][i] += 2; f[F_DARK][i] += 1.5; }
    else { f[F_SMOKE][i] += 0.4; f[F_DARK][i] += 0.2; }
    f[F_T][i] = Math.min(2000, T + q / C);
    f[F_BURN][i] = -FLAME_MEMORY;
    if (pre) out.premixed += q; else out.diffusion += q;
    out.x += q * (x + 0.5); out.y += q * (y + 0.5); out.z += q * (z + 0.5);
    out.cells++;
    let cov = false;
    for (let yy = y + 1; yy < y + 8 && !cov; yy++) { const j = lookup(x + 0.5, yy + 0.5, z + 0.5); if (j >= 0 && blocked(hit, j)) cov = true; }
    if (cov) out.covered += q;
    out.left += n * (f[F_CH4][i] + f[F_C3H8][i] + f[F_FUEL][i]);
    hit.content = true;
  }
  const E = out.premixed + out.diffusion;
  if (E > 0) { out.x /= E; out.y /= E; out.z /= E; out.covered /= E; }
  return out;
}

/* ---------------- rendering hooks ---------------- */

const _p: Vec3 = [0, 0, 0], _vel: Vec3 = [0, 0, 0];
function emitSmoke(): void {
  let budget = 14;
  for (const b of brickList) {
    if (!b.content || budget <= 0) continue;
    const S = b.f[F_SMOKE], D = b.f[F_DARK], St = b.f[F_STEAM];
    for (let s = 0; s < 48 && budget > 0; s++) {
      const i = (rnd() * N3) | 0;
      const sm = S[i], st = St[i];
      if (blocked(b, i) || (sm < 0.05 && st < 0.02)) continue;
      const white = st * 20 > sm;
      const dens = white ? st * 20 : sm;
      if (rnd() > Math.min(1, dens / 0.6)) continue;
      const x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
      _p[0] = b.ox + x + rnd(); _p[1] = b.oy + y + rnd(); _p[2] = b.oz + z + rnd();
      _vel[0] = b.f[F_U][i]; _vel[1] = b.f[F_V][i]; _vel[2] = b.f[F_W][i];
      const k = white ? 0 : Math.min(1, D[i] / Math.max(1e-6, sm));
      // timber and plastics burning in the open smoke grey-brown to charcoal, not black: only a fuel-rich fire goes darker
      const col = white ? 0xeeeeea : mix(0x857a6e, 0x3a3632, k * 0.7);
      fx.fieldSmoke(_p, _vel, 0.9 + Math.min(1.2, dens), Math.min(0.75, 0.18 + dens * 0.5), col);
      budget--;
    }
  }
}

function mix(a: number, b: number, k: number): number {
  const r = ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k, g = ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k, bl = (a & 255) * (1 - k) + (b & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

const _c: [number, number, number] = [0, 0, 0];
/** X-ray 'fields': flame fronts white, flammable gas green, smoke grey, hot gas in ironbow, blast pressure blue. */
export function fieldDots(push: (p: Vec3, radius: number, r: number, g: number, b: number) => void, thermal: (t: number, out: [number, number, number]) => [number, number, number], cap = 5000): void {
  let n = 0;
  const Ta = amb[F_T];
  for (const b of brickList) {
    if (!b.content) continue;
    const f = b.f;
    for (let i = 0; i < N3 && n < cap; i++) {
      if (blocked(b, i)) continue;
      const T = f[F_T][i], sm = f[F_SMOKE][i], fu = f[F_CH4][i] / 0.05 + f[F_C3H8][i] / 0.021 + f[F_FUEL][i] / 0.07, pk = f[F_PK][i];
      let r: number, g: number, bl: number, rad: number;
      if (f[F_BURN][i] > 0) { r = 1; g = 1; bl = 0.85; rad = 0.34; }
      else if (fu > 0.2) { const k = Math.min(1, fu); r = 0.1; g = 0.4 + 0.6 * k; bl = 0.15; rad = 0.1 + 0.2 * k; }
      else if (pk > 1000) { const k = Math.min(1, pk / 50e3); r = 0.3 * k; g = 0.5 + 0.3 * k; bl = 1; rad = 0.1 + 0.2 * k; }
      else if (T > Ta + 40) { thermal(T, _c); r = _c[0]; g = _c[1]; bl = _c[2]; rad = 0.12 + Math.min(0.2, (T - Ta) / 4000); }
      else if (sm > 0.08) { const k = Math.min(1, sm / 1.5); r = g = bl = 0.55 - 0.35 * k; rad = 0.1 + 0.15 * k; }
      else continue;
      _p[0] = b.ox + (i % N) + 0.5; _p[1] = b.oy + (((i / N) | 0) % N) + 0.5; _p[2] = b.oz + ((i / (N * N)) | 0) + 0.5;
      push(_p, rad, r, g, bl);
      n++;
    }
  }
}

export function fieldStats(): { bricks: number; voxels: number; water: number; waterTiles: number; flashovers: number; backdrafts: number; deflagrations: number; shocks: number; heatMW: number } {
  const s = {
    bricks: brickList.length, voxels: brickList.length * N3, water: waterStats.volume, waterTiles: tiles.size,
    flashovers: thermalStats.flashovers, backdrafts: thermalStats.backdrafts, deflagrations: thermalStats.deflagrations, shocks: thermalStats.shocks,
    heatMW: gasStats.heatW / 1e6,
  };
  gasStats.heatW = 0;
  return s;
}

export const waterPours = (): number => waterStats.pours;

export function clearFields(): void {
  clearBricks();
  clearWater();
  emitters.clear();
  sparks.length = 0;
  pending.length = 0;
  ev.E = ev.x = ev.y = ev.z = ev.pyro = ev.cov = 0;
  defl.E = defl.x = defl.y = defl.z = defl.pyro = defl.n = defl.cov = 0;
  deflT = -1;
  deflCool = 0;
  frontRate = frontBase = 0;
  credit = 0;
  rs = RS0;
  thermalStats.flashovers = thermalStats.backdrafts = thermalStats.deflagrations = thermalStats.shocks = thermalStats.conducted = 0;
}

/** For tests and debug overlays: every active brick. */
export const fieldBricks = (): readonly Brick[] => brickList;
export { bricks };
