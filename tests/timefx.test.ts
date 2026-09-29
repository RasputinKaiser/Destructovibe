import test from 'node:test';
import assert from 'node:assert/strict';
import { hitstop, simScale, toggleBulletTime, bulletTime, resetTime } from '../src/game/timefx.ts';

test('hitstop freezes the world for its duration, then real time resumes', () => {
  resetTime();
  hitstop(0.05);
  assert.ok(simScale(0.016) < 0.1);
  assert.ok(simScale(0.016) < 0.1);
  simScale(0.03);
  assert.equal(simScale(0.016), 1);
});

test('hitstop is clamped short and the deepest request wins', () => {
  resetTime();
  hitstop(5, 0.2);
  hitstop(0.01, 0.05);
  let t = 0;
  while (simScale(0.01) < 1 && t < 1) t += 0.01;
  assert.ok(t <= 0.13, `held ${t} s`);
});

test('bullet time eases toward 0.3x and back', () => {
  resetTime();
  assert.equal(toggleBulletTime(), true);
  assert.equal(bulletTime(), true);
  let k = 1;
  for (let i = 0; i < 60; i++) k = simScale(1 / 60);
  assert.ok(Math.abs(k - 0.3) < 0.02, `k ${k}`);
  toggleBulletTime();
  for (let i = 0; i < 60; i++) k = simScale(1 / 60);
  assert.ok(Math.abs(k - 1) < 0.02, `k ${k}`);
  resetTime();
});
