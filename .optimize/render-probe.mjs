// Render probe for the /optimize loop: Downtown at the default settings (quality High, render scale Auto), from the
// player's spawn view. Measures frame time (rAF deltas), draw calls, triangles and the game's own perf split at rest and
// 5 s after the standard tower blast (-60,1.5,-55,5). Needs the dev server (window.__dv exists only in DEV).
//   node .optimize/render-probe.mjs [url=http://localhost:5206/] [--headed]
// Playwright comes from the npx cache (`npx -y playwright@1.63.0 --version` once) and drives the system Chrome
// (channel 'chrome'), so no browser download is needed. Prints `RENDER {...}` as its last line.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall back to the npx cache */ }
  const base = join(homedir(), '.npm', '_npx');
  for (const d of existsSync(base) ? readdirSync(base) : []) {
    const p = join(base, d, 'node_modules', 'playwright', 'index.mjs');
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error('playwright not found: run `npx -y playwright@1.63.0 --version` once');
}

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5206/';
const headed = process.argv.includes('--headed');
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ channel: 'chrome', headless: !headed, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const out = {};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  // main.ts builds the Clearance Zone behind the title before physics is free: start once the title is up
  await page.waitForFunction(() => window.__dv && window.__dv.gfx && window.__dv.state === 'title', null, { timeout: 180e3 });
  out.gpu = await page.evaluate(() => {
    const gl = window.__dv.gfx.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  out.threads = await page.evaluate(() => window.__dv.threads);
  const tL = Date.now();
  await page.evaluate(() => window.__dv.downtown());
  await page.waitForFunction(() => ['playing', 'paused'].includes(window.__dv.state), null, { timeout: 120e3 });
  await page.evaluate(() => window.__dv.setPlaying());
  out.loadMs = Date.now() - tL;
  out.bootMs = tL - t0;
  // frames over `ms`: rAF deltas (p50/p95/max), draw calls/tris and the game's perf EMA at the end
  const sample = (ms) => page.evaluate((ms) => new Promise((res) => {
    const d = []; let last = performance.now(); const end = last + ms;
    const f = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else {
      d.sort((a, b) => a - b); const q = (x) => +d[Math.min(d.length - 1, Math.floor(x * d.length))].toFixed(1);
      const p = window.__dv.perf, s = window.__dv.stats;
      res({ frames: d.length, fps: +(1000 * d.length / ms).toFixed(1), p50: q(0.5), p95: q(0.95), max: q(1), calls: p.calls, tris: p.tris,
        physMs: p.phys, renderMs: p.render, fxMs: p.fx, syncMs: p.sync, pieces: s.pieces, step: s.step });
    } };
    requestAnimationFrame(f);
  }), ms);
  await page.waitForTimeout(3000); // settle-in: shaders compile, shadow maps fill
  out.rest = await sample(5000);
  await page.evaluate(() => window.__dv.boom(-60, 1.5, -55, 5));
  await page.waitForTimeout(5000);
  out.afterBlast = await sample(5000);
  out.errors = errors;
} finally {
  await browser.close();
}
console.log('RENDER ' + JSON.stringify(out));
