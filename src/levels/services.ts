import type { MaterialId, PieceSpec, UtilityKind, Vec3 } from '../types.ts';
import { block, box, cyl, hull, pipeRun, prism, splitRange, weldParts, type PieceOpts, type Range } from './kit.ts';
import { trimDetail } from './layers.ts';

/* Building services and machinery. Every service network is a chain of welded (face-touching) members of one
   UtilityKind running from a source fixture to its consumers, and every run also touches the building so it is
   carried. Assemblies are authored at a local origin (front +Z, like structures) and moved with place()/raise(). */

export type Light = NonNullable<PieceSpec['light']>;

export const LIGHT = {
  warm: { color: 0xffd49a, intensity: 5, range: 8 },
  cool: { color: 0xe6eeff, intensity: 7, range: 11 },
  bay: { color: 0xf4efe0, intensity: 12, range: 16 },
  sodium: { color: 0xffae55, intensity: 9, range: 15 },
  flood: { color: 0xf2f6ff, intensity: 28, range: 34 },
  candle: { color: 0xffc070, intensity: 4, range: 9 },
  beacon: { color: 0xff3b2a, intensity: 3, range: 6 },
} satisfies Record<string, Light>;

/* Identification colours (BS 1710): gas yellow ochre, water green-blue, electrical orange (containment) with black
   SWA cable, steam on aluminium-clad lagging. */
export const SVC = {
  conduit: 0xd9d5ca, cable: 0x34383c, gas: 0xe6be2e, water: 0x3d6ea8, steam: 0xd4d8da, copper: 0xb87840,
  transformer: 0x62805c, machine: 0x4d6a86, motor: 0x3f5f7a, cream: 0xf0ebe0, hazard: 0xe8b82a, hydrant: 0xc23a2a,
  orange: 0xd9722b, swa: 0x1f2124, galv: 0xa7adb2, meterBox: 0xe9e4d6,
};

const MAT_TINT: Partial<Record<UtilityKind, number>> = { gas: SVC.gas, water: SVC.water, steam: SVC.steam };

type PipeMat = 'copper' | 'steel' | 'castiron' | 'metal' | 'pvc';

export interface RouteOpts {
  /** round pipe (octagonal hulls / cylinders) instead of square conduit */
  round?: boolean;
  /** cube fitting at each corner (default the run width) */
  elbow?: number;
  maxL?: number;
  /** nominal bore of the run, m (flow and leak area); the drawn width is usually fatter */
  bore?: number;
}

/** Orthogonal service run through `pts` (each leg changes one axis): legs meet cube fittings at the corners,
    the first and last legs end exactly on the end points. */
export function route(mat: MaterialId, pts: Vec3[], w: number, o: PieceOpts = {}, r: RouteOpts = {}): PieceSpec[] {
  const e = r.elbow ?? w, maxL = r.maxL ?? 4.5, h = w / 2;
  const ps: PieceSpec[] = [];
  const last = pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[i + 1];
    const moved = [0, 1, 2].filter((k) => Math.abs(a[k] - b[k]) > 1e-9);
    if (moved.length !== 1) throw new Error(`route: leg ${i} must change exactly one axis`);
    const k = moved[0], d = Math.sign(b[k] - a[k]);
    const s0 = a[k] + (i > 0 ? d * e / 2 : 0), s1 = b[k] - (i + 1 < last ? d * e / 2 : 0);
    const span: Range = [Math.min(s0, s1), Math.max(s0, s1)];
    if (span[1] - span[0] < 0.05) throw new Error(`route: leg ${i} is shorter than its fittings`);
    if (r.round) {
      ps.push(...pipeRun(mat as PipeMat, (['x', 'y', 'z'] as const)[k], span, a, w, o, maxL));
      continue;
    }
    for (const s of splitRange(span[0], span[1], maxL)) {
      const rng = [0, 1, 2].map((j) => (j === k ? s : [a[j] - h, a[j] + h])) as [Range, Range, Range];
      ps.push(block(mat, rng[0], rng[1], rng[2], o));
    }
  }
  for (let i = 1; i < last; i++) {
    const c = pts[i];
    const f = block(mat, [c[0] - e / 2, c[0] + e / 2], [c[1] - e / 2, c[1] + e / 2], [c[2] - e / 2, c[2] + e / 2], o);
    if (o.util) f.svcPart = 'fitting';
    ps.push(f);
  }
  if (r.bore !== undefined) for (const p of ps) p.bore = r.bore;
  return ps;
}

/** Square PVC / steel conduit carrying power. */
export function conduit(pts: Vec3[], o: PieceOpts = {}, w = 0.08, mat: MaterialId = 'pvc', maxL = 4.5): PieceSpec[] {
  return route(mat, pts, w, { tint: mat === 'pvc' ? SVC.conduit : SVC.cable, ...o, util: 'power' }, { maxL });
}

/** Round service pipe of one kind; elbows are slightly fatter fittings. */
export function pipe(kind: UtilityKind, mat: PipeMat, pts: Vec3[], d: number, o: PieceOpts = {}, bore?: number): PieceSpec[] {
  return route(mat, pts, d, { tint: MAT_TINT[kind] ?? SVC.copper, ...o, util: kind }, { round: true, elbow: d + 0.04, bore });
}

export function lamp(x: Range, y: Range, z: Range, l: Light = LIGHT.warm, o: PieceOpts = {}): PieceSpec {
  const p = block('lamp', x, y, z, { ...o, tint: l.color, fixture: 'lamp' });
  p.light = { ...l };
  return p;
}

/* ---------------- services practice: sizes, supports, sleeves ---------------- */

/** Nominal bores, m: domestic copper 15 / 22 / 28, commercial copper 54, steel 25–150 (gas risers, sprinkler
    mains, steam), cast / ductile iron 100–300 water mains, PE 32–180 (yellow gas, blue water). */
export const BORE = {
  cu15: 0.015, cu22: 0.022, cu28: 0.028, cu54: 0.054, st25: 0.025, st50: 0.05, st80: 0.08, st100: 0.1, st150: 0.15,
  di100: 0.1, di150: 0.15, di300: 0.3, pe32: 0.032, pe63: 0.063, pe180: 0.18,
} as const;

/** Drawn diameter for a bore: pipe wall (and lagging), never under the 0.056 m a run needs for the core to weld it
    (faces must overlap by 0.05 m), so the smallest domestic pipes are drawn a little fat. */
export function drawn(bore: number, lagged = false): number {
  return Math.max(0.056, bore * 1.15 + 0.012 + (lagged ? 0.06 : 0));
}

/** Maximum spacing of supports, m, horizontal / vertical: copper to BS EN 806-4 (15 mm 1.2 / 1.8 up to 54 mm
    2.7 / 3.0), steel 2–3.6, cast iron at every length, PVC / PE pipe and conduit about a metre, cable tray 1.5. */
export function spacing(mat: PipeMat | 'tray' | 'conduit', bore: number): { h: number; v: number } {
  switch (mat) {
    case 'copper': return bore <= 0.015 ? { h: 1.2, v: 1.8 } : bore <= 0.028 ? { h: 1.8, v: 2.4 } : { h: 2.7, v: 3.0 };
    case 'steel': case 'metal': return bore <= 0.025 ? { h: 2.0, v: 2.4 } : bore <= 0.05 ? { h: 2.7, v: 3.0 } : { h: 3.0, v: 3.6 };
    case 'castiron': return { h: 3.0, v: 3.0 };
    case 'tray': return { h: 1.5, v: 1.5 };
    default: return { h: 1.0, v: 1.2 };
  }
}

/** Clips, brackets or drop rods carrying a run through `pts` (drawn diameter `d`) off the surface on `side` of it,
    `gap` beyond the pipe wall, at `space` centres and clear of the fittings. Legs along `side` need none. */
export function supports(pts: Vec3[], d: number, side: Vec3, gap: number, space: { h: number; v: number }, o: PieceOpts = {}, e = d + 0.04): PieceSpec[] {
  const out: PieceSpec[] = [];
  const s = side.findIndex((v) => Math.abs(v) > 0.5), sg = Math.sign(side[s]);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const k = [0, 1, 2].find((j) => Math.abs(a[j] - b[j]) > 1e-9)!;
    if (k === s) continue;
    const dir = Math.sign(b[k] - a[k]);
    const u0 = a[k] + dir * (i > 0 ? e / 2 + 0.06 : 0.06), u1 = b[k] - dir * (i + 2 < pts.length ? e / 2 + 0.06 : 0.06);
    const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
    if (hi - lo < 0.08) continue;
    const n = Math.max(1, Math.ceil((hi - lo) / (k === 1 ? space.v : space.h)));
    const j = 3 - k - s;
    for (let q = 0; q < n; q++) {
      const u = lo + ((q + 0.5) * (hi - lo)) / n;
      const r: [Range, Range, Range] = [[0, 0], [0, 0], [0, 0]];
      r[k] = [u - 0.03, u + 0.03];
      r[j] = [a[j] - d / 2, a[j] + d / 2];
      r[s] = sg > 0 ? [a[s] + d / 2, a[s] + d / 2 + gap] : [a[s] - d / 2 - gap, a[s] - d / 2];
      out.push(block('steel', r[0], r[1], r[2], { tint: SVC.galv, ...o }));
    }
  }
  return out;
}

/** A pipe run clipped to a surface: the service and its supports, the run standing `gap` off the surface on `side`.
    Steel steam lines are lagged; copper heating pipework (the wet system a 'steam' boiler stands for) is not. */
export function clipped(kind: UtilityKind, mat: PipeMat, pts: Vec3[], bore: number, side: Vec3, o: PieceOpts = {}, gap = 0.02): PieceSpec[] {
  const d = drawn(bore, kind === 'steam' && mat === 'steel');
  return [...pipe(kind, mat, pts, d, o, bore), ...supports(pts, d, side, gap, spacing(mat, bore), { group: o.group })];
}

/** Split every axis-aligned box of `ps` that a pipe along `axis` through `at`, over `span` of that axis, passes
    through (wall leaves, linings, cladding) round a square sleeve hole of half-width `r` + 3 cm. */
export function cutSleeve(ps: PieceSpec[], at: Vec3, axis: 'x' | 'z', r: number, span: Range, skip: (p: PieceSpec) => boolean = () => false): PieceSpec[] {
  const k = axis === 'x' ? 0 : 2, u = axis === 'x' ? 2 : 0, h = r + 0.03;
  const out: PieceSpec[] = [];
  for (const p of ps) {
    const lo = p.pos.map((v, i) => v - p.size[i] / 2), hi = p.pos.map((v, i) => v + p.size[i] / 2);
    const through = (p.shape ?? 'box') === 'box' && !p.rotY && !p.util && !p.fixture && !p.mech && !skip(p)
      && at[u] + h > lo[u] && at[u] - h < hi[u] && at[1] + h > lo[1] && at[1] - h < hi[1] && span[1] > lo[k] + 1e-6 && span[0] < hi[k] - 1e-6;
    if (!through) { out.push(p); continue; }
    const parts: [Range, Range][] = [
      [[lo[u], at[u] - h], [lo[1], hi[1]]], [[at[u] + h, hi[u]], [lo[1], hi[1]]],
      [[Math.max(lo[u], at[u] - h), Math.min(hi[u], at[u] + h)], [lo[1], at[1] - h]],
      [[Math.max(lo[u], at[u] - h), Math.min(hi[u], at[u] + h)], [at[1] + h, hi[1]]],
    ];
    for (const [ur, yr] of parts) {
      if (ur[1] - ur[0] < 0.06 || yr[1] - yr[0] < 0.06) continue;
      const x: Range = u === 0 ? ur : [lo[0], hi[0]], z: Range = u === 0 ? [lo[2], hi[2]] : ur;
      const q: PieceSpec = { ...p, size: [x[1] - x[0], yr[1] - yr[0], z[1] - z[0]], pos: [(x[0] + x[1]) / 2, (yr[0] + yr[1]) / 2, (z[0] + z[1]) / 2] };
      delete q.light;
      out.push(trimDetail(q));
    }
  }
  return out;
}

/** Wall-hung combi boiler (steam source standing in for its wet heating) on the inside face `face` of a wall
    along X (`into` +1 / -1 the room side), with its balanced-flue terminal on the outside face `outer`. */
export function combiBoiler(x: Range, y: Range, face: number, into: 1 | -1, outer: number, o: PieceOpts = {}): PieceSpec[] {
  const zin: Range = into > 0 ? [face, face + 0.3] : [face - 0.3, face];
  const cx = (x[0] + x[1]) / 2, fy = y[1] - 0.12;
  const zout: Range = into > 0 ? [outer - 0.12, outer] : [outer, outer + 0.12];
  return [
    block('machine', x, y, zin, { tint: SVC.cream, ...o, fixture: 'boiler' }),
    block('pvc', [cx - 0.08, cx + 0.08], [fy - 0.08, fy + 0.08], zout, { tint: 0xe9e9e4, group: o.group }),
  ];
}

/** Wet-pipe sprinkler installation hung under a roof: a cross main along Z at `main` x feeding ranges along X at
    each of `zs`, pendent heads every `pitch` m (a light-hazard head covers ~9–12 m²) and drop rods to the steel at
    `soffit` wherever `rodAt(x, z)` allows. `feed` is where the riser from the valve set reaches the cross main. */
export function sprinklerRanges(o: { x: Range; zs: number[]; y: number; main: number; soffit: number; pitch?: number; rodAt?: (x: number, z: number) => boolean; group?: string }): PieceSpec[] {
  const bore = BORE.st50, d = drawn(bore), rb = BORE.st25, rd = drawn(rb), pitch = o.pitch ?? 3;
  const g = { group: o.group }, red = { tint: 0xb0302a, group: o.group };
  const zs = [...o.zs].sort((a, b) => a - b);
  // one length for the cross main: a joint where a range tees in would leave the range touching neither half
  const ps: PieceSpec[] = route('steel', [[o.main, o.y, zs[0] - rd / 2 - 0.001], [o.main, o.y, zs[zs.length - 1] + rd / 2 + 0.001]], d,
    { ...red, util: 'water' }, { round: true, elbow: d + 0.04, maxL: 20, bore });
  const rods: Vec3[] = [];
  for (const z of zs) {
    for (const [a, b] of [[o.x[0], o.main - d / 2], [o.main + d / 2, o.x[1]]] as Range[]) {
      if (b - a < 0.4) continue;
      ps.push(...pipe('water', 'steel', [[a, o.y, z], [b, o.y, z]], rd, red, rb));
      const n = Math.max(1, Math.round((b - a) / pitch));
      for (let i = 0; i < n; i++) {
        const x = a + ((i + 0.5) * (b - a)) / n;
        const head = block('copper', [x - 0.03, x + 0.03], [o.y - rd / 2 - 0.08, o.y - rd / 2], [z - 0.03, z + 0.03], { tint: 0xc8a050, ...g, util: 'water' });
        head.svcPart = 'sprinkler';
        head.bore = 0.015;
        ps.push(head);
        for (const xr of [x - pitch / 2 + 0.25, x + 0.35]) if (xr > a + 0.1 && xr < b - 0.1 && (o.rodAt?.(xr, z) ?? true)) rods.push([xr, o.y, z]);
      }
    }
  }
  for (const [x, y, z] of rods) ps.push(block('steel', [x - 0.03, x + 0.03], [y + rd / 2, o.soffit], [z - 0.025, z + 0.025], { tint: SVC.galv, ...g }));
  return ps;
}

/** Flanged gate valve on a pipe of drawn diameter `d` running along `axis` through `at`: body, bolted flanges each end,
    bonnet and handwheel, one casting. Its flange faces are `VALVE_L` apart, centred on `at`; the pipe runs butt them.
    An isolating valve: U on it shuts or opens the line. */
export const VALVE_L = 0.44;
export function flangedValve(kind: UtilityKind, at: Vec3, axis: 'x' | 'z', d: number, bore?: number): PieceSpec {
  // body and flange rims only a little proud of the pipe: valves stand where the pipe runs close to a wall
  const [x, y, z] = at, h = VALVE_L / 2, w = d / 2 + 0.01, R = d / 2 + 0.015;
  const along = (a: number, b: number, cy: number, cz: number, r: number): PieceSpec => {
    const pts: Vec3[] = [];
    for (const e of [a, b]) for (let i = 0; i < 8; i++) {
      const u = r * Math.cos((i + 0.5) * Math.PI / 4), v = r * Math.sin((i + 0.5) * Math.PI / 4);
      pts.push(axis === 'x' ? [e, cy + u, cz + v] : [cz + v, cy + u, e]);
    }
    return hull('castiron', pts);
  };
  const c = axis === 'x' ? x : z, cz = axis === 'x' ? z : x;
  const span = (a: number, b: number): [Range, Range] => (axis === 'x' ? [[a, b], [z - w, z + w]] : [[x - w, x + w], [a, b]]);
  const [bx, bz] = span(c - h + 0.05, c + h - 0.05);
  const v = weldParts([
    block('castiron', bx, [y - w, y + w], bz),
    along(c - h, c - h + 0.05, y, cz, R), along(c + h - 0.05, c + h, y, cz, R),
    block('castiron', axis === 'x' ? [x - w * 0.6, x + w * 0.6] : [x - w * 0.6, x + w * 0.6], [y + w, y + w + 0.25], axis === 'x' ? [z - w * 0.6, z + w * 0.6] : [z - w * 0.6, z + w * 0.6]),
    cyl('castiron', Math.min(2.4 * d, 0.38), [y + w + 0.25, y + w + 0.3], x, z),
  ], { tint: kind === 'gas' ? SVC.gas : kind === 'water' ? SVC.hydrant : 0x4a4f53, finish: 'satin', util: kind, svcPart: 'valve' });
  if (bore !== undefined) v.bore = bore;
  return v;
}

/* ---------------- fixtures ---------------- */

/** Consumer unit / meter cabinet: the building's power supply point (a source), wall-hung. */
export function supplyBox(x: Range, y: Range, z: Range, o: PieceOpts = {}): PieceSpec {
  return block('machine', x, y, z, { tint: SVC.transformer, ...o, fixture: 'transformer' });
}

export function gasMeter(x: Range, y: Range, z: Range, o: PieceOpts = {}): PieceSpec {
  return block('machine', x, y, z, { tint: SVC.gas, ...o, fixture: 'gasmain' });
}

export function stopcock(x: Range, y: Range, z: Range, o: PieceOpts = {}): PieceSpec {
  return block('castiron', x, y, z, { tint: SVC.water, ...o, fixture: 'watermain' });
}

export function wallBoiler(x: Range, y: Range, z: Range, o: PieceOpts = {}): PieceSpec {
  return block('machine', x, y, z, { tint: SVC.cream, ...o, fixture: 'boiler' });
}

export function radiatorPanel(x: Range, y: Range, z: Range, o: PieceOpts = {}): PieceSpec {
  return block('castiron', x, y, z, { tint: 0xeeebe4, ...o, fixture: 'radiator' });
}

/** Street fire hydrant on the water main (source): barrel, cap and outlet. */
export function hydrant(x: number, z: number): PieceSpec[] {
  const red = { tint: SVC.hydrant };
  return [
    cyl('castiron', 0.32, [0, 0.72], x, z, { ...red, fixture: 'watermain' }),
    cyl('castiron', 0.4, [0.72, 0.82], x, z, { ...red, util: 'water' }),
    block('castiron', [x + 0.163, x + 0.33], [0.42, 0.56], [z - 0.07, z + 0.07], { ...red, util: 'water' }),
  ];
}

/** Pad-mounted transformer: plinth, oil tank (source), cooling fins and three bushings joined by a busbar.
    Feed runs attach to the busbar ends (local x ±0.7 at y 2.3..2.4) or the tank faces. */
export function groundTransformer(scale = 1): PieceSpec[] {
  const g = { tint: SVC.transformer };
  const s = (v: number) => v * scale;
  const ps: PieceSpec[] = [
    block('concrete', [s(-1.1), s(1.1)], [0, 0.2], [s(-0.85), s(0.85)], { tint: 0xa6a6a0 }),
    // the oil tank and its welded radiator banks are one body
    weldParts([
      block('machine', [s(-0.8), s(0.8)], [0.2, 0.2 + s(1.7)], [s(-0.55), s(0.55)], { ...g, fixture: 'transformer' }),
      block('machine', [s(-0.7), s(0.7)], [0.35, 0.2 + s(1.5)], [s(0.55), s(0.7)], g),
      block('machine', [s(-0.7), s(0.7)], [0.35, 0.2 + s(1.5)], [s(-0.7), s(-0.55)], g),
    ]),
  ];
  const top = 0.2 + s(1.7);
  for (const x of [-0.5, 0, 0.5]) ps.push(cyl('ceramic', 0.14, [top, top + 0.4], s(x), 0, { tint: 0x8a5a44, util: 'power' }));
  ps.push(block('copper', [s(-0.7), s(0.7)], [top + 0.4, top + 0.5], [-0.07, 0.07], { tint: SVC.copper, util: 'power' }));
  return ps;
}

/** Diesel standby set on a skid: engine, alternator (source), radiator and exhaust stack. */
export function generatorSet(): PieceSpec[] {
  const m = { tint: 0xd9a431 };
  return [
    block('steel', [-1.4, 1.4], [0, 0.2], [-0.6, 0.6], { tint: 0x3a3d40 }),
    block('machine', [-1.2, 0.3], [0.2, 1.3], [-0.5, 0.5], m),
    block('machine', [0.3, 1.25], [0.2, 1.15], [-0.45, 0.45], { ...m, fixture: 'generator' }),
    block('metal', [-1.4, -1.2], [0.2, 1.3], [-0.55, 0.55], { tint: 0x5b5f63 }),
    cyl('steel', 0.18, [1.3, 2.4], -0.7, 0.2, { tint: 0x5b5f63 }),
  ];
}

/** Standby generator in its acoustic enclosure (a power source behind an automatic transfer switch): it starts when
    the bus its lead reaches goes dead and hands back when the supply returns. */
export function standbySet(x: Range, y: Range, z: Range, o: PieceOpts = {}): PieceSpec {
  return { ...block('machine', x, y, z, { tint: 0x5f7f5a, finish: 'satin', ...o, fixture: 'generator' }), standby: true };
}

/** Maintained emergency luminaire: a lamp with its own battery that stays lit (dimmer) for `hours` after the supply fails. */
export function emergencyLamp(x: Range, y: Range, z: Range, l: Light = LIGHT.cool, hours = 3, o: PieceOpts = {}): PieceSpec {
  return { ...lamp(x, y, z, l, o), emergency: hours };
}

/* ---------------- lighting ---------------- */

/** Street lamp on its own feeder cabinet: footing, column, arm (all live) and a sodium lantern at the arm end (+X). */
export function streetLamp(h = 6, arm = 1.3, l: Light = LIGHT.sodium): PieceSpec[] {
  const col = { tint: 0x4a5055, util: 'power' as const };
  return [
    block('concrete', [-0.3, 0.3], [0, 0.3], [-0.3, 0.3], { tint: 0x9a9a96 }),
    block('machine', [0.09, 0.42], [0.3, 1.1], [-0.17, 0.17], { tint: SVC.transformer, fixture: 'transformer' }),
    ...splitRange(0.3, h, 3).map((y) => cyl('steel', 0.18, y, 0, 0, col)),
    block('steel', [-0.12, arm], [h, h + 0.12], [-0.08, 0.08], col),
    lamp([arm - 0.42, arm], [h - 0.2, h], [-0.16, 0.16], l),
  ];
}

/** Floodlight mast: feeder cabinet, tubular mast, head frame and a bank of lamps facing +Z. */
export function floodMast(h = 16, heads = 3, l: Light = LIGHT.flood): PieceSpec[] {
  const col = { tint: 0x8d949b, util: 'power' as const };
  const ps: PieceSpec[] = [
    block('concrete', [-0.7, 0.7], [0, 0.4], [-0.7, 0.7], { tint: 0x9a9a96 }),
    block('machine', [0.26, 0.7], [0.4, 1.5], [-0.3, 0.3], { tint: SVC.transformer, fixture: 'transformer' }),
    ...splitRange(0.4, h, 5.5).map((y) => cyl('steel', 0.5, y, 0, 0, col)),
  ];
  const w = heads * 0.7 / 2;
  ps.push(block('steel', [-w - 0.1, w + 0.1], [h, h + 0.2], [-0.3, 0.3], col));
  ps.push(block('steel', [-w - 0.1, w + 0.1], [h + 0.2, h + 1.3], [0.2, 0.32], col));
  for (let i = 0; i < heads; i++) {
    const x = -w + 0.35 + i * 0.7;
    for (const y of [h + 0.25, h + 0.8]) ps.push(lamp([x - 0.3, x + 0.3], [y, y + 0.45], [0.32, 0.52], l));
  }
  return ps;
}

/** Floor panels between seam lines with a rectangular hole cut out of whichever panel holds it (service risers). */
export function holedPanels(mat: MaterialId, xs: number[], y: Range, zs: number[], holes: { x: Range; z: Range } | { x: Range; z: Range }[], o: PieceOpts = {}): PieceSpec[] {
  const out: PieceSpec[] = [];
  const list = Array.isArray(holes) ? holes : [holes];
  const add = (x: Range, z: Range) => { if (x[1] - x[0] > 1e-6 && z[1] - z[0] > 1e-6) out.push(block(mat, x, y, z, o)); };
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const x: Range = [xs[i], xs[i + 1]], z: Range = [zs[j], zs[j + 1]];
      const hole = list.find((h) => h.x[0] >= x[0] - 1e-9 && h.x[1] <= x[1] + 1e-9 && h.z[0] >= z[0] - 1e-9 && h.z[1] <= z[1] + 1e-9);
      if (!hole) { add(x, z); continue; }
      const hx = hole.x, hz = hole.z;
      // a hole on a z edge keeps the panel whole beyond it, leaving only short strips beside the hole
      if (Math.abs(hz[0] - z[0]) < 1e-9 || Math.abs(hz[1] - z[1]) < 1e-9) {
        add(x, [z[0], hz[0]]);
        add(x, [hz[1], z[1]]);
        add([x[0], hx[0]], hz);
        add([hx[1], x[1]], hz);
        continue;
      }
      add([x[0], hx[0]], z);
      add([hx[1], x[1]], z);
      add(hx, [z[0], hz[0]]);
      add(hx, [hz[1], z[1]]);
    }
  }
  return out;
}

/** Chandelier / pendant: a live drop rod from a ceiling rose to the lamp, and a chain from the rose that
    keeps the fitting dangling (dark) once the rod snaps. `ceiling` is the underside it hangs from. */
export function pendant(x: number, z: number, ceiling: number, drop: number, l: Light = LIGHT.warm, size = 0.36): PieceSpec[] {
  const rose = block('pvc', [x - 0.12, x + 0.12], [ceiling - 0.08, ceiling], [z - 0.12, z + 0.12], { tint: SVC.cream, util: 'power' });
  const y1 = ceiling - 0.08 - drop;
  const fitting = lamp([x - size / 2, x + size / 2], [y1 - size * 0.6, y1], [z - size / 2, z + size / 2], l);
  rose.ropeTo = { end: [...fitting.pos], slack: 0.15, strength: 6e3, kind: 'chain' };
  return [rose, block('steel', [x - 0.04, x + 0.04], [y1, ceiling - 0.08], [z - 0.04, z + 0.04], { tint: 0x9a8a6a, util: 'power' }), fitting];
}

/* ---------------- machinery ----------------
   Moving parts keep >= 0.06 m from everything they do not ride on: nearer than the solver's speculative
   contact distance, a running part would join the building's island and keep the whole building awake. */

/** Convex disc (n-gon) with its axis along X or Z, for flywheels, pulleys, wheels and rotors. */
export function disc(mat: MaterialId, axis: 'x' | 'z', c: Vec3, r: number, t: number, o: PieceOpts = {}, n = 16): PieceSpec {
  const pts: Vec3[] = [];
  for (const s of [-t / 2, t / 2]) {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (i + 0.5)) / n, u = r * Math.cos(a), v = r * Math.sin(a);
      pts.push(axis === 'x' ? [c[0] + s, c[1] + v, c[2] + u] : [c[0] + u, c[1] + v, c[2] + s]);
    }
  }
  return hull(mat, pts, o);
}

function hinge(p: PieceSpec, at: Vec3, axis: Vec3, speed: number, force: number, always = false): PieceSpec {
  p.noWeld = true;
  p.mech = { kind: 'hinge', at, axis, motor: { speed, force, ...(always ? { always } : {}) } };
  return p;
}

/** Rooftop air handler: casing, fan motor (consumer) and a two-blade rotor on a vertical hinge above it.
    A live lead runs from the motor across the casing top and down its +X end to local (1.1, 0, 0). */
export function hvacUnit(o: PieceOpts = {}): PieceSpec[] {
  const casing = { tint: 0xc9ccc8, ...o };
  const rotor = block('aluminum', [-0.72, 0.72], [1.66, 1.74], [-0.11, 0.11], { tint: 0x55595d, group: o.group });
  return [
    block('machine', [-1.0, 1.0], [0, 1.2], [-0.8, 0.8], casing),
    block('metal', [-1.0, 1.0], [1.2, 1.28], [-0.8, -0.72], casing),
    block('machine', [-0.25, 0.25], [1.2, 1.6], [-0.25, 0.25], { tint: SVC.motor, ...o, fixture: 'motor' }),
    ...conduit([[0.25, 1.24, 0], [1.04, 1.24, 0], [1.04, 0, 0]], o),
    hinge(rotor, [0, 1.5, 0], [0, 1, 0], 7, 600),
  ];
}

/** Wall extractor fan: motor (consumer) bolted to a wall face at z = 0 and a blade turning in front of it
    about the wall normal. Feed the motor from its sides (local x ±0.25). */
export function wallFan(size = 1.4, o: PieceOpts = {}): PieceSpec[] {
  const blade = block('aluminum', [-size / 2, size / 2], [-0.12, 0.12], [0.38, 0.46], { tint: 0x55595d, group: o.group });
  return [
    block('machine', [-0.25, 0.25], [-0.25, 0.25], [0, 0.32], { tint: SVC.motor, ...o, fixture: 'motor' }),
    hinge(blade, [0, 0, 0.2], [0, 0, 1], 9, 400),
  ];
}

/** Belt-drive flywheel set: plinth, motor (consumer), bearing pedestal and a flywheel turning about X. */
export function flywheelDrive(r = 0.75, o: PieceOpts = {}): PieceSpec[] {
  const iron = { tint: 0x3c4044, ...o };
  const cy = 0.35 + r + 0.05;
  const wheel = disc('castiron', 'x', [0.54, cy, 0], r, 0.24, { tint: 0x2f3336, group: o.group });
  return [
    block('concrete', [-1.3, 1.0], [0, 0.3], [-r - 0.1, r + 0.1], { tint: 0x9a9a96, ...o }),
    block('machine', [-1.2, -0.2], [0.3, 1.1], [-0.42, 0.42], { tint: SVC.motor, ...o, fixture: 'motor' }),
    block('castiron', [-0.2, 0.36], [0.3, cy + 0.2], [-0.25, 0.25], iron),
    hinge(wheel, [0.26, cy, 0], [1, 0, 0], 4, 1500),
  ];
}

/** Power press: bed, two columns, crown, drive motor (consumer) and a shuttling ram on a vertical slider. */
export function press(o: PieceOpts = {}): PieceSpec[] {
  const iron = { tint: 0x5a6e5a, ...o };
  const ram = block('steel', [-0.48, 0.48], [1.9, 2.94], [-0.35, 0.35], { tint: 0x8d949b, group: o.group, noWeld: true });
  ram.mech = { kind: 'slider', at: [0, 3.1, 0], axis: [0, 1, 0], lower: -0.25, upper: 0, motor: { speed: 0.4, force: 4e4, shuttle: true } };
  return [
    block('castiron', [-0.85, 0.85], [0, 0.9], [-0.6, 0.6], iron),
    block('steel', [-0.4, 0.4], [0.9, 1.05], [-0.3, 0.3], { tint: 0x3c4044, ...o }),
    block('castiron', [-0.85, -0.55], [0.9, 3.0], [-0.4, 0.4], iron),
    block('castiron', [0.55, 0.85], [0.9, 3.0], [-0.4, 0.4], iron),
    block('castiron', [-0.95, 0.95], [3.0, 3.6], [-0.5, 0.5], iron),
    block('machine', [-0.45, 0.45], [3.6, 4.1], [-0.35, 0.35], { tint: SVC.motor, ...o, fixture: 'motor' }),
    ram,
  ];
}

/** Powered roller conveyor along +X from 0 to len: side rails on legs, a drive motor (consumer) on the +Z rail
    and rollers hinged to that rail. */
export function conveyor(len: number, o: PieceOpts = {}): PieceSpec[] {
  const st = { tint: 0x6d7479, ...o };
  const ps: PieceSpec[] = [];
  for (const z of [[-0.56, -0.46], [0.46, 0.56]] as Range[]) {
    ps.push(...splitRange(0, len, 4.5).map((x) => block('steel', x, [0.7, 0.85], z, st)));
    for (const x of [0.1, len - 0.1]) ps.push(block('steel', [x - 0.08, x + 0.08], [0, 0.7], z, st));
  }
  ps.push(block('machine', [len / 2 - 0.3, len / 2 + 0.3], [0.35, 0.85], [0.56, 0.9], { tint: SVC.motor, ...o, fixture: 'motor' }));
  const n = Math.max(2, Math.floor((len - 0.3) / 0.5));
  for (let i = 0; i < n; i++) {
    const x = 0.3 + (i * (len - 0.6)) / (n - 1);
    const roller = hull('steel', octagonZ(x, 0.8, [-0.4, 0.4], 0.1), { tint: 0xa8adb0, group: o.group });
    ps.push(hinge(roller, [x, 0.8, 0.5], [0, 0, 1], 3, 60));
  }
  return ps;
}

function octagonZ(x: number, y: number, z: Range, r: number): Vec3[] {
  const pts: Vec3[] = [];
  for (const zz of z) for (let i = 0; i < 8; i++) pts.push([x + r * Math.cos((i + 0.5) * Math.PI / 4), y + r * Math.sin((i + 0.5) * Math.PI / 4), zz]);
  return pts;
}

/** Passenger lift against a wall face at z = 0 (wall behind, -Z): live guide rail, winding motor (consumer) at the head,
    and a car on a shuttling vertical slider hung from the winder by its hoist rope. Cut the rope and it drops. */
export function lift(y0: number, travel: number, o: PieceOpts = {}): PieceSpec[] {
  const top = y0 + travel + 2.6;
  const car = block('metal', [-0.65, 0.65], [y0 + 0.06, y0 + 2.2], [0.18, 1.4], { tint: 0xb9bdc0, group: o.group, noWeld: true });
  const winder = block('machine', [-0.35, 0.35], [top, top + 0.55], [0, 0.55], { tint: SVC.motor, ...o, fixture: 'motor' });
  car.mech = { kind: 'slider', at: [0, y0 + 1.1, 0.06], axis: [0, 1, 0], lower: 0, upper: travel, motor: { speed: 1.2, force: 6e4, shuttle: true } };
  car.ropeTo = { end: [...winder.pos], slack: 0.1, strength: 9e4 };
  return [
    ...splitRange(y0, top, 8).map((y) => block('steel', [-0.08, 0.08], y, [0, 0.12], { tint: 0x6d7479, ...o, util: 'power' })),
    winder,
    car,
  ];
}

/** Undershot mill wheel between two stone piers, turning about Z (always driven by the race). */
export function waterwheel(r = 2.2, o: PieceOpts = {}): PieceSpec[] {
  const stone = { tint: 0xd8cdb4, ...o };
  const cy = r + 0.3;
  const wheel = disc('oak', 'z', [0, cy, 0], r, 1.0, { tint: 0x6e5238, group: o.group }, 12);
  return [
    block('stone', [-0.55, 0.55], [0, cy + 0.5], [0.56, 1.2], stone),
    block('stone', [-0.55, 0.55], [0, cy + 0.5], [-1.2, -0.56], stone),
    hinge(wheel, [0, cy, 0.8], [0, 0, 1], 0.5, 3e4, true),
  ];
}

/** Two-blade wind turbine: footing, tapering tower, nacelle (generator source) with a beacon, rotor on a
    horizontal hinge facing +Z, always turning slowly. */
export function windTurbine(h = 24, span = 16, o: PieceOpts = {}): PieceSpec[] {
  const white = { tint: 0xeef0ee, ...o };
  const ps: PieceSpec[] = [prism('concrete', 4.0, [0, 0.6], 0, 0, 8, { tint: 0x9a9a96, ...o })];
  const segs = splitRange(0.6, h, 6);
  segs.forEach((y, i) => ps.push(cyl('steel', 1.8 - (0.4 * i) / Math.max(1, segs.length - 1), y, 0, 0, white)));
  ps.push(block('machine', [-0.8, 0.8], [h, h + 1.6], [-1.4, 2.2], { ...white, fixture: 'generator' }));
  ps.push(lamp([-0.18, 0.18], [h + 1.6, h + 1.85], [-1.2, -0.84], LIGHT.beacon, o));
  const rotor = block('aluminum', [-span / 2, span / 2], [h + 0.45, h + 1.15], [2.26, 2.4], { tint: 0xf4f5f3, group: o.group });
  ps.push(hinge(rotor, [0, h + 0.8, 2.1], [0, 0, 1], 1.1, 1.2e4, true));
  return ps;
}

/* ---------------- lines & rigging ---------------- */

/** Timber utility pole with a crossarm (at local +Z) and three insulators; returns the insulator centres. */
export function utilityPole(x: number, z: number, h = 9, o: PieceOpts = {}): { ps: PieceSpec[]; tips: Vec3[] } {
  const oak = { tint: 0x6a5038, ...o };
  const ps: PieceSpec[] = splitRange(0, h, 4.6).map((y) => cyl('oak', 0.3, y, x, z, oak));
  const arm: Range = [h - 0.5, h - 0.35];
  ps.push(block('oak', [x - 1.1, x + 1.1], arm, [z + 0.154, z + 0.3], oak));
  const tips: Vec3[] = [];
  for (const dx of [-0.9, 0, 0.9]) {
    const ins = cyl('ceramic', 0.1, [arm[1], arm[1] + 0.2], x + dx, z + 0.24, { tint: 0x8a5a44, ...o });
    ps.push(ins);
    tips.push([...ins.pos]);
  }
  return { ps, tips };
}

/** Overhead line: poles along a straight path with two conductors per span (wire ropes; the lines themselves are
    not part of any building network). Returns poles and spans. */
export function poleLine(pts: [number, number][], h = 9, o: PieceOpts = {}): PieceSpec[] {
  const poles = pts.map(([x, z]) => utilityPole(x, z, h, o));
  const ps = poles.flatMap((p) => p.ps);
  for (let i = 0; i + 1 < poles.length; i++) {
    const ins = poles[i].ps.slice(-3);
    for (const k of [0, 2]) {
      ins[k].ropeTo = { end: [...poles[i + 1].tips[k]], slack: 0.7, strength: 900, kind: 'wire' };
    }
  }
  return ps;
}

/** Guy wire from a fitting on a mast to a ground anchor block (both welded); returns [fitting, anchor]. */
export function guy(from: Vec3, to: [number, number], fitting = 0.24, o: PieceOpts = {}): PieceSpec[] {
  const f = box('steel', [fitting, fitting, fitting], from, { tint: 0x5b5f63, ...o });
  const a = block('concrete', [to[0] - 0.3, to[0] + 0.3], [0, 0.35], [to[1] - 0.3, to[1] + 0.3], { tint: 0x9a9a96, ...o });
  f.ropeTo = { end: [...a.pos], slack: 0.05, strength: 6e4 };
  return [f, a];
}

/** Horizontal fire-tube boiler (steam source) on a brick hearth: saddles, shell, firebox with door plate, steam dome
    and a capped flue stub. Steam leaves the dome's +Z face (local x 0.81, y 1.9); gas feeds the door plate front
    (local z 0.82, y 0.38..0.62). */
export function boilerSet(): PieceSpec[] {
  const iron = { tint: 0x3c4044 }, red = { tint: 0xb0493a };
  return [
    block('brick', [-1.25, 1.25], [0, 0.28], [-0.75, 0.75], { tint: 0xa98474 }),
    block('castiron', [-0.95, -0.7], [0.28, 0.65], [-0.52, 0.52], iron),
    block('castiron', [0.7, 0.95], [0.28, 0.65], [-0.52, 0.52], iron),
    ...pipeRun('castiron', 'x', [-1.08, 1.08], [0, 1.23, 0], 1.16, { ...iron, fixture: 'boiler' }),
    block('steel', [-1.18, -1.08], [0.82, 1.62], [-0.48, 0.48], { ...red, util: 'steam' }),
    block('steel', [1.08, 1.18], [0.82, 1.62], [-0.48, 0.48], { ...red, util: 'steam' }),
    block('brick', [-0.55, 0.55], [0.28, 0.64], [0.42, 0.72], { tint: 0x6d625c }),
    block('steel', [-0.35, 0.35], [0.38, 0.62], [0.72, 0.82], iron),
    block('steel', [0.66, 0.96], [1.81, 1.99], [-0.15, 0.15], { ...red, util: 'steam' }),
    ...pipeRun('steel', 'y', [1.99, 2.68], [0.81, 0, 0], 0.28, red),
    cyl('steel', 0.44, [2.68, 2.8], 0.81, 0, red),
  ];
}

/** Pump set: plinth, pump casing (water) and its drive motor (consumer) on the casing's +Z side. */
export function pumpSet(o: PieceOpts = {}): PieceSpec[] {
  return [
    block('concrete', [-0.6, 0.6], [0, 0.25], [-0.45, 1.5], { tint: 0x9a9a96, ...o }),
    cyl('castiron', 0.7, [0.25, 1.1], 0, 0, { tint: SVC.water, ...o, util: 'water' }),
    block('machine', [-0.35, 0.35], [0.25, 0.95], [0.357, 1.35], { tint: SVC.motor, ...o, fixture: 'motor' }),
  ];
}
