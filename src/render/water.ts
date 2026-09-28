import * as THREE from 'three';
import { waterTiles, WATER_CELL, WATER_TN } from '../sim/fields/index';

/* Surface water from the shallow-water field: one heightfield mesh per tile. Dry vertices sink just under the bed so
   the sheet's edge follows the wet line. */

interface View { mesh: THREE.Mesh; pos: THREE.BufferAttribute; col: THREE.BufferAttribute }
const views = new Map<string, View>();
let root: THREE.Group | null = null;
let mat: THREE.MeshStandardMaterial;
const V = WATER_TN + 1;

export function initWater(scene: THREE.Scene): void {
  if (!root) {
    root = new THREE.Group();
    root.name = 'water';
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.78, depthWrite: false });
  }
  if (root.parent !== scene) scene.add(root);
}

function makeView(): View {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(V * V * 3), 3);
  const col = new THREE.BufferAttribute(new Float32Array(V * V * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  const idx: number[] = [];
  for (let j = 0; j < WATER_TN; j++) for (let i = 0; i < WATER_TN; i++) {
    const a = i + V * j, b = a + 1, c = a + V, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  g.setAttribute('position', pos);
  g.setAttribute('color', col);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  root!.add(mesh);
  return { mesh, pos, col };
}

export function updateWater(): void {
  if (!root) return;
  for (const [k, v] of views) if (!waterTiles.has(k)) { root.remove(v.mesh); v.mesh.geometry.dispose(); views.delete(k); }
  for (const [k, t] of waterTiles) {
    let v = views.get(k);
    if (!v) { v = makeView(); views.set(k, v); }
    const P = v.pos.array as Float32Array, C = v.col.array as Float32Array;
    let wet = 0;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      let s = 0, n = 0, bed = -Infinity, depth = 0;
      for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
        const x = i + di, z = j + dj;
        if (x < 0 || z < 0 || x >= WATER_TN || z >= WATER_TN) continue;
        const c = x + WATER_TN * z;
        if (t.bed[c] > 500) continue;
        bed = Math.max(bed, t.bed[c]);
        if (t.h[c] > 0.002) { s += t.bed[c] + t.h[c]; depth += t.h[c]; n++; }
      }
      const o = (i + V * j) * 3;
      P[o] = t.ox + i * WATER_CELL; P[o + 2] = t.oz + j * WATER_CELL;
      P[o + 1] = n ? s / n + 0.01 : (Number.isFinite(bed) ? bed : 0) - 0.05;
      const d = n ? Math.min(1, depth / n / 0.3) : 0;
      C[o] = 0.33 - 0.2 * d; C[o + 1] = 0.4 - 0.18 * d; C[o + 2] = 0.42 - 0.12 * d;
      if (n) wet++;
    }
    v.mesh.visible = wet > 0;
    v.pos.needsUpdate = true;
    v.col.needsUpdate = true;
    v.mesh.geometry.computeVertexNormals();
  }
}

export function clearWaterMeshes(): void {
  if (!root) return;
  for (const v of views.values()) { root.remove(v.mesh); v.mesh.geometry.dispose(); }
  views.clear();
}
