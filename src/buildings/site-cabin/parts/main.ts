import type { PieceSpec } from '../../../types.ts';
import { block, weldParts, type Range } from '../../../levels/kit.ts';
import { withDetail } from '../../../levels/layers.ts';
import type { Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/clearance-helpers.ts';

/** Site cabin: a 20 ft steel container office (6 × 2.4 m) on timber sleepers, with a window and door in its long side
    (+Z) and a galvanised step unit at the door. One body; up close it is its corner posts, top and bottom rails, corrugated side and end panels, roof sheet
    and floor. */
export function siteCabin(p: Placement & { tint?: number }): PieceSpec[] {
  const tint = p.tint ?? 0x3f6f9a;
  const X: Range = [-3, 3], Y: Range = [0.15, 2.75], Z: Range = [-1.2, 1.2];
  const box = block('metal', X, Y, Z, { tint });
  const d: PieceSpec[] = [];
  const unit = (x: Range, y: Range, z: Range, t: number, mat: 'steel' | 'metal' | 'plywood' = 'steel', rho?: number) => {
    const q = block(mat, x, y, z); q.tint = t; q.finish = mat === 'plywood' ? undefined : 'paint'; if (rho) q.density = rho; d.push(q);
  };
  const c = 0.12, dark = 0x2a2d30;
  for (const x of [[X[0], X[0] + c], [X[1] - c, X[1]]] as Range[]) for (const z of [[Z[0], Z[0] + c], [Z[1] - c, Z[1]]] as Range[]) unit(x, Y, z, dark, 'steel', 1500);
  const xi: Range = [X[0] + c, X[1] - c], zi: Range = [Z[0] + c, Z[1] - c];
  const rails: Range[] = [[Y[0], Y[0] + c], [Y[1] - c, Y[1]]];
  for (const y of rails) {
    for (const z of [[Z[0], Z[0] + c], [Z[1] - c, Z[1]]] as Range[]) unit(xi, y, z, tint, 'steel', 1500);
    for (const x of [[X[0], X[0] + c], [X[1] - c, X[1]]] as Range[]) unit(x, y, zi, tint, 'steel', 1500);
  }
  const wy: Range = [Y[0] + c, Y[1] - c];
  // corrugated panels: 2 mm sheet (drawn 13 mm) with trapezoid crowns at 280 mm, cap and webs proud of it
  const panel = (along: Range, face: number, out: 1 | -1, ax: 'x' | 'z') => {
    const tr = (a: number, b: number): Range => { const u = face - out * a, v = face - out * b; return [Math.min(u, v), Math.max(u, v)]; };
    const put3 = (u: Range, y: Range, t: Range, col: number) => (ax === 'x' ? unit(u, y, t, col, 'metal', 1200) : unit(t, y, u, col, 'metal', 1200));
    put3(along, wy, tr(0.047, 0.034), tint);
    for (let a = along[0] + 0.14; a < along[1] - 0.05; a += 0.28) {
      put3([a - 0.06, a - 0.05], wy, tr(0.034, 0), tint);
      put3([a - 0.05, a + 0.05], wy, tr(0.0115, 0), tint);
      put3([a + 0.05, a + 0.06], wy, tr(0.034, 0), tint);
    }
  };
  panel(xi, Z[1], 1, 'x');
  panel(xi, Z[0], -1, 'x');
  panel(zi, X[1], 1, 'z');
  // the container's own cargo doors at the -X end: two leaves, four locking bars with their cams and handles
  {
    const face = X[0], dz = (a: number, b: number): Range => [face + a, face + b];
    const mid = (zi[0] + zi[1]) / 2;
    for (const leaf of [[zi[0], mid - 0.003], [mid + 0.003, zi[1]]] as Range[]) {
      unit(dz(0.02, 0.047), wy, leaf, tint, 'metal', 1200);
      for (const bz of [leaf[0] + 0.25, leaf[1] - 0.25]) unit(dz(0.0, 0.02), [wy[0] + 0.05, wy[1] - 0.05], [bz - 0.015, bz + 0.015], 0x3c4246, 'steel', 7850);
    }
    unit(dz(0.02, 0.047), wy, [mid - 0.003, mid + 0.003], dark, 'steel', 1200);
  }
  unit(xi, [Y[1] - 0.05, Y[1]], zi, tint, 'steel', 1500);
  unit(xi, [Y[0], Y[0] + 0.03], zi, 0x9c7d52, 'plywood');
  const cabin = withDetail(box, d);
  cabin.density = 180;
  return put([
    block('wood', [-2.6, -2.3], [0, 0.15], [-1.2, 1.2], { tint: 0x7a5c3e }), block('wood', [2.3, 2.6], [0, 0.15], [-1.2, 1.2], { tint: 0x7a5c3e }),
    cabin,
    block('tempered', [-1.8, -0.4], [1.1, 2.1], [1.2, 1.26]),
    steelDoor([1.2, 2.1], [0.2, 2.3], [1.2, 1.26]),
    // a galvanised two-riser step unit standing on the ground in front of the door, its top tread at the sill
    { ...weldParts([block('steel', [1.05, 2.25], [0, 0.1], [1.265, 1.87]), block('steel', [1.05, 2.25], [0.1, 0.195], [1.265, 1.57])], { tint: 0x9aa1a6, finish: 'galv' }), density: 900 },
  ], p, 'cabins');
}

/** Steel security door on the cabin's long side: leaf, frame, kick plate and a lever handle, one body. */
function steelDoor(x: Range, y: Range, z: Range): PieceSpec {
  const p = block('steel', x, y, z, { tint: 0x4d565c, finish: 'paint' });
  const c = (xr: Range, yr: Range, zr: Range, tint: number) => { const q = block('steel', xr, yr, zr); q.tint = tint; q.finish = 'paint'; return q; };
  const f = 0.05, zm: Range = [z[0], z[1] - 0.02];
  return withDetail(p, [
    c([x[0], x[0] + f], y, z, 0x2f3438), c([x[1] - f, x[1]], y, z, 0x2f3438), c([x[0] + f, x[1] - f], [y[1] - f, y[1]], z, 0x2f3438),
    c([x[0] + f, x[1] - f], [y[0], y[0] + 0.25], z, 0x9aa1a6),
    c([x[0] + f, x[1] - f], [y[0] + 0.25, y[1] - f], zm, 0x4d565c),
    c([x[1] - 0.2, x[1] - 0.08], [y[0] + 1.0, y[0] + 1.04], [z[1] - 0.02, z[1]], 0xb8bcbe),
  ]);
}
