import { vec3 } from 'math';
import type { Vec3, ToolReadout } from '../../types';
import { raycast } from '../../physics/physics';
import { pieceOf } from '../../destruction/structure';
import { vehicleOf } from '../../vehicles/vehicle';
import { audio } from '../../audio/audio';
import { fx } from '../../render/fx';
import { hitmarker } from '../../ui/ui';
import { viewmodel } from '../../render/viewmodel';
import { NO_HIT, toolHooks } from './common';
import {
  LINES, makeLine, makeStake, faceStake, anchorOn, releaseLine, pickLine, linesOf, lineBar, inSnapZone, GROUND, type Anchor, type LineKind,
} from './lines';

/* Rigging lines: tie any two things together — a member to a member, to a vehicle's towing eye, or to a ground anchor
   (a 3-2-1 picket holdfast, good for ~18 kN before it ploughs out). Click one end, then the other; the line is made
   fast hand-tight, 20 cm slack. Several lines from the top of a wall to one truck is the classic pull-down: drive off
   and they all come tight together (keep the truck at least twice the wall's height away). A line tied off to the
   ground on the far side of a member stops it swinging into what stands next to it. The wheel picks the line: 16 mm
   wire rope (stiff, 178.6 kN), 22 mm nylon kinetic rope (stretches up to 30 %, stores a run-up and gives it back as a
   snatch, 127 kN), 13 mm G80 chain (no stretch below its proof load, 212 kN, heavy: it hangs in a deep curve). */
export const TETHER_REACH = 6;
export const MAX_TETHERS = 8;
const MAX_LEN = 40;
const SLACK = 0.2;
const KINDS: LineKind[] = ['wire16', 'nylon', 'chain13'];
let pick = 0;
let first: { anchor: Anchor; at: Vec3; what: string } | null = null;

export const tetherKind = (): LineKind => KINDS[pick];

export function tetherWheel(dir: number): string {
  pick = (pick + (dir > 0 ? 1 : KINDS.length - 1)) % KINDS.length;
  const s = LINES[KINDS[pick]];
  viewmodel.rig({ coil: s.color, chain: s.look === 'chain', fibre: s.look === 'fibre' });
  return `${s.name}: breaks at ${Math.round(s.mbl / 1000)} kN, ${s.spring ? `stretches ~${Math.round(s.stretch * 100)} %` : 'no stretch to speak of'}, ${s.kg} kg/m`;
}

/* What the aim is on: a member, a vehicle (its chassis takes the line) or the ground. */
function aimEnd(eye: Vec3, fwd: Vec3): { anchor: Anchor; at: Vec3; what: string } | string {
  const hit = raycast(eye, [fwd[0] * TETHER_REACH, fwd[1] * TETHER_REACH, fwd[2] * TETHER_REACH], NO_HIT);
  if (!hit) return `Rigging line — tie to a member, a vehicle or the ground within ${TETHER_REACH} m`;
  const at = hit.point as Vec3;
  const piece = pieceOf(hit.entity);
  if (piece) {
    const v = vehicleOf(piece);
    if (v) return { anchor: anchorOn(v.chassis, at), at: [...at], what: 'the vehicle' };
    return { anchor: anchorOn(piece, at), at: [...at], what: `the ${piece.mat}` };
  }
  if (hit.entity?.kind === 'ground' || !hit.entity) return { anchor: anchorOn(null, [at[0], at[1] + 0.12, at[2]]), at: [at[0], at[1] + 0.12, at[2]], what: 'a ground anchor' };
  return 'That will not take a line';
}

/** LMB: the first end, then the second. Returns why not (nothing is used up then). */
export function tetherFire(eye: Vec3, fwd: Vec3): string | null {
  const e = aimEnd(eye, fwd);
  if (typeof e === 'string') return e;
  if (!first) {
    if (linesOf('tether').length >= MAX_TETHERS) return `${MAX_TETHERS} lines rigged — RMB on one to cast it off`;
    first = e;
    audio.chargeStick(e.at);
    toolHooks.notify(`${LINES[KINDS[pick]].name} made fast to ${e.what} — now the other end (RMB lets go)`);
    return null;
  }
  const a0 = first.anchor, b0 = e.anchor;
  if (!a0.piece && !b0.piece) return 'Both ends on the ground: tie one to something';
  if (a0.piece && a0.piece === b0.piece) return 'Both ends on the same member';
  const len = vec3.distance(first.at, e.at);
  if (len > MAX_LEN) return `${Math.round(len)} m apart — the line is ${MAX_LEN} m`;
  if (len < 0.4) return 'The ends are touching';
  // the ground anchor is always end a (a static body end)
  const [a, b] = !b0.piece ? [b0, a0] : [a0, b0];
  const stake = !a.piece ? makeStake(a.local) : null;
  if (stake) faceStake(stake, b0 === a ? first.at : e.at);
  const L = makeLine(KINDS[pick], 'tether', a, b, len + SLACK, { stake });
  audio.chargeStick(e.at);
  fx.sparks(e.at, [0, 1, 0], L.spec.look === 'fibre' ? 0 : 5);
  hitmarker(0.4);
  toolHooks.notify(`${L.spec.name} rigged, ${len.toFixed(1)} m · ${linesOf('tether').length}/${MAX_TETHERS}`);
  first = null;
  return null;
}

/** RMB: let go of a half-made line, else cast off the line under the crosshair (or the newest). */
export function tetherSecondary(eye: Vec3, fwd: Vec3): boolean {
  if (first) { first = null; audio.ui('click'); toolHooks.notify('Let go of the loose end'); return true; }
  const hit = pickLine(eye, fwd, 12);
  const L = hit && (hit.L.owner === 'tether' || hit.L.owner === 'grapple') ? hit.L : linesOf('tether').at(-1);
  if (!L) return false;
  const T = L.tension * L.parts;
  if (T > 0.05 * L.spec.mbl) {
    toolHooks.notify(`That line carries ${Math.round(T / 1000)} kN — slack it off first, or cut it (and stand clear)`);
    audio.ui('deny');
    return true;
  }
  releaseLine(L, 'off');
  audio.ui('click');
  return true;
}

export function tetherPending(): Vec3 | null { return first ? first.at : null; }

export function tetherStatus(): ToolReadout {
  const s = LINES[KINDS[pick]];
  const mine = [...linesOf('tether'), ...linesOf('grapple')];
  const zone = inSnapZone();
  const lines = mine.map(L => lineBar(L, L.spec.name.replace(/ (wire rope|kinetic rope|chain|line)$/, '')));
  if (first) return { title: `Rigging line · ${s.name}`, progress: null, detail: 'one end made fast — LMB the other end (a member, a vehicle, the ground) · RMB lets go', warn: false, lines };
  const worst = lines.reduce((m, l) => Math.max(m, l.util), 0);
  return {
    title: `Rigging line · ${s.name} · ${mine.length}/${MAX_TETHERS}`,
    // while any line carries load the readout stays up (tags: kN and % of the line's WLL)
    progress: lines.length && worst > 0.01 ? Math.min(1, worst) : null,
    detail: zone
      ? `you are in the snap-back path of the ${zone.L.spec.name} (${Math.round(zone.util * 100)} % of its WLL) — a parted line flies back past its anchor: get out of line with it`
      : `LMB one end, LMB the other · wheel: wire / nylon / chain · RMB casts off · WLL ${Math.round(s.wll / 1000)} kN, break ${Math.round(s.mbl / 1000)} kN · ground anchor ~${Math.round(GROUND.picket / 1000)} kN`,
    warn: !!zone,
    lines,
  };
}

export function clearTether(): void { first = null; }
