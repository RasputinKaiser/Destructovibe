import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* The excavator remote takes over the nearest machine on the site however far off it is, and in free play a site with
   none gets one delivered to clear ground near the player. Charges planted on a member that then breaks stay on what
   is left of it or go back in the bag: once the sequence has fired, nothing is left counted as armed. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function harness() {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 16);
  const noop: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
  g.document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => noop }) };
  const req = createRequire(join(ROOT, 'package.json'));
  const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
  const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  const L = (p: string) => server.ssrLoadModule(p);
  const THREE = await L('three');
  const phys = await L('/src/physics/physics.ts');
  const st = await L('/src/destruction/structure.ts');
  const { initFx } = await L('/src/render/fx.ts');
  const w = await L('/src/game/weapons.ts');
  const exc = await L('/src/game/tools/excavator.ts');
  const { excavator } = await L('/src/levels/machines.ts');
  const { stand } = await L('/src/levels/maps/ground.ts');
  const scene = new THREE.Scene();
  initFx(scene, new THREE.PerspectiveCamera());
  await phys.initPhysics();
  st.initStructures(scene);
  w.initWeapons(scene);
  const notes: string[] = [];
  w.setWeaponHooks((m: string) => notes.push(m));
  const handlers = {
    hit: (a: unknown, b: unknown, p: number[], n: number[], s: number) => { st.onHit(a, b, p, n, s); w.onProjectileHit(a, b, p, s, n); },
    begin() {},
    jointBroken: (id: unknown) => st.onJointBroken(id),
  };
  const fresh = (pieces: unknown[]) => {
    st.clearStructures();
    w.clearWeapons();
    phys.createWorld();
    st.buildBlueprint({ pieces: [] });
    if (pieces.length) st.spawnPieces(pieces);
  };
  const step = (n: number) => {
    for (let i = 0; i < n; i++) { w.weaponsPreStep(); phys.step(handlers); st.afterStep(phys.FIXED_DT); w.weaponsAfterStep(phys.FIXED_DT); }
  };
  return { server, phys, st, w, exc, excavator, stand, notes, fresh, step };
}

test('excavator remote links a machine anywhere on the site; free play delivers one', { timeout: 300_000 }, async () => {
  const h = await harness();
  try {
    const eye = [0, 1.7, 0], east = [1, 0, 0];
    /* a contract site with its machine 150 m off: linked on the first press */
    h.fresh(h.stand(h.excavator({ x: 150, z: 0 }), 0));
    h.step(40);
    h.w.setLoadout({ hammer: -1, excavator: -1 }, 'excavator');
    assert.equal(h.exc.excavatorHold(eye, east, true), null, h.notes.join(' | '));
    const house = h.exc.excavatorLinked();
    assert.ok(house, 'not linked');
    assert.ok(Math.abs(house.curPos[0] - 150) < 3, `linked the wrong machine at ${house.curPos}`);
    assert.match(h.notes.at(-1) ?? '', /Excavator linked, 150 m E/);

    /* a contract site with none: no delivery off free play */
    h.fresh([]);
    h.w.setLoadout({ hammer: -1, excavator: -1 }, 'excavator');
    assert.match(h.exc.excavatorHold(eye, east, true) ?? '', /No excavator on this site$/);
    assert.match(h.exc.excavatorHold(eye, east, true) ?? '', /No excavator on this site$/);

    /* free play with none: the first press offers, the second delivers onto clear ground ahead, the next takes over */
    h.fresh([{ mat: 'brick', size: [3, 3, 3], pos: [10.5, 1.501, 0], anchored: true }]);
    h.step(40);
    h.w.setLoadout(Object.fromEntries(h.w.WEAPONS.map((x: { id: string }) => [x.id, -1])), 'excavator');
    assert.match(h.exc.excavatorHold(eye, east, true) ?? '', /fire again to have one delivered/);
    assert.equal(h.exc.excavatorHold(eye, east, true), null);
    assert.match(h.notes.at(-1) ?? '', /Excavator delivered, \d+ m/);
    h.step(45);
    assert.equal(h.exc.excavatorHold(eye, east, true), null, h.notes.join(' | '));
    const got = h.exc.excavatorLinked();
    assert.ok(got, 'the delivered machine was not linked');
    const d = Math.hypot(got.curPos[0], got.curPos[2]);
    assert.ok(d >= 8 && d <= 45, `delivered ${d.toFixed(1)} m away`);
    // not dropped on the brick block in the way
    assert.ok(Math.hypot(got.curPos[0] - 10.5, got.curPos[2]) > 3, `delivered onto the block at ${got.curPos}`);
  } finally {
    await h.server.close();
  }
});

test('charges on a member that breaks stay on what is left or go back; none stays armed after firing', { timeout: 300_000 }, async () => {
  const h = await harness();
  try {
    /* a pier of four brick lifts; three charges thrown onto the lowest, then the lift is shot out from under them */
    const lift = (y: number) => ({ mat: 'brick', size: [1.2, 1, 1.2], pos: [0, y + 0.501, 0], anchored: y === 0 });
    h.fresh([lift(0), lift(1), lift(2), lift(3)]);
    h.step(40);
    h.w.setLoadout({ hammer: -1, charge: 8 }, 'charge');
    for (const [y, z] of [[0.4, -0.3], [0.6, 0.3], [0.8, 0]]) h.w.launch('charge', [-6, y, z], [30, 1.5, 0]);
    h.step(30);
    assert.equal(h.w.chargesPlaced(), 3, 'three charges should be stuck on the pier');
    const low = [...h.st.live].find((p: { root: { spec: { pos: number[] } }; dead: boolean }) => !p.dead && p.root.spec.pos[1] < 1);
    h.st.damagePiece(low, [-0.6, 0.5, 0], 1e9, false);
    h.step(20);
    assert.ok(low.dead, 'the lift under the charges did not break');
    const held = h.w.weaponsDebug().flying.filter((f: { type: string; stuck: boolean }) => f.type === 'charge');
    assert.ok(held.every((f: { stuck: boolean }) => f.stuck), 'a charge lies loose instead of staying on the member or going back');
    assert.equal(h.w.chargesPlaced(), held.length);
    assert.equal(h.w.loadout.ammo.charge, 8 + (3 - held.length), 'charges that fell off were not returned'); // launch() spends none
    if (held.length) assert.ok(h.w.detonate(), 'detonate refused with charges armed');
    h.step(180);
    assert.equal(h.w.chargesPlaced(), 0, 'charges still counted as armed after firing');
    assert.equal(h.w.weaponsDebug().flying.filter((f: { type: string }) => f.type === 'charge').length, 0, 'a charge is left in the world after firing');
    assert.equal(h.w.liveOrdnance(), 0, 'live ordnance left after firing');
  } finally {
    await h.server.close();
  }
});
