import type { PieceSpec } from '../../../types.ts';
import { block, crates, drums, extrude, place, prism, wallRun, type Range } from '../../../levels/kit.ts';
import { band, canopy, downpipe, pilaster } from '../../../levels/facade.ts';
import { fit, pallet, workbench } from '../../../levels/interior.ts';
import { boilerSet, conduit, disc, gasMeter, groundTransformer, lamp, LIGHT, pipe, supplyBox, SVC } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { lineDrive, put } from '../../_shared/structures-helpers.ts';
import { industrialChimney } from '../../chimney/parts/main.ts';

/** Sawtooth-roofed factory, 30 x 18 m: steel columns and valley beams, north-light glazing between posts carrying
    ridge beams, sloped roof slabs seated on the valleys, brick-and-cladding walls, an overhead travelling crane,
    and an octagonal brick stack at the west end. */
export function factory(p: Placement & { stock?: boolean; stack?: boolean }): PieceSpec[] {
  const xs = [-15, -9, -3, 3, 9, 15], zs = [-9, -3, 3, 9], eave = 7.0, vb = 0.4, ridge = 9.9;
  const steel = { tint: TINT.steelGrey }, clad = { tint: TINT.metalGreen };
  const vt = eave + vb;
  const ps: PieceSpec[] = [];
  const segs: Range[] = [[-9.2, -3], [-3, 3], [3, 9.2]];
  for (const x of xs) {
    for (const z of zs) ps.push(block('steel', [x - 0.2, x + 0.2], [0, eave], [z - 0.2, z + 0.2], steel));
    for (const zr of segs) ps.push(block('steel', [x - 0.3, x + 0.3], [eave, vt], zr, steel));
  }
  for (let i = 0; i < 5; i++) {
    const xl = xs[i], xh = xs[i + 1];
    for (const z of zs) ps.push(block('steel', [xh - 0.15, xh + 0.15], [vt, ridge], [z - 0.15, z + 0.15], steel));
    for (const zr of segs) ps.push(block('steel', [xh - 0.2, xh + 0.2], [ridge, ridge + 0.3], zr, steel));
    for (let j = 0; j < 3; j++) ps.push(block('glass', [xh - 0.03, xh + 0.03], [vt, ridge], [zs[j] + 0.15, zs[j + 1] - 0.15]));
    // roof slab: seated on the valley at the low side, butting the ridge beam at the high side
    const x0 = xl + 0.15, x1 = xl + 0.3, xe = xh - 0.2, tv = 0.25, k = (ridge - vt) / (xe - x1);
    const prof: [number, number][] = [[xe, ridge], [xe, ridge + tv], [x0, vt + tv - k * (x1 - x0)], [x0, vt], [x1, vt]];
    // slab joints sit clear of the post lines so no slab corner just grazes a post
    for (const zr of [[-9.2, -3.2], [-3.2, 3.2], [3.2, 9.2]] as Range[]) ps.push(extrude('metal', prof, 'z', zr, steel));
    for (const zr of [[9.2, 9.45], [-9.45, -9.2]] as Range[]) ps.push(extrude('metal', [[x1, vt], [xe, vt], [xe, ridge]], 'z', zr, clad));
  }
  const lower = { mat: 'brick' as const, t: 0.25, y0: 0, h: 4, tint: TINT.brickPale, lintel: 'rconcrete' as const, maxW: 3 };
  const upper = { mat: 'metal' as const, t: 0.25, y0: 4, h: vt - 4, maxW: 3.2, tint: TINT.metalGreen };
  const wins = [-12, -6, 0, 6, 12].map((c) => ({ c, w: 2.4, y0: 1.2, h: 2.0 }));
  for (const s of [-1, 1] as const) {
    ps.push(...wallRun({ ...lower, from: -15.55, to: 15.55, at: s * 9.325, out: s, openings: wins }));
    ps.push(...wallRun({ ...upper, from: -15.55, to: 15.55, at: s * 9.325, out: s }));
    const door = s > 0 ? [{ c: 0, w: 5, y0: 0, h: 4 }] : [{ c: 3, w: 1.2, y0: 0, h: 2.4 }];
    ps.push(...wallRun({ ...lower, axis: 'z', from: -9.2, to: 9.2, at: s * 15.425, out: s, openings: door }));
    ps.push(...wallRun({ ...upper, axis: 'z', from: -9.2, to: 9.2, at: s * 15.425, out: s }));
  }
  // brick pilasters under a stone band at the brick/cladding junction, all round
  for (const s of [-1, 1] as const) {
    ps.push(...band({ mat: 'stone', face: s * 9.45, out: s, from: -15.55, to: 15.55, y: [3.88, 4.12], depth: 0.12, tint: TINT.stone }));
    ps.push(...band({ mat: 'stone', axis: 'z', face: s * 15.55, out: s, from: -9.2, to: 9.2, y: [3.88, 4.12], depth: 0.12, tint: TINT.stone }));
    for (const x of [-9, -3, 3, 9]) ps.push(...pilaster({ face: s * 9.45, out: s }, x, 0.45, [0, 3.88], { mat: 'brick', tint: TINT.brickDark, depth: 0.15 }));
    for (const x of [-15.2, 15.2]) ps.push(...downpipe({ face: s * 9.45, out: s }, x, [4.12, vt]));
  }
  // ridge ventilators and a canopy over the east loading door
  for (let i = 1; i < 6; i++) ps.push(prism('metal', 0.6, [ridge + 0.3, ridge + 0.9], xs[i], 0, 8, { tint: TINT.steelGrey }));
  ps.push(...canopy({ axis: 'z', face: 15.55 }, [-2.7, 2.7], 4.12, 1.5, { t: 0.25, tint: TINT.metalGreen }));
  // travelling crane in the south aisle: girders bolted to the column faces, bridge, trolley, hook
  for (let i = 0; i < 5; i++) {
    ps.push(block('steel', [xs[i], xs[i + 1]], [5.0, 5.6], [-8.8, -8.4], steel), block('steel', [xs[i], xs[i + 1]], [5.0, 5.6], [-3.6, -3.2], steel));
  }
  const crane = { tint: TINT.craneYellow };
  ps.push(block('steel', [-1.5, -0.5], [5.6, 6.2], [-8.8, -3.2], crane), block('steel', [-1.4, -0.6], [6.2, 6.6], [-6.4, -5.6], crane));
  ps.push(block('steel', [-1.05, -0.95], [3.4, 5.6], [-6.05, -5.95], steel), prism('steel', 0.5, [2.6, 3.4], -1, -6, 8, crane));
  // Machinery is deliberately confined to a west bay, outside the travelling
  // crane's hook line and the five-metre loading entrance on the east.
  ps.push(...lineDrive(-11.7, -5.5));
  // Services. East: a pad transformer whose lead climbs column (15, 3) to a line-shaft run along the z = 3 columns;
  // each hanger on it is a motor turning a pulley, and bay lamps hang from it. West: a boiler whose steam main runs
  // along the z = -3 columns, with its gas meter, and a wall supply box on floor trunking to the line drive.
  ps.push(...place(groundTransformer(), 12.2, 3.6));
  ps.push(...conduit([[13.0, 0.6, 3.24], [15.0, 0.6, 3.24], [15.0, 5.04, 3.24], [-9.3, 5.04, 3.24]]));
  for (const x of [-9, -3, 3, 9]) {
    ps.push(block('machine', [x - 0.15, x + 0.2], [4.3, 5.0], [3.2, 3.5], { tint: SVC.motor, fixture: 'motor' }));
    const pulley = disc('castiron', 'x', [x + 0.34, 4.6, 3.35], 0.32, 0.16, { tint: TINT.iron });
    pulley.noWeld = true;
    pulley.mech = { kind: 'hinge', at: [x + 0.05, 4.6, 3.35], axis: [1, 0, 0], motor: { speed: 5, force: 300 } };
    ps.push(pulley);
  }
  for (const x of [-6, 0, 6, 12]) ps.push(lamp([x - 0.25, x + 0.25], [4.7, 5.0], [3.2, 3.5], LIGHT.bay));
  ps.push(...place(boilerSet(), -12, -1.3, 2), gasMeter([-12.3, -11.7], [0, 0.9], [-2.62, -2.12]));
  ps.push(...pipe('steam', 'steel', [[-12.81, 1.9, -1.45], [-12.81, 1.9, -2.73], [-12.81, 4.2, -2.73], [12, 4.2, -2.73]], 0.14));
  ps.push(supplyBox([-13.5, -12.9], [0, 0.9], [-9.2, -9.0]));
  ps.push(...conduit([[-13.2, 0.04, -9.0], [-13.2, 0.04, -5.5], [-13.2, 0.9, -5.5], [-12.78, 0.9, -5.5]]));
  if (p.interior !== false) {
    for (const x of [-6, 0]) ps.push(...fit(workbench(), x, 7.8, 0, 2));
    for (const [x, z] of [[0, 1.0], [-4.5, 0.5]]) ps.push(...fit(pallet(2), x, z, 0));
  }
  if (p.stock) ps.push(...crates(6, 5.5, 0, 3, 2, 2), ...drums('barrel', -10, 5, 0, 3, 2), ...drums('propane', 11, -6, 0, 2, 1));
  if (p.stack ?? true) ps.push(...place(industrialChimney({ x: 0, z: 0 }), -21, 0));
  return put(ps, p, 'factory', { age: { years: 70, exposure: 'outdoor' } });
}
