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

/* ---------------- tool lines ---------------- */

/* Winch lines, rigging lines, the hoist's chain and the grapple line. Each is drawn along the shape it really hangs
   in: a catenary for the length paid out while it is slack, and once it is taut, a line straightened by its tension
   with only its own weight bowing it (mid-span sag w·c²/8T). Wire rope is six strands laid round a core (lay length
   ~6.5 d), fibre rope is braided in its maker's colour, chain is real interlocking links (pitch 3 d, inner width
   1.35 d, EN 818-2 proportions). A line worked near its breaking load shows broken wires or fuzzed yarns at its weak
   spot, and a line that parts whips back toward its anchors. */
export type LineLook = 'wire' | 'fibre' | 'chain';

const LN = 48, LS = 28, WIRES = 32, WHISK = WIRES * 2, LINKS = 2400, WHIP_T = 1.4;
let wireM: THREE.InstancedMesh | null = null, fibreM: THREE.InstancedMesh | null = null;
let wireOff: THREE.InstancedBufferAttribute, fibreOff: THREE.InstancedBufferAttribute;
let linkM: THREE.InstancedMesh | null = null, whiskM: THREE.InstancedMesh | null = null;
let eyeM: THREE.InstancedMesh | null = null, shackleM: THREE.InstancedMesh | null = null;
let linkUsed = 0;
let clock = 0;
/* the camera, for a floor on how thin a line is drawn: a 16 mm rope is under a pixel at 15 m, and a line the player has
   rigged has to stay readable (never thinner than ~1.1 mrad, about 1.5 px at 1080p) */
const eye = new THREE.Vector3(0, 1e6, 0);
const MIN_ANGLE = 0.0011;
const readable = (r: number, p: THREE.Vector3): number => Math.max(r, p.distanceTo(eye) * MIN_ANGLE);
/* where the ground is: slack line lies on it rather than hanging through it */
let floorAt: ((x: number, z: number) => number) | null = null;
export function setLineFloor(f: (x: number, z: number) => number): void { floorAt = f; }
function onFloor(pts: Float32Array, n: number, r: number): void {
  if (!floorAt) return;
  for (let i = 0; i <= n; i++) {
    const g = floorAt(pts[i * 3], pts[i * 3 + 2]) + r;
    if (pts[i * 3 + 1] < g) pts[i * 3 + 1] = g;
  }
}

interface ToolLine {
  on: boolean;
  look: LineLook;
  r: number;
  color: number;
  /** points of the last shape, xyz packed */
  pts: Float32Array;
  fray: number;
  /** where along the line (0 at a) the weak spot is */
  frayAt: number;
  seed: number;
  /** snapped: animating the two halves back toward their anchors */
  whip: { t0: number; a: Vec3; b: Vec3; at: number; v: number; twin: number } | null;
  links: number;
  /** chain: plastic stretch of the links past proof load */
  plastic: number;
}
const tl: ToolLine[] = [];
const tlFree: number[] = [];
let tlHigh = 0;
const pa = new THREE.Vector3(), pb = new THREE.Vector3(), seg = new THREE.Vector3(), side = new THREE.Vector3(), tan = new THREE.Vector3();
const lq = new THREE.Quaternion(), lq2 = new THREE.Quaternion(), lm = new THREE.Matrix4(), ls = new THREE.Vector3(), lbasis = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);
const lc = new THREE.Color();

function strandShader(m: THREE.MeshStandardMaterial, key: string, frag: string): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aOff;\nvarying float vAlong;\nvarying float vR;\nvarying vec3 vLoc;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        #ifdef USE_INSTANCING
          vAlong = aOff + position.y * length( instanceMatrix[ 1 ].xyz );
          vR = length( instanceMatrix[ 0 ].xyz );
        #else
          vAlong = position.y; vR = 1.0;
        #endif
        vLoc = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;\nvarying float vR;\nvarying vec3 vLoc;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${frag}`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/* Six strands laid right-hand round the core, their outer wires laid the other way (regular lay): the grooves between
   strands hold dark grease and the crowns catch the light. */
const WIRE_FRAG = /* glsl */`
  float ang = atan( vLoc.z, vLoc.x ) / 6.28318;
  float lay = vAlong / ( 13.0 * vR );
  float sf = fract( ( ang - lay ) * 6.0 );
  float crown = smoothstep( 0.0, 0.22, sf ) * smoothstep( 1.0, 0.78, sf );
  float wires = 0.78 + 0.22 * smoothstep( -0.2, 0.9, sin( 6.28318 * ( ang * 6.0 + lay * 0.35 ) * 9.0 ) );
  diffuseColor.rgb *= mix( 0.3, 1.0, crown ) * mix( 1.0, wires, crown );
  roughnessFactor = mix( 0.8, roughnessFactor, crown );`;
/* Twelve-strand braid: yarns running both ways over and under each other. */
const FIBRE_FRAG = /* glsl */`
  float ang = atan( vLoc.z, vLoc.x ) / 6.28318;
  float p = vAlong / ( 4.2 * vR );
  float u1 = ( ang + p ) * 6.0, u2 = ( ang - p ) * 6.0;
  float over = mod( floor( u1 ) + floor( u2 ), 2.0 );
  float yarn = mix( sin( 3.14159 * fract( u1 ) ), sin( 3.14159 * fract( u2 ) ), over );
  diffuseColor.rgb *= 0.5 + 0.5 * yarn;
  roughnessFactor = min( 1.0, roughnessFactor + 0.1 * ( 1.0 - yarn ) );`;

function lineMesh(mat: THREE.Material, name: string, n: number, radial: number): [THREE.InstancedMesh, THREE.InstancedBufferAttribute] {
  const geo = new THREE.CylinderGeometry(1, 1, 1, radial, 1, true).translate(0, 0.5, 0);
  const off = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  off.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOff', off);
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, lc.setHex(0xffffff)); }
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = name;
  return [m, off];
}

/* One G80 link, wire diameter 1: inner length 3 (the pitch), inner width 1.35, long axis along Y, in the XY plane. */
function linkGeometry(): THREE.BufferGeometry {
  const hl = 0.825, R = 1.175, rt = 0.5, TU = 18, RA = 6;
  const P = 4 * hl + 2 * Math.PI * R;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < TU; i++) {
    let s = (i / TU) * P;
    // straight right side going up, top arc, straight left side going down, bottom arc
    if (s < 2 * hl) { c.set(R, -hl + s, 0); n.set(1, 0, 0); }
    else if ((s -= 2 * hl) < Math.PI * R) { const a = s / R; c.set(R * Math.cos(a), hl + R * Math.sin(a), 0); n.set(Math.cos(a), Math.sin(a), 0); }
    else if ((s -= Math.PI * R) < 2 * hl) { c.set(-R, hl - s, 0); n.set(-1, 0, 0); }
    else { s -= 2 * hl; const a = Math.PI + s / R; c.set(R * Math.cos(a), -hl + R * Math.sin(a), 0); n.set(Math.cos(a), Math.sin(a), 0); }
    for (let j = 0; j < RA; j++) {
      const f = (j / RA) * Math.PI * 2, cf = Math.cos(f), sf = Math.sin(f);
      pos.push(c.x + rt * (cf * n.x), c.y + rt * (cf * n.y), rt * sf);
      nor.push(cf * n.x, cf * n.y, sf);
    }
  }
  for (let i = 0; i < TU; i++) for (let j = 0; j < RA; j++) {
    const a = i * RA + j, b = ((i + 1) % TU) * RA + j, cc = ((i + 1) % TU) * RA + ((j + 1) % RA), d = i * RA + ((j + 1) % RA);
    idx.push(a, b, d, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/* A bow shackle for pin diameter 1: the bow (a 3/4 torus, inside width ~1.7), its two eyes and the pin across them. */
function shackleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.TorusGeometry(1.35, 0.42, 6, 14, Math.PI * 1.35).rotateZ(-Math.PI * 0.175).translate(0, 1.3, 0));
  parts.push(new THREE.CylinderGeometry(0.5, 0.5, 3.4, 8).rotateZ(Math.PI / 2));
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of parts) {
    const gg = g.index ? g : g;
    const pa2 = gg.getAttribute('position'), na = gg.getAttribute('normal');
    for (let i = 0; i < pa2.count; i++) { pos.push(pa2.getX(i), pa2.getY(i), pa2.getZ(i)); nor.push(na.getX(i), na.getY(i), na.getZ(i)); }
    const ix = gg.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += pa2.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

export function initLines(scene: THREE.Scene): void {
  if (wireM && fibreM && linkM && whiskM && eyeM && shackleM) {
    for (const m of [wireM, fibreM, linkM, whiskM, eyeM, shackleM]) if (m.parent !== scene) scene.add(m);
    return;
  }
  // galvanised wire: a grey metal, not a mirror (at full metalness it reads the sky's blue)
  [wireM, wireOff] = lineMesh(strandShader(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.55 }), 'dv-wirerope2', WIRE_FRAG), 'lineWire', LN * LS, 12);
  [fibreM, fibreOff] = lineMesh(strandShader(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 }), 'dv-fibrerope', FIBRE_FRAG), 'lineFibre', LN * LS, 12);
  linkM = new THREE.InstancedMesh(linkGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.65 }), LINKS);
  linkM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < LINKS; i++) { linkM.setMatrixAt(i, ZERO); linkM.setColorAt(i, lc.setHex(0x3a3c3f)); }
  linkM.count = 0;
  linkM.frustumCulled = false;
  linkM.castShadow = true;
  linkM.name = 'lineChain';
  whiskM = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 3, 1, true).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4 }), LN * WHISK);
  whiskM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < LN * WHISK; i++) { whiskM.setMatrixAt(i, ZERO); whiskM.setColorAt(i, lc.setHex(0xffffff)); }
  whiskM.count = 0;
  whiskM.frustumCulled = false;
  whiskM.name = 'lineFray';
  // terminations: a thimble eye in the rope's end and a bow shackle through it at each end (galvanised)
  const fit = new THREE.MeshStandardMaterial({ color: 0xa4a8ac, roughness: 0.4, metalness: 0.7 });
  eyeM = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.28, 6, 14).scale(1, 1.35, 1), fit, LN * 2);
  shackleM = new THREE.InstancedMesh(shackleGeometry(), fit, LN * 2);
  for (const m of [eyeM, shackleM]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < LN * 2; i++) m.setMatrixAt(i, ZERO);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
  }
  eyeM.name = 'lineEyes';
  shackleM.name = 'lineShackles';
  scene.add(wireM, fibreM, linkM, whiskM, eyeM, shackleM);
}

/* ----- hanging shape ----- */

/* sinh(x)/x = r for x > 0 (Newton from the small- or large-x asymptote) */
function solveSinhc(r: number): number {
  let x = r < 3 ? Math.sqrt(6 * (r - 1)) : Math.log(2 * r) + Math.log(Math.log(2 * r) + 1);
  for (let i = 0; i < 12; i++) {
    x = Math.max(x, 1e-5);
    const sh = Math.sinh(x), ch = Math.cosh(x);
    const f = sh / x - r, df = (x * ch - sh) / (x * x);
    const dx = f / df;
    x -= dx;
    if (Math.abs(dx) < 1e-7 * x) break;
  }
  return Math.max(x, 1e-5);
}

/**
 * n+1 points (xyz packed into out) of a line of unstretched length `len` hung from a to b, carrying `tension` N, weighing
 * `w` N/m. Slack (len longer than the chord): the catenary through both ends for that length. Taut: straight but for
 * its own weight, a parabola of mid-span sag w⊥·c²/8T (never less than a just-taut line's 3 % of the chord ... never
 * more than a fifth of it). Returns the mid-span sag, m.
 */
export function hangLine(out: Float32Array, a: Vec3, b: Vec3, len: number, tension: number, w: number, n: number): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const h = Math.hypot(dx, dz), c = Math.hypot(h, dy);
  if (len > c + 1e-3 && h > 0.04 * c && len > Math.abs(dy) + 1e-3) {
    const x = solveSinhc(Math.sqrt(len * len - dy * dy) / h);
    const k = h / (2 * x);
    const xm = h / 2 - k * Math.atanh(dy / len);
    const c0 = a[1] - k * Math.cosh(-xm / k);
    let sag = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = k * Math.cosh((t * h - xm) / k) + c0;
      out[i * 3] = a[0] + dx * t; out[i * 3 + 1] = y; out[i * 3 + 2] = a[2] + dz * t;
      if (i * 2 === n) sag = a[1] + dy * 0.5 - y;
    }
    return sag;
  }
  let s: number;
  if (len > c + 1e-3) s = Math.min(len * 0.5, Math.sqrt((3 * c * (len - c)) / 8));
  else {
    // weight across the chord: the component of gravity square to it
    const wp = c > 1e-6 ? w * (h / c) : 0;
    const floor = 0.03 * c * (h / Math.max(c, 1e-6));
    s = tension > 1 ? Math.max(Math.min((wp * c * c) / (8 * tension), c * 0.2), Math.min(floor, (wp * c * c) / (8 * tension))) : floor;
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out[i * 3] = a[0] + dx * t; out[i * 3 + 1] = a[1] + dy * t - s * 4 * t * (1 - t); out[i * 3 + 2] = a[2] + dz * t;
  }
  return s;
}

/* ----- drawing ----- */

function hideLine(id: number): void {
  const L = tl[id];
  if (!wireM || !fibreM || !whiskM || !eyeM || !shackleM) return;
  for (let i = 0; i < LS; i++) { wireM.setMatrixAt(id * LS + i, ZERO); fibreM.setMatrixAt(id * LS + i, ZERO); }
  for (let i = 0; i < WHISK; i++) whiskM.setMatrixAt(id * WHISK + i, ZERO);
  for (let i = 0; i < 2; i++) { eyeM.setMatrixAt(id * 2 + i, ZERO); shackleM.setMatrixAt(id * 2 + i, ZERO); }
  wireM.instanceMatrix.needsUpdate = fibreM.instanceMatrix.needsUpdate = whiskM.instanceMatrix.needsUpdate = true;
  eyeM.instanceMatrix.needsUpdate = shackleM.instanceMatrix.needsUpdate = true;
  if (L) L.links = 0;
}

/* lay the strand along pts[0..n]: one cylinder per segment, each overlapping the next by a radius */
function drawStrand(id: number, L: ToolLine, pts: Float32Array, n: number): void {
  if (L.look === 'chain') return;
  const mesh = L.look === 'wire' ? wireM! : fibreM!, off = L.look === 'wire' ? wireOff : fibreOff;
  let along = 0;
  for (let i = 0; i < LS; i++) {
    const k = id * LS + i;
    if (i >= n) { mesh.setMatrixAt(k, ZERO); continue; }
    pa.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    pb.set(pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]);
    seg.subVectors(pb, pa);
    const l = seg.length();
    if (l < 1e-5) { mesh.setMatrixAt(k, ZERO); continue; }
    seg.multiplyScalar(1 / l);
    // a worn spot opens up: strands spring apart round broken wires (a birdcage), yarns bulge round cut ones
    const z = (i + 0.5) / LS - L.frayAt;
    const r = readable(L.r, pa) * (1 + 0.9 * L.fray * Math.exp(-(z * z) * 150));
    lq.setFromUnitVectors(UP, seg);
    lm.compose(pa.addScaledVector(seg, -r * 0.5), lq, ls.set(r, l + r, r));
    mesh.setMatrixAt(k, lm);
    off.setX(k, along - r * 0.5);
    along += l;
  }
  mesh.instanceMatrix.needsUpdate = true;
  off.needsUpdate = true;
}

/* links laid along the polyline at the pitch, alternate links turned a quarter round the chain's axis */
function drawLinks(L: ToolLine, pts: Float32Array, n: number): void {
  if (!linkM) return;
  pa.set(pts[Math.floor(n / 2) * 3], pts[Math.floor(n / 2) * 3 + 1], pts[Math.floor(n / 2) * 3 + 2]);
  const d = 2 * Math.min(readable(L.r, pa), L.r * 1.5), pitch = 3 * d * (1 + L.plastic);
  let s = pitch * 0.5, i = 0, acc = 0, k = 0;
  while (i < n && linkUsed < LINKS) {
    pa.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    pb.set(pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]);
    seg.subVectors(pb, pa);
    const l = seg.length();
    if (acc + l < s) { acc += l; i++; continue; }
    tan.copy(seg).multiplyScalar(1 / Math.max(l, 1e-6));
    pa.addScaledVector(tan, s - acc);
    // a stable frame round the tangent (no twist along a sagging run), every other link turned 90°
    side.crossVectors(tan, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const z = new THREE.Vector3().crossVectors(side, tan);
    if (k & 1) lbasis.makeBasis(z.clone().negate(), tan, side); else lbasis.makeBasis(side, tan, z);
    lq.setFromRotationMatrix(lbasis);
    lm.compose(pa, lq, ls.set(d * (1 - L.plastic * 0.5), d * (1 + L.plastic), d * (1 - L.plastic * 0.5)));
    linkM.setMatrixAt(linkUsed, lm);
    linkM.setColorAt(linkUsed, lc.setHex(L.color));
    linkUsed++; k++;
    s += pitch;
  }
  L.links = k;
}

/* Broken wires round the weak spot, sprung out and curled back along the lay like fish-hooks (up to 32 at the break,
   ISO 4309 would discard the rope at 9 in 6 d); on fibre rope, cut yarns standing off the braid. */
const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _wo = new THREE.Vector3(), _wz = new THREE.Vector3();
function drawFray(id: number, L: ToolLine, pts: Float32Array, n: number): void {
  if (!whiskM) return;
  const show = L.look === 'chain' ? 0 : Math.round(WIRES * Math.min(1, L.fray * 1.2));
  const j = Math.min(n - 1, Math.max(0, Math.floor(L.frayAt * n)));
  pa.set(pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]);
  pb.set(pts[j * 3 + 3], pts[j * 3 + 4], pts[j * 3 + 5]);
  tan.subVectors(pb, pa).normalize();
  side.crossVectors(tan, UP);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  _wz.crossVectors(side, tan);
  const wire = L.look === 'wire';
  const rv = readable(L.r, pa);
  for (let i = 0; i < WIRES; i++) {
    const k = id * WHISK + i * 2;
    if (i >= show) { whiskM.setMatrixAt(k, ZERO); whiskM.setMatrixAt(k + 1, ZERO); continue; }
    // a fixed scatter per line (hash of its seed), so the frayed wires don't dance from frame to frame
    const h1 = fract(Math.sin((L.seed + i) * 12.9898) * 43758.5453), h2 = fract(Math.sin((L.seed + i) * 78.233) * 12345.678);
    const a = h1 * Math.PI * 2, t = (h2 - 0.5) * rv * 12;
    _w1.copy(pa).lerp(pb, 0.5).addScaledVector(tan, t);
    _wo.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(_wz, Math.sin(a));
    _w1.addScaledVector(_wo, rv * 1.3);
    const len = (wire ? 2.6 : 2) * rv * (0.6 + 0.8 * h2) * (0.6 + 0.6 * L.fray);
    const th = Math.max(wire ? L.r * 0.08 : L.r * 0.06, rv * 0.14);
    const back = h2 > 0.5 ? 1 : -1;
    const col = lc.setHex(wire ? 0xc4c8cc : L.color).offsetHSL(0, 0, wire ? 0 : 0.12);
    if (!wire) {
      // cut yarns: short fine fibres standing off the braid every which way, no second bend
      seg.copy(_wo).addScaledVector(tan, (h1 - 0.5) * 1.6).addScaledVector(side, (h2 - 0.5) * 0.8).normalize();
      lq.setFromUnitVectors(UP, seg);
      lm.compose(_w1.addScaledVector(_wo, -rv * 0.4), lq, ls.set(th * 0.6, len * 0.55, th * 0.6));
      whiskM.setMatrixAt(k, lm);
      whiskM.setColorAt(k, col);
      whiskM.setMatrixAt(k + 1, ZERO);
      continue;
    }
    // out from the rope, then curling back along it
    seg.copy(_wo).multiplyScalar(0.8).addScaledVector(tan, 0.6 * back).normalize();
    lq.setFromUnitVectors(UP, seg);
    lm.compose(_w1, lq, ls.set(th, len, th));
    whiskM.setMatrixAt(k, lm);
    whiskM.setColorAt(k, col);
    _w2.copy(_w1).addScaledVector(seg, len);
    seg.copy(_wo).multiplyScalar(0.15).addScaledVector(tan, back).normalize();
    lq.setFromUnitVectors(UP, seg);
    lm.compose(_w2, lq, ls.set(th, len * 0.8, th));
    whiskM.setMatrixAt(k + 1, lm);
    whiskM.setColorAt(k + 1, col);
  }
  whiskM.instanceMatrix.needsUpdate = true;
  if (whiskM.instanceColor) whiskM.instanceColor.needsUpdate = true;
}

/* A thimble eye in the line's end and a bow shackle through it, sized to the rope (pin ~1.1 d), lying along the line. */
function drawFittings(id: number, L: ToolLine, pts: Float32Array, n: number): void {
  if (!eyeM || !shackleM) return;
  const d = 2 * Math.min(readable(L.r, pa.set(pts[0], pts[1], pts[2])), L.r * 1.5);
  for (let e = 0; e < 2; e++) {
    const i0 = e === 0 ? 0 : n, i1 = e === 0 ? 1 : n - 1;
    pa.set(pts[i0 * 3], pts[i0 * 3 + 1], pts[i0 * 3 + 2]);
    pb.set(pts[i1 * 3], pts[i1 * 3 + 1], pts[i1 * 3 + 2]);
    tan.subVectors(pb, pa).normalize();
    side.crossVectors(tan, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    _wz.crossVectors(side, tan);
    // the eye: its long axis along the line, 2.2 d out from the anchor
    lbasis.makeBasis(side, tan, _wz);
    lq.setFromRotationMatrix(lbasis);
    _w1.copy(pa).addScaledVector(tan, d * 3.2);
    lm.compose(_w1, lq, ls.set(d * 1.5, d * 1.5, d * 1.5));
    eyeM.setMatrixAt(id * 2 + e, lm);
    // the shackle: bow through the eye, pin across at the anchor, turned a quarter to the eye
    lbasis.makeBasis(_wz, tan, side);
    lq.setFromRotationMatrix(lbasis);
    lm.compose(pa, lq, ls.set(d * 1.1, d * 1.1, d * 1.1));
    shackleM.setMatrixAt(id * 2 + e, lm);
  }
  eyeM.instanceMatrix.needsUpdate = shackleM.instanceMatrix.needsUpdate = true;
}

const fract = (x: number) => x - Math.floor(x);
const _pts = new Float32Array((LS + 1) * 3);
const _wv: Vec3 = [0, 0, 0], _we: Vec3 = [0, 0, 0];

/* A parted line: each half runs back past its own anchor at the recoil speed, snaking and dropping as it goes. */
function drawWhip(id: number, L: ToolLine): boolean {
  const w = L.whip!;
  const t = clock - w.t0;
  if (t > WHIP_T) return false;
  const halves: [Vec3, number][] = [[w.a, w.at], [w.b, 1 - w.at]];
  halves.forEach(([anchor, share], h) => {
    const sid = h === 0 ? id : w.twin;
    if (sid < 0) return;
    const S = tl[sid];
    const full = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]);
    const len = full * share;
    // the free end: out from the break toward (and past) the anchor, braking as the line piles up
    const brk: Vec3 = [w.a[0] + (w.b[0] - w.a[0]) * w.at, w.a[1] + (w.b[1] - w.a[1]) * w.at, w.a[2] + (w.b[2] - w.a[2]) * w.at];
    const tau = Math.max(0.05, (len / Math.max(w.v, 1)) * 1.4);
    // it runs back almost its whole length past its anchor before the energy is spent
    const travel = len * 1.9 * (1 - Math.exp(-t / tau));
    vec3sub(_wv, anchor, brk);
    const d = Math.hypot(_wv[0], _wv[1], _wv[2]) || 1;
    _we[0] = brk[0] + (_wv[0] / d) * travel;
    _we[1] = brk[1] + (_wv[1] / d) * travel - 4.9 * Math.max(0, t - tau) ** 2;
    _we[2] = brk[2] + (_wv[2] / d) * travel;
    const amp = Math.min(0.6, len * 0.15) * Math.exp(-t * 3);
    for (let i = 0; i <= LS; i++) {
      const s = i / LS;
      const wave = amp * Math.sin(Math.PI * s) * Math.sin(Math.PI * (4 * s - t * 14));
      _pts[i * 3] = anchor[0] + (_we[0] - anchor[0]) * s + wave * (_wv[2] / d);
      _pts[i * 3 + 1] = anchor[1] + (_we[1] - anchor[1]) * s - 0.3 * len * s * (1 - s) * Math.min(1, t * 2) + wave * 0.5;
      _pts[i * 3 + 2] = anchor[2] + (_we[2] - anchor[2]) * s - wave * (_wv[0] / d);
    }
    if (S.look === 'chain') drawLinks(S, _pts, LS); else drawStrand(sid, S, _pts, LS);
  });
  return true;
}

function vec3sub(o: Vec3, a: Vec3, b: Vec3): void { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; }

function freeLine(id: number): void {
  const L = tl[id];
  if (!L || !L.on) return;
  L.on = false;
  L.whip = null;
  hideLine(id);
  tlFree.push(id);
}

export const lines = {
  /** reserves a line drawn as `look`, radius r (m), colour; -1 when all are in use */
  add(look: LineLook, r: number, color: number): number {
    if (!wireM) return -1;
    const id = tlFree.pop() ?? (tlHigh < LN ? tlHigh++ : -1);
    if (id < 0) return -1;
    tl[id] = { on: true, look, r, color, pts: new Float32Array((LS + 1) * 3), fray: 0, frayAt: 0.85, seed: id * 7 + 1, whip: null, links: 0, plastic: 0 };
    if (look !== 'chain') {
      const m = look === 'wire' ? wireM! : fibreM!;
      for (let i = 0; i < LS; i++) m.setColorAt(id * LS + i, lc.setHex(color));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    hideLine(id);
    wireM!.count = fibreM!.count = tlHigh * LS;
    whiskM!.count = tlHigh * WHISK;
    eyeM!.count = shackleM!.count = tlHigh * 2;
    return id;
  },
  /** Draws the line between a and b (see hangLine); fray 0..1 is how near it came to parting, at `frayAt` along it;
   *  `plastic` is a chain's yield stretch. `fittings` off for a line whose ends are drawn by its owner. */
  set(id: number, a: Vec3, b: Vec3, len: number, tension: number, w: number, fray = 0, frayAt = 0.85, plastic = 0, fittings = true): void {
    const L = tl[id];
    if (!L || !L.on || L.whip) return;
    hangLine(L.pts, a, b, len, tension, w, LS);
    onFloor(L.pts, LS, L.r);
    L.fray = fray;
    L.frayAt = frayAt;
    L.plastic = plastic;
    if (L.look === 'chain') drawLinks(L, L.pts, LS);
    else { drawStrand(id, L, L.pts, LS); drawFray(id, L, L.pts, LS); }
    if (fittings) drawFittings(id, L, L.pts, LS);
  },
  /** The line parted `at` (0..1 from a): it whips back at v m/s and is freed when the recoil has run out. */
  snap(id: number, a: Vec3, b: Vec3, at: number, v: number): void {
    const L = tl[id];
    if (!L || !L.on) return;
    const twin = lines.add(L.look, L.r, L.color);
    L.whip = { t0: clock, a: [...a], b: [...b], at, v, twin };
    L.fray = 0;
    for (let i = 0; i < WHISK; i++) whiskM?.setMatrixAt(id * WHISK + i, ZERO);
    for (let i = 0; i < 2; i++) { eyeM?.setMatrixAt(id * 2 + i, ZERO); shackleM?.setMatrixAt(id * 2 + i, ZERO); }
    if (twin >= 0) tl[twin].whip = { t0: clock, a: [...a], b: [...b], at, v, twin: -2 };
  },
  remove(id: number): void {
    const L = tl[id];
    if (!L || !L.on || L.whip) return;
    freeLine(id);
  },
  /** Once a frame, before the owners' `set` calls: advances the recoils; after them the chain links are flushed. */
  /** dev: slow the recoils down to look at them (1 = real time) */
  whipRate: 1,
  begin(dt: number, cam?: Vec3): void {
    clock += dt * lines.whipRate;
    if (cam) eye.set(cam[0], cam[1], cam[2]);
    linkUsed = 0;
    for (let id = 0; id < tlHigh; id++) {
      const L = tl[id];
      if (!L?.on || !L.whip || L.whip.twin === -2) continue;
      if (!drawWhip(id, L)) { const t = L.whip.twin; freeLine(id); if (t >= 0) freeLine(t); }
    }
  },
  flush(): void {
    if (!linkM) return;
    linkM.count = linkUsed;
    linkM.instanceMatrix.needsUpdate = true;
    if (linkM.instanceColor) linkM.instanceColor.needsUpdate = true;
  },
  clear(): void {
    for (let id = 0; id < tlHigh; id++) if (tl[id]?.on) { tl[id].on = false; tl[id].whip = null; hideLine(id); }
    tlFree.length = 0;
    tlHigh = 0;
    linkUsed = 0;
    if (wireM) wireM.count = 0;
    if (fibreM) fibreM.count = 0;
    if (whiskM) whiskM.count = 0;
    if (eyeM) eyeM.count = 0;
    if (shackleM) shackleM.count = 0;
    lines.flush();
  },
};
