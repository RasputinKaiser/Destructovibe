import type { Blueprint, FixtureKind, PieceSpec, UtilityKind, Vec3 } from '../types.ts';
import { block, cyl, place, raise, splitRange, tag, wallRun, type PieceOpts, type Range } from './kit.ts';
import { COVER, DPC } from '../terrain/spec.ts';
import { BORE, guy, lamp, LIGHT, route, SVC } from './services.ts';
import { trimDetail } from './layers.ts';
import { pieceAabb, pieceSolid, penetration, wouldWeld, type Aabb } from './validate.ts';
import { switchgear, waterPumps, isolatorOf, type Feed } from './machines.ts';
import type { Placement } from './structures.ts';

/* Site utility grid: buried mains, overhead lines, street lighting and the service entries that tie every building
   into them. Mains lie in the ground at their real cover (LV 0.5 m, gas 0.75 m, water 0.95 m, steam 1.3 m to the
   crown), in the verge order of NJUG practice (power nearest the plots, then water, then gas); their depths differ
   enough that crossings pass clear of each other. They are welded to the ground anchor and do not touch the
   terrain (terrain.ts), which also shields them from blasts until a crater opens it. Lamp columns, signals, hydrants,
   meter boxes and risers come up through the surface. A building's own intake stops being a source
   (Placement.gridFed, or `unsource` here) and a service tail is sleeved through its wall to reach the grid: power
   from an overhead drop to an external service head (or a buried cable), gas up into an external meter box at the
   foot of the wall (its excess-flow valve the building's gas gate), water to a stopcock inside. */

type Kind = UtilityKind;
type P2 = [number, number];

export interface MainSpec { d: number; mat: 'pvc' | 'castiron' | 'steel'; tint: number; bore: number }
/** LV cable in a black duct, a 180 mm (SDR 11, 147 mm bore) yellow PE gas main, a 200 mm cast-iron water main, a lagged
    150 mm steam main. */
export const MAIN: Record<Kind, MainSpec> = {
  power: { d: 0.14, mat: 'pvc', tint: 0x2b2b2b, bore: 0.1 },
  gas: { d: 0.18, mat: 'pvc', tint: SVC.gas, bore: 0.147 },
  water: { d: 0.24, mat: 'castiron', tint: SVC.water, bore: 0.2 },
  steam: { d: 0.22, mat: 'steel', tint: SVC.steam, bore: BORE.st150 },
};
/** service tails from a main into a building: 32 mm yellow PE gas, 25 mm blue MDPE water, 50 mm steel steam */
const TAIL: Record<Kind, MainSpec> = {
  power: { d: 0.1, mat: 'pvc', tint: 0x2b2b2b, bore: 0.05 },
  gas: { d: 0.1, mat: 'pvc', tint: SVC.gas, bore: BORE.pe32 },
  water: { d: 0.1, mat: 'pvc', tint: SVC.water, bore: 0.025 },
  steam: { d: 0.14, mat: 'steel', tint: SVC.steam, bore: BORE.st50 },
};
/** what an intake becomes once the grid feeds it: the consumer unit's MCBs / RCD, the meter's EFV, the stopcock */
const INTAKE: Record<Kind, 'breaker' | 'efv' | 'valve' | undefined> = { power: 'breaker', gas: 'efv', water: 'valve', steam: undefined };
/** centre height of a main of `kind` (its tails run at the same height, so they meet its side face) */
export const depthOf = (k: Kind): number => -(COVER[k] + MAIN[k].d / 2);

export interface Seg { kind: Kind; axis: 'x' | 'z'; at: number; from: number; to: number; half: number; top: number }

const SOURCE_FIXTURES: ReadonlySet<FixtureKind> = new Set(['transformer', 'generator', 'gasmain', 'watermain', 'boiler']);
const KIND_OF: Record<FixtureKind, Kind> = {
  transformer: 'power', generator: 'power', gasmain: 'gas', watermain: 'water', boiler: 'steam', lamp: 'power', radiator: 'steam', motor: 'power',
};
export const kindOf = (p: PieceSpec): Kind | undefined => p.util ?? (p.fixture ? KIND_OF[p.fixture] : undefined);

/** former building intakes (unsourced here, or by Placement.gridFed) — the points a grid entry should start from */
export const intakes = new WeakSet<PieceSpec>();

/** Turn a building's own supply points of these kinds into plain members, to be fed from the grid. */
export function unsource(ps: PieceSpec[], kinds: Kind[]): PieceSpec[] {
  for (const q of ps) {
    if (q.fixture && SOURCE_FIXTURES.has(q.fixture) && kinds.includes(KIND_OF[q.fixture])) {
      q.util = KIND_OF[q.fixture];
      delete q.fixture;
      if (INTAKE[q.util]) q.svcPart = INTAKE[q.util];
      intakes.add(q);
    } else if (!q.fixture && q.util === 'power' && q.mat === 'machine' && kinds.includes('power')) { q.svcPart ??= 'breaker'; intakes.add(q); }
  }
  return ps;
}

/** Same-kind member networks of a building (AABB face contact), largest first. */
export function networks(ps: PieceSpec[], kind: Kind): PieceSpec[][] {
  const list = ps.filter((q) => kindOf(q) === kind && !q.noWeld);
  const bx = list.map(pieceAabb), parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (wouldWeld(bx[i], bx[j])) parent[find(i)] = find(j);
  const nets = new Map<number, PieceSpec[]>();
  list.forEach((q, i) => { const r = find(i); (nets.get(r) ?? nets.set(r, []).get(r)!).push(q); });
  return [...nets.values()].sort((a, b) => b.length - a.length);
}

/* piece specs are not mutated once made: their bounds are worked out once (routing asks for them thousands of times) */
const bounds = new WeakMap<PieceSpec, Aabb>();
const aabbOf = (p: PieceSpec): Aabb => { let b = bounds.get(p); if (!b) { b = pieceAabb(p); bounds.set(p, b); } return b; };

const inflate = (b: Aabb, r: number): Aabb => ({ min: [b.min[0] - r, b.min[1] - r, b.min[2] - r], max: [b.max[0] + r, b.max[1] + r, b.max[2] + r] });
const hit = (a: Aabb, b: Aabb) => [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
const boxOf = (x: Range, y: Range, z: Range): Aabb => ({ min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] });

/* ---------------- the grid ---------------- */

export class SiteGrid {
  ps: PieceSpec[] = [];
  segs: Seg[] = [];
  /** pole crossarms, the ends of overhead service drops */
  arms: PieceSpec[] = [];
  group = 'grid';
  /** why the last groundTail failed */
  why = '';
  /** the ground surface where things come up through it (the site's terrain) */
  ground: (x: number, z: number) => number = () => 0;
  /** tails stay inside ±bound */
  bound = 63.5;
  /** valve positions on the mains, for the surface boxes over them */
  valveAt: { x: number; z: number; kind: Kind }[] = [];

  private add(ps: PieceSpec[], group = this.group): PieceSpec[] {
    this.ps.push(...tag(ps, { group }));
    return ps;
  }

  /** A main along waypoints (each leg along X or Z) at its cover depth. Valves split it into lengths with a cast
      valve body (a surface box over it). `rise` starts it with a riser up to that height at the first waypoint: the
      tail of a plant whose outlet face the riser touches. */
  main(kind: Kind, pts: P2[], o: { valves?: P2[]; group?: string; rise?: number } = {}): PieceSpec[] {
    const m = MAIN[kind], y0 = depthOf(kind), half = m.d / 2;
    const path: Vec3[] = [[pts[0][0], y0, pts[0][1]]];
    if (o.rise !== undefined) path.unshift([pts[0][0], o.rise, pts[0][1]]);
    const legs: Seg[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const axis: 'x' | 'z' = Math.abs(bx - ax) > 1e-9 ? 'x' : 'z';
      path.push([bx, y0, bz]);
      legs.push({ kind, axis, at: axis === 'x' ? az : ax, from: Math.min(axis === 'x' ? ax : az, axis === 'x' ? bx : bz), to: Math.max(axis === 'x' ? ax : az, axis === 'x' ? bx : bz), half, top: y0 + half });
    }
    const clean = path.filter((p, i) => i === 0 || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]) > 1e-6);
    const opts = { tint: m.tint, util: kind };
    const ro = { round: true, elbow: m.d + 0.04, maxL: 14, bore: m.bore };
    const out: PieceSpec[] = [];
    // split at valves: each valve sits on a ground leg, the pipe ends butt its faces
    const vl = 0.36, vw = m.d + 0.12;
    let cur: Vec3[] = [clean[0]];
    const valves = [...(o.valves ?? [])];
    for (let i = 1; i < clean.length; i++) {
      const a = clean[i - 1], b = clean[i];
      const onLeg = valves.filter(([vx, vz]) => a[1] === y0 && b[1] === y0 && between(a, b, [vx, y0, vz]));
      onLeg.sort((p, q) => dist2(a, [p[0], y0, p[1]]) - dist2(a, [q[0], y0, q[1]]));
      for (const [vx, vz] of onLeg) {
        const k = Math.abs(b[0] - a[0]) > 1e-9 ? 0 : 2, dir = Math.sign(b[k] - a[k]);
        const v: Vec3 = [vx, y0, vz];
        const e0: Vec3 = [...v]; e0[k] -= dir * vl / 2;
        const e1: Vec3 = [...v]; e1[k] += dir * vl / 2;
        cur.push(e0);
        out.push(...route(m.mat, cur, m.d, opts, ro));
        const vx0: Range = k === 0 ? [vx - vl / 2, vx + vl / 2] : [vx - vw / 2, vx + vw / 2];
        const vz0: Range = k === 0 ? [vz - vw / 2, vz + vw / 2] : [vz - vl / 2, vz + vl / 2];
        const valve = block('castiron', vx0, [y0 - half - 0.05, y0 + half + 0.05], vz0, { tint: m.tint, util: kind });
        valve.svcPart = 'valve';
        valve.bore = m.bore;
        out.push(valve);
        this.valveAt.push({ x: vx, z: vz, kind });
        cur = [e1];
      }
      cur.push(b);
    }
    out.push(...route(m.mat, cur, m.d, opts, ro));
    this.segs.push(...legs);
    return this.add(out, o.group);
  }

  /** Fire hydrant standing against a water main leg, on the given side of it, its barrel rising through the surfacing. */
  hydrant(x: number, z: number, axis: 'x' | 'z', side: 1 | -1): PieceSpec[] {
    const r = MAIN.water.d / 2 + 0.15;
    const [cx, cz] = axis === 'x' ? [x, z + side * r] : [x + side * r, z];
    const y = this.ground(cx, cz), red = { tint: SVC.hydrant, util: 'water' as const };
    return this.add([
      cyl('castiron', 0.3, [depthOf('water') - MAIN.water.d / 2, y + 0.74], cx, cz, red),
      cyl('castiron', 0.38, [y + 0.74, y + 0.84], cx, cz, red),
    ], 'hydrants');
  }

  /** Overhead line on timber poles: a live steel crossarm with two insulators per pole, two conductors per span,
      and an optional sodium lantern slung under each arm's street end. The first pole takes a cable riser from a
      buried duct ending at `riserFoot(0)`. Conductors sag about 2 % of the span (an LV span at 15 °C); each of
      `stays` is a ground anchor guyed to the nearest end pole, taking the pull of the line off it. */
  poleLine(pts: P2[], o: { h?: number; street: 1 | -1; lamps?: boolean; group?: string; stays?: P2[] }): { ps: PieceSpec[]; feet: P2[] } {
    const h0 = o.h ?? 8, ps: PieceSpec[] = [], feet: P2[] = [];
    const tips: PieceSpec[][] = [];
    const along: 'x' | 'z' = Math.abs(pts[1][0] - pts[0][0]) > Math.abs(pts[1][1] - pts[0][1]) ? 'x' : 'z';
    const oak = { tint: 0x6a5038 }, live = { tint: 0x4a5055, util: 'power' as const };
    pts.forEach(([x, z]) => {
      const g = this.ground(x, z), h = g + h0;
      // a pole stands in the ground a sixth of its length
      ps.push(...splitRange(g - 1.4, h, 4.5).map((y) => cyl('oak', 0.28, y, x, z, oak)));
      const ay: Range = [h - 0.5, h - 0.38];
      // the arm sits against the pole's +X (line along x) or +Z face and runs across the line
      const arm = along === 'x' ? block('steel', [x + 0.14, x + 0.26], ay, [z - 0.9, z + 0.9], live) : block('steel', [x - 0.9, x + 0.9], ay, [z + 0.14, z + 0.26], live);
      ps.push(arm);
      this.arms.push(arm);
      const ins = [-0.6, 0.6].map((u) => (along === 'x' ? cyl('ceramic', 0.12, [ay[1], ay[1] + 0.22], x + 0.2, z + u, { tint: 0x8a5a44, util: 'power' })
        : cyl('ceramic', 0.12, [ay[1], ay[1] + 0.22], x + u, z + 0.2, { tint: 0x8a5a44, util: 'power' })));
      ps.push(...ins);
      tips.push(ins);
      if (o.lamps) {
        const e = o.street * 0.9;
        ps.push(along === 'x' ? lamp([x + 0.08, x + 0.32], [ay[0] - 0.22, ay[0]], sortR(z + e, z + e - o.street * 0.4), LIGHT.sodium)
          : lamp(sortR(x + e, x + e - o.street * 0.4), [ay[0] - 0.22, ay[0]], [z + 0.08, z + 0.32], LIGHT.sodium));
      }
      feet.push(along === 'x' ? [x + 0.22, z] : [x, z + 0.22]);
    });
    for (let i = 0; i + 1 < tips.length; i++) for (let k = 0; k < 2; k++) {
      const span = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      tips[i][k].ropeTo = { end: [...tips[i + 1][k].pos], slack: clamp(0.02 * span, 0.15, 0.8), strength: 3000, kind: 'wire' };
    }
    for (const [ax, az] of o.stays ?? []) {
      const [px, pz] = [pts[0], pts[pts.length - 1]].sort((a, b) => Math.hypot(a[0] - ax, a[1] - az) - Math.hypot(b[0] - ax, b[1] - az))[0];
      const dx = ax - px, dz = az - pz, alongX = Math.abs(dx) >= Math.abs(dz), s = Math.sign(alongX ? dx : dz) || 1;
      const off = 0.14 + 0.12, gp = this.ground(px, pz), ga = this.ground(ax, az);
      // the stay block is set in the ground at its anchor
      const [f, a] = guy(alongX ? [px + s * off, gp + h0 - 1.2 - ga, pz] : [px, gp + h0 - 1.2 - ga, pz + s * off], [ax, az], 0.24, { tint: 0x5b5f63 });
      ps.push(...raise([f, a], ga).map((q) => (q.mat === 'concrete' ? { ...q, anchored: true } : q)));
    }
    // cable riser from the duct in the ground up the first pole into its arm
    const [x0, z0] = pts[0], top = this.ground(x0, z0) + h0 - 0.5, yd = depthOf('power');
    ps.push(...(along === 'x' ? route('pvc', [[x0 + 0.22, yd, z0], [x0 + 0.22, top, z0]], 0.08, { tint: 0x2b2b2b, util: 'power' })
      : route('pvc', [[x0, yd, z0 + 0.22], [x0, top, z0 + 0.22]], 0.08, { tint: 0x2b2b2b, util: 'power' })));
    this.add(ps, o.group ?? 'poles');
    return { ps, feet };
  }

  /** Column street light standing against a power duct leg: the cut-out plinth (its fuse) touches the duct and
      rises through the surfacing; `h` is the column height above the surface. */
  streetLight(x: number, z: number, axis: 'x' | 'z', side: 1 | -1, reach: 1 | -1, h0 = 6): PieceSpec[] {
    const r = MAIN.power.d / 2 + 0.2;
    const [cx, cz] = axis === 'x' ? [x, z + side * r] : [x + side * r, z];
    const y = this.ground(cx, cz), h = h0 + y;
    const col = { tint: 0x4a5055, util: 'power' as const };
    // the column's root and cut-out come up from beside the duct
    const cutout = block('steel', [cx - 0.2, cx + 0.2], [depthOf('power') - MAIN.power.d / 2, y + 0.5], [cz - 0.2, cz + 0.2], { tint: 0x55595d, util: 'power' });
    cutout.svcPart = 'fuse';
    const ps: PieceSpec[] = [cutout, cyl('steel', 0.16, [y + 0.5, h], cx, cz, col)];
    // the arm reaches over the road across the duct line
    const arm = 1.3 * reach;
    if (axis === 'x') {
      ps.push(block('steel', [cx - 0.06, cx + 0.06], [h, h + 0.1], sortR(cz - 0.08 * reach, cz + arm), col));
      ps.push(lamp([cx - 0.16, cx + 0.16], [h - 0.2, h], sortR(cz + arm, cz + arm - 0.42 * reach), LIGHT.sodium));
    } else {
      ps.push(block('steel', sortR(cx - 0.08 * reach, cx + arm), [h, h + 0.1], [cz - 0.06, cz + 0.06], col));
      ps.push(lamp(sortR(cx + arm, cx + arm - 0.42 * reach), [h - 0.2, h], [cz - 0.16, cz + 0.16], LIGHT.sodium));
    }
    return this.add(ps, 'streetlights');
  }

  /** Traffic signal on a power duct leg: cut-out plinth against the duct through the surfacing, a pole and a
      three-aspect head facing `face` (a unit x or z direction) with its lit aspect. */
  signal(x: number, z: number, axis: 'x' | 'z', side: 1 | -1, face: P2, go = false): PieceSpec[] {
    const r = MAIN.power.d / 2 + 0.2;
    const [cx, cz] = axis === 'x' ? [x, z + side * r] : [x + side * r, z];
    const y = this.ground(cx, cz);
    const cutout = block('steel', [cx - 0.18, cx + 0.18], [depthOf('power') - MAIN.power.d / 2, y + 0.45], [cz - 0.18, cz + 0.18], { tint: 0x55595d, util: 'power' });
    cutout.svcPart = 'fuse';
    const head = block('machine', [cx - 0.17, cx + 0.17], [y + 2.4, y + 3.35], [cz - 0.17, cz + 0.17], { tint: 0x1f2124, util: 'power' });
    const [fx, fz] = face, ay: Range = go ? [y + 2.5, y + 2.75] : [y + 3.0, y + 3.25];
    const lx: Range = fx ? sortR(cx + fx * 0.17, cx + fx * 0.23) : [cx - 0.11, cx + 0.11], lz: Range = fz ? sortR(cz + fz * 0.17, cz + fz * 0.23) : [cz - 0.11, cz + 0.11];
    return this.add([cutout, cyl('steel', 0.12, [y + 0.45, y + 2.4], cx, cz, { tint: 0x2b2d30, util: 'power' }), head,
      lamp(lx, ay, lz, { color: go ? 0x3bff7a : 0xff3b2a, intensity: 2.5, range: 5 })], 'signals');
  }

  /** Overhead service drop from a building's external service head to the nearest pole arm. */
  drop(head: PieceSpec, maxReach = 32): boolean {
    let best: PieceSpec | null = null, bd = maxReach;
    for (const a of this.arms) {
      const d = Math.hypot(a.pos[0] - head.pos[0], a.pos[2] - head.pos[2]);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return false;
    head.ropeTo = { end: [...best.pos], slack: clamp(0.025 * bd, 0.2, 1), strength: 2500, kind: 'wire' };
    return true;
  }

  private nearMain(f: Vec3, kind: Kind): number {
    return Math.min(...this.segs.filter((s) => s.kind === kind).map((s) => Math.abs((s.axis === 'x' ? f[2] : f[0]) - s.at)));
  }

  /* ---------------- service entries ---------------- */

  /** Sleeve a service tail of `kind` out through the wall a building member of that kind is mounted on.
      Returns the building with holes cut round the sleeve, the tail, and its end outside at tail height. */
  entry(bldg: PieceSpec[], kind: Kind, o: { prefer?: (p: PieceSpec) => boolean; head?: boolean; members?: PieceSpec[] } = {}):
    { bldg: PieceSpec[]; tail: PieceSpec[]; path: Vec3[]; head?: PieceSpec } | null {
    const t = TAIL[kind];
    const pool = o.members ? new Set(o.members) : null;
    const cands = bldg.filter((q) => kindOf(q) === kind && !q.mech && !q.noWeld && (!pool || pool.has(q)) && (!q.shape || q.shape === 'box' || q.shape === 'hull'));
    cands.sort((a, b) => Number(!!(o.prefer?.(b))) - Number(!!(o.prefer?.(a))));
    const boxes = bldg.map(pieceAabb);
    let best: { score: number; res: ReturnType<SiteGrid['sleeve']> } | null = null;
    // chamfered (box-like hull) walls are cut only when no plain wall will do
    for (const hulls of [false, true]) {
      for (const c of cands) {
        const cb = aabbOf(c);
        // a member thinner than the tail takes it on its centre line, so the two still share a face
        const y = cb.max[1] - cb.min[1] < t.d + 0.04 ? (cb.min[1] + cb.max[1]) / 2
          : Math.max(cb.min[1] + t.d / 2 + 0.02, Math.min(cb.max[1] - t.d / 2 - 0.02, (cb.min[1] + cb.max[1]) / 2));
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as P2[]) {
          const res = this.sleeve(bldg, boxes, c, cb, y, dx, dz, kind, !!o.head, hulls);
          if (!res) continue;
          const score = res.len + (o.prefer?.(c) ? 0 : 5);
          if (!best || score < best.score) best = { score, res };
        }
        if (best && o.prefer?.(c)) break;
      }
      if (best) break;
    }
    return best ? best.res : null;
  }

  private sleeve(bldg: PieceSpec[], boxes: Aabb[], c: PieceSpec, cb: Aabb, y: number, dx: number, dz: number, kind: Kind, head: boolean, hulls = false) {
    const t = TAIL[kind], r = t.d / 2, k = dx !== 0 ? 0 : 2, s = dx !== 0 ? dx : dz, u = k === 0 ? 2 : 0;
    const cu = (cb.min[u] + cb.max[u]) / 2;
    const start = s > 0 ? cb.max[k] : cb.min[k];
    const probe = (a: number, b: number, rr: number): number[] => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const bx: Aabb = { min: [0, y - rr, 0], max: [0, y + rr, 0] };
      bx.min[k] = lo; bx.max[k] = hi; bx.min[u] = cu - rr; bx.max[u] = cu + rr;
      return boxes.map((b, i) => (bldg[i] !== c && hit(b, bx) ? i : -1)).filter((i) => i >= 0);
    };
    // the member must be mounted on what it goes through: something within 3 cm of its face
    const first = probe(start, start + s * 0.03, r);
    if (!first.length) return null;
    let far = start, clear = 0, hits = new Set<number>();
    for (let step = 0; step < 60 && clear < 0.5; step++) {
      const a = start + s * step * 0.05, b = a + s * 0.05;
      const hh = probe(a, b, r + 0.02);
      if (hh.length) { hh.forEach((i) => hits.add(i)); far = b; clear = 0; } else clear += 0.05;
    }
    if (clear < 0.5 || Math.abs(far - start) > 1.4) return null;
    // and lead outdoors: nothing of the building ahead at this height
    if (probe(far + s * 0.05, far + s * 3.0, r + 0.1).length) return null;
    // everything cut must be an axis-aligned box that the sleeve passes right through
    for (const i of hits) {
      const p = bldg[i];
      if (((p.shape ?? 'box') !== 'box' && !(hulls && boxLike(p))) || p.rotY || p.mech || p.noWeld || p.ropeTo || kindOf(p)) return null;
      if (boxes[i].min[k] < Math.min(start, far) - 1e-6 || boxes[i].max[k] > Math.max(start, far) + 1e-6) return null;
    }
    const exit = far + s * 0.3;
    // the riser down the outside face must be clear
    const riser: Aabb = { min: [0, 0, 0], max: [0, y + r, 0] };
    riser.min[k] = exit - r - 0.05; riser.max[k] = exit + r + 0.05;
    riser.min[u] = cu - r - 0.04; riser.max[u] = cu + r + 0.04;
    if (!head && boxes.some((b, i) => !hits.has(i) && bldg[i] !== c && hit(b, riser))) return null;
    // cut the holes
    const hole: [Range, Range] = [[cu - r - 0.03, cu + r + 0.03], [y - r - 0.03, y + r + 0.03]];
    const out: PieceSpec[] = [];
    bldg.forEach((p, i) => { if (hits.has(i)) out.push(...holed(p, boxes[i], u, hole).map(trimDetail)); else out.push(p); });
    const P = (v: number, yy = y): Vec3 => (k === 0 ? [v, yy, cu] : [cu, yy, v]);
    const tail: PieceSpec[] = [];
    let path: Vec3[] = [];
    let hd: PieceSpec | undefined;
    if (head) {
      /* power: an external service head (cut-out) on the outer face; gas: the meter box standing at the foot of the
         wall, its regulator and excess-flow valve the building's gas gate, fed from below */
      const gas = kind === 'gas';
      // the meter box stands clear of the wall's footing, so its service pipe can come straight up beside it
      const off = gas ? 0.12 : 0, g0 = this.ground(k === 0 ? far + s * 0.26 : cu, k === 0 ? cu : far + s * 0.26);
      const hw = gas ? 0.5 : 0.36, hdpt = gas ? 0.28 : 0.2, hy: Range = gas ? [g0, Math.max(g0 + 0.62 + DPC, y + 0.2)] : [y - 0.3, y + 0.3];
      const kr: Range = s > 0 ? [far + off, far + off + hdpt] : [far - off - hdpt, far - off];
      const ur: Range = [cu - hw / 2, cu + hw / 2];
      hd = block('machine', k === 0 ? kr : ur, hy, k === 0 ? ur : kr, { tint: gas ? SVC.meterBox : 0xb5b9b0, util: kind });
      if (gas) { hd.svcPart = 'efv'; hd.bore = TAIL.gas.bore; } else hd.svcPart = 'fuse';
      tail.push(...route(t.mat, [P(start), P(far + s * off)], t.d, { tint: t.tint, util: kind }, { round: kind !== 'power', bore: t.bore }));
      tail.push(hd);
    } else path = [P(start), P(exit), P(exit, depthOf(kind))];
    return { bldg: out, tail, path, head: hd, len: Math.abs(far - start) };
  }

  /* ---------------- ground routing ---------------- */

  /** Continue a tail's `lead` path (ending at ground level) as a buried run to the nearest reachable main of `kind`,
      around everything in `world` that stands on the ground; the whole tail is laid as one run. */
  groundTail(kind: Kind, lead: Vec3[], world: PieceSpec[], o: { cell?: number; reach?: number; group?: string } = {}): PieceSpec[] | null {
    // a grid that turns a cell after the lead leaves no room for the elbows: try a coarser or finer one
    for (const cell of o.cell ? [o.cell] : [0.2, 0.25, 0.3, 0.15]) {
      const r = this.tailOn(kind, lead, world, { ...o, cell });
      if (r || !this.why.startsWith('short leg')) return r;
    }
    return null;
  }

  private tailOn(kind: Kind, lead: Vec3[], world: PieceSpec[], o: { cell?: number; reach?: number; group?: string }): PieceSpec[] | null {
    const t = TAIL[kind], cell = o.cell ?? 0.2, reach = o.reach ?? 40, y = depthOf(kind), rr = t.d / 2 + 0.07;
    const from = lead[lead.length - 1];
    const mains = this.segs.filter((s) => s.kind === kind && Math.abs(s.at - (s.axis === 'x' ? from[2] : from[0])) < reach);
    if (!mains.length) { this.why = 'no main in reach'; return null; }
    // the start sits on a cell centre so the first leg leaves it cleanly
    const n = 2 * Math.ceil(reach / cell) + 1, x0 = from[0] - (n / 2) * cell, z0 = from[2] - (n / 2) * cell;
    const idx = (i: number, j: number) => i * n + j;
    const blocked = new Uint8Array(n * n);
    const cx = (i: number) => x0 + (i + 0.5) * cell, cz = (j: number) => z0 + (j + 0.5) * cell;
    const mark = (b: Aabb, pad: number) => {
      const i0 = Math.max(0, Math.floor((b.min[0] - pad - x0) / cell)), i1 = Math.min(n - 1, Math.floor((b.max[0] + pad - x0) / cell));
      const j0 = Math.max(0, Math.floor((b.min[2] - pad - z0) / cell)), j1 = Math.min(n - 1, Math.floor((b.max[2] + pad - z0) / cell));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const px = cx(i), pz = cz(j);
        if (px > b.min[0] - pad && px < b.max[0] + pad && pz > b.min[2] - pad && pz < b.max[2] + pad) blocked[idx(i, j)] = 1;
      }
    };
    const win: Aabb = { min: [x0, -1, z0], max: [x0 + n * cell, 1, z0 + n * cell] };
    // what lies in the tail's depth band (other tails and mains, footings, basements, plinths) is in the way
    for (const p of [...world, ...this.ps]) {
      const b = aabbOf(p);
      if (b.min[1] > y + rr || b.max[1] < y - rr || !hit(b, { min: [win.min[0], -99, win.min[2]], max: [win.max[0], 99, win.max[2]] })) continue;
      mark(b, rr);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (Math.max(Math.abs(cx(i)), Math.abs(cz(j))) > this.bound) blocked[idx(i, j)] = 1;
    const si = Math.floor((from[0] - x0) / cell), sj = Math.floor((from[2] - z0) / cell);
    blocked[idx(si, sj)] = 0;
    // goal: a free cell from which a straight perpendicular leg reaches a main's side face through free cells
    const goalLeg = (i: number, j: number): Vec3 | null => {
      const px = cx(i), pz = cz(j);
      for (const s of mains) {
        const along = s.axis === 'x' ? px : pz, off = (s.axis === 'x' ? pz : px) - s.at;
        const need = s.half + rr;
        if (along < s.from + 0.35 || along > s.to - 0.35 || Math.abs(off) < need || Math.abs(off) > need + 1.0) continue;
        const face = s.at + Math.sign(off) * s.half;
        // cells between here and the face must be free apart from the main's own band
        let ok = true;
        const steps = Math.floor((Math.abs(off) - need) / cell);
        for (let q = 1; q <= steps && ok; q++) {
          const ii = s.axis === 'x' ? i : i - Math.sign(off) * q, jj = s.axis === 'x' ? j - Math.sign(off) * q : j;
          if (blocked[idx(ii, jj)]) ok = false;
        }
        if (ok) return s.axis === 'x' ? [px, y, face] : [face, y, pz];
      }
      return null;
    };
    // Dijkstra over (cell, heading) with a turn penalty, so tails run in few straight legs
    const dist = new Float64Array(n * n * 4).fill(Infinity);
    const prev = new Int32Array(n * n * 4).fill(-1);
    const dirs: P2[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const heap: [number, number][] = [];
    const push = (f: number, s: number) => { heap.push([f, s]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    for (let d = 0; d < 4; d++) { dist[idx(si, sj) * 4 + d] = 0; push(0, idx(si, sj) * 4 + d); }
    let goal = -1, goalPt: Vec3 | null = null;
    while (heap.length) {
      const [f, st] = pop();
      const c = st >> 2, d = st & 3, i = Math.floor(c / n), j = c % n;
      if (f > dist[st]) continue;
      const g = goalLeg(i, j);
      if (g) { goal = st; goalPt = g; break; }
      for (let nd = 0; nd < 4; nd++) {
        const ni = i + dirs[nd][0], nj = j + dirs[nd][1];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n || blocked[idx(ni, nj)]) continue;
        const ns = idx(ni, nj) * 4 + nd, cost = dist[st] + 1 + (nd === d ? 0 : 12);
        if (cost < dist[ns]) { dist[ns] = cost; prev[ns] = st; push(cost, ns); }
      }
    }
    if (goal < 0 || !goalPt) { this.why = `no path from ${from.map((v) => v.toFixed(2))} (start ${blocked[idx(si, sj)] ? 'blocked' : 'free'})`; return null; }
    const cells: P2[] = [];
    for (let st = goal; st >= 0; st = prev[st]) { const c = st >> 2; cells.push([Math.floor(c / n), c % n]); }
    cells.reverse();
    const pts: Vec3[] = [...lead];
    const cellPt = ([i, j]: P2): Vec3 => [cx(i), y, cz(j)];
    for (let q = 1; q < cells.length - 1; q++) {
      const a = cells[q - 1], b = cells[q], c = cells[q + 1];
      if ((b[0] - a[0]) !== (c[0] - b[0]) || (b[1] - a[1]) !== (c[1] - b[1])) pts.push(cellPt(b));
    }
    pts.push(cellPt(cells[cells.length - 1]), goalPt);
    const orth = orthogonalise(pts);
    const legs = simplify(orth, t.d + 0.1);
    if (!legs) { this.why = `short leg in ${orth.map((v) => v.map((q) => q.toFixed(2)).join(',')).join(' | ')}`; return null; }
    return this.add(route(t.mat, legs, t.d, { tint: t.tint, util: kind }, { round: kind !== 'power', elbow: t.d + 0.04, maxL: 14, bore: t.bore }), o.group ?? 'services');
  }

  /** Feed a floor-standing box (a machine isolator, a kiosk) from the nearest main of `kind`, leaving by whichever
      face routes; a box standing on the made ground takes its tail up through the surfacing into its underside. */
  feed(box: PieceSpec, kind: Kind, world: PieceSpec[]): PieceSpec[] | null {
    const b = aabbOf(box), y = depthOf(kind);
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const faces: [Vec3, P2][] = [[[b.max[0], y, cz], [1, 0]], [[b.min[0], y, cz], [-1, 0]], [[cx, y, b.max[2]], [0, 1]], [[cx, y, b.min[2]], [0, -1]]];
    const out = [...world, ...this.ps];
    for (const [f, [dx, dz]] of faces.sort((a, c) => this.nearMain(a[0], kind) - this.nearMain(c[0], kind))) {
      const end: Vec3 = [f[0] + dx * 0.4, y, f[2] + dz * 0.4];
      const r = TAIL[kind].d / 2 + 0.03;
      const lead: Aabb = { min: [Math.min(cx, end[0]) - r, y - r, Math.min(cz, end[2]) - r], max: [Math.max(cx, end[0]) + r, y + r, Math.max(cz, end[2]) + r] };
      if (out.some((q) => q !== box && hit(aabbOf(q), lead))) continue;
      const riser: Aabb = { min: [cx - r, y, cz - r], max: [cx + r, b.min[1] - 0.01, cz + r] };
      if (out.some((q) => q !== box && hit(aabbOf(q), riser))) continue;
      const t = this.groundTail(kind, [[cx, b.min[1], cz], [cx, y, cz], end], world);
      if (t) return t;
    }
    return null;
  }
}

/* ---------------- geometry helpers ---------------- */



function sortR(a: number, b: number): Range { return a < b ? [a, b] : [b, a]; }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function dist2(a: Vec3, b: Vec3) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; }
function between(a: Vec3, b: Vec3, v: Vec3): boolean {
  const k = Math.abs(b[0] - a[0]) > 1e-9 ? 0 : 2, o = k === 0 ? 2 : 0;
  return Math.abs(v[o] - a[o]) < 1e-6 && v[k] > Math.min(a[k], b[k]) + 0.4 && v[k] < Math.max(a[k], b[k]) - 0.4;
}

/** Insert corners so consecutive points differ in one horizontal axis only. */
function orthogonalise(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    const dx = Math.abs(b[0] - a[0]) > 1e-6, dz = Math.abs(b[2] - a[2]) > 1e-6, dy = Math.abs(b[1] - a[1]) > 1e-6;
    if (dx && dz) out.push([b[0], a[1], a[2]]);
    if (dx || dz || dy) out.push(b);
  }
  return out;
}

/** Merge collinear legs and refuse legs too short for their fittings. */
function simplify(pts: Vec3[], minLeg: number): Vec3[] | null {
  const out: Vec3[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (out.length >= 2) {
      const a = out[out.length - 2], m = out[out.length - 1];
      const ax = (u: Vec3, v: Vec3) => [0, 1, 2].findIndex((k) => Math.abs(u[k] - v[k]) > 1e-6);
      if (ax(a, m) === ax(m, b)) {
        // collinear (or doubling back): keep the far point, dropping a leg that would retrace itself
        out[out.length - 1] = b;
        if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 1e-6) out.pop();
        continue;
      }
    }
    out.push(b);
  }
  for (let i = 1; i < out.length; i++) if (Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1], out[i][2] - out[i - 1][2]) < minLeg) return null;
  return out;
}

/** A hull that is a box with small chamfers (a quoin, a splayed reveal): a sleeve may cut it as a box. */
function boxLike(p: PieceSpec): boolean {
  return p.shape === 'hull' && !!p.verts && p.verts.every((v) => [0, 1, 2].every((k) => Math.abs(v[k]) >= p.size[k] / 2 - 0.08));
}

/** Split an axis-aligned box piece around a rectangular hole (in the plane of axes u and y). */
function holed(p: PieceSpec, b: Aabb, u: number, hole: [Range, Range]): PieceSpec[] {
  const [hu, hy] = hole;
  const lo = b.min, hi = b.max, k = u === 0 ? 2 : 0;
  const parts: [Range, Range][] = [
    [[lo[u], hu[0]], [lo[1], hi[1]]],
    [[hu[1], hi[u]], [lo[1], hi[1]]],
    [[Math.max(lo[u], hu[0]), Math.min(hi[u], hu[1])], [lo[1], hy[0]]],
    [[Math.max(lo[u], hu[0]), Math.min(hi[u], hu[1])], [hy[1], hi[1]]],
  ];
  const out: PieceSpec[] = [];
  for (const [ur, yr] of parts) {
    if (ur[1] - ur[0] < 0.06 || yr[1] - yr[0] < 0.06) continue;
    const x: Range = u === 0 ? ur : [lo[k], hi[k]], z: Range = u === 0 ? [lo[k], hi[k]] : ur;
    const q: PieceSpec = { ...p, size: [x[1] - x[0], yr[1] - yr[0], z[1] - z[0]], pos: [(x[0] + x[1]) / 2, (yr[0] + yr[1]) / 2, (z[0] + z[1]) / 2] };
    delete q.light;
    if (q.shape === 'hull') { delete q.shape; delete q.verts; }
    if (p.light && q.fixture === 'lamp') q.light = p.light;
    out.push(q);
  }
  return out;
}

/* ---------------- plant buildings of the grid ---------------- */

/** Distribution substation: two pad transformers (the district's power sources) with HV bushings on a gantry,
    tails into an LV switchboard whose front feeder ways (+Z face, local x -1.2, -0.4, 0.4, 1.2 at z 3.45) start the
    buried feeders, a palisade fence with its gate on the feeder side, and two floodlights on the board. */
export function substation(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const g = { tint: SVC.transformer }, cu = { tint: SVC.copper, util: 'power' as const };
  for (const x of [-3.5, 3.5]) {
    ps.push(block('concrete', [x - 1.3, x + 1.3], [0, 0.25], [-1.0, 1.0], { tint: 0xa6a6a0 }));
    // 500 kVA oil-filled transformer, about 2 t
    const tank = block('machine', [x - 1.0, x + 1.0], [0.25, 2.3], [-0.7, 0.7], { ...g, fixture: 'transformer' });
    tank.density = 400;
    ps.push(tank);
    ps.push(block('steel', [x - 0.9, x + 0.9], [0.4, 2.1], [0.7, 0.86], g), block('steel', [x - 0.9, x + 0.9], [0.4, 2.1], [-0.86, -0.7], g));
    for (const dx of [-0.6, 0, 0.6]) ps.push(cyl('ceramic', 0.16, [2.3, 2.75], x + dx, 0, { tint: 0x8a5a44, util: 'power' }));
    ps.push(block('copper', [x - 0.8, x + 0.8], [2.75, 2.85], [-0.08, 0.08], cu));
    // LV tails: cable from the tank's front face down and along to the board
    const sx = x > 0 ? 1 : -1;
    ps.push(...route('copper', [[sx * 2.5, 1.2, 0], [sx * 1.2, 1.2, 0], [sx * 1.2, 1.2, 2.55]], 0.12, cu));
  }
  // each switchboard panel is a feeder way with its own fuses: a fault out on one feeder blows only that way
  ps.push(...place(switchgear({ x: 0, z: 0, panels: 4 }), 0, 3.0).map((q) => ({ ...q, group: undefined, ...(q.mat === 'machine' && q.util === 'power' ? { svcPart: 'fuse' as const } : {}) })));
  // HV gantry: droppers from the busbars up to line insulators under the beam
  const steel = { tint: 0x8d949b };
  for (const x of [-6.3, 6.3]) ps.push(block('steel', [x - 0.15, x + 0.15], [0, 6.2], [-0.15, 0.15], steel));
  ps.push(block('steel', [-6.45, 6.45], [6.2, 6.5], [-0.15, 0.15], steel));
  for (const x of [-3.5, 3.5]) {
    ps.push(block('copper', [x - 0.05, x + 0.05], [2.85, 5.5], [-0.05, 0.05], cu));
    ps.push(cyl('ceramic', 0.18, [5.5, 6.2], x, 0, { tint: 0x8a5a44, util: 'power' }));
  }
  // palisade fence, gate on the feeder side
  const fence = { tint: 0x55595d };
  const run = (a: number, b: number, at: number, alongX: boolean) => {
    for (const u of splitRange(a, b, 4.2)) ps.push(alongX ? block('metal', u, [0, 2.2], [at - 0.04, at + 0.04], fence) : block('metal', [at - 0.04, at + 0.04], [0, 2.2], u, fence));
  };
  run(-8, 8, -4, true);
  run(-8, -2.4, 5, true);
  run(2.4, 8, 5, true);
  run(-3.96, 4.96, -7.96, false);
  run(-3.96, 4.96, 7.96, false);
  // floodlights on the board top, live from its busbar trunk
  for (const x of [-1.2, 1.2]) {
    ps.push(block('steel', [x - 0.05, x + 0.05], [2.45, 4.0], [2.95, 3.05], { tint: 0x4a5055, util: 'power' }));
    ps.push(lamp([x - 0.2, x + 0.2], [4.0, 4.3], [2.8, 3.2], LIGHT.flood));
  }
  return tag(place(ps, p.x, p.z, p.rot ?? 0), { group: p.group ?? 'substation' });
}

/** Water pumping station: brick house round two grid-fed pump sets drawing on the incoming trunk (the source).
    The discharge header leaves through a sleeve in the east wall at local (5.0, 1.82, -0.0) and drops to a
    main at local (5.6, *, 0); the power duct comes in under the door to the isolator at the east end. */
export function pumpHall(p: Placement & { feed?: Feed; mainY?: number }): PieceSpec[] {
  const X = 5, Z = 3.5, h = 4.2, t = 0.3;
  const wall = { mat: 'brick' as const, t, y0: 0, h, tint: 0xa98474, lintel: 'rconcrete' as const, maxW: 3.2 };
  const ps: PieceSpec[] = [
    ...wallRun({ ...wall, from: -X, to: X, at: Z - t / 2, openings: [{ c: -2.5, w: 1.2, y0: 1.4, h: 1.5 }, { c: 2.5, w: 1.2, y0: 1.4, h: 1.5 }] }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + t / 2, out: -1, openings: [{ c: 0, w: 1.2, y0: 1.4, h: 1.5 }] }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1 }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2, openings: [{ c: -2.0, w: 1.2, y0: 0, h: 2.3 }, { c: 0, w: 0.5, y0: 1.57, h: 0.5, glass: false }] }),
    ...splitRange(-X - 0.1, X + 0.1, 3.6).map((x) => block('rconcrete', x, [h, h + 0.25], [-Z - 0.1, Z + 0.1], { tint: 0xcfcfca })),
  ];
  const pumps = waterPumps({ x: 0, z: -0.6, feed: p.feed ?? 'grid', pumps: 2 });
  ps.push(...pumps.map((q) => ({ ...q, group: undefined })));
  // header (local x -1.7..1.7 at y 1.82, z -0.6) continues east out of the sleeve and down to the main at `mainY`
  const dy = p.mainY ?? 0.14;
  ps.push(...route('steel', [[1.7, 1.82, -0.6], [2.6, 1.82, -0.6], [2.6, 1.82, 0], [5.6, 1.82, 0], [5.6, dy, 0], [6.0, dy, 0]], 0.24, { tint: SVC.water, util: 'water' }, { round: true, elbow: 0.28 }));
  // a bulkhead light on the isolator's lead
  const iso = isolatorOf(ps)!;
  ps.push(...route('pvc', [[iso.pos[0], 1.4, iso.pos[2]], [iso.pos[0], 3.6, iso.pos[2]]], 0.08, { tint: SVC.conduit, util: 'power' }));
  ps.push(lamp([iso.pos[0] - 0.15, iso.pos[0] + 0.15], [3.6, 3.8], [iso.pos[2] - 0.15, iso.pos[2] + 0.15], LIGHT.cool));
  return tag(place(ps, p.x, p.z, p.rot ?? 0), { group: p.group ?? 'pumping' });
}

/* ---------------- grid check ---------------- */

export interface GridReport { errors: string[]; networks: { kind: Kind; members: number; sources: string[]; consumers: number }[] }

/** Every consumer must reach a grid source: service networks are weld-connected same-kind members (AABB contact,
    as the core joins services) plus live wire ropes between power members. `gridSources(p)` says which sources
    count as grid (the substation, governor, pumping station, boiler house, and site generators). */
export function checkGrid(bp: Blueprint, gridSource: (p: PieceSpec) => boolean, ground: (x: number, z: number) => number = () => 0): GridReport {
  const ps = bp.pieces, kind = ps.map(kindOf), boxes = ps.map(pieceAabb);
  const parent = ps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const members = ps.map((_, i) => i).filter((i) => kind[i] && !ps[i].noWeld);
  // spatial hash on members only
  const cell = 3, map = new Map<string, number[]>();
  for (const i of members) {
    const b = boxes[i];
    for (let x = Math.floor((b.min[0] - 0.05) / cell); x <= Math.floor((b.max[0] + 0.05) / cell); x++) for (let z = Math.floor((b.min[2] - 0.05) / cell); z <= Math.floor((b.max[2] + 0.05) / cell); z++) {
      const k = `${x},${z}`;
      (map.get(k) ?? map.set(k, []).get(k)!).push(i);
    }
  }
  for (const list of map.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const i = list[a], j = list[b];
    if (kind[i] === kind[j] && find(i) !== find(j) && wouldWeld(boxes[i], boxes[j])) union(i, j);
  }
  // wires (and mech parts that are live members: they conduct only through wires)
  ps.forEach((p, i) => {
    if (!p.ropeTo || p.ropeTo.kind !== 'wire' || kind[i] !== 'power') return;
    let best = -1, d = 0.45;
    ps.forEach((q, j) => { if (j !== i) { const dd = Math.hypot(q.pos[0] - p.ropeTo!.end[0], q.pos[1] - p.ropeTo!.end[1], q.pos[2] - p.ropeTo!.end[2]); if (dd < d) { d = dd; best = j; } } });
    if (best >= 0 && kind[best] === 'power') union(i, best);
  });
  const nets = new Map<number, { kind: Kind; members: number; sources: string[]; grid: boolean; consumers: number[] }>();
  ps.forEach((p, i) => {
    if (!kind[i]) return;
    const r = find(i);
    const n = nets.get(r) ?? nets.set(r, { kind: kind[i]!, members: 0, sources: [], grid: false, consumers: [] }).get(r)!;
    n.members++;
    if (p.fixture && SOURCE_FIXTURES.has(p.fixture)) { n.sources.push(`${p.fixture}@${p.group}`); if (gridSource(p)) n.grid = true; }
    else if (p.fixture) n.consumers.push(i);
  });
  const errors: string[] = [];
  for (const n of nets.values()) {
    if (!n.consumers.length) continue;
    // steam and building gas boilers are local plant; power consumers must reach a grid (or site generator) source
    if (n.kind === 'power' ? !n.grid : !n.sources.length) {
      const q = ps[n.consumers[0]];
      errors.push(`${n.consumers.length} ${n.kind} consumer(s) reach no grid source, e.g. ${q.fixture}@${q.group} [${q.pos.map((v) => v.toFixed(1))}] (net sources: ${n.sources.join(', ') || 'none'})`);
    }
  }
  /* services practice: sprinkler heads are charged (their range reaches a water source); a gas meter box stands at the
     foot of an outside wall (at or near ground, below 1.2 m); a building's gas installation reaches the main only
     through a meter's excess-flow valve */
  const sourced = (i: number) => { const n = nets.get(find(i)); return !!n && n.sources.length > 0; };
  ps.forEach((p, i) => {
    if (p.svcPart === 'sprinkler' && !sourced(i)) errors.push(`sprinkler head @${p.group} [${p.pos.map((v) => v.toFixed(1))}] is not on a charged water main`);
    const g = ground(p.pos[0], p.pos[2]);
    if (p.svcPart === 'efv' && kind[i] === 'gas' && p.group === 'services' && (boxes[i].min[1] > g + 0.05 || boxes[i].max[1] > g + DPC + 1.2)) errors.push(`gas meter box [${p.pos.map((v) => v.toFixed(1))}] is not at the foot of its wall`);
  });
  // with every meter taken out, no building's gas pipework may still reach a grid gas source
  const gi = ps.map((_, i) => i).filter((i) => kind[i] === 'gas' && ps[i].svcPart !== 'efv' && !ps[i].noWeld);
  const gp = new Map(gi.map((i) => [i, i]));
  const gf = (i: number): number => (gp.get(i) === i ? i : (gp.set(i, gf(gp.get(i)!)), gp.get(i)!));
  for (let a = 0; a < gi.length; a++) for (let b = a + 1; b < gi.length; b++) if (wouldWeld(boxes[gi[a]], boxes[gi[b]])) gp.set(gf(gi[a]), gf(gi[b]));
  const fed = new Set(gi.filter((i) => ps[i].fixture === 'gasmain' && gridSource(ps[i])).map(gf));
  const grid = new Set(['services', 'gasmain', 'governor']);
  for (const i of gi) if (!grid.has(ps[i].group ?? '') && !ps[i].fixture && fed.has(gf(i))) {
    errors.push(`gas pipework @${ps[i].group} [${ps[i].pos.map((v) => v.toFixed(1))}] reaches the main without a meter / EFV`);
    break;
  }
  // motors: a mech motor that is not engine-driven must sit on a live host
  const live = (i: number) => { const r = find(i); const n = nets.get(r); return !!n && (n.kind === 'power' ? n.grid : n.sources.length > 0); };
  ps.forEach((p, i) => {
    if (!p.mech?.motor || p.mech.motor.always) return;
    const at = p.mech.at;
    const host = ps.findIndex((q, j) => j !== i && [0, 1, 2].every((k) => at[k] >= boxes[j].min[k] - 0.03 && at[k] <= boxes[j].max[k] + 0.03) && (!q.mech || q.util === 'power'));
    if (host < 0) { errors.push(`motor on ${p.mat}@${p.group} has no host`); return; }
    const hostLive = kind[host] === 'power' && live(host);
    const motorLive = ps.some((q, j) => q.fixture === 'motor' && live(j) && wouldWeld(boxes[j], boxes[host]));
    if (!hostLive && !motorLive) errors.push(`motor on ${p.mat}@${p.group} [${p.pos.map((v) => v.toFixed(1))}] has no live supply`);
  });
  return { errors, networks: [...nets.values()].map((n) => ({ kind: n.kind, members: n.members, sources: n.sources, consumers: n.consumers.length })) };
}

export { boxOf, hit, inflate, penetration, pieceSolid };
export type { PieceOpts };
