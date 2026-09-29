import type { PieceSpec } from '../../../types.ts';
import { block, flagpole, extrude, flight, place, splitRange, type Range } from '../../../levels/kit.ts';
import { band } from '../../../levels/facade.ts';
import { floodMast } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

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
