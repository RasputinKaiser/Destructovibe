import type { MaterialId, PieceSpec, Vec3 } from '../../types.ts';
import { block, cyl, extrude, hull as hullPiece, type PieceOpts, type Range } from '../../levels/kit.ts';
import { masonry, wallSlab, withDetail, BRICK } from '../../levels/layers.ts';
import { contains, hullPoly } from '../../destruction/polytope.ts';
import { hash3, shadeTint, vary } from './tints.ts';

/* Roof coverings and chimney stacks for the Clearance Zone houses and shops.
   roofUnits: the courses a sloped roof slab is built of (rafters, felt, battens, slates or tiles), laid square to the
   slope and cut to fit the slab at verges, hips and ridge so the covering is continuous (no stepped gaps where a
   course's last slate would not fit whole). pitchRoof: a duo-pitch roof over a row, split at party walls and around
   stacks, with brick gable triangles built of courses and stacks that stand on the walls below them. */

type V3 = [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const snap = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

export type Covering = 'slate' | 'tile' | 'plain';
const COVER: Record<Covering, { tt: number; gauge: number; w: number; tint: number; mat: MaterialId }> = {
  slate: { tt: 0.012, gauge: 0.25, w: 0.3, tint: 0x4f555d, mat: 'roof' },
  tile: { tt: 0.016, gauge: 0.34, w: 0.3, tint: 0x8a5242, mat: 'roof' },
  // 265 × 165 plain clay tiles at a 100 mm gauge
  plain: { tt: 0.012, gauge: 0.1, w: 0.165, tint: 0x8a5242, mat: 'terracotta' },
};

/** Give a sloped roof slab (a convex hull with one sloped top face) its courses as dormant detail. */
export function roofUnits(p: PieceSpec, o: { cover?: Covering; tint?: number } = {}): PieceSpec {
  if (p.shape !== 'hull' || !p.verts) return p;
  const world: V3[] = p.verts.map((v) => [v[0] + p.pos[0], v[1] + p.pos[1], v[2] + p.pos[2]]);
  const poly = hullPoly(world.flat());
  if (!poly) return p;
  let top: V3 | null = null, topD = 0, best = 0;
  for (const f of poly.faces) {
    if (f.n[1] < 0.3 || f.n[1] > 0.97) continue;
    const a = area(f.pts);
    if (a > best) { best = a; top = [...f.n] as V3; topD = f.d; }
  }
  if (!top) return p;
  const e = norm(cross([0, 1, 0], top)), dn = norm(cross(top, e));
  const pe = world.map((w) => dot(w, e)), pd = world.map((w) => dot(w, dn));
  const E: Range = [Math.min(...pe), Math.max(...pe)], S: Range = [Math.min(...pd), Math.max(...pd)];
  const at = (a: number, b: number, c: number): V3 => [e[0] * a + dn[0] * b + top![0] * c, e[1] * a + dn[1] * b + top![1] * c, e[2] * a + dn[2] * b + top![2] * c];
  const inside = (x: number, y: number, z: number) => contains(poly, at(x, y, z), 0.0004);
  const out: PieceSpec[] = [];
  /* shrink a unit's along-ridge (a) and down-slope (b) extents until all eight corners are inside the slab. Only the
     side the slab's edge crosses is cut: corners out along one course edge (a ridge, an eave) shorten the slate
     down the slope and keep its width, so the course stays closed; corners out along one side (a verge, a stack
     cut) narrow it; a single corner (a hip) is cut down the slope first. */
  const unit = (mat: MaterialId, a0: Range, b0: Range, c: Range, tint?: number, minA = 0.04, minB = 0.03): void => {
    const a: Range = [a0[0], a0[1]], b: Range = [b0[0], b0[1]];
    for (let it = 0; it < 80; it++) {
      const is = new Set<number>(), js = new Set<number>();
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (const z of c) if (!inside(a[i], b[j], z)) { is.add(i); js.add(j); }
      if (!is.size) break;
      const all = is.size === 2 && js.size === 2, cutB = js.size === 1 || all, cutA = (is.size === 1 && js.size === 2) || all;
      if (cutA) { if (is.has(0)) a[0] += 0.015; if (is.has(1)) a[1] -= 0.015; }
      if (cutB) { if (js.has(0)) b[0] += 0.015; if (js.has(1)) b[1] -= 0.015; }
      if (a[1] - a[0] < minA || b[1] - b[0] < minB) return;
      if (it === 79) return;
    }
    const corners: V3[] = [];
    for (const x of a) for (const y of b) for (const z of c) corners.push(at(x, y, z));
    const mid = at((a[0] + a[1]) / 2, (b[0] + b[1]) / 2, (c[0] + c[1]) / 2).map(snap) as V3;
    const verts = corners.map((q) => [snap(q[0] - mid[0]), snap(q[1] - mid[1]), snap(q[2] - mid[2])] as Vec3);
    const lo = [0, 1, 2].map((k) => Math.min(...verts.map((v) => v[k]))), hi = [0, 1, 2].map((k) => Math.max(...verts.map((v) => v[k])));
    const s: PieceSpec = { mat, shape: 'hull', verts, size: [snap(hi[0] - lo[0]), snap(hi[1] - lo[1]), snap(hi[2] - lo[2])], pos: mid };
    if (tint !== undefined) s.tint = tint;
    out.push(s);
  };
  const cv = COVER[o.cover ?? 'slate'], base = o.tint ?? p.tint ?? cv.tint;
  const bt = 0.025, felt = 0.002, c0 = topD;
  const cTile: Range = [c0 - cv.tt - 0.001, c0 - 0.001], cBat: Range = [cTile[0] - bt, cTile[0]], cFelt: Range = [cBat[0] - felt, cBat[0]];
  const cRaf: Range = [cFelt[0] - 0.12, cFelt[0] - 0.001];
  for (let a = Math.ceil(E[0] / 0.4) * 0.4; a < E[1]; a += 0.4) unit('wood', [a - 0.024, a + 0.024], [S[0] + 0.01, S[1] - 0.01], cRaf, 0xb89b72, 0.04, 0.2);
  for (let b = S[0]; b < S[1] - 0.01; b += 1.2) for (let a = E[0]; a < E[1] - 0.01; a += 2.4) {
    unit('pvc', [a + 0.001, Math.min(a + 2.4, E[1]) - 0.001], [b + 0.001, Math.min(b + 1.2, S[1]) - 0.001], cFelt, 0x3a3d42, 0.05, 0.05);
  }
  let row = 0;
  for (let b = Math.ceil(S[0] / cv.gauge) * cv.gauge; b < S[1] + cv.gauge; b += cv.gauge, row++) {
    const bb: Range = [Math.max(S[0], b - cv.gauge) + 0.003, Math.min(S[1], b) - 0.002];
    if (bb[1] - bb[0] < 0.02) continue;
    for (let a = Math.floor(E[0] / 3.6) * 3.6; a < E[1]; a += 3.6) unit('wood', [Math.max(a, E[0]) + 0.002, Math.min(a + 3.6, E[1]) - 0.002], [Math.max(bb[0], b - 0.05), bb[1]], cBat, 0xa88b62);
    const off = (row & 1) * cv.w / 2;
    for (let a = Math.floor((E[0] - off) / cv.w) * cv.w + off; a < E[1]; a += cv.w) {
      const aa: Range = [Math.max(a, E[0]) + 0.002, Math.min(a + cv.w, E[1]) - 0.002];
      if (aa[1] - aa[0] < 0.02) continue;
      const t: PieceSpec = { mat: cv.mat, size: [0, 0, 0], pos: [a, b, row] };
      unit(cv.mat, aa, [bb[0] + 0.002, bb[1]], cTile, vary(base, t, 0.16, 3), 0.02, 0.02);
    }
  }
  return withDetail({ ...p }, out);
}

function area(q: number[]): number {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i + 1 < q.length / 3; i++) {
    const ux = q[i * 3] - q[0], uy = q[i * 3 + 1] - q[1], uz = q[i * 3 + 2] - q[2];
    const wx = q[i * 3 + 3] - q[0], wy = q[i * 3 + 4] - q[1], wz = q[i * 3 + 5] - q[2];
    ax += uy * wz - uz * wy; ay += uz * wx - ux * wz; az += ux * wy - uy * wx;
  }
  return Math.hypot(ax, ay, az) / 2;
}

/* ---------------- chimney stacks ---------------- */

export interface ShaftOpts {
  x: Range; z: Range; y: Range; tint: number; pots: number; potTint?: number; soot: number; group?: string;
  /** the flue rises from the wall below in a neck of the wall's own width (x range) up to `top`, where the stack
      gathers out to its full width: the stack then bears on the wall alone, clear of the ceiling joists beside it */
  neck?: { x: Range; top: number };
  potD?: number;
  potH?: number;
}

/** A brick stack shaft standing on the wall below it (base at y[0]), its courses sooting up above `soot`, an
    oversailing capping course and a row of clay pots. */
export function stackShaft(s: ShaftOpts): PieceSpec[] {
  const o: PieceOpts = { tint: s.tint, group: s.group };
  // a stack is built on its wall and flashed to the roof, not bonded to it: it stands or falls with the wall
  const courses = (x: Range, y: Range, z: Range) => {
    const alongX = x[1] - x[0] >= z[1] - z[0];
    const slab = wallSlab(alongX ? 'x' : 'z', alongX ? x : z, y, alongX ? z : x, 1);
    const T = alongX ? z[1] - z[0] : x[1] - x[0];
    const units = masonry(slab, slab.T, { mat: 'brick', tint: s.tint, unit: [BRICK[0], BRICK[1], T >= 0.18 ? (T - 0.01) / 2 : T], joint: 0.01, kind: T >= 0.18 ? 'english' : 'stretcher' });
    for (const u of units) {
      let k = u.pos[1] < s.soot ? 1 : Math.max(0.28, 1 - 0.72 * ((u.pos[1] - s.soot) / Math.max(0.5, s.y[1] - s.soot)) ** 1.1);
      // soot-laden run-off streaks down from the oversailing course, in a few columns of bricks
      const col = Math.round((alongX ? u.pos[0] : u.pos[2]) / 0.11), below = s.y[1] - u.pos[1];
      if (below < 1.1 && hash3(col, 0, alongX ? z[0] : x[0], 41) < 0.3) k *= 0.55 + 0.45 * (below / 1.1) ** 0.7;
      u.tint = shadeTint(vary(s.tint, u, 0.2, 5), k);
    }
    return units;
  };
  const ps: PieceSpec[] = [];
  const y0 = s.neck ? s.neck.top : s.y[0];
  if (s.neck) ps.push(withDetail(block('brick', s.neck.x, [s.y[0], s.neck.top], s.z, o), courses(s.neck.x, [s.y[0], s.neck.top], s.z)));
  const shaft = block('brick', s.x, [y0, s.y[1]], s.z, { ...o, joint: { kind: 'nail', n: 4, d: 0.006 } });
  ps.push(withDetail(shaft, courses(s.x, [y0, s.y[1]], s.z)));
  const top = s.y[1];
  /* the oversailing course, black with soot, under a cement flaunching that weathers the pots in: thin at the
     edges, swept up round the pot bases, dark and crazed */
  const cx: Range = [s.x[0] - 0.06, s.x[1] + 0.06], cz: Range = [s.z[0] - 0.06, s.z[1] + 0.06], zc0 = (s.z[0] + s.z[1]) / 2;
  const capSlab = wallSlab('x', cx, [top, top + 0.075], cz, 1);
  const cap: PieceSpec[] = masonry(capSlab, capSlab.T, { mat: 'brick', tint: s.tint, unit: [BRICK[0], BRICK[1], (cz[1] - cz[0] - 0.01) / 2], joint: 0.01, kind: 'english' });
  for (const u of cap) u.tint = shadeTint(vary(s.tint, u, 0.2, 6), 0.42);
  const potD = s.potD ?? 0.21;
  /* the flaunching: a sand-and-cement bed thin at the oversailing course's edges, swept steeply up round the pots
     (a matte cement skin, darkened by soot) */
  const fy = top + 0.077, fe = 0.004, cr = Math.min(potD / 2 + 0.03, (cz[1] - cz[0]) / 2 - 0.02);
  const fl = hullPiece('plaster', [
    ...[cz[0] + fe, cz[1] - fe].flatMap((z) => [[cx[0] + fe, fy, z], [cx[1] - fe, fy, z], [cx[0] + fe, fy + 0.008, z], [cx[1] - fe, fy + 0.008, z]] as Vec3[]),
    ...[zc0 - cr, zc0 + cr].flatMap((z) => [[cx[0] + 0.03, top + 0.148, z], [cx[1] - 0.03, top + 0.148, z]] as Vec3[]),
  ]);
  fl.tint = shadeTint(vary(0x6e6961, fl, 0.08, 3), 0.9);
  cap.push(fl);
  ps.push(withDetail(block('brick', cx, [top, top + 0.15], cz, { ...o, tint: shadeTint(s.tint, 0.55) }), cap));
  // the rim stands proud of the body; pots set close in a row keep 12 mm between rims
  const w = s.x[1] - s.x[0], zc = (s.z[0] + s.z[1]) / 2, rimD = Math.min(potD + 0.035, w / s.pots - 0.012), bodyD = Math.min(potD, rimD - 0.03);
  for (let i = 0; i < s.pots; i++) {
    const x = s.x[0] + ((i + 0.5) * w) / s.pots, y1 = top + (s.potH ?? 0.55) + 0.08 * (i % 2), clay = shadeTint(s.potTint ?? 0xb86a48, 0.72 + 0.07 * (i % 3), 0.3);
    /* a plain octagonal clay pot: a moulded rim at the top, sooted black-brown over the rim and a hand's width below
       it, grimy where it is bedded in the flaunching. The pot stays fired clay; its skin is drawn in a plain matte
       finish with hairline arrises (a faceted cylinder's chamfers read as a cage of stripes). */
    const rim = y1 - 0.05, soot = rim - Math.min(0.14, (y1 - top - 0.15) * 0.25), bed = top + 0.2;
    const pot = cyl('terracotta', rimD, [top + 0.15, y1], x, zc, { tint: clay, group: s.group });
    const skin = (d: number, y: Range, tint: number): PieceSpec => ({ ...cyl('drywall', d, y, x, zc, { tint }), shape: 'prism', sides: 8 });
    ps.push(withDetail(pot, [skin(bodyD, [top + 0.15, bed], 0x3e3833), skin(bodyD, [bed, soot], clay), skin(bodyD, [soot, rim], shadeTint(clay, 0.42)),
      skin(rimD * 0.92, [rim, y1], 0x2e2824)]));
  }
  return ps;
}

/* ---------------- duo-pitch roof over a row ---------------- */

/** a stack through the roof: its plan (x, ±sz about the ridge) and the wall it rises from (neck); the slopes and
    gables stand 30 mm clear of it all round (the flashing gap), so it bears on its wall alone */
export interface RoofStack { x: Range; sz: number; h: number; pots: number; tint?: number; neck?: Range; potTint?: number; potD?: number; potH?: number }
const FLASH = 0.03;
export interface PitchRoofOpts {
  /** along the ridge, verges included, and the party lines where the covering is broken into bays */
  x: Range;
  breaks?: number[];
  /** outer faces of the eave walls, the wall-top height, the underside rise to the ridge */
  z: Range;
  y: number;
  rise: number;
  thick: number;
  seat: number;
  /** walls under the roof whose gable triangles carry the slopes */
  gables: Range[];
  stacks?: RoofStack[];
  tint?: number;
  ridgeTint?: number;
  gableTint: number;
  cover?: Covering;
  maxW?: number;
  group?: string;
}

/** A duo-pitch roof whose slopes seat on the eave walls and lean on brick gable triangles; stacks rise from the gable
    walls through the roof (the slopes and the gables are cut short of them), so they stand on the wall below. */
export function pitchRoof(r: PitchRoofOpts): PieceSpec[] {
  const [z0, z1] = r.z, mid = (z0 + z1) / 2, half = (z1 - z0) / 2, seat = r.seat, c = 0.12, cap = 0.14;
  const k = r.rise / (half - seat);
  const under = (d: number) => r.y + k * (half - seat - d);
  const ridgeTop = under(c) + r.thick, eaveTop = r.y + r.thick - k * seat;
  const topAt = (d: number) => ridgeTop - k * (d - c);
  const o: PieceOpts = { tint: r.tint ?? COVER[r.cover ?? 'slate'].tint, group: r.group };
  const stacks = r.stacks ?? [];
  const zone = (s: RoofStack): Range => {
    // a sliver of verge left outside the flashing gap would be too thin to build: the clipped slope runs to the verge
    const lo = s.x[0] - FLASH, hi = s.x[1] + FLASH;
    return [lo - r.x[0] < 0.08 ? r.x[0] : lo, r.x[1] - hi < 0.08 ? r.x[1] : hi];
  };
  const cuts = new Set<number>([r.x[0], r.x[1], ...(r.breaks ?? []), ...stacks.flatMap((s) => zone(s))]);
  const xs = [...cuts].filter((v) => v >= r.x[0] - 1e-9 && v <= r.x[1] + 1e-9).sort((a, b) => a - b);
  const ps: PieceSpec[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const seg: Range = [xs[i], xs[i + 1]];
    if (seg[1] - seg[0] < 1e-6) continue;
    const st = stacks.find((s) => seg[0] >= zone(s)[0] - 1e-9 && seg[1] <= zone(s)[1] + 1e-9);
    const n = Math.max(1, Math.ceil((seg[1] - seg[0]) / (r.maxW ?? 5.2)));
    for (let j = 0; j < n; j++) {
      const sx: Range = [seg[0] + ((seg[1] - seg[0]) * j) / n, seg[0] + ((seg[1] - seg[0]) * (j + 1)) / n];
      const prof: [number, number][] = st
        ? [[half, r.y], [half - seat, r.y], [st.sz + FLASH, under(st.sz + FLASH)], [st.sz + FLASH, topAt(st.sz + FLASH)], [half, eaveTop]]
        : [[half, r.y], [half - seat, r.y], [0, under(0)], [0, ridgeTop], [c, ridgeTop], [half, eaveTop]];
      for (const s of [1, -1]) ps.push(roofUnits(extrude('roof', prof.map(([d, y]) => [mid + s * d, y] as [number, number]), 'x', sx, o), { cover: r.cover }));
    }
    // one run of ridge tiles per bay, bedded along the slabs' ridge strips
    if (!st) ps.push(extrude('terracotta', [[mid - c, ridgeTop], [mid + c, ridgeTop], [mid + 0.9 * c, ridgeTop + 0.45 * cap], [mid + 0.55 * c, ridgeTop + 0.85 * cap],
      [mid, ridgeTop + cap], [mid - 0.55 * c, ridgeTop + 0.85 * cap], [mid - 0.9 * c, ridgeTop + 0.45 * cap]], 'x', seg, { tint: r.ridgeTint ?? 0x8a4a3a, group: r.group }));
  }
  // gable triangles, halved on the ridge line, built of courses; cut back where a stack stands on the wall
  for (const gx of r.gables) {
    const st = stacks.find((s) => gx[0] >= s.x[0] - 1e-9 && gx[1] <= s.x[1] + 1e-9);
    const dm = st ? st.sz + FLASH : 0;
    for (const s of [1, -1]) {
      const e = mid + s * (half - seat), m = mid + s * dm, yt = under(dm);
      const q = extrude('brick', [[e, r.y], [m, r.y], [m, yt]], 'x', gx, { tint: r.gableTint, group: r.group });
      ps.push(gableCourses(q, 'x', gx, e, m, r.y, yt, r.gableTint));
    }
  }
  for (const st of stacks) {
    ps.push(...stackShaft({ x: st.x, z: [mid - st.sz, mid + st.sz], y: [r.y, ridgeTop + cap + st.h], tint: st.tint ?? r.gableTint, pots: st.pots, soot: ridgeTop - 0.4, group: r.group,
      neck: st.neck ? { x: st.neck, top: r.y + 0.6 } : undefined, potTint: st.potTint, potD: st.potD, potH: st.potH }));
  }
  return ps;
}

/** Brick courses inside a gable triangle extruded `along` x (profile in z) or z (profile in x) over the thickness
    `thick`: from the eave-side corner at e (height y) rising to the tall side at m (height yt). */
export function gableCourses(q: PieceSpec, along: 'x' | 'z', thick: Range, e: number, m: number, y: number, yt: number, tint: number): PieceSpec {
  const ur: Range = [Math.min(e, m), Math.max(e, m)], k = along === 'x' ? 2 : 0;
  const slab = wallSlab(along === 'x' ? 'z' : 'x', ur, [y, yt], thick, 1);
  const line = (u: number) => y + ((yt - y) * (u - e)) / (m - e);
  const out: PieceSpec[] = [];
  for (const u of masonry(slab, slab.T, { mat: 'brick', tint, unit: [BRICK[0], BRICK[1], (thick[1] - thick[0] - 0.01) / 2], joint: 0.01, kind: 'flemish' })) {
    const ua = u.pos[k] - u.size[k] / 2, ub = u.pos[k] + u.size[k] / 2, ya = u.pos[1] - u.size[1] / 2, yb = u.pos[1] + u.size[1] / 2;
    const la = line(ua) - 0.002, lb = line(ub) - 0.002;
    if (yb <= Math.min(la, lb)) { u.tint = vary(tint, u, 0.2, 1); out.push(u); continue; }
    // a brick the rake passes through is cut along it (a trapezoid) — no stepped verge
    if (Math.max(la, lb) - ya < 0.02) continue;
    const t0 = u.pos[along === 'x' ? 0 : 2] - u.size[along === 'x' ? 0 : 2] / 2, t1 = t0 + u.size[along === 'x' ? 0 : 2];
    // keep the part of the brick under the rake: where the rake dips below the brick's bed the brick is cut short
    const uc = e + ((ya + 0.006 - y) * (m - e)) / (yt - y);
    let c0 = ua, c1 = ub;
    if (la < ya + 0.006) c0 = Math.max(ua, Math.min(ub, uc));
    if (lb < ya + 0.006) c1 = Math.min(ub, Math.max(ua, uc));
    if (c1 - c0 < 0.02) continue;
    const pts: Vec3[] = [];
    for (const [uu, top] of [[c0, Math.min(yb, line(c0) - 0.002)], [c1, Math.min(yb, line(c1) - 0.002)]] as const) {
      for (const tt of [t0, t1]) for (const yy of [ya, top]) pts.push(along === 'x' ? [tt, yy, uu] : [uu, yy, tt]);
    }
    const cut = hullPiece('brick', pts);
    cut.tint = vary(tint, u, 0.2, 1);
    out.push(cut);
  }
  return out.length ? withDetail(q, out) : q;
}
