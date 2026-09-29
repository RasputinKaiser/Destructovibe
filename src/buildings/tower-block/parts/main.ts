import type { PieceSpec } from '../../../types.ts';
import { beam, block, column, cyl, grid, place, raise, pipeRun, wallRun, GLASS_T, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { riggingLine } from '../../../levels/rigging.ts';
import { balcony } from '../../../levels/facade.ts';
import { bed, bookcase, fit, kitchen, sofa, stair, table, wardrobe } from '../../../levels/interior.ts';
import { gasMeter, holedPanels, hvacUnit, lamp, LIGHT, supplyBox, SVC } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { boiler, put, radiator } from '../../_shared/structures-helpers.ts';

/** Concrete-frame tower, 2 x 2 bays of 6.25 m: compartment walls, slab panels, spandrels, glazing, roof plant. */
export function towerBlock(p: Placement & { storeys?: number }): PieceSpec[] {
  const n = p.storeys ?? 6, H = 3.6, slab = 0.2, bd = 0.4, B = 6.25;
  const lines = [-B, 0, B];
  const bays: Range[] = [[-B + 0.2, -0.2], [0.2, B - 0.2]];
  const con = { tint: TINT.concrete };
  const ps: PieceSpec[] = [];
  const g = GLASS_T / 2;
  const riserHole = { x: [1.9, 2.0] as Range, z: [0, 0.3] as Range }, cable = { tint: SVC.cable, util: 'power' as const };
  ps.push(supplyBox([1.3, 1.9], [0, 1.8], [0.15, 0.8]));
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab, beamY: Range = [top - bd, top];
    for (const x of lines) for (const z of lines) ps.push(...column('rconcrete', x, z, [y0, top], 0.4, con));
    for (const l of lines) {
      for (const b of bays) ps.push(...beam('rconcrete', 'x', b, beamY, l, 0.3, con), ...beam('rconcrete', 'z', b, beamY, l, 0.3, con));
    }
    // scissor stair in the back-left bay: each storey's straight flight runs the other way in the other strip,
    // so it lands against the slab edge beyond its own well and starts on solid slab clear of the next one
    const strip: Range = k % 2 ? [-4.95, -3.85] : [-6.05, -4.95];
    ps.push(...holedPanels('rconcrete', [-B - 0.2, -2.5, 0, 2.5, B + 0.2], [top, top + slab], [-B - 0.2, 0, B + 0.2], [riserHole, { x: strip, z: [-5.9, -0.9] }], con));
    ps.push(...stair({ axis: 'z', from: k % 2 ? -0.9 : -5.9, to: k % 2 ? -5.9 : -0.9, cross: strip, y0, y1: (k + 1) * H, mat: 'rconcrete', tint: TINT.concrete, open: 'hi', waist: true }));
    if (k > 0 && p.interior !== false) {
      ps.push(...fit(sofa(2.0), 3.1, 0.55, y0), ...fit(table(1.0, 0.6), 3.1, 2.4, y0), ...fit(bed(true), -3.1, 1.2, y0), ...fit(wardrobe(1.0), -5.75, 3.6, y0, 1));
      ps.push(...fit(kitchen(2.4), 3.0, -0.1, y0, 2), ...fit(table(1.2, 0.8), 2.5, -3.0, y0), ...fit(bookcase(1.0, 1.8), 5.9, -2.5, y0, 3));
    }
    // power riser through the slab hole, against the spine beam; one lamp per floor beside it
    ps.push(block('steel', riserHole.x, [y0, (k + 1) * H], [0.15, 0.25], cable));
    ps.push(lamp([2.0, 2.4], [top - 0.3, top], [0.15, 0.45], LIGHT.warm));
    const fill: Range = [y0, top - bd];
    const sill = y0 + 0.9;
    // each perimeter bay, written for the front face then mirrored to the others
    for (const [face, alongX, sign] of [['front', true, 1], ['back', true, -1], ['left', false, -1], ['right', false, 1]] as const) {
      const mat = alongX ? 'brick' as const : k % 2 ? 'ceramic' as const : 'plaster' as const;
      const tint = alongX ? TINT.brickPale : k % 2 ? 0xe1e4df : TINT.blue;
      for (const b of bays) {
        const halves: Range[] = [[b[0], (b[0] + b[1]) / 2], [(b[0] + b[1]) / 2, b[1]]];
        const bay: PieceSpec[] = [];
        if (k === 0 && face === 'front') {
          for (const u of halves) bay.push(block('tempered', u, fill, [-g, g]));
        } else if (k === 0) {
          for (const u of halves) bay.push(block(mat, u, fill, [-0.15, 0.15], { tint }));
        } else {
          bay.push(block(mat, b, [y0, sill], [-0.15, 0.15], { tint }));
          for (const u of halves) bay.push(block('glass', u, [sill, fill[1]], [-g, g]));
        }
        ps.push(...(alongX ? place(bay, 0, sign * B) : place(bay, sign * B, 0, 1)));
      }
    }
    // Two real fire compartments per floor, split at the central column. Door openings
    // retain circulation; each leaf keys into a column, the beam above and a slab below.
    for (const sign of [-1, 1]) {
      const from = sign < 0 ? -B + 0.2 : 0.2;
      const to = sign < 0 ? -0.2 : B - 0.2;
      ps.push(...wallRun({ mat: 'cinderblock', from, to, at: 0, t: 0.2,
        y0, h: H - slab - bd, maxW: 3.4, tint: TINT.darkConcrete,
        openings: [{ c: (from + to) / 2, w: 1.1, y0: 0, h: 2.35, glass: false }] }));
    }
  }
  const roof = n * H;
  // A substantial stone crown changes the roof silhouette without adding fragile trim
  // across the window bays or increasing the number of unsupported facade pieces.
  ps.push(block('stone', [-B - 0.25, B + 0.25], [roof + 1, roof + 1.18], [B - 0.05, B + 0.25], { tint: TINT.stone }));
  ps.push(block('stone', [-B - 0.25, B + 0.25], [roof + 1, roof + 1.18], [-B - 0.25, -B + 0.05], { tint: TINT.stone }));
  ps.push(...grid('rconcrete', [-B - 0.2, B + 0.2], [roof, roof + 1.0], [B - 0.05, B + 0.2], { x: 3.6 }, con));
  ps.push(...grid('rconcrete', [-B - 0.2, B + 0.2], [roof, roof + 1.0], [-B - 0.2, -B + 0.05], { x: 3.6 }, con));
  ps.push(...grid('rconcrete', [-B - 0.2, -B + 0.05], [roof, roof + 1.0], [-B + 0.05, B - 0.05], { z: 3.6 }, con));
  ps.push(...grid('rconcrete', [B - 0.05, B + 0.2], [roof, roof + 1.0], [-B + 0.05, B - 0.05], { z: 3.6 }, con));
  const plant = { mat: 'brick' as const, t: 0.2, y0: roof, h: 2.4, tint: TINT.brickPale };
  ps.push(...wallRun({ ...plant, from: -3, to: 0.4, at: 0.3, openings: [{ c: -1.8, w: 0.9, y0: 0, h: 2.0 }] }));
  ps.push(...wallRun({ ...plant, from: -3, to: 0.4, at: -2.9, out: -1 }));
  ps.push(...wallRun({ ...plant, axis: 'z', from: -2.8, to: 0.2, at: -2.9, out: -1 }));
  ps.push(...wallRun({ ...plant, axis: 'z', from: -2.8, to: 0.2, at: 0.3 }));
  ps.push(block('rconcrete', [-3.1, 0.5], [roof + 2.4, roof + 2.6], [-3.1, 0.5], con));
  ps.push(cyl('steel', 1.6, [roof + 2.6, roof + 4.0], -1.3, -1.3, { tint: TINT.steelGrey }));
  ps.push(cyl('aluminum', 0.12, [roof, roof + 4.5], 3.6, 3.6, { tint: TINT.steelGrey }));
  // The short variant fits the free-play piece cap; both sizes get a working
  // ground-floor plant, tucked against the back wall away from compartment doors.
  ps.push(block('steel', riserHole.x, [roof, roof + 1.28], [0.15, 0.25], cable), ...raise(place(hvacUnit(), 3.1, 0.2, 2), roof));
  // Dressings: louvred plant screens round the air handler, an entrance canopy on posts, a concrete fin up the
  // centre column line front and back, and balconies off the slab edges of both front bays.
  ps.push(block('metal', [1.9, 4.3], [roof, roof + 1.6], [1.6, 1.68], { tint: TINT.steelGrey }), block('metal', [4.5, 4.58], [roof, roof + 1.6], [-0.9, 1.68], { tint: TINT.steelGrey }));
  for (const u of [[-2.5, -0.2], [0.2, 2.5]] as Range[]) ps.push(block('metal', u, [3.0, 3.15], [B + 0.2, B + 1.6], { tint: TINT.steelGrey }));
  for (const x of [-2.3, 2.3]) ps.push(block('steel', [x - 0.06, x + 0.06], [0, 3.0], [B + 1.4, B + 1.52], { tint: TINT.steelGrey }));
  for (let k = 0; k < n; k++) for (const sz of [-1, 1]) ps.push(block('rconcrete', [-0.2, 0.2], [k * H, (k + 1) * H], sz > 0 ? [B + 0.2, B + 0.35] : [-B - 0.35, -B - 0.2], con));
  for (let k = 1; k < n; k++) for (const x of [-3.125, 3.125]) ps.push(...balcony({ face: B + 0.2 }, [x - 1.2, x + 1.2], k * H, 1.1, con));
  if (n <= 4) {
    ps.push(block('concrete', [2.2, 4.7], [0, 0.25], [-5.9, -4.35], con));
    ps.push(block('steel', [2.4, 4.5], [0.25, 1.65], [-5.7, -4.55], { tint: TINT.metalBlue, fixture: 'boiler' }));
    ps.push(block('metal', [2.35, 4.55], [1.65, 1.77], [-5.75, -4.5], { tint: TINT.steelGrey }));
    ps.push(block('steel', [2.75, 3.85], [0.62, 1.25], [-4.55, -4.46], { tint: TINT.iron }));
    ps.push(...pipeRun('steel', 'y', [1.77, 2.7], [3.45, 0, -5.1], 0.28, { tint: TINT.steelGrey }));
  } else {
    ps.push(...boiler(3.45, -4.85), ...radiator(1.19, -4.85), gasMeter([3.15, 3.75], [0, 0.9], [-4.03, -3.5]));
  }
  ps.push(...riggingLine([-3.2, roof + 0.54, B + 0.37], [3.2, roof + 0.54, B + 0.37], 0.42));
  return put(layerize(ps, { brick: 'cavity', floors: 'vinyl', partitions: true }), p, 'tower', { age: { years: 60, exposure: 'outdoor', cover: 0.02 } });
}
