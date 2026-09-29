/* Strike marks: what a blow that did not break anything still left on the face. A star of cracks on masonry and
   glass, a bright scuff on metal, a bruised dent on timber, growing blow by blow at the same spot. Each mark rides
   its piece (stored in the piece's frame), fades after a while, and goes with the piece when it breaks. */
import * as THREE from 'three';
import type { Vec3, MaterialId } from '../types';
import type { Piece } from '../destruction/structure';

type Kind = 0 | 1 | 2;
const MAX = 48;
const LIFE = 40;
const METAL = new Set<MaterialId>(['steel', 'castiron', 'metal', 'machine', 'aluminum', 'copper']);
const TIMBER = new Set<MaterialId>(['wood', 'oak', 'plywood', 'crate', 'cardboard']);

interface Mark { m: THREE.Mesh; p: Piece | null; lp: THREE.Vector3; ln: THREE.Vector3; size: number; born: number; spin: number }

let root: THREE.Group | null = null;
const marks: Mark[] = [];
let mats: THREE.MeshBasicMaterial[] = [];
let clock = 0;
let next = 0;

function tex(kind: Kind): THREE.CanvasTexture {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  let seed = 7 + kind * 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 0) {
    // radial cracks from a crushed centre
    // pale powdered bruise round a dark crushed pit: reads on light render and dark brick alike
    const halo = g.createRadialGradient(0, 0, 10, 0, 0, 40);
    halo.addColorStop(0, 'rgba(232,224,206,0.45)'); halo.addColorStop(1, 'rgba(232,224,206,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 22);
    grd.addColorStop(0, 'rgba(0,0,0,0.9)'); grd.addColorStop(0.6, 'rgba(10,8,6,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      let a = (i / 9) * Math.PI * 2 + rnd() * 0.5, x = 0, y = 0, w = 5;
      g.beginPath(); g.moveTo(0, 0);
      const L = 30 + rnd() * 30;
      for (let s = 0; s < L; s += 6) { a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineWidth = w; g.lineTo(x, y); w = Math.max(1.4, w * 0.86); }
      g.stroke();
    }
  } else if (kind === 1) {
    // bright scuffed metal ringed by a dull bruise
    const grd = g.createRadialGradient(0, 0, 4, 0, 0, 40);
    grd.addColorStop(0, 'rgba(255,250,235,0.9)'); grd.addColorStop(0.45, 'rgba(210,205,195,0.55)'); grd.addColorStop(1, 'rgba(40,36,32,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 14; i++) { const a = rnd() * Math.PI * 2, r0 = rnd() * 12, r1 = 14 + rnd() * 22; g.lineWidth = 0.8 + rnd(); g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); }
  } else {
    // crushed fibres: a dark oval dent with split grain along it
    g.scale(1, 0.55);
    const grd = g.createRadialGradient(0, 0, 2, 0, 0, 38);
    grd.addColorStop(0, 'rgba(20,10,4,0.85)'); grd.addColorStop(1, 'rgba(20,10,4,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(10,5,2,0.8)';
    for (let i = 0; i < 6; i++) { const y = (rnd() - 0.5) * 30; g.lineWidth = 1 + rnd() * 1.5; g.beginPath(); g.moveTo(-46 + rnd() * 10, y); g.lineTo(46 - rnd() * 10, y + (rnd() - 0.5) * 6); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function initStrikes(scene: THREE.Scene): void {
  if (root) { if (root.parent !== scene) scene.add(root); return; }
  root = new THREE.Group();
  root.name = 'strikes';
  mats = ([0, 1, 2] as Kind[]).map(k => new THREE.MeshBasicMaterial({
    map: tex(k), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    fog: true,
  }));
  const geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < MAX; i++) {
    const m = new THREE.Mesh(geo, mats[0]);
    m.visible = false;
    m.renderOrder = 2;
    root.add(m);
    marks.push({ m, p: null, lp: new THREE.Vector3(), ln: new THREE.Vector3(), size: 0, born: -99, spin: 0 });
  }
  scene.add(root);
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

function kindOf(mat: MaterialId): Kind {
  return METAL.has(mat) ? 1 : TIMBER.has(mat) ? 2 : 0;
}

export const strikes = {
  /** a blow at `point` on `p`: grows the mark already there, else starts one */
  add(p: Piece, point: Vec3, normal: Vec3, size: number): void {
    if (!root || p.dead) return;
    _q.set(p.curRot[0], p.curRot[1], p.curRot[2], p.curRot[3]).invert();
    _v.set(point[0] - p.curPos[0], point[1] - p.curPos[1], point[2] - p.curPos[2]).applyQuaternion(_q);
    _n.set(normal[0], normal[1], normal[2]).applyQuaternion(_q).normalize();
    for (const k of marks) {
      if (k.p === p && k.lp.distanceTo(_v) < Math.max(0.1, k.size * 0.4) && clock - k.born < LIFE) {
        k.size = Math.min(0.6, Math.max(k.size, size) + size * 0.25);
        k.born = clock;
        return;
      }
    }
    const k = marks[next];
    next = (next + 1) % MAX;
    k.p = p; k.lp.copy(_v); k.ln.copy(_n); k.size = size; k.born = clock; k.spin = Math.random() * Math.PI * 2;
    k.m.material = mats[kindOf(p.mat)];
  },

  update(dt: number): void {
    if (!root) return;
    clock += dt;
    for (const k of marks) {
      const p = k.p;
      if (!p || p.dead || clock - k.born > LIFE) { k.m.visible = false; if (p?.dead) k.p = null; continue; }
      _q.set(p.curRot[0], p.curRot[1], p.curRot[2], p.curRot[3]);
      _v.copy(k.lp).applyQuaternion(_q);
      _n.copy(k.ln).applyQuaternion(_q);
      k.m.position.set(p.curPos[0] + _v.x + _n.x * 0.004, p.curPos[1] + _v.y + _n.y * 0.004, p.curPos[2] + _v.z + _n.z * 0.004);
      k.m.quaternion.setFromUnitVectors(_z, _n);
      k.m.rotateZ(k.spin);
      k.m.scale.setScalar(k.size);
      const fade = Math.min(1, (LIFE - (clock - k.born)) / 6);
      k.m.visible = fade > 0.01;
      k.m.scale.multiplyScalar(fade);
    }
  },

  clear(): void {
    for (const k of marks) { k.p = null; k.m.visible = false; }
  },
};
