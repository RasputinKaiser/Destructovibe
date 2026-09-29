import type { PieceSpec } from '../../../types.ts';
import { block, column, crates, drums, panels, pipeRun, tnt, wallRun, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { riggingLine, wireLine } from '../../../levels/rigging.ts';
import { band, canopy, downpipe } from '../../../levels/facade.ts';
import { fit, racking } from '../../../levels/interior.ts';
import { conduit, gasMeter, hydrant, lamp, LIGHT, pipe, stopcock, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { boiler, lineDrive, put } from '../../_shared/structures-helpers.ts';

/** 25 x 16 m steel portal hall with a load-bearing rear mezzanine, masonry base and roller-door bay. */
export function warehouse(p: Placement & { stock?: boolean }): PieceSpec[] {
  const X = 12.5, Z = 8, H = 7.2, c = 0.15;
  const xs = [-12.5, -6.25, 0, 6.25, 12.5];
  const steel = { tint: TINT.steelGrey };
  const ps: PieceSpec[] = [];
  for (const x of xs) for (const z of [-Z, 0, Z]) ps.push(...column('steel', x, z, [0, H], 2 * c, steel, 8));
  for (const x of [-X, X]) for (const z of [-4, 4]) ps.push(...column('steel', x, z, [0, H], 2 * c, steel, 8));
  for (const x of xs) {
    ps.push(block('steel', [x - c, x + c], [H, H + 0.4], [-Z - c, 0], steel), block('steel', [x - c, x + c], [H, H + 0.4], [0, Z + c], steel));
  }
  const bays: Range[] = [[-X - c, -6.25], [-6.25, 0], [0, 6.25], [6.25, X + c]];
  for (const z of [-Z, -4, 0, 4, Z]) for (const b of bays) ps.push(block('steel', b, [H + 0.4, H + 0.6], [z - 0.1, z + 0.1], steel));
  const roofTop = H + 0.7;
  ps.push(...panels('metal', [-X - c, -9.375, -6.25, -3.125, 0, 3.125, 6.25, 9.375, X + c], [H + 0.6, roofTop], [-Z - c, -4, 0, 4, Z + c], { tint: TINT.steelGrey }));
  const row = roofTop / 2;
  const clad = { mat: 'metal' as const, t: 0.1, h: row, maxW: 2.6, tint: TINT.metalBlue };
  const masonry = { mat: 'cinderblock' as const, t: 0.25, h: row, maxW: 2.6, tint: TINT.concrete, lintel: 'rconcrete' as const };
  const side = { ...clad, from: -X - c, to: X + c };
  const end = { ...clad, axis: 'z' as const, from: -Z - c - 0.1, to: Z + c + 0.1 };
  const clerestory = [-9.375, -3.125, 3.125, 9.375].map((cx) => ({ c: cx, w: 2.0, y0: 1.2, h: 1.4 }));
  ps.push(...wallRun({ ...side, ...masonry, at: Z + c + 0.125, y0: 0, openings: [{ c: 2.5, w: 3.8, y0: 0, h: row }] }));
  ps.push(...wallRun({ ...side, at: Z + c + 0.05, y0: row, openings: clerestory }));
  ps.push(...wallRun({ ...side, ...masonry, at: -Z - c - 0.125, y0: 0, out: -1 }));
  ps.push(...wallRun({ ...side, at: -Z - c - 0.05, y0: row, out: -1 }));
  ps.push(...wallRun({ ...end, ...masonry, at: X + c + 0.125, y0: 0, openings: [{ c: 1.5, w: 1.0, y0: 0, h: 2.2 }] }));
  ps.push(...wallRun({ ...end, at: X + c + 0.05, y0: row }));
  ps.push(...wallRun({ ...end, ...masonry, at: -X - c - 0.125, y0: 0, out: -1 }));
  ps.push(...wallRun({ ...end, at: -X - c - 0.05, y0: row, out: -1 }));
  // Grounded pilasters articulate the portal bays and tie the masonry to the roof-line frame.
  for (const x of [-6.25, 6.25]) for (const s of [-1, 1]) {
    const face = s * (Z + c + 0.25);
    ps.push(block('brick', [x - 0.22, x + 0.22], [0, row], s > 0 ? [face, face + 0.3] : [face - 0.3, face], { tint: TINT.brickDark }));
  }
  for (const xr of [[0.6, 2.5], [2.5, 4.4]] as Range[]) {
    ps.push(block('asphalt', xr, [0, 0.12], [Z + c + 0.25, Z + c + 1.25]));
  }
  // Rear-wall fire main: the floor riser, square elbow and individually capped
  // octagonal lengths weld to one another; clips bridge the gap to solid masonry.
  const fire = { tint: TINT.steelRed, util: 'water' as const };
  ps.push(...pipeRun('steel', 'y', [0, 2.39], [-6.25, 0, -8.98], 0.28, fire));
  ps.push(block('steel', [-6.41, -6.09], [2.39, 2.71], [-9.14, -8.82], fire));
  ps.push(...pipeRun('steel', 'x', [-6.09, 6.25], [0, 2.55, -8.98], 0.28, fire));
  ps.push(stopcock([-6.9, -6.39], [0, 0.5], [-9.2, -8.76]));
  ps.push(block('steel', [-6.36, -6.14], [0.9, 1.12], [-8.84, -8.7], steel));
  for (const x of [0, 4.8]) ps.push(block('steel', [x - 0.12, x + 0.12], [2.43, 2.67], [-8.84, -8.4], steel));
  // Rear half is a genuine second volume: transverse joists key into the portal posts,
  // and floor panels sit between (rather than intersecting) the joists and upright steel.
  for (const x of xs.slice(1, -1)) {
    ps.push(block('steel', [x - c, x + c], [3.35, 3.6], [-Z + c, -c], steel));
  }
  for (let i = 0; i < xs.length - 1; i++) {
    const xr: Range = [xs[i] + (i ? 0.07 : c), xs[i + 1] - (i === xs.length - 2 ? c : 0.07)];
    ps.push(block('wood', xr, [3.6, 3.8], [-Z + c, -4], { tint: TINT.woodPale }));
    ps.push(block('wood', xr, [3.6, 3.8], [-4, -c], { tint: TINT.woodPale }));
  }
  // Service bay at the west rear: a heavy floor machine and its heat source;
  // the middle roller door and the clear central aisle remain unobstructed.
  ps.push(...lineDrive(-10.8, -4.8), ...boiler(-9.0, -1.5));
  // Services: an in-house transformer in the front-west corner feeds a high-bay lamp run along the front
  // columns (with a drop out through the roller-door head to a yard lamp) and floor trunking to the line drive.
  // The boiler has its own gas meter and a steam main rising to the mezzanine.
  ps.push(supplyBox([-12.35, -11.2], [0, 1.8], [7.0, 8.15]));
  ps.push(...conduit([[-12.31, 1.8, 7.81], [-12.31, 5.54, 7.81], [12.35, 5.54, 7.81]]));
  for (const x of [-9.375, -3.125, 3.125, 9.375]) ps.push(lamp([x - 0.25, x + 0.25], [5.2, 5.5], [7.6, 7.85], LIGHT.bay));
  ps.push(...conduit([[4.3, 5.5, 7.81], [4.3, 3.91, 7.81], [4.3, 3.91, 8.6]]), lamp([4.0, 4.36], [3.62, 3.87], [8.35, 8.6], LIGHT.sodium));
  ps.push(...conduit([[-12.31, 0.04, 7.0], [-12.31, 0.04, -4.8], [-12.31, 1.24, -4.8], [-11.88, 1.24, -4.8]]));
  ps.push(gasMeter([-9.25, -8.75], [0, 0.9], [0.2, 0.6]), ...pipe('gas', 'steel', [[-9.0, 0.5, 0.2], [-9.0, 0.5, -0.68]], 0.1));
  ps.push(...pipe('steam', 'steel', [[-8.19, 1.9, -1.35], [-8.19, 1.9, -0.9], [-8.19, 3.6, -0.9]], 0.14));
  ps.push(...hydrant(8.5, 9.6));
  // Dressings: a coping on the masonry base where the cladding starts, gutters on both eaves, corner downpipes.
  const skin = Z + c + 0.1, endSkin = X + c + 0.1;
  for (const s of [-1, 1] as const) {
    ps.push(...band({ mat: 'concrete', face: s * skin, out: s, from: -X - c - 0.25, to: X + c + 0.25, y: [row, row + 0.1], depth: 0.25, tint: TINT.concrete }));
    ps.push(...band({ mat: 'concrete', axis: 'z', face: s * endSkin, out: s, from: -skin, to: skin, y: [row, row + 0.1], depth: 0.25, tint: TINT.concrete }));
    ps.push(...band({ mat: 'metal', face: s * skin, out: s, from: -endSkin, to: endSkin, y: [roofTop - 0.14, roofTop], depth: 0.14, tint: TINT.steelGrey }));
    for (const x of [-12.3, 12.3]) ps.push(...downpipe({ face: s * skin, out: s }, x, [row + 0.1, roofTop - 0.14]));
  }
  ps.push(block('metal', [0.4, 4.6], [4.2, 5.0], [skin, skin + 0.08], { tint: TINT.steelRed }));
  if (p.interior !== false) ps.push(...fit(racking(3), -10.9, 6.8, 0));
  ps.push(...canopy({ axis: 'z', face: X + c + 0.25 }, [0.8, 2.2], 2.36, 0.6, { t: 0.18, tint: TINT.steelGrey }));
  // External roof-line rigging and its low-strength electrical feed. The wall
  // fixtures touch solid cladding between, rather than through, the windows.
  ps.push(...riggingLine([-6.25, 7.03, 8.42], [6.25, 7.03, 8.42], 1.2));
  ps.push(...wireLine([-6.25, 6.65, 8.37], [6.25, 6.65, 8.37], 0.24));
  if (p.stock) {
    ps.push(...drums('propane', 0, -1.3, 0, 3, 2));
    ps.push(...drums('propane', -5, 4.5, 0, 2, 2));
    ps.push(...drums('barrel', 5.2, -4.2, 0, 3, 2));
    ps.push(...drums('barrel', -7.5, -5.5, 0, 2, 2));
    ps.push(...crates(-6.5, 1.5, 0, 3, 2, 2), ...crates(7, 3.5, 0, 2, 2, 2));
    ps.push(...tnt(4.6, 0.8, 0, 2));
  }
  return put(layerize(ps, { cladding: true, roofs: 'tile' }), p, 'warehouse');
}
