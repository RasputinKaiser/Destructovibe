import type { MaterialId, PieceSpec } from '../types.ts';
import { block, cyl, raise, splitRange, weldParts, type Range } from '../levels/kit.ts';
import { GROUND_TOL, pieceAabb, type Aabb } from '../levels/validate.ts';
import type { TerrainPlan } from './plan.ts';
import { CELL, DPC } from './spec.ts';

/* Foundations for a building built on y = 0 by its builder, applied at placement: the building is lifted a damp-proof
   course above the ground and stood on what it would really stand on.
     strip   concrete strip footings under the masonry wall lines (continuous under door openings), a mass pad and
             pier under each free-standing column; the ground-bearing slab is the site's static pad (plan.pad)
     raft    a reinforced raft over the footprint, optionally on a group of bored piles (towers)
     basement  a real room below ground: retaining walls, a base slab on the excavation, a suspended ground floor
             with a stair down through it, basement columns and a plant room; the terrain is holed over it
   Footings, rafts, piles and basement walls weld to the ground anchor: they carry the building. Whatever else stood
   on the ground (fittings, machines, small members) is anchored on the slab. A crater that takes the soil from
   under a footing lets it go (terrain.ts), and the building settles onto what is left. */

export interface FoundOpts {
  type?: 'strip' | 'raft';
  piles?: boolean;
  basement?: { depth?: number; stair?: boolean; plant?: boolean };
  /** footing depth below the ground (default 0.75 m, 1 m under tall masonry) */
  depth?: number;
  mat?: MaterialId;
}

export interface Founded {
  pieces: PieceSpec[];
  /** the footprint the terrain was prepared over */
  rect: { x: Range; z: Range };
  /** where the basement stair lands, if one was built */
  stair?: { x: Range; z: Range };
}

const RC = { tint: 0x9d9a92 }, MASS = { tint: 0xa9a59b };
/** walls that bear on a strip footing (cladding and glazing hang on the frame instead) */
const MASONRY: ReadonlySet<MaterialId> = new Set(['brick', 'stone', 'sandstone', 'concrete', 'rconcrete', 'cinderblock', 'adobe', 'plaster', 'wood', 'oak', 'marble']);
const COLUMN: ReadonlySet<MaterialId> = new Set(['rconcrete', 'steel', 'concrete', 'brick', 'stone', 'sandstone', 'castiron', 'oak', 'wood', 'marble']);
const bearingOf = (p: PieceSpec, b: Aabb) => !p.noWeld && !p.mech && !p.soft && !p.vehicle && !p.wheel && b.min[1] <= GROUND_TOL;

interface Strip { axis: 'x' | 'z'; c: number; t: number; a: number; b: number; h: number }

export function found(ps: PieceSpec[], plan: TerrainPlan, o: FoundOpts = {}): Founded {
  const boxes = ps.map(pieceAabb);
  const group = ps.find((p) => p.group)?.group;
  const bear = ps.map((p, i) => bearingOf(p, boxes[i]));
  const bi = bear.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  const rect = cluster(bi.map((i) => boxes[i]));
  const out: PieceSpec[] = raise(ps, DPC);
  const tag = (q: PieceSpec) => { if (group) q.group = group; return q; };
  const fnd: PieceSpec[] = [];
  let stairRect: { x: Range; z: Range } | undefined;

  if (o.basement) {
    stairRect = basement(ps, boxes, rect, o.basement, plan, fnd, !!o.piles);
    if (stairRect) for (let i = out.length - 1; i >= 0; i--) {
      if (!floorSlab(ps[i], boxes[i])) continue;
      const q = pieceAabb(out[i]), y: Range = [q.min[1], q.max[1]];
      const parts = cut({ x: [q.min[0], q.max[0]], z: [q.min[2], q.max[2]] }, stairRect);
      if (parts.length === 1 && parts[0].x[0] === q.min[0] && parts[0].x[1] === q.max[0] && parts[0].z[0] === q.min[2] && parts[0].z[1] === q.max[2]) continue;
      const { detail: _d, ...base } = out[i];
      out.splice(i, 1, ...parts.map((r) => ({ ...base, size: [r.x[1] - r.x[0], y[1] - y[0], r.z[1] - r.z[0]] as [number, number, number], pos: [(r.x[0] + r.x[1]) / 2, (y[0] + y[1]) / 2, (r.z[0] + r.z[1]) / 2] as [number, number, number] })));
    }
  } else {
    plan.pad(rect.x, rect.z, DPC);
    if (o.type === 'raft') raft(rect, o, fnd);
    else footings(ps, boxes, bi, o, fnd, out);
  }
  // what stood on the ground and has no footing of its own is fixed to the slab it stands on
  const footed = new Set<number>();
  if (!o.basement && o.type !== 'raft') for (const i of bi) if (onFooting(boxes[i], fnd)) footed.add(i);
  for (const i of bi) if (!o.basement && o.type !== 'raft' && !footed.has(i)) out[i] = { ...out[i], anchored: true };
  return { pieces: [...out, ...fnd.map(tag)], rect, stair: stairRect };
}

/** A building that brings its own below-grade group (a landmark's footings, crypt, raft): both are lifted a damp
    course and stood on the site's slab over their footprint; what stood on the ground clear of the group is fixed to
    the slab. */
export function onFoundation(ps: PieceSpec[], below: PieceSpec[], plan: TerrainPlan): PieceSpec[] {
  const boxes = ps.map(pieceAabb), bi = ps.map((p, i) => (bearingOf(p, boxes[i]) ? i : -1)).filter((i) => i >= 0);
  const rect = cluster(bi.map((i) => boxes[i]));
  plan.pad(rect.x, rect.z, DPC);
  const fnd = raise(below, DPC), out = raise(ps, DPC);
  for (const i of bi) if (!onFooting(boxes[i], fnd)) out[i] = { ...out[i], anchored: true };
  const group = ps.find((p) => p.group)?.group;
  return [...out, ...fnd.map((q) => ({ ...q, ...(group ? { group } : {}) }))];
}

/* ---------------- footprint ---------------- */

function cluster(bs: Aabb[]): { x: Range; z: Range } {
  if (!bs.length) return { x: [0, 0], z: [0, 0] };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.min[0]); x1 = Math.max(x1, b.max[0]); z0 = Math.min(z0, b.min[2]); z1 = Math.max(z1, b.max[2]); }
  const s = (v: number) => Math.round(v * 1e4) / 1e4;
  return { x: [s(x0 - 0.05), s(x1 + 0.05)], z: [s(z0 - 0.05), s(z1 + 0.05)] };
}

function onFooting(b: Aabb, fnd: PieceSpec[]): boolean {
  return fnd.some((f) => {
    const q = pieceAabb(f);
    return Math.abs(q.max[1] - DPC) < 1e-3 && q.min[0] < b.max[0] - 0.02 && q.max[0] > b.min[0] + 0.02 && q.min[2] < b.max[2] - 0.02 && q.max[2] > b.min[2] + 0.02;
  });
}

/* ---------------- strip and pad footings ---------------- */

function footings(ps: PieceSpec[], boxes: Aabb[], bi: number[], o: FoundOpts, fnd: PieceSpec[], out: PieceSpec[]): void {
  const mat = o.mat ?? 'concrete';
  const strips: Strip[] = [];
  const cols: Aabb[] = [];
  for (const i of bi) {
    const b = boxes[i], sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    const t = Math.min(sx, sz), L = Math.max(sx, sz), p = ps[i];
    if (h >= 1 && t <= 0.7 && L >= 2.5 * t && !p.util && !p.fixture && MASONRY.has(p.mat)) {
      const axis: 'x' | 'z' = sx >= sz ? 'x' : 'z';
      strips.push({ axis, c: axis === 'x' ? (b.min[2] + b.max[2]) / 2 : (b.min[0] + b.max[0]) / 2, t, a: axis === 'x' ? b.min[0] : b.min[2], b: axis === 'x' ? b.max[0] : b.max[2], h: b.max[1] });
    } else if (h >= 1.2 && sx <= 0.9 && sz <= 0.9 && t >= 0.15 && !p.util && !p.fixture && COLUMN.has(p.mat)) cols.push(b);
  }
  // one footing line per wall line: runs on the same line merge across door openings
  const lines = new Map<string, Strip[]>();
  for (const s of strips) {
    const k = `${s.axis}:${Math.round(s.c / 0.05)}:${Math.round(s.t / 0.05)}`;
    (lines.get(k) ?? lines.set(k, []).get(k)!).push(s);
  }
  const runs: Strip[] = [];
  for (const l of lines.values()) {
    l.sort((p, q) => p.a - q.a);
    let cur = { ...l[0] };
    for (const s of l.slice(1)) {
      if (s.a - cur.b <= 1.6) { cur.b = Math.max(cur.b, s.b); cur.h = Math.max(cur.h, s.h); } else { runs.push(cur); cur = { ...s }; }
    }
    runs.push(cur);
  }
  const tall = (y: number) => o.depth ?? (y > 7 ? 1.0 : 0.75);
  const rects: { x: Range; z: Range; d: number }[] = [];
  const xs = runs.filter((r) => r.axis === 'x'), zs = runs.filter((r) => r.axis === 'z');
  const w = (r: Strip) => Math.max(0.45, r.t + 0.3) / 2;
  for (const r of xs) rects.push({ x: [r.a - 0.15, r.b + 0.15], z: [r.c - w(r), r.c + w(r)], d: tall(r.h) });
  // cross walls stop at the footings they meet
  for (const r of zs) {
    const xr: Range = [r.c - w(r), r.c + w(r)];
    let segs: Range[] = [[r.a - 0.15, r.b + 0.15]];
    for (const q of rects) {
      if (q.x[0] >= xr[1] || q.x[1] <= xr[0]) continue;
      segs = segs.flatMap(([a, b]) => (q.z[1] <= a || q.z[0] >= b ? [[a, b]] : [[a, q.z[0]], [q.z[1], b]]).filter(([u, v]) => v - u > 0.3) as Range[]);
    }
    for (const z of segs) rects.push({ x: xr, z, d: tall(r.h) });
  }
  // parallel lines closer than their footings are cast as one wider footing
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < rects.length && !merged; i++) for (let j = i + 1; j < rects.length && !merged; j++) {
      const a = rects[i], b = rects[j];
      if (a.x[0] < b.x[1] - 1e-4 && b.x[0] < a.x[1] - 1e-4 && a.z[0] < b.z[1] - 1e-4 && b.z[0] < a.z[1] - 1e-4) {
        rects[i] = { x: [Math.min(a.x[0], b.x[0]), Math.max(a.x[1], b.x[1])], z: [Math.min(a.z[0], b.z[0]), Math.max(a.z[1], b.z[1])], d: Math.max(a.d, b.d) };
        rects.splice(j, 1);
        merged = true;
      }
    }
  }
  for (const q of rects) {
    const d = q.d;
    const long: 'x' | 'z' = q.x[1] - q.x[0] >= q.z[1] - q.z[0] ? 'x' : 'z';
    for (const u of splitRange(long === 'x' ? q.x[0] : q.z[0], long === 'x' ? q.x[1] : q.z[1], 16)) {
      fnd.push(block(mat, long === 'x' ? u : q.x, [-d, DPC], long === 'x' ? q.z : u, MASS));
    }
  }
  // columns: a mass pad at depth and a pier up to the damp course, where no wall footing already carries them
  const taken = fnd.map(pieceAabb);
  for (const c of cols) {
    const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2, hw = Math.max(c.max[0] - c.min[0], c.max[2] - c.min[2]) / 2;
    const pier: Aabb = { min: [c.min[0] - 0.05, -0.5, c.min[2] - 0.05], max: [c.max[0] + 0.05, DPC, c.max[2] + 0.05] };
    if (taken.some((t) => overlaps(t, pier))) continue;
    const bw = Math.max(0.4, 2 * hw);
    const base: Aabb = { min: [cx - bw, -1.0, cz - bw], max: [cx + bw, -0.5, cz + bw] };
    const piece = (b: Aabb, m: MaterialId) => block(m, [b.min[0], b.max[0]], [b.min[1], b.max[1]], [b.min[2], b.max[2]], m === 'rconcrete' ? RC : MASS);
    fnd.push(piece(pier, 'rconcrete'));
    if (!taken.some((t) => overlaps(t, base))) { fnd.push(piece(base, 'concrete')); taken.push(base); }
    taken.push(pier);
  }
  void out;
}

function overlaps(a: Aabb, b: Aabb): boolean {
  return a.min[0] < b.max[0] - 1e-4 && b.min[0] < a.max[0] - 1e-4 && a.min[1] < b.max[1] - 1e-4 && b.min[1] < a.max[1] - 1e-4 && a.min[2] < b.max[2] - 1e-4 && b.min[2] < a.max[2] - 1e-4;
}

/* ---------------- raft and piles ---------------- */

function raft(rect: { x: Range; z: Range }, o: FoundOpts, fnd: PieceSpec[]): void {
  const t = 1.2;
  for (const x of splitRange(rect.x[0], rect.x[1], 8)) for (const z of splitRange(rect.z[0], rect.z[1], 8)) fnd.push(block('rconcrete', x, [-t, DPC], z, RC));
  if (!o.piles) return;
  // a pile group: 900 mm bored piles on a ~8 m grid, 12 m long under the raft
  const W = rect.x[1] - rect.x[0], D = rect.z[1] - rect.z[0];
  const nx = Math.max(2, Math.round(W / 8)), nz = Math.max(2, Math.round(D / 8));
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
    const x = rect.x[0] + 1.5 + ((W - 3) * a) / (nx - 1), z = rect.z[0] + 1.5 + ((D - 3) * b) / (nz - 1);
    fnd.push(cyl('rconcrete', 0.9, [-t - 12, -t], x, z, RC));
  }
}

/* ---------------- basement ---------------- */

function basement(ps: PieceSpec[], boxes: Aabb[], rect: { x: Range; z: Range }, b: NonNullable<FoundOpts['basement']>, plan: TerrainPlan, fnd: PieceSpec[], piles = false): { x: Range; z: Range } | undefined {
  const D = b.depth ?? 3.0, T = 0.3, slab: Range = [-0.25, DPC];
  const { x, z } = rect;
  /* The excavation: box3d heightfield holes are unusable (a hole sample spoils the tile's height quantisation and
     stretches its bounds to the sky, so every body over it pairs with it), so the ground is dug a cell wider than
     the basement, a paved apron at ground level covers the dug edge round it, and a static floor lies under it. */
  const m = CELL + 0.01;
  plan.pit([x[0] - m, x[1] + m], [z[0] - m, z[1] + m], -D - 1.0, 0, 'soil');
  plan.block([x[0] - 2 * CELL, x[1] + 2 * CELL], [z[0] - 2 * CELL, z[0]], -D - 1.0, 0, 'concrete');
  plan.block([x[0] - 2 * CELL, x[1] + 2 * CELL], [z[1], z[1] + 2 * CELL], -D - 1.0, 0, 'concrete');
  plan.block([x[0] - 2 * CELL, x[0]], [z[0], z[1]], -D - 1.0, 0, 'concrete');
  plan.block([x[1], x[1] + 2 * CELL], [z[0], z[1]], -D - 1.0, 0, 'concrete');
  plan.block(x, z, -D - 1.0, -D - 0.3, 'concrete');
  // base slab (on a pile group under a tower), retaining walls
  for (const xr of splitRange(x[0], x[1], 9)) for (const zr of splitRange(z[0], z[1], 9)) fnd.push(block('rconcrete', xr, [-D - 0.3, -D], zr, RC));
  if (piles) {
    const W = x[1] - x[0], L = z[1] - z[0], nx = Math.max(2, Math.round(W / 9)), nz = Math.max(2, Math.round(L / 9));
    for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) fnd.push(cyl('rconcrete', 0.9, [-D - 0.3 - 12, -D - 0.3], x[0] + 1.5 + ((W - 3) * a) / (nx - 1), z[0] + 1.5 + ((L - 3) * c) / (nz - 1), RC));
    // the excavation's floor stops above the piles
  }
  const wy: Range = [-D, slab[0]];
  for (const zr of [[z[0], z[0] + T], [z[1] - T, z[1]]] as Range[]) for (const xr of splitRange(x[0], x[1], 12)) fnd.push(block('rconcrete', xr, wy, zr, RC));
  for (const xr of [[x[0], x[0] + T], [x[1] - T, x[1]]] as Range[]) for (const zr of splitRange(z[0] + T, z[1] - T, 12)) fnd.push(block('rconcrete', xr, wy, zr, RC));
  // the stair: a clear strip inside a wall on the ground floor, the flight down along it
  const rise = D + DPC, n = Math.ceil(rise / 0.3), run = 0.3, L = n * run, sw = 1.1;
  const clear = (q: { x: Range; z: Range }) => ps.every((p, i) => {
    const bb = boxes[i];
    return floorSlab(p, bb) || bb.min[1] >= 2.2 || bb.max[0] <= q.x[0] || bb.min[0] >= q.x[1] || bb.max[2] <= q.z[0] || bb.min[2] >= q.z[1];
  });
  let stair: { x: Range; z: Range; axis: 'x' | 'z'; dir: 1 | -1 } | undefined;
  if (b.stair !== false) {
    const tries: { x: Range; z: Range; axis: 'x' | 'z'; dir: 1 | -1 }[] = [];
    const ix: Range = [x[0] + T + 0.35, x[1] - T - 0.35], iz: Range = [z[0] + T + 0.35, z[1] - T - 0.35];
    for (let u = ix[0]; u + L + 1 <= ix[1]; u += 0.5) for (const zz of [[iz[0], iz[0] + sw], [iz[1] - sw, iz[1]]] as Range[]) tries.push({ x: [u, u + L], z: zz, axis: 'x', dir: 1 });
    for (let u = iz[0]; u + L + 1 <= iz[1]; u += 0.5) for (const xx of [[ix[0], ix[0] + sw], [ix[1] - sw, ix[1]]] as Range[]) tries.push({ x: xx, z: [u, u + L], axis: 'z', dir: 1 });
    // failing a wall, anywhere on the floor clear of what stands on it
    for (let a = ix[0]; a + sw <= ix[1]; a += 1) for (let u = iz[0]; u + L + 1 <= iz[1]; u += 1) tries.push({ x: [a, a + sw], z: [u, u + L], axis: 'z', dir: 1 });
    for (let a = iz[0]; a + sw <= iz[1]; a += 1) for (let u = ix[0]; u + L + 1 <= ix[1]; u += 1) tries.push({ x: [u, u + L], z: [a, a + sw], axis: 'x', dir: 1 });
    // the flight's head needs a landing clear beyond it on the ground floor
    stair = tries.find((q) => clear(q.axis === 'x' ? { x: [q.x[0] - 0.8, q.x[1] + 1.0], z: q.z } : { x: q.x, z: [q.z[0] - 0.8, q.z[1] + 1.0] }));
  }
  // suspended ground floor, round the stair opening
  const hole = stair ? { x: stair.x, z: stair.z } : null;
  for (const xr of splitRange(x[0], x[1], 8)) for (const zr of splitRange(z[0], z[1], 8)) {
    for (const q of cut({ x: xr, z: zr }, hole)) fnd.push(block('rconcrete', q.x, slab, q.z, { tint: 0xb9b6ae }));
  }
  if (stair) {
    const parts: PieceSpec[] = [];
    for (let i = 0; i < n; i++) {
      const u0 = (stair.axis === 'x' ? stair.x[0] : stair.z[0]) + i * run;
      const y1 = -D + ((i + 1) * rise) / n;
      parts.push(stair.axis === 'x' ? block('concrete', [u0, u0 + run], [-D, y1], stair.z) : block('concrete', stair.x, [-D, y1], [u0, u0 + run]));
    }
    // a flight rising from the basement floor to the ground floor, its top tread flush with it
    fnd.push(weldParts(parts, { tint: 0xa9a59b }));
  }
  // basement columns under long spans (clear of the stair), and the plant room at the far end
  const span = (r: Range, k: number) => Array.from({ length: k - 1 }, (_, i) => r[0] + ((r[1] - r[0]) * (i + 1)) / k);
  const cx = span(x, Math.max(1, Math.ceil((x[1] - x[0]) / 6.5))), cz = span(z, Math.max(1, Math.ceil((z[1] - z[0]) / 6.5)));
  const avoid = (px: number, pz: number) => stair && px > stair.x[0] - 0.8 && px < stair.x[1] + 0.8 && pz > stair.z[0] - 0.8 && pz < stair.z[1] + 0.8;
  const plantX = b.plant !== false && x[1] - x[0] > 8 ? (stair && stair.x[0] < (x[0] + x[1]) / 2 ? x[1] - 3.3 : x[0] + 3.3) : null;
  for (const px of cx) for (const pz of cz) {
    if (avoid(px, pz) || (plantX !== null && Math.abs(px - plantX) < 0.6)) continue;
    fnd.push(block('rconcrete', [px - 0.2, px + 0.2], wy, [pz - 0.2, pz + 0.2], RC));
  }
  if (plantX !== null) {
    const zi: Range = [z[0] + T, z[1] - T], door = (zi[0] + zi[1]) / 2;
    for (const zr of [[zi[0], door - 0.5], [door + 0.5, zi[1]]] as Range[]) for (const u of splitRange(zr[0], zr[1], 6)) fnd.push(block('cinderblock', [plantX - 0.1, plantX + 0.1], wy, u, { tint: 0xb8b5ac }));
    const east = plantX > (x[0] + x[1]) / 2, px: Range = east ? [plantX + 0.6, plantX + 1.6] : [plantX - 1.6, plantX - 0.6];
    const boiler = block('machine', px, [-D, -D + 1.7], [zi[0] + 0.4, zi[0] + 1.2], { tint: 0xd8d4c8 });
    const tank = cyl('steel', 1.1, [-D, -D + 1.6], (px[0] + px[1]) / 2, zi[1] - 1.0, { tint: 0x7d8a8f });
    fnd.push(boiler, tank);
  }
  return hole ?? undefined;
}

/** the builder's own slab on the ground: the stair opening is cut through it */
function floorSlab(p: PieceSpec, b: Aabb): boolean {
  return (p.shape ?? 'box') === 'box' && !p.rotY && !p.parts && b.min[1] <= GROUND_TOL && b.max[1] <= 0.35 && (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) >= 2;
}

function cut(r: { x: Range; z: Range }, h: { x: Range; z: Range } | null): { x: Range; z: Range }[] {
  if (!h || h.x[0] >= r.x[1] || h.x[1] <= r.x[0] || h.z[0] >= r.z[1] || h.z[1] <= r.z[0]) return [r];
  const out: { x: Range; z: Range }[] = [];
  const hx: Range = [Math.max(r.x[0], h.x[0]), Math.min(r.x[1], h.x[1])];
  if (hx[0] - r.x[0] > 0.05) out.push({ x: [r.x[0], hx[0]], z: r.z });
  if (r.x[1] - hx[1] > 0.05) out.push({ x: [hx[1], r.x[1]], z: r.z });
  if (h.z[0] - r.z[0] > 0.05) out.push({ x: hx, z: [r.z[0], h.z[0]] });
  if (r.z[1] - h.z[1] > 0.05) out.push({ x: hx, z: [h.z[1], r.z[1]] });
  return out;
}
