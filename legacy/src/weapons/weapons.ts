import * as THREE from 'three';
import { RAPIER, world } from '../physics/world';
import { scene, camera } from '../render/gfx';
import { mats } from '../render/textures';
import { explode, setProjKindLookup, setProjectileContactHandler } from '../physics/destructible';
import { playerBody } from '../player/controller';
import { puff } from '../render/particles';
import { sfx } from '../audio/sfx';
import { addShake } from '../render/effects';
import { rand } from '../util';

export type WeaponKind = 'ball' | 'nade' | 'rocket' | 'c4';

interface Projectile {
  mesh: THREE.Object3D;
  body: import('@dimforge/rapier3d-compat').RigidBody;
  collider: import('@dimforge/rapier3d-compat').Collider;
  kind: WeaponKind;
  born: number;
  fuse?: number;
  trailT?: number;
  stuck?: boolean;
  dead?: boolean;
}

export const WEAPONS: { kind: WeaponKind; cd: number }[] = [
  { kind: 'ball', cd: 0.55 },
  { kind: 'nade', cd: 0.85 },
  { kind: 'rocket', cd: 1.15 },
  { kind: 'c4', cd: 0.7 },
];

export const projectiles: Projectile[] = [];
const byCollider = new Map<number, Projectile>();
const lastFired = [-9, -9, -9, -9];
export let curWeapon = 0;
export let ammo: number[] = [Infinity, Infinity, Infinity, Infinity];
const MAX_C4 = 6;
let wtime = 0; // game-time clock so cooldowns/fuses freeze while paused

export function initWeapons(): void {
  setProjKindLookup(h => byCollider.get(h)?.kind ?? null);
  setProjectileContactHandler((h) => {
    const p = byCollider.get(h);
    if (!p || p.dead) return;
    if (p.kind === 'rocket') {
      p.dead = true;
      const t = p.body.translation();
      const pos = new THREE.Vector3(t.x, t.y, t.z);
      removeProj(p);
      explode(pos, 5.2, 14, 34);
    } else if (p.kind === 'c4' && !p.stuck) {
      p.stuck = true;
      p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      sfx.beep(660, 0.06, 0.15);
    }
  });
}

export function setLoadout(counts: number[]): void {
  ammo = counts.map(c => (c < 0 ? Infinity : c));
  lastFired.fill(-9);
  wtime = 0;
}

export function selectWeapon(i: number): void {
  curWeapon = i;
  document.querySelectorAll('.wcard').forEach((c, j) => c.classList.toggle('sel', j === i));
}

export function cycleWeapon(dirn: number): void {
  selectWeapon((curWeapon + (dirn > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length);
}

export function cooldownFrac(i: number): number {
  return Math.min(1, (wtime - lastFired[i]) / WEAPONS[i].cd);
}

export function totalAmmoLeft(): number {
  return ammo.reduce((s, a) => s + (isFinite(a) ? a : 1e9), 0);
}

export function liveOrdnance(): number {
  return projectiles.length;
}

function aimDir(): THREE.Vector3 {
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  return d;
}

export function fireWeapon(): boolean {
  const i = curWeapon;
  const t = wtime;
  if (t - lastFired[i] < WEAPONS[i].cd) return false;
  if (ammo[i] <= 0) { sfx.beep(220, 0.09, 0.12); return false; }
  if (WEAPONS[i].kind === 'c4' && placedC4().length >= MAX_C4) { sfx.beep(220, 0.09, 0.12); return false; }
  lastFired[i] = t;
  if (isFinite(ammo[i])) ammo[i]--;

  const dir = aimDir();
  const origin = new THREE.Vector3().copy(camera.position).addScaledVector(dir, 1.0);
  const kind = WEAPONS[i].kind;
  if (kind === 'ball') spawnBall(origin, dir);
  else if (kind === 'nade') spawnNade(origin, dir);
  else if (kind === 'rocket') spawnRocket(origin, dir);
  else spawnC4(origin, dir);
  sfx.fire(kind === 'rocket' ? 'rocket' : 'throw');
  addShake(0.06);
  return true;
}

function makeProjBody(o: THREE.Vector3, r: number, mass: number): {
  body: import('@dimforge/rapier3d-compat').RigidBody;
  collider: import('@dimforge/rapier3d-compat').Collider;
} {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(o.x, o.y, o.z).setCcdEnabled(true));
  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(r).setMass(mass).setFriction(0.4).setRestitution(0.15)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(10), body);
  return { body, collider };
}

function track(p: Projectile): void {
  byCollider.set(p.collider.handle, p);
  projectiles.push(p);
}

function spawnBall(o: THREE.Vector3, dir: THREE.Vector3): void {
  const r = 0.26;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mats.ball);
  mesh.castShadow = true; scene.add(mesh);
  const { body, collider } = makeProjBody(o, r, 18);
  body.setLinvel({ x: dir.x * 40, y: dir.y * 40, z: dir.z * 40 }, true);
  body.setAngvel({ x: rand(-8, 8), y: rand(-8, 8), z: rand(-8, 8) }, true);
  track({ mesh, body, collider, kind: 'ball', born: wtime });
}

function spawnRocket(o: THREE.Vector3, dir: THREE.Vector3): void {
  const grp = new THREE.Group();
  const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 10), mats.rocket);
  bodyM.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 10), mats.metal);
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.36;
  grp.add(bodyM, tip); scene.add(grp);
  const { body, collider } = makeProjBody(o, 0.14, 3);
  body.setLinvel({ x: dir.x * 55, y: dir.y * 55, z: dir.z * 55 }, true);
  body.setGravityScale(0.25, true);
  track({ mesh: grp, body, collider, kind: 'rocket', born: wtime, trailT: 0 });
}

function spawnNade(o: THREE.Vector3, dir: THREE.Vector3): void {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), mats.nade);
  mesh.castShadow = true; scene.add(mesh);
  const { body, collider } = makeProjBody(o, 0.14, 1.1);
  const pv = playerBody.linvel();
  body.setLinvel({ x: dir.x * 21 + pv.x * .4, y: dir.y * 21 + 5, z: dir.z * 21 + pv.z * .4 }, true);
  body.setAngvel({ x: rand(-10, 10), y: rand(-10, 10), z: rand(-10, 10) }, true);
  track({ mesh, body, collider, kind: 'nade', born: wtime, fuse: 2.2 });
}

function spawnC4(o: THREE.Vector3, dir: THREE.Vector3): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.22), mats.c4);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  led.position.y = 0.075;
  mesh.add(led);
  mesh.castShadow = true; scene.add(mesh);
  const { body, collider } = makeProjBody(o, 0.15, 1.5);
  const pv = playerBody.linvel();
  body.setLinvel({ x: dir.x * 18 + pv.x * .4, y: dir.y * 18 + 3, z: dir.z * 18 + pv.z * .4 }, true);
  track({ mesh, body, collider, kind: 'c4', born: wtime });
}

export function placedC4(): Projectile[] {
  return projectiles.filter(p => p.kind === 'c4');
}

export function detonateC4(): boolean {
  const charges = placedC4();
  if (!charges.length) return false;
  for (const p of charges) {
    if (p.dead) continue;
    p.dead = true;
    const t = p.body.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    removeProj(p);
    explode(pos, 5.8, 15, 40);
  }
  return true;
}

function removeProj(p: Projectile): void {
  byCollider.delete(p.collider.handle);
  world.removeRigidBody(p.body);
  scene.remove(p.mesh);
  const i = projectiles.indexOf(p);
  if (i >= 0) projectiles.splice(i, 1);
}

export function clearProjectiles(): void {
  for (const p of projectiles.slice()) removeProj(p);
}

const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, 1);
export function updateProjectiles(dt: number): void {
  wtime += dt;
  const t = wtime;
  for (const p of projectiles.slice()) {
    const bp = p.body.translation();
    p.mesh.position.set(bp.x, bp.y, bp.z);
    if (p.kind === 'rocket') {
      const v = p.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > 1) {
        _dir.set(v.x, v.y, v.z).normalize();
        p.mesh.quaternion.setFromUnitVectors(_fwd, _dir);
      }
      p.trailT = (p.trailT ?? 0) + dt;
      if (p.trailT > 0.028) { p.trailT = 0; puff(bp, 1, 0xcfcfcf, .22); }
    } else {
      const q = p.body.rotation();
      p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    if (p.kind === 'nade' && p.fuse !== undefined) {
      p.fuse -= dt;
      if (p.fuse <= 0) {
        const pos = new THREE.Vector3(bp.x, bp.y, bp.z);
        removeProj(p);
        explode(pos, 4.4, 11, 26);
        continue;
      }
    }
    const maxAge = p.kind === 'c4' ? 999 : 10;
    if (t - p.born > maxAge || bp.y < -30) removeProj(p);
  }
}
