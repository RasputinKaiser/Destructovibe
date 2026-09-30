import test from 'node:test';
import assert from 'node:assert/strict';
import { footStep, airStep, jumpSpeed, jumpArc, JUMP_H, landing, hitTier, SPEED, FALL_G, G } from '../src/game/move/kinematics.ts';

const DT = 1 / 60;
const v: [number, number] = [0, 0];

/** seconds of stepping, wishing along +x at `target`, until speed crosses `until` (or the step count runs out) */
function timeTo(start: number, wishX: number, target: number, until: (s: number) => boolean, max = 240): number {
  let vx = start, vz = 0;
  for (let i = 1; i <= max; i++) {
    footStep(v, vx, vz, wishX, 0, target, DT);
    vx = v[0]; vz = v[1];
    if (until(vx)) return i * DT;
  }
  return Infinity;
}

test('ground speed builds and bleeds like a person, not a cursor', () => {
  const walk = timeTo(0, 1, SPEED.jog, s => s >= 0.9 * SPEED.jog);
  assert.ok(walk > 0.12 && walk < 0.3, `jog 0→90 % in ${walk} s`);
  const sprint = timeTo(0, 1, SPEED.sprint, s => s >= 0.9 * SPEED.sprint);
  assert.ok(sprint > 0.45 && sprint < 0.9, `sprint 0→90 % in ${sprint} s`);
  const stop = timeTo(SPEED.jog, 0, 0, s => s <= 0.01);
  assert.ok(stop > 0.12 && stop < 0.3, `jog stop in ${stop} s`);
  const stopSprint = timeTo(SPEED.sprint, 0, 0, s => s <= 0.01);
  assert.ok(stopSprint > 0.25 && stopSprint < 0.5, `sprint stop in ${stopSprint} s`);
  const reverse = timeTo(SPEED.jog, -1, SPEED.jog, s => s <= -0.8 * SPEED.jog);
  assert.ok(reverse > 0.15 && reverse < 0.4, `reversal in ${reverse} s`);
});

test('ground speed never overshoots the gait and a turn keeps no sideways skid', () => {
  let vx = 0, vz = 0;
  for (let i = 0; i < 120; i++) { footStep(v, vx, vz, 1, 0, SPEED.jog, DT); vx = v[0]; vz = v[1]; assert.ok(Math.hypot(vx, vz) <= SPEED.jog + 1e-9); }
  // hard left: the old +x drift must be gone within a few tenths of a second
  for (let i = 0; i < 24; i++) { footStep(v, vx, vz, 0, 1, SPEED.jog, DT); vx = v[0]; vz = v[1]; }
  assert.ok(Math.abs(vx) < 1e-6, `drift left after 0.4 s: ${vx}`);
  assert.ok(Math.abs(vz - SPEED.jog) < 1e-6);
});

test('air steering never adds speed past takeoff (no strafe-jump gain)', () => {
  let vx = 5, vz = 0;
  for (let i = 0; i < 60; i++) {
    airStep(v, vx, vz, Math.cos(i), Math.sin(i), SPEED.jog, DT);
    vx = v[0]; vz = v[1];
    assert.ok(Math.hypot(vx, vz) <= 5 + 1e-9);
  }
});

test('a standing jump is a real one: ~0.48 m and a bit over half a second in the air', () => {
  const vj = jumpSpeed(JUMP_H);
  const arc = jumpArc(vj);
  assert.ok(Math.abs(arc.height - JUMP_H) < 1e-9);
  assert.ok(arc.air > 0.5 && arc.air < 0.65, `airtime ${arc.air}`);
  assert.ok(arc.apex < arc.air / 2 + 0.03, 'the fall is not slower than the rise');
  // on the moon slider the same legs go higher and hang longer
  const low = jumpArc(jumpSpeed(JUMP_H, G * 0.5), G * 0.5);
  assert.ok(low.air > arc.air * 1.3);
});

test('landings grade from nothing to a blackout with the height fallen', () => {
  const at = (h: number, mode: 'off' | 'stumble' | 'real' = 'real', crouched = false) => landing(Math.sqrt(2 * FALL_G * G * h), crouched, mode);
  assert.equal(at(0.5).tier, 'soft');
  assert.equal(at(1.8).tier, 'hard');
  assert.equal(at(3.2).tier, 'stumble');
  assert.equal(at(6).tier, 'knockdown');
  assert.equal(at(12).tier, 'fatal');
  assert.equal(at(12, 'stumble').tier, 'knockdown');
  assert.equal(at(12, 'off').tier, 'hard');
  assert.ok(Math.abs(at(3).drop - 3) < 1e-9);
  // tucking in takes something off
  assert.ok(at(3, 'real', true).drop < at(3).drop);
  // deeper dips and longer knockdowns from higher up
  assert.ok(at(1).dip < at(3).dip && at(3).dip <= at(8).dip);
  assert.ok(at(5).down < at(8).down);
});

test('blows: a thrown brick staggers, a slab from above is the end', () => {
  assert.equal(hitTier(20, false, 3, 'real'), 'none');
  assert.equal(hitTier(50, true, 6, 'real'), 'stagger');
  assert.equal(hitTier(400, false, 200, 'real'), 'knockdown');
  assert.equal(hitTier(700, true, 700, 'real'), 'fatal');
  assert.equal(hitTier(700, true, 700, 'stumble'), 'knockdown');
  assert.equal(hitTier(700, true, 700, 'off'), 'stagger');
});
