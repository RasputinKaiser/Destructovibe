/* Each tool's controls, as the prompt row under its readout shows them. The buttons are named, not spelled out: the
   HUD puts in the player's own key for detonate and the pad's buttons when a pad is in use. */
import type { WeaponId } from '../types';

/** fire = LMB / RT, alt = RMB / LT, wheel = mouse wheel / bumpers, det = the detonate key (alt also detonates there) */
export type Btn = 'fire' | 'hold' | 'alt' | 'wheel' | 'det';
export type Help = readonly (readonly [Btn, string])[];

const CUT: Help = [['hold', 'Cut the member']];
const SHOOT: Help = [['fire', 'Fire']];

export const TOOL_HELP: Record<WeaponId, Help> = {
  hammer: [['hold', 'Wind up, release to strike']],
  cannon: SHOOT,
  rocket: [['fire', 'Fire'], ['alt', 'Warhead']],
  charge: [['fire', 'Place'], ['wheel', 'Size'], ['det', 'Detonate']],
  airstrike: [['fire', 'Throw the smoke']],
  thermite: [['fire', 'Place the pot']],
  cutter: [['fire', 'Place on a member'], ['det', 'Detonate']],
  wrecker: [['fire', 'Rig, then swing'], ['alt', 'Drop the ball'], ['wheel', 'Luff the boom']],
  winch: [['fire', 'Hitch'], ['hold', 'Reel in'], ['alt', 'Cast off'], ['wheel', 'Parts of line']],
  gravgun: [['fire', 'Grab / throw'], ['alt', 'Set down'], ['wheel', 'Distance']],
  incendiary: [['fire', 'Throw']],
  megabomb: [['fire', 'Drop it, then run']],
  grinder: CUT, saw: CUT, drill: [['hold', 'Bore']], shears: [['hold', 'Shear / crush']], plasma: CUT, torch: [['hold', 'Preheat, then cut']],
  planner: [['fire', 'Pick a device / auto-sequence'], ['wheel', 'Delay'], ['det', 'Fire the sequence']],
  excavator: [['hold', 'Work the arm toward aim'], ['alt', 'Dump'], ['wheel', 'Curl the bucket']],
  breaker: [['hold', 'Break concrete or masonry']],
  hose: [['hold', 'Spray'], ['alt', 'Stream / fog']],
  splitter: [['fire', 'Set in a drilled bore']],
  wiresaw: [['fire', 'Rig the wire, then run it'], ['alt', 'Take the rig down']],
  grapple: [['fire', 'Throw the hook'], ['alt', 'Make fast / let go'], ['wheel', 'Pay out / take in']],
  tether: [['fire', 'First end, then second'], ['alt', 'Cast off'], ['wheel', 'Line type']],
  hoist: [['fire', 'Hook the load, hang the hoist'], ['hold', 'Work the lever'], ['alt', 'Let go / take down'], ['wheel', 'Pull / lower / free']],
  flamer: [['hold', 'Burn'], ['alt', 'Igniter on / off']],
  launcher: [['fire', 'Fire'], ['alt', 'Fuze type'], ['wheel', 'Airburst range']],
  recoilless: SHOOT,
  thermobaric: SHOOT,
  buster: [['fire', 'Lase and call it in'], ['wheel', 'Voids to count']],
  satchel: [['fire', 'Press on / throw'], ['det', 'Detonate']],
};
