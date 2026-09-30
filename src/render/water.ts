import * as THREE from 'three';
import { waterTiles, WATER_CELL, WATER_TN } from '../sim/fields/index';
import { SURFACE } from '../terrain/surface';
import { surfaceAt } from '../terrain/terrain';
import { lighting } from './shared';

/* Surface water from the shallow-water field: one heightfield mesh per tile. A wet vertex sits on the mean water
   surface of the wet cells around it; a dry one lies flat at the lowest bed it touches, so the sheet runs under
   whatever stands on the tile (a bollard, a kerb, a wall) instead of being draped over it. Water where the bed is
   open ground (soil, grass, gravel, rubble) is muddy, coloured by that ground. Ground the water has left stays dark
   and glossy for a while and dries back to its own colour: the damp is render-only memory, it drives nothing. */

interface View { mesh: THREE.Mesh; pos: THREE.BufferAttribute; col: THREE.BufferAttribute; damp: Float32Array; mud: Float32Array; version: number; gone: number }
const views = new Map<string, View>();
let root: THREE.Group | null = null;
let mat: THREE.MeshStandardMaterial;
const V = WATER_TN + 1;
const DRY_S = 90;               // s for a soaked patch to dry back (a wet street in weak sun takes ~20 min; compressed)
const KEEP_S = 60;              // s a view outlives its tile, drying
let last = 0;
const uTime = { value: 0 };
const skyU = { uWTime: uTime, uWHor: { value: new THREE.Color() }, uWZen: { value: new THREE.Color() }, uWSunDir: { value: new THREE.Vector3(0, 1, 0) }, uWSunCol: { value: new THREE.Color() } };
const _c = new THREE.Color();

export function initWater(scene: THREE.Scene): void {
  if (!root) {
    root = new THREE.Group();
    root.name = 'water';
    mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.08, metalness: 0, transparent: true, depthWrite: false, alphaTest: 0.004,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, envMapIntensity: 0.35,
    });
    /* wind and the flow ruffle the surface: two scrolling noise octaves tilt the normal a little, so the sun and the
       sky break up into glints instead of lying on it as one flat sheen */
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, skyU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWWp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWWp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWWp;
uniform float uWTime;
uniform vec3 uWHor;
uniform vec3 uWZen;
uniform vec3 uWSunDir;
uniform vec3 uWSunCol;
float wH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wH( i ), wH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wH( i + vec2( 0.0, 1.0 ) ), wH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
vec2 wGrad( vec2 p ) { float e = 0.07; return vec2( wN( p + vec2( e, 0.0 ) ) - wN( p - vec2( e, 0.0 ) ), wN( p + vec2( 0.0, e ) ) - wN( p - vec2( 0.0, e ) ) ) / ( 2.0 * e ); }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  // damp ground is dark and dull; a standing sheet is a mirror
  roughnessFactor = mix( 0.35, 0.03, smoothstep( 0.585, 0.64, vColor.a ) );`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec2 wq = vWWp.xz;
    vec2 wg = wGrad( wq * 2.3 + vec2( uWTime * 0.35, uWTime * 0.21 ) ) * 0.6 + wGrad( wq * 6.1 - vec2( uWTime * 0.52, - uWTime * 0.4 ) ) * 0.4;
    // thin films barely ripple; a sheet deep enough to run does
    float wk = 0.09 * smoothstep( 0.4, 0.9, vColor.a );
    normal = normalize( normal + ( viewMatrix * vec4( - wg.x * wk, 0.0, - wg.y * wk, 0.0 ) ).xyz );
    // seen at a low angle a sheet of water is a mirror whatever lies under it (Fresnel), the way wet asphalt shows the sky
    float wFr = pow( 1.0 - saturate( abs( dot( normal, normalize( vViewPosition ) ) ) ), 4.0 );
    diffuseColor.a = mix( diffuseColor.a, 0.97, wFr * smoothstep( 0.585, 0.64, vColor.a ) );
  }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    // the sky and the sun mirrored in the sheet: the scene's environment is too dim and blurred to show them, and a
    // wet street is read by exactly this, a bright band of sky at a low angle and glints where the ripples catch the sun
    vec3 wV = normalize( vWWp - cameraPosition );
    vec3 wN = normalize( inverseTransformDirection( normal, viewMatrix ) );
    vec3 wR = reflect( wV, wN );
    float wF = 0.02 + 0.98 * pow( 1.0 - saturate( dot( - wV, wN ) ), 5.0 );
    vec3 wSky = mix( uWHor, uWZen, smoothstep( 0.0, 0.6, wR.y ) );
    float wGl = pow( max( dot( wR, uWSunDir ), 0.0 ), 900.0 ) * 60.0;
    // a film of a few mm only darkens; from ~5 mm the sheet is deep enough to lie flat and mirror
    float wWet = smoothstep( 0.585, 0.64, vColor.a );
    totalEmissiveRadiance += wWet * wF * ( 0.75 * wSky + uWSunCol * wGl );
  }`);
    };
    mat.customProgramCacheKey = () => 'dv-water-sheet';
  }
  if (root.parent !== scene) scene.add(root);
}

function makeView(): View {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(V * V * 3), 3);
  const col = new THREE.BufferAttribute(new Float32Array(V * V * 4), 4);
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
  return { mesh, pos, col, damp: new Float32Array(V * V), mud: new Float32Array(WATER_TN * WATER_TN * 3), version: -1, gone: 0 };
}

/* the colour muddy water takes over each cell: the ground's own dust colour where it soaks, none on a hard surface */
function sampleMud(v: View, t: { ox: number; oz: number; bed: Float32Array }): void {
  for (let j = 0; j < WATER_TN; j++) for (let i = 0; i < WATER_TN; i++) {
    const k = i + WATER_TN * j, s = SURFACE[surfaceAt(t.ox + (i + 0.5) * WATER_CELL, t.oz + (j + 0.5) * WATER_CELL)];
    if (!s.soaks) { v.mud[k * 3] = -1; continue; }
    _c.setHex(s.dust);
    v.mud[k * 3] = _c.r; v.mud[k * 3 + 1] = _c.g; v.mud[k * 3 + 2] = _c.b;
  }
}

export function updateWater(): void {
  if (!root) return;
  const now = performance.now() / 1000, dt = last ? Math.min(0.25, Math.max(0, now - last)) : 0;
  last = now;
  uTime.value = now % 1000;
  /* the sky the sheet mirrors: the fog colour is the horizon band, the sky irradiance a stand-in for the zenith */
  const fog = (root.parent as THREE.Scene | null)?.fog as THREE.Fog | THREE.FogExp2 | null | undefined;
  if (fog) skyU.uWHor.value.copy(fog.color);
  skyU.uWZen.value.copy(lighting.ambTop).multiplyScalar(1.3);
  skyU.uWSunDir.value.copy(lighting.sunDir);
  skyU.uWSunCol.value.copy(lighting.sunColor).multiplyScalar(lighting.sunIntensity);
  for (const [k, v] of views) {
    if (waterTiles.has(k)) { v.gone = 0; continue; }
    /* the tile has drained away: its ground dries on */
    v.gone += dt;
    const C = v.col.array as Float32Array;
    let any = false;
    for (let i = 0; i < v.damp.length; i++) if (v.damp[i] > 0) { v.damp[i] = Math.max(0, v.damp[i] - dt / DRY_S); C[i * 4 + 3] = dampAlpha(v.damp[i]); any = true; }
    v.col.needsUpdate = true;
    if (!any || v.gone > KEEP_S) { root.remove(v.mesh); v.mesh.geometry.dispose(); views.delete(k); }
  }
  for (const [k, t] of waterTiles) {
    let v = views.get(k);
    if (!v) { v = makeView(); views.set(k, v); }
    if (v.version !== t.version) { v.version = t.version; sampleMud(v, t); }
    const P = v.pos.array as Float32Array, C = v.col.array as Float32Array, D = v.damp;
    let show = 0;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      let s = 0, n = 0, low = Infinity, depth = 0, mr = 0, mg = 0, mb = 0, mn = 0, sLo = Infinity, sHi = -Infinity, cells = 0, damp = false;
      for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
        const x = i + di, z = j + dj;
        if (x < 0 || z < 0 || x >= WATER_TN || z >= WATER_TN) continue;
        const c = x + WATER_TN * z;
        if (t.bed[c] > 500) continue;
        cells++;
        if (t.bed[c] < low) low = t.bed[c];
        if (t.h[c] > 0.0003) damp = true;
        if (t.h[c] > 0.002) {
          const w = t.bed[c] + t.h[c];
          s += w; depth += t.h[c]; n++;
          if (w < sLo) sLo = w;
          if (w > sHi) sHi = w;
          if (v.mud[c * 3] >= 0) { mr += v.mud[c * 3]; mg += v.mud[c * 3 + 1]; mb += v.mud[c * 3 + 2]; mn++; }
        }
      }
      const o = i + V * j, o3 = o * 3, o4 = o * 4;
      P[o3] = t.ox + i * WATER_CELL; P[o3 + 2] = t.oz + j * WATER_CELL;
      if (n) {
        const d = depth / n;
        P[o3 + 1] = s / n + 0.004;
        D[o] = 1;
        /* a film a few mm deep is the ground gone dark and glossy; a pool deepens to a grey-green body; over open
           ground the water carries the soil it runs over */
        const body = Math.min(1, d / 0.25), m = mn / n;
        /* clear water over a dark road is darker still, never a pale film */
        let r = 0.015 + 0.03 * body, g = 0.018 + 0.04 * body, b = 0.018 + 0.036 * body;
        if (m > 0) {
          const k = (0.35 + 0.35 * Math.min(1, d / 0.1)) * m;
          r += (mr / mn * 0.55 - r) * k; g += (mg / mn * 0.5 - g) * k; b += (mb / mn * 0.42 - b) * k;
        }
        C[o4] = r; C[o4 + 1] = g; C[o4 + 2] = b;
        /* a vertex on a step (a kerb with water both sides at different levels) would stand a sheet on edge: hide it */
        /* at the wet line (only some of its cells wet) the sheet feathers out instead of stepping cell by cell */
        C[o4 + 3] = sHi - sLo > 0.06 ? 0 : (0.58 + 0.34 * Math.min(1, d / 0.12) + 0.08 * m) * Math.pow(n / Math.max(1, cells), 0.6);
        show++;
      } else {
        P[o3 + 1] = (Number.isFinite(low) ? low : 0) + 0.004;
        /* a film too thin to stand (it ran off) still soaks the ground it crossed */
        if (damp) D[o] = 1;
        if (D[o] > 0) { D[o] = Math.max(0, D[o] - dt / DRY_S); show++; }
        C[o4] = 0.02; C[o4 + 1] = 0.018; C[o4 + 2] = 0.016;
        C[o4 + 3] = dampAlpha(D[o]);
      }
    }
    v.mesh.visible = show > 0;
    v.pos.needsUpdate = true;
    v.col.needsUpdate = true;
    v.mesh.geometry.computeVertexNormals();
  }
}

/* soaked ground reads about a third darker than dry, fading as it dries */
function dampAlpha(d: number): number { return d > 0 ? 0.45 * Math.min(1, d * 1.6) : 0; }

export function clearWaterMeshes(): void {
  if (!root) return;
  for (const v of views.values()) { root.remove(v.mesh); v.mesh.geometry.dispose(); }
  views.clear();
}
