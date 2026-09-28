/* Soft-body rendering: every sheet (cloth, netting, softbody skins) shares one dynamic mesh, ropes one tube
   mesh and grains one instanced mesh, so the whole system is three draw calls (plus shadows). Per-vertex
   attributes carry each fabric's look: roughness, velvet sheen, see-through weave for netting, weave
   frequency, and the burn state (char darkening in the colour, a glowing front in aGlow). */
import * as THREE from 'three';
import { dustU } from './shared';
import { softBodies, softVersion, setSoftViewer, type SoftBody } from '../sim/soft';
import { pool, ALIVE, BURNING } from '../sim/particles';

let scene: THREE.Scene | null = null;
let sheet: THREE.Mesh | null = null;
let rope: THREE.Mesh | null = null;
let grains: THREE.InstancedMesh | null = null;

const CHAR = new THREE.Color(0x120d09);
const _c = new THREE.Color(), _t = new THREE.Color();

/* ---------------- materials ---------------- */

function sheetMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0,
    sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(1, 1, 1),
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, dustU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFab;\nattribute float aGlow;\nattribute vec2 aUv;\nvarying vec4 vFab;\nvarying float vGlow;\nvarying vec2 vFuv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFab = aFab; vGlow = aGlow; vFuv = aUv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFab;\nvarying float vGlow;\nvarying vec2 vFuv;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        if ( vFab.w > 0.0 ) {
          vec2 wv = vFuv * vFab.w;
          vec2 fw = fwidth( wv );
          float fine = clamp( 1.0 - max( fw.x, fw.y ) * 0.6, 0.0, 1.0 );
          // over/under yarn shading, faded out where the weave is finer than a pixel
          float yarn = sin( wv.x * 6.2832 ) * sin( wv.y * 6.2832 );
          diffuseColor.rgb *= 1.0 - 0.09 * fine * ( 0.5 + 0.5 * yarn );
          if ( vFab.z > 0.0 ) {
            vec2 g = abs( fract( wv ) - 0.5 );
            float open = step( max( g.x, g.y ), 0.5 - 0.5 * ( 1.0 - vFab.z ) );
            // beyond pixel scale the mesh dithers to its solidity instead of aliasing
            float h = fract( sin( dot( floor( gl_FragCoord.xy ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            if ( mix( h < vFab.z ? 1.0 : 0.0, open, fine ) > 0.5 ) discard;
          }
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vFab.x;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor *= vFab.y * diffuseColor.rgb * 1.6;\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3( 1.0, 0.36, 0.08 ) * vGlow * vGlow * 4.0;');
  };
  m.customProgramCacheKey = () => 'dv-soft-sheet';
  return m;
}

/* ---------------- growable buffers ---------------- */

function attr(geo: THREE.BufferGeometry, name: string, size: number, cap: number, dynamic: boolean): THREE.BufferAttribute {
  const old = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (old && old.count >= cap) return old;
  const a = new THREE.BufferAttribute(new Float32Array(cap * size), size);
  if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

function indexOf(geo: THREE.BufferGeometry, cap: number): THREE.BufferAttribute {
  const old = geo.getIndex();
  if (old && old.count >= cap) return old;
  const a = new THREE.BufferAttribute(new Uint32Array(cap), 1);
  geo.setIndex(a);
  return a;
}

/* ---------------- init / layout ---------------- */

export function initSoftGfx(s: THREE.Scene): void {
  scene = s;
  if (!sheet) {
    sheet = new THREE.Mesh(new THREE.BufferGeometry(), sheetMaterial());
    sheet.name = 'softSheets';
    sheet.frustumCulled = false;
    sheet.castShadow = sheet.receiveShadow = true;
    sheet.onBeforeRender = (_r, _s, cam) => {
      const c = cam as THREE.PerspectiveCamera;
      if (c.isPerspectiveCamera && c.far > 500) setSoftViewer([c.position.x, c.position.y, c.position.z]);
    };
    rope = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.15 }));
    rope.name = 'softRopes';
    rope.frustumCulled = false;
    rope.castShadow = rope.receiveShadow = true;
  }
  if (sheet.parent !== s) s.add(sheet);
  if (rope && rope.parent !== s) s.add(rope);
  if (grains && grains.parent !== s) s.add(grains);
}

interface Slot { b: SoftBody; off: number; topo: number; shade: number; awake: boolean }
let slots: Slot[] = [];
let ropeSlots: Slot[] = [];
let grainSlots: Slot[] = [];
let layoutVersion = -1;
let sheetVerts = 0, ropeVerts = 0, grainCount = 0;
const RING = 6;

function relayout(): void {
  layoutVersion = softVersion;
  slots = []; ropeSlots = []; grainSlots = [];
  sheetVerts = ropeVerts = grainCount = 0;
  for (const b of softBodies) {
    if (b.kind === 'rope') { ropeSlots.push({ b, off: ropeVerts, topo: -1, shade: -1, awake: true }); ropeVerts += b.n * RING; }
    else if (b.kind === 'granular') { grainSlots.push({ b, off: grainCount, topo: -1, shade: -1, awake: true }); grainCount += b.n; }
    else { slots.push({ b, off: sheetVerts, topo: -1, shade: -1, awake: true }); sheetVerts += b.n; }
  }
  if (sheet) {
    const g = sheet.geometry;
    attr(g, 'position', 3, sheetVerts, true); attr(g, 'normal', 3, sheetVerts, true); attr(g, 'color', 3, sheetVerts, true);
    attr(g, 'aGlow', 1, sheetVerts, true); attr(g, 'aFab', 4, sheetVerts, false); attr(g, 'aUv', 2, sheetVerts, false);
    const fab = g.getAttribute('aFab') as THREE.BufferAttribute, uv = g.getAttribute('aUv') as THREE.BufferAttribute;
    for (const s of slots) {
      const b = s.b, look = b.fab.look;
      for (let k = 0; k < b.n; k++) {
        fab.setXYZW(s.off + k, look[0], look[1], look[2], look[3]);
        if (b.kind === 'softbody') {
          const i = b.p0 + k;
          uv.setXY(s.off + k, pool.x[i * 3] + pool.x[i * 3 + 2], pool.x[i * 3 + 1]);
        } else if (b.uv) uv.setXY(s.off + k, b.uv[k * 2], b.uv[k * 2 + 1]);
        else uv.setXY(s.off + k, b.cols ? b.cols[k % b.nu] : (k % b.nu) * b.resU, Math.floor(k / b.nu) * b.resV);
      }
    }
    fab.needsUpdate = uv.needsUpdate = true;
  }
  if (rope) {
    const g = rope.geometry;
    attr(g, 'position', 3, ropeVerts, true); attr(g, 'normal', 3, ropeVerts, true); attr(g, 'color', 3, ropeVerts, true);
  }
  makeGrains(Math.max(grainCount, 256));
  for (const s of grainSlots) seedGrains(s);
}

function makeGrains(cap: number): void {
  if (grains && (grains.instanceMatrix.count >= cap)) return;
  if (grains) { grains.removeFromParent(); grains.dispose(); }
  const geo = new THREE.IcosahedronGeometry(1, 0);
  grains = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true }), cap);
  grains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grains.setColorAt(0, _c.setRGB(1, 1, 1));
  grains.frustumCulled = false;
  grains.castShadow = grains.receiveShadow = true;
  grains.name = 'softGrains';
  grains.count = 0;
  if (scene) scene.add(grains);
}

/* each grain slot gets a fixed tumbled, squashed basis; only its translation changes per frame */
let basis = new Float32Array(0);
function seedGrains(s: Slot): void {
  if (!grains) return;
  if (basis.length < grains.instanceMatrix.count * 9) {
    const nb = new Float32Array(grains.instanceMatrix.count * 9);
    nb.set(basis);
    basis = nb;
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  const b = s.b, r = pool.r[b.p0] * 1.3;
  _t.setHex(b.tint);
  for (let k = 0; k < b.n; k++) {
    const slot = s.off + k, h = Math.sin(slot * 12.9898 + b.id * 78.233) * 43758.5453, f = h - Math.floor(h);
    e.set(f * 6.28, f * 37.1, f * 91.7);
    q.setFromEuler(e);
    sc.set(r * (0.8 + 0.4 * f), r * (0.6 + 0.3 * ((f * 7.3) % 1)), r * (0.8 + 0.4 * ((f * 3.1) % 1)));
    m.compose(new THREE.Vector3(), q, sc);
    const el = m.elements;
    basis.set([el[0], el[1], el[2], el[4], el[5], el[6], el[8], el[9], el[10]], slot * 9);
    grains.setColorAt(slot, _c.copy(_t).multiplyScalar(0.82 + 0.3 * ((f * 13.7) % 1)));
  }
  if (grains.instanceColor) grains.instanceColor.needsUpdate = true;
}

/* ---------------- per-frame sync ---------------- */

export function syncSoftGfx(alpha: number): void {
  if (!sheet || !rope) return;
  if (layoutVersion !== softVersion) relayout();
  syncSheets(alpha);
  syncRopes(alpha);
  syncGrains(alpha);
}

function lerpPos(i: number, alpha: number, out: Float32Array, o: number): void {
  const X = pool.x, S = pool.sx, i3 = i * 3;
  out[o] = S[i3] + (X[i3] - S[i3]) * alpha;
  out[o + 1] = S[i3 + 1] + (X[i3 + 1] - S[i3 + 1]) * alpha;
  out[o + 2] = S[i3 + 2] + (X[i3 + 2] - S[i3 + 2]) * alpha;
}

function syncSheets(alpha: number): void {
  const g = sheet!.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute, nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute, glow = g.getAttribute('aGlow') as THREE.BufferAttribute;
  if (!pos) return;
  const P = pos.array as Float32Array, N = nor.array as Float32Array, C = col.array as Float32Array, G = glow.array as Float32Array;
  let topo = false, moved = false, shaded = false;
  for (const s of slots) {
    const b = s.b;
    if (b.dead) continue;
    if (s.topo !== b.topo) { s.topo = b.topo; topo = true; }
    const fresh = s.awake !== b.awake || b.awake || s.shade < 0;
    s.awake = b.awake;
    if (fresh) {
      moved = true;
      for (let k = 0; k < b.n; k++) lerpPos(b.p0 + k, b.awake ? alpha : 1, P, (s.off + k) * 3);
      normals(s, P, N);
    }
    if (s.shade !== b.shade) {
      s.shade = b.shade;
      shaded = true;
      _t.setHex(b.tint);
      for (let k = 0; k < b.n; k++) {
        const i = b.p0 + k, ch = pool.char[i];
        _c.copy(_t).lerp(CHAR, Math.min(1, ch * 1.15));
        C[(s.off + k) * 3] = _c.r; C[(s.off + k) * 3 + 1] = _c.g; C[(s.off + k) * 3 + 2] = _c.b;
        G[s.off + k] = pool.fl[i] & BURNING ? 0.6 + 0.4 * Math.random() : Math.max(0, (pool.temp[i] - 300) / 500);
      }
    }
  }
  if (topo) rebuildSheetIndex();
  if (moved) { pos.needsUpdate = true; nor.needsUpdate = true; }
  if (shaded) { col.needsUpdate = true; glow.needsUpdate = true; }
}

function tri(idx: Uint32Array, n: number, a: number, b: number, c: number): number {
  idx[n] = a; idx[n + 1] = b; idx[n + 2] = c;
  return n + 3;
}

function rebuildSheetIndex(): void {
  const g = sheet!.geometry;
  let cap = 0;
  for (const s of slots) cap += s.b.kind === 'softbody' ? (s.b.surf.length / 4) * 6 : s.b.nc * 6;
  const ia = indexOf(g, Math.max(cap, 6));
  const idx = ia.array as Uint32Array;
  let n = 0;
  for (const s of slots) {
    const b = s.b, o = s.off - b.p0;
    if (b.dead) continue;
    if (b.kind === 'softbody') {
      for (let q = 0; q < b.surf.length; q += 4) {
        const A = b.surf[q] + o, B = b.surf[q + 1] + o, C = b.surf[q + 2] + o, D = b.surf[q + 3] + o;
        n = tri(idx, n, A, B, C); n = tri(idx, n, A, C, D);
      }
      continue;
    }
    for (let c = 0; c < b.nc; c++) {
      if (!b.cAlive[c]) continue;
      const A = b.c2p[c * 4] + o, B = b.c2p[c * 4 + 1] + o, C = b.c2p[c * 4 + 2] + o, D = b.c2p[c * 4 + 3] + o;
      if (b.cFlip[c]) { n = tri(idx, n, A, B, D); n = tri(idx, n, B, C, D); }
      else { n = tri(idx, n, A, B, C); n = tri(idx, n, A, C, D); }
    }
  }
  ia.needsUpdate = true;
  g.setDrawRange(0, n);
}

function normals(s: Slot, P: Float32Array, N: Float32Array): void {
  const b = s.b, o = s.off;
  N.fill(0, o * 3, (o + b.n) * 3);
  const face = (a: number, bb: number, c: number): void => {
    const a3 = a * 3, b3 = bb * 3, c3 = c * 3;
    const ux = P[b3] - P[a3], uy = P[b3 + 1] - P[a3 + 1], uz = P[b3 + 2] - P[a3 + 2];
    const vx = P[c3] - P[a3], vy = P[c3 + 1] - P[a3 + 1], vz = P[c3 + 2] - P[a3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    N[a3] += nx; N[a3 + 1] += ny; N[a3 + 2] += nz;
    N[b3] += nx; N[b3 + 1] += ny; N[b3 + 2] += nz;
    N[c3] += nx; N[c3 + 1] += ny; N[c3 + 2] += nz;
  };
  const d = o - b.p0;
  if (b.kind === 'softbody') {
    for (let q = 0; q < b.surf.length; q += 4) {
      face(b.surf[q] + d, b.surf[q + 1] + d, b.surf[q + 2] + d);
      face(b.surf[q] + d, b.surf[q + 2] + d, b.surf[q + 3] + d);
    }
  } else {
    for (let c = 0; c < b.nc; c++) {
      if (!b.cAlive[c]) continue;
      const A = b.c2p[c * 4] + d, B = b.c2p[c * 4 + 1] + d, C = b.c2p[c * 4 + 2] + d, D = b.c2p[c * 4 + 3] + d;
      if (b.cFlip[c]) { face(A, B, D); face(B, C, D); } else { face(A, B, C); face(A, C, D); }
    }
  }
  for (let k = o; k < o + b.n; k++) {
    const x = N[k * 3], y = N[k * 3 + 1], z = N[k * 3 + 2], l = Math.sqrt(x * x + y * y + z * z);
    if (l > 1e-12) { N[k * 3] = x / l; N[k * 3 + 1] = y / l; N[k * 3 + 2] = z / l; } else N[k * 3 + 1] = 1;
  }
}

const _p = new Float32Array(3), _q = new Float32Array(3), _r = new Float32Array(3);
function syncRopes(alpha: number): void {
  const g = rope!.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (!pos || !ropeSlots.length) { g.setDrawRange(0, 0); return; }
  const nor = g.getAttribute('normal') as THREE.BufferAttribute, col = g.getAttribute('color') as THREE.BufferAttribute;
  const P = pos.array as Float32Array, N = nor.array as Float32Array, C = col.array as Float32Array;
  let topo = false, moved = false;
  for (const s of ropeSlots) {
    const b = s.b;
    if (b.dead) continue;
    if (s.topo !== b.topo) { s.topo = b.topo; topo = true; }
    if (s.shade !== b.shade) {
      s.shade = b.shade;
      _t.setHex(b.tint);
      for (let k = 0; k < b.n; k++) {
        _c.copy(_t).lerp(CHAR, Math.min(1, pool.char[b.p0 + k] * 1.15));
        for (let j = 0; j < RING; j++) { const v = (s.off + k * RING + j) * 3; C[v] = _c.r; C[v + 1] = _c.g; C[v + 2] = _c.b; }
      }
      col.needsUpdate = true;
    }
    if (!(b.awake || s.awake !== b.awake)) continue;
    s.awake = b.awake;
    moved = true;
    const r = pool.r[b.p0], a = b.awake ? alpha : 1;
    let nx = 0, ny = 0, nz = 1;
    for (let k = 0; k < b.n; k++) {
      const i = b.p0 + k;
      lerpPos(i, a, _p, 0);
      lerpPos(b.p0 + Math.min(b.n - 1, k + 1), a, _q, 0);
      lerpPos(b.p0 + Math.max(0, k - 1), a, _r, 0);
      let tx = _q[0] - _r[0], ty = _q[1] - _r[1], tz = _q[2] - _r[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // parallel-transport the ring frame so the tube does not twist
      const dn = nx * tx + ny * ty + nz * tz;
      nx -= dn * tx; ny -= dn * ty; nz -= dn * tz;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-3) { nx = Math.abs(ty) < 0.9 ? 0 : 1; ny = Math.abs(ty) < 0.9 ? 1 : 0; nz = 0; const d2 = nx * tx + ny * ty; nx -= d2 * tx; ny -= d2 * ty; nz -= d2 * tz; nl = Math.hypot(nx, ny, nz); }
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let j = 0; j < RING; j++) {
        const th = (j / RING) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        const dx = nx * cs + bx * sn, dy = ny * cs + by * sn, dz = nz * cs + bz * sn;
        const v = (s.off + k * RING + j) * 3;
        P[v] = _p[0] + dx * r; P[v + 1] = _p[1] + dy * r; P[v + 2] = _p[2] + dz * r;
        N[v] = dx; N[v + 1] = dy; N[v + 2] = dz;
      }
    }
  }
  if (moved) { pos.needsUpdate = true; nor.needsUpdate = true; }
  if (topo) {
    let cap = 0;
    for (const s of ropeSlots) cap += s.b.nc * RING * 6;
    const ia = indexOf(g, Math.max(6, cap));
    const idx = ia.array as Uint32Array;
    let n = 0;
    for (const s of ropeSlots) {
      const b = s.b;
      if (b.dead) continue;
      for (let c = 0; c < b.nc; c++) {
        if (!b.cAlive[c]) continue;
        const r0 = s.off + c * RING, r1 = r0 + RING;
        for (let j = 0; j < RING; j++) {
          const j1 = (j + 1) % RING;
          n = tri(idx, n, r0 + j, r1 + j, r1 + j1);
          n = tri(idx, n, r0 + j, r1 + j1, r0 + j1);
        }
      }
    }
    ia.needsUpdate = true;
    g.setDrawRange(0, n);
  }
}

function syncGrains(alpha: number): void {
  if (!grains) return;
  grains.count = grainCount;
  if (!grainCount) return;
  const M = grains.instanceMatrix.array as Float32Array;
  let moved = false;
  for (const s of grainSlots) {
    const b = s.b;
    if (b.dead || !(b.awake || s.awake !== b.awake || s.topo !== b.topo)) continue;
    s.awake = b.awake; s.topo = b.topo;
    moved = true;
    const a = b.awake ? alpha : 1;
    for (let k = 0; k < b.n; k++) {
      const i = b.p0 + k, slot = s.off + k, o = slot * 16, q = slot * 9;
      const on = pool.fl[i] & ALIVE ? 1 : 0;
      M[o] = basis[q] * on; M[o + 1] = basis[q + 1] * on; M[o + 2] = basis[q + 2] * on; M[o + 3] = 0;
      M[o + 4] = basis[q + 3] * on; M[o + 5] = basis[q + 4] * on; M[o + 6] = basis[q + 5] * on; M[o + 7] = 0;
      M[o + 8] = basis[q + 6] * on; M[o + 9] = basis[q + 7] * on; M[o + 10] = basis[q + 8] * on; M[o + 11] = 0;
      lerpPos(i, a, _p, 0);
      M[o + 12] = _p[0]; M[o + 13] = _p[1]; M[o + 14] = _p[2]; M[o + 15] = 1;
    }
  }
  if (moved) grains.instanceMatrix.needsUpdate = true;
}

export function clearSoftGfx(): void {
  layoutVersion = -1;
  slots = []; ropeSlots = []; grainSlots = [];
  if (sheet) sheet.geometry.setDrawRange(0, 0);
  if (rope) rope.geometry.setDrawRange(0, 0);
  if (grains) grains.count = 0;
}
