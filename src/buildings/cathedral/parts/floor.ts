import type { PieceSpec } from '../../../types.ts';
import { block, splitRange, type Range } from '../../../levels/kit.ts';
import { withDetail } from '../../../levels/layers.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines, CAPW } from '../frame.ts';

/** A 0.3 m flagged floor on hardcore over nave and aisles, in bay-sized pieces (thin slabs pinched under falling
    masonry get shot out); between the piers it fills the arcade line bay by bay. */
export function floor(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), ZE = ZB[ZB.length - 1], XO = f.grid.x.arcade, XA0 = f.grid.x.aisleIn, FL = f.levels.floor;
  const ps: PieceSpec[] = [];
  const flags = (x: Range, z: Range) => {
    const u: PieceSpec[] = [];
    for (const a of splitRange(x[0], x[1], 0.6)) for (const b of splitRange(z[0], z[1], 0.6)) u.push(block('stone', [a[0] + 0.003, a[1] - 0.003], [FL - 0.04, FL], [b[0] + 0.003, b[1] - 0.003], { tint: ((a[0] * 5 + b[0] * 3) | 0) & 1 ? 0xcfc6b2 : 0xbdb39e }));
    return withDetail(block('stone', x, [0, FL], z, { tint: 0xc4bba7 }), u);
  };
  for (const z of splitRange(ZE, ZB[0], 6.5)) {
    for (const x of [[-4.4, 0], [0, 4.4]] as Range[]) ps.push(flags(x, z));
    for (const s of [-1, 1]) ps.push(flags(s > 0 ? [XO + 0.6, XA0] : [-XA0, -XO - 0.6], z));
  }
  for (let k = 0; k + 1 < ZB.length; k++) {
    const z: Range = [ZB[k + 1] + CAPW, ZB[k] - CAPW];
    for (const x of [[4.4, XO + 0.6], [-XO - 0.6, -4.4]] as Range[]) ps.push(flags(x, z));
  }
  return ps;
}
