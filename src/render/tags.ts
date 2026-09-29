/* Floating world-space labels (firing order and delay over each armed charge). Pooled sprites whose canvas is
   redrawn only when the text or colour changes; drawn over everything, constant screen size. */
import * as THREE from 'three';
import type { Vec3 } from '../types';

const MAX = 24;
const W = 160, H = 56;

interface Tag { s: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string }

let root: THREE.Group | null = null;
const pool: Tag[] = [];
let n = 0;

export function initTags(scene: THREE.Scene): void {
  if (root) { if (root.parent !== scene) scene.add(root); return; }
  root = new THREE.Group();
  root.name = 'tags';
  for (let i = 0; i < MAX; i++) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false, sizeAttenuation: false });
    const s = new THREE.Sprite(m);
    s.center.set(0.5, 0);
    s.scale.set(0.15, 0.15 * (H / W), 1);
    s.renderOrder = 1020;
    s.visible = false;
    s.frustumCulled = false;
    root.add(s);
    pool.push({ s, ctx, tex, key: '' });
  }
  scene.add(root);
}

function draw(t: Tag, text: string, sub: string, color: string, hot: boolean): void {
  const key = `${text}|${sub}|${color}|${hot}`;
  if (key === t.key) return;
  t.key = key;
  const g = t.ctx;
  g.clearRect(0, 0, W, H);
  g.fillStyle = hot ? 'rgba(120,16,8,0.88)' : 'rgba(14,16,18,0.82)';
  g.beginPath();
  g.roundRect(3, 3, W - 6, H - 16, 7);
  g.fill();
  g.beginPath();
  g.moveTo(W / 2 - 8, H - 13); g.lineTo(W / 2 + 8, H - 13); g.lineTo(W / 2, H - 3); g.closePath();
  g.fill();
  g.fillStyle = color;
  g.fillRect(3, 3, 7, H - 16);
  g.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textBaseline = 'middle';
  g.fillText(text, 18, (H - 13) / 2 + 1);
  g.fillStyle = 'rgba(235,235,230,0.92)';
  g.font = '600 18px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'right';
  g.fillText(sub, W - 12, (H - 13) / 2 + 1);
  g.textAlign = 'left';
  t.tex.needsUpdate = true;
}

export const tags = {
  begin(): void { n = 0; },
  add(pos: Vec3, text: string, sub: string, color: string, hot = false): void {
    if (!root || n >= MAX) return;
    const t = pool[n++];
    draw(t, text, sub, color, hot);
    t.s.position.set(pos[0], pos[1], pos[2]);
  },
  end(): void {
    for (let i = 0; i < pool.length; i++) pool[i].s.visible = i < n;
  },
};
