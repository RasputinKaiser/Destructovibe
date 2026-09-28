/* Procedural textures. PBR sets are generated from typed arrays into DataTextures (row 0 = v 0, no
   flipY) so normal maps and text masks share one orientation; all sets tile seamlessly because every
   noise lookup repeats an integer number of times across the tile. Generated lazily, once, cached. */
import * as THREE from 'three';
import { mulberry32 } from 'math/random';
import type { Quality } from '../types';

export type Rng = () => number;
export function makeRng(seed: number): Rng {
  const s = mulberry32.create(seed);
  return () => mulberry32.sample(s);
}

type C3 = readonly [number, number, number];
export function srgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
export function smooth(a: number, b: number, x: number): number {
  const t = (x - a) / (b - a);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const frac = (x: number): number => x - Math.floor(x);

export function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ---------------- tileable noise fields ---------------- */

const F = 256, FM = 255;

function fbmField(seed: number, cells: number, octaves: number, gain: number): Float32Array {
  const r = makeRng(seed), out = new Float32Array(F * F);
  let amp = 1;
  for (let oc = 0; oc < octaves; oc++) {
    const c = cells << oc;
    if (c > F) break;
    const g = new Float32Array(c * c);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const k = c / F;
    for (let y = 0; y < F; y++) {
      const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const r0 = (iy % c) * c, r1 = ((iy + 1) % c) * c;
      for (let x = 0; x < F; x++) {
        const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const c0 = ix % c, c1 = (ix + 1) % c;
        const a = g[r0 + c0], b = g[r0 + c1], d = g[r1 + c0], e = g[r1 + c1];
        out[y * F + x] += amp * (a + (b - a) * sx + (d - a) * sy + (a - b - d + e) * sx * sy);
      }
    }
    amp *= gain;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const inv = 1 / (hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * inv;
  return out;
}

let fields: Float32Array[] | null = null;
function fld(i: number): Float32Array {
  if (!fields) fields = [fbmField(11, 4, 6, 0.5), fbmField(23, 4, 6, 0.62), fbmField(37, 8, 5, 0.5), fbmField(53, 16, 4, 0.55)];
  return fields[i];
}

function tap(f: Float32Array, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const x0 = ix & FM, x1 = (ix + 1) & FM, y0 = (iy & FM) << 8, y1 = ((iy + 1) & FM) << 8;
  const a = f[y0 + x0], b = f[y0 + x1], c = f[y1 + x0], d = f[y1 + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
/** noise at tile coords (u,v), repeating sx × sy times per tile — keep them integers */
function nz(f: Float32Array, u: number, v: number, sx: number, sy = sx): number {
  return tap(f, u * sx * F, v * sy * F);
}

interface Cells { f1: Float32Array; id: Float32Array }
function worley(n: number, cells: number, seed: number, jitter = 0.85): Cells {
  const r = makeRng(seed), cc = cells * cells;
  const px = new Float32Array(cc), py = new Float32Array(cc), pid = new Float32Array(cc);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const q = j * cells + i;
    px[q] = i + 0.5 + (r() - 0.5) * jitter; py[q] = j + 0.5 + (r() - 0.5) * jitter; pid[q] = r();
  }
  const f1 = new Float32Array(n * n), id = new Float32Array(n * n), k = cells / n;
  const nx = new Float32Array(9), ny = new Float32Array(9), ni = new Float32Array(9);
  // pixels are walked cell by cell so the 3×3 neighbourhood is gathered once per cell
  for (let cy = 0; cy < cells; cy++) {
    const y0 = Math.ceil((cy / k) - 0.5), y1 = Math.min(n, Math.ceil(((cy + 1) / k) - 0.5));
    for (let cx = 0; cx < cells; cx++) {
      const x0 = Math.ceil((cx / k) - 0.5), x1 = Math.min(n, Math.ceil(((cx + 1) / k) - 0.5));
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = cy + dy, wy = (yy + cells) % cells;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx, wx = (xx + cells) % cells, q = wy * cells + wx;
          nx[m] = px[q] + xx - wx; ny[m] = py[q] + yy - wy; ni[m] = pid[q]; m++;
        }
      }
      for (let y = Math.max(0, y0); y < y1; y++) {
        const fy = (y + 0.5) * k, row = y * n;
        for (let x = Math.max(0, x0); x < x1; x++) {
          const fx = (x + 0.5) * k;
          let d1 = 1e9, best = 0;
          for (let q = 0; q < 9; q++) {
            const ex = fx - nx[q], ey = fy - ny[q], d = ex * ex + ey * ey;
            if (d < d1) { d1 = d; best = q; }
          }
          f1[row + x] = Math.sqrt(d1); id[row + x] = ni[best];
        }
      }
    }
  }
  return { f1, id };
}

function blur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n), w = 1 / (2 * r + 1), m = n - 1;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + (k & m)];
    for (let x = 0; x < n; x++) {
      tmp[row + x] = s * w;
      s += src[row + ((x + r + 1) & m)] - src[row + ((x - r) & m)];
    }
  }
  for (let x = 0; x < n; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[(k & m) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = s * w;
      s += tmp[((y + r + 1) & m) * n + x] - tmp[((y - r) & m) * n + x];
    }
  }
  return out;
}

/* ---------------- canvas masks (text, strokes) ---------------- */

const FONT = 'Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif';
const hasDom = typeof document !== 'undefined';

/** white-on-black drawing read back as a coverage mask; canvas top row becomes v = 1 */
function mask(n: number, draw: (g: CanvasRenderingContext2D, n: number) => void, h = n): Float32Array {
  const out = new Float32Array(n * h);
  if (!hasDom) return out;
  const c = document.createElement('canvas');
  c.width = n; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return out;
  g.fillStyle = '#000'; g.fillRect(0, 0, n, h);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  draw(g, n);
  const d = g.getImageData(0, 0, n, h).data;
  for (let y = 0; y < h; y++) for (let x = 0; x < n; x++) out[y * n + x] = d[((h - 1 - y) * n + x) * 4] / 255;
  return out;
}

interface TextItem { t: string; x: number; y: number; size: number; rot?: number; width?: number }
function textMask(n: number, items: TextItem[]): Float32Array {
  return mask(n, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const it of items) {
      g.save();
      g.translate(it.x * n, (1 - it.y) * n);
      if (it.rot) g.rotate(it.rot);
      g.font = `bold ${Math.max(6, Math.round(it.size * n))}px ${FONT}`;
      g.fillText(it.t, 0, 0, (it.width ?? 0.9) * n);
      g.restore();
    }
  });
}

function scratches(n: number, count: number, seed: number): Float32Array {
  const r = makeRng(seed);
  return mask(n, (g) => {
    g.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = r() * n, y = r() * n, a = r() < 0.6 ? 0.25 * (r() - 0.5) : r() * Math.PI;
      const l = (0.03 + r() * r() * 0.35) * n;
      g.globalAlpha = 0.2 + r() * 0.6;
      g.lineWidth = Math.max(0.6, (n / 700) * (0.5 + r()));
      const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
      g.beginPath();
      for (let ox = -n; ox <= n; ox += n) for (let oy = -n; oy <= n; oy += n) {
        g.moveTo(x + ox, y + oy); g.lineTo(x + dx + ox, y + dy + oy);
      }
      g.stroke();
    }
  });
}

/* ---------------- raster + finishing ---------------- */

class Img {
  readonly n: number;
  readonly alb: Float32Array;
  readonly h: Float32Array;
  readonly ro: Float32Array;
  readonly me: Float32Array;
  constructor(n: number) {
    const nn = n * n;
    this.n = n;
    this.alb = new Float32Array(nn * 3);
    this.h = new Float32Array(nn);
    this.ro = new Float32Array(nn).fill(0.9);
    this.me = new Float32Array(nn);
  }
  put(o: number, c: C3, k: number): void {
    const a = this.alb;
    a[o * 3] = c[0] * k; a[o * 3 + 1] = c[1] * k; a[o * 3 + 2] = c[2] * k;
  }
  rgb(o: number, r: number, g: number, b: number): void {
    const a = this.alb;
    a[o * 3] = r; a[o * 3 + 1] = g; a[o * 3 + 2] = b;
  }
}

let aniso = 4;
function dataTex(data: Uint8Array | Uint8ClampedArray, w: number, h: number, color: boolean, wrap = true): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface TexSet { map: THREE.DataTexture; orm: THREE.DataTexture; normal: THREE.DataTexture; size: [number, number] }

const b8 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);

function finish(im: Img, strength: number, ao: number, size: [number, number]): TexSet {
  const n = im.n, nn = n * n, m = n - 1, h = im.h, alb = im.alb, ro = im.ro, me = im.me;
  const map = new Uint8Array(nn * 4), orm = new Uint8Array(nn * 4), nrm = new Uint8Array(nn * 4);
  const cav = ao > 0 ? blur(h, n, Math.max(2, n >> 7)) : null;
  const s = (strength * n) / 256 / 8;
  for (let y = 0; y < n; y++) {
    const yu = ((y + 1) & m) * n, yc = y * n, yd = ((y - 1) & m) * n;
    for (let x = 0; x < n; x++) {
      const xr = (x + 1) & m, xl = (x - 1) & m, o = yc + x, o4 = o * 4, o3 = o * 3;
      const gx = h[yu + xr] + 2 * h[yc + xr] + h[yd + xr] - h[yu + xl] - 2 * h[yc + xl] - h[yd + xl];
      const gy = h[yu + xl] + 2 * h[yu + x] + h[yu + xr] - h[yd + xl] - 2 * h[yd + x] - h[yd + xr];
      const nx = -gx * s, ny = -gy * s, l = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nrm[o4] = ((nx * l * 0.5 + 0.5) * 255 + 0.5) | 0;
      nrm[o4 + 1] = ((ny * l * 0.5 + 0.5) * 255 + 0.5) | 0;
      nrm[o4 + 2] = ((l * 0.5 + 0.5) * 255 + 0.5) | 0;
      nrm[o4 + 3] = 255;
      map[o4] = b8(alb[o3]); map[o4 + 1] = b8(alb[o3 + 1]); map[o4 + 2] = b8(alb[o3 + 2]); map[o4 + 3] = 255;
      orm[o4] = cav ? b8(1 - Math.max(0, cav[o] - h[o]) * ao) : 255;
      orm[o4 + 1] = b8(ro[o]);
      orm[o4 + 2] = b8(me[o]);
      orm[o4 + 3] = 255;
    }
  }
  const set: TexSet = { map: dataTex(map, n, n, true), orm: dataTex(orm, n, n, false), normal: dataTex(nrm, n, n, false), size };
  for (const t of [set.map, set.orm, set.normal]) t.repeat.set(1 / size[0], 1 / size[1]);
  return set;
}

/* ---------------- material recipes (u right, v up, tile covers `size` metres) ---------------- */

function concrete(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3);
  const pits = worley(n, 44, 211), base = srgb(0x9d9a92);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, pv = frac(v * 2), tv = frac(pv * 2);
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, pu = frac(u * 2), tu = frac(pu * 2), o = y * n + x;
      const panel = hash(Math.floor(u * 2), Math.floor(v * 2), 5);
      const ds = Math.min(pu, 1 - pu, pv, 1 - pv) * 1.2;
      const seam = 1 - smooth(0.0012, 0.0035, ds);
      const lip = smooth(0.003, 0.005, ds) * (1 - smooth(0.005, 0.011, ds));
      const dt = Math.hypot(tu - 0.5, tv - 0.5) * 0.6;
      const hole = 1 - smooth(0.008, 0.012, dt);
      const halo = (1 - smooth(0.012, 0.045, dt)) * (1 - hole);
      const g = hash(x, y, 9);
      const pit = pits.id[o] < 0.3 ? 1 - smooth(0.07, 0.15, pits.f1[o]) : 0;
      const streak = smooth(0.52, 0.85, nz(f3, u, v, 24, 2)) * (0.3 + 0.7 * nz(f1, u, v, 2));
      let k = 0.84 + 0.22 * nz(f0, u, v, 2) + 0.07 * (nz(f2, u, v, 8) - 0.5) + (panel - 0.5) * 0.08 + (g - 0.5) * 0.07;
      k *= (1 - 0.2 * streak) * (1 - 0.4 * seam) * (1 - 0.12 * halo) * (1 - 0.55 * hole) * (1 - 0.4 * pit);
      im.put(o, base, k);
      im.h[o] = 0.55 + 0.07 * nz(f2, u, v, 12) + 0.04 * (g - 0.5) - 0.45 * seam + 0.06 * lip - 0.5 * hole - 0.3 * pit;
      im.ro[o] = 0.84 + 0.1 * nz(f1, u, v, 6) + 0.08 * (seam + hole + pit);
    }
  }
  return im;
}

function concreteIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2);
  const w = worley(n, 30, 307, 0.9), paste = srgb(0x8e8a83);
  const pal = [0x8a847a, 0xa29a8b, 0x6e6a64, 0xb8ad99, 0x7a6e60, 0x5f5b57, 0x9a8f7c].map(srgb);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 13);
      const id = w.id[o], rr = 0.3 + 0.32 * frac(id * 7.31), d = w.f1[o];
      const inside = id < 0.82 ? 1 - smooth(rr - 0.07, rr, d) : 0;
      const c = pal[Math.floor(frac(id * 3.7) * pal.length)];
      const kp = 0.84 + 0.2 * nz(f0, u, v, 2) + (g - 0.5) * 0.28;
      const kc = 0.85 + 0.25 * frac(id * 13.1) + (g - 0.5) * 0.06;
      im.rgb(o, paste[0] * kp + (c[0] * kc - paste[0] * kp) * inside, paste[1] * kp + (c[1] * kc - paste[1] * kp) * inside, paste[2] * kp + (c[2] * kc - paste[2] * kp) * inside);
      im.h[o] = 0.3 + 0.1 * nz(f2, u, v, 8) + (g - 0.5) * 0.08 + inside * (0.3 + 0.3 * Math.sqrt(Math.max(0, 1 - d / rr)));
      im.ro[o] = 0.95 - inside * 0.12;
    }
  }
  return im;
}

function brick(n: number): Img {
  const im = new Img(n), r = makeRng(101), f0 = fld(0), f1 = fld(1), f2 = fld(2);
  const pal = [0x8f3d2b, 0x9c4630, 0x7b3527, 0xa85437, 0x6d2f25, 0x94503a, 0x823a2a];
  const tone: number[] = [];
  for (let i = 0; i < 48; i++) {
    const c = srgb(pal[Math.floor(r() * pal.length)]), k = 0.86 + r() * 0.24;
    tone.push(c[0] * k, c[1] * k, c[2] * k, r());
  }
  const [mr, mg, mb] = srgb(0xaea493);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, rf = v * 12, row = Math.floor(rf), fv = rf - row, off = (row & 1) * 0.5;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, bf = u * 4 + off, bi = Math.floor(bf), fu = bf - bi, o = y * n + x;
      const t = (row * 4 + (bi & 3)) * 4;
      const d = Math.min(Math.min(fu, 1 - fu) * 0.225, Math.min(fv, 1 - fv) * 0.075) + (nz(f2, u, v, 6) - 0.5) * 0.005;
      const b = smooth(0.0042, 0.006, d);
      const g = hash(x, y, 7), pit = g < 0.02 ? 0.6 : 1;
      const k = (0.86 + 0.24 * nz(f0, u, v, 3) + (g - 0.5) * 0.1) * pit;
      const soot = 1 - 0.16 * smooth(0.55, 0.8, nz(f1, u, v, 1));
      const mk = 0.8 + 0.3 * nz(f2, u, v, 12) + (g - 0.5) * 0.15;
      im.rgb(o,
        (mr * mk + (tone[t] * k - mr * mk) * b) * soot,
        (mg * mk + (tone[t + 1] * k - mg * mk) * b) * soot,
        (mb * mk + (tone[t + 2] * k - mb * mk) * b) * soot);
      im.h[o] = 0.2 + 0.1 * nz(f2, u, v, 16) + b * (0.5 + 0.22 * smooth(0.004, 0.014, d) + 0.08 * nz(f0, u, v, 8) + tone[t + 3] * 0.05) - (1 - pit) * 0.3;
      im.ro[o] = 0.95 - b * (0.07 + 0.05 * tone[t + 3]);
    }
  }
  return im;
}

function brickIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2);
  const w = worley(n, 48, 331), base = srgb(0xc27b56), mortar = srgb(0xa9a396);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 17);
      const pore = (w.id[o] < 0.45 ? 1 - smooth(0.1, 0.18, w.f1[o]) : 0) + (g < 0.04 ? 0.5 : 0);
      const m = smooth(0.62, 0.7, nz(f1, u, v, 2));
      const k = (0.82 + 0.25 * nz(f0, u, v, 2) + (g - 0.5) * 0.15) * (1 - 0.4 * clamp01(pore));
      const km = 0.85 + 0.2 * nz(f2, u, v, 8);
      im.rgb(o, base[0] * k + (mortar[0] * km - base[0] * k) * m, base[1] * k + (mortar[1] * km - base[1] * k) * m, base[2] * k + (mortar[2] * km - base[2] * k) * m);
      im.h[o] = 0.5 + 0.15 * nz(f2, u, v, 10) - 0.4 * clamp01(pore) + m * 0.08;
      im.ro[o] = 0.95;
    }
  }
  return im;
}

function plaster(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3), base = srgb(0xdcd8ce);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 19);
      const dirt = smooth(0.6, 0.85, nz(f1, u, v, 1)) * 0.12;
      const crack = (1 - smooth(0.003, 0.009, Math.abs(nz(f1, u, v, 4) - 0.5))) * smooth(0.58, 0.72, nz(f3, u, v, 3));
      const k = (0.94 + 0.07 * nz(f0, u, v, 2) + (g - 0.5) * 0.04) * (1 - dirt) * (1 - crack * 0.35);
      im.put(o, base, k);
      im.h[o] = 0.5 + 0.25 * nz(f2, u, v, 16) + 0.15 * nz(f3, u, v, 32) + (g - 0.5) * 0.06 - crack * 0.3;
      im.ro[o] = 0.88 + 0.07 * nz(f0, u, v, 6);
    }
  }
  return im;
}

function plasterIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), f3 = fld(3), base = srgb(0xe3dfd4);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 23);
      const pore = g < 0.05 ? 0.8 : 1;
      im.put(o, base, (0.88 + 0.12 * nz(f0, u, v, 2) + (g - 0.5) * 0.08) * pore);
      im.h[o] = 0.5 + 0.2 * nz(f2, u, v, 12) + 0.1 * nz(f3, u, v, 24) + (g - 0.5) * 0.12 - (1 - pore);
      im.ro[o] = 0.97;
    }
  }
  return im;
}

function rowNoise(n: number, seed: number): Float32Array {
  const a = new Float32Array(n);
  for (let y = 0; y < n; y++) a[y] = hash(y, 0, seed);
  const b = new Float32Array(n);
  for (let y = 0; y < n; y++) b[y] = (a[(y - 1 + n) % n] + 2 * a[y] + a[(y + 1) % n]) * 0.25;
  return b;
}

function wood(n: number): Img {
  const im = new Img(n), r = makeRng(401), f0 = fld(0), f1 = fld(1), f3 = fld(3);
  const pal = [0x8b6a45, 0x7d5d3c, 0x96744f, 0x6f5236, 0x86643f].map(srgb), grey = srgb(0x8a857c), nail = srgb(0x3a3431);
  const P = 8, pl: number[] = [];
  for (let i = 0; i < P; i++) pl.push(r(), Math.floor(r() * pal.length), 0.88 + r() * 0.22, r(), r());
  const rows = rowNoise(n, 29);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, pf = v * P, pi = Math.floor(pf), pv = pf - pi, b = pi * 5;
    const c = pal[pl[b + 1]], tone = pl[b + 2];
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const pu = frac(u - pl[b]), du = Math.min(pu, 1 - pu) * 1.6, dv = Math.min(pv, 1 - pv) * 0.2;
      const edge = Math.min(du, dv);
      const gap = 1 - smooth(0.0012, 0.003, edge);
      const round = smooth(0.0012, 0.01, edge);
      const kx = frac(u - pl[b + 3] + 0.5) - 0.5, kd = Math.hypot((kx * 1.6) / 0.04, ((pv - 0.5) * 0.2) / 0.022);
      const warp = nz(f0, u, v, 2) * 2.2 + 1.4 / (1 + kd * kd);
      const ring = 0.5 + 0.5 * Math.sin((pv * 7 + warp + pl[b + 4] * 6) * Math.PI * 2);
      const fib = 0.6 * nz(f3, u, v, 2, 48) + 0.4 * rows[y];
      const knot = 1 - smooth(0.55, 1.0, kd);
      const k = tone * (0.8 + 0.14 * ring * ring + 0.14 * fib) * (1 - 0.5 * knot) * (1 - 0.8 * gap);
      const gr = smooth(0.45, 0.8, nz(f1, u, v, 1)) * 0.35;
      const nd = Math.min(Math.hypot(du - 0.025, (pv - 0.25) * 0.2), Math.hypot(du - 0.025, (pv - 0.75) * 0.2));
      const nl = 1 - smooth(0.003, 0.0045, nd);
      for (let ch = 0; ch < 3; ch++) {
        const w = (c[ch] + (grey[ch] - c[ch]) * gr) * k;
        im.alb[o * 3 + ch] = w + (nail[ch] - w) * nl;
      }
      im.h[o] = 0.55 + 0.1 * ring + 0.1 * fib - 0.25 * (1 - round) - 0.5 * gap + 0.08 * knot + 0.04 * nl;
      im.ro[o] = 0.78 + 0.1 * fib + 0.1 * gap - 0.25 * nl;
      im.me[o] = nl * 0.6;
    }
  }
  return im;
}

function woodIn(n: number): Img {
  const im = new Img(n), f2 = fld(2), f3 = fld(3), base = srgb(0xd6bb8c), rows = rowNoise(n, 31);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const fib = 0.55 * nz(f3, u, v, 2, 64) + 0.45 * rows[y];
      const f2v = nz(f2, u, v, 3, 24);
      const dark = smooth(0.62, 0.75, fib);
      im.put(o, base, (0.8 + 0.22 * fib + 0.1 * f2v) * (1 - 0.2 * dark));
      im.h[o] = 0.35 + 0.45 * fib + 0.2 * f2v;
      im.ro[o] = 0.9;
    }
  }
  return im;
}

function steel(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3);
  const chips = worley(n, 26, 509);
  const paint = srgb(0x3b434c), rA = srgb(0x5e2f16), rB = srgb(0x9a5528), bare = srgb(0x8d9196);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 21);
      const rust = smooth(0.6, 0.7, nz(f1, u, v, 2) + 0.3 * (nz(f2, u, v, 10) - 0.5));
      const bleed = smooth(0.55, 0.85, nz(f3, u, v, 36, 3)) * smooth(0.45, 0.62, nz(f1, u, v + 0.03, 2)) * 0.6;
      const rm = clamp01(rust + bleed * (1 - rust));
      const chip = (chips.id[o] < 0.28 ? 1 - smooth(0.16, 0.22, chips.f1[o]) : 0) * (1 - rust);
      const t = nz(f3, u, v, 16), kp = 0.9 + 0.14 * nz(f0, u, v, 3) + (g - 0.5) * 0.05, kb = 0.9 + 0.2 * g;
      for (let ch = 0; ch < 3; ch++) {
        let c = paint[ch] * kp;
        c += (rA[ch] + (rB[ch] - rA[ch]) * t - c) * rm;
        im.alb[o * 3 + ch] = c + (bare[ch] * kb - c) * chip;
      }
      im.me[o] = 0.2 * (1 - rm) + chip * 0.75;
      im.ro[o] = 0.5 + 0.08 * nz(f2, u, v, 8) + rm * 0.4 - chip * 0.15;
      im.h[o] = 0.6 + 0.04 * nz(f2, u, v, 16) + rust * (0.1 * (nz(f3, u, v, 24) - 0.5) - 0.05 + (g - 0.5) * 0.04) - chip * 0.025;
    }
  }
  return im;
}

function steelIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), sc = scratches(n, 260, 71), base = srgb(0xaeb2b7);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, s = sc[o], g = hash(x, y, 33);
      im.put(o, base, 0.9 + 0.1 * nz(f0, u, v, 3) + (g - 0.5) * 0.04 + s * 0.12);
      im.me[o] = 1;
      im.ro[o] = 0.34 + 0.12 * nz(f2, u, v, 6) - s * 0.14;
      im.h[o] = 0.5 - s * 0.25 + 0.03 * nz(f2, u, v, 12);
    }
  }
  return im;
}

function metal(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3);
  const base = srgb(0xb6bec4), rust = srgb(0x8a4a24), screw = srgb(0x4a4d50);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 41);
      const prof = 0.5 + 0.5 * Math.cos(u * 20 * Math.PI * 2);
      const dirt = smooth(0.5, 0.9, nz(f3, u, v, 40, 2)) * 0.25 + (1 - prof) * 0.06;
      const cu = ((frac(u * 20 + 0.5) - 0.5) / 20) * 1.52, cv = ((frac(v * 2 + 0.5) - 0.5) / 2) * 1.52;
      const sd = Math.hypot(cu, cv);
      const sw = 1 - smooth(0.005, 0.007, sd);
      const halo = (1 - smooth(0.006, 0.03, sd)) * smooth(0.45, 0.7, nz(f1, u, v, 6));
      const rs = clamp01(smooth(0.66, 0.74, nz(f1, u, v, 3) + 0.25 * (nz(f2, u, v, 14) - 0.5)) + halo * 0.8);
      const k = (0.88 + 0.12 * nz(f0, u, v, 2) + (g - 0.5) * 0.05) * (1 - dirt), kr = 0.8 + 0.3 * nz(f2, u, v, 20);
      for (let ch = 0; ch < 3; ch++) {
        const c = base[ch] * k + (rust[ch] * kr - base[ch] * k) * rs;
        im.alb[o * 3 + ch] = c + (screw[ch] - c) * sw;
      }
      im.me[o] = 0.45 * (1 - rs) * (1 - sw) + sw * 0.7;
      im.ro[o] = 0.5 + 0.12 * nz(f2, u, v, 6) + rs * 0.35 + dirt * 0.2;
      im.h[o] = prof * 0.85 + 0.03 * nz(f2, u, v, 20) + sw * 0.12;
    }
  }
  return im;
}

function roof(n: number): Img {
  const im = new Img(n), r = makeRng(603), f0 = fld(0), f1 = fld(1), f2 = fld(2);
  const pal = [0xa65336, 0x9b4a2f, 0xb4603f, 0x8f4429, 0xa9583a, 0x96503a].map(srgb), moss = srgb(0x6f7258);
  const tone: number[] = [];
  for (let i = 0; i < 48; i++) {
    const c = pal[Math.floor(r() * pal.length)], k = 0.88 + r() * 0.22;
    tone.push(c[0] * k, c[1] * k, c[2] * k);
  }
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, rf = v * 6, ri = Math.floor(rf), pv = rf - ri;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, cf = u * 8, ci = Math.floor(cf), pu = cf - ci, o = y * n + x;
      const t = (ri * 8 + (ci & 7)) * 3, g = hash(x, y, 61);
      const arch = Math.pow(Math.sin(Math.PI * pu), 0.6);
      const gapU = 1 - smooth(0, 0.06, Math.min(pu, 1 - pu));
      const lip = smooth(0.82, 1.0, pv);
      const lich = smooth(0.66, 0.74, nz(f1, u, v, 3) + 0.2 * (nz(f2, u, v, 24) - 0.5)) * 0.7;
      const k = (0.84 + 0.2 * nz(f0, u, v, 4) + (g - 0.5) * 0.08) * (1 - 0.55 * lip) * (1 - 0.45 * gapU) * (0.85 + 0.15 * arch);
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] = (tone[t + ch] + (moss[ch] - tone[t + ch]) * lich) * k;
      im.h[o] = 0.3 + 0.35 * (1 - pv) + 0.35 * arch * (1 - gapU) + 0.03 * (g - 0.5);
      im.ro[o] = 0.78 + 0.1 * nz(f2, u, v, 8) + lich * 0.1;
    }
  }
  return im;
}

function roofIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), w = worley(n, 40, 617), base = srgb(0xb5684a);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 67);
      const pore = w.id[o] < 0.35 ? 1 - smooth(0.08, 0.15, w.f1[o]) : 0;
      im.put(o, base, (0.84 + 0.2 * nz(f0, u, v, 2) + (g - 0.5) * 0.14) * (1 - 0.45 * pore));
      im.h[o] = 0.5 + 0.15 * nz(f2, u, v, 10) - 0.4 * pore;
      im.ro[o] = 0.93;
    }
  }
  return im;
}

/** horizontal boards along u; shared by crate and tnt */
function boards(im: Img, count: number, tileU: number, tileV: number, pal: C3[], seed: number, ink: Float32Array | null, inkCol: C3, wearCol: C3): void {
  const n = im.n, r = makeRng(seed), f0 = fld(0), f1 = fld(1), f3 = fld(3), rows = rowNoise(n, seed);
  const pl: number[] = [];
  for (let i = 0; i < count; i++) pl.push(Math.floor(r() * pal.length), 0.86 + r() * 0.24, r());
  const bw = tileV / count;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, bf = v * count, bi = Math.floor(bf), pv = bf - bi, b = bi * 3, c = pal[pl[b]];
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const dv = Math.min(pv, 1 - pv) * bw;
      const gap = 1 - smooth(0.0012, 0.003, dv);
      const round = smooth(0.0012, 0.008, dv);
      const fib = 0.6 * nz(f3, u, v, 3, 48) + 0.4 * rows[y];
      const ring = 0.5 + 0.5 * Math.sin((pv * 5 + nz(f0, u, v, 2) * 2 + pl[b + 2] * 6) * Math.PI * 2);
      const nd = Math.min(Math.hypot((frac(u * 2 + 0.46) - 0.5) * (tileU / 2), (pv - 0.5) * bw), 1);
      const nail = 1 - smooth(0.0028, 0.004, nd);
      const wear = smooth(0.5, 0.8, nz(f1, u, v, 3)) * (1 - round * 0.6);
      const k = pl[b + 1] * (0.82 + 0.1 * ring * ring + 0.14 * fib) * (1 - 0.8 * gap);
      const inkA = ink ? ink[o] * (0.55 + 0.45 * smooth(0.3, 0.5, nz(f1, u, v, 8))) : 0;
      for (let ch = 0; ch < 3; ch++) {
        let w = c[ch] + (wearCol[ch] - c[ch]) * wear * 0.6;
        w = w * k;
        w += (inkCol[ch] - w) * inkA;
        im.alb[o * 3 + ch] = w + (0.22 - w) * nail;
      }
      im.h[o] = 0.55 + 0.08 * ring + 0.1 * fib - 0.25 * (1 - round) - 0.5 * gap + 0.03 * nail;
      im.ro[o] = 0.8 + 0.1 * fib - 0.08 * inkA - 0.3 * nail;
      im.me[o] = nail * 0.6;
    }
  }
}

function crate(n: number): Img {
  const im = new Img(n);
  const ink = mask(n, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(0.3 * n, 0.37 * n); g.rotate(-0.04);
    g.font = `bold ${Math.round(0.075 * n)}px ${FONT}`; g.fillText('FRAGILE', 0, 0, 0.42 * n);
    g.restore();
    g.font = `bold ${Math.round(0.034 * n)}px ${FONT}`; g.fillText('THIS WAY UP', 0.74 * n, 0.8 * n, 0.3 * n);
    for (const ax of [0.68, 0.8]) {
      const cx = ax * n, top = 0.64 * n, s = 0.035 * n;
      g.beginPath(); g.moveTo(cx, top); g.lineTo(cx + s, top + s); g.lineTo(cx + s * 0.4, top + s);
      g.lineTo(cx + s * 0.4, top + s * 2.6); g.lineTo(cx - s * 0.4, top + s * 2.6); g.lineTo(cx - s * 0.4, top + s);
      g.lineTo(cx - s, top + s); g.closePath(); g.fill();
    }
  });
  boards(im, 10, 1.2, 1.2, [0xc29a64, 0xb58b55, 0xcaa472, 0xa98050].map(srgb), 701, ink, srgb(0x2b2622), srgb(0xd9c29a));
  return im;
}

function tnt(n: number): Img {
  const im = new Img(n);
  const ink = mask(n, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${Math.round(0.26 * n)}px ${FONT}`; g.fillText('TNT', 0.5 * n, 0.5 * n, 0.7 * n);
    g.font = `bold ${Math.round(0.075 * n)}px ${FONT}`; g.fillText('DANGER', 0.5 * n, 0.29 * n, 0.5 * n);
    g.font = `bold ${Math.round(0.055 * n)}px ${FONT}`; g.fillText('HIGH EXPLOSIVES', 0.5 * n, 0.69 * n, 0.62 * n);
    g.lineWidth = 0.012 * n; g.strokeRect(0.17 * n, 0.22 * n, 0.66 * n, 0.54 * n);
  });
  boards(im, 10, 1, 1, [0x8f2419, 0x9c2a1d, 0x7f2016, 0xa3301f].map(srgb), 811, ink, srgb(0x141414), srgb(0xb08a5a));
  return im;
}

/* barrel / propane: decal layout driven by object-space coords in the material shader:
   v 0..0.18 = lid, side height h maps to v = 0.6 + y * 0.85, u = two repeats around */
function drum(n: number, body: C3, glossy: number, paint: (im: Img, o: number, u: number, v: number, g: number) => number, text: TextItem[]): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), steelC = srgb(0x3d3f42);
  const txt = textMask(n, text);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, side = v >= 0.19;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 91);
      const rib = side ? Math.exp(-(((v - 0.4725) / 0.011) ** 2)) + Math.exp(-(((v - 0.7275) / 0.011) ** 2)) : 0;
      const chime = side ? 1 - smooth(0.2, 0.24, v) + smooth(0.96, 0.985, v) : 0;
      const k = 0.9 + 0.12 * nz(f0, u, v, 4) + (g - 0.5) * 0.04;
      im.put(o, body, k);
      const special = side ? paint(im, o, u, v, g) : 0;
      const tk = txt[o] * (0.75 + 0.25 * smooth(0.35, 0.55, nz(f1, u, v, 10)));
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] += (0.93 - im.alb[o * 3 + ch]) * tk * (1 - special);
      const wear = clamp01(smooth(0.64, 0.78, nz(f1, u, v, 3) + 0.25 * (nz(f2, u, v, 16) - 0.5)) + rib * 0.5 * smooth(0.45, 0.7, nz(f2, u, v, 20)) + chime * 0.6 * nz(f0, u, v, 12));
      const grime = side ? (1 - smooth(0.2, 0.36, v)) * 0.3 * nz(f1, u, v, 4, 2) : 0;
      for (let ch = 0; ch < 3; ch++) {
        const c = im.alb[o * 3 + ch] * (1 - grime);
        im.alb[o * 3 + ch] = c + (steelC[ch] * (0.9 + 0.2 * g) - c) * wear;
      }
      im.h[o] = 0.5 + rib * 0.35 - chime * 0.08 + 0.08 * nz(f0, u, v, 2) - wear * 0.06;
      im.ro[o] = glossy + 0.08 * nz(f2, u, v, 8) + wear * 0.15 + grime * 0.3;
      im.me[o] = 0.15 + wear * 0.7;
    }
  }
  return im;
}

function barrel(n: number): Img {
  const yel = srgb(0xe2a912), blk = srgb(0x1a1a1a);
  return drum(n, srgb(0xa3221a), 0.38, (im, o, u, v) => {
    if (v < 0.835 || v > 0.905) return 0;
    const s = frac((u + v) * 10) < 0.5 ? yel : blk;
    im.put(o, s, 1);
    return 1;
  }, [{ t: 'FLAMMABLE', x: 0.5, y: 0.6, size: 0.085, width: 0.62 }, { t: 'KEEP AWAY FROM HEAT', x: 0.5, y: 0.535, size: 0.026, width: 0.5 }]);
}

function propane(n: number): Img {
  const red = srgb(0xb3261e), coll = srgb(0x6d7074);
  return drum(n, srgb(0xe9e8e2), 0.32, (im, o, _u, v) => {
    if (v > 0.9) { im.put(o, coll, 1); return 1; }
    if (v > 0.655 && v < 0.675) { im.put(o, red, 1); return 1; }
    if (v > 0.52 && v < 0.54) { im.put(o, red, 1); return 1; }
    return 0;
  }, [{ t: 'PROPANE', x: 0.5, y: 0.6, size: 0.075, width: 0.55 }, { t: 'FLAMMABLE GAS', x: 0.5, y: 0.765, size: 0.03, width: 0.4 }]);
}

function ground(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2);
  const st = worley(n, 56, 911), sm = worley(n, 140, 913);
  const dirtA = srgb(0x7b6852), dirtB = srgb(0x6e675c);
  const pal = [0x8c8880, 0x9e978b, 0x6f6b66, 0xb2aa9c, 0x807565].map(srgb);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 97);
      const mixG = smooth(0.35, 0.7, nz(f1, u, v, 1));
      const damp = smooth(0.55, 0.75, nz(f1, u, v, 2, 3));
      const k = (0.78 + 0.35 * nz(f0, u, v, 3) + (g - 0.5) * 0.18) * (1 - 0.18 * damp);
      const id = st.id[o], rr = 0.2 + 0.25 * frac(id * 5.3);
      const stone = id < 0.55 ? 1 - smooth(rr - 0.05, rr, st.f1[o]) : 0;
      const id2 = sm.id[o], small = id2 < 0.3 ? 1 - smooth(0.18, 0.26, sm.f1[o]) : 0;
      const s = Math.max(stone, small), sc = pal[Math.floor(frac((stone > small ? id : id2) * 7.7) * pal.length)];
      const ks = 0.85 + 0.25 * g;
      for (let ch = 0; ch < 3; ch++) {
        const d = (dirtA[ch] + (dirtB[ch] - dirtA[ch]) * mixG) * k;
        im.alb[o * 3 + ch] = d + (sc[ch] * ks - d) * s;
      }
      im.h[o] = 0.35 + 0.15 * nz(f2, u, v, 6) + (g - 0.5) * 0.1 + stone * (0.3 + 0.3 * Math.sqrt(Math.max(0, 1 - st.f1[o] / rr))) + small * 0.15;
      im.ro[o] = 0.95 - s * 0.12 - damp * 0.08;
    }
  }
  return im;
}

/* viewmodel sets: tile [1,1], the viewmodel sets its own repeats */

function handle(n: number): Img {
  const im = new Img(n), f0 = fld(0), f3 = fld(3), base = srgb(0xa0753f);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 101);
      const grain = nz(f3, u, v, 48, 2), line = smooth(0.62, 0.72, grain);
      im.put(o, base, (0.82 + 0.2 * nz(f0, u, v, 2) + 0.1 * grain + (g - 0.5) * 0.04) * (1 - 0.3 * line));
      im.h[o] = 0.5 + 0.2 * grain;
      im.ro[o] = 0.42 + 0.1 * line;
    }
  }
  return im;
}

function gunmetal(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), sc = scratches(n, 160, 113), base = srgb(0x2e3034), worn = srgb(0x72767c);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 107);
      const w = clamp01(smooth(0.66, 0.8, nz(f1, u, v, 3)) + sc[o] * 0.6);
      const k = 0.9 + 0.15 * nz(f0, u, v, 4) + (g - 0.5) * 0.04;
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] = base[ch] * k + (worn[ch] - base[ch] * k) * w;
      im.me[o] = 0.85 + w * 0.15;
      im.ro[o] = 0.42 + 0.12 * nz(f2, u, v, 6) - w * 0.12;
      im.h[o] = 0.5 + 0.05 * nz(f2, u, v, 16) - sc[o] * 0.2;
    }
  }
  return im;
}

function olive(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), chips = worley(n, 22, 131), sc = scratches(n, 120, 137);
  const base = srgb(0x535d36), metalC = srgb(0x3a3b3d);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 139);
      const chip = clamp01((chips.id[o] < 0.22 ? 1 - smooth(0.14, 0.2, chips.f1[o]) : 0) + sc[o] * 0.7);
      const dirt = smooth(0.55, 0.8, nz(f1, u, v, 2)) * 0.2;
      const k = (0.88 + 0.16 * nz(f0, u, v, 3) + (g - 0.5) * 0.05) * (1 - dirt);
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] = base[ch] * k + (metalC[ch] - base[ch] * k) * chip;
      im.me[o] = 0.1 + chip * 0.75;
      im.ro[o] = 0.62 + 0.1 * nz(f2, u, v, 6) - chip * 0.2;
      im.h[o] = 0.55 - chip * 0.15 + 0.03 * nz(f2, u, v, 12);
    }
  }
  return im;
}

function rubber(n: number): Img {
  const im = new Img(n), f0 = fld(0), base = srgb(0x1f1f20);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const a = Math.abs(Math.sin((u + v) * 24 * Math.PI)), b = Math.abs(Math.sin((u - v) * 24 * Math.PI));
      im.put(o, base, 0.9 + 0.2 * nz(f0, u, v, 4));
      im.h[o] = Math.min(a, b);
      im.ro[o] = 0.82;
    }
  }
  return im;
}

/* ---------------- second-wave structural materials ---------------- */

const mix3 = (im: Img, o: number, c: C3, t: number): void => {
  const a = im.alb;
  for (let ch = 0; ch < 3; ch++) a[o * 3 + ch] += (c[ch] - a[o * 3 + ch]) * t;
};

/** board-formed reinforced concrete: 150 mm board imprints with grain, tie holes on a 0.6 m grid */
function rconcrete(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f3 = fld(3);
  const pits = worley(n, 44, 223), base = srgb(0xa29e95), rows = rowNoise(n, 41), B = 16;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, bf = v * B, bi = Math.floor(bf), pv = bf - bi, tv = frac(v * 4);
    const tone = hash(bi, 0, 43) - 0.5, sh = hash(bi, 1, 43), joint = 1 - smooth(0.0008, 0.0025, Math.min(pv, 1 - pv) * (2.4 / B));
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 47), tu = frac(u * 4);
      const grain = 0.55 * nz(f3, u + sh, v, 2, 64) + 0.45 * rows[y];
      const hole = 1 - smooth(0.008, 0.012, Math.hypot(tu - 0.5, tv - 0.5) * 0.6);
      const pit = pits.id[o] < 0.25 ? 1 - smooth(0.07, 0.14, pits.f1[o]) : 0;
      const streak = smooth(0.55, 0.85, nz(f3, u, v, 24, 2)) * nz(f1, u, v, 2);
      const k = (0.86 + 0.18 * nz(f0, u, v, 2) + tone * 0.1 + (grain - 0.5) * 0.1 + (g - 0.5) * 0.05)
        * (1 - 0.18 * streak) * (1 - 0.1 * joint) * (1 - 0.55 * hole) * (1 - 0.4 * pit);
      im.put(o, base, k);
      im.h[o] = 0.5 + tone * 0.08 + 0.14 * grain + 0.12 * joint - 0.5 * hole - 0.25 * pit + 0.03 * (g - 0.5);
      im.ro[o] = 0.84 + 0.1 * nz(f1, u, v, 6) + 0.06 * (hole + pit);
    }
  }
  return im;
}

/** aggregate break face with rusted bar ends on a ~0.2 m grid and two bars lying in the plane */
function rconcreteIn(n: number): Img {
  const im = concreteIn(n), T = 0.6;
  const rust = srgb(0x7a4022), dark = srgb(0x3b3330), stain = srgb(0x8c5c3a);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, cy = Math.floor(v * 3);
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, cx = Math.floor(u * 3);
      const live = hash(cx, cy, 73) > 0.22;
      const dx = (u * 3 - cx - 0.5) * 0.2 - (hash(cx, cy, 71) - 0.5) * 0.06;
      const dy = (v * 3 - cy - 0.5) * 0.2 - (hash(cx, cy, 72) - 0.5) * 0.06;
      const d = live ? Math.hypot(dx, dy) : 1, r = 0.006 + 0.002 * hash(cx, cy, 74);
      const la = Math.abs(v - 0.33 - 0.004 * Math.sin(u * Math.PI * 6)) * T;
      const lb = Math.abs(u - 0.78 - 0.004 * Math.sin(v * Math.PI * 4)) * T;
      const ld = Math.min(la, lb), lr = 0.007;
      const inBar = Math.max(1 - smooth(r - 0.0015, r, d), 1 - smooth(lr - 0.0015, lr, ld));
      const halo = (1 - smooth(0, 0.03, Math.min(d - r, ld - lr))) * (1 - inBar) * 0.55;
      const core = (1 - smooth(r * 0.35, r * 0.75, d)) * (d < ld ? 1 : 0);
      const rib = 0.5 + 0.5 * Math.sin((la < lb ? u : v) * 54 * Math.PI * 2);
      mix3(im, o, stain, halo);
      const kb = 0.8 + 0.3 * rib * (1 - core);
      for (let ch = 0; ch < 3; ch++) {
        const bar = rust[ch] * kb + (dark[ch] - rust[ch] * kb) * core;
        im.alb[o * 3 + ch] += (bar - im.alb[o * 3 + ch]) * inBar;
      }
      im.h[o] += inBar * (0.18 + 0.05 * rib);
      im.me[o] = inBar * (0.3 + 0.5 * core);
      im.ro[o] += (0.78 - 0.25 * core - im.ro[o]) * inBar;
    }
  }
  return im;
}

/** 390×190 mm concrete masonry units, 10 mm joints, running bond, coarse porous face */
function cinderblock(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), por = worley(n, 110, 521);
  const base = srgb(0x8f8d87), mortar = srgb(0xa19e96);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, rf = v * 4, row = Math.floor(rf), fv = rf - row, off = (row & 1) * 0.5;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, bf = u * 2 + off, bi = Math.floor(bf), fu = bf - bi;
      const t = hash(row, bi & 1, 53), g = hash(x, y, 57);
      const d = Math.min(Math.min(fu, 1 - fu) * 0.4, Math.min(fv, 1 - fv) * 0.2) + (nz(f2, u, v, 8) - 0.5) * 0.003;
      const b = smooth(0.0045, 0.006, d);
      const pore = por.id[o] < 0.55 ? 1 - smooth(0.1, 0.3, por.f1[o]) : 0;
      const kb = (0.84 + 0.18 * nz(f0, u, v, 3) + (t - 0.5) * 0.12 + (g - 0.5) * 0.22) * (1 - 0.45 * pore);
      const km = 0.9 + 0.12 * nz(f1, u, v, 10) + (g - 0.5) * 0.06;
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] = mortar[ch] * km + (base[ch] * kb - mortar[ch] * km) * b;
      im.h[o] = 0.3 + 0.05 * nz(f2, u, v, 16) + b * (0.35 + 0.15 * smooth(0.005, 0.012, d) + 0.08 * nz(f2, u, v, 12) - 0.3 * pore + (g - 0.5) * 0.06);
      im.ro[o] = 0.96;
    }
  }
  return im;
}

/** break face through hollow blocks: porous shell and webs around dark rounded cores (0.2 m grid) */
function cinderblockIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), por = worley(n, 140, 523), base = srgb(0x9a9891);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, py = (frac(v * 4) - 0.5) * 0.2;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, px = (frac(u * 4) - 0.5) * 0.2, g = hash(x, y, 59);
      const qx = Math.abs(px) - 0.05, qy = Math.abs(py) - 0.045;
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.02;
      const hollow = 1 - smooth(-0.003, 0.002, sd);
      const pore = por.id[o] < 0.5 ? 1 - smooth(0.1, 0.3, por.f1[o]) : 0;
      const ks = (0.84 + 0.18 * nz(f0, u, v, 2) + (g - 0.5) * 0.24) * (1 - 0.4 * pore);
      const kh = 0.07 + 0.3 * smooth(-0.025, 0, sd);
      im.put(o, base, ks + (kh - ks) * hollow);
      im.h[o] = (0.7 + 0.06 * nz(f2, u, v, 12) - 0.25 * pore) * (1 - hollow) + hollow * 0.12 * smooth(-0.025, 0, sd);
      im.ro[o] = 0.97;
    }
  }
  return im;
}

/** coursed limestone ashlar: 0.35–0.45 m courses, 0.6–1.2 m blocks, fine joints, claw tooling */
function stone(n: number): Img {
  const im = new Img(n), r = makeRng(1301), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3), T = 2.4;
  const H = [0.45, 0.35, 0.45, 0.35, 0.4, 0.4], rowY: number[] = [];
  let acc = 0;
  for (const h of H) { rowY.push(acc / T); acc += h; }
  rowY.push(1);
  const cuts: number[][] = [], lens: number[][] = [], tone: number[][] = [];
  for (let i = 0; i < H.length; i++) {
    const k = 2 + Math.floor(r() * 3), w: number[] = [];
    let sum = 0;
    for (let j = 0; j < k; j++) { const l = 0.7 + r() * 0.6; w.push(l); sum += l; }
    const c: number[] = [], L: number[] = [], t: number[] = [];
    let p = r();
    for (let j = 0; j < k; j++) { c.push(frac(p)); L.push(w[j] / sum); p += w[j] / sum; t.push(r(), r(), 200 + Math.floor(r() * 120), Math.floor((r() - 0.5) * 200)); }
    cuts.push(c); lens.push(L); tone.push(t);
  }
  const lightC = srgb(0xbdb5a7), warmC = srgb(0xab9f8b);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    let ci = 0;
    while (ci < H.length - 1 && v >= rowY[ci + 1]) ci++;
    const dv = Math.min(v - rowY[ci], rowY[ci + 1] - v) * T;
    const c = cuts[ci], L = lens[ci], tn = tone[ci];
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 61);
      let bj = 0, bu = 2;
      for (let j = 0; j < c.length; j++) { const q = frac(u - c[j]); if (q < bu) { bu = q; bj = j; } }
      const du = Math.min(bu, L[bj] - bu) * T;
      const d = Math.min(du, dv) + (nz(f2, u, v, 8) - 0.5) * 0.003;
      const joint = 1 - smooth(0.0025, 0.0045, d), chamfer = smooth(0.004, 0.025, d);
      const t0 = tn[bj * 4], t1 = tn[bj * 4 + 1];
      const tool = 0.5 + 0.5 * Math.sin((tn[bj * 4 + 2] * u + tn[bj * 4 + 3] * v) * Math.PI * 2);
      const speck = g < 0.05 ? 0.72 : g > 0.97 ? 1.1 : 1;
      const streak = smooth(0.6, 0.9, nz(f3, u, v, 30, 2)) * 0.12;
      const k = (0.88 + 0.16 * (t0 - 0.5) + 0.1 * nz(f0, u, v, 3) + (g - 0.5) * 0.05) * speck * (1 - streak) * (1 - 0.5 * joint);
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] = (lightC[ch] + (warmC[ch] - lightC[ch]) * t1) * k;
      im.h[o] = 0.3 + 0.5 * chamfer + 0.06 * nz(f2, u, v, 10) + 0.035 * tool * chamfer + (g - 0.5) * 0.04 - 0.1 * joint;
      im.ro[o] = 0.82 + 0.08 * nz(f1, u, v, 6) + 0.1 * joint;
    }
  }
  return im;
}

/** fresh granite-like fracture: interlocking crystals with per-grain facets and glints */
function stoneIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), w = worley(n, 96, 1311), mica = srgb(0x3a3835);
  const pal = [0xc9c2b5, 0xb8b1a4, 0xd8d2c6, 0x9a9387, 0xc6b3a0].map(srgb);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, id = w.id[o];
      const c = id < 0.07 ? mica : pal[Math.floor(frac(id * 5.1) * pal.length)];
      im.put(o, c, 0.92 + 0.1 * nz(f0, u, v, 2) + (hash(x, y, 63) - 0.5) * 0.06);
      im.h[o] = 0.5 + (frac(id * 9.7) - 0.5) * 0.25;
      im.ro[o] = 0.5 + 0.35 * frac(id * 3.3);
    }
  }
  return im;
}

/** ochre sandstone ashlar with wavy bedding, iron-stained layers and honeycomb weathering */
function sandstone(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3), pits = worley(n, 36, 1321);
  const base = srgb(0xc9a46b), iron = srgb(0xa9743e), pale = srgb(0xdcc39a);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, rf = v * 4, row = Math.floor(rf), fv = rf - row, off = (row & 1) * 0.5;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 67);
      const warp = (nz(f0, u, v, 2) - 0.5) * 0.04;
      const bed = 0.5 + 0.5 * Math.sin((v + warp) * 40 * Math.PI * 2);
      const fine = nz(f3, u, v + warp, 2, 96);
      const band = smooth(0.62, 0.8, nz(f1, u, v + warp, 1, 12));
      const bf = u * 2 + off, fu = bf - Math.floor(bf);
      const d = Math.min(Math.min(fu, 1 - fu) * 1.2, Math.min(fv, 1 - fv) * 0.6) + (nz(f2, u, v, 8) - 0.5) * 0.004;
      const blk = smooth(0.003, 0.006, d);
      const hc = smooth(0.6, 0.72, nz(f1, u, v, 3)) * (pits.id[o] < 0.6 ? 1 - smooth(0.2, 0.42, pits.f1[o]) : 0);
      const k = (0.84 + 0.08 * bed + 0.08 * fine + 0.1 * nz(f0, u, v, 3) + (g - 0.5) * 0.16) * (1 - 0.35 * hc) * (0.55 + 0.45 * blk);
      im.put(o, base, 1);
      mix3(im, o, pale, 0.3 * bed);
      mix3(im, o, iron, band * 0.55);
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] *= k;
      im.h[o] = 0.35 + 0.08 * bed + 0.06 * fine + 0.3 * smooth(0.003, 0.02, d) - 0.3 * hc + (g - 0.5) * 0.08;
      im.ro[o] = 0.95;
    }
  }
  return im;
}

function sandstoneIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f3 = fld(3), base = srgb(0xd4b07a);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 69);
      const bed = nz(f3, u, v, 1, 16);
      im.put(o, base, 0.84 + 0.1 * bed + 0.08 * nz(f0, u, v, 2) + (g - 0.5) * 0.3);
      im.h[o] = 0.5 + (g - 0.5) * 0.3 + 0.1 * bed;
      im.ro[o] = 0.97;
    }
  }
  return im;
}

/** polished white marble cladding: domain-warped grey veins, faint cloudiness, 1.2 m panel joints */
function marble(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3);
  const base = srgb(0xebe9e4), vein = srgb(0x6c7074), warm = srgb(0xdcd4c8);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, pv = frac(v * 2);
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, pu = frac(u * 2);
      const wx = (nz(f0, u, v, 2) - 0.5) * 0.25, wy = (nz(f2, u, v, 2) - 0.5) * 0.25;
      const a = Math.abs(nz(f1, u + wx, v + wy, 2) - 0.5), b = Math.abs(nz(f3, u + wy * 0.6, v + wx * 0.6, 1) - 0.5);
      const v1 = 1 - smooth(0.003, 0.014, a), v2 = (1 - smooth(0.006, 0.04, b)) * 0.45;
      const cloud = smooth(0.4, 0.8, nz(f0, u + 0.3, v, 3)) * 0.35;
      const joint = 1 - smooth(0.002, 0.0045, Math.min(pu, 1 - pu, pv, 1 - pv) * 1.2);
      im.put(o, base, 0.97 + 0.03 * nz(f2, u, v, 6));
      mix3(im, o, warm, cloud);
      mix3(im, o, vein, Math.max(v1 * 0.85, v2));
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] *= 1 - 0.35 * joint;
      im.h[o] = 0.5 - 0.3 * joint + 0.04 * nz(f2, u, v, 3);
      im.ro[o] = 0.12 + 0.06 * nz(f2, u, v, 8) + 0.05 * v1 + 0.45 * joint;
    }
  }
  return im;
}

/** sugary crystalline break: bright grains with individual facets and roughness, faint vein ghosts */
function marbleIn(n: number): Img {
  const im = new Img(n), f1 = fld(1), w = worley(n, 110, 1331), base = srgb(0xeeece8), vein = srgb(0x9a9ea2);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, id = w.id[o];
      im.put(o, base, 0.92 + 0.08 * id);
      mix3(im, o, vein, (1 - smooth(0.004, 0.02, Math.abs(nz(f1, u, v, 1) - 0.5))) * 0.4);
      im.h[o] = 0.5 + (frac(id * 7.3) - 0.5) * 0.2;
      im.ro[o] = 0.3 + 0.35 * frac(id * 4.1);
    }
  }
  return im;
}

/** decorative fired-clay blocks (0.3 m) with a raised frame, diamond and rosette, part-glazed */
function terracotta(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2);
  const raw = srgb(0xb85b3b), glazed = srgb(0x9c3f27), mortar = srgb(0x9d9486);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, lv = frac(v * 2) - 0.5;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, lu = frac(u * 2) - 0.5, g = hash(x, y, 79);
      const dj = (0.5 - Math.max(Math.abs(lu), Math.abs(lv))) * 0.3;
      const joint = 1 - smooth(0.002, 0.004, dj);
      const frame = smooth(0.005, 0.012, dj) * (1 - smooth(0.028, 0.036, dj));
      const dd = Math.abs(lu) + Math.abs(lv);
      const diamond = smooth(0.36, 0.32, dd) * (1 - smooth(0.26, 0.22, dd) * 0.6);
      const rr = Math.hypot(lu, lv), petal = 0.5 + 0.5 * Math.cos(Math.atan2(lv, lu) * 8);
      const ros = 1 - smooth(0.12 + 0.05 * petal, 0.14 + 0.05 * petal, rr), boss = 1 - smooth(0.035, 0.045, rr);
      const glaze = smooth(0.45, 0.6, nz(f1, u, v, 2));
      const k = (0.88 + 0.14 * nz(f0, u, v, 4) + (g - 0.5) * 0.06) * (1 - 0.15 * (1 - frame) * (1 - ros) * (1 - diamond));
      for (let ch = 0; ch < 3; ch++) {
        const c = (raw[ch] + (glazed[ch] - raw[ch]) * glaze) * k;
        im.alb[o * 3 + ch] = c + (mortar[ch] - c) * joint;
      }
      im.h[o] = (0.3 + 0.35 * frame + 0.2 * diamond + 0.25 * ros + 0.2 * boss + 0.04 * nz(f2, u, v, 16)) * (1 - joint);
      im.ro[o] = 0.78 + (0.3 - 0.78) * glaze + 0.15 * joint;
    }
  }
  return im;
}

function terracottaIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), w = worley(n, 50, 1341), base = srgb(0xc46d4a), grog = srgb(0xe2b48e);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 81);
      const pore = w.id[o] < 0.3 ? 1 - smooth(0.08, 0.16, w.f1[o]) : 0;
      im.put(o, base, (0.85 + 0.18 * nz(f0, u, v, 2) + (g - 0.5) * 0.1) * (1 - 0.4 * pore));
      if (g > 0.965) mix3(im, o, grog, 0.8);
      im.h[o] = 0.5 + 0.12 * nz(f2, u, v, 10) - 0.35 * pore + (g > 0.965 ? 0.1 : 0);
      im.ro[o] = 0.93;
    }
  }
  return im;
}

function strawMask(n: number, count: number, seed: number, tile: number): Float32Array {
  const r = makeRng(seed);
  return mask(n, (g) => {
    g.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = r() * n, y = r() * n, a = r() * Math.PI, l = ((0.01 + r() * 0.03) / tile) * n;
      g.globalAlpha = 0.5 + r() * 0.5;
      g.lineWidth = Math.max(0.7, (0.0012 / tile) * n * (0.7 + r() * 0.6));
      const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
      g.beginPath();
      for (let ox = -n; ox <= n; ox += n) for (let oy = -n; oy <= n; oy += n) { g.moveTo(x + ox, y + oy); g.lineTo(x + dx + ox, y + dy + oy); }
      g.stroke();
    }
  });
}

/** hand-trowelled mud render with straw flecks and shrinkage cracks */
function adobe(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3);
  const base = srgb(0xae8961), straw = srgb(0xcfae62), st = strawMask(n, 420, 1351, 2);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 83);
      const lump = 0.5 * nz(f0, u, v, 4) + 0.3 * nz(f2, u, v, 12) + 0.2 * nz(f3, u, v, 32);
      const crack = (1 - smooth(0.004, 0.012, Math.abs(nz(f1, u, v, 3) - 0.5))) * smooth(0.55, 0.7, nz(f3, u, v, 2));
      im.put(o, base, (0.82 + 0.25 * nz(f0, u, v, 2) + (g - 0.5) * 0.12) * (1 - 0.45 * crack));
      mix3(im, o, straw, st[o] * 0.8);
      im.h[o] = 0.3 + 0.5 * lump - 0.4 * crack + 0.05 * st[o];
      im.ro[o] = 0.97;
    }
  }
  return im;
}

/** crumbly earth: clods with gaps, grit and chopped straw */
function adobeIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), w = worley(n, 40, 1361), base = srgb(0x9d7851), straw = srgb(0xc4a45c), st = strawMask(n, 140, 1363, 0.6);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 85), id = w.id[o];
      const gap = smooth(0.5, 0.7, w.f1[o]);
      im.put(o, base, (0.8 + 0.25 * id + 0.1 * nz(f0, u, v, 2) + (g - 0.5) * 0.2) * (1 - 0.45 * gap));
      mix3(im, o, straw, st[o] * 0.7);
      im.h[o] = 0.35 + 0.35 * id * (1 - gap) - 0.25 * gap + (g - 0.5) * 0.1;
      im.ro[o] = 1;
    }
  }
  return im;
}

/** painted gypsum board: orange-peel roller stipple, feathered tape joints every 1.2 m, screw dimples */
function drywall(n: number): Img {
  const im = new Img(n), f0 = fld(0), f3 = fld(3), base = srgb(0xe9e6de);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, pu = frac(u * 2);
      const tape = 1 - smooth(0.02, 0.07, Math.min(pu, 1 - pu) * 1.2);
      const ds = Math.hypot((frac(u * 6) - 0.5) * 0.4, (frac(v * 8) - 0.5) * 0.3);
      const dimple = 1 - smooth(0.004, 0.007, ds);
      const stip = nz(f3, u, v, 48);
      im.put(o, base, 0.97 + 0.03 * nz(f0, u, v, 2) + 0.015 * tape - 0.03 * dimple);
      im.h[o] = 0.5 + 0.12 * stip + 0.08 * tape - 0.2 * dimple;
      im.ro[o] = 0.86 - 0.06 * tape;
    }
  }
  return im;
}

function drywallIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), base = srgb(0xefede7);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 87), pore = g < 0.08 ? 1 : 0;
      im.put(o, base, (0.93 + 0.06 * nz(f0, u, v, 3) + (g - 0.5) * 0.05) * (1 - 0.12 * pore));
      im.h[o] = 0.5 + 0.2 * nz(f2, u, v, 16) - 0.3 * pore;
      im.ro[o] = 0.98;
    }
  }
  return im;
}

/** quartersawn oak: tight latewood rings, earlywood pores, medullary-ray flecks, drying checks */
function oak(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3), rows = rowNoise(n, 61);
  const dark = srgb(0x5e3f25), light = srgb(0x8d6640);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 89);
      const ring = frac(v * 110 + nz(f0, u, v, 2) * 1.6 + nz(f1, u, v, 1, 2) * 0.8);
      const late = smooth(0.6, 0.9, ring);
      const pore = ring < 0.25 && g < 0.22 ? 1 : 0;
      const ray = smooth(0.74, 0.8, nz(f2, u, v, 6, 96));
      const check = (1 - smooth(0.002, 0.006, Math.abs(nz(f1, u, v, 1, 6) - 0.5))) * smooth(0.6, 0.75, nz(f3, u, v, 2));
      const k = (0.85 + 0.12 * rows[y] + 0.1 * nz(f3, u, v, 2, 48)) * (1 - 0.4 * pore) * (1 - 0.7 * check);
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] = (light[ch] + (dark[ch] - light[ch]) * (0.3 + 0.7 * late)) * k;
      mix3(im, o, light, ray * 0.5);
      im.h[o] = 0.5 + 0.1 * (1 - late) + 0.08 * rows[y] - 0.15 * pore - 0.5 * check + 0.03 * ray;
      im.ro[o] = 0.72 + 0.08 * late;
    }
  }
  return im;
}

function oakIn(n: number): Img {
  const im = new Img(n), f0 = fld(0), f3 = fld(3), base = srgb(0xb2895a), rows = rowNoise(n, 63);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const ring = 0.5 + 0.5 * Math.sin((v * 40 + nz(f0, u, v, 2) * 2) * Math.PI * 2);
      const fib = 0.55 * nz(f3, u, v, 2, 64) + 0.45 * rows[y];
      im.put(o, base, 0.78 + 0.2 * fib + 0.08 * ring);
      im.h[o] = 0.35 + 0.45 * fib + 0.1 * ring;
      im.ro[o] = 0.86;
    }
  }
  return im;
}

/** 1.22 × 2.44 m sheathing panels: rotary-cut face veneer, knots, football patches, grade stamp */
function plywood(n: number): Img {
  const im = new Img(n), r = makeRng(1401), f0 = fld(0), f1 = fld(1), f2 = fld(2), T = 2.44;
  const base = srgb(0xcaa56d), dark = srgb(0x9a723f), patchC = srgb(0xd8b884), ink = srgb(0x3a4a6a);
  const knots: number[] = [], patches: number[] = [];
  for (let i = 0; i < 9; i++) knots.push(r(), r(), 0.012 + r() * 0.02);
  for (let i = 0; i < 4; i++) patches.push(r(), r());
  const stamp = mask(n, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const cx of [0.25, 0.75]) {
      g.font = `bold ${Math.round(0.016 * n)}px ${FONT}`;
      g.fillText('SHEATHING  ·  EXPOSURE 1', cx * n, 0.42 * n, 0.3 * n);
      g.font = `bold ${Math.round(0.011 * n)}px ${FONT}`;
      g.fillText('15/32 INCH  ·  32/16  ·  PS 1-09', cx * n, 0.445 * n, 0.3 * n);
      g.lineWidth = Math.max(1, n / 600); g.strokeRect((cx - 0.12) * n, 0.405 * n, 0.24 * n, 0.055 * n);
    }
  });
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 91), pu = frac(u * 2);
      const gap = 1 - smooth(0.0012, 0.003, Math.min(Math.min(pu, 1 - pu) * (T / 2), Math.min(v, 1 - v) * T));
      const gf = u * 28 + (nz(f0, u, v, 2, 1) - 0.5) * 8 + (nz(f2, u, v, 4, 2) - 0.5) * 2;
      const line = 1 - smooth(0, 0.14, frac(gf));
      let knot = 0, ring = 0;
      for (let i = 0; i < knots.length; i += 3) {
        const dx = (frac(u - knots[i] + 0.5) - 0.5) * T, dy = (frac(v - knots[i + 1] + 0.5) - 0.5) * T, ks = knots[i + 2];
        if (dx * dx + dy * dy > 20 * ks * ks) continue;
        const e = Math.hypot(dx / ks, dy / (ks * 1.5));
        knot = Math.max(knot, 1 - smooth(0.8, 1.1, e));
        ring = Math.max(ring, (1 - smooth(1.2, 3, e)) * (0.5 + 0.5 * Math.cos(e * 5)));
      }
      let patch = 0, rim = 0;
      for (let i = 0; i < patches.length; i += 2) {
        const dx = (frac(u - patches[i] + 0.5) - 0.5) * T, dy = (frac(v - patches[i + 1] + 0.5) - 0.5) * T;
        if (Math.abs(dx) > 0.06 || Math.abs(dy) > 0.13) continue;
        const e = Math.hypot(dx / 0.05, dy / 0.11);
        patch = Math.max(patch, 1 - smooth(0.95, 1.0, e));
        rim = Math.max(rim, 1 - smooth(0, 0.06, Math.abs(e - 1)));
      }
      const k = (0.86 + 0.14 * nz(f1, u, v, 3) + (g - 0.5) * 0.04) * (1 - 0.8 * gap);
      for (let ch = 0; ch < 3; ch++) {
        let c = base[ch] + (dark[ch] - base[ch]) * Math.max(line * 0.55, ring * 0.35 * (1 - patch));
        c += (patchC[ch] - c) * patch;
        c += (0.2 - c) * knot * (1 - patch);
        c *= 1 - 0.35 * rim;
        c += (ink[ch] - c) * stamp[o] * 0.55;
        im.alb[o * 3 + ch] = c * k;
      }
      im.h[o] = 0.5 + 0.05 * line - 0.5 * gap - 0.15 * rim - 0.08 * knot;
      im.ro[o] = 0.8 + 0.08 * line;
    }
  }
  return im;
}

/** cross-laminated plies (~3 mm) with dark glue lines; face plies long-grain, cores end-grain */
function plywoodIn(n: number): Img {
  const im = new Img(n), f3 = fld(3), face = srgb(0xd3b27c), core = srgb(0xa9844f), P = 62;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, pf = v * P, pi = Math.floor(pf), pv = pf - pi, cross = pi & 1;
    const glue = 1 - smooth(0, 0.12, Math.min(pv, 1 - pv));
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 93);
      const fib = cross ? 0.75 + 0.35 * g : 0.8 + 0.25 * nz(f3, u, v, 4, 2 * P);
      im.put(o, cross ? core : face, fib * (1 - 0.55 * glue));
      im.h[o] = 0.5 + (cross ? (g - 0.5) * 0.25 : 0.1) - 0.3 * glue;
      im.ro[o] = 0.88;
    }
  }
  return im;
}

/** painted sand-cast iron: orange-peel casting skin, worn paint over dark iron, pin rust */
function castiron(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3);
  const pits = worley(n, 70, 1411), sc = scratches(n, 90, 1413);
  const paint = srgb(0x2f3335), iron = srgb(0x4b4d4f), rust = srgb(0x6a3b22);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const pit = pits.id[o] < 0.4 ? 1 - smooth(0.12, 0.25, pits.f1[o]) : 0;
      const wear = clamp01(smooth(0.66, 0.8, nz(f1, u, v, 3)) + sc[o] * 0.7);
      const rs = smooth(0.7, 0.8, nz(f3, u, v, 4)) * (1 - wear);
      im.put(o, paint, 0.9 + 0.15 * nz(f0, u, v, 3));
      mix3(im, o, iron, wear);
      mix3(im, o, rust, rs * 0.7);
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] *= 1 - 0.25 * pit;
      im.me[o] = 0.3 * (1 - wear) + 0.9 * wear;
      im.ro[o] = 0.4 + 0.08 * nz(f2, u, v, 8) + 0.1 * wear + 0.4 * rs + 0.2 * pit;
      im.h[o] = 0.5 - 0.2 * pit + 0.05 * nz(f2, u, v, 20) - 0.1 * sc[o];
    }
  }
  return im;
}

/** grey-iron fracture: dull granular faces with dark graphite flakes */
function castironIn(n: number): Img {
  const im = new Img(n), w = worley(n, 120, 1421), base = srgb(0x707274);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = y * n + x, id = w.id[o], g = hash(x, y, 95);
      im.put(o, base, (0.88 + 0.14 * id) * (g < 0.1 ? 0.5 : 1));
      im.h[o] = 0.5 + (frac(id * 6.1) - 0.5) * 0.2;
      im.me[o] = 0.9;
      im.ro[o] = 0.55 + 0.15 * frac(id * 3.7);
    }
  }
  return im;
}

/** clear-anodised extrusion: faint die lines along u, soft mottling */
function aluminum(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), base = srgb(0xb8bdc3), rows = rowNoise(n, 97);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, ex = rows[y];
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      im.put(o, base, 0.95 + 0.06 * nz(f0, u, v, 3) + (ex - 0.5) * 0.05);
      im.me[o] = 1;
      im.ro[o] = 0.22 + 0.08 * ex + 0.04 * nz(f2, u, v, 8);
      im.h[o] = 0.5 + 0.05 * ex;
    }
  }
  return im;
}

function aluminumIn(n: number): Img {
  const im = new Img(n), w = worley(n, 150, 1431), base = srgb(0xcfd3d7);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = y * n + x, id = w.id[o];
      im.put(o, base, 0.9 + 0.1 * id);
      im.h[o] = 0.5 + (frac(id * 5.3) - 0.5) * 0.18;
      im.me[o] = 1;
      im.ro[o] = 0.32 + 0.16 * frac(id * 2.9);
    }
  }
  return im;
}

/** rusted deformed bar (cylinder UVs: u around, v along): scale, pitting, transverse ribs */
function rebarSet(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2);
  const rustA = srgb(0x5e2f18), rustB = srgb(0x9a5a2a), scale = srgb(0x2e2420);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 99);
      const rib = Math.pow(0.5 + 0.5 * Math.sin(v * 60 * Math.PI * 2 + u * Math.PI * 2), 4);
      const lng = 1 - smooth(0.02, 0.05, Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75)));
      const t = nz(f0, u, v, 2, 8), sc = smooth(0.55, 0.7, nz(f1, u, v, 3, 12));
      for (let ch = 0; ch < 3; ch++) im.alb[o * 3 + ch] = (rustA[ch] + (rustB[ch] - rustA[ch]) * t) * (0.85 + 0.3 * g);
      mix3(im, o, scale, sc * 0.7);
      im.h[o] = 0.4 + 0.35 * Math.max(rib, lng) + 0.1 * nz(f2, u, v, 4, 16);
      im.ro[o] = 0.85;
      im.me[o] = sc * 0.4;
    }
  }
  return im;
}

/** Distinct glazed tile, bituminous aggregate and patinated copper finishes. */
function ceramic(n: number): Img {
  const im = new Img(n), f = fld(2), tile = srgb(0xe5e5d8), grout = srgb(0x827c70);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, o = y * n + x;
    const d = Math.min(frac(u * 8), 1 - frac(u * 8), frac(v * 8), 1 - frac(v * 8));
    const joint = 1 - smooth(0.012, 0.035, d), k = 0.86 + 0.17 * nz(f, u, v, 8) + 0.12 * (hash(Math.floor(u * 8), Math.floor(v * 8), 19) - 0.5);
    im.rgb(o, tile[0] * k * (1 - joint) + grout[0] * joint, tile[1] * k * (1 - joint) + grout[1] * joint, tile[2] * k * (1 - joint) + grout[2] * joint);
    im.h[o] = 0.54 + 0.025 * nz(f, u, v, 8) - 0.28 * joint;
    im.ro[o] = 0.16 + 0.65 * joint;
  }
  return im;
}

function asphalt(n: number): Img {
  const im = new Img(n), f = fld(3), light = srgb(0x66635d), dark = srgb(0x252828);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, o = y * n + x;
    const grain = hash(x, y, 73), aggregate = smooth(0.76, 0.87, nz(f, u, v, 16) + (grain - 0.5) * 0.22);
    const k = 0.83 + 0.2 * nz(fld(0), u, v, 2) + 0.16 * (grain - 0.5);
    im.rgb(o, (dark[0] * (1 - aggregate) + light[0] * aggregate) * k,
      (dark[1] * (1 - aggregate) + light[1] * aggregate) * k,
      (dark[2] * (1 - aggregate) + light[2] * aggregate) * k);
    im.h[o] = 0.35 + 0.23 * aggregate + 0.1 * (grain - 0.5);
    im.ro[o] = 0.9 - 0.23 * aggregate;
  }
  return im;
}

/** pipework / busbar copper: bright where handled, brown tarnish, verdigris only in the worst patches */
function copper(n: number): Img {
  const im = new Img(n), f1 = fld(1), f2 = fld(2), f3 = fld(3), sc = scratches(n, 120, 1521);
  const bright = srgb(0xd08a5c), tarn = srgb(0x7c4a30), patina = srgb(0x5a9a88);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, o = y * n + x, s = sc[o];
    const seam = 1 - smooth(0.002, 0.01, Math.min(frac(u * 4), 1 - frac(u * 4)));
    const tn = smooth(0.3, 0.75, nz(f1, u, v, 4, 2) + (hash(x, y, 103) - 0.5) * 0.08) * (1 - s * 0.8);
    const pat = smooth(0.78, 0.9, nz(f3, u, v, 6, 3)) * tn;
    const k = (0.88 + 0.18 * nz(f2, u, v, 8)) * (1 - 0.25 * seam) + s * 0.08;
    for (let ch = 0; ch < 3; ch++) {
      const c = bright[ch] + (tarn[ch] - bright[ch]) * tn * 0.85;
      im.alb[o * 3 + ch] = (c + (patina[ch] - c) * pat) * k;
    }
    im.h[o] = 0.55 - 0.15 * seam + 0.04 * pat - 0.04 * s;
    im.ro[o] = 0.28 + 0.3 * tn + 0.35 * pat + 0.15 * seam - 0.12 * s;
    im.me[o] = (1 - pat) * (1 - 0.5 * seam) * (1 - 0.15 * tn);
  }
  return im;
}

/** freshly torn copper: pink-bright, granular */
function copperIn(n: number): Img {
  const im = new Img(n), w = worley(n, 110, 1531), base = srgb(0xd9906a);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = y * n + x, id = w.id[o];
    im.put(o, base, 0.85 + 0.2 * id);
    im.h[o] = 0.5 + (frac(id * 5.7) - 0.5) * 0.2;
    im.me[o] = 1;
    im.ro[o] = 0.3 + 0.18 * frac(id * 3.1);
  }
  return im;
}

/** satin extruded plastic, near-white so the instance tint sets grey / white / orange */
function pvc(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), f3 = fld(3), rows = rowNoise(n, 1541), sc = scratches(n, 70, 1543);
  const base = srgb(0xdedcd6), grime = srgb(0x6d6a62);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, ex = rows[y];
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, s = sc[o];
      const dirt = smooth(0.55, 0.9, nz(f3, u, v, 6, 2)) * 0.35;
      im.put(o, base, 0.93 + 0.05 * nz(f0, u, v, 3) + (ex - 0.5) * 0.03 - s * 0.05);
      mix3(im, o, grime, dirt * 0.4);
      im.ro[o] = 0.36 + 0.06 * ex + 0.05 * nz(f2, u, v, 8) + s * 0.25 + dirt * 0.3;
      im.h[o] = 0.5 + 0.02 * ex - 0.06 * s;
    }
  }
  return im;
}

/** snapped plastic: stress-whitened, matte */
function pvcIn(n: number): Img {
  const im = new Img(n), w = worley(n, 40, 1551, 0.95), f2 = fld(2), base = srgb(0xe4e2dc);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, o = y * n + x, e = 1 - smooth(0.02, 0.08, w.f1[o]);
    im.put(o, base, 0.9 + 0.08 * w.id[o] + 0.06 * e);
    im.h[o] = 0.5 + 0.12 * nz(f2, u, v, 8) - 0.1 * e;
    im.ro[o] = 0.62 + 0.1 * w.id[o];
  }
  return im;
}

/** light fitting: dark prismatic frosted glass behind a wire guard. Metalness marks the guard, and the
    lamp shader masks emission with it, so the bars stay dark against a lit bulb. */
function lamp(n: number): Img {
  const im = new Img(n), f2 = fld(2), glass = srgb(0x465156), bar = srgb(0x1e1f20);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n, prism = 0.5 + 0.5 * Math.cos(v * 12 * Math.PI * 2);
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const du = Math.min(frac(u * 3), 1 - frac(u * 3)), dv = Math.min(frac(v * 2), 1 - frac(v * 2));
      const cage = 1 - smooth(0.012, 0.025, Math.min(du / 3, dv / 2));
      const frost = 0.5 + 0.5 * nz(f2, u, v, 16);
      im.put(o, glass, 0.9 + 0.12 * prism + 0.05 * frost);
      mix3(im, o, bar, cage);
      im.h[o] = 0.45 + 0.08 * prism + 0.3 * cage;
      im.ro[o] = 0.06 + 0.16 * frost * (1 - prism) + cage * 0.4;
      im.me[o] = cage * 0.85;
    }
  }
  return im;
}

function lampIn(n: number): Img {
  const im = new Img(n), f2 = fld(2), base = srgb(0x8fa3a0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n, o = y * n + x;
    im.put(o, base, 0.9 + 0.1 * nz(f2, u, v, 8));
    im.h[o] = 0.5 + 0.04 * nz(f2, u, v, 16);
    im.ro[o] = 0.1;
  }
  return im;
}

/** painted cast machinery housing: light neutral enamel for the instance tint, bolted panel seams,
    a louvred grille, edge wear to bare steel and oil grime. Bare metal escapes the tint in the shader. */
function machine(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3), sc = scratches(n, 110, 1561);
  const paint = srgb(0xc4c6c0), bare = srgb(0x8d9196), bolt = srgb(0x55585c), oil = srgb(0x2a2520);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 157);
      const su = Math.min(frac(u * 2), 1 - frac(u * 2)), sv = Math.min(v, 1 - v), edge = Math.min(su, sv);
      const seam = 1 - smooth(0.002, 0.006, edge);
      // bolt heads every 0.1 tile along both seam families, set in from the seam line
      const bu = frac(u * 10) - 0.5, bv = frac(v * 10) - 0.5;
      const dCol = Math.hypot(su - 0.025, bv / 10), dRow = Math.hypot(bu / 10, sv - 0.025);
      const bd = Math.min(dCol, dRow), bh = 1 - smooth(0.008, 0.011, bd);
      const inGrille = u > 0.58 && u < 0.92 && v > 0.12 && v < 0.42 ? 1 : 0;
      const slot = inGrille * (1 - smooth(0.25, 0.4, Math.abs(frac(v * 40) - 0.5) * 2));
      const frame = inGrille ? 0 : (u > 0.56 && u < 0.94 && v > 0.1 && v < 0.44 ? 1 : 0);
      const wear = clamp01(smooth(0.72, 0.86, nz(f1, u, v, 3) + (1 - smooth(0.004, 0.05, edge)) * 0.35) + sc[o] * 0.8) * (1 - bh);
      const grime = smooth(0.5, 0.85, nz(f3, u, v, 24, 2)) * smooth(0.4, 0.7, nz(f0, u, v, 2)) * 0.5;
      im.put(o, paint, 0.9 + 0.1 * nz(f0, u, v, 3) + (g - 0.5) * 0.04);
      mix3(im, o, oil, grime * 0.6 + seam * 0.5 + slot * 0.85);
      mix3(im, o, bolt, bh * 0.6);
      mix3(im, o, bare, wear);
      im.me[o] = wear * 0.9 + bh * 0.3;
      im.ro[o] = 0.42 + 0.08 * nz(f2, u, v, 8) + grime * 0.25 - wear * 0.1 + slot * 0.4;
      im.h[o] = 0.55 + 0.03 * nz(f2, u, v, 16) - 0.35 * seam + 0.25 * bh - 0.3 * slot + 0.08 * frame - 0.02 * wear;
    }
  }
  return im;
}

/* ---------------- finishes (render-only surface layers over any material) ---------------- */

/** metallic-paint flake: white-noise height gives every texel its own facet tilt, which mips away to flat at range */
function flake(n: number): Img {
  const im = new Img(n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = y * n + x;
    im.rgb(o, 1, 1, 1);
    im.h[o] = hash(x, y, 1601);
    im.ro[o] = 0.35;
  }
  return im;
}

/** clearcoat orange peel: soft low-amplitude waviness */
function peel(n: number): Img {
  const im = new Img(n), f2 = fld(2), f3 = fld(3);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      im.rgb(o, 1, 1, 1);
      im.h[o] = 0.6 * nz(f2, u, v, 8) + 0.4 * nz(f3, u, v, 4);
      im.ro[o] = 0.3;
    }
  }
  return im;
}

/** powder-coat / enamel: white base (the instance tint is the paint), fine stipple, faint scuffs */
function satin(n: number): Img {
  const im = new Img(n), f0 = fld(0), f2 = fld(2), f3 = fld(3), sc = scratches(n, 90, 1607), base = srgb(0xededeb);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 1609);
      im.put(o, base, 0.97 + 0.05 * nz(f0, u, v, 3) + (g - 0.5) * 0.02 + sc[o] * 0.04);
      im.ro[o] = 0.44 + 0.07 * nz(f2, u, v, 6) - sc[o] * 0.12;
      im.h[o] = 0.5 + 0.3 * nz(f3, u, v, 8) + 0.08 * g - sc[o] * 0.1;
    }
  }
  return im;
}

/** hot-dip galvanising: zinc spangles, each crystal its own tone and sheen, with feathered dendrites */
function galv(n: number): Img {
  const im = new Img(n), f2 = fld(2), f3 = fld(3), sp = worley(n, 14, 1621);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, id = sp.id[o];
      const fe = nz(f3, u, v, 4), t = 0.64 + 0.16 * id + 0.05 * fe + 0.03 * nz(f2, u, v, 2);
      im.rgb(o, t * 0.98, t, t * 1.02);
      im.me[o] = 1;
      im.ro[o] = 0.2 + 0.26 * frac(id * 7.31) + 0.06 * fe;
      im.h[o] = 0.5 + 0.06 * id + 0.015 * fe;
    }
  }
  return im;
}

/** block tread: square lugs (orientation-free, the tread faces' UVs turn with the facet) with diagonal sipes */
function tread(n: number): Img {
  const im = new Img(n), f0 = fld(0), base = srgb(0x1d1d1e);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x;
      const bu = frac(u * 6), bv = frac(v * 6), edge = Math.min(bu, 1 - bu, bv, 1 - bv);
      const lug = smooth(0.08, 0.13, edge), sipe = 1 - smooth(0.02, 0.05, Math.abs(frac((u + v) * 12) - 0.5));
      im.put(o, base, (0.9 + 0.2 * nz(f0, u, v, 4)) * (0.7 + 0.3 * lug));
      im.ro[o] = 0.84 + 0.06 * (1 - lug);
      im.h[o] = lug * (1 - 0.35 * sipe * lug);
    }
  }
  return im;
}

/** plain machine plate: grey enamel, faint rolling streaks, scuffs through to steel (metallic texels stay untinted) */
function plate(n: number): Img {
  const im = new Img(n), f0 = fld(0), f1 = fld(1), f2 = fld(2), f3 = fld(3), sc = scratches(n, 70, 1631);
  const paint = srgb(0xa2a8ac), bare = srgb(0x8d9196);
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, o = y * n + x, g = hash(x, y, 1637);
      const wear = clamp01(smooth(0.76, 0.88, nz(f1, u, v, 3)) * 0.6 + sc[o] * 0.8);
      im.put(o, paint, 0.93 + 0.08 * nz(f0, u, v, 2) + 0.03 * nz(f3, u, v, 1, 16) + (g - 0.5) * 0.02);
      mix3(im, o, bare, wear);
      im.me[o] = wear * 0.9;
      im.ro[o] = 0.46 + 0.08 * nz(f2, u, v, 6) - wear * 0.12;
      im.h[o] = 0.5 + 0.02 * nz(f2, u, v, 12) - 0.03 * wear;
    }
  }
  return im;
}

/* ---------------- set registry ---------------- */

export type SetId =
  | 'concrete' | 'concreteIn' | 'brick' | 'brickIn' | 'plaster' | 'plasterIn' | 'wood' | 'woodIn'
  | 'steel' | 'steelIn' | 'metal' | 'roof' | 'roofIn' | 'crate' | 'tnt' | 'barrel' | 'propane'
  | 'ground' | 'handle' | 'gunmetal' | 'olive' | 'rubber'
  | 'rconcrete' | 'rconcreteIn' | 'cinderblock' | 'cinderblockIn' | 'stone' | 'stoneIn' | 'sandstone' | 'sandstoneIn'
  | 'marble' | 'marbleIn' | 'terracotta' | 'terracottaIn' | 'ceramic' | 'ceramicIn' | 'asphalt' | 'asphaltIn' | 'copper' | 'copperIn'
  | 'adobe' | 'adobeIn' | 'drywall' | 'drywallIn'
  | 'oak' | 'oakIn' | 'plywood' | 'plywoodIn' | 'castiron' | 'castironIn' | 'aluminum' | 'aluminumIn' | 'rebar'
  | 'pvc' | 'pvcIn' | 'lamp' | 'lampIn' | 'machine'
  | 'flake' | 'peel' | 'satin' | 'galv' | 'tread' | 'plate';

/** res = [low, medium, high] texture size */
interface Recipe { size: [number, number]; normal: number; ao: number; res: [number, number, number]; gen: (n: number) => Img }
const BIG: [number, number, number] = [256, 512, 1024], MID: [number, number, number] = [256, 512, 512];
const SMALL: [number, number, number] = [128, 256, 256], PROP: [number, number, number] = [256, 512, 512];
const RECIPES: Record<SetId, Recipe> = {
  concrete: { size: [2.4, 2.4], normal: 2.4, ao: 3, res: BIG, gen: concrete },
  concreteIn: { size: [0.6, 0.6], normal: 2.2, ao: 3, res: SMALL, gen: concreteIn },
  brick: { size: [0.9, 0.9], normal: 2.4, ao: 3, res: MID, gen: brick },
  brickIn: { size: [0.6, 0.6], normal: 4.8, ao: 2, res: SMALL, gen: brickIn },
  plaster: { size: [2, 2], normal: 1.8, ao: 1.5, res: MID, gen: plaster },
  plasterIn: { size: [0.6, 0.6], normal: 3.5, ao: 1.5, res: SMALL, gen: plasterIn },
  wood: { size: [1.6, 1.6], normal: 1.6, ao: 2.5, res: MID, gen: wood },
  woodIn: { size: [0.6, 0.6], normal: 4.8, ao: 2, res: SMALL, gen: woodIn },
  steel: { size: [1.5, 1.5], normal: 4, ao: 1.5, res: MID, gen: steel },
  steelIn: { size: [0.6, 0.6], normal: 2, ao: 0, res: SMALL, gen: steelIn },
  metal: { size: [1.52, 1.52], normal: 3.2, ao: 2, res: MID, gen: metal },
  roof: { size: [1.6, 1.5], normal: 6.5, ao: 3, res: MID, gen: roof },
  roofIn: { size: [0.6, 0.6], normal: 9, ao: 2, res: SMALL, gen: roofIn },
  crate: { size: [1.2, 1.2], normal: 1.6, ao: 2, res: PROP, gen: crate },
  tnt: { size: [1, 1], normal: 1.6, ao: 2, res: PROP, gen: tnt },
  barrel: { size: [1, 1], normal: 8, ao: 1, res: PROP, gen: barrel },
  propane: { size: [1, 1], normal: 8, ao: 1, res: PROP, gen: propane },
  ground: { size: [4, 4], normal: 1.3, ao: 3, res: BIG, gen: ground },
  handle: { size: [1, 1], normal: 1.5, ao: 0, res: PROP, gen: handle },
  gunmetal: { size: [1, 1], normal: 2, ao: 0, res: PROP, gen: gunmetal },
  olive: { size: [1, 1], normal: 4, ao: 0, res: PROP, gen: olive },
  rubber: { size: [1, 1], normal: 1.5, ao: 1, res: PROP, gen: rubber },
  rconcrete: { size: [2.4, 2.4], normal: 4.5, ao: 3, res: MID, gen: rconcrete },
  rconcreteIn: { size: [0.6, 0.6], normal: 2.2, ao: 3, res: SMALL, gen: rconcreteIn },
  cinderblock: { size: [0.8, 0.8], normal: 2.4, ao: 3, res: MID, gen: cinderblock },
  cinderblockIn: { size: [0.8, 0.8], normal: 3, ao: 4, res: SMALL, gen: cinderblockIn },
  stone: { size: [2.4, 2.4], normal: 3, ao: 3, res: MID, gen: stone },
  stoneIn: { size: [0.6, 0.6], normal: 3.2, ao: 1.5, res: SMALL, gen: stoneIn },
  sandstone: { size: [2.4, 2.4], normal: 2.5, ao: 3, res: MID, gen: sandstone },
  sandstoneIn: { size: [0.6, 0.6], normal: 3.4, ao: 1.5, res: SMALL, gen: sandstoneIn },
  marble: { size: [2.4, 2.4], normal: 3, ao: 1, res: MID, gen: marble },
  marbleIn: { size: [0.6, 0.6], normal: 3, ao: 1, res: SMALL, gen: marbleIn },
  terracotta: { size: [0.6, 0.6], normal: 4, ao: 3, res: MID, gen: terracotta },
  terracottaIn: { size: [0.6, 0.6], normal: 8, ao: 2, res: SMALL, gen: terracottaIn },
  ceramic: { size: [1.6, 1.6], normal: 2.2, ao: 2, res: MID, gen: ceramic },
  ceramicIn: { size: [0.6, 0.6], normal: 7, ao: 2, res: SMALL, gen: terracottaIn },
  asphalt: { size: [1.6, 1.6], normal: 2.5, ao: 2, res: MID, gen: asphalt },
  asphaltIn: { size: [0.6, 0.6], normal: 3, ao: 2, res: SMALL, gen: concreteIn },
  copper: { size: [1.2, 1.2], normal: 2.2, ao: 1.5, res: MID, gen: copper },
  copperIn: { size: [0.6, 0.6], normal: 2.5, ao: 0, res: SMALL, gen: copperIn },
  pvc: { size: [1, 1], normal: 1.2, ao: 0.5, res: SMALL, gen: pvc },
  pvcIn: { size: [0.4, 0.4], normal: 2, ao: 1, res: SMALL, gen: pvcIn },
  lamp: { size: [0.3, 0.3], normal: 2.5, ao: 1, res: SMALL, gen: lamp },
  lampIn: { size: [0.4, 0.4], normal: 1, ao: 0, res: SMALL, gen: lampIn },
  machine: { size: [1.2, 1.2], normal: 3, ao: 2, res: MID, gen: machine },
  adobe: { size: [2, 2], normal: 5, ao: 3, res: MID, gen: adobe },
  adobeIn: { size: [0.6, 0.6], normal: 3, ao: 3, res: SMALL, gen: adobeIn },
  drywall: { size: [2.4, 2.4], normal: 2.2, ao: 1, res: MID, gen: drywall },
  drywallIn: { size: [0.6, 0.6], normal: 2, ao: 1, res: SMALL, gen: drywallIn },
  oak: { size: [1.2, 1.2], normal: 1.6, ao: 2, res: MID, gen: oak },
  oakIn: { size: [0.6, 0.6], normal: 3, ao: 2, res: SMALL, gen: oakIn },
  plywood: { size: [2.44, 2.44], normal: 8, ao: 2, res: MID, gen: plywood },
  plywoodIn: { size: [0.2, 0.2], normal: 1.5, ao: 2, res: SMALL, gen: plywoodIn },
  castiron: { size: [1, 1], normal: 3, ao: 1.5, res: MID, gen: castiron },
  castironIn: { size: [0.6, 0.6], normal: 4, ao: 1, res: SMALL, gen: castironIn },
  aluminum: { size: [0.6, 0.6], normal: 3, ao: 0, res: MID, gen: aluminum },
  aluminumIn: { size: [0.6, 0.6], normal: 3.5, ao: 0, res: SMALL, gen: aluminumIn },
  rebar: { size: [1, 1], normal: 3, ao: 1, res: SMALL, gen: rebarSet },
  flake: { size: [0.25, 0.25], normal: 1, ao: 0, res: SMALL, gen: flake },
  peel: { size: [0.3, 0.3], normal: 3, ao: 0, res: SMALL, gen: peel },
  satin: { size: [1, 1], normal: 1.2, ao: 0, res: MID, gen: satin },
  galv: { size: [0.6, 0.6], normal: 1.5, ao: 0, res: MID, gen: galv },
  tread: { size: [0.24, 0.24], normal: 5, ao: 1.5, res: SMALL, gen: tread },
  plate: { size: [1.5, 1.5], normal: 1, ao: 0, res: MID, gen: plate },
};

let tier = 1;
const sets = new Map<SetId, TexSet>();

/** resolution tier for everything generated after this call */
export function configureTextures(q: Quality, maxAniso: number): void {
  tier = q === 'high' ? 2 : q === 'medium' ? 1 : 0;
  aniso = Math.max(1, Math.min(maxAniso, q === 'high' ? 8 : q === 'medium' ? 4 : 2));
}

export function texSet(id: SetId): TexSet {
  let s = sets.get(id);
  if (!s) {
    const r = RECIPES[id];
    s = finish(r.gen(r.res[tier]), r.normal, r.ao, r.size);
    sets.set(id, s);
  }
  return s;
}

/* ---------------- fx / scenery textures ---------------- */

/** 2×2 atlas: cells 0-2 billowy puffs, cell 3 a smooth glow. R = density, G = lighting detail. */
export function smokeAtlas(): THREE.DataTexture {
  const n = 512, c = 256, d = new Uint8ClampedArray(n * n * 4), r = makeRng(77), f0 = fld(0), f2 = fld(2);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell & 1) * c, oy = (cell >> 1) * c, blobs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, rr = r() * 0.32;
      blobs.push(Math.cos(a) * rr, Math.sin(a) * rr, 0.3 + r() * 0.28);
    }
    const sx = r() * 256, sy = r() * 256;
    for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
      const px = ((x + 0.5) / c) * 2 - 1, py = ((y + 0.5) / c) * 2 - 1, rad = Math.hypot(px, py);
      let dens: number, det: number;
      if (cell === 3) {
        dens = Math.exp(-rad * rad * 4.5) * (1 - smooth(0.8, 1.0, rad));
        det = 0.5;
      } else {
        let b = 0;
        for (let k = 0; k < blobs.length; k += 3) {
          const dx = px - blobs[k], dy = py - blobs[k + 1], q = 1 - (dx * dx + dy * dy) / (blobs[k + 2] * blobs[k + 2]);
          if (q > b) b = q;
        }
        const nn = tap(f0, sx + px * 40, sy + py * 40) * 0.55 + tap(f2, sx + px * 90, sy + py * 90) * 0.45;
        const t = clamp01((b * 1.1 + (nn - 0.5) * 0.9) * 1.25) * (1 - smooth(0.78, 0.97, rad));
        dens = t * t * (3 - 2 * t);
        det = nn;
      }
      const o = ((oy + y) * n + ox + x) * 4;
      d[o] = dens * 255; d[o + 1] = det * 255; d[o + 2] = 0; d[o + 3] = 255;
    }
  }
  return dataTex(d, n, n, false, false);
}

/** R = soot coverage, G = ember mask */
export function scorchTex(): THREE.DataTexture {
  const n = 256, d = new Uint8ClampedArray(n * n * 4), f0 = fld(0), f2 = fld(2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = ((x + 0.5) / n) * 2 - 1, py = ((y + 0.5) / n) * 2 - 1, rad = Math.hypot(px, py), ang = Math.atan2(py, px);
    const nn = tap(f0, px * 50 + 30, py * 50 + 70), n2 = tap(f2, px * 120, py * 120);
    const rays = 0.5 + 0.5 * Math.sin(ang * 9 + nn * 6);
    const edge = 0.55 + 0.3 * rays + (nn - 0.5) * 0.35;
    const soot = (1 - smooth(edge * 0.55, edge, rad)) * (0.7 + 0.3 * n2) * (1 - smooth(0.9, 1.0, rad));
    const ember = smooth(0.62, 0.75, n2) * (1 - smooth(0.2, 0.6, rad)) * (hash(x, y, 5) < 0.5 ? 1 : 0.4);
    const o = (y * n + x) * 4;
    d[o] = soot * 255; d[o + 1] = ember * 255; d[o + 2] = 0; d[o + 3] = 255;
  }
  return dataTex(d, n, n, false, false);
}

/** additive glow with star spikes (muzzle flash, lamps); linear RGB */
export function flashTex(): THREE.DataTexture {
  const n = 128, d = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = ((x + 0.5) / n) * 2 - 1, py = ((y + 0.5) / n) * 2 - 1, rad = Math.hypot(px, py), ang = Math.atan2(py, px);
    const spikes = Math.pow(Math.abs(Math.cos(ang * 3)), 16) * Math.exp(-rad * 2.2) * 0.8;
    const v = clamp01((Math.exp(-rad * rad * 9) + spikes) * (1 - smooth(0.85, 1.0, rad)));
    const o = (y * n + x) * 4;
    d[o] = v * 255; d[o + 1] = v * 255; d[o + 2] = v * 255; d[o + 3] = v * 255;
  }
  return dataTex(d, n, n, false, false);
}

/** small wick flame: teardrop glow with its base at v = 0, brightest low; linear RGB, additive */
export function flameTex(): THREE.DataTexture {
  const w = 32, h = 64, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = ((x + 0.5) / w) * 2 - 1, v = (y + 0.5) / h;
    const half = 0.95 * Math.sin(Math.PI * Math.pow(v, 0.55)) * (1 - v * 0.3);
    const q = half > 1e-3 ? Math.abs(u) / half : 2;
    const s = clamp01(1 - q * q) * Math.pow(1 - v, 0.7) * smooth(0, 0.1, v);
    const o = (y * w + x) * 4;
    d[o] = s * 255; d[o + 1] = s * 255; d[o + 2] = s * 255; d[o + 3] = s * 255;
  }
  return dataTex(d, w, h, false, false);
}

/** diamond chain-link wire; alpha = wire coverage */
export function chainlinkTex(): THREE.DataTexture {
  const n = 128, d = new Uint8ClampedArray(n * n * 4), k = 4;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n;
    const a = Math.abs(frac((u + v) * k) - 0.5), b = Math.abs(frac((u - v) * k) - 0.5);
    const w = Math.max(1 - smooth(0.012, 0.03, 0.5 - a), 1 - smooth(0.012, 0.03, 0.5 - b));
    const o = (y * n + x) * 4, s = 150 + 50 * w;
    d[o] = s; d[o + 1] = s + 4; d[o + 2] = s + 8; d[o + 3] = w * 255;
  }
  return dataTex(d, n, n, true);
}

/** tower-crane lattice section: frame + diagonal; alpha = steel coverage */
export function latticeTex(): THREE.DataTexture {
  const n = 128, d = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n, v = (y + 0.5) / n;
    const frame = Math.min(u, 1 - u, v, 1 - v);
    const diag = Math.abs(u - v) / Math.SQRT2;
    const w = Math.max(1 - smooth(0.03, 0.05, frame), 1 - smooth(0.015, 0.03, diag));
    const o = (y * n + x) * 4;
    d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = w * 255;
  }
  return dataTex(d, n, n, false);
}

/** light-cone falloff: bright at v = 1 (lamp), soft toward the ground and the sides */
export function coneTex(): THREE.DataTexture {
  const w = 64, h = 128, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (y + 0.5) / h, u = (x + 0.5) / w;
    const s = Math.pow(v, 2.2) * (0.75 + 0.25 * Math.sin(u * Math.PI * 12) ** 2);
    const o = (y * w + x) * 4;
    d[o] = s * 255; d[o + 1] = s * 255; d[o + 2] = s * 255; d[o + 3] = 255;
  }
  return dataTex(d, w, h, false, false);
}

/** yellow/black 45° hazard stripes, one stripe pair per tile */
export function hazardTex(): THREE.DataTexture {
  const n = 64, d = new Uint8Array(n * n * 4), yel = srgb(0xe8b40c), blk = srgb(0x161616);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = frac((x + y + 1) / n) >= 0.5 ? blk : yel, o = (y * n + x) * 4;
    d[o] = b8(c[0]); d[o + 1] = b8(c[1]); d[o + 2] = b8(c[2]); d[o + 3] = 255;
  }
  return dataTex(d, n, n, true);
}

/** tileable low-frequency fbm: R and G are independent fields (large-scale ground variation) */
export function noiseTex(): THREE.DataTexture {
  const f1 = fld(1), f2 = fld(2), d = new Uint8Array(F * F * 4);
  for (let i = 0; i < F * F; i++) { d[i * 4] = b8(f1[i]); d[i * 4 + 1] = b8(f2[i]); d[i * 4 + 3] = 255; }
  return dataTex(d, F, F, false);
}

/** 160 m site mask centred on the origin (v = world z): R work area, G tyre tracks, B puddles */
export function siteMask(): THREE.DataTexture {
  const n = 1024, W = 160, ppm = n / W, d = new Uint8ClampedArray(n * n * 4), f0 = fld(0), f1 = fld(1), r = makeRng(1201);
  const tracks = mask(n, (g) => {
    g.lineCap = 'round';
    const cv = (x: number, z: number): [number, number] => [(x / W + 0.5) * n, (1 - (z / W + 0.5)) * n];
    for (let t = 0; t < 7; t++) {
      const a0 = r() * Math.PI * 2, a1 = a0 + Math.PI + (r() - 0.5) * 1.6;
      const p0: [number, number] = [Math.cos(a0) * 70, Math.sin(a0) * 70], p3: [number, number] = [Math.cos(a1) * 70, Math.sin(a1) * 70];
      const c1: [number, number] = [(r() - 0.5) * 70, (r() - 0.5) * 70], c2: [number, number] = [(r() - 0.5) * 70, (r() - 0.5) * 70];
      const dx = p3[0] - p0[0], dz = p3[1] - p0[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz2 = dx / l;
      g.globalAlpha = 0.5 + r() * 0.5;
      g.lineWidth = 0.45 * ppm;
      for (const side of [-0.95, 0.95]) {
        const o = (p: [number, number]): [number, number] => cv(p[0] + nx * side, p[1] + nz2 * side);
        const a = o(p0), b = o(c1), c = o(c2), e = o(p3);
        g.beginPath(); g.moveTo(a[0], a[1]); g.bezierCurveTo(b[0], b[1], c[0], c[1], e[0], e[1]); g.stroke();
      }
    }
  });
  for (let y = 0; y < n; y++) {
    const z = ((y + 0.5) / n - 0.5) * W, v = (y + 0.5) / n;
    for (let x = 0; x < n; x++) {
      const wx = ((x + 0.5) / n - 0.5) * W, u = (x + 0.5) / n, o = y * n + x;
      const rad = Math.hypot(wx, z) + (nz(f0, u, v, 3) - 0.5) * 14;
      const work = 1 - smooth(50, 66, rad);
      const pud = smooth(0.7, 0.74, nz(f1, u, v, 6) + 0.15 * (nz(f0, u, v, 24) - 0.5)) * work;
      d[o * 4] = work * 255; d[o * 4 + 1] = tracks[o] * work * 255; d[o * 4 + 2] = pud * 255; d[o * 4 + 3] = 255;
    }
  }
  return dataTex(d, n, n, false, false);
}

/* ---------------- painted canvas textures (signs, hoarding, cabins) ---------------- */

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  if (!hasDom) return dataTex(new Uint8ClampedArray([180, 180, 180, 255]), 1, 1, true);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

export function signTex(): THREE.Texture {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#c21d17'; g.fillRect(0, 0, 256, 70);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 52px ${FONT}`; g.fillText('DANGER', 128, 37, 230);
    g.fillStyle = '#f0b400'; g.strokeStyle = '#111'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(128, 84); g.lineTo(178, 168); g.lineTo(78, 168); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = `bold 58px ${FONT}`; g.fillText('!', 128, 136);
    g.font = `bold 26px ${FONT}`; g.fillText('DEMOLITION SITE', 128, 196, 236);
    g.font = `bold 22px ${FONT}`; g.fillText('KEEP OUT', 128, 228, 236);
    g.strokeStyle = '#222'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 250);
  });
}

export function hoardingTex(): THREE.Texture {
  return canvasTex(1024, 256, (g) => {
    g.fillStyle = '#26402f'; g.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + (i % 3) * 0.02})`; g.fillRect((i * 97) % 1024, 0, 18, 256); }
    for (let x = -64; x < 1024; x += 64) {
      g.fillStyle = '#e8b40c'; g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 32, 214); g.lineTo(x + 64, 214); g.lineTo(x + 32, 256); g.fill();
      g.fillStyle = '#151515'; g.beginPath(); g.moveTo(x + 32, 256); g.lineTo(x + 64, 214); g.lineTo(x + 96, 214); g.lineTo(x + 64, 256); g.fill();
    }
    g.fillStyle = '#f3efe2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 70px ${FONT}`; g.fillText('DESTRUCTOVIBE', 512, 80, 900);
    g.fillStyle = '#e8b40c'; g.font = `bold 34px ${FONT}`; g.fillText('CONTROLLED DEMOLITION  ·  SITE 7', 512, 150, 900);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, 6, 256); g.fillRect(1018, 0, 6, 256);
  });
}

export function cabinTex(emissive: boolean): THREE.Texture {
  return canvasTex(512, 256, (g) => {
    if (emissive) {
      g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#fff'; g.fillRect(52, 76, 170, 90); g.fillRect(262, 82, 110, 64); g.fillRect(420, 70, 44, 40);
      return;
    }
    g.fillStyle = '#d9d6cc'; g.fillRect(0, 0, 512, 256);
    for (let x = 0; x < 512; x += 16) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, 0, 3, 256); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x + 3, 0, 2, 256); }
    g.fillStyle = 'rgba(80,70,50,0.25)'; g.fillRect(0, 226, 512, 30);
    g.fillStyle = '#6b6e70'; g.fillRect(44, 68, 186, 106); g.fillRect(254, 74, 126, 80);
    g.fillStyle = '#1d2a33'; g.fillRect(52, 76, 170, 90); g.fillRect(262, 82, 110, 64);
    g.fillStyle = 'rgba(160,190,210,0.35)'; g.beginPath(); g.moveTo(60, 160); g.lineTo(140, 80); g.lineTo(170, 80); g.lineTo(90, 160); g.fill();
    g.fillStyle = '#3d5a78'; g.fillRect(410, 60, 64, 196);
    g.fillStyle = '#1d2a33'; g.fillRect(420, 70, 44, 40);
    g.fillStyle = '#c9c9c9'; g.fillRect(462, 150, 8, 18);
    g.fillStyle = '#e8b40c'; g.fillRect(262, 176, 110, 26);
    g.fillStyle = '#111'; g.font = `bold 18px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SITE OFFICE', 317, 190, 104);
  });
}
