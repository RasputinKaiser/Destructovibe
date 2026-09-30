import { CAT, overlapAABB, entityOfShape, b3 } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import { waterPour } from '../../render/utilityfx';
import { groundAt, surfaceAt } from '../../terrain/terrain';
import { SURFACE } from '../../terrain/surface';

/* Shallow water on a 2D heightfield (virtual-pipe scheme): 0.5 m cells in 16 m tiles laid over the topmost surface
   below the water's source level: the ground, a floor slab, rubble. Walls that rise through that level are dams;
   a floor that ends is a drop the water pours off. */

export const CELL = 0.5, TN = 32, TILE = CELL * TN;
const MAX_TILES = 16;
const G = 9.81;
const DAM = 1e3;
const SOAK = 2e-5;              // m/s lost into soil, gullies and cracks where the bed is open ground
const DRY = 2e-4;

export interface Tile {
  key: string; tx: number; tz: number; ox: number; oz: number; level: number;
  bed: Float32Array; h: Float32Array; fl: Float32Array; fr: Float32Array; fu: Float32Array; fd: Float32Array;
  vol: number; idle: number; pourT: number; bedT: number; version: number;
}

export const tiles = new Map<string, Tile>();
export const waterStats = { volume: 0, pours: 0, tiles: 0, ms: 0 };
const _aabb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

function tileKey(tx: number, tz: number, level: number): string { return `${tx},${tz},${Math.round(level * 2)}`; }

/* where the bed is open ground that drinks (soil, grass, gravel, a crater) */
const soaks = new WeakMap<Tile, Uint8Array>();

/* Top of whatever lies under each cell below `level`, the terrain first; anything crossing `level` is a dam. */
function sampleBed(t: Tile): void {
  const bed = t.bed, top = t.level + 0.35;
  const soak = soaks.get(t) ?? new Uint8Array(TN * TN);
  soaks.set(t, soak);
  let low = top;
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
    const x = t.ox + (i + 0.5) * CELL, z = t.oz + (j + 0.5) * CELL, g = groundAt(x, z), k = i + TN * j;
    bed[k] = !Number.isFinite(g) ? t.level - 8 : g > top ? DAM : g;
    soak[k] = SURFACE[surfaceAt(x, z)].soaks ? 1 : 0;
    if (bed[k] < low) low = bed[k];
  }
  overlapAABB([t.ox, low - 0.5, t.oz], [t.ox + TILE, top + 0.5, t.oz + TILE], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (p.dead) return;
    b3.b3Shape_GetAABB(_aabb, shape);
    // what lies in the ground (mains, footings) is under the bed, not on it
    if (_aabb[4] <= groundAt((_aabb[0] + _aabb[3]) / 2, (_aabb[2] + _aabb[5]) / 2) + 0.01) return;
    const dam = _aabb[1] < top && _aabb[4] > top;
    if (!dam && _aabb[4] > top) return;
    if (_aabb[3] - _aabb[0] < 0.2 && _aabb[5] - _aabb[2] < 0.2 && !dam) return;
    /* cells whose centre it covers; a kerb or wall thinner than a cell still takes the cell it runs through */
    const c0 = (_aabb[0] - t.ox) / CELL, c1 = (_aabb[3] - t.ox) / CELL, d0 = (_aabb[2] - t.oz) / CELL, d1 = (_aabb[5] - t.oz) / CELL;
    let i0 = Math.floor(c0 + 0.5), i1 = Math.floor(c1 - 0.5), j0 = Math.floor(d0 + 0.5), j1 = Math.floor(d1 - 0.5);
    if (i1 < i0) i0 = i1 = Math.floor((c0 + c1) / 2);
    if (j1 < j0) j0 = j1 = Math.floor((d0 + d1) / 2);
    i0 = Math.max(0, i0); i1 = Math.min(TN - 1, i1); j0 = Math.max(0, j0); j1 = Math.min(TN - 1, j1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i + TN * j;
      if (!dam && _aabb[4] > bed[k]) soaks.get(t)![k] = 0;
      bed[k] = dam ? DAM : Math.max(bed[k], _aabb[4]);
    }
  });
  t.version++;
}

function tileAt(x: number, z: number, level: number, make: boolean): Tile | null {
  const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
  let best: Tile | null = null;
  for (const t of tiles.values()) if (t.tx === tx && t.tz === tz && Math.abs(t.level - level) < 1.2 && (!best || Math.abs(t.level - level) < Math.abs(best.level - level))) best = t;
  if (best || !make || tiles.size >= MAX_TILES) return best;
  const n = TN * TN;
  const t: Tile = {
    key: tileKey(tx, tz, level), tx, tz, ox: tx * TILE, oz: tz * TILE, level,
    bed: new Float32Array(n), h: new Float32Array(n), fl: new Float32Array(n), fr: new Float32Array(n), fu: new Float32Array(n), fd: new Float32Array(n),
    vol: 0, idle: 0, pourT: 0, bedT: 0, version: 0,
  };
  sampleBed(t);
  tiles.set(t.key, t);
  return t;
}

/** Pour `kg` of water onto the surface under (x, y, z). */
export function addWaterAt(x: number, y: number, z: number, kg: number): void {
  if (!(kg > 0)) return;
  const t = tileAt(x, z, y, true);
  if (!t) return;
  const i = Math.min(TN - 1, Math.max(0, Math.floor((x - t.ox) / CELL))), j = Math.min(TN - 1, Math.max(0, Math.floor((z - t.oz) / CELL)));
  const k = i + TN * j;
  if (t.bed[k] >= DAM) return;
  t.h[k] += kg / 1000 / (CELL * CELL);
  t.idle = 0;
}

/** Water depth over the surface at (x, z) near height y (0 where there is no water tracked). */
export function depthAt(x: number, z: number, y: number): number {
  if (!tiles.size) return 0;
  const t = tileAt(x, z, y, false);
  if (!t) return 0;
  const i = Math.floor((x - t.ox) / CELL), j = Math.floor((z - t.oz) / CELL);
  if (i < 0 || j < 0 || i >= TN || j >= TN) return 0;
  const k = i + TN * j;
  return t.bed[k] + t.h[k] > y - 0.3 ? t.h[k] : 0;
}

export function clearWater(): void { tiles.clear(); }

export function stepWater(dt: number, rain: number): void {
  if (!tiles.size) return;
  const t0 = performance.now();
  let vol = 0;
  const A = CELL * CELL;
  for (const t of [...tiles.values()]) {
    t.bedT += dt;
    if (t.bedT > 1.5) { t.bedT = 0; sampleBed(t); }
    const { bed, h, fl, fr, fu, fd } = t, sk = soaks.get(t);
    if (rain > 0) for (let k = 0; k < h.length; k++) if (bed[k] < DAM) h[k] += rain * 1e-5 * dt;
    const K = dt * CELL * G;
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
      const k = i + TN * j;
      if (bed[k] >= DAM || h[k] <= 0) { fl[k] = fr[k] = fu[k] = fd[k] = 0; continue; }
      const H = bed[k] + h[k];
      const hl = i > 0 && bed[k - 1] < DAM ? H - (bed[k - 1] + h[k - 1]) : -1;
      const hr = i < TN - 1 && bed[k + 1] < DAM ? H - (bed[k + 1] + h[k + 1]) : -1;
      const hu = j > 0 && bed[k - TN] < DAM ? H - (bed[k - TN] + h[k - TN]) : -1;
      const hd = j < TN - 1 && bed[k + TN] < DAM ? H - (bed[k + TN] + h[k + TN]) : -1;
      /* flow over a lip depends on the water above the lip, not the drop beyond it */
      fl[k] = hl > 0 ? Math.max(0, fl[k] * 0.98 + K * Math.min(hl, h[k])) : 0;
      fr[k] = hr > 0 ? Math.max(0, fr[k] * 0.98 + K * Math.min(hr, h[k])) : 0;
      fu[k] = hu > 0 ? Math.max(0, fu[k] * 0.98 + K * Math.min(hu, h[k])) : 0;
      fd[k] = hd > 0 ? Math.max(0, fd[k] * 0.98 + K * Math.min(hd, h[k])) : 0;
      const tot = (fl[k] + fr[k] + fu[k] + fd[k]) * dt;
      const have = h[k] * A;
      if (tot > have) { const s = have / tot; fl[k] *= s; fr[k] *= s; fu[k] *= s; fd[k] *= s; }
    }
    let pour = 0, px = 0, pz = 0, py = 0;
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
      const k = i + TN * j;
      if (bed[k] >= DAM) continue;
      const out = fl[k] + fr[k] + fu[k] + fd[k];
      const inn = (i > 0 ? fr[k - 1] : 0) + (i < TN - 1 ? fl[k + 1] : 0) + (j > 0 ? fd[k - TN] : 0) + (j < TN - 1 ? fu[k + TN] : 0);
      h[k] = Math.max(0, h[k] + ((inn - out) * dt) / A - (sk?.[k] ? SOAK * dt : 0));
      if (h[k] < DRY && out === 0 && inn === 0) h[k] = 0;
      vol += h[k] * A;
      if (out > 0) {
        const drop = (n: number, f: number): void => {
          if (f > 1e-4 && bed[k] - bed[n] > 0.4) { pour += f; px += (i + 0.5) * f; pz += (j + 0.5) * f; py += bed[k] * f; }
        };
        if (i > 0) drop(k - 1, fl[k]);
        if (i < TN - 1) drop(k + 1, fr[k]);
        if (j > 0) drop(k - TN, fu[k]);
        if (j < TN - 1) drop(k + TN, fd[k]);
      }
    }
    t.pourT -= dt;
    if (pour > 0) {
      waterStats.pours++;
      if (t.pourT <= 0) {
        t.pourT = 0.1;
        waterPour([t.ox + (px / pour) * CELL, py / pour, t.oz + (pz / pour) * CELL], Math.min(2.5, Math.sqrt(pour) * 3));
      }
    }
    t.vol = vol;
    t.idle = vol < 1e-3 ? t.idle + dt : 0;
    if (t.idle > 10) tiles.delete(t.key);
    edgeSpill(t);
  }
  waterStats.volume = vol;
  waterStats.tiles = tiles.size;
  waterStats.ms += performance.now() - t0;
}

/* Water reaching a tile's edge carries on into the next tile at the same level. */
function edgeSpill(t: Tile): void {
  const { h, bed } = t;
  for (let s = 0; s < TN; s++) {
    for (const [k, dx, dz] of [[TN * s, -1, 0], [TN - 1 + TN * s, 1, 0], [s, 0, -1], [s + TN * (TN - 1), 0, 1]] as const) {
      if (h[k] < 0.003 || bed[k] >= DAM) continue;
      const x = t.ox + ((k % TN) + 0.5) * CELL + dx * CELL, z = t.oz + (Math.floor(k / TN) + 0.5) * CELL + dz * CELL;
      const n = tileAt(x, z, t.level, true);
      if (!n || n === t) continue;
      const m = h[k] * 0.5;
      h[k] -= m;
      addWaterAt(x, t.level, z, m * 1000 * CELL * CELL);
    }
  }
}
