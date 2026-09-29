import type { PieceSpec } from '../../../types.ts';
import { block, crates, cyl, drums, panels, splitRange, tnt, type Range } from '../../../levels/kit.ts';
import { lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** 32 m two-lane overpass along X: twin-column piers, crossheads, precast girders, deck panels, parapets, lamps. */
export function overpass(p: Placement & { traffic?: boolean }): PieceSpec[] {
  const L = 16, W = 4.6;
  const con = { tint: TINT.concrete }, dark = { tint: TINT.darkConcrete };
  const ps: PieceSpec[] = [];
  const zHalves = [-W, 0, W];
  for (const x of [-8, 0, 8]) {
    for (const z of [-2.5, 2.5]) for (const y of [[0, 2.5], [2.5, 5.0]] as Range[]) ps.push(cyl('rconcrete', 1.0, y, x, z, con));
    ps.push(...panels('rconcrete', [x - 0.6, x + 0.6], [5.0, 5.8], zHalves, con));
  }
  for (const s of [-1, 1]) {
    const seat: Range = s > 0 ? [L - 0.6, L + 0.2] : [-L - 0.2, -L + 0.6];
    const ballast: Range = s > 0 ? [L, L + 0.2] : [-L - 0.2, -L];
    ps.push(...panels('concrete', seat, [0, 5.8], zHalves, dark), ...panels('concrete', ballast, [5.8, 6.85], zHalves, dark));
  }
  for (const z of [-3.3, -1.1, 1.1, 3.3]) {
    for (const span of [[-16, -8], [-8, 0], [0, 8], [8, 16]] as Range[]) ps.push(block('rconcrete', span, [5.8, 6.6], [z - 0.2, z + 0.2], con));
  }
  const xs = splitRange(-L, L, 2.7).map((r) => r[0]).concat(L);
  ps.push(...panels('rconcrete', xs, [6.6, 6.85], [-W, -1.5333, 1.5333, W], dark));
  ps.push(...panels('rconcrete', xs, [6.85, 7.85], [W - 0.25, W], con), ...panels('rconcrete', xs, [6.85, 7.85], [-W, -W + 0.25], con));
  for (const [x, s] of [[-12, 1], [-4, -1], [4, 1], [12, -1]]) {
    const post: Range = s > 0 ? [W - 0.2, W - 0.05] : [-W + 0.05, -W + 0.2];
    const arm: Range = s > 0 ? [W - 1.4, W - 0.05] : [-W + 0.05, -W + 1.4];
    const live = { tint: TINT.steelGrey, util: 'power' as const };
    ps.push(block('steel', [x - 0.075, x + 0.075], [7.85, 12.85], post, live));
    ps.push(block('steel', [x - 0.1, x + 0.1], [12.85, 13.0], arm, live));
    ps.push(supplyBox([x + 0.075, x + 0.4], [7.85, 8.6], post));
    ps.push(lamp([x - 0.15, x + 0.15], [12.6, 12.85], s > 0 ? [W - 1.4, W - 1.0] : [-W + 1.0, -W + 1.4], LIGHT.sodium));
  }
  if (p.traffic) {
    ps.push(...drums('barrel', -4, -2.6, 6.85, 3, 2), ...drums('propane', 4.4, 2.4, 6.85, 2, 2));
    ps.push(...crates(-10.5, 2.2, 6.85, 2, 2, 2), ...tnt(10, -2.4, 6.85, 2));
  }
  return put(ps, p, 'overpass', { age: { years: 55, exposure: 'salt' } });
}
