import type { PieceSpec } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { block, splitRange, type Range } from '../../../levels/kit.ts';
import { withDetail } from '../../../levels/layers.ts';
import { disc } from '../../../levels/services.ts';
import { TINT } from '../../_shared/base.ts';

/** Two side platforms and an island on brick fill, four ballasted roads with bullhead rail ending at buffer stops,
    and the concourse made ground between the buffers and the booking hall. */
export function platforms(f: Frame): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const end = f.grid.z.shedEnd, conc = f.grid.z.concourse, top = f.levels.platform, stop = conc - 0.35;
  const bays = splitRange(end, conc, 8.3);
  const deck = { tint: 0x55575a }, cope = { tint: 0xd8d0bd }, fill = { tint: TINT.brickDark };
  const plats: [Range, number[]][] = [[[-17.6, -11.4], [-11.4]], [[-5, 5], [-5, 5]], [[11.4, 17.6], [11.4]]];
  for (const z of bays) {
    for (const [x, edges] of plats) {
      ps.push(block('brick', x, [0, 0.75], z, fill));
      const cx: Range[] = edges.map((e) => (e < x[0] + 0.1 ? [e, e + 0.6] : [e - 0.6, e]) as Range);
      let a = x[0], b = x[1];
      for (const c of cx) { if (Math.abs(c[0] - a) < 1e-6) a = c[1]; else b = c[0]; ps.push(block('stone', c, [0.75, top], z, cope)); }
      ps.push(block('asphalt', [a, b], [0.75, top], z, deck));
    }
  }
  // ballast beds with their sleepers as detail, bullhead rails in 16 m lengths, buffer stops against the concourse
  for (const c of [-9.95, -6.45, 6.45, 9.95]) {
    for (const z of splitRange(end, conc, 14.5)) {
      const zr: Range = [z[0], Math.min(z[1], stop)];
      const bed = block('stone', [c - 1.4, c + 1.4], [0, 0.3], z, { tint: 0x8d8778 });
      const sl: PieceSpec[] = [];
      for (let zz = Math.ceil((z[0] + 0.2) / 0.7) * 0.7; zz < z[1] - 0.2; zz += 0.7) sl.push(block('wood', [c - 1.3, c + 1.3], [0.17, 0.3], [zz - 0.125, zz + 0.125], { tint: 0x5a4a3c }));
      ps.push(withDetail(bed, sl));
      for (const r of [c - 0.7175, c + 0.7175]) ps.push({ ...block('steel', [r - 0.035, r + 0.035], [0.3, 0.45], zr, { tint: 0x6f665c }), section: { kind: 'I', t: 0.04, tw: 0.02, depth: 1 } });
    }
    ps.push(block('castiron', [c - 1.0, c + 1.0], [0.3, 1.25], [stop, conc], { tint: 0xa8332b }));
    for (const s of [-1, 1]) ps.push(disc('steel', 'z', [c + s * 0.87, 1.0, conc - 0.5], 0.2, 0.3, { tint: 0x3a3d40 }, 12));
  }
  // concourse made ground, flush with the platforms
  for (const x of splitRange(-17.6, 17.6, 8.8)) ps.push(block('concrete', x, [0, top], [conc, f.grid.z.hallBack - 0.06], { tint: 0xb5ad9d }));
  return ps;
}
