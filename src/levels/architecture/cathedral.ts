import type { PieceSpec, Vec3 } from '../../types.ts';
import { block, chamfer, cyl, extrude, hollowStack, hull, pitchedRoof, prism, ringCourse, splitRange, wallRun, weldParts, type PieceOpts, type Range, type WallRunOpts } from '../kit.ts';
import { roofDetail, withDetail } from '../layers.ts';
import { band } from '../facade.ts';
import { fit, pew } from '../interior.ts';
import { conduit, lamp, LIGHT, supplyBox } from '../services.ts';
import { TINT } from '../structures.ts';
import { ashlar, finish, type Placement } from './common.ts';

/* Gothic nave church. Six bays of clustered stone piers carry pointed arcade arches (radiating voussoirs, a keystone,
   spandrels cut to the extrados) under a clerestory; over the nave a quadripartite rib vault of stone web courses
   meeting on the groins, with transverse ribs at the bay lines and the diagonal ribs worked on the courses; a
   steep slated roof on oak trusses above it. Lean-to aisles are braced by buttresses whose flyers carry the vault's
   thrust across the aisle roofs to the clerestory. A west tower (belfry with three bells hung on their headstocks)
   carries a broach spire to 64 m. Nave axis along Z, west front toward +Z. */

const LIME = 0xd9d0bc, DARK = 0xb9ae98, SLATE = 0x5f656e, OAK = 0x6e5238;
/* bay lines from the west wall's inner face eastward; set per build from the bay count */
let ZB: number[] = [];
const ZE = (): number => ZB[ZB.length - 1];
const XI = 5, XO = 6, XA: Range = [10.6, 11.5], END_W = 1.2;
const PIER_TOP = 8, CAP = 8.6, CAPW = 0.95, RISE = 4.0, RING = 0.6, LEVEL = 13.4, CLER_TOP = 22.5;
/* vault: springing, height to the crown, web thickness, stations per half-span */
const YS = 15.5, VH = 6, WEB = 0.25, NS = 3, FL = 0.3;
const STAINED = [0xb8342c, 0x2f4fa8, 0xd8a838, 0x3f8a52, 0x7a3f8f, 0xc8c2b0];

type P2 = [number, number];

/* ---------------- arcade ---------------- */

/** Two-centred pointed arch from u = a to u = b springing at ys: convex (u, y) polygons for its voussoirs, keystone
    and the spandrel slices above the extrados up to the level course at yt. */
function pointedArch(a: number, b: number, ys: number, rise: number, d: number, yt: number, nv = 3): P2[][] {
  const s = b - a, r = (s * s / 4 + rise * rise) / s, cl = a + r, m = (a + b) / 2;
  const ta = Math.acos((s / 2 - r) / r);
  const I = (t: number): P2 => [cl + r * Math.cos(t), ys + r * Math.sin(t)];
  const E = (t: number): P2 => [cl + (r + d) * Math.cos(t), ys + (r + d) * Math.sin(t)];
  const th = (i: number) => Math.PI - (i * (Math.PI - ta)) / nv;
  const left: P2[][] = [];
  for (let i = 0; i < nv; i++) {
    left.push([I(th(i)), I(th(i + 1)), E(th(i + 1)), E(th(i))]);
    left.push([E(th(i)), E(th(i + 1)), [E(th(i + 1))[0], yt], [E(th(i))[0], yt]]);
  }
  const mir = (pg: P2[]): P2[] => pg.map(([u, y]) => [a + b - u, y] as P2);
  const ek = E(ta);
  const key: P2[] = [[m, ys + rise], ek, [ek[0], yt], [a + b - ek[0], yt], [a + b - ek[0], ek[1]]];
  return [...left, ...left.map(mir), key];
}

function arcade(o: PieceOpts): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const pier = (x: number, z: number): PieceSpec[] => {
    const shafts = (y: Range) => weldParts([
      block('stone', [x - 0.5, x + 0.5], y, [z - 0.5, z + 0.5], o),
      ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => cyl('stone', 0.44, y, x + dx * 0.715, z + dz * 0.715, o)),
    ]);
    return [shafts([0, 4]), shafts([4, PIER_TOP]), chamfer('stone', [x - CAPW, x + CAPW], [PIER_TOP, CAP], [z - CAPW, z + CAPW], 0.12, o, 'top')];
  };
  for (const s of [-1, 1]) {
    const x = s * (XI + XO) / 2, xr: Range = s > 0 ? [XI, XO] : [-XO, -XI];
    for (let k = 1; k < ZB.length - 1; k++) ps.push(...pier(x, ZB[k]));
    // responds against the end walls
    ps.push(block('stone', xr, [0, CAP], [ZB[0] - CAPW, ZB[0]], o), block('stone', xr, [0, CAP], [ZE(), ZE() + CAPW], o));
    for (let k = 0; k + 1 < ZB.length; k++) {
      const a = ZB[k + 1] + CAPW, b = ZB[k] - CAPW;
      for (const pg of pointedArch(a, b, CAP, RISE, RING, LEVEL)) ps.push(extrude('stone', pg, 'x', xr, { ...o, tint: DARK }));
      // pier-top slice between the springers of neighbouring arches (and against the end walls)
      const hi = a - RING, lo = k + 2 === ZB.length ? ZE() : hi - 2 * (CAPW - RING);
      if (hi - lo > 0.05) ps.push(block('stone', xr, [CAP, LEVEL], [lo, hi], { ...o, tint: DARK }));
      if (k === 0) ps.push(block('stone', xr, [CAP, LEVEL], [b + RING, ZB[0]], { ...o, tint: DARK }));
    }
  }
  return ps;
}

/* ---------------- vault ---------------- */

/* normalised two-centred pointed profile: phi(0) = 1 at the crown, phi(1) = 0 at the springing */
const PR = (1 + 1.2 * 1.2) / 2;
const phi = (u: number) => Math.sqrt(Math.max(0, PR * PR - (Math.min(1, u) - (1 - PR)) ** 2)) / 1.2;
const vy = (u: number) => YS + VH * phi(u);

function vault(): PieceSpec[] {
  const ps: PieceSpec[] = [], o = { tint: LIME };
  const st = Array.from({ length: 2 * NS + 1 }, (_, i) => -1 + i / NS);   // -1 .. 1 in steps of 1/NS
  for (let k = 0; k + 1 < ZB.length; k++) {
    const zm = (ZB[k] + ZB[k + 1]) / 2, hz = (ZB[k] - ZB[k + 1]) / 2;
    for (let i = 0; i + 1 < st.length; i++) {
      const u0 = st[i], u1 = st[i + 1], inner = Math.max(Math.abs(u0), Math.abs(u1)) < 1 - 1e-9;
      // main-barrel courses: across X, from each bay line in to the groins
      for (const sg of [-1, 1]) {
        const ze = zm + sg * hz, g = (u: number) => zm + sg * hz * Math.abs(u), pts: Vec3[] = [];
        for (const u of [u0, u1]) for (const zz of [ze, g(u)]) for (const t of [0, WEB]) pts.push([u * XI, vy(Math.abs(u)) + t, zz]);
        const course = hull('stone', pts, o);
        if (!inner) { ps.push(course); continue; }
        const rib: Vec3[] = [];
        for (const u of [u0, u1]) {
          const y = vy(Math.abs(u)), x = u * XI;
          rib.push([x, y, g(u)], [x, y, g(u) + sg * 0.2], [x, y - 0.3, g(u)], [x, y - 0.15, g(u) + sg * 0.2]);
        }
        ps.push(weldParts([course, hull('stone', rib, o)]));
      }
      // cross-barrel courses: across Z, from each clerestory wall in to the groins
      for (const sg of [-1, 1]) {
        const xw = sg * XI, xg = (u: number) => sg * XI * Math.abs(u), pts: Vec3[] = [];
        for (const u of [u0, u1]) for (const xx of [xw, xg(u)]) for (const t of [0, WEB]) pts.push([xx, vy(Math.abs(u)) + t, zm + u * hz]);
        const course = hull('stone', pts, o);
        if (!inner) { ps.push(course); continue; }
        const rib: Vec3[] = [];
        for (const u of [u0, u1]) {
          const y = vy(Math.abs(u)), z = zm + u * hz;
          rib.push([xg(u), y, z], [xg(u) + sg * 0.2, y, z], [xg(u), y - 0.3, z], [xg(u) + sg * 0.2, y - 0.15, z]);
        }
        ps.push(weldParts([course, hull('stone', rib, o)]));
      }
    }
  }
  // transverse ribs on the bay lines, wall ribs against the end walls
  for (let k = 0; k < ZB.length; k++) {
    const zr: Range = k === 0 ? [ZB[0] - 0.3, ZB[0]] : k === ZB.length - 1 ? [ZB[k], ZB[k] + 0.3] : [ZB[k] - 0.2, ZB[k] + 0.2];
    for (let i = 0; i + 1 < st.length; i++) {
      const pts: Vec3[] = [];
      for (const u of [st[i], st[i + 1]]) for (const zz of zr) pts.push([u * XI, vy(Math.abs(u)), zz], [u * XI, vy(Math.abs(u)) - 0.45, zz]);
      ps.push(hull('stone', pts, { tint: DARK }));
    }
  }
  return ps;
}

/* ---------------- walls ---------------- */

/** Leaded lights: coloured quarries in lead cames as detail on each pane. */
function leaded(p: PieceSpec, seed: number): PieceSpec {
  const [sx, sy, sz] = p.size, alongX = sx >= sz, uk = alongX ? 0 : 2, tk = alongX ? 2 : 0;
  const U: Range = [p.pos[uk] - p.size[uk] / 2, p.pos[uk] + p.size[uk] / 2], Y: Range = [p.pos[1] - sy / 2, p.pos[1] + sy / 2];
  const T: Range = [p.pos[tk] - p.size[tk] / 2 + 0.004, p.pos[tk] + p.size[tk] / 2 - 0.004];
  const cell = (mat: 'glass' | 'metal', u: Range, y: Range, tint: number): PieceSpec => {
    const x: Range = alongX ? u : T, z: Range = alongX ? T : u;
    return block(mat, x, y, z, { tint });
  };
  const nu = Math.max(1, Math.round((U[1] - U[0]) / 0.32)), nv = Math.max(1, Math.round((Y[1] - Y[0]) / 0.42)), c = 0.012;
  const du = (U[1] - U[0]) / nu, dv = (Y[1] - Y[0]) / nv, units: PieceSpec[] = [];
  for (let j = 0; j < nv; j++) {
    const y0 = Y[0] + j * dv, y1 = y0 + dv;
    if (j > 0) units.push(cell('metal', U, [y0, y0 + c], 0x2b2b2b));
    for (let i = 0; i < nu; i++) {
      const u0 = U[0] + i * du, u1 = u0 + du;
      if (i > 0) units.push(cell('metal', [u0, u0 + c], [y0 + (j > 0 ? c : 0), y1], 0x2b2b2b));
      units.push(cell('glass', [u0 + (i > 0 ? c : 0), u1], [y0 + (j > 0 ? c : 0), y1], STAINED[(i * 7 + j * 3 + seed) % STAINED.length]));
    }
  }
  return withDetail({ ...p, tint: STAINED[seed % STAINED.length] }, units);
}

function walls(o: PieceOpts): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const run = (w: Partial<WallRunOpts> & { from: number; to: number; at: number; y0: number; h: number; t: number }) =>
    wallRun({ mat: 'stone', maxW: 3.3, sill: 'stone', lintel: 'stone', lintelH: 0.3, mullion: 'stone', ...o, ...w } as WallRunOpts);
  const mids = ZB.slice(0, -1).map((z, k) => (z + ZB[k + 1]) / 2);
  for (const s of [-1, 1] as const) {
    // clerestory on the arcade's level course, a lancet pair in each bay's lunette
    ps.push(...run({ axis: 'z', from: ZE(), to: ZB[0], at: s * (XI + XO) / 2, t: XO - XI, out: s, y0: LEVEL, h: CLER_TOP - LEVEL, openings: mids.map((c) => ({ c, w: 1.8, y0: 3.0, h: 3.9 })) }));
    // aisle walls: tall two-light windows, a door in the westernmost bay of the north aisle
    ps.push(...run({ axis: 'z', from: ZE(), to: ZB[0], at: s * (XA[0] + XA[1]) / 2, t: XA[1] - XA[0], out: s, y0: 0, h: 9.5,
      openings: mids.map((c, k) => (s < 0 && k === 0 ? { c, w: 1.8, y0: FL, h: 3.6, glass: false } : { c, w: 2.2, y0: 2.2, h: 5.0 })) }));
  }
  // end walls: the west (behind the tower) with its door; the east with a three-light window over the altar
  const aisleW = (z: number, out: 1 | -1, door: boolean) => [
    ...run({ from: -XA[1], to: -XO, at: z, t: END_W, out, y0: 0, h: 9.5, openings: [{ c: -8.3, w: 1.8, y0: 2.4, h: 4.6 }] }),
    ...run({ from: XO, to: XA[1], at: z, t: END_W, out, y0: 0, h: 9.5, openings: [{ c: 8.3, w: 1.8, y0: 2.4, h: 4.6 }] }),
    ...run({ from: -XO, to: XO, at: z, t: END_W, out, y0: 0, h: 9.5, openings: door ? [{ c: 0, w: 2.2, y0: FL, h: 4.4, glass: false }] : [] }),
  ];
  ps.push(...aisleW(ZB[0] + END_W / 2, 1, true), ...aisleW(ZE() - END_W / 2, -1, false));
  ps.push(...run({ from: -XO, to: XO, at: ZB[0] + END_W / 2, t: END_W, out: 1, y0: 9.5, h: CLER_TOP - 9.5 }));
  ps.push(...run({ from: -XO, to: XO, at: ZE() - END_W / 2, t: END_W, out: -1, y0: 9.5, h: CLER_TOP - 9.5, mullion: undefined,
    openings: [-1.9, 0, 1.9].map((c) => ({ c, w: 1.5, y0: 1.0, h: 9.0 })) }));
  let n = 0;
  return ps.map((q) => (q.mat === 'glass' ? leaded(q, n++) : q));
}

/** Aisle lean-to roofs, stepped buttresses at the bay lines with pinnacles, and flyers to the clerestory. */
function aislesAndButtresses(o: PieceOpts): PieceSpec[] {
  const ps: PieceSpec[] = [];
  for (const s of [-1, 1]) {
    const X = (x: number) => s * x;
    for (let k = 0; k + 1 < ZB.length; k++) {
      const z: Range = [ZB[k + 1], ZB[k]];
      const pr: P2[] = [[X(XA[1]), 9.5], [X(XA[1] - 0.3), 9.5], [X(XO), 12.6], [X(XO), 12.95], [X(XA[1]), 9.85]];
      ps.push(roofDetail(extrude('roof', pr, 'z', z, { tint: SLATE }), { tile: 'slate' }));
    }
    for (let k = 0; k < ZB.length; k++) {
      const zr: Range = k === 0 ? [ZB[0], ZB[0] + 1.0] : k === ZB.length - 1 ? [ZE() - 1.0, ZE()] : [ZB[k] - 0.5, ZB[k] + 0.5];
      const xs = (a: number, b: number): Range => (s > 0 ? [a, b] : [-b, -a]);
      ps.push(block('stone', xs(XA[1], XA[1] + 2.2), [0, 6.5], zr, o), block('stone', xs(XA[1], XA[1] + 1.6), [6.5, 14.5], zr, o));
      ps.push(prism('stone', 0.7, [14.5, 17.8], X(XA[1] + 1.2), (zr[0] + zr[1]) / 2, 8, o));
      if (k === 0 || k === ZB.length - 1) continue;
      // flyer: two voussoir-like hulls from the buttress head to the clerestory face, a straight coping above
      const fz: Range = [ZB[k] - 0.3, ZB[k] + 0.3], xm = 8.9;
      const yTop = (x: number) => 15.3 + (18.4 - 15.3) * (XA[1] + 0.8 - x) / (XA[1] + 0.8 - XO);
      ps.push(extrude('stone', [[X(XA[1] + 0.8), 14.5], [X(XA[1]), 14.5], [X(xm), 16.3], [X(xm), yTop(xm)], [X(XA[1] + 0.8), yTop(XA[1] + 0.8)]], 'z', fz, o));
      ps.push(extrude('stone', [[X(xm), 16.3], [X(XO), 16.9], [X(XO), yTop(XO)], [X(xm), yTop(xm)]], 'z', fz, o));
    }
  }
  return ps;
}

/* ---------------- roof ---------------- */

function naveRoof(): PieceSpec[] {
  const ps = pitchedRoof({ mat: 'roof', x: [ZE() - END_W, ZB[0] + END_W], z: [-XO, XO], y: CLER_TOP, rise: 8, thick: 0.5, seat: 0.25, maxW: 4.4, tint: SLATE, axis: 'z',
    gables: { mat: 'stone', x: [[ZE() - END_W, ZE()], [ZB[0], ZB[0] + END_W]], tint: LIME } }).map((q) => (q.mat === 'roof' && q.size[1] > 1 ? roofDetail(q, { tile: 'slate' }) : q));
  const k = 8 / (XO - 0.25), under = (d: number) => CLER_TOP + k * (XO - 0.25 - d), oak = { tint: OAK };
  const zs = [...ZB.slice(1, -1), ...ZB.slice(0, -1).map((z, i) => (z + ZB[i + 1]) / 2)];
  for (const z of zs) {
    const zr: Range = [z - 0.12, z + 0.12];
    ps.push(block('oak', [-XI, XI], [CLER_TOP - 0.4, CLER_TOP], [z - 0.15, z + 0.15], oak));
    ps.push(block('oak', [-0.12, 0.12], [CLER_TOP, under(0.12)], zr, oak));
    for (const s of [-1, 1]) ps.push(extrude('oak', [[s * XI, CLER_TOP], [s * XI, under(XI)], [s * 0.12, under(0.12)], [s * 0.12, under(0.12) - 0.4]], 'z', zr, oak));
  }
  return ps;
}

/* ---------------- tower and spire ---------------- */

function tower(o: PieceOpts): PieceSpec[] {
  // an 80 mm movement joint (clear of the core's AABB margins): the tower is its own structure, not bonded to the nave it stands against
  const z0 = ZB[0] + END_W + 0.08, a = 4.5, t = 1.2, cz = z0 + a, ps: PieceSpec[] = [];
  const run = (w: Partial<WallRunOpts> & { from: number; to: number; at: number }) =>
    wallRun({ mat: 'stone', t, y0: 0, h: 9, maxW: 3.3, lintel: 'stone', lintelH: 0.45, ...o, ...w } as WallRunOpts);
  ps.push(...run({ from: -a, to: a, at: z0 + 2 * a - t / 2, out: 1, openings: [{ c: 0, w: 2.4, y0: 0, h: 5.2, glass: false }] }));
  ps.push(...run({ from: -a, to: a, at: z0 + t / 2, out: -1, openings: [{ c: 0, w: 2.2, y0: FL, h: 4.4, glass: false }] }));
  for (const s of [-1, 1] as const) ps.push(...run({ axis: 'z', from: z0 + t, to: z0 + 2 * a - t, at: s * (a - t / 2), out: s, openings: [{ c: cz, w: 1.0, y0: 4.5, h: 2.8 }] }));
  ps.push(...hollowStack('stone', 0, cz, 9, 2 * a, t, 3, 5, o));
  // belfry: corner piers, lintels, louvres; bell beams between the piers
  const cr = (c: number, s: number, w = 2.2): Range => (s > 0 ? [c + a - w, c + a] : [c - a, c - a + w]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(block('stone', cr(0, sx), [24, 30], cr(cz, sz), o));
  const gap: Range = [-a + 2.2, a - 2.2], gz: Range = [cz - a + 2.2, cz + a - 2.2];
  for (const s of [-1, 1]) {
    const zf: Range = s > 0 ? [cz + a - t, cz + a] : [cz - a, cz - a + t], xf: Range = s > 0 ? [a - t, a] : [-a, -a + t];
    ps.push(block('stone', gap, [29.2, 30], zf, o), block('stone', xf, [29.2, 30], gz, o));
    for (const y of [25.2, 26.5, 27.8]) {
      ps.push(block('wood', gap, [y, y + 0.9], [zf[0] + 0.5, zf[0] + 0.58], { tint: OAK }), block('wood', [xf[0] + 0.5, xf[0] + 0.58], [y, y + 0.9], gz, { tint: OAK }));
    }
  }
  const beams: [number, number[], number[]][] = [[cz - a + 1.8, [-1.15, 1.15], [0.9, 0.9]], [cz + a - 1.8, [0], [1.3]]];
  for (const [zb, xs, ds] of beams) {
    ps.push(block('oak', gap, [27.6, 28.0], [zb - 0.2, zb + 0.2], { tint: OAK }));
    xs.forEach((x, i) => ps.push(bell(x, 27.52, zb, ds[i])));
  }
  ps.push(...hollowStack('stone', 0, cz, 30, 2 * a, 1.6, 0.8, 1, { tint: DARK }), ...hollowStack('stone', 0, cz, 30.8, 2 * a, 0.5, 1.2, 1, o));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(prism('stone', 0.7, [32, 35.5], sx * (a - 0.15), cz + sz * (a - 0.15), 8, o));
  // octagonal broach spire in tapering courses, solid at the tip, finial and weathercock
  const R0 = 3.6, top = 62, y0 = 30.8, nc = 8;
  const rad = (y: number) => R0 + (0.12 - R0) * (y - y0) / (top - y0), wall = (y: number) => 0.5 - 0.3 * (y - y0) / (top - y0);
  for (let i = 0; i < nc; i++) {
    const ya = y0 + (i * (top - y0)) / nc, yb = y0 + ((i + 1) * (top - y0)) / nc, last = i === nc - 1;
    ps.push(...ringCourse('stone', 0, cz, [ya, yb], [rad(ya) - wall(ya), last ? 0 : rad(yb) - wall(yb)], [rad(ya), rad(yb)], 8, { tint: DARK }, Math.PI / 8));
  }
  ps.push(prism('steel', 0.12, [top, top + 2.2], 0, cz, 8, { tint: 0xb08d3c }), block('copper', [-0.4, 0.4], [top + 2.2, top + 2.5], [cz - 0.05, cz + 0.05], { tint: 0xb08d3c }));
  return ps;
}

/** Bronze bell hung by its headstock from a bell beam, free to swing about the beam's axis. */
function bell(x: number, yTop: number, z: number, d: number): PieceSpec {
  const pts: Vec3[] = [], h = d * 0.8;
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / 12, c = Math.cos(a), s = Math.sin(a);
    pts.push([x + (d / 2) * c, yTop - h, z + (d / 2) * s], [x + d * 0.33 * c, yTop - h * 0.55, z + d * 0.33 * s], [x + d * 0.27 * c, yTop, z + d * 0.27 * s]);
  }
  const b = hull('copper', pts, { tint: 0x8c6a2c, noWeld: true });
  b.density = 1600;   // bell bronze in a hollow cup (the hull is solid)
  b.mech = { kind: 'hinge', at: [x, yTop + 0.28, z], axis: [0, 0, 1] };
  return b;
}

/* ---------------- floor and furnishings ---------------- */

function interior(): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const flags = (x: Range, z: Range) => {
    const u: PieceSpec[] = [];
    for (const a of splitRange(x[0], x[1], 0.6)) for (const b of splitRange(z[0], z[1], 0.6)) u.push(block('stone', [a[0] + 0.003, a[1] - 0.003], [FL - 0.04, FL], [b[0] + 0.003, b[1] - 0.003], { tint: ((a[0] * 5 + b[0] * 3) | 0) & 1 ? 0xcfc6b2 : 0xbdb39e }));
    return withDetail(block('stone', x, [0, FL], z, { tint: 0xc4bba7 }), u);
  };
  // a 0.3 m flagged floor on hardcore, in bay-sized pieces (thin slabs pinched under falling masonry get shot out)
  for (const z of splitRange(ZE(), ZB[0], 6.5)) {
    for (const x of [[-4.4, 0], [0, 4.4]] as Range[]) ps.push(flags(x, z));
    for (const s of [-1, 1]) ps.push(flags(s > 0 ? [XO + 0.6, XA[0]] : [-XA[0], -XO - 0.6], z));
  }
  for (let k = 0; k + 1 < ZB.length; k++) {
    const z: Range = [ZB[k + 1] + CAPW, ZB[k] - CAPW];
    for (const x of [[4.4, XO + 0.6], [-XO - 0.6, -4.4]] as Range[]) ps.push(flags(x, z));
  }
  for (let z = 14.5; z >= ZE() + 13; z -= 2.05) for (const x of [-2.55, 2.55]) ps.push(...fit(pew(3.4), x, z, FL, 0));
  // chancel step, altar, font by the door
  ps.push(block('stone', [-4.4, 4.4], [FL, FL + 0.18], [ZE() + 0.01, ZE() + 4.5], { tint: 0xd8d0bf }), block('marble', [-1.4, 1.4], [FL + 0.18, FL + 1.18], [ZE() + 0.1, ZE() + 1.0], { tint: 0xf1ede4 }));
  ps.push(prism('stone', 0.8, [FL, FL + 0.95], -3.0, 16.2, 8, { tint: LIME }));
  // wall lanterns on a conduit along each aisle wall above the windows, fed from a box by the west door
  ps.push(supplyBox([-XA[0], -XA[0] + 0.25], [1.2, 2.0], [16.4, 17.0]), ...conduit([[-XA[0] + 0.12, 2.0, 16.7], [-XA[0] + 0.12, 8.2, 16.7], [-XA[0] + 0.12, 8.2, ZB[ZB.length - 2] - 0.1]]));
  for (let k = 1; k < ZB.length - 1; k++) ps.push(lamp([-XA[0], -XA[0] + 0.3], [7.76, 8.16], [ZB[k] - 0.15, ZB[k] + 0.15], LIGHT.candle));
  return ps;
}

/** Gothic church: six-bay (or `bays`) vaulted nave with aisles and flying buttresses, west tower and spire (front +Z). */
export function cathedral(p: Placement & { bays?: number }): PieceSpec[] {
  ZB = Array.from({ length: (p.bays ?? 6) + 1 }, (_, i) => 18 - 6.5 * i);
  const o = { tint: LIME };
  const masonry = ashlar([...walls(o), ...arcade(o), ...aislesAndButtresses(o), ...tower(o)], [0, 0], { maxUnits: 2600 });
  const ps = [...masonry, ...vault(), ...naveRoof(), ...interior()];
  return finish(ps, p, 'cathedral', { years: 160, exposure: 'outdoor' });
}
