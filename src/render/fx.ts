/* Particle effects. Smoke/dust/fire/flash puffs, sparks, scorch decals and shock rings are GPU ring
   buffers: a spawn writes one instance slot, motion is analytic in the vertex shader, and each frame
   uploads only the dirty slot range. Chips/splinters/shards need bounce + settle so they are CPU
   simulated into InstancedMeshes. Everything is allocated in initFx; spawning allocates nothing. */
import * as THREE from 'three';
import { random } from 'math/random';
import type { Vec3, MaterialId, WeaponId } from '../types';
import { makeRng, noiseTex, scorchTex, smokeAtlas } from './textures';
import { animateMaterials } from './materials';
import { CLOUDS, COVER_EXTENT, COVER_N, DV_ATMOS_GLSL, DV_CLOUD_GLSL, FX_DUST_LAYER, FX_LAYER, FX_SOFT_LAYER, atmosU, comfort, coverage, dustU, flashAtCamera, lighting, pendRange, roomU, softU, view } from './shared';
import { lampPool } from './lights';
import { floodlights } from './scenery';

const PUFFS = 4000, DUSTS = 1800, SPARKS = 2000, SCORCH = 40, RINGS = 8, FIRES = 16, BEACONS = 4, ARCS = 4;
let rng = makeRng(0x5eed);
const rf = (a: number, b: number): number => random.float(rng, a, b);
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const DEAD = -1e6;

/* ---------------- shaders ---------------- */

const DEAD_VERT = 'gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 ); return;';

/* NL = 3 fx flash lights + the 6 lamp PointLights; 4 floodlight spots are cone-limited */
const NL = 9;

const PUFF_VS = /* glsl */`
#define NL ${NL}
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uSunDir;
uniform vec3 uLPos[ NL ];
uniform vec3 uLCol[ NL ];
uniform vec3 uSPos[ 4 ];
uniform vec4 uSDir[ 4 ];
uniform vec3 uSCol[ 4 ];
${DV_CLOUD_GLSL}
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec4 aD;
attribute vec4 aE;
attribute vec4 aF;
attribute vec4 aG;
varying vec2 vQ;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vEmit;
varying vec3 vSunV;
varying vec3 vLoc;
varying float vY;
varying float vSun;
varying float vOcc;
varying float vViewZ;
varying float vSoftR;
varying vec3 vWP;
varying vec3 vVd;
varying vec2 vNz;
varying float vT;
#include <fog_pars_vertex>
vec3 dvSwirl( vec3 p ) {
  return vec3(
    sin( p.y * 1.1 + 1.7 * sin( p.z * 0.73 + 0.4 ) ),
    0.55 * sin( p.z * 0.97 + 1.7 * sin( p.x * 0.61 + 2.1 ) ),
    sin( p.x * 1.03 + 1.7 * sin( p.y * 0.83 + 4.3 ) ) );
}
void main() {
  float age = uTime - aA.w;
  float life = aB.w;
  if ( age < 0.0 || age >= life ) { ${DEAD_VERT} }
  float t = age / life;
  float drag = aE.w;
  float k = drag > 0.001 ? ( 1.0 - exp( -drag * age ) ) / drag : age;
  vec3 p = aA.xyz + aB.xyz * k + uWind * ( aF.y * age );
  p.y += aE.z * age + aF.z * age * age;
  float it = 1.0 - t;
  // aG.z > 0: grows on its own time constant (s), so a long-lived billow swells out in seconds and then drifts,
  // instead of creeping to full size over its whole life
  float s = mix( aC.x, aC.y, aG.z > 0.0 ? 1.0 - exp( - age / aG.z ) : 1.0 - it * it * it );
  float ph = aA.w * 7.13 + aC.z;
  p.x += sin( age * 0.8 + ph ) * 0.1 * s * t;
  p.z += cos( age * 0.6 + ph * 1.7 ) * 0.1 * s * t;
  if ( aG.x > 0.0 ) {
    // one shared swirl field, scaled to the puff's final size, so neighbouring billows roll together
    vec3 q0 = ( aA.xyz + uWind * ( aF.y * age ) ) / ( max( aC.y, 1.0 ) * 1.6 ) + vec3( 0.0, age * 0.035, age * 0.021 );
    vec3 sw = dvSwirl( q0 ) + 0.4 * dvSwirl( q0 * 2.3 + 5.1 );
    p += sw * ( aG.x * s * ( 1.0 - exp( - age * 0.18 ) ) );
  }
  // aG.y > 0: a bank of dust rolling along the ground reads wider than it is tall
  vec2 sq = vec2( 1.0 + aG.y, inversesqrt( 1.0 + aG.y ) );
  p.y = max( p.y, s * 0.3 * sq.y );
  vec2 q = position.xy * 2.0;
  vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
  float dist = -mvPosition.z;
  // a puff wider than the screen costs a full-screen fill for almost no information: fade it out and let
  // the camera-in-dust fog carry the look
  float bigFade = 1.0 - smoothstep( 1.1, 2.4, s * 0.5 * sq.x * projectionMatrix[ 1 ][ 1 ] / max( dist, 0.05 ) );
  if ( bigFade <= 0.0 ) { ${DEAD_VERT} }
  // a detonation flash (heat > 60) never shrinks below ~1.2 % of its distance: at range it flares the lens like the
  // real thing instead of vanishing into a few pixels; its emission is spread over the larger card
  float flare = 1.0;
  if ( abs( aE.x ) > 60.0 ) { float sMin = dist * 0.024; if ( s < sMin ) { flare = s / sMin; s = sMin; } }
  mvPosition.xy += q * sq * ( s * 0.5 );
  vVd = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  float rot = aC.z + aC.w * age;
  float cr = cos( rot );
  float sr = sin( rot );
  vec2 rq = vec2( cr * q.x - sr * q.y, sr * q.x + cr * q.y );
  vec2 cell = vec2( mod( aF.x, 2.0 ), floor( aF.x * 0.5 ) );
  vUv = ( cell + rq * 0.5 + 0.5 ) * 0.5;
  // erosion noise in the puff's own frame, sliding slowly so the edge keeps boiling as it thins
  vNz = rq * 0.32 + vec2( aC.z * 0.159 + aA.w * 0.0731, aF.x * 0.27 + aC.w * 0.5 ) + vec2( 0.011, - 0.007 ) * age;
  vT = t;
  vQ = q;
  float fin = aF.w > 0.0 ? clamp( age / aF.w, 0.0, 1.0 ) : 1.0;
  float fout = 1.0 - smoothstep( 0.3, 1.0, t );
  float hk = aE.y > 0.0 ? clamp( 1.0 - age / aE.y, 0.0, 1.0 ) : 0.0;
  hk *= hk;
  float nearFade = smoothstep( 0.1, 0.1 + s * 0.7, dist );
  float nearEmit = smoothstep( 0.05, 0.05 + s * 0.2, dist );
  vCol = vec4( aD.rgb, aD.a * fin * fout * ( 1.0 - 0.85 * hk ) * nearFade * bigFade );
  vec3 ramp = aE.x >= 0.0 ? vec3( 1.0, 0.22 + 0.55 * hk, 0.04 + 0.32 * hk * hk ) : aD.rgb;
  vEmit = ramp * ( abs( aE.x ) * hk * fin * nearEmit * bigFade * ( 0.6 + 0.4 * fout ) ) * sqrt( flare );
  vSunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
  vec3 loc = vec3( 0.0 );
  for ( int i = 0; i < NL; i ++ ) {
    vec3 dl = uLPos[ i ] - p;
    loc += uLCol[ i ] / ( dot( dl, dl ) + 1.0 );
  }
  for ( int i = 0; i < 4; i ++ ) {
    vec3 dl = p - uSPos[ i ];
    float d2 = max( dot( dl, dl ), 1e-4 );
    float cone = smoothstep( uSDir[ i ].w, uSDir[ i ].w + 0.08, dot( dl * inversesqrt( d2 ), uSDir[ i ].xyz ) );
    loc += uSCol[ i ] * ( cone / ( sqrt( d2 ) + 1.0 ) );
  }
  vLoc = loc;
  vSun = 1.0;
  vOcc = 1.0;
  if ( uDvCloudN > 0.5 ) {
    // optical depth through the dust ellipsoids toward the sun and straight up: self-shadowing and
    // the dark underbelly of a big cloud
    vSun = exp( - dvCloudOD( p, uSunDir ) );
    vOcc = exp( - 0.7 * dvCloudOD( p, vec3( 0.0, 1.0, 0.0 ) ) );
  }
  vViewZ = dist;
  vSoftR = max( 0.3, s * 0.4 );
  vWP = p;
  vY = p.y + ( q.x * sq.x * viewMatrix[ 1 ][ 0 ] + q.y * sq.y * viewMatrix[ 1 ][ 1 ] ) * s * 0.5;
  #include <fog_vertex>
}`;

const FOG_FACTOR = /* glsl */`
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  #endif`;

const PUFF_FS = /* glsl */`
uniform sampler2D uTex;
uniform sampler2D uNoise;
uniform float uErode;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uSoft;
${DV_ATMOS_GLSL}
varying vec2 vQ;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vEmit;
varying vec3 vSunV;
varying vec3 vLoc;
varying float vY;
varying float vSun;
varying float vOcc;
varying float vViewZ;
varying float vSoftR;
varying vec3 vWP;
varying vec3 vVd;
varying vec2 vNz;
varying float vT;
#include <fog_pars_fragment>
// Henyey-Greenstein, scaled so isotropic scattering is 1
float dvHG( float mu, float g ) {
  float d = 1.0 + g * g - 2.0 * g * mu;
  return ( 1.0 - g * g ) / ( d * sqrt( d ) );
}
void main() {
  float r2 = dot( vQ, vQ );
  if ( r2 >= 1.0 ) discard;
  vec4 tx = texture2D( uTex, vUv );
  // thin, ragged margins and a less even core: dust is a haze with structure, not a ball of wool
  float dens = tx.r * mix( 0.7, 1.15, tx.g ) * ( 1.0 - 0.45 * smoothstep( 0.35, 1.0, r2 ) );
  // noise eats the puff from its rim inward as it ages, so neighbouring puffs merge into one ragged mass
  // instead of each keeping a round outline
  float nz = texture2D( uNoise, vNz ).r * 0.62 + texture2D( uNoise, vNz * 2.7 + 0.31 ).g * 0.38;
  float er = uErode * ( 0.32 + 0.5 * vT ) * ( 0.4 + 0.6 * smoothstep( 0.05, 0.8, r2 ) );
  dens = clamp( ( dens - er * ( 1.0 - nz ) * 1.25 ) / ( 1.0 - 0.5 * er ), 0.0, 1.0 );
  float ground = smoothstep( 0.0, 0.35, vY );
  float soft = 1.0;
  if ( uSoft > 0.5 ) soft = clamp( ( texture2D( uDepth, gl_FragCoord.xy / uRes ).r - vViewZ ) / vSoftR, 0.0, 1.0 );
  float a = clamp( dens * vCol.a, 0.0, 1.0 ) * ground * soft;
  vec3 emit = vEmit * dens * ground * soft;
  if ( a < 0.002 && dot( emit, emit ) < 1e-6 ) discard;
  // a flattened normal: the puff is lit as a patch of a larger cloud, not shaded as a sphere; the density's own
  // gradient tilts it, so each lobe of a billow has a lit flank and a shaded one (the cauliflower look)
  // (screen derivatives are in the billboard's own frame, so no texture rotation to undo)
  vec2 dvG = clamp( vec2( dFdx( dens ), dFdy( dens ) ) / max( vec2( fwidth( vQ.x ), fwidth( vQ.y ) ), vec2( 1e-3 ) ), - 4.0, 4.0 );
  vec3 n = normalize( vec3( vQ * 0.45 - dvG * 0.35, sqrt( 1.0 - r2 ) + 0.9 ) );
  float wrap = clamp( dot( n, vSunV ) * 0.45 + 0.55, 0.0, 1.0 );
  // local optical thickness: dense cores shadow themselves on the side away from the sun
  float tau = dens * vCol.a * 5.0;
  float self = exp( - tau * ( 1.1 - 0.75 * wrap ) );
  // mineral dust scatters strongly forward (g ~ 0.7) with a weak back lobe: with a low sun behind the cloud its thin
  // margins glow and the light leaks through, while the thick core stays dark
  float mu = dot( normalize( vVd ), vSunV );
  float phase = 0.8 * dvHG( mu, 0.72 ) + 0.2 * dvHG( mu, - 0.25 );
  float fwd = min( max( phase - 1.0, 0.0 ) * 0.5, 6.0 ) * exp( - tau * 0.9 );
  vec3 amb = mix( uAmbBot, uAmbTop, n.y * 0.5 + 0.5 ) * mix( 0.45, 1.0, vOcc ) * mix( 0.62, 1.0, exp( - tau * 0.8 ) );
  // shadowed interior still glows a little from light scattered in from the lit side
  vec3 light = amb + uSunCol * ( vSun * ( wrap * wrap * mix( 0.5, 1.0, self ) + fwd ) + 0.12 * vOcc * ( 1.0 - vSun ) ) + vLoc;
  vec3 outc = vCol.rgb * light * mix( 0.72, 1.12, tx.g ) * a + emit;
  #ifdef USE_FOG
    ${FOG_FACTOR}
    outc = mix( outc, fogColor * a, fogF );
  #endif
  vec4 at = dvAtmos( cameraPosition, vWP, 0.0 );
  outc = outc * at.a + at.rgb * a;
  gl_FragColor = vec4( outc, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPARK_VS = /* glsl */`
uniform float uTime;
uniform float uAspect;
uniform float uPx;
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec4 aD;
varying vec3 vCol;
varying float vX;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aA.w;
  if ( age < 0.0 || age >= aB.w ) { ${DEAD_VERT} }
  float t = age / aB.w;
  float k = max( aD.y, 0.01 );
  vec3 g = vec3( 0.0, -9.81 * aD.x, 0.0 );
  float e = exp( -k * age );
  vec3 vt = g / k + ( aB.xyz - g / k ) * e;
  vec3 p = aA.xyz + g / k * age + ( aB.xyz - g / k ) * ( 1.0 - e ) / k;
  if ( p.y < 0.0 ) { p.y = -p.y * aD.w; vt.y = abs( vt.y ) * aD.w; }
  vec3 tail = p - vt * aD.z;
  vec4 mh = modelViewMatrix * vec4( p, 1.0 );
  vec4 mt = modelViewMatrix * vec4( tail, 1.0 );
  if ( mh.z > -0.05 || mt.z > -0.05 ) { ${DEAD_VERT} }
  vec4 ch = projectionMatrix * mh;
  vec4 ct = projectionMatrix * mt;
  vec2 asp = vec2( uAspect, 1.0 );
  vec2 d = ( ch.xy / ch.w - ct.xy / ct.w ) * asp;
  float len = length( d );
  d = len > 1e-6 ? d / len : vec2( 0.0, 1.0 );
  // a resting spark (slag on the ground) would collapse to zero length: keep it a round dot
  float minL = 2.0 * max( aC.w * projectionMatrix[ 1 ][ 1 ] / ch.w, uPx );
  if ( len < minL ) ct = vec4( ( ch.xy / ch.w - d / asp * minL ) * ct.w, ct.z, ct.w );
  vec2 nrm = vec2( -d.y, d.x ) / asp;
  float along = position.y + 0.5;
  vec4 c = mix( ch, ct, along );
  float hw = max( aC.w * projectionMatrix[ 1 ][ 1 ] / c.w, uPx );
  c.xy += nrm * ( position.x * 2.0 * hw * c.w );
  gl_Position = c;
  float heat = 1.0 - t;
  // negative colour = cool streak (electric arc, water): no fade toward ember orange
  vec3 base = aC.r < 0.0 ? -aC.rgb : mix( vec3( 1.0, 0.18, 0.03 ), aC.rgb, heat );
  vCol = base * heat * ( 1.0 - along * 0.75 );
  vX = position.x * 2.0;
  vec4 mvPosition = mix( mh, mt, along );
  #include <fog_vertex>
}`;

const SPARK_FS = /* glsl */`
varying vec3 vCol;
varying float vX;
#include <fog_pars_fragment>
void main() {
  vec3 c = vCol * ( 1.0 - vX * vX );
  #ifdef USE_FOG
    ${FOG_FACTOR}
    c *= 1.0 - fogF;
  #endif
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SCORCH_VS = /* glsl */`
uniform float uTime;
attribute vec4 aA;
attribute vec4 aB;
varying vec2 vUv;
varying float vAge;
#include <fog_pars_vertex>
void main() {
  float c = cos( aB.y );
  float s = sin( aB.y );
  vec2 q = vec2( c * position.x - s * position.z, s * position.x + c * position.z ) * aB.x;
  vec4 mvPosition = modelViewMatrix * vec4( aA.x + q.x, aA.y, aA.z + q.y, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  vUv = position.xz * 0.5 + 0.5;
  vAge = uTime - aA.w;
  #include <fog_vertex>
}`;

const SCORCH_FS = /* glsl */`
uniform sampler2D uTex;
varying vec2 vUv;
varying float vAge;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D( uTex, vUv );
  float fin = clamp( vAge * 6.0, 0.0, 1.0 );
  float a = t.r * 0.88 * fin;
  vec3 col = vec3( 0.018, 0.016, 0.014 ) * a + vec3( 1.0, 0.28, 0.05 ) * ( t.g * 5.0 * exp( -vAge * 0.6 ) * fin );
  #ifdef USE_FOG
    ${FOG_FACTOR}
    col = mix( col, fogColor * a, fogF );
  #endif
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RING_VS = /* glsl */`
uniform float uTime;
attribute vec4 aA;
attribute vec4 aB;
varying vec2 vQ;
varying float vT;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aA.w;
  if ( age < 0.0 || age >= aB.y ) { ${DEAD_VERT} }
  vT = age / aB.y;
  vQ = position.xz;
  vec4 mvPosition = modelViewMatrix * vec4( aA.xyz + position * aB.x, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const RING_FS = /* glsl */`
uniform vec3 uLight;
varying vec2 vQ;
varying float vT;
#include <fog_pars_fragment>
void main() {
  float r = length( vQ );
  if ( r >= 1.0 ) discard;
  float it = 1.0 - vT;
  float ringR = 1.0 - it * it * it;
  float q = ( r - ringR ) / ( 0.05 + 0.12 * vT );
  float band = exp( -q * q );
  float a = band * pow( it, 1.5 ) * 0.5;
  vec3 col = uLight * a + vec3( 1.0, 0.55, 0.25 ) * band * 3.0 * pow( it, 8.0 );
  #ifdef USE_FOG
    ${FOG_FACTOR}
    col = mix( col, fogColor * a, fogF );
  #endif
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- GPU ring buffers ---------------- */

class Ring {
  readonly cap: number;
  readonly geo = new THREE.InstancedBufferGeometry();
  readonly arrs: Float32Array[] = [];
  readonly attrs: THREE.InstancedBufferAttribute[] = [];
  readonly death: Float32Array;
  head = 0;
  private lo: number;
  private hi = 0;
  constructor(cap: number, names: string[], flat: boolean) {
    this.cap = cap;
    this.lo = cap;
    this.death = new Float32Array(cap);
    const p = flat ? [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1] : [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    this.geo.setIndex(flat ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    for (const name of names) {
      const a = new Float32Array(cap * 4);
      const at = new THREE.InstancedBufferAttribute(a, 4);
      at.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, at);
      this.arrs.push(a);
      this.attrs.push(at);
    }
    this.geo.instanceCount = cap;
    this.reset();
  }
  /** claims the next slot and returns its float offset */
  next(death: number): number {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    if (i < this.lo) this.lo = i;
    if (i + 1 > this.hi) this.hi = i + 1;
    this.death[i] = death;
    return i * 4;
  }
  /** like next, but skips live slots near the head so long-lived puffs are not recycled mid-life */
  nextFree(now: number, death: number): number {
    for (let n = 0; n < 96; n++) {
      if (this.death[this.head] <= now) break;
      this.head = (this.head + 1) % this.cap;
    }
    return this.next(death);
  }
  alive(now: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.death[i] > now) n++;
    return n;
  }
  flush(): void {
    if (this.hi <= this.lo) return;
    for (const at of this.attrs) pendRange(at, this.lo * 4, (this.hi - this.lo) * 4);
    this.lo = this.cap;
    this.hi = 0;
  }
  reset(): void {
    for (const a of this.arrs) a.fill(0);
    const a0 = this.arrs[0], a1 = this.arrs[1];
    for (let i = 0; i < this.cap; i++) { a0[i * 4 + 3] = DEAD; a1[i * 4 + 3] = 1; }
    this.death.fill(0);
    this.head = 0;
    this.lo = 0;
    this.hi = this.cap;
  }
}

function fxMaterial(uniforms: Record<string, THREE.IUniform>, vs: string, fs: string, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // own uniforms are attached by reference (merge would deep-clone the light arrays and textures)
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uniforms),
    vertexShader: vs,
    fragmentShader: fs,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
  });
}

/* ---------------- CPU chips ---------------- */

const CS = 17; // px py pz vx vy vz qx qy qz qw wx wy wz scale age life floor

/* the height of whatever lies under a point (set by the structure layer; a render query, it changes nothing) */
let floorAt: (x: number, y: number, z: number) => number = () => 0;
export function setFxFloor(f: (x: number, y: number, z: number) => number): void { floorAt = f; }

class Chips {
  readonly mesh: THREE.InstancedMesh;
  readonly cap: number;
  n = 0;
  private readonly s: Float32Array;
  private readonly settled: Uint8Array;
  private readonly col: Float32Array;
  private readonly rest: number;
  private colorDirty = false;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, rest: number) {
    this.cap = cap;
    this.rest = rest;
    this.s = new Float32Array(cap * CS);
    this.settled = new Uint8Array(cap);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.col = new Float32Array(cap * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.col, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number, life: number, c: THREE.Color, floor = 0): void {
    const i = this.n < this.cap ? this.n++ : Math.floor(rng() * this.cap);
    const s = this.s, o = i * CS;
    s[o] = x; s[o + 1] = y; s[o + 2] = z;
    s[o + 3] = vx; s[o + 4] = vy; s[o + 5] = vz;
    let qx = rng() - 0.5, qy = rng() - 0.5, qz = rng() - 0.5, qw = rng() - 0.5;
    const ql = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
    qx *= ql; qy *= ql; qz *= ql; qw *= ql;
    s[o + 6] = qx; s[o + 7] = qy; s[o + 8] = qz; s[o + 9] = qw;
    s[o + 10] = rf(-14, 14); s[o + 11] = rf(-14, 14); s[o + 12] = rf(-14, 14);
    s[o + 13] = scale; s[o + 14] = 0; s[o + 15] = life; s[o + 16] = floor;
    this.settled[i] = 0;
    const k = rf(0.85, 1.12);
    this.col[i * 3] = c.r * k; this.col[i * 3 + 1] = c.g * k; this.col[i * 3 + 2] = c.b * k;
    this.colorDirty = true;
  }
  load(): number { return this.n / this.cap; }
  clear(): void { this.n = 0; this.mesh.count = 0; }
  update(dt: number): void {
    const s = this.s, m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < this.n;) {
      const o = i * CS;
      const age = s[o + 14] + dt, life = s[o + 15];
      if (age >= life) { this.kill(i); continue; }
      s[o + 14] = age;
      const sc = s[o + 13];
      if (!this.settled[i]) {
        const damp = 1 - 0.35 * dt;
        let vx = s[o + 3] * damp, vy = (s[o + 4] - 9.81 * dt) * damp, vz = s[o + 5] * damp;
        let px = s[o] + vx * dt, py = s[o + 1] + vy * dt, pz = s[o + 2] + vz * dt;
        let wx = s[o + 10], wy = s[o + 11], wz = s[o + 12];
        const floor = s[o + 16] + sc * this.rest;
        if (py < floor) {
          py = floor;
          if (vy < 0) {
            vy = -vy * 0.3; vx *= 0.55; vz *= 0.55; wx *= 0.5; wy *= 0.5; wz *= 0.5;
            if (vy < 0.6 && vx * vx + vz * vz < 0.2) { this.settled[i] = 1; vx = vy = vz = 0; }
          }
        }
        let qx = s[o + 6], qy = s[o + 7], qz = s[o + 8], qw = s[o + 9];
        const h = 0.5 * dt;
        const nx = qx + h * (wx * qw + wy * qz - wz * qy);
        const ny = qy + h * (wy * qw + wz * qx - wx * qz);
        const nzq = qz + h * (wz * qw + wx * qy - wy * qx);
        const nw = qw - h * (wx * qx + wy * qy + wz * qz);
        const ql = 1 / Math.hypot(nx, ny, nzq, nw);
        qx = nx * ql; qy = ny * ql; qz = nzq * ql; qw = nw * ql;
        s[o] = px; s[o + 1] = py; s[o + 2] = pz;
        s[o + 3] = vx; s[o + 4] = vy; s[o + 5] = vz;
        s[o + 6] = qx; s[o + 7] = qy; s[o + 8] = qz; s[o + 9] = qw;
        s[o + 10] = wx; s[o + 11] = wy; s[o + 12] = wz;
      }
      const k = sc * Math.min(1, (life - age) / 1.2);
      const qx = s[o + 6], qy = s[o + 7], qz = s[o + 8], qw = s[o + 9];
      const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
      const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
      const wx2 = qw * x2, wy2 = qw * y2, wz2 = qw * z2, mo = i * 16;
      m[mo] = (1 - (yy + zz)) * k; m[mo + 1] = (xy + wz2) * k; m[mo + 2] = (xz - wy2) * k; m[mo + 3] = 0;
      m[mo + 4] = (xy - wz2) * k; m[mo + 5] = (1 - (xx + zz)) * k; m[mo + 6] = (yz + wx2) * k; m[mo + 7] = 0;
      m[mo + 8] = (xz + wy2) * k; m[mo + 9] = (yz - wx2) * k; m[mo + 10] = (1 - (xx + yy)) * k; m[mo + 11] = 0;
      m[mo + 12] = s[o]; m[mo + 13] = s[o + 1]; m[mo + 14] = s[o + 2]; m[mo + 15] = 1;
      i++;
    }
    const im = this.mesh.instanceMatrix;
    this.mesh.count = this.n;
    if (this.n > 0) {
      pendRange(im, 0, this.n * 16);
    }
    if (this.colorDirty && this.n > 0 && this.mesh.instanceColor) {
      const ic = this.mesh.instanceColor;
      pendRange(ic, 0, this.n * 3);
    }
    this.colorDirty = false;
  }
  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) {
      this.s.copyWithin(i * CS, last * CS, last * CS + CS);
      this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.settled[i] = this.settled[last];
      this.colorDirty = true;
    }
  }
}

function chipGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position as THREE.BufferAttribute, r = makeRng(9);
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 0.65 + r() * 0.5; seen.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function splinterGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 0.1, 0.16, 2, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = Math.abs(p.getX(i)) > 0.4 ? 0.25 : 1;
    p.setY(i, p.getY(i) * t);
    p.setZ(i, p.getZ(i) * t);
  }
  return g.toNonIndexed();
}

function shardGeometry(): THREE.BufferGeometry {
  const a = [0.75, 0, 0], b = [-0.35, 0, 0.2], c = [-0.3, 0, -0.16], t = 0.025;
  const v: number[] = [];
  const tri = (p: number[], q: number[], r: number[]): void => { v.push(...p, ...q, ...r); };
  const up = (p: number[]): number[] => [p[0], t, p[2]];
  const dn = (p: number[]): number[] => [p[0], -t, p[2]];
  tri(up(a), up(c), up(b));
  tri(dn(a), dn(b), dn(c));
  for (const [p, q] of [[a, b], [b, c], [c, a]]) { tri(up(p), up(q), dn(q)); tri(up(p), dn(q), dn(p)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/* ---------------- module state ---------------- */

let ready = false;
let root: THREE.Group;
let cam: THREE.Camera;
let clock = 0;
let litVersion = -1;
let puffLoad = 0;

let puffs: Ring, dustR: Ring, sparksR: Ring, scorches: Ring, rings: Ring;
let dustAlive = 0;
let puffU: Record<string, THREE.IUniform>, sparkU: Record<string, THREE.IUniform>, scorchU: Record<string, THREE.IUniform>, ringU: Record<string, THREE.IUniform>;
let chips: Chips, splinterChips: Chips, shardChips: Chips, diceChips: Chips, fineChips: Chips;

interface Flash { light: THREE.PointLight; t: number; dur: number; peak: number; prio: number; owner: number }
const flashes: Flash[] = [];
const lightPos = Array.from({ length: NL }, () => new THREE.Vector3(0, -1e4, 0));
const lightCol = Array.from({ length: NL }, () => new THREE.Vector3());
const spotPos = Array.from({ length: 4 }, () => new THREE.Vector3(0, -1e4, 0));
const spotDir = Array.from({ length: 4 }, () => new THREE.Vector4(0, -1, 0, 2));
const spotCol = Array.from({ length: 4 }, () => new THREE.Vector3());
const wind = new THREE.Vector3(0.55, 0, 0.25);

/** heat scales the flame emission: fx.fire runs hot (1), firebomb patches stay orange (0.5) */
interface Emitter { on: boolean; x: number; y: number; z: number; start: number; end: number; size: number; heat: number; a: number; b: number; c: number }
const mkEm = (): Emitter => ({ on: false, x: 0, y: 0, z: 0, start: 0, end: 0, size: 1, heat: 1, a: 0, b: 0, c: 0 });
const fires: Emitter[] = Array.from({ length: FIRES }, mkEm);
const beacons: Emitter[] = Array.from({ length: BEACONS }, mkEm);
/** lingering transformer arcing after fx.arcFlash; size = radius */
const arcs: Emitter[] = Array.from({ length: ARCS }, mkEm);
/** brightness for additive water droplets so they do not glow at night */
let dropK = 0.6;

const _c = new THREE.Color();
const _v = new THREE.Vector3(), _lp = new THREE.Vector3();
const _cd = new THREE.Vector3(), _cu = new THREE.Vector3(), _cw = new THREE.Vector3(), _bd = new THREE.Vector3();

/* ---------------- spawn templates (mutated in place, never allocated) ---------------- */

const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 2, rot: 0, spin: 0, r: 0.5, g: 0.5, b: 0.5, a: 0.5, heat: 0, heatDur: 0, rise: 0, drag: 1, variant: 0, wind: 1, accel: 0, fadeIn: 0.1, delay: 0, curl: 0, stretch: 0, grow: 0 };
function pAt(x: number, y: number, z: number): void {
  P.x = x; P.y = y; P.z = z; P.vx = P.vy = P.vz = 0;
  P.life = 1; P.s0 = 1; P.s1 = 2; P.rot = rf(0, 6.283); P.spin = rf(-0.6, 0.6);
  P.a = 0.5; P.heat = 0; P.heatDur = 0; P.rise = 0; P.drag = 1;
  P.variant = Math.floor(rng() * 3); P.wind = 1; P.accel = 0; P.fadeIn = 0.1; P.delay = 0; P.curl = 0; P.stretch = 0; P.grow = 0;
}
function pColor(hex: number, k = 1): void {
  _c.setHex(hex);
  P.r = _c.r * k; P.g = _c.g * k; P.b = _c.b * k;
}
function emit(ring?: Ring): void {
  if (!ready) return;
  const born = clock + P.delay, r = ring ?? puffs;
  const o = r === puffs ? r.next(born + P.life) : r.nextFree(clock, born + P.life), a = r.arrs;
  if (r === puffs) puffLoad += 1 / PUFFS;
  a[0][o] = P.x; a[0][o + 1] = P.y; a[0][o + 2] = P.z; a[0][o + 3] = born;
  a[1][o] = P.vx; a[1][o + 1] = P.vy; a[1][o + 2] = P.vz; a[1][o + 3] = P.life;
  a[2][o] = P.s0; a[2][o + 1] = P.s1; a[2][o + 2] = P.rot; a[2][o + 3] = P.spin;
  a[3][o] = P.r; a[3][o + 1] = P.g; a[3][o + 2] = P.b; a[3][o + 3] = P.a;
  a[4][o] = P.heat; a[4][o + 1] = P.heatDur; a[4][o + 2] = P.rise; a[4][o + 3] = P.drag;
  a[5][o] = P.variant; a[5][o + 1] = P.wind; a[5][o + 2] = P.accel; a[5][o + 3] = P.fadeIn;
  a[6][o] = P.curl; a[6][o + 1] = P.stretch; a[6][o + 2] = P.grow; a[6][o + 3] = 0;
}

const S = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, r: 1, g: 0.7, b: 0.3, w: 0.012, grav: 1, drag: 1, streak: 0.03, bounce: 0.3, delay: 0 };
/** S.delay applies to this spark only */
function spark(): void {
  if (!ready) return;
  const born = clock + S.delay;
  S.delay = 0;
  const o = sparksR.next(born + S.life), a = sparksR.arrs;
  a[0][o] = S.x; a[0][o + 1] = S.y; a[0][o + 2] = S.z; a[0][o + 3] = born;
  a[1][o] = S.vx; a[1][o + 1] = S.vy; a[1][o + 2] = S.vz; a[1][o + 3] = S.life;
  a[2][o] = S.r; a[2][o + 1] = S.g; a[2][o + 2] = S.b; a[2][o + 3] = S.w;
  a[3][o] = S.grav; a[3][o + 1] = S.drag; a[3][o + 2] = S.streak; a[3][o + 3] = S.bounce;
}

/** random unit vector into _v, optionally pushed toward (nx,ny,nz) */
function dirAround(nx: number, ny: number, nz: number, spread: number): void {
  random.vec3(_dir, rng);
  _v.set(nx + _dir[0] * spread, ny + _dir[1] * spread, nz + _dir[2] * spread);
  if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0);
  _v.normalize();
}
const _dir: [number, number, number] = [0, 1, 0];

function claim(list: Emitter[]): Emitter {
  let e = list[0];
  for (const f of list) {
    if (!f.on) return f;
    if (f.end < e.end) e = f;
  }
  return e;
}

function budget(): number { return puffLoad < 0.5 ? 1 : Math.max(0.2, 1 - (puffLoad - 0.5) * 1.6); }

/* ---------------- lights ---------------- */

/** merge > 0 re-triggers a live light of the same priority within that many metres (repeating sources) */
function flash(x: number, y: number, z: number, hex: number, peak: number, dur: number, range: number, prio: number, merge = 0): void {
  let best: Flash | null = null;
  if (merge > 0) {
    _lp.set(x, y, z);
    for (const f of flashes) if (f.prio === prio && f.light.position.distanceToSquared(_lp) < merge * merge) { best = f; break; }
  }
  if (!best) for (const f of flashes) {
    if (f.prio === 0) { best = f; break; }
    if (f.prio <= prio && (!best || f.peak * (1 - f.t / f.dur) < best.peak * (1 - best.t / best.dur))) best = f;
  }
  if (!best) return;
  best.light.position.set(x, y, z);
  best.light.color.setHex(hex);
  best.light.distance = range;
  best.t = 0; best.dur = dur; best.peak = peak * comfort.flash; best.prio = prio; best.owner = -1;
}

function updateLights(dt: number): void {
  for (const f of flashes) {
    if (f.prio > 0) {
      f.t += dt;
      if (f.t >= f.dur) { f.prio = 0; f.light.intensity = 0; }
      else { const k = 1 - f.t / f.dur; f.light.intensity = f.peak * k * k * rf(0.85, 1.05); }
    }
  }
  // idle lights follow burning fires and beacons, keeping their owner while it lives
  const emitters = FIRES + BEACONS;
  for (const f of flashes) {
    if (f.prio > 0) continue;
    const e = f.owner >= 0 ? (f.owner < FIRES ? fires[f.owner] : beacons[f.owner - FIRES]) : null;
    if (!e || !e.on) f.owner = -1;
  }
  for (let idx = 0; idx < emitters; idx++) {
    const e = idx < FIRES ? fires[idx] : beacons[idx - FIRES];
    if (!e.on) continue;
    let has = false;
    for (const f of flashes) if (f.prio === 0 && f.owner === idx) has = true;
    if (has) continue;
    for (const f of flashes) if (f.prio === 0 && f.owner < 0) { f.owner = idx; break; }
  }
  for (const f of flashes) {
    if (f.prio > 0) continue;
    if (f.owner < 0) { f.light.intensity = 0; continue; }
    const beacon = f.owner >= FIRES, e = beacon ? beacons[f.owner - FIRES] : fires[f.owner];
    const fade = Math.min(1, (e.end - clock) / 1.5, (clock - e.start) / 0.3);
    const flick = 0.75 + 0.25 * Math.sin(clock * 17 + f.owner) * Math.sin(clock * 7.3 + f.owner * 2.1) + rf(-0.08, 0.08);
    f.light.position.set(e.x, e.y + (beacon ? 0.4 : e.size * 0.7), e.z);
    f.light.color.setHex(beacon ? 0xff2412 : 0xff7a2e);
    f.light.distance = beacon ? 9 : 10 + e.size * 6;
    f.light.intensity = Math.max(0, (beacon ? 10 : 22 * e.size) * fade * flick);
  }
  flashAtCamera.setRGB(0, 0, 0);
  for (let i = 0; i < flashes.length; i++) {
    const l = flashes[i].light;
    lightPos[i].copy(l.position);
    const k = l.intensity * 0.02;
    lightCol[i].set(l.color.r * k, l.color.g * k, l.color.b * k);
    roomU.uDvFlashP.value[i].copy(l.position);
    // the rooms take the detonation's own brief pulse, not the fireball's half-second glow
    const fl = flashes[i], pulse = fl.prio > 0 ? Math.pow(Math.max(0, 1 - fl.t / Math.min(fl.dur, 0.25)), 2) : 0.4;
    roomU.uDvFlashC.value[i].copy(lightCol[i]).multiplyScalar(6 * pulse);
    if (l.intensity > 0) {
      const d2 = l.position.distanceToSquared(cam.position);
      const w = (l.intensity * 0.12) / (d2 + 1);
      flashAtCamera.r += l.color.r * w; flashAtCamera.g += l.color.g * w; flashAtCamera.b += l.color.b * w;
    }
  }
  // lamps and floodlights light the dust too: that is what makes halos and beams at night
  for (let i = 0; i < NL - 3; i++) {
    const l = lampPool[i], j = i + 3;
    if (!l || l.intensity <= 0) { lightCol[j].set(0, 0, 0); continue; }
    lightPos[j].copy(l.position);
    const k = l.intensity * 0.02;
    lightCol[j].set(l.color.r * k, l.color.g * k, l.color.b * k);
  }
  const fl = floodlights();
  for (let i = 0; i < 4; i++) {
    const sp = fl[i];
    if (!sp || sp.intensity <= 0) { spotCol[i].set(0, 0, 0); continue; }
    spotPos[i].copy(sp.position);
    _v.subVectors(sp.target.position, sp.position).normalize();
    spotDir[i].set(_v.x, _v.y, _v.z, Math.cos(sp.angle));
    const k = sp.intensity * 0.03;
    spotCol[i].set(sp.color.r * k, sp.color.g * k, sp.color.b * k);
  }
}

/* ---------------- environment ---------------- */

function applyLighting(): void {
  litVersion = lighting.version;
  const sd = lighting.sunDir, sc = lighting.sunColor, k = lighting.sunIntensity / Math.PI;
  (puffU.uSunDir.value as THREE.Vector3).copy(sd);
  (puffU.uSunCol.value as THREE.Color).setRGB(sc.r * k, sc.g * k, sc.b * k);
  (puffU.uAmbTop.value as THREE.Color).copy(lighting.ambTop);
  (puffU.uAmbBot.value as THREE.Color).copy(lighting.ambBot);
  const ring = ringU.uLight.value as THREE.Color;
  ring.copy(lighting.ambTop).multiplyScalar(0.8);
  ring.r += sc.r * k * 0.8; ring.g += sc.g * k * 0.8; ring.b += sc.b * k * 0.8;
  ring.multiply(_c.setHex(0xd8cbb4));
  const at = lighting.ambTop;
  dropK = clamp(0.3 * (at.r + at.g + at.b) + 0.25 * k * Math.max(sd.y, 0), 0.08, 1.2);
}

/** unit direction into _cd (falls back to +Y) */
function unitDir(d: Vec3): void {
  _cd.set(d[0], d[1], d[2]);
  if (_cd.lengthSq() < 1e-8) _cd.set(0, 1, 0);
  _cd.normalize();
}

/* A jagged electric bolt: a random walk of cool streak sparks, each spanning one segment (streak = 1 s at
   segment-length speed, so the short-lived streak covers the segment and only crawls a few percent). */
function bolt(x: number, y: number, z: number, len: number, segs: number, delay: number, w: number): void {
  dirAround(0, -0.2, 0, 1);
  _bd.copy(_v);
  const step = len / segs;
  let px = x, py = y, pz = z;
  for (let i = 0; i < segs; i++) {
    dirAround(_bd.x, _bd.y, _bd.z, 1.1);
    const qx = px + _v.x * step, qy = py + _v.y * step, qz = pz + _v.z * step;
    S.x = qx; S.y = qy; S.z = qz; S.vx = qx - px; S.vy = qy - py; S.vz = qz - pz;
    S.life = rf(0.06, 0.11); S.r = -3.2; S.g = -4.2; S.b = -8; S.w = w * rf(0.7, 1.2);
    S.grav = 0; S.drag = 0.01; S.streak = 1; S.bounce = 0; S.delay = delay;
    spark();
    if (i === 1 && rng() < 0.6) {
      dirAround(_v.x, _v.y, _v.z, 1.4);
      const bl = step * rf(0.6, 1.2);
      S.x = qx + _v.x * bl; S.y = qy + _v.y * bl; S.z = qz + _v.z * bl; S.vx = _v.x * bl; S.vy = _v.y * bl; S.vz = _v.z * bl;
      S.life = rf(0.05, 0.09); S.r = -2.4; S.g = -3.2; S.b = -6.5; S.w = w * 0.6;
      S.grav = 0; S.drag = 0.01; S.streak = 1; S.bounce = 0; S.delay = delay;
      spark();
    }
    px = qx; py = qy; pz = qz;
  }
}

function arcGlow(x: number, y: number, z: number, size: number, heat: number, life: number): void {
  pAt(x, y, z); P.variant = 3; P.life = life; P.s0 = size; P.s1 = size * 0.7; P.a = 0;
  pColor(0xb8d4ff); P.heat = -heat; P.heatDur = life; P.drag = 0; P.fadeIn = 0; P.spin = 0;
  emit();
}

/* ---------------- demolition dust clouds ----------------
   Every fx.dust / powder / blast feeds "dust volume" into the nearest cloud (or starts one). A cloud
   owes a number of big billow puffs that grows with its accumulated volume, and pays them out over a
   few seconds into their own ring: part roll out along the ground as a gravity current, part rise as a
   column, all driven by one shared swirl field. The cloud ellipsoid shadows the sun for its own puffs
   and for lit surfaces, fogs the camera when it stands inside, and settles dust onto the coverage map. */

interface Cloud {
  on: boolean; x: number; y: number; z: number;
  mass: number; owed: number; paid: number; acc: number;
  r: number; g: number; b: number;
  start: number; last: number; dep: number;
}
const clouds: Cloud[] = Array.from({ length: CLOUDS }, () => ({ on: false, x: 0, y: 0, z: 0, mass: 0, owed: 0, paid: 0, acc: 0, r: 0, g: 0, b: 0, start: 0, last: 0, dep: 0 }));
/** live billow cap, puffs/s ceiling, and how many puffs deep a big cloud is (the fill-rate knob) */
const DUSTQ = {
  low: { cap: 300, rate: 50, layers: 3.5 },
  medium: { cap: 700, rate: 110, layers: 5 },
  high: { cap: DUSTS, rate: 200, layers: 8 },
};
let dustRate = 0;
let coverClock = 0;
const _cc = new THREE.Color(), _cg = new THREE.Color(0xc0b09a);

const cbrt = Math.cbrt;
const cloudLife = (c: Cloud): number => clamp(18 + cbrt(c.mass) * 5, 18, 60);
// a high-rise's cloud spreads well past a terrace's: the caps are where a tower's worth of fines is still dense
const baseRadius = (m: number): number => clamp(2.5 + cbrt(m) * 2.4, 3, 70);
const billowSize = (m: number): number => clamp(1.4 + cbrt(m) * 0.75, 1.6, 14);
function cloudRadius(c: Cloud): number {
  // born the size of the debris throw, it rolls out as a density current and spreads for tens of seconds
  const t = clock - c.start;
  return baseRadius(c.mass) * (0.4 + 0.6 * Math.min(1, t / 10) + 0.35 * Math.min(1, t / 40));
}
const SQUASH = 1.7;
const _mortar = new THREE.Color(0xbdb6a8);

/** dust fed into clouds since load (m³-ish), and the share of it that was dark blast smoke (harness readout) */
export const dustLedger = { fed: 0, smoke: 0, box: null as null | [number, number, number, number] };

/** feed dust volume (m³-ish) into the nearest cloud */
/* Callers feed by the size of the event that raised it; the cloud that hangs over a collapse is the fine fraction of
   that, and a two-storey terrace coming down should raise one some 20–30 m across its base, not a whole-map fog. */
const CLOUD_SHARE = 0.15;
/** overall dust amount (owner's taste: 40 % less than the physically scaled figure read as too much on screen) */
const DUST_AMOUNT = 0.6;
/** the dust amount in play: the owner's figure times the player's Settings choice (1 = as the owner set it) */
const dustK = (): number => DUST_AMOUNT * comfort.dust;
/* A cloud is drawn as many thin, large, overlapping billows rather than a few dense ones: the same total opacity, but
   the billows merge into one rolling mass instead of reading as separate puffs. */
const BILLOW_DEPTH = 1.8, BILLOW_ALPHA = 0.62;
function feedCloud(x: number, y: number, z: number, vol: number, hex: number): void {
  vol *= CLOUD_SHARE;
  if (!ready || !(vol > 0)) return;
  const lb = dustLedger.box;
  if (!lb || (x > lb[0] && x < lb[1] && z > lb[2] && z < lb[3])) dustLedger.fed += vol;
  let best: Cloud | null = null, bd = Infinity;
  for (const c of clouds) {
    if (!c.on) continue;
    const R = cloudRadius(c), lim = 6 + R * 0.8, dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
    if (d2 < lim * lim && Math.abs(y - c.y) < 12 + R && d2 < bd) { best = c; bd = d2; }
  }
  _cc.setHex(hex);
  if (!best) {
    if (vol < 0.05) return;
    let slot = clouds[0];
    for (const c of clouds) {
      if (!c.on) { slot = c; break; }
      if (c.mass * (1 - (clock - c.last) / cloudLife(c)) < slot.mass * (1 - (clock - slot.last) / cloudLife(slot))) slot = c;
    }
    best = slot;
    best.on = true; best.x = x; best.y = y; best.z = z; best.mass = 0; best.owed = 0; best.paid = 0; best.acc = 3;
    best.r = _cc.r; best.g = _cc.g; best.b = _cc.b; best.start = clock; best.dep = 0;
  }
  const c = best, m = c.mass + vol, w = vol / m;
  c.x += (x - c.x) * w; c.z += (z - c.z) * w; c.y += (y - c.y) * w;
  c.r += (_cc.r - c.r) * w; c.g += (_cc.g - c.g) * w; c.b += (_cc.b - c.b) * w;
  c.mass = m;
  c.last = clock;
  const q = DUSTQ[view.quality];
  // enough final-size billows to cover the cloud's silhouette `layers` deep, fewer for small clouds
  const cover = baseRadius(m) / (billowSize(m) * 0.95), layers = q.layers * clamp(cbrt(m) / 6, 0.3, 1) * (1 + clamp((cbrt(m) - 8) / 8, 0, 0.8));
  c.owed = m < 2.5 ? 0 : Math.min(Math.floor(q.cap * 0.5), Math.floor(layers * 1.3 * cover * cover * dustK() * BILLOW_DEPTH));
}

function spawnBillow(c: Cloud, R: number, life: number): void {
  const ps = billowSize(c.mass);
  const grounded = c.y < Math.max(R * 1.2, 30);
  let a = rf(0.5, 0.68);
  if (grounded && rng() < 0.6) {
    // the density current: a low bank that rolls out along the ground and swallows what it reaches; the leading
    // billows are the thickest and lowest, the ones behind ride up over them
    const ang = rf(0, 6.283), ca = Math.cos(ang), sa = Math.sin(ang), r0 = R * rf(0, 0.35), front = rng(), sp = R * (0.3 + 0.5 * front) * (1 + 1.2 * clamp((R - 25) / 40, 0, 1) * front);
    pAt(c.x + ca * r0, ps * (0.12 + 0.35 * (1 - front) * rng()), c.z + sa * r0);
    P.vx = ca * sp; P.vy = rf(0.1, 0.4); P.vz = sa * sp; P.drag = 0.5;
    P.rise = rf(0.03, 0.2) * (1.2 - front); P.s0 = ps * rf(0.75, 1.05); P.s1 = ps * rf(1.8, 2.7);
    P.stretch = rf(0.3, 0.75);
    a *= 0.85 + 0.3 * front;
  } else {
    const ang = rf(0, 6.283), r0 = R * 0.35 * Math.sqrt(rng());
    pAt(c.x + Math.cos(ang) * r0, Math.max(ps * 0.4, c.y * rf(0.3, 1) + rf(0, R * 0.5)), c.z + Math.sin(ang) * r0);
    P.vx = rf(-0.6, 0.6); P.vy = rf(3, 10); P.vz = rf(-0.6, 0.6); P.drag = 0.4;
    P.rise = rf(0.4, 1.1) * (1 + clamp(R / 18, 0, 3.2)); P.accel = -0.004; P.s0 = ps * rf(0.75, 1.05); P.s1 = ps * rf(1.9, 3.0);
  }
  const k = rf(0.86, 1.08);
  _cc.setRGB(c.r, c.g, c.b).lerp(_cg, 0.6);
  P.r = _cc.r * k; P.g = _cc.g * k; P.b = _cc.b * k;
  P.life = life * rf(0.55, 1); P.a = a * BILLOW_ALPHA; P.fadeIn = rf(0.15, 0.45); P.grow = rf(1.5, 3.5);
  P.wind = rf(0.8, 1.1); P.spin = rf(-0.12, 0.12); P.curl = rf(0.35, 0.6);
  emit(dustR);
  dustAlive++;
}

/** settle dust onto the world coverage map (up-facing surfaces sample it) */
function splatCover(x: number, z: number, rad: number, amt: number, cr: number, cg: number, cb: number): void {
  const N = COVER_N, ppm = N / COVER_EXTENT, cx = (x / COVER_EXTENT + 0.5) * N, cz = (z / COVER_EXTENT + 0.5) * N, r = rad * ppm;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N - 1, Math.ceil(cz + r));
  if (x0 > x1 || z0 > z1) return;
  const d = coverage.data, R = cr * 255, G = cg * 255, B = cb * 255;
  for (let j = z0; j <= z1; j++) {
    for (let i = x0; i <= x1; i++) {
      const dx = (i + 0.5 - cx) / r, dz = (j + 0.5 - cz) / r, q = dx * dx + dz * dz;
      if (q >= 1) continue;
      const f = amt * (1 - q) * (1 - q), o = (j * N + i) * 4, a = d[o + 3] / 255, na = a + f * (1 - a);
      const w = f / Math.max(na, 0.05);
      d[o] += (R - d[o]) * w; d[o + 1] += (G - d[o + 1]) * w; d[o + 2] += (B - d[o + 2]) * w;
      d[o + 3] = Math.min(255, Math.round(na * 255));
    }
  }
  coverage.dirty = true;
}

/** optical depth of the cloud ellipsoids along a ray, CPU twin of dvCloudOD */
function cloudOD(px: number, py: number, pz: number, dx: number, dy: number, dz: number): number {
  const cl = dustU.uDvCloud.value, cp = dustU.uDvCloudP.value;
  let od = 0;
  for (let i = 0; i < CLOUDS; i++) {
    const k = cp[i];
    if (k.x <= 0) continue;
    const c = cl[i], ox = px - c.x, oy = (py - c.y) * k.y, oz = pz - c.z, ey = dy * k.y;
    const a = dx * dx + ey * ey + dz * dz, b = ox * dx + oy * ey + oz * dz, oo = ox * ox + oy * oy + oz * oz, r2 = c.w * c.w;
    let h = b * b - a * (oo - r2);
    if (h <= 0) continue;
    h = Math.sqrt(h);
    const t1 = (-b + h) / a;
    if (t1 <= 0) continue;
    const t0 = Math.max((-b - h) / a, 0), core = 1 - clamp((oo - (b * b) / a) / r2, 0, 1);
    od += k.x * (t1 - t0) * (0.35 + 0.65 * core);
  }
  return od;
}

function updateClouds(dt: number): void {
  const q = DUSTQ[view.quality];
  dustAlive = dustR.alive(clock);
  dustRate = Math.min(dustRate + q.rate * dt, q.rate * 0.1);
  const cl = dustU.uDvCloud.value, cp = dustU.uDvCloudP.value;
  const cam3 = cam.position;
  let fogK = 0, fogR = 0, fr = 0, fg = 0, fb = 0, n = 0;
  for (let i = 0; i < CLOUDS; i++) {
    const c = clouds[i];
    if (c.on && clock - c.last > cloudLife(c)) c.on = false;
    if (!c.on) { cp[i].set(0, 1, 0, 0); continue; }
    const life = cloudLife(c), age = clock - c.start, idle = clock - c.last, R = cloudRadius(c);
    c.x += wind.x * dt * 0.9; c.z += wind.z * dt * 0.9; c.y += 0.12 * dt;
    // pay out owed billows at a pace that makes the cloud boil up over a few seconds
    c.acc = Math.min(c.acc + Math.max(20, c.owed / 1.6) * dt, 40);
    while (c.acc >= 1 && c.paid < c.owed && dustRate >= 1 && dustAlive < q.cap) {
      spawnBillow(c, R, life);
      c.paid++; c.acc--; dustRate--;
    }
    const fade = (1 - THREE.MathUtils.smoothstep(idle / life, 0.45, 1)) * THREE.MathUtils.smoothstep(age, 0, 1.5);
    const ext = clamp(0.015 + cbrt(c.mass) * 0.006, 0.015, 0.08) * fade * dustK();
    const cy = Math.max(R * 0.3, c.y * 0.7);
    cl[i].set(c.x, cy, c.z, R);
    cp[i].set(ext, SQUASH, 0, 0);
    n++;
    c.dep += dt;
    if (c.dep > 0.5 && c.mass > 2) {
      c.dep = 0;
      // a film, not a white-out: most of what settles comes down in the first half minute
      splatCover(c.x, c.z, R * 1.15, clamp(0.005 * cbrt(c.mass), 0.003, 0.02) * fade * (age < 30 ? 1 : 0.3) * dustK(), c.r, c.g, c.b);
    }
    // camera inside this cloud: ellipsoid-normalised distance
    const ex = (cam3.x - c.x) / R, ey = ((cam3.y - cy) * SQUASH) / R, ez = (cam3.z - c.z) / R;
    const inside = 1 - THREE.MathUtils.smoothstep(Math.sqrt(ex * ex + ey * ey + ez * ez), 0.5, 1.05);
    if (inside > 0) {
      const w = ext * 4 * inside;
      fogK += w; fogR += R * w;
      fr += c.r * w; fg += c.g * w; fb += c.b * w;
    }
  }
  dustU.uDvCloudN.value = n;
  const df = atmosU.uDustFog.value;
  if (fogK > 1e-5) {
    const sd = lighting.sunDir, vis = Math.exp(-cloudOD(cam3.x, cam3.y, cam3.z, sd.x, sd.y, sd.z));
    const sk = (lighting.sunIntensity / Math.PI) * 0.55 * vis * Math.max(sd.y, 0.1), at = lighting.ambTop, sc = lighting.sunColor;
    const al = (at.r * 0.2126 + at.g * 0.7152 + at.b * 0.0722) * 0.9, tint = 0.3;
    df.set((fr / fogK) * (al + (at.r * 0.9 - al) * tint + sc.r * sk), (fg / fogK) * (al + (at.g * 0.9 - al) * tint + sc.g * sk), (fb / fogK) * (al + (at.b * 0.9 - al) * tint + sc.b * sk), fogK);
    atmosU.uDustFogR.value = Math.max(4, (fogR / fogK) * 1.2);
    atmosU.uAtmT.value = clock;
  } else df.set(0, 0, 0, 0);
  coverClock += dt;
  if (coverage.dirty && coverClock > 0.25) {
    coverClock = 0;
    coverage.dirty = false;
    coverage.tex.needsUpdate = true;
  }
}

/* ---------------- public ---------------- */

export function initFx(scene: THREE.Scene, camera: THREE.Camera): void {
  cam = camera;
  if (ready) {
    if (root.parent !== scene) scene.add(root);
    return;
  }
  root = new THREE.Group();
  root.name = 'fx';

  const PUFF_ATTRS = ['aA', 'aB', 'aC', 'aD', 'aE', 'aF', 'aG'];
  puffs = new Ring(PUFFS, PUFF_ATTRS, false);
  dustR = new Ring(DUSTS, PUFF_ATTRS, false);
  const puffMat = fxMaterial(Object.assign({
    uTime: { value: 0 }, uWind: { value: wind }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLPos: { value: lightPos }, uLCol: { value: lightCol }, uSPos: { value: spotPos }, uSDir: { value: spotDir }, uSCol: { value: spotCol },
    uTex: { value: smokeAtlas() }, uNoise: { value: noiseTex() }, uErode: { value: 1 },
    uSunCol: { value: new THREE.Color() }, uAmbTop: { value: new THREE.Color() }, uAmbBot: { value: new THREE.Color() },
  }, dustU, softU, atmosU), PUFF_VS, PUFF_FS, false);
  puffU = puffMat.uniforms;
  const puffMesh = new THREE.Mesh(puffs.geo, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 10;
  // the lingering clouds draw first so the short-lived smoke and fire of later events sit over them
  const dustMesh = new THREE.Mesh(dustR.geo, puffMat);
  dustMesh.frustumCulled = false;
  dustMesh.renderOrder = 8;

  sparksR = new Ring(SPARKS, ['aA', 'aB', 'aC', 'aD'], false);
  const sparkMat = fxMaterial({ uTime: { value: 0 }, uAspect: { value: 1 }, uPx: { value: 0.002 } }, SPARK_VS, SPARK_FS, true);
  sparkU = sparkMat.uniforms;
  const sparkMesh = new THREE.Mesh(sparksR.geo, sparkMat);
  sparkMesh.frustumCulled = false;
  sparkMesh.renderOrder = 11;

  scorches = new Ring(SCORCH, ['aA', 'aB'], true);
  const scorchMat = fxMaterial({ uTime: { value: 0 }, uTex: { value: scorchTex() } }, SCORCH_VS, SCORCH_FS, false);
  scorchMat.side = THREE.FrontSide;
  scorchMat.polygonOffset = true;
  scorchMat.polygonOffsetFactor = -2;
  scorchMat.polygonOffsetUnits = -4;
  scorchU = scorchMat.uniforms;
  const scorchMesh = new THREE.Mesh(scorches.geo, scorchMat);
  scorchMesh.frustumCulled = false;
  scorchMesh.renderOrder = 1;

  rings = new Ring(RINGS, ['aA', 'aB'], true);
  const ringMat = fxMaterial({ uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } }, RING_VS, RING_FS, false);
  ringU = ringMat.uniforms;
  const ringMesh = new THREE.Mesh(rings.geo, ringMat);
  ringMesh.frustumCulled = false;
  ringMesh.renderOrder = 9;

  chips = new Chips(chipGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true }), 1900, 0.3);
  splinterChips = new Chips(splinterGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true }), 650, 0.06);
  shardChips = new Chips(shardGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.07, metalness: 0.4, envMapIntensity: 2.4, flatShading: true }), 450, 0.03);
  diceChips = new Chips(new THREE.BoxGeometry(1, 0.8, 0.9), new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0.5, envMapIntensity: 2.6, flatShading: true }), 1000, 0.4);
  // crushed mortar, brick and stone grit that stays where rubble lands (render only: it costs the solver nothing)
  fineChips = new Chips(chipGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0, flatShading: true }), 7000, 0.25);
  fineChips.mesh.castShadow = false;

  for (let i = 0; i < 3; i++) {
    const light = new THREE.PointLight(0xffa050, 0, 20, 2);
    light.castShadow = false;
    flashes.push({ light, t: 0, dur: 1, peak: 0, prio: 0, owner: -1 });
    root.add(light);
  }
  puffMesh.layers.set(FX_SOFT_LAYER);
  dustMesh.layers.set(FX_DUST_LAYER);
  for (const m of [sparkMesh, ringMesh]) m.layers.set(FX_LAYER);
  root.add(scorchMesh, chips.mesh, splinterChips.mesh, shardChips.mesh, diceChips.mesh, fineChips.mesh, ringMesh, dustMesh, puffMesh, sparkMesh);
  scene.add(root);
  ready = true;
  applyLighting();
}

export const fx = {
  explosion(pos: Vec3, radius: number): void {
    if (!ready) return;
    const [x, y, z] = pos, R = clamp(radius, 1, 10), b = budget(), grow = 1 / Math.sqrt(b);
    // the detonation itself: a white-hot flash for a few frames, smaller than the fireball that follows (dimmed with
    // the flash comfort setting like the lights)
    pAt(x, y, z); P.variant = 3; P.life = 0.1; P.s0 = R * 0.7; P.s1 = R * 1.1; P.a = 0; P.heat = 140 * comfort.flash; P.heatDur = 0.1; P.drag = 0; P.fadeIn = 0; P.spin = 0;
    emit();
    pAt(x, y, z); P.variant = 3; P.life = 0.14; P.s0 = R * 1.6; P.s1 = R * 2.6; P.a = 0; P.heat = 40; P.heatDur = 0.14; P.drag = 0; P.fadeIn = 0; P.spin = 0;
    emit();
    for (let i = 0; i < 2; i++) {
      pAt(x + rf(-0.3, 0.3) * R, y + rf(0, 0.3) * R, z + rf(-0.3, 0.3) * R);
      P.variant = 3; P.life = 0.32; P.s0 = R * 0.9; P.s1 = R * 1.6; P.a = 0; P.heat = 16; P.heatDur = 0.32; P.fadeIn = 0;
      emit();
    }
    // humid air: the rarefaction behind the shock condenses into a brief white shell
    if (lighting.humidity > 0.3) {
      pAt(x, y + R * 0.2, z); P.variant = 3; P.life = 0.28; P.s0 = R * 1.4; P.s1 = R * 3.4; pColor(0xeef1f3);
      P.a = 0.45 * lighting.humidity; P.drag = 0; P.fadeIn = 0.03; P.spin = 0;
      emit();
    }
    const nf = Math.round((10 + R * 2.5) * b);
    for (let i = 0; i < nf; i++) {
      dirAround(0, 0.45, 0, 1);
      const sp = R * rf(1.4, 3.2);
      pAt(x + _v.x * R * 0.25, y + _v.y * R * 0.2, z + _v.z * R * 0.25);
      P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 3.5;
      P.life = rf(0.7, 1.3); P.s0 = R * 0.35; P.s1 = R * rf(0.9, 1.3) * grow;
      pColor(0x3a342d, rf(0.8, 1.2)); P.a = 0.8; P.heat = rf(9, 14); P.heatDur = rf(0.2, 0.45);
      P.rise = 1.5; P.accel = 0.4; P.wind = 0.3; P.fadeIn = 0.02; P.spin = rf(-1.5, 1.5);
      emit();
    }
    const ns = Math.round((8 + R * 2) * b);
    for (let i = 0; i < ns; i++) {
      const f = i / ns;
      pAt(x + rf(-0.6, 0.6) * R, y + R * (0.3 + f * 0.6), z + rf(-0.6, 0.6) * R);
      P.delay = f * 0.8; P.vx = rf(-1.4, 1.4); P.vy = rf(1.5, 3.2); P.vz = rf(-1.4, 1.4); P.drag = 0.8;
      P.rise = 0.7 + R * 0.1; P.accel = -0.02; P.life = rf(5, 9); P.s0 = R * 0.5; P.s1 = R * rf(2.0, 2.9) * grow;
      // the column is mostly lofted dust and pulverised mortar, grey-tan and thinning as it spreads, not a dark ball
      // floating off: only the fireball's own soot is dark
      pColor(0x9b9283, rf(0.85, 1.1)); P.a = 0.34; P.heat = 2; P.heatDur = 0.3; P.fadeIn = 0.35; P.curl = 0.4;
      emit();
    }
    // debris-laden ejecta: dark, fast, narrow, falling back under drag
    const nj = Math.round((3 + R) * b);
    for (let i = 0; i < nj; i++) {
      dirAround(0, 1, 0, 0.35);
      const sp = R * rf(3, 5.5);
      pAt(x + _v.x * R * 0.2, y + 0.3, z + _v.z * R * 0.2);
      P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 2.6; P.accel = -0.6;
      P.life = rf(2.5, 4.5); P.s0 = R * 0.2; P.s1 = R * rf(0.6, 0.9); pColor(0x66594b, rf(0.85, 1.1)); P.a = 0.7;
      P.fadeIn = 0.04; P.wind = 0.4; P.spin = rf(-0.8, 0.8);
      emit();
    }
    if (y < R * 0.9) {
      const nd = Math.round((10 + R * 2.2) * b);
      for (let i = 0; i < nd; i++) {
        const ang = (i / nd) * Math.PI * 2 + rf(-0.2, 0.2), ca = Math.cos(ang), sa = Math.sin(ang), sp = R * rf(1.6, 2.6);
        pAt(x + ca * R * 0.4, 0.3, z + sa * R * 0.4);
        P.vx = ca * sp; P.vy = rf(0.3, 1.2); P.vz = sa * sp; P.drag = 1.8;
        P.life = rf(3, 6); P.s0 = R * 0.35; P.s1 = R * rf(1.1, 1.6) * grow;
        pColor(0x9c8a70, rf(0.85, 1.1)); P.a = 0.5; P.rise = 0.25; P.wind = 0.8; P.fadeIn = 0.05;
        emit();
      }
      const o = rings.next(clock + 0.6), a = rings.arrs;
      a[0][o] = x; a[0][o + 1] = 0.06; a[0][o + 2] = z; a[0][o + 3] = clock;
      a[1][o] = R * 3.2; a[1][o + 1] = 0.6; a[1][o + 2] = 0; a[1][o + 3] = 0;
    }
    const nsp = Math.round(25 + R * 8);
    for (let i = 0; i < nsp; i++) {
      dirAround(0, 0.5, 0, 1);
      const sp = R * rf(2, 5);
      S.x = x; S.y = y + 0.2; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.6, 1.6); S.r = 6; S.g = 4.3; S.b = 1.9; S.w = rf(0.012, 0.022); S.grav = 1; S.drag = 0.8; S.streak = 0.035; S.bounce = 0.35;
      spark();
    }
    for (let i = 0; i < 10 + R * 2; i++) {
      dirAround(0, 1, 0, 0.8);
      const sp = rf(2, 6);
      S.x = x; S.y = y + 0.3; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(2, 4); S.r = 3; S.g = 1.3; S.b = 0.3; S.w = 0.01; S.grav = 0.15; S.drag = 1.5; S.streak = 0.02; S.bounce = 0.2;
      spark();
    }
    _c.setHex(0x2a2622);
    const nc = Math.round((12 + R * 4) * (chips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < nc; i++) {
      dirAround(0, 0.6, 0, 1);
      const sp = rf(6, 16);
      chips.spawn(x, y + 0.2, z, _v.x * sp, _v.y * sp, _v.z * sp, rf(0.03, 0.12), rf(5, 7), _c);
    }
    _c.setHex(0x2a2622);
    const nu = Math.round((6 + R * 2) * (chips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < nu; i++) {
      dirAround(0, 1, 0, 0.3);
      const sp = rf(10, 24);
      chips.spawn(x, y + 0.2, z, _v.x * sp, _v.y * sp, _v.z * sp, rf(0.03, 0.1), rf(5, 7), _c);
    }
    const smokeV = R * R * R * (y < R * 0.9 ? 0.9 : 0.35);
    dustLedger.smoke += smokeV;
    feedCloud(x, y, z, smokeV, y < R * 0.9 ? 0x8a7c68 : 0x5d554c);
    const fk = comfort.flash;
    _lp.set(cam.position.x - x, cam.position.y - y, cam.position.z - z).normalize().multiplyScalar(Math.min(1.5, R * 0.6));
    S.x = x + _lp.x; S.y = y + 0.3 + _lp.y; S.z = z + _lp.z; S.vx = S.vy = S.vz = 0; S.life = 0.09; S.r = 60 * fk; S.g = 52 * fk; S.b = 38 * fk;
    S.w = R * 0.45; S.grav = 0; S.drag = 1; S.streak = 0; S.bounce = 0; spark();
    for (let i = 0; i < 6; i++) {
      dirAround(0, 0.2, 0, 1);
      const sp = R * rf(14, 22);
      S.x = x; S.y = y + 0.3; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp; S.life = rf(0.05, 0.08);
      S.r = 30 * fk; S.g = 24 * fk; S.b = 14 * fk; S.w = R * 0.08; S.grav = 0; S.drag = 6; S.streak = 0.03; S.bounce = 0; spark();
    }
    flash(x, y + R * 0.3, z, 0xffb468, 320 * R * R, 0.6, Math.max(R * 10, 28), 3);
  },

  dust(pos: Vec3, size: number, color = 0xb8b0a0): void {
    if (!ready) return;
    const sz = clamp(size, 0.3, 10), b = budget(), grow = 1 / Math.sqrt(b);
    const aloft = pos[1] > 6 ? clamp((pos[1] - 6) / 10, 0, 1) : 0;
    const n = Math.min(40, Math.round((3 + sz * 3.5) * b * dustK() * (1 - 0.5 * aloft)));
    for (let i = 0; i < n; i++) {
      dirAround(0, 0.3, 0, 1);
      const r = rf(0, sz * 0.5);
      pAt(pos[0] + _v.x * r, pos[1] + _v.y * r * 0.5, pos[2] + _v.z * r);
      P.vx = rf(-0.6, 0.6); P.vy = rf(0.2, 0.6); P.vz = rf(-0.6, 0.6); P.drag = 1.2;
      P.rise = rf(0.15, 0.35); P.life = rf(4, 6) + sz * rf(0.3, 0.6);
      P.s0 = sz * rf(0.45, 0.7); P.s1 = sz * rf(1.8, 2.9) * grow;
      // what hangs in the air reads grey-tan whatever it came off: the fine fraction is mostly mortar and grit
      _cc.setHex(color).lerp(_cg, 0.35); const k = rf(0.9, 1.06); P.r = _cc.r * k; P.g = _cc.g * k; P.b = _cc.b * k;
      P.a = clamp(0.5 - sz * 0.03, 0.28, 0.46) * 0.5 * (1 - 0.35 * aloft); P.fadeIn = rf(0.25, 0.6); P.delay = (i / n) * 0.35; P.curl = 0.35;
      if (aloft > 0) { P.stretch = -0.45 * aloft; P.s1 *= 1 + 0.6 * aloft; P.accel = -0.25 * aloft; P.vy -= 0.8 * aloft; }
      emit();
    }
    feedCloud(pos[0], pos[1], pos[2], sz * sz * sz * 0.5, color);
  },

  /** Masonry coming apart: the mortar and brick face it crushes (a share of `vol`, m³ of wall) goes up as grey-tan
   *  dust that billows at the break, rolls out along the ground and hangs for tens of seconds. */
  crushDust(pos: Vec3, vol: number, color = 0xa89c8c): void {
    if (!ready || !(vol > 0)) return;
    // what hangs in the air is mostly the mortar (lime and cement, grey-white) with the brick's own dust through it
    const hex = _c.setHex(color).lerp(_mortar, 0.5).getHex();
    const sz = clamp(1 + Math.cbrt(vol) * 1.6, 1, 5);
    this.dust(pos, sz, hex);
    feedCloud(pos[0], pos[1], pos[2], vol * 25, hex);
  },

  debris(pos: Vec3, count: number, color: number, speed: number, dir?: Vec3): void {
    if (!ready) return;
    _c.setHex(color);
    const n = clamp(Math.round(count * (chips.load() < 0.75 ? 1 : 0.4)), 0, 64);
    for (let i = 0; i < n; i++) {
      if (dir) dirAround(dir[0], dir[1], dir[2], 0.7);
      else dirAround(0, 0.7, 0, 1);
      const sp = speed * rf(0.4, 1.2), sc = rf(0.02, 0.05) + rng() * rng() * 0.08;
      chips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp, sc, rf(5, 7), _c);
    }
  },

  /** Fines where masonry lands or breaks: crushed mortar, grit and brick crumbs (a few cm) settle over `radius` m round
   *  the point at its height and stay there, with a dusting on the ground round it. `vol` is the m³ that broke up. */
  fines(pos: Vec3, vol: number, color: number, radius = 0.6): void {
    if (!ready || !(vol > 0)) return;
    // they come to rest on whatever is under the point: the heap, a floor, the ground
    const floor = Math.max(0, Math.min(pos[1] - 0.05, floorAt(pos[0], pos[1] + 0.1, pos[2])));
    const n = clamp(Math.round(Math.cbrt(vol) * 60), 3, 40);
    const base = _c.setHex(color).lerp(_mortar, 0.45);
    for (let i = 0; i < n; i++) {
      const a = rf(0, 6.283), r = radius * Math.sqrt(rng());
      const sc = 0.012 + rng() * rng() * 0.07;
      _cc.copy(base).multiplyScalar(rf(0.78, 1.1));
      fineChips.spawn(pos[0] + Math.cos(a) * r, pos[1] + rf(0.05, 0.3), pos[2] + Math.sin(a) * r, rf(-0.4, 0.4), rf(0, 0.8), rf(-0.4, 0.4), sc, rf(150, 240), _cc, floor);
    }
    splatCover(pos[0], pos[2], radius * 1.6 + Math.cbrt(vol), clamp(0.05 + vol * 0.4, 0.05, 0.3) * dustK(), base.r, base.g, base.b);
  },

  sparks(pos: Vec3, normal: Vec3, count: number): void {
    if (!ready) return;
    for (let i = 0, n = clamp(Math.round(count), 0, 64); i < n; i++) {
      dirAround(normal[0], normal[1], normal[2], 0.85);
      const sp = rf(4, 14);
      S.x = pos[0]; S.y = pos[1]; S.z = pos[2]; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.25, 0.8); S.r = 5; S.g = 3.6; S.b = 1.8; S.w = rf(0.007, 0.013); S.grav = 1; S.drag = 1.2; S.streak = 0.03; S.bounce = 0.3;
      spark();
    }
    pAt(pos[0], pos[1], pos[2]); P.variant = 3; P.life = 0.06; P.s0 = 0.3; P.s1 = 0.2; P.a = 0; P.heat = 8; P.heatDur = 0.06; P.fadeIn = 0;
    emit();
  },

  splinters(pos: Vec3, count: number, color = 0x9b7442): void {
    if (!ready) return;
    _c.setHex(color);
    const n = Math.round(count * (splinterChips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < n; i++) {
      dirAround(0, 0.8, 0, 1);
      const sp = rf(3, 7);
      splinterChips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp, rf(0.06, 0.3), rf(5, 7), _c);
    }
    fx.dust(pos, 0.5, 0xcbb083);
  },

  shards(pos: Vec3, count: number): void {
    if (!ready) return;
    const n = Math.round(count * (shardChips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < n; i++) {
      dirAround(0, 0.5, 0, 1);
      const sp = rf(2, 6);
      _c.setRGB(rf(0.72, 0.85), rf(0.88, 0.95), rf(0.88, 0.95));
      shardChips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp, rf(0.03, 0.13), rf(5, 7), _c);
    }
    pAt(pos[0], pos[1], pos[2]); P.life = rf(1.5, 2.5); P.s0 = 0.2; P.s1 = 0.9; pColor(0xe4f1f3); P.a = 0.25; P.drag = 2;
    emit();
    // specular glints of tumbling panes catching the sun: brief, cold-white, scaled by the sun
    const gk = (lighting.sunIntensity / Math.PI) * Math.max(lighting.sunDir.y, 0.15);
    for (let i = 0, ng = Math.min(14, Math.round(count * 0.4)); i < ng; i++) {
      dirAround(0, 0.5, 0, 1);
      const sp = rf(2, 6);
      S.x = pos[0]; S.y = pos[1]; S.z = pos[2]; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp; S.delay = rf(0, 0.6);
      S.life = rf(0.05, 0.12); S.r = -2.2 * gk; S.g = -2.4 * gk; S.b = -2.6 * gk; S.w = 0.006; S.grav = 1; S.drag = 0.4; S.streak = 0.004; S.bounce = 0.3;
      spark();
    }
  },

  /** tempered glass: a burst of tiny glinting cubes */
  dice(pos: Vec3, count: number): void {
    if (!ready) return;
    const n = Math.round(count * (diceChips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < n; i++) {
      dirAround(0, 0.45, 0, 1);
      const sp = rf(2, 7);
      _c.setRGB(rf(0.62, 0.78), rf(0.86, 0.95), rf(0.84, 0.94));
      diceChips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp, rf(0.008, 0.018), rf(5, 7), _c);
    }
    for (let i = 0; i < Math.min(40, count * 0.25); i++) {
      dirAround(0, 0.4, 0, 1);
      const sp = rf(3, 8);
      S.x = pos[0]; S.y = pos[1]; S.z = pos[2]; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.12, 0.3); S.r = 2.2; S.g = 2.5; S.b = 2.8; S.w = 0.004; S.grav = 1; S.drag = 2; S.streak = 0.012; S.bounce = 0.3;
      spark();
    }
    pAt(pos[0], pos[1], pos[2]); P.life = rf(1.2, 2); P.s0 = 0.2; P.s1 = 0.8; pColor(0xe8f4f2); P.a = 0.2; P.drag = 2;
    emit();
  },

  /** crumbling drywall / adobe / sandstone: fine dust that sinks and settles, plus sand-grain chips */
  powder(pos: Vec3, size: number, color = 0xe6e2d8): void {
    if (!ready) return;
    const sz = clamp(size, 0.2, 6), b = budget(), n = Math.min(30, Math.round((4 + sz * 4) * b * dustK()));
    for (let i = 0; i < n; i++) {
      dirAround(0, 0.2, 0, 1);
      const r = rf(0, sz * 0.4), sp = rf(0.5, 2) * Math.sqrt(sz);
      pAt(pos[0] + _v.x * r, pos[1] + _v.y * r * 0.5, pos[2] + _v.z * r);
      P.vx = _v.x * sp; P.vy = rf(-0.2, 0.8); P.vz = _v.z * sp; P.drag = 2.5; P.accel = -0.35;
      P.life = rf(1.5, 3.2) + sz * 0.2; P.s0 = sz * 0.25; P.s1 = sz * rf(0.7, 1.1);
      pColor(color, rf(0.9, 1.05)); P.a = 0.6; P.fadeIn = 0.05; P.wind = 0.4;
      emit();
    }
    feedCloud(pos[0], pos[1], pos[2], sz * sz * sz * 0.4, color);
    _c.setHex(color).multiplyScalar(0.85);
    const nc = Math.round((10 + sz * 14) * (chips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < nc; i++) {
      dirAround(0, 0.5, 0, 1);
      const sp = rf(1.5, 4);
      chips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp, rf(0.008, 0.02), rf(3, 5), _c);
    }
  },

  impact(pos: Vec3, normal: Vec3, mat: MaterialId, strength: number): void {
    if (!ready) return;
    const s = clamp(strength, 0, 1), d = IMPACT[mat], b = budget();
    if (s < 0.015) return;
    const [nx, ny, nz] = normal;
    if (d.powder) fx.powder(pos, 0.4 + 1.2 * s, d.dustC);
    else if (d.dust > 0) {
      const n = Math.round((2 + 5 * s) * d.dust * b);
      for (let i = 0; i < n; i++) {
        dirAround(nx, ny, nz, 0.7);
        const sp = rf(1.5, 4) * (0.4 + s);
        pAt(pos[0] + nx * 0.1, pos[1] + ny * 0.1, pos[2] + nz * 0.1);
        P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 3;
        P.life = rf(1.5, 3.5) + s * 2; P.s0 = 0.15 + 0.3 * s; P.s1 = 0.6 + 1.6 * s; P.rise = 0.15;
        pColor(d.dustC, rf(0.9, 1.05)); P.a = 0.5; P.fadeIn = 0.05;
        emit();
      }
    }
    const heavyMineral = HEAVY_MINERAL.has(mat);
    const structuralSteel = mat === 'steel' || mat === 'castiron' || mat === 'machine';
    // Dense material: a compact front-face spall, then dust hanging behind it. No shock ring,
    // flash, camera shake or full blast for an ordinary collision.
    if (heavyMineral && s >= 0.6) {
      const n = Math.min(5, Math.round((1 + 4 * s) * b));
      for (let i = 0; i < n; i++) {
        dirAround(nx, ny, nz, 1.1);
        pAt(pos[0] + _v.x * rf(0.04, 0.25), pos[1] + _v.y * rf(0.04, 0.25), pos[2] + _v.z * rf(0.04, 0.25));
        P.vx = _v.x * rf(0.3, 1.2); P.vy = _v.y * rf(0.3, 1.2); P.vz = _v.z * rf(0.3, 1.2);
        P.drag = 2.4; P.accel = -0.18; P.life = rf(2.2, 3.8); P.s0 = rf(0.2, 0.4); P.s1 = rf(0.65, 1.3) * s;
        pColor(d.dustC, rf(0.8, 0.95)); P.a = 0.45; P.fadeIn = 0.15; P.delay = i * 0.045; P.wind = 0.35;
        emit();
      }
    }
    const nc = Math.round((3 + 14 * s) * d.chip);
    if (nc > 0) {
      const dir: Vec3 = _impactDir;
      dir[0] = nx; dir[1] = ny + 0.3; dir[2] = nz;
      if (d.kind === 'splinters') {
        _c.setHex(d.chipC);
        for (let i = 0; i < nc; i++) {
          dirAround(dir[0], dir[1], dir[2], 0.8);
          const sp = rf(2, 6) * (0.5 + s);
          splinterChips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp, rf(0.05, 0.22), rf(5, 7), _c);
        }
      } else if (d.kind === 'shards') fx.shards(pos, nc);
      else if (d.kind === 'dice') fx.dice(pos, nc * 4);
      else if (heavyMineral && s >= 0.6) {
        _c.setHex(d.chipC);
        const n = Math.min(24, Math.round(nc * (chips.load() < 0.75 ? 1 : 0.4)));
        for (let i = 0; i < n; i++) {
          dirAround(dir[0], dir[1], dir[2], 1.1);
          const sp = rf(1.5, 4.5) * (0.7 + s);
          // Fewer, larger falling chunks instead of the same fast confetti as plaster.
          chips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp,
            rf(0.055, 0.16) * (0.7 + s * 0.4), rf(6, 9), _c);
        }
      } else fx.debris(pos, nc, d.chipC, 3 + 6 * s, dir);
    }
    if (d.sparks > 0 && s >= (structuralSteel ? 0.32 : 0.5)) {
      fx.sparks(pos, normal, Math.min(18, Math.round((4 + 14 * s) * d.sparks)));
    }
  },

  scorch(pos: Vec3, radius: number): void {
    if (!ready) return;
    const o = scorches.next(1e9), a = scorches.arrs;
    a[0][o] = pos[0]; a[0][o + 1] = 0.012; a[0][o + 2] = pos[2]; a[0][o + 3] = clock;
    a[1][o] = clamp(radius, 0.3, 12) * rf(0.95, 1.2); a[1][o + 1] = rf(0, 6.283); a[1][o + 2] = rng(); a[1][o + 3] = 0;
  },

  smokeTrail(pos: Vec3): void {
    if (!ready) return;
    pAt(pos[0] + rf(-0.05, 0.05), pos[1] + rf(-0.05, 0.05), pos[2] + rf(-0.05, 0.05));
    P.vx = rf(-0.3, 0.3); P.vy = rf(-0.1, 0.4); P.vz = rf(-0.3, 0.3); P.drag = 1;
    P.life = rf(1.6, 2.6); P.s0 = 0.22; P.s1 = rf(1.0, 1.5); P.rise = 0.25; P.wind = 0.8;
    pColor(0x9a9690, rf(0.85, 1.1)); P.a = 0.45; P.heat = 5; P.heatDur = 0.07; P.fadeIn = 0.03;
    emit();
  },

  muzzle(pos: Vec3, dir: Vec3, weapon: WeaponId): void {
    if (!ready || (weapon !== 'cannon' && weapon !== 'rocket')) return;
    const [dx, dy, dz] = dir, [x, y, z] = pos, rocket = weapon === 'rocket';
    pAt(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25);
    P.variant = 3; P.life = 0.08; P.s0 = rocket ? 0.7 : 0.55; P.s1 = rocket ? 1.4 : 1.1; P.a = 0; P.heat = 30; P.heatDur = 0.08; P.fadeIn = 0;
    emit();
    const back = rocket ? -1 : 1;
    for (let i = 0; i < (rocket ? 6 : 5); i++) {
      dirAround(dx * back, dy * back, dz * back, 0.25);
      const sp = rf(8, 14);
      pAt(x + dx * 0.3 * back, y + dy * 0.3 * back, z + dz * 0.3 * back);
      P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 9;
      P.life = rf(0.18, 0.32); P.s0 = 0.25; P.s1 = 0.75; P.a = 0; P.heat = 12; P.heatDur = P.life; P.fadeIn = 0.01;
      emit();
    }
    // muzzle smoke stays light: it spawns right in front of the player's eyes
    for (let i = 0; i < (rocket ? 14 : 7); i++) {
      dirAround(dx * back, dy * back, dz * back, 0.35);
      const sp = rocket ? rf(6, 14) : rf(4, 10);
      pAt(x + dx * 0.4 * back, y + dy * 0.4 * back, z + dz * 0.4 * back);
      P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 3.5;
      P.life = rf(1.6, 3); P.s0 = 0.25; P.s1 = rocket ? rf(1.5, 2.6) : rf(0.9, 1.4); P.rise = 0.3;
      pColor(0xa8a49c, rf(0.85, 1.1)); P.a = rocket ? 0.4 : 0.32; P.heat = 3; P.heatDur = 0.1; P.fadeIn = 0.05;
      emit();
    }
    if (!rocket) {
      for (let i = 0; i < 12; i++) {
        dirAround(dx, dy, dz, 0.3);
        const sp = rf(10, 22);
        S.x = x + dx * 0.3; S.y = y + dy * 0.3; S.z = z + dz * 0.3; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
        S.life = rf(0.2, 0.5); S.r = 5; S.g = 3.2; S.b = 1.2; S.w = 0.008; S.grav = 1; S.drag = 1.5; S.streak = 0.025; S.bounce = 0.3;
        spark();
      }
    }
    flash(x + dx * 0.6, y + dy * 0.6, z + dz * 0.6, 0xffb060, rocket ? 90 : 60, rocket ? 0.15 : 0.09, 14, 2);
  },

  fire(pos: Vec3, seconds: number, size: number): void {
    if (!ready) return;
    const e = claim(fires);
    e.on = true; e.x = pos[0]; e.y = pos[1]; e.z = pos[2]; e.start = clock; e.end = clock + seconds; e.size = clamp(size, 0.2, 4); e.heat = 1; e.a = e.b = e.c = 0;
  },

  /* One tick of flame on a (possibly moving) burning piece; call a few times a second per piece. */
  flames(pos: Vec3, size: number, heat: number): void {
    if (!ready) return;
    const b = budget();
    const sz = clamp(size, 0.15, 2);
    const n = Math.max(1, Math.round(6 * sz * b * heat));
    for (let i = 0; i < n; i++) {
      const r = rf(0, 0.4 * sz), ang = rf(0, 6.283);
      pAt(pos[0] + Math.cos(ang) * r, pos[1] + rf(-0.1, 0.2) * sz, pos[2] + Math.sin(ang) * r);
      P.vx = rf(-0.25, 0.25); P.vy = rf(1.2, 2.6); P.vz = rf(-0.25, 0.25); P.drag = 1.2; P.rise = 0.6;
      P.life = rf(0.4, 0.8); P.s0 = sz * rf(0.6, 0.95); P.s1 = sz * 0.2; P.a = 0; P.heat = rf(3.5, 6) * heat; P.heatDur = P.life;
      P.spin = rf(-1.5, 1.5); P.wind = 0.6; P.fadeIn = 0.05;
      emit();
    }
    if (rng() < 0.35 * b) {
      pAt(pos[0] + rf(-0.2, 0.2) * sz, pos[1] + sz * 0.7, pos[2] + rf(-0.2, 0.2) * sz);
      P.vx = rf(-0.3, 0.3); P.vy = rf(1, 1.8); P.vz = rf(-0.3, 0.3); P.drag = 0.6; P.rise = 0.9;
      // timber burning in the open smokes grey-brown; soot-black is a fuel-rich fire's, not a building's
      P.life = rf(3, 5.5); P.s0 = sz * 0.5; P.s1 = sz * rf(2.2, 3.2); pColor(0x4a4440, rf(0.85, 1.15)); P.a = 0.3;
      P.wind = 1.2; P.fadeIn = 0.4; P.heat = 1.2; P.heatDur = 0.3;
      emit();
    }
    if (rng() < 0.3 * b) {
      S.x = pos[0] + rf(-0.3, 0.3) * sz; S.y = pos[1] + sz * 0.4; S.z = pos[2] + rf(-0.3, 0.3) * sz;
      S.vx = rf(-0.8, 0.8); S.vy = rf(1.5, 3.5); S.vz = rf(-0.8, 0.8);
      S.life = rf(1, 2.2); S.r = 3; S.g = 1.3; S.b = 0.35; S.w = 0.009; S.grav = 0.1; S.drag = 1.4; S.streak = 0.02; S.bounce = 0.2;
      spark();
    }
  },

  /** one tick (~10×/s) of a burning thermite pot: white core, spark fountain, falling slag, white smoke, flickering light */
  thermite(pos: Vec3, intensity: number): void {
    if (!ready) return;
    const k = clamp(intensity, 0, 2);
    if (k < 0.01) return;
    const [x, y, z] = pos, b = budget();
    for (let i = 0; i < 2; i++) {
      pAt(x + rf(-0.05, 0.05), y + rf(0.06, 0.14), z + rf(-0.05, 0.05));
      P.variant = 3; P.life = rf(0.13, 0.2); P.s0 = rf(0.35, 0.5) * (0.5 + 0.5 * k); P.s1 = P.s0 * 0.75; P.a = 0;
      pColor(0xfff0c8); P.heat = -rf(20, 30) * k; P.heatDur = P.life * 1.5; P.drag = 0; P.fadeIn = 0; P.spin = 0;
      emit();
    }
    const ns = Math.round(rf(10, 15) * k);
    for (let i = 0; i < ns; i++) {
      dirAround(0, 1, 0, 1.1);
      const sp = rf(2, 7.5);
      S.x = x; S.y = y + 0.1; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp + 1.2; S.vz = _v.z * sp;
      S.life = rf(0.5, 1.3); S.r = 6; S.g = 5.2; S.b = 3.4; S.w = rf(0.006, 0.012); S.grav = 1; S.drag = 0.7; S.streak = 0.04; S.bounce = 0.35;
      spark();
    }
    // near-zero bounce: the analytic path keeps falling below y = 0, and the mirror must not lift it back up
    const nd = Math.round(rf(1.5, 4) * k);
    for (let i = 0; i < nd; i++) {
      const ang = rf(0, 6.283), sp = rf(0.2, 1.4);
      S.x = x + rf(-0.06, 0.06); S.y = y; S.z = z + rf(-0.06, 0.06);
      S.vx = Math.cos(ang) * sp; S.vy = rf(-0.8, 0.6); S.vz = Math.sin(ang) * sp;
      S.life = rf(1.6, 2.8); S.r = 5; S.g = 2.6; S.b = 0.8; S.w = rf(0.016, 0.028); S.grav = 1; S.drag = 2; S.streak = 0.012; S.bounce = 0.006;
      spark();
    }
    if (rng() < 0.85 * b) {
      pAt(x + rf(-0.1, 0.1), y + 0.3, z + rf(-0.1, 0.1));
      P.vx = rf(-0.4, 0.4); P.vy = rf(1.5, 2.6); P.vz = rf(-0.4, 0.4); P.drag = 0.8; P.rise = 0.9;
      P.life = rf(4, 7); P.s0 = 0.3; P.s1 = rf(1.8, 3) * (0.6 + 0.4 * k); pColor(0xe9e6df, rf(0.9, 1.05)); P.a = 0.5;
      P.wind = 1.2; P.fadeIn = 0.2; P.heat = -2.5; P.heatDur = 0.35;
      emit();
    }
    flash(x, y + 0.35, z, 0xfff0d0, rf(80, 130) * k, 0.3, 18, 1, 1.5);
  },

  /** firebomb bursting: glass, a radial fire splash, a burning patch for ~8 s, scorch and a flash */
  firebomb(pos: Vec3, radius: number): void {
    if (!ready) return;
    const [x, y, z] = pos, R = clamp(radius, 0.8, 8), b = budget();
    _c.setRGB(0.32, 0.45, 0.24);
    const ng = Math.round(16 * (shardChips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < ng; i++) {
      dirAround(0, 0.6, 0, 1);
      const sp = rf(2, 6);
      shardChips.spawn(x, y + 0.1, z, _v.x * sp, _v.y * sp, _v.z * sp, rf(0.02, 0.07), rf(4, 6), _c);
    }
    pAt(x, y + 0.3, z); P.variant = 3; P.life = 0.35; P.s0 = R * 0.8; P.s1 = R * 1.5; P.a = 0;
    pColor(0xff7a26); P.heat = -9; P.heatDur = 0.35; P.drag = 0; P.fadeIn = 0; P.spin = 0;
    emit();
    const nf = Math.round((14 + R * 4) * b);
    for (let i = 0; i < nf; i++) {
      const ang = (i / nf) * 6.283 + rf(-0.25, 0.25), ca = Math.cos(ang), sa = Math.sin(ang), sp = R * rf(1.6, 3.2);
      pAt(x + ca * 0.2, y + rf(0.1, 0.35), z + sa * 0.2);
      P.vx = ca * sp; P.vy = rf(0.5, 2.5); P.vz = sa * sp; P.drag = 3.2; P.rise = 0.8;
      P.life = rf(0.6, 1.2); P.s0 = R * rf(0.25, 0.4); P.s1 = R * 0.12; P.a = 0; P.heat = rf(3.5, 6); P.heatDur = P.life;
      P.spin = rf(-1.5, 1.5); P.wind = 0.5; P.fadeIn = 0.03;
      emit();
    }
    for (let i = 0; i < 6; i++) {
      pAt(x + rf(-0.4, 0.4) * R, y + 0.2, z + rf(-0.4, 0.4) * R);
      P.vx = rf(-0.5, 0.5); P.vy = rf(2.5, 5); P.vz = rf(-0.5, 0.5); P.drag = 1.5; P.rise = 1;
      P.life = rf(0.7, 1.2); P.s0 = R * rf(0.35, 0.5); P.s1 = R * 0.15; P.a = 0; P.heat = rf(3.5, 6); P.heatDur = P.life;
      P.spin = rf(-1, 1); P.wind = 0.6; P.fadeIn = 0.04;
      emit();
    }
    const nsm = Math.round(6 * b);
    for (let i = 0; i < nsm; i++) {
      pAt(x + rf(-0.3, 0.3) * R, y + R * 0.4, z + rf(-0.3, 0.3) * R);
      P.delay = rf(0.1, 0.6); P.vx = rf(-0.6, 0.6); P.vy = rf(1.5, 3); P.vz = rf(-0.6, 0.6); P.drag = 0.7; P.rise = 1;
      P.life = rf(4, 7); P.s0 = R * 0.3; P.s1 = R * rf(1, 1.5); pColor(0x1c1814, rf(0.8, 1.2)); P.a = 0.5;
      P.wind = 1.2; P.fadeIn = 0.3; P.heat = 1.5; P.heatDur = 0.4;
      emit();
    }
    const ne = Math.round(18 + R * 6);
    for (let i = 0; i < ne; i++) {
      dirAround(0, 0.5, 0, 1);
      const sp = R * rf(1, 2.5);
      S.x = x; S.y = y + 0.2; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.6, 1.6); S.r = 4.5; S.g = 2; S.b = 0.5; S.w = rf(0.008, 0.014); S.grav = 0.8; S.drag = 1.4; S.streak = 0.03; S.bounce = 0.25;
      spark();
    }
    const np = R < 1.6 ? 1 : R < 3.5 ? 3 : 5, end = clock + rf(7.5, 8.5);
    for (let i = 0; i < np; i++) {
      const e = claim(fires), ang = (i * 6.283) / Math.max(1, np - 1) + rf(-0.3, 0.3), r = i === 0 ? 0 : R * rf(0.4, 0.65);
      e.on = true; e.x = x + Math.cos(ang) * r; e.y = y; e.z = z + Math.sin(ang) * r;
      e.start = clock; e.end = i === 0 ? end : end - rf(0, 1.5);
      e.size = clamp(R * (i === 0 ? 0.4 : 0.28), 0.3, 2); e.heat = 0.5; e.a = e.b = e.c = 0;
    }
    if (y < R * 0.6 + 0.5) fx.scorch(pos, R * 1.1);
    flash(x, y + 0.6, z, 0xff8a38, 60 * R * R + 150, 0.5, R * 7 + 6, 2);
  },

  /** sandbox megabomb (radius ~20-35 m): flash, fireball rising into a capped column over ~6 s,
      ground shock ring to ~2R, rolling dust wall, scorch and sparks. ~90 large puffs, births delayed. */
  megablast(pos: Vec3, radius: number): void {
    if (!ready) return;
    const [x, y, z] = pos, R = clamp(radius, 8, 40), b = Math.max(0.6, budget()), ground = y < R * 1.5;
    pAt(x, y + R * 0.15, z); P.variant = 3; P.life = 0.3; P.s0 = R * 1.3; P.s1 = R * 2.2; P.a = 0; P.heat = 60; P.heatDur = 0.3; P.drag = 0; P.fadeIn = 0; P.spin = 0;
    emit();
    pAt(x, y + R * 0.25, z); P.variant = 3; P.life = 1.1; P.s0 = R * 0.8; P.s1 = R * 1.5; P.a = 0;
    pColor(0xff8a30); P.heat = -12; P.heatDur = 1.1; P.drag = 0; P.fadeIn = 0; P.spin = 0;
    emit();
    // the column head climbs R·(0.25t + 0.03t²): fireball rise/accel follow it, later births are placed on it
    for (let i = 0; i < 16; i++) {
      dirAround(0, 0.8, 0, 1);
      const sp = R * rf(0.5, 1);
      pAt(x + _v.x * R * 0.12, y + Math.abs(_v.y) * R * 0.12, z + _v.z * R * 0.12);
      P.vx = _v.x * sp; P.vy = Math.abs(_v.y) * sp; P.vz = _v.z * sp; P.drag = 2.4;
      P.life = rf(2.6, 4); P.s0 = R * 0.28; P.s1 = R * rf(0.55, 0.8);
      pColor(0x1d1915, rf(0.8, 1.2)); P.a = 0.9; P.heat = rf(4.5, 7); P.heatDur = rf(1, 1.8);
      P.rise = R * 0.25; P.accel = R * 0.03; P.wind = 0.15; P.fadeIn = 0.02; P.spin = rf(-0.8, 0.8);
      emit();
    }
    for (let i = 0; i < 24; i++) {
      const d = 0.3 + ((i + rng()) / 24) * 4.2, top = R * (0.25 * d + 0.03 * d * d);
      pAt(x + rf(-0.12, 0.12) * R, y + top * rf(0.35, 1), z + rf(-0.12, 0.12) * R);
      P.delay = d; P.vx = rf(-0.4, 0.4); P.vy = R * rf(0.05, 0.12); P.vz = rf(-0.4, 0.4); P.drag = 0.6;
      P.rise = R * 0.06; P.life = rf(10, 14); P.s0 = R * 0.28; P.s1 = R * rf(0.45, 0.7);
      pColor(rng() < 0.5 ? 0x6f6150 : 0x4a4239, rf(0.85, 1.15)); P.a = 0.62; P.heat = d < 1.8 ? rf(1.5, 3) : 0; P.heatDur = 1.2;
      P.wind = 0.5; P.fadeIn = 0.5; P.spin = rf(-0.3, 0.3);
      emit();
    }
    for (let i = 0; i < 20; i++) {
      const d = rf(3.4, 6), top = R * (0.25 * d + 0.03 * d * d), ang = (i / 20) * 6.283 + rf(-0.2, 0.2);
      const ca = Math.cos(ang), sa = Math.sin(ang), r = R * rf(0.1, 0.45), sp = R * rf(0.12, 0.3);
      pAt(x + ca * r, y + top + rf(-0.1, 0.12) * R, z + sa * r);
      P.delay = d; P.vx = ca * sp; P.vy = R * rf(0.02, 0.08); P.vz = sa * sp; P.drag = 0.45;
      P.rise = R * 0.05; P.accel = -R * 0.003; P.life = rf(11, 15); P.s0 = R * 0.4; P.s1 = R * rf(0.85, 1.25);
      pColor(0x4a4239, rf(0.8, 1.15)); P.a = 0.58; P.wind = 0.7; P.fadeIn = 0.6; P.spin = rf(-0.25, 0.25);
      emit();
    }
    if (ground) {
      const nw = Math.max(14, Math.round(22 * b));
      for (let i = 0; i < nw; i++) {
        const ang = (i / nw) * 6.283 + rf(-0.12, 0.12), ca = Math.cos(ang), sa = Math.sin(ang), sp = R * rf(1.7, 2.3);
        pAt(x + ca * R * 0.3, 0.5, z + sa * R * 0.3);
        P.delay = rf(0, 0.12); P.vx = ca * sp; P.vy = rf(0.5, 2); P.vz = sa * sp; P.drag = 1.1;
        P.rise = R * 0.02; P.life = rf(7, 11); P.s0 = R * 0.22; P.s1 = R * rf(0.5, 0.75);
        pColor(0xa08d72, rf(0.85, 1.1)); P.a = 0.6; P.wind = 0.6; P.fadeIn = 0.05; P.spin = rf(-0.8, 0.8);
        emit();
      }
      for (let i = 0; i < 8; i++) {
        const ang = rf(0, 6.283), ca = Math.cos(ang), sa = Math.sin(ang), r = R * rf(0.2, 0.6);
        pAt(x + ca * r, 0.5, z + sa * r);
        P.delay = rf(0.3, 1.4); P.vx = ca * R * 0.4; P.vy = rf(1, 3); P.vz = sa * R * 0.4; P.drag = 0.8;
        P.rise = R * 0.04; P.life = rf(9, 13); P.s0 = R * 0.3; P.s1 = R * rf(0.7, 0.95);
        pColor(0x8a7a64, rf(0.85, 1.1)); P.a = 0.55; P.wind = 0.7; P.fadeIn = 0.4;
        emit();
      }
      const a = rings.arrs;
      let o = rings.next(clock + 0.8);
      a[0][o] = x; a[0][o + 1] = 0.08; a[0][o + 2] = z; a[0][o + 3] = clock;
      a[1][o] = R * 2; a[1][o + 1] = 0.8; a[1][o + 2] = 0; a[1][o + 3] = 0;
      o = rings.next(clock + 1.9);
      a[0][o] = x; a[0][o + 1] = 0.1; a[0][o + 2] = z; a[0][o + 3] = clock + 0.1;
      a[1][o] = R * 2.6; a[1][o + 1] = 1.8; a[1][o + 2] = 0; a[1][o + 3] = 0;
      if (y < R * 0.5) fx.scorch(pos, R * 0.45);
    }
    for (let i = 0; i < 140; i++) {
      dirAround(0, 0.55, 0, 1);
      const sp = R * rf(0.4, 1.3);
      S.x = x; S.y = y + 0.5; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(1.5, 3.5); S.r = 6; S.g = 4.3; S.b = 1.9; S.w = rf(0.03, 0.06); S.grav = 1; S.drag = 0.5; S.streak = 0.04; S.bounce = 0.3;
      spark();
    }
    for (let i = 0; i < 60; i++) {
      dirAround(0, 1, 0, 0.8);
      const sp = rf(4, 14);
      S.x = x; S.y = y + R * 0.3; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(3, 6); S.r = 3; S.g = 1.3; S.b = 0.3; S.w = 0.025; S.grav = 0.12; S.drag = 1.2; S.streak = 0.02; S.bounce = 0.2;
      spark();
    }
    _c.setHex(0x2a2622);
    const nc = Math.round(40 * (chips.load() < 0.75 ? 1 : 0.4));
    for (let i = 0; i < nc; i++) {
      dirAround(0, 0.7, 0, 1);
      const sp = rf(10, 30);
      chips.spawn(x, y + 0.5, z, _v.x * sp, _v.y * sp, _v.z * sp, rf(0.08, 0.3), rf(6, 9), _c);
    }
    if (ground) feedCloud(x, 0, z, R * R * R * 0.35, 0x9a8a72);
    flash(x, y + R * 0.3, z, 0xffc27a, 250 * R * R, 1.6, R * 10, 4);
    flash(x, y + R * 0.9, z, 0xff7a30, 40 * R * R, 5, R * 8, 3);
  },

  /** linear cut firing: a line of white flash along `dir` centred on `pos`, a perpendicular spark fan, thin smoke */
  cutter(pos: Vec3, dir: Vec3, length: number): void {
    if (!ready) return;
    const [x, y, z] = pos, L = clamp(length, 0.1, 8), b = budget();
    _cd.set(dir[0], dir[1], dir[2]);
    if (_cd.lengthSq() < 1e-8) _cd.set(1, 0, 0);
    _cd.normalize();
    _cu.set(0, 1, 0).cross(_cd);
    if (_cu.lengthSq() < 1e-6) _cu.set(1, 0, 0).cross(_cd);
    _cu.normalize();
    _cw.crossVectors(_cd, _cu);
    const n = Math.min(16, Math.max(2, Math.round(L / 0.3)));
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n - 0.5) * L, px = x + _cd.x * s, py = y + _cd.y * s, pz = z + _cd.z * s;
      pAt(px, py, pz); P.variant = 3; P.life = rf(0.07, 0.12); P.s0 = rf(0.45, 0.6); P.s1 = 0.3; P.a = 0;
      pColor(0xffe4b8); P.heat = -24; P.heatDur = P.life; P.drag = 0; P.fadeIn = 0; P.spin = 0;
      emit();
      if (rng() > b) continue;
      pAt(px, py, pz);
      P.vx = rf(-0.5, 0.5); P.vy = rf(0, 0.6); P.vz = rf(-0.5, 0.5); P.drag = 2; P.rise = 0.3;
      P.life = rf(1.5, 3); P.s0 = 0.15; P.s1 = rf(0.6, 1); pColor(0xb8b4ac, rf(0.9, 1.05)); P.a = 0.38;
      P.heat = 3; P.heatDur = 0.1; P.fadeIn = 0.04; P.wind = 0.8;
      emit();
    }
    const ns = Math.min(140, Math.round(20 + L * 30));
    for (let i = 0; i < ns; i++) {
      const s = rf(-0.5, 0.5) * L, ang = rf(0, 6.283), ca = Math.cos(ang), sa = Math.sin(ang), al = rf(-0.2, 0.2), sp = rf(6, 18);
      _v.set(_cu.x * ca + _cw.x * sa + _cd.x * al, _cu.y * ca + _cw.y * sa + _cd.y * al, _cu.z * ca + _cw.z * sa + _cd.z * al).normalize();
      S.x = x + _cd.x * s; S.y = y + _cd.y * s; S.z = z + _cd.z * s; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.2, 0.7); S.r = 6; S.g = 4.6; S.b = 2.4; S.w = rf(0.006, 0.011); S.grav = 1; S.drag = 1.4; S.streak = 0.035; S.bounce = 0.3;
      spark();
    }
    flash(x, y, z, 0xffd6a0, 50 + L * 30, 0.12, 10 + L * 2, 2);
  },

  /** one tick (every ~0.15-0.4 s) at a live cut cable: jagged blue-white arc, spark shower, blue flash */
  arc(pos: Vec3, strength: number): void {
    if (!ready) return;
    const s = clamp(strength, 0.1, 2), [x, y, z] = pos;
    const flick = 1 + Math.round(rng() * 2);
    for (let k = 0; k < flick; k++) {
      const d = k * rf(0.03, 0.06);
      bolt(x, y, z, rf(0.25, 0.6) * (0.6 + 0.4 * s), 5 + Math.round(rng() * 3), d, 0.009 + 0.006 * s);
      pAt(x, y, z); P.delay = d; P.variant = 3; P.life = 0.08; P.s0 = 0.3 + 0.35 * s; P.s1 = P.s0 * 0.7; P.a = 0;
      pColor(0xb8d4ff); P.heat = -(14 + 10 * s); P.heatDur = 0.08; P.drag = 0; P.fadeIn = 0; P.spin = 0;
      emit();
    }
    const ns = Math.min(40, Math.round(8 + 16 * s));
    for (let i = 0; i < ns; i++) {
      dirAround(0, -0.2, 0, 1);
      const sp = rf(2, 7) * (0.7 + 0.3 * s);
      S.x = x; S.y = y; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.3, 0.9); S.r = 6; S.g = 5.6; S.b = 5.2; S.w = rf(0.005, 0.01); S.grav = 1; S.drag = 1; S.streak = 0.03; S.bounce = 0.35;
      spark();
    }
    if (rng() < 0.3 * budget()) {
      pAt(x, y, z); P.vy = rf(0.3, 0.8); P.life = rf(1.2, 2); P.s0 = 0.1; P.s1 = 0.5; pColor(0x8a8c90); P.a = 0.25; P.rise = 0.3; P.fadeIn = 0.05;
      emit();
    }
    flash(x, y, z, 0x9ec4ff, 30 + 50 * s, 0.14, 7 + 5 * s, 1, 1);
  },

  /** transformer blowout: huge blue-white flash, molten copper sparks, rising smoke, ~1 s of lingering arcs */
  arcFlash(pos: Vec3, radius: number): void {
    if (!ready) return;
    const [x, y, z] = pos, R = clamp(radius, 0.5, 8), b = budget(), grow = 1 / Math.sqrt(b);
    arcGlow(x, y, z, R * 1.8, 45, 0.22);
    arcGlow(x, y, z, R * 0.9, 12, 0.6);
    for (let i = 0; i < 5; i++) bolt(x, y, z, R * rf(0.8, 1.6), 7, i * 0.04, 0.02 + 0.006 * R);
    const ns = Math.min(200, Math.round(60 + R * 25));
    for (let i = 0; i < ns; i++) {
      dirAround(0, 0.4, 0, 1);
      const sp = R * rf(2, 6), green = rng() < 0.25;
      S.x = x; S.y = y; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.6, 1.8); S.r = green ? 2.5 : 6; S.g = green ? 6 : 4.2; S.b = green ? 3.5 : 2.2;
      S.w = rf(0.01, 0.02); S.grav = 1; S.drag = 0.7; S.streak = 0.035; S.bounce = 0.3;
      spark();
    }
    const np = Math.round((10 + R * 4) * b);
    for (let i = 0; i < np; i++) {
      const f = i / np;
      pAt(x + rf(-0.3, 0.3) * R, y + R * (0.2 + f * 0.8), z + rf(-0.3, 0.3) * R);
      P.delay = f * 0.9; P.vx = rf(-0.6, 0.6); P.vy = rf(1.5, 3); P.vz = rf(-0.6, 0.6); P.drag = 0.8;
      // burnt insulation and vaporised copper: a brief grey puff that thins as it rises, not a standing black column
      P.life = rf(2.5, 4.5); P.s0 = R * 0.4; P.s1 = R * rf(1.8, 2.6) * grow; P.rise = 1.2; P.accel = 0.05;
      pColor(0x55524e, rf(0.85, 1.15)); P.a = 0.35; P.heat = f < 0.3 ? 3 : 0; P.heatDur = 0.4; P.fadeIn = 0.2; P.wind = 1;
      emit();
    }
    const e = claim(arcs);
    e.on = true; e.x = x; e.y = y; e.z = z; e.start = clock; e.end = clock + rf(0.9, 1.2); e.size = R; e.a = 0.08; e.b = e.c = 0;
    flash(x, y, z, 0xc8dcff, 400 * R * R + 300, 0.5, R * 12 + 8, 3);
  },

  /** the arc flash of a power fault; radius from its incident energy (a transformer blowout is `arcFlash`) */
  arcBlast(pos: Vec3, radius: number): void {
    fx.arcFlash(pos, radius);
  },

  /** a lightning strike: the channel polyline from the cloud base to the struck point, its forks, three return
      strokes and the sky lighting up */
  lightning(main: Vec3[], forks: Vec3[][], k: number): void {
    if (!ready || main.length < 2) return;
    const s = clamp(k, 0.3, 2);
    const seg = (a: Vec3, b: Vec3, w: number, d: number, dim: number): void => {
      S.x = b[0]; S.y = b[1]; S.z = b[2]; S.vx = b[0] - a[0]; S.vy = b[1] - a[1]; S.vz = b[2] - a[2];
      S.life = rf(0.07, 0.11); S.r = -3.6 * dim; S.g = -4.4 * dim; S.b = -8 * dim; S.w = w;
      S.grav = 0; S.drag = 0.01; S.streak = 1; S.bounce = 0; S.delay = d;
      spark();
    };
    for (const d of [0, rf(0.06, 0.1), rf(0.16, 0.24)]) {
      for (let i = 1; i < main.length; i++) seg(main[i - 1], main[i], 0.09 * s, d, 1.4);
      if (d === 0) for (const f of forks) for (let i = 1; i < f.length; i++) seg(f[i - 1], f[i], 0.035 * s, d, 0.7);
    }
    const end = main[main.length - 1], top = main[0];
    arcGlow(end[0], end[1], end[2], 3 * s, 40, 0.25);
    flash((top[0] + end[0]) / 2, 150, (top[2] + end[2]) / 2, 0xdfe8ff, 6e5 * s, 0.45, 700, 4);
    flash(end[0], end[1] + 2, end[2], 0xcfdcff, 2e4 * s, 0.3, 90, 4);
    const ns = Math.round(30 + 30 * s);
    for (let i = 0; i < ns; i++) {
      dirAround(0, 0.5, 0, 1);
      const sp = rf(3, 10);
      S.x = end[0]; S.y = end[1]; S.z = end[2]; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.4, 1.2); S.r = 6; S.g = 5.4; S.b = 4.8; S.w = rf(0.008, 0.014); S.grav = 1; S.drag = 0.8; S.streak = 0.03; S.bounce = 0.3;
      spark();
    }
  },

  /** ~2×/s at HV gear discharging into damp air: a faint violet glow round the conductor */
  corona(pos: Vec3, k: number): void {
    if (!ready || k < 0.02) return;
    const s = clamp(k, 0, 1.5), [x, y, z] = pos;
    pAt(x, y, z); P.variant = 3; P.life = rf(0.35, 0.55); P.s0 = 0.16 + 0.18 * s; P.s1 = P.s0 * 1.25; P.a = 0;
    pColor(0x9f7dff); P.heat = -(1.2 + 2.5 * s); P.heatDur = P.life; P.drag = 0; P.fadeIn = 0.15; P.spin = 0;
    emit();
    if (rng() < 0.25 * s) {
      dirAround(0, 1, 0, 1);
      S.x = x; S.y = y; S.z = z; S.vx = _v.x * 0.4; S.vy = _v.y * 0.4; S.vz = _v.z * 0.4;
      S.life = rf(0.05, 0.12); S.r = 2.2; S.g = 1.6; S.b = 4.5; S.w = 0.004; S.grav = 0; S.drag = 2; S.streak = 0.02; S.bounce = 0;
      spark();
    }
  },

  /** a wet live surface tracking: dry-band scintillation, tiny orange-blue sparks and a wisp of steam */
  tracking(pos: Vec3, k: number): void {
    if (!ready) return;
    const s = clamp(k, 0.05, 1), [x, y, z] = pos;
    const n = 1 + Math.round(rng() * 3 * s);
    for (let i = 0; i < n; i++) {
      dirAround(0, 0.3, 0, 1);
      const sp = rf(0.3, 1.5) * s;
      S.x = x + rf(-0.1, 0.1); S.y = y + rf(-0.1, 0.1); S.z = z + rf(-0.1, 0.1); S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.05, 0.18); S.r = rng() < 0.5 ? 5 : 2.5; S.g = 3.5; S.b = rng() < 0.5 ? 1.5 : 5; S.w = 0.005; S.grav = 0.5; S.drag = 1.5; S.streak = 0.02; S.bounce = 0.2;
      spark();
    }
    pAt(x, y, z); P.variant = 3; P.life = 0.08; P.s0 = 0.08 + 0.12 * s; P.s1 = P.s0; P.a = 0;
    pColor(0xbcd4ff); P.heat = -(3 + 5 * s); P.heatDur = 0.08; P.drag = 0; P.fadeIn = 0; P.spin = 0;
    emit();
    if (rng() < 0.3) {
      pAt(x, y, z); P.vy = rf(0.2, 0.5); P.life = rf(1, 1.6); P.s0 = 0.08; P.s1 = 0.35; pColor(0xd8dadc); P.a = 0.12; P.rise = 0.3; P.fadeIn = 0.1;
      emit();
    }
  },

  /** one tick (~10×/s) of a burning gas jet along `dir`: blue root, orange/yellow body, a little soot */
  gasJet(pos: Vec3, dir: Vec3, size: number): void {
    if (!ready) return;
    const sz = clamp(size, 0.1, 3), b = budget(), [x, y, z] = pos;
    unitDir(dir);
    const dx = _cd.x, dy = _cd.y, dz = _cd.z, root = Math.sqrt(sz);
    for (let i = 0; i < 2; i++) {
      pAt(x + dx * 0.05 * sz, y + dy * 0.05 * sz, z + dz * 0.05 * sz);
      P.delay = i * 0.05; P.variant = 3; P.vx = dx * 4 * root; P.vy = dy * 4 * root; P.vz = dz * 4 * root; P.drag = 4;
      P.life = 0.12; P.s0 = 0.18 * sz; P.s1 = 0.32 * sz; P.a = 0; pColor(0x4a78ff); P.heat = -7; P.heatDur = 0.12; P.fadeIn = 0; P.spin = 0;
      emit();
    }
    const n = Math.min(24, Math.round(7 * sz * b) + 2);
    for (let i = 0; i < n; i++) {
      dirAround(dx, dy, dz, 0.12);
      const sp = rf(7, 11) * root;
      pAt(x + dx * 0.15 * sz, y + dy * 0.15 * sz, z + dz * 0.15 * sz);
      P.delay = rf(0, 0.1); P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 2.5; P.rise = 1.2;
      P.life = rf(0.25, 0.5); P.s0 = 0.2 * sz; P.s1 = rf(0.6, 0.9) * sz; P.a = 0; P.heat = rf(6, 10); P.heatDur = P.life;
      P.spin = rf(-2, 2); P.wind = 0.3; P.fadeIn = 0.03;
      emit();
    }
    if (rng() < 0.5 * b) {
      pAt(x + dx * 1.4 * sz, y + dy * 1.4 * sz + 0.3 * sz, z + dz * 1.4 * sz);
      P.vx = dx * 1.5; P.vy = dy * 1.5 + 1; P.vz = dz * 1.5; P.drag = 0.8; P.rise = 0.9;
      // natural gas burns clean: a thin haze over the jet, not a smoke column
      P.life = rf(2, 4); P.s0 = 0.3 * sz; P.s1 = rf(1.4, 2) * sz; pColor(0x5c5751, rf(0.85, 1.15)); P.a = 0.14;
      P.wind = 1.2; P.fadeIn = 0.3; P.heat = 1.5; P.heatDur = 0.3;
      emit();
    }
    flash(x + dx * 0.8 * sz, y + dy * 0.8 * sz, z + dz * 0.8 * sz, 0xff8a3a, 40 * sz + 20, 0.35, 8 + 6 * sz, 1, 1.5);
  },

  /** one tick (~10×/s) of a burst water main: droplets arcing under gravity plus drifting mist */
  waterSpray(pos: Vec3, dir: Vec3, size: number): void {
    if (!ready) return;
    const sz = clamp(size, 0.1, 3), b = budget(), [x, y, z] = pos, k = dropK;
    unitDir(dir);
    const dx = _cd.x, dy = _cd.y, dz = _cd.z, root = Math.sqrt(sz);
    const n = Math.min(40, Math.round(14 * sz) + 4);
    for (let i = 0; i < n; i++) {
      dirAround(dx, dy, dz, 0.18);
      const sp = rf(6, 10) * root;
      S.x = x; S.y = y; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.6, 1.2); S.r = -0.55 * k; S.g = -0.62 * k; S.b = -0.7 * k; S.w = rf(0.004, 0.008) * (0.7 + 0.3 * sz);
      S.grav = 1; S.drag = 0.4; S.streak = 0.04; S.bounce = 0.15; S.delay = rf(0, 0.1);
      spark();
    }
    const nm = Math.max(1, Math.round(3 * b));
    for (let i = 0; i < nm; i++) {
      const t = rf(0.5, 1.5) * sz;
      pAt(x + dx * t, y + dy * t, z + dz * t);
      P.delay = rf(0, 0.1); P.vx = dx * 2 + rf(-0.4, 0.4); P.vy = dy * 2 + rf(-0.2, 0.3); P.vz = dz * 2 + rf(-0.4, 0.4); P.drag = 1.5;
      P.life = rf(1, 2); P.s0 = 0.2 * sz; P.s1 = rf(0.9, 1.4) * sz; pColor(0xe8eef2, rf(0.95, 1.05)); P.a = 0.18;
      P.rise = 0.1; P.accel = -0.2; P.fadeIn = 0.15; P.wind = 1;
      emit();
    }
  },

  /** one tick (~10×/s) of escaping steam: dense white plume that expands and rises */
  steamJet(pos: Vec3, dir: Vec3, size: number): void {
    if (!ready) return;
    const sz = clamp(size, 0.1, 3), b = budget(), grow = 1 / Math.sqrt(b), [x, y, z] = pos;
    unitDir(dir);
    const dx = _cd.x, dy = _cd.y, dz = _cd.z, root = Math.sqrt(sz);
    pAt(x + dx * 0.05, y + dy * 0.05, z + dz * 0.05);
    P.vx = dx * 10 * root; P.vy = dy * 10 * root; P.vz = dz * 10 * root; P.drag = 5;
    P.life = 0.4; P.s0 = 0.1 * sz; P.s1 = 0.5 * sz; pColor(0xf6f6f4); P.a = 0.7; P.fadeIn = 0.01;
    emit();
    const n = Math.min(20, Math.round((4 + 6 * sz) * b));
    for (let i = 0; i < n; i++) {
      dirAround(dx, dy, dz, 0.2);
      const sp = rf(5, 9) * root;
      pAt(x + dx * 0.1, y + dy * 0.1, z + dz * 0.1);
      P.delay = rf(0, 0.1); P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 2.2;
      P.life = rf(1.5, 3) + sz * 0.5; P.s0 = 0.12 * sz + 0.05; P.s1 = rf(1.2, 2) * sz * grow;
      pColor(0xf4f4f2, rf(0.95, 1.05)); P.a = 0.55; P.rise = 0.6; P.accel = 0.15; P.wind = 1; P.fadeIn = 0.04; P.spin = rf(-1, 1);
      emit();
    }
  },

  /** wind in m/s (world xz); drifts smoke and the lingering dust clouds */
  setWind(v: Vec3): void {
    wind.set(v[0], v[1] * 0.2, v[2]);
  },

  beacon(pos: Vec3, seconds: number): void {
    if (!ready) return;
    const e = claim(beacons);
    e.on = true; e.x = pos[0]; e.y = pos[1]; e.z = pos[2]; e.start = clock; e.end = clock + seconds; e.size = 1; e.a = e.b = e.c = 0;
  },

  /** one frame of a flamethrower's fuel in flight: lit, a rolling tongue of flame along its path that swells and
      sheds soot as it goes; unlit (a wet shot), a glistening amber streak */
  fuelGlob(from: Vec3, pos: Vec3, vel: Vec3, lit: boolean, age: number): void {
    if (!ready) return;
    const [x, y, z] = pos, b = budget();
    if (!lit) {
      S.x = x; S.y = y; S.z = z; S.vx = vel[0] * 0.3; S.vy = vel[1] * 0.3; S.vz = vel[2] * 0.3;
      S.life = 0.05; S.r = 0.9; S.g = 0.55; S.b = 0.15; S.w = 0.02; S.grav = 0; S.drag = 0; S.streak = 0.05; S.bounce = 0;
      spark();
      return;
    }
    const grow = clamp(age / 0.6, 0, 1);
    // tongues laid along the path it flew since the last frame, so the rope reads as one stream whatever the frame rate
    const dx = x - from[0], dy = y - from[1], dz = z - from[2];
    const n = clamp(Math.ceil(Math.hypot(dx, dy, dz) / (0.28 + 0.3 * grow)), 1, 10);
    for (let k = 0; k < n; k++) {
      const u = (k + rng()) / n;
      pAt(from[0] + dx * u + rf(-0.05, 0.05), from[1] + dy * u + rf(-0.05, 0.05), from[2] + dz * u + rf(-0.05, 0.05));
      P.vx = vel[0] * 0.2 + rf(-0.4, 0.4); P.vy = vel[1] * 0.2 + rf(0, 0.7); P.vz = vel[2] * 0.2 + rf(-0.4, 0.4); P.drag = 6; P.rise = 1;
      P.life = rf(0.1, 0.18); P.s0 = 0.14 + 0.45 * grow; P.s1 = P.s0 * rf(1.6, 2.2); P.a = 0; P.heat = rf(1.6, 2.8) * (1 - 0.35 * grow); P.heatDur = P.life;
      P.spin = rf(-2, 2); P.wind = 0.3; P.fadeIn = 0.02;
      emit();
    }
    if (rng() < (0.05 + 0.2 * grow) * b) {
      // a fuel-rich flame: dense black soot rolls off the tail of the stream
      pAt(x + rf(-0.2, 0.2), y + 0.2, z + rf(-0.2, 0.2));
      P.vx = vel[0] * 0.08 + rf(-0.3, 0.3); P.vy = rf(0.8, 1.8); P.vz = vel[2] * 0.08 + rf(-0.3, 0.3); P.drag = 1.2; P.rise = 1;
      P.life = rf(2.5, 4.5); P.s0 = 0.4 + 0.4 * grow; P.s1 = rf(1.8, 2.8); pColor(0x16130f, rf(0.8, 1.2)); P.a = 0.55;
      P.wind = 1.1; P.fadeIn = 0.15; P.heat = 1.2; P.heatDur = 0.25; P.curl = 0.3;
      emit();
    }
  },

  /** one tick (~5×/s) of burning fuel on a surface: sooty tongues of flame of the fire's own height and a
      column of heavy black smoke (thickened fuel burns fuel-rich: polystyrene and benzene soot) */
  fuelFire(pos: Vec3, size: number, flameH: number, lit: boolean): void {
    if (!ready) return;
    const b = budget(), sz = clamp(size, 0.12, 2.5), H = clamp(flameH, 0.2, 5);
    if (!lit) {
      if (rng() < 0.3) { pAt(pos[0], pos[1] + 0.05, pos[2]); P.life = rf(1, 2); P.s0 = sz * 0.5; P.s1 = sz; pColor(0x8c7a55, 0.6); P.a = 0.08; P.rise = 0.2; P.drag = 1; emit(); }
      return;
    }
    const n = Math.max(3, Math.round((9 + 12 * sz + 3 * H) * b));
    for (let i = 0; i < n; i++) {
      // the flame's body stands the fire's own height: tongues born up the column, narrowing to the tip
      const r = rf(0, 0.45 * sz), ang = rf(0, 6.283), h = rng() * rng() * H * 0.7;
      const w = sz * (1 - 0.6 * h / H) + 0.15;
      pAt(pos[0] + Math.cos(ang) * r, pos[1] + h + rf(0, 0.15), pos[2] + Math.sin(ang) * r);
      P.vx = rf(-0.3, 0.3); P.vy = rf(1, 2) + H * 0.35; P.vz = rf(-0.3, 0.3); P.drag = 1.4; P.rise = 0.5;
      P.life = rf(0.35, 0.7); P.s0 = w * rf(0.9, 1.4); P.s1 = w * 0.4; P.a = 0; P.heat = rf(2, 3.4); P.heatDur = P.life;
      P.spin = rf(-1.5, 1.5); P.wind = 0.6; P.fadeIn = 0.05;
      emit();
    }
    if (rng() < 0.75 * b) {
      pAt(pos[0] + rf(-0.2, 0.2) * sz, pos[1] + H * 0.9, pos[2] + rf(-0.2, 0.2) * sz);
      P.vx = rf(-0.3, 0.3); P.vy = rf(1.4, 2.4); P.vz = rf(-0.3, 0.3); P.drag = 0.6; P.rise = 1.1;
      P.life = rf(5, 9); P.s0 = sz * 0.6 + 0.2; P.s1 = sz * rf(2.6, 3.8) + 1; pColor(0x14110e, rf(0.8, 1.2)); P.a = 0.62;
      P.wind = 1.2; P.fadeIn = 0.3; P.heat = 1.4; P.heatDur = 0.35; P.curl = 0.35;
      emit();
    }
    if (rng() < 0.25 * b) {
      S.x = pos[0] + rf(-0.3, 0.3) * sz; S.y = pos[1] + H * 0.4; S.z = pos[2] + rf(-0.3, 0.3) * sz;
      S.vx = rf(-0.8, 0.8); S.vy = rf(1.5, 3.5); S.vz = rf(-0.8, 0.8);
      S.life = rf(1, 2.2); S.r = 3; S.g = 1.3; S.b = 0.35; S.w = 0.009; S.grav = 0.1; S.drag = 1.4; S.streak = 0.02; S.bounce = 0.2;
      spark();
    }
  },

  /** a launcher's backblast: a hot flash out of the tube's back and a long cone of dust and gas along the ground */
  backblast(pos: Vec3, dir: Vec3, reach: number, gas: number): void {
    if (!ready) return;
    const b = Math.max(0.5, budget()), n = Math.round((10 + 8 * gas) * b);
    for (let i = 0; i < n; i++) {
      dirAround(dir[0], dir[1] - 0.15, dir[2], 0.45);
      const sp = rf(0.3, 1) * reach * 1.6;
      // born well behind the firer: a puff this size started at the tube's end would swallow his own view
      const o = rf(1.6, 2.4);
      pAt(pos[0] + dir[0] * o, pos[1] - 0.2 + dir[1] * o, pos[2] + dir[2] * o);
      P.vx = _v.x * sp; P.vy = _v.y * sp * 0.4; P.vz = _v.z * sp; P.drag = 2.4;
      P.life = rf(1.5, 3.5); P.s0 = 0.4; P.s1 = rf(1.5, 3) * (0.7 + 0.3 * gas); pColor(0xb9ad98, rf(0.85, 1.1)); P.a = rf(0.3, 0.5);
      P.rise = 0.15; P.wind = 0.8; P.fadeIn = 0.04; P.heat = i < 3 ? 6 : 0; P.heatDur = 0.08;
      emit();
    }
    flash(pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2], 0xffc080, 50 + 40 * gas, 0.12, 12, 2);
  },

  /** a thermobaric burster throwing its fuel out: a grey-white aerosol cloud swelling to fill the box for `delay` s */
  fuelCloud(min: Vec3, max: Vec3, at: Vec3, delay: number): void {
    if (!ready) return;
    const b = Math.max(0.6, budget());
    const n = Math.round(22 * b);
    for (let i = 0; i < n; i++) {
      const tx = rf(min[0], max[0]), ty = rf(min[1], Math.min(max[1], min[1] + 3)), tz = rf(min[2], max[2]);
      pAt(at[0], at[1], at[2]);
      const k = 1 / Math.max(0.05, delay);
      P.vx = (tx - at[0]) * k * 1.4; P.vy = (ty - at[1]) * k * 1.4; P.vz = (tz - at[2]) * k * 1.4; P.drag = 7;
      P.life = delay + rf(0.08, 0.2); P.s0 = 0.3; P.s1 = rf(1.4, 2.2); pColor(0xd9d4c4, rf(0.9, 1.05)); P.a = 0.5;
      P.fadeIn = 0.02; P.rise = 0.1; P.wind = 0.3; P.heat = 0; P.heatDur = 0;
      emit();
    }
    flash(at[0], at[1], at[2], 0xfff0d8, 60, 0.06, 10, 2);
  },

  /** the cloud going up: flame through the whole box, then a rolling sooty fireball rising out of it */
  fuelFireball(min: Vec3, max: Vec3, c: Vec3): void {
    if (!ready) return;
    const b = Math.max(0.6, budget());
    const ex = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const n = Math.round(70 * b);
    for (let i = 0; i < n; i++) {
      pAt(rf(min[0], max[0]), rf(min[1], max[1]), rf(min[2], max[2]));
      // the cloud burns for over a second as the flame runs through it and the rich core mixes: a slow, rolling ball
      P.delay = rf(0, 0.5) * rng();
      P.vx = (P.x - c[0]) * rf(1.5, 3); P.vy = (P.y - c[1]) * rf(1.5, 3) + rf(0.5, 2); P.vz = (P.z - c[2]) * rf(1.5, 3); P.drag = 3;
      P.life = rf(0.9, 1.9); P.s0 = rf(1.2, 2); P.s1 = rf(2.4, 3.6); P.a = 0; P.heat = rf(4, 7); P.heatDur = P.life * 0.8;
      P.spin = rf(-1, 1); P.fadeIn = 0.01; P.rise = 1.2; P.wind = 0.3;
      emit();
    }
    for (let i = 0; i < Math.round(18 * b); i++) {
      pAt(c[0] + rf(-0.4, 0.4) * ex, c[1] + rf(0, 0.5) * ex, c[2] + rf(-0.4, 0.4) * ex);
      P.delay = rf(0.3, 0.9); P.vx = rf(-1, 1); P.vy = rf(2, 4); P.vz = rf(-1, 1); P.drag = 0.8; P.rise = 1.2;
      P.life = rf(5, 9); P.s0 = ex * 0.2 + 0.5; P.s1 = ex * rf(0.5, 0.8) + 2; pColor(0x1e1a16, rf(0.8, 1.2)); P.a = 0.6;
      P.wind = 1; P.fadeIn = 0.3; P.heat = rf(1.5, 3); P.heatDur = 0.8; P.curl = 0.4;
      emit();
    }
    flash(c[0], c[1] + 1, c[2], 0xffa24a, 260 + 60 * ex * ex, 1.8, 12 + ex * 5, 3);
  },

  /** a fragment's flight from a burst to where it lands: a fast hot streak, a spark where it strikes */
  fragTrace(from: Vec3, to: Vec3, struck: boolean): void {
    if (!ready) return;
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return;
    const sp = 260;
    S.x = from[0]; S.y = from[1]; S.z = from[2]; S.vx = (dx / L) * sp; S.vy = (dy / L) * sp; S.vz = (dz / L) * sp;
    S.life = Math.min(0.2, L / sp); S.r = 6; S.g = 4.4; S.b = 2.2; S.w = 0.006; S.grav = 0; S.drag = 0; S.streak = 0.012; S.bounce = 0;
    spark();
    if (!struck) return;
    for (let i = 0; i < 3; i++) {
      dirAround(-dx / L, -dy / L, -dz / L, 0.9);
      const v = rf(3, 9);
      S.delay = L / sp;
      S.x = to[0]; S.y = to[1]; S.z = to[2]; S.vx = _v.x * v; S.vy = _v.y * v; S.vz = _v.z * v;
      S.life = rf(0.15, 0.35); S.r = 5; S.g = 3.4; S.b = 1.4; S.w = 0.006; S.grav = 1; S.drag = 1.5; S.streak = 0.02; S.bounce = 0.3;
      spark();
    }
  },

  /** a fire's light, re-lit each call at the same spot (fuel fires, the flamer's stream): k ~ MW of flame */
  fireLight(pos: Vec3, k: number): void {
    if (!ready || k <= 0) return;
    flash(pos[0], pos[1], pos[2], 0xff7c2a, clamp(30 + 25 * k, 20, 150), 0.35, clamp(10 + 5 * k, 10, 28), 1, 3.5);
  },

  update(dt: number): void {
    if (!ready) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    clock += dt;
    animateMaterials(clock);
    if (litVersion !== lighting.version) applyLighting();
    const b = budget();
    for (const f of fires) if (f.on) updateFire(f, dt, b);
    for (const e of beacons) if (e.on) updateBeacon(e, dt);
    for (const e of arcs) if (e.on) updateArc(e, dt);
    updateLights(dt);
    chips.update(dt);
    splinterChips.update(dt);
    shardChips.update(dt);
    diceChips.update(dt);
    fineChips.update(dt);
    puffU.uTime.value = clock;
    sparkU.uTime.value = clock;
    sparkU.uAspect.value = view.width / Math.max(1, view.height);
    sparkU.uPx.value = 1.6 / Math.max(1, view.height);
    scorchU.uTime.value = clock;
    ringU.uTime.value = clock;
    updateClouds(dt);
    puffs.flush();
    dustR.flush();
    sparksR.flush();
    scorches.flush();
    rings.flush();
    puffLoad = puffs.alive(clock) / PUFFS;
  },

  clear(): void {
    if (!ready) return;
    puffs.reset(); dustR.reset(); sparksR.reset(); scorches.reset(); rings.reset();
    for (const c of clouds) c.on = false;
    for (const k of dustU.uDvCloudP.value) k.x = 0;
    dustU.uDvCloudN.value = 0;
    atmosU.uDustFog.value.set(0, 0, 0, 0);
    dustAlive = 0;
    coverage.data.fill(0);
    coverage.tex.needsUpdate = true;
    coverage.dirty = false;
    chips.clear(); splinterChips.clear(); shardChips.clear(); diceChips.clear(); fineChips.clear();
    for (const f of fires) f.on = false;
    for (const e of beacons) e.on = false;
    for (const e of arcs) e.on = false;
    for (const f of flashes) { f.prio = 0; f.owner = -1; f.light.intensity = 0; }
    flashAtCamera.setRGB(0, 0, 0);
    puffLoad = 0;
    clock = 0;
    rng = makeRng(0x5eed);
  },

  /** one tick (~10×/s) of an unlit gas leak: natural gas is invisible, so only a faint cold haze and, from a
      big hole, grit blown along the jet */
  gasVent(pos: Vec3, dir: Vec3, size: number): void {
    if (!ready) return;
    const sz = clamp(size, 0.1, 3), b = budget(), [x, y, z] = pos;
    unitDir(dir);
    const dx = _cd.x, dy = _cd.y, dz = _cd.z, root = Math.sqrt(sz);
    const n = Math.max(1, Math.min(6, Math.round(3 * sz * b)));
    for (let i = 0; i < n; i++) {
      dirAround(dx, dy, dz, 0.15);
      const sp = rf(4, 8) * root;
      pAt(x + dx * 0.05, y + dy * 0.05, z + dz * 0.05);
      P.delay = rf(0, 0.1); P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 3; P.rise = 0.4;
      P.life = rf(0.4, 0.8); P.s0 = 0.08 * sz; P.s1 = rf(0.5, 0.8) * sz; pColor(0xdfe5ea, rf(0.97, 1.03)); P.a = 0.07;
      P.fadeIn = 0.02; P.wind = 1; P.spin = rf(-1, 1);
      emit();
    }
    if (sz > 0.8 && rng() < 0.4 * b) {
      const ns = Math.min(10, Math.round(4 * sz));
      for (let i = 0; i < ns; i++) {
        dirAround(dx, dy, dz, 0.25);
        const sp = rf(4, 9) * root;
        S.x = x; S.y = y; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
        S.life = rf(0.3, 0.7); S.r = 0.35; S.g = 0.32; S.b = 0.28; S.w = rf(0.004, 0.008); S.grav = 1; S.drag = 1.2; S.streak = 0.02; S.bounce = 0.2; S.delay = rf(0, 0.1);
        spark();
      }
    }
  },

  /** torn fabric: scraps and lint shed from a rip */
  fabricShreds(pos: Vec3, count: number, color: number): void {
    if (!ready) return;
    _c.setHex(color);
    const n = clamp(Math.round(count * (chips.load() < 0.75 ? 1 : 0.4)), 0, 24);
    for (let i = 0; i < n; i++) {
      dirAround(0, 0.4, 0, 1);
      const sp = rf(0.8, 3.5);
      chips.spawn(pos[0] + rf(-0.2, 0.2), pos[1] + rf(-0.2, 0.2), pos[2] + rf(-0.2, 0.2), _v.x * sp, _v.y * sp, _v.z * sp, rf(0.015, 0.04), rf(3, 5), _c);
    }
    pAt(pos[0], pos[1], pos[2]);
    P.vx = rf(-0.2, 0.2); P.vy = rf(0.1, 0.3); P.vz = rf(-0.2, 0.2); P.drag = 1.5; P.rise = 0.1;
    P.life = rf(1.5, 2.5); P.s0 = 0.2; P.s1 = rf(0.6, 0.9); pColor(color, 1.1); P.a = 0.18; P.fadeIn = 0.05; P.wind = 1;
    emit();
  },

  /** grain spilling out of a split bag or bin: a spray of grit and a low dust puff */
  grainSpill(pos: Vec3, dir: Vec3, count: number, color: number): void {
    if (!ready) return;
    _c.setHex(color);
    const n = clamp(Math.round(count * (chips.load() < 0.75 ? 1 : 0.4)), 0, 48);
    for (let i = 0; i < n; i++) {
      dirAround(dir[0], dir[1], dir[2], 0.9);
      const sp = rf(1, 4);
      chips.spawn(pos[0], pos[1], pos[2], _v.x * sp, _v.y * sp, _v.z * sp, rf(0.01, 0.03), rf(3, 5), _c);
    }
    this.dust(pos, 0.8, color);
  },

  /* ---------------- machining (held cutting tools) ---------------- */

  /** one tick (~20/s) of a disc on metal: a spark stream flung along `dir`, hot chips that cool where they land */
  grindSparks(pos: Vec3, dir: Vec3, k: number, glow: number): void {
    const m = machFx();
    if (!m) return;
    const [x, y, z] = pos;
    const n = Math.round(rf(10, 16) * clamp(k, 0, 2));
    for (let i = 0; i < n; i++) {
      dirAround(dir[0], dir[1], dir[2], 0.35);
      const sp = rf(6, 17);
      S.x = x; S.y = y; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.3, 0.9); S.r = 6; S.g = 3.2 + glow; S.b = 1.1; S.w = rf(0.005, 0.01); S.grav = 1; S.drag = 0.9; S.streak = 0.05; S.bounce = 0.4;
      spark();
    }
    for (let i = 0, c = rng() < 0.7 ? 2 : 1; i < c; i++) {
      dirAround(dir[0], dir[1], dir[2], 0.5);
      const sp = rf(3, 8);
      m.bits.spawn(x, y, z, _v.x * sp, _v.y * sp, _v.z * sp, rf(900, 1250), rf(0.004, 0.009), 0, 0x4a4d52);
    }
    flash(x, y, z, 0xffae5a, rf(7, 13) * k, 0.08, 4, 1, 0.8);
  },

  /** one tick of a diamond disc or drill in mineral: a dust plume along `dir` and fine grit */
  cutDust(pos: Vec3, dir: Vec3, k: number, color: number): void {
    const m = machFx();
    if (!m) return;
    const [x, y, z] = pos, b = budget(), kk = clamp(k, 0, 2);
    for (let i = 0, n = Math.max(1, Math.round(2 * kk * b)); i < n; i++) {
      dirAround(dir[0], dir[1], dir[2], 0.3);
      const sp = rf(2, 5);
      pAt(x, y, z);
      P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 2.2; P.rise = 0.12;
      P.life = rf(2, 4); P.s0 = 0.06; P.s1 = rf(0.6, 1.1); pColor(color, rf(0.95, 1.08)); P.a = 0.32; P.fadeIn = 0.03; P.wind = 1; P.curl = 0.2;
      emit();
    }
    _c.setHex(color).multiplyScalar(0.8);
    for (let i = 0, n = Math.round(3 * kk); i < n; i++) {
      dirAround(dir[0], dir[1], dir[2], 0.45);
      const sp = rf(2, 6);
      chips.spawn(x, y, z, _v.x * sp, _v.y * sp, _v.z * sp, rf(0.006, 0.015), rf(2, 4), _c);
    }
    if (rng() < 0.15 * kk) feedCloud(x, y, z, 0.05 * kk, color);
  },

  /** one tick of teeth in timber: a stream of chips and sawdust, the odd splinter */
  sawdust(pos: Vec3, dir: Vec3, k: number, dust: number, chip: number): void {
    const m = machFx();
    if (!m) return;
    const [x, y, z] = pos, kk = clamp(k, 0, 2);
    _c.setHex(chip).lerp(_c2.setHex(0xe8cf9c), 0.45);
    for (let i = 0, n = Math.round(6 * kk); i < n; i++) {
      dirAround(dir[0], dir[1], dir[2], 0.3);
      const sp = rf(3, 9);
      chips.spawn(x, y, z, _v.x * sp, _v.y * sp, _v.z * sp, rf(0.004, 0.01), rf(3, 6), _c);
    }
    if (rng() < 0.2 * kk) {
      _c.setHex(chip);
      dirAround(dir[0], dir[1], dir[2], 0.5);
      splinterChips.spawn(x, y, z, _v.x * 4, _v.y * 4, _v.z * 4, rf(0.03, 0.08), rf(4, 6), _c);
    }
    if (rng() < 0.6 * budget()) {
      pAt(x, y, z);
      P.vx = dir[0] * 2; P.vy = dir[1] * 2 + 0.2; P.vz = dir[2] * 2; P.drag = 2; P.rise = 0.05;
      P.life = rf(1.5, 3); P.s0 = 0.05; P.s1 = rf(0.4, 0.7); pColor(dust, 1.05); P.a = 0.25; P.fadeIn = 0.03; P.wind = 1;
      emit();
    }
  },

  /** one tick of a cutter boring steel: curled swarf thrown off the face, straw → blue with heat */
  swarf(pos: Vec3, normal: Vec3, k: number, hot: number): void {
    const m = machFx();
    if (!m) return;
    const [x, y, z] = pos;
    if (rng() < 0.55 * k) {
      dirAround(normal[0], normal[1] + 0.3, normal[2], 0.8);
      const sp = rf(1, 3);
      m.bits.spawn(x, y, z, _v.x * sp, _v.y * sp, _v.z * sp, 180 + hot * rf(120, 260), rf(0.012, 0.022), 1, 0x8d9399);
    }
    if (hot > 0.6 && rng() < 0.3) fx.sparks(pos, normal, 2);
  },

  /** one tick of a plasma arc: blue-white glare that lights the site, molten dross dripping out of the far side, fume */
  plasmaArc(pos: Vec3, normal: Vec3, k: number, through: number): void {
    const m = machFx();
    if (!m) return;
    const [x, y, z] = pos, kk = clamp(k, 0, 2);
    const fl = rf(0.7, 1.15);
    arcGlow(x + normal[0] * 0.02, y + normal[1] * 0.02, z + normal[2] * 0.02, 0.18 * fl, 22 * kk, 0.06);
    arcGlow(x, y, z, 0.6 * fl, 4 * kk, 0.05);
    // dross leaves through the bottom of the kerf, the far side of the plate
    const bx = x - normal[0] * 0.03, by = y - normal[1] * 0.03 - 0.02, bz = z - normal[2] * 0.03;
    for (let i = 0, n = Math.round(rf(4, 8) * kk * (0.4 + 0.6 * through + 0.3)); i < n; i++) {
      dirAround(-normal[0], -normal[1] - 0.8, -normal[2], 0.5);
      const sp = rf(1.5, 5);
      S.x = bx; S.y = by; S.z = bz; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
      S.life = rf(0.5, 1.4); S.r = 5.5; S.g = 2.4; S.b = 0.7; S.w = rf(0.01, 0.02); S.grav = 1; S.drag = 1.5; S.streak = 0.015; S.bounce = 0.006;
      spark();
    }
    if (rng() < 0.5) {
      dirAround(-normal[0] * 0.3, -1, -normal[2] * 0.3, 0.3);
      m.bits.spawn(bx, by, bz, _v.x, _v.y, _v.z, rf(1400, 1550), rf(0.006, 0.012), 0, 0x3b3a38);
    }
    if (rng() < 0.5 * budget()) {
      pAt(x + normal[0] * 0.05, y + 0.05, z + normal[2] * 0.05);
      P.vx = normal[0] * 0.6; P.vy = rf(0.6, 1.2); P.vz = normal[2] * 0.6; P.drag = 1.2; P.rise = 0.6;
      P.life = rf(2, 3.5); P.s0 = 0.05; P.s1 = rf(0.5, 0.9); pColor(0xb6b8bc); P.a = 0.2; P.fadeIn = 0.03; P.wind = 1.1;
      emit();
    }
    flash(x + normal[0] * 0.15, y + normal[1] * 0.15, z + normal[2] * 0.15, 0xcfe0ff, rf(70, 160) * kk * fl, 0.07, 16, 1, 1);
  },

  /** one tick of an oxy-fuel torch: blue cones, then with the oxygen on a shower of slag through the cut */
  torchFlame(pos: Vec3, dir: Vec3, preheat: number, cutting: boolean): void {
    const m = machFx();
    if (!m) return;
    const [x, y, z] = pos;
    for (let i = 0; i < 2; i++) {
      const d = rf(0.01, 0.05);
      pAt(x + dir[0] * d, y + dir[1] * d, z + dir[2] * d);
      P.variant = 3; P.life = rf(0.06, 0.1); P.s0 = rf(0.05, 0.08); P.s1 = P.s0 * 0.6; P.a = 0;
      pColor(i ? 0xffb86a : 0x8fb6ff); P.heat = -(i ? 8 : 14); P.heatDur = P.life; P.drag = 0; P.fadeIn = 0; P.spin = 0;
      emit();
    }
    if (preheat > 0.3 && rng() < preheat * 0.4) fx.sparks(pos, dir, 1);
    if (cutting) {
      for (let i = 0, n = Math.round(rf(8, 14)); i < n; i++) {
        dirAround(-dir[0], -dir[1] - 0.5, -dir[2], 0.6);
        const sp = rf(2, 7);
        S.x = x - dir[0] * 0.04; S.y = y - dir[1] * 0.04; S.z = z - dir[2] * 0.04; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
        S.life = rf(0.5, 1.2); S.r = 5.6; S.g = 3; S.b = 0.9; S.w = rf(0.008, 0.016); S.grav = 1; S.drag = 1.1; S.streak = 0.03; S.bounce = 0.1;
        spark();
      }
      if (rng() < 0.6) {
        dirAround(-dir[0], -dir[1] - 0.5, -dir[2], 0.6);
        m.bits.spawn(x, y, z, _v.x * 2, _v.y * 2, _v.z * 2, rf(1300, 1500), rf(0.006, 0.014), 0, 0x2e2b28);
      }
    }
    flash(x + dir[0] * 0.1, y + dir[1] * 0.1, z + dir[2] * 0.1, cutting ? 0xffc27a : 0xa8c4ff, (cutting ? 45 : 14) * rf(0.8, 1.1), 0.1, cutting ? 8 : 4, 1, 1);
  },

  /** jaws through a steel section: screech sparks along the lip, flakes of mill scale, a torn bright edge */
  shearLip(pos: Vec3, dir: Vec3, width: number, metal: boolean): void {
    const m = machFx();
    if (!m) return;
    const L = clamp(width, 0.05, 1.5);
    for (let i = 0, n = Math.round(10 + L * 30); i < n; i++) {
      const s = rf(-0.5, 0.5) * L;
      const px = pos[0] + dir[0] * s, py = pos[1] + dir[1] * s, pz = pos[2] + dir[2] * s;
      if (metal) {
        dirAround(0, 0.4, 0, 1);
        const sp = rf(2, 7);
        S.x = px; S.y = py; S.z = pz; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
        S.life = rf(0.15, 0.45); S.r = 6; S.g = 4.6; S.b = 2.8; S.w = rf(0.004, 0.008); S.grav = 1; S.drag = 1.2; S.streak = 0.03; S.bounce = 0.3;
        spark();
      }
      if (i % 3 === 0) {
        _c.setHex(metal ? 0x2d2c2a : 0x8a6238);
        dirAround(0, 0.5, 0, 1);
        chips.spawn(px, py, pz, _v.x * 2, _v.y * 2, _v.z * 2, rf(0.008, 0.02), rf(3, 5), _c);
      }
    }
    if (metal) m.bits.spawn(pos[0], pos[1], pos[2], 0, 0.5, 0, 450, 0.01, 0, 0x6e7378);
    flash(pos[0], pos[1], pos[2], 0xffe0b0, 12, 0.06, 4, 1);
  },

  /** crusher jaws closing on concrete: pulverised core, chunks, a dust burst */
  crush(pos: Vec3, normal: Vec3, dust: number, chip: number): void {
    if (!machFx()) return;
    fx.debris(pos, 14, chip, 3.5, normal);
    fx.powder(pos, 0.6, dust);
    fx.dust(pos, 0.9, dust);
  },

  /** a splitter opening a block: a line of dust and grit along the crack, chips kicked out of the face */
  crack(pos: Vec3, dir: Vec3, normal: Vec3, length: number, dust: number, chip: number): void {
    if (!ready) return;
    const L = clamp(length, 0.2, 4);
    for (let i = 0, n = Math.min(10, Math.round(3 + L * 4)); i < n; i++) {
      const s = ((i + 0.5) / n - 0.5) * L;
      const p: Vec3 = [pos[0] + dir[0] * s, pos[1] + dir[1] * s, pos[2] + dir[2] * s];
      fx.debris(p, 2, chip, 2, normal);
      if (i % 2 === 0) fx.powder(p, 0.3, dust);
    }
    fx.dust(pos, 0.5 + L * 0.3, dust);
  },

  /** one tick (~20/s) of a water stream section: droplets launched along `vel` (m/s) that fall as the jet does */
  waterJet(pos: Vec3, vel: Vec3, spread: number, size: number): void {
    if (!ready) return;
    const b = budget(), k = dropK, sp = Math.hypot(vel[0], vel[1], vel[2]) || 1;
    const dx = vel[0] / sp, dy = vel[1] / sp, dz = vel[2] / sp;
    const n = Math.min(24, Math.round((8 + 8 * size) * b) + 2);
    for (let i = 0; i < n; i++) {
      dirAround(dx, dy, dz, spread);
      const v = sp * rf(0.85, 1.05);
      const t = rf(0, 1);
      S.x = pos[0] + vel[0] * t * 0.05; S.y = pos[1] + vel[1] * t * 0.05; S.z = pos[2] + vel[2] * t * 0.05;
      S.vx = _v.x * v; S.vy = _v.y * v; S.vz = _v.z * v;
      S.life = rf(0.08, 0.2); S.r = -0.6 * k; S.g = -0.66 * k; S.b = -0.74 * k; S.w = rf(0.006, 0.012) * size;
      S.grav = 1; S.drag = 0.2; S.streak = 0.05; S.bounce = 0.1; S.delay = rf(0, 0.05);
      spark();
    }
    if (rng() < 0.35 * b) {
      pAt(pos[0], pos[1], pos[2]);
      P.vx = dx * 3; P.vy = dy * 3; P.vz = dz * 3; P.drag = 1.5;
      P.life = rf(0.8, 1.6); P.s0 = 0.15 * size; P.s1 = rf(0.6, 1) * size; pColor(0xe8eef2); P.a = 0.12 + 0.1 * spread;
      P.rise = 0.05; P.fadeIn = 0.1; P.wind = 1;
      emit();
    }
  },

  /** the kerf breaking through: a last burst along the cut line */
  cutThrough(pos: Vec3, dir: Vec3, length: number, mode: string): void {
    const m = machFx();
    if (!m) return;
    const L = clamp(length, 0.05, 4);
    for (let i = 0, n = Math.min(24, Math.round(6 + L * 10)); i < n; i++) {
      const s = rf(-0.5, 0.5) * L;
      const px = pos[0] + dir[0] * s, py = pos[1] + dir[1] * s, pz = pos[2] + dir[2] * s;
      if (mode === 'abrasive' || mode === 'plasma' || mode === 'oxy') {
        dirAround(0, -0.3, 0, 1);
        const sp = rf(2, 8);
        S.x = px; S.y = py; S.z = pz; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
        S.life = rf(0.3, 0.8); S.r = mode === 'plasma' ? 5 : 6; S.g = mode === 'plasma' ? 4.8 : 3.4; S.b = mode === 'plasma' ? 5 : 1.2;
        S.w = rf(0.006, 0.012); S.grav = 1; S.drag = 1.2; S.streak = 0.04; S.bounce = 0.3;
        spark();
      } else if (i % 4 === 0) {
        pAt(px, py, pz);
        P.vx = rf(-0.4, 0.4); P.vy = rf(0, 0.5); P.vz = rf(-0.4, 0.4); P.drag = 2; P.rise = 0.1;
        P.life = rf(1.5, 3); P.s0 = 0.08; P.s1 = rf(0.5, 0.8); pColor(mode === 'teeth' ? 0xc9b48e : 0xb8b2a8); P.a = 0.3; P.fadeIn = 0.04;
        emit();
      }
    }
  },

  /** a live kerf decal on the member face (one per slot per frame): dark line across the member, the cut
      part glowing with its heat, a bright front showing how far through it is, and the torch's preheat spot */
  kerf(slot: number, pos: Vec3, across: Vec3, normal: Vec3, length: number, progress: number, width: number, glow: number, preheat: number): void {
    const m = machFx();
    if (!m || slot < 0 || slot >= m.kerfs.length) return;
    const k = m.kerfs[slot];
    k.seen = 2;
    k.g.visible = true;
    basisAt(k.g, pos, across, normal);
    const L = Math.max(0.02, length), x = clamp(progress, 0, 1), w = Math.max(0.004, width * 1.6);
    k.line.scale.set(L, 1, w);
    k.lineMat.opacity = 0.25 + 0.6 * x;
    k.cut.visible = x > 0.001;
    k.cut.scale.set(L * x, 1, w * 1.4);
    k.cut.position.x = -L / 2 + (L * x) / 2;
    heatRGB(450 + 1000 * glow, k.cutMat.color);
    k.cutMat.color.multiplyScalar(0.35 + 0.65 * glow);
    k.tip.visible = x > 0.001 && x < 0.999;
    k.tip.position.x = -L / 2 + L * x;
    k.tip.scale.setScalar(0.02 + 0.03 * glow);
    heatRGB(900 + 700 * glow, k.tipMat.color);
    k.spot.visible = preheat > 0.01;
    k.spot.scale.setScalar(0.02 + 0.05 * preheat);
    heatRGB(500 + 450 * preheat, k.spotMat.color);
    k.spotMat.color.multiplyScalar(preheat);
  },

  /** a bored hole (or one in progress) on the member face */
  bore(slot: number, pos: Vec3, normal: Vec3, radius: number, progress: number, glow: number): void {
    const m = machFx();
    if (!m || slot < 0 || slot >= m.bores.length) return;
    const b = m.bores[slot];
    b.seen = 2;
    b.g.visible = true;
    _bx.set(1, 0, 0);
    if (Math.abs(normal[0]) > 0.9) _bx.set(0, 0, 1);
    _bn.set(normal[0], normal[1], normal[2]).normalize();
    _bz.copy(_bn).multiplyScalar(_bx.dot(_bn));
    _bx.sub(_bz).normalize();
    basisAt(b.g, pos, [_bx.x, _bx.y, _bx.z], normal);
    const x = clamp(progress, 0, 1);
    b.hole.scale.setScalar(Math.max(0.004, radius * (0.35 + 0.65 * x)));
    b.holeMat.opacity = 0.5 + 0.45 * x;
    b.rim.visible = glow > 0.02;
    b.rim.scale.setScalar(radius * 1.15);
    heatRGB(450 + 1000 * glow, b.rimMat.color);
  },

  /** per rendered frame: cools and moves hot chips and swarf, hides decals nobody refreshed */
  machiningFrame(dt: number): void {
    if (!mach) return;
    const d = Math.min(Math.max(dt, 0), 0.1);
    mach.bits.update(d);
    for (const k of mach.kerfs) if (k.seen > 0 && --k.seen === 0) k.g.visible = false;
    for (const b of mach.bores) if (b.seen > 0 && --b.seen === 0) b.g.visible = false;
  },

  clearMachining(): void {
    if (!mach) return;
    mach.bits.clear();
    for (const k of mach.kerfs) { k.seen = 0; k.g.visible = false; }
    for (const b of mach.bores) { b.seen = 0; b.g.visible = false; }
  },

  /** one billow of smoke or steam at a gas-field voxel, carried off at the local flow velocity */
  fieldSmoke(pos: Vec3, vel: Vec3, size: number, alpha: number, color: number): void {
    if (!ready || budget() < 0.35) return;
    pAt(pos[0], pos[1], pos[2]);
    P.vx = vel[0] * 0.8 + rf(-0.15, 0.15); P.vy = vel[1] * 0.8 + rf(0, 0.2); P.vz = vel[2] * 0.8 + rf(-0.15, 0.15); P.drag = 0.8;
    // many thin billows that spread as they rise: a plume, not a string of opaque balls
    P.rise = 0.15; P.life = rf(3, 5); P.s0 = size * 0.7; P.s1 = size * rf(2, 2.8);
    pColor(color, rf(0.92, 1.06)); P.a = alpha * 0.55; P.fadeIn = 0.8; P.wind = 0.7; P.curl = 0.5; P.spin = rf(-0.3, 0.3);
    emit();
  },
};

const _impactDir: Vec3 = [0, 1, 0];
const HEAVY_MINERAL = new Set<MaterialId>(['concrete', 'rconcrete', 'brick', 'cinderblock', 'stone', 'sandstone', 'marble', 'asphalt']);

interface ImpactDef { dust: number; dustC: number; chip: number; chipC: number; kind: 'chips' | 'splinters' | 'shards' | 'dice'; sparks: number; powder?: boolean }
const IMPACT: Record<MaterialId, ImpactDef> = {
  concrete: { dust: 1, dustC: 0xbdb8ae, chip: 1, chipC: 0x9a978f, kind: 'chips', sparks: 0.1 },
  brick: { dust: 1, dustC: 0xb27a62, chip: 1, chipC: 0x9b4a32, kind: 'chips', sparks: 0 },
  plaster: { dust: 1.2, dustC: 0xe2ddd0, chip: 0.8, chipC: 0xd8d2c4, kind: 'chips', sparks: 0 },
  wood: { dust: 0.5, dustC: 0xc9a877, chip: 0.8, chipC: 0x8a6238, kind: 'splinters', sparks: 0 },
  steel: { dust: 0.2, dustC: 0x8a8a8a, chip: 0.2, chipC: 0x555a5e, kind: 'chips', sparks: 1 },
  metal: { dust: 0.3, dustC: 0x9aa0a4, chip: 0.3, chipC: 0x6d757b, kind: 'chips', sparks: 0.8 },
  glass: { dust: 0.3, dustC: 0xe4f1f3, chip: 1.2, chipC: 0xcfe8ee, kind: 'shards', sparks: 0 },
  roof: { dust: 0.9, dustC: 0xa8674c, chip: 1, chipC: 0x8e3f28, kind: 'chips', sparks: 0 },
  crate: { dust: 0.5, dustC: 0xcbb083, chip: 0.8, chipC: 0x9b7442, kind: 'splinters', sparks: 0 },
  barrel: { dust: 0.2, dustC: 0x6b6b6b, chip: 0.3, chipC: 0xb3261e, kind: 'chips', sparks: 0.7 },
  propane: { dust: 0.2, dustC: 0x6b6b6b, chip: 0.3, chipC: 0xe8e8e2, kind: 'chips', sparks: 0.7 },
  tnt: { dust: 0.4, dustC: 0x6b6b6b, chip: 0.8, chipC: 0xa3281c, kind: 'splinters', sparks: 0 },
  rconcrete: { dust: 1, dustC: 0xb5b1a8, chip: 1, chipC: 0x96938b, kind: 'chips', sparks: 0.15 },
  cinderblock: { dust: 1.1, dustC: 0xa8a59e, chip: 1.1, chipC: 0x8a8882, kind: 'chips', sparks: 0 },
  stone: { dust: 0.6, dustC: 0xcfc8ba, chip: 0.9, chipC: 0xb3ab9c, kind: 'chips', sparks: 0.12 },
  sandstone: { dust: 1.2, dustC: 0xd7b98a, chip: 0.9, chipC: 0xc49e66, kind: 'chips', sparks: 0, powder: true },
  marble: { dust: 0.8, dustC: 0xf0eee9, chip: 1, chipC: 0xe2e0db, kind: 'chips', sparks: 0.05 },
  terracotta: { dust: 0.9, dustC: 0xc98a66, chip: 1.1, chipC: 0xb4573a, kind: 'chips', sparks: 0 },
  ceramic: { dust: 0.7, dustC: 0xe1ddd0, chip: 1.2, chipC: 0xb7c4b9, kind: 'chips', sparks: 0 },
  asphalt: { dust: 0.8, dustC: 0x555350, chip: 0.8, chipC: 0x383b39, kind: 'chips', sparks: 0 },
  copper: { dust: 0.15, dustC: 0x648d80, chip: 0.35, chipC: 0xb7774b, kind: 'chips', sparks: 0.35 },
  adobe: { dust: 1.4, dustC: 0xb89572, chip: 0.9, chipC: 0x9c7a55, kind: 'chips', sparks: 0, powder: true },
  drywall: { dust: 1.4, dustC: 0xf2f0ea, chip: 0.7, chipC: 0xe6e3dc, kind: 'chips', sparks: 0, powder: true },
  oak: { dust: 0.4, dustC: 0xb08a5a, chip: 0.8, chipC: 0x6e4b2e, kind: 'splinters', sparks: 0 },
  plywood: { dust: 0.5, dustC: 0xcbb083, chip: 0.8, chipC: 0xb58e5a, kind: 'splinters', sparks: 0 },
  castiron: { dust: 0.2, dustC: 0x55585a, chip: 0.4, chipC: 0x3a3c3e, kind: 'chips', sparks: 0.9 },
  aluminum: { dust: 0.15, dustC: 0xb9bdc2, chip: 0.3, chipC: 0xaeb2b6, kind: 'chips', sparks: 0.35 },
  tempered: { dust: 0.3, dustC: 0xe8f4f2, chip: 1.5, chipC: 0xcfe8ee, kind: 'dice', sparks: 0 },
  pvc: { dust: 0.2, dustC: 0xd8d6d0, chip: 0.6, chipC: 0xc8c6c0, kind: 'chips', sparks: 0 },
  lamp: { dust: 0.2, dustC: 0xe4f1f3, chip: 1.2, chipC: 0xcfe8ee, kind: 'shards', sparks: 0.2 },
  machine: { dust: 0.2, dustC: 0x7a7c78, chip: 0.3, chipC: 0x4c5a44, kind: 'chips', sparks: 0.9 },
  insulation: { dust: 0.6, dustC: 0xe0d6a8, chip: 0.9, chipC: 0xd8c38a, kind: 'chips', sparks: 0, powder: true },
  frp: { dust: 0.4, dustC: 0xe2e2d8, chip: 0.8, chipC: 0xcfd3c8, kind: 'splinters', sparks: 0 },
  cardboard: { dust: 0.5, dustC: 0xc9b48e, chip: 0.7, chipC: 0xb09067, kind: 'splinters', sparks: 0 },
  rubber: { dust: 0.1, dustC: 0x2a2a2a, chip: 0.3, chipC: 0x202020, kind: 'chips', sparks: 0 },
};

function updateArc(e: Emitter, dt: number): void {
  if (clock >= e.end) { e.on = false; return; }
  e.a -= dt;
  if (e.a > 0) return;
  e.a = rf(0.05, 0.14);
  const R = e.size, fade = (e.end - clock) / (e.end - e.start);
  const x = e.x + rf(-0.4, 0.4) * R, y = e.y + rf(-0.2, 0.4) * R, z = e.z + rf(-0.4, 0.4) * R;
  bolt(x, y, z, R * rf(0.4, 1), 6, 0, 0.012 + 0.004 * R);
  arcGlow(x, y, z, 0.4 + 0.3 * R, 16 * (0.4 + 0.6 * fade), 0.08);
  for (let i = 0; i < 6; i++) {
    dirAround(0, -0.2, 0, 1);
    const sp = rf(2, 6);
    S.x = x; S.y = y; S.z = z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
    S.life = rf(0.3, 0.8); S.r = 6; S.g = 4.6; S.b = 2.6; S.w = rf(0.006, 0.012); S.grav = 1; S.drag = 1; S.streak = 0.03; S.bounce = 0.3;
    spark();
  }
  flash(x, y, z, 0x9ec4ff, (60 + 40 * R) * (0.4 + 0.6 * fade), 0.12, 8 + 4 * R, 2, R * 2);
}

function updateFire(e: Emitter, dt: number, b: number): void {
  if (clock >= e.end) { e.on = false; return; }
  const fade = Math.min(1, (e.end - clock) / 1.5, (clock - e.start) / 0.4), sz = e.size;
  e.a += dt * 26 * sz * fade * b;
  while (e.a >= 1) {
    e.a -= 1;
    const r = rf(0, 0.35 * sz), ang = rf(0, 6.283);
    pAt(e.x + Math.cos(ang) * r, e.y + 0.05, e.z + Math.sin(ang) * r);
    P.vx = rf(-0.3, 0.3); P.vy = rf(1.2, 2.6); P.vz = rf(-0.3, 0.3); P.drag = 1.2; P.rise = 0.6;
    P.life = rf(0.45, 0.85); P.s0 = sz * rf(0.55, 0.8); P.s1 = sz * 0.2; P.a = 0; P.heat = rf(7, 11) * e.heat; P.heatDur = P.life;
    P.spin = rf(-1.5, 1.5); P.wind = 0.6; P.fadeIn = 0.06;
    emit();
  }
  e.b += dt * 7 * sz * fade * b;
  while (e.b >= 1) {
    e.b -= 1;
    pAt(e.x + rf(-0.2, 0.2) * sz, e.y + sz * 0.9, e.z + rf(-0.2, 0.2) * sz);
    P.vx = rf(-0.3, 0.3); P.vy = rf(1.2, 2); P.vz = rf(-0.3, 0.3); P.drag = 0.6; P.rise = 0.9;
    P.life = rf(5, 8); P.s0 = sz * 0.6; P.s1 = sz * rf(3, 4.4); pColor(0x4b4540, rf(0.85, 1.15)); P.a = 0.4;
    P.wind = 1.2; P.fadeIn = 0.4; P.heat = 1.5; P.heatDur = 0.3; P.curl = 0.3;
    emit();
  }
  e.c += dt * 4 * fade;
  while (e.c >= 1) {
    e.c -= 1;
    S.x = e.x + rf(-0.3, 0.3) * sz; S.y = e.y + sz * 0.5; S.z = e.z + rf(-0.3, 0.3) * sz;
    S.vx = rf(-1, 1); S.vy = rf(2, 4); S.vz = rf(-1, 1);
    S.life = rf(1.2, 2.4); S.r = 3; S.g = 1.4; S.b = 0.4; S.w = 0.01; S.grav = 0.12; S.drag = 1.4; S.streak = 0.02; S.bounce = 0.2;
    spark();
  }
}

function updateBeacon(e: Emitter, dt: number): void {
  if (clock >= e.end) { e.on = false; return; }
  const fade = Math.min(1, (e.end - clock) / 2, (clock - e.start) / 0.3);
  e.a += dt * 16 * fade;
  while (e.a >= 1) {
    e.a -= 1;
    pAt(e.x + rf(-0.1, 0.1), e.y + 0.15, e.z + rf(-0.1, 0.1));
    P.vx = rf(-0.4, 0.4); P.vy = rf(2.2, 3.2); P.vz = rf(-0.4, 0.4); P.drag = 0.5; P.rise = 0.6;
    P.life = rf(6, 9); P.s0 = 0.25; P.s1 = rf(3, 4.2); pColor(0xd8261c, rf(0.8, 1.1)); P.a = 0.78;
    P.wind = 1.3; P.fadeIn = 0.15; P.heat = -0.6; P.heatDur = 0.5;
    emit();
  }
  e.b += dt * 30 * fade;
  while (e.b >= 1) {
    e.b -= 1;
    pAt(e.x, e.y + 0.1, e.z);
    P.variant = 3; P.vy = rf(0.5, 1.5); P.life = rf(0.12, 0.2); P.s0 = 0.3; P.s1 = 0.12; P.a = 0;
    pColor(0xff3a2a); P.heat = -14; P.heatDur = P.life; P.fadeIn = 0;
    emit();
  }
  e.c += dt * 6 * fade;
  while (e.c >= 1) {
    e.c -= 1;
    dirAround(0, 1, 0, 0.6);
    const sp = rf(1.5, 3.5);
    S.x = e.x; S.y = e.y + 0.1; S.z = e.z; S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
    S.life = rf(0.3, 0.7); S.r = 5; S.g = 0.8; S.b = 0.5; S.w = 0.008; S.grav = 1; S.drag = 1; S.streak = 0.02; S.bounce = 0.3;
    spark();
  }
}

/* ---------------- machining: hot bits, kerf and bore decals ---------------- */

const _c2 = new THREE.Color();
const _bx = new THREE.Vector3(), _bn = new THREE.Vector3(), _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4();

/* Incandescence in linear HDR: dull red from ~500 °C through orange to yellow-white at ~1500 °C. */
function heatRGB(t: number, out: THREE.Color): THREE.Color {
  const k = clamp((t - 450) / 1100, 0, 1);
  return out.setRGB(0.3 + 5.7 * k, 0.02 + 4.2 * k * k, 0.002 + 2.2 * k * k * k);
}

/* Steel temper colours on fresh swarf: straw at ~220 °C, brown, purple, blue by ~320 °C. */
const TEMPER: [number, number][] = [[200, 0x9aa0a6], [230, 0xc9a55a], [260, 0x8c5a2e], [285, 0x6a3e7a], [310, 0x2f4f9a], [360, 0x5f7f9f]];
function temperRGB(t: number, base: number, out: THREE.Color): THREE.Color {
  if (t < TEMPER[0][0]) return out.setHex(base);
  for (let i = 1; i < TEMPER.length; i++) {
    if (t > TEMPER[i][0]) continue;
    const [t0, c0] = TEMPER[i - 1], [t1, c1] = TEMPER[i];
    return out.setHex(c0).lerp(_c2.setHex(c1), (t - t0) / (t1 - t0));
  }
  return out.setHex(TEMPER[TEMPER.length - 1][1]);
}

function basisAt(o: THREE.Object3D, pos: Vec3, x: Vec3, y: Vec3): void {
  _bx.set(x[0], x[1], x[2]).normalize();
  _bn.set(y[0], y[1], y[2]).normalize();
  _bz.crossVectors(_bx, _bn).normalize();
  _bx.crossVectors(_bn, _bz);
  _bm.makeBasis(_bx, _bn, _bz);
  o.quaternion.setFromRotationMatrix(_bm);
  o.position.set(pos[0] + _bn.x * 0.003, pos[1] + _bn.y * 0.003, pos[2] + _bn.z * 0.003);
}

/* Chips and swarf that leave glowing and cool in flight and on the ground (Newtonian, τ from size),
   keeping their temper colour once cold. kind 0 = chip/droplet, 1 = swarf curl. */
const HB = 14; // px py pz vx vy vz age life T0 scale kind rx ry spin
class HotBits {
  readonly meshes: THREE.InstancedMesh[];
  private readonly s: Float32Array;
  private readonly base: Uint32Array;
  private readonly cap: number;
  private n = 0;
  private readonly o = new THREE.Object3D();
  constructor(cap: number) {
    this.cap = cap;
    this.s = new Float32Array(cap * HB);
    this.base = new Uint32Array(cap);
    const chip = new THREE.BoxGeometry(1, 0.35, 0.6);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 5;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.35 * (1 - i / 60), (i / 24) * 1.4 - 0.7, Math.sin(a) * 0.35 * (1 - i / 60)));
    }
    const curl = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.05, 4, false);
    this.meshes = [chip, curl].map(g => {
      const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ toneMapped: true }), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      return m;
    });
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, T0: number, scale: number, kind: number, base: number): void {
    const i = this.n < this.cap ? this.n++ : Math.floor(rng() * this.cap);
    const s = this.s, o = i * HB;
    s[o] = x; s[o + 1] = y; s[o + 2] = z; s[o + 3] = vx; s[o + 4] = vy; s[o + 5] = vz;
    s[o + 6] = 0; s[o + 7] = rf(6, 10); s[o + 8] = T0; s[o + 9] = scale; s[o + 10] = kind;
    s[o + 11] = rf(0, 6.283); s[o + 12] = rf(0, 6.283); s[o + 13] = rf(-12, 12);
    this.base[i] = base;
  }
  clear(): void { this.n = 0; for (const m of this.meshes) m.count = 0; }
  update(dt: number): void {
    const s = this.s, cnt = [0, 0];
    for (let i = 0; i < this.n;) {
      const o = i * HB;
      const age = s[o + 6] + dt;
      if (age >= s[o + 7]) { this.kill(i); continue; }
      s[o + 6] = age;
      const sc = s[o + 9];
      if (s[o + 1] > sc * 0.3 || s[o + 4] > 0) {
        s[o + 4] -= 9.81 * dt;
        const damp = 1 - 0.4 * dt;
        s[o + 3] *= damp; s[o + 5] *= damp;
        s[o] += s[o + 3] * dt; s[o + 1] += s[o + 4] * dt; s[o + 2] += s[o + 5] * dt;
        s[o + 11] += s[o + 13] * dt;
        if (s[o + 1] < sc * 0.3) {
          s[o + 1] = sc * 0.3;
          s[o + 4] = Math.abs(s[o + 4]) > 1.2 ? -s[o + 4] * 0.25 : 0;
          s[o + 3] *= 0.4; s[o + 5] *= 0.4; s[o + 13] *= 0.3;
        }
      }
      // small bits shed heat fast in flight, slower resting on the ground
      const tau = 0.8 + sc * 120;
      const T = AMB_C + (s[o + 8] - AMB_C) * Math.exp(-age / tau);
      const kind = s[o + 10] | 0, m = this.meshes[kind], j = cnt[kind]++;
      if (kind) temperRGB(Math.min(T, 360), this.base[i], _c);
      else _c.setHex(this.base[i]);
      if (T > 480) _c.add(heatRGB(T, _c2));
      m.instanceColor!.setXYZ(j, _c.r, _c.g, _c.b);
      this.o.position.set(s[o], s[o + 1], s[o + 2]);
      this.o.rotation.set(s[o + 11], s[o + 12], 0);
      this.o.scale.setScalar(sc * (kind ? 1.6 : 1));
      this.o.updateMatrix();
      m.setMatrixAt(j, this.o.matrix);
      i++;
    }
    this.meshes.forEach((m, k) => {
      m.count = cnt[k];
      if (!cnt[k]) return;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
    });
  }
  private kill(i: number): void {
    const last = --this.n;
    if (i === last) return;
    this.s.copyWithin(i * HB, last * HB, last * HB + HB);
    this.base[i] = this.base[last];
  }
}
const AMB_C = 20;

interface KerfFx {
  g: THREE.Group; seen: number;
  line: THREE.Mesh; lineMat: THREE.MeshBasicMaterial;
  cut: THREE.Mesh; cutMat: THREE.MeshBasicMaterial;
  tip: THREE.Mesh; tipMat: THREE.MeshBasicMaterial;
  spot: THREE.Mesh; spotMat: THREE.MeshBasicMaterial;
}
interface BoreFx { g: THREE.Group; seen: number; hole: THREE.Mesh; holeMat: THREE.MeshBasicMaterial; rim: THREE.Mesh; rimMat: THREE.MeshBasicMaterial }
interface MachFx { bits: HotBits; kerfs: KerfFx[]; bores: BoreFx[] }
let mach: MachFx | null = null;

function decalMat(color: number, additive: boolean, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
  });
}

/* Built on first use so the tools cost nothing on levels that never issue them. */
function machFx(): MachFx | null {
  if (!ready) return null;
  if (mach) return mach;
  const bits = new HotBits(700);
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const ring = new THREE.RingGeometry(0.82, 1, 24).rotateX(-Math.PI / 2);
  const kerfs: KerfFx[] = [], bores: BoreFx[] = [];
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group();
    const lineMat = decalMat(0x0c0a08, false, 0.5), cutMat = decalMat(0xff6a1a, true), tipMat = decalMat(0xffd08a, true), spotMat = decalMat(0xff5010, true);
    const line = new THREE.Mesh(quad, lineMat), cut = new THREE.Mesh(quad, cutMat), tip = new THREE.Mesh(disc, tipMat), spot = new THREE.Mesh(disc, spotMat);
    cut.position.y = 0.0005; tip.position.y = 0.001; spot.position.y = 0.001;
    g.add(line, cut, tip, spot);
    g.visible = false;
    kerfs.push({ g, seen: 0, line, lineMat, cut, cutMat, tip, tipMat, spot, spotMat });
    root.add(g);
  }
  for (let i = 0; i < 56; i++) {
    const g = new THREE.Group();
    const holeMat = decalMat(0x050403, false, 0.9), rimMat = decalMat(0xff6a1a, true);
    const hole = new THREE.Mesh(disc, holeMat), rim = new THREE.Mesh(ring, rimMat);
    rim.position.y = 0.0005;
    g.add(hole, rim);
    g.visible = false;
    bores.push({ g, seen: 0, hole, holeMat, rim, rimMat });
    root.add(g);
  }
  for (const m of bits.meshes) root.add(m);
  mach = { bits, kerfs, bores };
  return mach;
}

/* Emitter primitives for effect modules kept outside this file (render/utilityfx.ts): the same spawn templates,
   rings and flash lights, so their particles share one budget and one draw with everything here. */
export const fxKit = {
  P, S, pAt, pColor, spark, dirAround, unitDir, budget, flash, bolt, arcGlow, rf,
  emit: (): void => emit(),
  /** scratch direction written by dirAround / unitDir */
  v: _v, cd: _cd,
  ready: (): boolean => ready,
  /** the fx group in the scene, for effect meshes of their own */
  root: (): THREE.Group | null => (ready ? root : null),
  /** brightness of additive water droplets for the current light (they must not glow at night) */
  drop: (): number => dropK,
  /** the wind the smoke and mist drift in, m/s */
  wind,
};
