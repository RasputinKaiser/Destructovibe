import type { PieceSpec, Vec3 } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { block, hollowStack, prism, ringCourse, type Range } from '../../../levels/kit.ts';
import { disc } from '../../../levels/services.ts';
import { TINT } from '../../_shared/base.ts';
import { BRICK } from '../lib.ts';

/** Clock tower on the booking hall's east corner, on its own walls: brick shaft, four dials, open belfry, slated
    pyramid, finial. */
export function clockTower(f: Frame): PieceSpec[] {
  const cx = f.grid.x.clockTower, cz = f.grid.z.clockTower, brick = { tint: BRICK }, stone = { tint: TINT.stone };
  const ps: PieceSpec[] = [...hollowStack('brick', cx, cz, 0, 5.4, 0.6, 2.5, 10, brick)];
  ps.push(...hollowStack('stone', cx, cz, 25, 5.4, 0.6, 0.4, 1, stone), ...hollowStack('brick', cx, cz, 25.4, 5.4, 0.6, 3.6, 1, brick));
  for (const [ax, dx, dz] of [['z', 0, 1], ['z', 0, -1], ['x', 1, 0], ['x', -1, 0]] as ['x' | 'z', number, number][]) {
    const c: Vec3 = [cx + dx * 2.76, 27.2, cz + dz * 2.76];
    ps.push(disc('castiron', ax, c, 1.15, 0.12, { tint: 0xf4efe2 }, 24));
    const face: Range = [2.82, 2.88], v = (k: number, r: Range): Range => (k > 0 ? [r[0], r[1]] : [-r[1], -r[0]]);
    const hx: Range = ax === 'x' ? v(dx, face).map((q) => cx + q) as Range : [c[0] - 0.035, c[0] + 0.035];
    const hz: Range = ax === 'z' ? v(dz, face).map((q) => cz + q) as Range : [c[2] - 0.035, c[2] + 0.035];
    ps.push(block('steel', hx, [27.2, 28.1], hz, { tint: 0x1c1c1c }));
  }
  ps.push(...hollowStack('stone', cx, cz, 29, 5.4, 0.6, 0.4, 1, stone));
  const corner = (c: number, s: number): Range => (s > 0 ? [c + 1.6, c + 2.7] : [c - 2.7, c - 1.6]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(block('brick', corner(cx, sx), [29.4, 33], corner(cz, sz), brick));
  ps.push(...hollowStack('stone', cx, cz, 33, 5.8, 1.0, 0.45, 1, stone));
  ps.push(...ringCourse('roof', cx, cz, [33.45, 40.5], [2.9 * Math.SQRT2 - 0.45, 0], [2.9 * Math.SQRT2, 0.12], 4, { tint: TINT.slate }, Math.PI / 4));
  ps.push(prism('steel', 0.16, [40.5, 42.8], cx, cz, 8, { tint: 0x2b2f31 }));
  return ps;
}
