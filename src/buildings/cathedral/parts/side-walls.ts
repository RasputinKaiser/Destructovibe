import type { PieceSpec } from '../../../types.ts';
import type { Range } from '../../../levels/kit.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines } from '../frame.ts';
import { stoneRun, walls } from '../lib.ts';

/** The nave's long walls: on each side the clerestory on the arcade's level course up to the wall plate (a lancet pair in
    each bay), and the aisle wall up to the aisle wall plate (tall two-light windows, a door in the north aisle's
    westernmost bay). */
export function sideWalls(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), ZE = ZB[ZB.length - 1], L = f.levels, G = f.grid.x;
  const XI = G.nave, XO = G.arcade, XA: Range = [G.aisleIn, G.aisleOut];
  const mids = ZB.slice(0, -1).map((z, k) => (z + ZB[k + 1]) / 2);
  const ps: PieceSpec[] = [];
  for (const s of [-1, 1] as const) {
    ps.push(...stoneRun({ axis: 'z', from: ZE, to: ZB[0], at: s * (XI + XO) / 2, t: XO - XI, out: s, y0: L.arcadeTop, h: L.wallPlate - L.arcadeTop,
      openings: mids.map((c) => ({ c, w: 1.8, y0: 3.0, h: 3.9 })) }));
    ps.push(...stoneRun({ axis: 'z', from: ZE, to: ZB[0], at: s * (XA[0] + XA[1]) / 2, t: XA[1] - XA[0], out: s, y0: 0, h: L.aisleEaves,
      openings: mids.map((c, k) => (s < 0 && k === 0 ? { c, w: 1.8, y0: L.floor, h: 3.6, glass: false } : { c, w: 2.2, y0: 2.2, h: 5.0 })) }));
  }
  return walls(ps);
}
