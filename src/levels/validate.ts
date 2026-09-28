import type { Blueprint, FixtureKind, MaterialId, PieceSpec, UtilityKind, Vec3 } from '../types.ts';
import { specParts } from '../destruction/compound.ts';
import { dataOf, groundHeight, surfaceIdAt, type TerrainData } from '../terrain/raster.ts';
import { SURFACES } from '../terrain/spec.ts';

/* Mirrors the core's auto-weld rule (world AABBs of the real physics shapes) so levels can be checked
   without running physics. */
export const TOUCH_GAP = 0.025;
export const TOUCH_OVERLAP = 0.05;
export const OVERLAP_TOL = 0.01;
export const GROUND_TOL = 0.03;
export const BOUNDS = 40;
export const MAX_PIECES = 900;
/* studs, linings and battens are 0.05 m; anything thinner (bar glass) is suspect */
export const MIN_DIM = 0.05;
export const MIN_DIM_GLASS = 0.04;
/** the core refuses to build a hull thinner than this */
export const MIN_HULL_WIDTH = 0.035;
/* Long single members are allowed: a crane mast or jib must be one piece, because a welded chain of lengths
   sags and yields under its own weight in the soft solver. */
export const MAX_DIM = 32;
/** the core links at most this many ropes per world */
export const MAX_ROPES = 128;
/** the core joins a rope to the member whose centre lies within this of `ropeTo.end`, and skips shorter ropes */
export const ROPE_REACH = 0.45;
export const ROPE_MIN = 0.35;

export const FIXTURE_UTIL: Record<FixtureKind, UtilityKind> = {
  transformer: 'power', generator: 'power', gasmain: 'gas', watermain: 'water', boiler: 'steam', lamp: 'power', radiator: 'steam', motor: 'power',
};
export const SOURCES: ReadonlySet<FixtureKind> = new Set(['transformer', 'generator', 'gasmain', 'watermain', 'boiler']);

export function serviceKind(p: PieceSpec): UtilityKind | undefined {
  return p.util ?? (p.fixture ? FIXTURE_UTIL[p.fixture] : undefined);
}
/** the core tessellates 'cylinder' as a 16-gon */
const CYL_SIDES = 16;

export interface Aabb { min: Vec3; max: Vec3 }

export interface LevelStats {
  pieces: number;
  byMaterial: Partial<Record<MaterialId, number>>;
  byGroup: Record<string, number>;
  volume: number;
  welds: number;
  groundWelds: number;
  protectedPieces: number;
  props: number;
  maxHeight: number;
  /** building services: source fixtures, consumer fixtures (lamps included), lamps, machinery joints, ropes */
  sources: number;
  consumers: number;
  lamps: number;
  mechs: number;
  ropes: number;
}

export interface ValidationResult { errors: string[]; warnings: string[]; stats: LevelStats }

/* ---------------- convex geometry ---------------- */

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 | null => { const l = len(a); return l < 1e-9 ? null : [a[0] / l, a[1] / l, a[2] / l]; };

/** Adds a direction unless it is parallel (either sign) to one already present. */
function addDir(list: Vec3[], d: Vec3 | null): void {
  if (!d) return;
  for (const e of list) if (Math.abs(dot(e, d)) > 1 - 1e-7) return;
  list.push(d);
}

interface Face { n: Vec3; d: number; pts: Vec3[] }

/** Supporting planes of a point cloud (brute force: hull pieces have a handful of points). */
function hullFaces(pts: Vec3[]): Face[] {
  const faces: Face[] = [];
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      for (let k = j + 1; k < m; k++) {
        const n0 = unit(cross(sub(pts[j], pts[i]), sub(pts[k], pts[i])));
        if (!n0) continue;
        const d0 = dot(n0, pts[i]);
        let pos = false, neg = false;
        for (const q of pts) {
          const s = dot(n0, q) - d0;
          if (s > 1e-6) pos = true; else if (s < -1e-6) neg = true;
          if (pos && neg) break;
        }
        if (pos && neg) continue;
        const n: Vec3 = pos ? [-n0[0], -n0[1], -n0[2]] : n0;
        const d = pos ? -d0 : d0;
        if (faces.some((f) => dot(f.n, n) > 1 - 1e-7 && Math.abs(f.d - d) < 1e-6)) continue;
        faces.push({ n, d, pts: pts.filter((q) => Math.abs(dot(n, q) - d) < 1e-6) });
      }
    }
  }
  return faces;
}

function polygonArea(face: Face): number {
  const c = face.pts.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / face.pts.length) as Vec3;
  const u = unit(sub(face.pts[0], c)) ?? [1, 0, 0];
  const w = cross(face.n, u);
  const ring = [...face.pts].sort((a, b) => Math.atan2(dot(sub(a, c), w), dot(sub(a, c), u)) - Math.atan2(dot(sub(b, c), w), dot(sub(b, c), u)));
  let area = 0;
  for (let i = 0; i < ring.length; i++) area += dot(cross(sub(ring[i], c), sub(ring[(i + 1) % ring.length], c)), face.n) / 2;
  return Math.abs(area);
}

export interface Solid {
  verts: Vec3[];
  /** face normals and edge directions, deduplicated up to sign: the SAT candidate axes */
  normals: Vec3[];
  edges: Vec3[];
  box: Aabb;
  /** axis-aligned box: SAT reduces to the AABB test */
  aligned: boolean;
  volume: number;
  /** smallest caliper width across the face normals */
  width: number;
  /** compound piece: one solid per convex part (box, volume and width then cover all of them) */
  parts?: Solid[];
}

function ngon(n: number, r: number, hy: number): { verts: Vec3[]; normals: Vec3[]; edges: Vec3[] } {
  const rc = r / Math.cos(Math.PI / n);
  const verts: Vec3[] = [], normals: Vec3[] = [[0, 1, 0]], edges: Vec3[] = [[0, 1, 0]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, am = ((i + 0.5) / n) * Math.PI * 2;
    verts.push([Math.cos(a) * rc, -hy, Math.sin(a) * rc], [Math.cos(a) * rc, hy, Math.sin(a) * rc]);
    addDir(normals, [Math.cos(am), 0, Math.sin(am)]);
    addDir(edges, [-Math.sin(am), 0, Math.cos(am)]);
  }
  return { verts, normals, edges };
}

/** World-space solid exactly as the core builds it: convex (cylinders as 16-gons, prisms as n-gons), or a compound of parts. */
export function pieceSolid(p: PieceSpec): Solid {
  const parts = specParts(p);
  if (parts) {
    const r = p.rotY ?? 0, c = Math.cos(r), s = Math.sin(r);
    const subs = parts.map((q) => convexSolid({
      mat: p.mat, shape: q.shape, size: q.size, sides: q.sides, verts: q.verts, rotY: r + (q.rotY ?? 0),
      pos: [p.pos[0] + q.pos[0] * c + q.pos[2] * s, p.pos[1] + q.pos[1], p.pos[2] - q.pos[0] * s + q.pos[2] * c],
    }));
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const q of subs) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q.box.min[k]); max[k] = Math.max(max[k], q.box.max[k]); }
    return {
      verts: subs.flatMap((q) => q.verts), normals: [], edges: [], box: { min, max }, aligned: false,
      volume: subs.reduce((v, q) => v + q.volume, 0), width: Math.min(...subs.map((q) => q.width)), parts: subs,
    };
  }
  return convexSolid(p);
}

function convexSolid(p: PieceSpec): Solid {
  const [sx, sy, sz] = p.size;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const shape = p.shape ?? 'box';
  let verts: Vec3[], normals: Vec3[], edges: Vec3[];
  let volume: number, width: number;
  if (shape === 'cylinder' || shape === 'prism') {
    const n = shape === 'cylinder' ? CYL_SIDES : Math.min(24, Math.max(3, Math.round(p.sides ?? 8)));
    ({ verts, normals, edges } = ngon(n, hx, hy));
    volume = n * hx * hx * Math.tan(Math.PI / n) * sy;
    width = Math.min(sx, sy);
  } else if (shape === 'wedge') {
    verts = [[-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz]];
    normals = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    addDir(normals, unit([hy, hx, 0]));
    edges = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    addDir(edges, unit([hx, -hy, 0]));
    volume = sx * sy * sz / 2;
    width = Math.min(sz, (sx * sy) / Math.hypot(sx, sy));
  } else if (shape === 'hull') {
    verts = (p.verts ?? []).map((v) => [...v] as Vec3);
    const faces = hullFaces(verts);
    normals = [];
    edges = [];
    for (const f of faces) addDir(normals, f.n);
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const shared = faces[i].pts.filter((q) => faces[j].pts.includes(q)).length;
        if (shared >= 2) addDir(edges, unit(cross(faces[i].n, faces[j].n)));
      }
    }
    const c = verts.reduce<Vec3>((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]).map((v) => v / Math.max(1, verts.length)) as Vec3;
    volume = faces.reduce((s, f) => s + (polygonArea(f) * (f.d - dot(f.n, c))) / 3, 0);
    width = Infinity;
    for (const n of normals) {
      const pr = verts.map((q) => dot(n, q));
      width = Math.min(width, Math.max(...pr) - Math.min(...pr));
    }
    if (!faces.length) width = 0;
  } else {
    verts = [];
    for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) verts.push([x, y, z]);
    normals = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    edges = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    volume = sx * sy * sz;
    width = Math.min(sx, sy, sz);
  }
  const r = p.rotY ?? 0;
  const c = Math.cos(r), s = Math.sin(r);
  // three.js yaw: local +X → (cos, -sin), local +Z → (sin, cos) in world (x, z)
  const rot = (v: Vec3): Vec3 => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const [px, py, pz] = p.pos;
  const world = verts.map((v) => { const w = rot(v); return [w[0] + px, w[1] + py, w[2] + pz] as Vec3; });
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of world) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  const q = r / (Math.PI / 2);
  const aligned = shape === 'box' && Math.abs(q - Math.round(q)) < 1e-6;
  return { verts: world, normals: normals.map(rot), edges: edges.map(rot), box: { min, max }, aligned, volume, width };
}

export function pieceAabb(p: PieceSpec): Aabb {
  return pieceSolid(p).box;
}

/** Penetration depth of two convex solids by SAT (face normals of both plus edge-edge cross products); <= 0 means apart. */
export function penetration(a: Solid, b: Solid): number {
  if (a.parts || b.parts) {
    let worst = -Infinity;
    for (const qa of a.parts ?? [a]) for (const qb of b.parts ?? [b]) worst = Math.max(worst, penetration(qa, qb));
    return worst;
  }
  let best = Infinity;
  const test = (axis: Vec3 | null) => {
    if (!axis) return;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of a.verts) { const d = dot(axis, v); if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const v of b.verts) { const d = dot(axis, v); if (d < b0) b0 = d; if (d > b1) b1 = d; }
    best = Math.min(best, Math.min(a1, b1) - Math.max(a0, b0));
  };
  for (let k = 0; k < 3; k++) best = Math.min(best, Math.min(a.box.max[k], b.box.max[k]) - Math.max(a.box.min[k], b.box.min[k]));
  if (best <= 0 || (a.aligned && b.aligned)) return best;
  for (const n of a.normals) { test(n); if (best <= 0) return best; }
  for (const n of b.normals) { test(n); if (best <= 0) return best; }
  for (const e of a.edges) for (const f of b.edges) { test(unit(cross(e, f))); if (best <= 0) return best; }
  return best;
}

/** Signed separation per axis: > 0 gap, < 0 overlap depth. */
function separation(a: Aabb, b: Aabb, i: number): number {
  return Math.max(b.min[i] - a.max[i], a.min[i] - b.max[i]);
}

/** The core's face-contact rule on world AABBs (overlapping boxes weld too). */
export function wouldWeld(a: Aabb, b: Aabb, gap = TOUCH_GAP, overlap = TOUCH_OVERLAP): boolean {
  const s = [separation(a, b, 0), separation(a, b, 1), separation(a, b, 2)];
  let axis = 0;
  for (let i = 0; i < 3; i++) {
    if (s[i] > gap) return false;
    if (Math.abs(s[i]) < Math.abs(s[axis])) axis = i;
  }
  return -s[(axis + 1) % 3] >= overlap && -s[(axis + 2) % 3] >= overlap;
}

/** wouldWeld run part against part: a compound welds wherever any of its parts meets the other piece */
export function solidsWeld(a: Solid, b: Solid, gap = TOUCH_GAP, overlap = TOUCH_OVERLAP): boolean {
  if (!a.parts && !b.parts) return wouldWeld(a.box, b.box, gap, overlap);
  for (const qa of a.parts ?? [a]) for (const qb of b.parts ?? [b]) if (wouldWeld(qa.box, qb.box, gap, overlap)) return true;
  return false;
}

const EDGE = 0.002;

export function groundWelded(p: PieceSpec, box: Aabb): boolean {
  if (p.noWeld) return false;
  return !!p.anchored || box.min[1] <= GROUND_TOL;
}

function describe(p: PieceSpec, i: number): string {
  const f = (v: number) => v.toFixed(2);
  const shape = p.shape && p.shape !== 'box' ? `/${p.shape}` : '';
  return `#${i} ${p.mat}${shape}${p.group ? `@${p.group}` : ''} [${p.pos.map(f).join(', ')}]`;
}

const CELL = 4;

/** Candidate pairs whose AABBs (expanded by TOUCH_GAP) share a grid cell, each pair visited once. */
function candidatePairs(boxes: Aabb[], visit: (i: number, j: number) => void): void {
  const grid = new Map<string, number[]>();
  const range = boxes.map((b) => [
    Math.floor((b.min[0] - TOUCH_GAP) / CELL), Math.floor((b.max[0] + TOUCH_GAP) / CELL),
    Math.floor((b.min[2] - TOUCH_GAP) / CELL), Math.floor((b.max[2] + TOUCH_GAP) / CELL),
  ]);
  range.forEach(([x0, x1, z0, z1], i) => {
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`;
        const cell = grid.get(key);
        if (cell) cell.push(i); else grid.set(key, [i]);
      }
    }
  });
  for (const [key, cell] of grid) {
    const [cx, cz] = key.split(',').map(Number);
    for (let a = 0; a < cell.length; a++) {
      for (let b = a + 1; b < cell.length; b++) {
        const i = cell[a], j = cell[b];
        const ri = range[i], rj = range[j];
        // report the pair only from the lowest cell both ranges share
        if (cx !== Math.max(ri[0], rj[0]) || cz !== Math.max(ri[2], rj[2])) continue;
        visit(i, j);
      }
    }
  }
}

/** Campaign defaults; free-play sites are allowed bigger sites and budgets. */
export interface Limits { bounds?: number; maxPieces?: number }

/* Dormant detail: every unit inside its member, no two units interpenetrating (they become bodies side by side). */
const DETAIL_TOL = 0.002;
function checkDetail(p: PieceSpec, s: Solid, where: string, errors: string[]): void {
  const kids = p.detail!;
  const faces = s.parts ? null : hullFaces(s.verts);
  const sol = kids.map((c) => pieceSolid(c));
  let outside = 0, overlaps = 0;
  const first: string[] = [];
  sol.forEach((c, i) => {
    if (!kids[i].size.every((v) => v > 0)) { errors.push(`${where}: detail ${i} has no size`); return; }
    const inside = faces
      ? c.verts.every((v) => faces.every((f) => dot(f.n, v) <= f.d + DETAIL_TOL))
      : (s.parts ?? []).some((q) => c.verts.every((v) => v.every((x, k) => x >= q.box.min[k] - DETAIL_TOL && x <= q.box.max[k] + DETAIL_TOL)));
    if (!inside && outside++ < 2) first.push(`${kids[i].mat} at ${kids[i].pos.map((x) => x.toFixed(2)).join(',')} pokes out`);
  });
  const C = 0.25, grid = new Map<string, number[]>();
  sol.forEach((c, i) => {
    for (let x = Math.floor(c.box.min[0] / C); x <= Math.floor(c.box.max[0] / C); x++)
      for (let y = Math.floor(c.box.min[1] / C); y <= Math.floor(c.box.max[1] / C); y++)
        for (let z = Math.floor(c.box.min[2] / C); z <= Math.floor(c.box.max[2] / C); z++) {
          const k = `${x},${y},${z}`, g = grid.get(k);
          if (g) g.push(i); else grid.set(k, [i]);
        }
  });
  const seen = new Set<number>();
  for (const g of grid.values()) for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) {
    const i = Math.min(g[a], g[b]), j = Math.max(g[a], g[b]), key = i * kids.length + j;
    if (seen.has(key)) continue;
    seen.add(key);
    const pen = penetration(sol[i], sol[j]);
    if (pen > DETAIL_TOL && overlaps++ < 2) first.push(`${kids[i].mat}#${i} overlaps ${kids[j].mat}#${j} by ${pen.toFixed(3)}`);
  }
  if (outside || overlaps) errors.push(`${where}: detail ${outside} units outside, ${overlaps} overlapping (${first.join('; ')})`);
}

function checkShape(p: PieceSpec, s: Solid, where: string, errors: string[], warnings: string[]): void {
  if (s.parts) { checkCompound(p, s, where, errors, warnings); return; }
  const shape = p.shape ?? 'box';
  const glass = p.mat === 'glass' || p.mat === 'tempered';
  if (shape === 'hull') {
    const v = p.verts ?? [];
    if (v.length < 4 || s.volume <= 1e-6) { errors.push(`${where}: hull needs 4+ non-coplanar verts`); return; }
    const ext = [0, 1, 2].map((k) => Math.max(...v.map((q) => q[k])) - Math.min(...v.map((q) => q[k])));
    const mid = [0, 1, 2].map((k) => (Math.max(...v.map((q) => q[k])) + Math.min(...v.map((q) => q[k]))) / 2);
    if (ext.some((e, k) => Math.abs(e - p.size[k]) > 0.02)) warnings.push(`${where}: size ${p.size.map((q) => q.toFixed(2))} is not the hull extents ${ext.map((q) => q.toFixed(2))}`);
    if (mid.some((m) => Math.abs(m) > 0.05)) warnings.push(`${where}: hull verts are not centred on pos`);
  }
  if (shape === 'prism' && (p.sides ?? 8) !== Math.min(24, Math.max(3, Math.round(p.sides ?? 8)))) warnings.push(`${where}: prism sides must be an integer 3..24`);
  if (shape === 'hull' || shape === 'wedge' || shape === 'prism') {
    if (s.width <= MIN_HULL_WIDTH) errors.push(`${where}: ${shape} only ${s.width.toFixed(3)} m thick; the core will not build it`);
  }
  const dims = shape === 'cylinder' || shape === 'prism' ? [p.size[0], p.size[1]] : shape === 'box' ? p.size : [s.width];
  const lo = glass ? MIN_DIM_GLASS : MIN_DIM;
  if (Math.min(...dims) < lo - 1e-9) warnings.push(`${where}: dimension ${Math.min(...dims).toFixed(3)} < ${lo}`);
  if (Math.max(...p.size) > MAX_DIM + 1e-9) warnings.push(`${where}: dimension ${Math.max(...p.size).toFixed(2)} > ${MAX_DIM}`);
}

/* A compound is one body: its parts must be buildable hulls that don't overlap, join into one connected piece
   (a part touching none of the others floats inside the body), and fill the size box the level declares. */
function checkCompound(p: PieceSpec, s: Solid, where: string, errors: string[], warnings: string[]): void {
  const qs = s.parts!;
  qs.forEach((q, i) => { if (q.width <= MIN_HULL_WIDTH) errors.push(`${where}: part ${i} only ${q.width.toFixed(3)} m thick; the core will not build it`); });
  const id = qs.map((_, i) => i);
  const find = (i: number): number => (id[i] === i ? i : (id[i] = find(id[i])));
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const pen = penetration(qs[i], qs[j]);
      if (pen > OVERLAP_TOL) errors.push(`${where}: parts ${i} and ${j} overlap ${pen.toFixed(3)} m`);
      if (pen > -0.01 && wouldWeld(qs[i].box, qs[j].box, 0.01, 0.01)) id[find(i)] = find(j);
    }
  }
  const groups = new Set(qs.map((_, i) => find(i))).size;
  if (groups > 1) errors.push(`${where}: compound parts form ${groups} separate groups (a part touching no other floats in the body)`);
  const r = p.rotY ?? 0, q = r / (Math.PI / 2);
  if (Math.abs(q - Math.round(q)) < 1e-6) {
    const ext = [0, 1, 2].map((k) => s.box.max[k] - s.box.min[k]);
    const want = Math.round(q) % 2 ? [p.size[2], p.size[1], p.size[0]] : p.size;
    if (ext.some((e, k) => Math.abs(e - want[k]) > 0.02)) warnings.push(`${where}: size ${p.size.map((v) => v.toFixed(2))} is not the parts' extents ${ext.map((v) => v.toFixed(2))}`);
  }
  if (Math.max(...p.size) > MAX_DIM + 1e-9) warnings.push(`${where}: dimension ${Math.max(...p.size).toFixed(2)} > ${MAX_DIM}`);
}

export function validateBlueprint(bp: Blueprint, limits: Limits = {}): ValidationResult {
  const bounds = limits.bounds ?? BOUNDS, maxPieces = limits.maxPieces ?? MAX_PIECES;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ps = bp.pieces;
  const stats: LevelStats = {
    pieces: ps.length, byMaterial: {}, byGroup: {}, volume: 0, welds: 0, groundWelds: 0,
    protectedPieces: 0, props: 0, maxHeight: 0, sources: 0, consumers: 0, lamps: 0, mechs: 0, ropes: 0,
  };
  if (ps.length > maxPieces) warnings.push(`${ps.length} pieces exceeds budget of ${maxPieces}`);

  const valid: boolean[] = [];
  const solids: Solid[] = ps.map((p, i) => {
    const nums = [...p.size, ...p.pos, p.rotY ?? 0, ...(p.verts ?? []).flat()];
    const ok = nums.every(Number.isFinite) && p.size.every((v) => v > 0);
    valid.push(ok);
    if (!ok) errors.push(`${describe(p, i)}: NaN or non-positive size`);
    return ok ? pieceSolid(p) : pieceSolid({ ...p, shape: 'box', size: [1, 1, 1], verts: undefined });
  });
  const boxes = solids.map((s) => s.box);

  ps.forEach((p, i) => {
    if (!valid[i]) return;
    const b = boxes[i];
    stats.byMaterial[p.mat] = (stats.byMaterial[p.mat] ?? 0) + 1;
    const g = p.group ?? '-';
    stats.byGroup[g] = (stats.byGroup[g] ?? 0) + 1;
    stats.volume += solids[i].volume;
    stats.maxHeight = Math.max(stats.maxHeight, b.max[1]);
    if (p.protected) stats.protectedPieces++;
    if (p.noWeld) stats.props++;
    // on a site with terrain, foundations, mains and basements go into the ground (down to pile toes)
    if (b.min[1] < (bp.terrain ? -16 : -OVERLAP_TOL)) errors.push(`${describe(p, i)}: below ground (min y ${b.min[1].toFixed(3)})`);
    if (Math.max(-b.min[0], b.max[0], -b.min[2], b.max[2]) > bounds) errors.push(`${describe(p, i)}: outside ±${bounds} m`);
    checkShape(p, solids[i], describe(p, i), errors, warnings);
    if (p.detail) checkDetail(p, solids[i], describe(p, i), errors);
    if (groundWelded(p, b)) stats.groundWelds++;
  });

  const parent = ps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const GROUND = ps.length;
  parent.push(GROUND);
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  // A hanging load is supported by a validated cable anchor, not by a ground
  // weld or a shelf. Keep it a loose body so the rope joint can swing it.
  const cableEnds = new Set(ps.filter(p => p.ropeTo).map(p => p.ropeTo!.end.map(v => v.toFixed(2)).join(',')));
  const supported = ps.map((p, i) => valid[i] && p.noWeld === true &&
    (boxes[i].min[1] <= GROUND_TOL || !!p.mech || cableEnds.has(p.pos.map(v => v.toFixed(2)).join(','))));
  const borderline: string[] = [];
  const weldPairs: [number, number][] = [];

  candidatePairs(boxes, (i, j) => {
    if (!valid[i] || !valid[j]) return;
    const a = ps[i], b = ps[j];
    const ya = boxes[i], yb = boxes[j];
    const pen = penetration(solids[i], solids[j]);
    if (pen > OVERLAP_TOL) errors.push(`overlap ${pen.toFixed(3)} m: ${describe(a, i)} ↔ ${describe(b, j)}`);
    if (a.noWeld || b.noWeld) {
      // a prop is supported when its underside rests on the other piece's top
      const rests = (p: number, q: number) => ps[p].noWeld && Math.abs(boxes[p].min[1] - boxes[q].max[1]) <= TOUCH_GAP
        && -separation(boxes[p], boxes[q], 0) >= TOUCH_OVERLAP && -separation(boxes[p], boxes[q], 2) >= TOUCH_OVERLAP;
      if (rests(i, j)) supported[i] = true;
      if (rests(j, i)) supported[j] = true;
      return;
    }
    const weld = solidsWeld(solids[i], solids[j]);
    if (weld) {
      stats.welds++;
      union(i, j);
      weldPairs.push([i, j]);
    }
    // a contact sitting on the weld thresholds flips with float noise or a translated placement
    if (weld !== solidsWeld(solids[i], solids[j], TOUCH_GAP + (weld ? -EDGE : EDGE), TOUCH_OVERLAP + (weld ? EDGE : -EDGE))) {
      borderline.push(`${describe(a, i)} ↔ ${describe(b, j)}`);
    }
  });
  if (borderline.length) warnings.push(`${borderline.length} borderline contact(s) at the weld threshold, e.g. ${borderline.slice(0, 2).join('; ')}`);

  ps.forEach((p, i) => { if (valid[i] && groundWelded(p, boxes[i])) union(i, GROUND); });
  // a vehicle body stands on its wheels: a jointed part on the ground, or resting on a welded surface (made
  // ground, a road), carries the member its joint is in
  ps.forEach((p, k) => {
    if (!valid[k] || !p.mech) return;
    const b = boxes[k];
    const bed = b.min[1] <= GROUND_TOL ? GROUND : ps.findIndex((q, jj) => jj !== k && valid[jj] && !q.noWeld && !q.mech && Math.abs(boxes[jj].max[1] - b.min[1]) <= TOUCH_GAP
      && boxes[jj].min[0] < b.max[0] && boxes[jj].max[0] > b.min[0] && boxes[jj].min[2] < b.max[2] && boxes[jj].max[2] > b.min[2]);
    if (bed < 0) return;
    const j = ps.findIndex((q, jj) => jj !== k && valid[jj] && !q.noWeld && inside(boxes[jj], p.mech!.at));
    if (j >= 0) union(j, bed);
  });

  const islands = new Map<number, number[]>();
  ps.forEach((p, i) => {
    if (!valid[i] || p.noWeld) return;
    const r = find(i);
    if (r === find(GROUND)) return;
    const list = islands.get(r);
    if (list) list.push(i); else islands.set(r, [i]);
  });
  for (const list of islands.values()) {
    const what = list.length === 1 ? 'floating piece' : `floating cluster of ${list.length}`;
    warnings.push(`${what} (no weld path to ground): ${list.slice(0, 3).map((i) => describe(ps[i], i)).join('; ')}`);
  }
  ps.forEach((p, i) => {
    if (valid[i] && p.noWeld && !supported[i]) warnings.push(`${describe(p, i)}: loose prop is not resting on anything`);
  });

  checkServices(ps, valid, boxes, weldPairs, stats, errors, warnings);

  if (bp.spawn) {
    const [x, y, z] = bp.spawn.pos;
    if (Math.abs(x) > bounds || Math.abs(z) > bounds) errors.push(`spawn outside ±${bounds} m`);
    // the player stands on whatever is under the spawn point (made ground), not in it
    const inside = boxes.findIndex((b) => x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && b.min[1] < y + 1.8 && b.max[1] > y + 0.05);
    if (inside >= 0) errors.push(`spawn inside ${describe(ps[inside], inside)}`);
  }
  return { errors, warnings, stats };
}

const inside = (b: Aabb, v: Vec3, tol = 1e-6) => [0, 1, 2].every((k) => v[k] > b.min[k] + tol && v[k] < b.max[k] - tol);

/* Services conduct across face contacts between members of the same kind (service links at runtime, the same
   contact test as welding) and power also along wire ropes, so each network is a connected component of same-kind
   members; it is live when it holds a source fixture. Machinery joints hang off the member containing `mech.at` —
   a fixed member, or a moving part listed earlier (arm on turret on base); a motor turns only when that host is
   (or touches) a live motor fixture. */
function checkServices(ps: PieceSpec[], valid: boolean[], boxes: Aabb[], weldPairs: [number, number][], stats: LevelStats,
  errors: string[], warnings: string[]): void {
  const kind = ps.map((p) => serviceKind(p));
  const parent = ps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const adj = new Map<number, number[]>();
  for (const [i, j] of weldPairs) {
    (adj.get(i) ?? adj.set(i, []).get(i)!).push(j);
    (adj.get(j) ?? adj.set(j, []).get(j)!).push(i);
    if (kind[i] && kind[i] === kind[j]) parent[find(i)] = find(j);
  }
  const ropeEnd = (i: number): number => {
    const e = ps[i].ropeTo!.end;
    let best = -1, d = ROPE_REACH;
    ps.forEach((q, j) => {
      if (j === i || !valid[j]) return;
      const dj = Math.hypot(q.pos[0] - e[0], q.pos[1] - e[1], q.pos[2] - e[2]);
      if (dj < d) { d = dj; best = j; }
    });
    return best;
  };
  ps.forEach((p, i) => {
    if (!valid[i] || p.ropeTo?.kind !== 'wire' || kind[i] !== 'power') return;
    const j = ropeEnd(i);
    if (j >= 0 && kind[j] === 'power') parent[find(i)] = find(j);
  });
  const live = new Set<number>();
  ps.forEach((p, i) => {
    if (!valid[i]) return;
    if (p.fixture && SOURCES.has(p.fixture)) { stats.sources++; live.add(find(i)); }
    else if (p.fixture) stats.consumers++;
    if (p.fixture === 'lamp') {
      stats.lamps++;
      if (!p.light) errors.push(`${describe(p, i)}: lamp has no light`);
    } else if (p.light) warnings.push(`${describe(p, i)}: light on a piece that is not a lamp fixture`);
    if (p.fixture && p.util && p.util !== FIXTURE_UTIL[p.fixture]) warnings.push(`${describe(p, i)}: ${p.fixture} carries ${p.util}`);
  });
  const dead = new Map<number, number[]>();
  ps.forEach((p, i) => {
    if (!valid[i] || !kind[i] || live.has(find(i))) return;
    const r = find(i);
    (dead.get(r) ?? dead.set(r, []).get(r)!).push(i);
  });
  for (const list of dead.values()) {
    const users = list.filter((i) => ps[i].fixture);
    const what = users.length ? `orphaned ${users.map((i) => ps[i].fixture).join('/')}` : `${kind[list[0]]} run of ${list.length}`;
    warnings.push(`${what} reaches no ${kind[list[0]]} source: ${(users.length ? users : list).slice(0, 2).map((i) => describe(ps[i], i)).join('; ')}`);
  }
  const liveMember = (i: number) => !!kind[i] && live.has(find(i));
  const liveMotor = (i: number) => ps[i].fixture === 'motor' && liveMember(i);

  ps.forEach((p, i) => {
    if (!valid[i] || !p.mech) return;
    stats.mechs++;
    const m = p.mech, where = describe(p, i);
    if (!p.noWeld) errors.push(`${where}: machinery joint on a welded piece (set noWeld)`);
    if (Math.hypot(...m.axis) < 1e-6) errors.push(`${where}: zero ${m.kind} axis`);
    if (m.lower !== undefined && m.upper !== undefined && m.lower > m.upper) errors.push(`${where}: ${m.kind} limits inverted`);
    if (!nearBox(boxes[i], m.at, 0.5)) warnings.push(`${where}: joint point is far from the piece`);
    const all = ps.map((_, j) => j).filter((j) => j !== i && valid[j] && (!ps[j].noWeld || !!ps[j].mech) && inside(boxes[j], m.at));
    const hosts = all.filter((j) => !ps[j].mech || j < i);
    if (!hosts.length) {
      if (all.length) warnings.push(`${where}: its host moving part is listed after it, so it is joined to the world instead`);
      else if (m.at[1] > GROUND_TOL) warnings.push(`${where}: no member contains mech.at; joined to the world in mid-air`);
      return;
    }
    const vol = (j: number) => ps[j].size[0] * ps[j].size[1] * ps[j].size[2];
    const host = hosts.reduce((a, b) => (vol(b) > vol(a) ? b : a));
    if (m.motor && !m.motor.always && !liveMember(host) && !(adj.get(host) ?? []).some(liveMotor)) {
      warnings.push(`${where}: motor host ${describe(ps[host], host)} is not live and has no live motor fixture`);
    }
  });

  ps.forEach((p, i) => {
    if (!valid[i] || !p.ropeTo) return;
    stats.ropes++;
    const best = ropeEnd(i);
    if (best < 0) warnings.push(`${describe(p, i)}: rope end ${p.ropeTo.end.map((v) => v.toFixed(2))} finds no member`);
    else if (Math.hypot(ps[best].pos[0] - p.pos[0], ps[best].pos[1] - p.pos[1], ps[best].pos[2] - p.pos[2]) < ROPE_MIN) warnings.push(`${describe(p, i)}: rope shorter than ${ROPE_MIN} m is skipped`);
  });
  if (stats.ropes > MAX_ROPES) warnings.push(`${stats.ropes} ropes: the core links only ${MAX_ROPES}`);
}

function nearBox(b: Aabb, v: Vec3, tol: number): boolean {
  return [0, 1, 2].every((k) => v[k] > b.min[k] - tol && v[k] < b.max[k] + tol);
}

/* ---------------- walkability (free-play sites on terrain) ---------------- */

export interface WalkOpts {
  /** building groups that must each have a doorway reachable on foot from the spawn */
  buildings?: string[];
}

/** the player steps up this much; anything lower on a street must be fixed down or a prop by design */
export const STEP = 0.35;
const HEADROOM = 1.8, CELL_W = 0.25, BODY_R = 0.2;
const DESIGNED_PROP = /^(props|caches|rubble|stock|site-gas|bins|crates|debris|dock)$/;
const PROP_MATS: ReadonlySet<MaterialId> = new Set(['crate', 'barrel', 'propane', 'tnt']);
/** a service member that may come up through the ground: a riser, column plinth, pole, box or hydrant barrel */
const SURFACING = (p: PieceSpec, b: Aabb) => !!p.svcPart || !!p.fixture || Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) <= 0.7;
const STREET = new Set(['asphalt', 'paving', 'setts'].map((s) => SURFACES.indexOf(s as typeof SURFACES[number])));

/** Walkability of a site on terrain (the blueprint's `terrain`; flat ground without one):
    - no loose piece shorter than a step lies on a street surface unless it is a prop by design, and no service
      member lies on one at all (it is buried or rises as a surfacing point);
    - services stay in the ground except where they come up through it as a riser, plinth, box or pole;
    - every listed building has a doorway the player can walk to from the spawn (a 2.5D flood fill over the
      site from the terrain surface up: a step of STEP up or down, HEADROOM clear above; kerbs, steps and slabs are
      ground; a hole is open down to whatever floor is built in it). */
export function checkWalkability(bp: Blueprint, o: WalkOpts = {}): { errors: string[]; warnings: string[]; reached: number } {
  const errors: string[] = [], warnings: string[] = [];
  const ps = bp.pieces;
  const td: TerrainData | null = bp.terrain ? dataOf(bp.terrain) : null;
  const ground = (x: number, z: number) => (td ? groundHeight(td, x, z) : 0);
  const street = (x: number, z: number) => !td || STREET.has(surfaceIdAt(td, x, z));
  const boxes = ps.map((p) => pieceSolid(p).box);
  const onStreet = (b: Aabb) => {
    const x = (b.min[0] + b.max[0]) / 2, z = (b.min[2] + b.max[2]) / 2, g = ground(x, z);
    return Math.abs(b.min[1] - g) <= 0.03 && street(x, z);
  };
  let loose = 0, exposed = 0;
  ps.forEach((p, i) => {
    if (p.soft) return;
    const b = boxes[i], h = b.max[1] - b.min[1];
    if (h >= STEP || !onStreet(b)) return;
    if (serviceKind(p)) { if (exposed++ < 5) errors.push(`${describe(p, i)}: service member lying on a street surface`); return; }
    if (p.noWeld && !p.mech && !PROP_MATS.has(p.mat) && !DESIGNED_PROP.test(p.group ?? '') && loose++ < 5) errors.push(`${describe(p, i)}: loose trip hazard (${h.toFixed(2)} m) on a street surface`);
  });
  ps.forEach((p, i) => {
    const b = boxes[i];
    if (!serviceKind(p) || SURFACING(p, b)) return;
    const g = ground((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2);
    if (!Number.isFinite(g) || b.min[1] > g - 0.05 || b.max[1] <= g + 0.02) return;
    if (exposed++ < 5) errors.push(`${describe(p, i)}: buried service run comes up through the ground`);
  });
  if (exposed > 5 || loose > 5) errors.push(`${Math.max(0, exposed - 5) + Math.max(0, loose - 5)} more walkability error(s)`);

  /* column heights: occupied intervals per cell, the floor is the top of the stack standing on the ground */
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.min[0]); x1 = Math.max(x1, b.max[0]); z0 = Math.min(z0, b.min[2]); z1 = Math.max(z1, b.max[2]); }
  if (td) { x0 = Math.min(x0, -td.half); x1 = Math.max(x1, td.half); z0 = Math.min(z0, -td.half); z1 = Math.max(z1, td.half); }
  const nx = Math.ceil((x1 - x0) / CELL_W) + 1, nz = Math.ceil((z1 - z0) / CELL_W) + 1;
  const col: number[][] = Array.from({ length: nx * nz }, () => []);
  const owner: number[][] = Array.from({ length: nx * nz }, () => []);
  ps.forEach((p, i) => {
    if (p.soft) return;
    const parts = pieceSolid(p).parts?.map((q) => q.box) ?? [boxes[i]];
    for (const b of parts) {
      const i0 = Math.max(0, Math.ceil((b.min[0] - BODY_R - x0) / CELL_W - 0.5)), i1 = Math.min(nx - 1, Math.floor((b.max[0] + BODY_R - x0) / CELL_W - 0.5));
      const j0 = Math.max(0, Math.ceil((b.min[2] - BODY_R - z0) / CELL_W - 0.5)), j1 = Math.min(nz - 1, Math.floor((b.max[2] + BODY_R - z0) / CELL_W - 0.5));
      for (let a = i0; a <= i1; a++) for (let c = j0; c <= j1; c++) { const k = a * nz + c; col[k].push(b.min[1], b.max[1]); owner[k].push(i); }
    }
  });
  const floor = new Float32Array(nx * nz), cover = new Int32Array(nx * nz).fill(-1), open = new Uint8Array(nx * nz);
  for (let k = 0; k < col.length; k++) {
    const cx = x0 + (Math.floor(k / nz) + 0.5) * CELL_W, cz = z0 + ((k % nz) + 0.5) * CELL_W;
    // the ground under the body: its highest point within the body's reach (a kerb, a step, a slab edge)
    let g0 = -Infinity;
    for (const [dx, dz] of [[0, 0], [BODY_R, 0], [-BODY_R, 0], [0, BODY_R], [0, -BODY_R]]) g0 = Math.max(g0, ground(cx + dx, cz + dz));
    const c = col[k], n = c.length / 2, ord = Array.from({ length: n }, (_, q) => q).sort((a, b) => c[2 * a] - c[2 * b]);
    /* the floor is the top of the lowest stack with headroom above it (the ground itself, or a slab over a void);
       a void thinner than a hand is part of the stack, not space; what lies wholly in the ground is not there */
    let f = Number.isFinite(g0) ? g0 : -100, q = 0;
    for (;;) {
      for (; q < n && c[2 * ord[q]] <= f + 0.12; q++) f = Math.max(f, c[2 * ord[q] + 1]);
      if (q >= n || c[2 * ord[q]] >= f + HEADROOM) break;
      f = c[2 * ord[q] + 1];
      q++;
    }
    floor[k] = f;
    open[k] = f > -99 ? 1 : 0;
    if (q < n) cover[k] = owner[k][ord[q]];
  }
  const cellOf = (x: number, z: number) => Math.round((x - x0) / CELL_W - 0.5) * nz + Math.round((z - z0) / CELL_W - 0.5);
  const seen = new Uint8Array(nx * nz);
  const start = bp.spawn ? cellOf(bp.spawn.pos[0], bp.spawn.pos[2]) : -1;
  let reached = 0;
  if (start >= 0 && start < open.length && open[start]) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      reached++;
      const a = Math.floor(k / nz), c = k % nz;
      for (const [da, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const na = a + da, nc = c + dc;
        if (na < 0 || nc < 0 || na >= nx || nc >= nz) continue;
        const m = na * nz + nc;
        if (seen[m] || !open[m] || Math.abs(floor[m] - floor[k]) > STEP) continue;
        seen[m] = 1;
        stack.push(m);
      }
    }
  } else if (bp.spawn) errors.push('spawn stands on no walkable cell');
  for (const g of o.buildings ?? []) {
    let inside = 0, got = 0;
    for (let k = 0; k < cover.length; k++) if (cover[k] >= 0 && ps[cover[k]].group === g) { inside++; if (seen[k]) got++; }
    if (inside < 16) warnings.push(`${g}: no covered floor found to check its doors`);
    else if (!got) errors.push(`${g}: no doorway reachable on foot from the spawn (${(inside * CELL_W * CELL_W).toFixed(0)} m² inside)`);
  }
  return { errors, warnings, reached };
}
