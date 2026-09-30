// /optimize realism probe (run 1 verifier, promoted in run 3): a patched copy of run 1's scripts/sim.mjs. Usage, from the
// tree under test: cd <tree> && DV_ROOT=$PWD node .optimize/realism-probe.mjs S 1800 -60.5,1.2,-8,5 > out.txt
// Prints PROBE {demolitionPct, demoTL [t, demo%, awake, PE, mean y, loose n] every 5 s, end {hoverN, noContactN, steepRestN,
// looseAsleep}, sleepEvents (speed when put to sleep), wakeTest (wake every loose sleeper at the default threshold, 180
// steps: moved_gt2cm/gt10cm, dropped_gt10cm)}. A rule that changes outcomes must keep wakeTest movers ~0 and demo% within
// the base's scatter over blast shifts. hoverN is ray geometry (pieces on ledges count), so judge it with the wake test.

// Headless settle/step-cost harness. Usage: node scripts/sim.mjs <mapKey> [steps] [boom x,y,z,r]
// mapKey: S (Clearance), H (Heritage), D (Downtown), R (Railway), 1..8 contracts, P:<prefabId>, B:<buildingOrVariantId>
// env: CANON=0 spawn pieces in the given order (not canonical); PERM=<seed> seeded shuffle of a prefab's/building's
//      pieces; TERRAIN=0 skip the soil step (by default the soil steps with the live pieces every step, as the game's
//      main loop does: falling pieces dent the ground, the buried sweep runs at 10 Hz); WIN=<steps> per-window report
//      length; VIEWER=x,y,z the player/camera position (services, soft bodies and detail LOD are told it every frame,
//      as main.ts does; VPART=svc,soft,detail tells only those parts); SPF=<n> physics steps per drawn frame (default
//      1; the renderer's syncMeshes/maintain run once a frame, as in the game); PERF=1 timing mode for the /optimize
//      loop: adds a `PERF {...}` line before RESULT with per-second (60-step) arrays of phys/after/ter/frame/soft ms per
//      step, the svc/joints/fields/analysis cost counters, awake bodies and live pieces, and physCpu/afterCpu (process
//      CPU ms per step, steadier than wall time on a loaded machine) (output only, same run)
// The run goes through the same per-step and per-frame calls as main.ts, so what it reports is what the player sees.
// Neither the viewer nor the frame rate may change the outcome (tests/viewer-independence.test.ts): a run with no
// VIEWER is the player's collapse wherever the player stands.
// Last stdout line: RESULT {"weldsLost":n,"runaways":n,"awakeAtEnd":n,"fingerprint":"…"} (fingerprint: every live
// body's position to 1 mm, so two runs that should match can be compared)
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const ROOT = process.env.DV_ROOT;
const req = createRequire(join(ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const key = process.argv[2] ?? 'S';
const STEPS = +(process.argv[3] ?? 600);
const BOOM = process.argv[4]?.split(',').map(Number);
const VIEWER = process.env.VIEWER ? process.env.VIEWER.split(',').map(Number) : null;
const SPF = Math.max(1, +(process.env.SPF ?? 1));
globalThis.window ??= globalThis;
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);

const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const L = (p) => server.ssrLoadModule(p);
  const THREE = await L('three');
  const phys = await L('/src/physics/physics.ts');
  const st = await L('/src/destruction/structure.ts');
  const { initFx } = await L('/src/render/fx.ts');
  const svc = await L('/src/destruction/services.ts');
  const det = await L('/src/destruction/detail.ts');
  const soft = await L('/src/sim/soft.ts');
  const fields = await L('/src/sim/fields/index.ts');
  const an = await L('/src/destruction/analysis.ts');
  const ter = process.env.TERRAIN !== '0' ? await L('/src/terrain/terrain.ts') : null;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  initFx(scene, cam);
  await phys.initPhysics();
  st.initStructures(scene);
  const prefabId = key.startsWith('P:') ? key.slice(2) : null;
  const buildingId = key.startsWith('B:') ? key.slice(2) : null;
  // contracts (and through them the building registry) load only for map keys, so B: builds just its own package
  const C = prefabId || buildingId ? null : await L('/src/levels/contracts.ts');
  const c = prefabId ? { name: 'prefab ' + prefabId, build: () => ({ pieces: [] }) } : buildingId ? { name: 'building ' + buildingId, build: () => ({ pieces: [] }) } : key === 'S' ? C.SANDBOX : key === 'H' ? C.SHOWCASE : key === 'D' ? C.DOWNTOWN : key === 'R' ? C.RAILWAY : C.CONTRACTS[+key - 1];
  if (!c) throw new Error('no map ' + key);
  phys.createWorld();
  if (process.env.CANON === '0' && st.spawnOrder) st.spawnOrder.canonical = false;
  st.setDebrisLimit?.(1400);
  const bp = c.build();
  const t0 = performance.now();
  const perm = (specs) => {
    if (!process.env.PERM) return specs;
    let s = (+process.env.PERM * 2654435761) >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const out = specs.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  st.buildBlueprint(bp);
  if (prefabId) {
    const { PREFABS } = await L('/src/levels/prefabs.ts');
    const { stand } = await L('/src/levels/maps/ground.ts');
    const pf = PREFABS.find((p) => p.id === prefabId);
    const specs = perm(stand(pf.build(0, 0, 0), 0));
    bp.pieces = specs;
    st.spawnPieces(specs);
  }
  if (buildingId) {
    const { stand } = await L('/src/levels/maps/ground.ts');
    const { assemble } = await L('/src/buildings/assemble.ts');
    const specs = perm(stand(assemble(...await resolveBuilding(L, buildingId)), 0));
    bp.pieces = specs;
    st.spawnPieces(specs);
  }
  const buildMs = performance.now() - t0;
  const handlers = { hit: (a, b, p, n, s) => st.onHit(a, b, p, n, s), begin() {}, jointBroken: (id) => st.onJointBroken(id) };
  const pick = (s) => ({ pieces: s.pieces, welds: s.welds, snaps: s.snaps, eventSnaps: s.eventSnaps, fractures: s.fractures, cracks: s.cracks, buckles: s.buckles, yields: s.yields, creepFails: s.creepFails, fatigue: s.fatigue, crushes: s.crushes, slips: s.slips, delams: s.delams });
  const s0 = st.stats();
  let physT = 0, afterT = 0, maxStep = 0, softSum = 0;
  const win = { phys: 0, after: 0, soft: 0, n: 0 };
  const perWin = [];
  const awake = () => { try { return phys.b3.b3World_GetAwakeBodyCount(phys.world); } catch { return -1; } };
  const cost0 = { svc: svc.svcCost.ms, mech: svc.mechCost.ms, field: fields.fieldCost.ms, joint: st.jointCost.ms, an: an.stats.ms };
  const PERF = process.env.PERF === '1' ? { phys: [], after: [], ter: [], frame: [], soft: [], physCpu: [], afterCpu: [], svc: [], joints: [], fields: [], analysis: [], awake: [], pieces: [] } : null;
  const pw = { phys: 0, after: 0, ter: 0, frame: 0, soft: 0, physCpu: 0, afterCpu: 0, c: null };
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const costNow = () => ({ svc: svc.svcCost.ms, joints: st.jointCost.ms, fields: fields.fieldCost.ms, analysis: an.stats.ms });
  if (PERF) pw.c = costNow();
  const B = phys.b3;
  const samp = new Map();
  const sleepEv = [];   // pieces put to sleep: speed at last awake sample, welds, demolished
  const wakeEv = { n: 0 };
  const demoTL = [];
  for (let i = 0; i < STEPS; i++) {
    if (BOOM && i === 60) st.explode([BOOM[0], BOOM[1], BOOM[2]], BOOM[3] ?? 5, 90e3, 3200);
    const ca = PERF ? cpu() : 0;
    const a = performance.now();
    phys.step(handlers);
    const b = performance.now();
    const cb = PERF ? cpu() : 0;
    st.afterStep(phys.FIXED_DT);
    const c = PERF ? performance.now() : 0;
    ter?.terrainStep(st.live);
    const d = performance.now();
    if (PERF) { pw.physCpu += cb - ca; pw.afterCpu += cpu() - cb; }
    if ((i + 1) % SPF === 0) {
      if (VIEWER) {
        const vp = process.env.VPART ?? 'svc,soft,detail';
        if (vp.includes('svc')) svc.setServiceViewer(VIEWER);
        if (vp.includes('detail')) det.setDetailCamera(VIEWER);
        if (vp.includes('soft')) soft.setSoftViewer(VIEWER);
      }
      st.syncMeshes(1);
      st.maintain(phys.FIXED_DT * SPF);
    }
    if (i % 6 === 5) {
      const vv = [0, 0, 0], ww = [0, 0, 0];
      for (const p of st.live) {
        if (p.dead || !p.body) continue;
        let aw; try { aw = B.b3Body_IsAwake(p.body); } catch { continue; }
        let s = samp.get(p);
        if (!s) samp.set(p, s = { aw: true, v: 0, w: 0 });
        if (aw) { B.b3Body_GetLinearVelocity(vv, p.body); B.b3Body_GetAngularVelocity(ww, p.body); }
        if (s.aw && !aw && i > 60) sleepEv.push({ t: +((i + 1) / 60).toFixed(1), v: s.v, w: s.w, welds: p.welds.length, demo: !!p.demolished, mat: p.mat, vol: p.volume });
        if (!s.aw && aw) wakeEv.n++;
        s.aw = aw;
        if (aw) { s.v = Math.hypot(vv[0], vv[1], vv[2]); s.w = Math.hypot(ww[0], ww[1], ww[2]); }
      }
    }
    if ((i + 1) % 300 === 0) {
      let pe = 0, sy = 0, n = 0;
      for (const p of st.live) { if (p.dead || !p.body || p.welds.length || !p.demolished) continue; pe += (p.mass ?? 0) * p.curPos[1]; sy += p.curPos[1]; n++; }
      demoTL.push([ (i + 1) / 60, +(100 * st.demolitionFraction()).toFixed(2), awake(), Math.round(pe), +(sy / Math.max(1, n)).toFixed(3), n ]);
    }
    if (PERF) {
      pw.phys += b - a; pw.after += d - b; pw.ter += d - c; pw.frame += performance.now() - d; pw.soft += soft.softPerf.ms;
      if ((i + 1) % 60 === 0) {
        const r2 = (x) => +(x / 60).toFixed(3), cn = costNow();
        for (const k of ['phys', 'after', 'ter', 'frame', 'soft', 'physCpu', 'afterCpu']) { PERF[k].push(r2(pw[k])); pw[k] = 0; }
        for (const k of ['svc', 'joints', 'fields', 'analysis']) PERF[k].push(r2(cn[k] - pw.c[k]));
        pw.c = cn;
        PERF.awake.push(awake()); PERF.pieces.push(st.stats().pieces);
      }
    }
    physT += b - a; afterT += d - b; maxStep = Math.max(maxStep, d - a);
    softSum += soft.softPerf.ms;
    win.max = Math.max(win.max ?? 0, d - a); win.phys += b - a; win.after += d - b; win.soft += soft.softPerf.ms; win.n++;
    if ((i + 1) % (process.env.WIN ? +process.env.WIN : 120) === 0) {
      const s = st.stats();
      perWin.push(`t=${((i + 1) / 60).toFixed(0)}s phys ${(win.phys / win.n).toFixed(2)} after ${(win.after / win.n).toFixed(2)} soft ${(win.soft / win.n).toFixed(2)} ms | welds ${s.welds} pieces ${s.pieces} demo ${(100 * st.demolitionFraction()).toFixed(2)}% awakeBodies ${awake()} softAwake ${soft.softPerf.awake} snaps ${s.snaps} evSnaps ${s.eventSnaps} frac ${s.fractures} cracks ${s.cracks} yields ${s.yields} hangs ${s.hangs ?? 0} relieved ${s.relieved ?? 0} frozen ${s.frozen ?? 0} anPending ${an.stats.pending} anMax ${an.stats.maxMs.toFixed(1)} maxStep ${win.max.toFixed(1)}`); win.max = 0;
      win.phys = win.after = win.soft = win.n = 0;
    }
  }
  const s1 = st.stats();
  const kinds = {};
  for (const b of soft.softBodies) { if (b.dead) continue; const k = b.kind + (b.awake ? ':awake' : ':asleep'); kinds[k] = (kinds[k] ?? 0) + 1; }
  const per = (x) => +(x / STEPS).toFixed(3);
  console.log(JSON.stringify({ map: c.name, bpPieces: bp.pieces.length, buildMs: Math.round(buildMs), start: pick(s0), end: pick(s1),
    weldsLostPct: +(100 * (1 - s1.welds / Math.max(1, s0.welds))).toFixed(2), demolitionPct: +(100 * st.demolitionFraction()).toFixed(3),
    avgPhysMs: per(physT), avgAfterMs: per(afterT), avgSoftMs: per(softSum), maxStepMs: +maxStep.toFixed(1),
    breakdownMsPerStep: { svc: per(svc.svcCost.ms - cost0.svc), mech: per(svc.mechCost.ms - cost0.mech), fields: per(fields.fieldCost.ms - cost0.field), joints: per(st.jointCost.ms - cost0.joint), analysis: per(an.stats.ms - cost0.an) },
    runaways: phys.runaways, pumped: phys.pumped, designIssues: st.designIssues.length, softKinds: kinds, perWin }, null, 1));
  if (PERF) console.log('PERF ' + JSON.stringify({ map: c.name, steps: STEPS, boom: BOOM ?? null, buildMs: Math.round(buildMs), windowSteps: 60, ...PERF }));
  const fp = createHash('sha1');
  for (const p of [...st.live].filter((p) => !p.dead).sort((a, b) => a.id - b.id)) fp.update(`${p.id}:${p.curPos.map((v) => Math.round(v * 1000)).join(',')};`);
  console.log('RESULT ' + JSON.stringify({ weldsLost: Math.max(0, s0.welds - s1.welds), runaways: phys.runaways, awakeAtEnd: awake(), fingerprint: fp.digest('hex').slice(0, 16) }));
  // ---- verifier probe ----
  const qf = (m) => phys.queryFilter(m);
  const loose = [...st.live].filter((p) => !p.dead && p.body && !p.welds.length && p.demolished);
  const gapOf = (p) => {
    const bb = [0, 0, 0, 0, 0, 0]; B.b3Body_ComputeAABB(bb, p.body);
    const y0 = bb[1]; let best = Infinity, nrm = null;
    const xs = [bb[0] + 0.01, (bb[0] + bb[3]) / 2, bb[3] - 0.01], zs = [bb[2] + 0.01, (bb[2] + bb[5]) / 2, bb[5] - 0.01];
    for (const x of xs) for (const z of zs) {
      const r = B.b3World_CastRayClosest(phys.world, [x, y0 + 0.02, z], [0, -50, 0], qf(phys.ALL));
      if (!r.hit) continue;
      const e = phys.entityOfShape(r.shapeId);
      if (e === p) continue;
      const g = 0.02 - (-50 * r.fraction) * -1; // distance below y0+0.02 minus 0.02
      const gap = 50 * r.fraction - 0.02;
      if (gap < best) { best = gap; nrm = r.normal; }
    }
    return { gap: best, ny: nrm ? nrm[1] : null, y0 };
  };
  const summarise = () => {
    const hov = [], slope = [], nocontact = []; let cbuf = null;
    let asleep = 0;
    for (const p of loose) {
      if (p.dead) continue;
      let aw; try { aw = B.b3Body_IsAwake(p.body); } catch { continue; }
      if (aw) continue;
      asleep++;
      const g = gapOf(p);
      cbuf = B.getBodyContactData(cbuf ?? B.createContactsBuffer(), p.body);
      const nc = cbuf.count;
      if (nc === 0 && g.y0 > 0.1) nocontact.push({ id: p.id, mat: p.mat, vol: +p.volume.toFixed(3), y0: +g.y0.toFixed(2), gap: +g.gap.toFixed(2) });
      if (g.gap > 0.05 && g.y0 > 0.1) hov.push({ id: p.id, mat: p.mat, vol: +p.volume.toFixed(3), gap: +g.gap.toFixed(2), y0: +g.y0.toFixed(2) });
      if (g.ny != null && g.ny < Math.cos(35 * Math.PI / 180) && g.gap < 0.05) slope.push({ id: p.id, mat: p.mat, vol: +p.volume.toFixed(3), tilt: +(Math.acos(g.ny) * 180 / Math.PI).toFixed(0) });
    }
    return { looseTotal: loose.length, looseAsleep: asleep, noContactN: nocontact.length, noContactTop: nocontact.sort((a, b) => b.gap - a.gap).slice(0, 6), hoverN: hov.length, hoverTop: hov.sort((a, b) => b.gap - a.gap).slice(0, 5), steepRestN: slope.length, steepTop: slope.slice(0, 5) };
  };
  const sumEv = (evs) => {
    const bins = { '<=0.05': 0, '0.05-0.2': 0, '0.2-0.4': 0, '>0.4': 0 }, wb = { '<=0.5': 0, '0.5-2': 0, '>2': 0 };
    for (const e of evs) { const k = e.v <= 0.05 ? '<=0.05' : e.v <= 0.2 ? '0.05-0.2' : e.v <= 0.4 ? '0.2-0.4' : '>0.4'; bins[k]++; const kw = e.w <= 0.5 ? '<=0.5' : e.w <= 2 ? '0.5-2' : '>2'; wb[kw]++; }
    const fast = evs.filter((e) => e.v > 0.05).sort((a, b) => b.v - a.v).slice(0, 4);
    return { n: evs.length, loose: evs.filter((e) => !e.welds).length, linSpeedBins: bins, angBins: wb, fastest: fast };
  };
  const end = summarise();
  const asleepList = loose.filter((p) => { try { return !B.b3Body_IsAwake(p.body); } catch { return false; } });
  // wake test: default sleep threshold everywhere, wake every loose sleeper, run 180 more steps, measure residual motion
  const pos0 = new Map(asleepList.map((p) => [p, [p.curPos[0], p.curPos[1], p.curPos[2]]]));
  const raised = new Set();
  for (const p of asleepList) { try { if (B.b3Body_GetSleepThreshold(p.body) > 0.3) raised.add(p); } catch {} }
  const rlist = [];
  for (const p of st.live) { if (!p.dead && p.body) { try { B.b3Body_SetSleepThreshold(p.body, 0.05); } catch {} } }
  for (const p of asleepList) B.b3Body_SetAwake(p.body, true);
  const awakeRightAfter = asleepList.filter((p) => { try { return B.b3Body_IsAwake(p.body); } catch { return false; } }).length;
  const WAKE = +(process.env.WAKESTEPS ?? 180);
  for (let i = 0; i < WAKE; i++) { phys.step(handlers); st.afterStep(phys.FIXED_DT); ter?.terrainStep(st.live); if (i % 1 === 0) { st.syncMeshes(1); st.maintain(phys.FIXED_DT); } }
  const mv = [];
  for (const p of asleepList) { if (p.dead) { mv.push(99); continue; } const a = pos0.get(p); mv.push(Math.hypot(p.curPos[0] - a[0], p.curPos[1] - a[1], p.curPos[2] - a[2])); }
  const awakeAfterWake = asleepList.filter((p) => { try { return B.b3Body_IsAwake(p.body); } catch { return false; } }).length;
  const rInfo = (p, i) => ({ id: p.id, mat: p.mat, vol: +p.volume.toFixed(3), d: p.dead ? -1 : +mv[i].toFixed(2), y0: +pos0.get(p)[1].toFixed(2), y1: +p.curPos[1].toFixed(2), lastV: +(samp.get(p)?.v ?? -1).toFixed(2), lastW: +(samp.get(p)?.w ?? -1).toFixed(2) });
  const raisedIdx = asleepList.map((p, i) => [p, i]).filter(([p]) => raised.has(p));
  const raisedStats = { n: raised.size, moved_gt2cm: raisedIdx.filter(([p, i]) => !p.dead && mv[i] > 0.02).length, moved_gt10cm: raisedIdx.filter(([p, i]) => !p.dead && mv[i] > 0.1).length, dropped_gt10cm: raisedIdx.filter(([p, i]) => !p.dead && pos0.get(p)[1] - p.curPos[1] > 0.1).length, dead: raisedIdx.filter(([p]) => p.dead).length, top: raisedIdx.map(([p, i]) => rInfo(p, i)).sort((a, b) => b.d - a.d).slice(0, 8), lastVBins: { '<=0.05': 0, '0.05-0.2': 0, '0.2-0.4': 0, '>0.4': 0 } };
  for (const [p] of raisedIdx) { const v = samp.get(p)?.v ?? 0; raisedStats.lastVBins[v <= 0.05 ? '<=0.05' : v <= 0.2 ? '0.05-0.2' : v <= 0.4 ? '0.2-0.4' : '>0.4']++; }
  const nonRaisedMovers = asleepList.map((p, i) => [p, i]).filter(([p, i]) => !raised.has(p) && !p.dead && mv[i] > 0.1).length;
  const movers = asleepList.map((p, i) => ({ p, d: p.dead ? -1 : mv[i] })).filter((x) => x.d > 0.02).sort((a, b) => b.d - a.d).slice(0, 8).map((x) => ({ id: x.p.id, mat: x.p.mat, vol: +x.p.volume.toFixed(3), welds: x.p.welds.length, d: +x.d.toFixed(2), y0: +pos0.get(x.p)[1].toFixed(2), y1: +x.p.curPos[1].toFixed(2), x: +x.p.curPos[0].toFixed(1), z: +x.p.curPos[2].toFixed(1) }));
  const awakeNow = asleepList.filter((p) => { try { return B.b3Body_IsAwake(p.body); } catch { return false; } });
  const awakeBy = {}; for (const p of awakeNow) { const k = p.mat + (p.welds.length ? ':welded' : ':loose'); awakeBy[k] = (awakeBy[k] ?? 0) + 1; }
  const cnt = (th) => mv.filter((d) => d > th && d < 99).length;
  const dropped = asleepList.filter((p) => !p.dead && pos0.get(p)[1] - p.curPos[1] > 0.1).length;
  console.log('PROBE ' + JSON.stringify({ root: ROOT, key, steps: STEPS, boom: BOOM ?? null, perm: process.env.PERM ?? null, demolitionPct: +(100 * st.demolitionFraction()).toFixed(3), demoTL, weldsLost: Math.max(0, s0.welds - s1.welds), end, sleepEvents: sumEv(sleepEv), wakeEvents: wakeEv.n, wakeTest: { raisedStats, nonRaisedMoved_gt10cm: nonRaisedMovers, movers, awakeBy, awakeRightAfter, awakeAfterWake, steps: WAKE, sleepers: asleepList.length, moved_gt2cm: cnt(0.02), moved_gt10cm: cnt(0.1), moved_gt50cm: cnt(0.5), dropped_gt10cm: dropped, maxMove: +Math.max(0, ...mv.filter((d) => d < 99)).toFixed(2) } }));

} catch (e) { console.error('HARNESS ERROR', e?.stack ?? e); process.exitCode = 2; }
finally { await server.close(); }

/* [def, placement] for a building or variant id: its own package's def.ts when the id is a folder, else each package def
   loaded on its own (a broken package is skipped, not fatal) until one owns the variant. */
async function resolveBuilding(L, id) {
  const { existsSync, readdirSync } = await import('node:fs');
  const dir = join(ROOT, 'src', 'buildings');
  const at = { x: 0, z: 0 };
  if (existsSync(join(dir, id, 'def.ts'))) return [(await L(`/src/buildings/${id}/def.ts`)).default, at];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (!f.isDirectory() || f.name.startsWith('_') || !existsSync(join(dir, f.name, 'def.ts'))) continue;
    let d;
    try { d = (await L(`/src/buildings/${f.name}/def.ts`)).default; } catch (e) { console.error(`skipping broken package ${f.name}: ${e?.message ?? e}`); continue; }
    const v = d?.variants?.find((x) => x.id === id);
    if (v) return [d, { ...at, ...v.params }];
  }
  throw new Error(`unknown building '${id}'`);
}
