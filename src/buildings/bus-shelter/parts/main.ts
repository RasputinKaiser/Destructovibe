import type { PieceSpec } from '../../../types.ts';
import { block } from '../../../levels/kit.ts';
import { lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

export function busShelter(p: Placement): PieceSpec[] {
  const alu = { tint: TINT.metalGreen };
  const ps: PieceSpec[] = [];
  for (const x of [-1.55, 1.55]) for (const z of [-0.55, 0.55]) ps.push(block('aluminum', [x - 0.05, x + 0.05], [0, 2.4], [z - 0.05, z + 0.05], alu));
  ps.push(block('tempered', [-1.5, 1.5], [0, 2.3], [-0.58, -0.52]));
  ps.push(block('tempered', [-1.58, -1.52], [0, 2.3], [-0.5, 0.2]), block('tempered', [1.52, 1.58], [0, 2.3], [-0.5, 0.2]));
  ps.push(block('metal', [-1.7, 1.7], [2.4, 2.5], [-0.7, 0.7], alu));
  ps.push(block('wood', [-1.2, 1.2], [0, 0.45], [-0.52, -0.2], { tint: TINT.woodDark }));
  ps.push(lamp([-0.8, 0.8], [2.3, 2.4], [-0.45, -0.25], LIGHT.cool), supplyBox([0.8, 1.1], [2.1, 2.4], [-0.45, -0.25]));
  return put(ps, p, 'shelter', { protected: true });
}
