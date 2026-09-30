import type { b3BodyId, b3HeightFieldData, b3ShapeId } from 'box3d.js';
import type { Vec3 } from '../types';
import type { Piece } from '../destruction/structure';
import { b3, world, groundSlab, CAT, ALL, filter, register, stepCount, lastMoveStep, recentlyMoved, FIXED_DT, overlapAABB, type PhysEntity } from '../physics/physics';
import { fx } from '../render/fx';
import { SURFACES, TILE_CELLS, type SurfaceId, type TerrainSpec } from './spec';
import { fieldHeight, groundHeight, isHole, rasterize, surfaceIdAt, type TerrainData } from './raster';
import { SURFACE } from './surface';
import {
  initSoil, soilStep, takeBox, digSoil, heapSoil, craterSoil, dentSoil, shake, spawn, activate, surfaceSoil, isSealed, looseVolume,
  soilProps, ceilings, activeBox, heldBlocks, displace, SOILS, RHO_LOOSE, type SoilId, type SoilState,
} from './soil';

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
/** each tile's heightfield data (box3d keeps a pointer to it) and the heights it was made from */
let hfData: (b3HeightFieldData | null)[] = [];
let sent: Float32Array[] = [];
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
  d.soil = initSoil(d);
  terrain.data = d;
  soilLast = stepCount;
  commitStep = stepCount;
  capStep = -1e9;
  heldTile = -1;
  qCount = -1;
  buried.clear();
  entombed.clear();
  shapeMat.clear();
  const T = d.tiles;
  bodies = new Array(T * T);
  fields = new Array(T * T).fill(null);
  for (const h of hfData) if (h) b3.b3DestroyHeightField(h);
  hfData = new Array(T * T).fill(null);
  sent = new Array(T * T);
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
  if (hfData[t]) b3.b3DestroyHeightField(hfData[t]);
  const hs = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hs[i + N * j] = d.h[tx * TILE_CELLS + i + n * (tz * TILE_CELLS + j)];
  const hf = b3.b3CreateHeightField(hs, N, N, [d.cell, 1, d.cell]);
  hfData[t] = hf;
  sent[t] = hs;
  fields[t] = b3.b3CreateHeightFieldShape(bodies[t], groundDef(0.8), hf);
}

/* Remaking a tile's heightfield wakes everything lying on it, 16 m round: the soil's slow creep (a run settling to its
   repose, held spoil working out from under rubble) would keep every pile on the tile from ever sleeping. A tile is
   remade once its ground has moved by a centimetre somewhere (the render follows the same tiles, so what is drawn is
   what is collided with). */
const RESEND = 0.01;
function stale(d: TerrainData, t: number): boolean {
  const T = d.tiles, tx = t % T, tz = Math.floor(t / T), n = d.n, hs = sent[t];
  if (!hs) return true;
  for (let j = 0; j < N; j++) {
    const row = tx * TILE_CELLS + n * (tz * TILE_CELLS + j);
    for (let i = 0; i < N; i++) if (Math.abs(d.h[row + i] - hs[i + N * j]) > RESEND) return true;
  }
  return false;
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
  if (!d) return 'soil';
  // spoil lying on a pavement is dug, walked and driven as soil
  const s = d.soil, k = s ? nearest(d, x, z) : -1;
  if (s && k >= 0 && s.L[k] > 0.05) return 'soil';
  return SURFACES[surfaceIdAt(d, x, z)];
}

function nearest(d: TerrainData, x: number, z: number): number {
  const i = Math.round((x + d.half) / d.cell), j = Math.round((z + d.half) / d.cell);
  return i < 0 || j < 0 || i >= d.n || j >= d.n ? -1 : i + d.n * j;
}

/** The soil at the surface at (x, z): loose spoil, or the stratum a cut has laid bare. */
export function soilAtSurface(x: number, z: number): SoilId {
  const d = cur(), k = d?.soil ? nearest(d, x, z) : -1;
  return k >= 0 ? SOILS[surfaceSoil(d!.soil!, k)] : 'topsoil';
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
function bottomOf(p: Piece): number { b3.b3Body_ComputeAABB(_ob, p.body); return _ob[1]; }

/** Held up: welded to the anchor, or to a piece reaching down to or below its underside that is itself held up (or
    bears on the ground: entombed, or colliding with it). Ground-floor pieces welded only to one another are not: with
    the ground's collision off they would fall through it together. */
function held(p: Piece): boolean {
  const seen = new Set<Piece>([p]), queue: Piece[] = [p], bot = [bottomOf(p)];
  for (let h = 0; h < queue.length; h++) {
    if (h >= 96) return true;
    const q = queue[h], qb = bot[h];
    for (const w of q.welds) {
      if (!w.alive) continue;
      if (!w.b) return true;
      const o = w.a === q ? w.b : w.a;
      if (o.dead || seen.has(o)) continue;
      const ob = bottomOf(o);
      if (ob > qb + 0.05) continue;
      if (entombed.has(o) || !buried.has(o)) return true;
      seen.add(o);
      queue.push(o);
      bot.push(ob);
    }
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
  terrainStep();
  sweep(true);
}

/** Buried pieces nothing holds up any more (`full`: also those welded only to what is not held up itself) go back to
    the ground, or into it. Their collision with the ground is off: every step one is left falls through it. */
function sweep(full: boolean): void {
  for (const p of buried) {
    if (p.dead) { buried.delete(p); entombed.delete(p); continue; }
    if (entombed.has(p) || (p.welds.length && !full)) continue;
    if (p.welds.length && (p.welds.some((w) => w.alive && !w.b) || held(p))) continue;
    if (embedded(p)) entomb(p); else free(p);
  }
}

/** Hand a piece back to the ground: let it collide, and push the soil out of the way where the heightfield passes
    into it (only under the piece itself: its own footprint, to its own underside), so it starts clear. */
function free(p: Piece): void {
  if (entombed.delete(p)) b3.b3Body_SetType(p.body, b3.b3BodyType.b3_dynamicBody);
  setGround(p, true);
  buried.delete(p);
  clearUnder(p);
  b3.b3Body_SetAwake(p.body, true);
}

const _ks: number[] = [], _ys: number[] = [];
/** The heightfield samples under p that stand above its underside, lowered to it (the soil displaced round it). */
function clearUnder(p: Piece): void {
  const d = cur();
  if (!d) return;
  b3.b3Body_ComputeAABB(_bb, p.body);
  if (!d.soil) { carveBox(_bb[0] - 0.05, _bb[3] + 0.05, _bb[2] - 0.05, _bb[5] + 0.05, _bb[1] - 0.02); return; }
  const n = d.n, c = d.cell, lo = _bb[1] - 0.05, len = _bb[4] - _bb[1] + 0.1;
  const i0 = Math.max(1, Math.ceil((_bb[0] + d.half) / c)), i1 = Math.min(n - 2, Math.floor((_bb[3] + d.half) / c));
  const j0 = Math.max(1, Math.ceil((_bb[2] + d.half) / c)), j1 = Math.min(n - 2, Math.floor((_bb[5] + d.half) / c));
  _ks.length = _ys.length = 0;
  const shapes = shapesOf(p);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j;
    if (d.h[k] < lo || d.hole[k]) continue;
    const x = -d.half + i * c, z = -d.half + j * c;
    let y = Infinity;
    for (const s of shapes) {
      if (!b3.b3Shape_IsValid(s)) continue;
      const r = b3.b3Shape_RayCast(s, [x, lo, z], [0, len, 0]);
      if (r.hit && r.point[1] < y) y = r.point[1];
    }
    if (y - 0.02 < d.h[k]) { _ks.push(k); _ys.push(y - 0.02); }
  }
  if (!_ks.length) return;
  const x0 = _bb[0] - 2 * c, x1 = _bb[3] + 2 * c, z0 = _bb[2] - 2 * c, z1 = _bb[5] + 2 * c;
  capRegion(d, d.soil, x0, x1, z0, z1);
  const m = displace(d, d.soil, _ks, _ys);
  soilCost.displaced += m;
  const b = takeBox(d.soil);
  if (b) commitBox(d, b);
}

/* ---------------- deformation ---------------- */

export interface CraterInfo { x: number; z: number; r: number; depth: number; ms: number; tiles: number; exposed: number; undermined: number; /** kg of soil thrown out (and laid back as rim, blanket and clods) */ thrown: number }
export const craterLog: CraterInfo[] = [];

function touchTiles(x0: number, x1: number, z0: number, z1: number, feat: boolean): number {
  const d = terrain.data!, T = d.tiles;
  const a0 = Math.max(0, Math.floor((x0 + d.half) / (d.cell * TILE_CELLS) - 1e-9)), a1 = Math.min(T - 1, Math.floor((x1 + d.half) / (d.cell * TILE_CELLS) + 1e-9));
  const b0 = Math.max(0, Math.floor((z0 + d.half) / (d.cell * TILE_CELLS) - 1e-9)), b1 = Math.min(T - 1, Math.floor((z1 + d.half) / (d.cell * TILE_CELLS) + 1e-9));
  let k = 0;
  for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
    const t = a + T * b;
    if (!feat && !stale(d, t)) continue;
    tileField(t);
    if (feat) tileFeatures(t);
    terrain.dirty.add(t);
    k++;
  }
  if (k) terrain.version++;
  return k;
}

/** Lower the heightfield inside a box footprint to y (never raises): ground laid without soil. */
function carveBox(x0: number, x1: number, z0: number, z1: number, y: number): void {
  const d = cur();
  if (!d) return;
  const n = d.n;
  const i0 = Math.max(0, Math.floor((x0 + d.half) / d.cell)), i1 = Math.min(n - 1, Math.ceil((x1 + d.half) / d.cell));
  const j0 = Math.max(0, Math.floor((z0 + d.half) / d.cell)), j1 = Math.min(n - 1, Math.ceil((z1 + d.half) / d.cell));
  let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j;
    if (d.h[k] > y + 0.03) {
      d.h[k] = y; d.mat[k] = SURFACES.indexOf('soil'); changed = true;
    }
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
  const D = R * (bound ? 0.3 : 0.45), n = d.n;
  const bowl = SURFACES.indexOf(bound ? 'rubble' : 'soil');
  let L = 1.45 * R, thrown = 0;
  if (d.soil) {
    capRegion(d, d.soil, px - 3.5 * R - d.cell, px + 3.5 * R + d.cell, pz - 3.5 * R - d.cell, pz + 3.5 * R + d.cell);
    const c = craterSoil(d, d.soil, px, pz, surf, R, D);
    thrown = c.mass;
    L = Math.max(L, (Math.max(c.i1 - c.i0, c.j1 - c.j0) * d.cell) / 2);
    const i0 = Math.max(0, Math.floor((px - R + d.half) / d.cell)), i1 = Math.min(n - 1, Math.ceil((px + R + d.half) / d.cell));
    const j0 = Math.max(0, Math.floor((pz - R + d.half) / d.cell)), j1 = Math.min(n - 1, Math.ceil((pz + R + d.half) / d.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(-d.half + i * d.cell - px, -d.half + j * d.cell - pz) < R) d.mat[i + n * j] = bowl;
    // the ground round it is shaken: steep faces near by lose strength
    shake(d, d.soil, px, pz, 5 * R, 25);
    takeBox(d.soil);
  } else {
    const i0 = Math.max(1, Math.floor((px - L + d.half) / d.cell)), i1 = Math.min(n - 2, Math.ceil((px + L + d.half) / d.cell));
    const j0 = Math.max(1, Math.floor((pz - L + d.half) / d.cell)), j1 = Math.min(n - 2, Math.ceil((pz + L + d.half) / d.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i + n * j;
      const r = Math.hypot(-d.half + i * d.cell - px, -d.half + j * d.cell - pz);
      if (r < R) { d.h[k] -= D * (1 - (r / R) ** 2); d.mat[k] = bowl; }
      else if (r < L) d.h[k] += 0.12 * D * Math.sin((Math.PI * (r - R)) / (L - R));
    }
  }
  const tiles = touchTiles(px - L, px + L, pz - L, pz + L, feat);
  // ejecta: soil thrown up and out, a dust skirt; clods of the strata it went down into
  const col = sp.dust;
  fx.debris([px, surf + 0.2, pz], Math.round(10 + 30 * R), col, 4 + 5 * R, [0, 1, 0]);
  fx.dust([px, surf, pz], 1.5 * L, col);
  if (d.soil && R > 0.6) {
    const deep = soilProps(d.soil.types[Math.min(d.soil.nl - 1, 1)]).color;
    fx.debris([px, surf + 0.1, pz], Math.round(8 + 12 * R), deep, 3 + 3 * R, [0, 1, 0]);
    fx.dust([px, surf + 0.5, pz], 0.8 * L, deep);
  }
  const res = expose(px, pz, L);
  const info: CraterInfo = { x: px, z: pz, r: R, depth: D, ms: performance.now() - t0, tiles, thrown, ...res };
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
    if (d.soil) activate(d.soil, k);
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
  return exposeBox(x - L, x + L, z - L, z + L);
}

function exposeBox(x0: number, x1: number, z0: number, z1: number): { exposed: number; undermined: number } {
  let exposed = 0, undermined = 0;
  const near: Piece[] = [];
  // nothing founded in the ground is more than ~12 m across: a cheap cut on the centre first
  for (const p of buried) if (!p.dead && p.curPos[0] > x0 - 12 && p.curPos[0] < x1 + 12 && p.curPos[2] > z0 - 12 && p.curPos[2] < z1 + 12) near.push(p);
  for (const p of near) {
    if (p.dead) continue;
    b3.b3Body_ComputeAABB(_bb, p.body);
    if (_bb[0] > x1 || _bb[3] < x0 || _bb[2] > z1 || _bb[5] < z0) continue;
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

/** What a bite of ground brought up: loose (bucket) m³, kg, and the soil it mostly was. */
export interface Dug { vol: number; mass: number; soil: SoilId }
let lastDug: SoilId = 'topsoil';
const _acc = new Float64Array(SOILS.length);

/** Dig at (x, z): a bite up to `depth` deep over a disc of radius r (an excavator bucket); what came up. An unbroken
    pavement gives up only what lies on it. */
export function digGround(x: number, z: number, r: number, depth: number): Dug {
  const d = cur();
  if (!d || !(depth > 0)) return { vol: 0, mass: 0, soil: lastDug };
  if (!d.soil) return { vol: legacyDig(d, x, z, r, depth), mass: 0, soil: 'topsoil' };
  _acc.fill(0);
  const mass = digSoil(d, d.soil, x, z, r, depth, _acc, true);
  if (mass <= 0) return { vol: 0, mass: 0, soil: lastDug };
  let best = 0;
  for (let t = 1; t < SOILS.length; t++) if (_acc[t] > _acc[best]) best = t;
  lastDug = SOILS[best];
  const b = takeBox(d.soil);
  if (b) commitBox(d, b);
  return { vol: looseVolume(_acc) * d.cell * d.cell, mass, soil: lastDug };
}

/** Dig at (x, z): lower the ground by up to `depth` over a disc of radius r. Returns the loose m³ taken. */
export function dig(x: number, z: number, r: number, depth: number): number {
  return digGround(x, z, r, depth).vol;
}

function legacyDig(d: TerrainData, x: number, z: number, r: number, depth: number): number {
  const n = d.n;
  let vol = 0;
  const i0 = Math.max(1, Math.floor((x - r + d.half) / d.cell)), i1 = Math.min(n - 2, Math.ceil((x + r + d.half) / d.cell));
  const j0 = Math.max(1, Math.floor((z - r + d.half) / d.cell)), j1 = Math.min(n - 2, Math.ceil((z + r + d.half) / d.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = i + n * j, rr = Math.hypot(-d.half + i * d.cell - x, -d.half + j * d.cell - z);
    if (rr >= r || d.hole[k]) continue;
    const dh = depth * (1 - (rr / r) ** 2);
    d.h[k] -= dh;
    d.mat[k] = SURFACES.indexOf('soil');
    vol += dh * d.cell * d.cell;
  }
  if (vol > 0) { touchTiles(x - r, x + r, z - r, z + r, false); expose(x, z, r); }
  return vol;
}

/** Tip spoil at (x, z) over a disc of radius r: `vol` loose m³ (of `mass` kg of `soil`, else of what was last dug);
    it runs down to its angle of repose. Returns m³ laid. */
export function mound(x: number, z: number, r: number, vol: number, mass?: number, soil?: SoilId): number {
  const d = cur();
  if (!d || !(vol > 0)) return 0;
  const s = d.soil;
  if (!s) return 0;
  const t = SOILS.indexOf(soil ?? lastDug);
  capRegion(d, s, x - r - 2 * d.cell, x + r + 2 * d.cell, z - r - 2 * d.cell, z + r + 2 * d.cell);
  heapSoil(d, s, x, z, r, mass ?? vol * RHO_LOOSE[t], t);
  const b = takeBox(s);
  if (b) commitBox(d, b);
  return vol;
}

/** A clod of `mass` kg of `soil` let go at pos with velocity vel (tipped from a bucket); it lands and is laid. */
export function spill(pos: ArrayLike<number>, vel: ArrayLike<number>, mass: number, soil: SoilId): void {
  const d = cur();
  if (!d?.soil || !(mass > 0)) return;
  spawn(d.soil, d, pos[0], pos[1], pos[2], vel[0], vel[1], vel[2], mass, SOILS.indexOf(soil));
}

/* ---------------- the soil, stepped ---------------- */

let soilLast = 0, commitStep = 0, qCount = -1, qStep = 0, capStep = -1e9, heldTile = -1;
/** per-step cost and counts; `displaced`: kg of soil pushed out from under pieces handed back to the ground; `held`:
    kg of loose soil held under what lies on it (laid back when that goes); `capMs`: total ms refreshing the ceilings */
export const soilCost = { ms: 0, max: 0, commitMs: 0, visits: 0, active: 0, clods: 0, fails: 0, dents: 0, displaced: 0, held: 0, capMs: 0 };

const _sb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const NOT_GROUND = ALL & ~CAT.ground;
/** The soil's ceilings over a region from what lies on the ground there now: every non-static shape that collides
    with the ground and reaches down to within 3 m of it. */
function capRegion(d: TerrainData, s: SoilState, x0: number, x1: number, z0: number, z1: number): void {
  const t0 = performance.now(), n = d.n;
  const i0 = Math.max(0, Math.floor((x0 + d.half) / d.cell)), i1 = Math.min(n - 1, Math.ceil((x1 + d.half) / d.cell));
  const j0 = Math.max(0, Math.floor((z0 + d.half) / d.cell)), j1 = Math.min(n - 1, Math.ceil((z1 + d.half) / d.cell));
  let lo = Infinity, hi = -Infinity;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const h = d.h[i + n * j]; if (h < lo) lo = h; if (h > hi) hi = h; }
  if (!(lo <= hi)) return;
  const c = d.cell;
  ceilings(s, x0, x1, z0, z1, (put) => overlapAABB([x0 - c, lo - 0.5, z0 - c], [x1 + c, hi + 3, z1 + c], NOT_GROUND, (sh) => {
    if (b3.b3Shape_IsSensor(sh) || !(b3.b3Shape_GetFilter(sh).maskBits & CAT.ground)) return;
    if (b3.b3Body_GetType(b3.b3Shape_GetBody(sh)) === b3.b3BodyType.b3_staticBody) return;
    b3.b3Shape_GetAABB(_sb, sh);
    put(_sb[0], _sb[3], _sb[2], _sb[5], _sb[1] - 0.01);
  }));
  soilCost.capMs += performance.now() - t0;
}

/** Ceilings wherever the soil may rise before the next refresh: its active cells and clods in flight; and, a tile at a
    time in turn, where it holds soil under something that may since have moved. */
function refreshCaps(d: TerrainData, s: SoilState): void {
  const boxes = [activeBox(s)];
  if (s.holds.size) {
    const tiles = heldBlocks(s, TILE_CELLS);
    let pick = -1;
    for (const t of tiles.keys()) if (t > heldTile) { pick = t; break; }
    if (pick < 0) pick = tiles.keys().next().value!;
    heldTile = pick;
    boxes.push(tiles.get(pick)!);
  }
  for (const b of boxes) {
    if (b[0] > b[1]) continue;
    capRegion(d, s, -d.half + (b[0] - 2) * d.cell, -d.half + (b[1] + 2) * d.cell, -d.half + (b[2] - 2) * d.cell, -d.half + (b[3] + 2) * d.cell);
  }
}

/** Once per physics step (main loop; the buried-piece sweep catches up for loops that do not call it): the soil
    runs and slips, clods land, falling pieces dent soft ground; changed ground reaches the physics at 10 Hz. */
export function terrainStep(pieces?: Iterable<Piece>): void {
  const d = cur(), s = d?.soil;
  if (!d || !s) return;
  const t0 = performance.now();
  if (pieces) impacts(d, s, pieces);
  const due = Math.min(30, stepCount - soilLast);
  if (due > 0 && stepCount - capStep >= 6) { capStep = stepCount; refreshCaps(d, s); }
  if (due > 0) {
    soilLast = stepCount;
    for (let q = 0; q < due; q++) soilCost.visits = soilStep(d, s);
  }
  if (stepCount - commitStep >= 6) {
    commitStep = stepCount;
    // (the structure's own sweep runs at 2 Hz; a piece cut loose between them would sink half a metre into the ground)
    if (pieces) sweep(false);
    const b = takeBox(s);
    if (b) {
      const tc = performance.now();
      if (buried.size !== qCount || stepCount - qStep > 600) surcharge(d, s);
      commitBox(d, b);
      soilCost.commitMs = performance.now() - tc;
    }
    // slips: a burst of the soil's dust where it went
    for (let e = 0; e + 1 < s.events.length && e < 8; e += 2) {
      const k = s.events[e], m = s.events[e + 1], x = -d.half + (k % d.n) * d.cell, z = -d.half + Math.floor(k / d.n) * d.cell;
      fx.dust([x, d.h[k], z], Math.min(3, 0.5 + Math.cbrt(m / 800)), soilProps(surfaceSoil(s, k)).color);
    }
    s.events.length = 0;
  }
  const ms = performance.now() - t0;
  soilCost.ms += (ms - soilCost.ms) * 0.1;
  soilCost.max = Math.max(soilCost.max * 0.995, ms);
  soilCost.active = s.count;
  soilCost.clods = s.parts.n;
  soilCost.fails = s.stats.fails;
  soilCost.dents = s.stats.dents;
  if (stepCount === commitStep) { let h = 0; for (const k of s.holds) h += s.hold[k]; soilCost.held = h * d.cell * d.cell; }
}

/** the soil state of the terrain laid now (render, tools) */
export function soilState(): SoilState | null { return cur()?.soil ?? null; }

function commitBox(d: TerrainData, b: [number, number, number, number]): void {
  const x0 = -d.half + b[0] * d.cell, x1 = -d.half + b[1] * d.cell, z0 = -d.half + b[2] * d.cell, z1 = -d.half + b[3] * d.cell;
  touchTiles(x0 - d.cell, x1 + d.cell, z0 - d.cell, z1 + d.cell, false);
  exposeBox(x0 - d.cell, x1 + d.cell, z0 - d.cell, z1 + d.cell);
}

/* What is founded on the ground loads it: a footing, slab or wall base bears on the soil under it at its own weight
   over its footprint plus a storey's share (~40 kPa; strip footings of houses bear 50-150 kPa). A cut beside it
   has that surcharge on its crest. */
function surcharge(d: TerrainData, s: SoilState): void {
  qCount = buried.size;
  qStep = stepCount;
  s.q.fill(0);
  const n = d.n;
  for (const p of buried) {
    if (p.dead || p.mass < 300) continue;
    b3.b3Body_ComputeAABB(_bb, p.body);
    const cx = (_bb[0] + _bb[3]) / 2, cz = (_bb[2] + _bb[5]) / 2, area = (_bb[3] - _bb[0]) * (_bb[5] - _bb[2]);
    if (area < 0.3) continue;
    const g = surfaceY(cx, cz);
    if (_bb[1] > g + 0.3 || _bb[4] < g - 0.5) continue;
    const q = Math.min(150, 40 + (p.mass * 9.81) / 1000 / area);
    const i0 = Math.max(0, Math.floor((_bb[0] - 0.25 + d.half) / d.cell)), i1 = Math.min(n - 1, Math.ceil((_bb[3] + 0.25 + d.half) / d.cell));
    const j0 = Math.max(0, Math.floor((_bb[2] - 0.25 + d.half) / d.cell)), j1 = Math.min(n - 1, Math.ceil((_bb[5] + 0.25 + d.half) / d.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) s.q[i + n * j] = Math.max(s.q[i + n * j], q);
  }
}

/* A heavy piece landing on soft ground drives into it: the plastic work of the dent (its volume times the ground's
   resistance, ~150 kPa for loose spoil to 1 MPa for gravel) takes about 60 % of the vertical kinetic energy lost
   (the rest goes into the piece, the bounce and the air); the soil displaced heaves round it. */
const fall = new WeakMap<Piece, { vy: number; st: number }>();
function impacts(d: TerrainData, s: SoilState, pieces: Iterable<Piece>): void {
  // only what moved this step or the last can be landing: with nothing moving, the walk below would skip every piece
  if (lastMoveStep < stepCount - 1) return;
  let budget = 6;
  for (const p of pieces instanceof Set ? movedPieces(pieces) : pieces) {
    if (p.dead || p.movedStep < stepCount - 1) continue;
    const vy = p.movedStep === stepCount ? (p.curPos[1] - p.prevPos[1]) / FIXED_DT : 0;
    let o = fall.get(p);
    if (!o) { fall.set(p, { vy, st: stepCount }); continue; }
    const v0 = o.st === stepCount - 1 ? o.vy : 0;
    o.vy = vy; o.st = stepCount;
    if (v0 > -2.5 || vy < v0 * 0.35 || p.mass < 40 || budget <= 0 || buried.has(p) || p.hinged) continue;
    const sp = p.root.spec;
    if (sp.vehicle || sp.wheel || sp.mech || sp.soft) continue;
    b3.b3Body_ComputeAABB(_bb, p.body);
    const cx = (_bb[0] + _bb[3]) / 2, cz = (_bb[2] + _bb[5]) / 2, g = surfaceY(cx, cz);
    if (_bb[1] > g + 0.25 || groundAt(cx, cz) > g + 0.02) continue;
    const k = nearest(d, cx, cz);
    if (k < 0 || isSealed(d, s, k)) continue;
    const qu = (s.L[k] > 0.05 ? 150 : soilProps(surfaceSoil(s, k)).qu) * 1000;
    const dx = _bb[3] - _bb[0], dz = _bb[5] - _bb[2];
    const E = 0.5 * p.mass * (v0 * v0 - (vy < 0 ? vy * vy : 0));
    const A = Math.max(0.05, dx * dz * 0.6);
    const depth = Math.min((0.6 * E) / (qu * A), 0.35, 0.5 * (_bb[4] - _bb[1]));
    if (depth < 0.015) continue;
    budget--;
    capRegion(d, s, _bb[0] - 2 * d.cell, _bb[3] + 2 * d.cell, _bb[2] - 2 * d.cell, _bb[5] + 2 * d.cell);
    dentSoil(d, s, cx - dx * 0.4, cx + dx * 0.4, cz - dz * 0.4, cz + dz * 0.4, depth);
    fx.dust([cx, g, cz], 0.4 + 3 * depth, soilProps(surfaceSoil(s, k)).color);
  }
  // the dents reach the physics at once (the pieces that made them are lying in them)
  if (budget < 6) { const b = takeBox(s); if (b) commitBox(d, b); }
}

/* The live pieces that moved this step or the last, in the live set's order (ascending id: a piece gets its id as it
   joins the set), so the dent budget goes to the same pieces a walk of the whole set would give it to. */
const _moved: Piece[] = [];
function movedPieces(live: Set<Piece>): Iterable<Piece> {
  const recent = recentlyMoved();
  // in a collapse most of the set moves: sorting that many costs more than the walk it saves
  if ((recent[0].length + recent[1].length) * 4 > live.size) return live;
  _moved.length = 0;
  for (const list of recent) for (const e of list) if (e.kind === 'piece' && live.has(e as Piece)) _moved.push(e as Piece);
  _moved.sort((a, b) => a.id - b.id);
  let w = 0;
  for (let i = 0; i < _moved.length; i++) if (w === 0 || _moved[i] !== _moved[w - 1]) _moved[w++] = _moved[i];
  _moved.length = w;
  return _moved;
}

/** the static bodies carrying the ground (tiles and apron) */
export function groundBodies(): readonly b3BodyId[] { return bodies; }
