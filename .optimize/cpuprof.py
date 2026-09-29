#!/usr/bin/env python3
"""Summarise a V8 .cpuprofile (node --cpu-prof): top functions by self and by inclusive time.
  python3 .optimize/cpuprof.py <file.cpuprofile> [--top 30] [--filter src/]
Inclusive time counts a function once per stack (recursion is not double-counted)."""
import json, sys, argparse, collections
ap = argparse.ArgumentParser(); ap.add_argument('file'); ap.add_argument('--top', type=int, default=30); ap.add_argument('--filter', default='')
a = ap.parse_args()
P = json.load(open(a.file))
nodes = {n['id']: n for n in P['nodes']}
parent = {}
for n in P['nodes']:
    for c in n.get('children', []): parent[c] = n['id']
self_us = collections.Counter()
for sid, dt in zip(P['samples'], P['timeDeltas']): self_us[sid] += dt
total = sum(self_us.values())
def key(n):
    cf = n['callFrame']; url = cf['url'].split('/dv-perf-1/')[-1].split('?')[0]
    return f"{cf['functionName'] or '(anon)'} {url}:{cf['lineNumber'] + 1}"
selfk, incl = collections.Counter(), collections.Counter()
for nid, us in self_us.items():
    selfk[key(nodes[nid])] += us
    seen, cur = set(), nid
    while cur is not None:
        k = key(nodes[cur])
        if k not in seen: seen.add(k); incl[k] += us
        cur = parent.get(cur)
print(f'total {total / 1e3:.0f} ms sampled')
for title, c in (('SELF', selfk), ('INCLUSIVE', incl)):
    print(f'--- {title}')
    for k, us in c.most_common(400):
        if a.filter and a.filter not in k: continue
        print(f'{us / 1e3:10.0f} ms {100 * us / total:5.1f}%  {k}')
        a.top -= 1
        if a.top <= 0: break
    a.top = ap.parse_args().top
