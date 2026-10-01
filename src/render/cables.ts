/* Steel cables (wrecking-ball rope, winch line, det cord, a crane's boom) as one InstancedMesh. Each cable id owns
   SEG cylinder instances laid along a parabolic sag, so a slack line droops and a taut one reads straight; each has
   its own thickness and colour. */
import * as THREE from 'three';
import type { Vec3 } from '../types';
import { texSet } from './textures';
import { pendRange } from './shared';

const CABLES = 40, SEG = 12, RADIUS = 0.022;
const WIRE = new THREE.Color(0x33373b);
let mesh: THREE.InstancedMesh | null = null;
const live = new Uint8Array(CABLES);
const radius = new Float32Array(CABLES).fill(RADIUS);
const _col = new THREE.Color();
const free: number[] = [];
let hi = 0;
let dirtyLo = CABLES * SEG, dirtyHi = 0;

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();

function mark(lo: number, end: number): void {
  if (lo < dirtyLo) dirtyLo = lo;
  if (end > dirtyHi) dirtyHi = end;
}

function hide(id: number): void {
  if (!mesh) return;
  for (let s = 0; s < SEG; s++) mesh.setMatrixAt(id * SEG + s, ZERO);
  mark(id * SEG, id * SEG + SEG);
}

// each piece overlaps its neighbours by one radius so the outside of a bend never shows a gap
function segment(i: number, from: THREE.Vector3, to: THREE.Vector3, r: number): void {
  if (!mesh) return;
  _d.subVectors(to, from);
  const l = _d.length();
  if (l < 1e-5) mesh.setMatrixAt(i, ZERO);
  else {
    _d.multiplyScalar(1 / l);
    _q.setFromUnitVectors(UP, _d);
    _m.compose(_o.copy(from).addScaledVector(_d, -r * 0.5), _q, _s.set(r, l + r, r));
    mesh.setMatrixAt(i, _m);
  }
}

export function initCables(scene: THREE.Scene): void {
  if (mesh) {
    if (mesh.parent !== scene) scene.add(mesh);
    return;
  }
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.6 });
  mesh = new THREE.InstancedMesh(geo, mat, CABLES * SEG);
  for (let i = 0; i < CABLES * SEG; i++) mesh.setColorAt(i, WIRE);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'cables';
  scene.add(mesh);
}

export const cables = {
  /** reserves a cable (hidden until `set`), `r` thick in `color`; -1 when all are in use */
  add(r = RADIUS, color?: number): number {
    if (!mesh) return -1;
    let id: number;
    const f = free.pop();
    if (f !== undefined) id = f;
    else if (hi < CABLES) id = hi;
    else return -1;
    if (id >= hi) hi = id + 1;
    live[id] = 1;
    radius[id] = r;
    _col.set(color ?? WIRE.getHex());
    for (let s = 0; s < SEG; s++) mesh.setColorAt(id * SEG + s, _col);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    hide(id);
    return id;
  },

  /** span a → b sagging `slack` metres at mid-span along -Y; a zero-length span hides the cable */
  set(id: number, a: Vec3, b: Vec3, slack: number): void {
    if (!mesh || id < 0 || id >= hi || !live[id]) return;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    if (dx * dx + dy * dy + dz * dz < 1e-8) { hide(id); return; }
    const sag = 4 * Math.max(0, slack);
    _p0.set(a[0], a[1], a[2]);
    for (let s = 0; s < SEG; s++) {
      const t = (s + 1) / SEG;
      _p1.set(a[0] + dx * t, a[1] + dy * t - sag * t * (1 - t), a[2] + dz * t);
      segment(id * SEG + s, _p0, _p1, radius[id]);
      _p0.copy(_p1);
    }
    mark(id * SEG, id * SEG + SEG);
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
    dirtyLo = CABLES * SEG;
    dirtyHi = 0;
  },

  /** uploads everything `set` touched this frame; call once per frame */
  flush(): void {
    if (!mesh) return;
    mesh.count = hi * SEG;
    if (dirtyHi <= dirtyLo) return;
    const im = mesh.instanceMatrix;
    pendRange(im, dirtyLo * 16, (dirtyHi - dirtyLo) * 16);
    dirtyLo = CABLES * SEG;
    dirtyHi = 0;
  },
};

/* ---------------- wrecking ball ---------------- */

const ballMats = new Map<number, THREE.MeshStandardMaterial>();
let shackleMat: THREE.MeshStandardMaterial | null = null;

function ballMaterial(r: number): THREE.MeshStandardMaterial {
  const key = Math.round(r * 10);
  let m = ballMats.get(key);
  if (m) return m;
  const s = texSet('castiron');
  const ru = Math.max(2, Math.round((2 * Math.PI * r) / s.size[0])), rv = Math.max(1, Math.round((Math.PI * r) / s.size[1]));
  const c = (t: THREE.Texture): THREE.Texture => {
    const k = t.clone();
    k.repeat.set(ru, rv);
    k.needsUpdate = true;
    return k;
  };
  const orm = c(s.orm);
  // the tint pushes the painted-iron set toward weathered rust
  m = new THREE.MeshStandardMaterial({
    color: 0xb4805e, map: c(s.map), normalMap: c(s.normal), roughnessMap: orm, metalnessMap: orm, aoMap: orm,
    roughness: 1, metalness: 1,
  });
  ballMats.set(key, m);
  return m;
}

/** rusted cast-iron ball with a top shackle, origin at the ball centre; userData.attach = local Y of the cable eye */
export function makeWreckingBall(radius: number): THREE.Object3D {
  const r = Math.max(0.1, radius);
  shackleMat ??= new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.45, metalness: 1 });
  const sm = shackleMat;
  const w = r * 0.16, t = r * 0.07, pinY = r * 1.25, leg = r * 0.22;
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const g = new THREE.Group();
  g.name = 'wreckingBall';
  g.add(
    part(new THREE.SphereGeometry(r, 40, 28), ballMaterial(r), 0, 0),
    part(new THREE.CylinderGeometry(r * 0.26, r * 0.34, r * 0.3, 20), sm, 0, r * 0.92),
    part(new THREE.BoxGeometry(r * 0.1, r * 0.3, r * 0.22), sm, 0, r * 1.18),
    part(new THREE.CylinderGeometry(t * 1.1, t * 1.1, 2 * w + 4 * t, 12).rotateZ(Math.PI / 2), sm, 0, pinY),
    part(new THREE.CylinderGeometry(t, t, leg, 10), sm, -w, pinY + leg * 0.5),
    part(new THREE.CylinderGeometry(t, t, leg, 10), sm, w, pinY + leg * 0.5),
    part(new THREE.TorusGeometry(w, t, 10, 20, Math.PI), sm, 0, pinY + leg),
  );
  g.userData.attach = pinY + leg + w + t;
  return g;
}
