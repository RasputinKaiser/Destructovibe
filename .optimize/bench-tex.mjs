// Procedural texture generation bench (/optimize loop, backlog #3): generates every PBR set in src/render/textures.ts at
// one quality tier through the game's own texSet(), in a fresh module instance per round, and prints CPU ms per set and
// a hash of every generated pixel (behaviour check: a pure speed-up keeps the hash).
//   node .optimize/bench-tex.mjs [tier=medium|high|low] [rounds=3] [root=.]
// Last line: TEX {"tier":..,"cpuMs":[per round],"wallMs":[..],"hash":"..","sets":n,"top":[[id,ms],..]}
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const tier = process.argv[2] ?? 'medium';
const rounds = +(process.argv[3] ?? 3);
const ROOT = resolve(process.argv[4] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const req = createRequire(join(ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const src = readFileSync(join(ROOT, 'src/render/textures.ts'), 'utf8');
const block = src.slice(src.indexOf('const RECIPES'), src.indexOf('};', src.indexOf('const RECIPES')));
const ids = [...block.matchAll(/^\s+(\w+): \{ size:/gm)].map((m) => m[1]);
globalThis.window ??= globalThis;
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const out = { tier, root: ROOT, sets: ids.length, cpuMs: [], wallMs: [], hash: null, top: null };
try {
  for (let r = 0; r < rounds; r++) {
    // a fresh instance each round: the set cache and the shared noise fields are rebuilt, as on a page load
    server.moduleGraph.invalidateAll();
    const T = await server.ssrLoadModule('/src/render/textures.ts?r=' + r);
    T.configureTextures(tier, 16);
    const h = createHash('sha1'), per = [];
    const c0 = cpu(), w0 = performance.now();
    for (const id of ids) {
      const a = cpu();
      const s = T.texSet(id);
      per.push([id, +(cpu() - a).toFixed(1)]);
      for (const t of [s.map, s.orm, s.normal]) h.update(t.image.data);
    }
    out.cpuMs.push(+(cpu() - c0).toFixed(1));
    out.wallMs.push(+(performance.now() - w0).toFixed(1));
    const hx = h.digest('hex').slice(0, 16);
    if (out.hash && out.hash !== hx) throw new Error('hash differs between rounds');
    out.hash = hx;
    out.top = per.sort((a, b) => b[1] - a[1]).slice(0, 12);
  }
  console.log('TEX ' + JSON.stringify(out));
} catch (e) { console.error('BENCH ERROR', e?.stack ?? e); process.exitCode = 2; }
finally { await server.close(); }
