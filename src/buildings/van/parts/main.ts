import type { PieceSpec } from '../../../types.ts';
import { parkedVan } from '../../../levels/machines.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Parked panel van pointing +X (wheels fixed; see machines.ts for the driveable one). */
export function van(p: Placement & { tint?: number }): PieceSpec[] {
  return put(parkedVan(p.tint ?? TINT.vanWhite), p, 'van', { protected: true });
}
