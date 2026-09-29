import type { PieceSpec } from '../../../types.ts';
import { block, flight, panels, place, stairs, type Range } from '../../../levels/kit.ts';
import { pipe, stopcock, streetLamp } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** 20 m Warren truss footbridge: bottom and top chords, stepped diagonals, cross girders, timber deck,
    top lateral struts, concrete abutments and approach steps. */
export function trussBridge(p: Placement): PieceSpec[] {
  const half = 10, panel = 4, yb = 1.2, H = 3.5, zc = 2.2, c = 0.125;
  const steel = { tint: TINT.metalGreen };
  const yTop = yb + H;
  const ps: PieceSpec[] = [];
  const bottoms = Array.from({ length: 6 }, (_, i) => -half + i * panel);
  const tops = bottoms.slice(0, 5).map((x) => x + panel / 2);
  for (const s of [-1, 1]) {
    const cz: Range = [s * zc - c, s * zc + c], plane: Range = [s * zc - 0.08, s * zc + 0.08];
    for (let i = 0; i < 5; i++) ps.push(block('steel', [bottoms[i], bottoms[i + 1]], [yb, yb + 0.3], cz, steel));
    for (let i = 0; i < 4; i++) ps.push(block('steel', [tops[i], tops[i + 1]], [yTop - 0.3, yTop], cz, steel));
    tops.forEach((t, i) => {
      for (const from of [bottoms[i], bottoms[i + 1]]) {
        ps.push(...flight({ mat: 'steel', axis: 'x', from, to: t, cross: plane, y0: yb + 0.3, steps: 4, rise: (H - 0.6) / 4, lap: 0.15, ...steel }));
      }
    });
  }
  const inner: Range = [-zc + c, zc - c];
  const girders = [-half + 0.15, ...bottoms.slice(1, 5), half - 0.15];
  for (const x of girders) ps.push(block('steel', [x - 0.15, x + 0.15], [yb, yb + 0.3], inner, steel));
  ps.push(...panels('wood', [-half, ...bottoms.slice(1, 5), half], [yb + 0.3, yb + 0.42], inner, { tint: TINT.woodDark }));
  for (const t of tops) ps.push(block('steel', [t - 0.125, t + 0.125], [yTop - 0.3, yTop], inner, steel));
  const con = { tint: TINT.concrete };
  const flightW: Range = [-1.8, 1.8];
  for (const s of [-1, 1]) {
    ps.push(block('concrete', s > 0 ? [half - 0.4, half + 1] : [-half - 1, -half + 0.4], [0, yb], [-zc - 0.4, zc + 0.4], con));
    ps.push(block('concrete', s > 0 ? [half, half + 1] : [-half - 1, -half], [yb, yb + 0.42], inner, con));
  }
  const up = stairs('concrete', -half - 1 - 9 * 0.28, flightW, 0, 9, (yb + 0.42) / 9, 0.28, con);
  ps.push(...up, ...place(up, 0, 0, 2));
  // water main slung under the cross girders, valved at the west end; a street lamp at each approach
  ps.push(...pipe('water', 'castiron', [[-half + 0.4, yb - 0.1, 0], [half - 0.4, yb - 0.1, 0]], 0.2), stopcock([-8.3, -7.9], [0, yb - 0.2], [-0.2, 0.2]));
  ps.push(...place(streetLamp(5.5, 1.0), -11.5, -2.9), ...place(streetLamp(5.5, 1.0), 11.5, 2.9, 2));
  return put(ps, p, 'trussbridge', { age: { years: 110, exposure: 'outdoor' } });
}
