import type { PieceSpec } from '../../../types.ts';
import { hollowStack, panels, ringCourse } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Tapering octagonal brick chimney (~26 m) on a hollow square plinth: every course is eight sloping-faced
    sector hulls, so the shaft is smooth outside and the joints are flat. */
export function industrialChimney(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [
    ...hollowStack('brick', 0, 0, 0, 4.4, 0.7, 1.5, 2, { tint: TINT.brickDark }),
    ...panels('stone', [-2.3, 2.3], [3.0, 3.3], [-2.3, 0, 2.3], { tint: TINT.darkConcrete }),
  ];
  const n = 11, y0 = 3.3, ch = 2.0;
  const outer = (f: number) => 2.05 - 0.75 * f, wall = (f: number) => 0.46 - 0.16 * f;
  for (let k = 0; k < n; k++) {
    const f0 = k / n, f1 = (k + 1) / n;
    ps.push(...ringCourse('brick', 0, 0, [y0 + k * ch, y0 + (k + 1) * ch], [outer(f0) - wall(f0), outer(f1) - wall(f1)], [outer(f0), outer(f1)], 8, { tint: TINT.brickDark }));
  }
  const top = y0 + n * ch, r1 = outer(1), w1 = wall(1);
  ps.push(...ringCourse('brick', 0, 0, [top, top + 0.7], [r1 - w1, r1 - w1], [r1, r1 + 0.22], 8, { tint: TINT.soot }));
  return put(ps, p, 'chimney', { age: { years: 130, exposure: 'outdoor' } });
}
