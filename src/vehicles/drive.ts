import type { Vec3 } from '../types';
import { vehicles, setDriven, vehiclePoint, vehicleState, type Vehicle } from './vehicle';
import { rot } from './math';

/* The player at the wheel. main.ts owns the camera and the player body; this owns the controls and says where the
   camera should be. Right-hand drive: the driver's door is on the vehicle's right. */

export const driving = {
  vehicle: null as Vehicle | null,
  view: 'chase' as 'chase' | 'cab',
  /** mouse look relative to the vehicle heading, rad */
  yaw: 0,
  pitch: -0.12,
};

function halfWidth(v: Vehicle): number {
  return Math.max(...v.wheels.map(w => Math.abs(w.z))) + 0.25;
}

function door(v: Vehicle): Vec3 {
  return vehiclePoint(v, v.pre.eye[0], 1.0, halfWidth(v) + 0.2);
}

/** The vehicle whose driver's door is within `reach` m of the eye, if any (offer "E — drive"). */
export function vehicleNear(eye: Vec3, reach = 2.2): Vehicle | null {
  let best: Vehicle | null = null, bd = reach * reach;
  for (const v of vehicles) {
    if (!v.alive || v.chassis.dead || v.wheels.filter(w => w.attached).length < 3) continue;
    const d = door(v), dx = d[0] - eye[0], dy = d[1] - eye[1], dz = d[2] - eye[2], q = dx * dx + dy * dy * 0.25 + dz * dz;
    if (q < bd) { bd = q; best = v; }
  }
  return best;
}

export function enterVehicle(v: Vehicle): void {
  driving.vehicle = v;
  driving.yaw = 0;
  driving.pitch = -0.12;
  setDriven(v);
}

/** Leave the vehicle with the parking brake on; returns where the driver stands (beside the door, at road level). */
export function exitVehicle(): Vec3 | null {
  const v = driving.vehicle;
  driving.vehicle = null;
  setDriven(null);
  if (!v) return null;
  v.driven = false;
  v.engineOn = false;
  v.gear = 0;
  const p = vehiclePoint(v, v.pre.eye[0], 0.05, halfWidth(v) + 0.7);
  return [p[0], Math.max(0.05, p[1]), p[2]];
}

/** Keys, once per frame while driving: W/↑ throttle, S/↓ brake (reverse from a stop), A/D steer, Space handbrake,
    C swaps chase and cab view. Keyboard steering eases in so a tap is a small correction. */
export function driveControls(down: ReadonlySet<string>, pressed: ReadonlySet<string>, dt: number): void {
  const v = driving.vehicle;
  if (!v) return;
  if (v.chassis.dead || !v.alive) { exitVehicle(); return; }
  if (pressed.has('KeyC')) driving.view = driving.view === 'chase' ? 'cab' : 'chase';
  const fwd = down.has('KeyW') || down.has('ArrowUp'), back = down.has('KeyS') || down.has('ArrowDown');
  const st = (down.has('KeyD') || down.has('ArrowRight') ? 1 : 0) - (down.has('KeyA') || down.has('ArrowLeft') ? 1 : 0);
  const c = v.controls;
  if (Math.abs(v.speed) < 0.8) {
    if (back && !fwd && v.gear >= 0) v.gear = -1;
    else if (fwd && !back && v.gear <= 0) v.gear = 1;
  }
  const rev = v.gear < 0;
  c.throttle = (rev ? back : fwd) ? 1 : 0;
  c.brake = (rev ? fwd : back) ? 1 : 0;
  const k = Math.min(1, dt * (st === 0 ? 6 : 3));
  c.steer += (st - c.steer) * k;
  c.hand = down.has('Space');
}

/** Mouse look while driving (radians of yaw and pitch, as the on-foot look). */
export function driveLook(dYaw: number, dPitch: number): void {
  driving.yaw = Math.max(-Math.PI, Math.min(Math.PI, driving.yaw + dYaw));
  driving.pitch = Math.max(-1.2, Math.min(0.6, driving.pitch + dPitch));
}

const _f: Vec3 = [0, 0, 0];

/** Camera for this frame: eye position and a point to look at (interpolated between physics steps by alpha). */
export function driveCamera(alpha: number, eye: Vec3, look: Vec3): boolean {
  const v = driving.vehicle;
  if (!v) return false;
  const c = v.chassis;
  const lerp = (i: number) => c.prevPos[i] + (c.curPos[i] - c.prevPos[i]) * alpha;
  const ox = lerp(0) - c.curPos[0], oy = lerp(1) - c.curPos[1], oz = lerp(2) - c.curPos[2];
  rot(_f, c.curRot, v.fL);
  const h = Math.atan2(_f[2], _f[0]) + driving.yaw, cp = Math.cos(driving.pitch);
  const dx = Math.cos(h) * cp, dz = Math.sin(h) * cp, dy = Math.sin(driving.pitch);
  if (driving.view === 'cab') {
    const e = vehiclePoint(v, v.pre.eye[0], v.pre.eye[1], v.pre.eye[2]);
    eye[0] = e[0] + ox; eye[1] = e[1] + oy; eye[2] = e[2] + oz;
    look[0] = eye[0] + dx; look[1] = eye[1] + dy; look[2] = eye[2] + dz;
    return true;
  }
  const L = Math.max(...v.wheels.map(w => Math.abs(w.x))) + 2.5, H = Math.max(2, v.pre.eye[1]);
  const t = vehiclePoint(v, 0, H * 0.7, 0);
  look[0] = t[0] + ox; look[1] = t[1] + oy; look[2] = t[2] + oz;
  const dist = L + 3;
  eye[0] = look[0] - dx * dist; eye[1] = Math.max(0.5, look[1] - dy * dist + 1.2); eye[2] = look[2] - dz * dist;
  return true;
}

/** HUD readout while driving. */
export function driveHud(): ReturnType<typeof vehicleState> | null {
  return driving.vehicle ? vehicleState(driving.vehicle) : null;
}
