"""Sleep-keeper diagnostics (/optimize run 2-3). Builds a copy of <tree>/scripts/sim.mjs that, after the scenario, runs
TAILSTEPS (default 240) more steps and prints: awake count every 40 steps, STEPLOG (per step: bodies over their sleep
threshold excl. machines, body creates, destroys, joint destroys, impulses, other wakes), KEEPERS (bodies over threshold:
net vs path displacement, material, temperature, joints) and, in MODE=calls, every b3 setter call with a 3-frame stack.
  python3 .optimize/keepers.py <tree> <out.mjs>
  cd <tree> && DV_ROOT=$PWD MODE=plain|calls|noafter|nohits|none [KNOCK=<regex over "b3Fn @ stack">] [TAILSTEPS=n] \
      node <out.mjs> S 1200 -60.5,1.2,-8,5
MODE=noafter skips afterStep (pure physics); KNOCK turns matching b3 calls into no-ops (bisect the waker); CALM=1 damps
bodies with net < 5 cm and path > 10 cm at tail step 120. Run 3 found the chapel keepers with it: freezeRubble's SetType
and fire/heat SetAwake (both wake whole islands). Run from the tree's own directory (vite resolves its config there)."""
import sys
src = open(sys.argv[1] + '/scripts/sim.mjs').read()
src = src.replace("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');", "const ROOT = process.env.DV_ROOT;")
tail = r'''
  {
    const B = phys.b3, W = phys.world;
    const aw = () => B.b3World_GetAwakeBodyCount(W);
    const mode = process.env.MODE ?? 'calls';
    const cnt = {};
    const knock = process.env.KNOCK ? new RegExp(process.env.KNOCK) : null; let knocked = 0;
    if (mode === 'calls' || knock) {
      for (const k of Object.keys(B)) {
        if (typeof B[k] !== 'function' || !(/^b3[A-Za-z]+_[A-Z]/.test(k) || /^b3(Create|Destroy)/.test(k)) || /_(Get|Is[A-Z]|Cast|Overlap|Compute)/.test(k) || k === 'b3World_Step') continue;
        const o = B[k];
        B[k] = (...a) => {
          const fr = new Error().stack.split('\n').slice(2, 5).map(l => l.trim().replace(/^at /, '').replace(/\(?\/.*\/src\//, '(').replace(/\?[^:]*/, '')).join(' < ');
          const kk = k + ' @ ' + fr; cnt[kk] = (cnt[kk] ?? 0) + 1;
          if (knock && knock.test(kk)) { knocked++; return undefined; }
          if (/^b3Create(Body)/.test(k)) ev.create++; else if (/^b3DestroyBody/.test(k)) ev.destroy++; else if (/^b3DestroyJoint/.test(k)) ev.joint++; else if (/Impulse/.test(k)) ev.imp++; else if (/SetAwake|WakeBodies|SetType/.test(k) && !/stepMech|updateMechs|vehicle/.test(kk)) ev.other++;
          return o(...a);
        };
      }
    }
    const keep = new Map(); let overSum = 0, overNM = 0; const stepLog = []; const ev = { create: 0, destroy: 0, joint: 0, imp: 0, other: 0 };
    { const types = {}; const seenJ = new Set(); const drop = [];
      for (const p of st.live) { if (p.dead || !p.body) continue; const js = B.b3Body_GetJoints(p.body);
        for (let k = 0; k < js.size(); k++) { const j = js.get(k); const key = j.index1 + ':' + j.generation; if (seenJ.has(key)) continue; seenJ.add(key);
          const t = B.b3Joint_GetType(j); const tn = String(t?.value ?? t); types[tn] = (types[tn] ?? 0) + 1; if (t === B.b3JointType.b3_filterJoint) drop.push(j); }
        js.delete?.(); }
      console.log('JOINTTYPES', JSON.stringify(types), 'filter', drop.length);
      if (process.env.DROPFILTER) { for (const j of drop) B.b3DestroyJoint(j, false); console.log('dropped filter joints', drop.length); } }
    const nohit = { hit() {}, begin() {}, jointBroken: handlers.jointBroken };
    const TAIL = +(process.env.TAILSTEPS ?? 240);
    for (let k = 0; k < TAIL; k++) {
      if (process.env.CALM && k === 120) { let n = 0;
        for (const [p, r] of keep) { if (p.dead) continue; const net = Math.hypot(p.curPos[0] - r.p0[0], p.curPos[1] - r.p0[1], p.curPos[2] - r.p0[2]);
          if (net < 0.05 && r.path > 0.1 && !p.welds.length && !p.ropes.length && !p.mechs) { B.b3Body_SetLinearDamping(p.body, 5); B.b3Body_SetAngularDamping(p.body, 5); n++; } }
        console.log('  calmed', n); }
      phys.step(mode === 'nohits' || mode === 'none' ? nohit : handlers);
      if (mode !== 'noafter' && mode !== 'none') st.afterStep(phys.FIXED_DT);
      ter?.terrainStep(st.live); st.syncMeshes(1); st.maintain(phys.FIXED_DT);
      { const v = [0,0,0], w = [0,0,0], A = [0,0,0,0,0,0]; let over = 0;
        for (const p of st.live) { if (p.dead || !p.body) continue; let a; try { a = B.b3Body_IsAwake(p.body); } catch { continue; } if (!a) continue;
          B.b3Body_GetLinearVelocity(v, p.body); B.b3Body_GetAngularVelocity(w, p.body); B.b3Body_ComputeAABB(A, p.body);
          const ext = 0.5 * Math.hypot(A[3] - A[0], A[4] - A[1], A[5] - A[2]);
          const sv = Math.max(Math.hypot(...v), Math.hypot(...w) * ext), thr = B.b3Body_GetSleepThreshold(p.body);
          const isMech = !!(p.mechs?.length || p.root?.spec?.mech || p.root?.spec?.vehicle || p.root?.spec?.wheel);
          if (sv > thr && !isMech) { overNM++; }
          if (sv > thr && !isMech) { over++; const r = keep.get(p) ?? { n: 0, max: 0, p0: [...p.curPos], path: 0, last: [...p.curPos] };
            r.path += Math.hypot(p.curPos[0] - r.last[0], p.curPos[1] - r.last[1], p.curPos[2] - r.last[2]); r.last = [...p.curPos]; r.n++; r.max = Math.max(r.max, sv / thr); keep.set(p, r); } }
        overSum += over; stepLog.push([overNM, ev.create, ev.destroy, ev.joint, ev.imp, ev.other]); overNM = 0; ev.create = ev.destroy = ev.joint = ev.imp = ev.other = 0; }
      if (k % 40 === 39) console.log('  mode', mode, process.env.KNOCK ?? '', k + 1, 'awake', aw(), 'knocked', knocked);
    }
    console.log('STEPLOG ' + JSON.stringify(stepLog));
    console.log('OVERAVG', overSum / TAIL, 'distinct', keep.size);
    console.log('KEEPERS ' + JSON.stringify([...keep.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([p, r]) => ({ id: p.id, n: r.n, max: +r.max.toFixed(1), mat: p.mat, welds: p.welds.length, burning: !!p.burning, char: +(p.char ?? 0).toFixed(2), dem: !!p.demolished, vol: +p.volume.toFixed(3), y: +p.curPos[1].toFixed(2), type: B.b3Body_GetType(p.body), net: +Math.hypot(p.curPos[0] - r.p0[0], p.curPos[1] - r.p0[1], p.curPos[2] - r.p0[2]).toFixed(3), path: +r.path.toFixed(3), jt: (() => { const js = B.b3Body_GetJoints(p.body); const o = []; for (let k = 0; k < js.size(); k++) o.push(String(B.b3Joint_GetType(js.get(k))?.value)); return o.join(','); })(), ropes: p.ropes.length, rebars: p.rebars.length, hinged: !!p.hinged, buried: 0, joints: B.b3Body_GetJointCount(p.body), temp: Math.round(p.temp), heatK: +p.heatK.toFixed(2), thr: +B.b3Body_GetSleepThreshold(p.body).toFixed(3), x: +p.curPos[0].toFixed(1), z: +p.curPos[2].toFixed(1), frag: p.depth }))));
    if (mode === 'calls') console.log('CALLS ' + JSON.stringify(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 60), null, 1));
  }
'''
src = src.replace("  const s1 = st.stats();", tail + "  const s1 = st.stats();", 1)
open(sys.argv[2], 'w').write(src)
print('ok', 'CALLS' in src)
