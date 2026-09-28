import type { PieceSpec } from '../types.ts';
import { CELL, KERB_UP, type Decal, type DecalKind, type Kerb, type MarkKind, type Range, type SurfaceId, type TerrainOp, type TerrainSpec } from './spec.ts';
import { groundHeight, rasterize, type TerrainData } from './raster.ts';

/* Authoring helper for a map's ground: collects operations into a TerrainSpec (plain data for the Blueprint) and
   rasterises on demand so the builder can stand things on the surface it has made. */

export class TerrainPlan {
  readonly spec: TerrainSpec;
  private cache: TerrainData | null = null;

  constructor(half: number, seed: number, undulate = 0.1) {
    this.spec = { half, seed, undulate, ops: [], kerbs: [], blocks: [], pads: [], steps: [], decals: [], marks: [] };
  }

  private op(o: TerrainOp): this { this.spec.ops.push(o); this.cache = null; return this; }

  level(x: Range, z: Range, y: number, mat?: SurfaceId, blend?: number): this { return this.op({ k: 'level', x, z, y, ...(mat ? { mat } : {}), ...(blend ? { blend } : {}) }); }
  fall(x: Range, z: Range, y: number, axis: 'x' | 'z', dy: number, mat?: SurfaceId): this { return this.op({ k: 'level', x, z, y, fall: { axis, dy }, ...(mat ? { mat } : {}) }); }
  road(x: Range, z: Range, axis: 'x' | 'z', y = -KERB_UP, camber = 0.025, mat: SurfaceId = 'asphalt'): this { return this.op({ k: 'road', x, z, axis, y, camber, mat }); }
  ramp(x: Range, z: Range, axis: 'x' | 'z', y0: number, y1: number, mat?: SurfaceId): this { return this.op({ k: 'ramp', x, z, axis, y0, y1, ...(mat ? { mat } : {}) }); }
  mat(x: Range, z: Range, mat: SurfaceId): this { return this.op({ k: 'mat', x, z, mat }); }
  pit(x: Range, z: Range, y: number, batter = 0, mat: SurfaceId = 'soil'): this { return this.op({ k: 'pit', x, z, y, batter, mat }); }
  rough(x: Range, z: Range, amp: number, scale?: number): this { return this.op({ k: 'rough', x, z, amp, ...(scale ? { scale } : {}) }); }

  kerb(k: Kerb): this { this.spec.kerbs.push(k); this.cache = null; return this; }
  block(x: Range, z: Range, y0: number, y1: number, mat: 'stone' | 'concrete' | 'brick'): this { this.spec.blocks.push({ x, z, y0, y1, mat }); this.cache = null; return this; }
  /** a building's ground-bearing slab with its top at `top` */
  pad(x: Range, z: Range, top: number): this { this.spec.pads.push({ x, z, top }); this.cache = null; return this; }
  steps(x: Range, z: Range, axis: 'x' | 'z', dir: 1 | -1, y0: number, y1: number, n: number, mat: 'stone' | 'concrete' = 'stone'): this {
    this.spec.steps.push({ x, z, axis, dir, y0, y1, n, mat });
    // the ground under the flight ramps from its foot to its head, below every tread
    const lo = dir > 0 ? y0 : y1, hi = dir > 0 ? y1 : y0;
    return this.op({ k: 'ramp', x, z, axis, y0: lo, y1: hi });
  }
  decal(kind: DecalKind, x: number, z: number, w: number, d?: number, rot?: number): this {
    const o: Decal = { kind, x, z, w };
    if (d !== undefined) o.d = d;
    if (rot) o.rot = rot;
    this.spec.decals.push(o);
    return this;
  }
  mark(kind: MarkKind, a: [number, number], b: [number, number], w = 0.1): this { this.spec.marks.push({ kind, a, b, w }); return this; }

  /** A carriageway along `axis`: `across` is its edge-to-edge span (grid lines), `along` its length. Kerbs on the
      listed edges (footway at `top`), with dropped runs; centre line and edge markings. */
  street(axis: 'x' | 'z', across: Range, along: Range, o: { top?: number; kerbs?: (-1 | 1)[]; drops?: Partial<Record<-1 | 1, Range[]>>; centre?: boolean; camber?: number; noKerb?: Range[] } = {}): this {
    const top = o.top ?? 0, chan = top - KERB_UP;
    const x: Range = axis === 'x' ? along : across, z: Range = axis === 'x' ? across : along;
    this.road(x, z, axis, chan, o.camber ?? 0.025);
    for (const s of o.kerbs ?? [-1, 1] as (-1 | 1)[]) {
      const at = s < 0 ? across[0] : across[1];
      // runs between the gaps (junction mouths)
      const gaps = [...(o.noKerb ?? [])].sort((a, b) => a[0] - b[0]);
      let u = along[0];
      for (const g of [...gaps, [along[1], along[1]] as Range]) {
        if (g[0] - u > 0.3) this.kerb({ axis, at, from: u, to: Math.min(g[0], along[1]), side: s, top, up: KERB_UP, drops: (o.drops?.[s] ?? []).filter((d) => d[1] > u && d[0] < g[0]) });
        u = Math.max(u, g[1]);
      }
    }
    if (o.centre !== false) {
      const c = (across[0] + across[1]) / 2;
      this.mark('dash', axis === 'x' ? [along[0] + 1, c] : [c, along[0] + 1], axis === 'x' ? [along[1] - 1, c] : [c, along[1] - 1], 0.1);
    }
    return this;
  }

  /** Level beds under every structure that stands on unengineered ground (pieces welded to the ground). */
  seat(ps: PieceSpec[]): this {
    const done = new Set<string>();
    for (const p of ps) {
      if (p.noWeld || p.soft || p.mech || p.vehicle) continue;
      const hy = p.shape === 'cylinder' || p.rotY ? Math.max(p.size[0], p.size[2]) / 2 : 0;
      const hx = hy || p.size[0] / 2, hz = hy || p.size[2] / 2;
      const b = p.pos[1] - p.size[1] / 2;
      if (Math.abs(b) > 0.03) continue;
      const x: Range = [snap(p.pos[0] - hx, -1), snap(p.pos[0] + hx, 1)], z: Range = [snap(p.pos[2] - hz, -1), snap(p.pos[2] + hz, 1)];
      const key = `${x[0]},${x[1]},${z[0]},${z[1]}`;
      if (done.has(key)) continue;
      done.add(key);
      this.spec.ops.push({ k: 'seat', x, z, y: b });
    }
    this.cache = null;
    return this;
  }

  data(): TerrainData { return (this.cache ??= rasterize(this.spec)); }
  /** top of the ground at (x, z) as rasterised so far */
  y(x: number, z: number): number { const g = groundHeight(this.data(), x, z); return Number.isFinite(g) ? g : 0; }
}

const snap = (v: number, dir: -1 | 1) => (dir < 0 ? Math.floor(v / CELL) : Math.ceil(v / CELL)) * CELL;
