/* Reinforcing bars as one InstancedMesh. Each bar id owns two cylinder instances that meet at a
   slightly displaced midpoint, so stretched bars read as bent steel rather than laser-straight rods. */
import * as THREE from 'three';
import type { Vec3 } from '../types';
import { pbr } from './materials';
import { hash, texSet } from './textures';

const BARS = 1024;
let mesh: THREE.InstancedMesh | null = null;
const live = new Uint8Array(BARS);
const radius = new Float32Array(BARS);
/** per bar: sideways offset of the kink as a fraction of length, then a random axis */
const kink = new Float32Array(BARS * 4);
const free: number[] = [];
let hi = 0;
let dirtyLo = BARS * 2, dirtyHi = 0;

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3(), _mid = new THREE.Vector3();

function mark(i: number): void {
  if (i < dirtyLo) dirtyLo = i;
  if (i + 1 > dirtyHi) dirtyHi = i + 1;
}

function hide(id: number): void {
  if (!mesh) return;
  mesh.setMatrixAt(id * 2, ZERO);
  mesh.setMatrixAt(id * 2 + 1, ZERO);
  mark(id * 2);
  mark(id * 2 + 1);
}

function segment(i: number, from: THREE.Vector3, to: THREE.Vector3, r: number): void {
  if (!mesh) return;
  _d.subVectors(to, from);
  const l = _d.length();
  if (l < 1e-5) mesh.setMatrixAt(i, ZERO);
  else {
    _q.setFromUnitVectors(UP, _d.multiplyScalar(1 / l));
    _m.compose(from, _q, _s.set(r, l, r));
    mesh.setMatrixAt(i, _m);
  }
  mark(i);
}

export function initRebar(scene: THREE.Scene): void {
  if (mesh) {
    if (mesh.parent !== scene) scene.add(mesh);
    return;
  }
  const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1).translate(0, 0.5, 0);
  mesh = new THREE.InstancedMesh(geo, pbr(texSet('rebar'), true), BARS * 2);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'rebar';
  for (let i = 0; i < BARS; i++) {
    radius[i] = 0.006 + 0.002 * hash(i, 0, 5);
    kink[i * 4] = (hash(i, 1, 5) - 0.5) * 0.05;
    kink[i * 4 + 1] = hash(i, 2, 5) - 0.5;
    kink[i * 4 + 2] = hash(i, 3, 5) - 0.5;
    kink[i * 4 + 3] = hash(i, 4, 5) - 0.5;
  }
  scene.add(mesh);
}

export const rebar = {
  /** reserves a bar (hidden until `set`); -1 when all 1024 are in use */
  add(): number {
    if (!mesh) return -1;
    let id: number;
    const f = free.pop();
    if (f !== undefined) id = f;
    else if (hi < BARS) id = hi;
    else return -1;
    if (id >= hi) hi = id + 1;
    live[id] = 1;
    hide(id);
    return id;
  },

  set(id: number, a: Vec3, b: Vec3): void {
    if (!mesh || id < 0 || id >= hi || !live[id]) return;
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    _d.subVectors(_b, _a);
    const len = _d.length();
    if (len < 1e-4) { hide(id); return; }
    _d.multiplyScalar(1 / len);
    const o = id * 4;
    _k.set(kink[o + 1], kink[o + 2], kink[o + 3]).cross(_d);
    if (_k.lengthSq() < 1e-6) _k.set(1, 0, 0).cross(_d);
    _k.normalize();
    _mid.addVectors(_a, _b).multiplyScalar(0.5).addScaledVector(_k, len * kink[o]);
    segment(id * 2, _a, _mid, radius[id]);
    segment(id * 2 + 1, _mid, _b, radius[id]);
  },

  remove(id: number): void {
    if (!mesh || id < 0 || id >= hi || !live[id]) return;
    live[id] = 0;
    hide(id);
    free.push(id);
    while (hi > 0 && !live[hi - 1]) hi--;
  },

  clear(): void {
    live.fill(0);
    free.length = 0;
    hi = 0;
    if (mesh) mesh.count = 0;
    dirtyLo = BARS * 2;
    dirtyHi = 0;
  },

  /** uploads everything `set` touched this frame; call once per frame */
  flush(): void {
    if (!mesh) return;
    mesh.count = hi * 2;
    if (dirtyHi <= dirtyLo) return;
    const im = mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(dirtyLo * 16, (dirtyHi - dirtyLo) * 16);
    im.needsUpdate = true;
    dirtyLo = BARS * 2;
    dirtyHi = 0;
  },
};
