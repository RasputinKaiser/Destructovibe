import type { PieceSpec, Vec3 } from '../types.ts';
import { block, cyl, place, rod, tag, type PieceOpts } from './kit.ts';
import { conduit, route, SVC } from './services.ts';
import { ISO_TINT, type MachinePlacement } from './machines.ts';

/* Electrical content: lightning protection and the scrapyard's lifting-magnet crane. */

const TAPE = 0.06;                     // 25 × 3 mm copper tape, drawn wide enough for the core to weld it
const COPPER = 0xb4703c;

// 25 × 3 mm tape weighs 0.7 kg/m: the drawn section is given its real mass
const lps = (ps: PieceSpec[]): PieceSpec[] => ps.map((p) => ({ ...p, lps: true, density: 200 }));

/** Lightning protection (BS EN 62305): an air terminal `h` m tall standing on `tip`, and a down conductor of copper
    tape from its foot to an earth electrode at the ground. `slope`, if given, is where the tape leaving the tip first
    lands, lying down a sloped face (a spire) with `out` its outward normal; from there `down` is an orthogonal run
    (each leg along one axis) ending at ground level. */
export function lightningRod(tip: Vec3, h: number, down: Vec3[], o: PieceOpts & { slope?: Vec3; out?: Vec3 } = {}): PieceSpec[] {
  const c = { tint: COPPER, group: o.group };
  const ps: PieceSpec[] = [block('copper', [tip[0] - 0.03, tip[0] + 0.03], [tip[1], tip[1] + h], [tip[2] - 0.03, tip[2] + 0.03], c)];
  if (o.slope) {
    const n = o.out ?? [0, 1, 0], off = TAPE / 2;
    ps.push(rod('copper', [tip[0] + n[0] * off, tip[1] + n[1] * off, tip[2] + n[2] * off], [o.slope[0] + n[0] * off, o.slope[1] + n[1] * off, o.slope[2] + n[2] * off], TAPE, c));
  }
  if (down.length > 1) ps.push(...route('copper', down, TAPE, c, { maxL: 4.5 }));
  return lps(ps);
}

/** Tape bonding a steel structure's foot to earth, down the face of the footing it stands on: from `a` on the steel,
    along the footing top to its edge and down to the ground. */
export function earthBond(a: Vec3, edge: Vec3, o: PieceOpts = {}): PieceSpec[] {
  const y = edge[1] + TAPE / 2;
  return lps(route('copper', [[a[0], a[1], a[2]], [a[0], y, a[2]], [edge[0], y, edge[2]], [edge[0], 0, edge[2]]], TAPE, { tint: COPPER, group: o.group }));
}

/* ---------------- scrapyard magnet crane ---------------- */

const YEL = 0xe0a82a, DARK = 0x2f3336;

/** Scrapyard crane: a fixed steel column on a concrete plinth, a slewing jib (grid gearmotor, shuttling ±`slew` rad, default 0.7) and a
    hoist that dips a 1.3 m lifting magnet (rated 2 t) into the pile below its tip, 7 m out along +X. The magnet is fed
    by a festoon cable from the column: it holds its load only while the column is live, and drops it the moment
    the isolator opens, the cable is cut or the grid goes down. Its isolator stands on the ground at +X of the plinth. */
export function magnetCrane(p: MachinePlacement & { slew?: number }): PieceSpec[] {
  const sl = p.slew ?? 0.7;
  const y: PieceOpts = { tint: YEL, finish: 'satin' };
  // box-section steelwork drawn solid (a hollow section has nothing at the joint centres for the jib and hoist to
  // find), weighing what a 16 mm and 12 mm wall would
  const col = { ...block('steel', [-0.45, 0.45], [0.5, 7.0], [-0.45, 0.45], { ...y, util: 'power' }), density: 550 };
  // the jib's hoist motor and the magnet each take a festoon cable (a wire rope) from the column: both hang from
  // points that turn with the slew about the column's axis, so the cables keep their length as it slews
  const jib = { ...block('steel', [-2.2, 7.6], [7.1, 7.7], [-0.3, 0.3], { ...y, util: 'power' }), density: 620, noWeld: true };
  jib.ropeTo = { end: [0, 3.75, 0], slack: 0.5, strength: 4000, kind: 'wire' };
  jib.mech = { kind: 'hinge', at: [0, 6.95, 0], axis: [0, 1, 0], lower: -sl, upper: sl, motor: { speed: 0.15, force: 0, kW: 7.5, shuttle: true } };
  const hoist = { ...block('steel', [6.9, 7.1], [3.2, 7.04], [-0.1, 0.1], { tint: DARK }), noWeld: true };
  hoist.mech = { kind: 'slider', at: [7.0, 7.3, 0], axis: [0, 1, 0], lower: -2.3, upper: 0, motor: { speed: 0.35, force: 0, kW: 5.5, shuttle: true } };
  const magnet: PieceSpec = { ...cyl('steel', 1.3, [2.7, 3.2], 7.0, 0, { tint: DARK, util: 'power' }), noWeld: true, magnet: 2000, density: 2400 };
  magnet.mech = { kind: 'hinge', at: [7.0, 3.25, 0], axis: [0, 1, 0], lower: 0, upper: 0 };
  magnet.ropeTo = { end: [0, 3.75, 0], slack: 1.5, strength: 4000, kind: 'wire' };
  const iso = block('machine', [1.7, 2.2], [0, 1.4], [-0.3, 0.3], { tint: ISO_TINT, finish: 'satin', ...(p.feed === 'grid' ? { util: 'power' as const } : { fixture: 'transformer' as const }) });
  if (p.feed === 'grid') iso.svcPart = 'fuse';
  const ps: PieceSpec[] = [
    block('concrete', [-1.6, 1.6], [0, 0.5], [-1.6, 1.6], { tint: 0x9a9a96 }),
    col, jib, hoist, magnet, iso,
    ...conduit([[1.7, 1.0, 0], [0.45, 1.0, 0]], { tint: SVC.swa }),
    ...earthBond([-0.48, 1.5, 0], [-1.63, 0.5, 0]),
  ];
  return tag(place(ps, p.x, p.z, p.rot ?? 0), { group: p.group ?? 'magnetcrane' });
}

/** A heap of loose ferrous scrap under a magnet crane: plate offcuts, beam ends and a cast housing. */
export function scrapPile(x: number, z: number, group = 'scrap'): PieceSpec[] {
  const s = { tint: 0x6b5a4a, noWeld: true, group };
  return [
    block('steel', [x - 0.6, x + 0.6], [0, 0.04], [z - 0.5, z + 0.5], s),
    block('steel', [x - 0.45, x + 0.35], [0.04, 0.12], [z - 0.3, z + 0.35], s),
    block('metal', [x - 0.3, x + 0.5], [0.12, 0.16], [z - 0.4, z + 0.2], s),
    block('steel', [x + 0.7, x + 1.9], [0, 0.2], [z - 0.1, z + 0.1], s),
    block('castiron', [x - 1.4, x - 0.9], [0, 0.4], [z - 0.3, z + 0.3], s),
  ];
}
