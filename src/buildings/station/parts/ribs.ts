import type { PieceSpec, Vec3 } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { partsVolume } from '../../../destruction/compound.ts';
import { hull, weldParts, type Range } from '../../../levels/kit.ts';
import { arcPt } from '../../../levels/architecture/common.ts';
import { arch, IRON, NSEG, RB, TF } from '../lib.ts';

/** Wrought-iron lattice arch ribs, NSEG riveted segments each, springing from the plate-girder tops. */
export function ribs(f: Frame): PieceSpec[] {
  const { R, YC, RI, RO, DA, ang, cutR, RIBS } = arch(f);

  /** One rib segment: inner and outer flanges, and a Warren pair of lattice bars (a solid-web springer at each foot). */
  function ribSegment(j: number, z: number): PieceSpec {
    const zz: Range = [z - RB / 2, z + RB / 2];
    const lo = (r: number) => (j === 0 ? cutR(r) : ang(j));
    const hi = (r: number) => (j === NSEG - 1 ? Math.PI - cutR(r) : ang(j + 1));
    const band = (r0: number, r1: number, zr: Range): PieceSpec => {
      const pts: Vec3[] = [];
      for (const r of [r0, r1]) for (const a of [lo(r), hi(r)]) for (const zv of zr) pts.push(arcPt(0, YC, r, a, zv));
      return hull('steel', pts);
    };
    const parts: PieceSpec[] = [band(RI, RI + TF, zz), band(RO - TF, RO, zz)];
    const web: Range = [z - 0.03, z + 0.03];
    if (j === 0 || j === NSEG - 1) parts.push(band(RI + TF, RO - TF, [z - 0.02, z + 0.02]));
    else {
      const at = (r: number, u: number): Vec3 => {
        const a = arcPt(0, YC, r, ang(j), 0), b = arcPt(0, YC, r, ang(j + 1), 0);
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, 0];
      };
      const bar = (r0: number, u0: Range, r1: number, u1: Range): PieceSpec => {
        const pts: Vec3[] = [];
        for (const [r, us] of [[r0, u0], [r1, u1]] as [number, Range][]) for (const u of us) for (const zv of web) { const p = at(r, u); pts.push([p[0], p[1], zv]); }
        return hull('steel', pts);
      };
      parts.push(bar(RI + TF, [0, 0.12], RO - TF, [0.38, 0.5]), bar(RO - TF, [0.5, 0.62], RI + TF, [0.88, 1]));
    }
    const seg = weldParts(parts);
    // riveted wrought iron: two 150 × 150 angles and a 360 × 16 plate per flange, lattice flats — ~190 kg/m
    seg.density = Math.round((190 * R * DA) / partsVolume(seg.parts!));
    seg.tint = IRON;
    seg.joint = { kind: 'rivet', n: 24, d: 0.022 };
    return seg;
  }

  const ps: PieceSpec[] = [];
  for (const z of RIBS) for (let j = 0; j < NSEG; j++) ps.push(ribSegment(j, z));
  return ps;
}
