import type { PieceSpec } from '../../../types.ts';
import { block, extrude, pitchedRoof, type Range } from '../../../levels/kit.ts';
import { roofDetail } from '../../../levels/layers.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines, END_W, LIME, OAK, SLATE } from '../frame.ts';

/** Steep slated nave roof on the clerestory wall plate, stone gables over the end walls, and oak king-post trusses
    (tie beam, king post, principals) at the bay lines and mid-bays. */
export function naveRoof(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), ZE = ZB[ZB.length - 1], XI = f.grid.x.nave, XO = f.grid.x.arcade, CLER_TOP = f.levels.wallPlate;
  const ps = pitchedRoof({ mat: 'roof', x: [ZE - END_W, ZB[0] + END_W], z: [-XO, XO], y: CLER_TOP, rise: 8, thick: 0.5, seat: 0.25, maxW: 4.4, tint: SLATE, axis: 'z',
    gables: { mat: 'stone', x: [[ZE - END_W, ZE], [ZB[0], ZB[0] + END_W]], tint: LIME } }).map((q) => (q.mat === 'roof' && q.size[1] > 1 ? roofDetail(q, { tile: 'slate' }) : q));
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
