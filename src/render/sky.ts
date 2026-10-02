/* Art-directed gradient sky: horizon band equals the fog colour exactly so fogged terrain melts into
   it, plus sun/moon disc, Mie-ish glow, drifting fbm clouds with cheap self-shadowing and stars.
   uEnv = 1 renders the variant used for the PMREM environment (no disc, ground bounce below). */
import * as THREE from 'three';

const vertexShader = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}`;

const fragmentShader = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uSunSize;
uniform float uCloud;
uniform float uStars;
uniform float uTime;
uniform float uEnv;
varying vec3 vDir;

float h21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = h21( i );
  float b = h21( i + vec2( 1.0, 0.0 ) );
  float c = h21( i + vec2( 0.0, 1.0 ) );
  float d = h21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float fbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 5; i ++ ) {
    s += a * vnoise( p );
    p = p * 2.03 + vec2( 1.7, 9.2 );
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  float up = max( h, 0.0 );
  float cosT = dot( d, uSunDir );
  float toward = max( cosT, 0.0 );
  vec3 col = mix( uHorizon, uZenith, pow( up, 0.5 ) );
  col += uGlow * ( pow( toward, 6.0 ) * 0.6 + pow( toward, 48.0 ) * 0.9 ) * ( 1.0 - 0.5 * up );
  col += uGlow * 0.3 * pow( 1.0 - up, 5.0 ) * ( cosT * 0.5 + 0.5 ) * ( cosT * 0.5 + 0.5 );

  // stars only show against a truly dark sky: the eye loses them once the background is brighter than deep
  // twilight, so they fade by the sky's own luminance (and drop out low down in the horizon skyglow)
  float starVis = uStars * ( 1.0 - smoothstep( 0.005, 0.014, dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) ) );
  if ( starVis > 0.001 && h > 0.0 ) {
    vec2 sp = d.xz / ( d.y + 1.0 ) * 170.0;
    vec2 cell = floor( sp );
    float r = h21( cell );
    if ( r > 0.982 ) {
      vec2 c = cell + 0.5 + ( vec2( h21( cell + 7.1 ), h21( cell + 3.7 ) ) - 0.5 ) * 0.6;
      float tw = 0.65 + 0.35 * sin( uTime * ( 1.3 + r * 4.0 ) + r * 40.0 );
      // points, not discs: only the brightest few spread to more than a pixel or two
      float s = 1.0 - smoothstep( 0.0, 0.14 + 0.16 * ( r - 0.982 ) / 0.018, length( sp - c ) );
      col += vec3( 0.85, 0.92, 1.0 ) * starVis * s * tw * ( r - 0.982 ) * 90.0 * smoothstep( 0.0, 0.25, h );
    }
  }

  float cover = 0.0;
  if ( uCloud > 0.0 && h > 0.0 ) {
    vec2 cp = d.xz / ( h + 0.08 ) * 1.6 + vec2( uTime * 0.004, uTime * 0.0015 );
    float n = fbm( cp );
    float thr = 1.0 - uCloud;
    cover = smoothstep( thr - 0.06, thr + 0.22, n ) * smoothstep( 0.0, 0.1, h );
    float thick = smoothstep( thr, thr + 0.4, n );
    float n2 = fbm( cp + uSunDir.xz * 0.06 );
    float lit = clamp( 0.62 - ( n2 - n ) * 4.0, 0.0, 1.0 );
    vec3 cc = mix( uCloudShade, uCloudLit, lit ) * ( 1.0 - 0.25 * thick );
    cc += uGlow * pow( toward, 10.0 ) * ( 1.0 - thick ) * 1.4;
    col = mix( col, cc, cover );
  }

  float disc = smoothstep( uSunSize, uSunSize + 0.00008, cosT ) * ( 1.0 - uEnv ) * ( 1.0 - cover * 0.93 );
  col += uSunCol * disc;

  vec3 below = mix( uHorizon, uGround, uEnv );
  col = mix( col, below, 1.0 - smoothstep( -0.06, 0.0, h ) );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyParams {
  sunDir: THREE.Vector3;
  sunDisc: THREE.Color;
  sunSize: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  glow: THREE.Color;
  cloud: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  stars: number;
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly envScene = new THREE.Scene();
  private readonly mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uCloudLit: { value: new THREE.Color() },
        uCloudShade: { value: new THREE.Color() },
        uSunSize: { value: 0.9998 },
        uCloud: { value: 0.3 },
        uStars: { value: 0 },
        uTime: { value: 0 },
        uEnv: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.name = 'sky';
    // PMREM never clears depth between cube faces, so the env copy must not depend on it
    const envMat = new THREE.ShaderMaterial({ uniforms: this.mat.uniforms, vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    const env = new THREE.Mesh(geo, envMat);
    env.frustumCulled = false;
    this.envScene.add(env);
  }
  set(p: SkyParams): void {
    const u = this.mat.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir);
    (u.uSunCol.value as THREE.Color).copy(p.sunDisc);
    (u.uZenith.value as THREE.Color).copy(p.zenith);
    (u.uHorizon.value as THREE.Color).copy(p.horizon);
    (u.uGround.value as THREE.Color).copy(p.ground);
    (u.uGlow.value as THREE.Color).copy(p.glow);
    (u.uCloudLit.value as THREE.Color).copy(p.cloudLit);
    (u.uCloudShade.value as THREE.Color).copy(p.cloudShade);
    u.uSunSize.value = p.sunSize;
    u.uCloud.value = p.cloud;
    u.uStars.value = p.stars;
  }
  envMode(on: boolean): void { this.mat.uniforms.uEnv.value = on ? 1 : 0; }
  update(camPos: THREE.Vector3, time: number): void {
    this.mesh.position.copy(camPos);
    this.mat.uniforms.uTime.value = time;
  }
}
