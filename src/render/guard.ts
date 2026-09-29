/* Protected structures, marked in the world: an amber dashed outline of each one's footprint and corners, and
   a "PROTECTED" tag above it that shows through walls, so the briefing's warning has a place on site. A
   structure turns red once it has cost the player a penalty. */
import * as THREE from 'three';
import type { Vec3 } from '../types';

export interface Guarded { label: string; lo: Vec3; hi: Vec3 }

const AMBER = 0xffb020, RED = 0xff4a36;
interface Mark { g: Guarded; group: THREE.Group; line: THREE.LineDashedMaterial; tag: THREE.Sprite; tex: THREE.CanvasTexture; hit: boolean }
let root: THREE.Group | null = null;
let marks: Mark[] = [];
let t = 0;

export function initGuards(scene: THREE.Scene): void {
  root = new THREE.Group();
  root.name = 'guards';
  scene.add(root);
}

function tagTexture(label: string, hit: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(12,12,10,0.72)';
  x.fillRect(0, 18, 512, 92);
  x.fillStyle = hit ? '#ff4a36' : '#ffb020';
  x.fillRect(0, 18, 14, 92);
  x.font = '600 28px system-ui, sans-serif';
  x.fillText(hit ? 'DAMAGED — PENALTY' : 'PROTECTED — DO NOT DAMAGE', 32, 54);
  x.fillStyle = '#f4efe4';
  x.font = '700 38px system-ui, sans-serif';
  x.fillText(label.toUpperCase(), 32, 96, 464);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function setGuards(list: Guarded[]): void {
  clearGuards();
  if (!root) return;
  for (const g of list) {
    const group = new THREE.Group();
    const m = 0.6, y0 = g.lo[1] + 0.06, y1 = g.hi[1];
    const x0 = g.lo[0] - m, x1 = g.hi[0] + m, z0 = g.lo[2] - m, z1 = g.hi[2] + m;
    const p: number[] = [
      x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1, x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
      x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const line = new THREE.LineDashedMaterial({ color: AMBER, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false });
    const segs = new THREE.LineSegments(geo, line);
    segs.computeLineDistances();
    const tex = tagTexture(g.label, false);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false }));
    tag.center.set(0.5, 0);
    tag.position.set((x0 + x1) / 2, y1 + 1.2, (z0 + z1) / 2);
    tag.renderOrder = 20;
    group.add(segs, tag);
    root.add(group);
    marks.push({ g, group, line, tag, tex, hit: false });
  }
}

export function clearGuards(): void {
  for (const k of marks) {
    k.group.removeFromParent();
    k.group.traverse(o => {
      if (o instanceof THREE.LineSegments) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    k.tag.material.dispose();
    k.tex.dispose();
  }
  marks = [];
}

/** the protected structure a penalty landed on (nearest, within a couple of metres of its box) */
export function guardAt(pos: Vec3): Guarded | null {
  let best: Mark | null = null, bd = 2.5;
  for (const k of marks) {
    const { lo, hi } = k.g;
    const dx = Math.max(lo[0] - pos[0], 0, pos[0] - hi[0]), dy = Math.max(lo[1] - pos[1], 0, pos[1] - hi[1]), dz = Math.max(lo[2] - pos[2], 0, pos[2] - hi[2]);
    const d = Math.hypot(dx, dy, dz);
    if (d < bd) { bd = d; best = k; }
  }
  return best ? best.g : null;
}

export function flagGuard(g: Guarded): void {
  const k = marks.find(m => m.g === g);
  if (!k || k.hit) return;
  k.hit = true;
  k.line.color.setHex(RED);
  k.tex.dispose();
  k.tex = tagTexture(g.label, true);
  k.tag.material.map = k.tex;
  k.tag.material.needsUpdate = true;
}

/** tags keep a legible size near and far and fade out right next to the structure; hidden outside play */
export function updateGuards(cam: THREE.Vector3, visible: boolean, dt: number): void {
  if (!root) return;
  root.visible = visible && marks.length > 0;
  if (!root.visible) return;
  t += dt;
  for (const k of marks) {
    const p = k.tag.position, d = Math.max(1, cam.distanceTo(p));
    const s = THREE.MathUtils.clamp(d * 0.075, 1.6, 9);
    k.tag.scale.set(s * 4, s, 1);
    k.tag.material.opacity = THREE.MathUtils.smoothstep(d, 4, 10) * 0.95;
    k.line.opacity = k.hit ? 0.6 + 0.3 * Math.sin(t * 6) : 0.85;
  }
}
