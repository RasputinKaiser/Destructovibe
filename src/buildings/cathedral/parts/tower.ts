import type { PieceSpec } from '../../../types.ts';
import { hollowStack, wallRun, type PieceOpts, type WallRunOpts } from '../../../levels/kit.ts';
import type { Frame } from '../../assemble.ts';
import { LIME, TOWER_A, TOWER_T } from '../frame.ts';
import { masonry } from '../lib.ts';

/** West tower shaft: ground stage with the west door, the arch into the church and side lights, then coursed walls up to
    the belfry floor. It stands clear of the nave behind an 80 mm movement joint (its own structure, not bonded). */
export function tower(f: Frame): PieceSpec[] {
  const FL = f.levels.floor, z0 = f.grid.z.towerFace, a = TOWER_A, t = TOWER_T, cz = z0 + a;
  const o: PieceOpts = { tint: LIME }, ps: PieceSpec[] = [];
  const run = (w: Partial<WallRunOpts> & { from: number; to: number; at: number }) =>
    wallRun({ mat: 'stone', t, y0: 0, h: 9, maxW: 3.3, lintel: 'stone', lintelH: 0.45, ...o, ...w } as WallRunOpts);
  ps.push(...run({ from: -a, to: a, at: z0 + 2 * a - t / 2, out: 1, openings: [{ c: 0, w: 2.4, y0: 0, h: 5.2, glass: false }] }));
  ps.push(...run({ from: -a, to: a, at: z0 + t / 2, out: -1, openings: [{ c: 0, w: 2.2, y0: FL, h: 4.4, glass: false }] }));
  for (const s of [-1, 1] as const) ps.push(...run({ axis: 'z', from: z0 + t, to: z0 + 2 * a - t, at: s * (a - t / 2), out: s, openings: [{ c: cz, w: 1.0, y0: 4.5, h: 2.8 }] }));
  ps.push(...hollowStack('stone', 0, cz, 9, 2 * a, t, 3, (f.levels.belfryFloor - 9) / 3, o));
  return masonry(ps);
}
