"""Fracture-queue probe (/optimize run 5). Patches a COPY of a tree (git archive <rev> | tar -x -C <dir>, plus a
node_modules symlink) so its scripts/sim.mjs prints, every 60 steps, an FQ row: queue length, dead entries and the age of
the oldest live entry (s), pieces broken that second by path (stale/crowd/detail/compound/small/pulv/voronoi: n and ms),
the worst step's fracture ms, how long the broken pieces had waited (p50/p90/max), fractures of pieces AT REST
(|v| < 0.3 m/s when they break: late breaks in a heap) vs moving, fast flyers (> 8 m/s) and runaways.
  python3 .optimize/fq-probe.py <tree copy>
  cd <tree copy> && node scripts/sim.mjs D 1200 -60,1.5,-55,5 | grep '^FQ'
Run 5 used it to show the fracture drain: base (9672deb) waits up to 15.6 s with 35-61 rest-breaks/s at t 16-20 s; the
drain waits <= 0.6 s and has none after t 14 s."""
import sys, re
T = sys.argv[1]
f = T + '/src/destruction/structure.ts'
s = open(f).read()
if 'fractureQueue.push({ t: clock, ' not in s:
    s = s.replace('fractureQueue.push({ p', 'fractureQueue.push({ t: clock, p')
s = s.replace('function fracture(p: Piece, point: Vec3, intensity: number, blast: boolean): void {', '''function fracture(p: Piece, point: Vec3, intensity: number, blast: boolean): void {
  const D = ((globalThis as any).__fq ??= { n: 0, ms: 0, byPath: {}, ages: [], maxMs: 0 });
  const q = p;
  const path = q.dead ? 'stale' : q.pm.style === 'none' ? 'none' : hasDetail(q) ? 'detail' : q.parts ? 'compound'
    : q.volume < MIN_FRACTURE_VOL ? 'small' : (q.depth >= MAX_DEPTH && q.volume < BLOCK_VOL) ? 'pulv' : (debrisCount > BUDGET * 0.85 && q.depth >= 1) ? 'crowd' : 'voronoi';
  const t = performance.now();
  fracture0(p, point, intensity, blast);
  const dt = performance.now() - t;
  D.n++; D.ms += dt; D.maxMs = Math.max(D.maxMs, dt);
  const b = (D.byPath[path] ??= { n: 0, ms: 0, vol: 0 }); b.n++; b.ms += dt; b.vol += q.volume;
  const st = ((globalThis as any).__fqs ??= { step: -1, ms: 0, max: 0 });
  if (st.step !== stepCount) { st.step = stepCount; st.ms = 0; } st.ms += dt; st.max = Math.max(st.max, st.ms);
}
function fracture0(p: Piece, point: Vec3, intensity: number, blast: boolean): void {''', 1)
s = re.sub(r'fracture\(f\.p, f\.point, f\.intensity, f\.blast\)', '(((globalThis as any).__fq ??= { n: 0, ms: 0, byPath: {}, ages: [], maxMs: 0 }).ages.push(clock - (f as any).t), fracture(f.p, f.point, f.intensity, f.blast))', s)
s = s.replace("export function afterStep(dt: number): void {", """export function fqSnapshot() {
  let dead = 0; const ages: number[] = [];
  for (const e of fractureQueue) { if (e.p.dead) dead++; else ages.push(clock - (e as any).t); }
  ages.sort((a, b) => a - b);
  const q = (k: number) => ages.length ? +ages[Math.min(ages.length - 1, Math.floor(k * ages.length))].toFixed(1) : 0;
  return { len: fractureQueue.length, dead, age50: q(0.5), age90: q(0.9), ageMax: q(1) };
}
export function afterStep(dt: number): void {""", 1)
open(f, 'w').write(s)
g = T + '/scripts/sim.mjs'
m = open(g).read()
hook = r'''
    if ((i + 1) % 60 === 0) { const D = globalThis.__fq ?? { n: 0, ms: 0, byPath: {}, ages: [], maxMs: 0 }; const a = D.ages.sort((x, y) => x - y);
      const q = (k) => a.length ? +a[Math.min(a.length - 1, Math.floor(k * a.length))].toFixed(1) : 0;
      const bp = {}; for (const [k, v] of Object.entries(D.byPath)) bp[k] = [v.n, +v.ms.toFixed(1), +(v.vol / v.n).toFixed(3)];
      console.log('FQ ' + JSON.stringify({ t: (i + 1) / 60, ...st.fqSnapshot(), done: D.n, ms: +D.ms.toFixed(1), maxMs: +D.maxMs.toFixed(1), stepFracMax: +(globalThis.__fqs?.max ?? 0).toFixed(1), doneAge50: q(0.5), doneAge90: q(0.9), doneAgeMax: q(1), byPath: bp, stepMax: +FQMAX.toFixed(1), pieces: st.stats().pieces, fracs: st.stats().fractures, awake: awake(), run: phys.runaways, demo: +(100 * st.demolitionFraction()).toFixed(2) }));
      globalThis.__fq = { n: 0, ms: 0, byPath: {}, ages: [], maxMs: 0 }; if (globalThis.__fqs) globalThis.__fqs.max = 0; FQMAX = 0; }
'''
m = m.replace("    ter?.terrainStep(st.live);\n    const d = performance.now();\n", "    ter?.terrainStep(st.live);\n    const d = performance.now();\n    FQMAX = Math.max(FQMAX, d - a);\n" + hook, 1)
m = m.replace("  for (let i = 0; i < STEPS; i++) {", "  let FQMAX = 0;\n  for (let i = 0; i < STEPS; i++) {", 1)
assert 'FQ ' in m and 'fracture0' in s
open(g, 'w').write(m)


# ---- realism counters ----
f = T + '/src/destruction/structure.ts'
s = open(f).read()
old = "  const t = performance.now();\n  fracture0(p, point, intensity, blast);"
assert old in s
s = s.replace(old, """  if (!q.dead && path !== 'crowd' && path !== 'none') { const v: Vec3 = [0, 0, 0]; b3.b3Body_GetLinearVelocity(v, q.body); const sp = Math.hypot(v[0], v[1], v[2]);
    const R = ((globalThis as any).__fr ??= { rest: 0, moving: 0, restSlow: 0 }); if (sp < 0.3) R.rest++; else R.moving++; }
""" + old, 1)
open(f, 'w').write(s)
g = T + '/scripts/sim.mjs'
m = open(g).read()
old = "console.log('FQ ' + JSON.stringify({ t: (i + 1) / 60,"
assert old in m
m = m.replace(old, """let fly = 0, flyMax = 0; if (i > 240) { const v = [0, 0, 0]; for (const p of st.live) { if (p.dead || !p.body || !phys.b3.b3Body_IsAwake(p.body)) continue; phys.b3.b3Body_GetLinearVelocity(v, p.body); const sp = Math.hypot(v[0], v[1], v[2]); if (sp > 8) fly++; flyMax = Math.max(flyMax, sp); } }
      const FR = globalThis.__fr ?? { rest: 0, moving: 0 }; globalThis.__fr = { rest: 0, moving: 0 };
      """ + old + " fracRest: FR.rest, fracMoving: FR.moving, fly, flyMax: +flyMax.toFixed(1),", 1)
open(g, 'w').write(m)
print('ok')
