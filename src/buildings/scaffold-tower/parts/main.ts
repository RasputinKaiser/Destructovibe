import type { PieceSpec } from '../../../types.ts';
import { scaffold } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Free-standing one-bay scaffold tower (no ties): standards, ledgers, boards and guard rails. */
export function scaffoldTower(p: Placement & { height?: number }): PieceSpec[] {
  return put(scaffold({ from: -1.2, to: 1.2, face: -0.8, height: p.height ?? 6.2, tieEvery: 0, tint: TINT.steelGrey }), p, 'scaffold');
}
