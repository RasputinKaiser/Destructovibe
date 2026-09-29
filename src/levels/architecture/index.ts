import type { PieceSpec, PrefabView } from '../../types.ts';
import type { Placement } from './common.ts';
import { BUILDINGS, BUILDING_VARIANTS, building } from '../../buildings/registry.gen.ts';

export interface Landmark { id: string; name: string; category: PrefabView['category']; make(p: Placement): PieceSpec[] }

/* Every registry building marked `landmark: true`, in `order`, each followed by its variants. */
const bases = Object.values(BUILDINGS).filter((d) => d.landmark)
  .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export const LANDMARKS: Landmark[] = bases.flatMap((d) => BUILDING_VARIANTS.filter((v) => v.base === d.id)).map((v) => (
  { id: v.id, name: v.name, category: v.category, make: (p) => building(v.id, p as never) }
));
