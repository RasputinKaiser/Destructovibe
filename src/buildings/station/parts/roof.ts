import type { PieceSpec, Vec3 } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { hull, type PieceOpts, type Range } from '../../../levels/kit.ts';
import { roofDetail, withDetail } from '../../../levels/layers.ts';
import { TINT } from '../../_shared/base.ts';
import { arcPt, member, obox, PROF } from '../../../levels/architecture/common.ts';
import { arch, GLAZE, IRON, NSEG, RB } from '../lib.ts';

/** Purlins, one per rib segment on its outer flange, carrying slate on the haunches and patent glazing over the crown. */
export function roof(f: Frame): PieceSpec[] {
  const { YC, RO, DA, ang, RIBS } = arch(f);
  const ps: PieceSpec[] = [];
  const iron: PieceOpts = { tint: IRON, joint: { kind: 'rivet', n: 12, d: 0.022 } };
  const hc = Math.cos(DA / 2);
  for (let k = 0; k + 1 < RIBS.length; k++) {
    const z1 = RIBS[k] + (k === 0 ? RB / 2 : 0), z0 = RIBS[k + 1] - (k + 2 === RIBS.length ? RB / 2 : 0);
    for (let j = 0; j < NSEG; j++) {
      const am = (ang(j) + ang(j + 1)) / 2, n: Vec3 = [Math.cos(am), Math.sin(am), 0], e: Vec3 = [-Math.sin(am), Math.cos(am), 0];
      const hs = RO * hc, pc = (d: number, zv: number): Vec3 => [n[0] * d, YC + n[1] * d, zv];
      ps.push(member('steel', pc(hs + 0.15, RIBS[k + 1]), pc(hs + 0.15, RIBS[k]), PROF.I(0.3, 0.15, 0.012, 0.008), { ...iron, depth: n }));
      const hb = hs + 0.3, glass = j >= 5 && j <= 10, th = glass ? 0.08 : 0.25;
      const pts: Vec3[] = [];
      for (const a of [ang(j), ang(j + 1)]) for (const d of [hb, hb + th]) for (const zv of [z0, z1]) pts.push(arcPt(0, YC, d / hc, a, zv));
      if (!glass) { ps.push(roofDetail(hull('roof', pts, { tint: TINT.slate }), { tile: 'slate' })); continue; }
      const half = hb * Math.tan(DA / 2) - 0.01, o = pc(hb, 0), fr: [Vec3, Vec3, Vec3] = [e, [0, 0, 1], n];
      const units: PieceSpec[] = [];
      const bars: number[] = [];
      for (let zv = Math.ceil((z0 + 0.03) / 0.6) * 0.6; zv < z1 - 0.03; zv += 0.6) bars.push(zv);
      for (const zb of bars) units.push(obox('steel', o, fr, [[-half, half], [zb - 0.025, zb + 0.025], [0, th]], { tint: IRON }));
      const edges = [z0, ...bars, z1];
      for (let i = 0; i + 1 < edges.length; i++) {
        const za = edges[i] + (i === 0 ? 0.005 : 0.025), zb = edges[i + 1] - (i + 2 === edges.length ? 0.005 : 0.025);
        if (zb - za < 0.1) continue;
        for (const eh of [[-half, -0.002], [0.002, half]] as Range[]) units.push(obox('glass', o, fr, [eh, [za, zb], [th / 2 - 0.003, th / 2 + 0.003]], { tint: GLAZE }));
      }
      ps.push(withDetail(hull('glass', pts, { tint: GLAZE }), units));
    }
  }
  return ps;
}
