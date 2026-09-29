import type { PieceSpec } from '../../../types.ts';
import { block, extrude, prism, type PieceOpts, type Range } from '../../../levels/kit.ts';
import { roofDetail } from '../../../levels/layers.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines, LIME, SLATE } from '../frame.ts';
import { masonry } from '../lib.ts';

type P2 = [number, number];

/** Lean-to aisle roofs from the aisle wall plate up against the arcade, stepped buttresses at the bay lines with
    pinnacles, and flyers carrying the vault's thrust across the aisle roofs to the clerestory. */
export function aisles(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), ZE = ZB[ZB.length - 1], XO = f.grid.x.arcade, XA: Range = [f.grid.x.aisleIn, f.grid.x.aisleOut];
  const EAVES = f.levels.aisleEaves;
  const o: PieceOpts = { tint: LIME }, ps: PieceSpec[] = [];
  for (const s of [-1, 1]) {
    const X = (x: number) => s * x;
    for (let k = 0; k + 1 < ZB.length; k++) {
      const z: Range = [ZB[k + 1], ZB[k]];
      const pr: P2[] = [[X(XA[1]), EAVES], [X(XA[1] - 0.3), EAVES], [X(XO), 12.6], [X(XO), 12.95], [X(XA[1]), 9.85]];
      ps.push(roofDetail(extrude('roof', pr, 'z', z, { tint: SLATE }), { tile: 'slate' }));
    }
    for (let k = 0; k < ZB.length; k++) {
      const zr: Range = k === 0 ? [ZB[0], ZB[0] + 1.0] : k === ZB.length - 1 ? [ZE - 1.0, ZE] : [ZB[k] - 0.5, ZB[k] + 0.5];
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
  return masonry(ps);
}
