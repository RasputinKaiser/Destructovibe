import type { PieceSpec } from '../../../types.ts';
import { block, place, prism, raise, splitRange, wallRun, weldParts, type Range } from '../../../levels/kit.ts';
import { boards, curtainBay, floorSlab, wallSlab, withDetail } from '../../../levels/layers.ts';
import { fit, sofa, table } from '../../../levels/interior.ts';
import { conduit, emergencyLamp, hvacUnit, lamp, lift, LIGHT, standbySet, supplyBox } from '../../../levels/services.ts';
import { finish, type Placement } from '../../../levels/architecture/common.ts';

/* Modern residential tower, 34 storeys + crown and spire (~150 m). A cast-in-place RC core (lift, risers) and
   sixteen perimeter columns carry 250 mm post-tensioned flat slabs; a unitised curtain wall hangs off the slab
   edges storey by storey. The frame is real at every level (columns, core, slabs, curtain units are bodies), and
   what each member is made of rides on it as detail: the slabs' finish, screed, cast bays and banded tendons, the
   curtain units' mullions, transoms, spandrel and double glazing. A double-height glazed lobby at the foot, an
   open crown of fins round the plant deck, a steel spire with an aircraft beacon. Front (lobby entrance) +Z. */

const E = 15, CORE = 5.2, CW = 0.4, SLAB = 0.25, LOBBY = 6, H = 3.5, N = 34;
const COLS = [-14.5, -7.5, 0, 7.5, 14.5];
const CON = 0xcfcfca, GLASS = 0x9fc3d6, FRAME = 0x5d6a74;
/** top of the floor at level k (0 = lobby floor on its raft) */
const lvl = (k: number) => (k === 0 ? 0.3 : 0.3 + LOBBY + (k - 1) * H);

/** 250 mm PT flat slab: vinyl, 50 mm screed, cast bays with banded tendons in the construction joints between them. */
function ptSlab(x: Range, z: Range, y: Range): PieceSpec {
  const s = floorSlab(x, z, y), t = y[1] - y[0];
  const d: PieceSpec[] = [
    ...boards(s, [y[1] - 0.003, y[1]], 'pvc', [2, 2], 0.001, { tint: 0x8c8f8a, density: 1400 }),
    ...boards(s, [y[1] - 0.053, y[1] - 0.003], 'concrete', [2.4, 2.4], 0, { tint: 0xc4bfb3 }),
    ...boards(s, [y[0], y[1] - 0.053], 'rconcrete', [1.5, 1.5], 0.03, { tint: CON }),
  ];
  const ym = y[0] + (t - 0.053) / 2;
  for (let zz = Math.ceil(z[0] / 1.5) * 1.5; zz < z[1] - 0.05; zz += 1.5) {
    if (zz > z[0] + 0.05) d.push(block('steel', [x[0] + 0.02, x[1] - 0.02], [ym - 0.01, ym + 0.01], [zz - 0.01, zz + 0.01], { tint: 0x3a3d40 }));
  }
  return withDetail(block('rconcrete', x, y, z, { tint: CON }), d);
}

/** One storey of unitised curtain wall on a face: a hung panel whose 1.5 m units are its detail. */
function curtain(axis: 'x' | 'z', along: Range, face: Range, y: Range, sill: number, out: 1 | -1): PieceSpec {
  const units: PieceSpec[] = [];
  for (const u of splitRange(along[0], along[1], 1.5)) {
    const q = curtainBay(wallSlab(axis, u, y, face, out), { tint: GLASS, frame: FRAME, sill });
    units.push(...(q.detail ?? []));
  }
  const p = axis === 'x' ? block('tempered', along, y, face, { tint: GLASS }) : block('tempered', face, y, along, { tint: GLASS });
  return withDetail(p, units);
}

function storey(k: number): PieceSpec[] {
  const ps: PieceSpec[] = [], y0 = lvl(k), y1 = lvl(k + 1) - SLAB, con = { tint: CON };
  const cw = k < 12 ? 0.8 : 0.6;
  // perimeter columns on the slab below, under the slab above
  for (const x of COLS) for (const z of COLS) {
    if (Math.abs(x) < 14 && Math.abs(z) < 14) continue;
    const cx = Math.sign(x) * Math.min(Math.abs(x), E - 0.1 - cw / 2), cz = Math.sign(z) * Math.min(Math.abs(z), E - 0.1 - cw / 2);
    ps.push(block('rconcrete', [cx - cw / 2, cx + cw / 2], [y0, y1], [cz - cw / 2, cz + cw / 2], con));
  }
  // core: continuous through the slab zone, a lift-lobby door on the south face
  const cy: Range = [k === 0 ? y0 : y0 - SLAB, y1];
  ps.push(block('rconcrete', [-CORE, CORE], cy, [CORE - CW, CORE], con), block('rconcrete', [-CORE, -CORE + CW], cy, [-CORE + CW, CORE - CW], con), block('rconcrete', [CORE - CW, CORE], cy, [-CORE + CW, CORE - CW], con));
  ps.push(...wallRun({ mat: 'rconcrete', from: -CORE, to: CORE, at: -CORE + CW / 2, t: CW, y0: cy[0], h: cy[1] - cy[0], maxW: 11, tint: CON,
    openings: [{ c: 0, w: 1.2, y0: k === 0 ? 0 : SLAB, h: 2.2, glass: false }] }));
  // slab above, round the core
  const cuts = [-E, -CORE, CORE, E];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) ps.push(ptSlab([cuts[i], cuts[i + 1]], [cuts[j], cuts[j + 1]], [y1, y1 + SLAB]));
  // curtain wall hung off the slab edges, spanning from this floor's slab zone to the next
  const cy2: Range = [y0 - SLAB, y1], sill = k === 0 ? 0.35 : SLAB + 0.9;
  if (k > 0) {
    for (const s of [-1, 1] as const) {
      ps.push(curtain('x', [-E - 0.1, E + 0.1], s > 0 ? [E, E + 0.1] : [-E - 0.1, -E], cy2, sill, s));
      ps.push(curtain('z', [-E, E], s > 0 ? [E, E + 0.1] : [-E - 0.1, -E], cy2, sill, s));
    }
  }
  return ps;
}

function lobby(): PieceSpec[] {
  const ps: PieceSpec[] = [], y: Range = [0, 0.3];
  // raft floor in bays round the core, and the core's own floor
  const cuts = [-E - 0.1, -CORE, CORE, E + 0.1];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ps.push(block('concrete', [cuts[i], cuts[i + 1]], y, [cuts[j], cuts[j + 1]], { tint: 0xd9d4ca }));
  // full-height storefront glazing on the raft edge; the entrance leaves 6 m of the south face open under a canopy
  const gy: Range = [0.3, lvl(1) - SLAB];
  const glaze = (x: Range, z: Range) => ps.push(block('tempered', x, gy, z, { tint: GLASS }));
  glaze([-E - 0.1, -3], [E, E + 0.1]); glaze([3, E + 0.1], [E, E + 0.1]); glaze([-E - 0.1, E + 0.1], [-E - 0.1, -E]);
  glaze([E, E + 0.1], [-E, E]); glaze([-E - 0.1, -E], [-E, E]);
  ps.push(block('steel', [-4.5, 4.5], [4.3, 4.55], [E + 0.1, E + 3.2], { tint: FRAME }), block('glass', [-4.4, 4.4], [4.55, 4.61], [E + 0.2, E + 3.1], { tint: GLASS }));
  for (const x of [-4.2, 4.2]) ps.push(prism('steel', 0.2, [0.3, 4.3], x, E + 2.9, 8, { tint: FRAME }));
  // reception desk, sofas, a table; a supply cabinet in the core feeding the lobby lights on its wall
  ps.push(block('stone', [-2.0, 2.0], [0.3, 1.4], [8.0, 8.8], { tint: 0x2f3134 }));
  for (const [x, z, q] of [[-9, 9, 2], [9, 9, 2], [-9, 4, 0], [9, 4, 0]] as [number, number, number][]) ps.push(...fit(sofa(2.2), x, z, 0.3, q));
  ps.push(...fit(table(1.2, 0.7), -9, 6.5, 0.3), ...fit(table(1.2, 0.7), 9, 6.5, 0.3));
  ps.push(supplyBox([-1.0, 1.0], [0.3, 2.1], [CORE, CORE + 0.4]));
  // the lobby lights are maintained emergency fittings; a standby set in the core takes the lobby bus if the supply fails
  for (const x of [-3, 3]) ps.push(emergencyLamp([x - 0.3, x + 0.3], [5.2, 5.5], [CORE, CORE + 0.3], LIGHT.cool));
  ps.push(standbySet([3.4, 4.4], [0.3, 1.5], [CORE, CORE + 0.6]), ...conduit([[3.9, 1.5, CORE + 0.15], [3.9, 5.54, CORE + 0.15], [3.3, 5.54, CORE + 0.15]]));
  ps.push(block('steel', [-3.3, 3.3], [5.5, 5.58], [CORE, CORE + 0.3], { tint: 0x34383c, util: 'power' }), block('steel', [-0.08, 0.08], [2.1, 5.5], [CORE + 0.1, CORE + 0.3], { tint: 0x34383c, util: 'power' }));
  return ps;
}

function crown(): PieceSpec[] {
  const ps: PieceSpec[] = [], roof = lvl(N), con = { tint: CON }, alu = { tint: 0xd9dde0 };
  // the core rises two more storeys as the plant room; the roof deck carries the air handlers
  const cr: Range = [roof - SLAB, roof + 7];
  ps.push(block('rconcrete', [-CORE, CORE], cr, [CORE - CW, CORE], con), block('rconcrete', [-CORE, CORE], cr, [-CORE, -CORE + CW], con));
  ps.push(block('rconcrete', [-CORE, -CORE + CW], cr, [-CORE + CW, CORE - CW], con), block('rconcrete', [CORE - CW, CORE], cr, [-CORE + CW, CORE - CW], con));
  ps.push(block('rconcrete', [-CORE, CORE], [roof + 7, roof + 7.4], [-CORE, CORE], con));
  for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]] as [number, number][]) {
    ps.push(...raise(place(hvacUnit(), x, z), roof), supplyBox([x + 1.1, x + 1.6], [roof, roof + 0.7], [z - 0.3, z + 0.3]));
  }
  // glass balustrade on the roof edge
  for (const s of [-1, 1]) {
    ps.push(block('tempered', [-E - 0.1, E + 0.1], [roof, roof + 1.1], s > 0 ? [E - 0.1, E] : [-E, -E + 0.1], { tint: GLASS }));
    ps.push(block('tempered', s > 0 ? [E - 0.1, E] : [-E, -E + 0.1], [roof, roof + 1.1], [-E + 0.1, E - 0.1], { tint: GLASS }));
  }
  // crown: an L of tall aluminium fins standing in each corner of the roof
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const r = (a: number, b: number): Range => (sx > 0 ? [a, b] : [-b, -a]), q = (a: number, b: number): Range => (sz > 0 ? [a, b] : [-b, -a]);
    ps.push(weldParts([block('aluminum', r(E - 6, E - 0.4), [roof, roof + 9], q(E - 0.7, E - 0.4), alu), block('aluminum', r(E - 0.7, E - 0.4), [roof, roof + 9], q(E - 6, E - 0.7), alu)]));
  }
  // steel spire on the core roof, an aircraft warning beacon at its tip
  // the mast carries the beacon's feed from a cabinet at its foot
  let y = roof + 7.4;
  for (const [d, h] of [[1.4, 7], [0.9, 7], [0.45, 6]]) { ps.push(prism('steel', d, [y, y + h], 0, 0, 8, { tint: 0xb8bec4, util: 'power' })); y += h; }
  ps.push(lamp([-0.2, 0.2], [y, y + 0.4], [-0.2, 0.2], LIGHT.beacon));
  ps.push(supplyBox([-0.5, 0.5], [roof + 7.4, roof + 8.4], [-1.5, -0.7]));
  return ps;
}

/** 34-storey RC-core residential tower with unitised curtain wall, crown and spire (~150 m, front +Z). */
export function residentialTower(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [...lobby()];
  for (let k = 0; k < N; k++) ps.push(...storey(k));
  ps.push(...crown());
  // a lift in the core against its north wall, wound from the plant room
  ps.push(...place(lift(0.3, lvl(N - 1) - 0.3, { tint: 0x9aa2a8 }), 0, CORE - CW, 2));
  ps.push(supplyBox([0.75, 1.35], [0.3, 1.5], [CORE - CW - 0.4, CORE - CW]), block('steel', [0.08, 0.75], [1.3, 1.38], [CORE - CW - 0.08, CORE - CW], { tint: 0x34383c, util: 'power' }));
  return finish(ps, p, 'tower');
}
