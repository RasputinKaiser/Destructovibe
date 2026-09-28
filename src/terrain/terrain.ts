import type { b3BodyId, b3ShapeId } from 'box3d.js';
import type { Vec3 } from '../types';
import type { Piece } from '../destruction/structure';
import { b3, world, groundSlab, CAT, ALL, filter, register, type PhysEntity } from '../physics/physics';
import { fx } from '../render/fx';
import { SURFACES, TILE_CELLS, type SurfaceId, type TerrainSpec } from './spec';
import { fieldHeight, groundHeight, isHole, rasterize, surfaceIdAt, type TerrainData } from './raster';
import { SURFACE } from './surface';

/* The ground in the physics: one static body per tile (32 samples, 0.5 m apart on a site; 4 m on the flat default)
   carrying a heightfield and a triangle mesh per surfacing for the engineered features on it (kerbs, walls, steps,
   slabs), and a flat apron of boxes beyond. box3d heightfields only collide on a static body (so a quake drives the
   anchor, not the ground) and are one-sided (nothing below them is touched). Their hole samples (height ≥ ~1e5) are
   not used: one spoils the whole tile's height quantisation and stretches its bounds to the sky, pairing every body
   above with it; basements are dug instead. Pieces fixed to the ground, or passing below its surface — buried mains,
   footings, plinths, basement walls — do not collide with it at all (they are welded to the anchor); the soil keeps
   what is set in it, and a crater that undermines a piece hands it back to the ground. */

/* box3d gives triangle (heightfield and mesh) contacts a 5 mm skin: bodies rest that far above the triangles
   (measured; a box shape has none). The tiles sit just under that low, so a piece built on the ground rests at its
   nominal height half a millimetre into the skin: pushed up 5 mm, welded pieces fight their ground welds; held
   exactly at the skin's edge, the contact flickers on and off every step and the building never sleeps. */
const SKIN = 0.0045;
const N = TILE_CELLS + 1;

export interface TerrainState {
  data: TerrainData | null;
  /** bumped on every change of the heights or features */
  version: number;
  /** tiles whose heights or features changed since the renderer last looked */
  dirty: Set<number>;
  /** the flat default laid for sites that bring no terrain of their own */
  flat: boolean;
}
export const terrain: TerrainState = { data: null, version: 0, dirty: new Set(), flat: true };

let forWorld: unknown = null;
let bodies: b3BodyId[] = [];
let fields: (b3ShapeId | null)[] = [];
let feats: b3ShapeId[][] = [];
const shapeMat = new Map<number, number>();
const buried = new Set<Piece>();
const entombed = new Set<Piece>();

export interface TerrainHooks {
  /** break every weld holding p to the ground anchor */
  unground(p: Piece): void;
}
let hooks: TerrainHooks | null = null;
export function setTerrainHooks(h: TerrainHooks): void { hooks = h; }

// a flat plain needs no detail: 4 m samples keep large debris on few triangles (box3d gathers at most 256 per pair)
const DEFAULT: TerrainSpec = { half: 64, cell: 4, seed: 1, undulate: 0, ops: [{ k: 'mat', x: [-64, 64], z: [-64, 64], mat: 'soil' }], kerbs: [], blocks: [], pads: [], steps: [], decals: [], marks: [] };

/* ---------------- build ---------------- */

/** Lay the site's ground (or the flat default) in the current world, replacing any laid before. */
export function buildTerrain(spec?: TerrainSpec): void {
  if (forWorld === world) destroyBodies();
  if (groundSlab && b3.b3Shape_IsValid(groundSlab)) b3.b3DestroyShape(groundSlab, false);
  forWorld = world;
  terrain.flat = !spec;
  const d = rasterize(spec ?? DEFAULT);
  terrain.data = d;
  buried.clear();
  entombed.clear();
  shapeMat.clear();
  const T = d.tiles;
  bodies = new Array(T * T);
  fields = new Array(T * T).fill(null);
  feats = Array.from({ length: T * T }, () => []);
  for (let tz = 0; tz < T; tz++) for (let tx = 0; tx < T; tx++) {
    const bd = b3.b3DefaultBodyDef();
    const t = tx + T * tz;
    bd.position = [-d.half + tx * (d.cell * TILE_CELLS), -SKIN, -d.half + tz * (d.cell * TILE_CELLS)];
    const body = b3.b3CreateBody(world, bd);
    bodies[t] = body;
    const e: PhysEntity = { kind: 'ground', body, mass: Infinity, prevPos: [...bd.position] as Vec3, prevRot: [0, 0, 0, 1], curPos: [...bd.position] as Vec3, curRot: [0, 0, 0, 1], movedStep: -1 };
    register(e);
    tileField(t);
    tileFeatures(t);
  }
  apron(d.half);
  // tiles are created in raster order, which leaves box3d's incremental static tree hundreds deep
  b3.b3World_RebuildStaticTree(world);
  terrain.dirty.clear();
  for (let t = 0; t < T * T; t++) terrain.dirty.add(t);
  terrain.version++;
}

/** Lay the flat default if nothing has been laid in this world yet. */
export function ensureTerrain(): void {
  if ((globalThis as { __boxGround?: boolean }).__boxGround) { legacyGround(); return; }
  if (forWorld !== world || !terrain.data) buildTerrain();
}

/* A/B harness switch: keep the old 400 m box ground slab, no terrain and no burial. */
function legacyGround(): void {
  forWorld = world;
  terrain.data = null;
}

function destroyBodies(): void {
  for (const b of bodies) if (b && b3.b3Body_IsValid(b)) b3.b3DestroyBody(b);
  bodies = [];
}

function groundDef(friction: number) {
  const sd = b3.b3DefaultShapeDef();
  sd.baseMaterial.friction = friction;
  sd.filter = filter(CAT.ground, ALL);
  sd.enableContactEvents = false;
  sd.enableHitEvents = false;
  return sd;
}

function apron(half: number): void {
  const R = 400, w = (R - half) / 2, sd = groundDef(0.8);
  for (const [cx, cz, hx, hz] of [[0, -(half + w), R, w], [0, half + w, R, w], [-(half + w), 0, w, half], [half + w, 0, w, half]]) {
    const bd = b3.b3DefaultBodyDef();
    bd.position = [cx, -0.5, cz];
    const body = b3.b3CreateBody(world, bd);
    bodies.push(body);
    register({ kind: 'ground', body, mass: Infinity, prevPos: [cx, -0.5, cz], prevRot: [0, 0, 0, 1], curPos: [cx, -0.5, cz], curRot: [0, 0, 0, 1], movedStep: -1 });
    b3.b3CreateBoxShape(body, sd, hx, 0.5, hz);
  }
}

function tileField(t: number): void {
  const d = terrain.data!, T = d.tiles, tx = t % T, tz = Math.floor(t / T), n = d.n;
  if (fields[t] && b3.b3Shape_IsValid(fields[t]!)) b3.b3DestroyShape(fields[t]!, false);
  const hs = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hs[i + N * j] = d.h[tx * TILE_CELLS + i + n * (tz * TILE_CELLS + j)];
  const hf = b3.b3CreateHeightField(hs, N, N, [d.cell, 1, d.cell]);
  fields[t] = b3.b3CreateHeightFieldShape(bodies[t], groundDef(0.8), hf);
}

function tileFeatures(t: number): void {
  const d = terrain.data!, T = d.tiles, ox = -d.half + (t % T) * (d.cell * TILE_CELLS), oz = -d.half + Math.floor(t / T) * (d.cell * TILE_CELLS);
  for (const s of feats[t]) if (b3.b3Shape_IsValid(s)) { shapeMat.delete(s.index1); b3.b3DestroyShape(s, false); }
  feats[t] = [];
  const by = new Map<number, number[]>();
  for (const k of d.own[t]) {
    const it = d.items[k];
    if (!it.alive) continue;
    const l = by.get(it.mat) ?? by.set(it.mat, []).get(it.mat)!;
    for (let q = 0; q < it.pos.length; q += 3) l.push(it.pos[q] - ox, it.pos[q + 1], it.pos[q + 2] - oz);
  }
  for (const [m, pos] of by) {
    const nv = pos.length / 3, idx = new Uint32Array(nv);
    for (let q = 0; q < nv; q++) idx[q] = q;
    const mesh = b3.b3CreateMesh(new Float32Array(pos), idx);
    if (!mesh) continue;
    const s = b3.b3CreateMeshShape(bodies[t], groundDef(SURFACE[SURFACES[m]].friction), mesh, [1, 1, 1]);
    shapeMat.set(s.index1, m);
    feats[t].push(s);
  }
}

/* ---------------- queries ---------------- */

/** Top of the ground at (x, z) (a feature, or the heightfield); -Infinity over a hole; 0 with no terrain laid. */
/** the terrain laid in the current world (a world made since, without a blueprint, has none) */
function cur(): TerrainData | null { return forWorld === world ? terrain.data : null; }

export function groundAt(x: number, z: number): number {
  const d = cur();
  return d ? groundHeight(d, x, z) : 0;
}

/** Height of the natural surface at (x, z) ignoring holes (the level soil would stand at). */
export function surfaceY(x: number, z: number): number {
  const d = cur();
  return d ? fieldHeight(d, x, z) : 0;
}

export function holeAt(x: number, z: number): boolean {
  const d = cur();
  return !!d && isHole(d, x, z);
}

export function surfaceAt(x: number, z: number): SurfaceId {
  const d = cur();
  return d ? SURFACES[surfaceIdAt(d, x, z)] : 'soil';
}

/** Surfacing of a ground shape hit at `p` (features carry their own). */
export function surfaceOfHit(shape: b3ShapeId, p: ArrayLike<number>): SurfaceId {
  const m = shapeMat.get(shape.index1);
  return m !== undefined ? SURFACES[m] : surfaceAt(p[0], p[2]);
}

/** Ground over the point (x, y, z), m: soil, or a slab or kerb laid on it (0 above ground or over a hole). */
export function coverAt(x: number, y: number, z: number): number {
  const g = groundAt(x, z);
  return g > y ? g - y : 0;
}

/** Share of a blast's load (a charge of `kg` TNT) that reaches a point under ground. The soil's protection goes with
    the scaled depth of cover, cover / W^⅓: a rocket's 1.25 kg over a gas main at 0.75 m cover passes it a few
    thousandths, a 40 kg bomb a quarter. */
export function blastShield(p: ArrayLike<number>, kg: number): number {
  const c = coverAt(p[0], p[1], p[2]);
  if (c <= 0.02) return 1;
  const l = c / Math.cbrt(Math.max(kg, 1e-3));
  return Math.exp(-((l / 0.2) ** 2));
}

/* ---------------- buried pieces ---------------- */

const _bb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

function shapesOf(p: Piece): b3ShapeId[] {
  return p.parts ? p.parts.map((q) => q.shape) : [p.shape];
}

function setGround(p: Piece, on: boolean): void {
  for (const s of shapesOf(p)) {
    if (!b3.b3Shape_IsValid(s)) continue;
    const f = b3.b3Shape_GetFilter(s);
    b3.b3Shape_SetFilter(s, { ...f, maskBits: on ? f.maskBits | CAT.ground : f.maskBits & ~CAT.ground }, on);
  }
}

/** The ground under a box's footprint (5 × 5 samples; -Infinity over a hole): lowest, highest, and the shares of
    it above `hi` (the box passes into the soil there) and below `lo` (the soil has gone from under it). */
function under(b: ArrayLike<number>, hi: number, lo: number, soil = false): { min: number; max: number; above: number; below: number } {
  let min = Infinity, max = -Infinity, above = 0, below = 0;
  for (let a = 0; a < 5; a++) for (let c = 0; c < 5; c++) {
    const x = b[0] + ((b[3] - b[0]) * (a + 0.5)) / 5, z = b[2] + ((b[5] - b[2]) * (c + 0.5)) / 5;
    // what bears on the soil asks the soil: a slab laid over it does not hold a footing up from below
    const g = soil ? surfaceY(x, z) : groundAt(x, z);
    min = Math.min(min, g); max = Math.max(max, g);
    if (g > hi) above++;
    if (g < lo) below++;
  }
  return { min, max, above: above / 25, below: below / 25 };
}

/** Called for every new piece. A piece built fixed on or into the ground (standing on it, anchored to it, or on a
    footing laid in it) is carried by its welds, never by contact: box3d's triangle contacts under a large piece
    change from step to step, and a welded frame standing on them never settles (the old box ground gave one steady
    face). So are pieces built into the soil (mains, footings, plinths, basement walls), and fragments born inside it.
    Loose pieces always touch the ground. When nothing holds a piece up any more, the ground takes it back. */
export function bury(p: Piece): void {
  const d = cur();
  if (!d) return;
  const s = p.root.spec;
  if (s.noWeld || s.mech || s.vehicle || s.wheel || s.soft) return;
  b3.b3Body_ComputeAABB(_bb, p.body);
  const u = under(_bb, _bb[1] + 0.02, -Infinity);
  const fixed = p.depth === 0 && (_bb[1] <= 0.03 || !!s.anchored || _bb[1] <= u.max + 0.03);
  if (!fixed && u.above === 0) return;
  setGround(p, false);
  buried.add(p);
}

export function isBuried(p: Piece): boolean { return buried.has(p); }
export function buriedCount(): number { return buried.size; }

const _ob: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
/** Held up: welded to the anchor, or to a piece that reaches down to or below its underside. */
function held(p: Piece): boolean {
  let bottom = NaN;
  for (const w of p.welds) {
    if (!w.alive) continue;
    if (!w.b) return true;
    if (Number.isNaN(bottom)) { b3.b3Body_ComputeAABB(_bb, p.body); bottom = _bb[1]; }
    const o = w.a === p ? w.b : w.a;
    b3.b3Body_ComputeAABB(_ob, o.body);
    if (_ob[1] <= bottom + 0.05) return true;
  }
  return false;
}

/** Set in the soil: its underside well below the natural surface over it (a footing, a main, a pile). */
function embedded(p: Piece): boolean {
  b3.b3Body_ComputeAABB(_bb, p.body);
  return surfaceY((_bb[0] + _bb[3]) / 2, (_bb[2] + _bb[5]) / 2) > _bb[1] + 0.1;
}

/* The soil holds what is set in it: a piece bedded in the ground that loses its last weld to the anchor becomes part
   of the ground (a static body; what is welded to it stays founded on it), until a crater takes the soil away. */
function entomb(p: Piece): void {
  if (entombed.has(p)) return;
  entombed.add(p);
  b3.b3Body_SetLinearVelocity(p.body, [0, 0, 0]);
  b3.b3Body_SetAngularVelocity(p.body, [0, 0, 0]);
  b3.b3Body_SetType(p.body, b3.b3BodyType.b3_staticBody);
}

/** A weld of a fixed piece has gone: the soil keeps what is set in it; what stood on the surface with nothing left
    holding it up comes back to the ground. */
export function groundLost(p: Piece): void {
  if (!buried.has(p) || entombed.has(p) || p.welds.some((w) => w.alive && !w.b)) return;
  if (embedded(p)) entomb(p);
  else if (!held(p)) free(p);
}

/** Pieces the ground has let go of that nothing reported: fragments born in the soil, and pieces cut loose from
    everything (a member hanging from its neighbours stays theirs). */
export function settleBuried(): void {
  for (const p of buried) {
    if (p.dead) { buried.delete(p); entombed.delete(p); continue; }
    if (entombed.has(p) || p.welds.length) continue;
    if (embedded(p)) entomb(p); else free(p);
  }
}

/** Hand a piece back to the ground: dig the soil out from under its footprint where it would be inside it, so it
    starts clear of the heightfield, then let it collide. */
function free(p: Piece): void {
  if (entombed.delete(p)) b3.b3Body_SetType(p.body, b3.b3BodyType.b3_dynamicBody);
  b3.b3Body_ComputeAABB(_bb, p.body);
  carveBox(_bb[0] - 0.05, _bb[3] + 0.05, _bb[2] - 0.05, _bb[5] + 0.05, _bb[1] - 0.02);
  setGround(p, true);
  buried.delete(p);
  b3.b3Body_SetAwake(p.body, true);
}

/* ---------------- deformation ---------------- */

export interface CraterInfo { x: number; z: number; r: number; depth: number; ms: number; tiles: number; exposed: number; undermined: number }
export const craterLog: CraterInfo[] = [];

function touchTiles(x0: number, x1: number, z0: number, z1: number, feat: boolean): number {
  const d = terrain.data!, T = d.tiles;
  const a0 = Math.max(0, Math.floor((x0 + d.half) / (d.cell * TILE_CELLS) - 1e-9)), a1 = Math.min(T - 1, Math.floor((x1 + d.half) / (d.cell * TILE_CELLS) + 1e-9));
  const b0 = Math.max(0, Math.floor((z0 + d.half) / (d.cell * TILE_CELLS) - 1e-9)), b1 = Math.min(T - 1, Math.floor((z1 + d.half) / (d.cell * TILE_CELLS) + 1e-9));
  let k = 0;
  for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
    const t = a + T * b;
    tileField(t);
    if (feat) tileFeatures(t);
    terrain.dirty.add(t);
    k++;
  }
  terrain.version++;
  return k;
}

/** Lower the heightfield inside a box footprint to y (never raises). */
function carveBox(x0: number, x1: number, z0: number, z1: number, y: number): void {
  const d = cur();
  if (!d) return;
  const n = d.n;
  const i0 = Math.max(0, Math.floor((x0 + d.half) / d.cell)), i1 = Math.min(n - 1, Math.ceil((x1 + d.half) / d.cell));
  const j0 = Math.max(0, Math.floor((z0 + d.half) / d.cell)), j1 = Math.min(n - 1, Math.ceil((z1 + d.half) / d.cell));
  let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j;
    if (d.h[k] > y + 0.03) { d.h[k] = y; d.mat[k] = SURFACES.indexOf('soil'); changed = true; }
  }
  if (changed) touchTiles(x0 - d.cell, x1 + d.cell, z0 - d.cell, z1 + d.cell, false);
}

/** Crater from a charge of `kg` TNT equivalent at pos. Apparent radius ~0.6·W^⅓ m for a surface burst in soil,
    shrinking with the scaled height of burst (none above ~1.2 m/kg^⅓) and growing a little when the charge is
    below the surface; bound pavements resist (asphalt 0.6×, concrete 0.45×). The bowl is a paraboloid about 0.45 R
    deep in soil (0.3 R through a pavement), thrown up into a lip; kerbs in it are broken out. */
export function crater(pos: Vec3, kg: number): CraterInfo | null {
  const d = cur();
  if (!d || !(kg > 0)) return null;
  const t0 = performance.now();
  const [px, py, pz] = pos;
  if (Math.max(Math.abs(px), Math.abs(pz)) > d.half - 1 || holeAt(px, pz)) return null;
  const top = groundAt(px, pz), field = surfaceY(px, pz), slab = top > field + 0.02;
  const surf = top, w3 = Math.cbrt(kg), hob = (py - surf) / w3;
  if (hob > 1.2) return null;
  const g = hob >= 0 ? (1 - hob / 1.2) ** 2 : 1 + 0.5 * Math.min(1, -hob / 0.8);
  const sid = slab ? 'concrete' : surfaceAt(px, pz), sp = SURFACE[sid], bound = sp.crater < 0.8;
  const R = 0.6 * w3 * g * sp.crater;
  // a building's slab spans small craters: only a heavy charge breaks it out
  if (R < (slab ? 1 : 0.3)) return null;
  let feat = false;
  for (const k of itemsNear(px, pz, R)) {
    const it = d.items[k];
    it.alive = false;
    feat = true;
    if (it.pad) unpad(it.pad);
  }
  const D = R * (bound ? 0.3 : 0.45), L = 1.45 * R, n = d.n;
  const i0 = Math.max(1, Math.floor((px - L + d.half) / d.cell)), i1 = Math.min(n - 2, Math.ceil((px + L + d.half) / d.cell));
  const j0 = Math.max(1, Math.floor((pz - L + d.half) / d.cell)), j1 = Math.min(n - 2, Math.ceil((pz + L + d.half) / d.cell));
  const bowl = SURFACES.indexOf(bound ? 'rubble' : 'soil'), lip = SURFACES.indexOf('soil');
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j;
    const r = Math.hypot(-d.half + i * d.cell - px, -d.half + j * d.cell - pz);
    if (r < R) { d.h[k] -= D * (1 - (r / R) ** 2); d.mat[k] = bowl; }
    else if (r < L) {
      d.h[k] += 0.12 * D * Math.sin((Math.PI * (r - R)) / (L - R));
      if (!bound && r < 1.2 * R) d.mat[k] = lip;
    }
  }
  const tiles = touchTiles(px - L, px + L, pz - L, pz + L, feat);
  // ejecta: soil thrown up and out, a dust skirt
  const col = sp.dust;
  fx.debris([px, surf + 0.2, pz], Math.round(10 + 30 * R), col, 4 + 5 * R, [0, 1, 0]);
  fx.dust([px, surf, pz], 1.5 * L, col);
  const res = expose(px, pz, L);
  const info: CraterInfo = { x: px, z: pz, r: R, depth: D, ms: performance.now() - t0, tiles, ...res };
  craterLog.push(info);
  if (craterLog.length > 32) craterLog.shift();
  return info;
}

/** The ground under a broken-out piece of slab: the hardcore it was laid on, 0.3 m below its top. */
function unpad(q: { x: [number, number]; z: [number, number]; top: number }): void {
  const d = terrain.data!, n = d.n;
  const i0 = Math.max(0, Math.ceil((q.x[0] + d.half) / d.cell)), i1 = Math.min(n - 1, Math.floor((q.x[1] + d.half) / d.cell));
  const j0 = Math.max(0, Math.ceil((q.z[0] + d.half) / d.cell)), j1 = Math.min(n - 1, Math.floor((q.z[1] + d.half) / d.cell));
  const rubble = SURFACES.indexOf('rubble');
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j;
    d.h[k] = Math.min(d.h[k], q.top - 0.3);
    d.mat[k] = rubble;
  }
}

function itemsNear(x: number, z: number, r: number): number[] {
  const d = terrain.data!, out: number[] = [];
  for (const it of d.items.keys()) {
    const q = d.items[it];
    if (!q.alive || !q.fragile) continue;
    const dx = Math.max(q.min[0] - x, 0, x - q.max[0]), dz = Math.max(q.min[2] - z, 0, z - q.max[2]);
    if (dx * dx + dz * dz < r * r * 0.6) out.push(it);
  }
  return out;
}

/** After the ground has been dug round (x, z): what it has opened up. A piece with the soil gone from under more
    than a third of its footprint is undermined: its hold on the ground goes and it drops onto what is left. */
function expose(x: number, z: number, L: number): { exposed: number; undermined: number } {
  let exposed = 0, undermined = 0;
  for (const p of [...buried]) {
    if (p.dead) continue;
    b3.b3Body_ComputeAABB(_bb, p.body);
    if (_bb[0] > x + L || _bb[3] < x - L || _bb[2] > z + L || _bb[5] < z - L) continue;
    const u = under(_bb, Infinity, _bb[1] - 0.05, true);
    if (u.min < _bb[4]) exposed++;
    if (u.below > 0.34) {
      undermined++;
      hooks?.unground(p);
      free(p);
    }
  }
  return { exposed, undermined };
}

/** Dig at (x, z): lower the ground by up to `depth` over a disc of radius r (an excavator bucket). Returns m³ taken. */
export function dig(x: number, z: number, r: number, depth: number): number {
  const d = cur();
  if (!d) return 0;
  const n = d.n;
  let vol = 0;
  const i0 = Math.max(1, Math.floor((x - r + d.half) / d.cell)), i1 = Math.min(n - 2, Math.ceil((x + r + d.half) / d.cell));
  const j0 = Math.max(1, Math.floor((z - r + d.half) / d.cell)), j1 = Math.min(n - 2, Math.ceil((z + r + d.half) / d.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j, rr = Math.hypot(-d.half + i * d.cell - x, -d.half + j * d.cell - z);
    if (rr >= r) continue;
    const dh = depth * (1 - (rr / r) ** 2);
    d.h[k] -= dh;
    d.mat[k] = SURFACES.indexOf('soil');
    vol += dh * d.cell * d.cell;
  }
  if (vol > 0) { touchTiles(x - r, x + r, z - r, z + r, false); expose(x, z, r); }
  return vol;
}

/** Tip `vol` m³ of spoil at (x, z): a cone-ish heap over a disc of radius r (the inverse of dig). Returns m³ laid. */
export function mound(x: number, z: number, r: number, vol: number): number {
  const d = cur();
  if (!d || !(vol > 0)) return 0;
  const n = d.n;
  const i0 = Math.max(1, Math.floor((x - r + d.half) / d.cell)), i1 = Math.min(n - 2, Math.ceil((x + r + d.half) / d.cell));
  const j0 = Math.max(1, Math.floor((z - r + d.half) / d.cell)), j1 = Math.min(n - 2, Math.ceil((z + r + d.half) / d.cell));
  let w = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const rr = Math.hypot(-d.half + i * d.cell - x, -d.half + j * d.cell - z);
    if (rr < r && !d.hole[i + n * j]) w += 1 - (rr / r) ** 2;
  }
  if (w <= 0) return 0;
  const h = vol / (w * d.cell * d.cell);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j, rr = Math.hypot(-d.half + i * d.cell - x, -d.half + j * d.cell - z);
    if (rr >= r || d.hole[k]) continue;
    d.h[k] += h * (1 - (rr / r) ** 2);
    d.mat[k] = SURFACES.indexOf('soil');
  }
  touchTiles(x - r, x + r, z - r, z + r, false);
  return vol;
}

/** the static bodies carrying the ground (tiles and apron) */
export function groundBodies(): readonly b3BodyId[] { return bodies; }
