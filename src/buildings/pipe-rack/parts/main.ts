import type { PieceSpec } from '../../../types.ts';
import { block, column, pipeRun } from '../../../levels/kit.ts';
import { stopcock } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Freestanding construction-services rack: grounded posts, continuous header,
 * cross-clips and two separable pipe runs (one fed by a ground riser). */
export function pipeRack(p: Placement): PieceSpec[] {
  const frame = { tint: TINT.steelGrey }, copper = { tint: TINT.bronze };
  const ps: PieceSpec[] = [
    ...column('steel', -2, 0, [0, 2.7], 0.32, frame),
    ...column('steel', 2, 0, [0, 2.7], 0.32, frame),
    block('steel', [-2.16, 2.16], [2.7, 2.95], [-0.16, 0.16], frame),
  ];
  for (const x of [-1, 1]) ps.push(block('steel', [x - 0.12, x + 0.12], [2.95, 3.09], [-0.79, 0.79], frame));
  const water = { ...copper, util: 'water' as const };
  ps.push(...pipeRun('copper', 'y', [0, 3.09], [-2.15, 0, 0.65], 0.28, water));
  ps.push(block('copper', [-2.31, -1.99], [3.09, 3.37], [0.49, 0.81], water));
  ps.push(...pipeRun('copper', 'x', [-1.99, 2.2], [0, 3.23, 0.65], 0.28, water));
  ps.push(stopcock([-2.7, -2.293], [0, 0.5], [0.45, 0.85]));
  ps.push(...pipeRun('steel', 'x', [-2.2, 2.2], [0, 3.23, -0.65], 0.28, frame));
  return put(ps, p, 'pipe-rack');
}
