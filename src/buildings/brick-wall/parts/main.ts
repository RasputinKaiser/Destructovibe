import type { PieceSpec } from '../../../types.ts';
import { brickBond, grid } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Garden wall laid brick by brick in stretcher bond with a stone coping. */
export function brickByBrickWall(p: Placement & { length?: number; courses?: number }): PieceSpec[] {
  const L = p.length ?? 5.28, n = p.courses ?? 10;
  const ps = brickBond('brick', [-L / 2, L / 2], 0, n, 0, { tint: TINT.brickDark });
  ps.push(...grid('stone', [-L / 2 - 0.05, L / 2 + 0.05], [n * 0.14, n * 0.14 + 0.1], [-0.15, 0.15], { x: 2.8 }, { tint: TINT.stone }));
  return put(ps, p, 'brickwall');
}
