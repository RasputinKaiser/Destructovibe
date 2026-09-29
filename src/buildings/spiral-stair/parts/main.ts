import type { PieceSpec } from '../../../types.ts';
import { prism, spiralStair, splitRange } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Cast-iron spiral stair round a newel, climbing to a round landing on top of the newel. */
export function spiralFolly(p: Placement & { steps?: number }): PieceSpec[] {
  const n = p.steps ?? 14, rise = 0.25, top = n * rise;
  const iron = { tint: TINT.iron };
  const ps = spiralStair({ mat: 'castiron', cx: 0, cz: 0, y0: 0, steps: n, rise, rIn: 0.16, rOut: 1.1, turn: Math.PI / 7, width: Math.PI / 5, ...iron });
  // the newel stops under the landing, which also bears on the last tread
  const newel = ps.filter((q) => q.shape === 'prism');
  const keep = ps.filter((q) => q.shape !== 'prism');
  const post = newel[0];
  const out: PieceSpec[] = [...keep];
  for (const y of splitRange(0, top, 4)) out.push(prism('castiron', post.size[0], y, 0, 0, 16, iron));
  out.push(prism('plywood', 2.6, [top, top + 0.1], 0, 0, 16, { tint: TINT.woodPale }));
  return put(out, p, 'spiral');
}
