import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, hull } from '../../../levels/kit.ts';
import { BORE, clipped, conduit, lamp, LIGHT, radiatorPanel, sprinklerRanges, SVC } from '../../../levels/services.ts';
import { MAIN, depthOf } from '../../../levels/grid.ts';
import { DPC } from '../../../terrain/spec.ts';
import type { Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/clearance-helpers.ts';
import { frameDims, portalShed, roofY } from '../../portal-shed/parts/main.ts';

/** Works hall shell: portal shed with a north-wall lighting tray fed by a riser from the floor feeder (local z -5).
    The floor feeder and the steam main are laid by the site grid through the west door and the south roller door;
    its machines and unit heaters are placed with the map. A wet-pipe sprinkler installation (ordinary hazard, a head
    per ~10 m²) hangs from the roof on drop rods: three ranges off a cross main, fed up the west gable from the
    control valve set of its own tank-and-pump supply (a works' sprinkler water rarely comes off the town main). */
export function worksHall(p: Placement): PieceSpec[] {
  const X = 13, Z = 7, H = 6, f = frameDims(X, Z, H);
  const ps = portalShed({ x: 0, z: 0, X, Z, H, bays: 4, front: [[4, 4, 4.5]], west: [[-5, 1.2, 2.3]], shutter: 2.2 });
  // lighting tray along the inner flanges of the north columns, fed by a riser from the floor feeder (local z -5)
  const tz: [number, number] = [-Z + f.D, -Z + f.D + 0.2];
  ps.push(block('steel', [-X + 0.3, X - 0.3], [5.5, 5.6], tz, { tint: SVC.cable, util: 'power' }));
  for (const x of [-9.75, -3.25, 3.25, 9.75]) ps.push(lamp([x - 0.25, x + 0.25], [5.28, 5.5], tz, LIGHT.bay));
  // the floor feeder comes up into a distribution board against the north wall; the lighting riser leaves its top
  const db = block('machine', [-5.3, -4.7], [1.2, 2.0], [-6.9, -6.45], { tint: 0x9aa09c });
  db.util = 'power';
  db.svcPart = 'breaker';
  // (the feeder and the steam main lie in the ground under the floor, which stands a damp course above it)
  const yf = depthOf('power') - DPC;
  ps.push(db, ...conduit([[-5.0, yf, -5 - MAIN.power.d / 2], [-5.0, yf, -6.675], [-5.0, 1.2, -6.675]]), ...conduit([[-5.0, 2.0, -6.49], [-5.0, 5.5, -6.49]]));
  const valve = block('castiron', [-X, -X + 0.4], [0.3, 1.2], [1.5, 2.1], { tint: 0xb0302a, fixture: 'watermain' });
  valve.bore = BORE.st100;
  const rx = -X + 0.02 + 0.052, main = -12.2, rafters = [-13, -6.5, 0, 6.5, 13];
  ps.push(valve, ...clipped('water', 'steel', [[rx, 1.2, 1.8], [rx, 5.6, 1.8], [main - 0.035, 5.6, 1.8]], BORE.st80, [-1, 0, 0]));
  // drop rods up to the rafter-top plane: each rod's head is cut to the roof slope so it bears on the purlin line
  const soffit = roofY(f, 3.6);
  ps.push(...sprinklerRanges({ x: [main, X - 0.4], zs: [-3.5, 0, 3.5], y: 5.6, main, soffit, rodAt: (x) => rafters.every((r) => Math.abs(x - r) > 0.3) })
    .map((q) => (q.mat === 'steel' && q.tint === SVC.galv && Math.abs(q.pos[1] + q.size[1] / 2 - soffit) < 1e-6 ? slopedRod(q, f) : q)));
  // unit heaters, each on a flow riser up through the floor from the steam main along local z 5.6
  for (const x of [-9, -1, 3]) {
    ps.push(radiatorPanel([x - 0.5, x + 0.5], [0, 1.0], [Z - 1.51 - 0.3, Z - 1.51]));
    ps.push(block('steel', [x - 0.05, x + 0.05], [depthOf('steam') - DPC, 0], [Z - 1.61, Z - 1.51], { tint: SVC.steam, util: 'steam' }));
  }
  return put(ps, p, 'works');
}

/* a rod block re-cut as a hull whose head follows the roof underside (a ridge-straddling rod gets both slopes) */
function slopedRod(q: PieceSpec, f: ReturnType<typeof frameDims>): PieceSpec {
  const x: [number, number] = [q.pos[0] - q.size[0] / 2, q.pos[0] + q.size[0] / 2], z: [number, number] = [q.pos[2] - q.size[2] / 2, q.pos[2] + q.size[2] / 2];
  const y0 = q.pos[1] - q.size[1] / 2, zs = z[0] < 0 && z[1] > 0 ? [z[0], 0, z[1]] : z;
  const pts: Vec3[] = [];
  for (const xx of x) for (const zz of zs) pts.push([xx, y0, zz], [xx, roofY(f, zz), zz]);
  const { pos: _p, size: _s, ...rest } = q;
  return { ...rest, ...hull(q.mat, pts, { tint: q.tint, group: q.group }) };
}
