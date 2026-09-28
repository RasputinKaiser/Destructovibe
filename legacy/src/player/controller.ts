import * as THREE from 'three';
import { RAPIER, world } from '../physics/world';
import { camera } from '../render/gfx';
import { keys, inputActive } from '../core/input';
import { clamp } from '../util';
import { $ } from '../util';

export let playerBody: import('@dimforge/rapier3d-compat').RigidBody;
let playerCollider: import('@dimforge/rapier3d-compat').Collider;

export let yaw = 0;
export let pitch = -0.05;
export let fly = false;

let canJump = false;
let jumpGrace = 0;

export function initPlayer(): void {
  playerBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1.2, 4)
      .lockRotations()
      .setLinearDamping(0.05)
      .setCanSleep(false));
  playerCollider = world.createCollider(
    RAPIER.ColliderDesc.ball(0.45).setMass(75).setFriction(0.1).setRestitution(0), playerBody);
}

export function resetPlayer(): void {
  playerBody.setTranslation({ x: 0, y: 1.2, z: 4 }, true);
  playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  yaw = 0; pitch = -0.05;
  setFly(false);
}

export function applyLook(dx: number, dy: number): void {
  yaw -= dx * 0.0021;
  pitch -= dy * 0.0021;
  pitch = clamp(pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
}

export function setFly(on: boolean): void {
  fly = on;
  playerBody.setGravityScale(on ? 0 : 1, true);
  if (on) {
    const v = playerBody.linvel();
    playerBody.setLinvel({ x: v.x, y: Math.max(v.y, 0.5), z: v.z }, true);
  }
  const pill = $('#flyPill');
  pill.textContent = on ? 'FLY ON' : 'FLY OFF';
  pill.classList.toggle('on', on);
}

export function toggleFly(): void { setFly(!fly); }

export function kickPlayer(point: THREE.Vector3, radius: number): void {
  const p = playerBody.translation();
  const dx = p.x - point.x, dy = p.y - point.y, dz = p.z - point.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d >= radius * 1.4) return;
  const f = 1 - d / (radius * 1.4);
  const inv = d > 0.001 ? 1 / d : 0;
  const v = playerBody.linvel();
  playerBody.setLinvel({
    x: v.x + dx * inv * 10 * f,
    y: v.y + Math.abs(dy * inv) * 6 * f + 2 * f,
    z: v.z + dz * inv * 10 * f,
  }, true);
}

function groundedCheck(): boolean {
  const p = playerBody.translation();
  const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(ray, 0.62, true, undefined, undefined, playerCollider, playerBody);
  return hit !== null;
}

export function updatePlayer(dt: number): void {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  let mx = 0, mz = 0;
  if (inputActive()) {
    if (keys['KeyW']) mz += 1; if (keys['KeyS']) mz -= 1;
    if (keys['KeyD']) mx += 1; if (keys['KeyA']) mx -= 1;
  }
  const move = new THREE.Vector3().addScaledVector(fwd, mz).addScaledVector(right, mx);
  if (move.lengthSq() > 0) move.normalize();

  const grounded = groundedCheck();
  if (grounded) jumpGrace = 0.12; else jumpGrace -= dt;
  canJump = jumpGrace > 0;

  const v = playerBody.linvel();
  if (fly) {
    const spd = 15;
    let vy = 0;
    if (keys['Space']) vy += 1;
    if (keys['KeyC'] || keys['ControlLeft']) vy -= 1;
    playerBody.setLinvel({ x: move.x * spd, y: vy * spd * 0.85, z: move.z * spd }, true);
  } else {
    const spd = keys['ShiftLeft'] ? 9.5 : 5.8;
    const k = grounded ? .22 : .045;
    playerBody.setLinvel({
      x: THREE.MathUtils.lerp(v.x, move.x * spd, k),
      y: v.y,
      z: THREE.MathUtils.lerp(v.z, move.z * spd, k),
    }, true);
    if (keys['Space'] && canJump) {
      playerBody.setLinvel({ x: v.x, y: 6.4, z: v.z }, true);
      jumpGrace = 0;
    }
  }

  // keep in bounds
  const p = playerBody.translation();
  const cx = clamp(p.x, -120, 120), cz = clamp(p.z, -120, 120);
  let cy = p.y;
  if (p.y < 0.46) {
    cy = 0.46;
    const lv = playerBody.linvel();
    if (lv.y < 0) playerBody.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
  }
  if (cx !== p.x || cz !== p.z || cy !== p.y) playerBody.setTranslation({ x: cx, y: cy, z: cz }, true);

  camera.position.set(cx, cy + 1.15, cz);
  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}
