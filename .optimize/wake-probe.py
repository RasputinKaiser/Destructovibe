"""Destroy-wake probe (/optimize run 5). Patches a COPY of a tree (git archive <rev> | tar -x -C <dir>, plus a
node_modules symlink): every destroyPiece of a body that is asleep (after t 15 s) prints a WAKE row with the caller, the
piece, its touching contacts (other body dynamic/static, awake, `ny` = normal from the piece to the other (> 0: the other is
above), `jw` = the last substep's normalImpulse over the other's weight per step; the quiet-leave rule uses
totalNormalImpulse) and the world awake count before and one step after;
from t 15 s an AWK row every 0.5 s. Run 5 used it to find that most heap wakes came from pieces that bore nothing, and
that a destroy wakes islands the piece only lay near (no manifold).
  python3 .optimize/wake-probe.py <tree copy>
  cd <tree copy> && node scripts/sim.mjs S 2700 -60.35,1.2,-8,5 | grep -E '^(WAKE|AWK)'"""
import sys
T = sys.argv[1]
f = T + '/src/destruction/structure.ts'
s = open(f).read()
old = "function destroyPiece(p: Piece): void {\n  if (p.dead) return;\n"
assert old in s
s = s.replace(old, old + """  if (clock > 15 && b3.b3Body_IsValid(p.body) && !b3.b3Body_IsAwake(p.body)) (globalThis as any).__wakeLog?.(p, new Error().stack!.split('\\n').slice(2, 5).map(l => l.trim().replace(/^at /, '').replace(/\\(?\\/.*\\/src\\//, '(')).join(' < '));
""", 1)
s += """
export function __contactsOf(p: Piece): any[] {
  const out: any[] = [];
  const cb = b3.createContactsBuffer(), con = b3.createContact(), man = b3.createManifold();
  b3.getBodyContactData(cb, p.body);
  const n = b3.getNumContacts(cb);
  for (let i = 0; i < n; i++) {
    b3.getContactAt(con, cb, i);
    if (con.manifoldCount === 0) continue;
    const pa = entityOfShape(con.shapeIdA) === p, sh = pa ? con.shapeIdB : con.shapeIdA;
    const ob = b3.b3Shape_GetBody(sh);
    const dyn = b3.b3Body_GetType(ob) === b3.b3BodyType.b3_dynamicBody;
    const e = entityOfShape(sh) as any;
    let ny = 0, J = 0;
    for (let m = 0; m < con.manifoldCount; m++) {
      const mf = b3.getManifoldAt(man, con, m);
      ny = pa ? mf.normal[1] : -mf.normal[1];   // > 0: normal from p up to the other (other above p)
      for (let k = 0; k < mf.pointCount; k++) J += mf.points[k].normalImpulse;
    }
    const mass = dyn ? b3.b3Body_GetMass(ob) : 0;
    out.push({ id: e?.id ?? -1, kind: e?.kind ?? '?', dyn, awake: dyn ? b3.b3Body_IsAwake(ob) : false, ny: +ny.toFixed(2), jw: mass ? +(J / (mass * 9.81 / 60)).toFixed(3) : null, welds: e?.welds?.length ?? 0 });
  }
  return out;
}
"""
open(f, 'w').write(s)
g = T + '/scripts/sim.mjs'
m = open(g).read()
m = m.replace("  for (let i = 0; i < STEPS; i++) {", """  const WLOG = []; let wstep = -1;
  globalThis.__wakeLog = (p, stack) => { const c = st.__contactsOf(p); WLOG.push({ t: +(stepNow / 60).toFixed(2), id: p.id, mat: p.mat, vol: +p.volume.toFixed(4), depth: p.depth, welds: p.welds.length, rebars: p.rebars.length, ropes: p.ropes.length, dem: p.demolished, fade: p.fade, burning: p.burning, y: +p.curPos[1].toFixed(2), before: awake(), stack, contacts: c }); wstep = stepNow; };
  let stepNow = 0;
  for (let i = 0; i < STEPS; i++) {
    stepNow = i;""", 1)
m = m.replace("    ter?.terrainStep(st.live);\n", """    ter?.terrainStep(st.live);
    if (wstep >= 0 && i === wstep + 1) { for (const w of WLOG.filter(w => w.after === undefined)) { w.after = awake(); console.log('WAKE ' + JSON.stringify(w)); } }
    if (i >= 900 && (i + 1) % 30 === 0) console.log('AWK ' + (i + 1) / 60 + ' ' + awake());
""", 1)
assert 'WAKE ' in m and '__wakeLog' in m
open(g, 'w').write(m)
print('ok')
