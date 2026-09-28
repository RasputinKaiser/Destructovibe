import type { PieceSpec, Vec3 } from '../../types.ts';
import { block, hull, prism, splitRange, type Range } from '../kit.ts';
import { boards, floorSlab, rcSlab, wallSlab, withDetail } from '../layers.ts';
import { fit, shelving } from '../interior.ts';
import { lamp, LIGHT, supplyBox } from '../services.ts';
import { finish, unit, sub, type Placement } from './common.ts';

/* 1930s Art Deco department store. A reinforced-concrete frame — perimeter piers and mushroom-headed interior
   columns carrying flat slabs — clad in Portland stone: the piers run unbroken to a stepped parapet, the windows
   (steel-framed, Crittall pattern) sit recessed between them over stone-faced spandrels. Bronze shopfronts with
   granite stallrisers and a steel-and-glass marquee along the ground floor; a 12 m atrium through all four sales
   floors under a glazed lantern, with a pair of escalators (moving step bands on sliders) from the ground floor;
   the corner entrance tower rises two stages above the roof under a ziggurat crown with a lit sign fin, and a
   lettered sign frame stands on the roof. Front (Main Street) toward +Z. */

const X = 18, Z = 12, PIER = 0.8, INF = 0.3, SL = 0.3;
const LV = [0.3, 5.3, 9.5, 13.7, 17.9, 22.1];
const GX = [-18, -12, -6, 0, 6, 12, 18], GZ = [-12, -6, 0, 6, 12];
const STONE = 0xe8e0cc, RC = 0xc9c6bd, BRONZE = 0x6e5536, GRANITE = 0x3c3a3a, STEEL = 0x2e3438;
const ATRIUM = 6;

type Axis = 'x' | 'z';
/** box on a face: `u` along the face, `w` the thickness range on the other axis */
const B = (mat: PieceSpec['mat'], axis: Axis, u: Range, y: Range, w: Range, tint?: number): PieceSpec =>
  axis === 'x' ? block(mat, u, y, w, { tint }) : block(mat, w, y, u, { tint });

/** An RC member clad in stone on its outer face(s): 75 mm facing slabs on a grid, the concrete behind in cast lifts. */
function clad(p: PieceSpec, faces: { axis: Axis; out: 1 | -1 }[]): PieceSpec {
  const r = (k: number): Range => [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2];
  const units: PieceSpec[] = [];
  const lo = [r(0)[0], r(1)[0], r(2)[0]], hi = [r(0)[1], r(1)[1], r(2)[1]];
  for (const f of faces) {
    const tk = f.axis === 'x' ? 2 : 0, uk = f.axis === 'x' ? 0 : 2;
    const th: Range = f.out > 0 ? [hi[tk] - 0.075, hi[tk]] : [lo[tk], lo[tk] + 0.075];
    units.push(...boards(wallSlab(f.axis, [lo[uk], hi[uk]], r(1), th, f.out), th, 'stone', [0.9, 0.6], 0.004, { tint: STONE }));
    if (f.out > 0) hi[tk] -= 0.075; else lo[tk] += 0.075;
  }
  for (const y of splitRange(lo[1], hi[1], 1.4)) units.push(block('rconcrete', [lo[0], hi[0]], y, [lo[2], hi[2]], { tint: RC }));
  return withDetail({ ...p }, units);
}

/** Steel-framed window: panes in a grid of glazing bars (as detail on the pane). */
function crittall(p: PieceSpec, axis: Axis): PieceSpec {
  const uk = axis === 'x' ? 0 : 2, tk = axis === 'x' ? 2 : 0;
  const U: Range = [p.pos[uk] - p.size[uk] / 2, p.pos[uk] + p.size[uk] / 2], Y: Range = [p.pos[1] - p.size[1] / 2, p.pos[1] + p.size[1] / 2];
  const T: Range = [p.pos[tk] - p.size[tk] / 2 + 0.002, p.pos[tk] + p.size[tk] / 2 - 0.002];
  const nu = Math.max(1, Math.round((U[1] - U[0]) / 0.55)), nv = Math.max(1, Math.round((Y[1] - Y[0]) / 0.62)), bar = 0.03;
  const du = (U[1] - U[0]) / nu, dv = (Y[1] - Y[0]) / nv, units: PieceSpec[] = [];
  for (let j = 0; j < nv; j++) {
    const y0 = Y[0] + j * dv, y1 = y0 + dv;
    if (j > 0) units.push(B('steel', axis, U, [y0, y0 + bar], T, STEEL));
    for (let i = 0; i < nu; i++) {
      const u0 = U[0] + i * du, u1 = u0 + du, yb = y0 + (j > 0 ? bar : 0);
      if (i > 0) units.push(B('steel', axis, [u0, u0 + bar], [yb, y1], T, STEEL));
      units.push(B('glass', axis, [u0 + (i > 0 ? bar : 0), u1], [yb, y1], [T[0] + 0.02, T[1] - 0.02], 0xb9ccd2));
    }
  }
  return withDetail({ ...p }, units);
}

function frame(): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const inAtrium = (x: number, z: number) => Math.abs(x) < ATRIUM - 1e-6 && Math.abs(z) < ATRIUM - 1e-6;
  // raft floor in grid cells, terrazzo on the ground floor
  for (let i = 0; i + 1 < GX.length; i++) for (let j = 0; j + 1 < GZ.length; j++) {
    const x: Range = [GX[i], GX[i + 1]], z: Range = [GZ[j], GZ[j + 1]];
    ps.push({ ...rcSlab(floorSlab(x, z, [0, LV[0]]), { finish: 'tile', finishTint: (i + j) & 1 ? 0xd8cfbf : 0x9c3f36, bay: 3 }), tint: RC });
  }
  for (let k = 0; k < LV.length - 1; k++) {
    const y0 = LV[k], top = LV[k + 1] - SL;
    // interior columns with flared (mushroom) heads under the flat slab
    for (const x of GX.slice(1, -1)) for (const z of GZ.slice(1, -1)) {
      if (inAtrium(x, z)) continue;
      ps.push(prism('rconcrete', 0.55, [y0, top - 0.6], x, z, 16, { tint: RC }));
      ps.push(hull('rconcrete', [...ring(x, z, top - 0.6, 0.3), ...ring(x, z, top, 0.8)], { tint: RC }));
    }
    // flat slab above, round the atrium (the roof over it is the lantern)
    for (let i = 0; i + 1 < GX.length; i++) for (let j = 0; j + 1 < GZ.length; j++) {
      const x: Range = [Math.max(GX[i], -X + PIER), Math.min(GX[i + 1], X - PIER)], z: Range = [Math.max(GZ[j], -Z + PIER), Math.min(GZ[j + 1], Z - PIER)];
      if (inAtrium((GX[i] + GX[i + 1]) / 2, (GZ[j] + GZ[j + 1]) / 2)) continue;
      ps.push({ ...rcSlab(floorSlab(x, z, [top, top + SL]), { finish: k === LV.length - 2 ? 'none' : 'vinyl', finishTint: 0x7d6a58, bay: 2 }), tint: RC });
    }
  }
  return ps;
}

function ring(x: number, z: number, y: number, r: number): Vec3[] {
  return Array.from({ length: 12 }, (_, i) => [x + r * Math.cos((i + 0.5) * Math.PI / 6), y, z + r * Math.sin((i + 0.5) * Math.PI / 6)] as Vec3);
}

/** Piers, recessed spandrels and windows on every face; shopfronts and the entrance on the ground floor. */
function facades(): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const faces: { axis: Axis; s: 1 | -1; grid: number[]; E: number; L: number }[] = [
    { axis: 'x', s: 1, grid: GX, E: Z, L: X }, { axis: 'x', s: -1, grid: GX, E: Z, L: X }, { axis: 'z', s: 1, grid: GZ, E: X, L: Z }, { axis: 'z', s: -1, grid: GZ, E: X, L: Z },
  ];
  for (const f of faces) {
    const wOut: Range = f.s > 0 ? [f.E - PIER, f.E] : [-f.E, -f.E + PIER];
    const wInf: Range = f.s > 0 ? [f.E - PIER, f.E - PIER + INF] : [-f.E + PIER - INF, -f.E + PIER];
    const out = [{ axis: f.axis, out: f.s }];
    const owner = f.axis === 'x';   // the long faces own the corner piers
    const pierU = (g: number): Range | null => (Math.abs(g) < f.L - 1e-6 ? [g - PIER / 2, g + PIER / 2] : owner ? (g > 0 ? [g - PIER, g] : [g, g + PIER]) : null);
    const bayU = (i: number): Range => [f.grid[i] <= -f.L + 1e-6 ? -f.L + PIER : f.grid[i] + PIER / 2, f.grid[i + 1] >= f.L - 1e-6 ? f.L - PIER : f.grid[i + 1] - PIER / 2];
    // the corner tower stands on the front-east corner above the roof
    const underTower = (u: Range) => f.s > 0 && u[0] >= (f.axis === 'x' ? 12.3 : 6.3);
    for (let k = 0; k < LV.length - 1; k++) {
      const y: Range = [k === 0 ? LV[0] : LV[k] - SL, k === LV.length - 2 ? LV[k + 1] : LV[k + 1] - SL];
      for (const g of f.grid) {
        const u = pierU(g);
        if (!u) continue;
        const corner = Math.abs(g) >= f.L - 1e-6;
        ps.push(clad(B('rconcrete', f.axis, u, y, wOut, STONE), corner ? [...out, { axis: 'z', out: (g > 0 ? 1 : -1) as 1 | -1 }] : out));
      }
      for (let i = 0; i + 1 < f.grid.length; i++) {
        const u = bayU(i);
        if (k === 0) { ps.push(...shopfront(f, u, wInf, i)); continue; }
        const sill = LV[k] + 0.9, head = LV[k + 1] - SL - 0.55, mid = (wInf[0] + wInf[1]) / 2;
        ps.push(clad(B('rconcrete', f.axis, u, [y[0], sill], wInf, STONE), out));
        ps.push(crittall(B('glass', f.axis, u, [sill, head], [mid - 0.03, mid + 0.03], 0xb9ccd2), f.axis));
        ps.push(B('stone', f.axis, u, [head, y[1]], wInf, STONE));
      }
    }
    // parapet: the piers rise as fins over a coping wall
    const top = LV[LV.length - 1];
    for (let i = 0; i + 1 < f.grid.length; i++) { const u = bayU(i); if (!underTower(u)) ps.push(B('stone', f.axis, u, [top, top + 1.1], wOut, STONE)); }
    for (const g of f.grid) { const u = pierU(g); if (u && !underTower(u)) ps.push(B('stone', f.axis, u, [top, top + 1.8], wOut, STONE)); }
  }
  return ps;
}

/** Ground-floor bay: granite stallriser, bronze-framed plate glass, a fascia; doors in the front's entrance bays. */
function shopfront(f: { axis: Axis; s: 1 | -1 }, u: Range, w: Range, i: number): PieceSpec[] {
  const ps: PieceSpec[] = [], y0 = LV[0], head = LV[1] - SL - 0.9, top = LV[1] - SL;
  const door = f.axis === 'x' && f.s > 0 && (i === 2 || i === 3);
  const mid = (w[0] + w[1]) / 2, gw: Range = [mid - 0.04, mid + 0.04];
  if (door) {
    const c = (u[0] + u[1]) / 2, dw = 2.4;
    ps.push(B('stone', f.axis, [u[0], c - dw / 2], [y0, y0 + 0.5], w, GRANITE), B('stone', f.axis, [c + dw / 2, u[1]], [y0, y0 + 0.5], w, GRANITE));
    ps.push(B('tempered', f.axis, [u[0], c - dw / 2], [y0 + 0.5, head], gw, 0xaec4cc), B('tempered', f.axis, [c + dw / 2, u[1]], [y0 + 0.5, head], gw, 0xaec4cc));
  } else {
    ps.push(B('stone', f.axis, u, [y0, y0 + 0.5], w, GRANITE), B('tempered', f.axis, u, [y0 + 0.5, head], gw, 0xaec4cc));
  }
  ps.push(B('copper', f.axis, u, [head, head + 0.3], w, BRONZE), B('stone', f.axis, u, [head + 0.3, top], w, STONE));
  return ps;
}

/** Glazed lantern over the atrium, balustrades round its edges, and the escalator pair from the ground floor. */
function atrium(): PieceSpec[] {
  const ps: PieceSpec[] = [], A = ATRIUM, roof = LV[5];
  // lantern: four glazed facets, each seated on a strip of the roof slab round the atrium
  const apex: Vec3 = [0, roof + 4.5, 0];
  for (const [a, b] of [[[-A, -A], [A, -A]], [[A, -A], [A, A]], [[A, A], [-A, A]], [[-A, A], [-A, -A]]] as [number, number][][]) {
    const pa: Vec3 = [a[0], roof, a[1]], pb: Vec3 = [b[0], roof, b[1]];
    const n = unit([(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2]), out = (p: Vec3): Vec3 => [p[0] + n[0] * 0.25, p[1], p[2] + n[2] * 0.25];
    ps.push(hull('tempered', [pa, pb, out(pa), out(pb), apex, [apex[0], apex[1] + 0.12, apex[2]]], { tint: 0xc8dde4 }));
  }
  for (let k = 1; k < LV.length - 1; k++) {
    const y: Range = [LV[k], LV[k] + 1.1];
    // set back behind the atrium's edge columns
    const b = A + 0.35, g = { tint: 0xc8dde4 };
    ps.push(block('tempered', [-b - 0.06, b + 0.06], y, [b, b + 0.06], g), block('tempered', [-b - 0.06, b + 0.06], y, [-b - 0.06, -b], g));
    ps.push(block('tempered', [b, b + 0.06], y, [-b, b], g), block('tempered', [-b - 0.06, -b], y, [-b, b], g));
  }
  // escalators: a steel truss from the ground floor up to the first-floor slab edge, glass balustrades on it, and
  // a step band riding a slider along the incline
  const lo = LV[0], up = LV[1], rise = up - lo, run = rise / Math.tan(Math.PI / 6), z1 = A, z0 = A - run;
  const T0: Vec3 = [0, lo + 0.25, z0 - 1.2], T1: Vec3 = [0, up - 0.12, z1], along = unit(sub(T1, T0)), len = Math.hypot(T1[1] - T0[1], T1[2] - T0[2]);
  const onTop = (x: number, t: number, dy: number): Vec3 => [x, T0[1] + along[1] * t + dy, T0[2] + along[2] * t];
  for (const xc of [-2.2, 2.2]) {
    const x: Range = [xc - 0.7, xc + 0.7];
    const pts: Vec3[] = [];
    for (const [z, y] of [[z0 - 1.2, lo], [z0, lo], [z1, up - 1.1], [z1, up - 0.12], [z0 - 1.2, lo + 0.25]] as [number, number][]) for (const xx of x) pts.push([xx, y, z]);
    ps.push(hull('steel', pts, { tint: 0x8c9296, util: 'power' }), supplyBox([xc + 0.7, xc + 1.1], [lo, lo + 0.8], [z0 - 1.2, z0 - 0.8]));
    const band = hull('aluminum', [0.6, len - 1.0].flatMap((t) => [-0.5, 0.5].flatMap((dx) => [onTop(xc + dx, t, 0.07), onTop(xc + dx, t, 0.17)])), { tint: 0x55595d, noWeld: true });
    const mid = onTop(xc, len / 2, -0.4);
    band.mech = { kind: 'slider', at: mid, axis: along, lower: 0, upper: 0.4, motor: { speed: 0.5, force: 2e4, shuttle: true } };
    ps.push(band);
    for (const xs of [x[0], x[1] - 0.06]) ps.push(hull('tempered', [0, len].flatMap((t) => [xs, xs + 0.06].flatMap((xx) => [onTop(xx, t, 0), onTop(xx, t, 1.0)])), { tint: 0xc8dde4 }));
  }
  return ps;
}

/** Corner entrance tower above the roof: two stone stages, a ziggurat crown and a lit sign fin; a roof sign. */
function tower(): PieceSpec[] {
  const ps: PieceSpec[] = [], x0 = 12 + 0.4, x1 = X, z0 = 6 + 0.4, z1 = Z;
  const st = (x: Range, y: Range, z: Range) => ps.push(block('stone', x, y, z, { tint: STONE }));
  // the tower stands on the corner bay's slab and parapet as a hollow stone box with slit windows
  const walls = (y: Range, inset: number) => {
    const xa = x0 + inset, xb = x1 - inset, za = z0 + inset, zb = z1 - inset, t = 0.5;
    st([xa, xb], y, [zb - t, zb]); st([xa, xb], y, [za, za + t]); st([xa, xa + t], y, [za + t, zb - t]); st([xb - t, xb], y, [za + t, zb - t]);
  };
  // two full stages, then the ziggurat: each set-back stage on a slab over the one below
  const R = LV[5];
  walls([R, R + 4], 0); walls([R + 4, R + 8], 0);
  st([x0, x1], [R + 8, R + 8.3], [z0, z1]); walls([R + 8.3, R + 9.8], 0.5);
  st([x0 + 0.5, x1 - 0.5], [R + 9.8, R + 10.1], [z0 + 0.5, z1 - 0.5]); walls([R + 10.1, R + 11.2], 1.0);
  st([x0 + 1.0, x1 - 1.0], [R + 11.2, R + 11.5], [z0 + 1.0, z1 - 1.0]);
  // sign fin on the corner, lamps up its face; fed from a roof cabinet through its steel frame
  const fx: Range = [X - 0.3, X], fz: Range = [Z + 0.0, Z + 1.4];
  ps.push(block('metal', fx, [LV[5] + 1.0, LV[5] + 10.5], fz, { tint: 0xb8342c, util: 'power' }));
  for (let y = LV[5] + 1.6; y < LV[5] + 10; y += 1.4) ps.push(lamp([X - 0.3, X], [y, y + 0.35], [Z + 1.4, Z + 1.6], { color: 0xff5a3c, intensity: 6, range: 12 }));
  // roof sign: two lattice posts, a rail and the lettered board, with flood lamps on the rail
  const sx: Range = [-10, 6], sz: Range = [8, 8.3];
  for (const x of [-9.5, 5.5]) ps.push(block('steel', [x - 0.15, x + 0.15], [LV[5], LV[5] + 4.5], [sz[0] - 0.3, sz[1]], { tint: STEEL, util: 'power' }));
  ps.push(block('steel', sx, [LV[5] + 4.5, LV[5] + 4.7], [sz[0] - 0.3, sz[1]], { tint: STEEL, util: 'power' }));
  ps.push(block('metal', sx, [LV[5] + 4.7, LV[5] + 7.2], sz, { tint: 0xf1e6cf }));
  for (const x of [-7, -3, 1, 4.5]) ps.push(lamp([x - 0.2, x + 0.2], [LV[5] + 4.1, LV[5] + 4.5], [sz[1] - 0.4, sz[1]], LIGHT.flood));
  ps.push(supplyBox([-9.35, -8.5], [LV[5], LV[5] + 1.2], [sz[0] - 0.3, sz[1]]));
  ps.push(supplyBox([X - 0.6, X], [LV[5], LV[5] + 1.0], [Z, Z + 0.8]));
  return ps;
}

/** Marquee over the front, counters and rails on the sales floors, lights on the ground floor. */
function fittings(): PieceSpec[] {
  const ps: PieceSpec[] = [];
  ps.push(block('steel', [-12, 6], [LV[1] - SL - 0.9, LV[1] - SL - 0.72], [Z, Z + 2.6], { tint: STEEL }), block('glass', [-11.8, 5.8], [LV[1] - SL - 0.72, LV[1] - SL - 0.66], [Z + 0.1, Z + 2.5], { tint: 0xd8e4e6 }));
  for (let k = 0; k < 5; k++) {
    for (const [x, z] of [[-13, -8], [9, -8], [-13, 8.5], [15, 0]] as [number, number][]) {
      if (k === 0 && z > 8) continue;
      ps.push(...fit(shelving(2.4), x, z, LV[k]));
    }
  }
  ps.push(supplyBox([-17.2, -16.8], [LV[0], LV[0] + 1.6], [-9.5, -8.5]));
  ps.push(block('steel', [-17.2, -16.9], [LV[0] + 1.6, LV[1] - SL], [-9.2, -8.8], { tint: 0x34383c, util: 'power' }));
  for (const x of [[-16.9, 0], [0, 16.9]] as Range[]) ps.push(block('steel', x, [LV[1] - SL - 0.08, LV[1] - SL], [-9.2, -8.8], { tint: 0x34383c, util: 'power' }));
  for (const x of [-14, -9, -3, 3, 9, 14]) ps.push(lamp([x - 0.3, x + 0.3], [LV[1] - SL - 0.45, LV[1] - SL - 0.08], [-9.3, -8.7], LIGHT.warm));
  return ps;
}

/** Art Deco department store: RC frame in Portland stone, atrium and escalators, corner tower and roof sign (front +Z). */
export function departmentStore(p: Placement): PieceSpec[] {
  const ps = [...frame(), ...facades(), ...atrium(), ...tower(), ...fittings()];
  return finish(ps, p, 'store', { years: 90, exposure: 'outdoor' });
}
