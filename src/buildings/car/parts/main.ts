import type { PieceSpec } from '../../../types.ts';
import { parkedSaloon } from '../../../levels/machines.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Parked saloon pointing +X. */
export function car(p: Placement & { tint?: number; protected?: boolean }): PieceSpec[] {
  return put(parkedSaloon(p.tint ?? TINT.carRed), p, 'car', { protected: p.protected ?? true });
}
