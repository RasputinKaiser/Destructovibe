import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, grid, hull, place, raise, wallRun, weldParts, GLASS_T, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { band } from '../../../levels/facade.ts';
import { bar, chair, desk, filingCabinet, fit, screen, sofa, stair, table } from '../../../levels/interior.ts';
import { holedPanels, hvacUnit, lamp, LIGHT, supplyBox, SVC } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

const UC305: PieceSpec['section'] = { kind: 'I', t: 0.0154, tw: 0.0099, axis: 1, depth: 2 };

const UB457: NonNullable<PieceSpec['section']> = { kind: 'I', t: 0.0145, tw: 0.009, depth: 1 };

/** Steel-frame office, 12.5 m square: I-section columns (two flanges and a web), I-beams (web and bottom flange)
    framing into the column webs through fin plates and onto the flanges through end plates, composite floors
    (steel deck under a concrete topping), a scissor stair behind a concrete core wall, storey-high
    curtain-wall glass on the slab edges between aluminium mullions and fins, open-plan desks, metal parapet and
    rooftop plant. */
export function officeBlock(p: Placement & { storeys?: number }): PieceSpec[] {
  const n = p.storeys ?? 4, H = 3.6, slab = 0.2, bd = 0.45, B = 6, E = 6.25;
  const lines = [-B, 0, B];
  const bays: Range[] = [[-B + 0.15, -0.15], [0.15, B - 0.15]];
  const steel = { tint: TINT.steelGrey }, con = { tint: TINT.concrete }, glaze = { tint: TINT.blueGlass };
  // panes sit just outside the columns (0.04 clear) so they weld only to the slabs and each other
  const g = E - GLASS_T;
  const along = [-E, -E / 2, 0, E / 2, E], across = [-g, -g / 2, 0, g / 2, g];
  const riserHole = { x: [1.9, 2.0] as Range, z: [0, 0.23] as Range }, cable = { tint: SVC.cable, util: 'power' as const };
  const ps: PieceSpec[] = [supplyBox([1.3, 1.9], [0, 1.8], [0.13, 0.8])];
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab, by: Range = [top - bd, top];
    const tf = 0.06, fy: Range = [by[0], by[0] + tf], wy: Range = [by[0] + tf, top];
    // UC 305x305x97 columns and UB 457x191x74 beams, each one rigid I-section body (plates drawn 60 mm)
    for (const x of lines) for (const z of lines) {
      ps.push(weldParts([
        block('steel', [x - 0.15, x + 0.15], [y0, top], [z + 0.09, z + 0.15], steel), block('steel', [x - 0.15, x + 0.15], [y0, top], [z - 0.15, z - 0.09], steel),
        block('steel', [x - 0.03, x + 0.03], [y0, top], [z - 0.09, z + 0.09], steel),
      ], { section: UC305 }));
    }
    const ty: Range = [top - tf, top], cw: Range = [wy[0], top - tf];
    for (const l of lines) for (const b of bays) {
      // along X the coped web runs between the column flanges to the column web, with fin plates to the flanges;
      // both flanges stop clear of them
      const wb: Range = [b[0] - 0.12, b[1] + 0.12];
      ps.push(weldParts([
        block('steel', wb, cw, [l - 0.03, l + 0.03], steel), block('steel', b, ty, [l - 0.1, l + 0.1], steel), block('steel', b, fy, [l - 0.1, l + 0.1], steel),
        ...[[wb[0], b[0]], [b[1], wb[1]]].map(([x0, x1]) => block('steel', [x0, x1], [by[0] + 0.1, top - 0.08], [l + 0.03, l + 0.09], steel)),
      ], { section: { ...UB457, axis: 0 } }));
      ps.push(weldParts([
        block('steel', [l - 0.03, l + 0.03], cw, b, steel), block('steel', [l - 0.1, l + 0.1], ty, b, steel), block('steel', [l - 0.1, l + 0.1], fy, b, steel),
      ], { section: { ...UB457, axis: 2 } }));
    }
    const strip: Range = k % 2 ? [-4.7, -3.6] : [-5.8, -4.7];
    const holes = [riserHole, { x: strip, z: [-5.6, -0.8] as Range }];
    ps.push(...holedPanels('metal', [-E, -3, 0, 3, E], [top, top + 0.08], [-E, 0, E], holes, { tint: 0x8d949b }));
    ps.push(...holedPanels('rconcrete', [-E, -3, 0, 3, E], [top + 0.08, top + slab], [-E, 0, E], holes, con));
    ps.push(...stair({ axis: 'z', from: k % 2 ? -0.8 : -5.6, to: k % 2 ? -5.6 : -0.8, cross: strip, y0, y1: (k + 1) * H, mat: 'steel', tint: TINT.steelGrey, open: 'hi', waist: true }));
    // reinforced-concrete stair core wall between the stair and the floor plate, with its door
    ps.push(...wallRun({ mat: 'rconcrete', axis: 'z', from: -B + 0.1, to: -0.1, at: -3.45, t: 0.2, y0, h: top - y0, maxW: 3, tint: TINT.darkConcrete,
      openings: [{ c: -3.2, w: 1.0, y0: 0, h: 2.2, glass: false }] }));
    if (p.interior !== false) {
      if (k === 0) ps.push(...fit(bar(2.4, 0, { tint: 0xd9d4c8 }), -1.2, 4.2, y0), ...fit(sofa(2.0, { tint: 0x3f4f5f }), 3.1, 5.4, y0, 2));
      else {
        for (const x of [2.0, 4.1]) for (const z of [2.3, 4.3]) ps.push(...fit(desk(), x, z, y0), ...fit(chair(), x, z + 0.8, y0));
        for (const u of [[1.2, 2.8], [3.3, 4.9]] as Range[]) ps.push(...fit(screen(u[1] - u[0]), (u[0] + u[1]) / 2, 3.5, y0));
        ps.push(...fit(filingCabinet(), -2.2, 5.6, y0, 2), ...fit(filingCabinet(), -1.6, 5.6, y0, 2));
        ps.push(...fit(table(1.8, 0.9), 3.0, -3.0, y0), ...fit(chair(), 2.4, -2.1, y0), ...fit(chair(), 3.6, -2.1, y0));
        ps.push(...fit(desk(), -2.0, 2.5, y0), ...fit(chair(), -2.0, 3.3, y0));
      }
    }
    ps.push(block('steel', riserHole.x, [y0, (k + 1) * H], [0.13, 0.23], cable), lamp([2.0, 2.4], [top - 0.3, top], [0.13, 0.43], LIGHT.cool));
    // panes stand on the slab edge with a movement joint under the steel deck above; the mullions span both
    const gy: Range = [y0, top], pane: Range = [y0, top - 0.03];
    for (let i = 0; i < 4; i++) {
      const a: Range = [along[i], along[i + 1]], c: Range = [across[i], across[i + 1]];
      ps.push(block('tempered', a, pane, [g, E], glaze), block('tempered', a, pane, [-E, -g], glaze));
      ps.push(block('tempered', [g, E], pane, c, glaze), block('tempered', [-E, -g], pane, c, glaze));
    }
    // Actual exterior mullions at the central seam give the curtain wall a reveal
    // and a metallic silhouette; each touches two panes and the slab above.
    for (const sign of [-1, 1]) {
      const face = sign * E;
      const edge: Range = sign > 0 ? [face, face + 0.12] : [face - 0.12, face];
      // mullion with its pressure cap: 0.2 m on the glass line, tapering to a 0.1 m nose
      const nose = edge[sign > 0 ? 1 : 0], back = edge[sign > 0 ? 0 : 1], cap: [number, number][] = [[-0.1, back], [0.1, back], [0.05, nose], [-0.05, nose]];
      ps.push(hull('aluminum', cap.flatMap(([u, v]) => gy.map((y) => [u, y, v] as Vec3)), { tint: TINT.metalBlue, finish: 'satin' }));
      ps.push(hull('aluminum', cap.flatMap(([u, v]) => gy.map((y) => [v, y, u] as Vec3)), { tint: TINT.metalBlue, finish: 'satin' }));
    }
  }
  const roof = n * H, py: Range = [roof, roof + 0.9], metal = { tint: TINT.steelGrey };
  ps.push(...grid('aluminum', [-E, E], py, [E - 0.15, E], { x: 6.5 }, metal), ...grid('aluminum', [-E, E], py, [-E, -E + 0.15], { x: 6.5 }, metal));
  ps.push(...grid('aluminum', [-E, -E + 0.15], py, [-E + 0.15, E - 0.15], { z: 6.5 }, metal), ...grid('aluminum', [E - 0.15, E], py, [-E + 0.15, E - 0.15], { z: 6.5 }, metal));
  const plant: Range = [roof, roof + 2.6], white = { tint: TINT.metalWhite };
  ps.push(block('metal', [-3.5, 1.5], plant, [-0.6, -0.5], white), block('metal', [-3.5, 1.5], plant, [-3.5, -3.4], white));
  ps.push(block('metal', [-3.5, -3.4], plant, [-3.4, -0.6], white), block('metal', [1.4, 1.5], plant, [-3.4, -0.6], white));
  ps.push(block('metal', [-3.6, 1.6], [roof + 2.6, roof + 2.7], [-3.6, -0.4], metal));
  ps.push(block('steel', [2.5, 3.9], [roof, roof + 1.0], [2.5, 3.5], metal));
  ps.push(block('steel', riserHole.x, [roof, roof + 1.28], [0.13, 0.23], cable), ...raise(place(hvacUnit(), 3.1, 0.2, 2), roof));
  // Dressings: aluminium fins at the quarter points front and back (each keyed to the slab edge above it),
  // a projecting coping on those parapets and an entrance canopy on posts.
  for (let k = 0; k < n; k++) {
    for (const sz of [-1, 1]) for (const x of [-E / 2, E / 2]) {
      ps.push(block('aluminum', [x - 0.06, x + 0.06], [k * H, (k + 1) * H], sz > 0 ? [E, E + 0.35] : [-E - 0.35, -E], { tint: TINT.metalBlue }));
    }
  }
  for (const sz of [-1, 1]) ps.push(...band({ mat: 'aluminum', face: sz * (E - 0.15), out: sz as 1 | -1, from: -E, to: E, y: [roof + 0.9, roof + 1.02], depth: 0.55, maxW: 6.5, tint: TINT.metalWhite }));
  ps.push(block('metal', [-2.2, 2.2], [H - slab, H - slab + 0.15], [E + 0.35, E + 1.8], { tint: TINT.steelGrey }));
  for (const x of [-2.0, 2.0]) ps.push(block('steel', [x - 0.06, x + 0.06], [0, H - slab], [E + 1.6, E + 1.72], { tint: TINT.steelGrey }));
  return put(layerize(ps, { curtain: true, floors: 'tile' }), p, 'office');
}
