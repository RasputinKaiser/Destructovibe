import { CELL as CELL0, SURFACES, TILE_CELLS, type Block, type Kerb, type Pad, type Range, type Steps, type SurfaceId, type TerrainSpec } from './spec.ts';

/* Rasterised terrain: a heightfield of samples every CELL over [-half, half]², a surfacing id per sample, a hole
   flag per sample, and the engineered features (kerbs, walls, steps) as triangle meshes cut into items per tile.
   Sample (i, j) sits at x = -half + i·CELL, z = -half + j·CELL, index i + n·j (the box3d heightfield order).
   Every cell is split along its (1,0)–(0,1) diagonal, as the physics splits it (verified against box3d). */

export interface FeatureItem {
  /** the tile whose physics body and render batch carry it */
  tile: number;
  /** world-space triangle soup */
  pos: number[];
  /** surfacing id of the item */
  mat: number;
  /** render class: 0 kerb stone, 1 concrete, 2 stone, 3 brick, 10 + surfacing id: that surfacing's finish */
  look: number;
  min: [number, number, number]; max: [number, number, number];
  /** a crater can break it out */
  fragile: boolean;
  alive: boolean;
  /** a piece of a building's slab: the ground under it, restored when it is broken out */
  pad?: { x: Range; z: Range; top: number };
}

export interface TerrainData {
  spec: TerrainSpec;
  half: number;
  /** sample spacing, m */
  cell: number;
  /** samples per side */
  n: number;
  /** tiles per side */
  tiles: number;
  h: Float32Array;
  mat: Uint8Array;
  hole: Uint8Array;
  /** engineered (exact) samples: seats and natural undulation leave them alone */
  eng: Uint8Array;
  items: FeatureItem[];
  /** items overlapping each tile (queries) */
  byTile: number[][];
  /** items each tile carries (physics, render) */
  own: number[][];
}

const EPS = 1e-6;
/* sample spacing of the terrain being rasterised (set on entry; rasterising is synchronous) */
let CELL = CELL0;
const idOf = (s: SurfaceId): number => SURFACES.indexOf(s);

/* ---------------- noise ---------------- */

function hash2(seed: number, x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function value2(seed: number, x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(seed, xi, zi), b = hash2(seed, xi + 1, zi), c = hash2(seed, xi, zi + 1), d = hash2(seed, xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function undulation(seed: number, x: number, z: number, scale = 22): number {
  return 0.65 * value2(seed, x / scale, z / scale) + 0.35 * value2(seed + 7, x / (scale * 0.37), z / (scale * 0.37));
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/* ---------------- rasterise ---------------- */

export function rasterize(spec: TerrainSpec): TerrainData {
  CELL = spec.cell ?? CELL0;
  const half = spec.half, n = Math.round((2 * half) / CELL) + 1, tiles = Math.round((2 * half) / (CELL * TILE_CELLS));
  const h = new Float32Array(n * n), mat = new Uint8Array(n * n).fill(idOf('grass')), hole = new Uint8Array(n * n), eng = new Uint8Array(n * n);
  const X = (i: number) => -half + i * CELL;
  const I = (x: number) => (x + half) / CELL;
  // natural ground: a gentle roll that dies away toward the map edge, where it meets the flat apron
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = X(i), z = X(j), edge = smooth((half - Math.max(Math.abs(x), Math.abs(z))) / 10);
    h[i + n * j] = spec.undulate * undulation(spec.seed, x, z) * edge;
  }
  const span = (r: Range): [number, number] => [Math.max(0, Math.ceil(I(r[0]) - EPS)), Math.min(n - 1, Math.floor(I(r[1]) + EPS))];
  const each = (x: Range, z: Range, f: (k: number, x: number, z: number) => void, pad = 0) => {
    const [i0, i1] = span([x[0] - pad, x[1] + pad]), [j0, j1] = span([z[0] - pad, z[1] + pad]);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(i + n * j, X(i), X(j));
  };
  const outside = (x: Range, z: Range, px: number, pz: number) => Math.hypot(Math.max(x[0] - px, 0, px - x[1]), Math.max(z[0] - pz, 0, pz - z[1]));

  for (const op of spec.ops) {
    switch (op.k) {
      case 'level': {
        const m = op.mat ? idOf(op.mat) : -1, f = op.fall;
        const yAt = (x: number, z: number) => {
          if (!f) return op.y;
          const r = f.axis === 'x' ? op.x : op.z, u = f.axis === 'x' ? x : z;
          return op.y + f.dy * Math.min(1, Math.max(0, (u - r[0]) / (r[1] - r[0])));
        };
        const b = op.blend ?? 0;
        each(op.x, op.z, (k, x, z) => {
          const d = outside(op.x, op.z, x, z);
          const cx = Math.min(op.x[1], Math.max(op.x[0], x)), cz = Math.min(op.z[1], Math.max(op.z[0], z));
          if (d <= EPS) { h[k] = yAt(x, z); eng[k] = 1; if (m >= 0) mat[k] = m; return; }
          if (b <= 0 || eng[k]) return;
          const t = smooth(d / b);
          h[k] = yAt(cx, cz) * (1 - t) + h[k] * t;
        }, b);
        break;
      }
      case 'road': {
        const m = idOf(op.mat ?? 'asphalt'), c = op.camber ?? 0.025;
        const r = op.axis === 'x' ? op.z : op.x, mid = (r[0] + r[1]) / 2, hw = (r[1] - r[0]) / 2;
        each(op.x, op.z, (k, x, z) => { const u = op.axis === 'x' ? z : x; h[k] = op.y + c * (hw - Math.abs(u - mid)); mat[k] = m; eng[k] = 1; });
        break;
      }
      case 'ramp': {
        const m = op.mat ? idOf(op.mat) : -1, r = op.axis === 'x' ? op.x : op.z;
        each(op.x, op.z, (k, x, z) => {
          const u = op.axis === 'x' ? x : z;
          h[k] = op.y0 + (op.y1 - op.y0) * Math.min(1, Math.max(0, (u - r[0]) / (r[1] - r[0])));
          eng[k] = 1;
          if (m >= 0) mat[k] = m;
        });
        break;
      }
      case 'mat': { const m = idOf(op.mat); each(op.x, op.z, (k) => { mat[k] = m; }); break; }
      case 'pit': {
        const m = idOf(op.mat ?? 'soil'), bt = op.batter ?? 0;
        const pad = bt > 0 ? bt * 12 : 0;
        each(op.x, op.z, (k, x, z) => {
          const d = outside(op.x, op.z, x, z);
          if (d <= EPS) { h[k] = op.y; mat[k] = m; eng[k] = 1; return; }
          if (bt <= 0) return;
          const y = op.y + d / bt;
          if (y < h[k]) { h[k] = y; mat[k] = m; eng[k] = 1; }
        }, pad);
        break;
      }
      case 'seat': {
        each(op.x, op.z, (k, x, z) => {
          if (eng[k]) return;
          const d = outside(op.x, op.z, x, z);
          if (d <= 0.25 + EPS) { h[k] = op.y; eng[k] = 2; return; }
          const t = smooth((d - 0.25) / 0.75);
          h[k] = op.y * (1 - t) + h[k] * t;
        }, 1);
        break;
      }
      case 'rough': each(op.x, op.z, (k, x, z) => { if (!eng[k]) h[k] += op.amp * undulation(spec.seed + 31, x, z, op.scale ?? 9); }); break;
    }
  }

  const items: FeatureItem[] = [];
  for (const kb of spec.kerbs) kerb(kb, h, mat, n, half, items, tiles);
  for (const b of spec.blocks) block(b, half, items, tiles);
  for (const s of spec.steps) steps(s, half, items, tiles);
  const concrete = idOf('concrete');
  for (const pd of spec.pads) {
    // the ground runs on under the slab, below its top
    pad(pd, half, items, tiles);
    each(pd.x, pd.z, (k) => { mat[k] = concrete; });
  }
  const byTile: number[][] = Array.from({ length: tiles * tiles }, () => []), own: number[][] = Array.from({ length: tiles * tiles }, () => []);
  const T = CELL * TILE_CELLS, tc = (v: number) => Math.min(tiles - 1, Math.max(0, Math.floor((v + half) / T)));
  items.forEach((it, i) => {
    own[it.tile].push(i);
    for (let b = tc(it.min[2]); b <= tc(it.max[2]); b++) for (let a = tc(it.min[0]); a <= tc(it.max[0]); a++) byTile[a + tiles * b].push(i);
  });
  // the outermost ring meets the apron at y = 0
  for (let q = 0; q < n; q++) for (const k of [q, q + n * (n - 1), n * q, n - 1 + n * q]) { h[k] = 0; hole[k] = 0; }
  return { spec, half, cell: CELL, n, tiles, h, mat, hole, eng, items, byTile, own };
}

/* ---------------- features ---------------- */

function tileOf(half: number, tiles: number, x: number, z: number): number {
  const T = CELL * TILE_CELLS;
  const tx = Math.min(tiles - 1, Math.max(0, Math.floor((x + half) / T))), tz = Math.min(tiles - 1, Math.max(0, Math.floor((z + half) / T)));
  return tx + tiles * tz;
}

function newItem(half: number, tiles: number, pos: number[], mat: SurfaceId, look: number, fragile: boolean): FeatureItem {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  return { tile: tileOf(half, tiles, (min[0] + max[0]) / 2, (min[2] + max[2]) / 2), pos, mat: idOf(mat), look, min, max, fragile, alive: true };
}

/** push quad a b c d (counter-clockwise seen from the side it faces) */
function quad(o: number[], a: number[], b: number[], c: number[], d: number[]): void {
  o.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/** A kerb: the stone's face on the carriageway edge, a 20 mm chamfer and its top over one cell of the footway (the
    heightfield runs from the channel up to the footway under it). The footway behind a dropped run ramps down. */
function kerb(kb: Kerb, h: Float32Array, mat: Uint8Array, n: number, half: number, items: FeatureItem[], tiles: number): void {
  const chan = kb.top - kb.up, s = kb.side, drops = kb.drops ?? [], TR = 0.9, BAND = 1.5, DROP = 0.025;
  const along = kb.axis === 'x' ? 0 : 1;
  /* upstand along the line: full, dropped, or on a transition kerb between */
  const upAt = (u: number) => {
    let k = 1;
    for (const [a, b] of drops) {
      if (u >= a && u <= b) return DROP;
      if (u > a - TR && u < a) k = Math.min(k, (a - u) / TR);
      if (u > b && u < b + TR) k = Math.min(k, (u - b) / TR);
    }
    return DROP + (kb.up - DROP) * k;
  };
  const I = (v: number) => Math.round((v + half) / CELL);
  // heightfield: the line itself at channel level; the footway behind a drop falls to it
  const line = I(kb.at);
  for (let a = Math.max(0, Math.ceil(I(kb.from) - 1e-6)); a <= Math.min(n - 1, Math.floor(I(kb.to) + 1e-6)); a++) {
    const u = -half + a * CELL, k0 = along === 0 ? a + n * line : line + n * a;
    if (line >= 0 && line < n) h[k0] = chan;
    const drop = kb.up - upAt(u);
    if (drop <= 1e-4) continue;
    for (let q = 1; q * CELL <= BAND + 1e-6; q++) {
      const b = line + s * q;
      if (b < 0 || b >= n) break;
      const k = along === 0 ? a + n * b : b + n * a;
      h[k] = Math.min(h[k], kb.top - drop * (1 - Math.max(0, q * CELL - CELL) / (BAND - CELL)));
    }
  }
  /* mesh, cut into ≤ 2 m items; stations every 0.3 m (finer through the transitions) */
  const P = (u: number, c: number, y: number): number[] => (along === 0 ? [u, y, kb.at + s * c] : [kb.at + s * c, y, u]);
  const segs: Range[] = [];
  for (let u = kb.from; u < kb.to - 1e-6; u += 2) segs.push([u, Math.min(kb.to, u + 2)]);
  const back = line + s, KW = 0.15;
  for (const [u0, u1] of segs) {
    const ka = Math.round((u0 + u1) / 2 / CELL + half / CELL), fway = back >= 0 && back < n && ka >= 0 && ka < n ? mat[along === 0 ? ka + n * back : back + n * ka] : idOf('paving');
    const strip: number[] = [];
    const st: number[] = [];
    for (let u = u0; u < u1 - 1e-6; u += 0.3) st.push(u);
    st.push(u1);
    for (const [a, b] of drops) for (const v of [a - TR, a, b, b + TR]) if (v > u0 && v < u1 && !st.some((w) => Math.abs(w - v) < 0.02)) st.push(v);
    st.sort((p, q) => p - q);
    const o: number[] = [];
    const bot = chan - 0.03;
    for (let q = 0; q + 1 < st.length; q++) {
      // the stone top follows its upstand; behind a drop the footway has been ramped down to meet it
      const ua = st[q], ub = st[q + 1], ta = chan + upAt(ua), tb = chan + upAt(ub);
      const fwd = s * (along === 0 ? 1 : -1) > 0;
      const face = [P(ua, 0, bot), P(ub, 0, bot), P(ub, 0, tb - 0.02), P(ua, 0, ta - 0.02)];
      const cham = [P(ua, 0, ta - 0.02), P(ub, 0, tb - 0.02), P(ub, 0.02, tb), P(ua, 0.02, ta)];
      const top = [P(ua, 0.02, ta), P(ub, 0.02, tb), P(ub, KW, tb), P(ua, KW, ta)];
      const behind = [P(ua, KW, ta), P(ub, KW, tb), P(ub, CELL, tb), P(ua, CELL, ta)];
      for (const qd of [face, cham, top]) (fwd ? quad(o, qd[0], qd[3], qd[2], qd[1]) : quad(o, qd[0], qd[1], qd[2], qd[3]));
      (fwd ? quad(strip, behind[0], behind[3], behind[2], behind[1]) : quad(strip, behind[0], behind[1], behind[2], behind[3]));
    }
    // end caps where the run stops
    for (const [u, out] of [[kb.from, -1], [kb.to, 1]] as const) {
      if (u < u0 - 1e-6 || u > u1 + 1e-6 || (out < 0 && Math.abs(u - u0) > 1e-6) || (out > 0 && Math.abs(u - u1) > 1e-6)) continue;
      const t = chan + upAt(u);
      const cap = [P(u, 0, bot), P(u, CELL, bot), P(u, CELL, t), P(u, 0, t)];
      const fwd = (s * (along === 0 ? 1 : -1) > 0) !== (out > 0);
      if (fwd) quad(o, cap[0], cap[1], cap[2], cap[3]); else quad(o, cap[0], cap[3], cap[2], cap[1]);
    }
    items.push(newItem(half, tiles, o, kb.mat ?? 'concrete', 0, true));
    // the rest of the kerb's cell is the footway laid up to the stone
    items.push(newItem(half, tiles, strip, SURFACES[fway], 10 + fway, true));
  }
}

const LOOK = { concrete: 1, stone: 2, brick: 3 } as const;
const BLOCK_MAT: Record<Block['mat'], SurfaceId> = { concrete: 'concrete', stone: 'setts', brick: 'paving' };

function boxFaces(o: number[], x: Range, z: Range, y0: number, y1: number): void {
  const v = (a: number, y: number, b: number) => [a, y, b];
  quad(o, v(x[0], y1, z[0]), v(x[0], y1, z[1]), v(x[1], y1, z[1]), v(x[1], y1, z[0]));   // top (+y)
  quad(o, v(x[0], y0, z[1]), v(x[1], y0, z[1]), v(x[1], y1, z[1]), v(x[0], y1, z[1]));   // +z
  quad(o, v(x[1], y0, z[0]), v(x[0], y0, z[0]), v(x[0], y1, z[0]), v(x[1], y1, z[0]));   // -z
  quad(o, v(x[1], y0, z[1]), v(x[1], y0, z[0]), v(x[1], y1, z[0]), v(x[1], y1, z[1]));   // +x
  quad(o, v(x[0], y0, z[0]), v(x[0], y0, z[1]), v(x[0], y1, z[1]), v(x[0], y1, z[0]));   // -x
}

function block(b: Block, half: number, items: FeatureItem[], tiles: number): void {
  const L = 4;
  const along = b.x[1] - b.x[0] >= b.z[1] - b.z[0] ? 'x' : 'z', r = along === 'x' ? b.x : b.z;
  const k = Math.max(1, Math.ceil((r[1] - r[0]) / L - 1e-6));
  for (let q = 0; q < k; q++) {
    const u: Range = [r[0] + ((r[1] - r[0]) * q) / k, r[0] + ((r[1] - r[0]) * (q + 1)) / k];
    const o: number[] = [];
    boxFaces(o, along === 'x' ? u : b.x, along === 'x' ? b.z : u, b.y0, b.y1);
    items.push(newItem(half, tiles, o, BLOCK_MAT[b.mat], LOOK[b.mat], false));
  }
}

function pad(pd: Pad, half: number, items: FeatureItem[], tiles: number): void {
  const L = 4, bot = pd.top - 0.6;
  const xs: Range[] = [], zs: Range[] = [];
  const nx = Math.max(1, Math.ceil((pd.x[1] - pd.x[0]) / L - 1e-6)), nz = Math.max(1, Math.ceil((pd.z[1] - pd.z[0]) / L - 1e-6));
  for (let q = 0; q < nx; q++) xs.push([pd.x[0] + ((pd.x[1] - pd.x[0]) * q) / nx, pd.x[0] + ((pd.x[1] - pd.x[0]) * (q + 1)) / nx]);
  for (let q = 0; q < nz; q++) zs.push([pd.z[0] + ((pd.z[1] - pd.z[0]) * q) / nz, pd.z[0] + ((pd.z[1] - pd.z[0]) * (q + 1)) / nz]);
  const v = (a: number, y: number, b: number) => [a, y, b];
  xs.forEach((x, a) => zs.forEach((z, b) => {
    const o: number[] = [], t = pd.top;
    quad(o, v(x[0], t, z[0]), v(x[0], t, z[1]), v(x[1], t, z[1]), v(x[1], t, z[0]));
    if (b === nz - 1) quad(o, v(x[0], bot, z[1]), v(x[1], bot, z[1]), v(x[1], t, z[1]), v(x[0], t, z[1]));
    if (b === 0) quad(o, v(x[1], bot, z[0]), v(x[0], bot, z[0]), v(x[0], t, z[0]), v(x[1], t, z[0]));
    if (a === nx - 1) quad(o, v(x[1], bot, z[1]), v(x[1], bot, z[0]), v(x[1], t, z[0]), v(x[1], t, z[1]));
    if (a === 0) quad(o, v(x[0], bot, z[0]), v(x[0], bot, z[1]), v(x[0], t, z[1]), v(x[0], t, z[0]));
    const it = newItem(half, tiles, o, 'concrete', 1, true);
    it.pad = { x, z, top: t };
    items.push(it);
  }));
}

function steps(s: Steps, half: number, items: FeatureItem[], tiles: number): void {
  const r = s.axis === 'x' ? s.x : s.z, run = (r[1] - r[0]) / s.n, rise = (s.y1 - s.y0) / s.n;
  const o: number[] = [];
  for (let q = 0; q < s.n; q++) {
    const u0 = s.dir > 0 ? r[0] + q * run : r[1] - (q + 1) * run, ur: Range = [u0, u0 + run];
    // each tread is solid down to the foot of the flight (the ground under it ramps below)
    boxFaces(o, s.axis === 'x' ? ur : s.x, s.axis === 'x' ? s.z : ur, s.y0 - 0.02, s.y0 + (q + 1) * rise);
  }
  items.push(newItem(half, tiles, o, s.mat === 'stone' ? 'setts' : 'concrete', LOOK[s.mat], true));
}

/* ---------------- queries ---------------- */

const cached = new WeakMap<TerrainSpec, TerrainData>();
/** The rasterised terrain of a spec, made once per spec object (validators and checks share it). */
export function dataOf(spec: TerrainSpec): TerrainData {
  let d = cached.get(spec);
  if (!d) { d = rasterize(spec); cached.set(spec, d); }
  return d;
}

/** Ground height function of a blueprint's terrain (0 without one; holes read as 0). */
export function groundFn(spec: TerrainSpec | undefined): (x: number, z: number) => number {
  if (!spec) return () => 0;
  const d = dataOf(spec);
  return (x, z) => { const y = groundHeight(d, x, z); return Number.isFinite(y) ? y : 0; };
}

/** Height of the heightfield at (x, z) (the triangle the physics has there); outside the grid, the apron (0). */
export function fieldHeight(d: TerrainData, x: number, z: number): number {
  const fx = (x + d.half) / d.cell, fz = (z + d.half) / d.cell;
  if (fx < 0 || fz < 0 || fx > d.n - 1 || fz > d.n - 1) return 0;
  const i = Math.min(d.n - 2, Math.floor(fx)), j = Math.min(d.n - 2, Math.floor(fz)), u = fx - i, v = fz - j, n = d.n, H = d.h;
  const h00 = H[i + n * j], h10 = H[i + 1 + n * j], h01 = H[i + n * (j + 1)], h11 = H[i + 1 + n * (j + 1)];
  return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/** Is (x, z) over a hole (no ground triangle there)? */
export function isHole(d: TerrainData, x: number, z: number): boolean {
  const fx = (x + d.half) / d.cell, fz = (z + d.half) / d.cell;
  if (fx < 0 || fz < 0 || fx > d.n - 1 || fz > d.n - 1) return false;
  const i = Math.min(d.n - 2, Math.floor(fx)), j = Math.min(d.n - 2, Math.floor(fz)), n = d.n, o = d.hole;
  return fx - i + (fz - j) <= 1 ? !!(o[i + n * j] | o[i + 1 + n * j] | o[i + n * (j + 1)]) : !!(o[i + 1 + n * j] | o[i + n * (j + 1)] | o[i + 1 + n * (j + 1)]);
}

/** Top of the ground at (x, z): the heightfield or a feature standing on it; -Infinity over a hole. */
export function groundHeight(d: TerrainData, x: number, z: number): number {
  let y = isHole(d, x, z) ? -Infinity : fieldHeight(d, x, z);
  const T = d.cell * TILE_CELLS, tx = Math.floor((x + d.half) / T), tz = Math.floor((z + d.half) / T);
  if (tx < 0 || tz < 0 || tx >= d.tiles || tz >= d.tiles) return y;
  for (const k of d.byTile[tx + d.tiles * tz]) {
    const it = d.items[k];
    if (!it.alive || x < it.min[0] || x > it.max[0] || z < it.min[2] || z > it.max[2] || it.max[1] <= y) continue;
    const t = itemTop(it, x, z);
    if (t > y) y = t;
  }
  return y;
}

/** highest up-facing triangle of an item over (x, z) */
function itemTop(it: FeatureItem, x: number, z: number): number {
  let best = -Infinity;
  const p = it.pos;
  for (let t = 0; t < p.length; t += 9) {
    const ax = p[t], ay = p[t + 1], az = p[t + 2], bx = p[t + 3], by = p[t + 4], bz = p[t + 5], cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-9) continue;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    best = Math.max(best, w0 * ay + w1 * by + w2 * cy);
  }
  return best;
}

/** Surfacing id at (x, z): the nearest sample's. */
export function surfaceIdAt(d: TerrainData, x: number, z: number): number {
  const i = Math.round((x + d.half) / d.cell), j = Math.round((z + d.half) / d.cell);
  if (i < 0 || j < 0 || i >= d.n || j >= d.n) return SURFACES.indexOf('grass');
  return d.mat[i + d.n * j];
}
