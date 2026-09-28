import { mulberry32 } from 'math/random';
import type { PieceSpec, Vec3 } from '../types.ts';
import {
  awning, beam, block, curtains, flagpole, box, brickBond, chamfer, column, envelopeFinish, crates, cyl, drums, extrude, flight, grid, hollowStack, hull, panels, pitchedRoof, place, prism, raise,
  pipeRun, ringCourse, scaffold, spiralStair, splitRange, stairs, strut, tag, timberWall, tnt, wallRun, wedge, weldParts,
  GLASS_T, type Opening, type PieceOpts, type Range, type WallRunOpts,
} from './kit.ts';
import { layerize } from './layers.ts';
import { riggingLine, wireLine } from './rigging.ts';
import { parkedSaloon, parkedVan } from './machines.ts';
import { earthBond } from './electrical.ts';
import { balcony, band, canopy, dormer, downpipe, pilaster, quoins } from './facade.ts';
import {
  bar, bathroom, bed, bookcase, chair, desk, filingCabinet, fit, kitchen, loom, pallet, pew, racking, screen, shelving, sofa, stair, studWall, table,
  wardrobe, workbench,
} from './interior.ts';
import {
  boilerSet, conduit, disc, floodMast, gasMeter, generatorSet, groundTransformer, holedPanels, hvacUnit, hydrant, lamp, lift, LIGHT, pendant, pipe,
  radiatorPanel, stopcock, streetLamp, supplyBox, wallBoiler, SVC, BORE, clipped, cutSleeve, drawn,
} from './services.ts';

/* Every structure is authored in local metres around its own origin, front facing +Z,
   then dropped into the world with place() (quarter turns keep boxes axis-aligned). */

export interface Placement {
  x: number; z: number; rot?: number; group?: string;
  /** furniture, fittings, stairs and room partitions (default true); false keeps only the structure and services */
  interior?: boolean;
  /** the building's own intake (its consumer unit / supply cabinet) becomes a plain live member, to be fed from a site grid */
  gridFed?: boolean;
}

/** A grid-fed building: its local intake sources become ordinary power members. */
export function gridFeed(ps: PieceSpec[], on?: boolean): PieceSpec[] {
  if (!on) return ps;
  for (const q of ps) if (q.fixture === 'transformer') { delete q.fixture; q.util = 'power'; }
  return ps;
}

export const TINT = {
  cream: 0xf1e6cf, white: 0xf4f1ea, sage: 0xcfd8c0, pink: 0xecc9c1, blue: 0xc9d6e3, butter: 0xf3e2a9,
  shedGreen: 0x7f9f6c, woodDark: 0x8a6a4a, woodPale: 0xc9b596, weatherboard: 0xd9d2c3,
  slate: 0x7a808a, terracotta: 0xd08a64, felt: 0x55585c,
  concrete: 0xcfcfca, darkConcrete: 0x9a9a96, soot: 0x6d625c, brickPale: 0xe3c9b0, brickDark: 0xa98474,
  steelRed: 0xb0493a, steelGrey: 0x8d949b, metalWhite: 0xeceae4, metalBlue: 0x6f8fae, metalGreen: 0x7d9a86,
  rubber: 0x2a2a2a, vanWhite: 0xf2f2ee, carRed: 0xb8352c, carTeal: 0x3f8c8a,
  iron: 0x3c4044, stone: 0xe6dcc6, sand: 0xe8d2a6, barnRed: 0xa8503c, shingle: 0x6e5a48, blueGlass: 0xa9cde0, bronze: 0xa07a3c, craneYellow: 0xe8b82a,
};

export function rng(seed: number): () => number {
  const s = mulberry32.create(seed);
  return () => mulberry32.sample(s);
}

function put(ps: PieceSpec[], p: Placement, fallback: string, extra: PieceOpts = {}): PieceSpec[] {
  return gridFeed(tag(place(envelopeFinish(ps), p.x, p.z, p.rot ?? 0), { group: p.group ?? fallback, ...extra }), p.gridFed);
}

/** Floor-bolted line drive: plinth, continuous skids, motor, shaft, split flywheel,
 * guarded belt and intake hopper. The thin parts seat on thicker members so an
 * impact can strip the guard/hopper before it dislodges the heavy machine bed. */
function lineDrive(x: number, z: number, y = 0): PieceSpec[] {
  const iron: PieceOpts = { tint: TINT.iron, finish: 'satin' }, frame: PieceOpts = { finish: 'galv' }, guard: PieceOpts = { tint: 0x161616, finish: 'decal' };
  const ps: PieceSpec[] = [
    block('concrete', [-1.45, 1.45], [0, 0.24], [-0.85, 0.85], { tint: TINT.darkConcrete }),
    block('steel', [-1.25, 1.25], [0.24, 0.42], [-0.7, -0.46], frame),
    block('steel', [-1.25, 1.25], [0.24, 0.42], [0.46, 0.7], frame),
    block('castiron', [-0.95, 0.4], [0.42, 1.48], [-0.48, 0.48], { ...iron, fixture: 'motor' }),
    block('steel', [-1.08, -0.95], [0.62, 1.28], [-0.38, 0.38], { ...frame, util: 'power' }),
    block('castiron', [-0.08, 0.08], [1.48, 1.65], [-0.13, 0.13], iron),
    ...pipeRun('steel', 'x', [0.4, 0.9], [0, 1.0, 0], 0.24, frame),
    block('castiron', [0.9, 1.08], [0.42, 1.56], [-0.55, 0.55], iron),
    block('castiron', [1.08, 1.2], [0.42, 1.56], [-0.55, 0.55], iron),
    // Belt reaches between the motor and wheel; two removable guard cheeks
    // stand on the skids, while the top cap bridges them.
    block('metal', [0.08, 0.9], [1.56, 1.64], [-0.13, -0.03], { tint: TINT.rubber }),
    block('metal', [0.22, 1.25], [0.42, 1.78], [-0.69, -0.59], guard),
    block('metal', [0.22, 1.25], [0.42, 1.78], [0.59, 0.69], guard),
    block('metal', [0.22, 1.25], [1.78, 1.86], [-0.69, 0.69], guard),
    block('steel', [-0.65, -0.47], [1.48, 1.87], [-0.52, -0.34], frame),
    block('metal', [-1.05, -0.08], [1.87, 2.03], [-0.7, -0.16], { tint: TINT.metalGreen }),
    block('metal', [-1.05, -0.93], [2.03, 2.42], [-0.7, -0.16], { tint: TINT.metalGreen }),
    block('metal', [-0.2, -0.08], [2.03, 2.42], [-0.7, -0.16], { tint: TINT.metalGreen }),
  ];
  return raise(place(ps, x, z), y);
}

/** Horizontal boiler (steam source) on a masonry hearth; no full-size obstacle crosses a door. */
function boiler(x: number, z: number, y = 0): PieceSpec[] {
  return raise(place(boilerSet(), x, z), y);
}

/** Radiator fastened to a floor and wall by its base and two manifold ends.
 * Fins meet both headers face-to-face and break away individually. */
function radiator(x: number, z: number, y = 0): PieceSpec[] {
  const iron = { tint: TINT.metalWhite, util: 'steam' as const }, copper = { tint: TINT.bronze, util: 'steam' as const };
  const ps: PieceSpec[] = [
    block('castiron', [-0.92, 0.92], [0, 0.16], [-0.17, 0.17], iron),
    block('castiron', [-0.92, 0.92], [0.16, 0.29], [-0.12, 0.12], iron),
    block('castiron', [-0.92, 0.92], [1.04, 1.17], [-0.12, 0.12], { tint: TINT.metalWhite, fixture: 'radiator' }),
  ];
  for (const dx of [-0.7, -0.35, 0, 0.35, 0.7]) ps.push(block('castiron', [dx - 0.075, dx + 0.075], [0.29, 1.04], [-0.15, 0.15], iron));
  ps.push(block('copper', [0.92, 1.08], [1.04, 1.17], [-0.1, 0.1], copper));
  return raise(place(ps, x, z), y);
}

/* ---------------- garden scale ---------------- */

export function gardenShed(p: Placement): PieceSpec[] {
  const t = 0.1, y0 = 0.12, h = 1.98;
  const wood = { tint: TINT.shedGreen };
  const ps: PieceSpec[] = [
    ...grid('plywood', [-1.5, 1.5], [0, y0], [-1.2, 1.2], { x: 1.6 }, { tint: TINT.woodDark }),
    ...wallRun({ mat: 'wood', from: -1.5, to: 1.5, at: 1.2 - t / 2, t, y0, h, maxW: 1.6, ...wood,
      openings: [{ c: 0.5, w: 0.8, y0: 0, h: 1.8 }] }),
    ...wallRun({ mat: 'wood', from: -1.5, to: 1.5, at: -1.2 + t / 2, t, y0, h, maxW: 1.6, out: -1, ...wood }),
    ...wallRun({ mat: 'wood', axis: 'z', from: -1.1, to: 1.1, at: -1.5 + t / 2, t, y0, h, out: -1, ...wood, sill: 'wood',
      openings: [{ c: 0, w: 0.8, y0: 0.8, h: 0.6 }] }),
    ...wallRun({ mat: 'wood', axis: 'z', from: -1.1, to: 1.1, at: 1.5 - t / 2, t, y0, h, ...wood }),
    ...pitchedRoof({ mat: 'roof', x: [-1.7, 1.7], z: [-1.2, 1.2], y: y0 + h, rise: 0.8, thick: 0.18, seat: 0.1, tint: TINT.felt,
      gables: { mat: 'wood', x: [[-1.5, -1.4], [1.4, 1.5]], tint: TINT.shedGreen } }),
  ];
  // corner boards on the gable ends
  for (const x of [-1.58, 1.5]) for (const z of [-1.2, 1.12]) ps.push(block('wood', [x, x + 0.08], [y0, y0 + h], [z, z + 0.08], { tint: TINT.woodPale }));
  return put(ps, p, 'shed');
}

export function gardenWall(p: Placement & { length: number; gate?: number; height?: number }): PieceSpec[] {
  const h = p.height ?? 1.6, t = 0.23, pier = 0.36;
  const bays = Math.max(1, Math.round(p.length / 3));
  const pitch = p.length / bays;
  const x0 = -p.length / 2;
  const ps: PieceSpec[] = [];
  for (let i = 0; i <= bays; i++) {
    const x = x0 + i * pitch;
    ps.push(block('brick', [x - pier / 2, x + pier / 2], [0, h + 0.15], [-pier / 2, pier / 2]));
    ps.push(block('stone', [x - 0.22, x + 0.22], [h + 0.15, h + 0.25], [-0.22, 0.22], { tint: TINT.concrete }));
    if (i === bays || i === p.gate) continue;
    const span: Range = [x + pier / 2, x + pitch - pier / 2];
    ps.push(block('brick', span, [0, h], [-t / 2, t / 2]));
    ps.push(block('stone', span, [h, h + 0.08], [-0.15, 0.15], { tint: TINT.concrete }));
  }
  return put(ps, p, 'wall');
}

export function outhouse(p: Placement): PieceSpec[] {
  const t = 0.08, a = 0.6, h = 2.1;
  const o = { tint: TINT.woodPale };
  const ps: PieceSpec[] = [
    ...wallRun({ mat: 'wood', from: -a, to: a, at: a - t / 2, t, y0: 0, h, ...o, openings: [{ c: 0, w: 0.7, y0: 0, h: 1.85 }] }),
    block('wood', [-a, a], [0, h], [-a, -a + t], o),
    block('wood', [-a, -a + t], [0, h], [-a + t, a - t], o),
    block('wood', [a - t, a], [0, h], [-a + t, a - t], o),
    block('wood', [-a + t, a - t], [0, 0.45], [-a + t, -0.12], { tint: TINT.woodDark }),
    block('metal', [-0.75, 0.75], [h, h + 0.08], [-0.75, 0.85], { tint: TINT.steelGrey }),
    cyl('metal', 0.1, [h + 0.08, h + 0.5], 0.35, -0.4, { tint: TINT.steelGrey }),
  ];
  return put(ps, p, 'outhouse');
}

export function greenhouse(p: Placement): PieceSpec[] {
  const t = 0.1, h0 = 0.45, hg = 1.4;
  const ax = 1.5, az = 1.0;
  const gy: Range = [h0, h0 + hg];
  const g = GLASS_T / 2;
  const wood = { tint: TINT.weatherboard };
  const ps: PieceSpec[] = [
    block('wood', [-ax, ax], [0, h0], [az - t, az], wood),
    block('wood', [-ax, ax], [0, h0], [-az, -az + t], wood),
    block('wood', [-ax, -ax + t], [0, h0], [-az + t, az - t], wood),
    block('wood', [ax - t, ax], [0, h0], [-az + t, az - t], wood),
    ...grid('glass', [-ax, ax], gy, [az - t / 2 - g, az - t / 2 + g], { x: 1.5 }),
    ...grid('glass', [-ax, ax], gy, [-az + t / 2 - g, -az + t / 2 + g], { x: 1.5 }),
    block('glass', [-ax + t / 2 - g, -ax + t / 2 + g], gy, [-az + t / 2 + g, az - t / 2 - g]),
    block('glass', [ax - t / 2 - g, ax - t / 2 + g], gy, [-az + t / 2 + g, az - t / 2 - g]),
    ...grid('glass', [-ax, ax], [gy[1], gy[1] + GLASS_T], [-az, az], { x: 1.5 }),
    block('wood', [-1.0, 1.0], [0, 0.75], [-az + t + 0.05, -az + t + 0.55], { tint: TINT.woodDark }),
  ];
  return put(ps, p, 'greenhouse');
}

/* ---------------- bungalow ---------------- */

/** 10 x 7.5 m brick bungalow on a concrete plinth: plaster-lined rooms, tiled roof on timber plates, gable chimney. */
export function bungalow(p: Placement & { lining?: number; roofTint?: number }): PieceSpec[] {
  const X = 5, Z = 3.75, tb = 0.25, tl = 0.08, ti = tb + tl;
  const ph = 0.45, wallTop = 3.0, h = wallTop - ph, lip = 0.06;
  const lining = { mat: 'plaster' as const, t: tl, tint: p.lining ?? TINT.cream };
  const con = { tint: TINT.concrete };
  const win = (c: number, w = 1.4, y0 = 0.55, hh = 1.35) => ({ c, w, y0, h: hh });
  const wall = { mat: 'brick' as const, t: tb, y0: ph, h, lintel: 'rconcrete' as const, sill: 'stone' as const, mullion: 'wood' as const, mullionTint: TINT.white };
  const chim: Range = [-0.55, 0.55];
  const ps: PieceSpec[] = [
    // plinth ring, cut round the chimney breast on the +X gable
    ...grid('concrete', [-X - lip, X + lip], [0, ph], [Z - ti, Z + lip], { x: 2.6 }, con),
    ...grid('concrete', [-X - lip, X + lip], [0, ph], [-Z - lip, -Z + ti], { x: 2.6 }, con),
    ...grid('concrete', [-X - lip, -X + ti], [0, ph], [-Z + ti, Z - ti], { z: 2.4 }, con),
    ...grid('concrete', [X - ti, X + lip], [0, ph], [-Z + ti, chim[0]], { z: 2.4 }, con),
    ...grid('concrete', [X - ti, X + lip], [0, ph], [chim[1], Z - ti], { z: 2.4 }, con),
    block('concrete', [X - ti, X], [0, ph], chim, con),
    block('concrete', [-0.7, 0.7], [0, 0.25], [Z + lip, Z + 0.65], con),
    // walls
    ...wallRun({ ...wall, from: -X, to: X, at: Z - tb / 2, out: 1, lining: { ...lining, from: -X + tb, to: X - tb },
      openings: [win(-3), { c: 0, w: 1.0, y0: 0, h: 2.05 }, win(3)] }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + tb / 2, out: -1, lining: { ...lining, from: -X + tb, to: X - tb },
      openings: [win(-3), win(0.2, 0.9, 1.0, 0.9), win(3)] }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + tb, to: Z - tb, at: -X + tb / 2, out: -1, lining: { ...lining, from: -Z + ti, to: Z - ti },
      openings: [win(0, 1.2)] }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + tb, to: Z - tb, at: X - tb / 2, out: 1, lining: { ...lining, from: -Z + ti, to: Z - ti },
      openings: [win(-2.1, 0.9, 0.75, 1.1), win(2.1, 0.9, 0.75, 1.1)] }),
    // partitions stand on the ground inside the plinth ring
    ...wallRun({ mat: 'drywall', axis: 'z', from: -Z + ti, to: Z - ti, at: -1.2, t: 0.12, y0: 0, h: wallTop, tint: lining.tint,
      openings: [{ c: 1.6, w: 0.9, y0: ph, h: 2.05, glass: false }] }),
    ...wallRun({ mat: 'drywall', from: -1.14, to: X - ti, at: 0.6, t: 0.12, y0: 0, h: wallTop, tint: TINT.sage,
      openings: [{ c: 2.6, w: 0.9, y0: ph, h: 2.05, glass: false }] }),
    // timber wall plates
    ...grid('wood', [-X, X], [wallTop, wallTop + 0.15], [Z - ti, Z], { x: 5 }),
    ...grid('wood', [-X, X], [wallTop, wallTop + 0.15], [-Z, -Z + ti], { x: 5 }),
    ...grid('wood', [-X, -X + ti], [wallTop, wallTop + 0.15], [-Z + ti, Z - ti], { z: 3.5 }),
    ...grid('wood', [X - ti, X], [wallTop, wallTop + 0.15], [-Z + ti, Z - ti], { z: 3.5 }),
    ...pitchedRoof({ mat: 'roof', x: [-X - 0.3, X], z: [-Z, Z], y: wallTop + 0.15, rise: 2.6, thick: 0.32, seat: 0.25,
      tint: p.roofTint ?? TINT.terracotta, maxW: 3.6, gables: { mat: 'wood', x: [[-X, -X + ti], [X - ti, X]], tint: TINT.weatherboard },
      barge: { tint: TINT.white, ends: 'lo' } }),
    // external chimney breast on the +X gable, clear of the roof (no overhang on that end)
    ...grid('brick', [X, X + 0.6], [0, 7.0], chim, { y: 1.8 }, { tint: TINT.brickDark }),
    chamfer('stone', [X - 0.05, X + 0.65], [7.0, 7.1], [-0.6, 0.6], 0.04, con, 'top'),
    cyl('terracotta', 0.22, [7.1, 7.55], X + 0.3, -0.25, { tint: TINT.terracotta }),
    cyl('terracotta', 0.22, [7.1, 7.55], X + 0.3, 0.25, { tint: TINT.terracotta }),
  ];
  // The entrance is a real little masonry portico rather than a floating roof accent.
  // Its posts bear on independent pads, and the canopy keys into the front wall at its back edge.
  for (const x of [-1.8, 1.8]) {
    ps.push(block('concrete', [x - 0.32, x + 0.32], [0, 0.22], [4.45, 5.09], con));
    ps.push(block('stone', [x - 0.2, x + 0.2], [0.22, 2.45], [4.57, 4.97], { tint: TINT.stone }));
    ps.push(block('stone', [x - 0.3, x + 0.3], [2.45, 2.62], [4.47, 5.07], { tint: TINT.stone }));
  }
  ps.push(block('rconcrete', [-2.3, 2.3], [2.62, 2.82], [Z, 5.18], con));
  ps.push(block('copper', [-2.38, 2.38], [2.82, 2.94], [Z, 5.22], { tint: 0xc8b49b }));
  // Tile the four rooms separately: the finish beds inside, not through, their partitions.
  for (const xr of [[-X + ti, -1.26], [-1.14, X - ti]] as Range[]) {
    for (const zr of [[-Z + ti, 0.54], [0.66, Z - ti]] as Range[]) {
      ps.push(block('ceramic', xr, [0, 0.1], zr, { tint: 0xe9e3d4 }));
    }
  }
  // In the rear bedroom, under the window rather than in the front entrance.
  ps.push(...radiator(-3.1, -2.98, 0.1));
  // Dressings: stone quoins on the front corners, gutters on both eaves (split round the porch) and downpipes.
  const gy: Range = [wallTop - 0.14, wallTop];
  for (const [f, u, dir] of [[{ face: Z }, -X, 1], [{ face: Z }, X, -1], [{ axis: 'z', face: -X, out: -1 }, Z, -1], [{ axis: 'z', face: X }, Z, -1]] as const) {
    ps.push(...quoins(f as { face: number }, u, dir, [ph, gy[0] - 0.01], 4));
  }
  for (const u of [[-X, -2.4], [2.4, X]] as Range[]) ps.push(...band({ mat: 'pvc', face: Z, from: u[0], to: u[1], y: gy, depth: 0.14, tint: 0x3a3d40 }));
  ps.push(...band({ mat: 'pvc', face: -Z, out: -1, from: -X, to: X, y: gy, depth: 0.14, tint: 0x3a3d40 }));
  for (const [z, out] of [[Z, 1], [-Z, -1]] as const) for (const x of [-4.2, 4.2]) ps.push(...downpipe({ face: z, out }, x, [ph, gy[0]]));
  if (p.interior !== false) {
    ps.push(...fit(bed(true), -3.0, 2.0, 0.1, 2), ...fit(wardrobe(1.0), -4.35, -1.0, 0.1, 1));
    ps.push(...fit(kitchen(2.4, { wallUnits: false }), 4.67, -2.7, 0.1, 3), ...fit(table(1.2, 0.8), 2.2, -1.5, 0.1));
    for (const z of [-2.2, -0.8]) ps.push(...fit(chair(), 2.2, z, 0.1));
    ps.push(...fit(sofa(2.0), 2.5, 1.11, 0.1), ...fit(table(0.9, 0.5), 2.5, 2.3, 0.1), ...fit(bookcase(), -0.98, 2.5, 0.1, 1));
  }
  // Services: a consumer unit by the front door feeds a lamp run along the front room; a gas combi boiler heats the
  // bedroom radiator; the kitchen has a stopcock and a cold main along the back wall.
  const fi = Z - ti;
  ps.push(supplyBox([0.7, 1.1], [1.6, 2.2], [fi - 0.12, fi]), ...conduit([[0.9, 2.2, fi - 0.04], [0.9, 2.9, fi - 0.04], [X - ti, 2.9, fi - 0.04]]));
  for (const x of [1.8, 3.9]) ps.push(lamp([x - 0.18, x + 0.18], [2.6, 2.86], [fi - 0.3, fi], LIGHT.warm));
  // the gas meter box stands outside at the foot of the back wall; its outlet is sleeved through the wall to the boiler
  ps.push(wallBoiler([-2.02, -1.4], [1.0, 1.8], [-fi, -fi + 0.52]), gasMeter([-1.95, -1.4], [0, 0.62], [-Z - lip - 0.28, -Z - lip]));
  ps.push(...clipped('gas', 'copper', [[-1.67, 0.55, -Z - lip], [-1.67, 0.55, -fi + 0.05], [-1.67, 1.0, -fi + 0.05]], BORE.cu22, [0, 0, -1]));
  ps.push(stopcock([1.5, 1.8], [0.1, 0.45], [-fi, -fi + 0.25]), ...pipe('water', 'copper', [[1.65, 0.45, -fi + 0.07], [1.65, 0.9, -fi + 0.07], [4.2, 0.9, -fi + 0.07]], 0.1));
  return put(layerize(cutSleeve(ps, [-1.67, 0.55, 0], 'z', drawn(BORE.cu22) / 2, [-Z - lip, -fi]), { brick: 'english', lining: true, partitions: true, roofs: 'tile' }), p, 'bungalow');
}

/* ---------------- water tower ---------------- */

/** Four steel legs with two brace rings, a timber deck and a steel-banded stave tank (≈15 m). */
export function waterTower(p: Placement): PieceSpec[] {
  const a = 2, leg = 0.3, pad = 0.3, top = 10;
  const steel = { tint: TINT.steelRed };
  const ps: PieceSpec[] = [];
  const legSegs = splitRange(pad, top, 3.4);
  for (const sx of [-a, a]) {
    for (const sz of [-a, a]) {
      ps.push(block('concrete', [sx - 0.4, sx + 0.4], [0, pad], [sz - 0.4, sz + 0.4], { tint: TINT.darkConcrete }));
      for (const y of legSegs) ps.push(block('steel', [sx - leg / 2, sx + leg / 2], y, [sz - leg / 2, sz + leg / 2], steel));
    }
  }
  // brace rings straddle the leg joints so each joint is tied four ways
  for (let k = 1; k < legSegs.length; k++) {
    const y: Range = [legSegs[k][0] - 0.1, legSegs[k][0] + 0.1];
    const inner: Range = [-a + leg / 2, a - leg / 2];
    for (const s of [-a, a]) {
      ps.push(block('steel', inner, y, [s - 0.1, s + 0.1], steel));
      ps.push(block('steel', [s - 0.1, s + 0.1], y, inner, steel));
    }
  }
  ps.push(...grid('steel', [-0.15, 0.15], [0, top], [-0.15, 0.15], { y: 3.4 }, { tint: TINT.steelGrey, util: 'water' }));
  ps.push(stopcock([0.15, 0.55], [0, 0.6], [-0.2, 0.2]));
  const deckY = top + 0.4;
  for (const s of [-a, a]) ps.push(block('steel', [-2.6, 2.6], [top, deckY], [s - 0.15, s + 0.15], steel));
  ps.push(block('steel', [-0.15, 0.15], [top, deckY], [-a + 0.15, a - 0.15], steel));
  const deckTop = deckY + 0.15;
  ps.push(...panels('wood', [-2.6, 0, 2.6], [deckY, deckTop], [-2.6, 0, 2.6], { tint: TINT.woodDark }));
  const rail: Range = [deckTop, deckTop + 0.8];
  const wood = { tint: TINT.woodPale };
  ps.push(block('wood', [-2.6, 2.6], rail, [2.52, 2.6], wood), block('wood', [-2.6, 2.6], rail, [-2.6, -2.52], wood));
  ps.push(block('wood', [-2.6, -2.52], rail, [-2.52, 2.52], wood), block('wood', [2.52, 2.6], rail, [-2.52, 2.52], wood));
  // ten-sided tank: staves are annular sectors sharing flat radial joints, with a steel band course
  let ty = deckTop;
  for (const [mat, h, tint] of [['wood', 1.5, TINT.woodDark], ['steel', 0.25, TINT.steelGrey], ['wood', 1.5, TINT.woodDark]] as const) {
    ps.push(...ringCourse(mat, 0, 0, [ty, ty + h], [1.94, 1.94], [2.12, 2.12], 10, { tint }));
    ty += h;
  }
  const lid = deckTop + 3.25;
  ps.push(cyl('wood', 4.44, [lid, lid + 0.15], 0, 0, { tint: TINT.woodDark }));
  ps.push(cyl('metal', 3.2, [lid + 0.15, lid + 0.45], 0, 0, { tint: TINT.steelGrey }));
  ps.push(cyl('metal', 1.8, [lid + 0.45, lid + 0.75], 0, 0, { tint: TINT.steelGrey }));
  ps.push(cyl('steel', 0.3, [lid + 0.75, lid + 1.25], 0, 0, steel));
  return put(ps, p, 'tower');
}

export function pumpHouse(p: Placement): PieceSpec[] {
  const X = 2, Z = 1.5, t = 0.25, h = 2.6;
  const wall = { mat: 'cinderblock' as const, t, y0: 0, h, lintel: 'rconcrete' as const, tint: TINT.concrete };
  const ps: PieceSpec[] = [
    ...wallRun({ ...wall, from: -X, to: X, at: Z - t / 2, openings: [{ c: -0.8, w: 0.9, y0: 0, h: 2.0 }, { c: 0.9, w: 0.8, y0: 0.9, h: 0.8 }] }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + t / 2, out: -1 }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, openings: [{ c: 0, w: 0.7, y0: 1.2, h: 0.6 }] }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2 }),
    ...panels('rconcrete', [-X - 0.15, 0, X + 0.15], [h, h + 0.2], [-Z - 0.15, Z + 0.15], { tint: TINT.concrete }),
    cyl('steel', 0.8, [0, 1.0], 0.6, -0.5, { tint: TINT.metalGreen, fixture: 'watermain' }),
    supplyBox([-1.4, -0.9], [1.2, 1.8], [-Z + t, -Z + t + 0.2]),
    ...conduit([[-1.15, 1.8, -Z + t + 0.1], [-1.15, h - 0.04, -Z + t + 0.1], [-1.15, h - 0.04, 0.2]]),
    lamp([-1.35, -0.95], [h - 0.3, h - 0.08], [-0.2, 0.2], LIGHT.cool),
    ...canopy({ face: Z }, [-1.35, -0.25], 2.05, 0.5, { t: 0.18, tint: TINT.steelGrey }),
    ...band({ mat: 'concrete', face: Z, from: -X, to: X, y: [h - 0.14, h], depth: 0.15, tint: TINT.darkConcrete }),
    ...downpipe({ face: -Z, out: -1 }, 1.8, [0, h]),
  ];
  // Pump shaft, bolted motor bed and outlet feed: separate pieces welded to the
  // existing casing, with the front door at x=-0.8 left clear.
  ps.push(block('steel', [0.16, 1.4], [0, 0.18], [-1.12, -0.9], { tint: TINT.steelGrey }));
  ps.push(block('steel', [0.16, 1.4], [0, 0.18], [-0.1, 0.12], { tint: TINT.steelGrey }));
  ps.push(block('steel', [0.35, 0.85], [1.0, 1.2], [-0.75, -0.25], { tint: TINT.iron, util: 'water' }));
  ps.push(...pipeRun('steel', 'y', [1.2, 2.1], [0.6, 0, -0.5], 0.24, { tint: TINT.steelRed, util: 'water' }));
  ps.push(cyl('steel', 0.38, [2.1, 2.23], 0.6, -0.5, { tint: TINT.steelRed, util: 'water' }));
  return put(ps, p, 'pumphouse');
}

/* ---------------- small stacks & protected site kit ---------------- */

/** Square brick stack on a concrete plinth with a corbelled head. */
export function brickStack(p: Placement & { courses: number; tint?: number }): PieceSpec[] {
  const o = { tint: p.tint };
  const courseH = 1.25, base = 0.5;
  const top = base + p.courses * courseH;
  const ps: PieceSpec[] = [
    block('concrete', [-1, 1], [0, base], [-1, 1], { tint: TINT.darkConcrete }),
    ...hollowStack('brick', 0, 0, base, 1.4, 0.3, courseH, p.courses, o),
    ...hollowStack('terracotta', 0, 0, top, 1.64, 0.36, 0.3, 1, { tint: TINT.terracotta }),
    block('stone', [-0.85, 0.85], [top + 0.3, top + 0.42], [-0.85, 0.85], { tint: TINT.darkConcrete }),
  ];
  return put(ps, p, 'stack');
}

/** Site office on blocks: steel chassis, clad box with windows, timber steps on the door side (+Z). */
export function siteOffice(p: Placement): PieceSpec[] {
  const X = 3.6, Z = 1.3, t = 0.08, y0 = 0.65, h = 2.3;
  const skin = { mat: 'metal' as const, t, y0, h, tint: TINT.metalWhite };
  const win = (c: number) => ({ c, w: 1.2, y0: 0.9, h: 0.9 });
  const ps: PieceSpec[] = [];
  for (const sx of [-2.8, 2.8]) for (const sz of [-0.9, 0.9]) ps.push(block('cinderblock', [sx - 0.25, sx + 0.25], [0, 0.45], [sz - 0.25, sz + 0.25], { tint: TINT.darkConcrete }));
  ps.push(block('steel', [-X, X], [0.45, y0], [-Z, Z], { tint: TINT.steelGrey }));
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: Z - t / 2, openings: [{ c: -2.4, w: 0.9, y0: 0, h: 2.0 }, win(-0.6), win(1.6)] }));
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: -Z + t / 2, out: -1, openings: [win(-1.6), win(1.0)] }));
  ps.push(...wallRun({ ...skin, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, openings: [{ c: 0, w: 0.8, y0: 0.9, h: 0.9 }] }));
  ps.push(...wallRun({ ...skin, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2, maxW: 2.5 }));
  ps.push(...panels('metal', [-X - 0.1, 0, X + 0.1], [y0 + h, y0 + h + 0.1], [-Z - 0.1, Z + 0.1], { tint: TINT.steelGrey }));
  ps.push(...place(stairs('wood', 0, [-0.5, 0.5], 0, 2, 0.3, 0.3, { tint: TINT.woodDark }), -2.4, Z + 0.6, 1));
  ps.push(...band({ mat: 'pvc', face: Z, from: -X, to: X, y: [y0 + h - 0.12, y0 + h], depth: 0.1, tint: 0x3a3d40 }), ...downpipe({ face: Z }, 3.3, [0, y0 + h - 0.12]));
  // site generator on the east end: its lead climbs the end wall to a floodlight over the door side
  ps.push(...place(generatorSet(), X + 0.65, 0, 1));
  ps.push(...conduit([[X + 0.2, 0.9, -0.75], [X + 0.04, 0.9, -0.75], [X + 0.04, y0 + h - 0.06, -0.75], [X + 0.04, y0 + h - 0.06, Z - 0.2]]));
  ps.push(lamp([X, X + 0.3], [y0 + h - 0.4, y0 + h - 0.1], [Z - 0.5, Z - 0.2], LIGHT.flood));
  return put(ps, p, 'office', { protected: true });
}

/** Parked panel van pointing +X (wheels fixed; see machines.ts for the driveable one). */
export function van(p: Placement & { tint?: number }): PieceSpec[] {
  return put(parkedVan(p.tint ?? TINT.vanWhite), p, 'van', { protected: true });
}

/** Parked saloon pointing +X. */
export function car(p: Placement & { tint?: number; protected?: boolean }): PieceSpec[] {
  return put(parkedSaloon(p.tint ?? TINT.carRed), p, 'car', { protected: p.protected ?? true });
}

/* ---------------- warehouse ---------------- */

/** 25 x 16 m steel portal hall with a load-bearing rear mezzanine, masonry base and roller-door bay. */
export function warehouse(p: Placement & { stock?: boolean }): PieceSpec[] {
  const X = 12.5, Z = 8, H = 7.2, c = 0.15;
  const xs = [-12.5, -6.25, 0, 6.25, 12.5];
  const steel = { tint: TINT.steelGrey };
  const ps: PieceSpec[] = [];
  for (const x of xs) for (const z of [-Z, 0, Z]) ps.push(...column('steel', x, z, [0, H], 2 * c, steel, 8));
  for (const x of [-X, X]) for (const z of [-4, 4]) ps.push(...column('steel', x, z, [0, H], 2 * c, steel, 8));
  for (const x of xs) {
    ps.push(block('steel', [x - c, x + c], [H, H + 0.4], [-Z - c, 0], steel), block('steel', [x - c, x + c], [H, H + 0.4], [0, Z + c], steel));
  }
  const bays: Range[] = [[-X - c, -6.25], [-6.25, 0], [0, 6.25], [6.25, X + c]];
  for (const z of [-Z, -4, 0, 4, Z]) for (const b of bays) ps.push(block('steel', b, [H + 0.4, H + 0.6], [z - 0.1, z + 0.1], steel));
  const roofTop = H + 0.7;
  ps.push(...panels('metal', [-X - c, -9.375, -6.25, -3.125, 0, 3.125, 6.25, 9.375, X + c], [H + 0.6, roofTop], [-Z - c, -4, 0, 4, Z + c], { tint: TINT.steelGrey }));
  const row = roofTop / 2;
  const clad = { mat: 'metal' as const, t: 0.1, h: row, maxW: 2.6, tint: TINT.metalBlue };
  const masonry = { mat: 'cinderblock' as const, t: 0.25, h: row, maxW: 2.6, tint: TINT.concrete, lintel: 'rconcrete' as const };
  const side = { ...clad, from: -X - c, to: X + c };
  const end = { ...clad, axis: 'z' as const, from: -Z - c - 0.1, to: Z + c + 0.1 };
  const clerestory = [-9.375, -3.125, 3.125, 9.375].map((cx) => ({ c: cx, w: 2.0, y0: 1.2, h: 1.4 }));
  ps.push(...wallRun({ ...side, ...masonry, at: Z + c + 0.125, y0: 0, openings: [{ c: 2.5, w: 3.8, y0: 0, h: row }] }));
  ps.push(...wallRun({ ...side, at: Z + c + 0.05, y0: row, openings: clerestory }));
  ps.push(...wallRun({ ...side, ...masonry, at: -Z - c - 0.125, y0: 0, out: -1 }));
  ps.push(...wallRun({ ...side, at: -Z - c - 0.05, y0: row, out: -1 }));
  ps.push(...wallRun({ ...end, ...masonry, at: X + c + 0.125, y0: 0, openings: [{ c: 1.5, w: 1.0, y0: 0, h: 2.2 }] }));
  ps.push(...wallRun({ ...end, at: X + c + 0.05, y0: row }));
  ps.push(...wallRun({ ...end, ...masonry, at: -X - c - 0.125, y0: 0, out: -1 }));
  ps.push(...wallRun({ ...end, at: -X - c - 0.05, y0: row, out: -1 }));
  // Grounded pilasters articulate the portal bays and tie the masonry to the roof-line frame.
  for (const x of [-6.25, 6.25]) for (const s of [-1, 1]) {
    const face = s * (Z + c + 0.25);
    ps.push(block('brick', [x - 0.22, x + 0.22], [0, row], s > 0 ? [face, face + 0.3] : [face - 0.3, face], { tint: TINT.brickDark }));
  }
  for (const xr of [[0.6, 2.5], [2.5, 4.4]] as Range[]) {
    ps.push(block('asphalt', xr, [0, 0.12], [Z + c + 0.25, Z + c + 1.25]));
  }
  // Rear-wall fire main: the floor riser, square elbow and individually capped
  // octagonal lengths weld to one another; clips bridge the gap to solid masonry.
  const fire = { tint: TINT.steelRed, util: 'water' as const };
  ps.push(...pipeRun('steel', 'y', [0, 2.39], [-6.25, 0, -8.98], 0.28, fire));
  ps.push(block('steel', [-6.41, -6.09], [2.39, 2.71], [-9.14, -8.82], fire));
  ps.push(...pipeRun('steel', 'x', [-6.09, 6.25], [0, 2.55, -8.98], 0.28, fire));
  ps.push(stopcock([-6.9, -6.39], [0, 0.5], [-9.2, -8.76]));
  ps.push(block('steel', [-6.36, -6.14], [0.9, 1.12], [-8.84, -8.7], steel));
  for (const x of [0, 4.8]) ps.push(block('steel', [x - 0.12, x + 0.12], [2.43, 2.67], [-8.84, -8.4], steel));
  // Rear half is a genuine second volume: transverse joists key into the portal posts,
  // and floor panels sit between (rather than intersecting) the joists and upright steel.
  for (const x of xs.slice(1, -1)) {
    ps.push(block('steel', [x - c, x + c], [3.35, 3.6], [-Z + c, -c], steel));
  }
  for (let i = 0; i < xs.length - 1; i++) {
    const xr: Range = [xs[i] + (i ? 0.07 : c), xs[i + 1] - (i === xs.length - 2 ? c : 0.07)];
    ps.push(block('wood', xr, [3.6, 3.8], [-Z + c, -4], { tint: TINT.woodPale }));
    ps.push(block('wood', xr, [3.6, 3.8], [-4, -c], { tint: TINT.woodPale }));
  }
  // Service bay at the west rear: a heavy floor machine and its heat source;
  // the middle roller door and the clear central aisle remain unobstructed.
  ps.push(...lineDrive(-10.8, -4.8), ...boiler(-9.0, -1.5));
  // Services: an in-house transformer in the front-west corner feeds a high-bay lamp run along the front
  // columns (with a drop out through the roller-door head to a yard lamp) and floor trunking to the line drive.
  // The boiler has its own gas meter and a steam main rising to the mezzanine.
  ps.push(supplyBox([-12.35, -11.2], [0, 1.8], [7.0, 8.15]));
  ps.push(...conduit([[-12.31, 1.8, 7.81], [-12.31, 5.54, 7.81], [12.35, 5.54, 7.81]]));
  for (const x of [-9.375, -3.125, 3.125, 9.375]) ps.push(lamp([x - 0.25, x + 0.25], [5.2, 5.5], [7.6, 7.85], LIGHT.bay));
  ps.push(...conduit([[4.3, 5.5, 7.81], [4.3, 3.91, 7.81], [4.3, 3.91, 8.6]]), lamp([4.0, 4.36], [3.62, 3.87], [8.35, 8.6], LIGHT.sodium));
  ps.push(...conduit([[-12.31, 0.04, 7.0], [-12.31, 0.04, -4.8], [-12.31, 1.24, -4.8], [-11.88, 1.24, -4.8]]));
  ps.push(gasMeter([-9.25, -8.75], [0, 0.9], [0.2, 0.6]), ...pipe('gas', 'steel', [[-9.0, 0.5, 0.2], [-9.0, 0.5, -0.68]], 0.1));
  ps.push(...pipe('steam', 'steel', [[-8.19, 1.9, -1.35], [-8.19, 1.9, -0.9], [-8.19, 3.6, -0.9]], 0.14));
  ps.push(...hydrant(8.5, 9.6));
  // Dressings: a coping on the masonry base where the cladding starts, gutters on both eaves, corner downpipes.
  const skin = Z + c + 0.1, endSkin = X + c + 0.1;
  for (const s of [-1, 1] as const) {
    ps.push(...band({ mat: 'concrete', face: s * skin, out: s, from: -X - c - 0.25, to: X + c + 0.25, y: [row, row + 0.1], depth: 0.25, tint: TINT.concrete }));
    ps.push(...band({ mat: 'concrete', axis: 'z', face: s * endSkin, out: s, from: -skin, to: skin, y: [row, row + 0.1], depth: 0.25, tint: TINT.concrete }));
    ps.push(...band({ mat: 'metal', face: s * skin, out: s, from: -endSkin, to: endSkin, y: [roofTop - 0.14, roofTop], depth: 0.14, tint: TINT.steelGrey }));
    for (const x of [-12.3, 12.3]) ps.push(...downpipe({ face: s * skin, out: s }, x, [row + 0.1, roofTop - 0.14]));
  }
  ps.push(block('metal', [0.4, 4.6], [4.2, 5.0], [skin, skin + 0.08], { tint: TINT.steelRed }));
  if (p.interior !== false) ps.push(...fit(racking(3), -10.9, 6.8, 0));
  ps.push(...canopy({ axis: 'z', face: X + c + 0.25 }, [0.8, 2.2], 2.36, 0.6, { t: 0.18, tint: TINT.steelGrey }));
  // External roof-line rigging and its low-strength electrical feed. The wall
  // fixtures touch solid cladding between, rather than through, the windows.
  ps.push(...riggingLine([-6.25, 7.03, 8.42], [6.25, 7.03, 8.42], 1.2));
  ps.push(...wireLine([-6.25, 6.65, 8.37], [6.25, 6.65, 8.37], 0.24));
  if (p.stock) {
    ps.push(...drums('propane', 0, -1.3, 0, 3, 2));
    ps.push(...drums('propane', -5, 4.5, 0, 2, 2));
    ps.push(...drums('barrel', 5.2, -4.2, 0, 3, 2));
    ps.push(...drums('barrel', -7.5, -5.5, 0, 2, 2));
    ps.push(...crates(-6.5, 1.5, 0, 3, 2, 2), ...crates(7, 3.5, 0, 2, 2, 2));
    ps.push(...tnt(4.6, 0.8, 0, 2));
  }
  return put(layerize(ps, { cladding: true, roofs: 'tile' }), p, 'warehouse');
}

/* ---------------- mill yard ---------------- */

/** Freestanding construction-services rack: grounded posts, continuous header,
 * cross-clips and two separable pipe runs (one fed by a ground riser). */
export function pipeRack(p: Placement): PieceSpec[] {
  const frame = { tint: TINT.steelGrey }, copper = { tint: TINT.bronze };
  const ps: PieceSpec[] = [
    ...column('steel', -2, 0, [0, 2.7], 0.32, frame),
    ...column('steel', 2, 0, [0, 2.7], 0.32, frame),
    block('steel', [-2.16, 2.16], [2.7, 2.95], [-0.16, 0.16], frame),
  ];
  for (const x of [-1, 1]) ps.push(block('steel', [x - 0.12, x + 0.12], [2.95, 3.09], [-0.79, 0.79], frame));
  const water = { ...copper, util: 'water' as const };
  ps.push(...pipeRun('copper', 'y', [0, 3.09], [-2.15, 0, 0.65], 0.28, water));
  ps.push(block('copper', [-2.31, -1.99], [3.09, 3.37], [0.49, 0.81], water));
  ps.push(...pipeRun('copper', 'x', [-1.99, 2.2], [0, 3.23, 0.65], 0.28, water));
  ps.push(stopcock([-2.7, -2.293], [0, 0.5], [0.45, 0.85]));
  ps.push(...pipeRun('steel', 'x', [-2.2, 2.2], [0, 3.23, -0.65], 0.28, frame));
  return put(ps, p, 'pipe-rack');
}

/* ---------------- mill yard ---------------- */

/** Tapering octagonal brick chimney (~26 m) on a hollow square plinth: every course is eight sloping-faced
    sector hulls, so the shaft is smooth outside and the joints are flat. */
export function industrialChimney(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [
    ...hollowStack('brick', 0, 0, 0, 4.4, 0.7, 1.5, 2, { tint: TINT.brickDark }),
    ...panels('stone', [-2.3, 2.3], [3.0, 3.3], [-2.3, 0, 2.3], { tint: TINT.darkConcrete }),
  ];
  const n = 11, y0 = 3.3, ch = 2.0;
  const outer = (f: number) => 2.05 - 0.75 * f, wall = (f: number) => 0.46 - 0.16 * f;
  for (let k = 0; k < n; k++) {
    const f0 = k / n, f1 = (k + 1) / n;
    ps.push(...ringCourse('brick', 0, 0, [y0 + k * ch, y0 + (k + 1) * ch], [outer(f0) - wall(f0), outer(f1) - wall(f1)], [outer(f0), outer(f1)], 8, { tint: TINT.brickDark }));
  }
  const top = y0 + n * ch, r1 = outer(1), w1 = wall(1);
  ps.push(...ringCourse('brick', 0, 0, [top, top + 0.7], [r1 - w1, r1 - w1], [r1, r1 + 0.22], 8, { tint: TINT.soot }));
  return put(ps, p, 'chimney', { age: { years: 130, exposure: 'outdoor' } });
}

/** Two-storey brick mill, 19 x 11 m: cast-iron columns, compartmented floors, stepped slate roof. */
export function mill(p: Placement & { stock?: boolean }): PieceSpec[] {
  const X = 9.5, Z = 5.5, t = 0.3, h1 = 3.8, h2 = 4.2;
  const wall = { mat: 'brick' as const, t, maxW: 2.4, tint: TINT.brickPale, sill: 'stone' as const };
  const w = (c: number, y0 = 0.9) => ({ c, w: 1.3, y0, h: 2.0 });
  const long = { ...wall, from: -X, to: X };
  const front = { ...long, lintel: 'stone' as const };
  const end = { ...wall, axis: 'z' as const, from: -Z + t, to: Z - t };
  const ps: PieceSpec[] = [
    ...wallRun({ ...front, at: Z - t / 2, y0: 0, h: h1, openings: [w(-6), w(-3), { c: 0, w: 2.2, y0: 0, h: 3.0 }, w(3), w(6)] }),
    ...wallRun({ ...front, at: Z - t / 2, y0: h1, h: h2, openings: [-6, -3, 0, 3, 6].map((c) => w(c, 0.8)) }),
    ...wallRun({ ...long, at: -Z + t / 2, out: -1, y0: 0, h: h1, openings: [-4.5, -1.5, 1.5, 4.5].map((c) => w(c)) }),
    ...wallRun({ ...long, at: -Z + t / 2, out: -1, y0: h1, h: h2, openings: [-4.5, -1.5, 1.5, 4.5].map((c) => w(c, 0.8)) }),
  ];
  for (const s of [-1, 1] as const) {
    ps.push(...wallRun({ ...end, at: s * (X - t / 2), out: s, y0: 0, h: h1, openings: [w(0, 0.8)] }));
    ps.push(...wallRun({ ...end, at: s * (X - t / 2), out: s, y0: h1, h: h2, openings: [w(-2, 0.8), w(2, 0.8)] }));
  }
  // Five grounded foundation wings spread the bearing-wall perimeter; the front
  // loading entrance stays open, and every wing meets masonry along its inner face.
  const foot = { tint: TINT.darkConcrete };
  ps.push(block('concrete', [-X - 0.4, X + 0.4], [0, 0.32], [-Z - 0.4, -Z], foot));
  ps.push(block('concrete', [-X - 0.4, -1.2], [0, 0.32], [Z, Z + 0.4], foot));
  ps.push(block('concrete', [1.2, X + 0.4], [0, 0.32], [Z, Z + 0.4], foot));
  for (const s of [-1, 1]) ps.push(block('concrete', s < 0 ? [-X - 0.4, -X] : [X, X + 0.4], [0, 0.32], [-Z, Z], foot));
  // first floor: girder on two columns, joists at the board seams, boards
  const inner = X - t, zi = Z - t;
  const seams = [inner * -1, ...splitRange(-inner, inner, 2.6).map((r) => r[1])];
  const g1 = seams[2], g2 = seams[4];
  for (const r of [[-inner, g1], [g1, g2], [g2, inner]] as Range[]) ps.push(block('castiron', r, [3.0, 3.3], [-0.15, 0.15], { tint: TINT.iron }));
  for (const x of [g1, g2]) ps.push(prism('castiron', 0.3, [0, 3.0], x, 0, 8, { tint: TINT.iron }));
  for (const x of seams.slice(1, -1)) {
    ps.push(block('wood', [x - 0.125, x + 0.125], [3.3, 3.6], [-zi, 0], { tint: TINT.woodDark }));
    ps.push(block('wood', [x - 0.125, x + 0.125], [3.3, 3.6], [0, zi], { tint: TINT.woodDark }));
  }
  // Recess the front board edge from the masonry by 4 cm: the joists still carry it,
  // without a numerically borderline corner weld to the window jambs.
  ps.push(...panels('wood', seams, [3.6, h1], [-zi, 0, zi - 0.04], { tint: TINT.woodPale }));
  // A grounded rear machine room carries the floor above; its central doorway is
  // cut into the masonry rather than simulated with a decorative surface.
  ps.push(...wallRun({ mat: 'brick', from: -inner, to: inner, at: -2.4, t: 0.22, y0: 0, h: 3.3,
    tint: TINT.brickDark, maxW: 3.4, openings: [{ c: 0, w: 1.4, y0: 0, h: 2.5, glass: false }] }));
  // The upper storey is divided, and the long external walls have a continuous stone
  // string course at the floor line. These bear against the masonry rather than intersect it.
  ps.push(...wallRun({ mat: 'brick', axis: 'z', from: -zi, to: zi, at: 0, t: 0.2, y0: h1, h: h2,
    tint: TINT.brickPale, openings: [{ c: 0, w: 1.1, y0: 0, h: 2.4 }] }));
  for (const s of [-1, 1]) {
    const face = s * Z;
    ps.push(block('stone', [-X, X], [h1 - 0.23, h1 - 0.02], s > 0 ? [face, face + 0.12] : [face - 0.12, face], { tint: TINT.stone }));
    ps.push(block('copper', [-X, X], [h1 + h2 - 0.12, h1 + h2 + 0.08], s > 0 ? [face, face + 0.18] : [face - 0.18, face], { tint: 0xb3a394 }));
  }
  // Cast-iron steam main on the blind portion of the west gable, above the
  // ground-floor window; brackets seat directly on the brick end wall.
  const steam = { tint: TINT.iron }, main = { tint: TINT.iron, util: 'water' as const };
  ps.push(...pipeRun('castiron', 'y', [0.32, 3.04], [-9.78, 0, -3.2], 0.28, main));
  ps.push(block('castiron', [-9.94, -9.62], [3.04, 3.36], [-3.36, -3.04], main));
  ps.push(...pipeRun('castiron', 'z', [-3.04, 3.2], [-9.78, 3.2, 0], 0.28, main));
  ps.push(stopcock([-9.94, -9.62], [0.32, 0.8], [-3.74, -3.34]));
  ps.push(block('castiron', [-9.64, -9.5], [1.05, 1.29], [-3.32, -3.08], steam));
  ps.push(block('castiron', [-9.64, -9.5], [3.08, 3.32], [2.45, 2.69], steam));
  ps.push(...pitchedRoof({ mat: 'roof', x: [-X - 0.3, X + 0.3], z: [-Z, Z], y: h1 + h2, rise: 3.1, thick: 0.28, seat: 0.2, maxW: 4.2,
    tint: TINT.slate, gables: { mat: 'brick', x: [[-X, -X + t], [X - t, X]], tint: TINT.brickPale } }));
  // queen-post trusses: tie beam between the wall heads, two queen posts, a straining beam between their heads,
  // and principal rafters from the tie ends to the posts, all under the slate slabs
  {
    const seat = 0.2, kk = 3.1 / (Z - seat), under = (dz: number) => h1 + h2 + kk * (Z - seat - dz), y = h1 + h2, oak = { tint: TINT.woodDark };
    for (const x of [-6.5, -3.2, 3.2, 6.5]) {
      const xr: Range = [x - 0.1, x + 0.1];
      ps.push(block('oak', [x - 0.12, x + 0.12], [y - 0.3, y], [-zi, zi], oak), block('oak', xr, [under(1.7) - 0.4, under(1.7) - 0.15], [-1.7, 1.7], oak));
      for (const s of [-1, 1]) {
        ps.push(block('oak', xr, [y, under(1.9)], s > 0 ? [1.7, 1.9] : [-1.9, -1.7], oak));
        ps.push(extrude('oak', [[s * zi, y], [s * zi, under(zi)], [s * 1.9, under(1.9)], [s * 1.9, under(1.9) - 0.3]], 'x', xr, oak));
      }
    }
  }
  if (p.interior !== false) {
    for (const [x, z] of [[-2.0, 2.5], [2.2, 3.2], [6.5, 1.2]]) ps.push(...fit(pallet(2), x, z, 0));
    for (const [x, z] of [[-6.8, 2.8], [-2.5, 2.8], [6.0, -2.5]]) ps.push(...fit(loom(), x, z, h1));
    ps.push(...fit(workbench(), 2.4, -1.6, 0));
  }
  // stone quoins up the front corners either side of the string course, and front downpipes
  for (const [u, dir] of [[-X, 1], [X, -1]] as const) {
    ps.push(...quoins({ face: Z }, u, dir, [0.32, h1 - 0.23], 4), ...quoins({ face: Z }, u, dir, [h1 - 0.02, h1 + h2 - 0.12], 5));
  }
  for (const x of [-8.6, 8.6]) ps.push(...downpipe({ face: Z }, x, [0.32, h1 - 0.23]), ...downpipe({ face: Z }, x, [h1 - 0.02, h1 + h2 - 0.12]));
  // Mill drive in the rear machine room; boiler on the east side of the
  // partition, leaving the 1.4 m central room door and loading axis open.
  ps.push(...lineDrive(-5.4, -3.85), ...boiler(5.4, -3.85));
  // Services: a supply box on the rear wall powers the line drive; a second on the west gable feeds a lamp run
  // along the girder's face. The boiler heats a radiator on the partition and has its own gas meter.
  ps.push(supplyBox([-7.3, -6.7], [0.8, 1.6], [-5.2, -5.0]), ...conduit([[-7.0, 1.0, -5.0], [-7.0, 1.0, -3.85], [-6.48, 1.0, -3.85]]));
  ps.push(supplyBox([-9.2, -8.9], [2.2, 2.9], [0.8, 1.3]), ...conduit([[-9.05, 2.9, 1.05], [-9.05, 3.14, 1.05], [-9.05, 3.14, 0.23]]));
  ps.push(...conduit([[-inner, 3.14, 0.19], [inner, 3.14, 0.19]]));
  for (const x of [-6, -2, 2, 6]) ps.push(lamp([x - 0.2, x + 0.2], [2.83, 3.1], [0.15, 0.5], LIGHT.warm));
  ps.push(...pipe('steam', 'steel', [[6.21, 1.9, -3.7], [6.21, 1.9, -2.62], [6.97, 1.9, -2.62]], 0.12), radiatorPanel([6.97, 7.97], [1.5, 2.3], [-2.66, -2.51]));
  ps.push(gasMeter([5.1, 5.7], [0, 0.9], [-3.03, -2.51]), ...pipe('gas', 'steel', [[5.4, 0.9, -2.58], [5.4, 2.4, -2.58]], 0.1));
  ps.push(...riggingLine([-7.7, 7.42, 5.67], [7.7, 7.42, 5.67], 1.0));
  ps.push(...wireLine([-7.7, 7.04, 5.62], [7.7, 7.04, 5.62], 0.16));
  if (p.stock) {
    ps.push(...crates(-4.5, -2, h1, 2, 2, 2), ...crates(4, 2.2, h1, 2, 1, 1));
    ps.push(...drums('barrel', -5.5, 2.5, 0, 2, 2), ...drums('barrel', 5, -1.5, 0, 2, 1));
  }
  return put(layerize(ps, { brick: 'english', timber: true, roofs: 'slate', stone: true }), p, 'mill', { age: { years: 150, exposure: 'wet' } });
}

/** Terrace of plastered cottages (protected when `protected` is set), each a different colour. */
export function cottageRow(p: Placement & { count?: number; protected?: boolean }): PieceSpec[] {
  const n = p.count ?? 3, bay = 4.8, X = (n * bay) / 2, Z = 3, t = 0.25, h = 2.7;
  const wall = { mat: 'plaster' as const, t, y0: 0, h };
  const centres = Array.from({ length: n }, (_, i) => -X + bay * (i + 0.5));
  const ps: PieceSpec[] = [
    ...wallRun({ ...wall, mullion: 'wood', mullionTint: TINT.white, from: -X, to: X, at: Z - t / 2, arris: 0.05,
      openings: centres.flatMap((c) => [{ c: c - 1.0, w: 0.9, y0: 0, h: 2.0 }, { c: c + 1.0, w: 1.2, y0: 0.8, h: 1.2 }]) }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + t / 2, out: -1, arris: 0.05, openings: centres.map((c) => ({ c, w: 1.0, y0: 0.9, h: 1.1 })) }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1 }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2 }),
  ];
  const party: Range[] = [];
  for (let i = 1; i < n; i++) {
    const x = -X + i * bay;
    party.push([x - 0.1, x + 0.1]);
    ps.push(...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: x, t: 0.2 }));
  }
  const palette = [TINT.pink, TINT.butter, TINT.blue, TINT.sage, TINT.white];
  for (const q of ps) if (q.mat === 'plaster') q.tint = palette[Math.min(n - 1, Math.max(0, Math.floor((q.pos[0] + X) / bay))) % palette.length];
  const roof = pitchedRoof({ mat: 'roof', x: [-X - 0.3, X + 0.3], z: [-Z, Z], y: h, rise: 2.0, thick: 0.25, seat: 0.15, maxW: 3.8, tint: TINT.slate,
    gables: { mat: 'plaster', x: [[-X, -X + t], ...party, [X - t, X]], tint: TINT.white }, barge: { tint: TINT.woodDark } });
  ps.push(...roof);
  // shared chimney stacks straddle the party walls, sitting on the ridge cap
  const ridge = Math.max(...roof.map((q) => q.pos[1] + q.size[1] / 2));
  for (const [a, b] of party) {
    const x = (a + b) / 2;
    ps.push(block('brick', [x - 0.35, x + 0.35], [ridge, ridge + 0.8], [-0.4, 0.4], { tint: TINT.brickDark }));
    for (const dx of [-0.17, 0.17]) ps.push(cyl('terracotta', 0.2, [ridge + 0.8, ridge + 1.15], x + dx, 0, { tint: TINT.terracotta }));
  }
  // door hoods, gutters front and back, downpipes on the party walls
  const gy: Range = [h - 0.14, h];
  for (const c of centres) ps.push(...canopy({ face: Z }, [c - 1.6, c - 0.4], 2.08, 0.55, { mat: 'wood', tint: TINT.woodDark, t: 0.18 }));
  for (const [z, out] of [[Z, 1], [-Z, -1]] as const) ps.push(...band({ mat: 'pvc', face: z, out, from: -X, to: X, y: gy, depth: 0.13, tint: 0x3a3d40 }));
  for (const [a, b] of party) ps.push(...downpipe({ face: Z }, (a + b) / 2, [0, gy[0]]));
  // each cottage: meter box on the back wall, a short lead up to a wall lamp
  const bi = -Z + t;
  for (const c of centres) {
    ps.push(supplyBox([c + 0.8, c + 1.3], [1.2, 1.8], [bi, bi + 0.2]), ...conduit([[c + 1.05, 1.8, bi + 0.1], [c + 1.05, 2.2, bi + 0.1]]));
    ps.push(lamp([c + 0.85, c + 1.25], [2.2, 2.45], [bi, bi + 0.25], LIGHT.warm));
  }
  return put(ps, p, 'cottages', { protected: p.protected, age: { years: 120, exposure: 'outdoor' } });
}

/* ---------------- overpass ---------------- */

/** 32 m two-lane overpass along X: twin-column piers, crossheads, precast girders, deck panels, parapets, lamps. */
export function overpass(p: Placement & { traffic?: boolean }): PieceSpec[] {
  const L = 16, W = 4.6;
  const con = { tint: TINT.concrete }, dark = { tint: TINT.darkConcrete };
  const ps: PieceSpec[] = [];
  const zHalves = [-W, 0, W];
  for (const x of [-8, 0, 8]) {
    for (const z of [-2.5, 2.5]) for (const y of [[0, 2.5], [2.5, 5.0]] as Range[]) ps.push(cyl('rconcrete', 1.0, y, x, z, con));
    ps.push(...panels('rconcrete', [x - 0.6, x + 0.6], [5.0, 5.8], zHalves, con));
  }
  for (const s of [-1, 1]) {
    const seat: Range = s > 0 ? [L - 0.6, L + 0.2] : [-L - 0.2, -L + 0.6];
    const ballast: Range = s > 0 ? [L, L + 0.2] : [-L - 0.2, -L];
    ps.push(...panels('concrete', seat, [0, 5.8], zHalves, dark), ...panels('concrete', ballast, [5.8, 6.85], zHalves, dark));
  }
  for (const z of [-3.3, -1.1, 1.1, 3.3]) {
    for (const span of [[-16, -8], [-8, 0], [0, 8], [8, 16]] as Range[]) ps.push(block('rconcrete', span, [5.8, 6.6], [z - 0.2, z + 0.2], con));
  }
  const xs = splitRange(-L, L, 2.7).map((r) => r[0]).concat(L);
  ps.push(...panels('rconcrete', xs, [6.6, 6.85], [-W, -1.5333, 1.5333, W], dark));
  ps.push(...panels('rconcrete', xs, [6.85, 7.85], [W - 0.25, W], con), ...panels('rconcrete', xs, [6.85, 7.85], [-W, -W + 0.25], con));
  for (const [x, s] of [[-12, 1], [-4, -1], [4, 1], [12, -1]]) {
    const post: Range = s > 0 ? [W - 0.2, W - 0.05] : [-W + 0.05, -W + 0.2];
    const arm: Range = s > 0 ? [W - 1.4, W - 0.05] : [-W + 0.05, -W + 1.4];
    const live = { tint: TINT.steelGrey, util: 'power' as const };
    ps.push(block('steel', [x - 0.075, x + 0.075], [7.85, 12.85], post, live));
    ps.push(block('steel', [x - 0.1, x + 0.1], [12.85, 13.0], arm, live));
    ps.push(supplyBox([x + 0.075, x + 0.4], [7.85, 8.6], post));
    ps.push(lamp([x - 0.15, x + 0.15], [12.6, 12.85], s > 0 ? [W - 1.4, W - 1.0] : [-W + 1.0, -W + 1.4], LIGHT.sodium));
  }
  if (p.traffic) {
    ps.push(...drums('barrel', -4, -2.6, 6.85, 3, 2), ...drums('propane', 4.4, 2.4, 6.85, 2, 2));
    ps.push(...crates(-10.5, 2.2, 6.85, 2, 2, 2), ...tnt(10, -2.4, 6.85, 2));
  }
  return put(ps, p, 'overpass', { age: { years: 55, exposure: 'salt' } });
}

export function busShelter(p: Placement): PieceSpec[] {
  const alu = { tint: TINT.metalGreen };
  const ps: PieceSpec[] = [];
  for (const x of [-1.55, 1.55]) for (const z of [-0.55, 0.55]) ps.push(block('aluminum', [x - 0.05, x + 0.05], [0, 2.4], [z - 0.05, z + 0.05], alu));
  ps.push(block('tempered', [-1.5, 1.5], [0, 2.3], [-0.58, -0.52]));
  ps.push(block('tempered', [-1.58, -1.52], [0, 2.3], [-0.5, 0.2]), block('tempered', [1.52, 1.58], [0, 2.3], [-0.5, 0.2]));
  ps.push(block('metal', [-1.7, 1.7], [2.4, 2.5], [-0.7, 0.7], alu));
  ps.push(block('wood', [-1.2, 1.2], [0, 0.45], [-0.52, -0.2], { tint: TINT.woodDark }));
  ps.push(lamp([-0.8, 0.8], [2.3, 2.4], [-0.45, -0.25], LIGHT.cool), supplyBox([0.8, 1.1], [2.1, 2.4], [-0.45, -0.25]));
  return put(ps, p, 'shelter', { protected: true });
}

/* ---------------- tower block ---------------- */

/** Concrete-frame tower, 2 x 2 bays of 6.25 m: compartment walls, slab panels, spandrels, glazing, roof plant. */
export function towerBlock(p: Placement & { storeys?: number }): PieceSpec[] {
  const n = p.storeys ?? 6, H = 3.6, slab = 0.2, bd = 0.4, B = 6.25;
  const lines = [-B, 0, B];
  const bays: Range[] = [[-B + 0.2, -0.2], [0.2, B - 0.2]];
  const con = { tint: TINT.concrete };
  const ps: PieceSpec[] = [];
  const g = GLASS_T / 2;
  const riserHole = { x: [1.9, 2.0] as Range, z: [0, 0.3] as Range }, cable = { tint: SVC.cable, util: 'power' as const };
  ps.push(supplyBox([1.3, 1.9], [0, 1.8], [0.15, 0.8]));
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab, beamY: Range = [top - bd, top];
    for (const x of lines) for (const z of lines) ps.push(...column('rconcrete', x, z, [y0, top], 0.4, con));
    for (const l of lines) {
      for (const b of bays) ps.push(...beam('rconcrete', 'x', b, beamY, l, 0.3, con), ...beam('rconcrete', 'z', b, beamY, l, 0.3, con));
    }
    // scissor stair in the back-left bay: each storey's straight flight runs the other way in the other strip,
    // so it lands against the slab edge beyond its own well and starts on solid slab clear of the next one
    const strip: Range = k % 2 ? [-4.95, -3.85] : [-6.05, -4.95];
    ps.push(...holedPanels('rconcrete', [-B - 0.2, -2.5, 0, 2.5, B + 0.2], [top, top + slab], [-B - 0.2, 0, B + 0.2], [riserHole, { x: strip, z: [-5.9, -0.9] }], con));
    ps.push(...stair({ axis: 'z', from: k % 2 ? -0.9 : -5.9, to: k % 2 ? -5.9 : -0.9, cross: strip, y0, y1: (k + 1) * H, mat: 'rconcrete', tint: TINT.concrete, open: 'hi', waist: true }));
    if (k > 0 && p.interior !== false) {
      ps.push(...fit(sofa(2.0), 3.1, 0.55, y0), ...fit(table(1.0, 0.6), 3.1, 2.4, y0), ...fit(bed(true), -3.1, 1.2, y0), ...fit(wardrobe(1.0), -5.75, 3.6, y0, 1));
      ps.push(...fit(kitchen(2.4), 3.0, -0.1, y0, 2), ...fit(table(1.2, 0.8), 2.5, -3.0, y0), ...fit(bookcase(1.0, 1.8), 5.9, -2.5, y0, 3));
    }
    // power riser through the slab hole, against the spine beam; one lamp per floor beside it
    ps.push(block('steel', riserHole.x, [y0, (k + 1) * H], [0.15, 0.25], cable));
    ps.push(lamp([2.0, 2.4], [top - 0.3, top], [0.15, 0.45], LIGHT.warm));
    const fill: Range = [y0, top - bd];
    const sill = y0 + 0.9;
    // each perimeter bay, written for the front face then mirrored to the others
    for (const [face, alongX, sign] of [['front', true, 1], ['back', true, -1], ['left', false, -1], ['right', false, 1]] as const) {
      const mat = alongX ? 'brick' as const : k % 2 ? 'ceramic' as const : 'plaster' as const;
      const tint = alongX ? TINT.brickPale : k % 2 ? 0xe1e4df : TINT.blue;
      for (const b of bays) {
        const halves: Range[] = [[b[0], (b[0] + b[1]) / 2], [(b[0] + b[1]) / 2, b[1]]];
        const bay: PieceSpec[] = [];
        if (k === 0 && face === 'front') {
          for (const u of halves) bay.push(block('tempered', u, fill, [-g, g]));
        } else if (k === 0) {
          for (const u of halves) bay.push(block(mat, u, fill, [-0.15, 0.15], { tint }));
        } else {
          bay.push(block(mat, b, [y0, sill], [-0.15, 0.15], { tint }));
          for (const u of halves) bay.push(block('glass', u, [sill, fill[1]], [-g, g]));
        }
        ps.push(...(alongX ? place(bay, 0, sign * B) : place(bay, sign * B, 0, 1)));
      }
    }
    // Two real fire compartments per floor, split at the central column. Door openings
    // retain circulation; each leaf keys into a column, the beam above and a slab below.
    for (const sign of [-1, 1]) {
      const from = sign < 0 ? -B + 0.2 : 0.2;
      const to = sign < 0 ? -0.2 : B - 0.2;
      ps.push(...wallRun({ mat: 'cinderblock', from, to, at: 0, t: 0.2,
        y0, h: H - slab - bd, maxW: 3.4, tint: TINT.darkConcrete,
        openings: [{ c: (from + to) / 2, w: 1.1, y0: 0, h: 2.35, glass: false }] }));
    }
  }
  const roof = n * H;
  // A substantial stone crown changes the roof silhouette without adding fragile trim
  // across the window bays or increasing the number of unsupported facade pieces.
  ps.push(block('stone', [-B - 0.25, B + 0.25], [roof + 1, roof + 1.18], [B - 0.05, B + 0.25], { tint: TINT.stone }));
  ps.push(block('stone', [-B - 0.25, B + 0.25], [roof + 1, roof + 1.18], [-B - 0.25, -B + 0.05], { tint: TINT.stone }));
  ps.push(...grid('rconcrete', [-B - 0.2, B + 0.2], [roof, roof + 1.0], [B - 0.05, B + 0.2], { x: 3.6 }, con));
  ps.push(...grid('rconcrete', [-B - 0.2, B + 0.2], [roof, roof + 1.0], [-B - 0.2, -B + 0.05], { x: 3.6 }, con));
  ps.push(...grid('rconcrete', [-B - 0.2, -B + 0.05], [roof, roof + 1.0], [-B + 0.05, B - 0.05], { z: 3.6 }, con));
  ps.push(...grid('rconcrete', [B - 0.05, B + 0.2], [roof, roof + 1.0], [-B + 0.05, B - 0.05], { z: 3.6 }, con));
  const plant = { mat: 'brick' as const, t: 0.2, y0: roof, h: 2.4, tint: TINT.brickPale };
  ps.push(...wallRun({ ...plant, from: -3, to: 0.4, at: 0.3, openings: [{ c: -1.8, w: 0.9, y0: 0, h: 2.0 }] }));
  ps.push(...wallRun({ ...plant, from: -3, to: 0.4, at: -2.9, out: -1 }));
  ps.push(...wallRun({ ...plant, axis: 'z', from: -2.8, to: 0.2, at: -2.9, out: -1 }));
  ps.push(...wallRun({ ...plant, axis: 'z', from: -2.8, to: 0.2, at: 0.3 }));
  ps.push(block('rconcrete', [-3.1, 0.5], [roof + 2.4, roof + 2.6], [-3.1, 0.5], con));
  ps.push(cyl('steel', 1.6, [roof + 2.6, roof + 4.0], -1.3, -1.3, { tint: TINT.steelGrey }));
  ps.push(cyl('aluminum', 0.12, [roof, roof + 4.5], 3.6, 3.6, { tint: TINT.steelGrey }));
  // The short variant fits the free-play piece cap; both sizes get a working
  // ground-floor plant, tucked against the back wall away from compartment doors.
  ps.push(block('steel', riserHole.x, [roof, roof + 1.28], [0.15, 0.25], cable), ...raise(place(hvacUnit(), 3.1, 0.2, 2), roof));
  // Dressings: louvred plant screens round the air handler, an entrance canopy on posts, a concrete fin up the
  // centre column line front and back, and balconies off the slab edges of both front bays.
  ps.push(block('metal', [1.9, 4.3], [roof, roof + 1.6], [1.6, 1.68], { tint: TINT.steelGrey }), block('metal', [4.5, 4.58], [roof, roof + 1.6], [-0.9, 1.68], { tint: TINT.steelGrey }));
  for (const u of [[-2.5, -0.2], [0.2, 2.5]] as Range[]) ps.push(block('metal', u, [3.0, 3.15], [B + 0.2, B + 1.6], { tint: TINT.steelGrey }));
  for (const x of [-2.3, 2.3]) ps.push(block('steel', [x - 0.06, x + 0.06], [0, 3.0], [B + 1.4, B + 1.52], { tint: TINT.steelGrey }));
  for (let k = 0; k < n; k++) for (const sz of [-1, 1]) ps.push(block('rconcrete', [-0.2, 0.2], [k * H, (k + 1) * H], sz > 0 ? [B + 0.2, B + 0.35] : [-B - 0.35, -B - 0.2], con));
  for (let k = 1; k < n; k++) for (const x of [-3.125, 3.125]) ps.push(...balcony({ face: B + 0.2 }, [x - 1.2, x + 1.2], k * H, 1.1, con));
  if (n <= 4) {
    ps.push(block('concrete', [2.2, 4.7], [0, 0.25], [-5.9, -4.35], con));
    ps.push(block('steel', [2.4, 4.5], [0.25, 1.65], [-5.7, -4.55], { tint: TINT.metalBlue, fixture: 'boiler' }));
    ps.push(block('metal', [2.35, 4.55], [1.65, 1.77], [-5.75, -4.5], { tint: TINT.steelGrey }));
    ps.push(block('steel', [2.75, 3.85], [0.62, 1.25], [-4.55, -4.46], { tint: TINT.iron }));
    ps.push(...pipeRun('steel', 'y', [1.77, 2.7], [3.45, 0, -5.1], 0.28, { tint: TINT.steelGrey }));
  } else {
    ps.push(...boiler(3.45, -4.85), ...radiator(1.19, -4.85), gasMeter([3.15, 3.75], [0, 0.9], [-4.03, -3.5]));
  }
  ps.push(...riggingLine([-3.2, roof + 0.54, B + 0.37], [3.2, roof + 0.54, B + 0.37], 0.42));
  return put(layerize(ps, { brick: 'cavity', floors: 'vinyl', partitions: true }), p, 'tower', { age: { years: 60, exposure: 'outdoor', cover: 0.02 } });
}

/** Protected corner chip shop with shopfront glazing and a fascia sign. */
export function chipShop(p: Placement): PieceSpec[] {
  const X = 3, Z = 2.5, t = 0.25, h = 3.0;
  const wall = { mat: 'plaster' as const, t, y0: 0, h, tint: TINT.butter };
  const ps: PieceSpec[] = [
    ...wallRun({ ...wall, from: -X, to: X, at: Z - t / 2, openings: [{ c: -1.9, w: 0.9, y0: 0, h: 2.2 }, { c: 0.9, w: 3.0, y0: 0.6, h: 1.9 }], maxW: 3.2, glazing: 'tempered',
      mullion: 'aluminum', mullionTint: 0x2f3336 }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + t / 2, out: -1 }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1 }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2 }),
    ...panels('rconcrete', [-X - 0.15, 0, X + 0.15], [h, h + 0.2], [-Z - 0.15, Z + 0.15], { tint: TINT.concrete }),
    block('metal', [-X - 0.15, X + 0.15], [h + 0.2, h + 0.8], [Z - 0.05, Z + 0.15], { tint: TINT.carTeal }),
    ...canopy({ face: Z }, [-0.7, 2.5], 2.55, 1.1, { tint: 0x2f7f7a, t: 0.24 }),
    ...awning([-2.55, -1.25], Z, 2.8, 2.4, 0.9, 0xc23b2e),
    block('metal', [2.86, 2.94], [2.2, 2.9], [Z, Z + 0.7], { tint: TINT.butter }),
    ...downpipe({ face: -Z, out: -1 }, 2.8, [0, h]),
    // fittings are fixed (the shop is someone's livelihood): counter, fryer range, back shelves
    ...(p.interior !== false ? [
      ...fit(bar(3.0, 0, { tint: 0xd9d4c8 }), -1.0, 0.2, 0),
      block('machine', [0.2, 1.6] as Range, [0, 0.95] as Range, [-Z + t, -Z + t + 0.65] as Range, { tint: 0xc8cccf }),
    ] : []),
    supplyBox([-2.0, -1.5], [1.4, 2.0], [-Z + t, -Z + t + 0.2]),
    ...conduit([[-1.75, 2.0, -Z + t + 0.1], [-1.75, h - 0.04, -Z + t + 0.1], [-1.75, h - 0.04, 0.5]]),
    lamp([-1.95, -1.55], [h - 0.33, h - 0.08], [0.05, 0.45], LIGHT.cool),
  ];
  return put(ps, p, 'chipshop', { protected: true });
}

/* ---------------- loose explosive caches ---------------- */

export function dump(p: Placement & { barrels?: [number, number]; propane?: [number, number]; tnt?: number; crates?: [number, number, number]; y?: number }): PieceSpec[] {
  const y = p.y ?? 0;
  const ps: PieceSpec[] = [];
  let off = 0;
  if (p.crates) { ps.push(...crates(p.crates[0] / 2, 0, y, ...p.crates)); off += p.crates[0] + 0.3; }
  if (p.barrels) { ps.push(...drums('barrel', off + (p.barrels[0] * 0.64) / 2, 0, y, ...p.barrels)); off += p.barrels[0] * 0.64 + 0.3; }
  if (p.propane) { ps.push(...drums('propane', off + (p.propane[0] * 0.54) / 2, 0, y, ...p.propane)); off += p.propane[0] * 0.54 + 0.3; }
  if (p.tnt) ps.push(...tnt(off + 0.3, 0, y, p.tnt));
  return put(ps, p, 'props');
}


/* ---------------- multi-storey ---------------- */

/** Brick walk-up, 12 x 8 m: bearing facades and spine wall, timber joists on hangers with board floors, rendered
    shop floor, steel fire escape on the +X gable, parapet roof with chimney stacks. */
export function apartmentBlock(p: Placement & { storeys?: number; shop?: boolean; scaffold?: boolean }): PieceSpec[] {
  const n = p.storeys ?? 4, H = 3.0, X = 6, Z = 4, t = 0.3, ts = 0.2;
  const shop = p.shop ?? true;
  const win = (c: number, w = 1.2) => ({ c, w, y0: 0.9, h: 1.5 });
  const door = (c: number, w = 1.0, h = 2.3) => ({ c, w, y0: 0, h });
  // escape landings alternate gable sides so each flight can climb past the one below
  const landing = (L: number): Range => (L % 2 === 1 ? [0.9, 3.9] : [-3.9, -0.9]);
  const ps: PieceSpec[] = [];
  for (let k = 0; k < n; k++) {
    const ground = k === 0;
    const skin = ground ? { mat: 'plaster' as const, tint: TINT.cream } : { mat: 'brick' as const, tint: TINT.brickDark };
    const base = { ...skin, t, y0: k * H, h: H, maxW: 2.4 };
    const front = ground && shop ? [{ c: -3, w: 3.4, y0: 0.5, h: 2.0 }, door(0.3), door(3.6)] : [-4, 0, 4].map((c) => win(c));
    ps.push(...wallRun({ ...base, lintel: ground ? undefined : 'stone', glazing: ground ? 'tempered' : 'glass', from: -X, to: X, at: Z - t / 2, openings: front }));
    ps.push(...wallRun({ ...base, lintel: ground ? undefined : 'stone', from: -X, to: X, at: -Z + t / 2, out: -1,
      openings: ground ? [win(-3, 1.0), door(3, 1.0, 2.2)] : [win(-3, 1.0), win(3, 1.0)] }));
    ps.push(...wallRun({ ...base, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, maxW: 3.8 }));
    ps.push(...wallRun({ ...base, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2, maxW: 3.8,
      openings: ground ? [] : [door((landing(k)[0] + landing(k)[1]) / 2, 0.9, 2.1)] }));
    ps.push(...wallRun({ mat: 'brick', tint: TINT.brickPale, t: ts, y0: k * H, h: H, from: -X + t, to: X - t, at: 0, maxW: 3.8,
      openings: [door(-1.5, 0.9, 2.1)] }));
  }
  // floors hang off the facades and spine on their joist ends (joist-hanger welds); the roof deck is felt on the same joists
  const zi = Z - t, zs = ts / 2;
  // power riser on the spine face through a hole in each board floor, one lamp per floor, intake in the shop
  const riserHole = { x: [2.0, 2.1] as Range, z: [zs, zs + 0.1] as Range };
  ps.push(supplyBox([1.5, 2.0], [0, 1.6], [zs, zs + 0.5]));
  ps.push(...splitRange(0, n * H - 0.08, 6).map((y) => block('steel', riserHole.x, y, riserHole.z, { tint: SVC.cable, util: 'power' })));
  for (let L = 1; L <= n; L++) {
    const F = L * H;
    const jy: Range = [F - 0.33, F - 0.08];
    for (const x of [-2.85, 0, 2.85]) {
      ps.push(block('wood', [x - 0.1, x + 0.1], jy, [zs, zi], { tint: TINT.woodDark }), block('wood', [x - 0.1, x + 0.1], jy, [-zi, -zs], { tint: TINT.woodDark }));
    }
    const deck = L === n ? { mat: 'roof' as const, tint: TINT.felt } : { mat: 'plywood' as const, tint: TINT.woodPale };
    for (const zr of [[-zi, -zs], [zs, zi]] as Range[]) {
      ps.push(...(L === n ? panels(deck.mat, [-X + t, 0, X - t], [F - 0.08, F], zr, { tint: deck.tint })
        : holedPanels(deck.mat, [-X + t, 0, X - t], [F - 0.08, F], zr, riserHole, { tint: deck.tint })));
    }
    ps.push(lamp([2.1, 2.5], [F - 0.38, F - 0.08], [zs, zs + 0.3], LIGHT.warm));
  }
  const top = n * H, py: Range = [top, top + 0.9];
  const brick = { tint: TINT.brickDark };
  ps.push(...grid('brick', [-X, X], py, [Z - t, Z], { x: 4.2 }, brick), ...grid('brick', [-X, X], py, [-Z, -Z + t], { x: 4.2 }, brick));
  ps.push(...grid('brick', [-X, -X + t], py, [-Z + t, Z - t], { z: 3.8 }, brick), ...grid('brick', [X - t, X], py, [-Z + t, Z - t], { z: 3.8 }, brick));
  for (const x of [-3.2, 3.2]) {
    ps.push(block('brick', [x - 0.45, x + 0.45], [top, top + 1.5], [-0.35, 0.35], brick));
    ps.push(cyl('terracotta', 0.22, [top + 1.5, top + 1.9], x, 0, { tint: TINT.terracotta }));
  }
  ps.push(...grid('terracotta', [-X - 0.1, X + 0.1], [top + 0.9, top + 1.05], [Z - t, Z + 0.1], { x: 4.2 }, { tint: TINT.terracotta }));
  // External copper water service on the unpierced west gable. The top elbow
  // feeds a parapet-level run; clips tie the line into brick, not window glass.
  const water = { tint: TINT.bronze, util: 'water' as const };
  ps.push(stopcock([-6.42, -6.14], [0, 0.45], [-2.88, -2.48]));
  ps.push(...pipeRun('copper', 'y', [0, top + 0.39], [-6.28, 0, -2.34], 0.28, water, 3.2));
  ps.push(block('copper', [-6.44, -6.12], [top + 0.39, top + 0.71], [-2.5, -2.18], water));
  ps.push(...pipeRun('copper', 'z', [-2.18, 2.5], [-6.28, top + 0.55, 0], 0.28, water));
  ps.push(block('steel', [-6.14, -6], [1.08, 1.32], [-2.46, -2.22], { tint: TINT.iron }));
  ps.push(block('steel', [-6.14, -6], [top + 0.43, top + 0.67], [1.48, 1.72], { tint: TINT.iron }));
  // Two independent building services ride the front parapet: a taut rigging
  // line and a fine insulated feed. Both lose their endpoints when it fractures.
  if (p.scaffold) {
    // Hang the lines off its outer standards, in front of the planks rather than
    // hiding them behind the scaffold and parapet.
    ps.push(...riggingLine([-3.6, top - 1, Z + 1.54], [3.6, top - 1, Z + 1.54], 0.65));
    ps.push(...wireLine([-3.6, top - 2.35, Z + 1.49], [3.6, top - 2.35, Z + 1.49], 0.18));
  } else {
    ps.push(...riggingLine([-4, top + 0.64, Z + 0.17], [4, top + 0.64, Z + 0.17], 0.9));
    ps.push(...wireLine([-4, top + 0.19, Z + 0.12], [4, top + 0.19, Z + 0.12], 0.16));
  }
  // A radiator on the rear wall, left of the rear service door; the shopfront,
  // spine opening and alternating fire-escape landings stay unblocked.
  ps.push(...radiator(-3.0, -3.5, 0), wallBoiler([-1.92, -1.42], [0.9, 1.7], [-zi, -zi + 0.4]), gasMeter([-1.92, -1.42], [0, 0.5], [-zi, -zi + 0.3]));
  ps.push(...pipe('gas', 'copper', [[-1.67, 0.5, -zi + 0.15], [-1.67, 0.9, -zi + 0.15]], 0.1));
  if (n >= 4) ps.push(...boiler(3.7, -2.35), gasMeter([3.4, 4.0], [0, 0.9], [-1.53, -1.0]));
  if (shop) ps.push(block('metal', [-4.8, -1.2], [2.55, 2.95], [Z, Z + 0.08], { tint: TINT.carTeal }));
  // flats: kitchen on the back wall, bathroom suite, living room and bedroom furniture; the shop gets gondolas and a counter
  if (p.interior !== false) {
    for (let k = 1; k < n; k++) {
      const y = k * H;
      ps.push(...fit(kitchen(2.4), -1.2, -zi, y), ...fit(table(1.2, 0.8), -1.0, -1.6, y), ...fit(bathroom(), 2.4, -zi, y));
      ps.push(...fit(sofa(1.8), -3.5, zs + 0.45, y), ...fit(table(0.9, 0.6), -3.5, 2.2, y), ...fit(bed(true), 3.1, zs + 1.1, y), ...fit(wardrobe(1.0), 5.4, 2.6, y, 3));
    }
    if (shop) ps.push(...fit(shelving(1.8), -3.2, 1.25, 0), ...fit(shelving(1.8, {}, 2), -3.2, 0.4, 0), ...fit(bar(1.6, 0, { tint: 0xd9d4c8 }), 2.3, 1.9, 0));
  }
  // Dressings: stone string courses at each floor line, a cornice under the parapet, a shop awning, rear downpipes
  // and, without scaffold, balconies on the middle bay.
  const stone = { mat: 'stone' as const, tint: TINT.stone, depth: 0.08 };
  for (let L = 1; L < n; L++) {
    const y: Range = [L * H - 0.04, L * H + 0.12];
    ps.push(...band({ ...stone, face: Z, from: -X, to: X, y }), ...band({ ...stone, face: -Z, out: -1, from: -5.4, to: 5.4, y }));
    if (!p.scaffold) ps.push(...balcony({ face: Z }, [-1.1, 1.1], L * H + 0.27, 0.95, { tint: TINT.concrete }));
  }
  ps.push(...band({ ...stone, face: Z, from: -X, to: X, y: [top - 0.26, top], depth: 0.16, profile: 'cornice' }));
  ps.push(...band({ ...stone, face: -Z, out: -1, from: -5.4, to: 5.4, y: [top - 0.26, top], depth: 0.16, profile: 'cornice' }));
  if (shop && !p.scaffold) ps.push(...canopy({ face: Z }, [-4.9, -1.1], 2.36, 1.0, { tint: 0x9c3b34, t: 0.18 }));
  for (const x of [-5.7, 5.7]) ps.push(...downpipe({ face: -Z, out: -1 }, x, [0, top + 0.9]));
  // fire escape
  const iron = { tint: TINT.iron };
  const fx: Range = [X, X + 1.2], post: Range = [X + 1.2, X + 1.32];
  for (let L = 1; L < n; L++) {
    const F = L * H, zr = landing(L);
    ps.push(block('steel', fx, [F - 0.15, F], zr, iron));
    const edge = zr[0] > 0 ? zr[0] : zr[1];
    const from = L === 1 ? -3.3 : -edge;
    ps.push(...flight({ mat: 'steel', axis: 'z', from, to: edge, cross: [X + 0.1, X + 1.1], y0: F - H, steps: 6, rise: H / 6, seat: L > 1, ...iron }));
  }
  for (const side of [1, 2]) {
    let hi = 0;
    for (let L = side; L < n; L += 2) hi = L;
    if (!hi) continue;
    const zr = landing(side);
    const inner: Range = zr[0] > 0 ? [zr[0], zr[0] + 0.12] : [zr[1] - 0.12, zr[1]];
    const outer: Range = zr[0] > 0 ? [zr[1] - 0.12, zr[1]] : [zr[0], zr[0] + 0.12];
    for (const z of [inner, outer]) ps.push(...grid('steel', post, [0, hi * H + 1.0], z, { y: 4.5 }, iron));
    for (let L = side; L <= hi; L += 2) {
      const rail: Range = zr[0] > 0 ? [inner[1], outer[0]] : [outer[1], inner[0]];
      ps.push(block('steel', post, [L * H + 0.85, L * H + 1.0], rail, iron));
    }
  }
  if (p.scaffold) ps.push(...scaffold({ from: -X, to: X, face: Z, height: top + 0.9, tint: TINT.steelGrey, wrap: 'tarp' }));
  for (let k = 1; k < n; k++) ps.push(...curtains({ face: Z - t, into: -1, c: 0, w: 1.2, head: k * H + 2.4, drop: 1.5, fabric: k % 2 ? 'velvet' : 'cotton', tint: [0x6e1f2a, 0xd9cfb8, 0x2f4a6e][k % 3] }));
  return put(layerize(ps, { brick: 'cavity', render: true, timber: true, lining: true, partitions: true }), p, 'flats');
}

/** Open-deck concrete car park, 18.5 x 16.5 m: flat-slab decks on columns, edge upstands, lapped ramps that
    alternate sides deck to deck, and a stair tower on the -X end. */
export function carPark(p: Placement & { decks?: number; cars?: number }): PieceSpec[] {
  const D = p.decks ?? 3, H = 3.0, slab = 0.3, e = 0.2;
  const colX = [-9, -3, 3, 9], colZ = [-8, -8 / 3, 8 / 3, 8];
  const xs = [-9.25, -3, 3, 9.25], zs = [-8.25, -8 / 3, 8 / 3, 8.25];
  const con = { tint: TINT.concrete }, dark = { tint: TINT.darkConcrete };
  // each deck has a two-bay hole along one side strip where the ramp from the deck below arrives
  const holeStrip = (deck: number) => (deck % 2 === 1 ? 0 : 2);
  const has = (deck: number, i: number, j: number) => i >= 0 && i < 3 && j >= 0 && j < 3 && (deck === 0 || j !== holeStrip(deck) || i === 0);
  const ps: PieceSpec[] = [];
  for (let s = 0; s < D; s++) {
    const y0 = s * H, top = (s + 1) * H, d = s + 1;
    for (let il = 0; il < 4; il++) {
      for (let jl = 0; jl < 4; jl++) {
        const carries = [il - 1, il].some((i) => [jl - 1, jl].some((j) => has(d, i, j)));
        if (!carries) continue;
        // a column standing in the ramp hole of the deck below drops through it to the deck under that
        const standsOnDeck = s === 0 || [il - 1, il].some((i) => [jl - 1, jl].some((j) => has(s, i, j)));
        // flat slab: the column stops under a drop panel that spreads the punching load into the slab
        const dp = 0.39, cx = colX[il], cz = colZ[jl];
        ps.push(...column('rconcrete', cx, cz, [standsOnDeck ? y0 : y0 - H, top - slab - 0.25], 0.5, con, 6));
        ps.push(block('rconcrete', [Math.max(xs[0], cx - dp), Math.min(xs[3], cx + dp)], [top - slab - 0.25, top - slab], [Math.max(zs[0], cz - dp), Math.min(zs[3], cz + dp)], con));
      }
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (has(d, i, j)) ps.push(block('rconcrete', [xs[i], xs[i + 1]], [top - slab, top], [zs[j], zs[j + 1]], con));
    // edge upstands run between column faces so the next storey's columns stand clear of them
    const by: Range = [top, top + 1.0];
    for (let i = 0; i < 3; i++) {
      const xr: Range = [colX[i] + 0.25, colX[i + 1] - 0.25];
      if (has(d, i, 0)) ps.push(block('rconcrete', xr, by, [zs[0], zs[0] + e], dark));
      if (has(d, i, 2)) ps.push(block('rconcrete', xr, by, [zs[3] - e, zs[3]], dark));
    }
    for (let j = 0; j < 3; j++) {
      const zr: Range = [colZ[j] + 0.25, colZ[j + 1] - 0.25];
      if (has(d, 0, j)) ps.push(block('rconcrete', [xs[0], xs[0] + e], by, zr, dark));
      if (has(d, 2, j)) ps.push(block('rconcrete', [xs[3] - e, xs[3]], by, zr, dark));
    }
    const cross: Range = holeStrip(d) === 0 ? [-7.6, -3.1] : [3.1, 7.6];
    const x0 = s === 0 ? xs[3] : xs[3] - e;
    ps.push(...flight({ mat: 'rconcrete', axis: 'x', from: x0, to: xs[1], cross, y0, steps: 10, rise: H / 10, ...dark }));
    // prop under tread 4, clear of tread 3 below it
    const run = (x0 - xs[1]) / 10, zc = (cross[0] + cross[1]) / 2;
    ps.push(block('rconcrete', [x0 - 5.8 * run, x0 - 5.2 * run], [y0, y0 + 4 * (H / 10)], [zc - 0.3, zc + 0.3], con));
  }
  ps.push(...hollowStack('cinderblock', xs[0] - 1.6, 0, 0, 3.2, 0.25, H, D + 1, dark));
  // switchback stair inside the tower: a flight to a half landing, a flight back to the deck-level landing
  {
    const cx = xs[0] - 1.6, b = 1.35, A: Range = [cx - b, cx - 0.05], Bs: Range = [cx + 0.05, cx + b];
    for (let L = 0; L < D; L++) {
      const y = L * H, mid = y + H / 2, up = (L + 1) * H;
      ps.push(block('rconcrete', [cx - b, cx + b], [mid - 0.2, mid], [0.8, b], con), block('rconcrete', [cx - b, cx + b], [up - 0.2, up], [-b, -0.8], con));
      ps.push(...stair({ axis: 'z', from: -0.8, to: 0.8, cross: A, y0: y, y1: mid, steps: 8, seat: true, mat: 'rconcrete', tint: TINT.concrete, open: 'hi' }));
      ps.push(...stair({ axis: 'z', from: 0.8, to: -0.8, cross: Bs, y0: mid, y1: up, steps: 8, seat: true, mat: 'rconcrete', tint: TINT.concrete, open: 'lo' }));
    }
  }
  ps.push(block('rconcrete', [xs[0] - 3.3, xs[0]], [(D + 1) * H, (D + 1) * H + 0.2], [-1.7, 1.7], con));
  ps.push(block('metal', [xs[0] - 2.6, xs[0] - 0.6], [(D + 1) * H - 2.6, (D + 1) * H - 0.6], [1.6, 1.68], { tint: TINT.metalBlue }));
  // coping rails on the top deck upstands, a cornice round the stair tower head, corner downpipes
  {
    const top = D * H + 1.0, rail = { tint: TINT.steelGrey };
    for (let i = 0; i < 3; i++) {
      const xr: Range = [colX[i] + 0.25, colX[i + 1] - 0.25];
      if (has(D, i, 0)) ps.push(block('steel', xr, [top, top + 0.08], [zs[0] - 0.05, zs[0] + e], rail));
      if (has(D, i, 2)) ps.push(block('steel', xr, [top, top + 0.08], [zs[3] - e, zs[3] + 0.05], rail));
    }
    for (let j = 0; j < 3; j++) {
      const zr: Range = [colZ[j] + 0.25, colZ[j + 1] - 0.25];
      if (has(D, 0, j)) ps.push(block('steel', [xs[0], xs[0] + e], [top, top + 0.08], zr, rail));
      if (has(D, 2, j)) ps.push(block('steel', [xs[3] - e, xs[3] + 0.05], [top, top + 0.08], zr, rail));
    }
    const ty: Range = [(D + 1) * H - 0.25, (D + 1) * H];
    ps.push(...band({ mat: 'concrete', face: 1.6, from: xs[0] - 3.2, to: xs[0], y: ty, depth: 0.1, profile: 'cornice', ...dark }));
    ps.push(...band({ mat: 'concrete', face: -1.6, out: -1, from: xs[0] - 3.2, to: xs[0], y: ty, depth: 0.1, profile: 'cornice', ...dark }));
    ps.push(...band({ mat: 'concrete', axis: 'z', face: xs[0] - 3.2, out: -1, from: -1.6, to: 1.6, y: ty, depth: 0.1, profile: 'cornice', ...dark }));
    for (const [x, z] of [[-8.9, 1], [8.9, 1], [-8.9, -1], [8.9, -1]] as const) ps.push(...downpipe({ face: z * zs[3], out: z }, x, [0, top]));
  }
  // strip lights under every deck on a conduit fed by a riser on the west slab edges
  ps.push(supplyBox([-9.85, -9.33], [0, 1.4], [-2.3, -1.7]), ...splitRange(0, D * H, 6).map((y) => block('steel', [-9.33, -9.25], y, [-2.0, -1.92], { tint: SVC.cable, util: 'power' })));
  for (let s = 1; s <= D; s++) {
    const u = s * H - slab;
    ps.push(...conduit([[-9.25, u - 0.04, -1.96], [9.25, u - 0.04, -1.96]], {}, 0.08, 'pvc', 6.2));
    for (const x of [-6, 0, 6]) ps.push(lamp([x - 0.6, x + 0.6], [u - 0.18, u - 0.08], [-2.08, -1.84], LIGHT.cool));
  }
  const parked = [car({ x: -6, z: 5.3, protected: false }), car({ x: 6, z: 0, tint: TINT.carTeal, protected: false })];
  ps.push(...raise(parked.slice(0, p.cars ?? 0).flat(), H));
  return put(ps, p, 'carpark', { age: { years: 50, exposure: 'salt', cover: 0.025 } });
}

/** Steel-frame office, 12.5 m square: I-section columns (two flanges and a web), I-beams (web and bottom flange)
    framing into the column webs through fin plates and onto the flanges through end plates, composite floors
    (steel deck under a concrete topping), a scissor stair behind a concrete core wall, storey-high
    curtain-wall glass on the slab edges between aluminium mullions and fins, open-plan desks, metal parapet and
    rooftop plant. */
const UC305: PieceSpec['section'] = { kind: 'I', t: 0.0154, tw: 0.0099, axis: 1, depth: 2 };
const UB457: NonNullable<PieceSpec['section']> = { kind: 'I', t: 0.0145, tw: 0.009, depth: 1 };

export function officeBlock(p: Placement & { storeys?: number }): PieceSpec[] {
  const n = p.storeys ?? 4, H = 3.6, slab = 0.2, bd = 0.45, B = 6, E = 6.25;
  const lines = [-B, 0, B];
  const bays: Range[] = [[-B + 0.15, -0.15], [0.15, B - 0.15]];
  const steel = { tint: TINT.steelGrey }, con = { tint: TINT.concrete }, glaze = { tint: TINT.blueGlass };
  // panes sit just outside the columns (0.04 clear) so they weld only to the slabs and each other
  const g = E - GLASS_T;
  const along = [-E, -E / 2, 0, E / 2, E], across = [-g, -g / 2, 0, g / 2, g];
  const riserHole = { x: [1.9, 2.0] as Range, z: [0, 0.23] as Range }, cable = { tint: SVC.cable, util: 'power' as const };
  const ps: PieceSpec[] = [supplyBox([1.3, 1.9], [0, 1.8], [0.13, 0.8])];
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab, by: Range = [top - bd, top];
    const tf = 0.06, fy: Range = [by[0], by[0] + tf], wy: Range = [by[0] + tf, top];
    // UC 305x305x97 columns and UB 457x191x74 beams, each one rigid I-section body (plates drawn 60 mm)
    for (const x of lines) for (const z of lines) {
      ps.push(weldParts([
        block('steel', [x - 0.15, x + 0.15], [y0, top], [z + 0.09, z + 0.15], steel), block('steel', [x - 0.15, x + 0.15], [y0, top], [z - 0.15, z - 0.09], steel),
        block('steel', [x - 0.03, x + 0.03], [y0, top], [z - 0.09, z + 0.09], steel),
      ], { section: UC305 }));
    }
    const ty: Range = [top - tf, top], cw: Range = [wy[0], top - tf];
    for (const l of lines) for (const b of bays) {
      // along X the coped web runs between the column flanges to the column web, with fin plates to the flanges;
      // both flanges stop clear of them
      const wb: Range = [b[0] - 0.12, b[1] + 0.12];
      ps.push(weldParts([
        block('steel', wb, cw, [l - 0.03, l + 0.03], steel), block('steel', b, ty, [l - 0.1, l + 0.1], steel), block('steel', b, fy, [l - 0.1, l + 0.1], steel),
        ...[[wb[0], b[0]], [b[1], wb[1]]].map(([x0, x1]) => block('steel', [x0, x1], [by[0] + 0.1, top - 0.08], [l + 0.03, l + 0.09], steel)),
      ], { section: { ...UB457, axis: 0 } }));
      ps.push(weldParts([
        block('steel', [l - 0.03, l + 0.03], cw, b, steel), block('steel', [l - 0.1, l + 0.1], ty, b, steel), block('steel', [l - 0.1, l + 0.1], fy, b, steel),
      ], { section: { ...UB457, axis: 2 } }));
    }
    const strip: Range = k % 2 ? [-4.7, -3.6] : [-5.8, -4.7];
    const holes = [riserHole, { x: strip, z: [-5.6, -0.8] as Range }];
    ps.push(...holedPanels('metal', [-E, -3, 0, 3, E], [top, top + 0.08], [-E, 0, E], holes, { tint: 0x8d949b }));
    ps.push(...holedPanels('rconcrete', [-E, -3, 0, 3, E], [top + 0.08, top + slab], [-E, 0, E], holes, con));
    ps.push(...stair({ axis: 'z', from: k % 2 ? -0.8 : -5.6, to: k % 2 ? -5.6 : -0.8, cross: strip, y0, y1: (k + 1) * H, mat: 'steel', tint: TINT.steelGrey, open: 'hi', waist: true }));
    // reinforced-concrete stair core wall between the stair and the floor plate, with its door
    ps.push(...wallRun({ mat: 'rconcrete', axis: 'z', from: -B + 0.1, to: -0.1, at: -3.45, t: 0.2, y0, h: top - y0, maxW: 3, tint: TINT.darkConcrete,
      openings: [{ c: -3.2, w: 1.0, y0: 0, h: 2.2, glass: false }] }));
    if (p.interior !== false) {
      if (k === 0) ps.push(...fit(bar(2.4, 0, { tint: 0xd9d4c8 }), -1.2, 4.2, y0), ...fit(sofa(2.0, { tint: 0x3f4f5f }), 3.1, 5.4, y0, 2));
      else {
        for (const x of [2.0, 4.1]) for (const z of [2.3, 4.3]) ps.push(...fit(desk(), x, z, y0), ...fit(chair(), x, z + 0.8, y0));
        for (const u of [[1.2, 2.8], [3.3, 4.9]] as Range[]) ps.push(...fit(screen(u[1] - u[0]), (u[0] + u[1]) / 2, 3.5, y0));
        ps.push(...fit(filingCabinet(), -2.2, 5.6, y0, 2), ...fit(filingCabinet(), -1.6, 5.6, y0, 2));
        ps.push(...fit(table(1.8, 0.9), 3.0, -3.0, y0), ...fit(chair(), 2.4, -2.1, y0), ...fit(chair(), 3.6, -2.1, y0));
        ps.push(...fit(desk(), -2.0, 2.5, y0), ...fit(chair(), -2.0, 3.3, y0));
      }
    }
    ps.push(block('steel', riserHole.x, [y0, (k + 1) * H], [0.13, 0.23], cable), lamp([2.0, 2.4], [top - 0.3, top], [0.13, 0.43], LIGHT.cool));
    // panes stand on the slab edge with a movement joint under the steel deck above; the mullions span both
    const gy: Range = [y0, top], pane: Range = [y0, top - 0.03];
    for (let i = 0; i < 4; i++) {
      const a: Range = [along[i], along[i + 1]], c: Range = [across[i], across[i + 1]];
      ps.push(block('tempered', a, pane, [g, E], glaze), block('tempered', a, pane, [-E, -g], glaze));
      ps.push(block('tempered', [g, E], pane, c, glaze), block('tempered', [-E, -g], pane, c, glaze));
    }
    // Actual exterior mullions at the central seam give the curtain wall a reveal
    // and a metallic silhouette; each touches two panes and the slab above.
    for (const sign of [-1, 1]) {
      const face = sign * E;
      const edge: Range = sign > 0 ? [face, face + 0.12] : [face - 0.12, face];
      // mullion with its pressure cap: 0.2 m on the glass line, tapering to a 0.1 m nose
      const nose = edge[sign > 0 ? 1 : 0], back = edge[sign > 0 ? 0 : 1], cap: [number, number][] = [[-0.1, back], [0.1, back], [0.05, nose], [-0.05, nose]];
      ps.push(hull('aluminum', cap.flatMap(([u, v]) => gy.map((y) => [u, y, v] as Vec3)), { tint: TINT.metalBlue, finish: 'satin' }));
      ps.push(hull('aluminum', cap.flatMap(([u, v]) => gy.map((y) => [v, y, u] as Vec3)), { tint: TINT.metalBlue, finish: 'satin' }));
    }
  }
  const roof = n * H, py: Range = [roof, roof + 0.9], metal = { tint: TINT.steelGrey };
  ps.push(...grid('aluminum', [-E, E], py, [E - 0.15, E], { x: 6.5 }, metal), ...grid('aluminum', [-E, E], py, [-E, -E + 0.15], { x: 6.5 }, metal));
  ps.push(...grid('aluminum', [-E, -E + 0.15], py, [-E + 0.15, E - 0.15], { z: 6.5 }, metal), ...grid('aluminum', [E - 0.15, E], py, [-E + 0.15, E - 0.15], { z: 6.5 }, metal));
  const plant: Range = [roof, roof + 2.6], white = { tint: TINT.metalWhite };
  ps.push(block('metal', [-3.5, 1.5], plant, [-0.6, -0.5], white), block('metal', [-3.5, 1.5], plant, [-3.5, -3.4], white));
  ps.push(block('metal', [-3.5, -3.4], plant, [-3.4, -0.6], white), block('metal', [1.4, 1.5], plant, [-3.4, -0.6], white));
  ps.push(block('metal', [-3.6, 1.6], [roof + 2.6, roof + 2.7], [-3.6, -0.4], metal));
  ps.push(block('steel', [2.5, 3.9], [roof, roof + 1.0], [2.5, 3.5], metal));
  ps.push(block('steel', riserHole.x, [roof, roof + 1.28], [0.13, 0.23], cable), ...raise(place(hvacUnit(), 3.1, 0.2, 2), roof));
  // Dressings: aluminium fins at the quarter points front and back (each keyed to the slab edge above it),
  // a projecting coping on those parapets and an entrance canopy on posts.
  for (let k = 0; k < n; k++) {
    for (const sz of [-1, 1]) for (const x of [-E / 2, E / 2]) {
      ps.push(block('aluminum', [x - 0.06, x + 0.06], [k * H, (k + 1) * H], sz > 0 ? [E, E + 0.35] : [-E - 0.35, -E], { tint: TINT.metalBlue }));
    }
  }
  for (const sz of [-1, 1]) ps.push(...band({ mat: 'aluminum', face: sz * (E - 0.15), out: sz as 1 | -1, from: -E, to: E, y: [roof + 0.9, roof + 1.02], depth: 0.55, maxW: 6.5, tint: TINT.metalWhite }));
  ps.push(block('metal', [-2.2, 2.2], [H - slab, H - slab + 0.15], [E + 0.35, E + 1.8], { tint: TINT.steelGrey }));
  for (const x of [-2.0, 2.0]) ps.push(block('steel', [x - 0.06, x + 0.06], [0, H - slab], [E + 1.6, E + 1.72], { tint: TINT.steelGrey }));
  return put(layerize(ps, { curtain: true, floors: 'tile' }), p, 'office');
}

/** Two-storey timber-framed barn, 12 x 7.5 m: full-height posts, hayloft on tie beams, wall plates, king-post
    trusses, plank cladding with barn and loft doors, shingle roof on purlins. Nearly all timber, so it snaps and burns. */
export function timberBarn(p: Placement & { hay?: boolean }): PieceSpec[] {
  const px = [-6, -2, 2, 6], pz = 3.75, w = 0.25, hw = w / 2, loft = 3.0, eave = 5.8;
  const oak = { tint: TINT.woodDark }, pine = { tint: TINT.woodPale };
  const ps: PieceSpec[] = [];
  for (const x of px) {
    for (const z of [-pz, pz]) ps.push(block('oak', [x - hw, x + hw], [0, eave], [z - hw, z + hw], oak));
    ps.push(block('oak', [x - hw, x + hw], [loft - 0.25, loft], [-pz + hw, pz - hw], oak));
    ps.push(block('oak', [x - hw, x + hw], [eave + 0.25, eave + 0.5], [-pz - hw, pz + hw], oak));
  }
  ps.push(...panels('plywood', [-2, 2, 6], [loft, loft + 0.08], [-pz + hw, -1.2083, 1.2083, pz - hw], pine));
  for (const z of [-pz, pz]) {
    for (const r of [[-6 - hw, -2], [-2, 2], [2, 6 + hw]] as Range[]) ps.push(block('oak', r, [eave, eave + 0.25], [z - hw, z + hw], oak));
  }
  const base = eave + 0.5;
  const skin = { mat: 'wood' as const, t: 0.08, maxW: 3.5, tint: TINT.barnRed };
  const X = 6 + hw + 0.08, Zc = pz + hw + 0.04, Xc = 6 + hw + 0.04;
  const rows: [number, number][] = [[0, loft], [loft, base - loft]];
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: Zc, y0: 0, h: loft, openings: [{ c: 0, w: 3.2, y0: 0, h: 2.8 }] }));
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: Zc, y0: loft, h: base - loft, openings: [{ c: 0, w: 1.6, y0: 0.4, h: 1.8, glass: false }] }));
  for (const [y0, h] of rows) ps.push(...wallRun({ ...skin, from: -X, to: X, at: -Zc, out: -1, y0, h }));
  const vent = { c: 0, w: 0.8, y0: 1.4, h: 0.8, glass: false };
  for (const s of [-1, 1] as const) {
    const end = { ...skin, axis: 'z' as const, from: -pz - hw, to: pz + hw, at: s * Xc, out: s };
    ps.push(...wallRun({ ...end, y0: 0, h: loft, openings: s > 0 ? [{ c: 0, w: 1.2, y0: 0, h: 2.2 }] : [] }));
    ps.push(...wallRun({ ...end, y0: loft, h: base - loft, openings: [vent] }));
  }
  const zr = pz + hw + 0.08, seat = 0.2, rise = 3.0;
  ps.push(...pitchedRoof({ mat: 'wood', x: [-6.6, 6.6], z: [-zr, zr], y: base, rise, thick: 0.26, seat, maxW: 4.5, tint: TINT.shingle,
    gables: { mat: 'wood', x: [[-X, -X + 0.08], [X - 0.08, X]], tint: TINT.barnRed } }));
  // king posts with gabled heads bearing on both roof slabs at the ridge
  const k = rise / (zr - seat), apex = base + rise;
  for (const x of [-2, 2]) {
    const pts: [number, number, number][] = [];
    for (const xx of [x - 0.1, x + 0.1]) {
      for (const z of [-0.1, 0.1]) pts.push([xx, base, z], [xx, apex - k * 0.1, z]);
      pts.push([xx, apex, 0]);
    }
    ps.push(hull('oak', pts, oak));
  }
  // bracketed hay hood over the loft door
  ps.push(...canopy({ face: Zc + 0.04 }, [-1.1, 1.1], 5.3, 0.8, { mat: 'wood', tint: TINT.woodDark, t: 0.25, brackets: true }));
  if (p.hay) {
    ps.push(...crates(4, -1.8, loft + 0.08, 2, 2, 2), ...crates(0, 2.2, loft + 0.08, 2, 1, 1), ...crates(-4, 1.5, 0, 1, 2, 1));
    ps.push(...drums('barrel', -4, -2.3, 0, 2, 1));
  }
  return put(ps, p, 'barn');
}

/** Sandstone chapel with a stone west tower: buttressed nave (wedge weatherings) with stained-glass lancets and
    a rose window, marble porch, pitched slate roof, octagonal oak belfry with a cast bell, and an octagonal slate
    spire of tapering hull facets (~27 m). */
export function chapel(p: Placement & { graves?: number }): PieceSpec[] {
  const t = 0.45, h = 5.2, X0 = -5, X1 = 9, Z = 3.5;
  const sand = { tint: TINT.sand }, stone = { tint: TINT.stone }, slate = { tint: TINT.slate }, oak = { tint: TINT.woodDark };
  const stained = [0xd05a50, 0x5a78d0, 0xe0b848, 0x68b078];
  const lancet = (c: number) => ({ c, w: 0.8, y0: 1.4, h: 2.8 });
  const wall = { mat: 'sandstone' as const, t, y0: 0, h, maxW: 2.6, ...sand };
  // three-leaf walls: dressed ashlar faces either side of a lime-and-rubble core; only the core carries the glazing
  const leaves = (w: WallRunOpts): PieceSpec[] => {
    const s = w.out ?? 1, f = 0.12, core = t - 2 * f, dry = (w.openings ?? []).map((o) => ({ ...o, glass: false }));
    return [
      ...wallRun({ ...w, t: f, at: w.at + s * (t - f) / 2, openings: dry }),
      ...wallRun({ ...w, t: core, at: w.at, mat: 'concrete', tint: 0xb5a88f, sill: undefined, maxW: 3.4 }),
      ...wallRun({ ...w, t: f, at: w.at - s * (t - f) / 2, openings: dry, sill: undefined }),
    ];
  };
  const ps: PieceSpec[] = [
    ...leaves({ ...wall, from: X0, to: X1, at: Z - t / 2, openings: [{ c: -3, w: 1.4, y0: 0, h: 2.8 }, lancet(0), lancet(3), lancet(6)] }),
    ...leaves({ ...wall, from: X0, to: X1, at: -Z + t / 2, out: -1, openings: [-3, 0, 3, 6].map(lancet) }),
    ...leaves({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X1 - t / 2, openings: [{ c: 0, w: 2.4, y0: 1.6, h: 2.4, glass: false }] }),
    ...leaves({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X0 + t / 2, out: -1 }),
  ];
  // rose window: stone tracery rows filling the east opening, glass inside a circle, central mullion
  const rx: Range = [X1 - t, X1], gx: Range = [X1 - t / 2 - GLASS_T / 2, X1 - t / 2 + GLASS_T / 2], m = 0.07;
  for (let k = 0; k < 8; k++) {
    const y: Range = [1.6 + 0.3 * k, 1.9 + 0.3 * k];
    const dy = Math.max(Math.abs(y[0] - 2.8), Math.abs(y[1] - 2.8));
    const w = Math.min(1.1, Math.sqrt(Math.max(0, 1.44 - dy * dy)));
    if (w < m + 0.1) { ps.push(block('stone', rx, y, [-1.2, 1.2], stone)); continue; }
    ps.push(block('stone', rx, y, [-1.2, -w], stone), block('stone', rx, y, [-m, m], stone), block('stone', rx, y, [w, 1.2], stone));
    ps.push(block('glass', gx, y, [-w, -m], { tint: stained[k % 4] }), block('glass', gx, y, [m, w], { tint: stained[(k + 2) % 4] }));
  }
  ps.filter((q) => q.mat === 'glass' && q.tint === undefined).forEach((q, i) => { q.tint = stained[i % stained.length]; });
  // buttresses: two stages, each weathered back to the wall with a wedge
  for (const s of [-1, 1]) {
    for (const bx of [-1.35, 1.5, 4.5, 7.7]) {
      const zz = (d0: number, d1: number): Range => (s > 0 ? [Z + d0, Z + d1] : [-Z - d1, -Z - d0]);
      const x: Range = [bx - 0.3, bx + 0.3], toWall = s > 0 ? '-z' : '+z';
      ps.push(block('stone', x, [0, 2.6], zz(0, 0.7), stone), wedge('stone', x, [2.6, 2.9], zz(0.45, 0.7), toWall, stone));
      ps.push(block('stone', x, [2.6, 4.2], zz(0, 0.45), stone), wedge('stone', x, [4.2, 4.8], zz(0, 0.45), toWall, stone));
    }
  }
  const pz = Z + 1.6;
  for (const x of [-3.75, -2.25]) ps.push(prism('marble', 0.35, [0, 2.8], x, pz, 16, { tint: TINT.white }));
  ps.push(block('stone', [-4.0, -2.0], [2.8, 3.1], [pz - 0.25, pz + 0.25], stone), block('roof', [-4.2, -1.8], [3.1, 3.3], [Z, pz + 0.3], slate));
  const roof = pitchedRoof({ mat: 'roof', x: [X0, X1 + 0.3], z: [-Z, Z], y: h, rise: 3.8, thick: 0.4, seat: 0.25, maxW: 3.6, tint: TINT.slate,
    gables: { mat: 'sandstone', x: [[X0, X0 + t], [X1 - t, X1]], tint: TINT.sand } });
  ps.push(...roof);
  const ridge = Math.max(...roof.map((q) => q.pos[1] + q.size[1] / 2)), cx = X1 - 0.4;
  ps.push(block('stone', [cx - 0.12, cx + 0.12], [ridge, ridge + 1.2], [-0.12, 0.12], stone));
  for (const z of [[0.12, 0.45], [-0.45, -0.12]] as Range[]) ps.push(block('stone', [cx - 0.12, cx + 0.12], [ridge + 0.55, ridge + 0.8], z, stone));
  // tower: hollow ashlar courses with the west face of the first course opened into a doorway
  const tx = X0 - 2.1, a = 2.1, towerTop = 12.5;
  const tower = hollowStack('stone', tx, 0, 0, 2 * a, 0.55, 2.5, 5, stone);
  // (each course is one ring body: drop the first ring's west wall)
  tower[0].parts = tower[0].parts!.filter((q) => !(q.pos[0] < -1 && Math.abs(q.pos[2]) < 1e-6));
  const wx: Range = [tx - a, tx - a + 0.55];
  tower.push(block('stone', wx, [0, 2.5], [-a + 0.55, -0.6], stone), block('stone', wx, [0, 2.5], [0.6, a - 0.55], stone),
    block('stone', wx, [2.2, 2.5], [-0.6, 0.6], stone));
  ps.push(...tower, block('plaster', [tx - 0.6, tx + 0.6], [10.3, 11.5], [a, a + 0.08], { tint: TINT.white }));
  // octagonal belfry: floor, eight posts on the octagon corners, louvre boards between them, a cornice ring
  const post = 1.65, by: Range = [towerTop + 0.15, towerTop + 3.15];
  ps.push(prism('oak', 4.0, [towerTop, by[0]], tx, 0, 8, oak));
  for (let i = 0; i < 8; i++) {
    const ap = Math.PI / 8 + (i * Math.PI) / 4, am = ap + Math.PI / 8;
    ps.push(prism('oak', 0.3, by, tx + post * Math.cos(ap), post * Math.sin(ap), 8, oak));
    const rm = post * Math.cos(Math.PI / 8), chord = 2 * post * Math.sin(Math.PI / 8) - 0.3;
    const louvre = box('wood', [chord, 1.4, 0.1], [tx + rm * Math.cos(am), 13.4 + 0.7, rm * Math.sin(am)], { tint: TINT.woodPale });
    louvre.rotY = -(am + Math.PI / 2);
    ps.push(louvre);
  }
  const spireY = by[1] + 0.25;
  ps.push(prism('stone', 4.3, [by[1], spireY], tx, 0, 8, stone));
  ps.push(block('oak', [tx - 1.2, tx + 1.2], [by[1] - 0.3, by[1]], [-0.15, 0.15], oak));
  ps.push(cyl('castiron', 1.0, [by[1] - 1.2, by[1] - 0.3], tx, 0, { tint: TINT.bronze }));
  // spire: eight slate facets per stage, each a tapering sector hull; the facets meet on flat radial joints
  const vr = 2.0 / Math.cos(Math.PI / 8), mid = spireY + 5.2, apex = mid + 4.6;
  ps.push(...ringCourse('roof', tx, 0, [spireY, mid], [vr - 0.24, 0.72], [vr, 0.95], 8, slate, Math.PI / 8));
  ps.push(...ringCourse('roof', tx, 0, [mid, apex], [0.72, 0], [0.95, 0.16], 8, slate, Math.PI / 8));
  ps.push(prism('steel', 0.2, [apex, apex + 1.4], tx, 0, 8, { tint: TINT.bronze }));
  // Dressings: a plinth and a sill-level string course between the buttresses, hood moulds over the lancets and a
  // cornice along both eaves.
  for (const s of [-1, 1] as const) {
    const segs: Range[] = s > 0 ? [[X0, -3.7], [-2.3, -1.65], [-1.05, 1.2], [1.8, 4.2], [4.8, 7.4], [8.0, X1]] : [[X0, -1.65], [-1.05, 1.2], [1.8, 4.2], [4.8, 7.4], [8.0, X1]];
    for (const [a, b] of segs) {
      ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: a, to: b, y: [0, 0.4], depth: 0.1, tint: TINT.stone }));
      ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: a, to: b, y: [1.2, 1.32], depth: 0.1, profile: 'drip', tint: TINT.stone }));
    }
    for (const c of s > 0 ? [0, 3, 6] : [-3, 0, 3, 6]) ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: c - 0.5, to: c + 0.5, y: [4.2, 4.36], depth: 0.1, profile: 'drip', tint: TINT.stone }));
    ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: X0, to: X1, y: [4.9, h], depth: 0.22, profile: 'cornice', tint: TINT.stone }));
  }
  // two oak tie beams carry chandeliers on chains; their feed runs from a west-wall supply along the north wall head
  const zi = Z - t;
  ps.push(supplyBox([X0 + t, X0 + t + 0.2], [1.0, 1.6], [2.2, 2.7]));
  ps.push(...conduit([[X0 + t + 0.1, 1.6, 2.45], [X0 + t + 0.1, 4.78, 2.45], [X0 + t + 0.1, 4.78, zi - 0.04], [4.9, 4.78, zi - 0.04]]));
  for (const x of [0.75, 4.75]) ps.push(...conduit([[x, 4.86, zi], [x, 4.86, 0]]), ...pendant(x, 0, 4.82, 1.3, LIGHT.candle, 0.5));
  // king-post trusses: tie beam on the wall heads, king post to the ridge, principal rafters under the slates
  {
    const half = Z, seat = 0.25, kk = 3.8 / (half - seat), under = (dz: number) => h + kk * (half - seat - dz);
    for (const x of [-2.6, 0.75, 4.75, 7.4]) {
      ps.push(block('oak', [x - 0.15, x + 0.15], [4.9, h], [-zi, zi], oak), block('oak', [x - 0.1, x + 0.1], [h, under(0.12)], [-0.12, 0.12], oak));
      for (const s of [-1, 1]) ps.push(extrude('oak', [[s * zi, h], [s * zi, under(zi)], [s * 0.12, under(0.12)], [s * 0.12, under(0.12) - 0.3]], 'x', [x - 0.1, x + 0.1], oak));
    }
  }
  // flagged floor, altar and two blocks of pews facing east
  for (const x of splitRange(X0 + t, X1 - t, 3.4)) for (const z of [[-zi, 0], [0, zi]] as Range[]) ps.push(block('stone', x, [0, 0.1], z, { tint: 0xc9c1b0 }));
  ps.push(block('marble', [7.4, 8.2], [0.1, 1.05], [-0.9, 0.9], { tint: TINT.white }));
  if (p.interior !== false) for (let x = -2.4; x <= 5.9; x += 0.95) for (const z of [-1.7, 1.7]) ps.push(...fit(pew(2.2), x, z, 0.1, 1));
  for (let i = 0; i < (p.graves ?? 0); i++) {
    const gx0 = -1 + (i % 5) * 2.2, gz = Z + 2.5 + Math.floor(i / 5) * 2.2;
    ps.push(block('marble', [gx0 - 0.3, gx0 + 0.3], [0, 0.85], [gz - 0.08, gz + 0.08], { tint: TINT.white }));
  }
  ps.push(flagpole(X0 - 2.1 + 1.75, 1.75, 12.5, 3.2, [1.3, 0.85], 0xf2f2ee));
  return put(layerize(ps, { stone: true, roofs: 'slate', timber: true }), p, 'chapel', { age: { years: 170, exposure: 'wet' } });
}

/** Rotunda: stepped stone platform, eight round marble columns, an octagonal entablature ring and a coursed
    octagonal dome of sector hulls closed by a lantern. */
export function rotunda(p: Placement): PieceSpec[] {
  const stone = { tint: TINT.stone }, marble = { tint: TINT.white };
  const ps: PieceSpec[] = [prism('stone', 8.0, [0, 0.3], 0, 0, 16, stone), prism('stone', 7.3, [0.3, 0.6], 0, 0, 16, stone)];
  const colTop = 4.6, ph = Math.PI / 8;
  for (let i = 0; i < 8; i++) {
    const a = ph + (i * Math.PI) / 4;
    ps.push(prism('marble', 0.5, [0.6, colTop], 3.0 * Math.cos(a), 3.0 * Math.sin(a), 16, marble));
  }
  const ring: Range = [colTop, colTop + 0.6];
  ps.push(...ringCourse('stone', 0, 0, ring, [2.55, 2.55], [3.5, 3.5], 8, stone, ph));
  // dome courses cut from a spherical shell centred on the entablature top
  const Ro = 3.45, Ri = 3.05, yc = ring[1], cuts = [0, 1.0, 1.9, 2.6, 3.0];
  const rad = (r: number, y: number) => Math.sqrt(Math.max(0, r * r - y * y));
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    ps.push(...ringCourse('stone', 0, 0, [yc + a, yc + b], [rad(Ri, a), rad(Ri, b)], [rad(Ro, a), rad(Ro, b)], 8, { tint: TINT.cream }, ph));
  }
  const top = yc + cuts[cuts.length - 1];
  ps.push(prism('stone', 2.2, [top, top + 0.9], 0, 0, 8, stone), prism('stone', 1.2, [top + 0.9, top + 1.3], 0, 0, 8, stone));
  ps.push(prism('steel', 0.18, [top + 1.3, top + 2.3], 0, 0, 8, { tint: TINT.bronze }));
  return put(ps, p, 'rotunda');
}

/** Cast-iron spiral stair round a newel, climbing to a round landing on top of the newel. */
export function spiralFolly(p: Placement & { steps?: number }): PieceSpec[] {
  const n = p.steps ?? 14, rise = 0.25, top = n * rise;
  const iron = { tint: TINT.iron };
  const ps = spiralStair({ mat: 'castiron', cx: 0, cz: 0, y0: 0, steps: n, rise, rIn: 0.16, rOut: 1.1, turn: Math.PI / 7, width: Math.PI / 5, ...iron });
  // the newel stops under the landing, which also bears on the last tread
  const newel = ps.filter((q) => q.shape === 'prism');
  const keep = ps.filter((q) => q.shape !== 'prism');
  const post = newel[0];
  const out: PieceSpec[] = [...keep];
  for (const y of splitRange(0, top, 4)) out.push(prism('castiron', post.size[0], y, 0, 0, 16, iron));
  out.push(prism('plywood', 2.6, [top, top + 0.1], 0, 0, 16, { tint: TINT.woodPale }));
  return put(out, p, 'spiral');
}

/* ---------------- intricate showpieces ---------------- */

/** Semicircular stone arch bridge along X: thirteen radiating hull voussoirs per ring (two rings across the width)
    with a keystone rising to the deck, sandstone spandrel courses and columns cut to the extrados, paved deck,
    parapets with copings and stone stairs at both ends. */
export function stoneArchBridge(p: Placement): PieceSpec[] {
  const R = 3.0, T = 0.6, N = 13, ys = 0.6, L = 13, W = 3.2;
  const stone = { tint: TINT.stone }, sand = { tint: TINT.sand }, key = { tint: 0xd8d2c4 };
  const at = (r: number, i: number): [number, number] => {
    const a = Math.PI - (i * Math.PI) / N;
    return [r * Math.cos(a), ys + r * Math.sin(a)];
  };
  const I = (i: number) => at(R, i), E = (i: number) => at(R + T, i);
  const yD = ys + R + T + 0.3, kst = (N - 1) / 2;
  const ps: PieceSpec[] = [];
  const mirror = (pr: [number, number][]) => pr.map(([x, y]) => [-x, y] as [number, number]);
  for (const z of [[-W / 2, 0], [0, W / 2]] as Range[]) {
    const slab = (pr: [number, number][], mat: 'stone' | 'sandstone', o: PieceOpts) => ps.push(extrude(mat, pr, 'z', z, o));
    for (let i = 0; i < N; i++) {
      const pr: [number, number][] = [I(i), I(i + 1), E(i + 1), E(i)];
      if (i === kst) pr.push([E(i)[0], yD], [E(i + 1)[0], yD]);
      slab(pr, 'stone', i === kst ? key : stone);
    }
    for (const m of [false, true]) {
      const f = (pr: [number, number][]) => (m ? mirror(pr) : pr);
      for (let i = 0; i < 3; i++) slab(f([[-L / 2, E(i)[1]], E(i), E(i + 1), [-L / 2, E(i + 1)[1]]]), 'sandstone', sand);
      slab(f([[-L / 2, E(3)[1]], [E(3)[0], E(3)[1]], [E(3)[0], yD], [-L / 2, yD]]), 'sandstone', sand);
      for (let i = 3; i < kst; i++) slab(f([E(i), E(i + 1), [E(i + 1)[0], yD], [E(i)[0], yD]]), 'sandstone', sand);
      ps.push(block('stone', m ? [R, L / 2] : [-L / 2, -R], [0, ys], z, stone));
    }
    for (const u of splitRange(-L / 2, L / 2, 3.3)) ps.push(block('stone', u, [yD, yD + 0.3], z, stone));
  }
  const top = yD + 0.3;
  for (const s of [-1, 1]) {
    const wall: Range = s > 0 ? [W / 2 - 0.3, W / 2] : [-W / 2, -W / 2 + 0.3];
    const cope: Range = s > 0 ? [W / 2 - 0.35, W / 2 + 0.05] : [-W / 2 - 0.05, -W / 2 + 0.35];
    for (const u of splitRange(-L / 2, L / 2, 3.3)) {
      ps.push(block('sandstone', u, [top, top + 0.8], wall, sand), block('stone', u, [top + 0.8, top + 0.92], cope, stone));
    }
  }
  // stairs at a real rise and going (≈0.18 × 0.28), turning off a landing at each end to run along the bank
  const steps = Math.ceil(top / 0.18), run = 0.28, land: Range = [L / 2, L / 2 + W], fw = 1.8, py: Range = [top, top + 0.8];
  const end = [
    block('stone', land, [0, top], [-W / 2, W / 2], stone),
    ...place(stairs('stone', -steps * run, [-land[1], -land[1] + fw], 0, steps, top / steps, run, stone), 0, -W / 2, 3),
    block('sandstone', land, py, [W / 2 - 0.3, W / 2], sand), block('sandstone', [land[1] - 0.3, land[1]], py, [-W / 2, W / 2 - 0.3], sand),
    block('sandstone', [land[0], land[1] - fw], py, [-W / 2, -W / 2 + 0.3], sand),
  ];
  ps.push(...end, ...place(end, 0, 0, 2));
  ps.push(...place(streetLamp(6, 1.1), -8, -2.2), ...place(streetLamp(6, 1.1), 8, 2.2, 2));
  return put(ps, p, 'archbridge', { age: { years: 160, exposure: 'wet' } });
}

/** 20 m Warren truss footbridge: bottom and top chords, stepped diagonals, cross girders, timber deck,
    top lateral struts, concrete abutments and approach steps. */
export function trussBridge(p: Placement): PieceSpec[] {
  const half = 10, panel = 4, yb = 1.2, H = 3.5, zc = 2.2, c = 0.125;
  const steel = { tint: TINT.metalGreen };
  const yTop = yb + H;
  const ps: PieceSpec[] = [];
  const bottoms = Array.from({ length: 6 }, (_, i) => -half + i * panel);
  const tops = bottoms.slice(0, 5).map((x) => x + panel / 2);
  for (const s of [-1, 1]) {
    const cz: Range = [s * zc - c, s * zc + c], plane: Range = [s * zc - 0.08, s * zc + 0.08];
    for (let i = 0; i < 5; i++) ps.push(block('steel', [bottoms[i], bottoms[i + 1]], [yb, yb + 0.3], cz, steel));
    for (let i = 0; i < 4; i++) ps.push(block('steel', [tops[i], tops[i + 1]], [yTop - 0.3, yTop], cz, steel));
    tops.forEach((t, i) => {
      for (const from of [bottoms[i], bottoms[i + 1]]) {
        ps.push(...flight({ mat: 'steel', axis: 'x', from, to: t, cross: plane, y0: yb + 0.3, steps: 4, rise: (H - 0.6) / 4, lap: 0.15, ...steel }));
      }
    });
  }
  const inner: Range = [-zc + c, zc - c];
  const girders = [-half + 0.15, ...bottoms.slice(1, 5), half - 0.15];
  for (const x of girders) ps.push(block('steel', [x - 0.15, x + 0.15], [yb, yb + 0.3], inner, steel));
  ps.push(...panels('wood', [-half, ...bottoms.slice(1, 5), half], [yb + 0.3, yb + 0.42], inner, { tint: TINT.woodDark }));
  for (const t of tops) ps.push(block('steel', [t - 0.125, t + 0.125], [yTop - 0.3, yTop], inner, steel));
  const con = { tint: TINT.concrete };
  const flightW: Range = [-1.8, 1.8];
  for (const s of [-1, 1]) {
    ps.push(block('concrete', s > 0 ? [half - 0.4, half + 1] : [-half - 1, -half + 0.4], [0, yb], [-zc - 0.4, zc + 0.4], con));
    ps.push(block('concrete', s > 0 ? [half, half + 1] : [-half - 1, -half], [yb, yb + 0.42], inner, con));
  }
  const up = stairs('concrete', -half - 1 - 9 * 0.28, flightW, 0, 9, (yb + 0.42) / 9, 0.28, con);
  ps.push(...up, ...place(up, 0, 0, 2));
  // water main slung under the cross girders, valved at the west end; a street lamp at each approach
  ps.push(...pipe('water', 'castiron', [[-half + 0.4, yb - 0.1, 0], [half - 0.4, yb - 0.1, 0]], 0.2), stopcock([-8.3, -7.9], [0, yb - 0.2], [-0.2, 0.2]));
  ps.push(...place(streetLamp(5.5, 1.0), -11.5, -2.9), ...place(streetLamp(5.5, 1.0), 11.5, 2.9, 2));
  return put(ps, p, 'trussbridge', { age: { years: 110, exposure: 'outdoor' } });
}

/** Two-storey jettied box-frame house: oak frame on a brick plinth with daub infill, braced end bays,
    oak joists carrying a jettied upper floor on a bressumer, tiled roof on purlins, brick gable chimney. */
export function timberFrameHouse(p: Placement & { scaffold?: boolean }): PieceSpec[] {
  const X = 3.6, Z = 2.4, J = 0.4, wt = 0.3, plinth = 0.4, sh = 2.5;
  const up0 = plinth + sh + 0.2;
  const oak = { tint: TINT.woodDark }, brick = { tint: TINT.brickDark };
  const frame = { frame: 'oak' as const, infill: 'adobe' as const, frameTint: TINT.woodDark, tint: TINT.cream, rail: 1.0, mullion: 'oak' as const };
  const posts = [-3.5, -1.2, 1.2, 3.5];
  const braces = [{ bay: 0, dir: 1 as const }, { bay: 2, dir: -1 as const }];
  const win = (c: number, w = 0.8) => ({ c, w, y0: 1.15, h: 0.9 });
  const ps: PieceSpec[] = [
    ...grid('brick', [-X, X], [0, plinth], [Z - wt, Z], { x: 4 }, brick),
    ...grid('brick', [-X, X], [0, plinth], [-Z, -Z + wt], { x: 4 }, brick),
    block('brick', [-X, -X + wt], [0, plinth], [-Z + wt, Z - wt], brick),
    block('brick', [X - wt, X], [0, plinth], [-Z + wt, Z - wt], brick),
  ];
  const storey = (y0: number, front: number, openF: Opening[], openB: Opening[], openS: Opening[][]) => {
    ps.push(...timberWall({ ...frame, from: -X, to: X, face: front, y0, h: sh, posts, braces, openings: openF }));
    ps.push(...timberWall({ ...frame, from: -X, to: X, face: -Z, out: -1, y0, h: sh, posts, braces, openings: openB }));
    const zr: Range = [-Z + wt, front - wt];
    for (const s of [-1, 1] as const) {
      ps.push(...timberWall({ ...frame, axis: 'z', from: zr[0], to: zr[1], face: s * X, out: s, y0, h: sh,
        posts: [zr[0] + 0.1, (zr[0] + zr[1]) / 2, zr[1] - 0.1], openings: openS[s > 0 ? 1 : 0] }));
    }
  };
  storey(plinth, Z, [{ c: 0, w: 1.0, y0: 0.2, h: 1.9, glass: false }, win(-1.85), win(1.85)], [win(-1.85), win(0, 1.0), win(1.85)],
    [[{ c: 1.0, w: 0.7, y0: 1.15, h: 0.9 }], [{ c: -1.0, w: 0.7, y0: 1.15, h: 0.9 }]]);
  // jetty: oak joists sit on the ground-floor plates and run 0.4 m past the front to carry the upper front wall
  const jy: Range = [plinth + sh, up0];
  for (const x of [-X + 0.15, -1.75, 0, 1.75, X - 0.15]) {
    const w = Math.abs(x) > 3 ? 0.15 : 0.1;
    ps.push(block('oak', [x - w, x + w], jy, [-Z, Z + J], oak));
  }
  storey(up0, Z + J, [win(-1.85), win(0, 1.4), win(1.85)], [win(-1.85), win(1.85)],
    [[{ c: -1.0, w: 0.7, y0: 1.15, h: 0.9 }], [{ c: -1.0, w: 0.7, y0: 1.15, h: 0.9 }]]);
  ps.push(...panels('plywood', [-X + wt, 0, X - wt], [up0, up0 + 0.08], [-Z + wt, Z + J - wt], { tint: TINT.woodPale }));
  const eave = up0 + sh;
  ps.push(...pitchedRoof({ mat: 'roof', x: [-X, X + 0.3], z: [-Z, Z + J], y: eave, rise: 2.8, thick: 0.42, seat: 0.2, maxW: 4,
    tint: TINT.terracotta, gables: { mat: 'adobe', x: [[-X, -X + wt], [X - wt, X]], tint: TINT.cream } }));
  const stackTop = eave + 3.4 + 0.6;
  ps.push(...grid('brick', [-X - 0.7, -X], [0, stackTop], [-0.6, 0.6], { y: 2.6 }, brick));
  ps.push(block('stone', [-X - 0.75, -X + 0.05], [stackTop, stackTop + 0.1], [-0.65, 0.65], { tint: TINT.stone }));
  for (const z of [-0.22, 0.22]) ps.push(cyl('terracotta', 0.22, [stackTop + 0.1, stackTop + 0.5], -X - 0.35, z, { tint: TINT.terracotta }));
  if (p.interior !== false) {
    ps.push(...fit(table(1.4, 0.8), 1.0, 0, 0), ...fit(chair(), 1.0, -0.8, 0), ...fit(chair(), 1.0, 0.8, 0), ...fit(bookcase(1.2, 1.8), -2.2, -Z + wt + 0.16, 0));
    ps.push(...fit(bed(true), -1.6, 0.3, up0 + 0.08), ...fit(wardrobe(1.0), 2.6, -1.6, up0 + 0.08));
  }
  // two front dormers sitting flush on the upper roof slope, each glazed
  {
    const zr: Range = [-Z, Z + J], mid = (zr[0] + zr[1]) / 2, half = (zr[1] - zr[0]) / 2, k = 2.8 / (half - 0.2);
    const ridgeTop = eave + k * (half - 0.2 - 0.12) + 0.42, yAt = (d: number) => ridgeTop - k * (d - 0.12);
    for (const x of [-2.2, 1.2]) {
      const front = 1.9, top = 7.4, back = 0.12 + (ridgeTop - top) / k;
      ps.push(...dormer([x - 0.6, x + 0.6], mid, 1, front, back, top, yAt, { tint: TINT.terracotta }));
      ps.push(block('glass', [x - 0.42, x + 0.42], [yAt(front) + 0.12, top - 0.1], [mid + front, mid + front + GLASS_T]));
    }
  }
  // bracketed door hood, gutters on both eaves, two rear downpipes
  ps.push(...canopy({ face: Z }, [-0.75, 0.75], 2.52, 0.5, { mat: 'wood', tint: TINT.woodDark, t: 0.28, brackets: true }));
  const gy: Range = [eave - 0.14, eave];
  ps.push(...band({ mat: 'pvc', face: Z + J, from: -X, to: X, y: gy, depth: 0.13, tint: 0x3a3d40 }));
  ps.push(...band({ mat: 'pvc', face: -Z, out: -1, from: -X, to: X, y: gy, depth: 0.13, tint: 0x3a3d40 }));
  for (const x of [-3.0, 3.0]) ps.push(...downpipe({ face: -Z, out: -1 }, x, [0, gy[0]]));
  if (p.scaffold) ps.push(...scaffold({ from: -X, to: X, face: -Z, out: -1, height: eave - 0.1, tint: TINT.steelGrey }));
  return put(ps, p, 'tudor');
}

/** Garden wall laid brick by brick in stretcher bond with a stone coping. */
export function brickByBrickWall(p: Placement & { length?: number; courses?: number }): PieceSpec[] {
  const L = p.length ?? 5.28, n = p.courses ?? 10;
  const ps = brickBond('brick', [-L / 2, L / 2], 0, n, 0, { tint: TINT.brickDark });
  ps.push(...grid('stone', [-L / 2 - 0.05, L / 2 + 0.05], [n * 0.14, n * 0.14 + 0.1], [-0.15, 0.15], { x: 2.8 }, { tint: TINT.stone }));
  return put(ps, p, 'brickwall');
}

/* ---------------- big structures ---------------- */

/** Steel-frame skyscraper, 20 m square: perimeter steel columns and beams, radial beams to a reinforced-concrete
    core, rconcrete floor plates, storey-high tempered curtain wall (two panes per bay low down, one full-bay pane
    above), plant storeys on the core, aluminium parapet, corner crown fins and a stepped antenna. */
/* Built-up 500 mm box columns (40 mm plate: beams frame into a flat face from every side) and HEB 450 beams. */
const BOX500: PieceSpec['section'] = { kind: 'rhs', t: 0.04 };
const HEB450: PieceSpec['section'] = { kind: 'I', t: 0.026, tw: 0.014, depth: 1 };

export function skyscraper(p: Placement & { storeys?: number }): PieceSpec[] {
  const n = p.storeys ?? 18, H = 4.4, slab = 0.25, bd = 0.45, E = 11.8, cw = 0.5, cr = 3.5, ct = 0.3, L = 11.4;
  const co = cr + ct / 2;
  const g = [-L, -cr, cr, L];
  const steel = { tint: TINT.steelGrey }, con = { tint: TINT.concrete }, glaze = { tint: TINT.blueGlass }, alu = { tint: TINT.metalWhite };
  const ps: PieceSpec[] = [];
  const core = (y: Range) => {
    ps.push(block('rconcrete', [-co, co], y, [cr - ct / 2, co], con), block('rconcrete', [-co, co], y, [-co, -cr + ct / 2], con));
    ps.push(block('rconcrete', [cr - ct / 2, co], y, [-cr + ct / 2, cr - ct / 2], con), block('rconcrete', [-co, -cr + ct / 2], y, [-cr + ct / 2, cr - ct / 2], con));
  };
  const cuts = [-E, -co, co, E], gl = E - GLASS_T;
  // power riser up the north face of the core through a notch in each floor plate, from an intake transformer
  const rz: Range = [co, co + 0.16], riserHole = { x: [-0.08, 0.08] as Range, z: rz };
  const cable = { tint: SVC.cable, util: 'power' as const };
  ps.push(supplyBox([-0.6, 0.6], [0, 1.8], [co + 0.16, co + 1.0]));
  for (const y of splitRange(0, n * H + 1.28, 8.8)) ps.push(block('steel', riserHole.x, y, rz, cable));
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab, by: Range = [top - bd, top];
    for (const x of g) {
      for (const z of g) {
        if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;
        ps.push(k === 0 ? prism('steel', cw, [y0, top], x, z, 16, steel) : { ...block('steel', [x - cw / 2, x + cw / 2], [y0, top], [z - cw / 2, z + cw / 2], steel), section: BOX500 });
      }
    }
    for (const l of [-L, L]) {
      for (let i = 0; i < 3; i++) {
        const span: Range = [g[i] + cw / 2, g[i + 1] - cw / 2];
        ps.push({ ...block('steel', span, by, [l - 0.15, l + 0.15], steel), section: HEB450 }, { ...block('steel', [l - 0.15, l + 0.15], by, span, steel), section: HEB450 });
      }
    }
    for (const a of [-cr, cr]) {
      for (const s of [-1, 1]) {
        const span: Range = s > 0 ? [co, L - cw / 2] : [-L + cw / 2, -co];
        ps.push({ ...block('steel', [a - 0.15, a + 0.15], by, span, steel), section: HEB450 }, { ...block('steel', span, by, [a - 0.15, a + 0.15], steel), section: HEB450 });
      }
    }
    core([y0, (k + 1) * H]);
    // Alternate mechanical levels add grounded shear walls between the lift core and
    // facade. Their heads meet the floor plate; doors leave the core accessible.
    if (k % 3 === 0) for (const sign of [-1, 1]) {
      const from = sign < 0 ? -L + cw / 2 : co;
      const to = sign < 0 ? -co : L - cw / 2;
      ps.push(...wallRun({ mat: 'rconcrete', from, to, at: 0, t: 0.28,
        y0, h: H - slab, maxW: 4.0, tint: TINT.darkConcrete,
        openings: [{ c: (from + to) / 2, w: 1.15, y0: 0, h: 2.6, glass: false }] }));
    }
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) ps.push(...holedPanels('rconcrete', [cuts[i], cuts[i + 1]], [top, top + slab], [cuts[j], cuts[j + 1]], riserHole, con));
    }
    ps.push(lamp([0.08, 0.48], [top - 0.35, top], [co, co + 0.3], LIGHT.cool));
    const gy: Range = [y0, top], per = k < 4 ? 2 : 1;
    const side = [-gl, -co, co, gl];
    for (let i = 0; i < 3; i++) {
      for (const u of splitRange(cuts[i], cuts[i + 1], (cuts[i + 1] - cuts[i]) / per + 1e-6)) {
        ps.push(block('tempered', u, gy, [gl, E], glaze), block('tempered', u, gy, [-E, -gl], glaze));
      }
      for (const u of splitRange(side[i], side[i + 1], (side[i + 1] - side[i]) / per + 1e-6)) {
        ps.push(block('tempered', [gl, E], gy, u, glaze), block('tempered', [-E, -gl], gy, u, glaze));
      }
    }
    // Copper edge cassettes sit on the concrete slab face; they give every floor a
    // deliberate horizontal datum without replacing the load-bearing floor plate.
    for (const sign of [-1, 1]) {
      const edge: Range = sign > 0 ? [E, E + 0.12] : [-E - 0.12, -E];
      ps.push(block('copper', [-co, co], [top, top + slab], edge, { tint: 0xadc1b4 }));
      ps.push(block('copper', edge, [top, top + slab], [-co, co], { tint: 0xadc1b4 }));
    }
  }
  const roof = n * H;
  core([roof, roof + H]);
  core([roof + H, roof + 2 * H]);
  ps.push(block('rconcrete', [-co - 0.15, co + 0.15], [roof + 2 * H, roof + 2 * H + 0.3], [-co - 0.15, co + 0.15], con));
  // Exposed roof-plant supply: separate steel riser lengths, a square turn and
  // a cross-run on the lift core. Its clips bear on the concrete core wall.
  ps.push(...pipeRun('steel', 'y', [roof, roof + 7.74], [3.97, 0, 0], 0.28, steel, 3.9));
  ps.push(block('steel', [3.81, 4.13], [roof + 7.74, roof + 8.06], [-0.16, 0.16], steel));
  ps.push(...pipeRun('steel', 'z', [0.16, 3.1], [3.97, roof + 7.9, 0], 0.28, steel));
  for (const dy of [1.1, 6.9]) ps.push(block('steel', [co, 3.83], [roof + dy - 0.12, roof + dy + 0.12], [-0.12, 0.12], steel));
  const py: Range = [roof, roof + 1.2];
  ps.push(...grid('aluminum', [-E, E], py, [E - 0.15, E], { x: 7 }, alu), ...grid('aluminum', [-E, E], py, [-E, -E + 0.15], { x: 7 }, alu));
  ps.push(...grid('aluminum', [-E, -E + 0.15], py, [-E + 0.15, E - 0.15], { z: 7 }, alu), ...grid('aluminum', [E - 0.15, E], py, [-E + 0.15, E - 0.15], { z: 7 }, alu));
  ps.push(...riggingLine([-7, roof + 0.57, E + 0.17], [7, roof + 0.57, E + 0.17], 0.8));
  // crown: an L of tall fins in each corner, standing on the roof against the parapet
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const r = (a: number, b: number): Range => (sx > 0 ? [a, b] : [-b, -a]);
      const q = (a: number, b: number): Range => (sz > 0 ? [a, b] : [-b, -a]);
      ps.push(weldParts([
        block('aluminum', r(E - 4.4, E - 0.15), [roof, roof + 8], q(E - 0.45, E - 0.15), alu),
        block('aluminum', r(E - 0.45, E - 0.15), [roof, roof + 8], q(E - 4.4, E - 0.45), alu),
      ]));
    }
  }
  let y = roof + 2 * H + 0.3;
  for (const [d, h] of [[0.8, 6], [0.5, 6], [0.25, 6]]) {
    ps.push(prism('steel', d, [y, y + h], 0, 0, 8, steel));
    y += h;
  }
  // Single basement-level heat plant in the southwest service quadrant. It
  // occupies neither the lift core nor the door in the mechanical shear wall.
  ps.push(...boiler(-7.2, -7.0), gasMeter([-7.5, -6.9], [0, 0.9], [-6.18, -5.7]), radiatorPanel([-9.38, -8.38], [0.3, 1.5], [-7.2, -6.8]));
  // rooftop air handler on the riser; a lift against the south wall inside the core, wound from a motor room at roof level
  ps.push(...raise(place(hvacUnit(), 0, co + 1.24, 1), roof));
  ps.push(...place(lift(0, roof - 2.6), 0, -cr + ct / 2), supplyBox([0.35, 0.85], [roof, roof + 0.6], [-cr + ct / 2, -cr + ct / 2 + 0.4]));
  ps.push(...hydrant(E + 1.6, E + 1.6));
  // Dressings: a stone podium of pilasters over the first two storeys, floor-edge bands flanking the copper
  // cassettes at the podium top and mid-height, a coping on the parapet and an entrance canopy.
  const faces = [{ face: E }, { face: -E, out: -1 as const }, { axis: 'z' as const, face: E }, { axis: 'z' as const, face: -E, out: -1 as const }];
  for (const f of faces) {
    for (const u of [-L, -7.5, 7.5, L]) ps.push(...pilaster(f, u, 0.7, [0, 2 * H - slab], { tint: TINT.stone, depth: 0.25 }));
    for (const k of [1, Math.floor(n / 2)]) {
      const y: Range = [(k + 1) * H - slab, (k + 1) * H];
      for (const u of [[-E, -co], [co, E]] as Range[]) ps.push(...band({ ...f, mat: 'stone', from: u[0], to: u[1], y, depth: 0.2, maxW: 9, tint: TINT.stone }));
    }
    const edge = f.axis === 'z' ? E - 0.15 : E;
    ps.push(...band({ ...f, face: (f.out ?? 1) * (E - 0.15), mat: 'aluminum', from: -edge, to: edge, y: [roof + 1.2, roof + 1.32], depth: 0.45, maxW: 6, tint: TINT.metalWhite }));
  }
  ps.push(block('metal', [-3.4, 3.4], [H - slab, H - 0.1], [E + 0.12, E + 2.0], { tint: TINT.steelGrey }));
  for (const x of [-3.2, 3.2]) ps.push(block('steel', [x - 0.07, x + 0.07], [0, H - slab], [E + 1.8, E + 1.94], { tint: TINT.steelGrey }));
  return put(layerize(ps, { curtain: true, floors: 'vinyl', stone: true, maxUnits: 1500 }), p, 'skyscraper');
}

/** Hyperboloid cooling tower (~41 m): sixteen tapering rconcrete sectors per course on Λ-pairs of raked columns. */
export function coolingTower(p: Placement): PieceSpec[] {
  const n = 16, yb = 5, H = 36, throatY = yb + 26, a = 9.5, base = 14, courses = 9;
  const c = (throatY - yb) / Math.sqrt((base / a) ** 2 - 1);
  const r = (y: number) => a * Math.sqrt(1 + ((y - throatY) / c) ** 2);
  const t = (y: number) => 0.5 - (0.25 * (y - yb)) / H;
  const con = { tint: TINT.concrete };
  const ps: PieceSpec[] = [];
  for (let k = 0; k < courses; k++) {
    const y0 = yb + (k * H) / courses, y1 = yb + ((k + 1) * H) / courses;
    ps.push(...ringCourse('rconcrete', 0, 0, [y0, y1], [r(y0) - t(y0) / 2, r(y1) - t(y1) / 2], [r(y0) + t(y0) / 2, r(y1) + t(y1) / 2], n, con));
  }
  for (let j = 0; j < n; j++) {
    const aj = (2 * Math.PI * j) / n;
    for (const s of [-1, 1]) {
      const top = aj + (s * 0.45) / base, foot = aj + (s * 2.2) / base;
      ps.push(strut('rconcrete', [(base + 1.2) * Math.cos(foot), 0, (base + 1.2) * Math.sin(foot)], [base * Math.cos(top), yb, base * Math.sin(top)], 0.6, con));
    }
  }
  // circulating-water mains into the basin between the column pairs on ±X, each from a valve chamber outside
  for (const sx of [-1, 1]) {
    ps.push(...pipeRun('castiron', 'x', sx > 0 ? [6, 20] : [-20, -6], [0, 0.5, 0], 1.0, { tint: 0x3d6ea8, util: 'water' }));
    ps.push(stopcock(sx > 0 ? [20, 21] : [-21, -20], [0, 1.3], [-0.7, 0.7]));
  }
  return put(ps, p, 'cooling');
}

/** Steel transmission pylon (~33 m): five tiers stepping inward, every junction a solid node block so each weld is
    a flat box-to-box contact (slanted lattice bars made weak, fat-AABB joints), struts every half tier, cap plate,
    cross-arms and glass insulator strings. */
export function latticePylon(p: Placement): PieceSpec[] {
  const tiers = 5, th = 5.8, y0 = 0.4, nh = 0.3, lw = 0.5, hw = lw / 2, step = 0.55;
  const steel = { tint: TINT.steelGrey }, con = { tint: TINT.concrete }, glass = { tint: 0xcfe6ee };
  const ps: PieceSpec[] = [];
  const w = (i: number) => 3.6 - i * step;
  let y = y0;
  const corner = (c: number, s: number): Range => [s * c - hw, s * c + hw];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(block('concrete', corner(w(0), sx).map((v) => v + sx * 0) as Range, [0, y0], corner(w(0), sz), con));
  for (let i = 0; i < tiers; i++) {
    const c = w(i);
    // 508 x 16 mm tube legs; L 200x200x20 struts on each face at half-tier between leg faces
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push({ ...block('steel', corner(c, sx), [y, y + th], corner(c, sz), steel), section: { kind: 'chs', t: 0.016 } });
    const ym = y + th / 2, angle: PieceSpec['section'] = { kind: 'angle', t: 0.02 };
    for (const s of [-1, 1]) {
      ps.push({ ...block('steel', [-c + hw, c - hw], [ym - 0.1, ym + 0.1], [s * c - 0.1, s * c + 0.1], steel), section: angle });
      ps.push({ ...block('steel', [s * c - 0.1, s * c + 0.1], [ym - 0.1, ym + 0.1], [-c + hw, c - hw], steel), section: angle });
    }
    y += th;
    if (i + 1 < tiers) {
      // node block spanning this leg's top and the next (inset) leg's foot, and a strut ring at the joint
      const c2 = w(i + 1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const r = (sgn: number): Range => (sgn > 0 ? [c2 - hw, c + hw] : [-c - hw, -c2 + hw]);
        ps.push(block('steel', r(sx), [y, y + nh], r(sz), steel));
      }
      for (const s of [-1, 1]) {
        ps.push(block('steel', [-c2 + hw, c2 - hw], [y, y + nh], [s * c2 - 0.15, s * c2 + 0.15], steel));
        ps.push(block('steel', [s * c2 - 0.15, s * c2 + 0.15], [y, y + nh], [-c2 + hw, c2 - hw], steel));
      }
      y += nh;
    }
  }
  const H = y, c = w(tiers - 1);
  ps.push(block('steel', [-c - hw, c + hw], [H, H + 0.3], [-c - hw, c + hw], steel));
  ps.push(block('steel', [-7, 0], [H + 0.3, H + 0.8], [-0.25, 0.25], steel), block('steel', [0, 7], [H + 0.3, H + 0.8], [-0.25, 0.25], steel));
  ps.push(prism('steel', 0.3, [H + 0.8, H + 2.8], 0, 0, 8, steel));
  for (const x of [-6.6, 6.6]) ps.push(prism('glass', 0.25, [H + 0.3 - 1.5, H + 0.3], x, 0, 8, glass));
  // lower arms spring from the outer faces of the fourth-tier node blocks
  const yl = y0 + 4 * th + 3 * nh, cl = w(3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ps.push(block('steel', sx > 0 ? [cl + hw, 6.5] : [-6.5, -cl - hw], [yl, yl + nh], [sz * cl - 0.15, sz * cl + 0.15], steel));
    ps.push(prism('glass', 0.25, [yl - 1.5, yl], sx * 6.2, sz * cl, 8, glass));
  }
  return put(ps, p, 'pylon');
}

/** Sawtooth-roofed factory, 30 x 18 m: steel columns and valley beams, north-light glazing between posts carrying
    ridge beams, sloped roof slabs seated on the valleys, brick-and-cladding walls, an overhead travelling crane,
    and an octagonal brick stack at the west end. */
export function factory(p: Placement & { stock?: boolean; stack?: boolean }): PieceSpec[] {
  const xs = [-15, -9, -3, 3, 9, 15], zs = [-9, -3, 3, 9], eave = 7.0, vb = 0.4, ridge = 9.9;
  const steel = { tint: TINT.steelGrey }, clad = { tint: TINT.metalGreen };
  const vt = eave + vb;
  const ps: PieceSpec[] = [];
  const segs: Range[] = [[-9.2, -3], [-3, 3], [3, 9.2]];
  for (const x of xs) {
    for (const z of zs) ps.push(block('steel', [x - 0.2, x + 0.2], [0, eave], [z - 0.2, z + 0.2], steel));
    for (const zr of segs) ps.push(block('steel', [x - 0.3, x + 0.3], [eave, vt], zr, steel));
  }
  for (let i = 0; i < 5; i++) {
    const xl = xs[i], xh = xs[i + 1];
    for (const z of zs) ps.push(block('steel', [xh - 0.15, xh + 0.15], [vt, ridge], [z - 0.15, z + 0.15], steel));
    for (const zr of segs) ps.push(block('steel', [xh - 0.2, xh + 0.2], [ridge, ridge + 0.3], zr, steel));
    for (let j = 0; j < 3; j++) ps.push(block('glass', [xh - 0.03, xh + 0.03], [vt, ridge], [zs[j] + 0.15, zs[j + 1] - 0.15]));
    // roof slab: seated on the valley at the low side, butting the ridge beam at the high side
    const x0 = xl + 0.15, x1 = xl + 0.3, xe = xh - 0.2, tv = 0.25, k = (ridge - vt) / (xe - x1);
    const prof: [number, number][] = [[xe, ridge], [xe, ridge + tv], [x0, vt + tv - k * (x1 - x0)], [x0, vt], [x1, vt]];
    // slab joints sit clear of the post lines so no slab corner just grazes a post
    for (const zr of [[-9.2, -3.2], [-3.2, 3.2], [3.2, 9.2]] as Range[]) ps.push(extrude('metal', prof, 'z', zr, steel));
    for (const zr of [[9.2, 9.45], [-9.45, -9.2]] as Range[]) ps.push(extrude('metal', [[x1, vt], [xe, vt], [xe, ridge]], 'z', zr, clad));
  }
  const lower = { mat: 'brick' as const, t: 0.25, y0: 0, h: 4, tint: TINT.brickPale, lintel: 'rconcrete' as const, maxW: 3 };
  const upper = { mat: 'metal' as const, t: 0.25, y0: 4, h: vt - 4, maxW: 3.2, tint: TINT.metalGreen };
  const wins = [-12, -6, 0, 6, 12].map((c) => ({ c, w: 2.4, y0: 1.2, h: 2.0 }));
  for (const s of [-1, 1] as const) {
    ps.push(...wallRun({ ...lower, from: -15.55, to: 15.55, at: s * 9.325, out: s, openings: wins }));
    ps.push(...wallRun({ ...upper, from: -15.55, to: 15.55, at: s * 9.325, out: s }));
    const door = s > 0 ? [{ c: 0, w: 5, y0: 0, h: 4 }] : [{ c: 3, w: 1.2, y0: 0, h: 2.4 }];
    ps.push(...wallRun({ ...lower, axis: 'z', from: -9.2, to: 9.2, at: s * 15.425, out: s, openings: door }));
    ps.push(...wallRun({ ...upper, axis: 'z', from: -9.2, to: 9.2, at: s * 15.425, out: s }));
  }
  // brick pilasters under a stone band at the brick/cladding junction, all round
  for (const s of [-1, 1] as const) {
    ps.push(...band({ mat: 'stone', face: s * 9.45, out: s, from: -15.55, to: 15.55, y: [3.88, 4.12], depth: 0.12, tint: TINT.stone }));
    ps.push(...band({ mat: 'stone', axis: 'z', face: s * 15.55, out: s, from: -9.2, to: 9.2, y: [3.88, 4.12], depth: 0.12, tint: TINT.stone }));
    for (const x of [-9, -3, 3, 9]) ps.push(...pilaster({ face: s * 9.45, out: s }, x, 0.45, [0, 3.88], { mat: 'brick', tint: TINT.brickDark, depth: 0.15 }));
    for (const x of [-15.2, 15.2]) ps.push(...downpipe({ face: s * 9.45, out: s }, x, [4.12, vt]));
  }
  // ridge ventilators and a canopy over the east loading door
  for (let i = 1; i < 6; i++) ps.push(prism('metal', 0.6, [ridge + 0.3, ridge + 0.9], xs[i], 0, 8, { tint: TINT.steelGrey }));
  ps.push(...canopy({ axis: 'z', face: 15.55 }, [-2.7, 2.7], 4.12, 1.5, { t: 0.25, tint: TINT.metalGreen }));
  // travelling crane in the south aisle: girders bolted to the column faces, bridge, trolley, hook
  for (let i = 0; i < 5; i++) {
    ps.push(block('steel', [xs[i], xs[i + 1]], [5.0, 5.6], [-8.8, -8.4], steel), block('steel', [xs[i], xs[i + 1]], [5.0, 5.6], [-3.6, -3.2], steel));
  }
  const crane = { tint: TINT.craneYellow };
  ps.push(block('steel', [-1.5, -0.5], [5.6, 6.2], [-8.8, -3.2], crane), block('steel', [-1.4, -0.6], [6.2, 6.6], [-6.4, -5.6], crane));
  ps.push(block('steel', [-1.05, -0.95], [3.4, 5.6], [-6.05, -5.95], steel), prism('steel', 0.5, [2.6, 3.4], -1, -6, 8, crane));
  // Machinery is deliberately confined to a west bay, outside the travelling
  // crane's hook line and the five-metre loading entrance on the east.
  ps.push(...lineDrive(-11.7, -5.5));
  // Services. East: a pad transformer whose lead climbs column (15, 3) to a line-shaft run along the z = 3 columns;
  // each hanger on it is a motor turning a pulley, and bay lamps hang from it. West: a boiler whose steam main runs
  // along the z = -3 columns, with its gas meter, and a wall supply box on floor trunking to the line drive.
  ps.push(...place(groundTransformer(), 12.2, 3.6));
  ps.push(...conduit([[13.0, 0.6, 3.24], [15.0, 0.6, 3.24], [15.0, 5.04, 3.24], [-9.3, 5.04, 3.24]]));
  for (const x of [-9, -3, 3, 9]) {
    ps.push(block('machine', [x - 0.15, x + 0.2], [4.3, 5.0], [3.2, 3.5], { tint: SVC.motor, fixture: 'motor' }));
    const pulley = disc('castiron', 'x', [x + 0.34, 4.6, 3.35], 0.32, 0.16, { tint: TINT.iron });
    pulley.noWeld = true;
    pulley.mech = { kind: 'hinge', at: [x + 0.05, 4.6, 3.35], axis: [1, 0, 0], motor: { speed: 5, force: 300 } };
    ps.push(pulley);
  }
  for (const x of [-6, 0, 6, 12]) ps.push(lamp([x - 0.25, x + 0.25], [4.7, 5.0], [3.2, 3.5], LIGHT.bay));
  ps.push(...place(boilerSet(), -12, -1.3, 2), gasMeter([-12.3, -11.7], [0, 0.9], [-2.62, -2.12]));
  ps.push(...pipe('steam', 'steel', [[-12.81, 1.9, -1.45], [-12.81, 1.9, -2.73], [-12.81, 4.2, -2.73], [12, 4.2, -2.73]], 0.14));
  ps.push(supplyBox([-13.5, -12.9], [0, 0.9], [-9.2, -9.0]));
  ps.push(...conduit([[-13.2, 0.04, -9.0], [-13.2, 0.04, -5.5], [-13.2, 0.9, -5.5], [-12.78, 0.9, -5.5]]));
  if (p.interior !== false) {
    for (const x of [-6, 0]) ps.push(...fit(workbench(), x, 7.8, 0, 2));
    for (const [x, z] of [[0, 1.0], [-4.5, 0.5]]) ps.push(...fit(pallet(2), x, z, 0));
  }
  if (p.stock) ps.push(...crates(6, 5.5, 0, 3, 2, 2), ...drums('barrel', -10, 5, 0, 3, 2), ...drums('propane', 11, -6, 0, 2, 1));
  if (p.stack ?? true) ps.push(...place(industrialChimney({ x: 0, z: 0 }), -21, 0));
  return put(ps, p, 'factory', { age: { years: 70, exposure: 'outdoor' } });
}

/** Stadium stand section, 30 m wide: raked rconcrete terraces lapping between raker walls, rear wall, and a
    cantilevered steel roof of tapered girders on tall columns. */
export function stadiumStand(p: Placement): PieceSpec[] {
  const xr = [-15, -7.5, 0, 7.5, 15], rows = 14, rise = 0.5, back = -15;
  const con = { tint: TINT.concrete }, steel = { tint: TINT.steelGrey }, seat = [TINT.carTeal, TINT.metalBlue];
  const ps: PieceSpec[] = [];
  const slope = (rows * rise - rise) / (13.98 - 0.6);
  const topAt = (z: number) => 0.8 + (-0.6 - z) * slope;
  for (const x of xr) {
    for (const zr of [[-7.8, -0.3], [back - 0.3, -7.8]] as Range[]) {
      ps.push(extrude('rconcrete', [[zr[0], 0], [zr[1], 0], [zr[1], topAt(zr[1])], [zr[0], topAt(zr[0])]], 'x', [x - 0.15, x + 0.15], con));
    }
  }
  for (let b = 0; b < 4; b++) {
    const bay: Range = [xr[b] + 0.15, xr[b + 1] - 0.15];
    const treads = flight({ mat: 'rconcrete', axis: 'z', from: -0.6, to: back, cross: bay, y0: 0, steps: rows, rise, lap: 0.35, ...con });
    treads.forEach((q, j) => { q.tint = seat[j % 2]; });
    ps.push(...treads);
    ps.push(block('rconcrete', bay, [0, 1.1], [-0.6, -0.3], con), block('rconcrete', bay, [0, 7.5], [back - 0.3, back], con));
  }
  const colZ: Range = [back - 1.1, back - 0.3];
  for (const x of xr) {
    for (const y of splitRange(0, 17, 6)) ps.push(block('steel', [x - 0.4, x + 0.4], y, colZ, steel));
    // tapered cantilever girder in two lengths, flat on top so the sheeting beds on it
    const zb = colZ[0], zc = colZ[1], zm = -8.3, zf = -0.5, yTop = 18.6, depth = (z: number) => 1.6 - (1.2 * (z - zc)) / (zf - zc);
    ps.push(extrude('steel', [[zb, yTop], [zm, yTop], [zm, yTop - depth(zm)], [zc, 17], [zb, 17]], 'x', [x - 0.25, x + 0.25], steel));
    ps.push(extrude('steel', [[zm, yTop], [zf, yTop], [zf, yTop - depth(zf)], [zm, yTop - depth(zm)]], 'x', [x - 0.25, x + 0.25], steel));
  }
  for (let b = 0; b < 4; b++) {
    for (const zr of [[colZ[0], -8.3], [-8.3, -0.5]] as Range[]) ps.push(block('metal', [xr[b], xr[b + 1]], [18.6, 18.75], zr, { tint: TINT.metalWhite }));
  }
  for (const x of [-15.8, 15.8]) ps.push(...place(floodMast(22, 2), x, -17.6));
  for (const [x, c] of [[-7.5, TINT.carTeal], [7.5, TINT.metalBlue]] as [number, number][]) ps.push(flagpole(x, -8.9, 18.75, 4, [1.8, 1.1], c));
  ps.push(...band({ mat: 'metal', face: -0.5, from: -15, to: 15, y: [18.25, 18.75], depth: 0.1, maxW: 7.5, tint: TINT.carTeal }));
  return put(ps, p, 'stand');
}

/** Flat-top tower crane: footing, mast of box-section lengths, a slewing ring and above it the slewing superstructure
    as one rigid body (turntable, cat-head, a tapering box-truss jib and the counter-jib, with its ballast blocks riding
    on it), a trolley running out along the jib with the hook on its hoist line, and the operator's cab on a bracket
    at the mast head. Electric slew (15 kW) and trolley (5.5 kW) drives on the crane's own supply work an operator-less
    cycle: slew, run the trolley out and back. The superstructure is balanced about the mast, empty jib against
    ballast; the weight goes down the mast through the ring. */
export function towerCrane(p: Placement & { sections?: number }): PieceSpec[] {
  const nS = p.sections ?? 1, sh = 30, base = 1.0, a = 0.7, lh = 0.15;
  const yel = { tint: TINT.craneYellow }, con = { tint: TINT.concrete };
  const ps: PieceSpec[] = [block('concrete', [-2.5, 2.5], [0, base], [-2.5, 2.5], con)];
  let y = base;
  // mast: light box-section lengths stacked face to face (thin collars between heavy lengths made the solver soft)
  for (let k = 0; k < nS; k++) {
    ps.push({ ...block('steel', [-a - lh, a + lh], [y, y + sh], [-a - lh, a + lh], yel), section: { kind: 'rhs', t: 0.01 } });
    y += sh;
  }
  const top = y, y0 = top + 0.4, deck = top + 0.7, root = 2.4, jibTip = -21.5, T = 100;
  // the ring's fixed half on the mast head; the slewing half is the turntable 6 cm above it
  ps.push(prism('steel', 2.0, [top, top + 0.34], 0, 0, 16, yel));
  const upper = weldParts([
    block('aluminum', [-1.5, 1.5], [y0, deck], [-1.5, 1.5], yel),
    block('aluminum', [-1.5, 1.5], [deck, y0 + root], [-1.0, 1.0], yel),
    hull('aluminum', [[-1.5, y0, -0.5], [-1.5, y0, 0.5], [-1.5, y0 + root, -0.5], [-1.5, y0 + root, 0.5],
      [jibTip, y0, -0.2], [jibTip, y0, 0.2], [jibTip, y0 + 0.4, -0.2], [jibTip, y0 + 0.4, 0.2]], yel),
    block('aluminum', [1.5, 8.5], [y0, y0 + root], [-0.5, 0.5], yel),
  ], { noWeld: true, density: 390 });
  upper.mech = { kind: 'hinge', at: [0, top + 0.32, 0], axis: [0, 1, 0], brake: 2e5,
    motor: { speed: 0.07, force: 0, kW: 15, drive: 'electric', always: true },
    cycle: { period: T, keys: [[0, 0], [10, 0], [25, 0.5], [45, 0.5], [62, -0.4], [80, -0.4], [92, 0]] } };
  ps.push(upper);
  // ballast balancing the empty jib about the mast
  for (const x of [6.5, 7.5]) {
    const b = { ...block('concrete', [x, x + 1.0], [y0 + root, y0 + root + 2.0], [-0.65, 0.65], { tint: TINT.darkConcrete }), noWeld: true, density: 1230 };
    b.mech = { kind: 'hinge', at: [x + 0.5, y0 + root - 0.05, 0], axis: [0, 1, 0], lower: 0, upper: 0 };
    ps.push(b);
  }
  // cab and its supply on a bracket at the mast head, below the turntable
  ps.push(block('steel', [-0.8, -0.2], [top - 1.1, top - 0.9], [a + lh, 1.05], { tint: TINT.steelGrey }));
  ps.push(block('metal', [-1.2, 0.3], [top - 1.1, top + 0.34], [1.05, 2.55], { tint: TINT.metalWhite }), block('tempered', [-1.26, -1.2], [top - 0.8, top + 0.14], [1.15, 2.45]));
  ps.push(supplyBox([-1.2, -0.6], [top - 1.1, top - 0.5], [2.55, 2.85]), lamp([-0.6, -0.2], [top - 1.0, top - 0.75], [2.55, 2.8], LIGHT.cool));
  // the steelwork is the down conductor, bonded to earth past the concrete base
  ps.push(...earthBond([a + lh + 0.03, base + 0.5, 0], [2.53, base, 0]));
  const tx = -10;
  const trolley = { ...block('steel', [tx - 0.5, tx + 0.5], [top - 0.1, top + 0.34], [-0.85, 0.85], yel), noWeld: true };
  trolley.mech = { kind: 'slider', at: [tx, y0 + 0.05, 0], axis: [-1, 0, 0], lower: -7, upper: 9.5, brake: 3e4,
    motor: { speed: 0.8, force: 0, kW: 5.5, drive: 'electric', always: true },
    cycle: { period: T, keys: [[0, 0], [20, 0], [35, 8], [55, 8], [70, -5], [85, -5], [95, 0]] } };
  trolley.ropeTo = { end: [tx, top - 8.25, 0], slack: 0.24, strength: 80e3 };
  const sheave = { ...prism('steel', 0.5, [top - 0.8, top - 0.16], tx, 0, 8, yel), noWeld: true };
  sheave.mech = { kind: 'hinge', at: [tx, top - 0.05, 0], axis: [0, 1, 0], lower: 0, upper: 0 };
  ps.push(trolley, sheave);
  // The hook is a separate swinging mass suspended by the distance constraint.
  ps.push(block('castiron', [tx - 0.42, tx + 0.42], [top - 8.52, top - 7.98], [-0.3, 0.3], { tint: TINT.iron, noWeld: true }));
  return put(ps, p, 'crane');
}

/** Free-standing one-bay scaffold tower (no ties): standards, ledgers, boards and guard rails. */
export function scaffoldTower(p: Placement & { height?: number }): PieceSpec[] {
  return put(scaffold({ from: -1.2, to: 1.2, face: -0.8, height: p.height ?? 6.2, tieEvery: 0, tint: TINT.steelGrey }), p, 'scaffold');
}
