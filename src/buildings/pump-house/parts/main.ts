import type { PieceSpec } from '../../../types.ts';
import { block, cyl, panels, pipeRun, wallRun } from '../../../levels/kit.ts';
import { band, canopy, downpipe } from '../../../levels/facade.ts';
import { conduit, lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

export function pumpHouse(p: Placement): PieceSpec[] {
  const X = 2, Z = 1.5, t = 0.25, h = 2.6;
  const wall = { mat: 'cinderblock' as const, t, y0: 0, h, lintel: 'rconcrete' as const, tint: TINT.concrete };
  const ps: PieceSpec[] = [
    ...wallRun({ ...wall, from: -X, to: X, at: Z - t / 2, openings: [{ c: -0.8, w: 0.9, y0: 0, h: 2.0 }, { c: 0.9, w: 0.8, y0: 0.9, h: 0.8 }] }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + t / 2, out: -1 }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, openings: [{ c: 0, w: 0.7, y0: 1.2, h: 0.6 }] }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2 }),
    ...panels('rconcrete', [-X - 0.15, 0, X + 0.15], [h, h + 0.2], [-Z - 0.15, Z + 0.15], { tint: TINT.concrete }),
    cyl('steel', 0.8, [0, 1.0], 0.6, -0.5, { tint: TINT.metalGreen, fixture: 'watermain' }),
    supplyBox([-1.4, -0.9], [1.2, 1.8], [-Z + t, -Z + t + 0.2]),
    ...conduit([[-1.15, 1.8, -Z + t + 0.1], [-1.15, h - 0.04, -Z + t + 0.1], [-1.15, h - 0.04, 0.2]]),
    lamp([-1.35, -0.95], [h - 0.3, h - 0.08], [-0.2, 0.2], LIGHT.cool),
    ...canopy({ face: Z }, [-1.35, -0.25], 2.05, 0.5, { t: 0.18, tint: TINT.steelGrey }),
    ...band({ mat: 'concrete', face: Z, from: -X, to: X, y: [h - 0.14, h], depth: 0.15, tint: TINT.darkConcrete }),
    ...downpipe({ face: -Z, out: -1 }, 1.8, [0, h]),
  ];
  // Pump shaft, bolted motor bed and outlet feed: separate pieces welded to the
  // existing casing, with the front door at x=-0.8 left clear.
  ps.push(block('steel', [0.16, 1.4], [0, 0.18], [-1.12, -0.9], { tint: TINT.steelGrey }));
  ps.push(block('steel', [0.16, 1.4], [0, 0.18], [-0.1, 0.12], { tint: TINT.steelGrey }));
  ps.push(block('steel', [0.35, 0.85], [1.0, 1.2], [-0.75, -0.25], { tint: TINT.iron, util: 'water' }));
  ps.push(...pipeRun('steel', 'y', [1.2, 2.1], [0.6, 0, -0.5], 0.24, { tint: TINT.steelRed, util: 'water' }));
  ps.push(cyl('steel', 0.38, [2.1, 2.23], 0.6, -0.5, { tint: TINT.steelRed, util: 'water' }));
  return put(ps, p, 'pumphouse');
}
