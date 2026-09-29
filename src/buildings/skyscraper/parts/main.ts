import type { PieceSpec } from '../../../types.ts';
import { block, grid, place, prism, raise, pipeRun, splitRange, wallRun, weldParts, GLASS_T, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { riggingLine } from '../../../levels/rigging.ts';
import { band, pilaster } from '../../../levels/facade.ts';
import { gasMeter, holedPanels, hvacUnit, hydrant, lamp, lift, LIGHT, radiatorPanel, supplyBox, SVC } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { boiler, put } from '../../_shared/structures-helpers.ts';

/* Built-up 500 mm box columns (40 mm plate: beams frame into a flat face from every side) and HEB 450 beams. */
const BOX500: PieceSpec['section'] = { kind: 'rhs', t: 0.04 };

const HEB450: PieceSpec['section'] = { kind: 'I', t: 0.026, tw: 0.014, depth: 1 };

/** Steel-frame skyscraper, 20 m square: perimeter steel columns and beams, radial beams to a reinforced-concrete
    core, rconcrete floor plates, storey-high tempered curtain wall (two panes per bay low down, one full-bay pane
    above), plant storeys on the core, aluminium parapet, corner crown fins and a stepped antenna. */
export function skyscraper(p: Placement & { storeys?: number }): PieceSpec[] {
  const n = p.storeys ?? 18, H = 4.4, slab = 0.25, bd = 0.45, E = 11.8, cw = 0.5, cr = 3.5, ct = 0.3, L = 11.4;
  const co = cr + ct / 2;
  const g = [-L, -cr, cr, L];
  const steel = { tint: TINT.steelGrey }, con = { tint: TINT.concrete }, glaze = { tint: TINT.blueGlass }, alu = { tint: TINT.metalWhite };
  const ps: PieceSpec[] = [];
  const core = (y: Range) => {
    ps.push(block('rconcrete', [-co, co], y, [cr - ct / 2, co], con), block('rconcrete', [-co, co], y, [-co, -cr + ct / 2], con));
    ps.push(block('rconcrete', [cr - ct / 2, co], y, [-cr + ct / 2, cr - ct / 2], con), block('rconcrete', [-co, -cr + ct / 2], y, [-cr + ct / 2, cr - ct / 2], con));
  };
  const cuts = [-E, -co, co, E], gl = E - GLASS_T;
  // power riser up the north face of the core through a notch in each floor plate, from an intake transformer
  const rz: Range = [co, co + 0.16], riserHole = { x: [-0.08, 0.08] as Range, z: rz };
  const cable = { tint: SVC.cable, util: 'power' as const };
  ps.push(supplyBox([-0.6, 0.6], [0, 1.8], [co + 0.16, co + 1.0]));
  for (const y of splitRange(0, n * H + 1.28, 8.8)) ps.push(block('steel', riserHole.x, y, rz, cable));
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab, by: Range = [top - bd, top];
    for (const x of g) {
      for (const z of g) {
        if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;
        ps.push(k === 0 ? prism('steel', cw, [y0, top], x, z, 16, steel) : { ...block('steel', [x - cw / 2, x + cw / 2], [y0, top], [z - cw / 2, z + cw / 2], steel), section: BOX500 });
      }
    }
    for (const l of [-L, L]) {
      for (let i = 0; i < 3; i++) {
        const span: Range = [g[i] + cw / 2, g[i + 1] - cw / 2];
        ps.push({ ...block('steel', span, by, [l - 0.15, l + 0.15], steel), section: HEB450 }, { ...block('steel', [l - 0.15, l + 0.15], by, span, steel), section: HEB450 });
      }
    }
    for (const a of [-cr, cr]) {
      for (const s of [-1, 1]) {
        const span: Range = s > 0 ? [co, L - cw / 2] : [-L + cw / 2, -co];
        ps.push({ ...block('steel', [a - 0.15, a + 0.15], by, span, steel), section: HEB450 }, { ...block('steel', span, by, [a - 0.15, a + 0.15], steel), section: HEB450 });
      }
    }
    core([y0, (k + 1) * H]);
    // Alternate mechanical levels add grounded shear walls between the lift core and
    // facade. Their heads meet the floor plate; doors leave the core accessible.
    if (k % 3 === 0) for (const sign of [-1, 1]) {
      const from = sign < 0 ? -L + cw / 2 : co;
      const to = sign < 0 ? -co : L - cw / 2;
      ps.push(...wallRun({ mat: 'rconcrete', from, to, at: 0, t: 0.28,
        y0, h: H - slab, maxW: 4.0, tint: TINT.darkConcrete,
        openings: [{ c: (from + to) / 2, w: 1.15, y0: 0, h: 2.6, glass: false }] }));
    }
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) ps.push(...holedPanels('rconcrete', [cuts[i], cuts[i + 1]], [top, top + slab], [cuts[j], cuts[j + 1]], riserHole, con));
    }
    ps.push(lamp([0.08, 0.48], [top - 0.35, top], [co, co + 0.3], LIGHT.cool));
    const gy: Range = [y0, top], per = k < 4 ? 2 : 1;
    const side = [-gl, -co, co, gl];
    for (let i = 0; i < 3; i++) {
      for (const u of splitRange(cuts[i], cuts[i + 1], (cuts[i + 1] - cuts[i]) / per + 1e-6)) {
        ps.push(block('tempered', u, gy, [gl, E], glaze), block('tempered', u, gy, [-E, -gl], glaze));
      }
      for (const u of splitRange(side[i], side[i + 1], (side[i + 1] - side[i]) / per + 1e-6)) {
        ps.push(block('tempered', [gl, E], gy, u, glaze), block('tempered', [-E, -gl], gy, u, glaze));
      }
    }
    // Copper edge cassettes sit on the concrete slab face; they give every floor a
    // deliberate horizontal datum without replacing the load-bearing floor plate.
    for (const sign of [-1, 1]) {
      const edge: Range = sign > 0 ? [E, E + 0.12] : [-E - 0.12, -E];
      ps.push(block('copper', [-co, co], [top, top + slab], edge, { tint: 0xadc1b4 }));
      ps.push(block('copper', edge, [top, top + slab], [-co, co], { tint: 0xadc1b4 }));
    }
  }
  const roof = n * H;
  core([roof, roof + H]);
  core([roof + H, roof + 2 * H]);
  ps.push(block('rconcrete', [-co - 0.15, co + 0.15], [roof + 2 * H, roof + 2 * H + 0.3], [-co - 0.15, co + 0.15], con));
  // Exposed roof-plant supply: separate steel riser lengths, a square turn and
  // a cross-run on the lift core. Its clips bear on the concrete core wall.
  ps.push(...pipeRun('steel', 'y', [roof, roof + 7.74], [3.97, 0, 0], 0.28, steel, 3.9));
  ps.push(block('steel', [3.81, 4.13], [roof + 7.74, roof + 8.06], [-0.16, 0.16], steel));
  ps.push(...pipeRun('steel', 'z', [0.16, 3.1], [3.97, roof + 7.9, 0], 0.28, steel));
  for (const dy of [1.1, 6.9]) ps.push(block('steel', [co, 3.83], [roof + dy - 0.12, roof + dy + 0.12], [-0.12, 0.12], steel));
  const py: Range = [roof, roof + 1.2];
  ps.push(...grid('aluminum', [-E, E], py, [E - 0.15, E], { x: 7 }, alu), ...grid('aluminum', [-E, E], py, [-E, -E + 0.15], { x: 7 }, alu));
  ps.push(...grid('aluminum', [-E, -E + 0.15], py, [-E + 0.15, E - 0.15], { z: 7 }, alu), ...grid('aluminum', [E - 0.15, E], py, [-E + 0.15, E - 0.15], { z: 7 }, alu));
  ps.push(...riggingLine([-7, roof + 0.57, E + 0.17], [7, roof + 0.57, E + 0.17], 0.8));
  // crown: an L of tall fins in each corner, standing on the roof against the parapet
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const r = (a: number, b: number): Range => (sx > 0 ? [a, b] : [-b, -a]);
      const q = (a: number, b: number): Range => (sz > 0 ? [a, b] : [-b, -a]);
      ps.push(weldParts([
        block('aluminum', r(E - 4.4, E - 0.15), [roof, roof + 8], q(E - 0.45, E - 0.15), alu),
        block('aluminum', r(E - 0.45, E - 0.15), [roof, roof + 8], q(E - 4.4, E - 0.45), alu),
      ]));
    }
  }
  let y = roof + 2 * H + 0.3;
  for (const [d, h] of [[0.8, 6], [0.5, 6], [0.25, 6]]) {
    ps.push(prism('steel', d, [y, y + h], 0, 0, 8, steel));
    y += h;
  }
  // Single basement-level heat plant in the southwest service quadrant. It
  // occupies neither the lift core nor the door in the mechanical shear wall.
  ps.push(...boiler(-7.2, -7.0), gasMeter([-7.5, -6.9], [0, 0.9], [-6.18, -5.7]), radiatorPanel([-9.38, -8.38], [0.3, 1.5], [-7.2, -6.8]));
  // rooftop air handler on the riser; a lift against the south wall inside the core, wound from a motor room at roof level
  ps.push(...raise(place(hvacUnit(), 0, co + 1.24, 1), roof));
  ps.push(...place(lift(0, roof - 2.6), 0, -cr + ct / 2), supplyBox([0.35, 0.85], [roof, roof + 0.6], [-cr + ct / 2, -cr + ct / 2 + 0.4]));
  ps.push(...hydrant(E + 1.6, E + 1.6));
  // Dressings: a stone podium of pilasters over the first two storeys, floor-edge bands flanking the copper
  // cassettes at the podium top and mid-height, a coping on the parapet and an entrance canopy.
  const faces = [{ face: E }, { face: -E, out: -1 as const }, { axis: 'z' as const, face: E }, { axis: 'z' as const, face: -E, out: -1 as const }];
  for (const f of faces) {
    for (const u of [-L, -7.5, 7.5, L]) ps.push(...pilaster(f, u, 0.7, [0, 2 * H - slab], { tint: TINT.stone, depth: 0.25 }));
    for (const k of [1, Math.floor(n / 2)]) {
      const y: Range = [(k + 1) * H - slab, (k + 1) * H];
      for (const u of [[-E, -co], [co, E]] as Range[]) ps.push(...band({ ...f, mat: 'stone', from: u[0], to: u[1], y, depth: 0.2, maxW: 9, tint: TINT.stone }));
    }
    const edge = f.axis === 'z' ? E - 0.15 : E;
    ps.push(...band({ ...f, face: (f.out ?? 1) * (E - 0.15), mat: 'aluminum', from: -edge, to: edge, y: [roof + 1.2, roof + 1.32], depth: 0.45, maxW: 6, tint: TINT.metalWhite }));
  }
  ps.push(block('metal', [-3.4, 3.4], [H - slab, H - 0.1], [E + 0.12, E + 2.0], { tint: TINT.steelGrey }));
  for (const x of [-3.2, 3.2]) ps.push(block('steel', [x - 0.07, x + 0.07], [0, H - slab], [E + 1.8, E + 1.94], { tint: TINT.steelGrey }));
  return put(layerize(ps, { curtain: true, floors: 'vinyl', stone: true, maxUnits: 1500 }), p, 'skyscraper');
}
