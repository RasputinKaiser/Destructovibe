import * as THREE from 'three';
import type { Vec3 } from '../types';

/* Engineer's view overlay: one dot per structural joint, drawn through everything. */

const CAP = 6000;
let mesh: THREE.InstancedMesh;
let count = 0;
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

export function initXray(scene: THREE.Scene): void {
  const mat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false });
  mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, _c.setRGB(1, 1, 1));
  mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  mesh.count = 0;
  mesh.visible = false;
  scene.add(mesh);
}

export const xrayDots = {
  begin(): void { count = 0; },
  push(p: Vec3, radius: number, r: number, g: number, b: number): void {
    if (count >= CAP) return;
    _m.makeScale(radius, radius, radius).setPosition(p[0], p[1], p[2]);
    mesh.setMatrixAt(count, _m);
    mesh.setColorAt(count, _c.setRGB(r, g, b));
    count++;
  },
  end(): void {
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  },
  hide(): void { count = 0; mesh.count = 0; mesh.visible = false; },
};

/* green (idle) → yellow → red (at capacity) → white-hot (past it) */
export function stressColor(u: number, out: [number, number, number]): [number, number, number] {
  const t = Math.max(0, u);
  if (t < 0.5) { const k = t / 0.5; out[0] = 0.15 + 0.85 * k; out[1] = 0.9; out[2] = 0.3 * (1 - k); }
  else if (t < 1) { const k = (t - 0.5) / 0.5; out[0] = 1; out[1] = 0.9 * (1 - k) + 0.12 * k; out[2] = 0.05; }
  else { const k = Math.min(1, t - 1); out[0] = 1; out[1] = 0.12 + 0.88 * k; out[2] = 0.05 + 0.95 * k; }
  return out;
}

/* ironbow: ambient blue → purple → orange → yellow-white */
export function thermalColor(temp: number, out: [number, number, number]): [number, number, number] {
  const t = Math.min(1, Math.max(0, (temp - 20) / 1000));
  const stops = [[0.05, 0.1, 0.35], [0.45, 0.05, 0.55], [0.95, 0.3, 0.05], [1, 0.8, 0.2], [1, 1, 0.9]];
  const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
  for (let c = 0; c < 3; c++) out[c] = stops[i][c] + (stops[i + 1][c] - stops[i][c]) * k;
  return out;
}
