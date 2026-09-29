import type { PieceSpec } from '../../../types.ts';
import type { Range } from '../../../levels/kit.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines, END_W } from '../frame.ts';
import { stoneRun, walls } from '../lib.ts';

/** West and east end walls: aisle ends with their windows, the nave end (west door behind the tower; three-light east
    window over the altar) and the nave end walls above the aisle roofs up to the wall plate. */
export function endWalls(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), ZE = ZB[ZB.length - 1], L = f.levels, G = f.grid.x;
  const XO = G.arcade, XA: Range = [G.aisleIn, G.aisleOut];
  const aisleW = (z: number, out: 1 | -1, door: boolean) => [
    ...stoneRun({ from: -XA[1], to: -XO, at: z, t: END_W, out, y0: 0, h: L.aisleEaves, openings: [{ c: -8.3, w: 1.8, y0: 2.4, h: 4.6 }] }),
    ...stoneRun({ from: XO, to: XA[1], at: z, t: END_W, out, y0: 0, h: L.aisleEaves, openings: [{ c: 8.3, w: 1.8, y0: 2.4, h: 4.6 }] }),
    ...stoneRun({ from: -XO, to: XO, at: z, t: END_W, out, y0: 0, h: L.aisleEaves, openings: door ? [{ c: 0, w: 2.2, y0: L.floor, h: 4.4, glass: false }] : [] }),
  ];
  return walls([
    ...aisleW(ZB[0] + END_W / 2, 1, true),
    ...aisleW(ZE - END_W / 2, -1, false),
    ...stoneRun({ from: -XO, to: XO, at: ZB[0] + END_W / 2, t: END_W, out: 1, y0: L.aisleEaves, h: L.wallPlate - L.aisleEaves }),
    ...stoneRun({ from: -XO, to: XO, at: ZE - END_W / 2, t: END_W, out: -1, y0: L.aisleEaves, h: L.wallPlate - L.aisleEaves, mullion: undefined,
      openings: [-1.9, 0, 1.9].map((c) => ({ c, w: 1.5, y0: 1.0, h: 9.0 })) }),
  ]);
}
