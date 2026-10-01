/* Render-internal state shared between renderer, fx, viewmodel, materials and scenery.
   The renderer writes it in setEnvironment and bumps `version`; consumers re-read when it changes,
   so init order between the render modules does not matter. The uniform objects below are attached
   by reference to every material that uses them, so one write per frame reaches all programs. */
import * as THREE from 'three';
import type { EnvPreset, Quality } from '../types';

export const lighting = {
  preset: 'noon' as EnvPreset,
  /** unit vector toward the sun (or moon at night) */
  sunDir: new THREE.Vector3(0.4, 0.8, 0.4).normalize(),
  /** linear colour of the key light, intensity not folded in */
  sunColor: new THREE.Color(1, 1, 1),
  sunIntensity: 3,
  /** rough irradiance from sky above / ground below, linear, for unlit-shader shading */
  ambTop: new THREE.Color(0.4, 0.45, 0.55),
  ambBot: new THREE.Color(0.2, 0.18, 0.15),
  hemiSky: new THREE.Color(1, 1, 1),
  hemiGround: new THREE.Color(0.5, 0.45, 0.4),
  hemiIntensity: 0.3,
  env: null as THREE.Texture | null,
  envIntensity: 1,
  /** 0 = day, 1 = full night lighting (floodlights, lit windows) */
  lamps: 0,
  /** 0..1 air humidity: condensation flashes on blasts, wet ground */
  humidity: 0,
  version: 0,
};

/** Queue [start, start + count) of an attribute for upload. three uploads (and clears) the ranges only when the mesh is
    next drawn, so a frame that is stepped but not drawn (a hidden tab, a capture preroll) must widen what is still
    pending rather than replace it, or what it wrote never reaches the GPU. */
export function pendRange(at: THREE.BufferAttribute, start: number, count: number): void {
  const r = at.updateRanges[0];
  if (r) {
    const end = Math.max(r.start + r.count, start + count);
    r.start = Math.min(r.start, start);
    r.count = end - r.start;
  } else at.addUpdateRange(start, count);
  at.needsUpdate = true;
}

/** drawing-buffer size in device pixels, and the active quality tier */
export const view = { width: 1, height: 1, quality: 'medium' as Quality };

/** light arriving at the camera from explosion / fire lights this frame (linear), for the viewmodel */
export const flashAtCamera = new THREE.Color(0, 0, 0);
/** comfort settings the renderer honours: `flash` scales every flash light (blasts, arc flashes, muzzles), `dust` the
    demolition dust (1 = the game's own amount) */
export const comfort = { flash: 1, dust: 1 };

/** fx meshes drawn after the opaque pass: depth-tested sparks and rings, the soft smoke/dust puffs (which may go to a
    half-resolution target and occlude only through the soft depth test), and the big lingering dust billows, which
    always draw at half resolution under the puffs */
export const FX_LAYER = 3, FX_SOFT_LAYER = 4, FX_DUST_LAYER = 5;

/* ---------------- dust clouds ---------------- */

/** ellipsoids fx keeps for the big lingering dust clouds; they shadow the sun for particles and lit surfaces */
export const CLOUDS = 8;
export const dustU = {
  /** xyz centre, w horizontal radius */
  uDvCloud: { value: Array.from({ length: CLOUDS }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
  /** x extinction per metre (0 = unused), y vertical squash (1 = sphere) */
  uDvCloudP: { value: Array.from({ length: CLOUDS }, () => new THREE.Vector4()) },
  uDvCloudN: { value: 0 },
  /** 0 on low: lit surfaces skip the cloud shadow (particles keep it) */
  uDvCloudSurf: { value: 1 },
  uDvSunDir: { value: new THREE.Vector3(0, 1, 0) },
};

/* Every lit program declares these (see the chunk patch in renderer.ts); programs whose material does
   not attach dustU keep the GL default of 0 and skip the loop. */
export const DV_CLOUD_GLSL = /* glsl */`
uniform vec4 uDvCloud[ ${CLOUDS} ];
uniform vec4 uDvCloudP[ ${CLOUDS} ];
uniform float uDvCloudN;
uniform float uDvCloudSurf;
uniform vec3 uDvSunDir;
float dvCloudOD( vec3 p, vec3 d ) {
  float od = 0.0;
  for ( int i = 0; i < ${CLOUDS}; i ++ ) {
    vec4 k = uDvCloudP[ i ];
    if ( k.x <= 0.0 ) continue;
    vec4 c = uDvCloud[ i ];
    vec3 sq = vec3( 1.0, k.y, 1.0 );
    vec3 o = ( p - c.xyz ) * sq;
    vec3 dd = d * sq;
    float a = dot( dd, dd );
    float b = dot( o, dd );
    float r2 = c.w * c.w;
    float h = b * b - a * ( dot( o, o ) - r2 );
    if ( h <= 0.0 ) continue;
    h = sqrt( h );
    float t1 = ( - b + h ) / a;
    if ( t1 <= 0.0 ) continue;
    float t0 = max( ( - b - h ) / a, 0.0 );
    // chord through the ellipsoid, weighted toward its core so the shadow edge is soft
    float core = 1.0 - clamp( ( dot( o, o ) - b * b / a ) / r2, 0.0, 1.0 );
    od += k.x * ( t1 - t0 ) * ( 0.35 + 0.65 * core );
  }
  return od;
}`;

/** world-space dust / debris coverage that settles on up-facing surfaces: rgb colour, a coverage */
export const COVER_N = 256, COVER_EXTENT = 192;
const coverData = new Uint8Array(COVER_N * COVER_N * 4);
const coverTex = new THREE.DataTexture(coverData, COVER_N, COVER_N, THREE.RGBAFormat, THREE.UnsignedByteType);
coverTex.magFilter = THREE.LinearFilter;
coverTex.minFilter = THREE.LinearFilter;
coverTex.wrapS = coverTex.wrapT = THREE.ClampToEdgeWrapping;
coverTex.needsUpdate = true;
export const coverage = { data: coverData, tex: coverTex, dirty: false };
export const coverU = { uDvCover: { value: coverTex as THREE.Texture } };
export const DV_COVER_UV = `* ${(1 / COVER_EXTENT).toFixed(8)} + 0.5`;

/** wetness of the ground (dew / rain), 0..1 */
export const envU = { uDvWet: { value: 0 } };

/** quality tier as a uniform (0 low, 1 medium, 2 high) so features switch without new shader permutations */
export const qualU = { uDvQ: { value: 1 } };

/** light inside the fake rooms behind glazing: rgb daylight arriving through the window, a = night (office lights) */
export const roomU = {
  uDvRoom: { value: new THREE.Vector4(0.6, 0.65, 0.7, 0) },
  /** fx's flash and fire lights (position, linear colour × power): a charge going off inside lights the rooms round it */
  uDvFlashP: { value: Array.from({ length: 3 }, () => new THREE.Vector3(0, -1e4, 0)) },
  uDvFlashC: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
};

/* ---------------- atmosphere ---------------- */

/** soft-particle depth: linear view depth in metres, written by the renderer before the fx layer draws */
export const softU = {
  uDepth: { value: null as THREE.Texture | null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uSoft: { value: 0 },
};

export const atmosU = {
  /** x density at the base height (1/m), y falloff (1/m), z base height, w sun in-scatter strength */
  uHFog: { value: new THREE.Vector4(0, 0.05, 0, 0) },
  uHFogCol: { value: new THREE.Color() },
  uHFogSun: { value: new THREE.Color() },
  /** camera inside a dust cloud: rgb lit dust colour, a extinction per metre */
  uDustFog: { value: new THREE.Vector4() },
  uDustFogR: { value: 20 },
  /** fx clock, for the drift of the dust the camera stands in */
  uAtmT: { value: 0 },
  uAtmSun: { value: new THREE.Vector3(0, 1, 0) },
};

/* Height fog (analytic optical depth of an exponential layer) with a Mie-ish sun lobe, plus the
   dust the camera is standing in. Returns premultiplied in-scatter and the transmittance. */
export const DV_ATMOS_GLSL = /* glsl */`
uniform vec4 uHFog;
uniform vec3 uHFogCol;
uniform vec3 uHFogSun;
uniform vec4 uDustFog;
uniform float uDustFogR;
uniform float uAtmT;
uniform vec3 uAtmSun;
// dustK scales the optical depth of the dust round the camera (1 = even; the full-screen pass varies it with noise)
vec4 dvAtmosK( vec3 cam, vec3 wp, float sky, float dustK ) {
  vec3 d = wp - cam;
  float L = length( d );
  vec3 dir = d / max( L, 1e-4 );
  float fb = uHFog.y * d.y;
  float od = uHFog.x * L * exp( - uHFog.y * ( cam.y - uHFog.z ) ) * ( abs( fb ) > 1e-3 ? ( 1.0 - exp( - fb ) ) / fb : 1.0 );
  float T = sky > 0.5 ? 1.0 : exp( - od );
  float mu = max( dot( dir, uAtmSun ), 0.0 );
  vec3 col = uHFogCol + uHFogSun * uHFog.w * ( pow( mu, 6.0 ) * 0.6 + pow( mu, 40.0 ) * 1.4 );
  float Td = exp( - uDustFog.a * dustK * min( L, uDustFogR ) );
  return vec4( col * ( 1.0 - T ) * Td + uDustFog.rgb * ( 1.0 - Td ), T * Td );
}
vec4 dvAtmos( vec3 cam, vec3 wp, float sky ) { return dvAtmosK( cam, wp, sky, 1.0 ); }`;
