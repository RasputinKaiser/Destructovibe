/* Building rigging: shared strand meshes following the actual physics anchors (hemp rope and thin dark
   electrical wire in one non-metallic mesh, steel chain in a second metallic one). The distance joint
   carries tension; these segments are visual only and disappear on rupture. */
import * as THREE from 'three';
import type { Vec3 } from '../types';

export type RopeKind = 'rope' | 'wire' | 'chain';

const CAPACITY = 192, SEGMENTS = 14;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const from = new THREE.Vector3(), to = new THREE.Vector3(), dir = new THREE.Vector3();
const rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4();
const _c = new THREE.Color();
let strand: THREE.InstancedMesh | null = null;
let chain: THREE.InstancedMesh | null = null;
let high = 0;
const active = new Uint8Array(CAPACITY);
const isChain = new Uint8Array(CAPACITY);
const radii = new Float32Array(CAPACITY);
const free: number[] = [];

/* Chain links from the strand's own metric length: link pitch follows the radius, alternate links turn
   90°, and each link's eye is cut out on the faces looking through it. */
function chainMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.45, metalness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;\nvarying vec2 vRad;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        #ifdef USE_INSTANCING
          vAlong = position.y * length( instanceMatrix[ 1 ].xyz ) / ( length( instanceMatrix[ 0 ].xyz ) * 3.2 );
        #else
          vAlong = position.y;
        #endif
        vRad = position.xz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;\nvarying vec2 vRad;')
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        float lf = fract( vAlong );
        float lodd = mod( floor( vAlong ), 2.0 );
        vec2 lr = normalize( vRad + 1e-5 );
        float facing = abs( lodd > 0.5 ? lr.x : lr.y );
        if ( facing > 0.55 && abs( lf - 0.5 ) < 0.24 ) discard;
        diffuseColor.rgb *= 0.45 + 0.55 * sin( 3.14159 * lf );`);
  };
  m.customProgramCacheKey = () => 'dv-chain';
  return m;
}

function strandMesh(material: THREE.Material, name: string): THREE.InstancedMesh {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  const m = new THREE.InstancedMesh(geometry, material, CAPACITY * SEGMENTS);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < CAPACITY * SEGMENTS; i++) m.setMatrixAt(i, ZERO);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = true;
  m.name = name;
  return m;
}

function hide(id: number): void {
  if (!strand || !chain) return;
  for (let i = 0; i < SEGMENTS; i++) {
    strand.setMatrixAt(id * SEGMENTS + i, ZERO);
    chain.setMatrixAt(id * SEGMENTS + i, ZERO);
  }
  strand.instanceMatrix.needsUpdate = true;
  chain.instanceMatrix.needsUpdate = true;
}

export function initRopes(scene: THREE.Scene): void {
  if (strand && chain) {
    if (strand.parent !== scene) scene.add(strand);
    if (chain.parent !== scene) scene.add(chain);
    return;
  }
  strand = strandMesh(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 }), 'buildingRopes');
  chain = strandMesh(chainMaterial(), 'buildingChains');
  scene.add(strand, chain);
}

export const ropes = {
  /** -1 when all 192 strands are in use */
  add(kind: RopeKind = 'rope'): number {
    if (!strand || !chain) return -1;
    const id = free.pop() ?? high++;
    if (id >= CAPACITY) { high = Math.min(high, CAPACITY); return -1; }
    active[id] = 1;
    isChain[id] = kind === 'chain' ? 1 : 0;
    radii[id] = kind === 'wire' ? 0.012 : kind === 'chain' ? 0.028 : 0.035;
    if (kind !== 'chain') {
      _c.setHex(kind === 'wire' ? 0x1c2226 : 0x9b815c);
      for (let i = 0; i < SEGMENTS; i++) strand.setColorAt(id * SEGMENTS + i, _c);
      if (strand.instanceColor) strand.instanceColor.needsUpdate = true;
    }
    hide(id);
    strand.count = chain.count = high * SEGMENTS;
    return id;
  },
  /** Slack is droop at the midpoint, not a fake rope length added to the constraint. */
  set(id: number, a: Vec3, b: Vec3, slack: number): void {
    if (!strand || !chain || id < 0 || !active[id]) return;
    const mesh = isChain[id] ? chain : strand, r = radii[id];
    from.set(...a);
    for (let i = 0; i < SEGMENTS; i++) {
      const t = (i + 1) / SEGMENTS;
      to.set(a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t - Math.max(0, slack) * 4 * t * (1 - t),
        a[2] + (b[2] - a[2]) * t);
      dir.subVectors(to, from);
      const len = dir.length();
      if (len < 1e-5) mesh.setMatrixAt(id * SEGMENTS + i, ZERO);
      else {
        dir.multiplyScalar(1 / len);
        rotation.setFromUnitVectors(UP, dir);
        matrix.compose(from, rotation, scale.set(r, len + r, r));
        mesh.setMatrixAt(id * SEGMENTS + i, matrix);
      }
      from.copy(to);
    }
    mesh.instanceMatrix.needsUpdate = true;
  },
  remove(id: number): void {
    if (id < 0 || !active[id]) return;
    active[id] = 0;
    hide(id);
    free.push(id);
  },
  clear(): void {
    active.fill(0);
    free.length = 0;
    high = 0;
    if (strand) strand.count = 0;
    if (chain) chain.count = 0;
  },
};
