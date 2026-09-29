import type { PieceSpec } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { block, extrude, pitchedRoof, splitRange, wallRun, type Range, type WallRunOpts } from '../../../levels/kit.ts';
import { layerize, roofDetail, withDetail } from '../../../levels/layers.ts';
import { band, canopy, hood, quoins } from '../../../levels/facade.ts';
import { fit, pew } from '../../../levels/interior.ts';
import { conduit, LIGHT, pendant, supplyBox } from '../../../levels/services.ts';
import { TINT } from '../../_shared/base.ts';
import { hall } from '../frame.ts';
import { BRICK, CAST } from '../lib.ts';

/** Brick booking hall (Flemish-bonded street front, stone dressings) with two-storey wings, slate roof on king-post
    trusses, entrance canopy and steps; booking-office counters, benches and the hall's pendant lighting inside. */
export function bookingHall(f: Frame): PieceSpec[] {
  const { HX, HZ, T, L1, L2 } = hall(f);
  const brick = { tint: BRICK }, stone = { tint: TINT.stone };
  const wall = (w: Partial<WallRunOpts> & { from: number; to: number; at: number; y0: number; h: number }): PieceSpec[] =>
    wallRun({ mat: 'brick', t: T, maxW: 2.6, sill: 'stone', lintel: 'stone', lintelH: 0.3, ...brick, ...w } as WallRunOpts);
  const win = (c: number, y0: number, h: number, w = 1.4) => ({ c, w, y0, h });
  const door = (c: number, w: number, h: number) => ({ c, w, y0: 0.9, h, glass: false });
  const wingC = [-17.5, -14, -10.5, 10.5, 14, 17.5], hallC = [-4.5, 0, 4.5];
  const ps: PieceSpec[] = [], face: PieceSpec[] = [];
  // front and back (the back opens on the concourse); the hall's tall windows run through both lifts
  for (const [at, out] of [[HZ - T / 2, 1], [T / 2, -1]] as const) {
    const front = out > 0, dst = front ? face : ps;
    dst.push(...wall({ from: -HX, to: HX, at, out, y0: L1[0], h: L1[1] - L1[0],
      openings: [...wingC.map((c) => win(c, 1.8, 2.6)), ...hallC.map((c) => door(c, front ? 2.4 : 3.0, front ? 3.2 : 3.6))] }));
    dst.push(...wall({ from: -HX, to: HX, at, out, y0: L2[0], h: L2[1] - L2[0],
      openings: [...wingC.map((c) => win(c, 1.2, 2.2)), ...hallC.map((c) => win(c, 0.6, 3.6, 2.4))] }));
  }
  for (const s of [-1, 1] as const) {
    const side = { axis: 'z' as const, from: T, to: HZ - T };
    ps.push(...wall({ ...side, at: s * (HX - T / 2), out: s, y0: L1[0], h: L1[1] - L1[0], openings: (s > 0 ? [4] : [4, 10]).map((c) => win(c, 1.8, 2.6)) }));
    ps.push(...wall({ ...side, at: s * (HX - T / 2), out: s, y0: L2[0], h: L2[1] - L2[0], openings: (s > 0 ? [4] : [4, 10]).map((c) => win(c, 1.2, 2.2)) }));
    // cross walls between the hall and the wings
    ps.push(...wall({ ...side, at: s * 8, y0: L1[0], h: L1[1] - L1[0], sill: undefined, openings: [door(7, 1.2, 2.1)] }));
    ps.push(...wall({ ...side, at: s * 8, y0: L2[0], h: L2[1] - L2[0], sill: undefined, openings: [{ c: 7, w: 1.0, y0: 0.3, h: 2.1, glass: false }] }));
    // wing spine (corridor) wall and first floor on it
    const wx: Range = s < 0 ? [-HX + T, -8 - T / 2] : [8 + T / 2, HX - T];
    ps.push(...wallRun({ mat: 'brick', from: wx[0], to: wx[1], at: 7, t: 0.225, y0: 0.9, h: L1[1] - 0.9, maxW: 3.2, ...brick,
      openings: [{ c: s * 14, w: 0.9, y0: 0, h: 2.1, glass: false }] }));
    for (const x of splitRange(wx[0], wx[1], 4)) for (const z of [[T, 7], [7, HZ - T]] as Range[]) ps.push(block('plywood', x, [L1[1], L1[1] + 0.3], z, { tint: 0xa98b66 }));
    // made-ground floor of the wing
    for (const x of splitRange(wx[0], wx[1], 6)) for (const z of [[T, 7], [7, HZ - T]] as Range[]) ps.push(block('concrete', x, [0, 0.9], z, { tint: 0xa9a293 }));
  }
  for (const x of splitRange(-8 + T / 2, 8 - T / 2, 5.3)) for (const z of [[T, 7], [7, HZ - T]] as Range[]) {
    ps.push(withDetail(block('concrete', x, [0, 0.9], z, { tint: 0xa9a293 }),
      splitRange(x[0], x[1], 0.6).flatMap((u) => splitRange(z[0], z[1], 0.6).map((v) => block('stone', [u[0] + 0.003, u[1] - 0.003], [0.84, 0.9], [v[0] + 0.003, v[1] - 0.003], { tint: (Math.round(u[0] / 0.6) + Math.round(v[0] / 0.6)) & 1 ? 0xd9d1c0 : 0x8f5a48 })))));
  }
  // the street front is laid brick by brick (Flemish bond); the other walls stay plain members to hold the budget
  const out: PieceSpec[] = [...layerize(face, { brick: 'solid', maxUnits: 3200 }), ...ps.map((q) => (q.mat === 'plywood' ? layerize([q], { timber: true })[0] : q))];
  // slate roof on king-post trusses, brick gables at both ends and fire gables over the cross walls
  out.push(...pitchedRoof({ mat: 'roof', x: [-HX - 0.3, HX], z: [0, HZ], y: L2[1], rise: 5.2, thick: 0.34, seat: 0.3, maxW: 4.2, tint: TINT.slate,
    gables: { mat: 'brick', x: [[-HX, -HX + T], [-8 - T / 2, -8 + T / 2], [8 - T / 2, 8 + T / 2], [HX - T, HX]], tint: brick.tint } }).map((q) => q.mat === 'roof' && q.size[1] > 1 ? roofDetail(q, { tile: 'slate' }) : q));
  {
    const zi = HZ - T, h = L2[1], kk = 5.2 / (HZ / 2 - 0.3), under = (dz: number) => h + kk * (HZ / 2 - 0.3 - dz), oak = { tint: TINT.woodDark };
    for (const x of [-4.8, -1.6, 1.6, 4.8]) {
      const xr: Range = [x - 0.12, x + 0.12];
      out.push(block('oak', [x - 0.15, x + 0.15], [h - 0.35, h], [T, zi], oak), block('oak', xr, [h, under(0.12)], [HZ / 2 - 0.12, HZ / 2 + 0.12], oak));
      for (const s of [-1, 1]) out.push(extrude('oak', [[HZ / 2 + s * (zi - HZ / 2), h], [HZ / 2 + s * (zi - HZ / 2), under(zi - HZ / 2)], [HZ / 2 + s * 0.12, under(0.12)], [HZ / 2 + s * 0.12, under(0.12) - 0.35]], 'x', xr, oak));
    }
  }
  // stone dressings: plinth, first-floor string course, cornice, quoins, hood moulds over the hall openings
  for (const [face, out_] of [[HZ, 1], [0, -1]] as const) {
    out.push(...band({ mat: 'stone', face, out: out_, from: -HX, to: HX, y: [5.2, 5.5], depth: 0.1, profile: 'drip', ...stone }));
    out.push(...band({ mat: 'stone', face, out: out_, from: -HX, to: HX, y: [10.1, L2[1]], depth: 0.25, profile: 'cornice', ...stone }));
    for (const c of hallC) out.push(...hood({ face, out: out_ }, [c - 1.2, c + 1.2], L2[0] + 4.2, { ...stone, rise: 0.2 }));
    for (const [u, d] of [[-HX, 1], [HX, -1]] as const) out.push(...quoins({ face, out: out_ }, u, d, [0.3, 5.2], 7, stone), ...quoins({ face, out: out_ }, u, d, [5.5, 10.1], 7, stone));
  }
  out.push(...canopy({ face: HZ }, [-6.2, 6.2], 4.4, 2.6, { mat: 'metal', brackets: true, tint: CAST }));
  // entrance steps up to the hall floor
  for (const c of hallC) for (let i = 0; i < 5; i++) out.push(block('stone', [c - 1.4, c + 1.4], [0, 0.18 * (i + 1)], [HZ + 1.56 - 0.3 * (i + 1), HZ + 1.56 - 0.3 * i], stone));
  // interior: booking-office counter and glazed screen, benches, a supply box feeding pendants from the tie beams
  out.push(block('oak', [-6.5, -1.5], [0.9, 2.0], [3.0, 3.8], { tint: TINT.woodDark }), block('glass', [-6.5, -1.5], [2.0, 3.1], [3.37, 3.43], { tint: 0xd8e4e6 }));
  out.push(block('oak', [1.5, 6.5], [0.9, 2.0], [3.0, 3.8], { tint: TINT.woodDark }), block('glass', [1.5, 6.5], [2.0, 3.1], [3.37, 3.43], { tint: 0xd8e4e6 }));
  for (const x of [-4, 4]) for (const z of [8.4, 10.6]) out.push(...fit(pew(3.0), x, z, 0.9, 0));
  out.push(supplyBox([-8 + T / 2, -8 + T / 2 + 0.25], [1.4, 2.2], [11.0, 11.6]));
  out.push(...conduit([[-7.65, 2.2, 11.3], [-7.65, 10.11, 11.3], [-7.65, 10.11, 7], [4.8, 10.11, 7]]));
  for (const x of [-4.8, -1.6, 1.6, 4.8]) out.push(...pendant(x, 7, 10.07, 2.2, LIGHT.warm, 0.5));
  return out;
}
