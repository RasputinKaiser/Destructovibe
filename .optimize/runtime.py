#!/usr/bin/env python3
"""Runtime probes for Destructovibe (/optimize loop). Runs scripts/sim.mjs with PERF=1 per scenario and reduces the
per-second PERF arrays to a few metrics per scenario, plus each run's RESULT (fingerprint = behaviour check).

Single tree (as run 1):
  python3 .optimize/runtime.py --out .optimize/runs/<ts>-runtime.json [--only idle_S,tower_D] [--compare prev.json]

Interleaved A/B (run 2+; use this for every timing claim):
  python3 .optimize/runtime.py --base <dir with the base rev> --only tower_D,terrace_S --shifts 0,0.15,-0.15 \
      [--reps 3] [--concurrent] --out .optimize/runs/<ts>-ab.json
  Each variant is one (base, head) pair. Blast scenarios get one variant per blast-x shift (metres), so a chaotic collapse
  is judged over several nearby trajectories; idle scenarios get --reps variants. Pair order alternates (AB, BA, ...).
  --concurrent runs the two sides of a pair at the same time, so both see the same machine load. Each side's own buildMs
  (map build: code no runtime fix touches) is the load control: the report prints head/base buildMs per pair, and a
  pair whose ratio is outside 0.8-1.25 is listed as confounded. Metrics are reported as medians over variants,
  plus the median of per-pair head/base ratios. *_cpu (process CPU ms per step) is the primary timing metric.
  Fingerprints are compared per variant (SAME / CHANGED); a behaviour-preserving fix must print SAME everywhere.
  The base dir is any checkout with the same scripts/sim.mjs PERF mode, e.g. `git archive <rev> | tar -x -C <dir>` plus
  a node_modules symlink.

Windows are 60 steps (1 s); the blast (if any) fires at step 60, i.e. the start of window 1.
  idle_*    steady  = windows 10..19 (t 10-20 s; run 1-2 used t 5-10 s, which caught the start-up settle)
  tower_D / terrace_S  collapse = windows 1..9 (t 1-10 s), aftermath = windows 15..19 (t 15-20 s, ~+15 s after blast)
  chapel_S  settle_s = first second from which no body is awake; t10_20 = windows 10..19
Metrics are ms per physics step (phys = b3World_Step + event dispatch, after = afterStep + terrain, frame = once-a-frame
syncMeshes/maintain) and awake bodies; *_cpu = process CPU ms per step (user+sys, includes GC threads), steadier
than wall time when other agents load the machine, though the M1's efficiency cores still inflate it under load.
"""
import argparse, json, os, subprocess, sys, time, statistics
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SCEN = {
    # 20 s: the steady window is t 10-20 s, past the start-up settle (Clearance sandbags on timbers, quiet by ~9.5 s)
    'idle_S':    (['S', '1200'], 'idle'),
    'idle_D':    (['D', '1200'], 'idle'),
    'tower_D':   (['D', '1200', '-60,1.5,-55,5'], 'blast'),
    'terrace_S': (['S', '1200', '-3.6,1.2,50.8,5'], 'blast'),
    # the viewer-independence test's chapel blast, run to 30 s: a collapse with no fire, so the pile can go to sleep
    'chapel_S':  (['S', '1800', '-60.5,1.2,-8,5'], 'settle'),
}
KEY = {  # metrics the A/B table prints, per kind
    'idle': ['after_cpu', 'phys_cpu', 'after_ms', 'phys_ms', 'ter_ms', 'soft_ms', 'awake_end', 'awake_other'],
    'blast': ['collapse_phys_cpu', 'collapse_after_cpu', 'aftermath_phys_cpu', 'aftermath_after_cpu', 'collapse_total_ms',
              'aftermath_total_ms', 'awake_at_16s', 'awake_end', 'pieces_created', 'demo_pct'],
    'settle': ['t10_20_phys_cpu', 't10_20_after_cpu', 'collapse_total_ms', 'settle_s', 'awake_end'],
}
def mean(a): return round(statistics.fmean(a), 3) if a else None
def med(a):
    a = [x for x in a if isinstance(x, (int, float))]
    return round(statistics.median(a), 3) if a else None
def args_for(name, shift):
    args, kind = SCEN[name]
    args = list(args)
    if shift and len(args) > 2:
        b = [float(x) for x in args[2].split(',')]
        b[0] = round(b[0] + shift, 4)
        args[2] = ','.join(str(x) for x in b)
    return args, kind
def run(name, root=ROOT, shift=0.0):
    args, kind = args_for(name, shift)
    t0 = time.monotonic()
    r = subprocess.run(['node', 'scripts/sim.mjs', *args], cwd=root, env={**os.environ, 'PERF': '1'}, capture_output=True, text=True)
    wall = round(time.monotonic() - t0, 1)
    perf = res = full = None
    for ln in r.stdout.splitlines():
        if ln.startswith('PERF '): perf = json.loads(ln[5:])
        if ln.startswith('RESULT '): res = json.loads(ln[7:])
    try:
        full = json.loads(r.stdout[r.stdout.index('{'):r.stdout.index('\nPERF ')])
    except Exception:
        full = None
    if r.returncode or not perf or not res:
        return {'ok': False, 'exit': r.returncode, 'wall_s': wall, 'args': args, 'tail': (r.stdout + r.stderr)[-1500:]}
    P = perf
    def w(k, lo, hi): return P[k][lo:hi + 1]
    tot = [a + b + f for a, b, f in zip(P['phys'], P['after'], P['frame'])]
    m = {'ok': True, 'wall_s': wall, 'args': args, 'buildMs': P['buildMs'], 'result': res,
         'demo_pct': full.get('demolitionPct') if full else None,
         # machine groups the harness saw: an empty dict on a map with machines means the services module did not load
         # as one instance (seen once in run 2, concurrent runs); such a run is not comparable
         'machines': (full or {}).get('machines'), 'stderr': r.stderr[-600:]}
    if kind == 'idle':
        lo, hi = 10, 19
        m.update(after_ms=mean(w('after', lo, hi)), phys_ms=mean(w('phys', lo, hi)), frame_ms=mean(w('frame', lo, hi)),
                 soft_ms=mean(w('soft', lo, hi)), joints_ms=mean(w('joints', lo, hi)), svc_ms=mean(w('svc', lo, hi)),
                 ter_ms=mean(w('ter', lo, hi)), after_cpu=mean(w('afterCpu', lo, hi)), phys_cpu=mean(w('physCpu', lo, hi)),
                 awake_end=P['awake'][-1], awake_other=res.get('awakeOther'))
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
def brief(s): return {k: v for k, v in s.items() if k not in ('perf', 'tail')}
def ab(a):
    base, head = Path(a.base).resolve(), ROOT
    names = a.only.split(',') if a.only else list(SCEN)
    shifts = [float(x) for x in a.shifts.split(',')]
    out = {'mode': 'ab', 'base_root': str(base), 'head_root': str(head), 'shifts': shifts, 'reps': a.reps,
           'concurrent': a.concurrent, 'loadavg_start': [round(x, 2) for x in os.getloadavg()], 'scenarios': {}}
    for tree, key in ((base, 'base'), (head, 'head')):
        g = lambda *c: subprocess.run(['git', *c], cwd=tree, capture_output=True, text=True).stdout.strip()
        out[key + '_rev'] = g('rev-parse', '--short', 'HEAD') if (tree / '.git').exists() else 'export'
    pool = ThreadPoolExecutor(2) if a.concurrent else None
    for n in names:
        kind = SCEN[n][1]
        variants = shifts if kind != 'idle' else [0.0] * a.reps
        pairs = []
        for i, sh in enumerate(variants):
            order = [('base', base), ('head', head)] if i % 2 == 0 else [('head', head), ('base', base)]
            print(f'[ab] {n} shift {sh:+} order {order[0][0]}-{order[1][0]} ...', file=sys.stderr, flush=True)
            if pool:
                fs = {k: pool.submit(run, n, t, sh) for k, t in order}
                res = {k: f.result() for k, f in fs.items()}
            else:
                res = {k: run(n, t, sh) for k, t in order}
            pair = {'shift': sh, 'order': order[0][0] + '-' + order[1][0], 'loadavg': round(os.getloadavg()[0], 1), **res}
            pairs.append(pair)
            print(f'[ab]   base {json.dumps(brief(res["base"]))}\n[ab]   head {json.dumps(brief(res["head"]))}', file=sys.stderr, flush=True)
        out['scenarios'][n] = {'kind': kind, 'pairs': pairs}
    out['loadavg_end'] = [round(x, 2) for x in os.getloadavg()]
    if a.out:
        for s in out['scenarios'].values():
            if not a.keep_perf:
                for p in s['pairs']:
                    for k in ('base', 'head'): p[k].pop('perf', None)
        Path(a.out).write_text(json.dumps(out, indent=1))
    report(out)
def report(out):
    print(f"A/B base {out.get('base_rev')} ({out['base_root']}) vs head {out.get('head_rev')}; load {out['loadavg_start'][0]} -> {out['loadavg_end'][0]}; concurrent={out['concurrent']}")
    for n, s in out['scenarios'].items():
        pairs = [p for p in s['pairs'] if p['base'].get('ok') and p['head'].get('ok')]
        bad = len(s['pairs']) - len(pairs)
        print(f"\n{n}: {len(pairs)} pairs" + (f", {bad} FAILED" if bad else ''))
        for p in s['pairs']:
            for k in ('base', 'head'):
                if not p[k].get('ok'): print(f"  FAILED {k} shift {p['shift']}: exit {p[k].get('exit')} {p[k].get('tail', '')[-300:]!r}")
        conf = []
        for p in pairs:
            r = p['head']['buildMs'] / max(1, p['base']['buildMs'])
            fp = 'SAME' if p['head']['result']['fingerprint'] == p['base']['result']['fingerprint'] else 'CHANGED'
            print(f"  shift {p['shift']:+.2f} {p['order']}  buildMs {p['base']['buildMs']}/{p['head']['buildMs']} (x{r:.2f})  fp {fp}"
                  f"  weldsLost {p['base']['result']['weldsLost']}/{p['head']['result']['weldsLost']}"
                  f"  awakeOther {p['base']['result'].get('awakeOther')}/{p['head']['result'].get('awakeOther')}"
                  + ''.join(f"  NO-MACHINES({k})" for k in ('base', 'head') if p[k].get('machines') == {}))
            if not 0.8 <= r <= 1.25: conf.append(p['shift'])
        if conf: print(f"  CONFOUNDED pairs (buildMs ratio outside 0.8-1.25): shifts {conf}")
        print(f"  {'metric':24} {'base med':>10} {'head med':>10} {'d med':>8} {'med ratio':>9}  base range / head range")
        for k in KEY[s['kind']]:
            b = [p['base'].get(k) for p in pairs]; h = [p['head'].get(k) for p in pairs]
            bm, hm = med(b), med(h)
            rat = [y / x for x, y in zip(b, h) if isinstance(x, (int, float)) and isinstance(y, (int, float)) and x]
            rm = med(rat)
            d = f'{100 * (hm - bm) / bm:+.0f}%' if bm and hm is not None else ''
            rng = lambda v: f"{min(x for x in v if x is not None)}-{max(x for x in v if x is not None)}" if any(x is not None for x in v) else '-'
            print(f"  {k:24} {bm!s:>10} {hm!s:>10} {d:>8} {(f'x{rm:.2f}' if rm else ''):>9}  {rng(b)} / {rng(h)}")
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out'); ap.add_argument('--only'); ap.add_argument('--compare')
    ap.add_argument('--base', help='A/B mode: directory of the base tree')
    ap.add_argument('--shifts', default='0,0.15,-0.15', help='A/B: blast-x offsets in metres, one pair each')
    ap.add_argument('--reps', type=int, default=3, help='A/B: pairs per idle scenario')
    ap.add_argument('--concurrent', action='store_true', help='A/B: run both sides of a pair at once')
    ap.add_argument('--keep-perf', action='store_true', help='A/B: keep the per-second PERF arrays in --out')
    ap.add_argument('--report', help='re-print the A/B table of a saved --out file')
    a = ap.parse_args()
    if a.report: return report(json.loads(Path(a.report).read_text()))
    if a.base: return ab(a)
    names = a.only.split(',') if a.only else list(SCEN)
    rev = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(['git', 'status', '--porcelain', '--', 'src', 'scripts'], cwd=ROOT, capture_output=True, text=True).stdout.strip())
    load = os.getloadavg()
    out = {'rev': rev, 'dirty_src': dirty, 'loadavg_start': [round(x, 2) for x in load], 'scenarios': {}}
    for n in names:
        print(f'[runtime] {n} ...', file=sys.stderr, flush=True)
        out['scenarios'][n] = run(n)
        s = out['scenarios'][n]
        print(f'[runtime] {n}: ' + json.dumps(brief(s)), file=sys.stderr, flush=True)
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
            print(n, json.dumps(brief(s)))
main()
