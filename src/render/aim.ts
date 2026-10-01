/* Aim assist for placed and thrown tools: a ring where the tool will land or stick, the member it will act on
   outlined, the cut line it will make, a device ghost, and a ballistic arc. Drawn over everything each frame
   between begin() and end(); anything not redrawn is hidden. */
import * as THREE from 'three';
import type { Vec3, Quat } from '../types';

export type AimState = 'ok' | 'far' | 'bad' | 'sel';
const COLOR: Record<AimState, THREE.Color> = {
  ok: new THREE.Color(0x5cf08a), far: new THREE.Color(0xffb020), bad: new THREE.Color(0xff3b2f), sel: new THREE.Color(0x4ab2ff),
};
const STD: Record<AimState, number> = { ok: 0x5cf08a, far: 0xffb020, bad: 0xff3b2f, sel: 0x4ab2ff };
/* colour-blind palette (Okabe-Ito): sky blue, yellow, vermillion, reddish purple: apart in lightness as well as hue */
const CB: Record<AimState, number> = { ok: 0x56b4e9, far: 0xf0e442, bad: 0xff5a00, sel: 0xcc79a7 };
/** swaps the aim states' colours (materials pick them up as they are next coloured) */
export function setAimPalette(cb: boolean): void {
  for (const k of Object.keys(COLOR) as AimState[]) COLOR[k].setHex((cb ? CB : STD)[k]);
}
const BOXES = 12, LINES = 48, ARC = 96;

let root: THREE.Group | null = null;
let ring: THREE.Mesh, ringMat: THREE.MeshBasicMaterial, dot: THREE.Mesh;
let boxes: { g: THREE.LineSegments; m: THREE.LineBasicMaterial }[] = [];
let lineGeo: THREE.BufferGeometry, lineMat: THREE.LineBasicMaterial, lineObj: THREE.LineSegments, linePos: Float32Array, lineCol: Float32Array;
let arcGeo: THREE.BufferGeometry, arcMat: THREE.LineDashedMaterial, arcObj: THREE.Line, arcPos: Float32Array;
let halo: THREE.LineSegments, haloMat: THREE.LineBasicMaterial;
let nBox = 0, nLine = 0, ringOn = false, arcOn = false, haloOn = false;
const _q = new THREE.Quaternion(), _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

const overlay = (m: THREE.Material): THREE.Material => {
  m.depthTest = false;
  m.depthWrite = false;
  m.transparent = true;
  m.toneMapped = false;
  (m as THREE.MeshBasicMaterial).fog = false;
  return m;
};

export function initAim(scene: THREE.Scene): void {
  if (root) {
    if (root.parent !== scene) scene.add(root);
    return;
  }
  root = new THREE.Group();
  root.name = 'aim';
  ringMat = overlay(new THREE.MeshBasicMaterial({ color: COLOR.ok, opacity: 0.85, side: THREE.DoubleSide })) as THREE.MeshBasicMaterial;
  ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), ringMat);
  dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), ringMat);
  ring.add(dot);
  ring.renderOrder = 1010;
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  for (let i = 0; i < BOXES; i++) {
    const m = overlay(new THREE.LineBasicMaterial({ color: COLOR.ok, opacity: 0.7 })) as THREE.LineBasicMaterial;
    const g = new THREE.LineSegments(edges, m);
    g.renderOrder = 1009;
    g.frustumCulled = false;
    boxes.push({ g, m });
    root.add(g);
  }
  linePos = new Float32Array(LINES * 6);
  lineCol = new Float32Array(LINES * 6);
  lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
  lineMat = overlay(new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.95 })) as THREE.LineBasicMaterial;
  lineObj = new THREE.LineSegments(lineGeo, lineMat);
  lineObj.frustumCulled = false;
  lineObj.renderOrder = 1011;
  arcPos = new Float32Array(ARC * 3);
  arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3).setUsage(THREE.DynamicDrawUsage));
  arcMat = overlay(new THREE.LineDashedMaterial({ color: COLOR.ok, opacity: 0.6, dashSize: 0.5, gapSize: 0.35 })) as THREE.LineDashedMaterial;
  arcObj = new THREE.Line(arcGeo, arcMat);
  arcObj.frustumCulled = false;
  arcObj.renderOrder = 1008;
  // three great circles: the reach of a blast, readable from any side
  const hp: number[] = [];
  const SEG = 48;
  for (let c = 0; c < 3; c++) for (let i = 0; i < SEG; i++) {
    for (const j of [i, i + 1]) {
      const a = (j / SEG) * Math.PI * 2, u = Math.cos(a), v = Math.sin(a);
      hp.push(...(c === 0 ? [u, 0, v] : c === 1 ? [u, v, 0] : [0, u, v]));
    }
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
  haloMat = overlay(new THREE.LineBasicMaterial({ color: COLOR.far, opacity: 0.35 })) as THREE.LineBasicMaterial;
  halo = new THREE.LineSegments(hg, haloMat);
  halo.frustumCulled = false;
  halo.renderOrder = 1007;
  root.add(ring, lineObj, arcObj, halo);
  scene.add(root);
  aim.end();
}

export const aim = {
  begin(): void {
    nBox = 0; nLine = 0; ringOn = false; arcOn = false; haloOn = false;
  },

  /** wire sphere of radius r: how far a blast from here reaches */
  sphere(center: ArrayLike<number>, r: number, s: AimState, opacity = 0.35): void {
    if (!root) return;
    halo.position.set(center[0], center[1], center[2]);
    halo.scale.setScalar(Math.max(0.05, r));
    haloMat.color.copy(COLOR[s]);
    haloMat.opacity = opacity;
    haloOn = true;
  },

  /** ring of radius `r` lying on the surface at `pos` facing `normal` */
  marker(pos: Vec3, normal: Vec3, r: number, s: AimState): void {
    if (!root) return;
    _n.set(normal[0], normal[1], normal[2]).normalize();
    ring.quaternion.setFromUnitVectors(_z, _n);
    ring.position.set(pos[0] + _n.x * 0.01, pos[1] + _n.y * 0.01, pos[2] + _n.z * 0.01);
    ring.scale.setScalar(Math.max(0.03, r));
    ringMat.color.copy(COLOR[s]);
    ringOn = true;
  },

  /** oriented box outline: centre, rotation, full extents */
  box(center: ArrayLike<number>, rot: ArrayLike<number> | null, size: ArrayLike<number>, s: AimState, opacity = 0.7): void {
    if (!root || nBox >= BOXES) return;
    const b = boxes[nBox++];
    b.g.position.set(center[0], center[1], center[2]);
    if (rot) b.g.quaternion.set(rot[0], rot[1], rot[2], rot[3]); else b.g.quaternion.identity();
    b.g.scale.set(Math.max(size[0], 0.01), Math.max(size[1], 0.01), Math.max(size[2], 0.01));
    b.m.color.copy(COLOR[s]);
    b.m.opacity = opacity;
  },

  line(a: ArrayLike<number>, b: ArrayLike<number>, s: AimState): void {
    if (!root || nLine >= LINES) return;
    const i = nLine++ * 6, c = COLOR[s];
    linePos[i] = a[0]; linePos[i + 1] = a[1]; linePos[i + 2] = a[2];
    linePos[i + 3] = b[0]; linePos[i + 4] = b[1]; linePos[i + 5] = b[2];
    for (let k = 0; k < 2; k++) { lineCol[i + k * 3] = c.r; lineCol[i + k * 3 + 1] = c.g; lineCol[i + k * 3 + 2] = c.b; }
  },

  /** polyline through `pts` (x, y, z triples) */
  arc(pts: ArrayLike<number>, n: number, s: AimState): void {
    if (!root || n < 2) return;
    const m = Math.min(n, ARC);
    for (let i = 0; i < m * 3; i++) arcPos[i] = pts[i];
    arcGeo.setDrawRange(0, m);
    arcGeo.attributes.position.needsUpdate = true;
    arcObj.computeLineDistances();
    arcMat.color.copy(COLOR[s]);
    arcOn = true;
  },

  end(): void {
    if (!root) return;
    ring.visible = ringOn;
    for (let i = 0; i < BOXES; i++) boxes[i].g.visible = i < nBox;
    lineObj.visible = nLine > 0;
    if (nLine > 0) {
      lineGeo.setDrawRange(0, nLine * 2);
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
    }
    arcObj.visible = arcOn;
    halo.visible = haloOn;
  },
};

/** box outline of a rigid body's local bounds: world centre and rotation for aim.box */
export function obb(pos: ArrayLike<number>, rot: ArrayLike<number>, mn: ArrayLike<number>, mx: ArrayLike<number>, outC: Vec3, outR: Quat, outS: Vec3): void {
  _q.set(rot[0], rot[1], rot[2], rot[3]);
  _n.set((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2).applyQuaternion(_q);
  outC[0] = pos[0] + _n.x; outC[1] = pos[1] + _n.y; outC[2] = pos[2] + _n.z;
  outR[0] = rot[0]; outR[1] = rot[1]; outR[2] = rot[2]; outR[3] = rot[3];
  outS[0] = mx[0] - mn[0] + 0.04; outS[1] = mx[1] - mn[1] + 0.04; outS[2] = mx[2] - mn[2] + 0.04;
}
