import type { PieceSpec } from '../../../types.ts';
import { block, grid, pitchedRoof, wallRun } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

export function gardenShed(p: Placement): PieceSpec[] {
  const t = 0.1, y0 = 0.12, h = 1.98;
  const wood = { tint: TINT.shedGreen };
  const ps: PieceSpec[] = [
    ...grid('plywood', [-1.5, 1.5], [0, y0], [-1.2, 1.2], { x: 1.6 }, { tint: TINT.woodDark }),
    ...wallRun({ mat: 'wood', from: -1.5, to: 1.5, at: 1.2 - t / 2, t, y0, h, maxW: 1.6, ...wood,
      openings: [{ c: 0.5, w: 0.8, y0: 0, h: 1.8 }] }),
    ...wallRun({ mat: 'wood', from: -1.5, to: 1.5, at: -1.2 + t / 2, t, y0, h, maxW: 1.6, out: -1, ...wood }),
    ...wallRun({ mat: 'wood', axis: 'z', from: -1.1, to: 1.1, at: -1.5 + t / 2, t, y0, h, out: -1, ...wood, sill: 'wood',
      openings: [{ c: 0, w: 0.8, y0: 0.8, h: 0.6 }] }),
    ...wallRun({ mat: 'wood', axis: 'z', from: -1.1, to: 1.1, at: 1.5 - t / 2, t, y0, h, ...wood }),
    ...pitchedRoof({ mat: 'roof', x: [-1.7, 1.7], z: [-1.2, 1.2], y: y0 + h, rise: 0.8, thick: 0.18, seat: 0.1, tint: TINT.felt,
      gables: { mat: 'wood', x: [[-1.5, -1.4], [1.4, 1.5]], tint: TINT.shedGreen } }),
  ];
  // corner boards on the gable ends
  for (const x of [-1.58, 1.5]) for (const z of [-1.2, 1.12]) ps.push(block('wood', [x, x + 0.08], [y0, y0 + h], [z, z + 0.08], { tint: TINT.woodPale }));
  return put(ps, p, 'shed');
}
