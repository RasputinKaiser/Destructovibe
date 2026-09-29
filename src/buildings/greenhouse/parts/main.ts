import type { PieceSpec } from '../../../types.ts';
import { block, grid, GLASS_T, type Range } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

export function greenhouse(p: Placement): PieceSpec[] {
  const t = 0.1, h0 = 0.45, hg = 1.4;
  const ax = 1.5, az = 1.0;
  const gy: Range = [h0, h0 + hg];
  const g = GLASS_T / 2;
  const wood = { tint: TINT.weatherboard };
  const ps: PieceSpec[] = [
    block('wood', [-ax, ax], [0, h0], [az - t, az], wood),
    block('wood', [-ax, ax], [0, h0], [-az, -az + t], wood),
    block('wood', [-ax, -ax + t], [0, h0], [-az + t, az - t], wood),
    block('wood', [ax - t, ax], [0, h0], [-az + t, az - t], wood),
    ...grid('glass', [-ax, ax], gy, [az - t / 2 - g, az - t / 2 + g], { x: 1.5 }),
    ...grid('glass', [-ax, ax], gy, [-az + t / 2 - g, -az + t / 2 + g], { x: 1.5 }),
    block('glass', [-ax + t / 2 - g, -ax + t / 2 + g], gy, [-az + t / 2 + g, az - t / 2 - g]),
    block('glass', [ax - t / 2 - g, ax - t / 2 + g], gy, [-az + t / 2 + g, az - t / 2 - g]),
    ...grid('glass', [-ax, ax], [gy[1], gy[1] + GLASS_T], [-az, az], { x: 1.5 }),
    block('wood', [-1.0, 1.0], [0, 0.75], [-az + t + 0.05, -az + t + 0.55], { tint: TINT.woodDark }),
  ];
  return put(ps, p, 'greenhouse');
}
