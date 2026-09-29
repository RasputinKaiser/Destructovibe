import type { PieceSpec } from '../../../types.ts';
import { block, chamfer, cyl, grid, pitchedRoof, wallRun, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { band, downpipe, quoins } from '../../../levels/facade.ts';
import { bed, bookcase, chair, fit, kitchen, sofa, table, wardrobe } from '../../../levels/interior.ts';
import { conduit, gasMeter, lamp, LIGHT, pipe, stopcock, supplyBox, wallBoiler, BORE, clipped, cutSleeve, drawn } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put, radiator } from '../../_shared/structures-helpers.ts';

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
