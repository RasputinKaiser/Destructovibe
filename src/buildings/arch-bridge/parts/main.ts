import type { PieceSpec } from '../../../types.ts';
import { block, extrude, place, splitRange, stairs, type PieceOpts, type Range } from '../../../levels/kit.ts';
import { streetLamp } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Semicircular stone arch bridge along X: thirteen radiating hull voussoirs per ring (two rings across the width)
    with a keystone rising to the deck, sandstone spandrel courses and columns cut to the extrados, paved deck,
    parapets with copings and stone stairs at both ends. */
export function stoneArchBridge(p: Placement): PieceSpec[] {
  const R = 3.0, T = 0.6, N = 13, ys = 0.6, L = 13, W = 3.2;
  const stone = { tint: TINT.stone }, sand = { tint: TINT.sand }, key = { tint: 0xd8d2c4 };
  const at = (r: number, i: number): [number, number] => {
    const a = Math.PI - (i * Math.PI) / N;
    return [r * Math.cos(a), ys + r * Math.sin(a)];
  };
  const I = (i: number) => at(R, i), E = (i: number) => at(R + T, i);
  const yD = ys + R + T + 0.3, kst = (N - 1) / 2;
  const ps: PieceSpec[] = [];
  const mirror = (pr: [number, number][]) => pr.map(([x, y]) => [-x, y] as [number, number]);
  for (const z of [[-W / 2, 0], [0, W / 2]] as Range[]) {
    const slab = (pr: [number, number][], mat: 'stone' | 'sandstone', o: PieceOpts) => ps.push(extrude(mat, pr, 'z', z, o));
    for (let i = 0; i < N; i++) {
      const pr: [number, number][] = [I(i), I(i + 1), E(i + 1), E(i)];
      if (i === kst) pr.push([E(i)[0], yD], [E(i + 1)[0], yD]);
      slab(pr, 'stone', i === kst ? key : stone);
    }
    for (const m of [false, true]) {
      const f = (pr: [number, number][]) => (m ? mirror(pr) : pr);
      for (let i = 0; i < 3; i++) slab(f([[-L / 2, E(i)[1]], E(i), E(i + 1), [-L / 2, E(i + 1)[1]]]), 'sandstone', sand);
      slab(f([[-L / 2, E(3)[1]], [E(3)[0], E(3)[1]], [E(3)[0], yD], [-L / 2, yD]]), 'sandstone', sand);
      for (let i = 3; i < kst; i++) slab(f([E(i), E(i + 1), [E(i + 1)[0], yD], [E(i)[0], yD]]), 'sandstone', sand);
      ps.push(block('stone', m ? [R, L / 2] : [-L / 2, -R], [0, ys], z, stone));
    }
    for (const u of splitRange(-L / 2, L / 2, 3.3)) ps.push(block('stone', u, [yD, yD + 0.3], z, stone));
  }
  const top = yD + 0.3;
  for (const s of [-1, 1]) {
    const wall: Range = s > 0 ? [W / 2 - 0.3, W / 2] : [-W / 2, -W / 2 + 0.3];
    const cope: Range = s > 0 ? [W / 2 - 0.35, W / 2 + 0.05] : [-W / 2 - 0.05, -W / 2 + 0.35];
    for (const u of splitRange(-L / 2, L / 2, 3.3)) {
      ps.push(block('sandstone', u, [top, top + 0.8], wall, sand), block('stone', u, [top + 0.8, top + 0.92], cope, stone));
    }
  }
  // stairs at a real rise and going (≈0.18 × 0.28), turning off a landing at each end to run along the bank
  const steps = Math.ceil(top / 0.18), run = 0.28, land: Range = [L / 2, L / 2 + W], fw = 1.8, py: Range = [top, top + 0.8];
  const end = [
    block('stone', land, [0, top], [-W / 2, W / 2], stone),
    ...place(stairs('stone', -steps * run, [-land[1], -land[1] + fw], 0, steps, top / steps, run, stone), 0, -W / 2, 3),
    block('sandstone', land, py, [W / 2 - 0.3, W / 2], sand), block('sandstone', [land[1] - 0.3, land[1]], py, [-W / 2, W / 2 - 0.3], sand),
    block('sandstone', [land[0], land[1] - fw], py, [-W / 2, -W / 2 + 0.3], sand),
  ];
  ps.push(...end, ...place(end, 0, 0, 2));
  ps.push(...place(streetLamp(6, 1.1), -8, -2.2), ...place(streetLamp(6, 1.1), 8, 2.2, 2));
  return put(ps, p, 'archbridge', { age: { years: 160, exposure: 'wet' } });
}
