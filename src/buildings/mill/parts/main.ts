import type { PieceSpec } from '../../../types.ts';
import { block, crates, drums, extrude, panels, pitchedRoof, prism, pipeRun, splitRange, wallRun, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { riggingLine, wireLine } from '../../../levels/rigging.ts';
import { downpipe, quoins } from '../../../levels/facade.ts';
import { fit, loom, pallet, workbench } from '../../../levels/interior.ts';
import { conduit, gasMeter, lamp, LIGHT, pipe, radiatorPanel, stopcock, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { boiler, lineDrive, put } from '../../_shared/structures-helpers.ts';

/** Two-storey brick mill, 19 x 11 m: cast-iron columns, compartmented floors, stepped slate roof. */
export function mill(p: Placement & { stock?: boolean }): PieceSpec[] {
  const X = 9.5, Z = 5.5, t = 0.3, h1 = 3.8, h2 = 4.2;
  const wall = { mat: 'brick' as const, t, maxW: 2.4, tint: TINT.brickPale, sill: 'stone' as const };
  const w = (c: number, y0 = 0.9) => ({ c, w: 1.3, y0, h: 2.0 });
  const long = { ...wall, from: -X, to: X };
  const front = { ...long, lintel: 'stone' as const };
  const end = { ...wall, axis: 'z' as const, from: -Z + t, to: Z - t };
  const ps: PieceSpec[] = [
    ...wallRun({ ...front, at: Z - t / 2, y0: 0, h: h1, openings: [w(-6), w(-3), { c: 0, w: 2.2, y0: 0, h: 3.0 }, w(3), w(6)] }),
    ...wallRun({ ...front, at: Z - t / 2, y0: h1, h: h2, openings: [-6, -3, 0, 3, 6].map((c) => w(c, 0.8)) }),
    ...wallRun({ ...long, at: -Z + t / 2, out: -1, y0: 0, h: h1, openings: [-4.5, -1.5, 1.5, 4.5].map((c) => w(c)) }),
    ...wallRun({ ...long, at: -Z + t / 2, out: -1, y0: h1, h: h2, openings: [-4.5, -1.5, 1.5, 4.5].map((c) => w(c, 0.8)) }),
  ];
  for (const s of [-1, 1] as const) {
    ps.push(...wallRun({ ...end, at: s * (X - t / 2), out: s, y0: 0, h: h1, openings: [w(0, 0.8)] }));
    ps.push(...wallRun({ ...end, at: s * (X - t / 2), out: s, y0: h1, h: h2, openings: [w(-2, 0.8), w(2, 0.8)] }));
  }
  // Five grounded foundation wings spread the bearing-wall perimeter; the front
  // loading entrance stays open, and every wing meets masonry along its inner face.
  const foot = { tint: TINT.darkConcrete };
  ps.push(block('concrete', [-X - 0.4, X + 0.4], [0, 0.32], [-Z - 0.4, -Z], foot));
  ps.push(block('concrete', [-X - 0.4, -1.2], [0, 0.32], [Z, Z + 0.4], foot));
  ps.push(block('concrete', [1.2, X + 0.4], [0, 0.32], [Z, Z + 0.4], foot));
  for (const s of [-1, 1]) ps.push(block('concrete', s < 0 ? [-X - 0.4, -X] : [X, X + 0.4], [0, 0.32], [-Z, Z], foot));
  // first floor: girder on two columns, joists at the board seams, boards
  const inner = X - t, zi = Z - t;
  const seams = [inner * -1, ...splitRange(-inner, inner, 2.6).map((r) => r[1])];
  const g1 = seams[2], g2 = seams[4];
  for (const r of [[-inner, g1], [g1, g2], [g2, inner]] as Range[]) ps.push(block('castiron', r, [3.0, 3.3], [-0.15, 0.15], { tint: TINT.iron }));
  for (const x of [g1, g2]) ps.push(prism('castiron', 0.3, [0, 3.0], x, 0, 8, { tint: TINT.iron }));
  for (const x of seams.slice(1, -1)) {
    ps.push(block('wood', [x - 0.125, x + 0.125], [3.3, 3.6], [-zi, 0], { tint: TINT.woodDark }));
    ps.push(block('wood', [x - 0.125, x + 0.125], [3.3, 3.6], [0, zi], { tint: TINT.woodDark }));
  }
  // Recess the front board edge from the masonry by 4 cm: the joists still carry it,
  // without a numerically borderline corner weld to the window jambs.
  ps.push(...panels('wood', seams, [3.6, h1], [-zi, 0, zi - 0.04], { tint: TINT.woodPale }));
  // A grounded rear machine room carries the floor above; its central doorway is
  // cut into the masonry rather than simulated with a decorative surface.
  ps.push(...wallRun({ mat: 'brick', from: -inner, to: inner, at: -2.4, t: 0.22, y0: 0, h: 3.3,
    tint: TINT.brickDark, maxW: 3.4, openings: [{ c: 0, w: 1.4, y0: 0, h: 2.5, glass: false }] }));
  // The upper storey is divided, and the long external walls have a continuous stone
  // string course at the floor line. These bear against the masonry rather than intersect it.
  ps.push(...wallRun({ mat: 'brick', axis: 'z', from: -zi, to: zi, at: 0, t: 0.2, y0: h1, h: h2,
    tint: TINT.brickPale, openings: [{ c: 0, w: 1.1, y0: 0, h: 2.4 }] }));
  for (const s of [-1, 1]) {
    const face = s * Z;
    ps.push(block('stone', [-X, X], [h1 - 0.23, h1 - 0.02], s > 0 ? [face, face + 0.12] : [face - 0.12, face], { tint: TINT.stone }));
    ps.push(block('copper', [-X, X], [h1 + h2 - 0.12, h1 + h2 + 0.08], s > 0 ? [face, face + 0.18] : [face - 0.18, face], { tint: 0xb3a394 }));
  }
  // Cast-iron steam main on the blind portion of the west gable, above the
  // ground-floor window; brackets seat directly on the brick end wall.
  const steam = { tint: TINT.iron }, main = { tint: TINT.iron, util: 'water' as const };
  ps.push(...pipeRun('castiron', 'y', [0.32, 3.04], [-9.78, 0, -3.2], 0.28, main));
  ps.push(block('castiron', [-9.94, -9.62], [3.04, 3.36], [-3.36, -3.04], main));
  ps.push(...pipeRun('castiron', 'z', [-3.04, 3.2], [-9.78, 3.2, 0], 0.28, main));
  ps.push(stopcock([-9.94, -9.62], [0.32, 0.8], [-3.74, -3.34]));
  ps.push(block('castiron', [-9.64, -9.5], [1.05, 1.29], [-3.32, -3.08], steam));
  ps.push(block('castiron', [-9.64, -9.5], [3.08, 3.32], [2.45, 2.69], steam));
  ps.push(...pitchedRoof({ mat: 'roof', x: [-X - 0.3, X + 0.3], z: [-Z, Z], y: h1 + h2, rise: 3.1, thick: 0.28, seat: 0.2, maxW: 4.2,
    tint: TINT.slate, gables: { mat: 'brick', x: [[-X, -X + t], [X - t, X]], tint: TINT.brickPale } }));
  // queen-post trusses: tie beam between the wall heads, two queen posts, a straining beam between their heads,
  // and principal rafters from the tie ends to the posts, all under the slate slabs
  {
    const seat = 0.2, kk = 3.1 / (Z - seat), under = (dz: number) => h1 + h2 + kk * (Z - seat - dz), y = h1 + h2, oak = { tint: TINT.woodDark };
    for (const x of [-6.5, -3.2, 3.2, 6.5]) {
      const xr: Range = [x - 0.1, x + 0.1];
      ps.push(block('oak', [x - 0.12, x + 0.12], [y - 0.3, y], [-zi, zi], oak), block('oak', xr, [under(1.7) - 0.4, under(1.7) - 0.15], [-1.7, 1.7], oak));
      for (const s of [-1, 1]) {
        ps.push(block('oak', xr, [y, under(1.9)], s > 0 ? [1.7, 1.9] : [-1.9, -1.7], oak));
        ps.push(extrude('oak', [[s * zi, y], [s * zi, under(zi)], [s * 1.9, under(1.9)], [s * 1.9, under(1.9) - 0.3]], 'x', xr, oak));
      }
    }
  }
  if (p.interior !== false) {
    for (const [x, z] of [[-2.0, 2.5], [2.2, 3.2], [6.5, 1.2]]) ps.push(...fit(pallet(2), x, z, 0));
    for (const [x, z] of [[-6.8, 2.8], [-2.5, 2.8], [6.0, -2.5]]) ps.push(...fit(loom(), x, z, h1));
    ps.push(...fit(workbench(), 2.4, -1.6, 0));
  }
  // stone quoins up the front corners either side of the string course, and front downpipes
  for (const [u, dir] of [[-X, 1], [X, -1]] as const) {
    ps.push(...quoins({ face: Z }, u, dir, [0.32, h1 - 0.23], 4), ...quoins({ face: Z }, u, dir, [h1 - 0.02, h1 + h2 - 0.12], 5));
  }
  for (const x of [-8.6, 8.6]) ps.push(...downpipe({ face: Z }, x, [0.32, h1 - 0.23]), ...downpipe({ face: Z }, x, [h1 - 0.02, h1 + h2 - 0.12]));
  // Mill drive in the rear machine room; boiler on the east side of the
  // partition, leaving the 1.4 m central room door and loading axis open.
  ps.push(...lineDrive(-5.4, -3.85), ...boiler(5.4, -3.85));
  // Services: a supply box on the rear wall powers the line drive; a second on the west gable feeds a lamp run
  // along the girder's face. The boiler heats a radiator on the partition and has its own gas meter.
  ps.push(supplyBox([-7.3, -6.7], [0.8, 1.6], [-5.2, -5.0]), ...conduit([[-7.0, 1.0, -5.0], [-7.0, 1.0, -3.85], [-6.48, 1.0, -3.85]]));
  ps.push(supplyBox([-9.2, -8.9], [2.2, 2.9], [0.8, 1.3]), ...conduit([[-9.05, 2.9, 1.05], [-9.05, 3.14, 1.05], [-9.05, 3.14, 0.23]]));
  ps.push(...conduit([[-inner, 3.14, 0.19], [inner, 3.14, 0.19]]));
  for (const x of [-6, -2, 2, 6]) ps.push(lamp([x - 0.2, x + 0.2], [2.83, 3.1], [0.15, 0.5], LIGHT.warm));
  ps.push(...pipe('steam', 'steel', [[6.21, 1.9, -3.7], [6.21, 1.9, -2.62], [6.97, 1.9, -2.62]], 0.12), radiatorPanel([6.97, 7.97], [1.5, 2.3], [-2.66, -2.51]));
  ps.push(gasMeter([5.1, 5.7], [0, 0.9], [-3.03, -2.51]), ...pipe('gas', 'steel', [[5.4, 0.9, -2.58], [5.4, 2.4, -2.58]], 0.1));
  ps.push(...riggingLine([-7.7, 7.42, 5.67], [7.7, 7.42, 5.67], 1.0));
  ps.push(...wireLine([-7.7, 7.04, 5.62], [7.7, 7.04, 5.62], 0.16));
  if (p.stock) {
    ps.push(...crates(-4.5, -2, h1, 2, 2, 2), ...crates(4, 2.2, h1, 2, 1, 1));
    ps.push(...drums('barrel', -5.5, 2.5, 0, 2, 2), ...drums('barrel', 5, -1.5, 0, 2, 1));
  }
  return put(layerize(ps, { brick: 'english', timber: true, roofs: 'slate', stone: true }), p, 'mill', { age: { years: 150, exposure: 'wet' } });
}
