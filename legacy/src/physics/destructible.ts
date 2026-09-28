import * as THREE from 'three';
import { RAPIER, world, eventQueue } from './world';
import { scene } from '../render/gfx';
import { mats, boxGeo, BlockType } from '../render/textures';
import { puff, splinterBurst, sparkBurst } from '../render/particles';
import { sfx } from '../audio/sfx';
import { notifyDestruction, addPenalty, elapsed } from '../sim/scoring';
import { showHitmark, addShake, explosionFlash } from '../render/effects';
import { kickPlayer } from '../player/controller';
import { rand, clamp } from '../util';

export interface Obj {
  mesh: THREE.Mesh;
  body: import('@dimforge/rapier3d-compat').RigidBody;
  collider: import('@dimforge/rapier3d-compat').Collider;
  type: BlockType;
  size: [number, number, number];
  hp: number; hpMax: number;
  cracked: boolean; dents: number;
  dead?: boolean;
  rubbleAge: number; lastHit: number;
  isProtected: boolean;
  counted: boolean;           // contributes to demolition percentage
  segmented: boolean;         // owns a unique (dentable) geometry
  spawn: THREE.Vector3;       // rest position at build time (collapse detection)
}

export const objects: Obj[] = [];
export const byCollider = new Map<number, Obj>();
const MAX_OBJECTS = 700;

export let totalHP = 0;
export let remainHP = 0;
export let lastDestructionAt = 0;
export let protectedHits = 0;

/* weapons module registers projectile contact handling here (avoids an import cycle) */
export type ProjectileContactFn = (colliderHandle: number, point: THREE.Vector3) => void;
let projectileContact: ProjectileContactFn = () => { /* no-op until weapons registers */ };
export function setProjectileContactHandler(fn: ProjectileContactFn): void { projectileContact = fn; }

const density = (t: BlockType): number =>
  t === 'metal' || t === 'barrel' ? 7.8 : t === 'brick' ? 1.9 : 0.65;

function baseHP(type: BlockType, vol: number): number {
  if (type === 'brick') return 9 + vol * 22;
  if (type === 'wood' || type === 'tnt') return 7 + vol * 16;
  if (type === 'metal') return 30 + vol * 46;
  if (type === 'barrel') return 18;
  return 9999; // rubble
}

function threeMat(type: BlockType): THREE.MeshStandardMaterial {
  switch (type) {
    case 'brick': return mats.brick;
    case 'wood': return mats.wood;
    case 'metal': return mats.metal;
    case 'barrel': return mats.barrel;
    case 'tnt': return mats.tnt;
    default: return mats.rubble;
  }
}

export interface BlockOpts {
  rotY?: number;
  quat?: { x: number; y: number; z: number; w: number };
  mat?: THREE.Material;
  hpScale?: number;
  isProtected?: boolean;
}

export function addBlock(
  type: BlockType,
  sx: number, sy: number, sz: number,
  x: number, y: number, z: number,
  opts: BlockOpts = {},
): Obj {
  const segmented = type === 'metal';
  const geom = segmented ? new THREE.BoxGeometry(sx, sy, sz, 3, 3, 3) : boxGeo(sx, sy, sz);
  const mesh = new THREE.Mesh(geom, opts.mat || threeMat(type));
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.02)
    .setAngularDamping(0.05);
  if (opts.rotY) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY);
    desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
  if (opts.quat) desc.setRotation(opts.quat);
  const body = world.createRigidBody(desc);

  const colDesc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
    .setDensity(density(type))
    .setFriction(0.55)
    .setRestitution(0.05);
  if (type !== 'rubble') {
    colDesc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(40);
  }
  const collider = world.createCollider(colDesc, body);

  const vol = sx * sy * sz;
  const hp = baseHP(type, vol) * (opts.hpScale ?? 1);
  const obj: Obj = {
    mesh, body, collider, type, size: [sx, sy, sz],
    hp, hpMax: hp, cracked: false, dents: 0,
    rubbleAge: performance.now(), lastHit: 0,
    isProtected: !!opts.isProtected,
    counted: type !== 'rubble' && !opts.isProtected,
    segmented,
    spawn: new THREE.Vector3(x, y, z),
  };
  byCollider.set(collider.handle, obj);
  objects.push(obj);
  if (obj.counted) totalHP += obj.hpMax;
  syncMesh(obj);
  return obj;
}

function syncMesh(o: Obj): void {
  const p = o.body.translation(), q = o.body.rotation();
  o.mesh.position.set(p.x, p.y, p.z);
  o.mesh.quaternion.set(q.x, q.y, q.z, q.w);
}

export function removeObj(obj: Obj): void {
  // a live counted block leaving the world (knocked off the map) counts as demolished
  if (obj.counted && !obj.dead) remainHP = Math.max(0, remainHP - clamp(obj.hp, 0, obj.hpMax));
  byCollider.delete(obj.collider.handle);
  world.removeRigidBody(obj.body);
  scene.remove(obj.mesh);
  if (obj.segmented) obj.mesh.geometry.dispose();
  const i = objects.indexOf(obj);
  if (i >= 0) objects.splice(i, 1);
}

export function trimRubble(): void {
  if (objects.length <= MAX_OBJECTS) return;
  const rub = objects
    .filter(o => o.type === 'rubble' && o.body.isSleeping())
    .sort((a, b) => a.rubbleAge - b.rubbleAge);
  let need = objects.length - MAX_OBJECTS;
  for (const r of rub) { if (need-- <= 0) break; removeObj(r); }
}

export function clearSite(): void {
  for (const o of objects.slice()) removeObj(o);
  totalHP = 0; remainHP = 0; protectedHits = 0; lastDestructionAt = 0;
}

export function siteBuilt(): void {
  remainHP = totalHP;
  lastDestructionAt = 0;
  protectedHits = 0;
  for (const o of objects) o.body.sleep();  // keep freshly built stacks crisp
}

export function destroyedFraction(): number {
  return totalHP > 0 ? 1 - remainHP / totalHP : 0;
}

/* ---------------- impact events → damage ---------------- */
interface ImpactEvent { c1: number; c2: number; dir: THREE.Vector3 }
const _pending: ImpactEvent[] = [];

export function processImpacts(): void {
  _pending.length = 0;
  eventQueue.drainContactForceEvents(ev => {
    const d = ev.maxForceDirection();
    _pending.push({ c1: ev.collider1(), c2: ev.collider2(), dir: new THREE.Vector3(d.x, d.y, d.z) });
  });
  for (const e of _pending) {
    const point = contactPoint(e.c1, e.c2);
    handleSide(e.c1, e.c2, e.dir, point);
    handleSide(e.c2, e.c1, e.dir, point);
    projectileContact(e.c1, point);
    projectileContact(e.c2, point);
  }
}

function contactPoint(h1: number, h2: number): THREE.Vector3 {
  const col1 = world.getCollider(h1), col2 = world.getCollider(h2);
  const p = new THREE.Vector3();
  if (!col1 || !col2) return p;
  let found = false;
  try {
    world.contactPair(col1, col2, (manifold) => {
      if (!found && manifold.numSolverContacts() > 0) {
        const sp = manifold.solverContactPoint(0);
        if (sp) { p.set(sp.x, sp.y, sp.z); found = true; }
      }
    });
  } catch { /* fall through to midpoint */ }
  if (!found) {
    const t1 = col1.translation(), t2 = col2.translation();
    p.set((t1.x + t2.x) / 2, (t1.y + t2.y) / 2, (t1.z + t2.z) / 2);
  }
  return p;
}

function handleSide(target: number, otherH: number, dir: THREE.Vector3, point: THREE.Vector3): void {
  const obj = byCollider.get(target);
  if (!obj || obj.dead || obj.type === 'rubble') return;
  const now = performance.now();
  if (now - obj.lastHit < 60) return;

  const otherCol = world.getCollider(otherH);
  const selfCol = world.getCollider(target);
  if (!selfCol) return;
  const otherBody = otherCol?.parent() ?? null;
  const selfBody = obj.body;

  const sv = selfBody.linvel();
  const ov = otherBody ? otherBody.linvel() : { x: 0, y: 0, z: 0 };
  const relx = ov.x - sv.x, rely = ov.y - sv.y, relz = ov.z - sv.z;
  const impact = Math.abs(relx * dir.x + rely * dir.y + relz * dir.z);
  if (impact < 2.2) return;
  obj.lastHit = now;

  const otherMass = otherBody && otherBody.mass() > 0
    ? Math.min(otherBody.mass(), 40)
    : Math.min(selfBody.mass(), 20);
  let dmg = impact * (0.35 + otherMass * 0.12);
  const proj = otherCol ? projKind(otherCol.handle) : null;
  if (proj === 'ball') dmg *= 1.6; // dense iron hurts
  if (dmg < 1.5) return;

  const d = impactDirBetween(otherBody, obj);
  applyDamage(obj, dmg, point, d);
  if (dmg > 4) sfx.thud(clamp(dmg / 30, 0.1, 0.8), obj.type);
}

/* weapons registers a kind lookup so cannonballs get their bonus */
let projKind: (h: number) => string | null = () => null;
export function setProjKindLookup(fn: (h: number) => string | null): void { projKind = fn; }

function impactDirBetween(fromBody: import('@dimforge/rapier3d-compat').RigidBody | null, obj: Obj): THREE.Vector3 {
  const p = obj.body.translation();
  if (!fromBody) return new THREE.Vector3(0, -1, 0);
  const f = fromBody.translation();
  const d = new THREE.Vector3(p.x - f.x, p.y - f.y, p.z - f.z);
  return d.lengthSq() > 0.0001 ? d.normalize() : new THREE.Vector3(0, -1, 0);
}

/* ---------------- damage model ---------------- */
export function applyDamage(obj: Obj, dmg: number, point: THREE.Vector3, dir: THREE.Vector3): void {
  if (obj.dead || obj.type === 'rubble') return;
  const prev = clamp(obj.hp, 0, obj.hpMax);
  obj.hp -= dmg;
  if (obj.counted) remainHP = Math.max(0, remainHP - (prev - clamp(obj.hp, 0, obj.hpMax)));
  if (obj.isProtected) {
    protectedHits++;
    addPenalty(Math.round(dmg * 2));
  }

  if (obj.type === 'brick') {
    if (!obj.cracked && obj.hp < obj.hpMax * 0.55) {
      obj.cracked = true;
      obj.mesh.material = mats.brickCr;
      notifyDestruction(10, false);
      puff(point, 3, 0x8f7a6a, .35);
    }
    if (obj.hp <= 0) fractureBrick(obj, dir);
  } else if (obj.type === 'wood') {
    if (obj.hp <= 0) snapWood(obj, point, dir);
    else if (dmg > 5) splinterBurst(point, dir, 4);
  } else if (obj.type === 'metal') {
    if (dmg > 6) {
      dentMetal(obj, point, dir, clamp(dmg / 40, 0.06, 0.22));
      if (obj.dents === 1) notifyDestruction(15, false);
      sfx.clang(clamp(dmg / 40, .15, .7));
    }
    if (obj.hp <= 0) shearMetal(obj, point, dir);
  } else if (obj.type === 'barrel' || obj.type === 'tnt') {
    if (obj.hp <= 0) detonateVolatile(obj);
  }
}

function markDestroyed(obj: Obj, points: number): void {
  obj.dead = true;
  lastDestructionAt = elapsed;
  if (obj.isProtected) addPenalty(250);
  else notifyDestruction(points, true);
  showHitmark();
}

/* --- brick: shatter into rubble shards --- */
function fractureBrick(obj: Obj, dir: THREE.Vector3): void {
  if (obj.dead) return;
  markDestroyed(obj, 25);
  const [sx, sy, sz] = obj.size;
  const p = obj.body.translation();
  const q = obj.body.rotation();
  const v = obj.body.linvel();
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  removeObj(obj);
  const splits = [Math.random() < .6 ? 2 : 1, sy > 0.3 ? 2 : 1, Math.random() < .6 ? 2 : 1];
  if (splits[0] + splits[1] + splits[2] < 4) splits[0] = 2;
  for (let ix = 0; ix < splits[0]; ix++) for (let iy = 0; iy < splits[1]; iy++) for (let iz = 0; iz < splits[2]; iz++) {
    const ssx = sx / splits[0] * rand(.75, 1), ssy = sy / splits[1] * rand(.75, 1), ssz = sz / splits[2] * rand(.75, 1);
    if (Math.min(ssx, ssy, ssz) < 0.07) continue;
    const local = new THREE.Vector3(
      (ix + .5) / splits[0] * sx - sx / 2, (iy + .5) / splits[1] * sy - sy / 2, (iz + .5) / splits[2] * sz - sz / 2);
    local.applyQuaternion(quat);
    const shard = addBlock('rubble', ssx, ssy, ssz, p.x + local.x, p.y + local.y, p.z + local.z,
      { quat: q, mat: mats.rubble });
    shard.body.setLinvel({
      x: v.x + dir.x * rand(1, 4) + rand(-2, 2),
      y: v.y + rand(0, 3),
      z: v.z + dir.z * rand(1, 4) + rand(-2, 2),
    }, true);
    shard.body.setAngvel({ x: rand(-6, 6), y: rand(-6, 6), z: rand(-6, 6) }, true);
  }
  puff(p, 8, 0x9a6a52, .8);
  sfx.crumble();
  trimRubble();
}

/* --- wood: snap into halves + splinters --- */
function snapWood(obj: Obj, point: THREE.Vector3, dir: THREE.Vector3): void {
  if (obj.dead) return;
  markDestroyed(obj, 30);
  const [sx, sy, sz] = obj.size;
  const p = obj.body.translation(), q = obj.body.rotation(), v = obj.body.linvel();
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  removeObj(obj);
  const axis = sx >= sy && sx >= sz ? 0 : (sy >= sz ? 1 : 2);
  const len = [sx, sy, sz][axis];
  const pieces = len > 1.6 ? 3 : 2;
  for (let i = 0; i < pieces; i++) {
    const plen = len / pieces * rand(.7, .95);
    const size: number[] = [sx, sy, sz]; size[axis] = plen;
    const off = new THREE.Vector3();
    const t = ((i + .5) / pieces - .5) * len;
    if (axis === 0) off.x = t; else if (axis === 1) off.y = t; else off.z = t;
    off.applyQuaternion(quat);
    const piece = addBlock('rubble', size[0], size[1], size[2], p.x + off.x, p.y + off.y, p.z + off.z,
      { quat: q, mat: Math.random() < .5 ? mats.woodRaw : mats.wood });
    piece.body.setLinvel({
      x: v.x + dir.x * rand(1, 3) + rand(-1.5, 1.5),
      y: v.y + rand(.5, 2.5),
      z: v.z + dir.z * rand(1, 3) + rand(-1.5, 1.5),
    }, true);
    piece.body.setAngvel({ x: rand(-8, 8), y: rand(-8, 8), z: rand(-8, 8) }, true);
  }
  splinterBurst(point, dir, 10);
  sfx.snap();
  trimRubble();
}

/* --- metal: dent geometry, eventually shear --- */
const _v3 = new THREE.Vector3(), _v3b = new THREE.Vector3();
function dentMetal(obj: Obj, point: THREE.Vector3, dir: THREE.Vector3, depth: number): void {
  obj.dents++;
  if (obj.dents === 2) obj.mesh.material = mats.metalHit;
  const g = obj.mesh.geometry as THREE.BufferGeometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  obj.mesh.updateMatrixWorld();
  const local = obj.mesh.worldToLocal(_v3.copy(point));
  const ldir = _v3b.copy(dir).applyQuaternion(obj.mesh.quaternion.clone().invert()).normalize();
  const R = Math.max(...obj.size) * 0.45;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - local.x, dy = pos.getY(i) - local.y, dz = pos.getZ(i) - local.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < R) {
      const f = 1 - d / R; const push = depth * f * f;
      pos.setXYZ(i, pos.getX(i) + ldir.x * push, pos.getY(i) + ldir.y * push, pos.getZ(i) + ldir.z * push);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  sparkBurst(point, 6);
}

function shearMetal(obj: Obj, point: THREE.Vector3, dir: THREE.Vector3): void {
  if (obj.dead) return;
  markDestroyed(obj, 80);
  const [sx, sy, sz] = obj.size;
  const p = obj.body.translation(), q = obj.body.rotation(), v = obj.body.linvel();
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  removeObj(obj);
  const axis = sx >= sy && sx >= sz ? 0 : (sy >= sz ? 1 : 2);
  const len = [sx, sy, sz][axis];
  for (let i = 0; i < 2; i++) {
    const size: number[] = [sx, sy, sz]; size[axis] = len * rand(.4, .55);
    const off = new THREE.Vector3(); const t = (i - .5) * len * .5;
    if (axis === 0) off.x = t; else if (axis === 1) off.y = t; else off.z = t;
    off.applyQuaternion(quat);
    const piece = addBlock('rubble', size[0], size[1], size[2], p.x + off.x, p.y + off.y, p.z + off.z,
      { quat: q, mat: mats.metalHit });
    piece.mesh.rotation.z += rand(-.15, .15); // bent look
    piece.body.setLinvel({
      x: v.x + dir.x * rand(2, 5), y: v.y + rand(1, 3), z: v.z + dir.z * rand(2, 5),
    }, true);
    piece.body.setAngvel({ x: rand(-5, 5), y: rand(-5, 5), z: rand(-5, 5) }, true);
  }
  sparkBurst(point, 18); puff(point, 5, 0x8a8f94, .5);
  sfx.shear();
  trimRubble();
}

/* --- barrels & TNT: chain-reaction explosives --- */
function detonateVolatile(obj: Obj): void {
  if (obj.dead) return;
  const isTnt = obj.type === 'tnt';
  markDestroyed(obj, isTnt ? 50 : 40);
  const p = obj.body.translation();
  const point = new THREE.Vector3(p.x, p.y, p.z);
  removeObj(obj);
  explode(point, isTnt ? 6.5 : 4.8, isTnt ? 16 : 11, isTnt ? 38 : 26);
}

/* ---------------- explosions ---------------- */
export function explode(point: THREE.Vector3, radius: number, power: number, dmgBase: number): void {
  for (const o of objects.slice()) {
    if (o.dead) continue;
    const b = o.body;
    const bp = b.translation();
    const dx = bp.x - point.x, dy = bp.y - point.y, dz = bp.z - point.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > radius) continue;
    const f = 1 - d / radius;
    const inv = d > 0.001 ? 1 / d : 0;
    b.wakeUp();
    b.applyImpulse({
      x: dx * inv * power * f,
      y: (dy * inv * .6 + .55) * power * f,
      z: dz * inv * power * f,
    }, true);
    if (o.type !== 'rubble') {
      applyDamage(o, dmgBase * f * f + dmgBase * f * 0.3,
        new THREE.Vector3(bp.x, bp.y, bp.z),
        new THREE.Vector3(dx, dy, dz).normalize());
    }
  }
  kickPlayer(point, radius);
  explosionFlash(point, radius);
  puff(point, 14, 0x3a352f, radius * .28);
  puff(point, 8, 0xffa440, radius * .14);
  sparkBurst(point, 14);
  sfx.boom(clamp(power / 22, .4, 1));
  addShake(0.18);
}

/* ---------------- per-frame sync ---------------- */
export function syncDestructibles(): void {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!o.body.isSleeping()) {
      syncMesh(o);
    } else if (o.counted && !o.dead) {
      // came to rest displaced, dropped, or toppled → that part of the
      // structure has collapsed, which is what a demolition pays for
      const p = o.body.translation();
      const dx = p.x - o.spawn.x, dy = p.y - o.spawn.y, dz = p.z - o.spawn.z;
      const q = o.body.rotation();
      // local up-axis Y component: |1 - 2(qx² + qz²)|; < .55 ≈ tipped > ~55°
      const upY = Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
      if (dx * dx + dz * dz > 1.6 * 1.6 || -dy > 0.8 || upY < 0.55) {
        o.counted = false;
        remainHP = Math.max(0, remainHP - clamp(o.hp, 0, o.hpMax));
        lastDestructionAt = elapsed;
        notifyDestruction(6, true);
      }
    }
    if (o.body.translation().y < -25) removeObj(o);
  }
}
