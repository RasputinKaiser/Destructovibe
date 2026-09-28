import { rand } from '../util';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;

function ctx(): AudioContext {
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = volume;
    master.connect(ac.destination);
  }
  return ac;
}
function out(): GainNode { ctx(); return master!; }

export function setVolume(v: number): void {
  volume = v;
  if (master) master.gain.value = v;
}
export function getVolume(): number { return volume; }

function noise(dur: number): AudioBufferSourceNode {
  const a = ctx();
  const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = a.createBufferSource(); s.buffer = b; return s;
}
function env(g: GainNode, peak: number, dur: number): void {
  const a = ctx();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), a.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
}

export const sfx = {
  resume(): void { try { ctx().resume(); } catch { /* no audio */ } },
  boom(v = 1): void {
    try {
      const a = ctx();
      const o = a.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(28, a.currentTime + .5);
      const g = a.createGain(); env(g, .7 * v, .7);
      o.connect(g).connect(out()); o.start(); o.stop(a.currentTime + .75);
      const n = noise(.5);
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
      const g2 = a.createGain(); env(g2, .5 * v, .5);
      n.connect(f).connect(g2).connect(out()); n.start();
    } catch { /* no audio */ }
  },
  thud(v: number, type: string): void {
    try {
      const a = ctx(); const n = noise(.14);
      const f = a.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = type === 'metal' ? 900 : type === 'wood' ? 500 : 300; f.Q.value = 1.2;
      const g = a.createGain(); env(g, .3 * v, .16);
      n.connect(f).connect(g).connect(out()); n.start();
    } catch { /* no audio */ }
  },
  snap(): void {
    try {
      const a = ctx(); const n = noise(.12);
      const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
      const g = a.createGain(); env(g, .4, .13);
      n.connect(f).connect(g).connect(out()); n.start();
    } catch { /* no audio */ }
  },
  crumble(): void {
    try {
      const a = ctx(); const n = noise(.45);
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = a.createGain(); env(g, .4, .5);
      n.connect(f).connect(g).connect(out()); n.start();
    } catch { /* no audio */ }
  },
  clang(v: number): void {
    try {
      const a = ctx();
      [620, 940, 1420].forEach((fr, i) => {
        const o = a.createOscillator(); o.type = 'triangle';
        o.frequency.value = fr * rand(.96, 1.04);
        const g = a.createGain(); env(g, .14 * v / (i + 1), .4 + i * .1);
        o.connect(g).connect(out()); o.start(); o.stop(a.currentTime + .6);
      });
    } catch { /* no audio */ }
  },
  shear(): void {
    try {
      const a = ctx(); const n = noise(.35);
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = .8;
      const g = a.createGain(); env(g, .45, .4);
      n.connect(f).connect(g).connect(out()); n.start();
      this.clang(1);
    } catch { /* no audio */ }
  },
  fire(kind: string): void {
    try {
      const a = ctx(); const n = noise(kind === 'rocket' ? .3 : .1);
      const f = a.createBiquadFilter(); f.type = kind === 'rocket' ? 'lowpass' : 'bandpass';
      f.frequency.value = kind === 'rocket' ? 900 : 1200;
      const g = a.createGain(); env(g, kind === 'rocket' ? .4 : .25, kind === 'rocket' ? .35 : .12);
      n.connect(f).connect(g).connect(out()); n.start();
    } catch { /* no audio */ }
  },
  beep(freq = 880, dur = 0.08, v = 0.2): void {
    try {
      const a = ctx();
      const o = a.createOscillator(); o.type = 'square'; o.frequency.value = freq;
      const g = a.createGain(); env(g, v, dur);
      o.connect(g).connect(out()); o.start(); o.stop(a.currentTime + dur + .05);
    } catch { /* no audio */ }
  },
  win(): void {
    try {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => this.beep(f, .18, .18), i * 130));
    } catch { /* no audio */ }
  },
  lose(): void {
    try {
      [392, 330, 262].forEach((f, i) =>
        setTimeout(() => this.beep(f, .22, .16), i * 180));
    } catch { /* no audio */ }
  },
};
