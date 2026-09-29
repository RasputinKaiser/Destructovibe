import type { PieceSpec } from '../../../types.ts';
import { block, type Range } from '../../../levels/kit.ts';
import { type Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Background tower for distant skylines: the same load path as a real one (RC core, perimeter columns, flat
    slabs, storey-high glazing) but in few, large members, so a skyline costs a fraction of a hero building. */
export function backdropTower(p: Placement & { storeys?: number; tint?: number }): PieceSpec[] {
  const n = p.storeys ?? 12, H = 4.2, E = 10, c = 3.15, t = 0.3, slab = 0.3;
  const con = { tint: 0xcfcfca }, glaze = { tint: p.tint ?? 0xa9cde0 };
  const ps: PieceSpec[] = [];
  for (let k = 0; k < n; k += 2) {
    const y: Range = [k * H, Math.min(n, k + 2) * H];
    ps.push(block('rconcrete', [-c, c], y, [c - t, c], con), block('rconcrete', [-c, c], y, [-c, -c + t], con));
    ps.push(block('rconcrete', [-c, -c + t], y, [-c + t, c - t], con), block('rconcrete', [c - t, c], y, [-c + t, c - t], con));
  }
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab;
    for (const x of [-9.6, 0, 9.6]) for (const z of [-9.6, 0, 9.6]) if (x || z) ps.push(block('rconcrete', [x - 0.3, x + 0.3], [y0, top], [z - 0.3, z + 0.3], con));
    const sy: Range = [top, top + slab];
    ps.push(block('rconcrete', [-E, E], sy, [c, E], con), block('rconcrete', [-E, E], sy, [-E, -c], con));
    ps.push(block('rconcrete', [-E, -c], sy, [-c, c], con), block('rconcrete', [c, E], sy, [-c, c], con));
    const g: Range = [y0, top - 0.03];
    ps.push(block('tempered', [-E, E], g, [E - 0.06, E], glaze), block('tempered', [-E, E], g, [-E, -E + 0.06], glaze));
    ps.push(block('tempered', [E - 0.06, E], g, [-E + 0.06, E - 0.06], glaze), block('tempered', [-E, -E + 0.06], g, [-E + 0.06, E - 0.06], glaze));
  }
  const roof = n * H;
  for (const s of [-1, 1]) {
    ps.push(block('rconcrete', [-E, E], [roof, roof + 1.2], s > 0 ? [E - 0.25, E] : [-E, -E + 0.25], con));
    ps.push(block('rconcrete', s > 0 ? [E - 0.25, E] : [-E, -E + 0.25], [roof, roof + 1.2], [-E + 0.25, E - 0.25], con));
  }
  ps.push(block('metal', [-c, c], [roof, roof + 3], [-c, c], { tint: 0xeceae4 }));
  return put(ps, p, 'backdrop');
}
