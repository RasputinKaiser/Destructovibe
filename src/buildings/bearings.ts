import type { Bearing, BuildingDef } from './assemble.ts';
import { buildParts } from './assemble.ts';
import { pieceAabb, pieceSolid, TOUCH_GAP } from '../levels/validate.ts';
import type { PieceSpec } from '../types.ts';
import type { Range } from '../levels/kit.ts';

const overlaps = (lo: number, hi: number, r: Range) => hi > r[0] && lo < r[1];

export interface BearingIssue { part: string; bearing: string; msg: string }

/** Errors for bearings a part needs but nothing provides, and for parts that do not actually touch the bearing plane they claim. */
export function checkBearings<P>(def: BuildingDef<P>, params: Partial<P>): string[] {
  return bearingIssues(def, params).map((i) => i.msg);
}

/** checkBearings with each message's part and bearing, so a check can be scoped to one part. */
export function bearingIssues<P>(def: BuildingDef<P>, params: Partial<P>): BearingIssue[] {
  const issues: BearingIssue[] = [];
  const full = { ...def.defaults, ...params } as P;
  const frame = def.frame(full);
  const built = buildParts(def, full);
  const pieces = (id: string): PieceSpec[] => built.find((b) => b.part === id)?.pieces ?? [];
  const providers = (name: string) => def.parts.filter((p) => p.provides?.includes(name));

  /* 'top': a piece's outermost point along the bearing normal lies on the plane (the provider below); 'bottom': its
     innermost point does (the part resting on it). Horizontal bearings use the AABB; inclined ones the piece's vertices. */
  const touching = (ps: PieceSpec[], br: Bearing, face: 'top' | 'bottom') =>
    ps.some((p) => {
      const b = pieceAabb(p);
      if (!overlaps(b.min[0], b.max[0], br.x) || !overlaps(b.min[2], b.max[2], br.z)) return false;
      if (!br.normal) return Math.abs((face === 'top' ? b.max[1] : b.min[1]) - br.y) <= TOUCH_GAP;
      const n = br.normal, o = br.point ?? [(br.x[0] + br.x[1]) / 2, br.y, (br.z[0] + br.z[1]) / 2];
      const d = pieceSolid(p).verts.map((v) => (v[0] - o[0]) * n[0] + (v[1] - o[1]) * n[1] + (v[2] - o[2]) * n[2]);
      return Math.abs(face === 'top' ? Math.max(...d) : Math.min(...d)) <= TOUCH_GAP;
    });
  const where = (br: Bearing) => br.normal ? `the plane through [${br.point ?? `y=${br.y}`}] normal [${br.normal.map((v) => +v.toFixed(3))}]` : `y=${br.y}`;

  for (const pt of def.parts) {
    for (const name of pt.provides ?? []) {
      const br = frame.bearings[name];
      if (!br) { issues.push({ part: pt.id, bearing: name, msg: `part ${pt.id} provides ${name}: frame has no such bearing` }); continue; }
      if (!touching(pieces(pt.id), br, 'top'))
        issues.push({ part: pt.id, bearing: name, msg: `part ${pt.id} provides ${name}: no piece top within ${TOUCH_GAP} m of ${where(br)} over x[${br.x}] z[${br.z}]` });
    }
    for (const name of pt.needs ?? []) {
      const br = frame.bearings[name];
      if (!br) { issues.push({ part: pt.id, bearing: name, msg: `part ${pt.id} needs ${name}: frame has no such bearing` }); continue; }
      if (providers(name).length === 0) issues.push({ part: pt.id, bearing: name, msg: `part ${pt.id} needs ${name}: no part provides it` });
      if (!touching(pieces(pt.id), br, 'bottom'))
        issues.push({ part: pt.id, bearing: name, msg: `part ${pt.id} needs ${name}: no piece bottom within ${TOUCH_GAP} m of ${where(br)} over x[${br.x}] z[${br.z}]` });
    }
  }
  return issues;
}
