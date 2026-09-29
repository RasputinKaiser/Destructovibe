import type { PieceSpec } from '../../../types.ts';
import { prism, ringCourse, type Range } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Rotunda: stepped stone platform, eight round marble columns, an octagonal entablature ring and a coursed
    octagonal dome of sector hulls closed by a lantern. */
export function rotunda(p: Placement): PieceSpec[] {
  const stone = { tint: TINT.stone }, marble = { tint: TINT.white };
  const ps: PieceSpec[] = [prism('stone', 8.0, [0, 0.3], 0, 0, 16, stone), prism('stone', 7.3, [0.3, 0.6], 0, 0, 16, stone)];
  const colTop = 4.6, ph = Math.PI / 8;
  for (let i = 0; i < 8; i++) {
    const a = ph + (i * Math.PI) / 4;
    ps.push(prism('marble', 0.5, [0.6, colTop], 3.0 * Math.cos(a), 3.0 * Math.sin(a), 16, marble));
  }
  const ring: Range = [colTop, colTop + 0.6];
  ps.push(...ringCourse('stone', 0, 0, ring, [2.55, 2.55], [3.5, 3.5], 8, stone, ph));
  // dome courses cut from a spherical shell centred on the entablature top
  const Ro = 3.45, Ri = 3.05, yc = ring[1], cuts = [0, 1.0, 1.9, 2.6, 3.0];
  const rad = (r: number, y: number) => Math.sqrt(Math.max(0, r * r - y * y));
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    ps.push(...ringCourse('stone', 0, 0, [yc + a, yc + b], [rad(Ri, a), rad(Ri, b)], [rad(Ro, a), rad(Ro, b)], 8, { tint: TINT.cream }, ph));
  }
  const top = yc + cuts[cuts.length - 1];
  ps.push(prism('stone', 2.2, [top, top + 0.9], 0, 0, 8, stone), prism('stone', 1.2, [top + 0.9, top + 1.3], 0, 0, 8, stone));
  ps.push(prism('steel', 0.18, [top + 1.3, top + 2.3], 0, 0, 8, { tint: TINT.bronze }));
  return put(ps, p, 'rotunda');
}
