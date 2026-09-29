import type { PieceSpec } from '../../../types.ts';
import { pipeRun, ringCourse, strut } from '../../../levels/kit.ts';
import { stopcock } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Hyperboloid cooling tower (~41 m): sixteen tapering rconcrete sectors per course on Λ-pairs of raked columns. */
export function coolingTower(p: Placement): PieceSpec[] {
  const n = 16, yb = 5, H = 36, throatY = yb + 26, a = 9.5, base = 14, courses = 9;
  const c = (throatY - yb) / Math.sqrt((base / a) ** 2 - 1);
  const r = (y: number) => a * Math.sqrt(1 + ((y - throatY) / c) ** 2);
  const t = (y: number) => 0.5 - (0.25 * (y - yb)) / H;
  const con = { tint: TINT.concrete };
  const ps: PieceSpec[] = [];
  for (let k = 0; k < courses; k++) {
    const y0 = yb + (k * H) / courses, y1 = yb + ((k + 1) * H) / courses;
    ps.push(...ringCourse('rconcrete', 0, 0, [y0, y1], [r(y0) - t(y0) / 2, r(y1) - t(y1) / 2], [r(y0) + t(y0) / 2, r(y1) + t(y1) / 2], n, con));
  }
  for (let j = 0; j < n; j++) {
    const aj = (2 * Math.PI * j) / n;
    for (const s of [-1, 1]) {
      const top = aj + (s * 0.45) / base, foot = aj + (s * 2.2) / base;
      ps.push(strut('rconcrete', [(base + 1.2) * Math.cos(foot), 0, (base + 1.2) * Math.sin(foot)], [base * Math.cos(top), yb, base * Math.sin(top)], 0.6, con));
    }
  }
  // circulating-water mains into the basin between the column pairs on ±X, each from a valve chamber outside
  for (const sx of [-1, 1]) {
    ps.push(...pipeRun('castiron', 'x', sx > 0 ? [6, 20] : [-20, -6], [0, 0.5, 0], 1.0, { tint: 0x3d6ea8, util: 'water' }));
    ps.push(stopcock(sx > 0 ? [20, 21] : [-21, -20], [0, 1.3], [-0.7, 0.7]));
  }
  return put(ps, p, 'cooling');
}
