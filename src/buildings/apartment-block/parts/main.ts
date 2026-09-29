import type { PieceSpec } from '../../../types.ts';
import { block, curtains, cyl, flight, grid, panels, pipeRun, scaffold, splitRange, wallRun, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { riggingLine, wireLine } from '../../../levels/rigging.ts';
import { balcony, band, canopy, downpipe } from '../../../levels/facade.ts';
import { bar, bathroom, bed, fit, kitchen, shelving, sofa, table, wardrobe } from '../../../levels/interior.ts';
import { gasMeter, holedPanels, lamp, LIGHT, pipe, stopcock, supplyBox, wallBoiler, SVC } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { boiler, put, radiator } from '../../_shared/structures-helpers.ts';

/** Brick walk-up, 12 x 8 m: bearing facades and spine wall, timber joists on hangers with board floors, rendered
    shop floor, steel fire escape on the +X gable, parapet roof with chimney stacks. */
export function apartmentBlock(p: Placement & { storeys?: number; shop?: boolean; scaffold?: boolean }): PieceSpec[] {
  const n = p.storeys ?? 4, H = 3.0, X = 6, Z = 4, t = 0.3, ts = 0.2;
  const shop = p.shop ?? true;
  const win = (c: number, w = 1.2) => ({ c, w, y0: 0.9, h: 1.5 });
  const door = (c: number, w = 1.0, h = 2.3) => ({ c, w, y0: 0, h });
  // escape landings alternate gable sides so each flight can climb past the one below
  const landing = (L: number): Range => (L % 2 === 1 ? [0.9, 3.9] : [-3.9, -0.9]);
  const ps: PieceSpec[] = [];
  for (let k = 0; k < n; k++) {
    const ground = k === 0;
    const skin = ground ? { mat: 'plaster' as const, tint: TINT.cream } : { mat: 'brick' as const, tint: TINT.brickDark };
    const base = { ...skin, t, y0: k * H, h: H, maxW: 2.4 };
    const front = ground && shop ? [{ c: -3, w: 3.4, y0: 0.5, h: 2.0 }, door(0.3), door(3.6)] : [-4, 0, 4].map((c) => win(c));
    ps.push(...wallRun({ ...base, lintel: ground ? undefined : 'stone', glazing: ground ? 'tempered' : 'glass', from: -X, to: X, at: Z - t / 2, openings: front }));
    ps.push(...wallRun({ ...base, lintel: ground ? undefined : 'stone', from: -X, to: X, at: -Z + t / 2, out: -1,
      openings: ground ? [win(-3, 1.0), door(3, 1.0, 2.2)] : [win(-3, 1.0), win(3, 1.0)] }));
    ps.push(...wallRun({ ...base, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, maxW: 3.8 }));
    ps.push(...wallRun({ ...base, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2, maxW: 3.8,
      openings: ground ? [] : [door((landing(k)[0] + landing(k)[1]) / 2, 0.9, 2.1)] }));
    ps.push(...wallRun({ mat: 'brick', tint: TINT.brickPale, t: ts, y0: k * H, h: H, from: -X + t, to: X - t, at: 0, maxW: 3.8,
      openings: [door(-1.5, 0.9, 2.1)] }));
  }
  // floors hang off the facades and spine on their joist ends (joist-hanger welds); the roof deck is felt on the same joists
  const zi = Z - t, zs = ts / 2;
  // power riser on the spine face through a hole in each board floor, one lamp per floor, intake in the shop
  const riserHole = { x: [2.0, 2.1] as Range, z: [zs, zs + 0.1] as Range };
  ps.push(supplyBox([1.5, 2.0], [0, 1.6], [zs, zs + 0.5]));
  ps.push(...splitRange(0, n * H - 0.08, 6).map((y) => block('steel', riserHole.x, y, riserHole.z, { tint: SVC.cable, util: 'power' })));
  for (let L = 1; L <= n; L++) {
    const F = L * H;
    const jy: Range = [F - 0.33, F - 0.08];
    for (const x of [-2.85, 0, 2.85]) {
      ps.push(block('wood', [x - 0.1, x + 0.1], jy, [zs, zi], { tint: TINT.woodDark }), block('wood', [x - 0.1, x + 0.1], jy, [-zi, -zs], { tint: TINT.woodDark }));
    }
    const deck = L === n ? { mat: 'roof' as const, tint: TINT.felt } : { mat: 'plywood' as const, tint: TINT.woodPale };
    for (const zr of [[-zi, -zs], [zs, zi]] as Range[]) {
      ps.push(...(L === n ? panels(deck.mat, [-X + t, 0, X - t], [F - 0.08, F], zr, { tint: deck.tint })
        : holedPanels(deck.mat, [-X + t, 0, X - t], [F - 0.08, F], zr, riserHole, { tint: deck.tint })));
    }
    ps.push(lamp([2.1, 2.5], [F - 0.38, F - 0.08], [zs, zs + 0.3], LIGHT.warm));
  }
  const top = n * H, py: Range = [top, top + 0.9];
  const brick = { tint: TINT.brickDark };
  ps.push(...grid('brick', [-X, X], py, [Z - t, Z], { x: 4.2 }, brick), ...grid('brick', [-X, X], py, [-Z, -Z + t], { x: 4.2 }, brick));
  ps.push(...grid('brick', [-X, -X + t], py, [-Z + t, Z - t], { z: 3.8 }, brick), ...grid('brick', [X - t, X], py, [-Z + t, Z - t], { z: 3.8 }, brick));
  for (const x of [-3.2, 3.2]) {
    ps.push(block('brick', [x - 0.45, x + 0.45], [top, top + 1.5], [-0.35, 0.35], brick));
    ps.push(cyl('terracotta', 0.22, [top + 1.5, top + 1.9], x, 0, { tint: TINT.terracotta }));
  }
  ps.push(...grid('terracotta', [-X - 0.1, X + 0.1], [top + 0.9, top + 1.05], [Z - t, Z + 0.1], { x: 4.2 }, { tint: TINT.terracotta }));
  // External copper water service on the unpierced west gable. The top elbow
  // feeds a parapet-level run; clips tie the line into brick, not window glass.
  const water = { tint: TINT.bronze, util: 'water' as const };
  ps.push(stopcock([-6.42, -6.14], [0, 0.45], [-2.88, -2.48]));
  ps.push(...pipeRun('copper', 'y', [0, top + 0.39], [-6.28, 0, -2.34], 0.28, water, 3.2));
  ps.push(block('copper', [-6.44, -6.12], [top + 0.39, top + 0.71], [-2.5, -2.18], water));
  ps.push(...pipeRun('copper', 'z', [-2.18, 2.5], [-6.28, top + 0.55, 0], 0.28, water));
  ps.push(block('steel', [-6.14, -6], [1.08, 1.32], [-2.46, -2.22], { tint: TINT.iron }));
  ps.push(block('steel', [-6.14, -6], [top + 0.43, top + 0.67], [1.48, 1.72], { tint: TINT.iron }));
  // Two independent building services ride the front parapet: a taut rigging
  // line and a fine insulated feed. Both lose their endpoints when it fractures.
  if (p.scaffold) {
    // Hang the lines off its outer standards, in front of the planks rather than
    // hiding them behind the scaffold and parapet.
    ps.push(...riggingLine([-3.6, top - 1, Z + 1.54], [3.6, top - 1, Z + 1.54], 0.65));
    ps.push(...wireLine([-3.6, top - 2.35, Z + 1.49], [3.6, top - 2.35, Z + 1.49], 0.18));
  } else {
    ps.push(...riggingLine([-4, top + 0.64, Z + 0.17], [4, top + 0.64, Z + 0.17], 0.9));
    ps.push(...wireLine([-4, top + 0.19, Z + 0.12], [4, top + 0.19, Z + 0.12], 0.16));
  }
  // A radiator on the rear wall, left of the rear service door; the shopfront,
  // spine opening and alternating fire-escape landings stay unblocked.
  ps.push(...radiator(-3.0, -3.5, 0), wallBoiler([-1.92, -1.42], [0.9, 1.7], [-zi, -zi + 0.4]), gasMeter([-1.92, -1.42], [0, 0.5], [-zi, -zi + 0.3]));
  ps.push(...pipe('gas', 'copper', [[-1.67, 0.5, -zi + 0.15], [-1.67, 0.9, -zi + 0.15]], 0.1));
  if (n >= 4) ps.push(...boiler(3.7, -2.35), gasMeter([3.4, 4.0], [0, 0.9], [-1.53, -1.0]));
  if (shop) ps.push(block('metal', [-4.8, -1.2], [2.55, 2.95], [Z, Z + 0.08], { tint: TINT.carTeal }));
  // flats: kitchen on the back wall, bathroom suite, living room and bedroom furniture; the shop gets gondolas and a counter
  if (p.interior !== false) {
    for (let k = 1; k < n; k++) {
      const y = k * H;
      ps.push(...fit(kitchen(2.4), -1.2, -zi, y), ...fit(table(1.2, 0.8), -1.0, -1.6, y), ...fit(bathroom(), 2.4, -zi, y));
      ps.push(...fit(sofa(1.8), -3.5, zs + 0.45, y), ...fit(table(0.9, 0.6), -3.5, 2.2, y), ...fit(bed(true), 3.1, zs + 1.1, y), ...fit(wardrobe(1.0), 5.4, 2.6, y, 3));
    }
    if (shop) ps.push(...fit(shelving(1.8), -3.2, 1.25, 0), ...fit(shelving(1.8, {}, 2), -3.2, 0.4, 0), ...fit(bar(1.6, 0, { tint: 0xd9d4c8 }), 2.3, 1.9, 0));
  }
  // Dressings: stone string courses at each floor line, a cornice under the parapet, a shop awning, rear downpipes
  // and, without scaffold, balconies on the middle bay.
  const stone = { mat: 'stone' as const, tint: TINT.stone, depth: 0.08 };
  for (let L = 1; L < n; L++) {
    const y: Range = [L * H - 0.04, L * H + 0.12];
    ps.push(...band({ ...stone, face: Z, from: -X, to: X, y }), ...band({ ...stone, face: -Z, out: -1, from: -5.4, to: 5.4, y }));
    if (!p.scaffold) ps.push(...balcony({ face: Z }, [-1.1, 1.1], L * H + 0.27, 0.95, { tint: TINT.concrete }));
  }
  ps.push(...band({ ...stone, face: Z, from: -X, to: X, y: [top - 0.26, top], depth: 0.16, profile: 'cornice' }));
  ps.push(...band({ ...stone, face: -Z, out: -1, from: -5.4, to: 5.4, y: [top - 0.26, top], depth: 0.16, profile: 'cornice' }));
  if (shop && !p.scaffold) ps.push(...canopy({ face: Z }, [-4.9, -1.1], 2.36, 1.0, { tint: 0x9c3b34, t: 0.18 }));
  for (const x of [-5.7, 5.7]) ps.push(...downpipe({ face: -Z, out: -1 }, x, [0, top + 0.9]));
  // fire escape
  const iron = { tint: TINT.iron };
  const fx: Range = [X, X + 1.2], post: Range = [X + 1.2, X + 1.32];
  for (let L = 1; L < n; L++) {
    const F = L * H, zr = landing(L);
    ps.push(block('steel', fx, [F - 0.15, F], zr, iron));
    const edge = zr[0] > 0 ? zr[0] : zr[1];
    const from = L === 1 ? -3.3 : -edge;
    ps.push(...flight({ mat: 'steel', axis: 'z', from, to: edge, cross: [X + 0.1, X + 1.1], y0: F - H, steps: 6, rise: H / 6, seat: L > 1, ...iron }));
  }
  for (const side of [1, 2]) {
    let hi = 0;
    for (let L = side; L < n; L += 2) hi = L;
    if (!hi) continue;
    const zr = landing(side);
    const inner: Range = zr[0] > 0 ? [zr[0], zr[0] + 0.12] : [zr[1] - 0.12, zr[1]];
    const outer: Range = zr[0] > 0 ? [zr[1] - 0.12, zr[1]] : [zr[0], zr[0] + 0.12];
    for (const z of [inner, outer]) ps.push(...grid('steel', post, [0, hi * H + 1.0], z, { y: 4.5 }, iron));
    for (let L = side; L <= hi; L += 2) {
      const rail: Range = zr[0] > 0 ? [inner[1], outer[0]] : [outer[1], inner[0]];
      ps.push(block('steel', post, [L * H + 0.85, L * H + 1.0], rail, iron));
    }
  }
  if (p.scaffold) ps.push(...scaffold({ from: -X, to: X, face: Z, height: top + 0.9, tint: TINT.steelGrey, wrap: 'tarp' }));
  for (let k = 1; k < n; k++) ps.push(...curtains({ face: Z - t, into: -1, c: 0, w: 1.2, head: k * H + 2.4, drop: 1.5, fabric: k % 2 ? 'velvet' : 'cotton', tint: [0x6e1f2a, 0xd9cfb8, 0x2f4a6e][k % 3] }));
  return put(layerize(ps, { brick: 'cavity', render: true, timber: true, lining: true, partitions: true }), p, 'flats');
}
