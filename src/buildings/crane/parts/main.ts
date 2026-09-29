import type { PieceSpec } from '../../../types.ts';
import { block, hull, prism, weldParts } from '../../../levels/kit.ts';
import { earthBond } from '../../../levels/electrical.ts';
import { lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Flat-top tower crane: footing, mast of box-section lengths, a slewing ring and above it the slewing superstructure
    as one rigid body (turntable, cat-head, a tapering box-truss jib and the counter-jib, with its ballast blocks riding
    on it), a trolley running out along the jib with the hook on its hoist line, and the operator's cab on a bracket
    at the mast head. Electric slew (15 kW) and trolley (5.5 kW) drives on the crane's own supply work an operator-less
    cycle: slew, run the trolley out and back. The superstructure is balanced about the mast, empty jib against
    ballast; the weight goes down the mast through the ring. */
export function towerCrane(p: Placement & { sections?: number }): PieceSpec[] {
  const nS = p.sections ?? 1, sh = 30, base = 1.0, a = 0.7, lh = 0.15;
  const yel = { tint: TINT.craneYellow }, con = { tint: TINT.concrete };
  const ps: PieceSpec[] = [block('concrete', [-2.5, 2.5], [0, base], [-2.5, 2.5], con)];
  let y = base;
  // mast: light box-section lengths stacked face to face (thin collars between heavy lengths made the solver soft)
  for (let k = 0; k < nS; k++) {
    ps.push({ ...block('steel', [-a - lh, a + lh], [y, y + sh], [-a - lh, a + lh], yel), section: { kind: 'rhs', t: 0.01 } });
    y += sh;
  }
  const top = y, y0 = top + 0.4, deck = top + 0.7, root = 2.4, jibTip = -21.5, T = 100;
  // the ring's fixed half on the mast head; the slewing half is the turntable 6 cm above it
  ps.push(prism('steel', 2.0, [top, top + 0.34], 0, 0, 16, yel));
  const upper = weldParts([
    block('aluminum', [-1.5, 1.5], [y0, deck], [-1.5, 1.5], yel),
    block('aluminum', [-1.5, 1.5], [deck, y0 + root], [-1.0, 1.0], yel),
    hull('aluminum', [[-1.5, y0, -0.5], [-1.5, y0, 0.5], [-1.5, y0 + root, -0.5], [-1.5, y0 + root, 0.5],
      [jibTip, y0, -0.2], [jibTip, y0, 0.2], [jibTip, y0 + 0.4, -0.2], [jibTip, y0 + 0.4, 0.2]], yel),
    block('aluminum', [1.5, 8.5], [y0, y0 + root], [-0.5, 0.5], yel),
  ], { noWeld: true, density: 390 });
  upper.mech = { kind: 'hinge', at: [0, top + 0.32, 0], axis: [0, 1, 0], brake: 2e5,
    motor: { speed: 0.07, force: 0, kW: 15, drive: 'electric', always: true },
    cycle: { period: T, keys: [[0, 0], [10, 0], [25, 0.5], [45, 0.5], [62, -0.4], [80, -0.4], [92, 0]] } };
  ps.push(upper);
  // ballast balancing the empty jib about the mast
  for (const x of [6.5, 7.5]) {
    const b = { ...block('concrete', [x, x + 1.0], [y0 + root, y0 + root + 2.0], [-0.65, 0.65], { tint: TINT.darkConcrete }), noWeld: true, density: 1230 };
    b.mech = { kind: 'hinge', at: [x + 0.5, y0 + root - 0.05, 0], axis: [0, 1, 0], lower: 0, upper: 0 };
    ps.push(b);
  }
  // cab and its supply hung on the mast head's face, below the slewing ring
  ps.push({ ...block('metal', [-1.2, 0.3], [top - 1.4, top - 0.06], [a + lh, 2.35], { tint: TINT.metalWhite }), density: 250 },
    block('tempered', [-1.26, -1.2], [top - 1.1, top - 0.2], [a + lh + 0.1, 2.25]));
  ps.push(supplyBox([-1.2, -0.6], [top - 1.4, top - 0.8], [2.35, 2.65]), lamp([-0.6, -0.2], [top - 1.3, top - 1.05], [2.35, 2.6], LIGHT.cool));
  // the steelwork is the down conductor, bonded to earth past the concrete base
  ps.push(...earthBond([a + lh + 0.03, base + 0.5, 0], [2.53, base, 0]));
  const tx = -10;
  const trolley = { ...block('steel', [tx - 0.5, tx + 0.5], [top - 0.1, top + 0.34], [-0.85, 0.85], yel), noWeld: true };
  trolley.mech = { kind: 'slider', at: [tx, y0 + 0.05, 0], axis: [-1, 0, 0], lower: -7, upper: 9.5, brake: 3e4,
    motor: { speed: 0.8, force: 0, kW: 5.5, drive: 'electric', always: true },
    cycle: { period: T, keys: [[0, 0], [20, 0], [35, 8], [55, 8], [70, -5], [85, -5], [95, 0]] } };
  // hoist line: an 8 t SWL rope at a safety factor of five
  trolley.ropeTo = { end: [tx, top - 8.25, 0], slack: 0.1, strength: 4e5 };
  const sheave = { ...prism('steel', 0.5, [top - 0.8, top - 0.16], tx, 0, 8, yel), noWeld: true };
  sheave.mech = { kind: 'hinge', at: [tx, top - 0.05, 0], axis: [0, 1, 0], lower: 0, upper: 0 };
  ps.push(trolley, sheave);
  // The hook is a separate swinging mass suspended by the distance constraint.
  ps.push(block('castiron', [tx - 0.42, tx + 0.42], [top - 8.52, top - 7.98], [-0.3, 0.3], { tint: TINT.iron, noWeld: true }));
  return put(ps, p, 'crane');
}
