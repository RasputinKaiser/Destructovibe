import type { MaterialId, PieceSpec, Vec3 } from '../../types.ts';
import { block, hull, splitRange, weldParts, type PieceOpts, type Range } from '../../levels/kit.ts';
import { withDetail } from '../../levels/layers.ts';
import { member, PROF } from '../../levels/architecture/common.ts';

/* Package-local construction helpers for the steel portal sheds (portal shed, works hall, builders' merchant).

   The frame is simulated member by member (a column or a haunched rafter is one rigid body made of its plates);
   everything finer rides on the members as dormant detail: sheeting rails, eaves struts and bracing inside the
   wall and roof build-ups, profiled sheets with their crowns, roof lights, flashings, shutter laths. */

const snap = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

export const SHED = {
  steel: 0x7d868d,
  sheet: 0xa7aca8,        // goosewing grey
  roof: 0x9ea3a4,
  trim: 0x4b5256,         // merlin grey flashings
  gutter: 0x3f4447,
  rooflight: 0xd2e2fa,
  galv: 0x9aa1a6,
};

/* unit densities giving real weights to units drawn thicker than the steel: 0.7 mm profiled sheet ~7 kg/m² over a
   13.5 mm pan; Z rails and purlins ~5-6 kg/m over their drawn box; M20 bracing rod 2.5 kg/m; folded trims */
export const RHO = { sheet: 520, rail: 650, rod: 1700, trim: 120, light: 250, strut: 900, lath: 300 };
const rho = (q: PieceSpec, v: number): PieceSpec => { q.density = v; return q; };

/* 32/1000 trapezoidal sheet through its depth, measured in from its outer face. Each 1 m sheet is ONE body — its pan
   (drawn 13.5 mm, weighing 0.7 mm steel) — so a torn sheet leaves as a whole sheet, not as slats. The crowns (a cap
   and two webs at 333 mm, all under the 12 mm cosmetic limit) stand 34 mm proud of it outside; inside, the grey-white
   backing coat is drawn in bands, darker under each crown, so the sheet still reads ribbed from inside. */
export const PROFILE = { cap: [0, 0.0115] as Range, web: [0, 0.034] as Range, pan: [0.034, 0.0475] as Range, backOut: [0.048, 0.0495] as Range, back: [0.0495, 0.052] as Range, depth: 0.053 };
export const LINER = 0xd4d8d6;
const LINER_RIB = 0xa9aeb0;
/* the roof's backing coat faces down, where the site's warm ground bounce is all that lights it: drawn cool so it
   reads grey-white there, not cream (the ambient itself is an engine matter, see the loop2 round-3 claims) */
const ROOF_LINER = 0xb0cbf2, ROOF_RIB = 0x8ea6c8;
/** units of the sheets covering u0..u1 (1 m cover from u0), as [u, depth band from the outer face, tint, body?] */
function sheetLayers(u0: number, u1: number, tint: number, liner: [number, number] | null, banded = true): [Range, Range, number, boolean][] {
  const out: [Range, Range, number, boolean][] = [];
  /* the backing coat is laid in bands, darker under each crown; each band has the steel's own outer face (the sheet's
     tone) in front of the coat. A struck pan and its crowns go to dust over a region, the bands straddling its edge
     stay: they now read as torn strips of the sheet, not as pale stripes of backing coat (the "barcode") */
  const back = (u: Range, coat: number) => { if (banded) out.push([[u[0] + 0.0005, u[1] - 0.0005], PROFILE.backOut, shade(tint, 0.82), false]); out.push([u, PROFILE.back, coat, false]); };
  for (let a = u0; a < u1 - 0.004; a += 1.0) {
    const s1 = Math.min(a + 1.0, u1);
    out.push([[a, s1], PROFILE.pan, tint, true]);
    // (a roof is only seen stripped from above: one film of the sheet's tone across the sheet does there)
    if (liner && !banded) out.push([[a + 0.001, s1 - 0.001], PROFILE.backOut, shade(tint, 0.82), false]);
    let cur = a;
    for (let c = a + 0.1665; c + 0.03 < s1 - 0.004; c += 0.333) {
      out.push([[c - 0.03, c - 0.019], PROFILE.web, tint, false], [[c - 0.019, c + 0.019], PROFILE.cap, tint, false], [[c + 0.019, c + 0.03], PROFILE.web, tint, false]);
      if (liner) { if (c - 0.03 - cur > 0.002) back([cur, c - 0.03], liner[0]); back([c - 0.03, c + 0.03], liner[1]); }
      cur = c + 0.03;
    }
    if (liner && s1 - cur > 0.002) back([cur, s1], liner[0]);
  }
  return out;
}

export const shade = (c: number, k: number): number =>
  (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

/* ---------------- frame ---------------- */

export interface FrameDims {
  X: number; Z: number; H: number;
  /** column depth (in the frame plane, along z) and flange width (along x) */
  D: number; B: number;
  /** rafter depth square to the slope */
  dR: number;
  tn: number; sn: number; cs: number;
  /** rafter top (roof underside) at the column outer face, and at the ridge */
  Ht: number; yR: number;
  /** wall build-up (rails + sheet), roof build-up (bracing, purlins on cleats, sheet) */
  tw: number; tr: number;
  /** wall-cladding top: the roof underside over the cladding's outer face */
  Hg: number;
  /** outer face of the side walls, and the roof's eaves edge (over the gutter) */
  Ze: number; Zr: number;
}

export function frameDims(X: number, Z: number, H: number, pitchDeg = 6): FrameDims {
  const th = (pitchDeg * Math.PI) / 180, tn = Math.tan(th), sn = Math.sin(th), cs = Math.cos(th);
  const span = 2 * Z;
  const D = snap(Math.min(0.5, Math.max(0.36, 0.3 + 0.012 * span)));
  const B = span > 10 ? 0.19 : 0.17;
  const dR = snap(Math.min(0.42, Math.max(0.3, 0.24 + 0.012 * span)));
  const Ht = H + 0.45, yR = Ht + Z * tn, tw = 0.2, tr = 0.26;
  const Ze = Z + tw, Zr = Ze + 0.12;
  return { X, Z, H, D, B, dR, tn, sn, cs, Ht, yR, tw, tr, Hg: snap(yR - Ze * tn), Ze, Zr };
}

/** roof underside (rafter top) height at |z| */
export const roofY = (f: FrameDims, z: number): number => f.yR - Math.abs(z) * f.tn;

/** One portal column: UB with its base plate and a cap flush under the roof, as one body. `s` is the side (+1 at +Z). */
export function column(f: FrameDims, x: number, s: 1 | -1, o: PieceOpts, haunch = true): PieceSpec {
  const { D, B, Z } = f, t = 0.04, bp = 0.04;
  const zo = s * Z, zi = s * (Z - D);
  const zr = (a: number, b: number): Range => [Math.min(a, b), Math.max(a, b)];
  const xr: Range = [x - B / 2, x + B / 2];
  const yTopOut = snap(roofY(f, Z)), yTopIn = snap(roofY(f, Z - D + t));
  const parts = [
    block('steel', xr, [0, bp], zr(zo, zi - s * 0.08), o),
    block('steel', xr, [bp, yTopOut], zr(zo, zo - s * t), o),
    block('steel', xr, [bp, yTopIn], zr(zi, zi + s * t), o),
    block('steel', [x - t / 2, x + t / 2], [bp, yTopOut], zr(zo - s * t, zi + s * t), o),
  ];
  // web stiffeners opposite the haunch flange and the rafter's top flange, each side of the web
  const g = haunchGeom(f), yh = haunch ? haunchSoffit(f) : g.bot(g.zc - g.t), zin = zr(zo - s * t, zi + s * t);
  for (const y of [yh, yTopOut - 0.06]) for (const xs of [[x - B / 2, x - t / 2], [x + t / 2, x + B / 2]] as Range[]) parts.push(block('steel', xs, [y - 0.02, y + 0.02], zin, o));
  return weldParts(parts, { section: { kind: 'I', t: 0.0177, tw: 0.0105, axis: 1, depth: 2 }, joint: { kind: 'bolt', n: 4, d: 0.024, grade: '8.8', preload: 0.2 } });
}

/* member() plates back into world-space hull pieces, so a rafter and its haunch plates become one body */
function unpack(p: PieceSpec): PieceSpec[] {
  if (!p.parts) return [p];
  return p.parts.map((q) => ({ mat: p.mat, shape: q.shape ?? 'box', size: [...q.size] as Vec3, pos: [snap(p.pos[0] + q.pos[0]), snap(p.pos[1] + q.pos[1]), snap(p.pos[2] + q.pos[2])] as Vec3, ...(q.verts ? { verts: q.verts.map((v) => [...v] as Vec3) } : {}) }));
}

/* where the haunch ends (its toe) and its soffit depth at the column */
function haunchGeom(f: FrameDims) {
  const t = 0.04, zc = f.Z - f.D, dv = f.dR / f.cs, L = Math.max(0.8, 0.1 * 2 * f.Z);
  const toe = zc - t - L;
  const bot = (z: number) => roofY(f, z) - dv;
  const hb = (z: number) => bot(z) - (dv * (z - toe)) / (zc - t - toe);
  return { t, zc, dv, toe, bot, hb };
}
export const haunchSoffit = (f: FrameDims): number => { const g = haunchGeom(f); return g.hb(g.zc - g.t); };
/** the rafter splice (plastic-hinge point at the haunch toe), as a distance from the ridge along z */
export const spliceZ = (f: FrameDims): number => haunchGeom(f).toe;

/** A haunched rafter on side `s`, in two bodies bolted together at the haunch toe (where a portal frame hinges):
    the eaves segment (end plate bolted to the column's inner flange, cut-from-section haunch web and inclined flange,
    splice plate) and the main rafter (splice plate, UB, apex plate bolted to its partner). Plates are the bodies'
    parts; their detail repeats the plates, draws the end plates at their real 25 mm and puts the bolts and nuts on. */
export function rafter(f: FrameDims, x: number, s: 1 | -1, o: PieceOpts, haunch = true): PieceSpec[] {
  const { B, dR } = f;
  const { t, zc, toe, bot, hb: hh } = haunchGeom(f);
  // a gable frame carries only half a bay of roof: its rafter runs at full depth to the column, no haunch under it
  const hb = haunch ? hh : bot;
  const top = (z: number) => roofY(f, z);
  const P = (z: number, y: number, xx = x): Vec3 => [xx, y, s * z];
  const mid = (z: number) => (top(z) + bot(z)) / 2;
  const prof = PROF.I(dR, B, 0.0128, 0.0078);
  // an end/splice plate between z0 and z1 (z1 nearer the eaves), from `lo` under the soffit to just under the roof
  const plate = (z0: number, z1: number, lo: (z: number) => number): PieceSpec => {
    const q: Vec3[] = [];
    for (const xx of [x - B / 2, x + B / 2]) for (const z of [z0, z1]) q.push(P(z, lo(z), xx), P(z, top(z) - 0.002, xx));
    return hull('steel', q);
  };
  const plain = (z: number) => bot(z) - 0.03;
  // eaves segment: end plate at the column, UB, haunch, splice plate at the toe
  const eEnd = plate(zc - t, zc, () => hb(zc - t) - 0.03);
  const eSpl = plate(toe, toe + t, plain);
  const eRaf = member('steel', P(zc - t, mid(zc - t)), P(toe + t, mid(toe + t)), prof, { cut: 'plumb' });
  const web: Vec3[] = [], fl: Vec3[] = [];
  for (const xx of [x - t / 2, x + t / 2]) web.push(P(zc - t, bot(zc - t), xx), P(toe + t, bot(toe + t), xx), P(zc - t, hb(zc - t) + t, xx), P(toe + t, Math.min(bot(toe + t), hb(toe + t) + t), xx));
  for (const xx of [x - B / 2, x + B / 2]) fl.push(P(zc - t, hb(zc - t), xx), P(zc - t, hb(zc - t) + t, xx), P(toe + t, hb(toe + t), xx), P(toe + t, Math.min(bot(toe + t) - 0.001, hb(toe + t) + t), xx));
  // main rafter: splice plate, UB, apex plate
  const mSpl = plate(toe - t, toe, plain);
  const mApx = plate(0, t, plain);
  const mRaf = member('steel', P(toe - t, mid(toe - t)), P(t, mid(t)), prof, { cut: 'plumb' });
  const nut = (z: Range, y: number, xx: number) => { const q = block('steel', [xx - 0.018, xx + 0.018], [y - 0.018, y + 0.018], z); q.tint = 0x3a3d40; return q; };
  const bolts = (face: number, dir: 1 | -1, ys: number[]): PieceSpec[] => {
    // the plate drawn 25 mm thick against the joint face, nuts in the 15 mm left on the member side of the part
    const zz: Range = dir > 0 ? [face + 0.025, face + 0.04] : [face - 0.04, face - 0.025];
    const zw: Range = [Math.min(s * zz[0], s * zz[1]), Math.max(s * zz[0], s * zz[1])];
    return ys.flatMap((y) => [nut(zw, y, x - 0.06), nut(zw, y, x + 0.06)]);
  };
  const rows = (z: number, lo: number, n: number) => Array.from({ length: n }, (_, i) => lo + 0.06 + ((top(z) - 0.06 - (lo + 0.06)) * i) / Math.max(1, n - 1));
  const thin = (p: PieceSpec, face: number, dir: 1 | -1): PieceSpec => {
    // the same plate, 25 mm thick against its joint face
    const v = p.verts!.map((q) => [q[0] + p.pos[0], q[1] + p.pos[1], q[2] + p.pos[2]] as Vec3);
    const zf = s * face, zi = s * (face + dir * 0.025);
    return hull('steel', v.map((q) => [q[0], q[1], Math.abs(q[2] - zf) < 1e-6 ? zf : zi] as Vec3));
  };
  const make = (plates: PieceSpec[], units: PieceSpec[]): PieceSpec => {
    const out = weldParts(plates, { joint: { kind: 'bolt', n: 8, d: 0.024, grade: '8.8', preload: 0.6 } });
    const d = units.map((q) => { const c = { ...q }; if (c.tint === undefined) c.tint = o.tint; if (!c.finish && o.finish && c.tint === o.tint) c.finish = o.finish; if (c.density === undefined) c.density = Math.round(7850 * 0.34); return c; });
    const res = withDetail(out, d);
    if (o.tint !== undefined) res.tint = o.tint;
    if (o.group !== undefined) res.group = o.group;
    if (o.finish) res.finish = o.finish;
    return res;
  };
  const hs = haunch ? [hull('steel', web), hull('steel', fl)] : [];
  const eParts = [...unpack(eRaf), ...hs, eEnd, eSpl];
  const mParts = [...unpack(mRaf), mSpl, mApx];
  const eaves = make(eParts, [
    ...unpack(eRaf), ...hs, thin(eEnd, zc, -1), thin(eSpl, toe, 1),
    ...bolts(zc, -1, rows(zc, hb(zc - t), 5)), ...bolts(toe, 1, rows(toe, bot(toe), 3)),
  ]);
  const main = make(mParts, [
    ...unpack(mRaf), thin(mSpl, toe, -1), thin(mApx, 0, 1),
    ...bolts(toe, -1, rows(toe, bot(toe), 3)), ...bolts(0, 1, rows(0, bot(0), 3)),
  ]);
  return [eaves, main];
}

/* ---------------- walls ---------------- */

export interface CladOpts {
  tint: number;
  /** lower band (two-tone) up to this height (builder y); 0 = none */
  band?: number;
  bandTint?: number;
  /** cross-bracing in this panel */
  brace?: boolean;
  /** eaves strut along the top */
  eaves?: boolean;
  /** corner trims at these along-wall ends */
  corners?: number[];
}

/* a wall panel's frame: along U (x or z), up Y, through T from inner face Ti to outer face To (To may be < Ti) */
function wallFrame(p: PieceSpec, alongX: boolean, out: 1 | -1) {
  const r = (k: number): Range => [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2];
  const U = r(alongX ? 0 : 2), Y = r(1), T = r(alongX ? 2 : 0);
  const Ti = out > 0 ? T[0] : T[1], To = out > 0 ? T[1] : T[0];
  const tr = (a: number, b: number): Range => { const u = Ti + out * a, v = Ti + out * b; return [Math.min(u, v), Math.max(u, v)]; };
  const cell = (mat: MaterialId, u: Range, y: Range, t: Range, tint?: number, finish?: PieceSpec['finish']): PieceSpec => {
    const q = alongX ? block(mat, u, y, t) : block(mat, t, y, u);
    if (tint !== undefined) q.tint = tint;
    if (finish) q.finish = finish;
    return q;
  };
  const diag = (mat: MaterialId, a: [number, number], b: [number, number], w: number, t: Range, tint?: number): PieceSpec => {
    const du = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(du, dy), nu = (-dy / l) * (w / 2), ny = (du / l) * (w / 2);
    const pts: Vec3[] = [];
    for (const [u, y] of [[a[0] + nu, a[1] + ny], [a[0] - nu, a[1] - ny], [b[0] + nu, b[1] + ny], [b[0] - nu, b[1] - ny]]) for (const tt of t) pts.push(alongX ? [u, y, tt] : [tt, y, u]);
    const q = hull(mat, pts);
    if (tint !== undefined) q.tint = tint;
    return q;
  };
  return { U, Y, T, Ti, To, tr, cell, diag, depth: Math.abs(To - Ti) };
}

/** Profiled-sheet wall panel: its units are the cold-rolled sheeting rails (and eaves strut), cross-bracing, and
    32/1000 trapezoidal sheets (1 m cover, crowns at 333 mm) in one or two tones with a band flashing. */
export function claddingDetail(p: PieceSpec, alongX: boolean, out: 1 | -1, o: CladOpts): PieceSpec {
  const w = wallFrame(p, alongX, out);
  const { U, Y, tr, cell } = w;
  const d: PieceSpec[] = [];
  const dep = w.depth, band = (r: Range): Range => tr(dep - r[1], dep - r[0]);
  const rail: Range = tr(0.062, dep - PROFILE.depth);
  const corners = (o.corners ?? []).filter((c) => c >= U[0] - 1e-6 && c <= U[1] + 1e-6);
  let u0 = U[0], u1 = U[1];
  for (const c of corners) {
    const cu: Range = Math.abs(c - U[0]) < 1e-6 ? [U[0], U[0] + 0.25] : [U[1] - 0.25, U[1]];
    d.push(rho(cell('metal', cu, Y, tr(0.062, dep), SHED.trim, 'paint'), RHO.trim));
    if (cu[0] === U[0]) u0 = cu[1]; else u1 = cu[0];
  }
  if (u1 - u0 < 0.02) return withDetail(p, d);
  // sheets: bands of the panel height, each tiled by 1 m cover widths
  const bands: { y: Range; tint: number }[] = [];
  const yb = o.band ?? 0, low = o.bandTint ?? shade(o.tint, 0.62);
  if (yb > Y[0] + 0.2 && yb < Y[1] - 0.3) {
    bands.push({ y: [Y[0], yb - 0.05], tint: low }, { y: [yb, Y[1]], tint: o.tint });
    if (u1 - u0 > 0.02) d.push(rho(cell('metal', [u0, u1], [yb - 0.05, yb], tr(dep - PROFILE.back[1], dep), SHED.trim, 'paint'), RHO.sheet));
  } else bands.push({ y: Y, tint: yb > 0 && Y[1] <= yb + 1e-6 ? low : o.tint });
  for (const b of bands) {
    if (b.y[1] - b.y[0] < 0.05) continue;
    for (const [u, r, tint] of sheetLayers(u0, u1, b.tint, [LINER, LINER_RIB])) d.push(rho(cell('metal', u, b.y, band(r), tint, 'paint'), RHO.sheet));
  }
  // sheeting rails (cold-rolled Z, 65 mm flange seen from inside) at ~1.8 m, the eaves strut along the top
  const top = o.eaves ? Y[1] - 0.2 : Y[1] - 0.25;
  // (a strip beside a door is carried by the door's jamb post, not on rails)
  if (u1 - u0 >= 1.5) for (let y = Y[0] + 1.25; y + 0.07 < top; y += 1.75) d.push(rho(cell('steel', [u0, u1], [y, y + 0.065], rail, SHED.galv, 'galv'), RHO.rail));
  if (o.eaves) d.push(rho(cell('steel', [u0, u1], [Y[1] - 0.17, Y[1] - 0.002], rail, SHED.steel), RHO.strut));
  if (o.brace && U[1] - U[0] > 1.5 && Y[1] - Y[0] > 2.5) {
    const m = 0.3, lo = Y[0] + 0.35, hi = Y[1] - 0.35;
    d.push(rho(w.diag('steel', [U[0] + m, lo], [U[1] - m, hi], 0.05, tr(0.001, 0.03), SHED.steel), RHO.rod));
    d.push(rho(w.diag('steel', [U[0] + m, hi], [U[1] - m, lo], 0.05, tr(0.031, 0.06), SHED.steel), RHO.rod));
  }
  return withDetail(p, d);
}

/** The gable triangle over the gable wall at x in `xr` (inner face at `xin`, outer `xout`), as one hull with sheets
    whose tops follow the roof, and a rail. */
export function gableTriangle(f: FrameDims, xr: Range, out: 1 | -1, o: { tint: number; group?: string }): PieceSpec {
  const { Ze, Hg } = f, apex = roofY(f, 0);
  const pts: Vec3[] = [];
  for (const x of xr) pts.push([x, Hg, -Ze], [x, Hg, Ze], [x, apex, 0]);
  const p = hull('metal', pts, { tint: o.tint, group: o.group });
  const Ti = out > 0 ? xr[0] : xr[1], dep = xr[1] - xr[0];
  const trr = (a: number, b: number): Range => { const u = Ti + out * a, v = Ti + out * b; return [Math.min(u, v), Math.max(u, v)]; };
  const col = (mat: MaterialId, z: Range, y0: number, t: Range, tint: number, inset = 0.002): PieceSpec => {
    const top = (zz: number) => roofY(f, zz) - inset - 0.0005;
    const q: Vec3[] = [];
    for (const x of t) q.push([x, y0, z[0]], [x, y0, z[1]], [x, top(z[0]), z[0]], [x, top(z[1]), z[1]]);
    const u = hull(mat, q);
    u.tint = tint;
    u.finish = 'paint';
    u.density = RHO.sheet;
    return u;
  };
  const d: PieceSpec[] = [];
  const band = (r: Range): Range => trr(dep - r[1], dep - r[0]);
  const edges: number[] = [];
  for (let z = -Ze; z < Ze - 1e-6; z += 1.0) edges.push(z);
  edges.push(Ze);
  if (!edges.some((e) => Math.abs(e) < 1e-6)) { edges.push(0); edges.sort((a, b) => a - b); }
  for (let i = 0; i + 1 < edges.length; i++) {
    const lim = Ze - 0.07, z: Range = [Math.max(edges[i], -lim), Math.min(edges[i + 1], lim)];
    const hMin = Math.min(roofY(f, z[0]), roofY(f, z[1])) - Hg;
    if (z[1] - z[0] < 0.05 || hMin < 0.004) continue;
    for (const [u, r, tint] of sheetLayers(z[0], z[1], o.tint, [LINER, LINER_RIB])) {
      if (Math.min(roofY(f, u[0]), roofY(f, u[1])) - Hg < 0.006) continue;
      d.push(col('metal', u, Hg + 0.001, band(r), tint));
    }
  }
  // one rail across the triangle where it is tall enough
  const yr = Hg + 0.25, half = f.Ze - (yr + 0.07 - Hg) / f.tn - 0.02;
  if (half > 0.5) {
    const q = block('steel', trr(0.062, dep - PROFILE.depth), [yr, yr + 0.065], [-half, half]);
    q.tint = SHED.galv; q.finish = 'galv'; q.density = RHO.rail;
    d.push(q);
  }
  return withDetail(p, d);
}

/* ---------------- roof ---------------- */

export interface RoofOpts {
  tint: number; brace?: boolean; lights?: number[]; group?: string; verge?: ('lo' | 'hi')[];
  /** which part of the slope: from the ridge to the split line, or from it to the eaves (default: all of it) */
  part?: 'upper' | 'lower'; split?: number;
}

/** Where a slope is split into two roof bodies: between the purlins either side of the rafter splice, so the roof can
    fold with the frame at the haunch toe instead of propping it as one plate. Returned as distance down the slope. */
export function roofSplit(f: FrameDims): number {
  const P = purlinLines(f), b = spliceZ(f) / f.cs;
  for (let i = 0; i + 1 < P.length; i++) if (P[i] + 0.07 < b + 0.3 && P[i + 1] > b - 0.3) return (P[i] + 0.07 + P[i + 1]) / 2;
  return (P[P.length - 2] + 0.07 + P[P.length - 1]) / 2;
}
function purlinLines(f: FrameDims): number[] {
  const Bend = (f.Zr - f.tr * f.sn) / f.cs - 0.003;
  const n = Math.max(2, Math.round((Bend - 0.55) / 1.6) + 1);
  return Array.from({ length: n }, (_, i) => 0.3 + ((Bend - 0.55 - 0.3) * i) / (n - 1));
}

/** One roof slope (or the upper / lower part of it) over the bay x in `xr` on side `s`: a sloped hull from the ridge
    (plumb joint on z = 0) to the eaves edge over the gutter, carrying end-bay bracing, Z purlins on cleats, profiled
    sheets running down the slope (backing coat underneath), translucent GRP roof lights, the ridge flashing, the
    eaves filler over the wall head and verge flashings at the gables. */
export function roofSlope(f: FrameDims, xr: Range, s: 1 | -1, o: RoofOpts): PieceSpec {
  const { sn, cs, yR, tr, Zr } = f;
  const at = (a: number, b: number, c: number): Vec3 => [snap(a), snap(yR - b * sn + c * cs), snap(s * (b * cs + c * sn))];
  const bmax = (c: number) => (Zr - c * sn) / cs, bmin = (c: number) => -c * sn / cs;
  const split = o.split ?? roofSplit(f);
  const upper = o.part !== 'lower', lower = o.part !== 'upper';
  const b0 = (c: number) => (upper ? bmin(c) : split), b1 = (c: number) => (lower ? bmax(c) : split);
  const env: Vec3[] = [];
  for (const a of xr) for (const c of [0, tr]) env.push(at(a, b0(c), c), at(a, b1(c), c));
  const p = hull('metal', env, { tint: o.tint, group: o.group });
  const d: PieceSpec[] = [];
  const unit = (mat: MaterialId, a: Range, b: Range, c: Range, tint: number, finish: PieceSpec['finish'] | undefined, dens: number) => {
    const q: Vec3[] = [];
    for (const aa of a) for (const bb of b) for (const cc of c) q.push(at(aa, bb, cc));
    const u = hull(mat, q);
    u.tint = tint;
    u.density = dens;
    if (finish) u.finish = finish;
    d.push(u);
  };
  const Bend = bmax(tr) - 0.003, vw = 0.13;
  // the slope's own extent down the slope (clear of the split joint by a millimetre)
  const Blo = upper ? 0 : split + 0.001, Bhi = lower ? Bend : split - 0.001;
  const lo = o.verge?.includes('lo'), hi = o.verge?.includes('hi');
  const A: Range = [xr[0] + (lo ? vw : 0.002), xr[1] - (hi ? vw : 0.002)];
  // verge flashing: a folded trim over the gable end of the build-up, closing off the purlin ends and sheet edges
  for (const va of [lo ? [xr[0] + 0.002, xr[0] + vw - 0.001] : null, hi ? [xr[1] - vw + 0.001, xr[1] - 0.002] : null]) {
    if (!va) continue;
    const q: Vec3[] = [];
    for (const aa of va) for (const cc of [0.001, tr - 0.0005]) q.push(at(aa, upper ? bmin(cc) + 0.0005 : split + 0.001, cc), at(aa, lower ? bmax(cc) - 0.003 : split - 0.001, cc));
    const v = hull('metal', q); v.tint = SHED.trim; v.finish = 'paint'; v.density = RHO.trim;
    d.push(v);
  }
  // bracing in the plane just over the rafter flanges, an X in each part of an end bay
  if (o.brace) {
    const r0 = upper ? 0.4 : split + 0.15, r1 = lower ? Bend - 0.55 : split - 0.15, m = 0.15;
    const bar = (p0: [number, number], p1: [number, number], c: Range) => {
      const da = p1[0] - p0[0], db = p1[1] - p0[1], l = Math.hypot(da, db), na = (-db / l) * 0.025, nb = (da / l) * 0.025;
      const q: Vec3[] = [];
      for (const [aa, bb] of [[p0[0] + na, p0[1] + nb], [p0[0] - na, p0[1] - nb], [p1[0] + na, p1[1] + nb], [p1[0] - na, p1[1] - nb]]) for (const cc of c) q.push(at(aa, bb, cc));
      const u = hull('steel', q);
      u.tint = SHED.steel;
      u.density = RHO.rod;
      d.push(u);
    };
    if (r1 - r0 > 0.8) {
      bar([A[0] + m, r0], [A[1] - m, r1], [0.001, 0.029]);
      bar([A[0] + m, r1], [A[1] - m, r0], [0.031, 0.059]);
    }
  }
  // Z purlins at ~1.6 m down the slope, the first under the ridge flashing, the last over the eaves
  const purl: Range = [0.062, tr - PROFILE.depth];
  for (const b of purlinLines(f)) if (b >= Blo && b + 0.07 <= Bhi) unit('steel', A, [b, b + 0.07], purl, SHED.galv, 'galv', RHO.rail);
  const cb = (r: Range): Range => [tr - r[1], tr - r[0] - (r[0] === 0 ? 0.0005 : 0)];
  if (upper) {
    const rq: Vec3[] = [];
    for (const aa of A) for (const cc of [tr - PROFILE.back[1], tr - 0.0005]) rq.push(at(aa, bmin(cc) + 0.0005, cc), at(aa, 0.25, cc));
    const ridge = hull('metal', rq);
    ridge.tint = SHED.trim; ridge.finish = 'paint'; ridge.density = RHO.trim;
    d.push(ridge);
  }
  if (lower) unit('steel', A, [Bend - 0.475, Bend - 0.002], [0.001, tr - PROFILE.depth], SHED.trim, 'paint', RHO.strut);
  // sheets down the slope: troughs, crowns and the backing coat; roof lights are whole GRP sheets (no backing)
  const lights = new Set(o.lights ?? []);
  const sb: Range = [Math.max(0.2505, Blo), Bhi];
  if (sb[1] - sb[0] > 0.05) {
    let k = 0;
    for (let a = A[0]; a < A[1] - 0.05; a += 1.0, k++) {
      const sa: Range = [a, Math.min(a + 1.0, A[1])];
      const lit = lights.has(k);
      // a roof light is a whole GRP sheet, the same profile with no backing coat: pale and opaque (no translucent
      // material exists), weighing as GRP
      for (const [u, r, tint] of sheetLayers(sa[0], sa[1], lit ? SHED.rooflight : o.tint, lit ? null : [ROOF_LINER, ROOF_RIB], false)) {
        unit('metal', u, sb, cb(r), tint, 'paint', lit ? RHO.light : RHO.sheet);
      }
    }
  }
  return withDetail(p, d);
}

/* ---------------- doors, gutters ---------------- */

/** Roller shutter curtain in a wall opening (u × y, in the wall's thickness band t): 75 mm laths, a bottom rail and
    the side guides, one body welded to the jambs and head. */
export function shutter(alongX: boolean, u: Range, y: Range, t: Range, o: { tint: number; group?: string }): PieceSpec {
  const cell = (mat: MaterialId, uu: Range, yy: Range, tt: Range, tint: number, finish: PieceSpec['finish'] = 'paint'): PieceSpec => {
    const q = alongX ? block(mat, uu, yy, tt) : block(mat, tt, yy, uu);
    q.tint = tint; q.finish = finish;
    return q;
  };
  const p = cell('metal', u, y, t, o.tint);
  if (o.group) p.group = o.group;
  const d: PieceSpec[] = [];
  const g = 0.06, tm = (t[0] + t[1]) / 2;
  d.push(cell('steel', [u[0], u[0] + g], y, t, SHED.galv, 'galv'), cell('steel', [u[1] - g, u[1]], y, t, SHED.galv, 'galv'));
  const L: Range = [u[0] + g, u[1] - g];
  d.push(cell('aluminum', L, [y[0], y[0] + 0.08], t, 0x9aa0a4));
  for (let yy = y[0] + 0.08; yy < y[1] - 0.01; yy += 0.075) {
    const top = Math.min(yy + 0.075, y[1]);
    d.push(rho(cell('metal', L, [yy, top - 0.006], [tm - 0.02, tm + 0.02], o.tint), RHO.lath));
    d.push(rho(cell('metal', L, [top - 0.006, top], [tm - 0.008, tm + 0.008], shade(o.tint, 0.7)), RHO.lath));
  }
  return withDetail(p, d);
}

/** Box gutter along the eaves on side `s`, from x0 to x1: sole and two cheeks as units. */
export function gutter(f: FrameDims, x: Range, s: 1 | -1, group?: string): PieceSpec {
  const z0 = s * f.Ze, z1 = s * (f.Ze + 0.18), zr: Range = [Math.min(z0, z1), Math.max(z0, z1)], y: Range = [f.Hg - 0.2, f.Hg - 0.03];
  const p = block('metal', x, y, zr, { tint: SHED.gutter, group });
  const q = (zz: Range, yy: Range) => { const b = block('metal', x, yy, zz); b.tint = SHED.gutter; b.finish = 'paint'; return b; };
  const zi: Range = s > 0 ? [zr[0], zr[0] + 0.013] : [zr[1] - 0.013, zr[1]], zo: Range = s > 0 ? [zr[1] - 0.013, zr[1]] : [zr[0], zr[0] + 0.013];
  return withDetail(p, [q(zi, y), q(zo, y), q([zr[0] + 0.0135, zr[1] - 0.0135], [y[0], y[0] + 0.013])].map((u) => rho(u, RHO.sheet)));
}

export interface WallPanel { u: Range; y: Range; full: boolean }

/** Wall panels along [from, to], breaking at the frame lines and the door openings ([centre, width, height] from the
    floor): full-height panels between, a head panel over each opening. */
export function wallPanels(from: number, to: number, lines: number[], doors: [number, number, number][], top: number, maxW: number): WallPanel[] {
  const cuts = new Set<number>([from, to]);
  for (const l of lines) if (l > from + 0.3 && l < to - 0.3) cuts.add(l);
  for (const [c, w] of doors) { cuts.add(c - w / 2); cuts.add(c + w / 2); }
  const xs = [...cuts].sort((a, b) => a - b);
  for (const [c, w] of doors) for (let i = xs.length - 1; i >= 0; i--) if (xs[i] > c - w / 2 + 1e-6 && xs[i] < c + w / 2 - 1e-6) xs.splice(i, 1);
  const out: WallPanel[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const u: Range = [xs[i], xs[i + 1]];
    if (u[1] - u[0] < 1e-6) continue;
    const door = doors.find(([c, w]) => u[0] >= c - w / 2 - 1e-6 && u[1] <= c + w / 2 + 1e-6);
    if (door) out.push({ u, y: [door[2], top], full: false });
    else for (const r of splitRange(u[0], u[1], maxW)) out.push({ u: r, y: [0, top], full: true });
  }
  return out;
}
