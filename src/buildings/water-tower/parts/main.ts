import type { PieceSpec } from '../../../types.ts';
import { block, cyl, grid, panels, ringCourse, splitRange, type Range } from '../../../levels/kit.ts';
import { stopcock } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Four steel legs with two brace rings, a timber deck and a steel-banded stave tank (≈15 m). */
export function waterTower(p: Placement): PieceSpec[] {
  const a = 2, leg = 0.3, pad = 0.3, top = 10;
  const steel = { tint: TINT.steelRed };
  const ps: PieceSpec[] = [];
  const legSegs = splitRange(pad, top, 3.4);
  for (const sx of [-a, a]) {
    for (const sz of [-a, a]) {
      ps.push(block('concrete', [sx - 0.4, sx + 0.4], [0, pad], [sz - 0.4, sz + 0.4], { tint: TINT.darkConcrete }));
      for (const y of legSegs) ps.push(block('steel', [sx - leg / 2, sx + leg / 2], y, [sz - leg / 2, sz + leg / 2], steel));
    }
  }
  // brace rings straddle the leg joints so each joint is tied four ways
  for (let k = 1; k < legSegs.length; k++) {
    const y: Range = [legSegs[k][0] - 0.1, legSegs[k][0] + 0.1];
    const inner: Range = [-a + leg / 2, a - leg / 2];
    for (const s of [-a, a]) {
      ps.push(block('steel', inner, y, [s - 0.1, s + 0.1], steel));
      ps.push(block('steel', [s - 0.1, s + 0.1], y, inner, steel));
    }
  }
  ps.push(...grid('steel', [-0.15, 0.15], [0, top], [-0.15, 0.15], { y: 3.4 }, { tint: TINT.steelGrey, util: 'water' }));
  ps.push(stopcock([0.15, 0.55], [0, 0.6], [-0.2, 0.2]));
  const deckY = top + 0.4;
  for (const s of [-a, a]) ps.push(block('steel', [-2.6, 2.6], [top, deckY], [s - 0.15, s + 0.15], steel));
  ps.push(block('steel', [-0.15, 0.15], [top, deckY], [-a + 0.15, a - 0.15], steel));
  const deckTop = deckY + 0.15;
  ps.push(...panels('wood', [-2.6, 0, 2.6], [deckY, deckTop], [-2.6, 0, 2.6], { tint: TINT.woodDark }));
  const rail: Range = [deckTop, deckTop + 0.8];
  const wood = { tint: TINT.woodPale };
  ps.push(block('wood', [-2.6, 2.6], rail, [2.52, 2.6], wood), block('wood', [-2.6, 2.6], rail, [-2.6, -2.52], wood));
  ps.push(block('wood', [-2.6, -2.52], rail, [-2.52, 2.52], wood), block('wood', [2.52, 2.6], rail, [-2.52, 2.52], wood));
  // ten-sided tank: staves are annular sectors sharing flat radial joints, with a steel band course
  let ty = deckTop;
  for (const [mat, h, tint] of [['wood', 1.5, TINT.woodDark], ['steel', 0.25, TINT.steelGrey], ['wood', 1.5, TINT.woodDark]] as const) {
    ps.push(...ringCourse(mat, 0, 0, [ty, ty + h], [1.94, 1.94], [2.12, 2.12], 10, { tint }));
    ty += h;
  }
  const lid = deckTop + 3.25;
  ps.push(cyl('wood', 4.44, [lid, lid + 0.15], 0, 0, { tint: TINT.woodDark }));
  ps.push(cyl('metal', 3.2, [lid + 0.15, lid + 0.45], 0, 0, { tint: TINT.steelGrey }));
  ps.push(cyl('metal', 1.8, [lid + 0.45, lid + 0.75], 0, 0, { tint: TINT.steelGrey }));
  ps.push(cyl('steel', 0.3, [lid + 0.75, lid + 1.25], 0, 0, steel));
  return put(ps, p, 'tower');
}
