// Headless player-movement harness: scripted traversal courses through the real mover, physics step and structure
// update, the way main.ts calls them (playerPreStep → physics step → afterStep → playerPostStep, one step a frame).
// Usage: node scripts/move-sim.mjs [scenario ...]   (no args: all). Prints `RESULT {...}` per scenario, JSON metrics.
// Courses are laid along -Z from the origin (yaw 0 walks -Z); lanes side by side along X.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
globalThis.window ??= globalThis;
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);

const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const r3 = (x) => Math.round(x * 1000) / 1000;
try {
  const L = (p) => server.ssrLoadModule(p);
  const THREE = await L('three');
  const phys = await L('/src/physics/physics.ts');
  const st = await L('/src/destruction/structure.ts');
  const { initFx } = await L('/src/render/fx.ts');
  const { input, endFrame } = await L('/src/core/input.ts');
  const P = await L('/src/game/player.ts');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  initFx(scene, cam);
  await phys.initPhysics();
  st.initStructures(scene);
  const DT = phys.FIXED_DT;
  const handlers = { hit: (a, b, p, n, s) => st.onHit(a, b, p, n, s), begin() {}, jointBroken: (id) => st.onJointBroken(id) };

  function world(specs, at = [0, 0, 0], yaw = 0) {
    st.clearStructures();
    phys.createWorld();
    st.setDebrisLimit?.(1400);
    st.buildBlueprint({ pieces: [] });
    const made = specs.length ? st.spawnPieces(specs) : [];
    for (let i = 0; i < 90; i++) { phys.step(handlers); st.afterStep(DT); }
    P.createPlayer(at, yaw);
    input.down.clear(); input.pressed.clear();
    // settle the player onto the ground
    for (let i = 0; i < 20; i++) tick();
    return made;
  }
  let time = 0;
  const trace = [];
  function tick(keys) {
    if (keys) {
      for (const k of keys) if (!input.down.has(k)) input.pressed.add(k);
      for (const k of [...input.down]) if (!keys.includes(k)) input.down.delete(k);
      for (const k of keys) input.down.add(k);
    }
    P.playerPreStep(DT);
    phys.step(handlers);
    st.afterStep(DT);
    P.playerPostStep();
    P.updateCamera(cam, 1, DT);
    endFrame();
    time += DT;
    const e = P.player.e;
    const s = { t: time, x: e.curPos[0], y: e.curPos[1], z: e.curPos[2], vx: P.player.vel[0], vy: P.player.vel[1], vz: P.player.vel[2],
      g: P.player.grounded, c: P.player.crouch, cy: cam.position.y, ey: P.eyePosition([0, 0, 0], 1)[1] };
    trace.push(s);
    return s;
  }
  /** runs `secs` holding keys (array) or keys(t) */
  function run(secs, keys, each) {
    const n = Math.round(secs / DT);
    let s;
    for (let i = 0; i < n; i++) {
      s = tick(typeof keys === 'function' ? keys(i * DT) : keys);
      if (each && each(s, i * DT) === false) break;
    }
    return s;
  }
  const hspeed = (s) => Math.hypot(s.vx, s.vz);
  const box = (mat, size, pos, extra = {}) => ({ mat, size, pos, anchored: true, ...extra });
  /** worst frame-to-frame camera height change that is not explained by body motion */
  function camJerk(tr) {
    let m = 0;
    for (let i = 1; i < tr.length; i++) m = Math.max(m, Math.abs((tr[i].cy - tr[i - 1].cy) - (tr[i].y - tr[i - 1].y)));
    return r3(m);
  }
  function camMaxStep(tr) {
    let m = 0;
    for (let i = 1; i < tr.length; i++) m = Math.max(m, Math.abs(tr[i].cy - tr[i - 1].cy));
    return r3(m);
  }

  const S = {};

  S.ground = () => {
    const o = {};
    world([]);
    let t0 = time, t90 = null;
    run(1.5, ['KeyW'], (s) => { if (t90 === null && hspeed(s) >= 0.9 * 3.0) t90 = s.t - t0; });
    o.walkTop = r3(hspeed(trace.at(-1)));
    o.walkT90 = t90 === null ? null : r3(t90);
    let z0 = trace.at(-1).z; t0 = time; let tStop = null;
    run(1.2, [], (s) => { if (tStop === null && hspeed(s) < 0.05) tStop = s.t - t0; });
    o.walkStopT = tStop === null ? null : r3(tStop); o.walkStopDist = r3(Math.abs(trace.at(-1).z - z0));
    t0 = time; t90 = null;
    run(3, ['KeyW', 'ShiftLeft'], (s) => { if (t90 === null && hspeed(s) >= 0.9 * 6.2) t90 = s.t - t0; });
    o.sprintTop = r3(hspeed(trace.at(-1))); o.sprintT90 = t90 === null ? null : r3(t90);
    z0 = trace.at(-1).z; t0 = time; tStop = null;
    run(1.5, [], (s) => { if (tStop === null && hspeed(s) < 0.05) tStop = s.t - t0; });
    o.sprintStopT = tStop === null ? null : r3(tStop); o.sprintStopDist = r3(Math.abs(trace.at(-1).z - z0));
    // reversal: walking forward, then back
    run(1, ['KeyW']);
    t0 = time; let tRev = null;
    run(1.5, ['KeyS'], (s) => { if (tRev === null && s.vz > 0.9 * 3.0 * 0.8) tRev = s.t - t0; });
    o.reverseT = tRev === null ? null : r3(tRev);
    run(1, []);
    // strafe vs forward speed, and crouch-walk
    run(1.5, ['KeyD']); o.strafeTop = r3(hspeed(trace.at(-1)));
    run(1.5, ['KeyW', 'KeyD']); o.diagTop = r3(hspeed(trace.at(-1)));
    run(1.5, ['KeyW', 'KeyC']); o.crouchTop = r3(hspeed(trace.at(-1)));
    run(1, []);
    // stamina: how long a sprint lasts
    t0 = time; let tEx = null;
    run(14, ['KeyW', 'ShiftLeft'], (s) => { if (tEx === null && !P.player.sprint) tEx = s.t - t0; });
    o.sprintDuration = tEx === null ? '>14' : r3(tEx);
    return o;
  };

  S.jump = () => {
    const o = {};
    world([]);
    run(0.3, []);
    const y0 = trace.at(-1).y, ey0 = trace.at(-1).cy; let ymax = y0, tUp = null, tLand = null; const t0 = time;
    run(2, (t) => (t < 0.02 ? ['Space'] : []), (s) => {
      ymax = Math.max(ymax, s.y);
      if (tUp === null && !s.g) tUp = s.t;
      if (tUp !== null && tLand === null && s.g) tLand = s.t;
    });
    o.standHeight = r3(ymax - y0);
    o.standAir = tLand && tUp ? r3(tLand - tUp + DT) : null;
    o.apexT = null;
    // landing: camera dip depth after the jump and time back within 1 cm
    const after = trace.filter((s) => s.t >= tLand);
    let dipMin = Infinity; for (const s of after) dipMin = Math.min(dipMin, s.cy - ey0);
    o.landDip = r3(dipMin);
    // running jump
    run(2, ['KeyW', 'ShiftLeft']);
    const z0 = trace.at(-1).z; let zL = null, up = false;
    run(2, (t) => ['KeyW', 'ShiftLeft', ...(t < 0.02 ? ['Space'] : [])], (s) => { if (!s.g) up = true; if (up && s.g && zL === null) zL = s.z; });
    o.runJumpDist = zL === null ? null : r3(Math.abs(zL - z0));
    // bunny hop: sprint, and jump the instant you land, for 6 s: average ground speed vs sprint
    run(1, []);
    run(2, ['KeyW', 'ShiftLeft']);
    const zb = trace.at(-1).z, tb = time; let hops = 0, prevG = true;
    run(6, (t) => { const s = trace.at(-1); return ['KeyW', 'ShiftLeft', ...(s.g ? ['Space'] : [])]; }, (s) => { if (prevG && !s.g) hops++; prevG = s.g; });
    o.bhopSpeed = r3(Math.abs(trace.at(-1).z - zb) / (time - tb)); o.bhopHops = hops;
    o.bhopStamina = r3(P.player.stamina);
    // jump while crouched
    run(1, ['KeyC']);
    const yc = trace.at(-1).y; let ycm = yc;
    run(1, (t) => ['KeyC', ...(t < 0.02 ? ['Space'] : [])], (s) => { ycm = Math.max(ycm, s.y); });
    o.crouchJumpHeight = r3(ycm - yc);
    run(1, []);
    // jump spam in place: how many jumps in 3 s holding space
    let n = 0; prevG = true;
    run(3, ['Space'], (s) => { if (prevG && !s.g) n++; prevG = s.g; });
    o.holdSpaceJumps3s = n;
    return o;
  };

  S.coyote = () => {
    const o = {};
    for (const late of [0.05, 0.1, 0.15, 0.2]) {
      world([box('concrete', [4, 1, 4], [0, 0.5, 0])], [0, 1, 0.5]);
      let left = null, jumped = false;
      run(3, (t) => {
        const s = trace.at(-1);
        if (left === null && !s.g) left = s.t;
        return ['KeyW', ...(left !== null && s.t - left >= late - 1e-6 && s.t - left < late + DT ? ['Space'] : [])];
      }, (s) => { if (left !== null && s.vy > 2) { jumped = true; return false; } if (s.y < 0.05 && s.g) return false; });
      o[`late${late}`] = jumped;
    }
    // buffered: press 0.1 s before landing (landing from a jump)
    for (const early of [0.06, 0.12, 0.2]) {
      world([]);
      run(0.3, []);
      run(0.05, ['Space']); run(0.05, []);
      let armed = false, pressedAt = null, again = false;
      run(2, () => {
        const s = trace.at(-1);
        // estimate time to landing from the ballistic arc (y above floor, vy)
        if (!armed && s.vy < 0) {
          const g = 9.81 * 1.5, tl = (s.vy + Math.sqrt(s.vy * s.vy + 2 * g * Math.max(0, s.y))) / g;
          if (tl <= early) { armed = true; pressedAt = s.t; return ['Space']; }
        }
        return [];
      }, (s) => { if (armed && s.vy > 2) { again = true; return false; } });
      o[`buffer${early}`] = again;
    }
    return o;
  };

  S.steps = () => {
    const o = {};
    // lane A: 0.15 curb at z=-2; lane B: stair flight 0.18/0.28 x 8; lane C: 0.30 step; lane D: 0.40 block
    const specs = [
      box('concrete', [1.6, 0.15, 6], [0, 0.075, -5]),
      ...Array.from({ length: 8 }, (_, i) => box('concrete', [1.6, 0.18 * (i + 1), 0.28], [4, 0.09 * (i + 1), -2 - 0.14 - 0.28 * i])),
      box('concrete', [1.6, 0.18 * 8, 3], [4, 0.72, -2 - 0.28 * 8 - 1.5]),
      box('concrete', [1.6, 0.3, 4], [8, 0.15, -4]),
      box('concrete', [1.6, 0.4, 4], [12, 0.2, -4]),
    ];
    const lane = (x, name, top, secs = 3) => {
      world(specs, [x, 0, 0]);
      const t0 = trace.length;
      let stall = 0, reach = null;
      run(secs, ['KeyW'], (s, t) => { if (t > 0.4 && hspeed(s) < 0.5) stall += DT; if (reach === null && s.y >= top - 0.02) reach = r3(t); });
      const tr = trace.slice(t0);
      o[name] = { top: r3(trace.at(-1).y), reached: reach, stall: r3(stall), camMaxStep: camMaxStep(tr), camJerk: camJerk(tr) };
    };
    lane(0, 'curb15', 0.15);
    lane(4, 'stairs18', 1.44, 4);
    lane(8, 'step30', 0.3);
    lane(12, 'block40', 0.4);
    // down the stairs
    world(specs, [4, 1.44, -2 - 0.28 * 8 - 1.0], Math.PI);
    const t0 = trace.length; let airFrames = 0;
    run(3, ['KeyW'], (s) => { if (!s.g) airFrames++; });
    const tr = trace.slice(t0);
    o.stairsDown = { bottom: r3(trace.at(-1).y), airFrames, camMaxStep: camMaxStep(tr), camJerk: camJerk(tr) };
    return o;
  };

  S.ledges = () => {
    const o = {};
    for (const h of [0.6, 0.9, 1.1, 1.3, 1.6]) {
      world([box('concrete', [3, h, 3], [0, h / 2, -3])], [0, 0, 0]);
      let top = 0, t1 = null;
      run(3.5, (t) => ['KeyW', ...(t > 0.6 && t < 0.62 ? ['Space'] : [])], (s, t) => { top = s.y; if (t1 === null && s.y > h - 0.05 && s.g) t1 = r3(t); });
      o[`h${h}`] = { onTop: top > h - 0.05, t: t1 };
    }
    // holding jump into the ledge (the "press space at the wall" habit)
    for (const h of [0.9, 1.1]) {
      world([box('concrete', [3, h, 3], [0, h / 2, -3])], [0, 0, 0]);
      let top = 0;
      run(3.5, ['KeyW', 'Space'], (s) => { top = s.y; });
      o[`hold${h}`] = top > h - 0.05;
    }
    return o;
  };

  S.slopes = () => {
    const o = {};
    for (const deg of [20, 35, 44, 50, 60]) {
      const L = 4, H = L * Math.tan((deg * Math.PI) / 180);
      // wedge: full height at -X, zero at +X; turned so the high end is at -Z
      world([{ mat: 'concrete', shape: 'wedge', size: [L, H, 2], pos: [0, H / 2, -1 - L / 2], rotY: -Math.PI / 2, anchored: true }], [0, 0, 0]);
      let maxY = 0;
      run(3, ['KeyW'], (s) => { maxY = Math.max(maxY, s.y); });
      // stand still on the slope where it got to and see if it slides
      const y1 = trace.at(-1).y, z1 = trace.at(-1).z;
      run(2, []);
      o[`d${deg}`] = { climbed: r3(maxY), slideY: r3(y1 - trace.at(-1).y), slideZ: r3(trace.at(-1).z - z1), groundedEnd: trace.at(-1).g };
    }
    return o;
  };

  S.rubble = () => {
    const o = {};
    // a blast spoil: bricks and concrete lumps heaped across a 3 m wide lane, 1.2 m high in the middle, 5 m long
    let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const specs = [];
    for (let i = 0; i < 260; i++) {
      const zc = -2 - rnd() * 5, xc = (rnd() - 0.5) * 3;
      const hump = Math.max(0, 1 - Math.abs(zc + 4.5) / 2.5);
      const big = rnd() < 0.25;
      const size = big ? [0.3 + rnd() * 0.4, 0.2 + rnd() * 0.25, 0.3 + rnd() * 0.3] : [0.215, 0.065, 0.1025];
      specs.push({ mat: big ? 'concrete' : 'brick', size, pos: [xc, 0.1 + rnd() * hump * 1.3, zc], rotY: rnd() * 6.28, noWeld: true });
    }
    const made = world(specs, [0, 0, 0]);
    for (let i = 0; i < 240; i++) { phys.step(handlers); st.afterStep(DT); }
    let hi = 0; for (const p of made) if (!p.dead) hi = Math.max(hi, p.curPos[1]);
    o.pileTop = r3(hi);
    P.teleport([0, 0.02, 0], 0, 0);
    const t0 = trace.length, before = made.map((p) => [...p.curPos]);
    let dbgN = 0; if (process.env.DBG) globalThis.DBG = (...a) => { if (dbgN++ < 60) console.log('DBG', time.toFixed(3), ...a.map((x) => typeof x === 'number' ? r3(x) : x)); };
    let stall = 0, maxY = 0, cross = null;
    run(8, ['KeyW'], (q, t) => { if (t > 0.4 && hspeed(q) < 0.4) stall += DT; maxY = Math.max(maxY, q.y); if (cross === null && q.z < -7.5) cross = r3(t); });
    const tr = trace.slice(t0);
    let moved = 0, movedHeavy = 0;
    made.forEach((p, i) => { if (p.dead) return; const d = Math.hypot(p.curPos[0] - before[i][0], p.curPos[2] - before[i][2]); if (d > 0.05) { moved++; if (p.mass > 40) movedHeavy++; } });
    o.walk = { crossT: cross, endZ: r3(trace.at(-1).z), maxY: r3(maxY), stall: r3(stall), camMaxStep: camMaxStep(tr), camJerk: camJerk(tr), piecesMoved: moved, heavyMoved: movedHeavy };
    return o;
  };

  S.duck = () => {
    const o = {};
    // a beam across the lane, underside at 1.5 m; then a 1.3 m high crawl-space slab 3 m long
    const specs = [
      box('concrete', [0.3, 0.3, 3], [-1.35, 0.75, -2.5]), box('concrete', [0.3, 0.3, 3], [1.35, 0.75, -2.5]),
      box('steel', [3, 0.3, 0.3], [0, 1.65, -2.5]),
    ];
    world(specs, [0, 0, 0]);
    let passed = null, crouched = false;
    run(4, ['KeyW'], (s, t) => { if (s.c) crouched = true; if (passed === null && s.z < -3.5) passed = r3(t); });
    o.beam = { passed, autoCrouch: crouched, standingAfter: !trace.at(-1).c };
    world([box('concrete', [3, 0.3, 3], [0, 1.45, -3]), box('concrete', [0.3, 1.3, 3], [-1.5, 0.65, -3]), box('concrete', [0.3, 1.3, 3], [1.5, 0.65, -3])], [0, 0, 0]);
    run(0.3, ['KeyC']);
    run(2, ['KeyW', 'KeyC']);
    const under = trace.at(-1);
    run(0.5, []); // release crouch under the slab
    o.ceiling = { underZ: r3(under.z), stoodUp: !trace.at(-1).c, y: r3(trace.at(-1).y) };
    // uncrouch smoothness: camera change per frame when standing up
    world([]);
    run(0.8, ['KeyC']); const t0 = trace.length; run(0.8, []);
    o.standUpCamMaxStep = camMaxStep(trace.slice(t0));
    return o;
  };

  S.falls = () => {
    const o = {};
    for (const h of [1.5, 3, 5, 8, 12]) {
      world([box('concrete', [2, h, 2], [0, h / 2, 0])], [0, h, 0]);
      let vmin = 0;
      run(2.5, (t) => (t < 0.6 ? ['KeyW'] : []), (s) => { vmin = Math.min(vmin, s.vy); });
      o[`h${h}`] = { impactV: r3(-vmin), after: { crouch: trace.at(-1).c, hp: P.player.health ?? null } };
    }
    return o;
  };

  S.push = () => {
    const o = {};
    // light brick, 60 kg lump, 400 kg block, in lanes
    const specs = [
      { mat: 'brick', size: [0.215, 0.065, 0.1025], pos: [0, 0.035, -1.5], noWeld: true },
      { mat: 'concrete', size: [0.4, 0.4, 0.16], pos: [3, 0.2, -1.5], noWeld: true },
      { mat: 'concrete', size: [1, 0.6, 0.3], pos: [6, 0.3, -1.5], noWeld: true },
    ];
    const lane = (x, i, name) => {
      const made = world(specs, [x, 0, 0]);
      const p = made[i], b = [...p.curPos];
      run(2.5, ['KeyW']);
      o[name] = { mass: r3(p.mass), moved: r3(Math.hypot(p.curPos[0] - b[0], p.curPos[2] - b[2])), playerZ: r3(trace.at(-1).z) };
    };
    lane(0, 0, 'brick');
    lane(3, 1, 'lump');
    lane(6, 2, 'block');
    return o;
  };

  S.crush = () => {
    const o = {};
    // a 0.7 t slab and a 6 kg lump dropped from 4 m onto a standing player
    for (const [name, size] of [['slab', [1.2, 0.2, 1.2]], ['lump', [0.2, 0.12, 0.1]]]) {
      world([], [0, 0, 0]);
      const p = st.spawnPieces([{ mat: 'concrete', size, pos: [0.1, 4, 0], noWeld: true }])[0];
      let vmax = 0, dmax = 0, knock = 0, down = false; const x0 = trace.at(-1).x, z0 = trace.at(-1).z;
      run(2.5, [], (s) => { vmax = Math.max(vmax, hspeed(s), s.vy); dmax = Math.max(dmax, Math.hypot(s.x - x0, s.z - z0)); knock = Math.max(knock, P.player.knock); if (P.player.downed > 0) down = true; });
      o[name] = { mass: r3(p.mass), peakV: r3(vmax), displaced: r3(dmax), knock: r3(knock), downed: down, crouchAfter: trace.at(-1).c, hp: P.player.health ?? null };
    }
    return o;
  };

  S.scree = () => {
    const o = {};
    // dropped onto a 55 degree face from 1 m above it: does the player slide off or stick like glue?
    for (const deg of [40, 55]) {
      const L = 4, H = L * Math.tan((deg * Math.PI) / 180);
      world([{ mat: 'concrete', shape: 'wedge', size: [L, H, 2], pos: [0, H / 2, -L / 2], rotY: -Math.PI / 2, anchored: true }], [0, H / 2 + 1.2, -L / 2]);
      const y0 = trace.at(-1).y;
      run(2.5, []);
      o[`d${deg}`] = { from: r3(y0), end: r3(trace.at(-1).y), grounded: trace.at(-1).g };
    }
    return o;
  };

  const want = process.argv.slice(2);
  for (const [k, f] of Object.entries(S)) {
    if (want.length && !want.includes(k)) continue;
    trace.length = 0;
    const t0 = performance.now();
    const res = f();
    console.log('RESULT ' + JSON.stringify({ scenario: k, ms: Math.round(performance.now() - t0), ...res }));
  }
} catch (e) { console.error('HARNESS ERROR', e?.stack ?? e); process.exitCode = 2; }
finally { await server.close(); }
