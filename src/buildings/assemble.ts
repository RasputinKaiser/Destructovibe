import type { AgeSpec, PieceSpec, PrefabView, Vec3 } from '../types.ts';
import type { Range } from '../levels/kit.ts';
import type { Placement } from './_shared/base.ts';
import { finish } from '../levels/architecture/common.ts';
import { canonicalKey } from './fingerprint.ts';

/** A bearing surface: the horizontal plane at `y` over x/z, or, with `normal`, the inclined plane through `point` (default
    [mid x, y, mid z]) whose outward normal is `normal`, still limited to the x/z extent. */
export interface Bearing { y: number; x: Range; z: Range; normal?: Vec3; point?: Vec3 }
export interface Frame { levels: Record<string, number>; grid: { x: Record<string, number>; z: Record<string, number> }; footprint: { x: Range; z: Range }; bearings: Record<string, Bearing> }
export interface PartDef<P> { id: string; budget: number; provides?: string[]; needs?: string[]; build(f: Frame, p: P): PieceSpec[] }
export interface BuildingDef<P = Record<string, unknown>> {
  id: string; name: string; category: PrefabView['category']; group: string; age?: AgeSpec;
  defaults: P; variants?: { id: string; name: string; params: Partial<P>; category?: PrefabView['category'] }[];
  /** 'finish' (default): assemble applies the landmark finish pipeline; 'raw': parts already return placed, finished pieces (migrated legacy functions) */
  pipeline?: 'finish' | 'raw';
  /** listed in LANDMARKS (src/levels/architecture/index.ts) and at the end of the prefab palette, ordered by `order` */
  landmark?: true; order?: number;
  frame(p: P): Frame; parts: PartDef<P>[];
}

export function footprintFrame(x: Range, z: Range): Frame {
  return { levels: {}, grid: { x: {}, z: {} }, footprint: { x, z }, bearings: {} };
}

export function buildParts<P>(def: BuildingDef<P>, params: P): { part: string; pieces: PieceSpec[] }[] {
  const f = def.frame(params);
  return def.parts.map((pt) => {
    const pieces = pt.build(f, params);
    for (const q of pieces) q.part = `${def.id}/${pt.id}`;
    return { part: pt.id, pieces };
  });
}

export function assemble<P>(def: BuildingDef<P>, placement: Placement & Partial<P>): PieceSpec[] {
  const params = { ...def.defaults, ...placement } as P & Placement;
  const all = buildParts(def, params).flatMap((x) => x.pieces);
  if (def.pipeline === 'raw') return all;
  /* Canonical piece order (by the fingerprint's line, in local coordinates): the collapse sim is sensitive to piece creation
     order, so the order must not depend on part order or on how a part happens to emit its pieces. */
  const keyed = all.map((p) => ({ k: canonicalKey(p), p }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return finish(keyed.map((x) => x.p), placement, def.group, def.age);
}
