import type { PieceSpec } from '../../../types.ts';
import { block, extrude, flight, place, splitRange, type Range } from '../../../levels/kit.ts';
import { floodMast } from '../../../levels/services.ts';
import { TINT } from '../../_shared/base.ts';
import { finish, sect, type Placement } from '../../../levels/architecture/common.ts';

/* Football ground: two 64 m stands facing across a 70 m pitch. Each stand is a raked RC terrace of 22 rows
   (0.45 m rise, 0.8 m going) lapped between raker walls every 8 m, with a vomitory-height front wall and a tall
   rear wall; behind it steel columns carry tapered plate-girder cantilevers that throw a 20 m roof over the seats.
   Four 40 m floodlight masts stand at the corners of the pitch. */

const W = 32, BAY = 8, ROWS = 22, RISE = 0.45, GO = 0.8, PITCH = 35;
const SEAT = [0x2f5f9f, 0xc8c8c8];

/** One stand facing +Z, its front row at z = 0 (the touchline side), built back toward -Z. */
function stand(): PieceSpec[] {
  const ps: PieceSpec[] = [], con = { tint: TINT.concrete }, steel = { tint: 0x3d4a57 };
  const xs = Array.from({ length: 2 * W / BAY + 1 }, (_, i) => -W + i * BAY);
  const front = -0.6, back = front - ROWS * GO, top = ROWS * RISE;
  const slope = (top - RISE) / (Math.abs(back - front) - GO);
  const topAt = (z: number) => RISE + (front - GO - z) * slope + 0.3;
  // rakers: stepped-soffit walls under the terrace, in two lengths
  for (const x of xs) {
    const xr: Range = [x - 0.2, x + 0.2];
    for (const zr of [[back / 2 - 0.3, -0.3], [back - 0.3, back / 2 - 0.3]] as Range[]) {
      ps.push(extrude('rconcrete', [[zr[0], 0], [zr[1], 0], [zr[1], Math.min(top, topAt(zr[1]))], [zr[0], Math.min(top, topAt(zr[0]))]], 'x', xr, con));
    }
  }
  for (let b = 0; b + 1 < xs.length; b++) {
    const bay: Range = [xs[b] + 0.2, xs[b + 1] - 0.2];
    const treads = flight({ mat: 'rconcrete', axis: 'z', from: front, to: back, cross: bay, y0: 0, steps: ROWS, rise: RISE, lap: 0.35, ...con });
    treads.forEach((q, j) => { q.tint = SEAT[(j >> 2) & 1]; });
    ps.push(...treads);
    ps.push(block('rconcrete', bay, [0, 1.1], [front, -0.3], con), block('rconcrete', bay, [0, top + 1.1], [back - 0.3, back], con));
  }
  // roof: a column behind each raker, a tapered cantilever girder in two lengths on it, sheeting and a fascia
  const colZ: Range = [back - 1.2, back - 0.3], yTop = top + 7.5, zm = back + 10, zf = front + 1.0;
  for (const x of xs) {
    for (const y of splitRange(0, yTop - 1.8, 6)) ps.push(sect('steel', [x - 0.3, x + 0.3], y, colZ, { kind: 'I', t: 0.03, tw: 0.02, axis: 1, depth: 2 }, steel));
    const depth = (z: number) => 1.8 - (1.3 * (z - colZ[1])) / (zf - colZ[1]);
    const g = [extrude('steel', [[colZ[0], yTop], [zm, yTop], [zm, yTop - depth(zm)], [colZ[1], yTop - 1.8], [colZ[0], yTop - 1.8]], 'x', [x - 0.25, x + 0.25], steel),
      extrude('steel', [[zm, yTop], [zf, yTop], [zf, yTop - depth(zf)], [zm, yTop - depth(zm)]], 'x', [x - 0.25, x + 0.25], steel)];
    // welded plate girders: flanges and a 15 mm web, a fifth of the envelope
    for (const q of g) q.density = 1600;
    ps.push(...g);
  }
  for (let b = 0; b + 1 < xs.length; b++) for (const zr of [[colZ[0], zm], [zm, zf]] as Range[]) ps.push(block('metal', [xs[b], xs[b + 1]], [yTop, yTop + 0.15], zr, { tint: 0xeceae4 }));
  for (const x of splitRange(-W, W, 8)) ps.push(block('metal', x, [yTop - 0.5, yTop + 0.15], [zf, zf + 0.1], { tint: 0x2f5f9f }));
  return ps;
}

export function stadium(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [...place(stand(), 0, -PITCH), ...place(stand(), 0, PITCH, 2)];
  for (const [x, z, q] of [[-W - 4, -PITCH + 1, 0], [W + 4, -PITCH + 1, 0], [-W - 4, PITCH - 1, 2], [W + 4, PITCH - 1, 2]] as [number, number, number][]) {
    ps.push(...place(floodMast(40, 4), x, z, q));
  }
  return finish(ps, p, 'stadium', { years: 25, exposure: 'outdoor' });
}
