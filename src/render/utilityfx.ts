/* Water and electrical effects for the service networks (destruction/services.ts drives them). Render-only: every
   call only spawns particles and lights through the shared fx rings and decides nothing in the simulation. */
import * as THREE from 'three';
import type { Vec3 } from '../types';
import { fxKit } from './fx';

const { P, S, pAt, pColor, spark, dirAround, unitDir, budget, rf, v: _v, cd: _cd } = fxKit;
const G = 9.81;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

const MUD = [0.42, 0.33, 0.24];

/** One tick (~10×/s) of a burst main's spray: the drops and aerated water torn off a jet of bore `D` (m) thrown along
    `dir` at `v0` m/s (the speed that carries it to its reach), falling back as a curtain of drops round its foot, with
    a churning skirt where it lands. The coherent column itself is a mesh (setWaterJets). `mud` 0..1 browns it (soil
    washed out of the ground it comes up through). */
export function waterColumn(pos: Vec3, dir: Vec3, v0: number, D: number, mud: number): void {
  if (!fxKit.ready() || v0 < 0.5) return;
  const b = budget(), k = fxKit.drop();
  unitDir(dir);
  const dx = _cd.x, dy = _cd.y, dz = _cd.z;
  const up = Math.max(0.25, dy), big = clamp(D / 0.2, 0.1, 1.5), H = (v0 * up) ** 2 / (2 * G);
  const tUp = (v0 * up) / G, tAll = 2 * tUp + 0.3;
  const cr = mix(0.93, MUD[0], mud * 0.8), cg = mix(0.95, MUD[1], mud * 0.8), cbb = mix(0.96, MUD[2], mud * 0.8);
  const [x, y, z] = pos;
  /* the body: aerated water, opaque white where it is thick, spreading to a plume */
  const n = Math.max(1, Math.round((2 + 3 * big) * b));
  for (let i = 0; i < n; i++) {
    dirAround(dx, dy, dz, 0.05 + 0.04 * rf(0, 1));
    const sp = v0 * rf(0.86, 1.02);
    pAt(x + rf(-0.5, 0.5) * D, y + rf(0, 0.2) * D, z + rf(-0.5, 0.5) * D);
    P.delay = rf(0, 0.1); P.vx = _v.x * sp; P.vy = _v.y * sp; P.vz = _v.z * sp; P.drag = 0.08;
    P.accel = -G / 2; P.life = tAll * rf(0.95, 1.15); P.s0 = D * 1.2 + 0.05; P.s1 = D * 1.8 + 0.06 * H + 0.3; P.variant = 3;
    P.r = cr * rf(0.96, 1.03); P.g = cg * rf(0.97, 1.02); P.b = cbb; P.a = 0.28 + 0.1 * big; P.fadeIn = 0.02; P.wind = 0.5; P.spin = rf(-1.5, 1.5);
    fxKit.emit();
  }
  /* drops torn off the column: thrown slower and wider, falling round it as rain */
  const nd = Math.min(40, Math.round((10 + 14 * big) * (0.5 + 0.5 * b)));
  for (let i = 0; i < nd; i++) {
    dirAround(dx, dy, dz, 0.1 + 0.2 * rf(0, 1));
    const sp = v0 * rf(0.45, 1.0);
    const t = rf(0, 0.6);
    S.x = x + dx * sp * t * 0.3; S.y = y + dy * sp * t * 0.3; S.z = z + dz * sp * t * 0.3;
    S.vx = _v.x * sp; S.vy = _v.y * sp; S.vz = _v.z * sp;
    S.life = tAll * rf(0.7, 1.05); S.r = -0.7 * k * (1 - 0.4 * mud); S.g = -0.74 * k * (1 - 0.45 * mud); S.b = -0.8 * k * (1 - 0.55 * mud);
    S.w = rf(0.006, 0.013) * (0.8 + 0.4 * big); S.grav = 1; S.drag = 0.18; S.streak = 0.05; S.bounce = 0.05; S.delay = rf(0, 0.1);
    spark();
  }
  /* the skirt: water crashing back down and running off round the foot */
  if (rf(0, 1) < 0.35 + 0.4 * b) {
    const rr = 0.3 + 0.12 * H;
    const a = rf(0, 6.283);
    pAt(x + Math.cos(a) * rr * rf(0, 1), y + 0.1, z + Math.sin(a) * rr * rf(0, 1));
    P.vx = Math.cos(a) * rf(0.8, 2) * big; P.vy = rf(0.2, 0.6); P.vz = Math.sin(a) * rf(0.8, 2) * big; P.drag = 1.2;
    P.life = rf(1.4, 2.4); P.s0 = 0.4 + D; P.s1 = 1.2 + 0.18 * H; P.r = cr; P.g = cg; P.b = cbb; P.a = 0.3; P.fadeIn = 0.08; P.wind = 1; P.rise = 0.05;
    fxKit.emit();
  }
}

/* ---------------- burst-main jets as solid columns ---------------- */

/* The coherent part of a jet is a tube bent along its ballistic path (vertex shader), widening as it breaks up, with
   streaks of aerated water running up it at the flow's speed. Particles (waterColumn) do the spray, the crown and the
   rain round it. One mesh per shown jet from a fixed pool; each grows up to its reach when it opens and slumps away
   when it stops. */

export interface JetSpec { key: number; pos: Vec3; dir: Vec3; v0: number; D: number; mud: number; floor: number }

const JETS = 16;
interface JetView {
  mesh: THREE.Mesh; u: Record<string, THREE.IUniform>; key: number; on: boolean; level: number; fade: number;
  p0: THREE.Vector3; v: THREE.Vector3; wantP: THREE.Vector3; wantV: THREE.Vector3; T: number; r0: number; r1: number; len: number; mud: number;
}
const jets: JetView[] = [];
let jetGeo: THREE.CylinderGeometry | null = null;
let jetLast = 0;

const JET_PARS = /* glsl */`
uniform vec3 uP0;
uniform vec3 uV;
uniform float uT;
uniform float uR0;
uniform float uR1;
uniform float uTime;
uniform float uLen;
uniform float uLevel;
uniform float uFade;
uniform float uMud;
varying float vJS;
varying float vJA;
float jHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float jNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( jHash( i ), jHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( jHash( i + vec2( 0.0, 1.0 ) ), jHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;

const JET_NORMAL = /* glsl */`
  float jS = position.y * uLevel;
  float jT = jS * uT;
  vec3 jTan = normalize( uV + vec3( 0.0, - 9.81 * jT, 0.0 ) + vec3( 1e-4, 0.0, 0.0 ) );
  vec3 jRef = abs( jTan.y ) > 0.9 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 );
  vec3 jB1 = normalize( cross( jTan, jRef ) );
  vec3 jB2 = cross( jTan, jB1 );
  vec2 jQ = normalize( position.xz + vec2( 1e-5, 0.0 ) );
  float jAng = atan( jQ.y, jQ.x );
  float jR = mix( uR0, uR1, pow( position.y, 0.8 ) ) * ( 1.0 + 0.16 * ( jNoise( vec2( jAng * 1.3, jS * uLen * 0.7 - uTime * 3.0 ) ) - 0.5 ) );
  vec3 jN = jB1 * jQ.x + jB2 * jQ.y;
  vec3 objectNormal = jN;
  vJS = position.y;
  vJA = jAng;`;

const JET_POS = /* glsl */`
  vec3 transformed = uP0 + uV * jT + vec3( 0.0, - 4.905 * jT * jT, 0.0 ) + jN * jR;`;

const JET_ALPHA = /* glsl */`
  {
    // streaks of aerated water climbing at the flow's speed; the column thins and tears as it rises
    float jn = jNoise( vec2( vJA * 4.0, vJS * uLen * 0.3 - uTime * length( uV ) * 0.3 ) ) * 0.6
      + jNoise( vec2( vJA * 11.0 + 3.0, vJS * uLen * 0.9 - uTime * length( uV ) * 0.9 ) ) * 0.4;
    float jEnd = 1.0 - smoothstep( 0.6, 1.0, vJS );
    float jA = mix( 0.92, 0.3, vJS ) * jEnd * smoothstep( 0.0, 0.02, vJS );
    jA *= smoothstep( 0.22 + 0.45 * vJS, 0.62 + 0.3 * vJS, jn + 0.18 );
    diffuseColor.a *= jA * uFade;
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.46, 0.36, 0.26 ), uMud ) * ( 0.8 + 0.3 * jn );
  }`;

const JET_VIEW = /* glsl */`
  // a round jet is thick through its middle and thin at its edges, where it is all loose drops
  diffuseColor.a *= 0.12 + 0.88 * pow( abs( dot( normalize( normal ), normalize( vViewPosition ) ) ), 0.8 );`;

function jetMat(u: Record<string, THREE.IUniform>): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.75, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.9 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${JET_PARS}`)
      .replace('#include <beginnormal_vertex>', JET_NORMAL)
      .replace('#include <begin_vertex>', JET_POS);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${JET_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${JET_ALPHA}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${JET_VIEW}`);
  };
  m.customProgramCacheKey = () => 'dv-waterjet';
  return m;
}

function makeJet(root: THREE.Group): JetView {
  jetGeo ??= new THREE.CylinderGeometry(1, 1, 1, 16, 40, true).translate(0, 0.5, 0);
  const u: Record<string, THREE.IUniform> = {
    uP0: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3(0, 1, 0) }, uT: { value: 1 }, uR0: { value: 0.1 }, uR1: { value: 0.5 },
    uTime: { value: 0 }, uLen: { value: 5 }, uLevel: { value: 0 }, uFade: { value: 0 }, uMud: { value: 0 },
  };
  const mesh = new THREE.Mesh(jetGeo, jetMat(u));
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 3;
  const j: JetView = { mesh, u, key: -1, on: false, level: 0, fade: 0, p0: new THREE.Vector3(), v: new THREE.Vector3(), wantP: new THREE.Vector3(), wantV: new THREE.Vector3(), T: 1, r0: 0.1, r1: 0.5, len: 5, mud: 0 };
  mesh.onBeforeRender = () => stepJet(j);
  root.add(mesh);
  return j;
}

function stepJet(j: JetView): void {
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, Math.max(0, now - jetLast));
  if (dt > 0) jetLast = now;
  if (dt > 0) for (const o of jets) {
    /* a jet climbs to its reach in about the time its water takes to get there, and slumps away when it stops */
    if (o.on) { o.level = Math.min(1, o.level + dt / Math.max(0.3, o.T * 0.8)); o.fade = Math.min(1, o.fade + dt / 0.25); }
    else { o.fade = Math.max(0, o.fade - dt / 0.7); o.level = Math.max(0, o.level - dt / 1.2); }
    o.p0.lerp(o.wantP, Math.min(1, dt * 6));
    o.v.lerp(o.wantV, Math.min(1, dt * 3));
    o.mesh.visible = o.fade > 0.001;
  }
  const u = j.u;
  (u.uP0.value as THREE.Vector3).copy(j.p0);
  (u.uV.value as THREE.Vector3).copy(j.v);
  u.uT.value = j.T; u.uR0.value = j.r0; u.uR1.value = j.r1; u.uLen.value = j.len; u.uMud.value = j.mud;
  u.uTime.value = now % 1000; u.uLevel.value = j.level; u.uFade.value = j.fade;
}

const _jd = new THREE.Vector3();
/** The water jets to draw now (services, ~4×/s): each keeps its mesh while its key stays in the list. */
export function setWaterJets(list: JetSpec[]): void {
  const root = fxKit.root();
  if (!root) return;
  while (jets.length < Math.min(JETS, list.length)) jets.push(makeJet(root));
  for (const j of jets) j.on = false;
  for (const s of list.slice(0, JETS)) {
    let j = jets.find((o) => o.key === s.key) ?? jets.find((o) => !o.on && o.fade <= 0) ?? jets.find((o) => !o.on);
    if (!j) break;
    const fresh = j.key !== s.key;
    j.key = s.key; j.on = true; j.mesh.visible = true;
    _jd.set(s.dir[0], s.dir[1], s.dir[2]);
    if (_jd.lengthSq() < 1e-8) _jd.set(0, 1, 0);
    _jd.normalize();
    j.wantP.set(s.pos[0], s.pos[1], s.pos[2]);
    j.wantV.copy(_jd).multiplyScalar(s.v0);
    if (fresh) { j.p0.copy(j.wantP); j.v.copy(j.wantV); j.level = 0; j.fade = 0; }
    const vy = j.wantV.y, vh = Math.hypot(j.wantV.x, j.wantV.z);
    /* a steep jet is drawn up to its crown (the particles fall back); a slanting one along its whole arc to the ground */
    j.T = vh < 0.3 * s.v0 && vy > 0 ? (0.95 * vy) / G : Math.min(4, (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0.05, s.pos[1] - s.floor))) / G);
    j.len = Math.max(0.3, s.v0 * j.T * 0.75);
    j.r0 = s.D * 0.5;
    j.r1 = s.D * 0.5 + 0.07 * j.len + 0.08;
    j.mud = s.mud;
  }
}

export function clearWaterJets(): void {
  for (const j of jets) { j.on = false; j.fade = 0; j.level = 0; j.key = -1; j.mesh.visible = false; }
}

/* ---------------- fallen conductors ---------------- */

/* The snapped halves of overhead conductors (destruction/conductors.ts), drawn as the same dark stranded wire as a
   standing span, one thin cylinder per link, refreshed each frame from the services' own list. */
type TailSource = () => readonly { t: { x: Float32Array } }[];
let tailSource: TailSource | null = null;
let tailMesh: THREE.InstancedMesh | null = null;
const TAIL_CAP = 32 * 12;
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tq = new THREE.Quaternion(), _ts = new THREE.Vector3(), _tm = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export function setTailSource(f: TailSource): void { tailSource = f; }

function drawTails(): void {
  const m = tailMesh!, list = tailSource ? tailSource() : [];
  let k = 0;
  for (const { t } of list) {
    const x = t.x;
    for (let i = 3; i < x.length && k < TAIL_CAP; i += 3) {
      _ta.set(x[i - 3], x[i - 2], x[i - 1]); _tb.set(x[i], x[i + 1], x[i + 2]);
      _ts.subVectors(_tb, _ta);
      const l = _ts.length();
      if (l < 1e-5) continue;
      _tq.setFromUnitVectors(UP, _ts.multiplyScalar(1 / l));
      _tm.compose(_ta, _tq, _ts.set(0.012, l + 0.012, 0.012));
      m.setMatrixAt(k++, _tm);
    }
  }
  m.count = k;
  m.instanceMatrix.needsUpdate = true;
}

/** per frame (cheap when there are none): keeps the fallen conductors drawn where the services have them */
export function updateTails(): void {
  const root = fxKit.root();
  if (!root || !tailSource) return;
  if (!tailMesh) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    tailMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.55, metalness: 0.4 }), TAIL_CAP);
    tailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tailMesh.frustumCulled = false;
    tailMesh.castShadow = true;
    tailMesh.count = 0;
    root.add(tailMesh);
  }
  if (tailMesh.parent !== root) root.add(tailMesh);
  drawTails();
}

/* ---------------- device state lamps ---------------- */

/* A small lit tag on each breaker, fuse, valve, meter and supply near the player, readable at a glance: green live and
   closed, red off or shut, red flashing tripped on a fault, amber a standby set running, nothing when it is dead. */
export interface Indicator { pos: Vec3; color: number; blink: boolean }
const IND_CAP = 48;
let indMesh: THREE.InstancedMesh | null = null;
let indList: Indicator[] = [];
const _ic = new THREE.Color(), _dark = new THREE.Color(0x0b0b0b);

export function setIndicators(list: Indicator[]): void { indList = list.slice(0, IND_CAP); }

function drawIndicators(root: THREE.Group): void {
  if (!indMesh) {
    indMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), IND_CAP);
    indMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    indMesh.frustumCulled = false;
    indMesh.count = 0;
    for (let i = 0; i < IND_CAP; i++) indMesh.setColorAt(i, _dark);
  }
  if (indMesh.parent !== root) root.add(indMesh);
  const on = (performance.now() / 1000) % 0.8 < 0.4;
  for (let i = 0; i < indList.length; i++) {
    const d = indList[i];
    _tm.makeTranslation(d.pos[0], d.pos[1], d.pos[2]);
    indMesh.setMatrixAt(i, _tm);
    /* lit well over white so the tag stays readable in daylight and blooms a little at night */
    indMesh.setColorAt(i, d.blink && !on ? _dark : _ic.setHex(d.color).multiplyScalar(2.2));
  }
  indMesh.count = indList.length;
  indMesh.instanceMatrix.needsUpdate = true;
  if (indMesh.instanceColor) indMesh.instanceColor.needsUpdate = true;
}

/** per frame: the fallen conductors and the device lamps */
export function updateUtilityFx(): void {
  updateTails();
  const root = fxKit.root();
  if (root && (indList.length || indMesh)) drawIndicators(root);
}
