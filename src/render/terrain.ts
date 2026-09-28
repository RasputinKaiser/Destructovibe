import * as THREE from 'three';
import { terrain } from '../terrain/terrain';
import { SURFACES, TILE_CELLS } from '../terrain/spec';
import { fieldHeight, type TerrainData } from '../terrain/raster';
import { coverU, dustU, envU, DV_COVER_UV } from './shared';

/* The site's ground, drawn from the terrain data (terrain/raster.ts):
     ground    one mesh over every 0.5 m sample, its index rebuilt per 16 m tile at 1, 2 or 4 samples a quad by
               distance, with skirts along the tile edges hiding the cracks between levels; splat-blended surfacing
               (asphalt with aggregate, saw-cut concrete, flags with their joints, setts, gravel, grass, soil, rubble)
               worked out per pixel in world space, with worn edges at every change of surfacing, wetness and the
               settled dust coverage
     features  kerbs (granite, their joints), walls and steps (ashlar, brick, board-marked concrete), slabs
     decals    manholes, valve boxes, gratings, oil, patches, puddles and the road markings, in one transparent mesh
     tufts     grass tufts scattered over the grass
   Four draw calls. Only tiles a crater has touched are refreshed. */

const GLSL = /* glsl */`
float dvHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float dvNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( dvHash( i ), dvHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( dvHash( i + vec2( 0.0, 1.0 ) ), dvHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float dvFbm( vec2 p ) { return 0.5 * dvNoise( p ) + 0.25 * dvNoise( p * 2.03 ) + 0.125 * dvNoise( p * 4.01 ) + 0.0625 * dvNoise( p * 8.05 ); }
float dvJoint( vec2 f, vec2 s, float w ) { vec2 e = min( f, 1.0 - f ) * s; return 1.0 - smoothstep( w * 0.4, w, min( e.x, e.y ) ); }
/* each surfacing: albedo (linear), roughness, bump height (m) */
void dvSurf( int k, vec2 p, out vec3 c, out float r, out float b ) {
  if ( k == 0 ) {          // asphalt: dark binder, light and dark aggregate, polished where tyres run
    float g = dvHash( floor( p * 55.0 ) ), m = dvFbm( p * 0.35 );
    c = vec3( 0.058, 0.06, 0.064 ) * ( 0.8 + 0.4 * m ) + vec3( 0.07 ) * step( 0.92, g ) - vec3( 0.015 ) * step( g, 0.1 );
    r = 0.84 - 0.12 * m; b = 0.0015 * g;
  } else if ( k == 1 ) {   // concrete: blotchy, saw-cut joints every 4 m
    vec2 f = fract( p / 4.0 ); float j = dvJoint( f, vec2( 4.0 ), 0.012 );
    c = vec3( 0.33, 0.325, 0.31 ) * ( 0.85 + 0.3 * dvFbm( p * 0.8 ) ) * ( 1.0 - 0.45 * j );
    r = 0.88; b = -0.004 * j + 0.0008 * dvNoise( p * 30.0 );
  } else if ( k == 2 ) {   // 600 mm flags, each its own tone, sanded joints
    vec2 q = p / 0.6, cell = floor( q ); float j = dvJoint( fract( q ), vec2( 0.6 ), 0.009 );
    c = vec3( 0.42, 0.405, 0.375 ) * ( 0.84 + 0.26 * dvHash( cell ) ) * ( 0.92 + 0.16 * dvNoise( p * 6.0 ) ) * ( 1.0 - 0.5 * j );
    r = 0.78; b = -0.005 * j + 0.0008 * dvNoise( p * 25.0 );
  } else if ( k == 3 ) {   // setts in stretcher courses, domed and worn
    vec2 q = p / vec2( 0.2, 0.12 ); float row = floor( q.y ); q.x += 0.5 * mod( row, 2.0 );
    vec2 cell = floor( q ), f = fract( q ); vec2 e = min( f, 1.0 - f ) * vec2( 0.2, 0.12 );
    float dome = smoothstep( 0.0, 0.03, min( e.x, e.y ) );
    c = vec3( 0.29, 0.275, 0.25 ) * ( 0.7 + 0.5 * dvHash( cell + row * 7.1 ) ) * ( 0.62 + 0.38 * dome );
    r = 0.72 - 0.2 * dome; b = 0.012 * dome;
  } else if ( k == 4 ) {   // gravel
    float g1 = dvHash( floor( p * 38.0 ) ), g2 = dvHash( floor( p * 23.0 ) + 3.0 );
    c = mix( vec3( 0.33, 0.31, 0.27 ), vec3( 0.5, 0.47, 0.41 ), g1 ) * ( 0.8 + 0.3 * g2 );
    r = 0.9; b = 0.005 * g1;
  } else if ( k == 5 ) {   // grass: two greens, dry patches, blade-scale flicker
    float n = dvFbm( p * 0.25 ), n2 = dvNoise( p * 3.0 ), dry = smoothstep( 0.6, 0.8, dvFbm( p * 0.07 + 7.0 ) );
    c = mix( vec3( 0.07, 0.13, 0.035 ), vec3( 0.12, 0.18, 0.05 ), n );
    c = mix( c, vec3( 0.21, 0.19, 0.08 ), dry ) * ( 0.85 + 0.3 * n2 );
    r = 0.95; b = 0.004 * n2;
  } else if ( k == 6 ) {   // soil with clods
    c = vec3( 0.15, 0.105, 0.07 ) * ( 0.75 + 0.5 * dvFbm( p * 1.3 ) ) * ( 0.9 + 0.2 * dvHash( floor( p * 12.0 ) ) );
    r = 0.95; b = 0.01 * dvNoise( p * 9.0 );
  } else {                 // rubble and broken pavement
    c = mix( vec3( 0.2, 0.19, 0.18 ), vec3( 0.32, 0.25, 0.2 ), dvHash( floor( p * 7.0 ) ) ) * ( 0.7 + 0.4 * dvNoise( p * 14.0 ) );
    r = 0.92; b = 0.02 * dvNoise( p * 7.0 );
  }
}
/* bump from a height in metres by screen derivatives (normal and view position in view space) */
vec3 dvBump( vec3 n, vec3 viewPos, float h ) {
  vec3 dpx = dFdx( viewPos ), dpy = dFdy( viewPos );
  float bx = dFdx( h ), by = dFdy( h );
  vec3 r1 = cross( dpy, n ), r2 = cross( n, dpx );
  float det = dot( dpx, r1 );
  return normalize( abs( det ) * n - sign( det ) * ( bx * r1 + by * r2 ) );
}
`;

const COVER_GLSL = /* glsl */`
  vec4 dvCov = texture2D( uDvCover, vGW.xz ${DV_COVER_UV} );
  float dvDust = clamp( dvCov.a * smoothstep( 0.2, 0.55, dvNoise( vGW.xz * 0.6 ) + dvCov.a * 0.5 ), 0.0, 0.92 );
  diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 - 0.22 * uDvWet ), dvCov.rgb, dvDust );`;

function groundMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, dustU, coverU, envU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplatA;\nattribute vec4 aSplatB;\nvarying vec4 vSA;\nvarying vec4 vSB;\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSA = aSplatA;\nvSB = aSplatB;\nvGW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vSA;\nvarying vec4 vSB;\nvarying vec3 vGW;\nuniform sampler2D uDvCover;\nuniform float uDvWet;\nfloat dvR;\nfloat dvB;\n${GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          float w[ 8 ]; w[ 0 ] = vSA.x; w[ 1 ] = vSA.y; w[ 2 ] = vSA.z; w[ 3 ] = vSA.w; w[ 4 ] = vSB.x; w[ 5 ] = vSB.y; w[ 6 ] = vSB.z; w[ 7 ] = vSB.w;
          float tot = 0.0, top = 0.0; vec3 col = vec3( 0.0 ); dvR = 0.0; dvB = 0.0;
          for ( int k = 0; k < 8; k ++ ) {
            if ( w[ k ] < 0.01 ) continue;
            vec3 c; float r, b; dvSurf( k, vGW.xz, c, r, b );
            col += c * w[ k ]; dvR += r * w[ k ]; dvB += b * w[ k ]; tot += w[ k ]; top = max( top, w[ k ] );
          }
          col /= max( tot, 1e-3 ); dvR /= max( tot, 1e-3 ); dvB /= max( tot, 1e-3 );
          // worn, dirtier edges where one surfacing meets another
          float edge = 1.0 - smoothstep( 0.55, 0.95, top / max( tot, 1e-3 ) );
          col *= 1.0 - 0.3 * edge * ( 0.6 + 0.4 * dvNoise( vGW.xz * 4.0 ) );
          diffuseColor.rgb = col;
        }
        ${COVER_GLSL}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( dvR, dvR * 0.45, uDvWet );')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = dvBump( normal, - vViewPosition, dvB );');
  };
  m.customProgramCacheKey = () => 'dv-terrain';
  return m;
}

function featureMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, dustU, coverU, envU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLook;\nvarying float vLook;\nvarying vec3 vGW;\nvarying vec3 vNW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLook = aLook;\nvGW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvNW = normalize( mat3( modelMatrix ) * objectNormal );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vLook;\nvarying vec3 vGW;\nvarying vec3 vNW;\nuniform sampler2D uDvCover;\nuniform float uDvWet;\nfloat dvR;\nfloat dvB;\n${GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          vec3 an = abs( vNW );
          // the face's own plane: the top in plan, a side along its length
          vec2 p = an.y > 0.7 ? vGW.xz : ( an.x > an.z ? vec2( vGW.z, vGW.y ) : vec2( vGW.x, vGW.y ) );
          int look = int( vLook + 0.5 );
          vec3 c; float r, b;
          if ( look >= 10 ) dvSurf( look - 10, vGW.xz, c, r, b );
          else if ( look == 0 ) {        // granite kerb: speckle, 915 mm lengths
            float g = dvHash( floor( p * 70.0 ) ), along = an.y > 0.7 ? ( an.x > an.z ? vGW.z : vGW.x ) : p.x;
            float j = 1.0 - smoothstep( 0.002, 0.006, abs( fract( along / 0.915 + 0.5 ) - 0.5 ) * 0.915 );
            c = vec3( 0.34, 0.335, 0.32 ) * ( 0.85 + 0.3 * g ) * ( 1.0 - 0.5 * j ); r = 0.7; b = -0.003 * j;
          } else if ( look == 2 ) {      // ashlar
            vec2 q = p / vec2( 0.6, 0.3 ); float row = floor( q.y ); q.x += 0.5 * mod( row, 2.0 );
            float j = dvJoint( fract( q ), vec2( 0.6, 0.3 ), 0.012 );
            c = vec3( 0.42, 0.38, 0.31 ) * ( 0.8 + 0.3 * dvHash( floor( q ) + row ) ) * ( 0.9 + 0.2 * dvNoise( p * 8.0 ) );
            c = mix( c, vec3( 0.5, 0.48, 0.44 ), j * 0.7 ); r = 0.8; b = -0.006 * j;
          } else if ( look == 3 ) {      // stretcher-bond brick
            vec2 q = p / vec2( 0.225, 0.075 ); float row = floor( q.y ); q.x += 0.5 * mod( row, 2.0 );
            float j = dvJoint( fract( q ), vec2( 0.225, 0.075 ), 0.01 );
            c = mix( vec3( 0.3, 0.13, 0.08 ) * ( 0.8 + 0.35 * dvHash( floor( q ) + row * 3.0 ) ), vec3( 0.45, 0.43, 0.4 ), j ); r = 0.85; b = -0.004 * j;
          } else {                       // board-marked concrete
            float board = an.y > 0.7 ? 0.0 : 1.0 - smoothstep( 0.002, 0.008, abs( fract( vGW.y / 0.15 ) - 0.5 ) * 0.15 );
            c = vec3( 0.34, 0.335, 0.32 ) * ( 0.85 + 0.25 * dvFbm( p * 1.5 ) ) * ( 1.0 - 0.15 * board ); r = 0.88; b = -0.001 * board;
          }
          diffuseColor.rgb = c; dvR = r; dvB = b;
        }
        ${COVER_GLSL}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( dvR, dvR * 0.5, uDvWet );')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = dvBump( normal, - vViewPosition, dvB );');
  };
  m.customProgramCacheKey = () => 'dv-terrain-features';
  return m;
}

const DECAL: Record<string, number> = { manhole: 0, valve: 1, gasvalve: 2, grating: 3, hydrant: 4, stopcock: 5, oil: 6, patch: 7, puddle: 8, white: 9, yellow: 10 };

function decalMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, envU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind;\nattribute vec2 aUv;\nvarying float vKind;\nvarying vec2 vUv2;\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind;\nvUv2 = aUv;\nvGW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vKind;\nvarying vec2 vUv2;\nvarying vec3 vGW;\nuniform float uDvWet;\nfloat dvR;\nfloat dvM;\n${GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          int k = int( vKind + 0.5 );
          vec2 u = vUv2; vec2 e = min( u, 1.0 - u );
          vec3 c = vec3( 0.05 ); float a = 1.0; dvR = 0.5; dvM = 0.0;
          float rim = 1.0 - smoothstep( 0.03, 0.06, min( e.x, e.y ) );
          if ( k <= 5 && k != 3 ) {    // cast iron lids in their frames; gas boxes yellow-rimmed, hydrant plates red
            float stud = step( 0.55, dvHash( floor( u * 10.0 ) ) ) * step( 0.2, fract( u.x * 10.0 ) ) * step( 0.2, fract( u.y * 10.0 ) );
            c = vec3( 0.045, 0.045, 0.05 ) * ( 0.8 + 0.4 * stud ) + vec3( 0.03 ) * rim;
            if ( k == 2 ) c = mix( c, vec3( 0.55, 0.42, 0.05 ), rim );
            if ( k == 4 ) c = mix( c, vec3( 0.5, 0.05, 0.04 ), rim );
            dvR = 0.45; dvM = 0.7;
          } else if ( k == 3 ) {       // gully grating: bars over the dark pot
            float bar = step( 0.45, fract( u.x * 7.0 ) );
            c = mix( vec3( 0.005 ), vec3( 0.06, 0.06, 0.065 ), max( bar, rim ) ); dvR = 0.5; dvM = 0.6;
          } else if ( k == 6 ) {       // oil: a dark stain, a sheen when wet
            float d = length( u - 0.5 ) * 2.0; float n = dvFbm( vGW.xz * 3.0 );
            a = ( 1.0 - smoothstep( 0.35, 1.0, d + 0.4 * n ) ) * 0.7; c = vec3( 0.012, 0.011, 0.01 ); dvR = mix( 0.35, 0.1, uDvWet );
          } else if ( k == 7 ) {       // patch repair
            a = ( 1.0 - smoothstep( 0.0, 0.06, 0.06 - min( e.x, e.y ) ) ) * 0.85; c = vec3( 0.035, 0.036, 0.04 ) * ( 0.8 + 0.4 * dvNoise( vGW.xz * 20.0 ) ); dvR = 0.8;
          } else if ( k == 8 ) {       // standing water in a dip
            float d = length( u - 0.5 ) * 2.0; float n = dvFbm( vGW.xz * 1.5 );
            a = 1.0 - smoothstep( 0.5, 1.0, d + 0.35 * n ); c = vec3( 0.01, 0.012, 0.014 ); dvR = 0.03; dvM = 0.0; a *= 0.85;
          } else {                     // road paint, worn
            c = k == 9 ? vec3( 0.75, 0.75, 0.72 ) : vec3( 0.7, 0.5, 0.06 );
            a = 0.92 * smoothstep( 0.25, 0.6, dvNoise( vGW.xz * 9.0 ) + 0.45 ); dvR = 0.55;
          }
          diffuseColor.rgb = c; diffuseColor.a *= a;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( dvR, dvR * 0.5, uDvWet );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = dvM;');
  };
  m.customProgramCacheKey = () => 'dv-terrain-decals';
  return m;
}

/* ---------------- state ---------------- */

interface View {
  data: TerrainData;
  group: THREE.Group;
  ground: THREE.Mesh;
  geo: THREE.BufferGeometry;
  skirt: Int32Array;         // border sample → its skirt vertex, or -1
  lod: Uint8Array;           // per tile: 1, 2 or 4 samples a quad
  version: number;
  features: THREE.Mesh;
  decals: THREE.Mesh;
  tufts: THREE.InstancedMesh;
  base: Float32Array;        // heights as built: paint and tufts go where the ground has been dug
  alive: number;
}

let scene: THREE.Scene | null = null;
let view: View | null = null;
let mats: { ground: THREE.MeshStandardMaterial; feat: THREE.MeshStandardMaterial; decal: THREE.MeshStandardMaterial; tuft: THREE.MeshStandardMaterial } | null = null;

export function initTerrainGfx(s: THREE.Scene): void {
  scene = s;
  mats ??= {
    ground: groundMaterial(), feat: featureMaterial(), decal: decalMaterial(),
    tuft: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
  };
}

/** Per frame: builds the ground for a new site, refreshes tiles a crater has changed, and picks each tile's level. */
export function updateTerrainGfx(cam: THREE.Vector3): void {
  if (!scene || !mats) return;
  const d = terrain.data;
  if (!d) return;
  if (!view || view.data !== d) build(d);
  const v = view!;
  if (v.version !== terrain.version) refresh(v);
  if (pickLod(v, cam)) index(v);
}

function dispose(): void {
  if (!view) return;
  view.group.parent?.remove(view.group);
  for (const m of [view.ground, view.features, view.decals, view.tufts]) m.geometry.dispose();
  view.tufts.dispose();
  view = null;
}

function build(d: TerrainData): void {
  dispose();
  const n = d.n, T = d.tiles, count = n * n;
  // skirt vertices under every tile-border sample
  const skirt = new Int32Array(count).fill(-1);
  let ns = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (i % TILE_CELLS === 0 || j % TILE_CELLS === 0) skirt[i + n * j] = count + ns++;
  const nv = count + ns;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geo.setAttribute('aSplatA', new THREE.BufferAttribute(new Uint8Array(nv * 4), 4, true));
  geo.setAttribute('aSplatB', new THREE.BufferAttribute(new Uint8Array(nv * 4), 4, true));
  const ground = new THREE.Mesh(geo, mats!.ground);
  ground.receiveShadow = true;
  ground.castShadow = true;
  ground.frustumCulled = false;
  ground.name = 'terrain';
  const group = new THREE.Group();
  group.name = 'terrain';
  const empty = () => new THREE.BufferGeometry();
  const features = new THREE.Mesh(empty(), mats!.feat);
  features.castShadow = features.receiveShadow = true;
  const decals = new THREE.Mesh(empty(), mats!.decal);
  decals.renderOrder = 1;
  const tufts = new THREE.InstancedMesh(tuftGeo(), mats!.tuft, 16000);
  tufts.receiveShadow = true;
  tufts.frustumCulled = false;
  group.add(ground, features, decals, tufts);
  scene!.add(group);
  view = { data: d, group, ground, geo, skirt, lod: new Uint8Array(T * T), version: -1, features, decals, tufts, base: new Float32Array(d.h), alive: -1 };
  fill(view, 0, n - 1, 0, n - 1);
  hideSceneryGround(d.half);
  refresh(view);
  index(view);
}

/** Heights, normals and surfacing of samples in [i0, i1] × [j0, j1] (and their skirts). */
function fill(v: View, i0: number, i1: number, j0: number, j1: number): void {
  const d = v.data, n = d.n, H = d.h;
  const pos = v.geo.attributes.position.array as Float32Array, nor = v.geo.attributes.normal.array as Float32Array;
  const sa = v.geo.attributes.aSplatA.array as Uint8Array, sb = v.geo.attributes.aSplatB.array as Uint8Array;
  for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
    const k = i + n * j, x = -d.half + i * d.cell, z = -d.half + j * d.cell, y = H[k];
    const hl = H[Math.max(0, i - 1) + n * j], hr = H[Math.min(n - 1, i + 1) + n * j], hd = H[i + n * Math.max(0, j - 1)], hu = H[i + n * Math.min(n - 1, j + 1)];
    let nx = hl - hr, ny = 2 * d.cell, nz = hd - hu;
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const m = d.mat[k];
    for (const q of [k, v.skirt[k]]) {
      if (q < 0) continue;
      pos[3 * q] = x; pos[3 * q + 1] = q === k ? y : y - 0.6; pos[3 * q + 2] = z;
      nor[3 * q] = nx; nor[3 * q + 1] = ny; nor[3 * q + 2] = nz;
      for (let c = 0; c < 4; c++) { sa[4 * q + c] = m === c ? 255 : 0; sb[4 * q + c] = m === c + 4 ? 255 : 0; }
    }
  }
  for (const name of ['position', 'normal', 'aSplatA', 'aSplatB']) v.geo.attributes[name].needsUpdate = true;
}

/** After a change of the terrain: the tiles it touched, the features, the decals and tufts. */
function refresh(v: View): void {
  const d = v.data, n = d.n;
  for (const t of terrain.dirty) {
    const tx = t % d.tiles, tz = Math.floor(t / d.tiles);
    fill(v, tx * TILE_CELLS - 1, (tx + 1) * TILE_CELLS + 1, tz * TILE_CELLS - 1, (tz + 1) * TILE_CELLS + 1);
  }
  terrain.dirty.clear();
  v.geo.computeBoundingSphere();
  const alive = d.items.reduce((s, it) => s + (it.alive ? 1 : 0), 0);
  if (alive !== v.alive) { v.alive = alive; v.features.geometry.dispose(); v.features.geometry = featureGeo(d); }
  v.decals.geometry.dispose();
  v.decals.geometry = decalGeo(v);
  tufts(v);
  v.version = terrain.version;
  void n;
}

/* ---------------- tiles ---------------- */

function pickLod(v: View, cam: THREE.Vector3): boolean {
  const d = v.data, T = d.tiles, S = d.cell * TILE_CELLS;
  let changed = false;
  for (let tz = 0; tz < T; tz++) for (let tx = 0; tx < T; tx++) {
    const cx = -d.half + (tx + 0.5) * S, cz = -d.half + (tz + 0.5) * S;
    const r = Math.max(0, Math.hypot(cx - cam.x, cz - cam.z) - S * 0.7);
    const l = r < 40 ? 1 : r < 100 ? 2 : 4;
    const t = tx + T * tz;
    if (v.lod[t] !== l) { v.lod[t] = l; changed = true; }
  }
  return changed;
}

function index(v: View): void {
  const d = v.data, n = d.n, T = d.tiles, idx: number[] = [];
  for (let tz = 0; tz < T; tz++) for (let tx = 0; tx < T; tx++) {
    const s = v.lod[tx + T * tz] || 1, i0 = tx * TILE_CELLS, j0 = tz * TILE_CELLS;
    // the cell split the physics uses: along the (1,0)-(0,1) diagonal
    for (let j = j0; j < j0 + TILE_CELLS; j += s) for (let i = i0; i < i0 + TILE_CELLS; i += s) {
      const a = i + n * j, b = a + s, c = a + s * n, e = c + s;
      idx.push(a, c, b, b, c, e);
    }
    // skirts down each edge, both faces
    const edge = (list: number[]) => {
      for (let q = 0; q + 1 < list.length; q++) {
        const a = list[q], b = list[q + 1], a2 = v.skirt[a], b2 = v.skirt[b];
        idx.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2);
      }
    };
    const top: number[] = [], bot: number[] = [], lft: number[] = [], rgt: number[] = [];
    for (let q = 0; q <= TILE_CELLS; q += s) {
      top.push(i0 + q + n * j0); bot.push(i0 + q + n * (j0 + TILE_CELLS));
      lft.push(i0 + n * (j0 + q)); rgt.push(i0 + TILE_CELLS + n * (j0 + q));
    }
    edge(top); edge(bot); edge(lft); edge(rgt);
  }
  v.geo.setIndex(idx);
}

/* ---------------- features ---------------- */

function featureGeo(d: TerrainData): THREE.BufferGeometry {
  const pos: number[] = [], look: number[] = [];
  for (const it of d.items) {
    if (!it.alive) continue;
    for (let q = 0; q < it.pos.length; q++) pos.push(it.pos[q]);
    for (let q = 0; q < it.pos.length / 3; q++) look.push(it.look);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aLook', new THREE.Float32BufferAttribute(look, 1));
  g.computeVertexNormals();
  return g;
}

/* ---------------- decals and markings ---------------- */

function decalGeo(v: View): THREE.BufferGeometry {
  const d = v.data, s = d.spec;
  const pos: number[] = [], uv: number[] = [], kind: number[] = [], idx: number[] = [];
  const dug = (x: number, z: number) => {
    const i = Math.round((x + d.half) / d.cell), j = Math.round((z + d.half) / d.cell);
    if (i < 0 || j < 0 || i >= d.n || j >= d.n) return false;
    return Math.abs(d.h[i + d.n * j] - v.base[i + d.n * j]) > 0.03;
  };
  const quad = (cx: number, cz: number, ux: number, uz: number, hw: number, hd: number, k: number, lift = 0.012) => {
    // (ux, uz): unit along; the quad spans ±hw along it and ±hd across
    const px = -uz, pz = ux, base = pos.length / 3;
    if (dug(cx, cz)) return;
    for (const [a, b, u0, u1] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      const x = cx + ux * hw * a + px * hd * b, z = cz + uz * hw * a + pz * hd * b;
      pos.push(x, fieldHeight(d, x, z) + lift, z);
      uv.push(u0, u1);
      kind.push(k);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (const q of s.decals) {
    const r = q.rot ?? 0;
    quad(q.x, q.z, Math.cos(r), Math.sin(r), q.w / 2, (q.d ?? q.w) / 2, DECAL[q.kind], q.kind === 'puddle' || q.kind === 'oil' || q.kind === 'patch' ? 0.008 : 0.014);
  }
  // road markings, laid in lengths that follow the ground
  for (const m of s.marks) {
    const dx = m.b[0] - m.a[0], dz = m.b[1] - m.a[1], L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    const ux = dx / L, uz = dz / L, px = -uz, pz = ux, white = m.kind === 'yellow' ? DECAL.yellow : DECAL.white;
    const run = (u0: number, u1: number, off = 0, w = m.w) => {
      for (let u = u0; u < u1 - 1e-6; u += 1.5) {
        const e = Math.min(u1, u + 1.5), c = (u + e) / 2;
        quad(m.a[0] + ux * c + px * off, m.a[1] + uz * c + pz * off, ux, uz, (e - u) / 2, w / 2, white);
      }
    };
    if (m.kind === 'line' || m.kind === 'stop' || m.kind === 'bay') run(0, L);
    else if (m.kind === 'dash') for (let u = 0; u < L; u += 9) run(u, Math.min(L, u + 3));
    else if (m.kind === 'give') for (let u = 0; u < L; u += 0.9) run(u, Math.min(L, u + 0.6));
    else if (m.kind === 'double' || m.kind === 'yellow') { run(0, L, -0.1, 0.1); run(0, L, 0.1, 0.1); }
    else if (m.kind === 'zebra') {
      // stripes across the crossing, 0.6 m wide at 1.2 m centres, running along the crossing's width w
      for (let u = 0.3; u < L; u += 1.2) quad(m.a[0] + ux * u, m.a[1] + uz * u, px, pz, m.w / 2, 0.3, white);
    } else if (m.kind === 'hatch') {
      for (let u = 0.5; u < L; u += 1.5) quad(m.a[0] + ux * u, m.a[1] + uz * u, (ux + px) / Math.SQRT2, (uz + pz) / Math.SQRT2, m.w * 0.7, 0.08, white);
      run(0, L, -m.w / 2, 0.1); run(0, L, m.w / 2, 0.1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/* ---------------- grass ---------------- */

function tuftGeo(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + 0.4, r = 0.05, lean = 0.06 + 0.04 * (b % 2), h = 0.16 + 0.06 * ((b * 7) % 3);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, tx = Math.cos(a + 1.4) * 0.02, tz = Math.sin(a + 1.4) * 0.02;
    pos.push(x - tx, 0, z - tz, x + tx, 0, z + tz, x + Math.cos(a) * lean, h, z + Math.sin(a) * lean);
    col.push(0.05, 0.09, 0.025, 0.05, 0.09, 0.025, 0.16, 0.2, 0.06);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function tufts(v: View): void {
  const d = v.data, grass = SURFACES.indexOf('grass'), n = d.n, m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let c = 0;
  const max = v.tufts.count;
  for (let j = 1; j < n - 1 && c < max; j++) for (let i = 1; i < n - 1 && c < max; i++) {
    const k = i + n * j;
    if (d.mat[k] !== grass) continue;
    const r = hash(i, j);
    if (r > 0.55) continue;
    const x = -d.half + (i + hash(j, i)) * d.cell, z = -d.half + (j + hash(i + 7, j)) * d.cell;
    p.set(x, fieldHeight(d, x, z), z);
    q.setFromAxisAngle(UP, r * 40);
    const s = 0.7 + r;
    sc.set(s, s * (0.8 + hash(i, j + 3) * 0.6), s);
    m.compose(p, q, sc);
    v.tufts.setMatrixAt(c++, m);
  }
  v.tufts.count = c;
  v.tufts.instanceMatrix.needsUpdate = true;
}
const UP = new THREE.Vector3(0, 1, 0);
function hash(a: number, b: number): number {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ---------------- the scenery's ground beyond the site ---------------- */

function hideSceneryGround(half: number): void {
  const g = scene?.getObjectByName('ground') as THREE.Mesh | undefined;
  if (!g || (g.userData.hole as number | undefined) === half) return;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 1150, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.moveTo(-half, -half); hole.lineTo(half, -half); hole.lineTo(half, half); hole.lineTo(-half, half); hole.lineTo(-half, -half);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape, 48).rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
  g.geometry.dispose();
  g.geometry = geo;
  g.userData.hole = half;
}
