import type { MechMotor, PieceSpec, Vec3, VehicleModel } from '../types.ts';
import { MACHINE_KG, MATS, envelopeVolume } from '../destruction/materials.ts';
import { block, chamfer, cyl, extrude, hull, hullVolume, loft, place, prism, raise, ringCourse, rod, splitRange, tag, tankX, vessel, weldParts, type PieceOpts, type Range } from './kit.ts';
import { partsVolume } from '../destruction/compound.ts';
import { conduit, disc, lamp, LIGHT, pipe, SVC } from './services.ts';
import type { Placement } from './structures.ts';

/* Machines, plant and vehicles. Authored like structures (local metres, front +Z; road vehicles point +X) and dropped
   with place(). Every moving part is one noWeld piece on a hinge or slider; a part that rides on another moving part is
   hosted by it directly, so a chain (slew -> boom -> stick -> bucket) moves as one. Moving parts keep >= 0.06 m from
   every body they do not ride on, including their resting host: while it rests the joint is anchored to the world and
   the host is just another body to collide with.

   Grid-powered machines take their supply through an isolator panel standing on the floor. `feed: 'local'` (the
   default, for prefabs) makes that panel the machine's own supply; `feed: 'grid'` leaves a plain live member for a
   site cable to reach, so cutting the cable stops the machine. Mobile plant runs from its own engine. */

export type Feed = 'local' | 'grid';
export type MachinePlacement = Placement & { feed?: Feed };

const YEL = 0xe8b82a, DARK = 0x2f3336, RUBBER = 0x2a2a2a, GREY = 0x8d949b, ORANGE = 0xd9731e, IRON = 0x3c4044, CON = 0x9a9a96;
/** isolator panels carry this tint so a site grid can find a machine's power entry */
export const ISO_TINT = 0x5e7e59;

/** lowest vertex of a 16-gon disc sits r * cos(pi / 16) below its centre */
const R16 = Math.cos(Math.PI / 16);

type Motor = MechMotor;
type Cycle = NonNullable<NonNullable<PieceSpec['mech']>['cycle']>;
type Limits = { lower?: number; upper?: number; motor?: Motor; brake?: number; drivenBy?: NonNullable<PieceSpec['mech']>['drivenBy']; cycle?: Cycle };

function put(ps: PieceSpec[], p: Placement, fallback: string): PieceSpec[] {
  return tag(place(ps, p.x, p.z, p.rot ?? 0), { group: p.group ?? fallback });
}

function joint(kind: 'hinge' | 'slider', p: PieceSpec, at: Vec3, axis: Vec3, o: Limits = {}): PieceSpec {
  p.noWeld = true;
  p.mech = { kind, at, axis, ...o };
  return p;
}
const hinge = (p: PieceSpec, at: Vec3, axis: Vec3, o: Limits = {}) => joint('hinge', p, at, axis, o);
const slider = (p: PieceSpec, at: Vec3, axis: Vec3, o: Limits = {}) => joint('slider', p, at, axis, o);
/** rigidly carried by a moving part (a cab on a slewing house, forks on a carriage) */
const locked = (p: PieceSpec, at: Vec3) => joint('hinge', p, at, [0, 1, 0], { lower: 0, upper: 0 });
/** Grid induction gearmotor (runs while its host is live or welded to a live motor fixture): rated output speed (rad/s or m/s) and power; stalls at 2.5× rated torque, trips on overload */
const gearmotor = (speed: number, kW: number, shuttle = false, rpm?: number): Motor => ({ speed, force: 0, kW, ...(rpm ? { rpm } : {}), ...(shuttle ? { shuttle } : {}) });
/** Engine-driven hydraulic cylinder (bore, rod m; relief bar; pump flow L/min), acting through `arm` m on a hinge. */
const ram = (bore: number, rod: number, bar: number, lpm: number, o: Partial<Motor> = {}): Motor =>
  ({ speed: 1, force: 0, drive: 'hydraulic', bore, rod, bar, lpm, always: true, shuttle: true, ...o });
/** Engine-driven hydraulic slew / drum motor, rated as output torque (N·m) at relief and output speed (rad/s). */
function hydroMotor(torque: number, speed: number, bar: number, o: Partial<Motor> = {}): Motor {
  const cc = (2 * Math.PI * torque) / (bar * 1e5) * 1e6;
  return { speed, force: 0, drive: 'hydraulic', bar, cc, lpm: (speed * cc) / (2 * Math.PI) * 0.06, always: true, ...o };
}

/** Parking brake on one wheel that locks it on its share of the vehicle: about a quarter of the weight at the tyre. */
const park = (kg: number, r: number): number => Math.round(0.25 * kg * 9.81 * r);

const vol = (q: PieceSpec): number => (q.parts ? partsVolume(q.parts) : q.shape === 'hull' && q.verts ? hullVolume(q.verts) : envelopeVolume(q));

/** Real in-service weight: wheels at their own mass, glazing at its real 5 mm, everything else pro rata. */
function weigh(ps: PieceSpec[], kg: number, wheel = 0): PieceSpec[] {
  let fixed = 0, m = 0;
  const rest: PieceSpec[] = [];
  for (const q of ps) {
    const v = vol(q);
    if ((q.mech?.crr !== undefined || q.wheel) && wheel > 0) { q.density = Math.round(wheel / v); fixed += wheel; }
    else if (q.mat === 'tempered') { q.density = 210; fixed += 210 * v; }
    else { rest.push(q); m += v * (q.density ?? MATS[q.mat].density); }
  }
  const k = (kg - fixed) / m;
  for (const q of rest) q.density = Math.round((q.density ?? MATS[q.mat].density) * k);
  return ps;
}

/** Hollow bodies (car shells, box vans, a loaded drum) weigh what they really weigh, not their material's solid density. */
function kg(ps: PieceSpec[], density: Partial<Record<PieceSpec['mat'], number>>): PieceSpec[] {
  for (const q of ps) { const d = density[q.mat]; if (d !== undefined && q.density === undefined) q.density = d; }
  return ps;
}

/* A grid-fed isolator is a switch-fuse: a fault on the machine blows it, not the substation. */
function isolator(x: Range, z: Range, feed: Feed = 'local', h = 1.4): PieceSpec {
  const p = block('machine', x, [0, h], z, { tint: ISO_TINT, finish: 'satin', ...(feed === 'grid' ? { util: 'power' as const } : { fixture: 'transformer' as const }) });
  if (feed === 'grid') p.svcPart = 'fuse';
  return p;
}

/** Motor in the given box: a round frame along its longest side with flats on the box faces (so it beds and takes its
    leads where the box did) and end bells. */
function motorBox(x: Range, y: Range, z: Range): PieceSpec {
  const r = [x, y, z], e = r.map((q) => q[1] - q[0]), k = e.indexOf(Math.max(...e)), u = (k + 1) % 3, v = (k + 2) % 3;
  const bell = Math.min(0.08, 0.15 * e[k]), pts: Vec3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) * Math.PI) / 6, cu = Math.cos(a) / Math.cos(Math.PI / 12), cv = Math.sin(a) / Math.cos(Math.PI / 12);
    for (const [t, sc] of [[r[k][0], 0.8], [r[k][0] + bell, 1], [r[k][1] - bell, 1], [r[k][1], 0.8]]) {
      const q: Vec3 = [0, 0, 0];
      q[k] = t;
      q[u] = (r[u][0] + r[u][1]) / 2 + (sc * cu * e[u]) / 2;
      q[v] = (r[v][0] + r[v][1]) / 2 + (sc * cv * e[v]) / 2;
      pts.push(q);
    }
  }
  return hull('machine', pts, { tint: SVC.motor, fixture: 'motor', finish: 'satin' });
}

/** Power lead between two live members that move relative to each other (a festoon or drag-chain cable). */
function lead(from: PieceSpec, to: PieceSpec, slack = 1.2): void {
  from.ropeTo = { end: [...to.pos], slack, strength: 4e3, kind: 'wire' };
}

/* ---------------- wheels & parking ---------------- */

/* Road wheel on an axle along Z, hosted by the member whose side face is at |z| = face: pneumatic tyre (μ 0.9, rolling
   resistance 0.012 car / 0.008 truck) and, on a braked axle, the parking brake. A parked vehicle stands on its wheels,
   brakes on, and sleeps until something shoves it harder than the tyres grip. */
function roadWheel(x: number, side: 1 | -1, face: number, r: number, t: number, mat: 'steel' | 'machine', brake: number): PieceSpec {
  const cy = r * R16 + 0.002;
  const w = disc(mat, 'z', [x, cy, side * (face + 0.07 + t / 2)], r, t, { tint: RUBBER, finish: 'rubber' });
  hinge(w, [x, cy, side * (face - 0.01)], [0, 0, 1], brake > 0 ? { brake } : {});
  w.mech!.crr = r > 0.4 ? 0.008 : 0.012;
  w.friction = 0.9;
  return w;
}

function axle(x: number, face: number, r: number, t: number, mat: 'steel' | 'machine' = 'steel', brake = 0): PieceSpec[] {
  return [roadWheel(x, 1, face, r, t, mat, brake), roadWheel(x, -1, face, r, t, mat, brake)];
}

type WheelRole = NonNullable<PieceSpec['wheel']>;
/* Road-vehicle axle: the wheels are carried by the vehicle runtime (raycast suspension and tyres), not by hinges. */
function vaxle(x: number, face: number, r: number, t: number, mat: 'steel' | 'machine', role: WheelRole): PieceSpec[] {
  return ([1, -1] as const).map((s) => {
    const w = disc(mat, 'z', [x, r * R16 + 0.002, s * (face + 0.07 + t / 2)], r, t, { tint: RUBBER, finish: 'rubber' });
    w.noWeld = true;
    w.friction = 0.9;
    w.wheel = { ...role, crr: r > 0.4 ? 0.008 : 0.012 };
    return w;
  });
}

/** Mark the chassis member (the first piece matching `is`) as the vehicle and optional component roles by reference. */
function vehicle<T extends PieceSpec[]>(ps: T, model: VehicleModel, chassis: PieceSpec): T {
  chassis.vehicle = { model };
  return ps;
}
const crumple = (...ps: PieceSpec[]): void => { for (const q of ps) q.vpart = 'crumple'; };

/* ---------------- road vehicles (+X forward) ---------------- */

const TRIM: PieceOpts = { tint: 0x26282b, finish: 'satin' };
const BRIGHT: PieceOpts = { tint: 0xc9cdd1, finish: 'chrome' };
const PRIVACY: PieceOpts = { tint: 0x303438, finish: 'smoked' };
const SEAT: PieceOpts = { tint: 0x33363a };
const paint = (tint: number): PieceOpts => ({ tint, finish: 'paint' });
/** z-mirrored pair built by f(side) */
const pair = (f: (s: 1 | -1) => PieceSpec): PieceSpec[] => [f(1), f(-1)];
/** side profile [x, y] extruded across z */
const across = (mat: PieceSpec['mat'], prof: [number, number][], z: Range, o: PieceOpts = {}): PieceSpec =>
  hull(mat, prof.flatMap(([x, y]) => z.map((zz) => [x, y, zz] as Vec3)), o);
/** raked screen or pane: foot [x0, x1] at y0, head [x0, x1] at y1, half-widths at foot and head */
const pane = (foot: Range, y0: number, head: Range, y1: number, w0: number, w1: number, o: PieceOpts = { finish: 'smoked' }): PieceSpec =>
  hull('tempered', [...foot.flatMap((x) => [-w0, w0].map((z) => [x, y0, z] as Vec3)), ...head.flatMap((x) => [-w1, w1].map((z) => [x, y1, z] as Vec3))], o);
/** one side's glazing, tumbled in: foot [x0, x1] at y0 across z0, head [x0, x1] at y1 across z1 */
const sideGlass = (s: 1 | -1, foot: Range, y0: number, z0: Range, head: Range, y1: number, z1: Range, o: PieceOpts = { finish: 'smoked' }): PieceSpec =>
  hull('tempered', [...foot.flatMap((x) => z0.map((z) => [x, y0, s * z] as Vec3)), ...head.flatMap((x) => z1.map((z) => [x, y1, s * z] as Vec3))], o);
/** door mirror on a stalk from the belt at y, root across z [z0, z0 + 0.05] */
const mirror = (s: 1 | -1, x: Range, y: number, z0: number, o: PieceOpts): PieceSpec => hull('metal', [
  ...x.flatMap((xx) => [[xx, y, s * z0], [xx, y, s * (z0 + 0.05)]] as Vec3[]),
  ...[x[0] + 0.02, x[1] - 0.02].flatMap((xx) => [[xx, y + 0.05, s * (z0 + 0.1)], [xx, y + 0.15, s * (z0 + 0.08)], [xx, y + 0.05, s * (z0 + 0.24)], [xx, y + 0.16, s * (z0 + 0.24)]] as Vec3[]),
], o);
/** headlamp pair on a front face at x, across [z0, z1] */
const headlamps = (x: number, y: Range, z: Range): PieceSpec[] => pair((s) => block('lamp', [x, x + 0.05], y, s > 0 ? z : [-z[1], -z[0]], { tint: 0xf4f2e8 }));

/* Saloon shell, +X forward, around 0.3 m wheels on axles at x = ±1.3 whose inner faces clear |z| = 0.8 by 0.07. A floor pan
   carries the hubs; sills and doors fill between the arches; bonnet, boot and bumpers sit over and beyond them, 0.07
   clear of the tyres, so the arches read as cut-outs. The glass house (raked screens, tumbled-in side glass) stands on
   the belt and carries a crowned roof; the front seats stand on the pan. */
export function saloonShell(tint: number, road = false): PieceSpec[] {
  const b = paint(tint), belt = 0.98, eave = 1.38;
  const wing: [number, number][] = [[0, 0.67], [1.08, 0.67], [1.08, 0.78], [1.06, 0.86], [1.03, belt], [0, belt]];
  const bumper: [number, number][] = [[0, 0.28], [1.0, 0.3], [1.02, 0.45], [1.02, 0.67], [0, 0.67]];
  const bonnet = loft('metal', [[0.93, wing], [1.6, [[1.07, 0.67], [1.07, 0.84], [1.0, 0.92], [0, 0.94]]], [2.02, [[0.92, 0.67], [0.95, 0.76], [0.85, 0.8], [0, 0.81]]]], b);
  const front = loft('pvc', [[1.67, bumper], [2.0, [[0, 0.27], [0.96, 0.3], [0.98, 0.67], [0, 0.67]]], [2.12, [[0, 0.36], [0.82, 0.38], [0.84, 0.64], [0, 0.64]]]], BRIGHT);
  const boot = loft('metal', [[-0.93, wing], [-1.55, [[1.07, 0.67], [1.07, 0.86], [1.03, belt], [0, belt]]], [-2.02, [[0.94, 0.67], [0.97, 0.8], [0.9, 0.92], [0, 0.93]]]], b);
  const rear = loft('pvc', [[-1.67, bumper], [-2.02, [[0, 0.29], [0.96, 0.31], [0.98, 0.67], [0, 0.67]]], [-2.1, [[0, 0.34], [0.86, 0.36], [0.88, 0.62], [0, 0.62]]]], BRIGHT);
  const screen = pane([0.8, 0.93], belt, [0.12, 0.25], eave, 1.0, 0.86);
  const lamps = headlamps(2.12, [0.52, 0.62], [0.5, 0.78]);
  /* on the road the floor stops short of the crumple zones, which ride on it and fold back into that space */
  const pan = block('steel', road ? [-1.35, 1.35] : [-1.67, 1.67], [0.25, 0.67], [-0.8, 0.8], { tint: 0x2a2c2e });
  if (road) { crumple(bonnet, front, boot, rear, ...lamps); screen.vpart = 'windscreen'; }
  return [
    pan,
    ...pair((s) => extrude('metal', ([[0.8, 0.3], [1.0, 0.3], [1.07, 0.4], [1.08, 0.62], [1.06, 0.86], [1.03, belt], [0.8, belt]] as [number, number][])
      .map(([z, y]) => [s * z, y] as [number, number]), 'x', [-0.93, 0.93], b)),
    bonnet, front, boot, rear, screen,
    pane([-1.25, -1.12], belt, [-0.72, -0.6], eave, 1.0, 0.86, PRIVACY),
    ...pair((s) => sideGlass(s, [-1.1, 0.78], belt, [0.92, 0.98], [-0.58, 0.1], eave, [0.78, 0.84])),
    loft('metal', [[0.27, [[0.86, eave], [0.84, 1.42], [0, 1.44]]], [0.14, [[0.88, eave], [0.86, 1.445], [0.6, 1.47], [0, 1.48]]],
      [-0.62, [[0.88, eave], [0.86, 1.445], [0.6, 1.47], [0, 1.48]]], [-0.74, [[0.86, eave], [0.8, 1.43], [0, 1.45]]]], b),
    across('plywood', [[-0.2, 0.67], [0.45, 0.67], [0.45, 0.9], [-0.12, 1.25], [-0.28, 1.25]], [-0.72, 0.72], SEAT),
    ...pair((s) => mirror(s, [0.62, 0.76], belt, 0.99, b)),
    ...lamps,
  ];
}

const SALOON_KG = { steel: 760, metal: 260, pvc: 300, plywood: 150 };

export function car(p: Placement & { tint?: number }): PieceSpec[] {
  const shell = saloonShell(p.tint ?? 0xb8352c, true);
  return put(weigh(kg(vehicle([
    ...shell,
    ...vaxle(-1.3, 0.8, 0.3, 0.2, 'steel', { park: true }), ...vaxle(1.3, 0.8, 0.3, 0.2, 'steel', { drive: true, steer: 1 }),
  ], 'car', shell[0]), SALOON_KG), MACHINE_KG.car, 20), p, 'car');
}

/** A parked saloon with its wheels fixed: tyres bedded on the ground and against the pan (a set piece, not a machine). */
export function parkedSaloon(tint: number): PieceSpec[] {
  const wheels = [-1.3, 1.3].flatMap((x) => pair((s) => disc('steel', 'z', [x, 0.3 * R16, s * 0.935], 0.3, 0.27, { tint: RUBBER, finish: 'rubber' })));
  return weigh(kg([...saloonShell(tint), ...wheels], SALOON_KG), MACHINE_KG.car);
}

/** Panel van shell (wheels 0.34 m on axles at x = ±1.55, inner faces clear of |z| = 0.95): floor pan on the hubs, sills and
    cab doors between the arches, a short bonnet, the load box with rounded roof edges on the sills and rear body, a cab
    roof on the raked screen, cab glass and a seat against the load-box bulkhead. */
export function vanShell(tint: number, road = false): PieceSpec[] {
  const b = paint(tint), belt = 1.2, eave = 2.12;
  const low: [number, number][] = [[0, 0.74], [1.24, 0.74], [1.24, 1.1], [1.22, belt], [0, belt]];
  const box: [number, number][] = [[0, belt], [1.24, belt], [1.24, 2.2], [1.16, 2.38], [0.95, 2.45], [0, 2.46]];
  const bonnet = loft('metal', [[1.14, low], [1.96, [[1.22, 0.74], [1.2, 1.08], [1.1, 1.14], [0, 1.16]]], [2.3, [[1.08, 0.74], [1.1, 0.95], [1.0, 1.02], [0, 1.04]]]], b);
  const front = loft('pvc', [[1.96, [[0, 0.3], [1.2, 0.32], [1.22, 0.5], [1.22, 0.74], [0, 0.74]]], [2.3, [[0, 0.3], [1.1, 0.32], [1.12, 0.74], [0, 0.74]]],
    [2.42, [[0, 0.36], [0.98, 0.38], [1.0, 0.72], [0, 0.72]]]], BRIGHT);
  const rear = loft('pvc', [[-1.96, [[0, 0.3], [1.2, 0.32], [1.22, 0.74], [0, 0.74]]], [-2.45, [[0, 0.3], [1.2, 0.32], [1.22, 0.74], [0, 0.74]]],
    [-2.55, [[0, 0.34], [1.1, 0.36], [1.12, 0.72], [0, 0.72]]]], BRIGHT);
  const screen = pane([1.0, 1.14], belt, [0.62, 0.76], eave, 1.2, 1.14);
  const lamps = headlamps(2.42, [0.56, 0.68], [0.72, 1.0]);
  if (road) { crumple(bonnet, front, rear, ...lamps); screen.vpart = 'windscreen'; }
  return [
    block('steel', road ? [-1.6, 1.6] : [-1.96, 1.96], [0.28, 0.74], [-0.95, 0.95], { tint: 0x2a2c2e }),
    ...pair((s) => extrude('metal', ([[0.95, 0.32], [1.16, 0.32], [1.24, 0.44], [1.24, 1.1], [1.22, belt], [0.95, belt]] as [number, number][])
      .map(([z, y]) => [s * z, y] as [number, number]), 'x', [-1.14, 1.14], b)),
    bonnet, front,
    loft('metal', [[-1.14, low], [-2.45, low]], b),
    rear,
    loft('metal', [[-2.45, box], [-0.2, box]], b),
    screen,
    loft('metal', [[-0.2, [[0, eave], [1.18, eave], [1.18, 2.2], [1.1, 2.38], [0.95, 2.45], [0, 2.46]]], [0.8, [[1.16, eave], [1.1, 2.3], [0, 2.36]]]], b),
    ...pair((s) => sideGlass(s, [-0.18, 0.98], belt, [1.1, 1.16], [-0.18, 0.6], eave, [1.04, 1.1])),
    across('plywood', [[-0.15, 0.74], [0.55, 0.74], [0.55, 1.0], [-0.05, 1.75], [-0.18, 1.75]], [-0.9, 0.9], SEAT),
    ...pair((s) => mirror(s, [0.82, 0.96], belt, 1.17, TRIM)),
    ...lamps,
  ];
}

const VAN_KG = { steel: 600, metal: 150, pvc: 300, plywood: 150 };

export function van(p: Placement & { tint?: number }): PieceSpec[] {
  const shell = vanShell(p.tint ?? 0xf2f2ee, true);
  return put(weigh(kg(vehicle([
    ...shell,
    ...vaxle(-1.55, 0.95, 0.34, 0.22, 'steel', { drive: true, park: true }), ...vaxle(1.55, 0.95, 0.34, 0.22, 'steel', { steer: 1 }),
  ], 'van', shell[0]), VAN_KG), MACHINE_KG.van, 28), p, 'van');
}

export function parkedVan(tint: number): PieceSpec[] {
  const wheels = [-1.55, 1.55].flatMap((x) => pair((s) => disc('steel', 'z', [x, 0.34 * R16, s * 1.095], 0.34, 0.29, { tint: RUBBER, finish: 'rubber' })));
  return weigh(kg([...vanShell(tint), ...wheels], VAN_KG), MACHINE_KG.van);
}

/** Single-deck coach: two chassis rails carry the wheels under a floor with rounded ends; skirts between and beyond
    the arches, the engine bay behind the rear axle, a curved dash and near-upright wrap-round windscreen, glazing
    split by pillars, a crowned roof, rows of seats inside and mirrors on stalks ahead of the screen. */
export function bus(p: Placement & { tint?: number }): PieceSpec[] {
  const b = paint(p.tint ?? 0xb8352c), r = 0.5, fl: Range = [1.06, 1.16], top = 2.6;
  const ends = (x0: number, d: number, y: Range, w = 1.3): [number, [number, number][]][] =>
    [[x0, [[0, y[0]], [w, y[0]], [w, y[1]], [0, y[1]]]], [x0 + d * 0.12, [[w - 0.08, y[0]], [w - 0.08, y[1]]]], [x0 + d * 0.25, [[0, y[0]], [w - 0.3, y[0]], [w - 0.3, y[1]], [0, y[1]]]]];
  const ps: PieceSpec[] = [
    block('steel', [-4.27, 4.47], [0.42, fl[0]], [0.65, 0.95], { tint: DARK }),
    block('steel', [-4.27, 4.47], [0.42, fl[0]], [-0.95, -0.65], { tint: DARK }),
    loft('metal', [...ends(-5.5, -1, fl), ...ends(5.5, 1, fl)], b),
    loft('metal', [[4.47, [[0, 0.45], [1.3, 0.45], [1.3, fl[0]], [0, fl[0]]]], ...ends(5.5, 1, [0.47, fl[0]]).slice(1)], b),
    loft('metal', [[-4.27, [[0, 0.45], [1.3, 0.45], [1.3, fl[0]], [0, fl[0]]]], ...ends(-5.5, -1, [0.47, fl[0]]).slice(1)], b),
    ...pair((s) => extrude('metal', ([[1.1, 0.55], [1.26, 0.55], [1.3, 0.65], [1.3, fl[0]], [1.1, fl[0]]] as [number, number][]).map(([z, y]) => [s * z, y] as [number, number]), 'x', [-3.13, 3.33], b)),
    ...pair((s) => extrude('metal', ([[1.2, fl[1]], [1.3, fl[1]], [1.3, 1.5], [1.28, 1.6], [1.2, 1.6]] as [number, number][]).map(([z, y]) => [s * z, y] as [number, number]), 'x', [-5.5, 5.5], b)),
    loft('metal', ends(5.5, 1, [fl[1], 1.75]), b),
    loft('metal', ends(-5.5, -1, [fl[1], top]), b),
    hull('tempered', [[5.58, 1.75, 0], [5.7, 1.75, 0], [5.5, 1.75, 1.18], [5.58, 1.75, 1.18], [5.5, 1.75, -1.18], [5.58, 1.75, -1.18],
      [5.46, top, 0], [5.58, top, 0], [5.38, top, 1.16], [5.46, top, 1.16], [5.38, top, -1.16], [5.46, top, -1.16]]),
    ...pair((s) => hull('metal', [5.0, 5.5].flatMap((x) => [1.6, top].flatMap((y) => [[x, y, s * 1.2], [x, y, s * 1.3]] as Vec3[])), b)),
    loft('metal', [[-5.74, [[1.0, top], [0.9, 2.68], [0, 2.7]]], [-5.55, [[1.3, top], [1.28, 2.66], [1.1, 2.72], [0, 2.74]]],
      [5.3, [[1.3, top], [1.28, 2.66], [1.1, 2.72], [0, 2.74]]], [5.62, [[1.06, top], [0.95, 2.68], [0, 2.7]]]], { tint: 0xeceae4, finish: 'paint' }),
    ...headlamps(5.75, [0.78, 0.92], [0.6, 0.9]),
    ...pair((s) => hull('metal', [[5.1, 2.3, s * 1.3], [5.25, 2.3, s * 1.3], [5.1, 2.42, s * 1.3], [5.25, 2.42, s * 1.3],
      [5.9, 2.0, s * 1.34], [6.0, 2.0, s * 1.34], [5.9, 2.34, s * 1.34], [6.0, 2.34, s * 1.34], [5.95, 2.0, s * 1.42], [5.95, 2.34, s * 1.42]], TRIM)),
  ];
  const bays: Range[] = [[-5.5, -2.1], [-2.0, 1.4], [1.5, 5.0]];
  for (const s of [1, -1] as const) {
    for (const x of bays) ps.push(sideGlass(s, x, 1.6, [1.22, 1.28], x, top, [1.18, 1.24]));
    for (const x of [[-2.1, -2.0], [1.4, 1.5]] as Range[]) ps.push(sideGlass(s, x, 1.6, [1.2, 1.28], x, top, [1.16, 1.24], b));
    for (const x of [[-4.9, -1.3], [-1.0, 2.6]] as Range[]) {
      ps.push(across('plywood', [[x[0], fl[1]], [x[1], fl[1]], [x[1], 1.6], [x[0] + 0.3, 2.05], [x[0], 2.05]], s > 0 ? [0.3, 1.1] : [-1.1, -0.3], SEAT));
    }
  }
  ps.push(...vaxle(-3.7, 0.95, r, 0.3, 'machine', { drive: true, park: true }), ...vaxle(3.9, 0.95, r, 0.3, 'machine', { steer: 1 }));
  ps[11].vpart = 'windscreen';
  return put(weigh(kg(vehicle(ps, 'bus', ps[0]), { metal: 600, steel: 1350, plywood: 150 }), MACHINE_KG.bus, 110), p, 'bus');
}

/* Cab-over truck cab from x0 (back) to x1 (front) on the deck: lower shell with rounded front corners and a chrome
   grille, raked screen and door glass on the belt, a solid back from x = g, crowned roof (flat on top, for a deflector),
   seat and mirrors. */
function cabOver(x0: number, x1: number, g: number, deck: number, belt: number, eave: number, w: number, b: PieceOpts): PieceSpec[] {
  const rect = (ww: number, y0: number, y1: number): [number, number][] => [[0, y0], [ww, y0], [ww, y1], [0, y1]];
  const crown = (ww: number): [number, number][] => [[ww, eave], [ww - 0.04, eave + 0.13], [ww - 0.19, eave + 0.2], [0, eave + 0.2]];
  return [
    loft('metal', [[x0, rect(w, deck, belt)], [x1 - 0.2, [[w, deck], [w, belt]]], [x1, [[0, deck], [w - 0.19, deck], [w - 0.16, belt], [0, belt]]]], b),
    block('steel', [x1, x1 + 0.05], [deck + 0.15, belt - 0.1], [-w * 0.65, w * 0.65], BRIGHT),
    { ...pane([x1 - 0.15, x1 - 0.03], belt, [x1 - 0.25, x1 - 0.13], eave, w - 0.1, w - 0.14), vpart: 'windscreen' },
    ...pair((s) => sideGlass(s, [g, x1 - 0.17], belt, [w - 0.08, w - 0.02], [g, x1 - 0.27], eave, [w - 0.12, w - 0.06])),
    loft('metal', [[x0, rect(w - 0.06, belt, eave)], [x0 + 0.1, [[w, belt], [w, eave]]], [g, rect(w, belt, eave)]], b),
    loft('metal', [[x0, [[w - 0.06, eave], [w - 0.12, eave + 0.15], [0, eave + 0.2]]], [x0 + 0.1, crown(w)], [x1 - 0.26, crown(w)],
      [x1 - 0.12, [[w - 0.14, eave], [w - 0.24, eave + 0.13], [0, eave + 0.15]]]], b),
    across('plywood', [[g + 0.02, belt], [g + 0.5, belt], [g + 0.5, belt + 0.25], [g + 0.14, belt + 0.6], [g + 0.02, belt + 0.6]], [-w + 0.24, w - 0.24], SEAT),
    ...pair((s) => hull('metal', [...[x1 - 0.35, x1 - 0.23].flatMap((x) => [belt - 0.25, belt - 0.05].map((yy) => [x, yy, s * w] as Vec3)),
      ...[x1 - 0.3, x1 - 0.2].flatMap((x) => [belt + 0.05, belt + 0.65].flatMap((yy) => [[x, yy, s * (w + 0.18)], [x, yy, s * (w + 0.26)]] as Vec3[]))], TRIM)),
  ];
}

/** Rigid box lorry: chassis rails on the hubs, a cab-over with rounded corners, chrome grille, raked screen, sleeper
    back, crowned roof and air deflector; a box body with rounded roof edges, side guards, a fuel tank and a tandem rear
    axle. */
export function lorry(p: Placement & { tint?: number }): PieceSpec[] {
  const b = paint(p.tint ?? 0x3f6f9a), r = 0.5, deck = 1.06, belt = 1.95, eave = 2.85;
  const box = loft('metal', [-4.8, 2.1].map((x) => [x, [[0, deck], [1.25, deck], [1.25, 3.35], [1.18, 3.47], [1.05, 3.5], [0, 3.5]]] as [number, [number, number][]]),
    { tint: 0xd8dcd6, finish: 'paint' });
  box.density = 120;
  const galv: PieceOpts = { finish: 'galv' };
  const guard = (s: 1 | -1, x: Range) => extrude('steel', ([[1.15, 0.5], [1.23, 0.5], [1.23, deck], [1.15, deck]] as [number, number][]).map(([z, y]) => [s * z, y] as [number, number]), 'x', x, galv);
  const frame = block('steel', [-4.8, 3.78], [0.42, deck], [-0.9, 0.9], { tint: DARK, finish: 'satin' });
  return put(weigh(kg(vehicle([
    frame,
    loft('steel', [[3.78, [[0, 0.42], [1.22, 0.42], [1.22, deck], [0, deck]]], [4.2, [[0, 0.45], [1.14, 0.45], [1.16, deck], [0, deck]]],
      [4.3, [[0, 0.55], [1.0, 0.55], [1.0, 1.0], [0, 1.0]]]], BRIGHT),
    ...cabOver(2.3, 4.15, 3.2, deck, belt, eave, 1.24, b),
    across('metal', [[2.45, 3.05], [3.3, 3.05], [2.7, 3.55], [2.45, 3.55]], [-1.0, 1.0], b),
    ...headlamps(4.3, [0.75, 0.9], [0.6, 0.95]),
    box,
    guard(1, [-2.03, 0.9]), guard(-1, [-2.03, 2.62]),
    { ...tankX('steel', [1.0, 2.3], 0.75, 0.9 + 0.18 * Math.cos(Math.PI / 12), 0.18, 0.08, { tint: 0xc9ccce, finish: 'galv' }), vpart: 'fuel' },
    ...vaxle(3.2, 0.9, r, 0.3, 'machine', { steer: 1 }), ...vaxle(-2.6, 0.9, r, 0.3, 'machine', { drive: true, park: true }),
    ...vaxle(-3.7, 0.9, r, 0.3, 'machine', { drive: true, park: true }),
  ], 'lorry', frame), { steel: 600, metal: 250, plywood: 150 }), MACHINE_KG.lorry, 110), p, 'lorry');
}

/* ---------------- construction plant ---------------- */

/** Crawler track frame along Z at x, stadium-profiled: flat on the ground, rounded over the idler and sprocket. */
function trackFrame(x: Range, len: number, h: number, o: PieceOpts): PieceSpec {
  const L = len / 2, prof: [number, number][] = [[-L + 0.4, 0], [L - 0.4, 0], [L - 0.05, 0.22 * h / 0.85], [L, 0.5 * h], [L - 0.15, 0.82 * h], [L - 0.35, h],
    [-L + 0.35, h], [-L + 0.15, 0.82 * h], [-L, 0.5 * h], [-L + 0.05, 0.22 * h / 0.85]];
  return hull('steel', prof.flatMap(([z, y]) => x.map((xx) => [xx, y, z] as Vec3)), o);
}

/** Straight boom or stick from foot to head in the y-z plane across x, a chamfered box section tapering from w0 x d0 to w1 x d1
    (ends square to the arm, or cut plumb). */
function taperedArm(mat: PieceSpec['mat'], xc: number, foot: [number, number], head: [number, number], w: Range, d: Range, o: PieceOpts, plumb = false): PieceSpec {
  const dy = head[0] - foot[0], dz = head[1] - foot[1], l = Math.hypot(dy, dz), n: [number, number] = plumb ? [1, 0] : [dz / l, -dy / l];
  const pts: Vec3[] = [];
  ([[foot, w[0], d[0]], [head, w[1], d[1]]] as [[number, number], number, number][]).forEach(([[yy, zz], ww, dd]) => {
    const c = Math.min(ww, dd) * 0.18;
    for (const [u, v] of [[ww / 2 - c, dd / 2], [ww / 2, dd / 2 - c]] as [number, number][]) {
      for (const su of [-1, 1]) for (const sv of [-1, 1]) pts.push([xc + su * u, yy + sv * v * n[0], zz + sv * v * n[1]]);
    }
  });
  return hull(mat, pts, o);
}

/** Tracked excavator, 20-tonne class (2.4 m track gauge, 5.7 m boom, 2.9 m stick, ~21 t): heavy undercarriage on the
    ground, a house with its curved counterweight and glazed cab slewing to and fro on the ring, and a tapered box boom
    (its ram alongside), stick and toothed bucket each on their own shuttling hydraulic hinge — a slow dig cycle, all
    engine-driven. */
export function excavator(p: Placement): PieceSpec[] {
  const y: PieceOpts = { tint: YEL, finish: 'satin' }, d: PieceOpts = { tint: DARK, finish: 'satin' };
  const ps: PieceSpec[] = [
    trackFrame([-1.5, -0.9], 4.5, 0.85, d), trackFrame([0.9, 1.5], 4.5, 0.85, d),
    chamfer('machine', [-0.9, 0.9], [0.3, 0.8], [-1.1, 1.1], 0.12, d, 'vert'),
    cyl('castiron', 1.6, [0.8, 1.0], 0, 0, { tint: IRON }),
  ];
  /* dig cycle (26 s): boom down with the stick out and the bucket open, drag the stick in and curl the bucket full,
     boom up, slew 50° to the spoil heap, open the bucket over it, slew back. Positive boom angle lowers it, positive
     stick and bucket angles curl them in. */
  const T = 26;
  const house = hinge(chamfer('metal', [-1.35, 1.35], [1.06, 2.1], [-1.45, 0.9], 0.12, y, 'top'), [0, 0.99, 0], [0, 1, 0],
    { lower: -1.1, upper: 1.1, motor: hydroMotor(65e3, 0.3, 280, { tank: 400 }), cycle: { period: T, keys: [[0, 0], [11, 0], [14.5, 0.9], [19.5, 0.9], [23, 0]] } });
  const arc = [-90, -60, -30, 0, 30, 60, 90].map((a) => [1.35 * Math.sin((a * Math.PI) / 180), -1.45 - 0.9 * Math.cos((a * Math.PI) / 180)]);
  const cw = locked(hull('castiron', arc.flatMap(([x, z]) => [[x, 1.06, z], [x, 1.8, z], [x * 0.93, 1.92, -1.45 - (-1.45 - z) * 0.9]] as Vec3[]),
    { tint: 0x161616, finish: 'decal' }), [0, 1.5, -1.4]);
  const at: Vec3 = [-0.85, 2.05, 0.25];
  const cab = locked(chamfer('metal', [-1.35, -0.4], [2.1, 2.5], [-0.4, 0.9], 0.08, y, 'vert'), at);
  const glass = locked(hull('tempered', [[-1.33, 2.5, -0.38], [-0.42, 2.5, -0.38], [-1.33, 2.5, 0.88], [-0.42, 2.5, 0.88],
    [-1.33, 2.95, -0.38], [-0.42, 2.95, -0.38], [-1.33, 2.95, 0.76], [-0.42, 2.95, 0.76]], { finish: 'smoked' }), at);
  const roof = locked(chamfer('metal', [-1.37, -0.38], [2.95, 3.05], [-0.42, 0.8], 0.05, y, 'top'), [-0.85, 2.9, 0.25]);
  // boom foot on the house front at 1.75 m, head 5.6 m out and up
  const boom = hinge(taperedArm('metal', 0.5, [1.775, 0.96], [5.625, 5.0], [0.44, 0.34], [0.55, 0.41], y, true),
    [0.5, 1.75, 0.89], [1, 0, 0], { lower: -0.15, upper: 0.55, motor: ram(0.17, 0.12, 350, 150, { arm: 0.8, shuttle: false }),
      cycle: { period: T, keys: [[0, -0.1], [4, 0.45], [8.5, 0.42], [12, -0.12], [22, -0.12]] } });
  const boomRam = locked(rod('steel', [0.5, 1.2, 1.4], [0.5, 3.27, 2.9], 0.16, { tint: 0xd6d9dc, finish: 'chrome' }), [0.5, 3.43, 2.7]);
  // stick: 2.9 m bar from the boom head down to the bucket pin, beside the boom
  const stick = hinge(taperedArm('metal', 0.95, [5.75, 4.9], [3.05, 5.95], [0.34, 0.28], [0.4, 0.3], y),
    [0.5, 5.62, 4.9], [1, 0, 0], { lower: -0.6, upper: 0.5, motor: ram(0.14, 0.1, 350, 100, { arm: 0.6, shuttle: false }),
      cycle: { period: T, keys: [[0, -0.5], [4, -0.45], [9, 0.3], [15, 0.3], [18, -0.1], [23, -0.5]] } });
  const bucket = hinge(hull('metal', [0.62, 1.28].flatMap((x) => [[x, 2.82, 5.6], [x, 2.82, 6.4], [x, 2.2, 6.6], [x, 1.98, 6.35], [x, 1.93, 6.05], [x, 2.02, 5.75], [x, 2.2, 5.55]] as Vec3[]), d),
    [0.95, 3.05, 5.8], [1, 0, 0], { lower: -0.6, upper: 0.5, motor: ram(0.12, 0.085, 350, 100, { arm: 0.4, shuttle: false }),
      cycle: { period: T, keys: [[0, -0.4], [6.5, -0.3], [9, 0.45], [15, 0.45], [17, -0.55], [19, -0.55], [21.5, -0.4]], dig: 1.0, dump: -0.5 } });
  const teeth = locked(hull('steel', [0.66, 1.24].flatMap((x) => [[x, 2.2, 6.6], [x, 2.314, 6.563], [x, 2.1, 6.82]] as Vec3[]), { tint: IRON }), [0.95, 2.25, 6.45]);
  ps.push(house, cw, cab, glass, roof, boom, boomRam, stick, bucket, teeth);
  house.density = 600;
  cw.density = 2500;
  for (const q of [cab, roof]) q.density = 250;
  boom.density = 1300;
  boomRam.density = 1500;
  stick.density = 1300;
  bucket.density = 1400;
  teeth.density = 1400;
  return put(weigh(kg(ps, { steel: 1500, machine: 1500, castiron: 4000 }), MACHINE_KG.excavator), p, 'excavator');
}

/** Crawler dozer, D6 class (~20 t): tracks, a sloping engine hood with its grille, a ROPS cab on the frame, and a curved
    push blade (three strips, the middle one on the lift) raised and lowered together. */
export function bulldozer(p: Placement): PieceSpec[] {
  const y: PieceOpts = { tint: YEL, finish: 'satin' }, d: PieceOpts = { tint: DARK, finish: 'satin' };
  const strip = (y0: number, y1: number, f0: number, f1: number, o: PieceOpts) =>
    hull('steel', [-1.8, 1.8].flatMap((x) => [[x, y0, 2.0], [x, y1, 2.0], [x, y0, f0], [x, y1, f1]] as Vec3[]), o);
  const blade = slider(strip(0.55, 1.1, 2.22, 2.18, y), [0, 0.9, 1.59], [0, 1, 0], { lower: 0, upper: 0.3, motor: ram(0.155, 0.07, 200, 90, { tank: 400 }) });
  const edge = locked(strip(0.22, 0.55, 2.4, 2.22, d), [0, 0.8, 2.08]), lip = locked(strip(1.1, 1.45, 2.18, 2.34, y), [0, 0.8, 2.08]);
  for (const q of [blade, edge, lip]) q.density = 1330;
  const hood = hull('machine', [
    ...[-0.95, 0.95].flatMap((x) => [[x, 0.3, -1.9], [x, 0.3, 1.6], [x, 1.6, -1.9], [x, 1.38, 1.6]] as Vec3[]),
    ...[-0.85, 0.85].flatMap((x) => [[x, 1.7, -1.9], [x, 1.7, 1.0], [x, 1.45, 1.6]] as Vec3[]),
  ], y);
  return put(weigh(kg([
    trackFrame([-1.5, -0.95], 3.8, 0.9, d), trackFrame([0.95, 1.5], 3.8, 0.9, d),
    hood,
    block('steel', [-0.6, 0.6], [0.55, 1.3], [1.6, 1.66], d),
    chamfer('metal', [-0.9, 0.9], [1.7, 2.05], [-1.9, -0.4], 0.08, y, 'vert'),
    hull('tempered', [-0.86, 0.86].flatMap((x) => [[x, 2.05, -1.86], [x, 2.05, -0.44], [x, 2.9, -1.86], [x, 2.9, -0.54]] as Vec3[]), { finish: 'smoked' }),
    chamfer('metal', [-0.98, 0.98], [2.9, 3.05], [-1.98, -0.42], 0.05, y, 'top'),
    cyl('steel', 0.16, [1.7, 2.6], 0.45, 0.9, { tint: IRON }),
    blade, edge, lip,
  ], { steel: 1700, machine: 1000, metal: 350 }), MACHINE_KG.bulldozer), p, 'bulldozer');
}

/** Rigid site dump truck (~27 t): chassis with a chrome radiator grille, a glazed cab over the front axle beside its
    walkway deck, and a flared body with a raised tail and a canopy over the cab that tips to 50° on its rear pivot. */
export function dumpTruck(p: Placement): PieceSpec[] {
  const y: PieceOpts = { tint: YEL, finish: 'satin' }, r = 0.75;
  const bed = hinge(hull('metal', [1, -1].flatMap((s) => [[-3.3, 1.78, s * 1.1], [-3.0, 1.56, s * 1.1], [1.15, 1.56, s * 1.1], [-3.3, 2.62, s * 1.35], [1.15, 3.17, s * 1.35]] as Vec3[]), y),
    [-3.25, 1.2, 0], [0, 0, 1], { lower: 0, upper: 0.87, motor: ram(0.226, 0.1, 200, 170, { arm: 1.0, tank: 400, shuttle: false }),
      cycle: { period: 60, keys: [[0, 0], [30, 0], [40, 0.85], [46, 0.85], [54, 0]] } });
  const canopy = locked(block('metal', [1.15, 3.05], [3.02, 3.17], [-1.3, 0.35], y), [1.05, 2.95, 0]);
  bed.density = canopy.density = 700;
  const frame = block('steel', [-3.3, 3.0], [0.55, 1.25], [-0.7, 0.7], { tint: DARK, finish: 'satin' });
  return put(weigh(kg(vehicle([
    frame,
    block('steel', [3.0, 3.08], [0.7, 1.2], [-0.6, 0.6], BRIGHT),
    block('metal', [1.3, 3.0], [1.25, 1.55], [-0.7, 0.7], y),
    block('steel', [1.3, 3.0], [1.55, 1.62], [0.2, 1.25], { finish: 'galv' }),
    chamfer('metal', [1.3, 3.0], [1.55, 2.95], [-1.2, 0.2], 0.1, y, 'vert'),
    block('tempered', [3.0, 3.06], [2.2, 2.85], [-1.05, 0.05], { finish: 'smoked' }),
    block('tempered', [1.9, 2.85], [2.2, 2.85], [-1.26, -1.2], { finish: 'smoked' }),
    bed, canopy,
    ...vaxle(1.9, 0.7, r, 0.45, 'machine', { steer: 1, park: true }), ...vaxle(-2.1, 0.7, r, 0.45, 'machine', { drive: true, park: true }),
  ], 'dumptruck', frame), { steel: 1200, metal: 300, machine: 3000 }), MACHINE_KG.dumpTruck, 450), p, 'dumptruck');
}

/** Truck mixer, loaded (~29 t): the pear-shaped drum turns at about 9 rpm on its front pedestal all day; cab-over cab,
    bumper, and a feed hopper on the rear pedestal. */
export function mixerTruck(p: Placement): PieceSpec[] {
  const r = 0.5, deck = 1.06, g: PieceOpts = { tint: GREY, finish: 'satin' };
  const pts: Vec3[] = [];
  for (const [x, rr] of [[0.84, 0.5], [0.5, 0.75], [-0.3, 0.85], [-1.6, 0.72], [-2.44, 0.42]]) {
    for (let i = 0; i < 12; i++) pts.push([x, 2.2 + rr * Math.sin(((i + 0.5) * Math.PI) / 6), rr * Math.cos(((i + 0.5) * Math.PI) / 6)]);
  }
  const drum = hinge(hull('metal', pts, { tint: 0xe7e3d8, finish: 'paint' }), [0.91, 2.2, 0], [1, 0, 0], { motor: hydroMotor(60e3, 0.9, 350, { tank: 250 }) });
  // the loaded drum's mass as when it was a plain 12-gon barrel (0.85 m, 3.28 m long) at 1400 kg/m³
  drum.density = Math.round((1400 * 6 * 0.85 ** 2 * 0.5 * 3.28) / hullVolume(drum.verts!));
  const frame = block('steel', [-3.4, 3.3], [0.4, deck], [-0.6, 0.6], { tint: DARK, finish: 'satin' });
  return put(weigh(kg(vehicle([
    frame,
    loft('steel', [[3.3, [[0, 0.45], [1.2, 0.45], [1.2, deck], [0, deck]]], [3.55, [[0, 0.5], [1.05, 0.5], [1.05, 1.0], [0, 1.0]]]], BRIGHT),
    ...headlamps(3.55, [0.72, 0.86], [0.6, 0.95]),
    ...cabOver(1.8, 3.3, 2.3, deck, 1.85, 2.62, 1.2, paint(0xf2f2ee)),
    chamfer('steel', [0.9, 1.6], [deck, 2.6], [-0.6, 0.6], 0.1, g, 'top'),
    block('metal', [-3.3, -2.9], [deck, 2.0], [-0.5, 0.5], g),
    hull('metal', [[-3.35, 2.0, -0.4], [-2.85, 2.0, -0.4], [-3.35, 2.0, 0.4], [-2.85, 2.0, 0.4],
      [-3.45, 2.55, -0.55], [-2.9, 2.55, -0.55], [-3.45, 2.55, 0.55], [-2.9, 2.55, 0.55]], g),
    drum,
    ...vaxle(2.4, 0.6, r, 0.3, 'machine', { steer: 1 }), ...vaxle(-1.6, 0.6, r, 0.3, 'machine', { drive: true, park: true }),
    ...vaxle(-2.7, 0.6, r, 0.3, 'machine', { drive: true, park: true }),
  ], 'mixer', frame), { steel: 1800, metal: 300, machine: 3000, plywood: 150 }), MACHINE_KG.mixerLoaded, 110), p, 'mixer');
}

/** Mobile crane on its outriggers (striped beams on round jacks): a carrier with fender decks and a glazed cab; the
    superstructure slews with its counterweight and luffs a tapered telescopic boom on a chrome ram. The hook block hangs
    on its line from the head sheave with a bundle of steel beams slung under it; the operator-less cycle luffs up to
    lift the bundle, slews it across, sets it down, and brings it back. `load` sets the bundle's mass (kg, default 2.5 t;
    0 for none). The carrier stands on its jacks and tips when the lift's moment carries the machine past them. */
export function mobileCrane(p: Placement & { load?: number }): PieceSpec[] {
  const y: PieceOpts = { tint: YEL, finish: 'satin' }, d: PieceOpts = { tint: DARK, finish: 'satin' }, r = 0.55, top = 1.25;
  const stripe: PieceOpts = { tint: 0x161616, finish: 'decal' };
  const ps: PieceSpec[] = [
    loft('metal', [[-4.5, [[0, 0.6], [0.9, 0.6], [1.0, 0.75], [1.0, top], [0, top]]], [-4.3, [[0, 0.45], [1.0, 0.45], [1.0, top], [0, top]]],
      [4.3, [[0, 0.45], [1.0, 0.45], [1.0, top], [0, top]]], [4.5, [[0, 0.6], [0.9, 0.6], [1.0, 0.75], [1.0, top], [0, top]]]], y),
    ...pair((s) => block('steel', [-4.5, 2.95], [top, 1.32], s > 0 ? [0.92, 1.45] : [-1.45, -0.92], { finish: 'galv' })),
  ];
  for (const x of [[-4.5, -4.1], [1.9, 2.3]] as Range[]) {
    for (const s of [1, -1]) {
      const zr = (a: number, b: number): Range => (s > 0 ? [a, b] : [-b, -a]);
      ps.push(chamfer('steel', x, [0.8, 1.1], zr(1.0, 2.7), 0.04, stripe), cyl('steel', 0.38, [0, 0.8], (x[0] + x[1]) / 2, s * 2.5, d));
    }
  }
  ps.push(chamfer('metal', [3.0, 4.4], [top, 2.8], [-1.3, -0.2], 0.1, y, 'vert'),
    block('tempered', [4.4, 4.46], [1.9, 2.7], [-1.2, -0.3], { finish: 'smoked' }), block('tempered', [3.2, 4.3], [1.9, 2.7], [-1.36, -1.3], { finish: 'smoked' }));
  ps.push(cyl('castiron', 1.8, [top, 1.5], -1.0, 0, { tint: IRON }));
  // lift cycle (48 s): set down at A, lift, slew 50° to B, set down, lift, slew back; + luffs the boom up
  const T = 48;
  const house = hinge(chamfer('metal', [-3.4, 0.6], [1.56, 3.0], [-1.2, 1.2], 0.12, y, 'top'), [-1.0, 1.49, 0], [0, 1, 0],
    { lower: -1.3, upper: 1.3, motor: hydroMotor(1e5, 0.1, 280, { tank: 300 }), cycle: { period: T, keys: [[0, 0], [13, 0], [22, 0.9], [37, 0.9], [46, 0]] } });
  const cw = locked(chamfer('castiron', [-3.9, -3.4], [1.56, 2.8], [-1.1, 1.1], 0.1, stripe, 'vert'), [-3.3, 2.2, 0]);
  const lo = (x: number) => 2.6 + (x - 0.66) * 0.806, hi = (x: number) => 3.1 + (x - 0.66) * 0.7997;
  // telescopic boom tapering from the 0.7 m base section to the 0.54 m tip section
  const boom = hinge(hull('metal', [...[-0.35, 0.35].flatMap((z) => [[0.66, lo(0.66), z], [0.66, hi(0.66), z]] as Vec3[]),
    ...[-0.27, 0.27].flatMap((z) => [[8.6, 9.035, z], [8.6, 9.415, z]] as Vec3[])], y),
    [0.55, 2.8, 0], [0, 0, 1], { lower: -0.1, upper: 0.08, motor: ram(0.25, 0.18, 300, 180, { arm: 1.5, shuttle: false }),
      cycle: { period: T, keys: [[0, 0.06], [4, -0.05], [9, -0.05], [13, 0.06], [24, 0.06], [28, -0.05], [33, -0.05], [37, 0.06]] } });
  const boomRam = locked(rod('steel', [1.25, 2.25, 0], [3.4, lo(3.4) - 0.13, 0], 0.18, { tint: 0xd6d9dc, finish: 'chrome' }), [3.3, (lo(3.3) + hi(3.3)) / 2, 0]);
  const sheave = locked(disc('steel', 'z', [8.9, 9.2, 0], 0.24, 0.4, d), [8.55, 9.2, 0]);
  // hook block down on its hoist line (multi-fall, ~60 t breaking) over the slung bundle, the line a little slack
  const hook = { ...chamfer('castiron', [8.62, 9.04], [1.25, 1.75], [-0.2, 0.2], 0.07, stripe), noWeld: true };
  hook.density = 3000;
  sheave.ropeTo = { end: [...hook.pos], slack: 0.3, strength: 6e5, kind: 'rope' };
  ps[0].outriggers = true;
  ps.push(house, cw, boom, boomRam, sheave, hook);
  /* set up on its outriggers: jacked up clear of the road, the wheels hang on their parked hubs */
  const b = park(MACHINE_KG.mobileCrane / 3, r);
  ps.push(...raise([...axle(3.4, 1.0, r, 0.35, 'machine', b), ...axle(-1.4, 1.0, r, 0.35, 'machine', b), ...axle(-2.8, 1.0, r, 0.35, 'machine', b)], 0.12));
  house.density = 800;
  cw.density = 800;
  // the tapered boom weighs what the old parallel one did
  boom.density = 1560;
  const out = weigh(kg(ps, { metal: 1100, machine: 1200 }), MACHINE_KG.mobileCrane, 150);
  const kgLoad = p.load ?? 2500;
  if (kgLoad > 0) {
    // a slung bundle of steel sections resting on dunnage under the head
    const load = { ...block('steel', [8.3, 9.5], [0.02, 0.52], [-0.9, 0.9], { tint: 0x7a4a32, finish: 'satin' }), noWeld: true };
    load.density = Math.round(kgLoad / (1.2 * 0.5 * 1.8));
    hook.ropeTo = { end: [...load.pos], slack: 0.15, strength: 6e5, kind: 'chain' };
    out.push(load);
  }
  return put(out, p, 'mobilecrane');
}

/** Counterbalance forklift (~4.4 t, 2 t cast counterweight): an inner mast telescopes out of the outer uprights and the
    carriage rides the inner mast, for a 3.3 m lift. Rounded striped counterweight, seat under the overhead guard,
    tapered forks. A pallet of cartons rides the forks: the operator-less cycle stacks it high (free lift on the carriage,
    then the inner mast) and brings it down again. */
export function forklift(p: Placement & { pallet?: boolean }): PieceSpec[] {
  const y: PieceOpts = { tint: ORANGE, finish: 'satin' }, d: PieceOpts = { tint: DARK, finish: 'satin' };
  const T = 40;
  const inner = slider(block('steel', [0.76, 0.86], [0.3, 2.3], [-0.42, 0.42], d), [0.65, 1.0, 0.36], [0, 1, 0],
    { lower: 0, upper: 1.6, motor: ram(0.06, 0.045, 180, 34, { shuttle: false, tank: 60 }), cycle: { period: T, keys: [[0, 0], [14, 0], [20, 1.5], [26, 1.5], [32, 0]] } });
  const carriage = slider(block('steel', [0.92, 1.02], [0.25, 1.0], [-0.45, 0.45], d), [0.81, 0.6, 0], [0, 1, 0],
    { lower: 0, upper: 1.7, motor: ram(0.05, 0.035, 180, 24, { shuttle: false }), cycle: { period: T, keys: [[0, 0], [6, 0], [12, 1.6], [34, 1.6], [39, 0]] } });
  const cwPlan: [number, number][] = [[-1.2, 0.55], [-1.38, 0.53], [-1.48, 0.45], [-1.5, 0.3], [-1.5, -0.3], [-1.48, -0.45], [-1.38, -0.53], [-1.2, -0.55]];
  const ps: PieceSpec[] = [
    block('machine', [-1.2, 0.6], [0.2, 1.2], [-0.55, 0.55], y),
    hull('castiron', cwPlan.flatMap(([x, z]) => [[x, 0.2, z], [x, 1.22, z], [x + (x < -1.21 ? 0.06 : 0), 1.3, z * 0.9]] as Vec3[]), { tint: 0x161616, finish: 'decal' }),
    block('steel', [0.6, 0.7], [0.2, 2.4], [0.3, 0.42], d),
    block('steel', [0.6, 0.7], [0.2, 2.4], [-0.42, -0.3], d),
    block('steel', [0.6, 0.7], [2.4, 2.5], [-0.42, 0.42], d),
    inner, carriage,
    across('plywood', [[-0.8, 1.2], [-0.3, 1.2], [-0.3, 1.35], [-0.68, 1.8], [-0.8, 1.8]], [-0.3, 0.3], SEAT),
  ];
  for (const x of [[-1.1, -1.02], [0.44, 0.52]] as Range[]) for (const z of [[0.45, 0.53], [-0.53, -0.45]] as Range[]) ps.push(block('steel', x, [1.2, 2.1], z, d));
  ps.push(block('steel', [-1.1, 0.52], [2.1, 2.16], [-0.53, 0.53], d));
  for (const z of [[0.2, 0.32], [-0.32, -0.2]] as Range[]) {
    ps.push(locked(hull('steel', [z[0], z[1]].flatMap((zz) => [[1.02, 0.25, zz], [1.02, 0.33, zz], [2.1, 0.25, zz], [2.1, 0.29, zz]] as Vec3[]), d), [0.97, 0.3, (z[0] + z[1]) / 2]));
  }
  ps.push(...vaxle(0.25, 0.55, 0.3, 0.2, 'steel', { drive: true, park: true }), ...vaxle(-0.9, 0.55, 0.26, 0.18, 'steel', { steer: -1 }));
  vehicle(ps, 'forklift', ps[0]);
  inner.density = 3000;
  const out = weigh(kg(ps, { machine: 700, castiron: 5600, steel: 3000, plywood: 150 }), MACHINE_KG.forklift, 35);
  if (p.pallet !== false) {
    // a Euro pallet (1.2 × 0.8 m, 25 kg) on the forks and two cartons of stock on it, loose
    out.push({ ...block('wood', [1.1, 2.0], [0.34, 0.48], [-0.6, 0.6], { tint: 0xb89a6a }), noWeld: true, density: 170 });
    for (const z of [[-0.55, -0.02], [0.02, 0.55]] as Range[]) out.push({ ...block('cardboard', [1.2, 1.9], [0.49, 1.05], z, { tint: 0xb08a5a }), noWeld: true, density: 180 });
  }
  return put(out, p, 'forklift');
}

/** Scissor lift: the scissor pack and the guarded platform ride up together and come back down. */
export function scissorLift(p: Placement): PieceSpec[] {
  const o: PieceOpts = { tint: ORANGE, finish: 'satin' };
  const lift = { period: 50, keys: [[0, 0], [12, 0], [20, 1.45], [36, 1.45], [44, 0]] as [number, number][] };
  const pack = slider(block('steel', [-0.9, 0.9], [0.56, 1.1], [-0.45, 0.45], { tint: DARK, finish: 'satin' }), [0, 0.49, 0], [0, 1, 0],
    { lower: 0, upper: 1.5, motor: ram(0.08, 0.05, 180, 45, { shuttle: false }), cycle: lift });
  const deck = slider(block('steel', [-1.25, 1.25], [1.16, 1.3], [-0.65, 0.65], o), [0, 1.09, 0], [0, 1, 0],
    { lower: 0, upper: 1.5, motor: ram(0.08, 0.05, 180, 45, { shuttle: false }), cycle: lift });
  const rail = (z: Range) => locked(block('steel', [-1.25, 1.25], [1.3, 2.3], z, { finish: 'galv' }), [0, 1.25, (z[0] + z[1]) / 2]);
  return put(weigh(kg([
    chamfer('machine', [-1.2, 1.2], [0, 0.5], [-0.6, 0.6], 0.08, o, 'top'),
    pack, deck, rail([0.59, 0.65]), rail([-0.65, -0.59]),
  ], { machine: 1000, steel: 700 }), MACHINE_KG.scissorLift), p, 'scissorlift');
}

/** Towable site compressor on its drawbar stand: a round-shouldered canopy over mudguarded wheels; the cooling fan
    turns behind the rear grille. */
export function compressor(p: Placement): PieceSpec[] {
  const d: PieceOpts = { tint: DARK, finish: 'satin' };
  return put(weigh(kg([
    chamfer('machine', [-1.0, 1.0], [0.25, 1.4], [-0.6, 0.6], 0.2, { tint: ORANGE, finish: 'satin' }, 'top'),
    block('steel', [-0.9, -0.6], [0, 0.25], [-0.5, 0.5], d),
    block('steel', [0.6, 0.9], [0, 0.25], [-0.5, 0.5], d),
    block('steel', [1.0, 2.0], [0.5, 0.6], [-0.06, 0.06], d),
    block('steel', [1.84, 1.96], [0, 0.5], [-0.06, 0.06], d),
    ...pair((s) => block('steel', [-0.37, 0.37], [0.67, 0.72], s > 0 ? [0.6, 0.86] : [-0.86, -0.6], d)),
    cyl('steel', 0.12, [1.4, 1.8], -0.6, 0.3, { tint: IRON }),
    hinge(block('aluminum', [-1.12, -1.06], [0.5, 1.2], [-0.08, 0.08], { tint: GREY }), [-0.99, 0.85, 0], [1, 0, 0],
      { motor: { speed: 8, force: 0, drive: 'diesel', kW: 3, always: true, tank: 90 } }),
    ...axle(0, 0.6, 0.3, 0.15, 'steel', park(MACHINE_KG.compressor, 0.3)),
  ], { machine: 500, steel: 2000 }), MACHINE_KG.compressor, 25), p, 'compressor');
}

/** 500 kVA diesel generator set (~5 t, a power source): engine with its radiator, a round alternator with its cooling
    fan, and a floor feeder cabinet on its lead. */
export function dieselGenerator(p: Placement): PieceSpec[] {
  const m: PieceOpts = { tint: 0xd9a431, finish: 'satin' }, ra = 0.45 / Math.cos(Math.PI / 12);
  return put(weigh(kg([
    block('steel', [-1.4, 1.4], [0, 0.2], [-0.6, 0.6], { tint: 0x3a3d40, finish: 'satin' }),
    chamfer('machine', [-1.2, 0.3], [0.2, 1.3], [-0.5, 0.5], 0.1, m, 'top'),
    tankX('machine', [0.3, 1.25], 0.2 + 0.45, 0, ra, 0.12, { ...m, fixture: 'generator' }),
    block('metal', [-1.4, -1.2], [0.2, 1.3], [-0.55, 0.55], { tint: 0x2f3336, finish: 'satin' }),
    cyl('steel', 0.18, [1.3, 2.4], -0.7, 0.2, { tint: 0x5b5f63 }),
    hinge(block('aluminum', [1.31, 1.37], [0.36, 0.99], [-0.08, 0.08], { tint: GREY }), [1.24, 0.675, 0], [1, 0, 0], { motor: gearmotor(10, 1.5) }),
    ...conduit([[0.8, 0.6, -0.45], [0.8, 0.6, -1.0]]),
    chamfer('machine', [0.55, 1.05], [0, 1.1], [-1.3, -1.0], 0.04, { tint: SVC.transformer, util: 'power', finish: 'satin' }, 'vert'),
  ], { steel: 2000, machine: 1500 }), MACHINE_KG.genset500kVA), p, 'generator');
}

/** Site lighting tower: trailer on jacks with its own generator under a round-shouldered canopy, a galvanised mast and a
    bank of floodlights. */
export function lightTower(p: Placement): PieceSpec[] {
  const s = { finish: 'galv' as const, util: 'power' as const }, d: PieceOpts = { tint: DARK, finish: 'satin' };
  const ps: PieceSpec[] = [
    chamfer('steel', [-1.2, 1.2], [0.3, 0.7], [-0.6, 0.6], 0.05, { tint: YEL, finish: 'satin' }, 'vert'),
    block('steel', [0.85, 1.0], [0, 0.3], [-0.8, 0.8], d),
    block('steel', [-1.0, -0.85], [0, 0.3], [-0.8, 0.8], d),
    chamfer('machine', [-1.1, 0.4], [0.7, 1.6], [-0.55, 0.55], 0.15, { tint: YEL, fixture: 'generator', finish: 'satin' }, 'top'),
    ...conduit([[0.4, 1.0, 0], [0.7, 1.0, 0]]),
    ...splitRange(0.7, 8.0, 4).map((yr) => cyl('steel', 0.2, yr, 0.8, 0, s)),
    block('steel', [0.3, 1.3], [8.0, 8.12], [-0.1, 0.1], s),
  ];
  for (const x of [0.4, 0.65, 0.95, 1.2]) ps.push(lamp([x - 0.1, x + 0.1], [7.9, 8.2], [0.1, 0.3], LIGHT.flood));
  return put(weigh(kg(ps, { steel: 900, machine: 600 }), MACHINE_KG.lightTower), p, 'lighttower');
}

/* ---------------- industrial ---------------- */

/** Powered roller line along +X from 0 to len with its drive and isolator on the +Z side. */
export function conveyorLine(p: MachinePlacement & { len?: number }): PieceSpec[] {
  const len = p.len ?? 6, c = len / 2, st: PieceOpts = { finish: 'galv' };
  const ps: PieceSpec[] = [];
  for (const z of [[-0.56, -0.46], [0.46, 0.56]] as Range[]) {
    ps.push(block('steel', [0, len], [0.7, 0.85], z, st));
    for (const x of [0.1, c, len - 0.1]) ps.push(block('steel', [x - 0.08, x + 0.08], [0, 0.7], z, st));
  }
  ps.push(motorBox([c + 0.14, c + 0.7], [0.35, 0.85], [0.56, 0.9]));
  /* one 1.1 kW gearmotor turns the middle roller; the rest follow on roller chain */
  // roller pitch under a third of the shortest load's length, so a carton always rides on at least three
  const n = Math.max(2, Math.ceil((len - 0.6) / 0.3) + 1), mid = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    const x = 0.3 + (i * (len - 0.6)) / (n - 1);
    // turning clockwise about +Z seen from +Z, so the roller tops carry the load toward +X
    ps.push(hinge(hull('steel', octZ(x, 0.8, [-0.4, 0.4], 0.1), { tint: 0xa8adb0, finish: 'chrome' }), [x, 0.8, 0.5], [0, 0, 1],
      i === mid ? { motor: gearmotor(-3, 1.1) } : { drivenBy: { ratio: 1, kind: 'chain' } }));
  }
  ps.push(...conduit([[c + 0.42, 0.6, 0.9], [c + 0.42, 0.6, 1.3]]), isolator([c + 0.17, c + 0.67], [1.3, 1.6], p.feed));
  // crates of stock riding the rollers, taken off at the tail and fed on again at the head
  for (let x = 0.3; x + 0.9 < len - 0.3; x += 1.6) {
    ps.push({ ...block('crate', [x, x + 0.9], [0.91, 1.21], [-0.22, 0.22], { tint: 0xb08a5a }), noWeld: true, density: 120,
      carry: { from: [0.3 + 0.45, 1.07, 0], to: [len - 0.05, 1.07, 0] } });
  }
  return put(ps, p, 'conveyor');
}

function octZ(x: number, y: number, z: Range, r: number): Vec3[] {
  const pts: Vec3[] = [];
  for (const zz of z) for (let i = 0; i < 8; i++) pts.push([x + r * Math.cos((i + 0.5) * Math.PI / 4), y + r * Math.sin((i + 0.5) * Math.PI / 4), zz]);
  return pts;
}

/** Rotary drum dryer (a short kiln): the drum turns slowly between its feed hood and its firing hood, driven from
    the firing end; riding-ring piers stand clear beneath it and a flue rises from the feed hood. */
export function rotaryKiln(p: MachinePlacement): PieceSpec[] {
  const cy = 1.9, m: PieceOpts = { tint: 0x7a6f66, finish: 'satin' };
  const drum = hinge(disc('metal', 'x', [0, cy, 0], 0.9, 7.0, { tint: 0x9a5a3a, finish: 'satin' }, 12), [3.61, cy, 0], [1, 0, 0], { motor: gearmotor(0.4, 37) });
  return put([
    chamfer('machine', [3.6, 4.5], [0, 3.2], [-1.2, 1.2], 0.15, m, 'top'),
    chamfer('machine', [-4.5, -3.6], [0, 3.0], [-1.1, 1.1], 0.15, m, 'top'),
    chamfer('concrete', [-2.6, -2.0], [0, 0.88], [-0.9, 0.9], 0.06, { tint: CON }, 'vert'),
    chamfer('concrete', [1.4, 2.0], [0, 0.88], [-0.9, 0.9], 0.06, { tint: CON }, 'vert'),
    drum,
    motorBox([3.75, 4.35], [3.2, 3.7], [-0.3, 0.3]),
    ...conduit([[4.05, 3.45, 0.3], [4.05, 3.45, 1.5], [4.05, 0.6, 1.5]]),
    isolator([3.8, 4.3], [1.54, 1.84], p.feed),
    ...splitRange(3.0, 10.0, 3.5).map((yr) => cyl('steel', 0.7, yr, -4.05, 0, { finish: 'galv' })),
  ], p, 'kiln');
}

/** Bucket elevator: twin casings from a concrete boot to a head house; a bucket climbs the up-leg and returns while
    the boot drive and its sprocket turn. */
export function bucketElevator(p: MachinePlacement & { height?: number }): PieceSpec[] {
  const H = p.height ?? 12, s: PieceOpts = { finish: 'galv' };
  const mot = motorBox([0.1, 0.55], [0.6, 1.2], [0.3, 0.6]);
  return put([
    block('concrete', [-0.8, 0.8], [0, 0.6], [-0.6, 0.6], { tint: CON }),
    block('steel', [-0.55, -0.1], [0.6, H], [-0.3, 0.3], s),
    block('steel', [0.1, 0.55], [0.6, H], [-0.3, 0.3], s),
    chamfer('metal', [-0.8, 0.8], [H, H + 1.2], [-0.5, 0.5], 0.12, { tint: 0x7d9a86, finish: 'satin' }, 'top'),
    mot,
    hinge(disc('steel', 'x', [0.67, 0.9, 0.45], 0.22, 0.12, { tint: IRON }), [0.54, 0.9, 0.45], [1, 0, 0], { motor: gearmotor(3, 5.5) }),
    slider(block('steel', [0.15, 0.5], [1.26, 1.66], [0.36, 0.66], { tint: ORANGE, finish: 'satin' }), [0.3, 1.0, 0.45], [0, 1, 0],
      { lower: 0, upper: H - 2.2, motor: gearmotor(0.8, 5.5, true) }),
    ...conduit([[0.33, 0.7, 0.6], [0.33, 0.7, 1.25], [0.65, 0.7, 1.25]]),
    isolator([0.65, 1.15], [1.1, 1.4], p.feed),
  ], p, 'elevator');
}

/** Bank of axial extract fans in a plenum wall, each on its own motor, fed along a cable tray. */
export function fanBank(p: MachinePlacement & { fans?: number }): PieceSpec[] {
  const n = p.fans ?? 3, W = n * 1.6 / 2;
  const ps: PieceSpec[] = splitRange(-W, W, 3.2).map((x) => block('metal', x, [0, 2.6], [-0.6, 0], { tint: 0x9aa3a8, finish: 'satin' }));
  for (let i = 0; i < n; i++) {
    const c = -W + 0.8 + i * 1.6;
    ps.push(motorBox([c - 0.25, c + 0.25], [1.0, 1.5], [0, 0.32]));
    ps.push(hinge(block('aluminum', [c - 0.62, c + 0.62], [1.13, 1.37], [0.38, 0.46], { tint: 0x55595d }), [c, 1.25, 0.2], [0, 0, 1], { motor: gearmotor(8, 5.5, false, 960) }));
  }
  ps.push(...conduit([[-W + 0.8, 1.54, 0.16], [W - 0.8, 1.54, 0.16]]));
  ps.push(...conduit([[W - 0.8, 1.54, 0.16], [W + 0.3, 1.54, 0.16], [W + 0.3, 1.2, 0.16], [W + 0.3, 1.2, 0.6]]), isolator([W + 0.05, W + 0.55], [0.6, 0.9], p.feed));
  return put(ps, p, 'fanbank');
}

/** Dry cooler: finned coil casing with a large horizontal fan on its motor on top. */
export function coolingFan(p: MachinePlacement): PieceSpec[] {
  return put([
    chamfer('machine', [-1.3, 1.3], [0, 1.6], [-1.0, 1.0], 0.12, { tint: 0xc9ccc8, finish: 'satin' }, 'vert'),
    motorBox([-0.3, 0.3], [1.6, 2.0], [-0.3, 0.3]),
    hinge(block('aluminum', [-1.15, 1.15], [2.06, 2.14], [-0.14, 0.14], { tint: 0x55595d }), [0, 1.9, 0], [0, 1, 0], { motor: gearmotor(6, 11) }),
    ...conduit([[0.3, 1.75, 0], [1.3, 1.75, 0]]),
    ...conduit([[1.3, 1.75, 0], [1.6, 1.75, 0], [1.6, 1.2, 0], [1.6, 1.2, 1.1]]),
    isolator([1.35, 1.85], [1.1, 1.4], p.feed),
  ], p, 'coolingfan');
}

function pressUnit(): PieceSpec[] {
  const iron: PieceOpts = { tint: 0x5a6e5a, finish: 'satin' };
  // a 100 t press: the ram (a fabricated box, ~2 t) is driven hard both ways
  // stroke (5 s): dwell open while a blank is loaded, close fast onto it, hold the squeeze, return
  const head = slider(chamfer('steel', [-0.48, 0.48], [1.9, 2.94], [-0.35, 0.35], 0.06, { tint: GREY, finish: 'satin' }, 'vert'), [0, 3.1, 0], [0, 1, 0],
    { lower: -0.32, upper: 0, motor: { ...ram(0.25, 0.18, 210, 880), always: undefined, shuttle: false, speed: -0.3 },
      cycle: { period: 5, keys: [[0, 0], [1.6, 0], [2.3, -0.29], [2.8, -0.29], [3.8, 0]], thump: -0.245 } });
  head.density = 3000;
  return [
    // the straight-side frame is one iron casting: bed, two columns and crown
    weldParts([
      chamfer('castiron', [-0.85, 0.85], [0, 0.9], [-0.6, 0.6], 0.08, iron, 'vert'),
      chamfer('castiron', [-0.85, -0.55], [0.9, 3.0], [-0.4, 0.4], 0.06, iron, 'vert'),
      chamfer('castiron', [0.55, 0.85], [0.9, 3.0], [-0.4, 0.4], 0.06, iron, 'vert'),
      chamfer('castiron', [-0.95, 0.95], [3.0, 3.6], [-0.5, 0.5], 0.1, iron, 'top'),
    ]),
    block('steel', [-0.4, 0.4], [0.9, 1.05], [-0.3, 0.3], { tint: 0x161616, finish: 'decal' }),
    // lower die on the bolster and a sheet blank on it
    block('steel', [-0.42, 0.42], [1.05, 1.6], [-0.3, 0.3], { tint: 0x4a4f53, finish: 'satin' }),
    { ...block('steel', [-0.3, 0.3], [1.6, 1.65], [-0.22, 0.22], { tint: 0xb9bec2, finish: 'galv' }), noWeld: true },
    motorBox([-0.45, 0.45], [3.6, 4.1], [-0.35, 0.35]),
    head,
  ];
}

/** Hydraulic press line: presses in a row, their crown motors on one overhead cable tray fed down to the isolator. */
export function pressLine(p: MachinePlacement & { presses?: number }): PieceSpec[] {
  const n = p.presses ?? 3, gap = 3.0, x0 = -((n - 1) * gap) / 2;
  const ps: PieceSpec[] = [];
  for (let i = 0; i < n; i++) ps.push(...place(pressUnit(), x0 + i * gap, 0));
  const xe = -x0 + 1.2;
  ps.push(block('steel', [x0 - 0.45, -x0 + 0.45], [4.1, 4.18], [-0.1, 0.1], { tint: SVC.cable, util: 'power' }));
  ps.push(...conduit([[-x0 + 0.45, 4.14, 0], [xe, 4.14, 0], [xe, 1.2, 0], [xe, 1.2, 0.5]]), isolator([xe - 0.25, xe + 0.25], [0.5, 0.8], p.feed));
  return put(ps, p, 'pressline');
}

/** CNC router gantry: the bridge traverses the bed on its rails and the spindle carriage crosses the bridge, each fed
    by a drag cable from the one below. */
export function cncGantry(p: MachinePlacement): PieceSpec[] {
  const y: PieceOpts = { tint: YEL, finish: 'satin' }, s: PieceOpts = { tint: 0xd6d9dc, finish: 'chrome' };
  const post = block('steel', [-0.1, 0.1], [0, 4.0], [1.5, 1.7], { finish: 'galv', util: 'power' });
  const bridge = slider(block('steel', [-0.2, 0.2], [1.9, 2.2], [-1.3, 1.3], { ...y, util: 'power' }), [0, 2.05, 1.6], [1, 0, 0],
    { lower: -1.4, upper: 1.4, motor: gearmotor(0.3, 3, true) });
  const carriage = slider(chamfer('steel', [0.26, 0.56], [1.45, 2.35], [-0.3, 0.3], 0.05, { tint: ORANGE, util: 'power', finish: 'satin' }, 'vert'), [0, 2.05, 0], [0, 0, 1],
    { lower: -0.9, upper: 0.9, motor: gearmotor(0.25, 1.5, true) });
  lead(post, bridge);
  lead(bridge, carriage, 1.0);
  const leg = (z: Range) => locked(block('steel', [-0.15, 0.15], [1.06, 1.9], z, y), [0, 2.0, (z[0] + z[1]) / 2]);
  return put([
    chamfer('castiron', [-2.0, 2.0], [0, 0.8], [-1.2, 1.2], 0.08, { tint: 0x4d5a62, finish: 'satin' }, 'top'),
    block('steel', [-2.0, 2.0], [0.8, 1.0], [1.0, 1.2], s),
    block('steel', [-2.0, 2.0], [0.8, 1.0], [-1.2, -1.0], s),
    motorBox([2.0, 2.4], [0.7, 1.05], [0.95, 1.25]),
    ...conduit([[2.2, 1.05, 1.1], [2.2, 1.3, 1.1], [2.2, 1.3, 1.6], [0.1, 1.3, 1.6]]),
    post, bridge, carriage, leg([1.02, 1.2]), leg([-1.2, -1.02]),
    ...conduit([[2.4, 0.9, 1.1], [2.7, 0.9, 1.1], [2.7, 0.9, 1.9]]),
    isolator([2.45, 2.95], [1.9, 2.2], p.feed),
  ], p, 'cnc');
}

/** Six-axis-style robot arm on a motor base: turret, upper arm and forearm on shuttling powered joints, each fed by a
    lead from the joint below, so a dead base leaves the whole arm limp. */
export function robotArm(p: MachinePlacement): PieceSpec[] {
  const o = { tint: ORANGE, util: 'power' as const, finish: 'satin' as const };
  const base = cyl('machine', 1.0, [0, 0.6], 0, 0, { tint: SVC.motor, fixture: 'motor', finish: 'satin' });
  const turret = hinge(cyl('machine', 0.9, [0.66, 1.2], 0, 0, o), [0, 0.59, 0], [0, 1, 0], { lower: -1.5, upper: 1.5, motor: gearmotor(0.5, 3.7, true) });
  const bar = (a: [number, number], b: [number, number], x: Range, w: number): Vec3[] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]), nn = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
    return x.flatMap((xx) => [a, b].flatMap(([yy, zz]) => [-w, w].map((k) => [xx, yy + k * nn[0], zz + k * nn[1]] as Vec3)));
  };
  const upper = hinge(hull('machine', bar([1.4, 0], [2.5, 0.6], [-0.14, 0.14], 0.15), o), [0, 1.19, 0], [1, 0, 0],
    { lower: -0.35, upper: 0.3, motor: gearmotor(0.35, 3.7, true) });
  const fore = hinge(hull('machine', bar([2.55, 0.75], [2.05, 1.85], [0.17, 0.37], 0.11), o), [0, 2.5, 0.62], [1, 0, 0],
    { lower: -0.4, upper: 0.4, motor: gearmotor(0.45, 2.2, true) });
  lead(base, turret, 0.6);
  lead(turret, upper, 1.2);
  lead(upper, fore, 1.2);
  return put([
    base, turret, upper, fore,
    ...conduit([[0.5, 0.3, 0], [1.3, 0.3, 0]]),
    isolator([1.3, 1.6], [-0.25, 0.25], p.feed),
  ], p, 'robot');
}

/** Goods lift in a steel tower against its shaft wall: live guide rail, head winder and a shuttling car on its rope. */
export function goodsLift(p: MachinePlacement & { travel?: number }): PieceSpec[] {
  const tr = p.travel ?? 6, y0 = 0.2, top = y0 + tr + 2.6, s: PieceOpts = { finish: 'galv' };
  const winder = motorBox([-0.35, 0.35], [top, top + 0.55], [0, 0.55]);
  const car = slider(block('metal', [-0.65, 0.65], [y0 + 0.06, y0 + 2.2], [0.18, 1.4], { tint: 0xb9bdc0, finish: 'satin' }), [0, y0 + 1.1, 0.06], [0, 1, 0],
    { lower: 0, upper: tr, motor: gearmotor(1.0, 18.5, true) });
  car.ropeTo = { end: [...winder.pos], slack: 0.1, strength: 9e4 };
  car.density = 350;
  return put([
    ...splitRange(0, top + 0.7, 5).map((yr) => block('metal', [-1.1, 1.1], yr, [-0.12, 0], { tint: 0xa8adb0, finish: 'satin' })),
    ...splitRange(y0, top, 5).map((yr) => block('steel', [-0.08, 0.08], yr, [0, 0.12], { ...s, util: 'power' })),
    winder, car,
    ...[-1.0, 1.0].map((x) => block('steel', [x - 0.08, x + 0.08], [0, top + 0.7], [1.5, 1.66], s)),
    ...[-1.0, 1.0].map((x) => block('steel', [x - 0.08, x + 0.08], [top + 0.7, top + 0.85], [-0.12, 1.66], s)),
    ...conduit([[0.08, 0.5, 0.06], [1.5, 0.5, 0.06], [1.5, 0.5, -0.5]]),
    isolator([1.3, 1.7], [-0.8, -0.5], p.feed),
  ], p, 'goodslift');
}

/** Ventilation stack: a tall steel flue over a fan chamber whose extract fan turns on the chamber side. */
export function ventStack(p: MachinePlacement & { height?: number }): PieceSpec[] {
  const H = p.height ?? 16;
  return put([
    chamfer('metal', [-1.2, 1.2], [0, 2.4], [-1.2, 1.2], 0.1, { tint: 0x9aa3a8, finish: 'satin' }, 'vert'),
    ...splitRange(2.4, H, 5).map((yr) => cyl('steel', 1.3, yr, 0, 0, { finish: 'galv' })),
    cyl('steel', 1.5, [H, H + 0.25], 0, 0, { finish: 'galv' }),
    motorBox([-0.25, 0.25], [1.0, 1.5], [1.2, 1.52]),
    hinge(block('aluminum', [-0.62, 0.62], [1.13, 1.37], [1.58, 1.66], { tint: 0x55595d }), [0, 1.25, 1.4], [0, 0, 1], { motor: gearmotor(8, 4, false, 960) }),
    ...conduit([[0.25, 1.25, 1.36], [1.6, 1.25, 1.36], [1.6, 1.25, 1.9]]),
    isolator([1.35, 1.85], [1.9, 2.2], p.feed),
  ], p, 'ventstack');
}

/** Pump sets on plinths with the motor cooling fans turning; risers join a discharge header. With `water: 'main'`
    (default) a stub main at the -X end supplies it; 'none' leaves the header for a site main to reach. */
export function waterPumps(p: MachinePlacement & { pumps?: number; water?: 'main' | 'none' }): PieceSpec[] {
  const n = p.pumps ?? 2, ps: PieceSpec[] = [];
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 1.8);
  for (const x of xs) {
    ps.push(chamfer('concrete', [x - 0.6, x + 0.6], [0, 0.25], [-0.45, 1.6], 0.04, { tint: CON }, 'top'));
    ps.push(cyl('castiron', 0.7, [0.25, 1.1], x, 0, { tint: SVC.water, util: 'water', finish: 'satin' }));
    ps.push(motorBox([x - 0.35, x + 0.35], [0.25, 0.95], [0.357, 1.35]));
    ps.push(hinge(disc('aluminum', 'z', [x, 0.62, 1.44], 0.28, 0.06, { tint: GREY }), [x, 0.62, 1.34], [0, 0, 1], { motor: gearmotor(12, 15) }));
    ps.push(...pipe('water', 'steel', [[x, 1.1, 0], [x, 1.7, 0]], 0.24));
  }
  ps.push(...pipe('water', 'steel', [[xs[0] - 0.8, 1.82, 0], [xs[n - 1] + 0.8, 1.82, 0]], 0.24));
  const xe = xs[n - 1] + 1.3;
  ps.push(...conduit([[xs[0], 0.95, 0.85], [xs[0], 1.05, 0.85]]));
  ps.push(block('steel', [xs[0] - 0.1, xe], [1.05, 1.13], [0.8, 0.9], { tint: SVC.cable, util: 'power' }));
  for (const x of xs.slice(1)) ps.push(...conduit([[x, 0.95, 0.85], [x, 1.05, 0.85]]));
  ps.push(isolator([xe, xe + 0.4], [0.7, 1.0], p.feed));
  // the trunk main in: a district supply, 300 mm
  if (p.water !== 'none') ps.push({ ...block('castiron', [xs[0] - 1.0, xs[0] - 0.8], [1.2, 2.44], [-0.3, 0.3], { tint: SVC.water, fixture: 'watermain' }), bore: 0.3 });
  return put(ps, p, 'pumps');
}

/** Forced-draught cooling tower: block cells with a fan on a motor over each, turning inside a steel shroud. */
export function coolingTowerFans(p: MachinePlacement & { cells?: number }): PieceSpec[] {
  const n = p.cells ?? 2, W = 3.2, h = 3.0, t = 0.2, X = (n * W) / 2;
  const blk = { tint: 0xc8c6bd };
  const ps: PieceSpec[] = [];
  for (const z of [[-W / 2, -W / 2 + t], [W / 2 - t, W / 2]] as Range[]) ps.push(...splitRange(-X, X, 3.4).map((x) => block('cinderblock', x, [0, h], z, blk)));
  for (let i = 0; i <= n; i++) {
    const x = -X + i * W, xr: Range = i === 0 ? [x, x + t] : i === n ? [x - t, x] : [x - t / 2, x + t / 2];
    ps.push(block('cinderblock', xr, [0, h], [-W / 2 + t, W / 2 - t], blk));
  }
  const tray = { tint: SVC.cable, util: 'power' as const };
  for (let i = 0; i < n; i++) {
    const c = -X + W / 2 + i * W;
    ps.push(block('steel', [c - W / 2 + 0.1, c + W / 2 - 0.1], [h, h + 0.2], [-0.1, 0.1], tray));
    ps.push(motorBox([c - 0.3, c + 0.3], [h + 0.2, h + 0.6], [-0.3, 0.3]));
    ps.push(hinge(block('aluminum', [c - 1.2, c + 1.2], [h + 0.66, h + 0.74], [-0.15, 0.15], { tint: 0x55595d }), [c, h + 0.5, 0], [0, 1, 0], { motor: gearmotor(5, 15) }));
    for (const z of [[-1.5, -1.42], [1.42, 1.5]] as Range[]) ps.push(block('metal', [c - 1.5, c + 1.5], [h, h + 1.1], z, { finish: 'galv' }));
    if (i + 1 < n) ps.push(block('steel', [c + W / 2 - 0.1, c + W / 2 + 0.1], [h, h + 0.2], [-0.1, 0.1], tray));
  }
  ps.push(...conduit([[X - 0.1, h + 0.1, 0], [X + 0.4, h + 0.1, 0], [X + 0.4, 1.0, 0], [X + 0.4, 1.0, 0.7]]));
  ps.push(isolator([X + 0.15, X + 0.65], [0.7, 1.0], p.feed));
  return put(ps, p, 'coolingfans');
}

/* ---------------- utility plant ---------------- */

/** Row of switchgear panels on a busbar trunk: every cubicle is live and conducts to its neighbours. */
export function switchgear(p: Placement & { panels?: number; source?: boolean }): PieceSpec[] {
  const n = p.panels ?? 4, W = n * 0.8 / 2;
  const ps: PieceSpec[] = splitRange(-W, W, 0.8).map((x, i) => chamfer('machine', x, [0, 2.2], [-0.45, 0.45], 0.04,
    { tint: i % 2 ? 0xb8bcb4 : 0xa9ada5, finish: 'satin', ...(p.source && i === 0 ? { fixture: 'transformer' as const } : { util: 'power' as const }) }, 'top'));
  ps.push(block('copper', [-W, W], [2.2, 2.45], [-0.2, 0.2], { tint: 0x8a6a4a, util: 'power' }));
  return put(ps, p, 'switchgear');
}

/** District gas governor: the high-pressure inlet (the site's gas source) rises through a slam-shut valve into two
    regulator streams, joins an outlet header and leaves on a buried main at local (1.8, 0.1, 3.2) heading +Z;
    a relief vent stands on the inlet. */
export function gasGovernor(p: Placement): PieceSpec[] {
  const g = { tint: SVC.gas }, iron = { tint: IRON };
  const ps: PieceSpec[] = [
    block('concrete', [-2.6, 2.6], [0, 0.2], [-1.6, 1.6], { tint: CON }),
    { ...block('castiron', [-2.3, -1.8], [0.2, 1.2], [-0.3, 0.3], { ...g, fixture: 'gasmain' }), bore: 0.15 },   // district governor inlet, 150 mm
    ...pipe('gas', 'steel', [[-1.8, 0.9, 0], [-1.3, 0.9, 0]], 0.26),
    block('castiron', [-1.3, -0.9], [0.2, 1.2], [-0.8, 0.8], { ...iron, util: 'gas' }),
  ];
  for (const z of [-0.5, 0.5]) {
    ps.push(...pipe('gas', 'steel', [[-0.9, 0.9, z], [0.9, 0.9, z]], 0.2));
    ps.push(vessel('castiron', 0.55, [1.0, 1.4], 0, z, 0.1, { ...iron, util: 'gas', finish: 'satin' }));
  }
  ps.push(block('castiron', [0.9, 1.3], [0.2, 1.2], [-0.8, 0.8], { ...iron, util: 'gas' }));
  ps.push(...pipe('gas', 'steel', [[1.3, 0.9, 0], [1.8, 0.9, 0], [1.8, 0.9, 1.9], [1.8, 0.12, 1.9], [1.8, 0.12, 3.2]], 0.2));
  ps.push(...pipe('gas', 'steel', [[-2.05, 1.2, 0], [-2.05, 3.4, 0]], 0.16));
  for (const z of [[1.5, 1.6], [-1.6, -1.5]] as Range[]) ps.push(block('steel', [-2.6, 1.4], [0.2, 1.2], z, { finish: 'galv' }));
  return put(ps, p, 'governor');
}

/** Sewage pumping station: a round wet well with its surface aerator turning on a bridge motor, the control kiosk
    and a vent. */
export function sewageStation(p: MachinePlacement): PieceSpec[] {
  const con = { tint: 0xb9b7ae };
  const ps: PieceSpec[] = [...ringCourse('concrete', 0, 0, [0, 1.3], [2.0, 2.0], [2.3, 2.3], 8, con, Math.PI / 8)];
  ps.push(block('steel', [-2.2, 2.2], [1.3, 1.5], [-0.15, 0.15], { tint: SVC.cable, util: 'power' }));
  ps.push(motorBox([-0.3, 0.3], [1.5, 1.9], [-0.3, 0.3]));
  // surface aerator churning the well: the water is the motor's load (drag ≈ rated torque at speed)
  const aerator = hinge(prism('steel', 1.4, [0.9, 1.2], 0, 0, 8, { tint: 0x55595d }), [0, 1.4, 0], [0, 1, 0], { motor: gearmotor(3, 11) });
  aerator.mech!.drag = 290;
  ps.push(aerator);
  ps.push(chamfer('metal', [2.6, 4.0], [0, 2.2], [-0.8, 0.8], 0.1, { tint: 0x7d9a86, finish: 'satin' }, 'top'));
  ps.push(...conduit([[2.2, 1.4, 0], [2.52, 1.4, 0], [2.52, 1.4, 0.84], [4.2, 1.4, 0.84], [4.2, 1.4, 0.3]]));
  ps.push(isolator([4.0, 4.4], [-0.3, 0.3], p.feed, 1.8));
  ps.push(cyl('steel', 0.25, [0, 4.2], 3.3, -0.93, { finish: 'galv' }));
  return put(ps, p, 'sewage');
}

/** The isolator panel of a machine built by this module (its grid power entry). */
export function isolatorOf(ps: PieceSpec[]): PieceSpec | undefined {
  return ps.find((q) => q.tint === ISO_TINT && q.mat === 'machine');
}
