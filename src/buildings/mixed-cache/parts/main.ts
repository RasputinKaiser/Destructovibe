import type { PieceSpec } from '../../../types.ts';
import { crates, drums, tnt } from '../../../levels/kit.ts';
import { type Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

export function dump(p: Placement & { barrels?: [number, number]; propane?: [number, number]; tnt?: number; crates?: [number, number, number]; y?: number }): PieceSpec[] {
  const y = p.y ?? 0;
  const ps: PieceSpec[] = [];
  let off = 0;
  if (p.crates) { ps.push(...crates(p.crates[0] / 2, 0, y, ...p.crates)); off += p.crates[0] + 0.3; }
  if (p.barrels) { ps.push(...drums('barrel', off + (p.barrels[0] * 0.64) / 2, 0, y, ...p.barrels)); off += p.barrels[0] * 0.64 + 0.3; }
  if (p.propane) { ps.push(...drums('propane', off + (p.propane[0] * 0.54) / 2, 0, y, ...p.propane)); off += p.propane[0] * 0.54 + 0.3; }
  if (p.tnt) ps.push(...tnt(off + 0.3, 0, y, p.tnt));
  return put(ps, p, 'props');
}
