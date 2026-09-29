import type { PieceSpec } from '../../../types.ts';
import { block, prism, ringCourse } from '../../../levels/kit.ts';
import type { Frame } from '../../assemble.ts';
import { DARK, TOWER_A } from '../frame.ts';
import { masonry } from '../lib.ts';

/** Octagonal broach spire in tapering courses seated on the belfry's corbel course, solid at the tip, with finial and
    weathercock at 64 m. */
export function spire(f: Frame): PieceSpec[] {
  const cz = f.grid.z.towerFace + TOWER_A, ps: PieceSpec[] = [];
  const R0 = 3.6, top = 62, y0 = f.levels.spireSeat, nc = 8;
  const rad = (y: number) => R0 + (0.12 - R0) * (y - y0) / (top - y0), wall = (y: number) => 0.5 - 0.3 * (y - y0) / (top - y0);
  for (let i = 0; i < nc; i++) {
    const ya = y0 + (i * (top - y0)) / nc, yb = y0 + ((i + 1) * (top - y0)) / nc, last = i === nc - 1;
    ps.push(...ringCourse('stone', 0, cz, [ya, yb], [rad(ya) - wall(ya), last ? 0 : rad(yb) - wall(yb)], [rad(ya), rad(yb)], 8, { tint: DARK }, Math.PI / 8));
  }
  ps.push(prism('steel', 0.12, [top, top + 2.2], 0, cz, 8, { tint: 0xb08d3c }), block('copper', [-0.4, 0.4], [top + 2.2, top + 2.5], [cz - 0.05, cz + 0.05], { tint: 0xb08d3c }));
  return masonry(ps);
}
