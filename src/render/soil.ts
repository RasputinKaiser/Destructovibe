import * as THREE from 'three';
import { soilState } from '../terrain/terrain';
import { carriers, soilProps } from '../terrain/soil';

/* Soil that is not (yet) ground: clods in flight (tipped from a bucket, thrown out of a crater), drawn where the soil
   simulation has them, and the spoil heaped in a working bucket. Two draw calls. */

const CAP = 1024, HEAPS = 4;
let clods: THREE.InstancedMesh | null = null;
let heaps: THREE.Mesh[] = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

export function initSoilGfx(scene: THREE.Scene): void {
  if (clods?.parent === scene) return;
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  clods = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, CAP);
  clods.count = 0;
  clods.castShadow = true;
  clods.frustumCulled = false;
  clods.name = 'soil-clods';
  clods.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  scene.add(clods);
  heaps = [];
  for (let i = 0; i < HEAPS; i++) {
    const g = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    // a lumpy heap, not a dome: the rim of the hemisphere stays on the mouth, the top is roughened
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v), x = pos.getX(v), z = pos.getZ(v);
      const k = 1 + 0.18 * y * Math.sin(x * 9.1 + z * 5.3) * Math.cos(z * 7.7 - x * 3.1);
      pos.setXYZ(v, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    const h = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0, flatShading: true }));
    h.castShadow = true;
    h.visible = false;
    h.name = 'bucket-soil';
    scene.add(h);
    heaps.push(h);
  }
}

export function updateSoilGfx(): void {
  if (!clods) return;
  const s = soilState(), p = s?.parts;
  let n = 0;
  if (p) for (let i = 0; i < p.n && n < CAP; i++) {
    const m = p.m[i], size = Math.min(0.2, Math.max(0.03, Math.cbrt(m / 1700) * 0.45));
    _p.set(p.x[i], p.y[i], p.z[i]);
    _e.set(i * 1.7 + p.y[i] * 3, i * 2.3, i * 0.9 + p.x[i]);
    _q.setFromEuler(_e);
    _s.set(size, size * 0.8, size * 1.1);
    _m.compose(_p, _q, _s);
    clods.setMatrixAt(n, _m);
    _c.setHex(soilProps(p.t[i]).color).multiplyScalar(0.6 + 0.3 * ((i * 0.618) % 1));
    clods.setColorAt(n, _c);
    n++;
  }
  clods.count = n;
  clods.instanceMatrix.needsUpdate = true;
  if (clods.instanceColor) clods.instanceColor.needsUpdate = true;
  let h = 0;
  for (const get of carriers) {
    const v = get();
    if (!v || h >= heaps.length) continue;
    const mesh = heaps[h];
    _q.set(v.rot[0], v.rot[1], v.rot[2], v.rot[3]);
    // the heap's axis is the mouth's normal; tipped past ~70° the load has gone over the lip
    _p.set(0, 1, 0).applyQuaternion(_q);
    if (_p.y < 0.35) continue;
    const f = Math.min(1.2, v.fill);
    mesh.position.set(v.pos[0], v.pos[1], v.pos[2]);
    mesh.quaternion.copy(_q);
    mesh.scale.set(v.hx * (0.55 + 0.4 * f), 0.04 + 0.34 * f, v.hz * (0.55 + 0.4 * f));
    (mesh.material as THREE.MeshStandardMaterial).color.setHex(v.color);
    mesh.visible = true;
    h++;
  }
  for (; h < heaps.length; h++) heaps[h].visible = false;
}
