import type { PieceSpec, Vec3 } from '../../../types.ts';
import { hull, weldParts, type Range } from '../../../levels/kit.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines, DARK, LIME } from '../frame.ts';

/* vault: height to the crown, web thickness, stations per half-span */
const VH = 6, WEB = 0.25, NS = 3;
/* normalised two-centred pointed profile: phi(0) = 1 at the crown, phi(1) = 0 at the springing */
const PR = (1 + 1.2 * 1.2) / 2;
const phi = (u: number) => Math.sqrt(Math.max(0, PR * PR - (Math.min(1, u) - (1 - PR)) ** 2)) / 1.2;

/** Quadripartite rib vault over the nave: stone web courses meeting on the groins, diagonal ribs worked on the courses,
    transverse ribs on the bay lines and wall ribs against the end walls. Springs off the clerestory's inner faces. */
export function vault(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), XI = f.grid.x.nave, YS = f.levels.springing;
  const vy = (u: number) => YS + VH * phi(u);
  const ps: PieceSpec[] = [], o = { tint: LIME };
  const st = Array.from({ length: 2 * NS + 1 }, (_, i) => -1 + i / NS);   // -1 .. 1 in steps of 1/NS
  for (let k = 0; k + 1 < ZB.length; k++) {
    const zm = (ZB[k] + ZB[k + 1]) / 2, hz = (ZB[k] - ZB[k + 1]) / 2;
    for (let i = 0; i + 1 < st.length; i++) {
      const u0 = st[i], u1 = st[i + 1], inner = Math.max(Math.abs(u0), Math.abs(u1)) < 1 - 1e-9;
      // main-barrel courses: across X, from each bay line in to the groins
      for (const sg of [-1, 1]) {
        const ze = zm + sg * hz, g = (u: number) => zm + sg * hz * Math.abs(u), pts: Vec3[] = [];
        for (const u of [u0, u1]) for (const zz of [ze, g(u)]) for (const t of [0, WEB]) pts.push([u * XI, vy(Math.abs(u)) + t, zz]);
        const course = hull('stone', pts, o);
        if (!inner) { ps.push(course); continue; }
        const rib: Vec3[] = [];
        for (const u of [u0, u1]) {
          const y = vy(Math.abs(u)), x = u * XI;
          rib.push([x, y, g(u)], [x, y, g(u) + sg * 0.2], [x, y - 0.3, g(u)], [x, y - 0.15, g(u) + sg * 0.2]);
        }
        ps.push(weldParts([course, hull('stone', rib, o)]));
      }
      // cross-barrel courses: across Z, from each clerestory wall in to the groins
      for (const sg of [-1, 1]) {
        const xw = sg * XI, xg = (u: number) => sg * XI * Math.abs(u), pts: Vec3[] = [];
        for (const u of [u0, u1]) for (const xx of [xw, xg(u)]) for (const t of [0, WEB]) pts.push([xx, vy(Math.abs(u)) + t, zm + u * hz]);
        const course = hull('stone', pts, o);
        if (!inner) { ps.push(course); continue; }
        const rib: Vec3[] = [];
        for (const u of [u0, u1]) {
          const y = vy(Math.abs(u)), z = zm + u * hz;
          rib.push([xg(u), y, z], [xg(u) + sg * 0.2, y, z], [xg(u), y - 0.3, z], [xg(u) + sg * 0.2, y - 0.15, z]);
        }
        ps.push(weldParts([course, hull('stone', rib, o)]));
      }
    }
  }
  // transverse ribs on the bay lines, wall ribs against the end walls
  for (let k = 0; k < ZB.length; k++) {
    const zr: Range = k === 0 ? [ZB[0] - 0.3, ZB[0]] : k === ZB.length - 1 ? [ZB[k], ZB[k] + 0.3] : [ZB[k] - 0.2, ZB[k] + 0.2];
    for (let i = 0; i + 1 < st.length; i++) {
      const pts: Vec3[] = [];
      for (const u of [st[i], st[i + 1]]) for (const zz of zr) pts.push([u * XI, vy(Math.abs(u)), zz], [u * XI, vy(Math.abs(u)) - 0.45, zz]);
      ps.push(hull('stone', pts, { tint: DARK }));
    }
  }
  return ps;
}
