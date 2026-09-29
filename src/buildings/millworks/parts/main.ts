import type { PieceSpec } from '../../../types.ts';
import { block, extrude, hollowStack, pitchedRoof, prism, ringCourse, splitRange, tankX, wallRun, weldParts, type Opening, type Range, type WallRunOpts } from '../../../levels/kit.ts';
import { layerize, roofDetail } from '../../../levels/layers.ts';
import { band } from '../../../levels/facade.ts';
import { fit, loom, pallet } from '../../../levels/interior.ts';
import { conduit, disc, lamp, LIGHT, pipe, supplyBox } from '../../../levels/services.ts';
import { TINT } from '../../_shared/base.ts';
import { finish, refit, sect, type Placement } from '../../../levels/architecture/common.ts';

/* Fireproof cotton mill complex. The mill is five storeys of load-bearing brick (one-and-a-half brick, Flemish
   bond) round a frame of cast-iron columns carrying cast-iron beams, with brick jack arches sprung between the
   beams' bottom flanges and levelled up to the floor — the fireproof floor of the 1830s–70s mills. A slated roof
   on king-post trusses bears on the top-floor columns. At the east end an engine house holds a horizontal steam
   engine whose 6.4 m flywheel turns on its bearings (steam from two Lancashire boilers next door); the boiler
   flue runs to a 60 m octagonal chimney on a square pedestal. A stair tower with its sprinkler tank stands at
   the west end. Front (the long south face) toward +Z. */

const BRICK = 0xa4604a, SOOT = 0x6d625c, IRON = 0x3c4044;
const X = 15, Z = 7, T = 0.56, H = 3.6, N = 5, BEAM = 0.5;
const XI = X - T, ZI = Z - T;
const LINES = Array.from({ length: 9 }, (_, i) => -12 + 3 * i);
const COLZ = [-2.2, 2.2];
const ZSEG: Range[] = [[-ZI, COLZ[0]], [COLZ[0], COLZ[1]], [COLZ[1], ZI]];
const floorY = (k: number) => (k === 0 ? 0.3 : k * H);

/** Jack arch between two beam webs (or a wall face), sprung off the bottom flanges and levelled to the floor. */
function jackArch(xa: number, xb: number, yf: number, z: Range, wallA: boolean, wallB: boolean): PieceSpec {
  const o = { tint: 0x9b6a54 }, spring = yf - BEAM + 0.05, rise = 0.24;
  const e0 = wallA ? xa : xa + 0.13, e1 = wallB ? xb : xb - 0.13;
  const under = (x: number) => spring + rise * (1 - ((2 * (x - (e0 + e1) / 2)) / (e1 - e0)) ** 2);
  const parts: PieceSpec[] = [];
  // haunches under each beam's top flange, between web and flange edge
  if (!wallA) parts.push(block('brick', [xa, e0], [spring, yf - 0.05], z, o));
  if (!wallB) parts.push(block('brick', [e1, xb], [spring, yf - 0.05], z, o));
  const cuts = splitRange(e0, e1, (e1 - e0) / 3 + 1e-9);
  for (const [a, b] of cuts) parts.push(extrude('brick', [[a, under(a)], [b, under(b)], [b, yf], [a, yf]], 'z', z, o));
  const q = weldParts(parts);
  q.density = 1750;   // brick arch, lime-concrete fill and flags
  return q;
}

function millBlock(): PieceSpec[] {
  const brick = { tint: BRICK }, iron = { tint: IRON }, ps: PieceSpec[] = [];
  const bays = Array.from({ length: 10 }, (_, i) => -13.5 + 3 * i);
  const face: PieceSpec[] = [];
  for (let k = 0; k < N; k++) {
    const y0 = k * H, ground = k === 0;
    const run = (w: Partial<WallRunOpts> & { from: number; to: number; at: number }) =>
      wallRun({ mat: 'brick', t: T, y0, h: H, maxW: 2.6, ...brick, ...(ground ? { sill: 'stone' as const, lintel: 'stone' as const, lintelH: 0.22 } : {}), ...w } as WallRunOpts);
    const win = (c: number, w = 1.5) => ({ c, w, y0: ground ? 1.2 : 0.9, h: ground ? 2.0 : 2.1 });
    for (const s of [-1, 1] as const) {
      const openings = bays.map((c) => (ground && s > 0 && Math.abs(c + 1.5) < 0.1 ? { c, w: 2.2, y0: 0.3, h: 2.6, glass: false } : win(c)));
      const wall = run({ from: -X, to: X, at: s * (Z - T / 2), out: s, openings });
      (k < (s > 0 ? 3 : 2) ? face : ps).push(...wall);
      // west end: the stair tower covers the middle; east end: the engine house covers the lower storeys
      const endOps: Opening[] = s < 0 ? [-4.3, 4.3].map((c) => win(c, 1.2)) : k >= 4 ? [-4.3, 0, 4.3].map((c) => win(c, 1.2)) : [];
      if (s < 0) endOps.push(...(ground ? [{ c: 0, w: 1.1, y0: 0.08, h: 2.3, glass: false }] : [{ c: 0, w: 1.1, y0: 0, h: 2.4, glass: false }]));
      ps.push(...run({ axis: 'z', from: -ZI, to: ZI, at: s * (X - T / 2), out: s, openings: endOps }));
    }
    // cast-iron columns, one lift per storey, capped by the beams
    const top = (k + 1) * H - BEAM;
    for (const x of LINES) for (const z of COLZ) ps.push(prism('castiron', 0.28, [floorY(k), top], x, z, 16, iron));
    if (k === N - 1) continue;
    const yf = (k + 1) * H;
    for (const x of LINES) for (const z of ZSEG) ps.push(sect('castiron', [x - 0.15, x + 0.15], [yf - BEAM, yf], z, { kind: 'I', t: 0.05, tw: 0.04, depth: 1 }, iron));
    const webs = [-XI, ...LINES, XI];
    for (let i = 0; i + 1 < webs.length; i++) {
      const a = i === 0 ? -XI : webs[i] + 0.02, b = i + 2 === webs.length ? XI : webs[i + 1] - 0.02;
      for (const z of ZSEG) ps.push(jackArch(a, b, yf, z, i === 0, i + 2 === webs.length));
    }
  }
  // flagged ground floor on the natural ground, in bay-sized pieces
  for (const x of splitRange(-XI, XI, 6)) for (const z of ZSEG) ps.push(block('stone', x, [0, 0.3], z, { tint: 0x8f887c }));
  // slated roof on king-post trusses bearing on the top-floor columns
  const y = N * H;
  ps.push(...pitchedRoof({ mat: 'roof', x: [-X, X + 0.3], z: [-Z, Z], y, rise: 3.5, thick: 0.35, seat: 0.4, maxW: 3.8, tint: TINT.slate,
    gables: { mat: 'brick', x: [[-X, -XI], [XI, X]], tint: BRICK } }).map((q) => (q.mat === 'roof' && q.size[1] > 1 ? roofDetail(q, { tile: 'slate' }) : q)));
  {
    const kk = 3.5 / (Z - 0.4), under = (d: number) => y + kk * (Z - 0.4 - d), oak = { tint: TINT.woodDark };
    for (const x of LINES) {
      const xr: Range = [x - 0.1, x + 0.1];
      ps.push(block('wood', [x - 0.12, x + 0.12], [y - BEAM, y], [-ZI, ZI], oak), block('wood', xr, [y, under(0.12)], [-0.12, 0.12], oak));
      for (const s of [-1, 1]) ps.push(extrude('wood', [[s * ZI, y], [s * ZI, under(ZI)], [s * 0.12, under(0.12)], [s * 0.12, under(0.12) - 0.3]], 'x', xr, oak));
    }
  }
  // stone string courses at the first-floor line and the eaves
  for (const s of [-1, 1] as const) {
    ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: -X, to: X, y: [H - 0.25, H], depth: 0.1, profile: 'drip', tint: TINT.stone }));
    ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: -X, to: X, y: [N * H - 0.35, N * H], depth: 0.2, profile: 'cornice', tint: TINT.stone }));
  }
  // mules and looms on the floors, bales in the loading bay; a supply box and lamps on the ground floor
  for (let k = 0; k < N; k++) for (const x of [-7.5, 1.5, 7.5]) ps.push(...fit(loom(), x, k % 2 ? -4.4 : 4.4, floorY(k)));
  for (const x of [-2.2, -0.8]) ps.push(...fit(pallet(2), x, 4.4, 0.3));
  ps.push(supplyBox([-XI, -XI + 0.25], [1.2, 2.0], [-5.2, -4.6]), ...conduit([[-XI + 0.12, 2.0, -4.9], [-XI + 0.12, 3.06, -4.9], [-XI + 0.12, 3.06, 0], [13.2, 3.06, 0]]));
  for (const x of [-9, -3, 3, 9]) ps.push(lamp([x - 0.2, x + 0.2], [2.66, 3.02], [-0.2, 0.2], LIGHT.warm));
  return [...layerize(face, { brick: 'solid', maxUnits: 3000 }), ...ps];
}

/** Stair tower on the west end with a cast-iron sprinkler tank on its roof. */
function stairTower(): PieceSpec[] {
  const brick = { tint: BRICK }, cx = -X - 2.3;
  const ps: PieceSpec[] = [...hollowStack('brick', cx, 0, 0, 4.6, 0.46, H, N + 1, brick)];
  // the ground course is opened into a doorway on the south
  ps[0] = refit({ ...ps[0], parts: ps[0].parts!.filter((q) => !(q.pos[2] > 1.5 && Math.abs(q.pos[0]) < 1e-6)) });
  ps.push(block('brick', [cx - 2.3, cx - 0.6], [0, H], [2.3 - 0.46, 2.3], brick), block('brick', [cx + 0.6, cx + 2.3], [0, H], [2.3 - 0.46, 2.3], brick),
    block('stone', [cx - 0.6, cx + 0.6], [2.6, H], [2.3 - 0.46, 2.3], { tint: TINT.stone }));
  const y = (N + 1) * H;
  ps.push(block('stone', [cx - 2.4, cx + 2.3], [y, y + 0.3], [-2.4, 2.4], { tint: TINT.stone }), block('castiron', [cx - 1.8, cx + 1.8], [y + 0.3, y + 2.4], [-1.8, 1.8], { tint: 0x4b5a4f }));
  return ps;
}

/** Engine house (east end) with its horizontal engine, boiler house with two Lancashire boilers, flue and chimney. */
function powerHouse(): PieceSpec[] {
  const brick = { tint: BRICK }, iron = { tint: IRON }, ps: PieceSpec[] = [];
  // 80 mm movement joints (clear of the core's AABB margin) keep the engine house and the chimney their own
  // structures: a falling stack wrecks what it lands on, not everything it was bonded to
  const x0 = X + 0.08, x1 = X + 10, z = 5.5, t = 0.56, h = 12.4;
  const run = (w: Partial<WallRunOpts> & { from: number; to: number; at: number; y0: number; h: number }) =>
    wallRun({ mat: 'brick', t, maxW: 2.8, sill: 'stone', lintel: 'stone', lintelH: 0.35, ...brick, ...w } as WallRunOpts);
  for (const s of [-1, 1] as const) {
    for (const [y0, hh] of [[0, 6.2], [6.2, h - 6.2]] as Range[]) {
      const tall = y0 === 0 ? { y0: 2.2, h: 4.0 } : { y0: 0, h: 3.4 };
      ps.push(...run({ from: x0, to: x1, at: s * (z - t / 2), out: s, y0, h: hh, openings: [x0 + 3, x0 + 7].map((c) => ({ c, w: 1.8, ...tall, glass: true })) }));
    }
  }
  ps.push(...run({ axis: 'z', from: -z + t, to: z - t, at: x1 - t / 2, y0: 0, h: 6.2, openings: [{ c: 0, w: 2.6, y0: 0, h: 3.6, glass: false }] }));
  ps.push(...run({ axis: 'z', from: -z + t, to: z - t, at: x1 - t / 2, y0: 6.2, h: h - 6.2, openings: [{ c: 0, w: 2.2, y0: 0.4, h: 4.0 }] }));
  ps.push(...pitchedRoof({ mat: 'roof', x: [x0, x1 + 0.3], z: [-z, z], y: h, rise: 2.6, thick: 0.3, seat: 0.4, maxW: 3.6, tint: TINT.slate,
    gables: { mat: 'brick', x: [[x1 - t, x1]], tint: BRICK } }).map((q) => (q.mat === 'roof' && q.size[1] > 1 ? roofDetail(q, { tile: 'slate' }) : q)));
  // the engine: bed, cylinder, guides and a flywheel on two pedestals; the bed stands on its own foundation,
  // clear of the house floor, so the turning wheel's island is just the engine
  const ex = x0 + 5, ez = -1.2, fy = 3.7, fr = 3.2;
  ps.push(block('concrete', [x0 + 0.6, x1 - 0.6], [0, 0.35], [-z + t, -3.1], { tint: 0x8f887c }), block('concrete', [x0 + 0.6, x1 - 0.6], [0, 0.35], [2.0, z - t], { tint: 0x8f887c }));
  ps.push(block('castiron', [x0 + 1.0, ex - 0.7], [0, 0.9], [ez - 0.7, ez + 0.4], iron));
  ps.push(tankX('castiron', [x0 + 1.2, x0 + 3.4], 0.9 + 0.62 * Math.sin(Math.PI * 5 / 12), ez, 0.62, 0.12, { tint: 0x55606a }));
  ps.push(block('castiron', [x0 + 3.4, ex - 0.8], [0.9, 1.9], [ez - 0.35, ez + 0.35], iron));
  for (const zp of [ez + 0.95, ez + 2.35]) ps.push(block('castiron', [ex - 0.6, ex + 0.6], [0, fy + 0.3], [zp - 0.35, zp + 0.35], iron));
  const wheel = disc('castiron', 'z', [ex, fy, ez + 1.65], fr, 0.5, { tint: 0x2f3336 }, 24);
  wheel.density = 2400;   // rim, arms and boss of a built-up flywheel (the disc is solid)
  wheel.noWeld = true;
  wheel.mech = { kind: 'hinge', at: [ex, fy, ez + 0.95], axis: [0, 0, 1], motor: { speed: 1.6, force: 4e5, always: true } };
  ps.push(wheel);
  // boiler house: lean-to shed, two Lancashire boilers on brick seatings, steam main to the engine
  const bx0 = x1, bx1 = x1 + 9.5;
  for (const s of [-1, 1] as const) ps.push(...run({ from: bx0, to: bx1, at: s * (z - t / 2), out: s, y0: 0, h: 6, openings: s > 0 ? [{ c: bx0 + 4.8, w: 2.4, y0: 0, h: 3.2, glass: false }] : [] }));
  ps.push(...run({ axis: 'z', from: -z + t, to: z - t, at: bx1 - t / 2, y0: 0, h: 6, openings: [] }));
  for (const zz of splitRange(-z, z, 3.7)) ps.push(block('metal', [bx0, bx1], [6, 6.12], zz, { tint: 0x5b5f63 }));
  for (const zb of [-2.3, 1.8]) {
    ps.push(block('brick', [bx0 + 1.2, bx1 - 1.0], [0, 0.8], [zb - 1.1, zb + 1.1], { tint: SOOT }));
    ps.push(tankX('steel', [bx0 + 1.3, bx1 - 1.1], 0.8 + 1.2 * Math.sin(Math.PI * 5 / 12), zb, 1.2, 0.2, { tint: 0x6c6259, fixture: 'boiler' }));
  }
  ps.push(...pipe('steam', 'steel', [[bx0 + 4.0, 0.8 + 2.4 * Math.sin(Math.PI * 5 / 12), -2.3], [bx0 + 4.0, 4.8, -2.3], [bx0, 4.8, -2.3]], 0.2));
  // brick flue from the boiler house to the chimney's base
  const cx = bx1 + 5.5;
  ps.push(block('brick', [bx1, cx - 3.08], [0, 2.4], [-1.0, 1.0], { tint: SOOT }));
  ps.push(...chimney(cx, 0));
  return ps;
}

/** 60 m octagonal brick chimney: hollow square pedestal, tapering shaft in sector courses, corbelled cap. */
function chimney(cx: number, cz: number): PieceSpec[] {
  const ps: PieceSpec[] = [...hollowStack('brick', cx, cz, 0, 6.0, 1.0, 2.4, 4, { tint: SOOT })];
  ps.push(block('stone', [cx - 3.1, cx + 3.1], [9.6, 10.2], [cz - 3.1, cz - 1.0], { tint: TINT.stone }), block('stone', [cx - 3.1, cx + 3.1], [9.6, 10.2], [cz + 1.0, cz + 3.1], { tint: TINT.stone }),
    block('stone', [cx - 3.1, cx - 1.0], [9.6, 10.2], [cz - 1.0, cz + 1.0], { tint: TINT.stone }), block('stone', [cx + 1.0, cx + 3.1], [9.6, 10.2], [cz - 1.0, cz + 1.0], { tint: TINT.stone }));
  const y0 = 10.2, top = 58.2, n = 15;
  const outer = (f: number) => 2.9 - 1.25 * f, wall = (f: number) => 0.75 - 0.4 * f;
  for (let k = 0; k < n; k++) {
    const f0 = k / n, f1 = (k + 1) / n;
    ps.push(...ringCourse('brick', cx, cz, [y0 + (top - y0) * f0, y0 + (top - y0) * f1], [outer(f0) - wall(f0), outer(f1) - wall(f1)], [outer(f0), outer(f1)], 8, { tint: k > n - 3 ? SOOT : BRICK }));
  }
  const r1 = outer(1), w1 = wall(1);
  ps.push(...ringCourse('brick', cx, cz, [top, top + 0.9], [r1 - w1, r1 - w1], [r1, r1 + 0.35], 8, { tint: SOOT }));
  ps.push(...ringCourse('brick', cx, cz, [top + 0.9, top + 1.8], [r1 - w1, r1 - w1], [r1 + 0.35, r1 + 0.1], 8, { tint: SOOT }));
  return ps;
}

/** Five-storey fireproof cotton mill with engine house, boiler house, 60 m chimney and stair tower (front +Z). */
export function millComplex(p: Placement): PieceSpec[] {
  const ps = [...millBlock(), ...stairTower(), ...powerHouse()];
  return finish(ps, p, 'millworks', { years: 150, exposure: 'wet' });
}

