import type { PieceSpec } from '../../../types.ts';
import { block, prism, type Range } from '../../../levels/kit.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Steel transmission pylon (~33 m): five tiers stepping inward, every junction a solid node block so each weld is
    a flat box-to-box contact (slanted lattice bars made weak, fat-AABB joints), struts every half tier, cap plate,
    cross-arms and glass insulator strings. */
export function latticePylon(p: Placement): PieceSpec[] {
  const tiers = 5, th = 5.8, y0 = 0.4, nh = 0.3, lw = 0.5, hw = lw / 2, step = 0.55;
  const steel = { tint: TINT.steelGrey }, con = { tint: TINT.concrete }, glass = { tint: 0xcfe6ee };
  const ps: PieceSpec[] = [];
  const w = (i: number) => 3.6 - i * step;
  let y = y0;
  const corner = (c: number, s: number): Range => [s * c - hw, s * c + hw];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(block('concrete', corner(w(0), sx).map((v) => v + sx * 0) as Range, [0, y0], corner(w(0), sz), con));
  for (let i = 0; i < tiers; i++) {
    const c = w(i);
    // 508 x 16 mm tube legs; L 200x200x20 struts on each face at half-tier between leg faces
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push({ ...block('steel', corner(c, sx), [y, y + th], corner(c, sz), steel), section: { kind: 'chs', t: 0.016 } });
    const ym = y + th / 2, angle: PieceSpec['section'] = { kind: 'angle', t: 0.02 };
    for (const s of [-1, 1]) {
      ps.push({ ...block('steel', [-c + hw, c - hw], [ym - 0.1, ym + 0.1], [s * c - 0.1, s * c + 0.1], steel), section: angle });
      ps.push({ ...block('steel', [s * c - 0.1, s * c + 0.1], [ym - 0.1, ym + 0.1], [-c + hw, c - hw], steel), section: angle });
    }
    y += th;
    if (i + 1 < tiers) {
      // node block spanning this leg's top and the next (inset) leg's foot, and a strut ring at the joint
      const c2 = w(i + 1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const r = (sgn: number): Range => (sgn > 0 ? [c2 - hw, c + hw] : [-c - hw, -c2 + hw]);
        ps.push(block('steel', r(sx), [y, y + nh], r(sz), steel));
      }
      for (const s of [-1, 1]) {
        ps.push(block('steel', [-c2 + hw, c2 - hw], [y, y + nh], [s * c2 - 0.15, s * c2 + 0.15], steel));
        ps.push(block('steel', [s * c2 - 0.15, s * c2 + 0.15], [y, y + nh], [-c2 + hw, c2 - hw], steel));
      }
      y += nh;
    }
  }
  const H = y, c = w(tiers - 1);
  ps.push(block('steel', [-c - hw, c + hw], [H, H + 0.3], [-c - hw, c + hw], steel));
  ps.push(block('steel', [-7, 0], [H + 0.3, H + 0.8], [-0.25, 0.25], steel), block('steel', [0, 7], [H + 0.3, H + 0.8], [-0.25, 0.25], steel));
  ps.push(prism('steel', 0.3, [H + 0.8, H + 2.8], 0, 0, 8, steel));
  for (const x of [-6.6, 6.6]) ps.push(prism('glass', 0.25, [H + 0.3 - 1.5, H + 0.3], x, 0, 8, glass));
  // lower arms spring from the outer faces of the fourth-tier node blocks
  const yl = y0 + 4 * th + 3 * nh, cl = w(3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ps.push(block('steel', sx > 0 ? [cl + hw, 6.5] : [-6.5, -cl - hw], [yl, yl + nh], [sz * cl - 0.15, sz * cl + 0.15], steel));
    ps.push(prism('glass', 0.25, [yl - 1.5, yl], sx * 6.2, sz * cl, 8, glass));
  }
  return put(ps, p, 'pylon');
}
