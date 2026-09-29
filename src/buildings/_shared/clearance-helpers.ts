import type { PieceSpec } from '../../types.ts';
import { block, envelopeFinish, place, tag } from '../../levels/kit.ts';
import { BORE, clipped, stopcock } from '../../levels/services.ts';
import type { Placement } from './base.ts';

export function put(ps: PieceSpec[], p: Placement, fallback: string): PieceSpec[] {
  return tag(place(envelopeFinish(ps), p.x, p.z, p.rot ?? 0), { group: p.group ?? fallback });
}

/** Sink base under a back-wall window at `c` (inner face `bi`, room toward +Z): two end panels and the sink, with the
    stopcock at the foot of the wall inside it and the 15 mm rising main clipped up to the sink. */
export function kitchenSink(c: number, bi: number): PieceSpec[] {
  const zc = bi + 0.048;
  return [
    block('wood', [c - 0.6, c - 0.55], [0, 0.87], [bi, bi + 0.6], { tint: 0xe8e2d4 }),
    block('wood', [c + 0.55, c + 0.6], [0, 0.87], [bi, bi + 0.6], { tint: 0xe8e2d4 }),
    block('steel', [c - 0.6, c + 0.6], [0.87, 0.95], [bi, bi + 0.6], { tint: 0xc9cdd0 }),
    stopcock([c - 0.1, c + 0.15], [0.15, 0.45], [bi, bi + 0.2]),
    ...clipped('water', 'copper', [[c + 0.025, 0.45, zc], [c + 0.025, 0.87, zc]], BORE.cu15, [0, 0, -1]),
  ];
}
