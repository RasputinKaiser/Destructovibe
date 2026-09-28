import * as THREE from 'three';
import type { Vec3 } from '../types';
import * as P from '../destruction/polytope';
import { setPieceGeometry, batchScene } from '../destruction/batches';
import type { Piece } from '../destruction/structure';

/* Plastic deformation of a piece's render mesh: dents, crumple (accordion folds) and buckling waves, all in the body
   frame, on top of the piece's own rest mesh refined so a dent has vertices to bend. The refinement bisects the
   longest edge of each triangle, keyed by edge position so both faces of a crease split together and nothing opens
   up when displaced. Deformed pieces own their geometry; untouched pieces keep the shared batch path. */

export const MAX_DEFORMED = 200;
const MAX_VERTS = 7000;

interface Deformed {
  p: Piece;
  rest: Float32Array;       // refined rest positions, ext then int
  dent: Float32Array;       // accumulated dent displacement
  extN: number;
  ext: THREE.BufferGeometry | null;
  int: THREE.BufferGeometry | null;
  crush: { a: Vec3; d: number; s0: number; s1: number; c: Vec3 } | null;
  wave: { n: Vec3; u: Vec3; v: Vec3; amp: number; u0: number; lu: number; v0: number; lv: number; m: number } | null;
}

const states = new Map<Piece, Deformed>();

export function deformedCount(): number {
  for (const [p] of states) if (p.dead) states.delete(p);
  return states.size;
}

export function isDeformed(p: Piece): boolean {
  return states.has(p);
}

function meshOf(p: Piece): P.MeshData {
  const sz = p.root.spec.size, grain = sz[0] >= sz[1] && sz[0] >= sz[2] ? 0 : sz[1] >= sz[2] ? 1 : 2;
  return p.parts ? P.mergeMeshes(p.parts.map(q => P.buildMesh(q.poly, p.uvOrigin, q.cyl, p.mat, grain)))
    : P.buildMesh(p.poly, p.uvOrigin, p.cyl, p.mat, grain);
}

interface Soup { pos: number[]; uv: number[]; wear: number[]; tri: number[] }

const q = (x: number) => Math.round(x * 2e4);
const pk = (pos: number[], i: number) => `${q(pos[i * 3])},${q(pos[i * 3 + 1])},${q(pos[i * 3 + 2])}`;
const ek = (pos: number[], a: number, b: number) => { const ka = pk(pos, a), kb = pk(pos, b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };

/* Conforming longest-edge bisection until every edge is shorter than L (or the vertex budget runs out). */
function refine(s: Soup, L: number): void {
  const marked = new Set<string>();
  const mids = new Map<string, number>();
  const len2 = (a: number, b: number) => {
    const dx = s.pos[a * 3] - s.pos[b * 3], dy = s.pos[a * 3 + 1] - s.pos[b * 3 + 1], dz = s.pos[a * 3 + 2] - s.pos[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const longest = (t: number): number => {
    const a = s.tri[t], b = s.tri[t + 1], c = s.tri[t + 2];
    const l0 = len2(a, b), l1 = len2(b, c), l2 = len2(c, a);
    return l0 >= l1 && l0 >= l2 ? 0 : l1 >= l2 ? 1 : 2;
  };
  for (let t = 0; t < s.tri.length; t += 3) {
    const e = longest(t), a = s.tri[t + e], b = s.tri[t + (e + 1) % 3];
    if (len2(a, b) > L * L) marked.add(ek(s.pos, a, b));
  }
  for (let pass = 0; pass < 40 && marked.size; pass++) {
    let changed = false;
    const out: number[] = [];
    for (let t = 0; t < s.tri.length; t += 3) {
      const v = [s.tri[t], s.tri[t + 1], s.tri[t + 2]];
      let any = false;
      for (let k = 0; k < 3; k++) if (marked.has(ek(s.pos, v[k], v[(k + 1) % 3]))) { any = true; break; }
      if (!any || s.pos.length / 3 > MAX_VERTS) { out.push(v[0], v[1], v[2]); continue; }
      const e = longest(t), a = v[e], b = v[(e + 1) % 3], c = v[(e + 2) % 3];
      const key = ek(s.pos, a, b);
      marked.add(key);
      const ik = a < b ? `${a}:${b}` : `${b}:${a}`;
      let m = mids.get(ik);
      if (m === undefined) {
        m = s.pos.length / 3;
        for (let k = 0; k < 3; k++) s.pos.push((s.pos[a * 3 + k] + s.pos[b * 3 + k]) / 2);
        s.uv.push((s.uv[a * 2] + s.uv[b * 2]) / 2, (s.uv[a * 2 + 1] + s.uv[b * 2 + 1]) / 2);
        s.wear.push((s.wear[a] + s.wear[b]) / 2);
        mids.set(ik, m);
      }
      out.push(a, m, c, m, b, c);
      changed = true;
      if (len2(a, m) > L * L) marked.add(ek(s.pos, a, m));
      if (len2(m, c) > L * L && len2(m, c) >= len2(a, c) && len2(m, c) >= len2(a, m)) marked.add(ek(s.pos, m, c));
    }
    s.tri = out;
    if (!changed) break;
  }
}

function build(p: Piece): Deformed | null {
  if (p.cyl) return null;
  const md = meshOf(p);
  const soup: Soup = { pos: [], uv: [], wear: [], tri: [] };
  for (let i = 0; i < md.extCount; i++) {
    soup.pos.push(md.position[i * 3], md.position[i * 3 + 1], md.position[i * 3 + 2]);
    soup.uv.push(md.uv[i * 2], md.uv[i * 2 + 1]);
    soup.wear.push(md.wear[i] ?? 0);
  }
  for (let i = 0; i < md.extIndex; i++) soup.tri.push(md.index[i]);
  let area = 0;
  for (let t = 0; t < soup.tri.length; t += 3) {
    const a = soup.tri[t] * 3, b = soup.tri[t + 1] * 3, c = soup.tri[t + 2] * 3, s = soup.pos;
    const ux = s[b] - s[a], uy = s[b + 1] - s[a + 1], uz = s[b + 2] - s[a + 2], vx = s[c] - s[a], vy = s[c + 1] - s[a + 1], vz = s[c + 2] - s[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  refine(soup, Math.max(0.05, Math.min(0.3, Math.sqrt(area / 2500))));
  const extN = soup.pos.length / 3, intN = md.intCount;
  const rest = new Float32Array((extN + intN) * 3);
  rest.set(soup.pos);
  rest.set(md.position.subarray(md.extCount * 3, (md.extCount + intN) * 3), extN * 3);
  const d: Deformed = { p, rest, dent: new Float32Array(rest.length), extN, ext: null, int: null, crush: null, wave: null };
  if (extN && soup.tri.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(extN * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(extN * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(soup.uv), 2));
    g.setAttribute('wear', new THREE.BufferAttribute(new Float32Array(soup.wear), 1));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(soup.tri), 1));
    d.ext = g;
  }
  if (intN && md.intIndex) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(intN * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(intN * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(md.uv.slice(md.extCount * 2, (md.extCount + intN) * 2), 2));
    g.setIndex(new THREE.BufferAttribute(md.index.slice(md.extIndex, md.extIndex + md.intIndex), 1));
    d.int = g;
  }
  return d;
}

function stateOf(p: Piece): Deformed | null {
  let d = states.get(p);
  if (d) return d;
  if (p.dead || deformedCount() >= MAX_DEFORMED) return null;
  d = build(p) ?? undefined;
  if (!d) return null;
  states.set(p, d);
  return d;
}

function normals(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position').array as Float32Array, nor = g.getAttribute('normal').array as Float32Array, idx = g.getIndex()!.array;
  nor.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { nor[i] += nx; nor[i + 1] += ny; nor[i + 2] += nz; }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
}

function commit(d: Deformed): void {
  const r = d.rest, dn = d.dent, c = d.crush, w = d.wave;
  const write = (g: THREE.BufferGeometry | null, from: number, n: number) => {
    if (!g) return;
    const pos = g.getAttribute('position').array as Float32Array;
    for (let i = 0; i < n; i++) {
      const j = (from + i) * 3;
      let x = r[j] + dn[j], y = r[j + 1] + dn[j + 1], z = r[j + 2] + dn[j + 2];
      if (c && c.d > 0) {
        const s = r[j] * c.a[0] + r[j + 1] * c.a[1] + r[j + 2] * c.a[2];
        const t = Math.min(1, Math.max(0, (s - c.s0) / (c.s1 - c.s0)));
        x -= c.d * t * c.a[0]; y -= c.d * t * c.a[1]; z -= c.d * t * c.a[2];
        /* folds: the compressed length buckles outward in lobes about 0.15 m long, deepest at the struck end */
        const ox = r[j] - c.c[0] - s * c.a[0], oy = r[j + 1] - c.c[1] - s * c.a[1], oz = r[j + 2] - c.c[2] - s * c.a[2];
        const ol = Math.hypot(ox, oy, oz);
        if (ol > 1e-4) {
          const lobes = Math.max(2, (c.s1 - c.s0) / 0.15);
          const k = Math.min(0.07, 0.2 * c.d) * Math.abs(Math.sin(Math.PI * lobes * t)) * Math.max(0, 1 - t * 0.8);
          x += (ox / ol) * k; y += (oy / ol) * k; z += (oz / ol) * k;
        }
      }
      if (w && w.amp > 0) {
        const u = r[j] * w.u[0] + r[j + 1] * w.u[1] + r[j + 2] * w.u[2], v = r[j] * w.v[0] + r[j + 1] * w.v[1] + r[j + 2] * w.v[2];
        const k = w.amp * Math.sin((Math.PI * w.m * (u - w.u0)) / w.lu) * Math.sin((Math.PI * (v - w.v0)) / w.lv);
        x += w.n[0] * k; y += w.n[1] * k; z += w.n[2] * k;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    g.getAttribute('position').needsUpdate = true;
    normals(g);
  };
  write(d.ext, 0, d.extN);
  write(d.int, d.extN, d.rest.length / 3 - d.extN);
  if (!d.p.dead) setPieceGeometry(d.p.gfx, d.ext, d.int);
}

/** Deepest existing dent within r of a body-frame point (m): the work-hardened region resists further denting. */
export function dentDepthAt(p: Piece, pt: Vec3, r: number): number {
  const d = states.get(p);
  if (!d) return 0;
  let best = 0;
  const rr = r * r, a = d.rest, dn = d.dent;
  for (let j = 0; j < a.length; j += 3) {
    const dx = a[j] - pt[0], dy = a[j + 1] - pt[1], dz = a[j + 2] - pt[2];
    if (dx * dx + dy * dy + dz * dz > rr) continue;
    const m = Math.hypot(dn[j], dn[j + 1], dn[j + 2]);
    if (m > best) best = m;
  }
  return best;
}

/** Ball dent: push the surface within `radius` of the body-frame point along `dir` by up to `depth` (smooth falloff). */
export function dent(p: Piece, pt: Vec3, dir: Vec3, radius: number, depth: number): boolean {
  const d = stateOf(p);
  if (!d || depth <= 0) return false;
  const a = d.rest, dn = d.dent, rr = radius * radius;
  for (let j = 0; j < a.length; j += 3) {
    const dx = a[j] - pt[0], dy = a[j + 1] - pt[1], dz = a[j + 2] - pt[2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= rr) continue;
    const f = 1 - r2 / rr, w = depth * f * f;
    dn[j] += dir[0] * w; dn[j + 1] += dir[1] * w; dn[j + 2] += dir[2] * w;
  }
  commit(d);
  return true;
}

/** Crumple: the piece is shortened by `amount` along body-frame `axis` (pointing from the struck face into the vehicle),
    its far face held in place and the compressed length folded. `amount` is absolute (the total crush). */
export function crush(p: Piece, axis: Vec3, amount: number): boolean {
  const d = stateOf(p);
  if (!d) return false;
  if (!d.crush) {
    let s0 = Infinity, s1 = -Infinity;
    const c: Vec3 = [0, 0, 0], a = d.rest, n = a.length / 3;
    for (let j = 0; j < a.length; j += 3) {
      const s = a[j] * axis[0] + a[j + 1] * axis[1] + a[j + 2] * axis[2];
      s0 = Math.min(s0, s); s1 = Math.max(s1, s);
      c[0] += a[j] / n; c[1] += a[j + 1] / n; c[2] += a[j + 2] / n;
    }
    const sc = c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2];
    d.crush = { a: [...axis] as Vec3, d: 0, s0, s1: Math.max(s1, s0 + 1e-3), c: [c[0] - sc * axis[0], c[1] - sc * axis[1], c[2] - sc * axis[2]] };
  }
  d.crush.d = Math.min(amount, 0.85 * (d.crush.s1 - d.crush.s0));
  commit(d);
  return true;
}

/** Buckling waves in a thin panel: `m` half-waves along its length, amplitude `amp` m out of the plane `normal`. */
export function buckleWaves(p: Piece, normal: Vec3, amp: number, m = 3): boolean {
  const d = stateOf(p);
  if (!d) return false;
  if (!d.wave) {
    const n = normal, t: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u: Vec3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const ul = Math.hypot(...u); u[0] /= ul; u[1] /= ul; u[2] /= ul;
    const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const a = d.rest;
    for (let j = 0; j < a.length; j += 3) {
      const uu = a[j] * u[0] + a[j + 1] * u[1] + a[j + 2] * u[2], vv = a[j] * v[0] + a[j + 1] * v[1] + a[j + 2] * v[2];
      u0 = Math.min(u0, uu); u1 = Math.max(u1, uu); v0 = Math.min(v0, vv); v1 = Math.max(v1, vv);
    }
    d.wave = { n: [...n] as Vec3, u, v, amp: 0, u0, lu: Math.max(u1 - u0, 1e-3), v0, lv: Math.max(v1 - v0, 1e-3), m };
  }
  if (Math.abs(amp - d.wave.amp) < 0.002) return true;
  d.wave.amp = amp;
  commit(d);
  return true;
}

/* ---------------- laminated glass: spider-web crack decals that stay with the pane ---------------- */

let crackTex: THREE.DataTexture | null = null;
function crackTexture(): THREE.DataTexture {
  if (crackTex) return crackTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const plot = (x: number, y: number, a: number) => {
    const i = Math.round(x), j = Math.round(y);
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const k = (j * N + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = 255;
    data[k + 3] = Math.max(data[k + 3], a);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) plot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, a);
  };
  const c = N / 2, rays = 14, ang: number[] = [];
  for (let i = 0; i < rays; i++) {
    const a0 = ((i + rnd() * 0.6) / rays) * Math.PI * 2;
    ang.push(a0);
    let x = c, y = c, a = a0;
    for (let s = 0; s < 12; s++) {
      a += (rnd() - 0.5) * 0.35;
      const l = 6 + rnd() * 8, nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
      line(x, y, nx, ny, 230 - s * 12);
      x = nx; y = ny;
    }
  }
  for (const r of [10, 22, 38, 56]) {
    for (let i = 0; i < rays; i++) {
      const a0 = ang[i], a1 = ang[(i + 1) % rays] + (i + 1 === rays ? Math.PI * 2 : 0), rr = r * (0.85 + rnd() * 0.3);
      if (rnd() < 0.25) continue;
      line(c + Math.cos(a0) * rr, c + Math.sin(a0) * rr, c + Math.cos(a1) * rr * 0.95, c + Math.sin(a1) * rr * 0.95, 200 - r * 2);
    }
  }
  for (let k = 0; k < 40; k++) plot(c + (rnd() - 0.5) * 6, c + (rnd() - 0.5) * 6, 255);
  crackTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  crackTex.needsUpdate = true;
  return crackTex;
}

interface Crack { mesh: THREE.Mesh; p: Piece }
const cracks: Crack[] = [];
const MAX_CRACKS = 24;
const _m = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pv = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

/** Crack a laminated pane at a body-frame point (on its surface, facing `normal`): a spider web `size` m across. */
export function crackGlass(p: Piece, pt: Vec3, normal: Vec3, size: number): void {
  const scene = batchScene();
  for (let i = cracks.length - 1; i >= 0; i--) if (cracks[i].p.dead) dropCrack(i);
  if (!scene || cracks.length >= MAX_CRACKS) return;
  const mat = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.9 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(pt[0] + normal[0] * 0.004, pt[1] + normal[1] * 0.004, pt[2] + normal[2] * 0.004),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal[0], normal[1], normal[2]))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * Math.PI * 2)),
    _one);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.onBeforeRender = () => {
    if (p.dead) { mesh.visible = false; return; }
    _pv.set(p.curPos[0], p.curPos[1], p.curPos[2]);
    _pq.set(p.curRot[0], p.curRot[1], p.curRot[2], p.curRot[3]);
    mesh.matrixWorld.multiplyMatrices(_m.compose(_pv, _pq, _one), local);
  };
  scene.add(mesh);
  cracks.push({ mesh, p });
}

function dropCrack(i: number): void {
  const c = cracks[i];
  c.mesh.removeFromParent();
  c.mesh.geometry.dispose();
  (c.mesh.material as THREE.Material).dispose();
  cracks.splice(i, 1);
}

export function crackCount(p?: Piece): number {
  return p ? cracks.filter(c => c.p === p).length : cracks.length;
}

export function clearDeform(): void {
  states.clear();
  while (cracks.length) dropCrack(cracks.length - 1);
}
