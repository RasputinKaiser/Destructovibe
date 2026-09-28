/* Non-colliding set dressing: ground, fenced site perimeter (> 62 m), floodlight towers, cabins and
   stockpiles, a tower crane, low-poly hills with trees and a distant instanced skyline. Everything
   repeated is instanced or merged; materials/textures are built once and shared across rebuilds. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, simplex2d } from 'math/noise';
import type { EnvPreset } from '../types';
import { getGroundMaterial, getPieceMaterials } from './materials';
import { cabinTex, chainlinkTex, coneTex, hoardingTex, latticeTex, makeRng, signTex, smooth } from './textures';
import { lighting } from './shared';

const LAMPS: Record<EnvPreset, number> = { noon: 0, golden: 0, overcast: 0, dusk: 0.7, night: 1 };
const FENCE = 66;
const TOWERS: [number, number][] = [[70, 70], [-70, 70], [70, -70], [-70, -70]];
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
varying vec3 vW;
varying vec3 vN;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  vN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
  vSeed = fract( sin( dot( instanceMatrix[ 3 ].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SKY_FS = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform float uLit;
varying vec3 vW;
varying vec3 vN;
varying float vSeed;
#include <fog_pars_fragment>
float hs( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
void main() {
  vec3 n = normalize( vN );
  float wall = 1.0 - step( 0.5, abs( n.y ) );
  vec2 fc = abs( n.x ) > abs( n.z ) ? vec2( vW.z, vW.y ) : vec2( vW.x, vW.y );
  vec2 g = fc / vec2( 3.2, 3.6 );
  vec2 cell = floor( g );
  vec2 f = fract( g );
  float win = wall * step( 0.18, f.x ) * step( f.x, 0.82 ) * step( 0.28, f.y ) * step( f.y, 0.86 ) * step( 4.0, vW.y );
  float lit = step( hs( cell + vSeed * 17.0 ), uLit ) * win;
  float aa = clamp( 1.5 - fwidth( g.x ) * 2.5, 0.0, 1.0 );
  win = mix( 0.33 * wall, win, aa );
  lit = mix( 0.33 * wall * uLit, lit, aa );
  vec3 base = mix( vec3( 0.26, 0.27, 0.29 ), vec3( 0.52, 0.48, 0.42 ), vSeed );
  vec3 alb = mix( base, vec3( 0.05, 0.07, 0.09 ), win );
  vec3 amb = mix( uAmbBot, uAmbTop, n.y * 0.5 + 0.5 );
  vec3 col = alb * ( amb + uSunCol * max( dot( n, uSunDir ), 0.0 ) );
  vec3 wc = mix( vec3( 1.0, 0.7, 0.38 ), vec3( 0.72, 0.84, 1.0 ), step( 0.72, hs( cell * 1.7 + 3.0 ) ) );
  col += wc * lit * 2.4;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    col = mix( col, fogColor, fogF * 0.85 );
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
  m.name = 'hills';
  return m;
}

function trees(mats: Mats): THREE.Object3D[] {
  const rnd = makeRng(303), NC = 190, ND = 70;
  const cone = new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0);
  const blob = new THREE.IcosahedronGeometry(1, 0);
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1, 5).translate(0, 0.5, 0);
  const cones = inst(cone, mats.foliage, NC), blobs = inst(blob, mats.foliage, ND), trunks = inst(trunk, mats.bark, NC + ND);
  const c = new THREE.Color();
  let t = 0;
  const spot = (): [number, number] => {
    for (;;) {
      const a = rnd() * Math.PI * 2, r = 95 + Math.pow(rnd(), 0.8) * 360, x = Math.sin(a) * r, z = -Math.cos(a) * r;
      const az = Math.abs(a > Math.PI ? a - Math.PI * 2 : a);
      if (r > 300 && az < 0.6) continue;
      if (Math.hypot(x + 48, z + 112) < 16 || (x < -70 && x > -95 && z > 20 && z < 55)) continue;
      return [x, z];
    }
  };
  for (let i = 0; i < NC; i++) {
    const [x, z] = spot(), y = hillHeight(x, z) - 0.3, h = 6 + rnd() * 7, rr = h * (0.26 + rnd() * 0.08), th = h * 0.22;
    place(cones, i, x, y + th, z, rnd() * 6, rr, h, rr);
    place(trunks, t++, x, y, z, 0, 1, th + 0.5, 1);
    cones.setColorAt(i, c.setHex(0x2e4a2b).lerp(new THREE.Color(0x46603a), rnd()));
  }
  for (let i = 0; i < ND; i++) {
    const [x, z] = spot(), y = hillHeight(x, z) - 0.3, s = 2.5 + rnd() * 2.5, th = 2 + rnd() * 2;
    place(blobs, i, x, y + th + s * 0.6, z, rnd() * 6, s, s * (0.8 + rnd() * 0.4), s);
    place(trunks, t++, x, y, z, 0, 1.2, th + s * 0.5, 1.2);
    blobs.setColorAt(i, c.setHex(0x4d6534).lerp(new THREE.Color(0x6e7b3c), rnd()));
  }
  return [cones, blobs, trunks];
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
  for (let t = -56; t <= 56; t += 16) { spotsXZ.push([-S + 0.1, t, Math.PI / 2], [S - 0.1, t, -Math.PI / 2]); }
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
  place(cabins, 0, -80, 1.3, 30, Math.PI / 2);
  place(cabins, 1, -80, 3.92, 30, Math.PI / 2);
  place(cabins, 2, -80, 1.3, 37.5, Math.PI / 2);
  cabins.castShadow = true;
  out.push(cabins);

  const loo = inst(merge([new THREE.BoxGeometry(1.1, 2.3, 1.1).translate(0, 1.15, 0), new THREE.BoxGeometry(1.24, 0.08, 1.24).translate(0, 2.34, 0)]), mats.plastic, 2);
  place(loo, 0, -80.5, 0, 44, Math.PI / 2);
  place(loo, 1, -80.5, 0, 45.4, Math.PI / 2);
  out.push(loo);

  const skipGeo = new THREE.BoxGeometry(3.6, 1.5, 1.8, 2, 1, 1);
  const sp = skipGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) if (sp.getY(i) > 0) { sp.setX(i, sp.getX(i) * 1.25); sp.setZ(i, sp.getZ(i) * 1.12); }
  skipGeo.translate(0, 0.75, 0);
  skipGeo.computeVertexNormals();
  const metal = getPieceMaterials('metal')[0];
  const skips = inst(planarUv(skipGeo.toNonIndexed()), metal, 2);
  place(skips, 0, 74, 0, -20, Math.PI / 2 + 0.1);
  place(skips, 1, 74.5, 0, -12.5, Math.PI / 2 - 0.08);
  skips.setColorAt(0, new THREE.Color(0xd89a1f));
  skips.setColorAt(1, new THREE.Color(0x2f6fa8));
  out.push(skips);

  const conc = getPieceMaterials('concrete')[0];
  const rubble = inst(planarUv(new THREE.IcosahedronGeometry(0.45, 0)), conc, 14);
  const rr = makeRng(88);
  for (let i = 0; i < 14; i++) {
    const cx = i < 7 ? 74 : 74.5, cz = i < 7 ? -20 : -12.5;
    place(rubble, i, cx + (rr() - 0.5) * 1.0, 1.25 + rr() * 0.3, cz + (rr() - 0.5) * 2.8, rr() * 6, 0.7 + rr() * 0.6, 0.6 + rr() * 0.5, 0.7 + rr() * 0.6);
  }
  out.push(rubble);

  const containers = inst(planarUv(new THREE.BoxGeometry(6.06, 2.59, 2.44).translate(0, 1.295, 0)), metal, 3);
  place(containers, 0, 80, 0, 42, Math.PI / 2);
  place(containers, 1, 83, 0, 42, Math.PI / 2);
  place(containers, 2, 81.5, 2.59, 42.3, Math.PI / 2 + 0.04);
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
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) place(pipes, n++, -74, 0.62 + row * 1.07, -48 + (i + row * 0.5) * 1.26);
  out.push(pipes);

  const steelPipes = inst(planarUv(new THREE.CylinderGeometry(0.16, 0.16, 6, 14).rotateZ(Math.PI / 2)), getPieceMaterials('steel')[0], 9);
  n = 0;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) place(steelPipes, n++, -74, 0.3 + row * 0.31, -30 + i * 0.34);
  out.push(steelPipes);

  const pallets = inst(planarUv(new THREE.BoxGeometry(1.2, 0.14, 1.0)), getPieceMaterials('wood')[0], 5);
  const bricks = inst(planarUv(new THREE.BoxGeometry(1.0, 0.75, 0.9)), getPieceMaterials('brick')[0], 5);
  for (let i = 0; i < 5; i++) {
    const z = 18 + i * 1.7, ry = (rr() - 0.5) * 0.2;
    place(pallets, i, 72, 0.07, z, ry);
    place(bricks, i, 72, 0.14 + 0.375, z, ry);
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
  const cx = -48, cz = -112;
  g.position.set(cx, hillHeight(cx, cz) + 0.2, cz);
  // jib runs parallel to the site edge so nothing hangs over the play area
  g.rotation.y = Math.atan2(cz, -cx) + 1.25;
  g.children[0].renderOrder = 3;
  return [g];
}

function skyline(mats: Mats): THREE.InstancedMesh {
  const rnd = makeRng(515), N = 170;
  const m = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mats.skyline, N);
  for (let i = 0; i < N; i++) {
    const main = i < 135;
    const a = main ? (rnd() - 0.5) * 1.15 : 2.1 + (rnd() - 0.5) * 0.7;
    const r = main ? 520 + rnd() * 380 : 700 + rnd() * 280;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r;
    const tall = rnd() < 0.12;
    const h = (tall ? 80 + rnd() * 70 : 16 + rnd() * 46) * (main ? 1 : 0.7);
    place(m, i, x, hillHeight(x, z) - 2, z, a + (rnd() - 0.5) * 0.3, 14 + rnd() * 28, h, 14 + rnd() * 26);
  }
  m.name = 'skyline';
  return m;
}

/* ---------------- materials ---------------- */

function mats(): Mats {
  if (M) return M;
  const link = chainlinkTex();
  link.repeat.set((2 * FENCE) / 0.4, 2.35 / 0.4);
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
    hills: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }),
    foliage: new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
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
}

export function buildScenery(scene: THREE.Scene, env: EnvPreset): void {
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
  root = new THREE.Group();
  root.name = 'scenery';
  root.add(ground(), hills(m), ...trees(m), ...fence(m), ...towers(m), ...props(m), ...crane(m), skyline(m));
  scene.add(root);
  applySceneryEnv(env);
}
