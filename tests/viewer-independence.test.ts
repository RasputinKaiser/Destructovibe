import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The same blast must come out the same whoever watches it and however fast frames are drawn: a player 5 m from the
   chapel with a frame every step, and one 60 m off drawing a frame every third step, see one collapse. Runs the game's
   own per-step / per-frame path headless (scripts/sim.mjs) and compares every body's final position. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(viewer: string, spf: number): Promise<{ fingerprint: string; weldsLost: number; line: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [join(ROOT, 'scripts/sim.mjs'), 'S', '200', '-60.5,1.2,-8,5'], {
      cwd: ROOT, env: { ...process.env, VIEWER: viewer, SPF: String(spf) }, maxBuffer: 64 << 20, timeout: 540_000,
    }, (err, stdout) => {
      if (err) return reject(err);
      const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
      if (!line) return reject(new Error('no RESULT line'));
      const r = JSON.parse(line.slice(7));
      resolve({ fingerprint: r.fingerprint, weldsLost: r.weldsLost, line });
    });
  });
}

test('a blast plays out identically for a near and a far viewer, at any frame rate', {
  timeout: 600_000,
  todo: 'known bug E10: detail LOD / frame slicing still feed the simulation (near and far viewers diverge)',
}, async () => {
  const [near, far] = await Promise.all([run('-66.5,1.7,-8', 1), run('-121,1.7,-8', 3)]);
  assert.ok(near.weldsLost > 0, `the blast broke nothing: ${near.line}`);
  assert.equal(far.fingerprint, near.fingerprint, `near ${near.line}\nfar  ${far.line}`);
});
