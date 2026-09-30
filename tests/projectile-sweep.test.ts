import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* Fast ordnance acts on the first solid surface on its path. Every contact-fused round (rocket, bomb, firebomb, thrown
   charge, thermite, megabomb) fired at a half-brick wall at its top speed from square-on to a steep slant must go off or
   stick on the near face, never past it; a rocket whose path only grazes a thin post must still go off on it; a
   cannonball (a plain body, the solver's continuous collision) must not come out behind a wall it did not break; and a
   tandem warhead fired into a hollow stack must set its follow-through off inside the flue, not beyond the far wall. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('projectiles stop or go off at the first surface on their path', { timeout: 300_000 }, async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 16);
  // canvases for the weapon tags: nothing is drawn headless
  const noop: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
  g.document ??= { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => noop }) };
  const req = createRequire(join(ROOT, 'package.json'));
  const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
  const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  try {
    const L = (p: string) => server.ssrLoadModule(p);
    const THREE = await L('three');
    const phys = await L('/src/physics/physics.ts');
    const st = await L('/src/destruction/structure.ts');
    const { initFx } = await L('/src/render/fx.ts');
    const w = await L('/src/game/weapons.ts');
    const scene = new THREE.Scene();
    initFx(scene, new THREE.PerspectiveCamera());
    await phys.initPhysics();
    st.initStructures(scene);
    w.initWeapons(scene);
    const handlers = {
      hit: (a: unknown, b: unknown, p: number[], n: number[], s: number) => { st.onHit(a, b, p, n, s); w.onProjectileHit(a, b, p, s, n); },
      begin() {},
      jointBroken: (id: unknown) => st.onJointBroken(id),
    };
    let booms: number[][] = [];
    st.setStructureHooks((pos: number[]) => booms.push([...pos]), () => {});
    type Flying = { type: string; pos: number[]; stuck: boolean };
    /* a fresh world with `pieces`, one round fired from `from` at `at` (aimed off for its drop), `steps` watched */
    const shoot = (pieces: unknown[], type: string, from: number[], at: number[], speed: number, head = 'he', steps = 75) => {
      st.clearStructures();
      w.clearWeapons();
      phys.createWorld();
      st.buildBlueprint({ pieces: [] });
      st.spawnPieces(pieces);
      for (let i = 0; i < 5; i++) { phys.step(handlers); st.afterStep(phys.FIXED_DT); }
      const s0 = st.stats();
      booms = [];
      const d = at.map((x, k) => x - from[k]);
      const tof = Math.hypot(...d) / speed;
      d[1] += 0.5 * 9.81 * tof * tof;
      const l = Math.hypot(...d);
      w.launch(type, from, d.map((x) => (x / l) * speed), head);
      const seen: Flying[] = [];
      for (let i = 0; i < steps; i++) {
        w.weaponsPreStep();
        phys.step(handlers);
        st.afterStep(phys.FIXED_DT);
        w.weaponsAfterStep(phys.FIXED_DT);
        seen.push(...w.weaponsDebug().flying);
      }
      const s1 = st.stats();
      return { booms, seen, last: w.weaponsDebug().flying as Flying[], broke: s1.fractures + s1.snaps - s0.fractures - s0.snaps };
    };

    /* a half-brick wall, face at x = -t/2, 5 m long, 3 m high */
    const t = 0.1, face = -t / 2, back = t / 2;
    const wall = [{ mat: 'brick', size: [t, 3, 5], pos: [0, 1.501, 0], anchored: true }];
    const top: Record<string, number> = { rocket: 120, bomb: 110, bottle: 40, charge: 40, thermite: 40, megabomb: 40, ball: 62 };
    const fails: string[] = [];
    for (const type of ['rocket', 'bomb', 'bottle', 'charge', 'thermite', 'megabomb', 'ball']) {
      for (const ang of [0, 35, 65]) {
        const a = (ang * Math.PI) / 180, at = [face, 1.5, 0.3];
        const from = [at[0] - 14 * Math.cos(a), 1.5, at[2] - 14 * Math.sin(a)];
        const r = shoot(wall, type, from, at, top[type]);
        const tag = `${type} at ${ang}°`;
        const past = r.seen.find((f) => f.pos[0] > back + 0.02);
        if (type === 'ball') {
          if (past && !r.broke) fails.push(`${tag}: the ball came out behind the unbroken wall at x ${past.pos[0].toFixed(2)}`);
          continue;
        }
        if (past) fails.push(`${tag}: in flight behind the wall at x ${past.pos[0].toFixed(2)}`);
        if (type === 'charge' || type === 'thermite' || type === 'megabomb') {
          const c = r.last.find((f) => f.type === type);
          if (!c || !c.stuck) fails.push(`${tag}: did not stick`);
          else if (c.pos[0] > face + 0.01 || c.pos[0] < face - 0.35) fails.push(`${tag}: stuck at x ${c.pos[0].toFixed(2)}, not on the face`);
        } else if (type !== 'bottle') {
          if (!r.booms.length) fails.push(`${tag}: never went off`);
          else if (r.booms.some((b) => b[0] > face + 0.02 || b[0] < face - 0.4)) fails.push(`${tag}: went off at ${r.booms.map((b) => b.map((x) => x.toFixed(2)).join(',')).join(' ')}, not at the face`);
        } else if (r.last.some((f) => f.type === 'bottle')) fails.push(`${tag}: did not break`);
      }
    }

    /* a rocket whose axis passes 0.12 m clear of a 0.1 m post: its 8 cm body strikes the post's side */
    const post = [{ mat: 'wood', size: [0.1, 3, 0.1], pos: [0, 1.501, 0], anchored: true }];
    for (const dz of [0.12, -0.12]) {
      const r = shoot(post, 'rocket', [-14, 1.5, dz], [3, 1.5, dz], 120);
      const b = r.booms[0];
      if (!b) fails.push(`rocket grazing the post at dz ${dz}: never went off`);
      else if (Math.hypot(b[0], b[2]) > 0.45) fails.push(`rocket grazing the post at dz ${dz}: went off at ${b.map((x) => x.toFixed(2))}, not on the post`);
    }

    /* tandem into a hollow brick stack (1.4 m square, 0.3 m walls, 0.8 m flue): the follow-through stays inside */
    const stack = [
      { mat: 'brick', size: [1.4, 2.5, 0.3], pos: [0, 1.251, -0.55], anchored: true },
      { mat: 'brick', size: [1.4, 2.5, 0.3], pos: [0, 1.251, 0.55], anchored: true },
      { mat: 'brick', size: [0.3, 2.5, 0.8], pos: [-0.55, 1.251, 0], anchored: true },
      { mat: 'brick', size: [0.3, 2.5, 0.8], pos: [0.55, 1.251, 0], anchored: true },
    ];
    for (const dz of [0, 0.2]) {
      const r = shoot(stack, 'rocket', [-14, 1.4, dz], [0, 1.4, dz], 120, 'tandem');
      if (!r.booms.some((b) => b[0] > -1.1 && b[0] < 0.45 && Math.abs(b[2] - dz) < 0.5)) fails.push(`tandem into the stack at dz ${dz}: never went off at the stack`);
      for (const b of r.booms) if (b[0] > 0.45) fails.push(`tandem into the stack at dz ${dz}: a charge went off at x ${b[0].toFixed(2)}, past the flue`);
    }
    assert.deepEqual(fails, []);
  } finally {
    await server.close();
  }
});
