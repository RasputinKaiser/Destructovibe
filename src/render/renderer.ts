import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { EnvPreset, Quality, Vec3 } from '../types';
import { setMeshDetail } from '../destruction/polytope';
import { SkyDome } from './sky';
import { DV_ATMOS_GLSL, DV_CLOUD_GLSL, FX_LAYER, FX_SOFT_LAYER, atmosU, dustU, envU, lighting, qualU, roomU, softU, view } from './shared';
import { applySceneryEnv } from './scenery';
import { setViewmodelAspect, syncViewmodel, viewmodelLayer } from './viewmodel';

export interface Gfx { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera }

/* ---------------- lit-shader patch ----------------
   Applied to three's chunks once, before anything compiles, so every lit program has the same shape:
   - the sun is two DirectionalLights (near cascade first, far cascade second); a fragment weights them
     by whether it sits inside the near shadow box, fading across its outer 10 %. Scenes with any other
     directional light count (the viewmodel has 3) are untouched.
   - sunlight is attenuated by the dust-cloud ellipsoids (zero cost unless the material attaches dustU). */
const DIR_MARK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
function patchChunks(): boolean {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.lights_fragment_begin.includes('dvSunVis')) return true;
  const lf = C.lights_fragment_begin, at = lf.indexOf(DIR_MARK), re = /\n([ \t]*)RE_Direct\(/;
  if (at < 0 || !re.test(lf.slice(at))) return false;
  const pre = /* glsl */`
float dvSunVis = 1.0;
if ( uDvCloudN * uDvCloudSurf > 0.5 ) dvSunVis = exp( - dvCloudOD( ( vec4( geometryPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition, uDvSunDir ) );
#if NUM_DIR_LIGHTS == 2
	float dvNear = 1.0;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
		vec3 dvSc = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
		vec2 dvE = smoothstep( 0.0, 0.1, dvSc.xy ) * smoothstep( 0.0, 0.1, 1.0 - dvSc.xy );
		dvNear = dvE.x * dvE.y * step( dvSc.z, 1.0 );
	#endif
#endif
`;
  const tail = lf.slice(at).replace(re, '\n$1#if NUM_DIR_LIGHTS == 2\n$1directLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? dvNear : 1.0 - dvNear;\n$1#endif\n$1directLight.color *= dvSunVis;\n$1RE_Direct(');
  C.lights_fragment_begin = lf.slice(0, at) + pre + tail;
  C.lights_pars_begin = `${C.lights_pars_begin}\n${DV_CLOUD_GLSL}\n`;
  return true;
}
const cascades = patchChunks();

/* ---------------- presets ---------------- */

interface Preset {
  elev: number; azim: number; sun: number; sunI: number; shadow: number;
  zenith: number; horizon: number; fogD: number;
  hemiSky: number; hemiGround: number; hemiI: number; envI: number; exposure: number;
  glow: number; glowK: number; cloud: number; cloudLit: number; cloudShade: number; stars: number;
  disc: number; discDeg: number; bloomT: number; bloomS: number;
  /** ground haze: density at y = 0 (1/m), scale height (m), sun in-scatter, god-ray strength */
  hazeD: number; hazeH: number; scatter: number; god: number;
  humid: number; wet: number;
}

/* colours are sRGB hex; the horizon colour doubles as the fog colour so terrain dissolves into the sky */
const PRESETS: Record<EnvPreset, Preset> = {
  noon: {
    elev: 58, azim: 35, sun: 0xfff1dc, sunI: 5.2, shadow: 1, zenith: 0x2d6cc4, horizon: 0xb9cfe3, fogD: 0.0021,
    hemiSky: 0xcfe0ff, hemiGround: 0x67615a, hemiI: 0.25, envI: 0.85, exposure: 1.0,
    glow: 0xfff0d0, glowK: 0.35, cloud: 0.3, cloudLit: 0xffffff, cloudShade: 0x9aa6b8, stars: 0, disc: 60, discDeg: 1.1, bloomT: 5, bloomS: 0.35,
    hazeD: 0.0009, hazeH: 34, scatter: 0.35, god: 0.16, humid: 0.2, wet: 0,
  },
  golden: {
    elev: 14, azim: -68, sun: 0xffb46b, sunI: 4.6, shadow: 1, zenith: 0x4a74b0, horizon: 0xe6c39c, fogD: 0.0026,
    hemiSky: 0xbac8e2, hemiGround: 0x665a50, hemiI: 0.22, envI: 0.8, exposure: 1.05,
    glow: 0xffa860, glowK: 1.1, cloud: 0.35, cloudLit: 0xffd2a0, cloudShade: 0x8a7f8c, stars: 0, disc: 40, discDeg: 1.3, bloomT: 4, bloomS: 0.45,
    hazeD: 0.0016, hazeH: 24, scatter: 0.9, god: 0.5, humid: 0.35, wet: 0,
  },
  overcast: {
    elev: 50, azim: 20, sun: 0xdfe4ea, sunI: 1.2, shadow: 0.35, zenith: 0x8a939d, horizon: 0xafb5bb, fogD: 0.0042,
    hemiSky: 0xc9d1da, hemiGround: 0x5f5a52, hemiI: 0.45, envI: 1.25, exposure: 1.15,
    glow: 0xdfe4ea, glowK: 0.12, cloud: 0.97, cloudLit: 0xc4c9ce, cloudShade: 0x80878f, stars: 0, disc: 2, discDeg: 1.2, bloomT: 2.8, bloomS: 0.4,
    hazeD: 0.0024, hazeH: 45, scatter: 0.12, god: 0, humid: 0.9, wet: 0.55,
  },
  dusk: {
    elev: 7, azim: -100, sun: 0xff7a42, sunI: 2.2, shadow: 0.9, zenith: 0x283060, horizon: 0xb57a6a, fogD: 0.003,
    hemiSky: 0x6a6aa8, hemiGround: 0x37312f, hemiI: 0.35, envI: 0.7, exposure: 1.35,
    glow: 0xff7040, glowK: 1.5, cloud: 0.4, cloudLit: 0xff9a6a, cloudShade: 0x4a3c58, stars: 0.25, disc: 25, discDeg: 1.4, bloomT: 2.2, bloomS: 0.55,
    hazeD: 0.0018, hazeH: 18, scatter: 1.0, god: 0.45, humid: 0.6, wet: 0.35,
  },
  night: {
    elev: 38, azim: 150, sun: 0x9fb6ff, sunI: 0.7, shadow: 0.8, zenith: 0x040914, horizon: 0x16213a, fogD: 0.0034,
    hemiSky: 0x3b4f82, hemiGround: 0x1c1a18, hemiI: 0.8, envI: 0.9, exposure: 1.7,
    glow: 0x6c86c8, glowK: 0.1, cloud: 0.22, cloudLit: 0x3a4460, cloudShade: 0x10141e, stars: 1, disc: 6, discDeg: 1.6, bloomT: 1.4, bloomS: 0.6,
    hazeD: 0.002, hazeH: 14, scatter: 0.25, god: 0.04, humid: 0.7, wet: 0.65,
  },
};

/** near cascade box per quality (m), far cascade covers the skyline */
const NEAR_BOX: Record<Quality, number> = { low: 60, medium: 70, high: 76 };
const NEAR_MAP: Record<Quality, number> = { low: 1024, medium: 2048, high: 2048 };
const FAR_MAP: Record<Quality, number> = { low: 1024, medium: 1024, high: 2048 };
const FAR_EVERY: Record<Quality, number> = { low: 6, medium: 4, high: 3 };
const FAR_BOX = 360, SHADOW_DIST = 220, FAR_DIST = 420;

let gfx: Gfx | null = null;
let hostEl: HTMLElement;
let sun: THREE.DirectionalLight;
let sunFar: THREE.DirectionalLight;
let hemi: THREE.HemisphereLight;
let fog: THREE.FogExp2;
let sky: SkyDome;
let pmrem: THREE.PMREMGenerator;
let envRT: THREE.WebGLRenderTarget | null = null;
let quality: Quality = 'medium';
let env: EnvPreset = 'noon';
let lost = false;
let time = 0;
let farTick = 0;
const focus = new THREE.Vector3();
const sunDir = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _c = new THREE.Vector3(), _v4 = new THREE.Vector4();

let composer: EffectComposer | null = null;
let scenePass: ScenePass | null = null;
let godPass: GodRayPass | null = null;
let exposurePass: ExposurePass | null = null;
let lensPass: LensPass | null = null;
let bloom: UnrealBloomPass | null = null;
let grainOn = true;
let caOn = true;

/* ---------------- fullscreen helpers ---------------- */

/* One NaN/Inf texel from any shader turns the bloom mip chain (and the god-ray blur) into a frame-wide black
   smear. Checked on the exponent bits, which fast-math cannot fold away as it may an isnan(). */
const FINITE_GLSL = /* glsl */`
vec3 dvFinite( vec3 c ) {
  uvec3 e = floatBitsToUint( c ) & 0x7f800000u;
  return any( equal( e, uvec3( 0x7f800000u ) ) ) ? vec3( 0.0 ) : c;
}`;

const FS_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

type Blend = 'none' | 'over' | 'mul' | 'add';
function fsQuad(fs: string, uniforms: Record<string, THREE.IUniform>, blend: Blend = 'none'): FullScreenQuad {
  const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false });
  if (blend !== 'none') {
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = blend === 'mul' ? THREE.ZeroFactor : THREE.OneFactor;
    m.blendDst = blend === 'mul' ? THREE.SrcColorFactor : blend === 'over' ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
  }
  return new FullScreenQuad(m);
}
const U = (q: FullScreenQuad): Record<string, THREE.IUniform> => (q.material as THREE.ShaderMaterial).uniforms;

function draw(r: THREE.WebGLRenderer, q: FullScreenQuad, target: THREE.WebGLRenderTarget | null, clear: boolean): void {
  r.setRenderTarget(target);
  const ac = r.autoClear;
  r.autoClear = clear;
  q.render(r);
  r.autoClear = ac;
}

function floatRT(w: number, h: number, format: THREE.PixelFormat = THREE.RGBAFormat, filter: THREE.MagnificationTextureFilter = THREE.LinearFilter): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType, format, minFilter: filter, magFilter: filter, depthBuffer: false });
}

/* ---------------- scene pass ----------------
   Replaces RenderPass: opaque world → GTAO multiplied into it (so dust is never darkened by AO of the
   wall behind it) → linear depth copy → height fog / aerial perspective blended in place → soft
   smoke/dust puffs (at half resolution when fill rate matters: they occlude through the soft depth
   test alone, then composite premultiplied) → depth-tested sparks and rings. Never swaps. */

const DEPTH_FS = /* glsl */`
#include <packing>
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
void main() {
  float d = texture2D( tDepth, vUv ).x;
  float z = d >= 1.0 ? uFar : - perspectiveDepthToViewZ( d, uNear, uFar );
  gl_FragColor = vec4( z, 0.0, 0.0, 1.0 );
}`;

const AO_FS = /* glsl */`
uniform sampler2D tAO;
uniform float uK;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4( vec3( mix( 1.0, texture2D( tAO, vUv ).r, uK ) ), 1.0 );
}`;

const COMP_FS = /* glsl */`
uniform sampler2D tColor;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D( tColor, vUv );
}`;

const ATM_FS = /* glsl */`
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCam;
uniform float uFar;
varying vec2 vUv;
${DV_ATMOS_GLSL}
void main() {
  float z = texture2D( tDepth, vUv ).r;
  float sky = z > uFar * 0.995 ? 1.0 : 0.0;
  vec4 v = uInvProj * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
  vec3 vd = v.xyz / v.w;
  vec3 wp = ( uCamWorld * vec4( vd * ( min( z, uFar ) / max( - vd.z, 1e-4 ) ), 1.0 ) ).xyz;
  vec4 a = dvAtmos( uCam, wp, sky );
  gl_FragColor = vec4( a.rgb, 1.0 - a.a );
}`;

class ScenePass extends Pass {
  readonly depthRT = floatRT(1, 1, THREE.RedFormat, THREE.NearestFilter);
  private readonly fxRT = floatRT(1, 1);
  private readonly compQ = fsQuad(COMP_FS, { tColor: { value: null } }, 'over');
  private readonly clearCol = new THREE.Color();
  /** offscreen half-res puffs even at modest resolutions (medium) */
  forceHalf = false;
  private half = false;
  private readonly copyQ = fsQuad(DEPTH_FS, { tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 1200 } });
  private readonly aoQ = fsQuad(AO_FS, { tAO: { value: null }, uK: { value: 0.9 } }, 'mul');
  private readonly atmQ = fsQuad(ATM_FS, Object.assign({
    tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uCam: { value: new THREE.Vector3() }, uFar: { value: 1200 },
  }, atmosU), 'over');
  ao = false;
  aoScale = 1;
  private w = 1;
  private h = 1;
  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera, readonly gtao: GTAOPass) {
    super();
    this.needsSwap = false;
    gtao.output = GTAOPass.OUTPUT.Off;
  }
  setSize(w: number, h: number): void {
    this.w = w; this.h = h;
    // soft particles and haze tolerate half-res depth; at retina sizes the full copy is pure bandwidth
    this.half = this.forceHalf || w * h > 2.6e6;
    const ds = this.half ? 0.5 : 1, dw = Math.max(1, Math.round(w * ds)), dh = Math.max(1, Math.round(h * ds));
    this.depthRT.setSize(dw, dh);
    this.fxRT.setSize(dw, dh);
    this.gtao.setSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale)));
  }
  resizeAO(): void { this.setSize(this.w, this.h); }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const { scene, camera } = this;
    renderer.setRenderTarget(read);
    renderer.render(scene, camera);
    if (this.ao) {
      this.gtao.render(renderer, read, read, 0, false);
      U(this.aoQ).tAO.value = this.gtao.pdRenderTarget.texture;
      draw(renderer, this.aoQ, read, false);
    }
    const cu = U(this.copyQ);
    cu.tDepth.value = read.depthTexture;
    cu.uNear.value = camera.near;
    cu.uFar.value = camera.far;
    draw(renderer, this.copyQ, this.depthRT, true);
    softU.uDepth.value = this.depthRT.texture;
    softU.uSoft.value = 1;
    const au = U(this.atmQ);
    au.tDepth.value = this.depthRT.texture;
    (au.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (au.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    (au.uCam.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    au.uFar.value = camera.far;
    draw(renderer, this.atmQ, read, false);
    const mask = camera.layers.mask, auto = scene.matrixWorldAutoUpdate, ac = renderer.autoClear;
    scene.matrixWorldAutoUpdate = false;
    renderer.autoClear = false;
    camera.layers.set(FX_SOFT_LAYER);
    if (this.half) {
      softU.uRes.value.set(this.fxRT.width, this.fxRT.height);
      renderer.getClearColor(this.clearCol);
      const ca = renderer.getClearAlpha();
      renderer.setRenderTarget(this.fxRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.setClearColor(this.clearCol, ca);
      U(this.compQ).tColor.value = this.fxRT.texture;
      draw(renderer, this.compQ, read, false);
    } else {
      softU.uRes.value.set(read.width, read.height);
      renderer.setRenderTarget(read);
      renderer.render(scene, camera);
    }
    camera.layers.set(FX_LAYER);
    renderer.setRenderTarget(read);
    renderer.render(scene, camera);
    renderer.autoClear = ac;
    scene.matrixWorldAutoUpdate = auto;
    camera.layers.mask = mask;
  }
}

/* ---------------- god rays ----------------
   Sky pixels near the sun (and very bright pixels, i.e. sun-lit dust in forward scatter), radially
   blurred at quarter resolution and added back. Dust between camera and sun blocks the sky mask, so
   shafts appear through gaps in a cloud. */

const GOD_MASK_FS = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
uniform float uFar;
uniform float uThresh;
varying vec2 vUv;
${FINITE_GLSL}
void main() {
  vec3 c = min( dvFinite( texture2D( tColor, vUv ).rgb ), vec3( 30.0 ) );
  float sky = step( uFar * 0.995, texture2D( tDepth, vUv ).r );
  vec2 dv = ( vUv - uSun ) * vec2( uAspect, 1.0 );
  float fall = exp( - dot( dv, dv ) * 5.0 );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float m = fall * ( sky + ( 1.0 - sky ) * 0.15 * smoothstep( uThresh, uThresh * 3.0, l ) );
  gl_FragColor = vec4( c * m, 1.0 );
}`;

const GOD_BLUR_FS = /* glsl */`
uniform sampler2D tMask;
uniform vec2 uSun;
uniform float uDecay;
uniform float uLen;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vec2 d = ( vUv - uSun ) * ( uLen / 40.0 );
  float j = fract( sin( dot( vUv + uSeed, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  vec2 uv = vUv - d * j;
  vec3 acc = vec3( 0.0 );
  float w = 1.0;
  for ( int i = 0; i < 40; i ++ ) {
    acc += texture2D( tMask, uv ).rgb * w;
    w *= uDecay;
    uv -= d;
  }
  gl_FragColor = vec4( acc * ( 1.0 / 40.0 ), 1.0 );
}`;

const ADD_FS = /* glsl */`
uniform sampler2D tColor;
uniform float uK;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4( texture2D( tColor, vUv ).rgb * uK, 1.0 );
}`;

class GodRayPass extends Pass {
  private readonly maskRT = floatRT(1, 1);
  private readonly blurRT = floatRT(1, 1);
  private readonly maskQ = fsQuad(GOD_MASK_FS, {
    tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uFar: { value: 1200 }, uThresh: { value: 4 },
  });
  private readonly blurQ = fsQuad(GOD_BLUR_FS, { tMask: { value: null }, uSun: { value: new THREE.Vector2() }, uDecay: { value: 0.955 }, uLen: { value: 0.85 }, uSeed: { value: 0 } });
  private readonly addQ = fsQuad(ADD_FS, { tColor: { value: null }, uK: { value: 0 } }, 'add');
  strength = 0;
  constructor(private readonly camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
  }
  setSize(w: number, h: number): void {
    const qw = Math.max(1, Math.round(w / 4)), qh = Math.max(1, Math.round(h / 4));
    this.maskRT.setSize(qw, qh);
    this.blurRT.setSize(qw, qh);
    U(this.maskQ).uAspect.value = w / Math.max(1, h);
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const cam = this.camera;
    _c.setFromMatrixPosition(cam.matrixWorld).addScaledVector(sunDir, 1000);
    _v4.set(_c.x, _c.y, _c.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    if (_v4.w <= 0 || this.strength <= 0.001) return;
    const x = _v4.x / _v4.w, y = _v4.y / _v4.w, e = Math.max(Math.abs(x), Math.abs(y));
    const k = this.strength * (1 - THREE.MathUtils.smoothstep(e, 1.0, 1.7)) * THREE.MathUtils.smoothstep(sunDir.y, -0.03, 0.06);
    if (k <= 0.001) return;
    const su = (x + 1) * 0.5, sv = (y + 1) * 0.5;
    const mu = U(this.maskQ);
    mu.tColor.value = read.texture;
    mu.tDepth.value = softU.uDepth.value;
    (mu.uSun.value as THREE.Vector2).set(su, sv);
    mu.uFar.value = cam.far;
    mu.uThresh.value = bloom ? bloom.threshold : 4;
    draw(renderer, this.maskQ, this.maskRT, true);
    const bu = U(this.blurQ);
    bu.tMask.value = this.maskRT.texture;
    (bu.uSun.value as THREE.Vector2).set(su, sv);
    bu.uSeed.value = ((bu.uSeed.value as number) + 0.618) % 1;
    draw(renderer, this.blurQ, this.blurRT, true);
    const au = U(this.addQ);
    au.tColor.value = this.blurRT.texture;
    au.uK.value = k;
    draw(renderer, this.addQ, read, false);
  }
}

/* ---------------- eye adaptation + chromatic aberration ----------------
   Centre-weighted mean log luminance (64² with mips), tracked by a fast "eye" and a slow "scene
   baseline"; exposure moves by their difference, clamped to about a stop either way. So the preset's
   own exposure stays the neutral look, and only transitions (walking into dust, a night flash, a
   bright fireball) adapt, relaxing again over ~20 s. No CPU readback. */

const LUM_FS = /* glsl */`
uniform sampler2D tColor;
varying vec2 vUv;
${FINITE_GLSL}
void main() {
  const float o = 1.0 / 256.0;
  vec3 c = dvFinite( texture2D( tColor, vUv + vec2( - o, - o ) ).rgb + texture2D( tColor, vUv + vec2( o, - o ) ).rgb
    + texture2D( tColor, vUv + vec2( - o, o ) ).rgb + texture2D( tColor, vUv + vec2( o, o ) ).rgb );
  float l = dot( c * 0.25, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec2 cc = vUv - 0.5;
  float w = exp( - dot( cc, cc ) * 5.0 );
  gl_FragColor = vec4( w * log2( clamp( l, 1e-4, 1e4 ) ), w, 0.0, 1.0 );
}`;

const ADAPT_FS = /* glsl */`
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uReset;
varying vec2 vUv;
void main() {
  vec4 s = textureLod( tLum, vec2( 0.5 ), 6.0 );
  float avg = s.r / max( s.g, 1e-5 );
  vec2 prev = texture2D( tPrev, vec2( 0.5 ) ).rg;
  if ( isnan( avg ) || isinf( avg ) ) avg = prev.y;
  if ( uReset > 0.5 || isnan( prev.x ) || isnan( prev.y ) ) {
    gl_FragColor = vec4( avg, avg, 0.0, 1.0 );
    return;
  }
  float tau = avg < prev.x ? 1.4 : 0.45;
  float f = prev.x + ( avg - prev.x ) * ( 1.0 - exp( - uDt / tau ) );
  float b = prev.y + ( avg - prev.y ) * ( 1.0 - exp( - uDt / 20.0 ) );
  gl_FragColor = vec4( f, b, 0.0, 1.0 );
}`;

const EXPO_FS = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tAdapt;
uniform float uStrength;
uniform vec2 uClamp;
uniform float uCA;
uniform float uAspect;
varying vec2 vUv;
${FINITE_GLSL}
void main() {
  vec2 a = texture2D( tAdapt, vec2( 0.5 ) ).rg;
  float ev = clamp( ( a.y - a.x ) * uStrength, - uClamp.x, uClamp.y );
  vec2 cc = vUv - 0.5;
  vec2 ca = cc * vec2( uAspect, 1.0 );
  // lateral CA grows with the square of the field radius: invisible in the centre, a fringe in the corners
  vec2 off = cc * dot( ca, ca ) * uCA;
  vec3 c = vec3( texture2D( tColor, vUv - off ).r, texture2D( tColor, vUv ).g, texture2D( tColor, vUv + off ).b );
  gl_FragColor = vec4( dvFinite( c * exp2( ev ) ), 1.0 );
}`;

class ExposurePass extends Pass {
  private readonly lumRT = new THREE.WebGLRenderTarget(64, 64, {
    type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  private readonly adapt = [floatRT(1, 1, THREE.RGBAFormat, THREE.NearestFilter), floatRT(1, 1, THREE.RGBAFormat, THREE.NearestFilter)];
  private cur = 0;
  private readonly lumQ = fsQuad(LUM_FS, { tColor: { value: null } });
  private readonly adaptQ = fsQuad(ADAPT_FS, { tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uReset: { value: 1 } });
  private readonly expoQ = fsQuad(EXPO_FS, {
    tColor: { value: null }, tAdapt: { value: null }, uStrength: { value: 0.65 }, uClamp: { value: new THREE.Vector2(1, 1.3) }, uCA: { value: 0.006 }, uAspect: { value: 1 },
  });
  reset = true;
  setSize(w: number, h: number): void { U(this.expoQ).uAspect.value = w / Math.max(1, h); }
  setAberration(k: number): void { U(this.expoQ).uCA.value = k; }
  setLimits(down: number, up: number, strength: number): void {
    const u = U(this.expoQ);
    (u.uClamp.value as THREE.Vector2).set(down, up);
    u.uStrength.value = strength;
  }
  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, dt: number): void {
    U(this.lumQ).tColor.value = read.texture;
    draw(renderer, this.lumQ, this.lumRT, true);
    const au = U(this.adaptQ), next = 1 - this.cur;
    au.tLum.value = this.lumRT.texture;
    au.tPrev.value = this.adapt[this.cur].texture;
    au.uDt.value = Math.min(Math.max(dt || 0.016, 0.001), 0.1);
    au.uReset.value = this.reset ? 1 : 0;
    draw(renderer, this.adaptQ, this.adapt[next], true);
    this.cur = next;
    this.reset = false;
    const eu = U(this.expoQ);
    eu.tColor.value = read.texture;
    eu.tAdapt.value = this.adapt[this.cur].texture;
    draw(renderer, this.expoQ, this.renderToScreen ? null : write, true);
  }
}

/* ---------------- lens: vignette + film grain (display-referred, after AA) ---------------- */

const LENS_FS = /* glsl */`
uniform sampler2D tColor;
uniform float uTime;
uniform float uGrain;
uniform float uVig;
uniform float uAspect;
varying vec2 vUv;
float h12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
void main() {
  vec3 c = texture2D( tColor, vUv ).rgb;
  vec2 cc = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
  float rr = dot( cc, cc ) / ( 0.25 * ( uAspect * uAspect + 1.0 ) );
  c *= 1.0 - uVig * rr * rr;
  vec2 fc = gl_FragCoord.xy + fract( uTime * 7.13 ) * 911.0;
  float n = h12( fc ) + h12( fc + 17.7 ) - 1.0;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c += n * uGrain * ( 1.0 - 0.75 * l );
  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
}`;

class LensPass extends Pass {
  private readonly q = fsQuad(LENS_FS, { tColor: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.018 }, uVig: { value: 0.28 }, uAspect: { value: 1 } });
  setSize(w: number, h: number): void { U(this.q).uAspect.value = w / Math.max(1, h); }
  set(grain: number, vig: number): void { const u = U(this.q); u.uGrain.value = grain; u.uVig.value = vig; }
  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const u = U(this.q);
    u.tColor.value = read.texture;
    u.uTime.value = time;
    draw(renderer, this.q, this.renderToScreen ? null : write, true);
  }
}

/** draws the weapon overlay into the frame so far, after clearing depth so it never clips walls */
class ViewmodelPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const vm = viewmodelLayer();
    if (!vm) return;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
    renderer.autoClear = ac;
  }
}

function ensureComposer(g: Gfx): EffectComposer {
  if (composer) return composer;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
  composer = new EffectComposer(g.renderer, rt);
  const gtao = new GTAOPass(g.scene, g.camera, 1, 1);
  // AO reads the main pass depth and reconstructs normals: no second scene render
  if (rt.depthTexture) gtao.setGBuffer(rt.depthTexture);
  gtao.updateGtaoMaterial({ radius: 0.65, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 16, distanceFallOff: 0.8 });
  scenePass = new ScenePass(g.scene, g.camera, gtao);
  godPass = new GodRayPass(g.camera);
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), PRESETS[env].bloomS, 0.5, PRESETS[env].bloomT);
  const hp = bloom.materialHighPassFilter;
  hp.fragmentShader = hp.fragmentShader
    .replace('void main() {', `${FINITE_GLSL}\nvoid main() {`)
    .replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = dvFinite( texel.rgb );');
  hp.needsUpdate = true;
  exposurePass = new ExposurePass();
  lensPass = new LensPass();
  composer.addPass(scenePass);
  composer.addPass(new ViewmodelPass());
  composer.addPass(godPass);
  composer.addPass(bloom);
  composer.addPass(exposurePass);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());
  composer.addPass(lensPass);
  return composer;
}

/* ---------------- dynamic resolution ----------------
   Frame time is held at 60 fps by walking a ladder: pixel ratio first, then the radius inside which walls draw as
   individual bevelled units, then pixel ratio again. The frame interval says whether 60 is being missed; a GPU
   timer query (where exposed) says whether the GPU is why, and whether there is headroom to climb back. Some
   drivers' timers run long (ANGLE on Metal reads several times the real cost while frames still hit 60), so the
   timer only counts while it agrees with the interval; otherwise climbing is probed on a backoff. */
const LADDER: readonly (readonly [scale: number, shed: number])[] = [
  [1, 0], [0.9, 0], [0.8, 0], [0.8, 1], [0.7, 1], [0.6, 1], [0.6, 2], [0.5, 2],
];
const GPU_BUDGET = 14, FRAME_BUDGET = 1000 / 60;
let userScale = 0;
let rung = 0;
let gpuMs = 0;
let frameMs = FRAME_BUDGET;
let overT = 0;
let underT = 0;
let upWait = 3;
let sinceUp = 1e9;
let detailTier: Quality | null = null;
let detailHook: ((q: Quality | null) => void) | null = null;

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
interface Timer { gl: WebGL2RenderingContext; ext: TimerExt; free: WebGLQuery[]; pending: WebGLQuery[]; open: boolean }
let timer: Timer | null = null;

function initTimer(r: THREE.WebGLRenderer): void {
  const gl = r.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  timer = ext ? { gl, ext, free: [], pending: [], open: false } : null;
}

function timerBegin(): void {
  if (!timer || timer.open || timer.pending.length > 6) return;
  const q = timer.free.pop() ?? timer.gl.createQuery();
  if (!q) return;
  timer.gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, q);
  timer.pending.push(q);
  timer.open = true;
}

function timerEnd(): void {
  if (!timer?.open) return;
  timer.gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
  timer.open = false;
}

/** latest finished GPU frame time in ms, or null if none has resolved */
function timerPoll(): number | null {
  if (!timer) return null;
  const { gl, ext, pending, free } = timer;
  let ms: number | null = null;
  while (pending.length > (timer.open ? 1 : 0)) {
    const q = pending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
    pending.shift();
    free.push(q);
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) ms = ns / 1e6;
  }
  return ms;
}

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

function applyDetailTier(): void {
  const shed = userScale > 0 ? 0 : LADDER[rung][1];
  const want = shed ? QUALITIES[Math.max(0, QUALITIES.indexOf(quality) - shed)] : null;
  if (want === detailTier) return;
  detailTier = want;
  detailHook?.(want);
}

function effectiveScale(): number { return userScale > 0 ? userScale : LADDER[rung][0]; }

function setRung(i: number): void {
  const prev = effectiveScale();
  rung = Math.max(0, Math.min(LADDER.length - 1, i));
  overT = underT = 0;
  applyDetailTier();
  if (effectiveScale() !== prev) applyPixelRatio();
}

function adapt(dt: number): void {
  const gpu = timerPoll();
  if (gpu !== null) gpuMs = gpuMs > 0 ? gpuMs + (gpu - gpuMs) * 0.15 : gpu;
  // hidden tabs tick on a 100 ms timeout; that says nothing about the GPU
  if (document.hidden || dt <= 0) return;
  frameMs += (Math.min(dt, 0.1) * 1000 - frameMs) * 0.1;
  sinceUp += dt;
  if (userScale > 0) return;
  const trusted = timer !== null && gpuMs > 0 && gpuMs < frameMs * 1.15;
  const missing = frameMs > FRAME_BUDGET * 1.12 && (!trusted || gpuMs > GPU_BUDGET);
  const roomy = trusted ? gpuMs < GPU_BUDGET * 0.7 : frameMs < FRAME_BUDGET * 1.04;
  overT = missing ? overT + dt : 0;
  underT = roomy ? underT + dt : 0;
  if (overT > 0.75 && rung < LADDER.length - 1) {
    // falling straight back after a climb: that level is out of reach, probe it less often
    upWait = sinceUp < 6 ? Math.min(upWait * 2, 40) : 3;
    setRung(rung + 1);
  } else if (underT > upWait && rung > 0) {
    setRung(rung - 1);
    sinceUp = 0;
  }
}

function basePixelRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  return quality === 'low' ? 1 : quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
}

function applyPixelRatio(): void {
  if (!gfx) return;
  gfx.renderer.setPixelRatio(Math.max(0.5, basePixelRatio() * effectiveScale()));
  resize();
  scenePass?.resizeAO();
}

/** 0 = dynamic, else a fixed fraction of the quality's pixel ratio */
export function setRenderScale(s: number): void {
  userScale = s > 0 ? Math.min(1, Math.max(0.5, s)) : 0;
  overT = underT = 0;
  upWait = 3;
  applyDetailTier();
  applyPixelRatio();
}

/** detail-tier override requests (null = the quality's own); main wires it to the unit-detail LOD */
export function onDetailTier(cb: (q: Quality | null) => void): void { detailHook = cb; cb(detailTier); }

export function renderStats(): { scale: number; gpuMs: number; frameMs: number; timed: boolean; detail: Quality } {
  return {
    scale: gfx ? +(gfx.renderer.getPixelRatio() / basePixelRatio()).toFixed(2) : 1, gpuMs: +gpuMs.toFixed(2), frameMs: +frameMs.toFixed(2),
    timed: timer !== null && gpuMs < frameMs * 1.15, detail: detailTier ?? quality,
  };
}

export function setPostFx(o: { grain: boolean; aberration: boolean }): void {
  grainOn = o.grain;
  caOn = o.aberration;
  applyLens();
}

function applyLens(): void {
  lensPass?.set(grainOn ? (quality === 'high' ? 0.018 : 0.012) : 0, 0.28);
  exposurePass?.setAberration(caOn ? 0.006 : 0);
}

function resize(): void {
  if (!gfx) return;
  const w = Math.max(1, hostEl.clientWidth || window.innerWidth), h = Math.max(1, hostEl.clientHeight || window.innerHeight);
  const { renderer, camera } = gfx;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  setViewmodelAspect(w / h);
  const pr = renderer.getPixelRatio();
  if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); }
  view.width = Math.round(w * pr);
  view.height = Math.round(h * pr);
}

/** snap the frustum centre to whole shadow texels in light space so the map never swims */
function fitShadow(light: THREE.DirectionalLight, box: number, dist: number): void {
  const texel = box / light.shadow.mapSize.x;
  const right = _right.set(0, 1, 0).cross(sunDir);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = _up.crossVectors(sunDir, right);
  const x = Math.round(focus.dot(right) / texel) * texel, y = Math.round(focus.dot(up) / texel) * texel, z = focus.dot(sunDir);
  const c = right.multiplyScalar(x).addScaledVector(up, y).addScaledVector(sunDir, z);
  light.target.position.copy(c);
  light.position.copy(c).addScaledVector(sunDir, dist);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

function applyShadowFocus(): void {
  if (!gfx) return;
  fitShadow(sun, NEAR_BOX[quality], SHADOW_DIST);
  fitShadow(sunFar, FAR_BOX, FAR_DIST);
}

function setShadowBox(light: THREE.DirectionalLight, box: number, dist: number, size: number): void {
  const sc = light.shadow.camera;
  sc.left = -box / 2; sc.right = box / 2; sc.top = box / 2; sc.bottom = -box / 2;
  sc.near = 1; sc.far = dist * 2;
  sc.updateProjectionMatrix();
  if (light.shadow.mapSize.x !== size) {
    light.shadow.mapSize.set(size, size);
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }
  light.shadow.normalBias = (box / size) * 1.2;
}

/** haze and fog split: low keeps three's distance fog only; medium/high move part of it into the height-fog pass */
function applyAtmos(): void {
  const p = PRESETS[env];
  const post = quality !== 'low';
  fog.density = p.fogD * (post ? 0.65 : 1);
  const hf = atmosU.uHFog.value;
  hf.set(post ? p.hazeD : 0, 1 / p.hazeH, 0, p.scatter);
  if (godPass) godPass.strength = quality === 'high' ? p.god : 0;
}

function applyQuality(q: Quality): void {
  quality = q;
  view.quality = q;
  dustU.uDvCloudSurf.value = q === 'low' ? 0 : 1;
  qualU.uDvQ.value = q === 'low' ? 0 : q === 'medium' ? 1 : 2;
  setMeshDetail(q);
  if (!gfx) return;
  const { renderer } = gfx;
  renderer.setPixelRatio(Math.max(0.5, basePixelRatio() * effectiveScale()));
  applyDetailTier();
  setShadowBox(sun, NEAR_BOX[q], SHADOW_DIST, NEAR_MAP[q]);
  setShadowBox(sunFar, FAR_BOX, FAR_DIST, FAR_MAP[q]);
  sun.shadow.radius = q === 'low' ? 1 : q === 'medium' ? 2.5 : 3;
  sunFar.shadow.radius = 1.5;
  sunFar.shadow.needsUpdate = true;
  if (q !== 'low') {
    ensureComposer(gfx);
    if (scenePass) {
      scenePass.ao = true;
      // half-res AO upsampled is indistinguishable under the denoiser; full res cost as much as the scene
      scenePass.aoScale = 0.5;
      scenePass.forceHalf = q === 'medium';
      scenePass.gtao.updateGtaoMaterial({ samples: q === 'high' ? 12 : 8 });
    }
    if (godPass) godPass.enabled = q === 'high';
    applyLens();
    exposurePass?.setLimits(1.0, env === 'night' ? 0.9 : 1.3, 0.65);
    if (exposurePass) exposurePass.reset = true;
  }
  softU.uSoft.value = 0;
  resize();
  scenePass?.resizeAO();
  applyAtmos();
  applyShadowFocus();
}

function buildEnvMap(): void {
  if (!gfx || lost) return;
  sky.envMode(true);
  const rt = pmrem.fromScene(sky.envScene, 0, 0.1, 100, { size: 256 });
  sky.envMode(false);
  gfx.scene.environment = rt.texture;
  envRT?.dispose();
  envRT = rt;
  lighting.env = rt.texture;
  lighting.version++;
}

function makeSun(): THREE.DirectionalLight {
  const l = new THREE.DirectionalLight(0xffffff, 3);
  l.castShadow = true;
  l.shadow.bias = -0.0002;
  return l;
}

export function initRenderer(host: HTMLElement, q: Quality): Gfx {
  if (gfx) return gfx;
  hostEl = host;
  const renderer = new THREE.WebGLRenderer({ antialias: q === 'low', powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // counters cover the whole frame (scene + overlay + post), reset in renderFrame
  renderer.info.autoReset = false;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 1200);
  camera.position.set(0, 1.7, 26);
  gfx = { renderer, scene, camera };

  fog = new THREE.FogExp2(0xb9cfe3, 0.0021);
  scene.fog = fog;
  // near cascade must come first: three keeps scene order among shadow casters and the patch weights index 0
  sun = makeSun();
  sunFar = makeSun();
  sunFar.shadow.bias = -0.0003;
  sunFar.shadow.autoUpdate = false;
  if (!cascades) { sunFar.castShadow = false; sunFar.visible = false; }
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
  sky = new SkyDome();
  scene.add(sun, sun.target, sunFar, sunFar.target, hemi, sky.mesh);
  pmrem = new THREE.PMREMGenerator(renderer);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    try {
      buildEnvMap();
      renderer.shadowMap.needsUpdate = true;
      sunFar.shadow.needsUpdate = true;
      if (exposurePass) exposurePass.reset = true;
    } catch (err) {
      console.warn('render: context restore', err);
    }
  }, false);
  initTimer(renderer);
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(host);

  applyQuality(q);
  setEnvironment(env);
  return gfx;
}

export function setQuality(q: Quality): void {
  applyQuality(q);
}

export function setEnvironment(e: EnvPreset): void {
  env = e;
  if (!gfx) return;
  const p = PRESETS[e], el = THREE.MathUtils.degToRad(p.elev), az = THREE.MathUtils.degToRad(p.azim);
  sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();

  const sunC = new THREE.Color(p.sun), zen = new THREE.Color(p.zenith), hor = new THREE.Color(p.horizon);
  for (const l of [sun, sunFar]) {
    l.color.copy(sunC);
    l.intensity = p.sunI;
    l.shadow.intensity = p.shadow;
  }
  sunFar.shadow.needsUpdate = true;
  hemi.color.setHex(p.hemiSky);
  hemi.groundColor.setHex(p.hemiGround);
  hemi.intensity = p.hemiI;
  fog.color.copy(hor);
  gfx.renderer.toneMappingExposure = p.exposure;
  gfx.scene.environmentIntensity = p.envI;

  const k = (p.sunI * Math.max(sunDir.y, 0)) / Math.PI;
  // what comes back up off a site is paving, concrete, rubble and trodden grass: a grey-brown, not a sandy orange
  const groundEnv = new THREE.Color(0.19, 0.175, 0.155).multiply(new THREE.Color(sunC.r * k + hor.r * 0.8, sunC.g * k + hor.g * 0.8, sunC.b * k + hor.b * 0.8));
  sky.set({
    sunDir,
    sunDisc: sunC.clone().multiplyScalar(p.disc),
    sunSize: Math.cos(THREE.MathUtils.degToRad(p.discDeg * 0.5)),
    zenith: zen,
    horizon: hor,
    ground: groundEnv,
    glow: new THREE.Color(p.glow).multiplyScalar(p.glowK),
    cloud: p.cloud,
    cloudLit: new THREE.Color(p.cloudLit),
    cloudShade: new THREE.Color(p.cloudShade),
    stars: p.stars,
  });
  if (bloom) { bloom.threshold = p.bloomT; bloom.strength = p.bloomS; }

  lighting.preset = e;
  lighting.sunDir.copy(sunDir);
  lighting.sunColor.copy(sunC);
  lighting.sunIntensity = p.sunI;
  lighting.hemiSky.copy(hemi.color);
  lighting.hemiGround.copy(hemi.groundColor);
  lighting.hemiIntensity = p.hemiI;
  lighting.envIntensity = p.envI;
  lighting.ambTop.copy(zen).lerp(hor, 0.5).multiplyScalar(p.envI).add(hemi.color.clone().multiplyScalar(p.hemiI));
  lighting.ambBot.copy(groundEnv).multiplyScalar(p.envI).add(hemi.groundColor.clone().multiplyScalar(p.hemiI));
  lighting.lamps = e === 'night' ? 1 : e === 'dusk' ? 0.7 : 0;
  lighting.humidity = p.humid;
  lighting.ambTop.r += 0.25 * lighting.lamps; lighting.ambTop.g += 0.2 * lighting.lamps; lighting.ambTop.b += 0.15 * lighting.lamps;

  const day = zen.clone().lerp(hor, 0.5).multiplyScalar(p.envI).add(sunC.clone().multiplyScalar(p.sunI * Math.max(sunDir.y, 0) * 0.04));
  roomU.uDvRoom.value.set(day.r, day.g, day.b, lighting.lamps);

  dustU.uDvSunDir.value.copy(sunDir);
  envU.uDvWet.value = p.wet;
  atmosU.uAtmSun.value.copy(sunDir);
  atmosU.uHFogCol.value.copy(hor);
  atmosU.uHFogSun.value.copy(sunC).multiplyScalar(p.sunI / Math.PI * 0.35);
  if (exposurePass) {
    exposurePass.setLimits(1.0, e === 'night' ? 0.9 : 1.3, 0.65);
    exposurePass.reset = true;
  }
  applyAtmos();
  buildEnvMap();
  applySceneryEnv(e);
  applyShadowFocus();
}

export function setShadowFocus(center: Vec3): void {
  focus.set(center[0], center[1], center[2]);
  applyShadowFocus();
}

export function renderFrame(dt: number): void {
  if (!gfx || lost) return;
  const { renderer } = gfx;
  if (renderer.getContext().isContextLost()) return;
  renderer.info.reset();
  adapt(dt);
  timerBegin();
  try {
    drawFrame(dt);
  } finally {
    timerEnd();
  }
}

function drawFrame(dt: number): void {
  const { renderer, scene, camera } = gfx!;
  time += Math.min(Math.max(dt, 0), 0.1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  sky.update(camera.position, time);
  syncViewmodel(camera);
  // the far cascade only frames distant towers: refreshing it every few frames is invisible
  if (++farTick >= FAR_EVERY[quality]) { farTick = 0; sunFar.shadow.needsUpdate = true; }
  if (quality === 'low' || !composer) {
    softU.uSoft.value = 0;
    camera.layers.enable(FX_SOFT_LAYER);
    camera.layers.enable(FX_LAYER);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    camera.layers.disable(FX_LAYER);
    camera.layers.disable(FX_SOFT_LAYER);
    const vm = viewmodelLayer();
    if (vm) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(vm.scene, vm.camera);
      renderer.autoClear = true;
    }
    return;
  }
  // the main pass must land in the target that owns the depth texture GTAO samples
  composer.readBuffer = composer.renderTarget1;
  composer.writeBuffer = composer.renderTarget2;
  composer.render(dt);
}
