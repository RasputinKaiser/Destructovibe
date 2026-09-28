import * as THREE from 'three';
import { scene } from './gfx';
import { makeCanvas, boxGeo, mats } from './textures';
import { rand } from '../util';

interface Puff { sprite: THREE.Sprite; vel: THREE.Vector3; life: number; t: number; grow: number }
interface Chip { mesh: THREE.Mesh; vel: THREE.Vector3; ang: THREE.Vector3; life: number; t: number; spark?: boolean }

let puffTex: THREE.CanvasTexture;
const sprites: Puff[] = [];
const chips: Chip[] = [];
let sparkMat: THREE.MeshBasicMaterial;

export function initParticles(): void {
  puffTex = makeCanvas(64, 64, ctx => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.6, 'rgba(255,255,255,.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  });
  sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
}

export function puff(p: { x: number; y: number; z: number }, n: number, color: number, size: number): void {
  for (let i = 0; i < n; i++) {
    const m = new THREE.SpriteMaterial({
      map: puffTex, color, transparent: true,
      opacity: rand(.25, .5), depthWrite: false,
    });
    const s = new THREE.Sprite(m);
    s.position.set(p.x + rand(-.4, .4), p.y + rand(-.2, .5), p.z + rand(-.4, .4));
    const sc = size * rand(.6, 1.4); s.scale.set(sc, sc, 1);
    scene.add(s);
    sprites.push({
      sprite: s, vel: new THREE.Vector3(rand(-.8, .8), rand(.4, 1.6), rand(-.8, .8)),
      life: rand(.8, 1.8), t: 0, grow: rand(1.1, 2.2),
    });
  }
}

export function splinterBurst(p: { x: number; y: number; z: number }, dir: THREE.Vector3, n: number): void {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(boxGeo(rand(.03, .06), rand(.12, .4), rand(.02, .05)), mats.woodRaw);
    m.position.set(p.x, p.y, p.z);
    m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    scene.add(m);
    chips.push({
      mesh: m,
      vel: new THREE.Vector3(dir.x * rand(1, 4) + rand(-3, 3), rand(1, 5), dir.z * rand(1, 4) + rand(-3, 3)),
      ang: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), life: rand(.9, 1.6), t: 0,
    });
  }
}

export function sparkBurst(p: { x: number; y: number; z: number }, n: number): void {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(boxGeo(.03, .03, .12), sparkMat);
    m.position.set(p.x, p.y, p.z);
    scene.add(m);
    chips.push({
      mesh: m, vel: new THREE.Vector3(rand(-6, 6), rand(1, 7), rand(-6, 6)),
      ang: new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)), life: rand(.25, .6), t: 0, spark: true,
    });
  }
}

export function updateParticles(dt: number): void {
  for (let i = sprites.length - 1; i >= 0; i--) {
    const s = sprites[i]; s.t += dt;
    if (s.t >= s.life) {
      scene.remove(s.sprite); s.sprite.material.dispose(); sprites.splice(i, 1); continue;
    }
    s.sprite.position.addScaledVector(s.vel, dt);
    const k = 1 + s.grow * dt; s.sprite.scale.multiplyScalar(k);
    s.sprite.material.opacity *= (1 - dt / s.life * 1.4);
  }
  for (let i = chips.length - 1; i >= 0; i--) {
    const c = chips[i]; c.t += dt;
    if (c.t >= c.life || c.mesh.position.y < 0.02) {
      scene.remove(c.mesh); chips.splice(i, 1); continue;
    }
    c.vel.y -= 9.82 * dt;
    c.mesh.position.addScaledVector(c.vel, dt);
    c.mesh.rotation.x += c.ang.x * dt; c.mesh.rotation.y += c.ang.y * dt; c.mesh.rotation.z += c.ang.z * dt;
  }
}

export function clearParticles(): void {
  for (const s of sprites.splice(0)) { scene.remove(s.sprite); s.sprite.material.dispose(); }
  for (const c of chips.splice(0)) scene.remove(c.mesh);
}
