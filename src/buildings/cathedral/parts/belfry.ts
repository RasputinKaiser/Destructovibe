import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, hollowStack, hull, prism, type PieceOpts, type Range } from '../../../levels/kit.ts';
import type { Frame } from '../../assemble.ts';
import { DARK, LIME, OAK, TOWER_A, TOWER_T } from '../frame.ts';
import { masonry } from '../lib.ts';

/** Bronze bell hung by its headstock from a bell beam, free to swing about the beam's axis. */
function bell(x: number, yTop: number, z: number, d: number): PieceSpec {
  const pts: Vec3[] = [], h = d * 0.8;
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / 12, c = Math.cos(a), s = Math.sin(a);
    pts.push([x + (d / 2) * c, yTop - h, z + (d / 2) * s], [x + d * 0.33 * c, yTop - h * 0.55, z + d * 0.33 * s], [x + d * 0.27 * c, yTop, z + d * 0.27 * s]);
  }
  const b = hull('copper', pts, { tint: 0x8c6a2c, noWeld: true });
  b.density = 1600;   // bell bronze in a hollow cup (the hull is solid)
  b.mech = { kind: 'hinge', at: [x, yTop + 0.28, z], axis: [0, 0, 1] };
  return b;
}

/** Belfry stage on the tower shaft: corner piers, lintels and oak louvres, bell beams with three bells, then the corbel
    course the spire seats on, the parapet and corner pinnacles. */
export function belfry(f: Frame): PieceSpec[] {
  const a = TOWER_A, t = TOWER_T, cz = f.grid.z.towerFace + a, y0 = f.levels.belfryFloor, top = f.levels.spireSeat;
  const o: PieceOpts = { tint: LIME }, ps: PieceSpec[] = [];
  const cr = (c: number, s: number, w = 2.2): Range => (s > 0 ? [c + a - w, c + a] : [c - a, c - a + w]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(block('stone', cr(0, sx), [y0, 30], cr(cz, sz), o));
  const gap: Range = [-a + 2.2, a - 2.2], gz: Range = [cz - a + 2.2, cz + a - 2.2];
  for (const s of [-1, 1]) {
    const zf: Range = s > 0 ? [cz + a - t, cz + a] : [cz - a, cz - a + t], xf: Range = s > 0 ? [a - t, a] : [-a, -a + t];
    ps.push(block('stone', gap, [29.2, 30], zf, o), block('stone', xf, [29.2, 30], gz, o));
    for (const y of [25.2, 26.5, 27.8]) {
      ps.push(block('wood', gap, [y, y + 0.9], [zf[0] + 0.5, zf[0] + 0.58], { tint: OAK }), block('wood', [xf[0] + 0.5, xf[0] + 0.58], [y, y + 0.9], gz, { tint: OAK }));
    }
  }
  const beams: [number, number[], number[]][] = [[cz - a + 1.8, [-1.15, 1.15], [0.9, 0.9]], [cz + a - 1.8, [0], [1.3]]];
  for (const [zb, xs, ds] of beams) {
    ps.push(block('oak', gap, [27.6, 28.0], [zb - 0.2, zb + 0.2], { tint: OAK }));
    xs.forEach((x, i) => ps.push(bell(x, 27.52, zb, ds[i])));
  }
  ps.push(...hollowStack('stone', 0, cz, 30, 2 * a, 1.6, 0.8, 1, { tint: DARK }), ...hollowStack('stone', 0, cz, top, 2 * a, 0.5, 1.2, 1, o));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(prism('stone', 0.7, [32, 35.5], sx * (a - 0.15), cz + sz * (a - 0.15), 8, o));
  return masonry(ps);
}
