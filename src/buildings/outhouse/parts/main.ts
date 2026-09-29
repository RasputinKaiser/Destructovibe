import type { PieceSpec } from '../../../types.ts';
import { block, cyl, wallRun } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

export function outhouse(p: Placement): PieceSpec[] {
  const t = 0.08, a = 0.6, h = 2.1;
  const o = { tint: TINT.woodPale };
  const ps: PieceSpec[] = [
    ...wallRun({ mat: 'wood', from: -a, to: a, at: a - t / 2, t, y0: 0, h, ...o, openings: [{ c: 0, w: 0.7, y0: 0, h: 1.85 }] }),
    block('wood', [-a, a], [0, h], [-a, -a + t], o),
    block('wood', [-a, -a + t], [0, h], [-a + t, a - t], o),
    block('wood', [a - t, a], [0, h], [-a + t, a - t], o),
    block('wood', [-a + t, a - t], [0, 0.45], [-a + t, -0.12], { tint: TINT.woodDark }),
    block('metal', [-0.75, 0.75], [h, h + 0.08], [-0.75, 0.85], { tint: TINT.steelGrey }),
    cyl('metal', 0.1, [h + 0.08, h + 0.5], 0.35, -0.4, { tint: TINT.steelGrey }),
  ];
  return put(ps, p, 'outhouse');
}
