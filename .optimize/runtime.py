#!/usr/bin/env python3
"""Runtime probes for Destructovibe (/optimize loop). Runs scripts/sim.mjs with PERF=1 per scenario and reduces the
per-second PERF arrays to a few metrics per scenario, plus each run's RESULT (fingerprint = behaviour check).

  python3 .optimize/runtime.py --out .optimize/runs/<ts>-runtime.json [--only idle_S,tower_D] [--compare prev.json]

Windows are 60 steps (1 s); the blast (if any) fires at step 60, i.e. the start of window 1.
  idle_*    steady  = windows 5..9 (t 5-10 s)
  tower_D / terrace_S  collapse = windows 1..9 (t 1-10 s), aftermath = windows 15..19 (t 15-20 s, ~+15 s after blast)
  chapel_S  settle_s = first second from which no body is awake; t10_20 = windows 10..19
Metrics are ms per physics step (phys = b3World_Step + event dispatch, after = afterStep + terrain, frame = once-a-frame
syncMeshes/maintain) and awake bodies; *_cpu = process CPU ms per step (user+sys, includes GC threads), steadier
than wall time when other agents load the machine. Compare runs back to back only.
"""
import argparse, json, os, subprocess, sys, time, statistics
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SCEN = {
    'idle_S':    (['S', '600'], 'idle'),
    'idle_D':    (['D', '600'], 'idle'),
    'tower_D':   (['D', '1200', '-60,1.5,-55,5'], 'blast'),
    'terrace_S': (['S', '1200', '-3.6,1.2,50.8,5'], 'blast'),
    # the viewer-independence test's chapel blast, run to 30 s: a collapse with no fire, so the pile can go to sleep
    'chapel_S':  (['S', '1800', '-60.5,1.2,-8,5'], 'settle'),
}
def mean(a): return round(statistics.fmean(a), 3) if a else None
def run(name):
    args, kind = SCEN[name]
    t0 = time.monotonic()
    r = subprocess.run(['node', 'scripts/sim.mjs', *args], cwd=ROOT, env={**os.environ, 'PERF': '1'}, capture_output=True, text=True)
    wall = round(time.monotonic() - t0, 1)
    perf = res = None
    for ln in r.stdout.splitlines():
        if ln.startswith('PERF '): perf = json.loads(ln[5:])
        if ln.startswith('RESULT '): res = json.loads(ln[7:])
    if r.returncode or not perf or not res:
        return {'ok': False, 'exit': r.returncode, 'wall_s': wall, 'tail': (r.stdout + r.stderr)[-1500:]}
    P = perf
    def w(k, lo, hi): return P[k][lo:hi + 1]
    tot = [a + b + f for a, b, f in zip(P['phys'], P['after'], P['frame'])]
    m = {'ok': True, 'wall_s': wall, 'buildMs': P['buildMs'], 'result': res}
    if kind == 'idle':
        m.update(after_ms=mean(w('after', 5, 9)), phys_ms=mean(w('phys', 5, 9)), frame_ms=mean(w('frame', 5, 9)),
                 soft_ms=mean(w('soft', 5, 9)), joints_ms=mean(w('joints', 5, 9)), svc_ms=mean(w('svc', 5, 9)),
                 ter_ms=mean(w('ter', 5, 9)), after_cpu=mean(w('afterCpu', 5, 9)), awake_end=P['awake'][-1])
    elif kind == 'settle':
        a = P['awake']
        settle = next((i for i in range(1, len(a)) if all(x == 0 for x in a[i:])), None)
        m.update(settle_s=settle, t10_20_phys_ms=mean(w('phys', 10, 19)), t10_20_after_ms=mean(w('after', 10, 19)),
                 t10_20_phys_cpu=mean(w('physCpu', 10, 19)), t10_20_after_cpu=mean(w('afterCpu', 10, 19)),
                 collapse_total_ms=mean(tot[1:10]), awake_end=a[-1])
    else:
        m.update(collapse_phys_ms=mean(w('phys', 1, 9)), collapse_after_ms=mean(w('after', 1, 9)),
                 collapse_total_ms=mean(tot[1:10]), collapse_worst_s_ms=round(max(tot[1:10]), 2),
                 collapse_fields_ms=mean(w('fields', 1, 9)), collapse_analysis_ms=mean(w('analysis', 1, 9)),
                 collapse_joints_ms=mean(w('joints', 1, 9)), collapse_svc_ms=mean(w('svc', 1, 9)),
                 aftermath_phys_ms=mean(w('phys', 15, 19)), aftermath_after_ms=mean(w('after', 15, 19)),
                 aftermath_total_ms=mean(tot[15:20]),
                 collapse_phys_cpu=mean(w('physCpu', 1, 9)), collapse_after_cpu=mean(w('afterCpu', 1, 9)),
                 aftermath_phys_cpu=mean(w('physCpu', 15, 19)), aftermath_after_cpu=mean(w('afterCpu', 15, 19)), awake_at_16s=P['awake'][15], awake_end=P['awake'][-1],
                 pieces_created=P['pieces'][-1] - P['pieces'][0])
    m['perf'] = P
    return m
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out'); ap.add_argument('--only'); ap.add_argument('--compare')
    a = ap.parse_args()
    names = a.only.split(',') if a.only else list(SCEN)
    rev = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(['git', 'status', '--porcelain', '--', 'src', 'scripts'], cwd=ROOT, capture_output=True, text=True).stdout.strip())
    load = os.getloadavg()
    out = {'rev': rev, 'dirty_src': dirty, 'loadavg_start': [round(x, 2) for x in load], 'scenarios': {}}
    for n in names:
        print(f'[runtime] {n} ...', file=sys.stderr, flush=True)
        out['scenarios'][n] = run(n)
        s = out['scenarios'][n]
        print(f'[runtime] {n}: ' + json.dumps({k: v for k, v in s.items() if k not in ('perf', 'tail')}), file=sys.stderr, flush=True)
    out['loadavg_end'] = [round(x, 2) for x in os.getloadavg()]
    if a.out:
        Path(a.out).write_text(json.dumps(out, indent=1))
    if a.compare:
        prev = json.loads(Path(a.compare).read_text())['scenarios']
        print(f"{'scenario.metric':44} {'before':>10} {'after':>10} {'delta':>8}")
        for n, s in out['scenarios'].items():
            p = prev.get(n)
            if not p or not s.get('ok') or not p.get('ok'): print(n, 'no comparable run'); continue
            for k, v in s.items():
                if k in ('perf', 'ok', 'result') or not isinstance(v, (int, float)): continue
                pv = p.get(k)
                if isinstance(pv, (int, float)):
                    d = f'{100 * (v - pv) / pv:+.0f}%' if pv else ''
                    print(f'{n + "." + k:44} {pv:>10} {v:>10} {d:>8}')
            same = p['result'] == s['result']
            print(f'{n + ".result":44} {"SAME" if same else "CHANGED: " + json.dumps(p["result"]) + " -> " + json.dumps(s["result"])}')
    else:
        for n, s in out['scenarios'].items():
            print(n, json.dumps({k: v for k, v in s.items() if k not in ('perf', 'tail')}))
main()
