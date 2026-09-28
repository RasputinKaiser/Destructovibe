import * as THREE from 'three';
import { scene, camera } from './gfx';
import { $, rand } from '../util';

let expLight: THREE.PointLight;
let expLightT = 0;
let shake = 0;
let hitT: ReturnType<typeof setTimeout> | null = null;

export function initEffects(): void {
  expLight = new THREE.PointLight(0xffb060, 0, 30);
  scene.add(expLight);
}

export function explosionFlash(point: THREE.Vector3, radius: number): void {
  expLight.position.set(point.x, point.y + .5, point.z);
  expLight.intensity = 90;
  expLightT = 0.28;
  const pd = camera.position.distanceTo(point);
  if (pd < radius * 1.4) {
    const f = 1 - pd / (radius * 1.4);
    $('#flash').style.opacity = String(f * 0.45);
    setTimeout(() => { $('#flash').style.opacity = '0'; }, 40);
    addShake(f * 0.65);
  }
}

export function addShake(n: number): void { shake += n; }

export function showHitmark(): void {
  const h = $('#hitmark');
  h.style.opacity = '1';
  if (hitT) clearTimeout(hitT);
  hitT = setTimeout(() => { h.style.opacity = '0'; }, 120);
}

export function updateEffects(dt: number): void {
  if (expLightT > 0) {
    expLightT -= dt;
    expLight.intensity = Math.max(0, expLight.intensity - dt * 380);
  }
  if (shake > 0.001) {
    camera.position.x += rand(-1, 1) * shake * .14;
    camera.position.y += rand(-1, 1) * shake * .14;
    camera.rotation.z += rand(-1, 1) * shake * .02;
    shake *= Math.pow(0.02, dt);
  }
}
