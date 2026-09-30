/* First-person models for bank VI (flamethrower, grenade launcher, recoilless rifle, thermobaric rocket, bunker-buster
   designator, satchel charge), built and animated for the viewmodel overlay. Each is laid out like the others: grip at
   the origin, working end along -Z. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { easing } from 'math/time';
import type { Vec3 } from 'math';
import { flameTex, flashTex, texSet, type SetId } from './textures';

export type ArsenalId = 'flamer' | 'launcher' | 'recoilless' | 'thermobaric' | 'buster' | 'satchel';
export interface ArsenalModel { group: THREE.Group; pos: Vec3; rot: Vec3; muzzle: THREE.Object3D | null; scale: number }

function texMat(set: SetId, color: number, rep: [number, number], metal: boolean, rough = 1): THREE.MeshStandardMaterial {
  const s = texSet(set);
  const c = (t: THREE.Texture): THREE.Texture => { const k = t.clone(); k.repeat.set(rep[0], rep[1]); k.needsUpdate = true; return k; };
  const orm = c(s.orm);
  return new THREE.MeshStandardMaterial({ color, map: c(s.map), normalMap: c(s.normal), roughnessMap: orm, metalnessMap: metal ? orm : null, roughness: rough, metalness: metal ? 1 : 0 });
}
const plain = (color: number, rough: number, metal = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
const alongZ = (g: THREE.BufferGeometry, forward = true): THREE.BufferGeometry => g.rotateX(forward ? -Math.PI / 2 : Math.PI / 2);
const lathe = (pts: number[]): THREE.LatheGeometry => {
  const v: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i += 2) v.push(new THREE.Vector2(pts[i], pts[i + 1]));
  return new THREE.LatheGeometry(v, 28);
};
const glowMat = (hex: number, k: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: hex, emissiveIntensity: k, roughness: 0.4 });
function sprite(map: THREE.Texture, r: number, g: number, b: number): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  m.color.setRGB(r, g, b);
  return new THREE.Sprite(m);
}

let pilot: THREE.Sprite, pilotCore: THREE.Sprite, nozzleGlow: THREE.MeshStandardMaterial;
let glBarrel: THREE.Group, glShell: THREE.Mesh;
let rrVenturi: THREE.Group, tbTube: THREE.Group, desLed: THREE.MeshStandardMaterial, desBtn: THREE.Mesh, desBeam: THREE.Mesh;
let satFlap: THREE.Mesh, satPull: THREE.Group;

export function buildArsenalModels(): Record<ArsenalId, ArsenalModel> {
  const olive = texMat('olive', 0xffffff, [3, 1], true);
  const oliveDark = texMat('olive', 0x8a8f86, [1, 1], true);
  const iron = texMat('gunmetal', 0xffffff, [2, 2], true);
  const wood = texMat('handle', 0xffffff, [1, 2], false);
  const rubber = texMat('rubber', 0xffffff, [1, 2], false);
  const black = plain(0x1c1d20, 0.5, 0.2);
  const bore = plain(0x0c0c0c, 0.9);
  bore.side = THREE.BackSide;
  const polished = plain(0xc9ccd0, 0.22, 1);
  const brass = plain(0xc79a4a, 0.35, 1);
  const yellow = plain(0xd9a21b, 0.45);
  const canvas = new THREE.MeshStandardMaterial({ color: 0x5d5a3c, roughness: 0.95 });
  const webbing = new THREE.MeshStandardMaterial({ color: 0x3f3d2a, roughness: 0.9 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x0d1a26, roughness: 0.05, metalness: 0.9, envMapIntensity: 2 });
  const green = plain(0x49553a, 0.7, 0.1);
  const flare = flashTex();

  // flamethrower gun: fuel tube along -Z with the igniter head at the nozzle, two grips, the fuel hose off the back
  nozzleGlow = glowMat(0xff6a1a, 0);
  pilot = sprite(flameTex(), 2.6, 1.3, 0.45);
  pilot.center.set(0.5, 0.1);
  pilot.position.set(0, -0.012, -0.64);
  pilot.scale.set(0.026, 0.05, 1);
  pilotCore = sprite(flameTex(), 2.2, 2.2, 2.6);
  pilotCore.center.set(0.5, 0.1);
  pilotCore.position.set(0, -0.012, -0.641);
  pilotCore.scale.set(0.01, 0.022, 1);
  const flamer = new THREE.Group();
  const fg1 = mesh(new RoundedBoxGeometry(0.034, 0.11, 0.05, 2, 0.01), wood, 0, -0.075, 0.03);
  fg1.rotation.x = -0.28;
  const fg2 = mesh(new RoundedBoxGeometry(0.03, 0.09, 0.045, 2, 0.01), wood, 0, -0.07, -0.3);
  fg2.rotation.x = 0.15;
  const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.01, 0.1), new THREE.Vector3(0.01, -0.07, 0.2), new THREE.Vector3(0.03, -0.2, 0.26), new THREE.Vector3(0.05, -0.45, 0.24),
  ]), 20, 0.014, 8), rubber);
  flamer.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.02, 0.022, 0.62, 18)), olive, 0, 0, -0.26),
    mesh(alongZ(new THREE.CylinderGeometry(0.034, 0.034, 0.16, 20)), oliveDark, 0, 0, 0.02),
    mesh(alongZ(lathe([0.036, 0, 0.036, 0.01, 0.03, 0.014, 0.03, 0.04])), iron, 0, 0, -0.1),
    mesh(alongZ(new THREE.CylinderGeometry(0.028, 0.028, 0.08, 20)), iron, 0, -0.012, -0.585),
    mesh(alongZ(lathe([0.012, 0, 0.018, 0, 0.022, 0.02, 0.02, 0.05, 0.012, 0.06])), polished, 0, 0, -0.57),
    mesh(alongZ(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 14)), nozzleGlow, 0, 0, -0.632),
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 12), iron, 0, 0.04, -0.03),
    mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 16), black, 0, 0.074, -0.03),
    mesh(new THREE.BoxGeometry(0.006, 0.024, 0.012), black, 0, -0.035, -0.02),
    fg1, fg2, hose, pilot, pilotCore,
  );
  const fMuzzle = new THREE.Object3D();
  fMuzzle.position.set(0, 0, -0.64);
  flamer.add(fMuzzle);

  // 40 mm launcher: short fat barrel that breaks open over the hinge, wooden grip and stock stub, leaf sight
  glBarrel = new THREE.Group();
  glBarrel.position.set(0, 0.01, -0.06);
  glShell = mesh(alongZ(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 18)), brass, 0, 0, 0.02);
  glShell.visible = false;
  glBarrel.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.029, 0.029, 0.32, 24, 1, true)), iron, 0, 0, -0.16),
    mesh(alongZ(new THREE.CylinderGeometry(0.0205, 0.0205, 0.32, 20, 1, true)), bore, 0, 0, -0.16),
    mesh(alongZ(lathe([0.0205, 0, 0.031, 0, 0.031, 0.018, 0.0205, 0.018])), iron, 0, 0, -0.33),
    mesh(new THREE.BoxGeometry(0.004, 0.02, 0.012), black, 0, 0.034, -0.3),
    glShell,
  );
  const launcher = new THREE.Group();
  const lg = mesh(new RoundedBoxGeometry(0.034, 0.12, 0.05, 2, 0.01), wood, 0, -0.08, 0.03);
  lg.rotation.x = -0.3;
  launcher.add(
    glBarrel,
    mesh(new RoundedBoxGeometry(0.05, 0.05, 0.12, 2, 0.01), iron, 0, 0.0, 0.02),
    mesh(new RoundedBoxGeometry(0.04, 0.05, 0.16, 2, 0.012), wood, 0, -0.03, 0.14),
    mesh(new THREE.BoxGeometry(0.03, 0.036, 0.004), black, 0, 0.045, -0.02),
    mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 14, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2), iron, 0, -0.035, -0.02),
    lg,
  );
  const lMuzzle = new THREE.Object3D();
  lMuzzle.position.set(0, 0.01, -0.4);
  launcher.add(lMuzzle);

  // 84 mm recoilless rifle: long tube, flared venturi behind the shoulder, front grip, optical sight on the left
  rrVenturi = new THREE.Group();
  rrVenturi.position.set(0, 0, 0.42);
  rrVenturi.add(
    mesh(alongZ(lathe([0.047, 0, 0.056, 0, 0.07, 0.1, 0.075, 0.16, 0.06, 0.16, 0.047, 0.03]), false), iron, 0, 0, 0),
    mesh(alongZ(new THREE.CylinderGeometry(0.047, 0.066, 0.16, 24, 1, true), false), bore, 0, 0, 0.08),
  );
  const recoilless = new THREE.Group();
  const rg1 = mesh(new RoundedBoxGeometry(0.032, 0.11, 0.05, 2, 0.01), black, 0, -0.1, -0.08);
  rg1.rotation.x = 0.3;
  const rg2 = mesh(new RoundedBoxGeometry(0.03, 0.1, 0.045, 2, 0.01), black, 0, -0.1, -0.42);
  recoilless.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.052, 0.052, 1.0, 28, 1, true)), texMat('gunmetal', 0x70756a, [3, 1], true), 0, 0, -0.08),
    mesh(alongZ(new THREE.CylinderGeometry(0.047, 0.047, 1.0, 24, 1, true)), bore, 0, 0, -0.08),
    mesh(alongZ(lathe([0.047, 0, 0.058, 0, 0.058, 0.03, 0.047, 0.03])), iron, 0, 0, -0.6),
    mesh(new RoundedBoxGeometry(0.03, 0.05, 0.16, 2, 0.008), black, -0.075, 0.035, -0.2),
    mesh(alongZ(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 18)), lens, -0.075, 0.035, -0.281),
    mesh(new RoundedBoxGeometry(0.1, 0.06, 0.14, 2, 0.02), rubber, 0, -0.05, 0.2),
    mesh(new THREE.TorusGeometry(0.057, 0.008, 8, 28), black, 0, 0, -0.3),
    mesh(new THREE.TorusGeometry(0.057, 0.008, 8, 28), black, 0, 0, 0.1),
    rg1, rg2, rrVenturi,
  );
  const rMuzzle = new THREE.Object3D();
  rMuzzle.position.set(0, 0, -0.62);
  recoilless.add(rMuzzle);

  // thermobaric rocket: disposable fat green container, carry handle, flip-up sight; a fresh tube comes up after a shot
  tbTube = new THREE.Group();
  tbTube.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.06, 0.06, 0.92, 28)), green, 0, 0, -0.2),
    mesh(alongZ(new THREE.CylinderGeometry(0.063, 0.063, 0.05, 28)), black, 0, 0, -0.64),
    mesh(alongZ(new THREE.CylinderGeometry(0.063, 0.063, 0.05, 28)), black, 0, 0, 0.24),
    mesh(alongZ(new THREE.CylinderGeometry(0.0605, 0.0605, 0.03, 28, 1, true)), yellow, 0, 0, -0.5),
    mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 16, Math.PI), webbing, 0, 0.062, -0.2),
    mesh(new THREE.BoxGeometry(0.03, 0.035, 0.006), black, -0.02, 0.078, -0.45),
    mesh(new THREE.BoxGeometry(0.02, 0.025, 0.006), black, -0.02, 0.074, -0.02),
  );
  const tg = mesh(new RoundedBoxGeometry(0.032, 0.1, 0.048, 2, 0.01), black, 0, -0.1, -0.05);
  tg.rotation.x = 0.3;
  tbTube.add(tg);
  const thermobaric = new THREE.Group();
  thermobaric.add(tbTube);
  const tMuzzle = new THREE.Object3D();
  tMuzzle.position.set(0, 0, -0.68);
  thermobaric.add(tMuzzle);

  // laser designator: a boxy sight with the laser aperture and a big objective, pistol grip and fire button
  desLed = glowMat(0xff1a0a, 0.3);
  desBtn = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 14), plain(0xb3170f, 0.4), 0, 0.045, 0.03);
  desBeam = mesh(alongZ(new THREE.CylinderGeometry(0.0015, 0.0015, 2, 6)), new THREE.MeshBasicMaterial({ color: 0xff2210, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), 0.028, 0, -1.2);
  desBeam.visible = false;
  const buster = new THREE.Group();
  const dg = mesh(new RoundedBoxGeometry(0.034, 0.1, 0.046, 2, 0.01), rubber, 0, -0.08, 0.04);
  dg.rotation.x = -0.25;
  buster.add(
    mesh(new RoundedBoxGeometry(0.1, 0.07, 0.19, 3, 0.012), oliveDark, 0, 0, -0.05),
    mesh(alongZ(new THREE.CylinderGeometry(0.03, 0.032, 0.05, 24)), black, -0.018, 0.004, -0.16),
    mesh(alongZ(new THREE.CylinderGeometry(0.026, 0.026, 0.004, 24)), lens, -0.018, 0.004, -0.186),
    mesh(alongZ(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 16)), black, 0.028, 0, -0.16),
    mesh(alongZ(new THREE.CylinderGeometry(0.008, 0.008, 0.003, 16)), plain(0x401010, 0.2, 0.3), 0.028, 0, -0.181),
    mesh(new THREE.SphereGeometry(0.004, 10, 8), desLed, 0.035, 0.038, 0.0),
    mesh(alongZ(new THREE.CylinderGeometry(0.014, 0.018, 0.04, 16)), rubber, -0.018, 0.004, 0.06),
    desBtn, dg, desBeam,
  );

  // satchel: canvas bag with the carry strap, a flap and the pull-ring firing device on a length of fuse
  satFlap = mesh(new RoundedBoxGeometry(0.2, 0.012, 0.13, 2, 0.005), canvas, 0, 0.056, -0.01);
  satPull = new THREE.Group();
  satPull.position.set(0.07, 0.05, 0.08);
  satPull.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 10)), plain(0x2f5f2f, 0.6), 0, 0, 0),
    mesh(new THREE.TorusGeometry(0.01, 0.002, 6, 14), polished, 0, 0, 0.032),
  );
  const satchel = new THREE.Group();
  satchel.add(
    mesh(new RoundedBoxGeometry(0.2, 0.1, 0.13, 3, 0.02), canvas, 0, 0, 0),
    satFlap,
    mesh(new THREE.BoxGeometry(0.03, 0.105, 0.135), webbing, -0.05, 0, 0),
    mesh(new THREE.BoxGeometry(0.03, 0.105, 0.135), webbing, 0.05, 0, 0),
    mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 24, Math.PI).rotateY(Math.PI / 2), webbing, 0, 0.05, 0),
    satPull,
  );

  const mk = (group: THREE.Group, pos: Vec3, rot: Vec3, muzzle: THREE.Object3D | null, scale = 1): ArsenalModel => ({ group, pos, rot, muzzle, scale });
  return {
    flamer: mk(flamer, [0.27, -0.22, -0.46], [0.04, -0.05, 0], fMuzzle),
    launcher: mk(launcher, [0.26, -0.21, -0.5], [0.03, -0.04, 0], lMuzzle),
    recoilless: mk(recoilless, [0.3, -0.24, -0.36], [0.02, 0.05, 0.02], rMuzzle, 0.85),
    thermobaric: mk(thermobaric, [0.3, -0.25, -0.4], [0.02, 0.05, 0.02], tMuzzle, 0.85),
    buster: mk(buster, [0.24, -0.2, -0.46], [0.05, -0.12, 0.04], null),
    satchel: mk(satchel, [0.24, -0.23, -0.5], [0.25, -0.35, -0.1], null, 0.9),
  };
}

/** recoil springs' kick for a shot from each (position z/y, rotation x) */
export const ARSENAL_KICK: Record<ArsenalId, [number, number, number]> = {
  flamer: [0.3, 0, 0.6], launcher: [2.6, 0.6, 7], recoilless: [1.8, 0.2, 4], thermobaric: [2, 0.2, 4.5], buster: [0, 0, -0.5], satchel: [-0.6, 0, -2],
};

// [t, rotX, rotZ, posY, posZ]
const BREAK = [[0, 0, 0, 0, 0], [0.18, 0, 0, 0, 0], [0.32, 0.35, -0.1, -0.03, 0.03], [0.62, 0.35, -0.1, -0.03, 0.03], [0.85, 0, 0, 0, 0]];
const LOB = [[0, 0, 0, 0, 0], [0.18, 0.4, 0.1, -0.08, 0.12], [0.34, -0.7, 0, 0.1, -0.3], [0.35, -0.7, 0, -0.35, 0], [0.9, -0.3, 0, -0.35, 0], [1.2, 0, 0, 0, 0]];
const kOut = [0, 0, 0, 0];
function key3(t: number, keys: number[][]): number[] {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i++;
  const k0 = keys[i - 1], k1 = keys[i];
  const u = easing.sineInOut(Math.min(1, Math.max(0, (t - k0[0]) / (k1[0] - k0[0]))));
  for (let c = 0; c < 4; c++) kOut[c] = k0[c + 1] + (k1[c + 1] - k0[c + 1]) * u;
  return kOut;
}

/** Per-frame pose. t: seconds since this tool last fired (large when it has not); hold: firing now (flamer, designator)
 * with its intensity; `lit` the flamer's igniter. Returns an in-hand glow for the overlay's fill light. */
export function animateArsenal(id: ArsenalId, g: THREE.Group, t: number, time: number, hold: { on: boolean; k: number; lit: boolean }, glow: THREE.Color): void {
  switch (id) {
    case 'flamer': {
      const f = 0.85 + 0.15 * Math.sin(time * 37) * Math.sin(time * 17) + (Math.random() - 0.5) * 0.08;
      const lit = hold.lit ? 1 : 0, on = hold.on ? 1 : 0;
      pilot.visible = pilotCore.visible = lit > 0;
      pilot.scale.set(0.026 * (1 + on), 0.05 * f * (1 + 1.5 * on), 1);
      pilotCore.scale.set(0.01 * (1 + on), 0.022 * f * (1 + on), 1);
      nozzleGlow.emissiveIntensity = on * 2.5 * f;
      if (on) {
        // a pressurised stream shoves back and the gun bucks in the hands
        g.position.z += 0.012 + (Math.random() - 0.5) * 0.004;
        g.position.x += (Math.random() - 0.5) * 0.003;
        g.rotation.x += 0.015 + (Math.random() - 0.5) * 0.008;
      }
      glow.setRGB((0.08 * lit + 0.6 * on) * f, (0.035 * lit + 0.25 * on) * f, (0.01 * lit + 0.05 * on) * f);
      return;
    }
    case 'launcher': {
      const r = t < 0.85 ? key3(t, BREAK) : null;
      if (r) { g.rotation.x += r[0]; g.rotation.z += r[1]; g.position.y = r[2]; g.position.z = r[3]; }
      // the barrel drops open on its hinge, the case comes out and a fresh round goes in
      const open = t > 0.18 && t < 0.72 ? Math.sin(((t - 0.18) / 0.54) * Math.PI) : 0;
      glBarrel.rotation.x = -0.55 * open;
      glShell.visible = t > 0.4 && t < 0.62;
      return;
    }
    case 'recoilless': {
      // the breech swings open for the next round, then locks
      const open = t > 0.5 && t < 2.1 ? Math.sin(((t - 0.5) / 1.6) * Math.PI) : 0;
      rrVenturi.rotation.y = 1.1 * easing.sineInOut(Math.min(1, open * 1.4));
      if (t < 2.2) { g.rotation.x += 0.25 * open; g.position.y -= 0.04 * open; }
      return;
    }
    case 'thermobaric': {
      // single shot: the empty tube is dropped and a fresh one is unslung
      const out = t > 0.35 && t < 2.3;
      const k = !out ? 0 : t < 0.8 ? easing.cubicIn((t - 0.35) / 0.45) : t < 1.8 ? 1 : 1 - easing.cubicOut((t - 1.8) / 0.5);
      tbTube.position.y = -0.5 * k;
      tbTube.rotation.x = -0.6 * k;
      return;
    }
    case 'buster': {
      desBtn.position.y = hold.on ? 0.042 : 0.045;
      desLed.emissiveIntensity = hold.on ? (Math.sin(time * 30) > 0 ? 5 : 1) : (time % 1.2) < 0.1 ? 3 : 0.3;
      desBeam.visible = hold.on;
      if (hold.on) glow.setRGB(0.06, 0.005, 0.003);
      return;
    }
    case 'satchel': {
      const thrown = t < 1.2;
      if (thrown) {
        const r = key3(t, LOB);
        g.rotation.x += r[0]; g.rotation.z += r[1]; g.position.y = r[2]; g.position.z = r[3];
      }
      g.visible = !(thrown && t > 0.34 && t < 0.9);
      satPull.position.z = thrown && t < 0.3 ? 0.08 + 0.05 * Math.min(1, t / 0.12) : 0.08;
      satFlap.rotation.x = Math.sin(time * 1.3) * 0.02;
      return;
    }
  }
}
