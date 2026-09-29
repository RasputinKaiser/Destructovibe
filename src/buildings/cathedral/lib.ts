import type { PieceSpec } from '../../types.ts';
import { block, wallRun, type PieceOpts, type Range, type WallRunOpts } from '../../levels/kit.ts';
import { withDetail } from '../../levels/layers.ts';
import { ashlar } from '../../levels/architecture/common.ts';
import { LIME } from './frame.ts';

/** Coursed ashlar faces on the stone members (every masonry part goes through this). */
export const masonry = (ps: PieceSpec[]): PieceSpec[] => ashlar(ps, [0, 0], { maxUnits: 2600 });

const STAINED = [0xb8342c, 0x2f4fa8, 0xd8a838, 0x3f8a52, 0x7a3f8f, 0xc8c2b0];

/* A pane's colour seed comes from its own local position, so no part's glass depends on what another part builds. */
function paneSeed(p: PieceSpec): number {
  const [x, y, z] = p.pos.map((v) => Math.round(v * 100));
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
}

/** Leaded lights: coloured quarries in lead cames as detail on each pane. */
function leaded(p: PieceSpec): PieceSpec {
  const seed = paneSeed(p);
  const [sx, sy, sz] = p.size, alongX = sx >= sz, uk = alongX ? 0 : 2, tk = alongX ? 2 : 0;
  const U: Range = [p.pos[uk] - p.size[uk] / 2, p.pos[uk] + p.size[uk] / 2], Y: Range = [p.pos[1] - sy / 2, p.pos[1] + sy / 2];
  const T: Range = [p.pos[tk] - p.size[tk] / 2 + 0.004, p.pos[tk] + p.size[tk] / 2 - 0.004];
  const cell = (mat: 'glass' | 'metal', u: Range, y: Range, tint: number): PieceSpec => {
    const x: Range = alongX ? u : T, z: Range = alongX ? T : u;
    return block(mat, x, y, z, { tint });
  };
  const nu = Math.max(1, Math.round((U[1] - U[0]) / 0.32)), nv = Math.max(1, Math.round((Y[1] - Y[0]) / 0.42)), c = 0.012;
  const du = (U[1] - U[0]) / nu, dv = (Y[1] - Y[0]) / nv, units: PieceSpec[] = [];
  for (let j = 0; j < nv; j++) {
    const y0 = Y[0] + j * dv, y1 = y0 + dv;
    if (j > 0) units.push(cell('metal', U, [y0, y0 + c], 0x2b2b2b));
    for (let i = 0; i < nu; i++) {
      const u0 = U[0] + i * du, u1 = u0 + du;
      if (i > 0) units.push(cell('metal', [u0, u0 + c], [y0 + (j > 0 ? c : 0), y1], 0x2b2b2b));
      units.push(cell('glass', [u0 + (i > 0 ? c : 0), u1], [y0 + (j > 0 ? c : 0), y1], STAINED[(i * 7 + j * 3 + seed) % STAINED.length]));
    }
  }
  return withDetail({ ...p, tint: STAINED[seed % STAINED.length] }, units);
}

type RunOpts = Partial<WallRunOpts> & { from: number; to: number; at: number; y0: number; h: number; t: number };

/** A limewashed ashlar wall run with stone sills, lintels and mullions (the church's wall kit). */
export const stoneRun = (w: RunOpts): PieceSpec[] =>
  wallRun({ mat: 'stone', maxW: 3.3, sill: 'stone', lintel: 'stone', lintelH: 0.3, mullion: 'stone', ...({ tint: LIME } as PieceOpts), ...w } as WallRunOpts);

/** Finish a wall part's runs: glazing becomes leaded lights, then the ashlar pass. */
export const walls = (ps: PieceSpec[]): PieceSpec[] => masonry(ps.map((q) => (q.mat === 'glass' ? leaded(q) : q)));
