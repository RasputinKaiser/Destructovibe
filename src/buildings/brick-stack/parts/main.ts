import type { PieceSpec } from '../../../types.ts';
import { block, hollowStack } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Square brick stack on a concrete plinth with a corbelled head. */
export function brickStack(p: Placement & { courses: number; tint?: number }): PieceSpec[] {
  const o = { tint: p.tint };
  const courseH = 1.25, base = 0.5;
  const top = base + p.courses * courseH;
  const ps: PieceSpec[] = [
    block('concrete', [-1, 1], [0, base], [-1, 1], { tint: TINT.darkConcrete }),
    ...hollowStack('brick', 0, 0, base, 1.4, 0.3, courseH, p.courses, o),
    ...hollowStack('terracotta', 0, 0, top, 1.64, 0.36, 0.3, 1, { tint: TINT.terracotta }),
    block('stone', [-0.85, 0.85], [top + 0.3, top + 0.42], [-0.85, 0.85], { tint: TINT.darkConcrete }),
  ];
  return put(ps, p, 'stack');
}
