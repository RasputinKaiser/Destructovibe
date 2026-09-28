import * as THREE from 'three';
import type { MaterialId, PieceSpec } from '../types';
import { getFinishMaterial, getPieceMaterials, setBatchHeat, type SurfaceFinish } from '../render/materials';
import { buildMesh, meshDetail, type MeshData } from './polytope';
export type { SurfaceFinish };

/* Every piece face-group lives in one BatchedMesh per (material, exterior|interior), so a
   collapsing building costs a few dozen draw calls instead of two per fragment. Tint is a
   per-instance colour on the untinted material. Exterior faces of a piece with a finish go to one batch
   per finish, shared by every material; its fracture faces stay in the material's interior batch. */

interface Batch {
  mesh: THREE.BatchedMesh;
  maxInst: number;
  maxVerts: number;
  maxIdx: number;
  live: number;
  dead: number;
}

interface Slot { b: Batch; geo: number; inst: number }
export interface PieceGfx { ext: Slot | null; int: Slot | null }

const batches = new Map<string, Batch>();
let xrayMat: THREE.MeshBasicMaterial | null = null;
let xrayOn = false;
let scene: THREE.Scene;

export function initBatches(s: THREE.Scene): void {
  scene = s;
}

/* Corrugation belongs on cladding sheets only: a thin, large piece. Any other plain 'metal' is machine plate. */
function sheet(size: readonly number[]): boolean {
  const [a, b, c] = [...size].sort((x, y) => x - y);
  return a <= 0.16 && b >= 1.2 && b * c >= 3;
}

/* Rubber on a round piece (two equal extents, the third no longer) is a road wheel: tyre plus steel rim. */
function round(spec: PieceSpec): boolean {
  if ((spec.shape ?? 'box') === 'box') return false;
  const [a, b, c] = [...spec.size].sort((x, y) => x - y);
  return c - b <= 0.12 * c || (b - a <= 0.12 * b && c <= b * 1.05);
}

/** the exterior surface a spawned piece renders with; fragments inherit their root's */
export function pieceFinish(spec: PieceSpec): SurfaceFinish | undefined {
  if (spec.finish === 'rubber' && round(spec)) return 'wheel';
  if (spec.finish) return spec.finish;
  return spec.mat === 'metal' && !sheet(spec.size) ? 'plate' : undefined;
}

function batchFor(mat: MaterialId, face: 0 | 1, finish?: SurfaceFinish): Batch {
  const fin = face === 0 ? finish : undefined;
  const key = fin ? `~${fin}` : `${mat}:${face}`;
  let b = batches.get(key);
  if (b) return b;
  const material = fin ? getFinishMaterial(fin) : getPieceMaterials(mat)[face];
  const maxInst = 256, maxVerts = 49152, maxIdx = 98304;
  const mesh = new THREE.BatchedMesh(maxInst, maxVerts, maxIdx, material);
  mesh.castShadow = !material.transparent;
  mesh.receiveShadow = true;
  mesh.sortObjects = material.transparent;
  mesh.perObjectFrustumCulled = true;
  mesh.frustumCulled = false;
  mesh.name = `pieces:${key}`;
  mesh.userData.material = material;
  if (xrayOn) applyXray(mesh);
  scene.add(mesh);
  b = { mesh, maxInst, maxVerts, maxIdx, live: 0, dead: 0 };
  batches.set(key, b);
  return b;
}

function geometryFrom(md: MeshData, start: number, count: number, i0: number, icount: number, ext: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(md.position.subarray(start * 3, (start + count) * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(md.normal.subarray(start * 3, (start + count) * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(md.uv.subarray(start * 2, (start + count) * 2), 2));
  if (ext) g.setAttribute('wear', new THREE.BufferAttribute(md.wear.subarray(start, start + count), 1));
  g.setIndex(new THREE.BufferAttribute(md.index.subarray(i0, i0 + icount), 1));
  return g;
}

const _white = new THREE.Color(1, 1, 1);
const _tint = new THREE.Color();

function addGeo(b: Batch, g: THREE.BufferGeometry): number {
  const need = g.getAttribute('position').count, needIdx = g.getIndex()!.count;
  const m = b.mesh;
  try {
    return m.addGeometry(g);
  } catch {
    if (b.dead > 0) { m.optimize(); b.dead = 0; }
    try {
      return m.addGeometry(g);
    } catch {
      b.maxVerts = Math.max(b.maxVerts * 2, b.maxVerts + need * 4);
      b.maxIdx = Math.max(b.maxIdx * 2, b.maxIdx + needIdx * 4);
      m.setGeometrySize(b.maxVerts, b.maxIdx);
      return m.addGeometry(g);
    }
  }
}

function add(b: Batch, g: THREE.BufferGeometry, tint: number | undefined): Slot {
  const m = b.mesh;
  const geo = addGeo(b, g);
  if (b.live >= b.maxInst) {
    b.maxInst *= 2;
    m.setInstanceCount(b.maxInst);
  }
  const inst = m.addInstance(geo);
  m.setColorAt(inst, tint === undefined ? _white : _tint.setHex(tint));
  b.live++;
  return { b, geo, inst };
}

export function addPieceGfx(mat: MaterialId, tint: number | undefined, md: MeshData, finish?: SurfaceFinish): PieceGfx {
  // built without a material: rebuild with one so it gets bevels and fracture relief
  if (md.src && meshDetail() > 0) md = buildMesh(md.src.poly, md.src.uvOrigin, md.src.cyl, mat);
  return {
    ext: md.extIndex ? add(batchFor(mat, 0, finish), geometryFrom(md, 0, md.extCount, 0, md.extIndex, true), tint) : null,
    int: md.intIndex ? add(batchFor(mat, 1), geometryFrom(md, md.extCount, md.intCount, md.extIndex, md.intIndex, false), undefined) : null,
  };
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function setPieceTransform(g: PieceGfx, pos: ArrayLike<number>, rot: ArrayLike<number> | THREE.Quaternion, scale = 1): void {
  _p.set(pos[0], pos[1], pos[2]);
  if (rot instanceof THREE.Quaternion) _q.copy(rot);
  else _q.set(rot[0], rot[1], rot[2], rot[3]);
  _s.setScalar(scale);
  _m.compose(_p, _q, _s);
  if (g.ext) g.ext.b.mesh.setMatrixAt(g.ext.inst, _m);
  if (g.int) g.int.b.mesh.setMatrixAt(g.int.inst, _m);
}

export function setPieceHeat(g: PieceGfx, heat: number): void {
  if (g.ext) setBatchHeat(g.ext.b.mesh, g.ext.inst, heat);
  if (g.int) setBatchHeat(g.int.b.mesh, g.int.inst, heat);
}

export function setPieceColor(g: PieceGfx, c: THREE.Color): void {
  if (g.ext) g.ext.b.mesh.setColorAt(g.ext.inst, c);
  if (g.int) g.int.b.mesh.setColorAt(g.int.inst, c);
}

function remove(s: Slot | null): void {
  if (!s) return;
  setBatchHeat(s.b.mesh, s.inst, 0);
  s.b.mesh.deleteInstance(s.inst);
  s.b.mesh.deleteGeometry(s.geo);
  s.b.live--;
  s.b.dead++;
}

const _range = { vertexStart: 0, vertexCount: 0, reservedVertexCount: 0, indexStart: 0, indexCount: 0, reservedIndexCount: 0, start: 0, count: 0 };
function swapGeo(s: Slot | null, g: THREE.BufferGeometry | null): void {
  if (!s || !g) return;
  const m = s.b.mesh;
  m.getGeometryRangeAt(s.geo, _range);
  if (g.getAttribute('position').count <= _range.reservedVertexCount && g.getIndex()!.count <= _range.reservedIndexCount) {
    m.setGeometryAt(s.geo, g);
    return;
  }
  const geo = addGeo(s.b, g);
  m.setGeometryIdAt(s.inst, geo);
  m.deleteGeometry(s.geo);
  s.b.dead++;
  s.geo = geo;
}

/** Plastic deformation: the piece renders its own (dented, crumpled) geometry from now on, in the same batches. Same
    vertex layout as addPieceGfx; later calls that fit the reserved space update in place. */
export function setPieceGeometry(g: PieceGfx, ext: THREE.BufferGeometry | null, int: THREE.BufferGeometry | null): void {
  swapGeo(g.ext, ext);
  swapGeo(g.int, int);
}

/** Scene the batches live in (decals and other per-piece overlays go beside them). */
export function batchScene(): THREE.Scene | undefined {
  return scene;
}

export function removePieceGfx(g: PieceGfx): void {
  remove(g.ext);
  remove(g.int);
  g.ext = g.int = null;
}

function applyXray(mesh: THREE.BatchedMesh): void {
  xrayMat ??= new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  mesh.material = xrayOn ? xrayMat : (mesh.userData.material as THREE.Material);
  mesh.castShadow = !xrayOn && !(mesh.userData.material as THREE.Material).transparent;
}

/* Engineer's view: every piece becomes a faint additive ghost tinted by its instance colour. */
export function setBatchesXray(on: boolean): void {
  xrayOn = on;
  for (const b of batches.values()) applyXray(b.mesh);
  for (const p of pools.values()) p.mesh.visible = !on;
}

export function batchesXray(): boolean {
  return xrayOn;
}

/** Hide a piece's own faces while its dormant detail draws in its place. */
export function setPieceVisible(g: PieceGfx, on: boolean): void {
  if (g.ext) g.ext.b.mesh.setVisibleAt(g.ext.inst, on);
  if (g.int) g.int.b.mesh.setVisibleAt(g.int.inst, on);
}

export function clearBatches(): void {
  for (const b of batches.values()) {
    scene.remove(b.mesh);
    b.mesh.dispose();
  }
  batches.clear();
  for (const p of pools.values()) {
    scene.remove(p.mesh);
    p.mesh.dispose();
    p.mesh.geometry.dispose();
  }
  pools.clear();
}

/* ---------------- dormant detail ----------------
   Bricks, blocks, boards and battens that ride on an intact member repeat a handful of shapes thousands of times,
   so each (shape, material, finish) is one InstancedMesh: one draw per kind whatever the count. A BatchedMesh would
   issue one multi-draw entry per instance, which ANGLE on Metal replays as separate draws. Slots are packed: removing
   one moves the last instance into its place and tells that instance's owner. */

export interface PoolOwner { slots: Int32Array }

export interface DetailPool {
  mesh: THREE.InstancedMesh;
  cap: number;
  count: number;
  owner: (PoolOwner | null)[];
  idx: Int32Array;
  lo: number;
  hi: number;
  tris: number;
}

const pools = new Map<string, DetailPool>();

function poolMesh(g: THREE.BufferGeometry, material: THREE.Material, cap: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(g, material, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = !material.transparent;
  m.receiveShadow = true;
  m.visible = !xrayOn;
  return m;
}

export function detailPool(key: string, mat: MaterialId, finish: SurfaceFinish | undefined, md: MeshData): DetailPool {
  let p = pools.get(key);
  if (p) return p;
  const g = geometryFrom(md, 0, md.extCount, 0, md.extIndex, true);
  const material = finish ? getFinishMaterial(finish) : getPieceMaterials(mat)[0];
  const mesh = poolMesh(g, material, 64);
  mesh.name = `detail:${key}`;
  scene.add(mesh);
  p = { mesh, cap: 64, count: 0, owner: [], idx: new Int32Array(64), lo: Infinity, hi: -1, tris: md.extIndex / 3 };
  pools.set(key, p);
  return p;
}

function grow(p: DetailPool): void {
  const cap = p.cap * 2, old = p.mesh;
  const m = poolMesh(old.geometry, old.material as THREE.Material, cap);
  m.name = old.name;
  m.instanceMatrix.array.set(old.instanceMatrix.array);
  m.instanceColor!.array.set(old.instanceColor!.array);
  m.count = p.count;
  scene.remove(old);
  old.dispose();
  scene.add(m);
  const idx = new Int32Array(cap);
  idx.set(p.idx);
  p.mesh = m; p.cap = cap; p.idx = idx; p.lo = 0; p.hi = p.count - 1;
}

const _c = new THREE.Color();

export function poolAdd(p: DetailPool, owner: PoolOwner, i: number, m: ArrayLike<number>, tint: number | undefined): number {
  if (p.count >= p.cap) grow(p);
  const s = p.count++;
  p.owner[s] = owner;
  p.idx[s] = i;
  owner.slots[i] = s;
  (p.mesh.instanceMatrix.array as Float32Array).set(m, s * 16);
  _c.setHex(tint ?? 0xffffff);
  const col = p.mesh.instanceColor!.array as Float32Array;
  col[s * 3] = _c.r; col[s * 3 + 1] = _c.g; col[s * 3 + 2] = _c.b;
  if (s < p.lo) p.lo = s;
  if (s > p.hi) p.hi = s;
  return s;
}

export function poolRemove(p: DetailPool, s: number): void {
  const last = --p.count;
  const o = p.owner[s];
  if (o) o.slots[p.idx[s]] = -1;
  if (s !== last) {
    const mo = p.owner[last]!, mi = p.idx[last];
    const mat = p.mesh.instanceMatrix.array as Float32Array, col = p.mesh.instanceColor!.array as Float32Array;
    mat.copyWithin(s * 16, last * 16, last * 16 + 16);
    col.copyWithin(s * 3, last * 3, last * 3 + 3);
    p.owner[s] = mo;
    p.idx[s] = mi;
    mo.slots[mi] = s;
    if (s < p.lo) p.lo = s;
    if (s > p.hi) p.hi = s;
  }
  p.owner[last] = null;
}

/** hand an instance to a new owner (a member split into pieces keeps drawing the same units) */
export function poolRebind(p: DetailPool, s: number, owner: PoolOwner, i: number): void {
  p.owner[s] = owner;
  p.idx[s] = i;
  owner.slots[i] = s;
}

export function poolWrite(p: DetailPool, s: number, m: ArrayLike<number>): void {
  (p.mesh.instanceMatrix.array as Float32Array).set(m, s * 16);
  if (s < p.lo) p.lo = s;
  if (s > p.hi) p.hi = s;
}

/** upload only the touched range of each pool this frame */
export function poolFlush(): void {
  for (const p of pools.values()) {
    p.mesh.count = p.count;
    if (p.hi < p.lo) continue;
    const hi = Math.min(p.hi, p.cap - 1);
    const a = p.mesh.instanceMatrix, c = p.mesh.instanceColor!;
    a.clearUpdateRanges(); c.clearUpdateRanges();
    a.addUpdateRange(p.lo * 16, (hi - p.lo + 1) * 16);
    c.addUpdateRange(p.lo * 3, (hi - p.lo + 1) * 3);
    a.needsUpdate = true; c.needsUpdate = true;
    p.lo = Infinity; p.hi = -1;
  }
}

/** instances per pool (profiling) */
export function poolCounts(): [string, number][] {
  return [...pools].map(([k, p]) => [k, p.count]);
}

export function poolStats(): { pools: number; instances: number; capacity: number; triangles: number; bytes: number } {
  let instances = 0, capacity = 0, triangles = 0, bytes = 0;
  for (const p of pools.values()) {
    instances += p.count;
    capacity += p.cap;
    triangles += p.count * p.tris;
    const g = p.mesh.geometry;
    for (const k of Object.keys(g.attributes)) bytes += (g.attributes[k].array as Float32Array).byteLength;
    bytes += g.index ? (g.index.array as Uint32Array).byteLength : 0;
    bytes += p.cap * (16 + 3) * 4 + p.cap * 4;
  }
  return { pools: pools.size, instances, capacity, triangles, bytes };
}

export function batchStats(): { batches: number; instances: number; triangles: number; vertices: number } {
  let instances = 0, triangles = 0, vertices = 0;
  for (const b of batches.values()) {
    instances += b.live;
    const info = (b.mesh as unknown as { _geometryInfo: { active: boolean; vertexCount: number; indexCount: number }[] })._geometryInfo;
    for (const g of info) if (g.active) { triangles += g.indexCount / 3; vertices += g.vertexCount; }
  }
  return { batches: batches.size, instances, triangles, vertices };
}
