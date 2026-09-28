// Run with: node tests/fx-impact.mjs
// Headless FX regression: exercises real Vite-transformed module and Three instance buffers.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { initFx, fx } = await server.ssrLoadModule('/src/render/fx.ts');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 8);
  initFx(scene, camera);
  const root = scene.getObjectByName('fx');
  assert(root);
  const meshes = root.children.filter(x => x.isInstancedMesh);
  const gpu = root.children.filter(x => x.isMesh && !x.isInstancedMesh);
  const chipMesh = meshes[0];
  const puffMesh = gpu.find(x => x.geometry.getAttribute('aF'));
  const sparkMesh = gpu.find(x => x.geometry.getAttribute('aD') && !x.geometry.getAttribute('aF'));
  assert(chipMesh && puffMesh && sparkMesh);
  const born = mesh => {
    const a = mesh.geometry.getAttribute('aA').array;
    let n = 0;
    for (let i = 3; i < a.length; i += 4) if (a[i] >= 0) n++;
    return n;
  };
  const sample = mat => {
    fx.clear();
    fx.impact([0, 2, 0], [1, 0, 0], mat, 1);
    fx.update(0);
    const n = chipMesh.count;
    const sizes = [];
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      chipMesh.getMatrixAt(i, matrix);
      matrix.decompose(pos, q, scale);
      sizes.push(scale.x);
    }
    return { puffs: born(puffMesh), sparks: born(sparkMesh), chips: n,
      meanChipSize: n ? sizes.reduce((a, b) => a + b, 0) / n : 0,
      positions: Array.from(puffMesh.geometry.getAttribute('aA').array.slice(0, 32)) };
  };
  const concrete = sample('concrete');
  const repeat = sample('concrete');
  const steel = sample('steel');
  const drywall = sample('drywall');
  assert.deepEqual(concrete, repeat, 'restart with same event sequence must reproduce FX buffers');
  assert(concrete.meanChipSize > drywall.meanChipSize, 'concrete must shed larger slower chunks than drywall');
  assert(concrete.puffs > steel.puffs, 'steel must not throw a masonry dust cloud');
  assert(steel.sparks > concrete.sparks, 'structural steel must throw a short spark spray');
  console.log('single-impact samples:', { concrete: { ...concrete, positions: undefined }, steel: { ...steel, positions: undefined }, drywall: { ...drywall, positions: undefined } });
  assert(concrete.puffs <= 14 && concrete.chips <= 24 && steel.sparks <= 18,
    'single-impact particle cap exceeded');
  fx.clear();
  fx.debris([0, 2, 0], 10000, 0xffffff, 2);
  fx.sparks([0, 2, 0], [0, 1, 0], 10000);
  fx.update(0);
  assert(chipMesh.count <= 64 && born(sparkMesh) <= 65, 'external burst cap exceeded');
  console.log(JSON.stringify({ concrete: { ...concrete, positions: undefined }, steel: { ...steel, positions: undefined }, drywall: { ...drywall, positions: undefined }, burst: { chips: chipMesh.count, sparks: born(sparkMesh) } }, null, 2));
} finally {
  await server.close();
}
