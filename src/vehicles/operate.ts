import type { Vec3 } from '../types';
import { live, hoistRope, hoistOf, type Piece } from '../destruction/structure';
import { machineParts, mechCommand, mechPose, mechGauge, rigState } from '../destruction/services';
import { vehicleOf } from './vehicle';

/* The player at a machine's controls (a crane, an excavator, any plant with driven axes that is not a road vehicle):
   E at the machine takes the seat, E again leaves it. Each lever runs one axis through its own valve or drive at up
   to its flow-limited speed, the load held when the lever is centred; the machine's own work cycle stops while an
   operator has it and picks up again when they leave. Road vehicles with driven gear (forklift mast, tipper body)
   take R / F while being driven. */

export interface Machine { root: Piece; axes: Piece[]; hoist: Piece | null; all: Piece[]; name: string }

export const operating = {
  machine: null as Machine | null,
  /** camera orbit about the machine: yaw, pitch (rad) */
  yaw: 0,
  pitch: -0.25,
};

const LEVER_RATE = 3;        // lever travel per second: a tap is a nudge
const HOIST_SPEED = 0.6;     // m/s line speed
const lever = [0, 0, 0, 0];

const NAMES: Record<string, string[]> = {
  excavator: ['slew', 'boom', 'stick', 'bucket'],
  mobilecrane: ['slew', 'luff'],
  crane: ['slew', 'trolley'],
  forklift: ['mast', 'carriage'],
  dumptruck: ['body'],
};

function nameOf(p: Piece): string {
  return p.root.spec.group ?? 'machine';
}

/** The nearest machine with driven axes (not a road vehicle) whose moving parts are within `reach` m of the eye. */
export function machineNear(eye: Vec3, reach = 5): { m: Machine; d: number } | null {
  let best: Piece | null = null, bd = reach * reach;
  for (const p of live) {
    if (p.dead || !p.hinged || !p.mechs) continue;
    const dx = p.curPos[0] - eye[0], dy = p.curPos[1] - eye[1], dz = p.curPos[2] - eye[2], d = dx * dx + dy * dy + dz * dz;
    if (d < bd && p.mechs.some((m) => m.part === p && m.drive)) { bd = d; best = p; }
  }
  if (!best) return null;
  const { all, axes } = machineParts(best);
  if (!axes.length || all.some((q) => vehicleOf(q))) return null;
  let hoist: Piece | null = null;
  for (const q of all) if (q.ropes.length && hoistOf(q)) { hoist = q; break; }
  const root = all.find((q) => !q.hinged) ?? best;
  return { m: { root, axes, hoist, all, name: nameOf(best) }, d: Math.sqrt(bd) };
}

export function enterMachine(m: Machine): void {
  operating.machine = m;
  operating.yaw = 0;
  operating.pitch = -0.25;
  lever.fill(0);
  for (const p of m.axes) mechCommand(p, 0);
}

/** Leave the controls: every axis goes back to the machine's own cycle. Returns where the operator steps down. */
export function exitMachine(): Vec3 | null {
  const m = operating.machine;
  operating.machine = null;
  if (!m) return null;
  for (const p of m.axes) if (!p.dead) mechCommand(p, null);
  const r = m.root;
  return [r.curPos[0] + 2.5, Math.max(0.1, r.curPos[1] - 1), r.curPos[2] + 2.5];
}

const KEYS: [string, string][] = [['KeyD', 'KeyA'], ['KeyW', 'KeyS'], ['KeyR', 'KeyF'], ['KeyT', 'KeyG']];

/** Keys, once per frame at the controls: A/D slew (first axis), W/S the second (boom, luff, trolley), R/F the third,
    T/G the fourth; Space pays the hoist line out, C hauls it in. */
export function operateControls(down: ReadonlySet<string>, dt: number): void {
  const m = operating.machine;
  if (!m) return;
  if (m.root.dead || m.axes.every((p) => p.dead)) { exitMachine(); return; }
  m.axes.forEach((p, i) => {
    if (i >= KEYS.length || p.dead) return;
    const want = (down.has(KEYS[i][0]) ? 1 : 0) - (down.has(KEYS[i][1]) ? 1 : 0);
    const k = Math.min(1, dt * LEVER_RATE * (want === 0 ? 2 : 1));
    lever[i] += (want - lever[i]) * k;
    if (Math.abs(lever[i]) < 0.02 && want === 0) lever[i] = 0;
    mechCommand(p, lever[i]);
  });
  if (m.hoist) {
    const h = (down.has('Space') ? 1 : 0) - (down.has('KeyC') ? 1 : 0);
    if (h) hoistRope(m.hoist, h * HOIST_SPEED * dt);
  }
}

/** Mouse orbit round the machine while operating. */
export function operateLook(dYaw: number, dPitch: number): void {
  operating.yaw += dYaw;
  operating.pitch = Math.max(-1.2, Math.min(0.3, operating.pitch + dPitch));
}

/** Camera while operating: behind and above the machine, orbiting with the mouse. */
export function operateCamera(eye: Vec3, look: Vec3): boolean {
  const m = operating.machine;
  if (!m) return false;
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of m.all) {
    if (q.dead) continue;
    x0 = Math.min(x0, q.curPos[0]); x1 = Math.max(x1, q.curPos[0]); y1 = Math.max(y1, q.curPos[1]);
    z0 = Math.min(z0, q.curPos[2]); z1 = Math.max(z1, q.curPos[2]);
  }
  const span = Math.max(6, Math.hypot(x1 - x0, z1 - z0));
  look[0] = (x0 + x1) / 2; look[1] = Math.min(y1, m.root.curPos[1] + span * 0.3); look[2] = (z0 + z1) / 2;
  const d = span * 1.2, cp = Math.cos(operating.pitch);
  eye[0] = look[0] - Math.sin(operating.yaw) * cp * d;
  eye[1] = Math.max(1.5, look[1] - Math.sin(operating.pitch) * d);
  eye[2] = look[2] + Math.cos(operating.yaw) * cp * d;
  return true;
}

/** Operator's readout: each axis's position and state, the hoist line and, on outriggers, the load-moment margin. */
export function operateHud(): string | null {
  const m = operating.machine;
  if (!m) return null;
  const names = NAMES[m.name] ?? [];
  const keys = ['A/D', 'W/S', 'R/F', 'T/G'];
  const parts = m.axes.slice(0, 4).map((p, i) => {
    const ps = mechPose(p), g = mechGauge(p);
    const at = ps ? (ps.hinge ? `${Math.round((ps.at * 180) / Math.PI)}°` : `${ps.at.toFixed(2)} m`) : '—';
    const flag = !g ? '' : g.cut ? ' HOSE BURST' : g.burnt ? ' MOTOR BURNT OUT' : g.tripped ? ' TRIPPED' : g.stalled ? ' STALLED' : '';
    return `${keys[i]} ${names[i] ?? `axis ${i + 1}`} ${at}${flag}`;
  });
  if (m.hoist) {
    const h = hoistOf(m.hoist);
    if (h) parts.push(`Space/C hoist ${h.length.toFixed(1)} m${h.taut ? ' taut' : ''}`);
  }
  const rig = rigState(m.root);
  if (rig) parts.push(rig.margin < 0 ? 'TIPPING' : `load ${(rig.load / 1000).toFixed(1)} t · CG ${rig.margin.toFixed(2)} m inside the outriggers${rig.margin < 0.4 ? ' — OVERLOAD' : ''}`);
  return `${m.name.toUpperCase()} · ${parts.join(' · ')} · E leave`;
}

/** R / F raise and lower whatever a driven road vehicle carries on its own drives (forklift mast, tipper body). */
export function vehicleGear(chassis: Piece, down: ReadonlySet<string>): string | null {
  const { axes } = machineParts(chassis);
  if (!axes.length) return null;
  const want = (down.has('KeyR') ? 1 : 0) - (down.has('KeyF') ? 1 : 0);
  for (const p of axes) mechCommand(p, p.root.spec.mech?.lower === undefined ? null : want);
  return 'R/F ' + (axes.some((p) => p.root.spec.mech?.kind === 'slider') ? 'mast' : 'body');
}

/** Hand a vehicle's gear back to its own cycle when the driver gets out. */
export function releaseVehicleGear(chassis: Piece): void {
  for (const p of machineParts(chassis).axes) mechCommand(p, null);
}
