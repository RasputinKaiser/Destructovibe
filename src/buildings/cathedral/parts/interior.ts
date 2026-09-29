import type { PieceSpec } from '../../../types.ts';
import { block, prism } from '../../../levels/kit.ts';
import { fit, pew } from '../../../levels/interior.ts';
import { conduit, lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines, LIME } from '../frame.ts';

/** Pews in two blocks down the nave, chancel step and altar, font by the west door, and wall lanterns on a conduit along
    the north aisle wall fed from a box by the west door. */
export function interior(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), ZE = ZB[ZB.length - 1], XA0 = f.grid.x.aisleIn, FL = f.levels.floor;
  const ps: PieceSpec[] = [];
  for (let z = 14.5; z >= ZE + 13; z -= 2.05) for (const x of [-2.55, 2.55]) ps.push(...fit(pew(3.4), x, z, FL, 0));
  ps.push(block('stone', [-4.4, 4.4], [FL, FL + 0.18], [ZE + 0.01, ZE + 4.5], { tint: 0xd8d0bf }), block('marble', [-1.4, 1.4], [FL + 0.18, FL + 1.18], [ZE + 0.1, ZE + 1.0], { tint: 0xf1ede4 }));
  ps.push(prism('stone', 0.8, [FL, FL + 0.95], -3.0, 16.2, 8, { tint: LIME }));
  ps.push(supplyBox([-XA0, -XA0 + 0.25], [1.2, 2.0], [16.4, 17.0]), ...conduit([[-XA0 + 0.12, 2.0, 16.7], [-XA0 + 0.12, 8.2, 16.7], [-XA0 + 0.12, 8.2, ZB[ZB.length - 2] - 0.1]]));
  for (let k = 1; k < ZB.length - 1; k++) ps.push(lamp([-XA0, -XA0 + 0.3], [7.76, 8.16], [ZB[k] - 0.15, ZB[k] + 0.15], LIGHT.candle));
  return ps;
}
