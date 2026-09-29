import type { PieceSpec } from '../../../types.ts';
import { block, type Range } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

export function gardenWall(p: Placement & { length: number; gate?: number; height?: number }): PieceSpec[] {
  const h = p.height ?? 1.6, t = 0.23, pier = 0.36;
  const bays = Math.max(1, Math.round(p.length / 3));
  const pitch = p.length / bays;
  const x0 = -p.length / 2;
  const ps: PieceSpec[] = [];
  for (let i = 0; i <= bays; i++) {
    const x = x0 + i * pitch;
    ps.push(block('brick', [x - pier / 2, x + pier / 2], [0, h + 0.15], [-pier / 2, pier / 2]));
    ps.push(block('stone', [x - 0.22, x + 0.22], [h + 0.15, h + 0.25], [-0.22, 0.22], { tint: TINT.concrete }));
    if (i === bays || i === p.gate) continue;
    const span: Range = [x + pier / 2, x + pitch - pier / 2];
    ps.push(block('brick', span, [0, h], [-t / 2, t / 2]));
    ps.push(block('stone', span, [h, h + 0.08], [-0.15, 0.15], { tint: TINT.concrete }));
  }
  return put(ps, p, 'wall');
}
