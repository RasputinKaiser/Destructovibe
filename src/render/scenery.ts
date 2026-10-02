/* Non-colliding set dressing: ground, fenced site perimeter (> 62 m), floodlight towers, cabins and
   stockpiles, a tower crane, low-poly hills with trees and a distant instanced skyline. Everything
   repeated is instanced or merged; materials/textures are built once and shared across rebuilds. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, simplex2d } from 'math/noise';
import type { EnvPreset } from '../types';
import { getGroundMaterial, getPieceMaterials } from './materials';
import { cabinTex, chainlinkTex, coneTex, hoardingTex, latticeTex, makeRng, noiseTex, signTex, smooth, treeAtlas } from './textures';
import { lighting } from './shared';

const LAMPS: Record<EnvPreset, number> = { noon: 0, golden: 0, overcast: 0, dusk: 0.7, night: 1 };
/* Site dressing is laid out for the 64 m Clearance site (terrain.half 64). A bigger map (terrain.half) pushes the fence,
   floodlights, cabins, stockpiles and crane outward by the same margin so none of it stands inside the play area. */
const BASE_HALF = 64;
let outset = 0;
let FENCE = 66;
/** the map's surroundings: open country (default) or the town it was cut out of */
let TOWN = false;
let TOWERS: [number, number][] = [[70, 70], [-70, 70], [70, -70], [-70, -70]];
const LAMP_Y = 20.4;

let root: THREE.Group | null = null;

interface Mats {
  galv: THREE.MeshStandardMaterial;
  link: THREE.MeshStandardMaterial;
  hoard: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  cone: THREE.MeshBasicMaterial;
  cabin: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  hills: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  trees: THREE.ShaderMaterial;
  bark: THREE.MeshStandardMaterial;
  lattice: THREE.MeshStandardMaterial;
  craneSolid: THREE.MeshStandardMaterial;
  beacon: THREE.MeshBasicMaterial;
  skyline: THREE.ShaderMaterial;
}
let M: Mats | null = null;
const spots: THREE.SpotLight[] = [];
let cones: THREE.InstancedMesh | null = null;
let beacons: THREE.Mesh | null = null;

/* ---------------- skyline shader ---------------- */

const SKY_VS = /* glsl */`
attribute vec3 color;
varying vec3 vW;
varying vec3 vN;
varying float vSeed;
varying float vPart;
varying float vH;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  vN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
  vSeed = fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  vPart = color.r;
  vH = position.y;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

/* Distant towers: per-building storey and bay sizes, a facade palette (concrete, stone, brick, dark curtain wall), and
   windows box-filtered over the pixel footprint so a far facade averages to its mean instead of shimmering. Lights go
   on by runs of bays along a floor (a tenancy), at a share that varies building to building; rooftop plant, crowns and
   spires (part 1) are plain. */
const SKY_FS = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform float uLit;
varying vec3 vW;
varying vec3 vN;
varying float vSeed;
varying float vPart;
varying float vH;
#include <fog_pars_fragment>
float hs( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// integral of a 0/1 pulse that is 1 on [a, b] of every unit cell
float dvPI( float x, float a, float b ) { return floor( x ) * ( b - a ) + clamp( fract( x ), a, b ) - a; }
// the pulse averaged over [x - w/2, x + w/2]
float dvPulse( float x, float a, float b, float w ) {
  w = max( w, 1e-4 );
  return ( dvPI( x + 0.5 * w, a, b ) - dvPI( x - 0.5 * w, a, b ) ) / w;
}
void main() {
  vec3 n = normalize( vN );
  float side = 1.0 - step( 0.5, abs( n.y ) );
  float wall = side * ( 1.0 - step( 0.5, vPart ) );
  vec2 fc = abs( n.x ) > abs( n.z ) ? vec2( vW.z, vW.y ) : vec2( vW.x, vW.y );
  float kind = fract( vSeed * 5.31 );
  vec2 sz = vec2( 2.6 + 1.8 * fract( vSeed * 3.7 ), 3.2 + 0.7 * fract( vSeed * 9.1 ) );
  bool curtain = kind > 0.78;
  vec2 g = fc / sz;
  vec2 fw = fwidth( g );
  float wx = curtain ? 0.94 : 0.62 + 0.2 * fract( vSeed * 13.3 );
  float wy = curtain ? 0.82 : 0.52 + 0.12 * fract( vSeed * 17.9 );
  float win = wall * dvPulse( g.x, 0.5 - wx * 0.5, 0.5 + wx * 0.5, fw.x ) * dvPulse( g.y, 0.86 - wy, 0.86, fw.y ) * step( 4.0, vW.y );
  // which windows are lit: runs of 2-6 bays per floor, a share per building
  vec2 cell = floor( g );
  float run = 2.0 + floor( 5.0 * fract( vSeed * 23.7 ) );
  float share = uLit * ( 0.25 + 1.0 * fract( vSeed * 31.3 ) );
  float h1 = hs( vec2( floor( cell.x / run ), cell.y ) + vSeed * 17.0 );
  float h2 = hs( cell + vSeed * 7.0 );
  float litCell = step( h1, share ) * step( 0.12, h2 ) + step( 0.985, h2 ) * step( 0.1, uLit );
  float far = smoothstep( 0.25, 0.7, max( fw.x, fw.y ) );
  float lit = mix( litCell, min( share * 0.95 + 0.015, 1.0 ), far ) * win;
  vec3 pal = kind < 0.3 ? vec3( 0.42, 0.41, 0.39 ) : kind < 0.55 ? vec3( 0.55, 0.5, 0.43 ) : kind < 0.78 ? vec3( 0.4, 0.27, 0.21 ) : vec3( 0.11, 0.14, 0.17 );
  vec3 base = pal * ( 0.85 + 0.3 * fract( vSeed * 41.0 ) );
  if ( vPart > 0.5 ) base = vec3( 0.36, 0.36, 0.35 ) * ( 0.8 + 0.4 * fract( vSeed * 61.0 ) );
  // grime toward the street, a lighter crown
  base *= 0.82 + 0.18 * smoothstep( 0.0, 0.8, vH );
  vec3 amb = mix( uAmbBot, uAmbTop, n.y * 0.5 + 0.5 );
  vec3 glassC = vec3( 0.035, 0.045, 0.055 );
  #ifdef USE_FOG
    // glazing seen at a distance mirrors the sky it faces
    glassC += fogColor * ( curtain ? 0.28 : 0.16 );
  #endif
  vec3 alb = mix( base, vec3( 0.0 ), win );
  vec3 col = alb * ( amb + uSunCol * max( dot( n, uSunDir ), 0.0 ) ) + glassC * win * ( 1.0 - lit );
  vec3 wc = mix( vec3( 1.0, 0.72, 0.42 ), vec3( 0.78, 0.86, 1.0 ), step( 0.8, hs( cell * 1.7 + 3.0 ) ) ) * ( 0.45 + 0.7 * hs( cell + 9.1 ) );
  wc = mix( wc, vec3( 0.88, 0.8, 0.66 ), far );
  col += wc * lit * 1.4;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    // aerial perspective: surfaces go to the horizon colour, lit windows keep a little more of their contrast
    col = mix( col, fogColor, fogF * 0.68 ) + wc * lit * 1.4 * fogF * 0.08;
  #endif
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* Tree impostors: a camera-facing card per tree (turning about its trunk), cut from a 2×2 atlas of side views. The
   atlas carries coverage, a sideways normal and how far out in the crown a texel is, so the crown is lit as a volume:
   a lit flank, a dark core, and leaves glowing when the sun is behind them. */
const TREE_VS = /* glsl */`
attribute float aKind;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vR;
varying vec3 vToCam;
#include <fog_pars_vertex>
void main() {
  vec3 base = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  float sw = length( instanceMatrix[ 0 ].xyz ), sh = length( instanceMatrix[ 1 ].xyz );
  vec3 toCam = cameraPosition - base;
  toCam.y = 0.0;
  toCam = normalize( toCam + vec3( 1e-5, 0.0, 0.0 ) );
  vec3 right = vec3( toCam.z, 0.0, - toCam.x );
  vec3 w = base + right * ( position.x * sw ) + vec3( 0.0, position.y * sh, 0.0 );
  vec2 cell = vec2( mod( aKind, 2.0 ), floor( aKind * 0.5 ) );
  vUv = ( cell + vec2( position.x + 0.5, position.y ) ) * 0.5;
  vTint = instanceColor;
  vR = right;
  vToCam = toCam;
  vec4 mvPosition = viewMatrix * vec4( w, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const TREE_FS = /* glsl */`
uniform sampler2D uTex;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vR;
varying vec3 vToCam;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D( uTex, vUv );
  // a dithered band at the cut so the crown edge is soft rather than a hard stencil
  float d = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  if ( t.r < 0.38 + 0.24 * d ) discard;
  float nx = t.g * 2.0 - 1.0, outer = t.b;
  bool trunk = t.a < 0.5;
  vec3 n = normalize( vR * nx * 0.85 + vec3( 0.0, 0.3 + 0.5 * outer, 0.0 ) + vToCam * sqrt( max( 0.0, 1.0 - nx * nx ) ) * 0.8 );
  vec3 alb = trunk ? vec3( 0.2, 0.16, 0.12 ) : vTint * mix( 0.5, 1.12, outer );
  float wrap = clamp( dot( n, uSunDir ) * 0.6 + 0.4, 0.0, 1.0 );
  float back = trunk ? 0.0 : pow( clamp( dot( - vToCam, normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) + 1e-5 ) ), 0.0, 1.0 ), 4.0 ) * ( 1.0 - 0.5 * outer ) * 0.55;
  vec3 amb = mix( uAmbBot, uAmbTop, n.y * 0.5 + 0.5 ) * mix( 0.55, 1.0, outer );
  vec3 col = alb * ( amb + uSunCol * ( wrap * mix( 0.45, 1.0, outer ) ) ) + vTint * uSunCol * back * 0.6;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    col = mix( col, fogColor, fogF );
  #endif
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ---------------- helpers ---------------- */

/** metre UVs by dominant normal axis, same convention as the destructible pieces */
function planarUv(g: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }
    else if (ay >= az) { u = x; v = ny > 0 ? -z : z; }
    else { u = nz > 0 ? x : -x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function flip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') ng.deleteAttribute(k);
    return ng;
  });
  const m = mergeGeometries(clean, false);
  if (!m) throw new Error('scenery: geometry merge failed');
  return m;
}

const _o = new THREE.Object3D();
function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): void {
  _o.position.set(x, y, z);
  _o.rotation.set(0, ry, 0);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  mesh.setMatrixAt(i, _o.matrix);
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.frustumCulled = false;
  return m;
}

function colorGeo(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/* ---------------- terrain ---------------- */

const hillGen = simplex2d.create(4242);
export function hillHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < 168) return -0.4;
  const az = Math.abs(Math.atan2(x, -z));
  const city = 1 - 0.78 * (1 - smooth(0.25, 0.75, az));
  const n = fbm((f) => simplex2d.sample(hillGen, x * 0.0045 * f, z * 0.0045 * f), 4, 2, 0.5);
  const ramp = smooth(168, 340, r);
  return ramp * city * (1 - 0.35 * smooth(850, 1150, r)) * (12 + 40 * (n * 0.5 + 0.5)) - 0.4 * (1 - smooth(168, 215, r));
}

function ground(): THREE.Mesh {
  const g = new THREE.CircleGeometry(1150, 96).rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
  const m = new THREE.Mesh(g, getGroundMaterial());
  m.receiveShadow = true;
  m.name = 'ground';
  return m;
}

function hills(mats: Mats): THREE.Mesh {
  const RS = [165, 185, 210, 240, 275, 320, 370, 430, 500, 580, 670, 770, 880, 1000, 1150], AS = 200;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const dry = new THREE.Color(0x6f6a45), green = new THREE.Color(0x4e5c34), dark = new THREE.Color(0x3e4a2c), rock = new THREE.Color(0x77695a);
  const c = new THREE.Color(), rnd = makeRng(71);
  for (let ri = 0; ri < RS.length; ri++) for (let ai = 0; ai <= AS; ai++) {
    const a = (ai / AS) * Math.PI * 2 + (ri % 2) * (Math.PI / AS), r = RS[ri] * (1 + (rnd() - 0.5) * 0.04);
    const x = Math.sin(a) * r, z = -Math.cos(a) * r, h = hillHeight(x, z);
    pos.push(x, h, z);
    const t = Math.min(1, Math.max(0, h / 45));
    c.copy(dry).lerp(green, smooth(0.1, 0.5, t)).lerp(dark, smooth(0.55, 1, t));
    if (rnd() < 0.12) c.lerp(rock, 0.5);
    const k = 0.85 + rnd() * 0.25;
    col.push(c.r * k, c.g * k, c.b * k);
  }
  const W = AS + 1;
  for (let ri = 0; ri < RS.length - 1; ri++) for (let ai = 0; ai < AS; ai++) {
    const a = ri * W + ai, b = a + 1, d = a + W, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mats.hills);
  m.receiveShadow = true;
  m.name = 'hills';
  return m;
}

/* Copses and hedgerow trees rather than an even scatter: clumps of 3-14 round a centre, conifers and broadleaves in
   their own stands, a few loners. Each is a lit impostor card (see TREE_FS). */
function trees(mats: Mats): THREE.Object3D[] {
  const rnd = makeRng(303), N = 760;
  const ok = (x: number, z: number): boolean => {
    const r = Math.hypot(x, z), a = Math.atan2(x, -z);
    if (r < 95 || r > 470) return false;
    if (r > 300 && Math.abs(a) < 0.6) return false;
    if (Math.max(Math.abs(x), Math.abs(z)) < (TOWN ? 185 : FENCE + 4)) return false;
    if (Math.hypot(x + 48, z + 112 + outset) < 16 || (x < -70 - outset && x > -95 - outset && z > 20 && z < 55)) return false;
    return true;
  };
  const card = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const m = new THREE.InstancedMesh(card, mats.trees, N);
  m.frustumCulled = false;
  const kind = new Float32Array(N);
  const c = new THREE.Color(), dark = new THREE.Color(0x26402a), mid = new THREE.Color(0x3c5a33), olive = new THREE.Color(0x5d6b34), autumn = new THREE.Color(0x7a6a32);
  let n = 0, guard = 0;
  while (n < N && guard++ < 20000) {
    const a = rnd() * Math.PI * 2, r = 100 + Math.pow(rnd(), 0.75) * 360, cx = Math.sin(a) * r, cz = -Math.cos(a) * r;
    if (!ok(cx, cz)) continue;
    const conifer = rnd() < 0.45, size = rnd() < 0.15 ? 1 : 3 + Math.floor(rnd() * 12), spread = 5 + size * 1.6;
    const tone = rnd();
    for (let i = 0; i < size && n < N; i++) {
      const aa = rnd() * Math.PI * 2, rr = spread * Math.sqrt(rnd()), x = cx + Math.sin(aa) * rr, z = cz + Math.cos(aa) * rr;
      if (!ok(x, z)) continue;
      const y = hillHeight(x, z) - 0.4, h = conifer ? 9 + rnd() * 12 : 7 + rnd() * 9, w = h * (conifer ? 0.48 + rnd() * 0.12 : 0.9 + rnd() * 0.25);
      place(m, n, x, y, z, 0, w, h, 1);
      kind[n] = conifer ? Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
      if (conifer) c.copy(dark).lerp(mid, rnd() * 0.6);
      else c.copy(mid).lerp(olive, 0.3 + rnd() * 0.5).lerp(autumn, tone > 0.8 ? rnd() * 0.6 : 0);
      c.multiplyScalar(0.85 + rnd() * 0.3);
      m.setColorAt(n, c);
      n++;
    }
  }
  m.count = n;
  card.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  m.name = 'trees';
  return [m];
}

/* ---------------- site perimeter ---------------- */

function fence(mats: Mats): THREE.Object3D[] {
  const out: THREE.Object3D[] = [], S = FENCE, H = 2.35;
  const sides: { x: number; z: number; ry: number }[] = [
    { x: 0, z: -S, ry: 0 }, { x: 0, z: S, ry: Math.PI }, { x: -S, z: 0, ry: Math.PI / 2 }, { x: S, z: 0, ry: -Math.PI / 2 },
  ];
  const nPer = Math.round((2 * S) / 3);
  const posts = inst(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6).translate(0, 1.25, 0), mats.galv, nPer * 4);
  let k = 0;
  for (const s of sides) for (let i = 0; i < nPer; i++) {
    const t = -S + i * 3, dx = Math.cos(s.ry), dz = -Math.sin(s.ry);
    place(posts, k++, s.x + dx * t, 0, s.z + dz * t);
  }
  out.push(posts);
  const rails: THREE.BufferGeometry[] = [], panels: THREE.BufferGeometry[] = [];
  for (const s of sides) {
    for (const y of [0.12, 2.42]) rails.push(new THREE.CylinderGeometry(0.025, 0.025, 2 * S, 6).rotateZ(Math.PI / 2).rotateY(s.ry).translate(s.x, y, s.z));
    panels.push(new THREE.PlaneGeometry(2 * S, H).translate(0, H / 2 + 0.08, 0).rotateY(s.ry).translate(s.x, 0, s.z));
  }
  out.push(new THREE.Mesh(merge(rails), mats.galv));
  const link = new THREE.Mesh(merge(panels), mats.link);
  link.renderOrder = 2;
  out.push(link);

  const hoards: THREE.BufferGeometry[] = [];
  for (const [len, z] of [[88, -S - 0.2], [60, S + 0.2]]) {
    const b = new THREE.BoxGeometry(len, 2.4, 0.06).translate(0, 1.22, z);
    const uv = b.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 12));
    hoards.push(b);
  }
  const hoard = new THREE.Mesh(merge(hoards), mats.hoard);
  hoard.receiveShadow = true;
  out.push(hoard);

  const spotsXZ: [number, number, number][] = [];
  for (let t = -(S - 10); t <= S - 10; t += 16) { spotsXZ.push([-S + 0.1, t, Math.PI / 2], [S - 0.1, t, -Math.PI / 2]); }
  for (const t of [-60, -52, 52, 60]) spotsXZ.push([t, -S + 0.1, 0]);
  for (const t of [-44, -36, 36, 44]) spotsXZ.push([t, S - 0.1, Math.PI]);
  const signs = inst(new THREE.PlaneGeometry(0.7, 0.7), mats.sign, spotsXZ.length);
  spotsXZ.forEach(([x, z, ry], i) => place(signs, i, x, 1.5, z, ry));
  out.push(signs);
  return out;
}

function towers(mats: Mats): THREE.Object3D[] {
  const structure = merge([
    new THREE.CylinderGeometry(0.16, 0.28, 20, 8).translate(0, 10, 0),
    new THREE.BoxGeometry(1.2, 0.3, 1.2).translate(0, 0.15, 0),
    new THREE.BoxGeometry(3.4, 0.18, 0.18).translate(0, 20, 0),
    new THREE.BoxGeometry(0.1, 0.1, 1.6).translate(0.1, 20.05, -0.7),
    ...[-1.2, -0.4, 0.4, 1.2].map((x) => new THREE.BoxGeometry(0.62, 0.48, 0.3).rotateX(0.45).translate(x, LAMP_Y, 0)),
  ]);
  const faces = merge([-1.2, -0.4, 0.4, 1.2].map((x) => new THREE.PlaneGeometry(0.54, 0.4).translate(0, 0, 0.152).rotateX(0.45).translate(x, LAMP_Y, 0)));
  const st = inst(structure, mats.galv, 4), lf = inst(faces, mats.lamp, 4);
  const coneGeo = new THREE.ConeGeometry(15, 78, 24, 1, true).translate(0, -39, 0);
  cones = inst(coneGeo, mats.cone, 4);
  cones.renderOrder = 12;
  const q = new THREE.Quaternion(), down = new THREE.Vector3(0, -1, 0), dir = new THREE.Vector3(), m = new THREE.Matrix4();
  TOWERS.forEach(([x, z], i) => {
    const ry = Math.atan2(-x, -z);
    place(st, i, x, 0, z, ry);
    place(lf, i, x, 0, z, ry);
    dir.set(-x, -LAMP_Y, -z).normalize();
    q.setFromUnitVectors(down, dir);
    m.compose(new THREE.Vector3(x - Math.sign(x) * 0.3, LAMP_Y, z - Math.sign(z) * 0.3), q, new THREE.Vector3(1, 1, 1));
    cones?.setMatrixAt(i, m);
    let sp = spots[i];
    if (!sp) {
      sp = new THREE.SpotLight(0xffe2b8, 0, 0, 0.62, 0.65, 1);
      sp.castShadow = false;
      spots.push(sp);
    }
    sp.position.set(x, LAMP_Y, z);
    sp.target.position.set(x * 0.08, 0, z * 0.08);
  });
  const out: THREE.Object3D[] = [st, lf, cones];
  for (const sp of spots) out.push(sp, sp.target);
  return out;
}

/* ---------------- yard props ---------------- */

function props(mats: Mats): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const cabins = inst(new THREE.BoxGeometry(6, 2.6, 2.4), mats.cabin, 3);
  place(cabins, 0, -80 - outset, 1.3, 30, Math.PI / 2);
  place(cabins, 1, -80 - outset, 3.92, 30, Math.PI / 2);
  place(cabins, 2, -80 - outset, 1.3, 37.5, Math.PI / 2);
  cabins.castShadow = true;
  out.push(cabins);

  const loo = inst(merge([new THREE.BoxGeometry(1.1, 2.3, 1.1).translate(0, 1.15, 0), new THREE.BoxGeometry(1.24, 0.08, 1.24).translate(0, 2.34, 0)]), mats.plastic, 2);
  place(loo, 0, -80.5 - outset, 0, 44, Math.PI / 2);
  place(loo, 1, -80.5 - outset, 0, 45.4, Math.PI / 2);
  out.push(loo);

  const skipGeo = new THREE.BoxGeometry(3.6, 1.5, 1.8, 2, 1, 1);
  const sp = skipGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) if (sp.getY(i) > 0) { sp.setX(i, sp.getX(i) * 1.25); sp.setZ(i, sp.getZ(i) * 1.12); }
  skipGeo.translate(0, 0.75, 0);
  skipGeo.computeVertexNormals();
  const metal = getPieceMaterials('metal')[0];
  const skips = inst(planarUv(skipGeo.toNonIndexed()), metal, 2);
  place(skips, 0, 74 + outset, 0, -20, Math.PI / 2 + 0.1);
  place(skips, 1, 74.5 + outset, 0, -12.5, Math.PI / 2 - 0.08);
  skips.setColorAt(0, new THREE.Color(0xd89a1f));
  skips.setColorAt(1, new THREE.Color(0x2f6fa8));
  out.push(skips);

  const conc = getPieceMaterials('concrete')[0];
  const rubble = inst(planarUv(new THREE.IcosahedronGeometry(0.45, 0)), conc, 14);
  const rr = makeRng(88);
  for (let i = 0; i < 14; i++) {
    const cx = (i < 7 ? 74 : 74.5) + outset, cz = i < 7 ? -20 : -12.5;
    place(rubble, i, cx + (rr() - 0.5) * 1.0, 1.25 + rr() * 0.3, cz + (rr() - 0.5) * 2.8, rr() * 6, 0.7 + rr() * 0.6, 0.6 + rr() * 0.5, 0.7 + rr() * 0.6);
  }
  out.push(rubble);

  const containers = inst(planarUv(new THREE.BoxGeometry(6.06, 2.59, 2.44).translate(0, 1.295, 0)), metal, 3);
  place(containers, 0, 80 + outset, 0, 42, Math.PI / 2);
  place(containers, 1, 83 + outset, 0, 42, Math.PI / 2);
  place(containers, 2, 81.5 + outset, 2.59, 42.3, Math.PI / 2 + 0.04);
  containers.setColorAt(0, new THREE.Color(0x3a6ea5));
  containers.setColorAt(1, new THREE.Color(0xb5452a));
  containers.setColorAt(2, new THREE.Color(0x4c7d4a));
  containers.castShadow = true;
  out.push(containers);

  const pipe = planarUv(merge([
    new THREE.CylinderGeometry(0.62, 0.62, 2.5, 22, 1, true),
    flip(new THREE.CylinderGeometry(0.5, 0.5, 2.5, 22, 1, true)),
    new THREE.RingGeometry(0.5, 0.62, 22).rotateX(-Math.PI / 2).translate(0, 1.25, 0),
    new THREE.RingGeometry(0.5, 0.62, 22).rotateX(Math.PI / 2).translate(0, -1.25, 0),
  ]).rotateZ(Math.PI / 2));
  const pipes = inst(pipe, conc, 6);
  let n = 0;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) place(pipes, n++, -74 - outset, 0.62 + row * 1.07, -48 + (i + row * 0.5) * 1.26);
  out.push(pipes);

  const steelPipes = inst(planarUv(new THREE.CylinderGeometry(0.16, 0.16, 6, 14).rotateZ(Math.PI / 2)), getPieceMaterials('steel')[0], 9);
  n = 0;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) place(steelPipes, n++, -74 - outset, 0.3 + row * 0.31, -30 + i * 0.34);
  out.push(steelPipes);

  const pallets = inst(planarUv(new THREE.BoxGeometry(1.2, 0.14, 1.0)), getPieceMaterials('wood')[0], 5);
  const bricks = inst(planarUv(new THREE.BoxGeometry(1.0, 0.75, 0.9)), getPieceMaterials('brick')[0], 5);
  for (let i = 0; i < 5; i++) {
    const z = 18 + i * 1.7, ry = (rr() - 0.5) * 0.2;
    place(pallets, i, 72 + outset, 0.07, z, ry);
    place(bricks, i, 72 + outset, 0.14 + 0.375, z, ry);
  }
  out.push(pallets, bricks);
  return out;
}

function crane(mats: Mats): THREE.Object3D[] {
  const lat = planarUv(merge([
    new THREE.BoxGeometry(2, 54, 2).translate(0, 27, 0),
    new THREE.BoxGeometry(60, 1.8, 1.6).translate(28, 55.1, 0),
    new THREE.BoxGeometry(20, 1.4, 1.6).translate(-12, 55, 0),
    new THREE.BoxGeometry(1.6, 7, 1.6).translate(0, 59.5, 0),
  ]), 0.5);
  const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry => {
    const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  const apex = new THREE.Vector3(0, 63, 0);
  const solid = merge([
    colorGeo(new THREE.BoxGeometry(2.2, 2.2, 2.4).translate(1.6, 52.8, 1.9), 0xd9a01e),
    colorGeo(new THREE.BoxGeometry(3, 2.6, 2.2).translate(-18.5, 53.2, 0), 0x8a8780),
    colorGeo(new THREE.BoxGeometry(1.6, 0.6, 1.8).translate(38, 53.9, 0), 0xd9a01e),
    colorGeo(new THREE.CylinderGeometry(0.03, 0.03, 26, 4).translate(38, 40.6, 0), 0x222222),
    colorGeo(new THREE.BoxGeometry(0.8, 1.1, 0.5).translate(38, 27, 0), 0xc9321f),
    colorGeo(new THREE.BoxGeometry(6, 1.5, 6).translate(0, 0.75, 0), 0x8f8b84),
    colorGeo(strut(apex, new THREE.Vector3(34, 56, 0), 0.06), 0x333333),
    colorGeo(strut(apex, new THREE.Vector3(-20, 55.8, 0), 0.06), 0x333333),
  ]);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lat, mats.lattice), new THREE.Mesh(solid, mats.craneSolid));
  beacons = new THREE.Mesh(merge([
    new THREE.SphereGeometry(0.35, 10, 8).translate(0, 63.4, 0),
    new THREE.SphereGeometry(0.3, 10, 8).translate(57.8, 56.2, 0),
  ]), mats.beacon);
  beacons.onBeforeRender = () => { if (M) M.beacon.color.setRGB((performance.now() / 1000) % 1.4 < 0.5 ? 12 : 0.3, 0.05, 0.02); };
  g.add(beacons);
  const cx = -48, cz = -112 - outset;
  g.position.set(cx, hillHeight(cx, cz) + 0.2, cz);
  // jib runs parallel to the site edge so nothing hangs over the play area
  g.rotation.y = Math.atan2(cz, -cx) + 1.25;
  g.children[0].renderOrder = 3;
  return [g];
}

/* ---------------- townscape ---------------- */

/* The town round an inner-city clearance site (render only, no pieces): its streets run on past the site fence
   between terraced rows (brick fronts, slate roofs, a stack on each party wall) out to the edge of the view. The
   site's own streets continue: Mill Lane (x -22) north and south, Works Road (x 26) north, High Street (z 6) and
   Terrace Row (z 38) east and west; further streets make up the blocks. One instanced mesh for the houses and one
   merged mesh for the carriageways and footways. */
let townMat: THREE.MeshStandardMaterial | null = null;
function townscape(): THREE.Object3D[] {
  townMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const E = FENCE + 12, R = 172;
  const xs = [-166, -118, -70, -22, 26, 74, 122, 170], zs = [-154, -106, -58, 6, 38, 86, 134, 182];
  // the unit house: 1 m of frontage (scaled per instance to 4.6-5.6 m), 8 m deep, front toward -z
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => colorGeo(new THREE.BoxGeometry(w, h, d).translate(x, y, z).deleteAttribute('uv'), c);
  const roof = new THREE.BufferGeometry();
  const rp = [-0.5, 5.4, -4.25, 0.5, 5.4, -4.25, 0.5, 8.1, 0, -0.5, 8.1, 0, -0.5, 5.4, 4.25, 0.5, 5.4, 4.25];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  roof.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 2, 4, 2, 3]);
  const slate = colorGeo(roof.toNonIndexed(), 0x4a4e55);
  slate.computeVertexNormals();
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 5.4, -4, -0.5, 5.4, 4, -0.5, 8.0, 0, 0.5, 5.4, 4, 0.5, 5.4, -4, 0.5, 8.0, 0], 3));
  gable.computeVertexNormals();
  colorGeo(gable, 0xffffff);
  const dark = 0x1c1f24;
  const unit = merge([
    box(1, 5.4, 8, 0, 2.7, 0, 0xffffff),
    slate, gable,
    box(0.14, 1.5, 0.9, 0.5, 8.3, 0, 0x7a4a38),
    box(0.3, 2.1, 0.06, -0.28, 1.05, -4.02, 0x2b2320), box(0.34, 1.3, 0.06, 0.17, 1.0 + 0.9, -4.02, dark),
    box(0.26, 1.4, 0.06, -0.26, 3.9, -4.02, dark), box(0.26, 1.4, 0.06, 0.2, 3.9, -4.02, dark),
    box(0.26, 1.2, 0.06, 0.15, 1.8, 4.02, dark), box(0.26, 1.3, 0.06, -0.2, 3.9, 4.02, dark),
  ]);
  const spots: [number, number, number, number][] = [];
  const rnd = makeRng(1904);
  const inSite = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) < E;
  const clear = (x: number, z: number) => !inSite(x, z) && Math.hypot(x, z) < R && Math.hypot(x + 48, z + 112 + outset) > 14
    && TOWERS.every(([tx, tz]) => Math.hypot(x - tx, z - tz) > 9);
  for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i] + 5.5, x1 = xs[i + 1] - 5.5;
    // a row facing each street, back gardens and an alley between them
    for (const [zf, face] of [[zs[j] + 5.5 + 4, 0], [zs[j + 1] - 5.5 - 4, Math.PI]] as [number, number][]) {
      if (zs[j + 1] - zs[j] < 30 && face) continue;
      let x = x0;
      while (x < x1 - 4) {
        const w = Math.min(x1 - x, 4.6 + rnd() * 1.0);
        const cx = x + w / 2;
        if (clear(cx, zf)) spots.push([cx, zf, w, face]);
        x += w;
      }
    }
  }
  const houses = inst(unit, townMat, spots.length);
  const c = new THREE.Color();
  const bricks = [0x8e5a44, 0x9a6a50, 0x7d4c3a, 0xa27458, 0xb89878, 0xd8d0c0];
  spots.forEach(([x, z, w, face], i) => {
    place(houses, i, x, hillHeight(x, z) + 0.35, z, face, w, 0.96 + 0.08 * rnd(), 1);
    houses.setColorAt(i, c.setHex(bricks[Math.floor(rnd() * bricks.length)]).multiplyScalar(0.9 + 0.2 * rnd()));
  });
  houses.name = 'townscape';
  // carriageways (7 m) with footways either side, from the site fence out through the town, just over the flat
  // ground disc (y 0) inside the hills
  const road: THREE.BufferGeometry[] = [];
  const strip = (axis: 'x' | 'z', at: number, a: number, b: number) => {
    const L = b - a, m = (a + b) / 2;
    for (const [w, off, col, y] of [[7, 0, 0x3b3c3e, 0.04], [2.2, 4.6, 0x8c887f, 0.08], [2.2, -4.6, 0x8c887f, 0.08]] as [number, number, number, number][]) {
      const g = new THREE.PlaneGeometry(axis === 'x' ? L : w, axis === 'x' ? w : L).rotateX(-Math.PI / 2);
      g.translate(axis === 'x' ? m : at + off, y, axis === 'x' ? at + off : m);
      road.push(colorGeo(g, col));
    }
  };
  for (const x of xs) {
    const ends = x === -22 ? [[-R, -FENCE], [FENCE, R]] : x === 26 ? [[-R, -FENCE]] : Math.abs(x) > E ? [[-R, R]] : [[-R, -E], [E, R]];
    for (const [a, b] of ends) strip('z', x, a, b);
  }
  for (const z of zs) {
    const ends = z === 6 || z === 38 ? [[-R, -FENCE], [FENCE, R]] : Math.abs(z) > E ? [[-R, R]] : [[-R, -E], [E, R]];
    for (const [a, b] of ends) strip('x', z, a, b);
  }
  const streets = new THREE.Mesh(merge(road), townMat);
  streets.name = 'town-streets';
  streets.receiveShadow = true;
  return [houses, streets];
}

/** a box in the unit building (footprint ±0.5, height 0..1); part 1 = plain (plant, crown, spire), 0 = windowed facade */
function sbox(w: number, h: number, d: number, x: number, y: number, z: number, part: number): THREE.BufferGeometry {
  return colorGeo(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).deleteAttribute('uv'), part ? 0xffffff : 0x000000);
}
/* Silhouettes: plain slab, setbacks, podium and tower, crown with a mast, twin blocks, and a hipped cap. */
const ARCH: (() => THREE.BufferGeometry[])[] = [
  () => [sbox(1, 1, 1, 0, 0, 0, 0), sbox(0.4, 0.035, 0.3, 0.1, 1, 0.05, 1), sbox(0.18, 0.05, 0.18, -0.25, 1, -0.2, 1)],
  () => [sbox(1, 0.62, 1, 0, 0, 0, 0), sbox(0.78, 0.26, 0.78, 0, 0.62, 0, 0), sbox(0.55, 0.12, 0.55, 0, 0.88, 0, 0), sbox(0.3, 0.03, 0.3, 0, 1, 0, 1)],
  () => [sbox(1, 0.14, 1, 0, 0, 0, 0), sbox(0.6, 0.86, 0.66, 0.12, 0.14, -0.08, 0), sbox(0.3, 0.03, 0.28, 0.12, 1, -0.08, 1)],
  () => [sbox(1, 0.88, 1, 0, 0, 0, 0), sbox(1.03, 0.025, 1.03, 0, 0.88, 0, 1), sbox(0.8, 0.07, 0.8, 0, 0.905, 0, 1),
    colorGeo(new THREE.CylinderGeometry(0.012, 0.02, 0.22, 5).translate(0, 1.08, 0).deleteAttribute('uv'), 0xffffff)],
  () => [sbox(0.52, 1, 1, -0.24, 0, 0, 0), sbox(0.5, 0.72, 0.9, 0.25, 0, 0.03, 0), sbox(0.3, 0.04, 0.4, -0.24, 1, 0, 1)],
  () => [sbox(1, 0.9, 1, 0, 0, 0, 0), colorGeo(new THREE.ConeGeometry(0.72, 0.1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.95, 0).deleteAttribute('uv').toNonIndexed(), 0xffffff)],
];

function skyline(mats: Mats): THREE.InstancedMesh[] {
  const rnd = makeRng(515), N = 190;
  const geos = ARCH.map((f) => {
    const g = mergeGeometries(f().map((x) => (x.index ? x.toNonIndexed() : x)), false);
    if (!g) throw new Error('scenery: skyline merge failed');
    return g;
  });
  const picks: number[][] = geos.map(() => []);
  const spec: number[][] = [];
  for (let i = 0; i < N; i++) {
    const main = i < 150;
    const a = main ? (rnd() - 0.5) * 1.2 : 2.1 + (rnd() - 0.5) * 0.7;
    const r = main ? 500 + rnd() * 420 : 690 + rnd() * 300;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r;
    const u = rnd();
    const h = (u < 0.1 ? 95 + rnd() * 85 : u < 0.4 ? 45 + rnd() * 45 : 14 + rnd() * 32) * (main ? 1 : 0.7);
    const w = h > 90 ? 18 + rnd() * 16 : 14 + rnd() * 30, d = h > 90 ? 18 + rnd() * 14 : 12 + rnd() * 28;
    const k = h > 90 ? [1, 2, 3, 5][Math.floor(rnd() * 4)] : h > 45 ? [0, 1, 2, 4, 5][Math.floor(rnd() * 5)] : [0, 0, 4, 5][Math.floor(rnd() * 4)];
    picks[k].push(spec.length);
    spec.push([x, hillHeight(x, z) - 2, z, a + (rnd() - 0.5) * 0.3, w, h, d]);
  }
  return geos.map((g, k) => {
    const m = inst(g, mats.skyline, Math.max(1, picks[k].length));
    picks[k].forEach((j, i) => { const [x, y, z, ry, w, h, d] = spec[j]; place(m, i, x, y, z, ry, w, h, d); });
    m.count = picks[k].length;
    m.name = `skyline${k}`;
    return m;
  });
}

/* ---------------- materials ---------------- */

/* The open country: the vertex colours carry dry valleys to darker high ground; over that, a patchwork of fields
   (grass, stubble, ploughland) with hedgerows on their bounds, tone noise at three scales and bare earth and rock where
   the slope is steep. */
function hillsMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
  const noise = noiseTex();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHN = { value: noise };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHW;\nuniform sampler2D uHN;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        {
          vec2 hw = vHW.xz;
          float n1 = texture2D( uHN, hw / 520.0 ).r, n2 = texture2D( uHN, hw / 131.0 + 0.3 ).g, n3 = texture2D( uHN, hw / 29.0 + 0.7 ).r;
          vec2 pf = hw / vec2( 150.0, 105.0 ) + vec2( n1, n2 ) * 0.9;
          vec2 plot = floor( pf );
          float ph = fract( sin( dot( plot, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          vec3 field = ph < 0.22 ? vec3( 1.16, 1.06, 0.72 ) : ph < 0.34 ? vec3( 0.86, 0.72, 0.6 ) : ph < 0.62 ? vec3( 0.92, 1.04, 0.86 ) : vec3( 1.0 );
          float open = 1.0 - smoothstep( 25.0, 50.0, vHW.y );
          diffuseColor.rgb *= mix( vec3( 1.0 ), field, 0.6 * open ) * ( 0.84 + 0.32 * n2 ) * ( 0.9 + 0.2 * n3 );
          // hedgerows: a dark line along each field bound, faded out where it would shimmer
          vec2 fp = fract( pf ), fwp = fwidth( pf );
          vec2 e = min( fp, 1.0 - fp ) / max( fwp, vec2( 1e-4 ) );
          float hedge = ( 1.0 - smoothstep( 0.5, 1.6, min( e.x, e.y ) ) ) * ( 1.0 - smoothstep( 0.012, 0.035, max( fwp.x, fwp.y ) ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.14, 0.08 ), 0.35 * hedge * open * ( 0.5 + 0.5 * n3 ) );
          vec3 fn = normalize( cross( dFdx( vHW ), dFdy( vHW ) ) );
          float steep = smoothstep( 0.22, 0.45, 1.0 - abs( fn.y ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.36, 0.31, 0.26 ) * ( 0.8 + 0.4 * n3 ), steep * 0.75 );
        }`);
  };
  m.customProgramCacheKey = () => 'dv-hills';
  return m;
}

function mats(): Mats {
  if (M) return M;
  const link = chainlinkTex();
  const hoard = hoardingTex();
  hoard.wrapS = THREE.RepeatWrapping;
  const lattice = latticeTex();
  M = {
    galv: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.7, roughness: 0.45 }),
    link: new THREE.MeshStandardMaterial({ map: link, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }),
    hoard: new THREE.MeshStandardMaterial({ map: hoard, roughness: 0.75 }),
    sign: new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.55, side: THREE.DoubleSide }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x9a9890, emissive: 0xfff0d8, emissiveIntensity: 0, roughness: 0.3 }),
    cone: new THREE.MeshBasicMaterial({ map: coneTex(), color: 0xffe6c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    cabin: new THREE.MeshStandardMaterial({ map: cabinTex(false), emissiveMap: cabinTex(true), emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.7 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x2a5fa8, roughness: 0.5 }),
    hills: hillsMaterial(),
    foliage: new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
    trees: new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uTex: { value: treeAtlas() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uAmbTop: { value: new THREE.Color(0.4, 0.45, 0.5) }, uAmbBot: { value: new THREE.Color(0.2, 0.2, 0.2) },
      }),
      vertexShader: TREE_VS,
      fragmentShader: TREE_FS,
      fog: true,
    }),
    bark: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1, flatShading: true }),
    lattice: new THREE.MeshStandardMaterial({ color: 0xe0a31c, map: lattice, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 }),
    craneSolid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff2010 }),
    skyline: new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uAmbTop: { value: new THREE.Color(0.4, 0.45, 0.5) }, uAmbBot: { value: new THREE.Color(0.2, 0.2, 0.2) }, uLit: { value: 0 },
      }),
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      fog: true,
    }),
  };
  return M;
}

/* ---------------- public ---------------- */

/** the four tower floodlights (empty until the scenery is built) */
export function floodlights(): readonly THREE.SpotLight[] { return spots; }

/** lamps, lit windows and the skyline shading for the given preset; the renderer calls this too */
export function applySceneryEnv(env: EnvPreset): void {
  if (!M) return;
  const lamps = LAMPS[env];
  // spots stay visible at intensity 0 by day: a changing light count would recompile every lit shader
  for (const s of spots) s.intensity = 140 * lamps;
  M.lamp.emissiveIntensity = 7 * lamps;
  M.cone.opacity = 0.055 * lamps;
  if (cones) cones.visible = lamps > 0;
  if (beacons) beacons.visible = lamps > 0;
  M.cabin.emissiveIntensity = 1.6 * lamps;
  const u = M.skyline.uniforms, k = lighting.sunIntensity / Math.PI;
  (u.uSunDir.value as THREE.Vector3).copy(lighting.sunDir);
  (u.uSunCol.value as THREE.Color).copy(lighting.sunColor).multiplyScalar(k);
  (u.uAmbTop.value as THREE.Color).copy(lighting.ambTop);
  (u.uAmbBot.value as THREE.Color).copy(lighting.ambBot);
  u.uLit.value = env === 'night' ? 0.42 : env === 'dusk' ? 0.26 : env === 'overcast' ? 0.06 : 0.02;
  const t = M.trees.uniforms;
  (t.uSunDir.value as THREE.Vector3).copy(lighting.sunDir);
  (t.uSunCol.value as THREE.Color).copy(lighting.sunColor).multiplyScalar(k);
  (t.uAmbTop.value as THREE.Color).copy(lighting.ambTop);
  (t.uAmbBot.value as THREE.Color).copy(lighting.ambBot);
}

/** `half`: the map's terrain half-size, m (default: the original 62 m site) */
export function buildScenery(scene: THREE.Scene, env: EnvPreset, half = BASE_HALF, backdrop?: 'town'): void {
  outset = Math.max(0, half - BASE_HALF);
  TOWN = backdrop === 'town';
  FENCE = 66 + outset;
  TOWERS = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => [a * (70 + outset), b * (70 + outset)] as [number, number]);
  if (root) {
    root.parent?.remove(root);
    const old = root;
    old.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) g.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
  }
  const m = mats();
  m.link.map?.repeat.set((2 * FENCE) / 0.4, 2.35 / 0.4);
  root = new THREE.Group();
  root.name = 'scenery';
  root.add(ground(), hills(m), ...trees(m), ...fence(m), ...towers(m), ...props(m), ...crane(m), ...skyline(m), ...(TOWN ? townscape() : []));
  scene.add(root);
  applySceneryEnv(env);
}
