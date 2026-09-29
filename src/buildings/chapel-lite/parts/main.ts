import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, hull, pitchedRoof, swapXZ, weldParts, cyl, type Range } from '../../../levels/kit.ts';
import { layerize, withDetail } from '../../../levels/layers.ts';
import { conduit, lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import type { Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/clearance-helpers.ts';
import { archWall, gable, gableBlocks, rubble, COURSES, type Lancet } from '../lib.ts';

const STONE = 0x9a968e, DRESS = 0xe0dacb, SLATE = 0x3a4350, IRON = 0x2a2c2e;

/** Victorian nonconformist chapel, gable front (west door) toward -X: a single-cell nave, 13 × 7.2 m over 500 mm
    walls of squared rubble (dressed plinth, sill-level string course, quoins, dressed jambs, sills and arch stones;
    limewashed plaster inside), three lancets a side, two in the west front and a wide lancet in the east gable, a
    steep (43°) slate roof on four king-post trusses (tie beams across the nave on the wall heads), fascias with
    cast-iron gutters and downpipes, a coped west parapet gable carrying a bellcote with its bell, and a gabled stone
    porch over the pointed west door. Inside: pews on timber platforms either side of the aisle, the communion table
    before a raised pulpit on its dais, the consumer unit on the north wall (its supply sleeved through a dressed
    through-stone) and two nave lights off a cable along the north wall head. */
export function chapelLite(p: Placement): PieceSpec[] {
  const X = 6.5, Z = 3.6, t = 0.5, h = 5.0, rise = 3.3, thick = 0.4, seat = 0.2;
  const ps: PieceSpec[] = [];
  // every wall breaks at the sill string course (1.5 m): bays below, piers and heads above
  const wall = { tint: STONE, dress: DRESS, h, plaster: true, lift: 1.5 };
  const side: Lancet[] = [-3.4, 0, 3.4].map((c) => ({ c, w: 0.75, y0: 1.5, spring: 3.7 }));
  // south (+Z) and north walls run the full length; the gable walls stand between them
  const corners = { quoins: ['from', 'to'] as ('from' | 'to')[] }, returns = { returns: ['from', 'to'] as ('from' | 'to')[] };
  ps.push(...archWall({ ...wall, ...corners, from: -X, to: X, t: [Z - t, Z], out: 1, openings: side }));
  // the supply comes in at the west end of the north wall, through a plain dressed through-stone in the lower lift
  const entry: { u: Range; y: Range } = { u: [-5.75, -5.05], y: [0.85, 1.5] };
  ps.push(...archWall({ ...wall, ...corners, from: -X, to: X, t: [-Z, -Z + t], out: -1, openings: side, through: entry }));
  const west: Lancet[] = [{ c: 0, w: 1.2, y0: 0, spring: 2.1, r: 1.2, fill: 'door' }, { c: -2.2, w: 0.6, y0: 1.5, spring: 3.6 }, { c: 2.2, w: 0.6, y0: 1.5, spring: 3.6 }];
  ps.push(...swapXZ(archWall({ ...wall, ...returns, lift: undefined, from: -Z + t, to: Z - t, t: [-X, -X + t], out: -1, openings: west })));
  ps.push(...swapXZ(archWall({ ...wall, ...returns, from: -Z + t, to: Z - t, t: [X - t, X], out: 1, openings: [{ c: 0, w: 1.4, y0: 1.5, spring: 3.3, r: 1.2 }] })));

  // slate roof between the west parapet and the east gable, on the wall heads: two bays a slope, jointed over the
  // truss at x = -1.7, and clear of the parapet by 10 mm (the gable is not hung from the roof)
  for (const xr of [[-X + t + 0.01, -1.7], [-1.7, X]] as Range[]) {
    const roof = pitchedRoof({ mat: 'roof', x: xr, z: [-Z, Z], y: h, rise, thick, seat, tint: SLATE, maxW: 13, ridgeTint: 0x4a525c });
    ps.push(...slated(layerize(roof, { roofs: 'slate' })));
  }
  const k = rise / (Z - seat), under = (dz: number) => h + k * (Z - seat - dz);
  // king-post trusses: a tie beam across the nave on the wall heads, principals under the slopes, a king post
  for (const x of [-4.7, -1.7, 1.7, 4.7]) ps.push(truss(x, h, Z - seat, k));
  // fascia boards over the rafter feet with cast-iron gutters and a downpipe at each end
  for (const s of [1, -1] as const) ps.push(...eaves(s, X, Z, h, h + thick - k * seat));
  // gables in blocks: lifts on the course lines near 6.3 and 7.4 m; the west gable in three columns of blocks (open
  // joints between them), so the part over a blown doorway drops while the rest stands on its own piers
  const at = (y: number) => COURSES.reduce((b, c) => (Math.abs(c.y[0] - y) < Math.abs(b - y) ? c.y[0] : b), 0);
  const lifts = [at(6.3), at(7.45)];
  // east gable under the roof slopes
  ps.push(...gableBlocks([[-Z + seat, h], [Z - seat, h], [0, under(0)]], [X - t, X], STONE, { lifts, splits: [[-1.0, 1.0]], out: 1, plaster: true, dress: DRESS }));
  // west parapet gable: coped 150 mm above the slates at the eaves, rising to a flat top over the ridge for the bellcote
  const topZ = under(Z) + thick + 0.15, yA = under(0) + thick + 0.3;
  ps.push(...gableBlocks([[-Z, h], [Z, h], [Z, topZ], [0.55, yA], [-0.55, yA], [-Z, topZ]], [-X, -X + t], STONE, { lifts, splits: [[-1.2, 1.2], [-1.2, 1.2]], out: -1, plaster: true, dress: DRESS }));
  // bellcote: two piers and a gabled cap, the bell hung between them
  const bx: Range = [-X, -X + t], cap = yA + 0.95;
  const capHull = hull('stone', [bx[0] - 0.05, bx[1] + 0.05].flatMap((x) => [[x, cap, -0.62], [x, cap, 0.62], [x, cap + 0.1, -0.62], [x, cap + 0.1, 0.62], [x, cap + 0.5, 0]] as Vec3[]));
  const bell = weldParts([
    block('stone', bx, [yA, cap], [-0.5, -0.28]), block('stone', bx, [yA, cap], [0.28, 0.5]), capHull,
  ], { tint: DRESS });
  ps.push(bell, cyl('castiron', 0.36, [cap - 0.42, cap], -X + t / 2, 0, { tint: 0x7a6436 }));

  // porch: side walls, a pointed open archway, its own slate roof and coped gable
  const px: Range = [-X - 2.0, -X], hp = 2.6, pw = 0.3, pz = 1.35;
  for (const [zr, out] of [[[pz - pw, pz], 1], [[-pz, -pz + pw], -1]] as [Range, 1 | -1][]) {
    ps.push(withDetail(block('stone', px, [0, hp], zr, { tint: STONE }), rubble(px, [0, hp], zr, out, { tint: STONE, dress: DRESS, quoin: [px[0]], ret: [], jambs: [], twoFaced: true })));
  }
  ps.push(...swapXZ(archWall({ ...wall, ...returns, plaster: false, twoFaced: true, h: hp, from: -pz + pw, to: pz - pw, t: [px[0], px[0] + pw], out: -1, openings: [{ c: 0, w: 1.0, y0: 0, spring: 1.6, r: 1.0, fill: 'door' }] })));
  const pr = 1.1, pseat = 0.15, pk = pr / (pz - pseat);
  ps.push(...slated(layerize(pitchedRoof({ mat: 'roof', x: [px[0] - 0.1, px[1]], z: [-pz, pz], y: hp, rise: pr, thick: 0.25, seat: pseat, tint: SLATE, maxW: 3, ridgeTint: 0x4a525c }), { roofs: 'slate' })));
  ps.push(gable([[-pz + pseat, hp], [pz - pseat, hp], [0, hp + pk * (pz - pseat)]], [px[0], px[0] + pw], STONE, -1));

  // interior: pews on their platforms, the communion table, the pulpit on its dais
  ps.push(pewBlock([-4.6, 2.6], [[0.45, 2.95], [-2.95, -0.45]], 8));
  ps.push(block('stone', [4.2, X - t], [0, 0.2], [-Z + t, Z - t], { tint: 0xcfc6b2 }));
  ps.push(table([3.2, 3.9], [-0.9, 0.9], 0));
  ps.push(pulpit([5.0, 5.85], [-2.75, -1.9], 0.2));
  // consumer unit on the north wall over the through-stone; its lighting cable up the wall and along the wall head
  const zn = -Z + t;
  ps.push(supplyBox([-5.6, -5.2], [0.85, 1.3], [zn, zn + 0.12]));
  ps.push(...conduit([[-5.4, 1.3, zn + 0.04], [-5.4, h - 0.04, zn + 0.04], [5, h - 0.04, zn + 0.04]]));
  for (const x of [-2.5, 1.5]) ps.push(lamp([x - 0.25, x + 0.25], [h - 0.28, h - 0.08], [zn, zn + 0.4], LIGHT.warm));
  // built 1870s: a century and a half of weather has leached and frost-worked the lime out of the joints
  for (const q of ps) q.age ??= { years: 150, exposure: 'outdoor' };
  return put(ps, p, 'chapel');
}

/** The pews either side of the aisle on one timber platform, facing east (+x): one body. Each pew is its back (raked), a book
    ledge on the back for the pew behind, the seat on an apron rail, and two shaped bench ends rising to a rounded
    shoulder at the back. Varnished oak, not painted. */
function pewBlock(x: Range, sides: Range[], n: number): PieceSpec {
  // one boarded platform under both blocks and the aisle between
  const parts: PieceSpec[] = [block('oak', x, [0, 0.08], [Math.min(...sides.map((z) => z[0])), Math.max(...sides.map((z) => z[1]))])];
  for (const z of sides) pews(x, z, n, parts);
  return weldParts(parts, { tint: 0xd9bf9c });
}

function pews(x: Range, z: Range, n: number, parts: PieceSpec[]): void {
  const pitch = (x[1] - x[0] - 0.62) / (n - 1), zi: Range = [z[0] + 0.05, z[1] - 0.05];
  const prof = (q: [number, number][], zr: Range) => hull('oak', zr.flatMap((zz) => q.map(([xx, y]) => [xx, y, zz] as Vec3)));
  for (let i = 0; i < n; i++) {
    const x0 = x[0] + 0.14 + i * pitch;
    parts.push(prof([[x0, 0.46], [x0 + 0.045, 0.46], [x0 - 0.01, 0.92], [x0 - 0.055, 0.92]], zi));
    parts.push(block('oak', [x0 - 0.17, x0 - 0.052], [0.83, 0.87], zi));
    parts.push(block('oak', [x0 + 0.045, x0 + 0.46], [0.42, 0.46], zi));
    parts.push(block('oak', [x0 + 0.42, x0 + 0.46], [0.3, 0.42], zi));
    for (const e of [[z[0], z[0] + 0.05], [z[1] - 0.05, z[1]]] as Range[]) {
      parts.push(prof([[x0 - 0.08, 0.08], [x0 + 0.48, 0.08], [x0 + 0.48, 0.6], [x0 + 0.4, 0.66], [x0 + 0.02, 0.98], [x0 - 0.04, 1.0], [x0 - 0.08, 0.96]], e));
    }
  }
}

/** Communion table on the dais: top, frieze and four legs as one body. */
function table(x: Range, z: Range, y0: number): PieceSpec {
  const top = y0 + 0.9, l = 0.06;
  return weldParts([
    block('wood', [x[0] - 0.03, x[1] + 0.03], [top - 0.04, top], [z[0] - 0.03, z[1] + 0.03]),
    block('wood', x, [top - 0.16, top - 0.04], z),
    ...([[x[0], z[0]], [x[1] - l, z[0]], [x[0], z[1] - l], [x[1] - l, z[1] - l]] as [number, number][]).map(([a, b]) => block('wood', [a, a + l], [y0, top - 0.16], [b, b + l])),
  ], { tint: 0xc9a47c, mat: 'oak' });
}

/** King-post truss across the nave at x: a tie beam on the wall heads (its ends cut to the roof slope), two principal
    rafters under the slopes and the king post, one oak body bearing on both walls and carrying the roof. */
function truss(x: number, h: number, half: number, k: number): PieceSpec {
  const w: Range = [x - 0.1, x + 0.1], tb = 0.25, dp = 0.2 * Math.hypot(1, k);
  const U = (z: number) => h + k * (half - Math.abs(z)), L = (z: number) => U(z) - dp;
  const zU = half - tb / k, zL = half - (tb + dp) / k;
  const pts = (q: [number, number][]) => w.flatMap((xx) => q.map(([z, y]) => [xx, y, z] as Vec3));
  const tie = hull('wood', pts([[-half, h], [half, h], [zU, h + tb], [-zU, h + tb]]));
  const princ = (s: 1 | -1) => hull('wood', pts([[s * 0.1, U(0.1)], [s * 0.1, L(0.1)], [s * zL, h + tb], [s * zU, h + tb]]));
  const king = block('wood', w, [h + tb, U(0.1)], [-0.1, 0.1]);
  return weldParts([tie, princ(1), princ(-1), king], { tint: 0x8a6a4a, joint: { kind: 'bolt', n: 2, d: 0.02 } });
}

/** Fascia over the rafter feet, a cast-iron gutter on it and a downpipe at each end, one body along the eaves. */
function eaves(s: 1 | -1, X: number, Z: number, h: number, top: number): PieceSpec[] {
  const zr = (a: number, b: number): Range => [Math.min(s * a, s * b), Math.max(s * a, s * b)];
  const o = { tint: IRON, finish: 'paint' as const };
  const p = weldParts([
    // the fascia stands 100 mm above the rafter feet, closing the eaves under the bottom slates (the nave's lamps and
    // the sky showed through there)
    block('castiron', [-X + 0.5, X], [h - 0.03, top + 0.1], zr(Z, Z + 0.04)),
    block('castiron', [-X + 0.5, X], [h + 0.03, h + 0.15], zr(Z + 0.04, Z + 0.17)),
  ], o);
  p.density = 1400;
  // the downpipes stand on their own (a service sleeved out through the wall behind must not meet one body's box)
  const pipes = [-X + 0.62, X - 0.3].map((x) => ({ ...block('castiron', [x - 0.04, x + 0.04], [0, h + 0.03], zr(Z + 0.065, Z + 0.145), o), density: 1200 }));
  return [p, ...pipes];
}

/** Raised pulpit on the dais, clear of the east window: a panelled octagon-fronted tub on a pedestal, its floor
    1.1 m up, a sloped book board on its front, a cornice, and a stair of five steps with a handrail and newel coming
    up to it from the west. One oak body; the fielded panels, rails and stiles are detail. */
function pulpit(x: Range, z: Range, y0: number): PieceSpec {
  const fl = y0 + 0.9, top = fl + 1.0, xm = (x[0] + x[1]) / 2, zm = (z[0] + z[1]) / 2, ch = 0.22;
  // the tub in plan: a square with its front corners cut (a half-octagon toward the congregation)
  const tub = (y: Range, g = 0): PieceSpec => hull('oak', y.flatMap((yy) => ([[x[0] - g + ch, z[0] - g], [x[1] + g, z[0] - g], [x[1] + g, z[1] + g], [x[0] - g + ch, z[1] + g], [x[0] - g, z[1] + g - ch], [x[0] - g, z[0] - g + ch]] as [number, number][]).map(([a, b]) => [a, yy, b] as Vec3)));
  const parts: PieceSpec[] = [
    block('oak', [xm - 0.2, xm + 0.2], [y0, fl - 0.12], [zm - 0.2, zm + 0.2]),
    tub([fl - 0.12, top]),
    tub([top, top + 0.06], 0.04),
    hull('oak', ([[x[0] - 0.14, top - 0.05], [x[0], top - 0.005], [x[0], top - 0.13], [x[0] - 0.06, top - 0.13]] as [number, number][]).flatMap(([a, y]) => [zm - 0.3, zm + 0.3].map((b) => [a, y, b] as Vec3))),
  ];
  // stair up the pulpit's north side from the west: five risers to the floor, a newel and a raking handrail
  const sz: Range = [z[1], z[1] + 0.55], sx0 = x[0] - 0.7, run = (x[0] + ch - sx0) / 5;
  for (let i = 0; i < 5; i++) parts.push(block('oak', [sx0 + i * run, sx0 + (i + 1) * run], [y0, y0 + ((fl - y0) * (i + 1)) / 5], sz));
  parts.push(block('oak', [sx0 - 0.08, sx0], [y0, fl + 0.05], [sz[1] - 0.08, sz[1]]));
  parts.push(hull('oak', ([[sx0, fl - 0.05], [sx0, fl + 0.02], [x[0] + ch, top], [x[0] + ch, top - 0.07]] as [number, number][]).flatMap(([a, y]) => [sz[1] - 0.06, sz[1] - 0.02].map((b) => [a, y, b] as Vec3))));
  // fielded panels on the three front faces of the tub, bolection-moulded, standing 40 mm proud of its stiles and rails
  const faces: [number, number, number, number][] = [[x[0] + ch, z[0], x[0], z[0] + ch], [x[0], z[0] + ch, x[0], z[1] - ch], [x[0], z[1] - ch, x[0] + ch, z[1]]];
  for (const [ax, az, bx, bz] of faces) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), nx = dz / L, nz = -dx / L;
    const q: Vec3[] = [];
    for (const o2 of [0.001, 0.041]) for (const s2 of [0.07, L - 0.07]) for (const yy of [fl + 0.06, top - 0.14]) q.push([ax + (dx * s2) / L - nx * o2, yy, az + (dz * s2) / L - nz * o2]);
    parts.push(hull('oak', q));
  }
  return weldParts(parts, { tint: 0xc9a47c });
}

/* Welsh slate: the roof detail's slates as grey-blue stone, each a little different (the roof set's tile texture reads
   as red clay under any tint); the slab keeps its roof material */
function slated(ps: PieceSpec[]): PieceSpec[] {
  const tones = [0x3a4350, 0x434b57, 0x353c47, 0x48505a, 0x3e4652];
  // rafters, battens: sawn softwood (an untinted unit would take the slab's slate colour)
  return ps.map((p) => (p.detail ? { ...p, detail: closeCourses(p, p.detail.map((u, i) => (u.mat === 'roof' ? { ...u, mat: 'stone' as const, tint: tones[(i * 7919) % tones.length] } : u.mat === 'wood' && u.tint === undefined ? { ...u, tint: 0xa27c55 } : u))) } : p));
}

/* The slates are laid broken-bond on a grid that ignores where a roof bay ends, and a slate that would cross the bay's
   end is left out: every other course stops half a slate short, and the battens show through a stepped gap (at the
   bay joint over the truss this read as a damaged roof). Each course is closed to the bay's end with a cut slate (or
   its end slate widened into a slate-and-a-half), as a slater finishes a verge. The slates run along x. */
function closeCourses(slab: PieceSpec, d: PieceSpec[]): PieceSpec[] {
  const x0 = slab.pos[0] - slab.size[0] / 2 + 0.003, x1 = slab.pos[0] + slab.size[0] / 2 - 0.003;
  const rows = new Map<string, number[]>();
  d.forEach((u, i) => {
    if (u.mat !== 'stone' || !u.verts) return;
    const k = `${Math.round(u.pos[1] * 200)},${Math.round(u.pos[2] * 200)}`;
    const r = rows.get(k);
    if (r) r.push(i); else rows.set(k, [i]);
  });
  const out = [...d];
  const span = (u: PieceSpec): Range => [u.pos[0] - u.size[0] / 2, u.pos[0] + u.size[0] / 2];
  const refit = (u: PieceSpec, a: number, b: number): PieceSpec => {
    const [ua, ub] = span(u), c = (a + b) / 2;
    const verts = u.verts!.map((v) => [Math.abs(v[0] + u.pos[0] - ua) < 1e-4 ? a - c : Math.abs(v[0] + u.pos[0] - ub) < 1e-4 ? b - c : v[0] + u.pos[0] - c, v[1], v[2]] as Vec3);
    return { ...u, pos: [Math.round(c * 1e6) / 1e6, u.pos[1], u.pos[2]], size: [Math.round((b - a) * 1e6) / 1e6, u.size[1], u.size[2]], verts };
  };
  for (const idx of rows.values()) {
    idx.sort((i, j) => out[i].pos[0] - out[j].pos[0]);
    for (const [end, i] of [[0, idx[0]], [1, idx[idx.length - 1]]] as [0 | 1, number][]) {
      const u = out[i], [ua, ub] = span(u), gap = end ? x1 - ub : ua - x0;
      if (gap < 0.004) continue;
      // a gap under 100 mm widens the end slate; a wider one takes a cut slate of its own, 4 mm joint between
      if (gap < 0.1) out[i] = end ? refit(u, ua, x1) : refit(u, x0, ub);
      else out.push(end ? refit(u, ub + 0.004, x1) : refit(u, x0, ua - 0.004));
    }
  }
  return out;
}
