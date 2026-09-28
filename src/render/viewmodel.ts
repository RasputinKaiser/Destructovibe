/* First-person weapon overlay: its own scene + camera, drawn after the world with depth cleared.
   Lights mirror the world preset but are re-expressed in camera space every frame (syncViewmodel),
   and the environment map is counter-rotated so reflections match what the player is facing. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Vec3 } from 'math';
import { easing, spring, spring3 } from 'math/time';
import type { WeaponId } from '../types';
import { flameTex, flashTex, hazardTex, texSet, type SetId } from './textures';
import { flashAtCamera, lighting } from './shared';

interface Model {
  group: THREE.Group;
  pos: Vec3;
  rot: Vec3;
  muzzle: THREE.Object3D | null;
}

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera;
let rig: THREE.Group;
let models: Record<WeaponId, Model>;
let key: THREE.DirectionalLight, fill: THREE.DirectionalLight, flashL: THREE.DirectionalLight, hemi: THREE.HemisphereLight;
let flashFx: THREE.Group;
let rocketTip: THREE.Group, detButton: THREE.Mesh, ledMat: THREE.MeshStandardMaterial, beaconLed: THREE.MeshStandardMaterial;
let thermTip: THREE.MeshStandardMaterial, thermGlow: THREE.Sprite, cutLed: THREE.MeshStandardMaterial;
let wreckStick: THREE.Group, wreckLed: THREE.MeshStandardMaterial, winchDrum: THREE.Group, winchHook: THREE.Group;
let prongs: THREE.Group[] = [], gravCore: THREE.MeshStandardMaterial, gravGlow: THREE.Sprite;
let flame: THREE.Sprite, flameCore: THREE.Sprite;
let megaCover: THREE.Group, megaButton: THREE.Mesh, megaLed: THREE.MeshStandardMaterial;
let gripping = false, drumSpin = 0;
let grDisc: THREE.Group, grDiscMat: THREE.MeshStandardMaterial, sawChain: THREE.Group, drillBit: THREE.Group;
let jawA: THREE.Group, jawB: THREE.Group, plasmaGlow: THREE.Sprite, plasmaTip: THREE.MeshStandardMaterial;
let torchFlame: THREE.Sprite, torchCore: THREE.Sprite;
let planBtn: THREE.Mesh, planLed: THREE.MeshStandardMaterial, planScreen: THREE.MeshStandardMaterial;
let excStickL: THREE.Group, excStickR: THREE.Group, excLed: THREE.MeshStandardMaterial;
let brkChisel: THREE.Group, hoseTip: THREE.Group, splitWedge: THREE.Group, wireBtn: THREE.Mesh, wireLed: THREE.MeshStandardMaterial;
const work = { on: false, load: 0, heat: 0, close: 0, lit: false, spin: 0, chain: 0 };
/** hammer wind-up 0..1 and the bank IV tools' running state */
const hold = { wind: 0, on: false, k: 0, run: 0 };
const PRONG_OPEN = 0.3, PRONG_SHUT = -0.1, HOOK_Z = -0.25;
const gripK = spring.create(0), prongK = spring.create(PRONG_OPEN);
/** in-hand glow (flame, igniter, core) added to the camera-facing fill light, so no light is ever added */
const vmGlow = new THREE.Color(), fillBase = new THREE.Color();
let visible = true;
let litVersion = -1;

let current: WeaponId = 'hammer', target: WeaponId = 'hammer';
let swapping = false, swapT = 1;
let fireT = 99, firedWith: WeaponId = 'hammer', flashT = 99;
let time = 0, bobPhase = 0, airTime = 0, wasGrounded = true;
const bobAmp = spring.create(0), sprintK = spring.create(0);
const kickP = spring3.create(), kickR = spring3.create(), sway = spring3.create();
const ZERO: Vec3 = [0, 0, 0];
const LOOK_RAD = 0.0022;
const swayTarget: Vec3 = [0, 0, 0];
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

/* ---------------- materials ---------------- */

function texMat(set: SetId, color: number, rep: [number, number], metal: boolean, rough = 1): THREE.MeshStandardMaterial {
  const s = texSet(set);
  const c = (t: THREE.Texture): THREE.Texture => {
    const k = t.clone();
    k.repeat.set(rep[0], rep[1]);
    k.needsUpdate = true;
    return k;
  };
  const orm = c(s.orm);
  return new THREE.MeshStandardMaterial({
    color, map: c(s.map), normalMap: c(s.normal), roughnessMap: orm, metalnessMap: metal ? orm : null,
    roughness: rough, metalness: metal ? 1 : 0,
  });
}

const plain = (color: number, rough: number, metal = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

const lathe = (pts: number[]): THREE.LatheGeometry => {
  const v: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i += 2) v.push(new THREE.Vector2(pts[i], pts[i + 1]));
  return new THREE.LatheGeometry(v, 28);
};
const alongZ = (g: THREE.BufferGeometry, forward = true): THREE.BufferGeometry => g.rotateX(forward ? -Math.PI / 2 : Math.PI / 2);

/* ---------------- models ---------------- */

function buildModels(): Record<WeaponId, Model> {
  const wood = texMat('handle', 0xffffff, [1, 3], false);
  const rubber = texMat('rubber', 0xffffff, [1, 2], false);
  const iron = texMat('gunmetal', 0xffffff, [2, 2], true);
  const steelHead = texMat('gunmetal', 0xb4bac2, [1, 1], true, 0.8);
  const polished = plain(0xc9ccd0, 0.22, 1);
  const brass = texMat('gunmetal', 0xe0b25a, [2, 2], true, 0.7);
  const oliveM = texMat('olive', 0xffffff, [3, 1], true);
  const oliveDark = texMat('olive', 0x8a8f86, [1, 1], true);
  const black = plain(0x1c1d20, 0.5, 0.2);
  const bore = plain(0x0c0c0c, 0.9);
  bore.side = THREE.BackSide;
  const yellow = plain(0xd9a21b, 0.45);
  const red = plain(0xb3170f, 0.4, 0.05);
  const cream = plain(0xe5dfcc, 0.7);
  const copper = plain(0xc0773f, 0.3, 1);
  const lens = new THREE.MeshStandardMaterial({ color: 0x0d1a26, roughness: 0.05, metalness: 0.9, envMapIntensity: 2 });
  ledMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a0a, emissiveIntensity: 0, roughness: 0.3 });
  beaconLed = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2a10, emissiveIntensity: 0, roughness: 0.3 });

  // sledgehammer: grip at origin, handle along +Y
  const hammer = new THREE.Group();
  hammer.add(
    mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.84, 14), wood, 0, 0.34, 0),
    mesh(new THREE.CylinderGeometry(0.025, 0.024, 0.2, 18), rubber, 0, 0, 0),
    mesh(new THREE.CylinderGeometry(0.029, 0.026, 0.028, 18), rubber, 0, -0.112, 0),
    mesh(new RoundedBoxGeometry(0.052, 0.034, 0.052, 2, 0.006), steelHead, 0, 0.69, 0),
    mesh(new RoundedBoxGeometry(0.09, 0.09, 0.24, 3, 0.012), steelHead, 0, 0.745, 0),
    mesh(alongZ(new THREE.CylinderGeometry(0.047, 0.047, 0.018, 24)), polished, 0, 0.745, 0.126),
    mesh(alongZ(new THREE.CylinderGeometry(0.047, 0.047, 0.018, 24)), polished, 0, 0.745, -0.126),
  );

  // hand cannon: barrel along -Z
  const cannon = new THREE.Group();
  const barrel = alongZ(lathe([0, 0, 0.05, 0, 0.058, 0.012, 0.06, 0.05, 0.055, 0.1, 0.049, 0.14, 0.046, 0.42, 0.048, 0.47, 0.056, 0.49, 0.057, 0.52, 0.032, 0.52, 0.03, 0.46]));
  cannon.add(mesh(barrel, iron));
  for (const [z, r] of [[-0.13, 0.05], [-0.3, 0.048], [-0.455, 0.049]]) cannon.add(mesh(new THREE.TorusGeometry(r, 0.0065, 8, 28), brass, 0, 0, z));
  cannon.add(mesh(new THREE.SphereGeometry(0.022, 16, 10), brass, 0, 0, 0.02));
  const grip = mesh(new RoundedBoxGeometry(0.04, 0.15, 0.065, 3, 0.012), wood, 0, -0.085, 0.03);
  grip.rotation.x = -0.35;
  const guard = new THREE.TorusGeometry(0.024, 0.004, 6, 16, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2);
  cannon.add(grip, mesh(guard, brass, 0, -0.04, -0.035), mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.02, 8), brass, 0, 0.062, -0.03), mesh(new THREE.BoxGeometry(0.006, 0.012, 0.012), brass, 0, 0.061, -0.49));
  const cMuzzle = new THREE.Object3D();
  cMuzzle.position.set(0, 0, -0.53);
  cannon.add(cMuzzle);

  // rocket launcher: tube along -Z, rear end behind the camera
  const rocket = new THREE.Group();
  rocket.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.056, 0.056, 1.05, 28, 1, true)), oliveM, 0, 0, -0.2),
    mesh(alongZ(new THREE.CylinderGeometry(0.051, 0.051, 1.05, 28, 1, true)), bore, 0, 0, -0.2),
    mesh(alongZ(lathe([0.051, 0, 0.056, 0, 0.066, 0.05, 0.07, 0.085, 0.066, 0.09, 0.051, 0.07])), oliveDark, 0, 0, -0.725),
    mesh(alongZ(lathe([0.051, 0, 0.056, 0, 0.066, 0.05, 0.07, 0.085, 0.066, 0.09, 0.051, 0.07]), false), oliveDark, 0, 0, 0.325),
    mesh(alongZ(new THREE.CylinderGeometry(0.0575, 0.0575, 0.035, 28, 1, true)), yellow, 0, 0, -0.62),
    mesh(new THREE.BoxGeometry(0.008, 0.045, 0.008), black, 0, 0.078, -0.6),
    mesh(new THREE.BoxGeometry(0.02, 0.014, 0.03), black, 0, 0.06, -0.6),
    mesh(new THREE.BoxGeometry(0.012, 0.03, 0.01), black, -0.013, 0.072, -0.08),
    mesh(new THREE.BoxGeometry(0.012, 0.03, 0.01), black, 0.013, 0.072, -0.08),
    mesh(new RoundedBoxGeometry(0.035, 0.04, 0.13, 2, 0.008), black, -0.072, 0.03, -0.26),
    mesh(alongZ(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 18)), lens, -0.072, 0.03, -0.327),
  );
  const rg = mesh(new RoundedBoxGeometry(0.032, 0.11, 0.05, 2, 0.01), black, 0, -0.1, -0.05);
  rg.rotation.x = 0.3;
  const fg = mesh(new RoundedBoxGeometry(0.03, 0.09, 0.04, 2, 0.01), black, 0, -0.09, -0.38);
  rocket.add(rg, fg);
  rocketTip = new THREE.Group();
  rocketTip.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 20)), oliveDark, 0, 0, -0.77),
    mesh(new THREE.ConeGeometry(0.045, 0.16, 20).rotateX(-Math.PI / 2), oliveDark, 0, 0, -0.9),
    mesh(alongZ(new THREE.CylinderGeometry(0.008, 0.012, 0.03, 12)), copper, 0, 0, -0.985),
  );
  rocket.add(rocketTip);
  const rMuzzle = new THREE.Object3D();
  rMuzzle.position.set(0, 0, -0.82);
  rocket.add(rMuzzle);

  // remote detonator
  const det = new THREE.Group();
  detButton = mesh(alongZ(new THREE.CylinderGeometry(0.013, 0.014, 0.01, 20)), red, 0, -0.018, 0.026);
  det.add(
    mesh(new RoundedBoxGeometry(0.07, 0.12, 0.034, 3, 0.01), black),
    mesh(new RoundedBoxGeometry(0.058, 0.07, 0.006, 2, 0.002), yellow, 0, -0.015, 0.017),
    mesh(alongZ(new THREE.CylinderGeometry(0.019, 0.019, 0.006, 20)), black, 0, -0.018, 0.021),
    detButton,
    mesh(new THREE.SphereGeometry(0.005, 12, 8), ledMat, 0.02, 0.036, 0.018),
    mesh(new THREE.BoxGeometry(0.008, 0.016, 0.008), polished, -0.018, 0.036, 0.02),
    mesh(new THREE.CylinderGeometry(0.0025, 0.0035, 0.16, 8), black, -0.024, 0.135, 0),
    mesh(new THREE.SphereGeometry(0.006, 10, 8), black, -0.024, 0.215, 0),
  );

  // airstrike signal canister
  const beacon = new THREE.Group();
  const lever = mesh(new THREE.BoxGeometry(0.012, 0.1, 0.004), polished, 0.034, 0.03, 0);
  lever.rotation.z = -0.08;
  beacon.add(
    mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.13, 22), red),
    mesh(new THREE.CylinderGeometry(0.0315, 0.0315, 0.05, 22, 1, true), cream, 0, -0.005, 0),
    mesh(new THREE.CylinderGeometry(0.0318, 0.0318, 0.008, 22, 1, true), black, 0, 0.018, 0),
    mesh(new THREE.CylinderGeometry(0.029, 0.031, 0.02, 22), iron, 0, 0.075, 0),
    mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.018, 14), iron, 0, 0.093, 0),
    mesh(new THREE.CylinderGeometry(0.031, 0.029, 0.012, 22), iron, 0, -0.071, 0),
    lever,
    mesh(new THREE.BoxGeometry(0.018, 0.006, 0.006), polished, 0.024, 0.084, 0),
    mesh(new THREE.TorusGeometry(0.012, 0.0022, 6, 18).rotateY(Math.PI / 2), polished, -0.014, 0.1, 0),
    mesh(new THREE.SphereGeometry(0.004, 10, 8), beaconLed, 0, 0.103, 0.008),
  );

  const orange = plain(0xd4581c, 0.45);
  const wire = plain(0x3a3e42, 0.45, 1);
  const glow = (hex: number, k: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: hex, emissiveIntensity: k, roughness: 0.4 });
  const sprite = (map: THREE.Texture, r: number, g: number, b: number): THREE.Sprite => {
    const m = new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    m.color.setRGB(r, g, b);
    return new THREE.Sprite(m);
  };
  const flare = flashTex();

  // thermite pot: canister with igniter up top, magnetic pad underneath
  thermTip = glow(0xff7a1e, 3);
  thermGlow = sprite(flare, 2.4, 1.1, 0.3);
  thermGlow.position.set(0.012, 0.089, 0.004);
  thermGlow.scale.setScalar(0.045);
  const therm = new THREE.Group();
  therm.add(
    mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.11, 24), steelHead),
    mesh(new THREE.CylinderGeometry(0.0346, 0.0346, 0.032, 24, 1, true), orange, 0, 0.01, 0),
    mesh(new THREE.CylinderGeometry(0.031, 0.035, 0.01, 24), iron, 0, 0.06, 0),
    mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 24), iron, 0, -0.056, 0),
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 24), black, 0, -0.062, 0),
    mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.022, 12), polished, 0.012, 0.074, 0),
    mesh(new THREE.SphereGeometry(0.0062, 12, 8), thermTip, 0.012, 0.087, 0),
    mesh(new THREE.TorusGeometry(0.01, 0.0018, 6, 16).rotateY(Math.PI / 2), polished, -0.014, 0.075, 0),
    thermGlow,
  );

  // linear cutter: copper chevron (apex up) along -Z on foam feet, detonator box on the near end
  cutLed = glow(0x2cff4a, 0);
  const plate = (s: number): THREE.Mesh => {
    const m = mesh(new THREE.BoxGeometry(0.02, 0.0025, 0.22), copper, s * 0.0083, -0.0056, -0.02);
    m.rotation.z = -s * 0.6;
    return m;
  };
  const cutter = new THREE.Group();
  cutter.add(
    plate(-1), plate(1),
    mesh(new THREE.BoxGeometry(0.006, 0.004, 0.22), black, -0.0175, -0.0125, -0.02),
    mesh(new THREE.BoxGeometry(0.006, 0.004, 0.22), black, 0.0175, -0.0125, -0.02),
    mesh(new RoundedBoxGeometry(0.034, 0.022, 0.038, 2, 0.004), black, 0, 0.004, 0.105),
    mesh(new THREE.BoxGeometry(0.0345, 0.008, 0.02), yellow, 0, 0.004, 0.105),
    mesh(new THREE.SphereGeometry(0.0038, 10, 8), cutLed, 0.009, 0.016, 0.112),
    mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.03, 6), black, -0.008, 0.028, 0.115),
  );

  // crane radio remote: control face up (+Y), joystick right, e-stop left, antenna back-left
  wreckLed = glow(0x39ff5a, 0.2);
  wreckStick = new THREE.Group();
  wreckStick.position.set(0.02, 0.02, 0.004);
  wreckStick.add(
    mesh(new THREE.CylinderGeometry(0.009, 0.014, 0.012, 16), rubber, 0, 0.006, 0),
    mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.036, 10), polished, 0, 0.026, 0),
    mesh(new THREE.SphereGeometry(0.009, 14, 10), black, 0, 0.046, 0),
  );
  const antenna = mesh(new THREE.CylinderGeometry(0.0022, 0.0035, 0.09, 8), black, -0.046, 0.055, -0.028);
  antenna.rotation.z = 0.2;
  const wrecker = new THREE.Group();
  wrecker.add(
    mesh(new RoundedBoxGeometry(0.105, 0.036, 0.075, 3, 0.01), yellow),
    mesh(new RoundedBoxGeometry(0.09, 0.004, 0.062, 2, 0.0015), black, 0, 0.018, 0),
    wreckStick,
    mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.006, 20), yellow, -0.026, 0.022, 0.002),
    mesh(new THREE.CylinderGeometry(0.0105, 0.012, 0.009, 20), red, -0.026, 0.029, 0.002),
    mesh(new THREE.BoxGeometry(0.004, 0.012, 0.004), polished, -0.004, 0.024, 0.022),
    mesh(new THREE.BoxGeometry(0.004, 0.012, 0.004), polished, 0.006, 0.024, 0.022),
    mesh(new THREE.SphereGeometry(0.0035, 10, 8), wreckLed, -0.036, 0.021, 0.024),
    mesh(new RoundedBoxGeometry(0.02, 0.016, 0.008, 2, 0.003), black, -0.046, 0.012, -0.03),
    antenna,
    mesh(new THREE.SphereGeometry(0.0045, 10, 8), black, -0.055, 0.1, -0.028),
  );

  // winch launcher: body along -Z, cable drum on top, hook in the fairlead
  winchDrum = new THREE.Group();
  winchDrum.position.set(0, 0.088, -0.02);
  const flange = new THREE.CylinderGeometry(0.036, 0.036, 0.004, 24).rotateZ(Math.PI / 2);
  winchDrum.add(
    mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.05, 20).rotateZ(Math.PI / 2), wire),
    mesh(flange, iron, 0.027, 0, 0),
    mesh(flange, iron, -0.027, 0, 0),
  );
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    winchDrum.add(mesh(new THREE.BoxGeometry(0.004, 0.008, 0.008), polished, s * 0.03, Math.cos(a) * 0.024, Math.sin(a) * 0.024));
  }
  winchHook = new THREE.Group();
  winchHook.position.set(0, 0.028, HOOK_Z);
  const hook = mesh(new THREE.TorusGeometry(0.012, 0.0033, 8, 20, Math.PI * 1.35).rotateY(Math.PI / 2), polished, 0, 0.006, -0.026);
  hook.rotation.x = 1.81;
  winchHook.add(mesh(alongZ(new THREE.CylinderGeometry(0.0035, 0.0035, 0.022, 8)), polished, 0, 0, -0.005), hook);
  const wg = mesh(new RoundedBoxGeometry(0.032, 0.11, 0.045, 2, 0.01), rubber, 0, -0.07, 0.05);
  wg.rotation.x = -0.3;
  const winch = new THREE.Group();
  winch.add(
    mesh(new RoundedBoxGeometry(0.05, 0.06, 0.2, 3, 0.012), oliveDark, 0, 0.02, -0.07),
    mesh(new THREE.BoxGeometry(0.006, 0.04, 0.03), oliveDark, 0.03, 0.07, -0.02),
    mesh(new THREE.BoxGeometry(0.006, 0.04, 0.03), oliveDark, -0.03, 0.07, -0.02),
    winchDrum,
    mesh(alongZ(new THREE.CylinderGeometry(0.02, 0.022, 0.05, 20)), iron, 0, 0.028, -0.195),
    mesh(alongZ(new THREE.CylinderGeometry(0.0225, 0.0225, 0.012, 20, 1, true)), yellow, 0, 0.028, -0.19),
    mesh(new THREE.TorusGeometry(0.014, 0.004, 8, 20), polished, 0, 0.028, -0.22),
    wg,
    mesh(guard, iron, 0, -0.03, -0.005),
    mesh(new THREE.BoxGeometry(0.006, 0.02, 0.008), black, 0, -0.022, -0.01),
    winchHook,
  );

  // manipulator: armoured body along -Z, coil pack on top, three hinged prongs round a glowing core
  gravCore = glow(0x5ad6ff, 2.5);
  gravGlow = sprite(flare, 0.6, 1.8, 3.2);
  gravGlow.position.set(0, 0, -0.14);
  gravGlow.scale.setScalar(0.06);
  const gg = mesh(new RoundedBoxGeometry(0.034, 0.11, 0.05, 2, 0.01), rubber, 0, -0.085, 0.07);
  gg.rotation.x = -0.3;
  const grav = new THREE.Group();
  grav.add(
    mesh(new RoundedBoxGeometry(0.07, 0.07, 0.19, 3, 0.014), iron, 0, 0, 0.02),
    mesh(new RoundedBoxGeometry(0.076, 0.018, 0.15, 2, 0.006), oliveDark, 0, 0.038, 0.01),
    mesh(new RoundedBoxGeometry(0.012, 0.05, 0.13, 2, 0.004), oliveDark, -0.04, 0, 0.02),
    mesh(new RoundedBoxGeometry(0.012, 0.05, 0.13, 2, 0.004), oliveDark, 0.04, 0, 0.02),
    mesh(alongZ(new THREE.CylinderGeometry(0.05, 0.038, 0.05, 24)), iron, 0, 0, -0.1),
    mesh(new THREE.TorusGeometry(0.047, 0.006, 8, 28), polished, 0, 0, -0.125),
    mesh(new THREE.SphereGeometry(0.019, 16, 12), gravCore, 0, 0, -0.118),
    mesh(new THREE.BoxGeometry(0.003, 0.008, 0.08), gravCore, -0.047, 0.012, 0.02),
    mesh(alongZ(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 14)), black, 0, 0.064, 0.05),
    mesh(new RoundedBoxGeometry(0.03, 0.08, 0.036, 2, 0.01), black, 0, -0.07, -0.06),
    gg, gravGlow,
  );
  for (let i = 0; i < 4; i++) grav.add(mesh(new THREE.TorusGeometry(0.016, 0.0055, 8, 20), copper, 0, 0.064, 0.014 + i * 0.024));
  prongs = [];
  for (let i = 0; i < 3; i++) {
    const root = new THREE.Group();
    root.rotation.z = (i / 3) * Math.PI * 2;
    // positive hinge X swings the tip radially outward
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.046, -0.125);
    const tip = mesh(new THREE.BoxGeometry(0.009, 0.007, 0.045), steelHead, 0, -0.01, -0.09);
    tip.rotation.x = -0.45;
    hinge.add(
      mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.016, 10).rotateZ(Math.PI / 2), polished),
      mesh(new THREE.BoxGeometry(0.012, 0.008, 0.07), steelHead, 0, 0, -0.035),
      tip,
    );
    root.add(hinge);
    grav.add(root);
    prongs.push(hinge);
  }

  // firebomb: tinted bottle, amber fill, rag wick with a small flame
  const glassM = new THREE.MeshStandardMaterial({ color: 0x5d7a44, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, envMapIntensity: 2.2, depthWrite: false });
  const rag = plain(0xa38f6c, 1);
  const fmap = flameTex();
  flame = sprite(fmap, 3.2, 1.2, 0.28);
  flameCore = sprite(fmap, 3.4, 2.2, 0.7);
  flame.center.set(0.5, 0.06);
  flameCore.center.set(0.5, 0.06);
  flame.position.set(0, 0.142, 0);
  flameCore.position.set(0, 0.141, 0.002);
  flame.scale.set(0.036, 0.07, 1);
  flameCore.scale.set(0.016, 0.034, 1);
  const flap = mesh(new THREE.BoxGeometry(0.018, 0.045, 0.003), rag, 0.013, 0.1, 0.004);
  flap.rotation.z = -0.25;
  const bottle = new THREE.Group();
  bottle.add(
    mesh(lathe([0, -0.06, 0.028, -0.06, 0.031, -0.054, 0.031, 0.03, 0.027, 0.05, 0.014, 0.068, 0.011, 0.085, 0.011, 0.104, 0.013, 0.107, 0.013, 0.113, 0.0105, 0.115]), glassM),
    mesh(lathe([0, -0.057, 0.0285, -0.057, 0.0285, 0.018, 0, 0.018]), plain(0x8a5716, 0.12)),
    mesh(new THREE.CylinderGeometry(0.008, 0.0105, 0.05, 10), rag, 0, 0.118, 0),
    mesh(new THREE.SphereGeometry(0.0085, 10, 8), plain(0x1d1915, 1), 0, 0.142, 0),
    flap, flame, flameCore,
  );

  // sandbox detonator: hazard-striped case, red button under a flip cover hinged at the far edge
  const hz = hazardTex();
  hz.repeat.set(3, 1.5);
  const hazM = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.55, metalness: 0.1 });
  const coverM = new THREE.MeshStandardMaterial({ color: 0xff3a24, roughness: 0.12, transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 1.6 });
  megaLed = glow(0xffa21e, 0.2);
  megaButton = mesh(new THREE.CylinderGeometry(0.019, 0.02, 0.012, 24), red, 0.016, 0.042, 0.008);
  megaCover = new THREE.Group();
  megaCover.position.set(0.016, 0.037, -0.021);
  megaCover.add(
    mesh(new THREE.BoxGeometry(0.06, 0.026, 0.058).translate(0, 0.013, 0.029), coverM),
    mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.062, 10).rotateZ(Math.PI / 2), polished),
  );
  const mega = new THREE.Group();
  mega.add(
    mesh(new RoundedBoxGeometry(0.12, 0.056, 0.086, 3, 0.008), hazM),
    mesh(new RoundedBoxGeometry(0.108, 0.006, 0.074, 2, 0.002), black, 0, 0.028, 0),
    mesh(new THREE.CylinderGeometry(0.025, 0.027, 0.008, 24), iron, 0.016, 0.034, 0.008),
    megaButton, megaCover,
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 16), polished, -0.034, 0.033, 0.018),
    mesh(new THREE.BoxGeometry(0.003, 0.012, 0.008), polished, -0.034, 0.041, 0.018),
    mesh(new THREE.SphereGeometry(0.0045, 10, 8), megaLed, -0.034, 0.033, -0.016),
    mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.05, 8), black, -0.05, 0.05, -0.034),
  );

  // disc cutter: motor body along -Z, gear head in front, Ø230 disc in the vertical plane under a half guard, side handle
  grDiscMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.85, metalness: 0.2, emissive: 0xff5a14, emissiveIntensity: 0 });
  grDisc = new THREE.Group();
  grDisc.position.set(0, -0.02, -0.25);
  grDisc.add(
    mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.003, 40).rotateZ(Math.PI / 2), grDiscMat),
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 18).rotateZ(Math.PI / 2), polished),
    mesh(new THREE.BoxGeometry(0.004, 0.012, 0.012), black, 0.006, 0.02, 0),
  );
  const guard2 = mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.03, 32, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), iron, 0, -0.02, -0.25);
  guard2.rotation.x = -0.4;
  const grinder = new THREE.Group();
  grinder.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.036, 0.04, 0.26, 20)), oliveDark, 0, 0, 0),
    mesh(alongZ(new THREE.CylinderGeometry(0.03, 0.036, 0.06, 20)), black, 0, 0, 0.16),
    mesh(new RoundedBoxGeometry(0.06, 0.055, 0.075, 2, 0.01), iron, 0, 0, -0.16),
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12).rotateZ(Math.PI / 2), polished, 0.015, -0.02, -0.25),
    mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 12).rotateZ(Math.PI / 2), rubber, -0.08, 0.01, -0.14),
    mesh(new THREE.BoxGeometry(0.012, 0.01, 0.05), black, 0, -0.04, 0.05),
    guard2, grDisc,
  );

  // chainsaw: orange engine, rear handle, wrap handle, 18" bar with a running chain
  const sawBody = plain(0xd4581c, 0.5);
  sawChain = new THREE.Group();
  for (let i = 0; i < 26; i++) sawChain.add(mesh(new THREE.BoxGeometry(0.006, 0.008, 0.012), wire));
  const saw = new THREE.Group();
  saw.add(
    mesh(new RoundedBoxGeometry(0.1, 0.13, 0.2, 3, 0.02), sawBody, 0, 0.02, 0.02),
    mesh(new RoundedBoxGeometry(0.03, 0.04, 0.14, 2, 0.01), black, 0, -0.02, 0.17),
    mesh(new THREE.TorusGeometry(0.075, 0.009, 8, 20, Math.PI).rotateY(Math.PI / 2), black, 0, 0.07, -0.02),
    mesh(new THREE.BoxGeometry(0.006, 0.07, 0.46), polished, 0.055, 0, -0.3),
    mesh(new RoundedBoxGeometry(0.02, 0.05, 0.06, 2, 0.008), black, 0.055, 0.03, -0.09),
    sawChain,
  );
  sawChain.position.set(0.055, 0, -0.3);

  // drill rig: motor, pistol grip, side handle and a spinning core barrel
  drillBit = new THREE.Group();
  drillBit.position.set(0, 0, -0.14);
  drillBit.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 18, 1, true)), polished, 0, 0, -0.13),
    mesh(alongZ(new THREE.CylinderGeometry(0.0235, 0.0235, 0.02, 18, 1, true)), iron, 0, 0, -0.26),
    mesh(new THREE.BoxGeometry(0.005, 0.005, 0.25), black, 0.02, 0, -0.13),
  );
  const drillGrip = mesh(new RoundedBoxGeometry(0.034, 0.11, 0.05, 2, 0.01), rubber, 0, -0.09, 0.07);
  drillGrip.rotation.x = -0.25;
  const drill = new THREE.Group();
  drill.add(
    mesh(new RoundedBoxGeometry(0.075, 0.08, 0.22, 3, 0.015), yellow, 0, 0.01, 0.02),
    mesh(alongZ(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 18)), iron, 0, 0, -0.115),
    mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.12, 12).rotateZ(Math.PI / 2), rubber, -0.08, 0, -0.08),
    drillGrip, drillBit,
  );

  // hydraulic shears: ram body, hose, two curved blades hinged at the nose
  const blade = (s: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(0, 0.012 * s, -0.2);
    const b = mesh(new THREE.BoxGeometry(0.018, 0.028, 0.15), steelHead, 0, 0.012 * s, -0.07);
    b.rotation.x = 0.12 * s;
    g.add(b, mesh(new THREE.BoxGeometry(0.004, 0.006, 0.13), polished, 0, -0.002 * s, -0.07));
    return g;
  };
  jawA = blade(1); jawB = blade(-1);
  const shears = new THREE.Group();
  shears.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.04, 0.045, 0.24, 20)), yellow, 0, 0, 0),
    mesh(alongZ(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16)), iron, 0, 0, -0.14),
    mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 14).rotateZ(Math.PI / 2), polished, 0, 0, -0.2),
    mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 20, Math.PI).rotateY(Math.PI / 2), black, 0, 0.05, 0.02),
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), black, 0.03, -0.05, 0.12),
    jawA, jawB,
  );

  // plasma torch: pistol handle, head angled at the work, nozzle glowing when the arc is on
  plasmaTip = glow(0x9cc8ff, 0);
  plasmaGlow = sprite(flare, 1.6, 2.2, 3.4);
  plasmaGlow.position.set(0, -0.055, -0.19);
  plasmaGlow.scale.setScalar(0.0);
  const plasmaHead = mesh(alongZ(new THREE.CylinderGeometry(0.014, 0.02, 0.08, 16)), black, 0, -0.025, -0.16);
  plasmaHead.rotation.x = -0.6;
  const plasma = new THREE.Group();
  plasma.add(
    mesh(new RoundedBoxGeometry(0.036, 0.12, 0.04, 2, 0.012), black, 0, -0.03, 0.02),
    mesh(alongZ(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 16)), black, 0, 0.02, -0.06),
    plasmaHead,
    mesh(new THREE.SphereGeometry(0.007, 10, 8), plasmaTip, 0, -0.052, -0.186),
    mesh(new THREE.BoxGeometry(0.008, 0.02, 0.02), red, 0, -0.01, -0.015),
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), black, 0, -0.1, 0.1),
    plasmaGlow,
  );

  // oxy-fuel torch: brass handle, oxygen + fuel valves, lever, bent head and a flame
  const fmap2 = flameTex();
  torchFlame = sprite(fmap2, 0.6, 0.9, 3);
  torchCore = sprite(fmap2, 1.4, 2, 3.4);
  for (const f of [torchFlame, torchCore]) { f.center.set(0.5, 0.05); f.material.rotation = Math.PI; }
  torchFlame.position.set(0, -0.07, -0.3);
  torchCore.position.set(0, -0.07, -0.3);
  const tHead = mesh(alongZ(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 10)), brass, 0, -0.03, -0.26);
  tHead.rotation.x = -0.7;
  const torch = new THREE.Group();
  torch.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 14)), brass, 0, 0, -0.02),
    mesh(alongZ(new THREE.CylinderGeometry(0.007, 0.007, 0.12, 10)), brass, 0.008, 0.008, -0.18),
    tHead,
    mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.012, 12).rotateZ(Math.PI / 2), red, 0.02, 0, 0.07),
    mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.012, 12).rotateZ(Math.PI / 2), plain(0x2f5fb3, 0.4), -0.02, 0, 0.07),
    mesh(new THREE.BoxGeometry(0.008, 0.006, 0.12), polished, 0, 0.018, -0.1),
    torchFlame, torchCore,
  );

  // detonator panel: hazard case with a firing-circuit screen, arming key and a guarded red fire button
  planLed = glow(0x39ff5a, 0.3);
  planScreen = new THREE.MeshStandardMaterial({ color: 0x08120a, emissive: 0x2cff6a, emissiveIntensity: 0.35, roughness: 0.3 });
  planBtn = mesh(new THREE.CylinderGeometry(0.014, 0.015, 0.012, 20), red, 0.03, 0.036, 0.018);
  const planner = new THREE.Group();
  planner.add(
    mesh(new RoundedBoxGeometry(0.14, 0.05, 0.1, 3, 0.008), hazM),
    mesh(new RoundedBoxGeometry(0.128, 0.006, 0.088, 2, 0.002), black, 0, 0.025, 0),
    mesh(new THREE.BoxGeometry(0.07, 0.002, 0.045), planScreen, -0.024, 0.029, -0.012),
    mesh(new THREE.CylinderGeometry(0.02, 0.021, 0.006, 20), iron, 0.03, 0.03, 0.018),
    planBtn,
    mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 12), polished, 0.03, 0.032, -0.022),
    mesh(new THREE.BoxGeometry(0.004, 0.012, 0.01), brass, 0.03, 0.04, -0.022),
    mesh(new THREE.SphereGeometry(0.004, 10, 8), planLed, -0.052, 0.03, 0.03),
    mesh(new THREE.CylinderGeometry(0.003, 0.004, 0.07, 8), black, -0.06, 0.06, -0.04),
  );

  // excavator radio remote: two joysticks, e-stop, antenna
  excLed = glow(0xffb020, 0.2);
  const joy = (x: number): THREE.Group => {
    const j = new THREE.Group();
    j.position.set(x, 0.02, 0.004);
    j.add(
      mesh(new THREE.CylinderGeometry(0.009, 0.014, 0.012, 16), rubber, 0, 0.006, 0),
      mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.036, 10), polished, 0, 0.026, 0),
      mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 12), black, 0, 0.048, 0),
    );
    return j;
  };
  excStickL = joy(-0.035); excStickR = joy(0.035);
  const excAnt = mesh(new THREE.CylinderGeometry(0.0022, 0.0035, 0.1, 8), black, 0, 0.06, -0.045);
  excAnt.rotation.x = -0.2;
  const excavator = new THREE.Group();
  excavator.add(
    mesh(new RoundedBoxGeometry(0.13, 0.036, 0.085, 3, 0.01), yellow),
    mesh(new RoundedBoxGeometry(0.115, 0.004, 0.072, 2, 0.0015), black, 0, 0.018, 0),
    excStickL, excStickR,
    mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.009, 20), red, 0, 0.024, 0.026),
    mesh(new THREE.SphereGeometry(0.0035, 10, 8), excLed, 0, 0.021, -0.03),
    excAnt,
  );

  // handheld breaker: T-handle, cylinder body and a chisel steel under the crosshair
  brkChisel = new THREE.Group();
  brkChisel.position.set(0, 0, -0.3);
  brkChisel.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.013, 0.013, 0.22, 10)), polished, 0, 0, -0.11),
    mesh(new THREE.ConeGeometry(0.013, 0.04, 4).rotateX(-Math.PI / 2), polished, 0, 0, -0.24),
  );
  const breaker = new THREE.Group();
  breaker.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.042, 0.048, 0.26, 20)), oliveDark, 0, 0, -0.1),
    mesh(alongZ(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 16)), iron, 0, 0, -0.26),
    mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 12).rotateZ(Math.PI / 2), rubber, 0, 0.02, 0.06),
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), black, 0.04, -0.04, 0.12),
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), red, -0.04, -0.04, 0.12),
    brkChisel,
  );

  // water cannon: red monitor body on its swivel, a tapered brass tip and the supply hose
  hoseTip = new THREE.Group();
  hoseTip.position.set(0, 0.01, -0.26);
  hoseTip.add(
    mesh(alongZ(lathe([0.034, 0, 0.034, 0.02, 0.022, 0.16, 0.016, 0.18, 0, 0.18])), brass, 0, 0, 0),
    mesh(alongZ(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 20)), black, 0, 0, -0.02),
  );
  const hose = new THREE.Group();
  hose.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.04, 0.045, 0.22, 20)), red, 0, 0, -0.12),
    mesh(new THREE.TorusGeometry(0.05, 0.016, 10, 20, Math.PI), red, 0, -0.05, 0.02),
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 14), plain(0xd9d2c0, 0.8), 0, -0.14, 0.05),
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 10).rotateZ(Math.PI / 2), polished, 0, 0.04, -0.06),
    hoseTip,
  );

  // wedge splitter: yellow ram body, wedge between two feathers, hoses
  splitWedge = new THREE.Group();
  splitWedge.position.set(0, 0, -0.18);
  splitWedge.add(mesh(new THREE.BoxGeometry(0.01, 0.03, 0.2).translate(0, 0, -0.1), polished));
  const feather = (s: number) => mesh(new THREE.BoxGeometry(0.008, 0.012, 0.2).translate(0, 0, -0.1), steelHead, 0, s * 0.019, -0.18);
  const splitter = new THREE.Group();
  splitter.add(
    mesh(alongZ(new THREE.CylinderGeometry(0.045, 0.05, 0.22, 20)), yellow, 0, 0, -0.04),
    mesh(new RoundedBoxGeometry(0.1, 0.04, 0.05, 2, 0.01), black, 0, 0.055, 0.02),
    splitWedge, feather(1), feather(-1),
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8), black, 0.03, -0.05, 0.12),
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8), black, -0.03, -0.05, 0.12),
  );

  // wire saw pendant: grey control box, start (green) / stop (red) buttons, run LED and the pendant lead
  wireLed = glow(0x39ff5a, 0.2);
  wireBtn = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 16), plain(0x1f9a3a, 0.4), -0.016, 0.03, 0.01);
  const wiresaw = new THREE.Group();
  wiresaw.add(
    mesh(new RoundedBoxGeometry(0.075, 0.05, 0.12, 3, 0.01), plain(0x7d8388, 0.5, 0.3)),
    wireBtn,
    mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 16), red, 0.016, 0.028, 0.01),
    mesh(new THREE.SphereGeometry(0.004, 10, 8), wireLed, 0, 0.026, -0.035),
    mesh(new THREE.TorusGeometry(0.018, 0.004, 8, 20), black, 0, 0.0, 0.07),
    mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 8), black, 0, -0.06, 0.08),
  );

  const mk = (group: THREE.Group, pos: Vec3, rot: Vec3, muzzle: THREE.Object3D | null): Model => ({ group, pos, rot, muzzle });
  return {
    hammer: mk(hammer, [0.36, -0.52, -0.74], [-0.6, 0, 0.05], null),
    cannon: mk(cannon, [0.25, -0.25, -0.6], [0.03, -0.04, 0], cMuzzle),
    rocket: mk(rocket, [0.3, -0.25, -0.34], [0.03, 0.13, 0.02], rMuzzle),
    charge: mk(det, [0.22, -0.22, -0.46], [-0.35, -0.35, 0.12], null),
    airstrike: mk(beacon, [0.22, -0.24, -0.46], [0.15, -0.3, -0.25], null),
    thermite: mk(therm, [0.22, -0.22, -0.46], [0.12, -0.3, -0.16], null),
    cutter: mk(cutter, [0.2, -0.21, -0.46], [0.5, 0.3, -0.2], null),
    wrecker: mk(wrecker, [0.19, -0.19, -0.42], [0.9, -0.3, 0.08], null),
    winch: mk(winch, [0.26, -0.24, -0.5], [0.03, -0.05, 0], null),
    gravgun: mk(grav, [0.26, -0.24, -0.52], [0.03, -0.05, 0], null),
    incendiary: mk(bottle, [0.21, -0.25, -0.45], [0.1, -0.3, -0.14], null),
    megabomb: mk(mega, [0.2, -0.2, -0.44], [0.8, -0.3, 0.06], null),
    grinder: mk(grinder, [0.24, -0.24, -0.46], [0.08, -0.08, 0.1], null),
    saw: mk(saw, [0.22, -0.3, -0.42], [0.1, -0.06, 0], null),
    drill: mk(drill, [0.24, -0.24, -0.46], [0.03, -0.05, 0], null),
    shears: mk(shears, [0.24, -0.24, -0.5], [0.03, -0.05, 0], null),
    plasma: mk(plasma, [0.24, -0.2, -0.48], [0.12, -0.05, 0], null),
    torch: mk(torch, [0.24, -0.2, -0.48], [0.12, -0.05, 0], null),
    planner: mk(planner, [0.2, -0.2, -0.44], [0.85, -0.3, 0.06], null),
    excavator: mk(excavator, [0.19, -0.19, -0.42], [0.9, -0.2, 0.05], null),
    breaker: mk(breaker, [0.24, -0.3, -0.42], [0.35, -0.05, 0], null),
    hose: mk(hose, [0.24, -0.24, -0.5], [0.03, -0.05, 0], null),
    splitter: mk(splitter, [0.24, -0.24, -0.46], [0.05, -0.05, 0], null),
    wiresaw: mk(wiresaw, [0.2, -0.2, -0.44], [0.8, -0.3, 0.06], null),
  };
}

function buildFlash(): THREE.Group {
  const m = new THREE.MeshBasicMaterial({ map: flashTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  m.color.setRGB(7, 4.2, 1.8);
  const g = new THREE.Group();
  const a = new THREE.PlaneGeometry(0.26, 0.26);
  const b = new THREE.PlaneGeometry(0.34, 0.16).rotateY(Math.PI / 2).translate(0, 0, -0.1);
  const c = new THREE.PlaneGeometry(0.34, 0.16).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, -0.1);
  g.add(new THREE.Mesh(a, m), new THREE.Mesh(b, m), new THREE.Mesh(c, m));
  g.visible = false;
  return g;
}

/* ---------------- renderer hooks ---------------- */

export function viewmodelLayer(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null {
  return scene && visible ? { scene, camera } : null;
}

export function setViewmodelAspect(aspect: number): void {
  if (!scene) return;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

/** re-expresses world lighting in the overlay's camera space; call once per frame before drawing */
export function syncViewmodel(world: THREE.Camera): void {
  if (!scene) return;
  if (litVersion !== lighting.version) {
    litVersion = lighting.version;
    key.color.copy(lighting.sunColor);
    key.intensity = lighting.sunIntensity * 0.85;
    hemi.color.copy(lighting.hemiSky);
    hemi.groundColor.copy(lighting.hemiGround);
    hemi.intensity = lighting.hemiIntensity + 0.25;
    fillBase.setHex(lighting.lamps > 0.5 ? 0xffd9a8 : 0xdfe8ff).multiplyScalar(0.25 + lighting.lamps * 0.9);
    scene.environment = lighting.env;
    scene.environmentIntensity = lighting.envIntensity;
  }
  fill.color.copy(fillBase).add(vmGlow);
  world.getWorldQuaternion(_q).invert();
  key.position.copy(_v.copy(lighting.sunDir).applyQuaternion(_q)).multiplyScalar(5);
  hemi.position.set(0, 1, 0).applyQuaternion(_q);
  scene.environmentRotation.setFromQuaternion(_q);
  flashL.color.copy(flashAtCamera);
  if (flashT < 0.07) {
    const k = 7 * (1 - flashT / 0.07);
    flashL.color.r += k; flashL.color.g += k * 0.6; flashL.color.b += k * 0.25;
  }
}

/* ---------------- public ---------------- */

export function initViewmodel(): void {
  if (scene) return;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 10);
  rig = new THREE.Group();
  scene.add(rig);
  models = buildModels();
  for (const id of Object.keys(models) as WeaponId[]) {
    const m = models[id];
    m.group.visible = id === current;
    m.group.rotation.set(m.rot[0], m.rot[1], m.rot[2]);
    rig.add(m.group);
  }
  flashFx = buildFlash();
  key = new THREE.DirectionalLight(0xffffff, 2);
  fill = new THREE.DirectionalLight(0xdfe8ff, 1);
  fill.position.set(-0.3, 0.4, 1);
  flashL = new THREE.DirectionalLight(0x000000, 1);
  flashL.position.set(0.2, 0.3, -1);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  scene.add(key, fill, flashL, hemi);
}

export const viewmodel = {
  setWeapon(id: WeaponId): void {
    if (id === target) return;
    target = id;
    if (!swapping) { swapping = true; swapT = 0; }
    else if (swapT > 0.5) swapT = 1 - swapT;
  },

  fire(id: WeaponId): void {
    if (!scene) return;
    fireT = 0;
    firedWith = id;
    if (id === 'cannon') {
      kickP.velocity[2] += 4; kickP.velocity[1] += 0.8;
      kickR.velocity[0] += 9; kickR.velocity[2] += (Math.random() - 0.5) * 4;
    } else if (id === 'rocket') {
      kickP.velocity[2] += 2.4; kickR.velocity[0] += 4.5;
    } else if (id === 'charge') {
      kickP.velocity[2] -= 0.6; kickR.velocity[0] -= 2;
    } else if (id === 'thermite' || id === 'cutter' || id === 'megabomb') {
      kickP.velocity[2] -= 0.5; kickR.velocity[0] -= 1.6;
    } else if (id === 'winch') {
      kickP.velocity[2] += 1.8; kickR.velocity[0] += 4; drumSpin = 55;
    } else if (id === 'gravgun') {
      kickP.velocity[2] += 1.2; kickR.velocity[0] += 3; prongK.velocity -= 14;
    } else if (id === 'wrecker' || id === 'planner' || id === 'wiresaw') {
      kickR.velocity[0] -= 0.8;
    } else if (id === 'splitter') {
      kickP.velocity[2] -= 0.8; kickR.velocity[0] -= 1.2;
    } else if (id === 'breaker') {
      kickP.velocity[2] -= 0.6;
    }
    const m = models[id];
    if (m.muzzle) {
      m.muzzle.add(flashFx);
      flashFx.rotation.z = Math.random() * Math.PI;
      flashFx.scale.setScalar(id === 'rocket' ? 1.4 : 1);
      flashT = 0;
    }
  },

  update(dt: number, s: { move: number; grounded: boolean; sprint: boolean; lookDelta: [number, number] }): void {
    if (!scene) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    time += dt;
    fireT += dt;
    flashT += dt;

    if (swapping) {
      swapT += dt / 0.42;
      if (swapT >= 0.5 && current !== target) {
        models[current].group.visible = false;
        current = target;
        models[current].group.visible = true;
        fireT = 99;
      }
      if (swapT >= 1) { swapT = 1; swapping = false; }
    }
    const lower = swapping ? (swapT < 0.5 ? easing.cubicIn(swapT * 2) : 1 - easing.cubicOut((swapT - 0.5) * 2)) : 0;

    const moving = s.grounded ? Math.min(1, Math.max(0, s.move)) : 0;
    spring.damp(bobAmp, moving * (s.sprint ? 1.5 : 1), 0.12, dt);
    if (s.move > 0.05 && s.grounded) bobPhase += dt * (s.sprint ? 8.4 : 6.2);
    const a = bobAmp.value;
    const bx = Math.sin(bobPhase) * 0.011 * a;
    const by = -Math.abs(Math.cos(bobPhase)) * 0.013 * a + Math.sin(time * 1.7) * 0.0025;
    const broll = Math.sin(bobPhase) * 0.018 * a;

    // lookDelta arrives as mouse pixels this frame; LOOK_RAD matches player.applyLook at sensitivity 1
    const k = (LOOK_RAD * 0.02) / Math.max(dt, 1 / 240);
    swayTarget[0] = Math.max(-0.08, Math.min(0.08, s.lookDelta[1] * k));
    swayTarget[1] = Math.max(-0.08, Math.min(0.08, s.lookDelta[0] * k));
    swayTarget[2] = swayTarget[1] * 0.6;
    spring3.damp(sway, swayTarget, 0.09, dt);

    spring.damp(sprintK, s.sprint && s.grounded && s.move > 0.3 ? 1 : 0, 0.14, dt);
    const sk = sprintK.value;

    if (!s.grounded) airTime += dt;
    else {
      if (!wasGrounded) {
        kickP.velocity[1] -= Math.min(0.5 + airTime * 1.6, 2.2);
        kickR.velocity[0] -= Math.min(1 + airTime * 2.5, 3.5);
      }
      airTime = 0;
    }
    wasGrounded = s.grounded;

    spring3.update(kickP, ZERO, 0.07, 0.45, dt);
    spring3.update(kickR, ZERO, 0.08, 0.4, dt);

    const m = models[current];
    const air = s.grounded ? 0 : 0.012;
    rig.position.set(
      m.pos[0] + bx - sway.value[1] * 0.12 - sk * 0.03,
      m.pos[1] + by - lower * 0.32 + kickP.value[1] + air - sk * 0.05 + sway.value[0] * 0.06,
      m.pos[2] + kickP.value[2] + sk * 0.03,
    );
    rig.rotation.set(
      sway.value[0] + kickR.value[0] - lower * 0.7 - sk * 0.35 + Math.sin(time * 1.7) * 0.004,
      sway.value[1] + kickR.value[1] + sk * 0.5,
      broll + sway.value[2] + kickR.value[2] + sk * 0.25,
    );
    animateWeapon(m, dt);
  },

  setVisible(v: boolean): void { visible = v; },

  /** held cutting tool state, every frame: running, load 0..1, blade heat 0..1, jaw closure 0..1, torch oxygen on */
  work(on: boolean, load: number, heat: number, close: number, lit: boolean): void {
    work.on = on; work.load = load; work.heat = heat; work.close = close; work.lit = lit;
  },

  /** sledge wind-up 0..1 (0 = at rest) */
  charge(k: number): void { hold.wind = Math.min(1, Math.max(0, k)); },

  /** breaker / water cannon / excavator remote in use this frame, with its intensity 0..1 */
  hold(on: boolean, k: number): void { hold.on = on; hold.k = k; },
};

/** gravgun hold state: prongs close, core brightens, the tool shakes */
export function viewmodelGrip(active: boolean): void { gripping = active; }

const kOut = [0, 0, 0, 0];
function key3(t: number, keys: number[][]): number[] {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i++;
  const k0 = keys[i - 1], k1 = keys[i];
  const u = easing.sineInOut(Math.min(1, Math.max(0, (t - k0[0]) / (k1[0] - k0[0]))));
  for (let c = 0; c < 4; c++) kOut[c] = k0[c + 1] + (k1[c + 1] - k0[c + 1]) * u;
  return kOut;
}

// [t, rotX, rotZ, posY, posZ]
const SWING = [[0, 0, 0, 0, 0], [0.12, 0.45, -0.05, 0.04, 0.05], [0.24, -1.3, 0.45, -0.08, -0.22], [0.3, -1.25, 0.42, -0.1, -0.2], [0.58, 0, 0, 0, 0]];
const THROW = [[0, 0, 0, 0, 0], [0.14, 0.5, 0, 0.06, 0.1], [0.3, -0.9, 0, 0.15, -0.35], [0.31, -0.9, 0, -0.35, 0], [0.9, -0.3, 0, -0.35, 0], [1.25, 0, 0, 0, 0]];
const PLACE = [[0, 0, 0, 0, 0], [0.1, 0.3, 0, 0.02, 0.06], [0.24, -0.45, 0.1, 0.08, -0.26], [0.25, -0.3, 0, -0.3, 0.02], [0.62, -0.3, 0, -0.3, 0.02], [0.95, 0, 0, 0, 0]];

function flicker(a: number, b: number): number {
  return 0.85 + 0.15 * Math.sin(time * a) * Math.sin(time * b) + (Math.random() - 0.5) * 0.06;
}

function animateWeapon(m: Model, dt: number): void {
  const g = m.group;
  g.rotation.set(m.rot[0], m.rot[1], m.rot[2]);
  g.position.set(0, 0, 0);
  vmGlow.setRGB(0, 0, 0);
  flashFx.visible = flashT < 0.06;
  if (current === 'hammer' && firedWith === 'hammer' && fireT < 0.6) {
    const k = key3(fireT, SWING);
    g.rotation.x += k[0]; g.rotation.z += k[1]; g.position.y = k[2]; g.position.z = k[3];
  } else if (current === 'hammer' && hold.wind > 0) {
    // wound up over the shoulder, trembling a little at the top
    const w = easing.cubicOut(hold.wind);
    g.rotation.x += 0.55 * w; g.rotation.z += -0.08 * w; g.position.y = 0.06 * w; g.position.z = 0.08 * w;
    if (hold.wind >= 1) g.rotation.x += Math.sin(time * 40) * 0.004;
  } else if (current === 'planner') {
    const t = firedWith === 'planner' ? fireT : 99;
    planBtn.position.y = t < 0.15 ? 0.032 : 0.036;
    planLed.emissiveIntensity = (time % 0.8) < 0.1 ? 4 : 0.3;
    planScreen.emissiveIntensity = 0.35 + 0.1 * Math.sin(time * 3);
  } else if (current === 'excavator') {
    hold.run += ((hold.on ? 1 : 0) - hold.run) * Math.min(1, dt * 8);
    excStickL.rotation.set(-0.35 * hold.run + Math.sin(time * 1.7) * 0.1 * hold.run, 0, Math.sin(time * 1.3) * 0.2 * hold.run);
    excStickR.rotation.set(-0.25 * hold.run * Math.sin(time * 2.1), 0, 0.15 * hold.run);
    excLed.emissiveIntensity = hold.on ? (Math.sin(time * 20) > 0 ? 4 : 0.3) : (time % 1.5) < 0.1 ? 3 : 0.2;
  } else if (current === 'breaker') {
    hold.run += ((hold.on ? 1 : 0) - hold.run) * Math.min(1, dt * 10);
    // 25 Hz blows: the chisel steel reciprocates and the body judders in the hands
    const r = hold.run;
    brkChisel.position.z = -0.3 - 0.012 * r * (0.5 + 0.5 * Math.sin(time * 157));
    g.position.x += (Math.random() - 0.5) * 0.006 * r;
    g.position.y += (Math.random() - 0.5) * 0.008 * r;
    g.rotation.x += (Math.random() - 0.5) * 0.02 * r;
  } else if (current === 'hose') {
    hold.run += ((hold.on ? 1 : 0) - hold.run) * Math.min(1, dt * 6);
    hoseTip.rotation.z += dt * (hold.k < 1 ? 6 : 0) * hold.run;
    g.position.z += 0.015 * hold.run;
    g.position.x += (Math.random() - 0.5) * 0.002 * hold.run;
    g.position.y += (Math.random() - 0.5) * 0.002 * hold.run;
  } else if (current === 'splitter') {
    const t = firedWith === 'splitter' ? fireT : 99;
    splitWedge.position.z = -0.18 - (t < 3.2 ? 0.06 * Math.min(1, t / 3.2) : 0);
    if (t < 3.2) g.position.x += (Math.random() - 0.5) * 0.0015;
  } else if (current === 'wiresaw') {
    const t = firedWith === 'wiresaw' ? fireT : 99;
    wireBtn.position.y = t < 0.15 ? 0.026 : 0.03;
    wireLed.emissiveIntensity = (time % 1) < 0.5 ? 2.5 : 0.3;
  } else if (current === 'airstrike') {
    const thrown = firedWith === 'airstrike' && fireT < 1.3;
    if (thrown) {
      const k = key3(fireT, THROW);
      g.rotation.x += k[0]; g.position.y = k[2]; g.position.z = k[3];
    }
    g.visible = !(thrown && fireT > 0.3 && fireT < 0.9);
    beaconLed.emissiveIntensity = Math.sin(time * 4) > 0.6 ? 3 : 0.1;
  } else if (current === 'charge') {
    const pressed = firedWith === 'charge' && fireT < 0.16;
    detButton.position.z = pressed ? 0.022 : 0.026;
    const fast = firedWith === 'charge' && fireT < 0.7;
    ledMat.emissiveIntensity = (fast ? Math.sin(time * 40) > 0 : (time % 1) < 0.12) ? 4 : 0.15;
  } else if (current === 'rocket') {
    const reloading = firedWith === 'rocket' && fireT < 1.6;
    rocketTip.visible = !reloading || fireT > 1.25;
    rocketTip.position.z = reloading && fireT > 1.25 ? -0.3 * (1 - easing.cubicOut((fireT - 1.25) / 0.35)) : 0;
  } else if (current === 'thermite' || current === 'cutter') {
    // placed item leaves the hand, a fresh one comes up from below
    const placing = firedWith === current && fireT < 0.95;
    if (placing) {
      const k = key3(fireT, PLACE);
      g.rotation.x += k[0]; g.rotation.z += k[1]; g.position.y = k[2]; g.position.z = k[3];
    }
    g.visible = !(placing && fireT > 0.25 && fireT < 0.62);
    if (current === 'thermite') {
      const f = flicker(31, 13.7);
      thermTip.emissiveIntensity = 3 * f;
      thermGlow.scale.setScalar(0.045 * f);
      vmGlow.setRGB(0.12 * f, 0.05 * f, 0.01 * f);
    } else cutLed.emissiveIntensity = (time % 1.2) < 0.1 ? 4 : 0.1;
  } else if (current === 'incendiary') {
    const thrown = firedWith === 'incendiary' && fireT < 1.3;
    if (thrown) {
      const k = key3(fireT, THROW);
      g.rotation.x += k[0]; g.position.y = k[2]; g.position.z = k[3];
    }
    g.visible = !(thrown && fireT > 0.3 && fireT < 0.9);
    const f = flicker(23, 9.7);
    flame.scale.set(0.036 * (0.92 + 0.08 * f), 0.07 * f, 1);
    flameCore.scale.set(0.016, 0.034 * f, 1);
    if (g.visible) vmGlow.setRGB(0.5 * f, 0.2 * f, 0.04 * f);
  } else if (current === 'wrecker') {
    const t = firedWith === 'wrecker' ? fireT : 99;
    const push = t < 0.08 ? easing.cubicOut(t / 0.08) : t < 0.45 ? 1 : t < 0.75 ? 1 - easing.sineInOut((t - 0.45) / 0.3) : 0;
    wreckStick.rotation.set(-0.5 * push, 0, 0.12 * push * Math.sin(t * 30));
    wreckLed.emissiveIntensity = t < 0.75 ? (Math.sin(time * 30) > 0 ? 4 : 0.2) : (time % 1.5) < 0.1 ? 3 : 0.2;
  } else if (current === 'winch') {
    drumSpin *= Math.exp(-dt * 2.2);
    winchDrum.rotation.x -= drumSpin * dt;
    const t = firedWith === 'winch' ? fireT : 99;
    winchHook.visible = t < 0.07 || t > 1.1;
    winchHook.position.z = HOOK_Z - (t < 0.07 ? (t / 0.07) * 0.12 : 0.06 * (1 - easing.cubicOut(Math.min(1, Math.max(0, (t - 1.1) / 0.3)))));
  } else if (current === 'gravgun') {
    spring.damp(gripK, gripping ? 1 : 0, 0.08, dt);
    spring.update(prongK, gripping ? PRONG_SHUT : PRONG_OPEN, 0.05, 0.4, dt);
    const gk = gripK.value, burst = firedWith === 'gravgun' ? Math.exp(-fireT * 7) : 0;
    for (const p of prongs) p.rotation.x = prongK.value;
    const pulse = 0.5 + 0.5 * Math.sin(time * (5 + gk * 20));
    gravCore.emissiveIntensity = 2 + gk * 5 + pulse * (0.8 + gk * 2) + burst * 22;
    gravGlow.scale.setScalar(0.06 + gk * 0.05 + burst * 0.14 + pulse * 0.008);
    if (gk > 0.01) {
      const s = 0.0025 * gk;
      g.position.x += (Math.random() - 0.5) * s;
      g.position.y += (Math.random() - 0.5) * s;
      g.rotation.z += (Math.random() - 0.5) * s * 4;
    }
    vmGlow.setRGB(0.05, 0.25, 0.5).multiplyScalar(0.1 + gk * 0.6 + burst * 3);
  } else if (current === 'grinder' || current === 'saw' || current === 'drill' || current === 'shears' || current === 'plasma' || current === 'torch') {
    animateMachine(g, dt);
  } else if (current === 'megabomb') {
    const t = firedWith === 'megabomb' ? fireT : 99;
    const open = t < 0.18 ? easing.cubicOut(t / 0.18) : t < 0.75 ? 1 : t < 1.05 ? 1 - easing.cubicIn((t - 0.75) / 0.3) : 0;
    megaCover.rotation.x = -1.95 * open;
    megaButton.position.y = t > 0.26 && t < 0.42 ? 0.037 : 0.042;
    const armed = t > 0.26 && t < 2;
    megaLed.emissive.setHex(armed ? 0xff2a10 : 0xffa21e);
    megaLed.emissiveIntensity = armed ? (Math.sin(time * 38) > 0 ? 5 : 0.2) : (time % 1.4) < 0.12 ? 3 : 0.15;
  }
}

function animateMachine(g: THREE.Group, dt: number): void {
  const on = work.on, L = work.load;
  work.spin += dt * (on ? 1 : -0.6) * 3;
  work.spin = Math.min(1, Math.max(0, work.spin));
  const rev = work.spin * (1 - 0.35 * L);
  if (on && current !== 'torch') {
    const s = 0.0012 + 0.004 * L;
    g.position.x += (Math.random() - 0.5) * s;
    g.position.y += (Math.random() - 0.5) * s;
    g.rotation.z += (Math.random() - 0.5) * s * 3;
  }
  if (current === 'grinder') {
    grDisc.rotation.x -= dt * 110 * rev;
    grDiscMat.emissiveIntensity = work.heat * 2.5;
    if (on) g.rotation.x += 0.08 * L;
  } else if (current === 'saw') {
    work.chain = (work.chain + dt * 3 * rev) % 1;
    const n = sawChain.children.length, half = n / 2;
    sawChain.children.forEach((c, i) => {
      const u = ((i % half) / half + work.chain) % 1;
      c.position.set(0, i < half ? 0.037 : -0.037, i < half ? 0.23 - u * 0.46 : -0.23 + u * 0.46);
    });
  } else if (current === 'drill') {
    drillBit.rotation.z -= dt * 40 * rev;
    if (on) g.position.z += Math.sin(time * 280) * 0.002 * L;
  } else if (current === 'shears') {
    const open = 0.5 * (1 - work.close);
    jawA.rotation.x = open;
    jawB.rotation.x = -open;
  } else if (current === 'plasma') {
    const f = on ? flicker(97, 41) : 0;
    plasmaTip.emissiveIntensity = on ? 6 * f : 0;
    plasmaGlow.scale.setScalar(on ? 0.05 * f : 0);
    vmGlow.setRGB(0.5 * f, 0.7 * f, 1.1 * f);
  } else if (current === 'torch') {
    const f = flicker(37, 17);
    const k = on ? (work.lit ? 1.5 : 1) : 0.35;
    torchFlame.scale.set(0.018 * k, 0.07 * k * f, 1);
    torchCore.scale.set(0.007 * k, 0.025 * k * f, 1);
    vmGlow.setRGB(0.15 * k * f, 0.18 * k * f, 0.35 * k * f);
  }
}
