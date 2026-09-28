import type { Piece, Root } from '../destruction/structure';
import type { Vec3 } from '../types';
import { Candidates } from './collide';
import { FABRICS, type Fabric, type FabricId, type SoftKind } from './fabric';
import { pool, allocParticles, ALIVE, SOLID, PINNED, GRAIN } from './particles';
import type { Gas } from './pressure';

/* XPBD with one constraint iteration per substep (small steps beat iterations). Topology is cell based:
   a cloth cell is one grid quad (2 triangles, 2 shear diagonals); tearing or burning kills cells, and an
   edge or bending hinge lives while the cells it belongs to do. Ropes use segments as cells. */

export interface Pin {
  i: number;
  piece: Piece | null;
  /** point in the piece's frame (world when piece is null) */
  local: Float64Array;
  /** step-start and step-end world target, and this substep's */
  t0: Float64Array; t1: Float64Array; t: Float64Array;
  tear: number;
  /** force this step (mean over substeps), N */
  f: number;
  /** reaction impulse on the host this step */
  J: Float64Array;
  alive: boolean;
}

let nextBodyId = 1;

export class SoftBody {
  id = nextBodyId++;
  dead = false;
  p0 = 0;
  n = 0;
  // grid shape (cloth/net: nu × nv; softbody/granular lattice: nu × nv × nw; rope: nu)
  nu = 0; nv = 0; nw = 0;
  resU = 0; resV = 0;
  // distance constraints
  ne = 0;
  ei = new Int32Array(0);
  el = new Float64Array(0);
  ea = new Float64Array(0);
  eAlive = new Uint8Array(0);
  /** owning cells (−1 none); eAny: alive while any owner lives, else while all do */
  e2c = new Int32Array(0);
  eAny = new Uint8Array(0);
  // isometric bending hinges: a, b (edge), c, d (wings)
  nb = 0;
  bi = new Int32Array(0);
  bk = new Float64Array(0);
  bAlive = new Uint8Array(0);
  b2c = new Int32Array(0);
  // cells
  nc = 0;
  cAlive = new Uint8Array(0);
  cWeak = new Float32Array(0);
  /** cloth: 4 corner particles (a b c d round the quad) and diagonal parity; rope: 2 ends */
  c2p = new Int32Array(0);
  cFlip = new Uint8Array(0);
  c2e: number[][] = [];
  c2b: number[][] = [];
  p2c: number[][] = [];
  /** softbody render surface: quads (4 particle indices, CCW from outside) */
  surf = new Int32Array(0);
  // shape matching
  q0: Float64Array | null = null;
  /** shape-matching goal positions from the last substep */
  goal: Float64Array | null = null;
  rot = new Float64Array([0, 0, 0, 1]);
  // long-range attachments: tether each particle to a pin at its geodesic rest distance
  lraPin = new Int16Array(0);
  lraD = new Float64Array(0);
  pins: Pin[] = [];
  /** sheets: each grid column's distance along u, m (a seam doubles its column) */
  cols: Float64Array | null = null;
  /** seams: particle pairs sewn together, alive, and the gape (m) at which a stitch lets go */
  nst = 0;
  sti = new Int32Array(0);
  stOn = new Uint8Array(0);
  stGap = 0;
  /** strain limit: longest each edge may get (latex locks up near full inflation), or null */
  eMax: Float64Array | null = null;
  /** creasing hinges: edge length at rest */
  bL: Float64Array | null = null;
  /** closed / open shells: rest area of each cell (holes), whether it lies on a panel seam, render uv */
  cArea: Float32Array | null = null;
  cSeam: Uint8Array | null = null;
  uv: Float32Array | null = null;
  /** rest positions (self-contact exclusion within the body) */
  rest0: Float32Array | null = null;
  gas: Gas | null = null;
  /** step once every `period` rigid steps (distant bodies are frame-sliced) */
  period = 1;
  /** contact thickness against other sheets, m */
  selfR = 0;
  /** edge length tearing strain is measured from (prestretched membranes), else the rest length */
  eRef: Float64Array | null = null;
  /** fabric membranes take no compression: their edges only resist stretching, so they wrinkle and fold */
  slack = false;
  /** ties to other bodies (they wake and step together) */
  tied = 0;
  /** step stamp of the group this body is being stepped in */
  stamp = 0;
  /** ropes: the rigid surface each particle rests on (normal, friction), from the last contact pass */
  cn: Float32Array | null = null;
  /** ropes: the piece each particle near a tied end passes into (not collided with) */
  skip: (Piece | null)[] | null = null;
  /** pieces resting on it when it fell asleep (it wakes if one goes) */
  bearers: Piece[] = [];
  aabb = new Float64Array(6);
  cand = new Candidates();
  awake = true;
  still = 0;
  shelter = 1;
  shelterT = 0;
  burning = 0;
  /** bumps when cells die (render rebuilds its index) */
  topo = 0;
  /** bumps when char/burn colours change */
  shade = 0;
  cuts = 0;
  tethersDirty = false;
  hostGone = false;
  /** cloth: fastest particle speed last step, m/s; granular: particles still moving */
  moving = 0;
  /** contact stiffness against rigid pieces, N/m per particle (solid bodies) */
  kc = 0;
  /** fastest particle at the start of the step, m/s */
  vmax = 0;
  sleepWind = 0;
  mass = 0;
  /** seconds since creation */
  age = 0;
  gfx: unknown = null;
  tint: number;
  kind: SoftKind;
  fabId: FabricId;
  fab: Fabric;
  host: Piece | null;
  root: Root | null;
  constructor(kind: SoftKind, fabId: FabricId, fab: Fabric, host: Piece | null, root: Root | null, tint?: number) {
    this.kind = kind; this.fabId = fabId; this.fab = fab; this.host = host; this.root = root;
    this.tint = tint ?? fab.tint;
  }
}

/* ---------------- builders ---------------- */

interface EdgeDraft { i: number; j: number; a: number; c0: number; c1: number; any: number }

function finishEdges(b: SoftBody, list: EdgeDraft[]): void {
  const X = pool.x;
  b.ne = list.length;
  b.ei = new Int32Array(b.ne * 2); b.el = new Float64Array(b.ne); b.ea = new Float64Array(b.ne);
  b.eAlive = new Uint8Array(b.ne).fill(1); b.e2c = new Int32Array(b.ne * 2); b.eAny = new Uint8Array(b.ne);
  list.forEach((e, k) => {
    b.ei[k * 2] = e.i; b.ei[k * 2 + 1] = e.j; b.ea[k] = e.a; b.e2c[k * 2] = e.c0; b.e2c[k * 2 + 1] = e.c1; b.eAny[k] = e.any;
    b.el[k] = Math.hypot(X[e.j * 3] - X[e.i * 3], X[e.j * 3 + 1] - X[e.i * 3 + 1], X[e.j * 3 + 2] - X[e.i * 3 + 2]);
    if (e.c0 >= 0) b.c2e[e.c0].push(k);
    if (e.c1 >= 0 && e.c1 !== e.c0) b.c2e[e.c1].push(k);
  });
}

function initParticles(b: SoftBody, n: number, massEach: number, radius: number, solid: boolean): void {
  b.p0 = allocParticles(n);
  b.n = n;
  for (let i = b.p0; i < b.p0 + n; i++) {
    pool.m[i] = massEach; pool.w[i] = 1 / massEach; pool.r[i] = radius;
    pool.fl[i] = ALIVE | (solid ? SOLID : 0) | (b.kind === 'granular' ? GRAIN : 0);
    pool.body[i] = b.id;
    pool.mu[i] = b.fab.friction; pool.coh[i] = b.fab.cohesion ?? 0;
  }
  b.mass = massEach * n;
}

function setPos(i: number, x: number, y: number, z: number): void {
  const X = pool.x, i3 = i * 3;
  X[i3] = pool.px[i3] = pool.sx[i3] = x;
  X[i3 + 1] = pool.px[i3 + 1] = pool.sx[i3 + 1] = y;
  X[i3 + 2] = pool.px[i3 + 2] = pool.sx[i3 + 2] = z;
}

function cot(ux: number, uy: number, uz: number, vx: number, vy: number, vz: number): number {
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return (ux * vx + uy * vy + uz * vz) / Math.max(1e-9, Math.sqrt(cx * cx + cy * cy + cz * cz));
}

/** Rectangular sheet over corners a b c d (a→b = u, a→d = v). Panels `seamW` wide are sewn together: a seam
    doubles its grid column and the two copies are tied, so a sheet tears along its seams before its cloth. */
export function buildSheet(b: SoftBody, pts: Vec3[], res: number, seamW = 0): void {
  const [a, bb, c, d] = pts;
  const lu = Math.max(Math.hypot(bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]), Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]));
  const lv = Math.max(Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]), Math.hypot(c[0] - bb[0], c[1] - bb[1], c[2] - bb[2]));
  const nu0 = Math.max(2, Math.round(lu / res) + 1), nv = Math.max(2, Math.round(lv / res) + 1);
  const panels = seamW > 0 ? Math.max(1, Math.round(lu / seamW)) : 1;
  const seamAt = new Set<number>();
  for (let k = 1; k < panels; k++) { const u = Math.round((k * (nu0 - 1)) / panels); if (u > 0 && u < nu0 - 1) seamAt.add(u); }
  const cols: number[] = [], gap: number[] = [];
  for (let u = 0; u < nu0; u++) {
    cols.push(u / (nu0 - 1)); gap.push(0);
    if (seamAt.has(u)) { gap[gap.length - 1] = 1; cols.push(u / (nu0 - 1)); gap.push(0); }
  }
  const nu = cols.length;
  b.nu = nu; b.nv = nv; b.resU = lu / (nu0 - 1); b.resV = lv / (nv - 1);
  b.cols = Float64Array.from(cols, (s) => s * lu);
  const area = lu * lv, n = nu * nv;
  initParticles(b, n, (b.fab.density * area) / (nu0 * nv), b.fab.radius, false);
  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    const s = cols[u], t = v / (nv - 1);
    const x = (a[0] * (1 - s) + bb[0] * s) * (1 - t) + (d[0] * (1 - s) + c[0] * s) * t;
    const y = (a[1] * (1 - s) + bb[1] * s) * (1 - t) + (d[1] * (1 - s) + c[1] * s) * t;
    const z = (a[2] * (1 - s) + bb[2] * s) * (1 - t) + (d[2] * (1 - s) + c[2] * s) * t;
    setPos(b.p0 + v * nu + u, x, y, z);
  }
  const idx = (u: number, v: number): number => b.p0 + v * nu + u;
  const nc = (nu - 1) * (nv - 1);
  b.nc = nc;
  b.cAlive = new Uint8Array(nc).fill(1);
  b.cWeak = new Float32Array(nc).fill(1);
  b.c2p = new Int32Array(nc * 4);
  b.cFlip = new Uint8Array(nc);
  b.c2e = Array.from({ length: nc }, () => []);
  b.c2b = Array.from({ length: nc }, () => []);
  b.p2c = Array.from({ length: n }, () => []);
  const tris: number[] = [];
  const triCell: number[] = [];
  for (let v = 0; v < nv - 1; v++) for (let u = 0; u < nu - 1; u++) {
    const cI = v * (nu - 1) + u;
    const A = idx(u, v), B = idx(u + 1, v), C = idx(u + 1, v + 1), D = idx(u, v + 1);
    b.c2p.set([A, B, C, D], cI * 4);
    // a seam's gap column holds no cloth
    if (gap[u]) { b.cAlive[cI] = 0; continue; }
    const flip = (u + v) & 1;
    b.cFlip[cI] = flip;
    if (!flip) tris.push(A, B, C, A, C, D); else tris.push(A, B, D, B, C, D);
    triCell.push(cI, cI);
    for (const p of [A, B, C, D]) b.p2c[p - b.p0].push(cI);
  }
  const edges: EdgeDraft[] = [];
  const f = b.fab, weft = f.weft ?? f.stretch, warp = f.warp ?? f.stretch;
  const cellAt = (u: number, v: number): number => (u >= 0 && v >= 0 && u < nu - 1 && v < nv - 1 && !gap[u] ? v * (nu - 1) + u : -1);
  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    if (u < nu - 1 && !gap[u]) { const c0 = cellAt(u, v), c1 = cellAt(u, v - 1); edges.push({ i: idx(u, v), j: idx(u + 1, v), a: weft, c0: c0 >= 0 ? c0 : c1, c1: c1 >= 0 ? c1 : c0, any: 1 }); }
    if (v < nv - 1) { const c0 = cellAt(u, v), c1 = cellAt(u - 1, v); edges.push({ i: idx(u, v), j: idx(u, v + 1), a: warp, c0: c0 >= 0 ? c0 : c1, c1: c1 >= 0 ? c1 : c0, any: 1 }); }
  }
  for (let v = 0; v < nv - 1; v++) for (let u = 0; u < nu - 1; u++) {
    const cI = cellAt(u, v);
    if (cI < 0) continue;
    edges.push({ i: idx(u, v), j: idx(u + 1, v + 1), a: f.shear, c0: cI, c1: cI, any: 1 });
    edges.push({ i: idx(u + 1, v), j: idx(u, v + 1), a: f.shear, c0: cI, c1: cI, any: 1 });
  }
  finishEdges(b, edges);
  buildHinges(b, tris, triCell, null);
  const st: number[] = [];
  for (let u = 0; u < nu - 1; u++) if (gap[u]) for (let v = 0; v < nv; v++) st.push(idx(u, v), idx(u + 1, v));
  if (st.length) {
    b.nst = st.length / 2;
    b.sti = Int32Array.from(st); b.stOn = new Uint8Array(b.nst).fill(1);
    /* a stitch is as stiff as the cloth, so a seam gapes as the cloth beside it strains; it lets go at the
       strain the cloth would tear at, in the ratio of seam to cloth strength */
    b.stGap = Math.min(1, (f.seam ?? f.tensile * 0.5) / f.tensile) * f.strain * b.resU;
  }
  keepRest(b);
}

function keepRest(b: SoftBody): void {
  b.rest0 = new Float32Array(b.n * 3);
  for (let k = 0; k < b.n * 3; k++) b.rest0[k] = pool.x[b.p0 * 3 + k];
}

/** Isometric bending hinges over every interior triangle edge (skip: crease lines left free to fold). */
function buildHinges(b: SoftBody, tris: number[], triCell: number[], skip: ((i: number, j: number) => boolean) | null): void {
  const X = pool.x;
  const byEdge = new Map<number, { t: number; o: number }[]>();
  for (let t = 0; t < tris.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const i = tris[t * 3 + k], j = tris[t * 3 + ((k + 1) % 3)], o = tris[t * 3 + ((k + 2) % 3)];
      const key = Math.min(i, j) * 1e6 + Math.max(i, j);
      let l = byEdge.get(key);
      if (!l) byEdge.set(key, (l = []));
      l.push({ t, o });
    }
  }
  const bi: number[] = [], bk: number[] = [], b2c: number[] = [], bl: number[] = [];
  for (const [key, l] of byEdge) {
    if (l.length !== 2) continue;
    const A = Math.floor(key / 1e6), B = key % 1e6, C = l[0].o, D = l[1].o;
    if (skip && skip(A, B)) continue;
    const p = (q: number, k: number): number => X[q * 3 + k];
    const e0 = [p(B, 0) - p(A, 0), p(B, 1) - p(A, 1), p(B, 2) - p(A, 2)];
    const e1 = [p(C, 0) - p(A, 0), p(C, 1) - p(A, 1), p(C, 2) - p(A, 2)];
    const e2 = [p(D, 0) - p(A, 0), p(D, 1) - p(A, 1), p(D, 2) - p(A, 2)];
    const e3 = [p(C, 0) - p(B, 0), p(C, 1) - p(B, 1), p(C, 2) - p(B, 2)];
    const e4 = [p(D, 0) - p(B, 0), p(D, 1) - p(B, 1), p(D, 2) - p(B, 2)];
    const c01 = cot(e0[0], e0[1], e0[2], e1[0], e1[1], e1[2]), c02 = cot(e0[0], e0[1], e0[2], e2[0], e2[1], e2[2]);
    const c03 = cot(-e0[0], -e0[1], -e0[2], e3[0], e3[1], e3[2]), c04 = cot(-e0[0], -e0[1], -e0[2], e4[0], e4[1], e4[2]);
    bi.push(A, B, C, D);
    bk.push(c03 + c04, c01 + c02, -c01 - c03, -c02 - c04);
    b2c.push(triCell[l[0].t], triCell[l[1].t]);
    bl.push(Math.hypot(e0[0], e0[1], e0[2]));
  }
  b.nb = bi.length / 4;
  b.bi = Int32Array.from(bi); b.bk = Float64Array.from(bk); b.bAlive = new Uint8Array(b.nb).fill(1); b.b2c = Int32Array.from(b2c);
  if (b.fab.crease) b.bL = Float64Array.from(bl);
  for (let q = 0; q < b.nb; q++) { b.c2b[b.b2c[q * 2]].push(q); if (b.b2c[q * 2 + 1] !== b.b2c[q * 2]) b.c2b[b.b2c[q * 2 + 1]].push(q); }
}

function shellDivs(lo: Vec3, hi: Vec3, res: number, shape: 'box' | 'ellipsoid' | 'dome'): number[] {
  // a ring round an ellipse of diameter D crosses four faces: m = πD / 4res keeps its segments `res` long
  return [0, 1, 2].map((k) => Math.max(2, Math.round(((shape === 'box' ? 1 : 0.8) * (hi[k] - lo[k])) / res)));
}

/** particles a shell would take */
export function shellCount(lo: Vec3, hi: Vec3, res: number, shape: 'box' | 'ellipsoid' | 'dome'): number {
  const [mx, my, mz] = shellDivs(lo, hi, res, shape);
  const all = (mx + 1) * (my + 1) * (mz + 1) - (mx - 1) * (my - 1) * (mz - 1);
  return shape === 'dome' ? all - (mx - 1) * (mz - 1) : all;
}

/** Closed (or, for a dome, bottomless) shell over the box lo..hi: a subdivided box, blown out to an ellipsoid for
    balloons and domes. Each box face is a sewn panel; board (carton) bends only inside its panels, folding freely
    at the creases between them. */
export function buildShell(b: SoftBody, lo: Vec3, hi: Vec3, res: number, shape: 'box' | 'ellipsoid' | 'dome'): void {
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const dome = shape === 'dome';
  const m = shellDivs(lo, hi, res, shape);
  const [mx, my, mz] = m;
  const vid = new Map<number, number>();
  const lat: number[] = [];
  const key = (i: number, j: number, k: number): number => (i * 4096 + j) * 4096 + k;
  const vert = (i: number, j: number, k: number): number => {
    const kk = key(i, j, k);
    let v = vid.get(kk);
    if (v === undefined) { v = lat.length / 3; vid.set(kk, v); lat.push(i, j, k); }
    return v;
  };
  const quads: number[] = [];
  const faceOf: number[] = [];
  // each face: origin corner, two in-face axes (right-handed with the outward normal)
  const face = (axis: number, side: 0 | 1, id: number): void => {
    const ua = (axis + 1) % 3, va = (axis + 2) % 3;
    const nU = m[ua], nV = m[va], fixed = side ? m[axis] : 0;
    for (let u = 0; u < nU; u++) for (let v = 0; v < nV; v++) {
      const at = (du: number, dv: number): number => {
        const c = [0, 0, 0];
        c[axis] = fixed; c[ua] = u + du; c[va] = v + dv;
        return vert(c[0], c[1], c[2]);
      };
      const A = at(0, 0), B = at(1, 0), C = at(1, 1), D = at(0, 1);
      if (side) quads.push(A, B, C, D); else quads.push(A, D, C, B);
      faceOf.push(id);
    }
  };
  face(0, 0, 0); face(0, 1, 1); face(1, 1, 3); face(2, 0, 4); face(2, 1, 5);
  if (!dome) face(1, 0, 2);
  const nv = lat.length / 3;
  const c = [(lo[0] + hi[0]) / 2, dome ? lo[1] : (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const hx = ext[0] / 2, hy = dome ? ext[1] : ext[1] / 2, hz = ext[2] / 2;
  const pos = new Float64Array(nv * 3);
  for (let q = 0; q < nv; q++) {
    let x = (2 * lat[q * 3]) / mx - 1, y = dome ? lat[q * 3 + 1] / my : (2 * lat[q * 3 + 1]) / my - 1, z = (2 * lat[q * 3 + 2]) / mz - 1;
    if (shape !== 'box') {
      // equal-area-ish cube-to-sphere map keeps the cells even
      const x2 = x * x, y2 = y * y, z2 = z * z;
      const sx = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3), sy = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3), sz = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
      x = sx; y = sy; z = sz;
    }
    pos[q * 3] = c[0] + x * hx; pos[q * 3 + 1] = c[1] + y * hy; pos[q * 3 + 2] = c[2] + z * hz;
  }
  const nq = quads.length / 4;
  let area = 0;
  const qa = new Float32Array(nq);
  for (let k = 0; k < nq; k++) {
    const A = quads[k * 4] * 3, B = quads[k * 4 + 1] * 3, C = quads[k * 4 + 2] * 3, D = quads[k * 4 + 3] * 3;
    const ux = pos[C] - pos[A], uy = pos[C + 1] - pos[A + 1], uz = pos[C + 2] - pos[A + 2];
    const vx = pos[D] - pos[B], vy = pos[D + 1] - pos[B + 1], vz = pos[D + 2] - pos[B + 2];
    qa[k] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    area += qa[k];
  }
  initParticles(b, nv, (b.fab.density * area) / nv, b.fab.radius, false);
  for (let q = 0; q < nv; q++) setPos(b.p0 + q, pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]);
  b.resU = b.resV = Math.sqrt(area / nq);
  b.nc = nq;
  b.cAlive = new Uint8Array(nq).fill(1);
  b.cWeak = new Float32Array(nq).fill(1);
  b.c2p = new Int32Array(nq * 4);
  b.cFlip = new Uint8Array(nq);
  b.cArea = qa;
  b.cSeam = new Uint8Array(nq);
  b.c2e = Array.from({ length: nq }, () => []);
  b.c2b = Array.from({ length: nq }, () => []);
  b.p2c = Array.from({ length: nv }, () => []);
  // a vertex on two or more box faces lies on a panel seam
  const onFaces = (q: number): number => {
    let f = 0;
    for (let k = 0; k < 3; k++) { const l = lat[q * 3 + k]; if (l === 0 && !(dome && k === 1)) f++; else if (l === m[k]) f++; }
    return f;
  };
  const tris: number[] = [], triCell: number[] = [];
  const sides = new Map<number, { i: number; j: number; c0: number; c1: number }>();
  for (let k = 0; k < nq; k++) {
    const q = [quads[k * 4], quads[k * 4 + 1], quads[k * 4 + 2], quads[k * 4 + 3]].map((v) => v + b.p0);
    b.c2p.set(q, k * 4);
    const flip = (lat[quads[k * 4] * 3] + lat[quads[k * 4] * 3 + 1] + lat[quads[k * 4] * 3 + 2]) & 1;
    b.cFlip[k] = flip;
    if (!flip) tris.push(q[0], q[1], q[2], q[0], q[2], q[3]); else tris.push(q[0], q[1], q[3], q[1], q[2], q[3]);
    triCell.push(k, k);
    for (const p of q) b.p2c[p - b.p0].push(k);
    for (let e = 0; e < 4; e++) {
      const i = q[e], j = q[(e + 1) % 4], kk = Math.min(i, j) * 1e6 + Math.max(i, j);
      const s = sides.get(kk);
      if (s) s.c1 = k; else sides.set(kk, { i, j, c0: k, c1: k });
      if (onFaces(i - b.p0) >= 2 && onFaces(j - b.p0) >= 2) b.cSeam[k] = 1;
    }
  }
  const f = b.fab, edges: EdgeDraft[] = [];
  for (const e of sides.values()) edges.push({ i: e.i, j: e.j, a: f.stretch, c0: e.c0, c1: e.c1, any: 1 });
  for (let k = 0; k < nq; k++) {
    const q = b.c2p;
    edges.push({ i: q[k * 4], j: q[k * 4 + 2], a: f.shear, c0: k, c1: k, any: 1 });
    edges.push({ i: q[k * 4 + 1], j: q[k * 4 + 3], a: f.shear, c0: k, c1: k, any: 1 });
  }
  finishEdges(b, edges);
  if (f.bend > 0 && shape === 'box') buildHinges(b, tris, triCell, (i, j) => onFaces(i - b.p0) >= 2 && onFaces(j - b.p0) >= 2);
  else { b.nb = 0; b.bi = new Int32Array(0); b.bk = new Float64Array(0); b.bAlive = new Uint8Array(0); b.b2c = new Int32Array(0); }
  b.uv = new Float32Array(nv * 2);
  for (let q = 0; q < nv; q++) { b.uv[q * 2] = pos[q * 3] + pos[q * 3 + 2]; b.uv[q * 2 + 1] = pos[q * 3 + 1]; }
  keepRest(b);
}

export function polyLength(pts: Vec3[]): number {
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
  return len;
}

/** Particle rope along a polyline (two points: straight), resampled evenly: segments are its cells, bending
    through second-neighbour links. */
export function buildRope(b: SoftBody, pts: Vec3[], res: number): void {
  const len = polyLength(pts);
  const n = Math.max(3, Math.round(len / res) + 1);
  b.nu = n; b.resU = len / (n - 1);
  initParticles(b, n, (b.fab.density * len) / n, b.fabId === 'thread' ? b.fab.radius : Math.max(b.fab.radius, 0.012), false);
  let seg = 0, s0 = 0;
  for (let k = 0; k < n; k++) {
    const at = (k / (n - 1)) * len;
    while (seg < pts.length - 2 && s0 + Math.hypot(pts[seg + 1][0] - pts[seg][0], pts[seg + 1][1] - pts[seg][1], pts[seg + 1][2] - pts[seg][2]) < at) {
      s0 += Math.hypot(pts[seg + 1][0] - pts[seg][0], pts[seg + 1][1] - pts[seg][1], pts[seg + 1][2] - pts[seg][2]); seg++;
    }
    const a = pts[seg], e = pts[seg + 1] ?? a, l = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]), s = l > 1e-9 ? Math.min(1, (at - s0) / l) : 0;
    setPos(b.p0 + k, a[0] + (e[0] - a[0]) * s, a[1] + (e[1] - a[1]) * s, a[2] + (e[2] - a[2]) * s);
  }
  b.nc = n - 1;
  b.cAlive = new Uint8Array(b.nc).fill(1);
  b.cWeak = new Float32Array(b.nc).fill(1);
  b.c2p = new Int32Array(b.nc * 4);
  b.c2e = Array.from({ length: b.nc }, () => []);
  b.c2b = Array.from({ length: b.nc }, () => []);
  b.p2c = Array.from({ length: n }, () => []);
  const edges: EdgeDraft[] = [];
  for (let k = 0; k < n - 1; k++) {
    b.c2p.set([b.p0 + k, b.p0 + k + 1, b.p0 + k + 1, b.p0 + k], k * 4);
    b.p2c[k].push(k); b.p2c[k + 1].push(k);
    edges.push({ i: b.p0 + k, j: b.p0 + k + 1, a: b.fab.stretch, c0: k, c1: k, any: 1 });
  }
  for (let k = 0; k < n - 2; k++) edges.push({ i: b.p0 + k, j: b.p0 + k + 2, a: b.fab.bend, c0: k, c1: k + 1, any: 0 });
  finishEdges(b, edges);
}

/** Lattice filling the box between two corners (softbody), shape matched to its rest pose. */
export function buildLattice(b: SoftBody, box0: Vec3, box1: Vec3, res: number, radius: number): void {
  // particle centres inset by their radius so the collision surface is the authored box; two layers across the
  // thinnest side must not overlap each other (they collide within the body)
  const solidR = Math.min(radius, Math.min(box1[0] - box0[0], box1[1] - box0[1], box1[2] - box0[2]) / 4);
  const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const m = (box0[k] + box1[k]) / 2, h = Math.max((box1[k] - box0[k]) / 2 - solidR, 0.01);
    lo[k] = m - h; hi[k] = m + h;
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const nu = Math.max(2, Math.round(ext[0] / res) + 1), nv = Math.max(2, Math.round(ext[1] / res) + 1), nw = Math.max(2, Math.round(ext[2] / res) + 1);
  b.nu = nu; b.nv = nv; b.nw = nw;
  const n = nu * nv * nw;
  initParticles(b, n, (b.fab.density * (box1[0] - box0[0]) * (box1[1] - box0[1]) * (box1[2] - box0[2])) / n, solidR, true);
  const idx = (u: number, v: number, w: number): number => b.p0 + (w * nv + v) * nu + u;
  for (let w = 0; w < nw; w++) for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    setPos(idx(u, v, w), lo[0] + (ext[0] * u) / (nu - 1), lo[1] + (ext[1] * v) / (nv - 1), lo[2] + (ext[2] * w) / (nw - 1));
  }
  const edges: EdgeDraft[] = [];
  const f = b.fab;
  for (let w = 0; w < nw; w++) for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    const i = idx(u, v, w);
    for (let dw = 0; dw <= 1; dw++) for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
      // each undirected neighbour once: lexicographically positive offsets
      if (dw === 0 && (dv < 0 || (dv === 0 && du <= 0))) continue;
      const U = u + du, V = v + dv, Wd = w + dw;
      if (U < 0 || V < 0 || U >= nu || V >= nv || Wd >= nw) continue;
      const k = Math.abs(du) + Math.abs(dv) + dw;
      edges.push({ i, j: idx(U, V, Wd), a: k === 1 ? f.stretch : f.shear, c0: -1, c1: -1, any: 1 });
    }
    if (u + 2 < nu) edges.push({ i, j: idx(u + 2, v, w), a: f.shear * 2, c0: -1, c1: -1, any: 1 });
    if (v + 2 < nv) edges.push({ i, j: idx(u, v + 2, w), a: f.shear * 2, c0: -1, c1: -1, any: 1 });
    if (w + 2 < nw) edges.push({ i, j: idx(u, v, w + 2), a: f.shear * 2, c0: -1, c1: -1, any: 1 });
  }
  finishEdges(b, edges);
  // rest shape about the centroid
  b.q0 = new Float64Array(n * 3);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pool.x[(b.p0 + i) * 3]; cy += pool.x[(b.p0 + i) * 3 + 1]; cz += pool.x[(b.p0 + i) * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  for (let i = 0; i < n; i++) {
    b.q0[i * 3] = pool.x[(b.p0 + i) * 3] - cx; b.q0[i * 3 + 1] = pool.x[(b.p0 + i) * 3 + 1] - cy; b.q0[i * 3 + 2] = pool.x[(b.p0 + i) * 3 + 2] - cz;
  }
  // six faces as outward quads for rendering
  const s: number[] = [];
  const quad = (a: number, bq: number, c: number, d: number): void => { s.push(a, bq, c, d); };
  for (let v = 0; v < nv - 1; v++) for (let u = 0; u < nu - 1; u++) {
    quad(idx(u, v, 0), idx(u, v + 1, 0), idx(u + 1, v + 1, 0), idx(u + 1, v, 0));
    quad(idx(u, v, nw - 1), idx(u + 1, v, nw - 1), idx(u + 1, v + 1, nw - 1), idx(u, v + 1, nw - 1));
  }
  for (let w = 0; w < nw - 1; w++) for (let u = 0; u < nu - 1; u++) {
    quad(idx(u, 0, w), idx(u + 1, 0, w), idx(u + 1, 0, w + 1), idx(u, 0, w + 1));
    quad(idx(u, nv - 1, w), idx(u, nv - 1, w + 1), idx(u + 1, nv - 1, w + 1), idx(u + 1, nv - 1, w));
  }
  for (let w = 0; w < nw - 1; w++) for (let v = 0; v < nv - 1; v++) {
    quad(idx(0, v, w), idx(0, v, w + 1), idx(0, v + 1, w + 1), idx(0, v + 1, w));
    quad(idx(nu - 1, v, w), idx(nu - 1, v + 1, w), idx(nu - 1, v + 1, w + 1), idx(nu - 1, v, w + 1));
  }
  b.surf = Int32Array.from(s);
}

/** Loose grains: a heap inside the box (lo, hi) at the fabric's angle of repose, or `pts` given explicitly. */
export function buildGrains(b: SoftBody, pts: number[], res: number): void {
  const n = pts.length / 3;
  const r = res * 0.5;
  initParticles(b, n, b.fab.density * res * res * res, r, true);
  for (let k = 0; k < n; k++) setPos(b.p0 + k, pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
}

export function heapPoints(lo: Vec3, hi: Vec3, res: number, slopeDeg: number, fill: boolean, max: number): number[] {
  const out: number[] = [];
  const tan = Math.tan((slopeDeg * Math.PI) / 180);
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  const hx = (hi[0] - lo[0]) / 2, hz = (hi[2] - lo[2]) / 2, H = hi[1] - lo[1];
  const dy = res * 0.87;
  let layer = 0;
  for (let y = lo[1] + res / 2; y <= hi[1] && out.length / 3 < max; y += dy, layer++) {
    const off = (layer & 1) * res * 0.5;
    for (let x = lo[0] + res / 2 + off; x <= hi[0] - res / 2 + 1e-6; x += res) {
      for (let z = lo[2] + res / 2 + off; z <= hi[2] - res / 2 + 1e-6; z += res) {
        const edge = Math.min(hx - Math.abs(x - cx), hz - Math.abs(z - cz));
        if (!fill && y - lo[1] > Math.min(H, edge * tan) + res * 0.25) continue;
        out.push(x, y, z);
        if (out.length / 3 >= max) break;
      }
      if (out.length / 3 >= max) break;
    }
  }
  return out;
}

export function fabricOf(id: FabricId): Fabric {
  return FABRICS[id];
}

/* ---------------- kernels (one substep) ---------------- */

export function integrate(b: SoftBody, h: number, gy: number, damp: number): void {
  const X = pool.x, PX = pool.px, V = pool.v, W = pool.w, FL = pool.fl;
  const k = Math.max(0, 1 - damp * h);
  for (let i = b.p0, e = b.p0 + b.n; i < e; i++) {
    const i3 = i * 3;
    PX[i3] = X[i3]; PX[i3 + 1] = X[i3 + 1]; PX[i3 + 2] = X[i3 + 2];
    if (W[i] === 0 || !(FL[i] & ALIVE)) continue;
    V[i3] *= k; V[i3 + 1] = (V[i3 + 1] + gy * h) * k; V[i3 + 2] *= k;
    X[i3] += V[i3] * h; X[i3 + 1] += V[i3 + 1] * h; X[i3 + 2] += V[i3 + 2] * h;
  }
}

export function solveEdges(b: SoftBody, h: number, from = 0): void {
  const X = pool.x, W = pool.w, ei = b.ei, el = b.el, ea = b.ea, al = b.eAlive, slack = b.slack;
  const ih2 = 1 / (h * h);
  for (let e = from, ne = b.ne; e < ne; e++) {
    if (!al[e]) continue;
    const i = ei[e * 2], j = ei[e * 2 + 1], wi = W[i], wj = W[j], ws = wi + wj;
    if (ws === 0) continue;
    const i3 = i * 3, j3 = j * 3;
    const dx = X[j3] - X[i3], dy = X[j3 + 1] - X[i3 + 1], dz = X[j3 + 2] - X[i3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9 || (slack && d < el[e])) continue;
    const dl = (d - el[e]) / (d * (ws + ea[e] * ih2));
    const ax = dx * dl, ay = dy * dl, az = dz * dl;
    X[i3] += ax * wi; X[i3 + 1] += ay * wi; X[i3 + 2] += az * wi;
    X[j3] -= ax * wj; X[j3 + 1] -= ay * wj; X[j3 + 2] -= az * wj;
  }
}

let TA = new Float64Array(64), TB = new Float64Array(64), TC = new Float64Array(64), TD = new Float64Array(64), TN = new Float64Array(192);

/**
 * A rope's segment constraints solved together (Thomas algorithm on the tridiagonal system of one linearised XPBD
 * step): tension carries the whole length of the chain in one pass whatever the particle masses. Segments are
 * edges 0..n−2 (buildRope). Pinned ends are driven (rigid here; the chain's pull on them goes to their host).
 * Belt friction: consecutive particles resting on rigid surfaces form a contact run, held where it lies (rigid in
 * the solve) while the tension pulling it one way stays within the capstan limit of the tension the other way,
 * T₂ ≤ T₁·e^{μθ} (θ the rope's turn across the run) plus friction on its own weight; past that the run slips.
 */
export function solveChain(b: SoftBody, h: number, gy: number): void {
  if (b.n < 2) return;
  if (TW.length < b.n) { TW = new Float64Array(b.n * 2); TS = new Uint8Array(b.n * 2); }
  const FL = pool.fl, p0 = b.p0, cn = b.cn, X = pool.x, PX = pool.px;
  for (let k = 0; k < b.n; k++) {
    const i = p0 + k;
    TS[k] = cn && cn[k * 4 + 3] > 0 && !(FL[i] & PINNED) && pool.w[i] > 0 ? 1 : 0;
    if (TS[k]) { X[i * 3] = PX[i * 3]; X[i * 3 + 1] = PX[i * 3 + 1]; X[i * 3 + 2] = PX[i * 3 + 2]; }
  }
  /* A light rope under a heavy load carries transverse waves faster than a segment per substep (c = √(T/ρ)), which
     no linearised step follows; across the rope its particles move as if at least a twentieth of the heaviest load
     on it (along it they keep their own mass, so tension and weight are true). */
  let mMax = 0;
  for (let k = 0; k < b.n; k++) if (pool.m[p0 + k] > mMax) mMax = pool.m[p0 + k];
  for (const pin of b.pins) if (pin.alive && pin.piece && !pin.piece.root.spec.anchored && pin.piece.mass > mMax) mMax = pin.piece.mass;
  CAP = 20 / mMax;
  // one Newton step is exact only for small turns (a whipping end turns fast): two, the first settling the held set
  for (let pass = 0; pass < 2; pass++) {
    let guard = 0;
    do {
      for (let k = 0; k < b.n; k++) TW[k] = FL[p0 + k] & PINNED || TS[k] ? 0 : pool.w[p0 + k];
      chainSolve(b, h);
    } while (pass === 0 && cn && ++guard < 16 && slipRuns(b, h, gy));
    chainApply(b, h);
    // the bending links between the passes: a kink must not look like give to the second
    if (pass === 0) solveEdges(b, h, b.n - 1);
  }
}

/** let go every contact run the chain pulls past its capstan limit; true if any went */
function slipRuns(b: SoftBody, h: number, gy: number): boolean {
  const cn = b.cn!, m = b.n - 1, M = pool.m, p0 = b.p0;
  let any = false;
  for (let a = 0; a < b.n; a++) {
    if (!TS[a]) continue;
    let e = a;
    while (e + 1 < b.n && TS[e + 1]) e++;
    // boundary tensions (−Δλ; a rope pushes nothing) and the turn, friction and weight across the run
    const t0 = a > 0 ? Math.max(0, -TD[a - 1]) : 0, t1 = e < m ? Math.max(0, -TD[e]) : 0;
    let th = 0, mu = 0, wt = 0;
    for (let k = a; k <= e; k++) {
      if (k > 0 && k < m) {
        const c = TN[k * 3 - 3] * TN[k * 3] + TN[k * 3 - 2] * TN[k * 3 + 1] + TN[k * 3 - 1] * TN[k * 3 + 2];
        th += Math.acos(Math.max(-1, Math.min(1, c)));
      }
      mu += cn[k * 4 + 3];
      wt += M[p0 + k] * Math.max(0, cn[k * 4 + 1]);
    }
    mu /= e - a + 1;
    const hi = Math.max(t0, t1), lo = Math.min(t0, t1);
    if (hi > lo * Math.exp(mu * th) + mu * wt * -gy * h * h) {
      for (let k = a; k <= e; k++) TS[k] = 0;
      any = true;
    }
    a = e;
  }
  return any;
}

/* Mobility of chain particle k: M = w·P·A·P, where A gives full motion along the rope and a share across it (TSD,
   capped under a heavy load), and P removes motion into the surface a sliding particle rests on. Into _mv. */
const _mv = new Float64Array(3);
function mobVec(b: SoftBody, k: number, vx: number, vy: number, vz: number): void {
  const w = TW[k];
  if (w === 0) { _mv[0] = _mv[1] = _mv[2] = 0; return; }
  const cn = b.cn, q = k * 4, slide = !!cn && cn[q + 3] > 0;
  if (slide) { const d = vx * cn[q] + vy * cn[q + 1] + vz * cn[q + 2]; vx -= d * cn[q]; vy -= d * cn[q + 1]; vz -= d * cn[q + 2]; }
  const t = k * 3, tv = vx * TT[t] + vy * TT[t + 1] + vz * TT[t + 2], sd = TSD[k];
  vx = TT[t] * tv + sd * (vx - TT[t] * tv); vy = TT[t + 1] * tv + sd * (vy - TT[t + 1] * tv); vz = TT[t + 2] * tv + sd * (vz - TT[t + 2] * tv);
  if (slide) { const d = vx * cn![q] + vy * cn![q + 1] + vz * cn![q + 2]; vx -= d * cn![q]; vy -= d * cn![q + 1]; vz -= d * cn![q + 2]; }
  _mv[0] = vx * w; _mv[1] = vy * w; _mv[2] = vz * w;
}
function mob(b: SoftBody, k: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  mobVec(b, k, bx, by, bz);
  return ax * _mv[0] + ay * _mv[1] + az * _mv[2];
}

function chainSolve(b: SoftBody, h: number): void {
  const m = b.n - 1;
  if (TA.length < m) { TA = new Float64Array(m * 2); TB = new Float64Array(m * 2); TC = new Float64Array(m * 2); TD = new Float64Array(m * 2); TN = new Float64Array(m * 6); }
  const X = pool.x, el = b.el, al = b.eAlive, p0 = b.p0, at = b.fab.stretch / (h * h);
  for (let k = 0; k < m; k++) {
    const i = (p0 + k) * 3, j = i + 3;
    const dx = X[j] - X[i], dy = X[j + 1] - X[i + 1], dz = X[j + 2] - X[i + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const live = al[k] && d > 1e-9;
    if (live) { TN[k * 3] = dx / d; TN[k * 3 + 1] = dy / d; TN[k * 3 + 2] = dz / d; } else TN[k * 3] = TN[k * 3 + 1] = TN[k * 3 + 2] = 0;
    const nx = TN[k * 3], ny = TN[k * 3 + 1], nz = TN[k * 3 + 2];
    TB[k] = live ? mob(b, k, nx, ny, nz, nx, ny, nz) + mob(b, k + 1, nx, ny, nz, nx, ny, nz) + at : 1;
    TD[k] = live ? -(d - el[k]) : 0;
  }
  // each particle's tangent, and its share of motion across the rope (see solveChain)
  if (TT.length < b.n * 3) { TT = new Float64Array(b.n * 6); TSD = new Float64Array(b.n * 2); }
  for (let k = 0; k <= m; k++) TSD[k] = Math.min(1, CAP / Math.max(1e-9, pool.w[p0 + k]));
  for (let k = 0; k <= m; k++) {
    let x = 0, y = 0, z = 0;
    if (k < m) { x += TN[k * 3]; y += TN[k * 3 + 1]; z += TN[k * 3 + 2]; }
    if (k > 0) { x += TN[k * 3 - 3]; y += TN[k * 3 - 2]; z += TN[k * 3 - 1]; }
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    TT[k * 3] = x / l; TT[k * 3 + 1] = y / l; TT[k * 3 + 2] = z / l;
  }
  for (let k = 0; k < m; k++) {
    const i = (p0 + k) * 3, nx = TN[k * 3], ny = TN[k * 3 + 1], nz = TN[k * 3 + 2];
    if (al[k] && (nx || ny || nz)) TB[k] = mob(b, k, nx, ny, nz, nx, ny, nz) + mob(b, k + 1, nx, ny, nz, nx, ny, nz) + at;
    void i;
  }
  for (let k = 0; k < m; k++) {
    const n0 = k * 3;
    // coupling through the shared particle k+1
    TC[k] = k + 1 < m ? -mob(b, k + 1, TN[n0], TN[n0 + 1], TN[n0 + 2], TN[n0 + 3], TN[n0 + 4], TN[n0 + 5]) : 0;
    TA[k] = k > 0 ? TC[k - 1] : 0;
  }
  // forward sweep, back substitution (TD becomes Δλ)
  for (let k = 1; k < m; k++) {
    const f = TA[k] / TB[k - 1];
    TB[k] -= f * TC[k - 1];
    TD[k] -= f * TD[k - 1];
  }
  TD[m - 1] /= TB[m - 1];
  for (let k = m - 2; k >= 0; k--) TD[k] = (TD[k] - TC[k] * TD[k + 1]) / TB[k];
}

function chainApply(b: SoftBody, h: number): void {
  const m = b.n - 1, X = pool.x, FL = pool.fl, p0 = b.p0, W = TW;
  for (let k = 0; k <= m; k++) {
    const i = (p0 + k) * 3, w = W[k];
    let gx = 0, gy = 0, gz = 0;
    if (k < m) { const l = TD[k]; gx -= TN[k * 3] * l; gy -= TN[k * 3 + 1] * l; gz -= TN[k * 3 + 2] * l; }
    if (k > 0) { const l = TD[k - 1]; gx += TN[k * 3 - 3] * l; gy += TN[k * 3 - 2] * l; gz += TN[k * 3 - 1] * l; }
    if (w > 0) {
      mobVec(b, k, gx, gy, gz);
      const dx = _mv[0], dy = _mv[1], dz = _mv[2];
      X[i] += dx; X[i + 1] += dy; X[i + 2] += dz;
      continue;
    }
    if (!(FL[p0 + k] & PINNED)) continue;
    for (const pin of b.pins) {
      if (!pin.alive || pin.i !== p0 + k) continue;
      pin.J[0] += gx / h; pin.J[1] += gy / h; pin.J[2] += gz / h;
      pin.f += Math.sqrt(gx * gx + gy * gy + gz * gz) / (h * h);
    }
  }
}
let TW = new Float64Array(64);
let TT = new Float64Array(192);
let TSD = new Float64Array(64);
let CAP = Infinity;
let TS = new Uint8Array(64);

export function solveBending(b: SoftBody, h: number, alpha: number): void {
  const X = pool.x, W = pool.w, bi = b.bi, bk = b.bk, al = b.bAlive;
  const at = alpha / (h * h);
  for (let q = 0, nb = b.nb; q < nb; q++) {
    if (!al[q]) continue;
    const o = q * 4;
    let ex = 0, ey = 0, ez = 0, den = at;
    for (let k = 0; k < 4; k++) {
      const p = bi[o + k] * 3, K = bk[o + k];
      ex += K * X[p]; ey += K * X[p + 1]; ez += K * X[p + 2];
      den += W[bi[o + k]] * K * K;
    }
    const C = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (C < 1e-9 || den < 1e-12) continue;
    const s = -1 / den; // Δλ / C, applied along ê·C = e
    for (let k = 0; k < 4; k++) {
      const i = bi[o + k], p = i * 3, g = W[i] * bk[o + k] * s;
      X[p] += g * ex; X[p + 1] += g * ey; X[p + 2] += g * ez;
    }
  }
}

/** Long-range attachments: never let a particle drift further from its pin than it is along the cloth. */
export function solveTethers(b: SoftBody, h: number): void {
  if (!b.lraPin.length) return;
  const X = pool.x, W = pool.w, M = pool.m, lp = b.lraPin, ld = b.lraD;
  for (let k = 0; k < b.n; k++) {
    const pi = lp[k];
    if (pi < 0) continue;
    const pin = b.pins[pi];
    if (!pin.alive) continue;
    const i = b.p0 + k;
    if (W[i] === 0) continue;
    const i3 = i * 3, t = pin.t;
    const dx = X[i3] - t[0], dy = X[i3 + 1] - t[1], dz = X[i3 + 2] - t[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const over = d - ld[k];
    if (over <= 0) continue;
    const s = over / d;
    X[i3] -= dx * s; X[i3 + 1] -= dy * s; X[i3 + 2] -= dz * s;
    const j = (M[i] * s) / h;
    pin.J[0] += dx * j; pin.J[1] += dy * j; pin.J[2] += dz * j;
    pin.f += (M[i] * over) / (h * h);
  }
}

export function solvePins(b: SoftBody, h: number, alpha: number): void {
  const X = pool.x, W = pool.w, at = alpha / (h * h);
  for (const pin of b.pins) {
    if (!pin.alive) continue;
    const i = pin.i, i3 = i * 3, w = W[i], t = pin.t;
    const dx = X[i3] - t[0], dy = X[i3 + 1] - t[1], dz = X[i3 + 2] - t[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-12 || w === 0) continue;
    const lam = d / (w + at);           // |Δλ|
    const s = (w * lam) / d;
    X[i3] -= dx * s; X[i3 + 1] -= dy * s; X[i3 + 2] -= dz * s;
    const j = lam / (h * d);
    pin.J[0] += dx * j; pin.J[1] += dy * j; pin.J[2] += dz * j;
    pin.f += lam / (h * h);
  }
}

/** Strain limiting: no edge longer than its cap (latex stiffening, yarns running out of crimp). */
export function solveLimits(b: SoftBody): void {
  const lim = b.eMax;
  if (!lim) return;
  const X = pool.x, W = pool.w, ei = b.ei, al = b.eAlive;
  for (let e = 0, ne = b.ne; e < ne; e++) {
    if (!al[e]) continue;
    const i = ei[e * 2], j = ei[e * 2 + 1], ws = W[i] + W[j];
    if (ws === 0) continue;
    const i3 = i * 3, j3 = j * 3;
    const dx = X[j3] - X[i3], dy = X[j3 + 1] - X[i3 + 1], dz = X[j3 + 2] - X[i3 + 2];
    const d2 = dx * dx + dy * dy + dz * dz, L = lim[e];
    if (d2 <= L * L) continue;
    const d = Math.sqrt(d2), k = (d - L) / (d * ws);
    X[i3] += dx * k * W[i]; X[i3 + 1] += dy * k * W[i]; X[i3 + 2] += dz * k * W[i];
    X[j3] -= dx * k * W[j]; X[j3 + 1] -= dy * k * W[j]; X[j3 + 2] -= dz * k * W[j];
  }
}

/** Seams: each stitch holds its two coincident particles together (zero rest length, the cloth's compliance). */
export function solveSeams(b: SoftBody, h: number): void {
  const X = pool.x, W = pool.w, st = b.sti, on = b.stOn, at = (b.fab.warp ?? b.fab.stretch) / (h * h);
  for (let k = 0, n = b.nst; k < n; k++) {
    if (!on[k]) continue;
    const i = st[k * 2], j = st[k * 2 + 1], wi = W[i], wj = W[j], ws = wi + wj;
    if (ws === 0) continue;
    const i3 = i * 3, j3 = j * 3;
    const s = 1 / (ws + at);
    const dx = (X[j3] - X[i3]) * s, dy = (X[j3 + 1] - X[i3 + 1]) * s, dz = (X[j3 + 2] - X[i3 + 2]) * s;
    X[i3] += dx * wi; X[i3 + 1] += dy * wi; X[i3 + 2] += dz * wi;
    X[j3] -= dx * wj; X[j3 + 1] -= dy * wj; X[j3 + 2] -= dz * wj;
  }
}

/** Board and paper: a hinge folded past the crease limit loses its stiffness for good (it stays folded). */
export function creaseCheck(b: SoftBody): number {
  const L = b.bL, lim = b.fab.crease;
  if (!L || !lim) return 0;
  const X = pool.x, bi = b.bi, bk = b.bk, al = b.bAlive;
  let n = 0;
  for (let q = 0, nb = b.nb; q < nb; q++) {
    if (!al[q]) continue;
    const o = q * 4;
    let ex = 0, ey = 0, ez = 0;
    for (let k = 0; k < 4; k++) { const p = bi[o + k] * 3, K = bk[o + k]; ex += K * X[p]; ey += K * X[p + 1]; ez += K * X[p + 2]; }
    if (ex * ex + ey * ey + ez * ez > (lim * L[q]) ** 2) { al[q] = 0; n++; }
  }
  return n;
}

/** Plastic shape matching: where a particle has been held off its goal by more than the yield, the rest shape
    gives way under it (a crushed carton stays crushed). */
export function plasticYield(b: SoftBody, yieldDev: number, rate: number): number {
  const q0 = b.q0, G = b.goal;
  if (!q0 || !G) return 0;
  const X = pool.x, FL = pool.fl, q = b.rot;
  const x = q[0], y = q[1], z = q[2], w = q[3];
  // Rᵀ columns
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  let moved = 0;
  for (let k = 0; k < b.n; k++) {
    const i = b.p0 + k;
    if (!(FL[i] & ALIVE)) continue;
    const dx = X[i * 3] - G[k * 3], dy = X[i * 3 + 1] - G[k * 3 + 1], dz = X[i * 3 + 2] - G[k * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d <= yieldDev) continue;
    const s = ((d - yieldDev) / d) * rate;
    q0[k * 3] += (r00 * dx + r10 * dy + r20 * dz) * s;
    q0[k * 3 + 1] += (r01 * dx + r11 * dy + r21 * dz) * s;
    q0[k * 3 + 2] += (r02 * dx + r12 * dy + r22 * dz) * s;
    moved++;
  }
  if (moved) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < b.n; k++) { cx += q0[k * 3]; cy += q0[k * 3 + 1]; cz += q0[k * 3 + 2]; }
    cx /= b.n; cy /= b.n; cz /= b.n;
    for (let k = 0; k < b.n; k++) { q0[k * 3] -= cx; q0[k * 3 + 1] -= cy; q0[k * 3 + 2] -= cz; }
  }
  return moved;
}

/**
 * Crush a box's rest shape by `s` (a share of its depth) along the unit direction d (the load): the walls give way
 * and fold, so shape matching and its edges hold the crushed shape from then on.
 */
export function crushShape(b: SoftBody, dx: number, dy: number, dz: number, s: number): void {
  const q0 = b.q0;
  if (!q0) return;
  const q = b.rot, x = q[0], y = q[1], z = q[2], w = q[3];
  // the load direction in the rest frame (Rᵀd)
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  const lx = r00 * dx + r10 * dy + r20 * dz, ly = r01 * dx + r11 * dy + r21 * dz, lz = r02 * dx + r12 * dy + r22 * dz;
  for (let k = 0; k < b.n; k++) {
    const t = (q0[k * 3] * lx + q0[k * 3 + 1] * ly + q0[k * 3 + 2] * lz) * s;
    q0[k * 3] -= lx * t; q0[k * 3 + 1] -= ly * t; q0[k * 3 + 2] -= lz * t;
  }
  const p0 = b.p0;
  for (let e = 0; e < b.ne; e++) {
    const i = (b.ei[e * 2] - p0) * 3, j = (b.ei[e * 2 + 1] - p0) * 3;
    b.el[e] = Math.hypot(q0[j] - q0[i], q0[j + 1] - q0[i + 1], q0[j + 2] - q0[i + 2]);
  }
}

/** Rest shape for shape matching: the current pose about its centroid. */
export function captureShape(b: SoftBody): void {
  const n = b.n;
  b.q0 = new Float64Array(n * 3);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pool.x[(b.p0 + i) * 3]; cy += pool.x[(b.p0 + i) * 3 + 1]; cz += pool.x[(b.p0 + i) * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  for (let i = 0; i < n; i++) {
    b.q0[i * 3] = pool.x[(b.p0 + i) * 3] - cx; b.q0[i * 3 + 1] = pool.x[(b.p0 + i) * 3 + 1] - cy; b.q0[i * 3 + 2] = pool.x[(b.p0 + i) * 3 + 2] - cz;
  }
}

const A = new Float64Array(9);
/** Müller et al. meshless shape matching; rotation by the iterative polar extraction of Müller 2016. */
export function solveShape(b: SoftBody, stiffness: number): void {
  const q0 = b.q0;
  if (!q0) return;
  const X = pool.x, M = pool.m, FL = pool.fl;
  let cx = 0, cy = 0, cz = 0, mt = 0;
  for (let k = 0; k < b.n; k++) {
    const i = b.p0 + k;
    if (!(FL[i] & ALIVE)) continue;
    const m = M[i];
    cx += X[i * 3] * m; cy += X[i * 3 + 1] * m; cz += X[i * 3 + 2] * m; mt += m;
  }
  if (mt <= 0) return;
  cx /= mt; cy /= mt; cz /= mt;
  A.fill(0);
  for (let k = 0; k < b.n; k++) {
    const i = b.p0 + k;
    if (!(FL[i] & ALIVE)) continue;
    const m = M[i], px = X[i * 3] - cx, py = X[i * 3 + 1] - cy, pz = X[i * 3 + 2] - cz;
    const qx = q0[k * 3], qy = q0[k * 3 + 1], qz = q0[k * 3 + 2];
    A[0] += m * px * qx; A[1] += m * px * qy; A[2] += m * px * qz;
    A[3] += m * py * qx; A[4] += m * py * qy; A[5] += m * py * qz;
    A[6] += m * pz * qx; A[7] += m * pz * qy; A[8] += m * pz * qz;
  }
  const q = b.rot;
  for (let it = 0; it < 4; it++) {
    // columns of R(q)
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + w * z), r20 = 2 * (x * z - w * y);
    const r01 = 2 * (x * y - w * z), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + w * x);
    const r02 = 2 * (x * z + w * y), r12 = 2 * (y * z - w * x), r22 = 1 - 2 * (x * x + y * y);
    // ω = Σ r_i × a_i / |Σ r_i·a_i|  (a_i = columns of A)
    const ox = (r10 * A[6] - r20 * A[3]) + (r11 * A[7] - r21 * A[4]) + (r12 * A[8] - r22 * A[5]);
    const oy = (r20 * A[0] - r00 * A[6]) + (r21 * A[1] - r01 * A[7]) + (r22 * A[2] - r02 * A[8]);
    const oz = (r00 * A[3] - r10 * A[0]) + (r01 * A[4] - r11 * A[1]) + (r02 * A[5] - r12 * A[2]);
    const dn = Math.abs(r00 * A[0] + r10 * A[3] + r20 * A[6] + r01 * A[1] + r11 * A[4] + r21 * A[7] + r02 * A[2] + r12 * A[5] + r22 * A[8]) + 1e-9;
    const wx = ox / dn, wy = oy / dn, wz = oz / dn;
    const ang = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (ang < 1e-9) break;
    const s = Math.sin(ang / 2) / ang, c = Math.cos(ang / 2);
    const ax = wx * s, ay = wy * s, az = wz * s;
    // q = dq * q
    const nx = c * x + ax * w + ay * z - az * y;
    const ny = c * y - ax * z + ay * w + az * x;
    const nz = c * z + ax * y - ay * x + az * w;
    const nw = c * w - ax * x - ay * y - az * z;
    const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    q[0] = nx * l; q[1] = ny * l; q[2] = nz * l; q[3] = nw * l;
  }
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  const W = pool.w;
  if (!b.goal) b.goal = new Float64Array(b.n * 3);
  const G = b.goal;
  for (let k = 0; k < b.n; k++) {
    const i = b.p0 + k;
    if (!(FL[i] & ALIVE) || W[i] === 0) continue;
    const qx = q0[k * 3], qy = q0[k * 3 + 1], qz = q0[k * 3 + 2];
    const gx = cx + r00 * qx + r01 * qy + r02 * qz, gy = cy + r10 * qx + r11 * qy + r12 * qz, gz = cz + r20 * qx + r21 * qy + r22 * qz;
    if (G) { G[k * 3] = gx; G[k * 3 + 1] = gy; G[k * 3 + 2] = gz; }
    X[i * 3] += (gx - X[i * 3]) * stiffness; X[i * 3 + 1] += (gy - X[i * 3 + 1]) * stiffness; X[i * 3 + 2] += (gz - X[i * 3 + 2]) * stiffness;
  }
}

export function updateVelocity(b: SoftBody, h: number, vmax: number): void {
  const X = pool.x, PX = pool.px, V = pool.v, W = pool.w;
  const ih = 1 / h, v2 = vmax * vmax;
  for (let i = b.p0, e = b.p0 + b.n; i < e; i++) {
    if (W[i] === 0) continue;
    const i3 = i * 3;
    let vx = (X[i3] - PX[i3]) * ih, vy = (X[i3 + 1] - PX[i3 + 1]) * ih, vz = (X[i3 + 2] - PX[i3 + 2]) * ih;
    const s2 = vx * vx + vy * vy + vz * vz;
    if (s2 > v2) { const k = vmax / Math.sqrt(s2); vx *= k; vy *= k; vz *= k; }
    V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
  }
}

export function pinParticle(b: SoftBody, pin: Pin): void {
  b.pins.push(pin);
  pool.fl[pin.i] |= PINNED;
}
