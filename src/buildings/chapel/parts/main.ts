import type { PieceSpec } from '../../../types.ts';
import { block, flagpole, box, cyl, extrude, hollowStack, pitchedRoof, prism, ringCourse, splitRange, wallRun, wedge, GLASS_T, type Range, type WallRunOpts } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { band } from '../../../levels/facade.ts';
import { fit, pew } from '../../../levels/interior.ts';
import { conduit, LIGHT, pendant, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Sandstone chapel with a stone west tower: buttressed nave (wedge weatherings) with stained-glass lancets and
    a rose window, marble porch, pitched slate roof, octagonal oak belfry with a cast bell, and an octagonal slate
    spire of tapering hull facets (~27 m). */
export function chapel(p: Placement & { graves?: number }): PieceSpec[] {
  const t = 0.45, h = 5.2, X0 = -5, X1 = 9, Z = 3.5;
  const sand = { tint: TINT.sand }, stone = { tint: TINT.stone }, slate = { tint: TINT.slate }, oak = { tint: TINT.woodDark };
  const stained = [0xd05a50, 0x5a78d0, 0xe0b848, 0x68b078];
  const lancet = (c: number) => ({ c, w: 0.8, y0: 1.4, h: 2.8 });
  const wall = { mat: 'sandstone' as const, t, y0: 0, h, maxW: 2.6, ...sand };
  // three-leaf walls: dressed ashlar faces either side of a lime-and-rubble core; only the core carries the glazing
  const leaves = (w: WallRunOpts): PieceSpec[] => {
    const s = w.out ?? 1, f = 0.12, core = t - 2 * f, dry = (w.openings ?? []).map((o) => ({ ...o, glass: false }));
    return [
      ...wallRun({ ...w, t: f, at: w.at + s * (t - f) / 2, openings: dry }),
      ...wallRun({ ...w, t: core, at: w.at, mat: 'concrete', tint: 0xb5a88f, sill: undefined, maxW: 3.4 }),
      ...wallRun({ ...w, t: f, at: w.at - s * (t - f) / 2, openings: dry, sill: undefined }),
    ];
  };
  const ps: PieceSpec[] = [
    ...leaves({ ...wall, from: X0, to: X1, at: Z - t / 2, openings: [{ c: -3, w: 1.4, y0: 0, h: 2.8 }, lancet(0), lancet(3), lancet(6)] }),
    ...leaves({ ...wall, from: X0, to: X1, at: -Z + t / 2, out: -1, openings: [-3, 0, 3, 6].map(lancet) }),
    ...leaves({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X1 - t / 2, openings: [{ c: 0, w: 2.4, y0: 1.6, h: 2.4, glass: false }] }),
    ...leaves({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X0 + t / 2, out: -1 }),
  ];
  // rose window: stone tracery rows filling the east opening, glass inside a circle, central mullion
  const rx: Range = [X1 - t, X1], gx: Range = [X1 - t / 2 - GLASS_T / 2, X1 - t / 2 + GLASS_T / 2], m = 0.07;
  for (let k = 0; k < 8; k++) {
    const y: Range = [1.6 + 0.3 * k, 1.9 + 0.3 * k];
    const dy = Math.max(Math.abs(y[0] - 2.8), Math.abs(y[1] - 2.8));
    const w = Math.min(1.1, Math.sqrt(Math.max(0, 1.44 - dy * dy)));
    if (w < m + 0.1) { ps.push(block('stone', rx, y, [-1.2, 1.2], stone)); continue; }
    ps.push(block('stone', rx, y, [-1.2, -w], stone), block('stone', rx, y, [-m, m], stone), block('stone', rx, y, [w, 1.2], stone));
    ps.push(block('glass', gx, y, [-w, -m], { tint: stained[k % 4] }), block('glass', gx, y, [m, w], { tint: stained[(k + 2) % 4] }));
  }
  ps.filter((q) => q.mat === 'glass' && q.tint === undefined).forEach((q, i) => { q.tint = stained[i % stained.length]; });
  // buttresses: two stages, each weathered back to the wall with a wedge
  for (const s of [-1, 1]) {
    for (const bx of [-1.35, 1.5, 4.5, 7.7]) {
      const zz = (d0: number, d1: number): Range => (s > 0 ? [Z + d0, Z + d1] : [-Z - d1, -Z - d0]);
      const x: Range = [bx - 0.3, bx + 0.3], toWall = s > 0 ? '-z' : '+z';
      ps.push(block('stone', x, [0, 2.6], zz(0, 0.7), stone), wedge('stone', x, [2.6, 2.9], zz(0.45, 0.7), toWall, stone));
      ps.push(block('stone', x, [2.6, 4.2], zz(0, 0.45), stone), wedge('stone', x, [4.2, 4.8], zz(0, 0.45), toWall, stone));
    }
  }
  const pz = Z + 1.6;
  for (const x of [-3.75, -2.25]) ps.push(prism('marble', 0.35, [0, 2.8], x, pz, 16, { tint: TINT.white }));
  ps.push(block('stone', [-4.0, -2.0], [2.8, 3.1], [pz - 0.25, pz + 0.25], stone), block('roof', [-4.2, -1.8], [3.1, 3.3], [Z, pz + 0.3], slate));
  const roof = pitchedRoof({ mat: 'roof', x: [X0, X1 + 0.3], z: [-Z, Z], y: h, rise: 3.8, thick: 0.4, seat: 0.25, maxW: 3.6, tint: TINT.slate,
    gables: { mat: 'sandstone', x: [[X0, X0 + t], [X1 - t, X1]], tint: TINT.sand } });
  ps.push(...roof);
  const ridge = Math.max(...roof.map((q) => q.pos[1] + q.size[1] / 2)), cx = X1 - 0.4;
  ps.push(block('stone', [cx - 0.12, cx + 0.12], [ridge, ridge + 1.2], [-0.12, 0.12], stone));
  for (const z of [[0.12, 0.45], [-0.45, -0.12]] as Range[]) ps.push(block('stone', [cx - 0.12, cx + 0.12], [ridge + 0.55, ridge + 0.8], z, stone));
  // tower: hollow ashlar courses with the west face of the first course opened into a doorway
  const tx = X0 - 2.1, a = 2.1, towerTop = 12.5;
  const tower = hollowStack('stone', tx, 0, 0, 2 * a, 0.55, 2.5, 5, stone);
  // (each course is one ring body: drop the first ring's west wall)
  tower[0].parts = tower[0].parts!.filter((q) => !(q.pos[0] < -1 && Math.abs(q.pos[2]) < 1e-6));
  const wx: Range = [tx - a, tx - a + 0.55];
  tower.push(block('stone', wx, [0, 2.5], [-a + 0.55, -0.6], stone), block('stone', wx, [0, 2.5], [0.6, a - 0.55], stone),
    block('stone', wx, [2.2, 2.5], [-0.6, 0.6], stone));
  ps.push(...tower, block('plaster', [tx - 0.6, tx + 0.6], [10.3, 11.5], [a, a + 0.08], { tint: TINT.white }));
  // octagonal belfry: floor, eight posts on the octagon corners, louvre boards between them, a cornice ring
  const post = 1.65, by: Range = [towerTop + 0.15, towerTop + 3.15];
  ps.push(prism('oak', 4.0, [towerTop, by[0]], tx, 0, 8, oak));
  for (let i = 0; i < 8; i++) {
    const ap = Math.PI / 8 + (i * Math.PI) / 4, am = ap + Math.PI / 8;
    ps.push(prism('oak', 0.3, by, tx + post * Math.cos(ap), post * Math.sin(ap), 8, oak));
    const rm = post * Math.cos(Math.PI / 8), chord = 2 * post * Math.sin(Math.PI / 8) - 0.3;
    const louvre = box('wood', [chord, 1.4, 0.1], [tx + rm * Math.cos(am), 13.4 + 0.7, rm * Math.sin(am)], { tint: TINT.woodPale });
    louvre.rotY = -(am + Math.PI / 2);
    ps.push(louvre);
  }
  const spireY = by[1] + 0.25;
  ps.push(prism('stone', 4.3, [by[1], spireY], tx, 0, 8, stone));
  ps.push(block('oak', [tx - 1.2, tx + 1.2], [by[1] - 0.3, by[1]], [-0.15, 0.15], oak));
  ps.push(cyl('castiron', 1.0, [by[1] - 1.2, by[1] - 0.3], tx, 0, { tint: TINT.bronze }));
  // spire: eight slate facets per stage, each a tapering sector hull; the facets meet on flat radial joints
  const vr = 2.0 / Math.cos(Math.PI / 8), mid = spireY + 5.2, apex = mid + 4.6;
  ps.push(...ringCourse('roof', tx, 0, [spireY, mid], [vr - 0.24, 0.72], [vr, 0.95], 8, slate, Math.PI / 8));
  ps.push(...ringCourse('roof', tx, 0, [mid, apex], [0.72, 0], [0.95, 0.16], 8, slate, Math.PI / 8));
  ps.push(prism('steel', 0.2, [apex, apex + 1.4], tx, 0, 8, { tint: TINT.bronze }));
  // Dressings: a plinth and a sill-level string course between the buttresses, hood moulds over the lancets and a
  // cornice along both eaves.
  for (const s of [-1, 1] as const) {
    const segs: Range[] = s > 0 ? [[X0, -3.7], [-2.3, -1.65], [-1.05, 1.2], [1.8, 4.2], [4.8, 7.4], [8.0, X1]] : [[X0, -1.65], [-1.05, 1.2], [1.8, 4.2], [4.8, 7.4], [8.0, X1]];
    for (const [a, b] of segs) {
      ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: a, to: b, y: [0, 0.4], depth: 0.1, tint: TINT.stone }));
      ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: a, to: b, y: [1.2, 1.32], depth: 0.1, profile: 'drip', tint: TINT.stone }));
    }
    for (const c of s > 0 ? [0, 3, 6] : [-3, 0, 3, 6]) ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: c - 0.5, to: c + 0.5, y: [4.2, 4.36], depth: 0.1, profile: 'drip', tint: TINT.stone }));
    ps.push(...band({ mat: 'stone', face: s * Z, out: s, from: X0, to: X1, y: [4.9, h], depth: 0.22, profile: 'cornice', tint: TINT.stone }));
  }
  // two oak tie beams carry chandeliers on chains; their feed runs from a west-wall supply along the north wall head
  const zi = Z - t;
  ps.push(supplyBox([X0 + t, X0 + t + 0.2], [1.0, 1.6], [2.2, 2.7]));
  ps.push(...conduit([[X0 + t + 0.1, 1.6, 2.45], [X0 + t + 0.1, 4.78, 2.45], [X0 + t + 0.1, 4.78, zi - 0.04], [4.9, 4.78, zi - 0.04]]));
  for (const x of [0.75, 4.75]) ps.push(...conduit([[x, 4.86, zi], [x, 4.86, 0]]), ...pendant(x, 0, 4.82, 1.3, LIGHT.candle, 0.5));
  // king-post trusses: tie beam on the wall heads, king post to the ridge, principal rafters under the slates
  {
    const half = Z, seat = 0.25, kk = 3.8 / (half - seat), under = (dz: number) => h + kk * (half - seat - dz);
    for (const x of [-2.6, 0.75, 4.75, 7.4]) {
      ps.push(block('oak', [x - 0.15, x + 0.15], [4.9, h], [-zi, zi], oak), block('oak', [x - 0.1, x + 0.1], [h, under(0.12)], [-0.12, 0.12], oak));
      for (const s of [-1, 1]) ps.push(extrude('oak', [[s * zi, h], [s * zi, under(zi)], [s * 0.12, under(0.12)], [s * 0.12, under(0.12) - 0.3]], 'x', [x - 0.1, x + 0.1], oak));
    }
  }
  // flagged floor, altar and two blocks of pews facing east
  for (const x of splitRange(X0 + t, X1 - t, 3.4)) for (const z of [[-zi, 0], [0, zi]] as Range[]) ps.push(block('stone', x, [0, 0.1], z, { tint: 0xc9c1b0 }));
  ps.push(block('marble', [7.4, 8.2], [0.1, 1.05], [-0.9, 0.9], { tint: TINT.white }));
  if (p.interior !== false) for (let x = -2.4; x <= 5.9; x += 0.95) for (const z of [-1.7, 1.7]) ps.push(...fit(pew(2.2), x, z, 0.1, 1));
  for (let i = 0; i < (p.graves ?? 0); i++) {
    const gx0 = -1 + (i % 5) * 2.2, gz = Z + 2.5 + Math.floor(i / 5) * 2.2;
    ps.push(block('marble', [gx0 - 0.3, gx0 + 0.3], [0, 0.85], [gz - 0.08, gz + 0.08], { tint: TINT.white }));
  }
  ps.push(flagpole(X0 - 2.1 + 1.75, 1.75, 12.5, 3.2, [1.3, 0.85], 0xf2f2ee));
  return put(layerize(ps, { stone: true, roofs: 'slate', timber: true }), p, 'chapel', { age: { years: 170, exposure: 'wet' } });
}
