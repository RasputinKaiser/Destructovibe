import type { PieceSpec, Vec3 } from '../types.ts';
import { block, box, place, tag } from './kit.ts';

/** Two welded eyelets and a tension-only rope. Positions are local to the building;
 *  place() transforms both the fixtures and the opposite anchor in ropeTo. */
export function riggingLine(a: Vec3, b: Vec3, slack = 0.35, strength = 35e3): PieceSpec[] {
  const first = box('castiron', [0.34, 0.34, 0.34], a, { tint: 0x66615a });
  first.ropeTo = { end: [...b], slack, strength };
  const last = box('castiron', [0.34, 0.34, 0.34], b, { tint: 0x66615a });
  return [first, last];
}

/** Insulated cable between two wall-mounted junction boxes. It tears on a much
 *  smaller load than rigging, so it cannot prop up a collapsing building. */
export function wireLine(a: Vec3, b: Vec3, slack = 0.12): PieceSpec[] {
  const first = box('castiron', [0.24, 0.24, 0.24], a, { tint: 0x383f43 });
  first.ropeTo = { end: [...b], slack, strength: 350, kind: 'wire' };
  return [first, box('castiron', [0.24, 0.24, 0.24], b, { tint: 0x383f43 })];
}

/** Placeable construction-services gantry: every eyelet is welded to its frame;
 *  the rope and low-strength electrical lead respond separately to a cut post. */
export function serviceGantry(x: number, z: number, quarter = 0): PieceSpec[] {
  const frame = { tint: 0x858d91 };
  const ps = [
    block('steel', [-2.12, -1.78], [0, 3.05], [-0.2, 0.2], frame),
    block('steel', [1.78, 2.12], [0, 3.05], [-0.2, 0.2], frame),
    block('steel', [-2.12, 2.12], [3.05, 3.3], [-0.2, 0.2], frame),
    ...riggingLine([-1.95, 2.94, 0.37], [1.95, 2.94, 0.37], 0.52),
    ...wireLine([-1.95, 2.46, -0.32], [1.95, 2.46, -0.32], 0.12),
  ];
  return tag(place(ps, x, z, quarter), { group: 'service-gantry' });
}
