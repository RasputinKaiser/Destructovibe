import { mulberry32 } from 'math/random';

export interface Bank {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  /** sparse decaying grains: debris patter, crumble modulation */
  crackle: AudioBuffer;
  glass: AudioBuffer[];
  /** tempered pane bursting: a dense cloud of tiny cube clicks, no long shard ring */
  tempered: AudioBuffer[];
  crickets: AudioBuffer;
  /** outdoor slapback + short diffuse tail */
  ir: AudioBuffer;
  /** blast N-wave with a positive phase of NWAVE_T s; stretch with playbackRate */
  nwave: AudioBuffer;
}

export const NWAVE_T = 0.004;

function normalize(peak: number, ...chans: Float32Array[]): void {
  let m = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m <= 0) return;
  const k = peak / m;
  for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= k;
}

// Blend the process's continuation past the end into the head so looped playback has no seam.
function loopFill(d: Float32Array, fade: number, gen: () => number): void {
  const L = d.length;
  const F = Math.min(fade, L >> 2);
  for (let i = 0; i < L; i++) d[i] = gen();
  for (let i = 0; i < F; i++) {
    const w = (i / F) * (Math.PI / 2);
    d[i] = d[i] * Math.sin(w) + gen() * Math.cos(w);
  }
}

export function makeBank(ctx: BaseAudioContext): Bank {
  const sr = ctx.sampleRate;
  const st = mulberry32.create(0xdecade);
  const r = () => mulberry32.sample(st);
  const n = () => r() * 2 - 1;
  const mk = (sec: number, ch = 1) => ctx.createBuffer(ch, Math.max(1, Math.round(sec * sr)), sr);

  const white = mk(2);
  {
    const d = white.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = n();
  }

  const pink = mk(3);
  {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    const d = pink.getChannelData(0);
    loopFill(d, sr * 0.05, () => {
      const w = n();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const o = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return o;
    });
    normalize(0.9, d);
  }

  const brown = mk(4);
  {
    let last = 0;
    const d = brown.getChannelData(0);
    loopFill(d, sr * 0.08, () => (last = (last + 0.02 * n()) / 1.02));
    normalize(0.9, d);
  }

  const crackle = mk(3);
  {
    const d = crackle.getChannelData(0);
    const L = d.length;
    let i = 0;
    for (;;) {
      i += 1 + Math.floor((sr * -Math.log(1 - r())) / 75);
      if (i >= L) break;
      const a = Math.pow(r(), 2.4) * (r() < 0.5 ? -1 : 1);
      const len = Math.floor(sr * (0.0005 + r() * 0.0035));
      const tau = len * 0.3;
      for (let k = 0; k < len && i + k < L; k++) d[i + k] += a * n() * Math.exp(-k / tau);
    }
    normalize(0.95, d);
  }

  const glass = [0, 1, 2].map(() => {
    const b = mk(1.4);
    const d = b.getChannelData(0);
    const L = d.length;
    const shards = 28 + Math.floor(r() * 16);
    for (let s = 0; s < shards; s++) {
      const t0 = Math.floor(sr * 1.05 * Math.pow(r(), 2.3));
      const amp = (0.25 + 0.75 * r()) * Math.pow(1 - t0 / L, 1.4);
      const parts = 2 + Math.floor(r() * 2);
      for (let p = 0; p < parts; p++) {
        // damped two-pole resonator: cheap decaying sinusoid without per-sample sin/exp
        const f = 1800 + r() * 6400;
        const dec = 0.012 + r() * 0.08;
        const w = (2 * Math.PI * f) / sr;
        const rad = Math.exp(-1 / (dec * sr));
        const c2 = 2 * rad * Math.cos(w);
        const r2 = rad * rad;
        let y1 = (amp * Math.sin(w)) / parts;
        let y2 = 0;
        const len = Math.min(L - t0, Math.floor(dec * sr * 5));
        for (let k = 0; k < len; k++) {
          const y = c2 * y1 - r2 * y2;
          d[t0 + k] += y1;
          y2 = y1;
          y1 = y;
        }
      }
    }
    let prev = 0;
    const crash = Math.min(L, Math.floor(sr * 0.25));
    for (let k = 0; k < crash; k++) {
      const x = n() * Math.exp(-k / (sr * 0.035));
      d[k] += (x - prev) * 0.7;
      prev = x;
    }
    normalize(0.9, d);
    return b;
  });

  const tempered = [0, 1].map(() => {
    const b = mk(1.1);
    const d = b.getChannelData(0);
    const L = d.length;
    const cubes = 520 + Math.floor(r() * 220);
    for (let c = 0; c < cubes; c++) {
      const t0 = Math.floor(sr * 0.85 * Math.pow(r(), 2.8));
      const amp = (0.15 + 0.85 * r()) * Math.pow(1 - t0 / L, 1.2) * (r() < 0.08 ? 1.7 : 1);
      const w = (2 * Math.PI * (2600 + r() * 7000)) / sr;
      const dec = 0.0018 + r() * 0.007;
      const rad = Math.exp(-1 / (dec * sr));
      const c2 = 2 * rad * Math.cos(w);
      const r2 = rad * rad;
      let y1 = amp * Math.sin(w);
      let y2 = 0;
      const len = Math.min(L - t0, Math.floor(dec * sr * 5));
      for (let k = 0; k < len; k++) {
        const y = c2 * y1 - r2 * y2;
        d[t0 + k] += y1;
        y2 = y1;
        y1 = y;
      }
    }
    let prev = 0;
    const burst = Math.min(L, Math.floor(sr * 0.4));
    for (let k = 0; k < burst; k++) {
      const x = n() * Math.exp(-k / (sr * 0.06));
      d[k] += (x - prev) * 0.8;
      prev = x;
    }
    normalize(0.9, d);
    return b;
  });

  const crickets = mk(4, 2);
  {
    const Lc = crickets.getChannelData(0);
    const Rc = crickets.getChannelData(1);
    const L = Lc.length;
    for (let c = 0; c < 5; c++) {
      const w = (2 * Math.PI * (4100 + r() * 1300)) / sr;
      const pan = r() * 2 - 1;
      const gl = Math.cos(((pan + 1) * Math.PI) / 4);
      const gr = Math.sin(((pan + 1) * Math.PI) / 4);
      const rate = 26 + r() * 16;
      const pulses = 3 + Math.floor(r() * 3);
      const period = 0.42 + r() * 0.55;
      const amp = 0.35 + r() * 0.65;
      const plen = Math.floor((sr * 0.55) / rate);
      const pulse = new Float32Array(plen);
      for (let k = 0; k < plen; k++) pulse[k] = amp * Math.sin(w * k) * Math.sin((Math.PI * k) / plen);
      for (let tc = r() * period; tc < 3.7; tc += period * (0.9 + r() * 0.2)) {
        if (r() < 0.12) continue;
        for (let p = 0; p < pulses; p++) {
          const s0 = Math.floor((tc + p / rate) * sr);
          for (let k = 0; k < plen && s0 + k < L; k++) {
            Lc[s0 + k] += pulse[k] * gl;
            Rc[s0 + k] += pulse[k] * gr;
          }
        }
      }
    }
    normalize(0.8, Lc, Rc);
  }

  const ir = mk(2.4, 2);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const L = d.length;
    const kDecay = Math.exp(-1 / (0.3 * sr));
    const kDark = Math.exp(-1 / (0.45 * sr));
    let lp = 0;
    let decay = 0.6;
    let bright = 0.5;
    for (let i = 0; i < L; i++) {
      const t = i / sr;
      lp += (bright + 0.05) * (n() - lp);
      bright *= kDark;
      const on = t < 0.01 ? 0 : Math.min(1, (t - 0.01) / 0.035);
      d[i] = lp * decay * on;
      decay *= kDecay;
    }
    const taps = [0.043, 0.071, 0.102, 0.139, 0.198, 0.27];
    const gains = [0.85, 0.6, 0.5, 0.36, 0.26, 0.17];
    const len = Math.floor(sr * 0.006);
    for (let j = 0; j < taps.length; j++) {
      const s0 = Math.floor((taps[j] + (r() - 0.5) * 0.008 + ch * 0.003) * sr);
      let sm = 0;
      for (let k = 0; k < len && s0 + k < L; k++) {
        sm += 0.35 * (n() - sm);
        d[s0 + k] += gains[j] * sm * 2.2 * Math.exp(-k / (len * 0.25));
      }
    }
  }

  const nwave = mk(NWAVE_T * 2.6);
  {
    const d = nwave.getChannelData(0);
    const P = Math.round(NWAVE_T * sr);
    // shock front (1 sample rise), linear expansion through zero to underpressure, then a softer closing shock
    for (let i = 0; i < 2 * P; i++) d[i] = 1 - i / P;
    for (let i = 2 * P; i < d.length; i++) d[i] = -Math.exp(-(i - 2 * P) / (P * 0.12));
  }

  return { white, pink, brown, crackle, glass, tempered, crickets, ir, nwave };
}
