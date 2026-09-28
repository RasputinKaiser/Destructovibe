import { vec3, quat } from 'math';
import type { Vec3, Quat } from '../../types';
import { b3, CAT, overlapAABB, entityOfShape, stepCount } from '../../physics/physics';
import * as P from '../../destruction/polytope';
import type { Piece } from '../../destruction/structure';

/* Sparse voxel store: 1 m cells in 16³ bricks, allocated only where something is happening. */

export const N = 16, N3 = N * N * N;
export const F_T = 0, F_SMOKE = 1, F_DARK = 2, F_O2 = 3, F_CH4 = 4, F_C3H8 = 5, F_FUEL = 6, F_STEAM = 7, F_CO = 8,
  F_WAT = 9, F_U = 10, F_V = 11, F_W = 12, F_P = 13, F_BURN = 14, F_PK = 15, NF = 16;
/** fields carried by the flow (scalars and velocity); droplets fall through it separately */
export const ADV = [F_T, F_SMOKE, F_DARK, F_O2, F_CH4, F_C3H8, F_FUEL, F_STEAM, F_CO, F_U, F_V, F_W];
export const O2_AIR = 0.2095;
export const MAX_BRICKS = 24;

/** ambient state of the open air around the active region */
export const amb = new Float32Array(NF);
amb[F_T] = 20;
amb[F_O2] = O2_AIR;

export interface Rast {
  vox: number[];            // voxel indices this piece marks in the brick
  amt: number[];            // …and the cover it adds to each (solid pieces)
  solid: boolean;
  pos: Vec3;
  rot: Quat;
  home: boolean;            // the brick holding the piece's origin: it does the piece's gas exchange here
  near: number;             // voxel at the piece's origin
  comb: boolean;            // combustible
}

export interface Brick {
  key: number; bx: number; by: number; bz: number; ox: number; oy: number; oz: number;
  f: Float32Array[];
  occ: Uint8Array;          // cross-section covered by solid pieces, 1/32nds
  por: Uint8Array;          // porous pieces (props, rods, rubble); three or more block like a solid
  ign: Uint8Array;          // ignition source in the voxel this step
  nb: (Brick | null)[];     // 27-neighbourhood, self at 13
  rast: Map<Piece, Rast>;
  last: number;             // field clock at its last step
  idle: number;
  rescan: number;
  maxT: number;
  content: boolean;
}

export const bricks = new Map<number, Brick>();
export const brickList: Brick[] = [];
let nbDirty = false;
const pool: Brick[] = [];

export const bkey = (bx: number, by: number, bz: number): number => ((bx + 1024) * 2048 + (by + 1024)) * 2048 + (bz + 1024);

export function brickAt(bx: number, by: number, bz: number): Brick | undefined {
  return bricks.get(bkey(bx, by, bz));
}

export function allocBrick(bx: number, by: number, bz: number, clock: number, scanNow = true): Brick | null {
  if (by < 0) return null;
  const k = bkey(bx, by, bz);
  let b = bricks.get(k);
  if (b) return b;
  if (brickList.length >= MAX_BRICKS) return null;
  b = pool.pop();
  if (!b) {
    const f: Float32Array[] = [];
    for (let i = 0; i < NF; i++) f.push(new Float32Array(N3));
    b = { key: 0, bx: 0, by: 0, bz: 0, ox: 0, oy: 0, oz: 0, f, occ: new Uint8Array(N3), por: new Uint8Array(N3), ign: new Uint8Array(N3),
      nb: new Array(27).fill(null), rast: new Map(), last: 0, idle: 0, rescan: 0, maxT: 20, content: false };
  }
  b.key = k; b.bx = bx; b.by = by; b.bz = bz; b.ox = bx * N; b.oy = by * N; b.oz = bz * N;
  for (let i = 0; i < NF; i++) b.f[i].fill(i === F_U || i === F_W ? 0 : amb[i]);
  b.occ.fill(0); b.por.fill(0); b.ign.fill(0);
  b.rast.clear();
  b.last = clock; b.idle = 0; b.rescan = 0; b.maxT = amb[F_T]; b.content = false;
  bricks.set(k, b);
  brickList.push(b);
  nbDirty = true;
  if (scanNow) scanBrick(b); else b.rescan = -1;
  return b;
}

export function freeBrick(b: Brick): void {
  for (const [p, r] of b.rast) unmark(b, p, r);
  b.rast.clear();
  bricks.delete(b.key);
  const i = brickList.indexOf(b);
  if (i >= 0) brickList.splice(i, 1);
  pool.push(b);
  nbDirty = true;
}

export function clearBricks(): void {
  for (const b of brickList.slice()) freeBrick(b);
}

export function linkNeighbours(): void {
  if (!nbDirty) return;
  nbDirty = false;
  for (const b of brickList) {
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      b.nb[dx + 1 + 3 * (dy + 1 + 3 * (dz + 1))] = bricks.get(bkey(b.bx + dx, b.by + dy, b.bz + dz)) ?? null;
  }
}

/** Activates the brick holding a world point, and its neighbours within `pad` metres of it. */
export function touch(x: number, y: number, z: number, pad: number, clock: number): Brick | null {
  const vx = Math.floor(x), vy = Math.max(0, Math.floor(y)), vz = Math.floor(z);
  const bx = Math.floor(vx / N), by = Math.floor(vy / N), bz = Math.floor(vz / N);
  const b = allocBrick(bx, by, bz, clock);
  if (pad > 0) {
    const lx = vx - bx * N, ly = vy - by * N, lz = vz - bz * N;
    const sx = lx < pad ? -1 : lx >= N - pad ? 1 : 0, sy = ly < pad ? -1 : ly >= N - pad ? 1 : 0, sz = lz < pad ? -1 : lz >= N - pad ? 1 : 0;
    if (sx) allocBrick(bx + sx, by, bz, clock);
    if (sy) allocBrick(bx, by + sy, bz, clock);
    if (sz) allocBrick(bx, by, bz + sz, clock);
    if (sx && sz) allocBrick(bx + sx, by, bz + sz, clock);
  }
  return b;
}

/** Voxel lookup: returns the index within `hit`, or -1 when the brick is not allocated. */
export let hit: Brick = null as unknown as Brick;
export function lookup(x: number, y: number, z: number): number {
  const vx = Math.floor(x), vy = Math.floor(y), vz = Math.floor(z);
  if (vy < 0) return -1;
  const bx = vx >> 4, by = vy >> 4, bz = vz >> 4;
  const b = bricks.get(bkey(bx, by, bz));
  if (!b) return -1;
  hit = b;
  return (vx - b.ox) + N * ((vy - b.oy) + N * (vz - b.oz));
}

export const blocked = (b: Brick, i: number): boolean => b.occ[i] > 16 || b.por[i] >= 3;

/* ---------------- occupancy from rigid pieces ---------------- */

const localBox = new WeakMap<P.Poly, [Vec3, Vec3]>();
export function polyBox(poly: P.Poly): [Vec3, Vec3] {
  let r = localBox.get(poly);
  if (!r) {
    r = [[0, 0, 0], [0, 0, 0]];
    P.bounds(poly, r[0], r[1]);
    localBox.set(poly, r);
  }
  return r;
}

const COMB = new Set(['wood', 'oak', 'plywood', 'crate', 'pvc']);
const FRAGILE = new Set(['glass', 'tempered', 'lamp']);
export const isFragile = (p: Piece): boolean => FRAGILE.has(p.mat);

const _l: Vec3 = [0, 0, 0], _c: Vec3 = [0, 0, 0], _qi: Quat = [0, 0, 0, 1];
const _aabb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

/* Solid pieces add the share of each voxel's cross-section they cover (in 1/32nds); a voxel seals once more than
   half is covered. Across a thin side (a 250 mm wall, a pane) a piece counts in full for the one voxel whose
   centre is within half a cell of its mid-plane, so walls never slip between cell centres; along its long sides it
   counts the overlap, so two walls meeting mid-cell seal it together while a 1 m window beside one wall stays open
   once its glass has gone. Hulls and wedges are trimmed to within half a cell of the real solid. Pieces thin in two
   directions (studs, joists, rods) or small ones only obstruct; loose, moving ones are ignored. */
export const COVER = 32, SEAL = 16;
export function rasterize(p: Piece, x0: number, y0: number, z0: number, n: number, visit: (x: number, y: number, z: number, frac: number) => void): boolean {
  const [mn, mx] = polyBox(p.poly);
  const hx = (mx[0] - mn[0]) / 2, hy = (mx[1] - mn[1]) / 2, hz = (mx[2] - mn[2]) / 2;
  const cx = (mx[0] + mn[0]) / 2, cy = (mx[1] + mn[1]) / 2, cz = (mx[2] + mn[2]) / 2;
  const thick = (hx >= 0.15 ? 1 : 0) + (hy >= 0.15 ? 1 : 0) + (hz >= 0.15 ? 1 : 0);
  /* shards, splinters and small rubble let gas through the gaps between them */
  const solid = thick >= 2 && Math.max(hx, hy, hz) >= 0.3 && p.volume >= 0.015 && !(p.depth > 0 && p.demolished && p.volume < 0.08);
  const hull = p.poly.faces.length > 6;
  const tAx = hx <= hy && hx <= hz ? 0 : hy <= hz ? 1 : 2;
  b3.b3Body_ComputeAABB(_aabb, p.body);
  const ax = Math.max(x0, Math.floor(_aabb[0] - 0.5)), bx = Math.min(x0 + n - 1, Math.floor(_aabb[3] + 0.5));
  const ay = Math.max(y0, Math.floor(_aabb[1] - 0.5)), by = Math.min(y0 + n - 1, Math.floor(_aabb[4] + 0.5));
  const az = Math.max(z0, Math.floor(_aabb[2] - 0.5)), bz = Math.min(z0 + n - 1, Math.floor(_aabb[5] + 0.5));
  quat.conjugate(_qi, p.curRot);
  for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    vec3.set(_c, x + 0.5 - p.curPos[0], y + 0.5 - p.curPos[1], z + 0.5 - p.curPos[2]);
    vec3.transformQuat(_l, _c, _qi);
    const fx = span(hx, Math.abs(_l[0] - cx), tAx === 0), fy = fx > 0 ? span(hy, Math.abs(_l[1] - cy), tAx === 1) : 0, fz = fy > 0 ? span(hz, Math.abs(_l[2] - cz), tAx === 2) : 0;
    if (fz <= 0) continue;
    if (hull && !P.contains(p.poly, _l, -0.5)) continue;
    visit(x, y, z, fx * fy * fz);
  }
  return solid;
}

/* share of a unit cell covered by a slab of half-width h whose mid-plane is d from the cell centre; across its
   thinnest side a slab claims the whole cell it bisects */
function span(h: number, d: number, thin: boolean): number {
  if (thin && h < 0.5) return d <= 0.5 ? 1 : 0;
  const o = Math.min(d + h, 0.5) - Math.max(d - h, -0.5);
  return o <= 0 ? 0 : o >= 1 ? 1 : o;
}

function unmark(b: Brick, _p: Piece, r: Rast): void {
  if (r.solid) for (let k = 0; k < r.vox.length; k++) { const i = r.vox[k]; b.occ[i] = Math.max(0, b.occ[i] - r.amt[k]); }
  else for (const i of r.vox) if (b.por[i] > 0) b.por[i]--;
}

/* Fast-moving debris is transient: it neither seals nor obstructs until it comes to rest. */
function markable(p: Piece): boolean {
  return !p.dead && p.fade <= 0 && !(p.demolished && stepCount - p.movedStep < 3);
}

export function markPiece(b: Brick, p: Piece): void {
  const old = b.rast.get(p);
  if (old) { unmark(b, p, old); b.rast.delete(p); }
  if (!markable(p)) return;
  const vox: number[] = [], amt: number[] = [];
  const solid = rasterize(p, b.ox, b.oy, b.oz, N, (x, y, z, f) => {
    const a = Math.round(f * COVER);
    if (a <= 0) return;
    vox.push((x - b.ox) + N * ((y - b.oy) + N * (z - b.oz)));
    amt.push(a);
  });
  const lx = Math.floor(p.curPos[0]) - b.ox, ly = Math.floor(p.curPos[1]) - b.oy, lz = Math.floor(p.curPos[2]) - b.oz;
  const home = lx >= 0 && lx < N && ly >= 0 && ly < N && lz >= 0 && lz < N;
  if (!vox.length && !home) return;
  if (solid) for (let k = 0; k < vox.length; k++) b.occ[vox[k]] = Math.min(255, b.occ[vox[k]] + amt[k]);
  else for (const i of vox) if (b.por[i] < 255) b.por[i]++;
  b.rast.set(p, {
    vox, amt, solid, pos: [p.curPos[0], p.curPos[1], p.curPos[2]], rot: [p.curRot[0], p.curRot[1], p.curRot[2], p.curRot[3]],
    home, near: home ? lx + N * (ly + N * lz) : -1, comb: COMB.has(p.mat),
  });
}

export function scanBrick(b: Brick): void {
  const seen = new Set<Piece>();
  overlapAABB([b.ox - 0.5, b.oy - 0.5, b.oz - 0.5], [b.ox + N + 0.5, b.oy + N + 0.5, b.oz + N + 0.5], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (seen.has(p) || b.rast.has(p)) return;
    seen.add(p);
    markPiece(b, p);
  });
}

/** Re-rasterises pieces that died or moved; returns how many were redone. */
export function refreshOcc(b: Brick, budget: number): number {
  let n = 0;
  for (const [p, r] of b.rast) {
    if (p.dead || p.fade > 0) { unmark(b, p, r); b.rast.delete(p); continue; }
    if (n >= budget) continue;
    if (vec3.squaredDistance(p.curPos, r.pos) < 0.04 && Math.abs(quat.dot(p.curRot, r.rot)) > 0.999) continue;
    markPiece(b, p);
    n++;
  }
  return n;
}
