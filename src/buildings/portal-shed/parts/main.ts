import type { PieceSpec } from '../../../types.ts';
import { block, cyl, type Range } from '../../../levels/kit.ts';
import { withDetail } from '../../../levels/layers.ts';
import type { Placement } from '../../_shared/base.ts';
import { claddingDetail, column, frameDims, gableTriangle, gutter, rafter, roofSlope, SHED, shade, shutter, wallPanels, type FrameDims } from '../lib.ts';

export { frameDims, roofY, type FrameDims } from '../lib.ts';

export interface PortalShedOpts {
  X: number; Z: number; H: number; bays: number;
  /** wall cladding colour (upper); the lower band is the same colour darker */
  tint?: number;
  roofTint?: number;
  /** openings as [centre, width, height]: front (+Z) and west gable (-X) */
  front?: [number, number, number][];
  west?: [number, number, number][];
  /** roller-shutter curtain bottom height in the front openings (undefined: rolled up, open) */
  shutter?: number;
  /** two-tone band height (0 = single colour) */
  band?: number;
  /** downpipes per eave */
  downpipes?: number;
  pitch?: number;
  /** roller-shutter coil boxes over the front openings (default true) */
  hoods?: boolean;
}

/** Steel portal shed, front +Z, frames across Z at the bay lines along X (UK single-span practice, 6° pitch):
    UB columns on base plates, haunched UB rafters bolted to the column flanges and to each other at the apex,
    Z purlins and sheeting rails on cleats, cross-bracing in the end bays of the roof and long walls, 32/1000
    profiled sheeting with a darker lower band and corner trims, roof lights in alternate bays, box gutters with
    downpipes, roller shutters with coil boxes, a steel personnel door. `front` / `west` are openings as
    [x or z centre, width, height]. */
/* sheet fixings: self-drilling screws into the rails, the weak link that lets cladding and gutters tear away */
const SCREWS = { kind: 'screw' as const, n: 6, d: 0.0055 };

export function portalShed(p: Placement & PortalShedOpts): PieceSpec[] {
  const { X, Z, H } = p;
  const f: FrameDims = frameDims(X, Z, H, p.pitch ?? 6);
  const { B, tw, Hg } = f;
  const steel = { tint: SHED.steel, finish: 'paint' as const };
  const wallTint = p.tint ?? 0x7d9a86, roofTint = p.roofTint ?? SHED.roof, band = p.band ?? 2.4;
  const xs = Array.from({ length: p.bays + 1 }, (_, i) => -X + (2 * X * i) / p.bays);
  const fx = xs.map((x, i) => (i === 0 ? x + B / 2 : i === p.bays ? x - B / 2 : x));
  const ps: PieceSpec[] = [];
  // portal frames
  for (const x of fx) for (const s of [1, -1] as const) ps.push(column(f, x, s, steel), ...rafter(f, x, s, steel));
  // roof, bay by bay, oversailing the gables by 100 mm
  for (let i = 0; i < p.bays; i++) {
    const xr: Range = [i === 0 ? -X - tw - 0.1 : xs[i], i === p.bays - 1 ? X + tw + 0.1 : xs[i + 1]];
    const end = i === 0 || i === p.bays - 1;
    const verge = [...(i === 0 ? ['lo' as const] : []), ...(i === p.bays - 1 ? ['hi' as const] : [])];
    const lights = i % 2 === 1 ? [] : [1, 4];
    for (const s of [1, -1] as const) for (const part of ['upper', 'lower'] as const) ps.push(roofSlope(f, xr, s, { tint: roofTint, brace: end, lights, verge, part }));
  }
  // long walls (+Z front, -Z back), wrapping the corners
  const front = p.front ?? [], west = p.west ?? [];
  const corners = [-X - tw, X + tw];
  for (const s of [1, -1] as const) {
    const zr: Range = s > 0 ? [Z, f.Ze] : [-f.Ze, -Z];
    for (const w of wallPanels(-X - tw, X + tw, xs, s > 0 ? front : [], Hg, 7.5)) {
      const endBay = w.full && (w.u[1] <= xs[1] + 1e-6 || w.u[0] >= xs[p.bays - 1] - 1e-6) && w.u[1] - w.u[0] > 3;
      ps.push(claddingDetail(block('metal', w.u, w.y, zr, { tint: wallTint, joint: SCREWS }), true, s, { tint: wallTint, band, brace: endBay, eaves: true, corners }));
    }
  }
  // gable walls and their triangles
  for (const s of [1, -1] as const) {
    const xr: Range = s > 0 ? [X, X + tw] : [-X - tw, -X];
    for (const w of wallPanels(-Z, Z, [], s < 0 ? west : [], Hg, 8.5)) {
      ps.push(claddingDetail(block('metal', xr, w.y, w.u, { tint: wallTint, joint: SCREWS }), false, s, { tint: wallTint, band }));
    }
    ps.push(gableTriangle(f, xr, s, { tint: wallTint }));
  }
  // front openings: roller shutters (curtain + coil box inside the head) ; west: a steel door or a shutter
  for (const [c, w, h] of front) {
    const u: Range = [c - w / 2, c + w / 2];
    if (p.shutter !== undefined && p.shutter < h - 0.3) ps.push(shutter(true, u, [p.shutter, h], [Z + 0.03, Z + 0.11], { tint: shade(wallTint, 0.85) }));
    if (p.hoods !== false) ps.push(block('steel', [u[0] - 0.1, u[1] + 0.1], [h, h + 0.55], [Z - 0.5, Z], { tint: SHED.galv }));
  }
  for (const [c, w, h] of west) {
    const u: Range = [c - w / 2, c + w / 2];
    if (w >= 2) { ps.push(shutter(false, u, [p.shutter ?? 0, h], [-X - 0.11, -X - 0.03], { tint: shade(wallTint, 0.85) })); continue; }
    ps.push(steelDoor(u, h, [-X - 0.14, -X - 0.06]));
  }
  // eaves gutters and downpipes
  const nd = p.downpipes ?? (X > 9 ? 2 : 1);
  for (const s of [1, -1] as const) {
    ps.push({ ...gutter(f, [-X - tw, X + tw], s), joint: SCREWS });
    const dx = nd === 1 ? [s > 0 ? X - 0.4 : -X + 0.4] : [-X + 0.4, X - 0.4];
    for (const x of dx) {
      if (s > 0 && front.some(([c, w]) => Math.abs(x - c) < w / 2 + 0.2)) continue;
      ps.push({ ...cyl('aluminum', 0.1, [0, Hg - 0.2], x, s * (f.Ze + 0.07), { tint: 0x7f868b, finish: 'paint' }), density: 400 });
    }
  }
  return ps;
}

/** Flush steel personnel door in a gable opening (z range u, height h), leaf in its frame with a kick plate. */
function steelDoor(u: Range, h: number, t: Range): PieceSpec {
  const cell = (z: Range, y: Range, tt: Range, tint: number) => { const q = block('steel', tt, y, z); q.tint = tint; q.finish = 'paint'; return q; };
  const p = block('steel', t, [0, h], u, { tint: 0x3d4a52 });
  const fw = 0.05, tm = (t[0] + t[1]) / 2;
  return withDetail(p, [
    cell([u[0], u[0] + fw], [0, h], t, 0x2f363b), cell([u[1] - fw, u[1]], [0, h], t, 0x2f363b), cell([u[0] + fw, u[1] - fw], [h - fw, h], t, 0x2f363b),
    cell([u[0] + fw, u[1] - fw], [0, 0.25], [tm - 0.03, tm + 0.03], 0x9aa0a4),
    cell([u[0] + fw, u[1] - fw], [0.25, h - fw], [tm - 0.025, tm + 0.025], 0x3d4a52),
  ]);
}
