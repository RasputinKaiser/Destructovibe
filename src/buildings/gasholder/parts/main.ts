import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, hull, prism, ringCourse, wallRun, type Range } from '../../../levels/kit.ts';
import { gasMeter, pipe } from '../../../levels/services.ts';
import { TINT } from '../../_shared/base.ts';
import { finish, member, PROF, type Placement } from '../../../levels/architecture/common.ts';

/* Column-guided gasholder of the 1880s, 45 m across. A brick water tank ring; a two-lift telescopic bell of riveted
   plate (the inner lift under a shallow crown), held on its guide carriages; sixteen cast-iron standards in three
   tiers carrying riveted ring girders at each tier, finials on top; a brick valve house with the gas main.
   The bell is shown standing full, riding up on its carriages; take the frame out and it drops into the tank. */

const N = 16, RT: Range = [21.6, 22.6], RS = 23.6, TIER = 11, TIERS = 3, STD = [1.1, 0.9, 0.8];
const RED = 0x8c3b2e, IRON = 0x3a4046, PLATE = 0x6c7a70;
const at = (r: number, a: number, y: number): Vec3 => [r * Math.cos(a), y, r * Math.sin(a)];

/** One lift: a ring of plate sectors (each a chord panel centred on a standard's bearing) from y0 to y1 at radius r. */
function lift(r: number, y: Range): PieceSpec[] {
  const ps: PieceSpec[] = [];
  for (let i = 0; i < N; i++) {
    const a0 = ((i - 0.5) * 2 * Math.PI) / N, a1 = ((i + 0.5) * 2 * Math.PI) / N;
    const q = hull('steel', [a0, a1].flatMap((a) => [r - 0.06, r + 0.06].flatMap((rr) => y.map((yy) => at(rr, a, yy)))), { tint: PLATE });
    q.density = 1400;   // 10 mm plate with its vertical stiffeners and the cup at the bottom
    ps.push(q);
  }
  return ps;
}

/** Guide carriage from a lift's rim out to the standard's inner face. */
function carriage(r: number, i: number, y: number, half: number): PieceSpec {
  const a = (i * 2 * Math.PI) / N, c = Math.cos(Math.PI / N);
  return member('steel', at((r + 0.06) * c, a, y), at(RS - half, a, y), PROF.box(0.5, 0.4, 0.02), { tint: IRON, depth: [0, 1, 0] });
}

export function gasholder(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [];
  // brick water tank
  for (const y of [[0, 4], [4, 8]] as Range[]) ps.push(...ringCourse('brick', 0, 0, y, [RT[0], RT[0]], [RT[1], RT[1]], 24, { tint: 0x9b5a45 }, y[0] ? Math.PI / 24 : 0));
  ps.push(...ringCourse('stone', 0, 0, [8, 8.4], [RT[0] - 0.05, RT[0] - 0.05], [RT[1] + 0.1, RT[1] + 0.1], 24, { tint: TINT.stone }));
  // standards: 16-sided cast-iron columns in three tiers, ring girders at each tier head, a finial on top
  for (let k = 0; k < TIERS; k++) {
    const y0 = k * TIER + (k ? 0.8 : 0), y1 = (k + 1) * TIER;
    for (let i = 0; i < N; i++) {
      const [x, , z] = at(RS, (i * 2 * Math.PI) / N, 0);
      ps.push(prism('castiron', STD[k], [y0, y1], x, z, 16, { tint: IRON }));
    }
    for (let i = 0; i < N; i++) {
      const a0 = (i * 2 * Math.PI) / N, a1 = ((i + 1) * 2 * Math.PI) / N, y = y1 + 0.4;
      const n0: Vec3 = [-Math.sin(a0), 0, Math.cos(a0)], n1: Vec3 = [-Math.sin(a1), 0, Math.cos(a1)];
      ps.push(member('steel', at(RS, a0, y), at(RS, a1, y), PROF.box(0.8, 0.5, 0.016), { tint: RED, depth: [0, 1, 0], joint: { kind: 'rivet', n: 24, d: 0.022 },
        cut: [{ at: at(RS, a0, y), n: n0 }, { at: at(RS, a1, y), n: n1 }] }));
    }
  }
  for (let i = 0; i < N; i++) {
    const [x, , z] = at(RS, (i * 2 * Math.PI) / N, 0), top = TIERS * TIER + 0.8;
    ps.push(prism('castiron', 0.7, [top, top + 1.2], x, z, 8, { tint: IRON }), prism('castiron', 0.3, [top + 1.2, top + 2.0], x, z, 8, { tint: IRON }));
  }
  // the bell: outer lift sitting down in the tank, inner lift above it under the crown, both on their carriages
  const outer = 21.2, inner = 20.8, yo: Range = [5.0, 15.4], yi: Range = [13.0, 24.6];
  ps.push(...lift(outer, yo), ...lift(inner, yi));
  for (let i = 0; i < N; i++) ps.push(carriage(outer, i, yo[1] - 0.25, STD[1] / 2), carriage(inner, i, yi[1] - 0.25, STD[2] / 2));
  // crown: shallow cone of plate sectors from the inner lift's rim to a centre boss
  const rise = 3.2, rc = 1.2;
  for (let i = 0; i < N; i++) {
    const a0 = ((i - 0.5) * 2 * Math.PI) / N, a1 = ((i + 0.5) * 2 * Math.PI) / N;
    const pts: Vec3[] = [];
    for (const a of [a0, a1]) for (const [r, y] of [[inner + 0.06, yi[1]], [inner - 0.06, yi[1]], [rc, yi[1] + rise]] as [number, number][]) pts.push(at(r, a, y), at(r, a, y + 0.1));
    const q = hull('steel', pts, { tint: PLATE });
    q.density = 1100;
    ps.push(q);
  }
  ps.push(prism('steel', 2 * rc * Math.cos(Math.PI / 16), [yi[1] + rise, yi[1] + rise + 0.4], 0, 0, 16, { tint: PLATE }));
  // valve house and the gas main from the governor to the holder's inlet
  const vx = 0, vz = RT[1] + 7;
  ps.push(...wallRun({ mat: 'brick', from: vx - 3, to: vx + 3, at: vz + 2.2, t: 0.34, y0: 0, h: 3.2, tint: 0x9b5a45, openings: [{ c: vx, w: 1.0, y0: 0, h: 2.1, glass: false }] }));
  ps.push(...wallRun({ mat: 'brick', from: vx - 3, to: vx + 3, at: vz - 2.2, t: 0.34, y0: 0, h: 3.2, tint: 0x9b5a45, openings: [{ c: vx + 1.5, w: 1.0, y0: 1.0, h: 1.0 }] }));
  for (const s of [-1, 1]) ps.push(...wallRun({ mat: 'brick', axis: 'z', from: vz - 2.03, to: vz + 2.03, at: vx + s * 2.83, t: 0.34, y0: 0, h: 3.2, tint: 0x9b5a45 }));
  ps.push(block('roof', [vx - 3.1, vx + 3.1], [3.2, 3.4], [vz - 2.5, vz + 2.5], { tint: TINT.slate }));
  ps.push(gasMeter([2.2, 3.8], [0, 1.4], [vz - 3.2, vz - 2.4]));
  ps.push(...pipe('gas', 'castiron', [[3, 0.5, vz - 3.2], [3, 0.5, RT[1] + 0.02]], 0.5));
  return finish(ps, p, 'gasholder', { years: 140, exposure: 'outdoor' });
}
