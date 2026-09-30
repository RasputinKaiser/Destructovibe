import type { Vec3, MaterialId, WeaponId, EnvPreset } from '../types';
import { clamp } from 'math';
import { mulberry32 } from 'math/random';
import { makeBank, NWAVE_T, type Bank } from './bank';
import { MATS as PHYS } from '../destruction/materials';

type Surface = 'dirt' | 'concrete' | 'wood' | 'metal';
type UiSound = 'click' | 'hover' | 'win' | 'lose' | 'star' | 'target' | 'deny' | 'combo' | 'toast';
/** hit fraction along `translation` from `origin`, or null when the ray is clear */
export type RayQuery = (origin: Vec3, translation: Vec3) => number | null;

const MAX_VOICES = 24;
const HRTF_BUDGET = 8;
const SOUND_SPEED = 343;
/** P-wave in compacted ground: the floor shakes before the air carries the roar */
const GROUND_SPEED = 1500;
const RAY_BUDGET = 40;
const PROBE_LEN = 80;
const UP: Vec3 = [0, 1, 0];

const rs = mulberry32.create(0x0d15ea5e);
const rnd = () => mulberry32.sample(rs);
const rr = (a: number, b: number) => a + (b - a) * rnd();

let ctx: AudioContext | null = null;
let B!: Bank;
let master!: GainNode;
let world!: GainNode;
let pauseLP!: BiquadFilterNode;
let muffle!: BiquadFilterNode;
let uiBus!: GainNode;
let verbIn!: GainNode;
let ambBus!: GainNode;
let ringGain!: GainNode;
let ringOsc!: OscillatorNode;
let shapeCurve!: Float32Array<ArrayBuffer>;

const L: Vec3 = [0, 1.7, 0];
const F: Vec3 = [0, 0, -1];
const U: Vec3 = [0, 1, 0];
let volume = 0.8;
let paused = false;

const live = (): boolean => ctx !== null && ctx.state === 'running';
const volGain = (v: number) => (v <= 0 ? 0 : Math.pow(clamp(v, 0, 1), 1.6));
const distTo = (p: Vec3) => Math.hypot(p[0] - L[0], p[1] - L[1], p[2] - L[2]);

/* ---------------- propagation: rays, occlusion, air ---------------- */

let rayQ: RayQuery | null = null;
let rayN = 0;
let rayReset = -1;
let raysTotal = 0;
const _ro: Vec3 = [0, 0, 0];
const _rt: Vec3 = [0, 0, 0];

/** hit fraction along the segment o -> (x, y, z) clipped to `len`; null = clear, undefined = out of ray budget */
function cast(o: Vec3, x: number, y: number, z: number, len = Infinity): number | null | undefined {
  const now = ctx!.currentTime;
  if (now - rayReset > 0.05) {
    rayReset = now;
    rayN = 0;
  }
  if (rayN >= RAY_BUDGET) return undefined;
  rayN++;
  raysTotal++;
  _ro[0] = o[0];
  _ro[1] = o[1];
  _ro[2] = o[2];
  const dx = x - o[0], dy = y - o[1], dz = z - o[2];
  const d = Math.hypot(dx, dy, dz) || 1;
  const k = Math.min(len, d) / d;
  _rt[0] = dx * k;
  _rt[1] = dy * k;
  _rt[2] = dz * k;
  try {
    const f = rayQ!(_ro, _rt);
    return f === null || !(f >= 0) ? null : f;
  } catch {
    return null;
  }
}

/** true = blocked, false = clear, null = no budget. Stops 0.5 m short: impacts sit on the surface they hit. */
function blocked(o: Vec3, p: Vec3): boolean | null {
  const d = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
  if (d < 1) return false;
  const f = cast(o, p[0], p[1], p[2], d - 0.5);
  return f === undefined ? null : f !== null;
}

interface Occ {
  t: number;
  l: Vec3;
  blocked: boolean;
  diff: number;
  side: number;
}
const OPEN: Occ = { t: 0, l: [0, 0, 0], blocked: false, diff: 1, side: 1 };
const occCache = new Map<number, Occ>();
const cell = (p: Vec3, s: number) =>
  (((Math.floor(p[0] / s) & 1023) << 20) | ((Math.floor(p[1] / s) & 1023) << 10) | (Math.floor(p[2] / s) & 1023)) >>> 0;
const _e: Vec3 = [0, 0, 0];

/** two-leg path via a point `off` from the obstacle hit, kept just on the listener's side of it */
function edgeClear(p: Vec3, hx: number, hy: number, hz: number, ox: number, oy: number, oz: number): boolean {
  _e[0] = hx + ox;
  _e[1] = hy + oy;
  _e[2] = hz + oz;
  return blocked(L, _e) === false && blocked(_e, p) === false;
}

function occlusion(p: Vec3): Occ {
  if (!rayQ) return OPEN;
  const now = ctx!.currentTime;
  const key = cell(p, 2);
  const e = occCache.get(key);
  if (e && now - e.t < 0.4 && Math.hypot(e.l[0] - L[0], e.l[1] - L[1], e.l[2] - L[2]) < 1.5) return e;
  const d = Math.hypot(p[0] - L[0], p[1] - L[1], p[2] - L[2]);
  if (d < 1) return OPEN;
  const f = cast(L, p[0], p[1], p[2], d - 0.5);
  if (f === undefined) return e ?? OPEN;
  let diff = 1;
  const side = e ? -e.side : 1;
  if (f !== null) {
    // edge diffraction: a clear detour over, or beside, the obstacle within ~4 m of where the direct ray hit it
    const ux = (p[0] - L[0]) / d, uy = (p[1] - L[1]) / d, uz = (p[2] - L[2]) / d;
    const r = f * (d - 0.5) - 0.3;
    const hx = L[0] + ux * r, hy = L[1] + uy * r, hz = L[2] + uz * r;
    const h = Math.hypot(ux, uz) || 1;
    const over = edgeClear(p, hx, hy, hz, 0, 4, 0);
    const round = edgeClear(p, hx, hy, hz, (-uz / h) * 4 * side, 0, (ux / h) * 4 * side);
    diff = ((over ? 1 : 0) + (round ? 1 : 0)) / 2;
    if (e?.blocked) diff = Math.max(diff, 0.5 * (diff + e.diff));
  }
  if (occCache.size > 512) for (const [k, o] of occCache) if (now - o.t > 2) occCache.delete(k);
  const o: Occ = e ?? { t: 0, l: [0, 0, 0], blocked: false, diff: 1, side };
  o.t = now;
  o.l[0] = L[0];
  o.l[1] = L[1];
  o.l[2] = L[2];
  o.blocked = f !== null;
  o.diff = diff;
  o.side = side;
  occCache.set(key, o);
  return o;
}

/** ISO 9613-1 (20 °C, 70 % RH): alpha(f) ~ 0.0766 dB/m * (f/8 kHz)^1.74; cutoff where the path has lost 3 dB */
const airCutoff = (d: number) => (d < 15 ? 20000 : clamp(8000 * Math.pow(3 / (0.0766 * d), 0.575), 250, 20000));

interface Prop {
  d: number;
  fc: number;
  g: number;
  blocked: boolean;
}
const PR: Prop = { d: 0, fc: 20000, g: 1, blocked: false };

function propagate(p: Vec3, occl = true): Prop {
  const d = distTo(p);
  PR.d = d;
  PR.fc = airCutoff(d);
  PR.g = 1;
  PR.blocked = false;
  if (occl && d > 1) {
    const o = occlusion(p);
    if (o.blocked) {
      // mass law passes the lows through a wall; any open edge nearby lets mids diffract around it
      PR.blocked = true;
      PR.g = 0.15 + 0.35 * o.diff;
      PR.fc = Math.min(PR.fc, 300 + 1700 * o.diff);
    }
  }
  return PR;
}

/** a persistent source's propagation stage (loops and beds): [delay] -> lowpass -> gain */
interface Stage {
  head: AudioNode;
  dl: DelayNode | null;
  lp: BiquadFilterNode;
  g: GainNode;
  fc: number;
  gv: number;
  d: number;
}

function stage(c: AudioContext, out: AudioNode, doppler = false): Stage {
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 20000;
  lp.Q.value = 0.5;
  const g = c.createGain();
  lp.connect(g).connect(out);
  let dl: DelayNode | null = null;
  if (doppler) {
    dl = c.createDelay(2);
    dl.delayTime.value = 0;
    dl.connect(lp);
  }
  return { head: dl ?? lp, dl, lp, g, fc: 20000, gv: 1, d: -1 };
}

function steer(s: Stage, pos: Vec3): void {
  const now = ctx!.currentTime;
  const pr = propagate(pos);
  if (Math.abs(pr.fc - s.fc) > s.fc * 0.1) {
    s.fc = pr.fc;
    s.lp.frequency.setTargetAtTime(pr.fc, now, 0.12);
  }
  if (Math.abs(pr.g - s.gv) > 0.05) {
    s.gv = pr.g;
    s.g.gain.setTargetAtTime(pr.g, now, 0.12);
  }
  if (s.dl && Math.abs(pr.d - s.d) > 0.02) {
    // the delay line carries travel time; moving it continuously is what produces the Doppler shift
    const dt = Math.min(pr.d / SOUND_SPEED, 1.9);
    if (s.d < 0 || Math.abs(pr.d - s.d) > 8) s.dl.delayTime.setValueAtTime(dt, now);
    else s.dl.delayTime.setTargetAtTime(dt, now, 0.06);
    s.d = pr.d;
  }
}

/* ---------------- voices ---------------- */

interface Voice {
  out: GainNode;
  pan: PannerNode | null;
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  live: number;
  t0: number;
  t1: number;
  loud: number;
  hrtf: boolean;
  dead: boolean;
  /** propagation state for re-steering long positional voices */
  pos: Vec3 | null;
  lp: BiquadFilterNode | null;
  lvl: number;
  g: number;
  /** travel distance at start, for image-source echoes */
  dist: number;
}

interface VoiceOpts {
  pos?: Vec3 | null;
  level: number;
  dur: number;
  ref?: number;
  send?: number;
  delay?: boolean;
  hrtf?: boolean;
  pan?: number;
  ui?: boolean;
  /** source velocity (m/s): path-following panner plus a delay-line Doppler shift */
  vel?: Vec3;
  /** propagation speed override (ground-borne): no air absorption, occlusion or ground reflection */
  speed?: number;
  ground?: boolean;
}

const voices: Voice[] = [];

function reap(now: number): void {
  let j = 0;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    if (!v.dead && v.t1 > now - 0.1) voices[j++] = v;
  }
  voices.length = j;
}

function release(v: Voice): void {
  v.dead = true;
  for (const n of v.nodes) n.disconnect();
}

function kill(v: Voice, now: number): void {
  const g = v.out.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + 0.03);
  for (const s of v.srcs) {
    try {
      s.stop(now + 0.035);
    } catch {
      /* already stopped */
    }
  }
  v.dead = true;
}

function setPos(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
}

const DOP_N = 16;

function voice(o: VoiceOpts): Voice | null {
  const c = ctx!;
  const now = c.currentTime;
  const ref = o.ref ?? 4;
  let att = 1;
  let dist = 0;
  let g = 1;
  let fc = 20000;
  let blocked = false;
  if (o.pos) {
    const pr = propagate(o.pos, !o.speed);
    dist = pr.d;
    att = ref / (ref + Math.max(0, dist - ref));
    if (!o.speed) {
      g = pr.g;
      fc = pr.fc;
      blocked = pr.blocked;
    }
  }
  const loud = o.level * att * g;
  if (!(loud >= 0.0025)) return null;

  if (!o.ui) {
    reap(now);
    if (voices.length >= MAX_VOICES) {
      let vi = -1;
      let vl = Infinity;
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        const rem = clamp((v.t1 - now) / Math.max(0.05, v.t1 - v.t0), 0, 1);
        const e = v.loud * (0.25 + 0.75 * rem);
        if (e < vl) {
          vl = e;
          vi = i;
        }
      }
      if (vl >= loud) return null;
      kill(voices[vi], now);
      voices.splice(vi, 1);
    }
  }

  // Doppler path: distance to the moving source sampled over the voice's life
  let path: Float32Array | null = null;
  let dmin = dist;
  if (o.pos && o.vel && !o.speed && o.delay !== false) {
    path = new Float32Array(DOP_N);
    dmin = Infinity;
    for (let i = 0; i < DOP_N; i++) {
      const k = (o.dur * i) / (DOP_N - 1);
      path[i] = Math.hypot(o.pos[0] + o.vel[0] * k - L[0], o.pos[1] + o.vel[1] * k - L[1], o.pos[2] + o.vel[2] * k - L[2]);
      if (!(path[i] < Infinity)) return null;
      dmin = Math.min(dmin, path[i]);
    }
  }
  const t0 = now + 0.006 + (o.pos && o.delay !== false ? dmin / (o.speed ?? SOUND_SPEED) : 0);
  const out = c.createGain();
  out.gain.value = o.level * g;
  const v: Voice = {
    out, pan: null, nodes: [out], srcs: [], live: 0, t0, t1: t0 + o.dur, loud, hrtf: false, dead: false,
    pos: o.pos && !path && !o.speed ? [o.pos[0], o.pos[1], o.pos[2]] : null, lp: null, lvl: o.level, g, dist,
  };

  if (o.pos) {
    let tail: AudioNode = out;
    if (path) {
      // content emitted at t0 + tau reaches the ear dist(tau)/c later; the line carries the excess over dmin
      const dl = c.createDelay(Math.max(0.05, (path.reduce((a, b) => Math.max(a, b), 0) - dmin) / SOUND_SPEED + 0.02));
      const curve = new Float32Array(DOP_N);
      for (let i = 0; i < DOP_N; i++) curve[i] = (path[i] - dmin) / SOUND_SPEED;
      dl.delayTime.value = curve[0];
      dl.delayTime.setValueCurveAtTime(curve, t0, o.dur);
      tail.connect(dl);
      tail = dl;
      v.nodes.push(dl);
      // keep the graph alive until the delayed tail has drained out of the line
      const keep = c.createOscillator();
      keep.start(t0);
      reg(v, keep, t0 + o.dur + curve.reduce((a, b) => Math.max(a, b), 0) + 0.05);
    }
    if (fc < 16000 || (o.dur > 1.2 && !o.speed)) {
      const air = c.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = fc;
      air.Q.value = 0.5;
      tail.connect(air);
      tail = air;
      v.nodes.push(air);
      v.lp = air;
    }
    const p = c.createPanner();
    let hr = false;
    if (o.hrtf !== false) {
      let n = 0;
      for (const w of voices) if (w.hrtf && !w.dead) n++;
      hr = n < HRTF_BUDGET;
    }
    try {
      p.panningModel = hr ? 'HRTF' : 'equalpower';
    } catch {
      p.panningModel = 'equalpower';
      hr = false;
    }
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.maxDistance = 10000;
    setPos(p, o.pos[0], o.pos[1], o.pos[2]);
    if (path && o.vel && p.positionX) {
      for (let a = 0; a < 3; a++) {
        const cv = new Float32Array(DOP_N);
        for (let i = 0; i < DOP_N; i++) cv[i] = o.pos[a] + (o.vel[a] * o.dur * i) / (DOP_N - 1);
        (a === 0 ? p.positionX : a === 1 ? p.positionY : p.positionZ).setValueCurveAtTime(cv, t0, o.dur);
      }
    }
    tail.connect(p).connect(world);
    v.pan = p;
    v.hrtf = hr;
    v.nodes.push(p);
    // ground reflection: the image source below the floor arrives a fraction of a millisecond late and combs the direct sound
    if (!path && !o.speed && !blocked && o.ground !== false && loud >= 0.05 && dist > 1.5 && dist < 100) {
      const hs = Math.max(0.05, o.pos[1]);
      const hl = Math.max(0.3, L[1]);
      const r2 = Math.max(0, dist * dist - (o.pos[1] - L[1]) ** 2);
      const d2 = Math.sqrt(r2 + (hs + hl) ** 2);
      const dt = (d2 - dist) / SOUND_SPEED;
      if (dt > 0.00008) {
        const gd = c.createDelay(0.1);
        gd.delayTime.value = Math.min(dt, 0.09);
        const gg = c.createGain();
        gg.gain.value = (0.7 * dist) / d2;
        tail.connect(gd).connect(gg).connect(p);
        v.nodes.push(gd, gg);
      }
    }
    if (o.send) {
      // taken pre-panner so reverb falls off slower than the direct sound: distant or occluded blasts read as echoey
      const s = c.createGain();
      s.gain.value = o.send * Math.sqrt(att * g);
      tail.connect(s).connect(verbIn);
      v.nodes.push(s);
    }
  } else {
    const bus = o.ui ? uiBus : world;
    if (o.pan) {
      const sp = c.createStereoPanner();
      sp.pan.value = o.pan;
      out.connect(sp).connect(bus);
      v.nodes.push(sp);
    } else out.connect(bus);
    if (o.send) {
      const s = c.createGain();
      s.gain.value = o.send;
      out.connect(s).connect(verbIn);
      v.nodes.push(s);
    }
  }
  if (!o.ui) voices.push(v);
  return v;
}

function reg(v: Voice, s: AudioScheduledSourceNode, end: number): void {
  v.srcs.push(s);
  v.live++;
  if (end > v.t1) v.t1 = end;
  s.onended = () => {
    if (--v.live <= 0) release(v);
  };
  s.stop(end);
}

/** long voices follow the listener: walls broken or walked around while a collapse is still rumbling */
function steerVoices(now: number): void {
  for (const v of voices) {
    if (v.dead || !v.pos || !v.lp || v.t1 - now < 0.5) continue;
    const pr = propagate(v.pos);
    v.lp.frequency.setTargetAtTime(pr.fc, now, 0.15);
    if (Math.abs(pr.g - v.g) > 0.04) {
      v.g = pr.g;
      v.out.gain.setTargetAtTime(v.lvl * pr.g, now, 0.15);
    }
  }
}

/* ---------------- environment: listener probe -> early reflections + FDN reverb ---------------- */

const S2 = Math.SQRT1_2;
const PROBE: Vec3[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => [Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)] as Vec3),
  [0, 1, 0],
  ...[0, 1, 2].map(i => [S2 * Math.cos(((i * 2 + 0.25) * Math.PI) / 3), S2, S2 * Math.sin(((i * 2 + 0.25) * Math.PI) / 3)] as Vec3),
];
const probeD = new Float32Array(PROBE.length).fill(Infinity);
const probeAt: Vec3 = [0, 0, 0];
let probeI = PROBE.length;
let probeT = -9;
let lastSteer = -9;

interface Env {
  fdnD: DelayNode[];
  fdnLp: BiquadFilterNode[];
  fdnFb: GainNode[];
  fdnOut: GainNode;
  convG: GainNode;
  er: { d: DelayNode; g: GainNode; p: StereoPannerNode }[];
  flD: DelayNode;
  flFb: GainNode;
  flIn: GainNode;
  rt60: number;
  mfp: number;
  encl: number;
  canyon: number;
  width: number;
  wet: number;
}
let E!: Env;
const FDN_R = [1, 1.27, 1.49, 1.73];

function buildEnv(c: AudioContext, conv: AudioNode): Env {
  const gn = (v: number) => {
    const g = c.createGain();
    g.gain.value = v;
    return g;
  };
  const convG = gn(0.55);
  conv.connect(convG).connect(world);
  // 4-line FDN, Householder feedback (x_j - 0.5 * sum x): orthogonal, so loop gains alone set the decay
  const fdnIn = gn(0.35);
  verbIn.connect(fdnIn);
  const sum = gn(-0.5);
  const fdnOut = gn(0.05);
  fdnOut.connect(world);
  const sides = [-0.7, 0.7].map(x => {
    const sp = c.createStereoPanner();
    sp.pan.value = x;
    sp.connect(fdnOut);
    return sp;
  });
  const fdnD: DelayNode[] = [], fdnLp: BiquadFilterNode[] = [], fdnFb: GainNode[] = [];
  for (let i = 0; i < 4; i++) {
    const d = c.createDelay(1);
    d.delayTime.value = 0.02 * FDN_R[i];
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000;
    lp.Q.value = 0.5;
    const fb = gn(0.3);
    fdnIn.connect(d);
    d.connect(lp).connect(fb);
    fb.connect(d);
    fb.connect(sum);
    fb.connect(sides[i & 1]);
    fdnD.push(d);
    fdnLp.push(lp);
    fdnFb.push(fb);
  }
  for (const d of fdnD) sum.connect(d);
  const er = [0, 1, 2, 3].map(() => {
    const d = c.createDelay(1);
    d.delayTime.value = 0.05;
    const g = gn(0);
    const p = c.createStereoPanner();
    verbIn.connect(d).connect(g).connect(p).connect(world);
    return { d, g, p };
  });
  // flutter between two parallel facades: a loop whose period is the canyon width
  const flIn = gn(0);
  const flD = c.createDelay(1);
  flD.delayTime.value = 0.05;
  const flLp = c.createBiquadFilter();
  flLp.type = 'lowpass';
  flLp.frequency.value = 2800;
  flLp.Q.value = 0.5;
  const flFb = gn(0);
  verbIn.connect(flIn).connect(flD).connect(flLp).connect(flFb);
  flFb.connect(flD);
  flLp.connect(gn(0.8)).connect(world);
  return { fdnD, fdnLp, fdnFb, fdnOut, convG, er, flD, flFb, flIn, rt60: 0.3, mfp: 2, encl: 0, canyon: 0, width: 0, wet: 0.05 };
}

/** ~4 rays a frame, a full 12-direction sweep every 0.5 s */
function probeStep(now: number): void {
  if (probeI >= PROBE.length) {
    if (now - probeT < 0.5) return;
    probeT = now;
    probeI = 0;
    probeAt[0] = L[0];
    probeAt[1] = L[1];
    probeAt[2] = L[2];
  }
  for (let n = 0; n < 4 && probeI < PROBE.length; n++, probeI++) {
    const d = PROBE[probeI];
    const f = cast(L, L[0] + d[0] * PROBE_LEN, L[1] + d[1] * PROBE_LEN, L[2] + d[2] * PROBE_LEN);
    if (f === undefined) return;
    probeD[probeI] = f === null ? Infinity : Math.max(0.3, f * PROBE_LEN);
  }
  if (probeI >= PROBE.length) applyEnv(now);
}

function applyEnv(now: number): void {
  const N = PROBE.length + 1;
  const floor = Math.max(0.4, L[1]);
  let hits = 1;
  let sum = floor;
  for (let i = 0; i < PROBE.length; i++) {
    if (probeD[i] < Infinity) {
      hits++;
      sum += probeD[i];
    }
  }
  const mfp = sum / hits;
  // open directions absorb everything: Sabine with l = 4V/S gives RT60 = 0.04 l / a_mean
  const aBar = (hits * 0.08 + (N - hits)) / N;
  const rt = clamp((0.04 * mfp) / aBar, 0.15, 4);
  const encl = (hits - 1) / (N - 1);
  // only the zenith ray decides: steep diagonals also land on the facades of an open street
  const roofed = probeD[8] < 40;
  let width = 0;
  for (let i = 0; i < 4; i++) {
    const w = probeD[i] + probeD[i + 4];
    if (w < 80 && (width === 0 || w < width)) width = w;
  }
  const canyon = width > 0 && !roofed ? clamp(1 - width / 80, 0, 1) : 0;
  const k = 0.5;
  E.rt60 += (rt - E.rt60) * k;
  E.mfp += (mfp - E.mfp) * k;
  E.encl += (encl - E.encl) * k;
  E.canyon += (canyon - E.canyon) * k;
  E.width = width;
  E.wet = 0.05 + 0.5 * E.encl * (roofed ? 1 : 0.5);
  const tau = 0.3;
  for (let i = 0; i < 4; i++) {
    const len = clamp((E.mfp / SOUND_SPEED) * FDN_R[i], 0.007, 0.25);
    E.fdnD[i].delayTime.setTargetAtTime(len, now, tau);
    E.fdnFb[i].gain.setTargetAtTime(Math.pow(10, (-3 * len) / E.rt60), now, tau);
    E.fdnLp[i].frequency.setTargetAtTime(2500 + 6000 * (1 - aBar), now, tau);
  }
  E.fdnOut.gain.setTargetAtTime(E.wet, now, tau);
  E.convG.gain.setTargetAtTime(0.55 * (1 - 0.75 * E.encl), now, tau);
  // early reflections from the four nearest surfaces, panned to where the surface is
  const R: Vec3 = [F[1] * U[2] - F[2] * U[1], F[2] * U[0] - F[0] * U[2], F[0] * U[1] - F[1] * U[0]];
  const rl = Math.hypot(R[0], R[1], R[2]) || 1;
  const order = [...probeD.keys()].filter(i => probeD[i] < 60).sort((a, b) => probeD[a] - probeD[b]);
  for (let j = 0; j < 4; j++) {
    const t = E.er[j];
    const i = order[j];
    if (i === undefined) {
      t.g.gain.setTargetAtTime(0, now, tau);
      continue;
    }
    const d = probeD[i];
    const dir = PROBE[i];
    t.d.delayTime.setTargetAtTime(Math.min(0.95, (2 * d) / SOUND_SPEED), now, tau);
    t.g.gain.setTargetAtTime(0.5 * Math.min(1, 3 / d), now, tau);
    t.p.pan.setValueAtTime(clamp((dir[0] * R[0] + dir[1] * R[1] + dir[2] * R[2]) / rl, -1, 1), now);
  }
  E.flIn.gain.setTargetAtTime(0.4 * E.canyon, now, tau);
  if (width > 0) E.flD.delayTime.setTargetAtTime(clamp(width / SOUND_SPEED, 0.01, 0.9), now, tau);
  E.flFb.gain.setTargetAtTime(0.55 * E.canyon, now, tau);
}

/** image sources of the probed surfaces: echo delay past the direct arrival and relative gain, nearest first */
function wallEchoes(pos: Vec3, dist: number, max: number, fn: (dt: number, g: number) => void): void {
  let n = 0;
  const order = [...probeD.keys()].filter(i => probeD[i] < PROBE_LEN).sort((a, b) => probeD[a] - probeD[b]);
  for (const i of order) {
    const nx = PROBE[i][0], ny = PROBE[i][1], nz = PROBE[i][2];
    const w = probeD[i];
    const s = (pos[0] - probeAt[0] - nx * w) * nx + (pos[1] - probeAt[1] - ny * w) * ny + (pos[2] - probeAt[2] - nz * w) * nz;
    if (s > -0.3) continue;
    const ix = pos[0] - 2 * s * nx, iy = pos[1] - 2 * s * ny, iz = pos[2] - 2 * s * nz;
    const path = Math.hypot(ix - L[0], iy - L[1], iz - L[2]);
    const dt = (path - dist) / SOUND_SPEED;
    if (dt < 0.004) continue;
    fn(dt, (0.55 * Math.max(dist, 1)) / path);
    if (++n >= max) return;
  }
}

function frameTick(): void {
  const now = ctx!.currentTime;
  rayN = 0;
  rayReset = now;
  if (rayQ) probeStep(now);
  if (now - lastSteer > 0.25) {
    lastSteer = now;
    steerVoices(now);
  }
}

/* ---------------- blast physics ---------------- */

/** Kinney–Graham peak side-on overpressure, kPa, at scaled distance Z (m/kg^1/3 TNT) */
function overpressure(Z: number): number {
  const r = (808 * (1 + (Z / 4.5) ** 2)) / Math.sqrt((1 + (Z / 0.048) ** 2) * (1 + (Z / 0.32) ** 2) * (1 + (Z / 1.35) ** 2));
  return 101.325 * r;
}

/** returns the N-wave's positive-phase duration at the listener; schedules temporary threshold shift on arrival */
function blast(pos: Vec3, W: number, at: number): number {
  const r = Math.max(1, distTo(pos));
  const w3 = Math.cbrt(W);
  const Z = r / w3;
  const spl = 20 * Math.log10((overpressure(Z) * 1000) / 2e-5);
  const a = clamp((spl - 145) / 30, 0, 1);
  if (a > 0.08) muffleAt(a, at);
  // far-field N-wave lengthens as r^1/4 while it steepens into a shock
  return clamp(0.0012 * w3 * Math.pow(1 + Z / 10, 0.25), 0.0006, 0.06);
}

function nwave(v: Voice, t: number, T: number, a: number): void {
  const rate = clamp(NWAVE_T / T, 0.05, 8);
  const s = ctx!.createBufferSource();
  s.buffer = B.nwave;
  s.playbackRate.value = rate;
  s.connect(gainNode(v, a)).connect(v.out);
  s.start(t);
  reg(v, s, t + B.nwave.duration / rate + 0.01);
}

let muf = { a: 0, t: 0, tau: 1 };

function muffleAt(amount: number, at: number): void {
  const a = clamp(amount, 0, 1);
  const cur = at < muf.t ? muf.a : muf.a * Math.exp(-(at - muf.t) / muf.tau);
  if (!(a > cur + 0.05)) return;
  muf = { a, t: at, tau: 0.6 + 1.6 * a };
  const lo = 20000 * Math.pow(320 / 20000, Math.pow(a, 0.8));
  const t1 = at + 0.03 + 0.25 * a;
  const f = muffle.frequency;
  hold(f, at);
  f.exponentialRampToValueAtTime(lo, at + 0.03);
  f.setValueAtTime(lo, t1);
  f.exponentialRampToValueAtTime(Math.min(20000, lo * 4), t1 + muf.tau);
  f.exponentialRampToValueAtTime(20000, t1 + 3 * muf.tau);
  if (a > 0.25) {
    // tinnitus: a narrow tone somewhere in the 3-6 kHz notch that overpressure damages first
    ringOsc.frequency.setValueAtTime(rr(3200, 6200), at);
    const g = ringGain.gain;
    const te = at + 0.4 + 3.2 * a;
    hold(g, at);
    g.linearRampToValueAtTime(0.03 * a, at + 0.08);
    g.exponentialRampToValueAtTime(0.0004, te);
    g.linearRampToValueAtTime(0, te + 0.05);
  }
}

/* ---------------- building blocks ---------------- */

function env(p: AudioParam, t: number, a: number, peak: number, d: number, hold = 0): number {
  const ta = t + Math.max(0.001, a);
  const th = ta + hold;
  const te = th + Math.max(0.005, d);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, ta);
  if (hold > 0) p.setValueAtTime(peak, th);
  p.exponentialRampToValueAtTime(peak * 0.0015, te);
  p.linearRampToValueAtTime(0, te + 0.012);
  return te + 0.016;
}

function amp(v: Voice, t: number, a: number, peak: number, d: number, hold = 0): { g: GainNode; end: number } {
  const g = ctx!.createGain();
  g.gain.value = 0;
  const end = env(g.gain, t, a, Math.max(peak, 1e-4), d, hold);
  g.connect(v.out);
  v.nodes.push(g);
  return { g, end };
}

function gainNode(v: Voice, value: number): GainNode {
  const g = ctx!.createGain();
  g.gain.value = value;
  v.nodes.push(g);
  return g;
}

function filt(v: Voice, type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
  const b = ctx!.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  v.nodes.push(b);
  return b;
}

function noise(v: Voice, buf: AudioBuffer, t: number, end: number, rate = 1): AudioBufferSourceNode {
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, rnd() * buf.duration * 0.9);
  reg(v, s, end);
  return s;
}

function osc(v: Voice, type: OscillatorType, f: number, t: number, end: number, anchor = true): OscillatorNode {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.value = f;
  if (anchor) o.frequency.setValueAtTime(f, t);
  o.start(t);
  reg(v, o, end);
  return o;
}

function shaper(v: Voice): WaveShaperNode {
  const w = ctx!.createWaveShaper();
  w.curve = shapeCurve;
  v.nodes.push(w);
  return w;
}

/** filtered noise burst; returns the filter (frequency anchored at t, so sweeps can be appended) */
function nburst(
  v: Voice, buf: AudioBuffer, t: number, type: BiquadFilterType, f: number, q: number,
  a: number, peak: number, d: number, rate = 1, hold = 0,
): BiquadFilterNode {
  const l = amp(v, t, a, peak, d, hold);
  const b = filt(v, type, f, q);
  b.frequency.setValueAtTime(f, t);
  noise(v, buf, t, l.end, rate).connect(b).connect(l.g);
  return b;
}

function tone(
  v: Voice, type: OscillatorType, f: number, t: number, a: number, peak: number, d: number,
  f2 = 0, glide = 0, drive = false,
): OscillatorNode {
  const l = amp(v, t, a, peak, d);
  const o = osc(v, type, f, t, l.end);
  if (f2 > 0) o.frequency.exponentialRampToValueAtTime(f2, t + (glide || d));
  if (drive) o.connect(shaper(v)).connect(l.g);
  else o.connect(l.g);
  return o;
}

/* ---------------- materials (modal synthesis) ---------------- */

interface Mat {
  f: number;
  r: number[];
  d: number[];
  a: number[];
  nf: number;
  nq: number;
  nd: number;
  na: number;
  thud: number;
  tf: number;
  bend?: number;
  hp?: boolean;
}

const WOOD: Mat = { f: 330, r: [1, 2.63, 4.1], d: [0.1, 0.055, 0.03], a: [0.8, 0.4, 0.2], nf: 1400, nq: 0.9, nd: 0.03, na: 0.5, thud: 0.45, tf: 140 };
const CRATE: Mat = { f: 240, r: [1, 2.4, 3.9], d: [0.08, 0.05, 0.03], a: [0.7, 0.35, 0.2], nf: 1100, nq: 0.8, nd: 0.04, na: 0.55, thud: 0.5, tf: 120 };
const DULL = { f: 0, r: [], d: [], a: [] };

const MATS: Record<MaterialId, Mat> = {
  concrete: { ...DULL, nf: 900, nq: 0.8, nd: 0.12, na: 0.9, thud: 1, tf: 95 },
  rconcrete: { ...DULL, nf: 850, nq: 0.8, nd: 0.13, na: 0.9, thud: 1.05, tf: 90 },
  brick: { f: 820, r: [1, 2.31], d: [0.035, 0.022], a: [0.3, 0.18], nf: 1700, nq: 1.2, nd: 0.07, na: 0.85, thud: 0.6, tf: 130 },
  cinderblock: { f: 520, r: [1, 1.9], d: [0.03, 0.02], a: [0.28, 0.15], nf: 1100, nq: 0.7, nd: 0.06, na: 0.75, thud: 0.6, tf: 150 },
  // dense crystalline stone: short, high, dry modes = the "tock"
  stone: { f: 1900, r: [1, 1.61, 2.71], d: [0.03, 0.02, 0.012], a: [0.5, 0.34, 0.2], nf: 2600, nq: 0.9, nd: 0.014, na: 0.75, thud: 0.55, tf: 175 },
  sandstone: { ...DULL, nf: 950, nq: 0.6, nd: 0.1, na: 0.8, thud: 0.6, tf: 115 },
  marble: { f: 2300, r: [1, 1.52, 2.44, 3.6], d: [0.05, 0.035, 0.025, 0.015], a: [0.5, 0.36, 0.24, 0.14], nf: 3200, nq: 0.9, nd: 0.012, na: 0.7, thud: 0.45, tf: 190 },
  terracotta: { f: 1250, r: [1, 2.21, 3.48, 5.1], d: [0.07, 0.05, 0.035, 0.02], a: [0.45, 0.3, 0.2, 0.12], nf: 3000, nq: 1, nd: 0.02, na: 0.5, thud: 0.25, tf: 200 },
  ceramic: { f: 1900, r: [1, 1.7, 2.8], d: [0.06, 0.04, 0.02], a: [0.5, 0.3, 0.18], nf: 3200, nq: 1, nd: 0.03, na: 0.65, thud: 0.2, tf: 190 },
  asphalt: { ...DULL, nf: 620, nq: 0.7, nd: 0.08, na: 0.7, thud: 0.85, tf: 95 },
  copper: { f: 340, r: [1, 1.93, 3.1, 4.8], d: [0.7, 0.46, 0.26, 0.12], a: [0.55, 0.36, 0.2, 0.1], nf: 2400, nq: 0.9, nd: 0.04, na: 0.45, thud: 0.3, tf: 120, bend: 0.05 },
  adobe: { ...DULL, nf: 600, nq: 0.5, nd: 0.12, na: 0.8, thud: 0.7, tf: 90 },
  plaster: { ...DULL, nf: 1200, nq: 0.6, nd: 0.09, na: 0.75, thud: 0.55, tf: 115 },
  drywall: { ...DULL, nf: 520, nq: 0.6, nd: 0.07, na: 0.7, thud: 0.65, tf: 85 },
  roof: { f: 1700, r: [1, 1.72, 2.93], d: [0.05, 0.04, 0.03], a: [0.35, 0.25, 0.15], nf: 2700, nq: 1.4, nd: 0.05, na: 0.7, thud: 0.3, tf: 180 },
  wood: WOOD,
  oak: { f: 235, r: [1, 2.71, 4.33], d: [0.15, 0.075, 0.04], a: [0.85, 0.42, 0.2], nf: 1050, nq: 0.9, nd: 0.025, na: 0.45, thud: 0.6, tf: 105 },
  plywood: { f: 180, r: [1, 1.52, 2.31], d: [0.06, 0.04, 0.025], a: [0.6, 0.35, 0.2], nf: 800, nq: 0.6, nd: 0.05, na: 0.7, thud: 0.5, tf: 100 },
  crate: CRATE,
  tnt: { ...CRATE, f: 265 },
  // free-bar partial ratios: the inharmonic series is what makes steel read as steel
  steel: { f: 210, r: [1, 2.76, 5.4, 8.93, 13.34], d: [1.5, 0.95, 0.6, 0.4, 0.25], a: [0.45, 0.38, 0.28, 0.18, 0.1], nf: 3200, nq: 1, nd: 0.02, na: 0.5, thud: 0.5, tf: 90 },
  // bell partial ladder (prime, tierce, quint, nominal...): brittle grey iron rings bright and clear
  castiron: { f: 430, r: [1, 1.19, 1.5, 2, 2.66, 3.2], d: [1.1, 0.8, 0.6, 0.5, 0.3, 0.2], a: [0.4, 0.25, 0.3, 0.3, 0.18, 0.1], nf: 3000, nq: 1, nd: 0.015, na: 0.5, thud: 0.35, tf: 110 },
  aluminum: { f: 620, r: [1, 1.73, 2.61, 3.9, 5.4], d: [0.25, 0.18, 0.12, 0.08, 0.05], a: [0.35, 0.3, 0.25, 0.18, 0.1], nf: 3500, nq: 0.9, nd: 0.04, na: 0.5, thud: 0.15, tf: 140, bend: 0.02 },
  metal: { f: 390, r: [1, 1.58, 2.37, 3.12, 4.73], d: [0.38, 0.3, 0.22, 0.15, 0.1], a: [0.4, 0.34, 0.28, 0.2, 0.14], nf: 2200, nq: 0.8, nd: 0.12, na: 0.6, thud: 0.3, tf: 110, bend: 0.04 },
  glass: { f: 2600, r: [1, 1.42, 2.13, 2.9], d: [0.14, 0.1, 0.07, 0.05], a: [0.45, 0.38, 0.28, 0.2], nf: 5000, nq: 0.7, nd: 0.015, na: 0.4, thud: 0, tf: 0, hp: true },
  // pre-stressed pane is stiffer and damped: a duller "tunk" than annealed glass
  tempered: { f: 2100, r: [1, 1.47, 2.2], d: [0.09, 0.06, 0.04], a: [0.4, 0.3, 0.2], nf: 4500, nq: 0.7, nd: 0.012, na: 0.35, thud: 0.25, tf: 260, hp: true },
  barrel: { f: 150, r: [1, 1.5, 2.24, 3.4], d: [0.38, 0.26, 0.18, 0.12], a: [0.8, 0.5, 0.3, 0.2], nf: 900, nq: 1, nd: 0.03, na: 0.4, thud: 0.5, tf: 80, bend: 0.08 },
  propane: { f: 205, r: [1, 2.1, 3.32, 5.2], d: [0.65, 0.42, 0.26, 0.15], a: [0.7, 0.45, 0.3, 0.15], nf: 1500, nq: 1, nd: 0.025, na: 0.4, thud: 0.4, tf: 90, bend: 0.03 },
  // hollow tube: the air column's heavily damped modes plus a narrow knock, no ring
  pvc: { f: 460, r: [1, 2.08], d: [0.04, 0.022], a: [0.45, 0.2], nf: 1300, nq: 1.4, nd: 0.03, na: 0.55, thud: 0.4, tf: 170 },
  lamp: { f: 3300, r: [1, 1.46, 2.23], d: [0.07, 0.05, 0.03], a: [0.35, 0.28, 0.18], nf: 6000, nq: 0.7, nd: 0.008, na: 0.3, thud: 0.08, tf: 320, hp: true },
  // thick painted casting: low, short, heavily damped partials = a dull clonk rather than a bell
  machine: { f: 165, r: [1, 1.47, 2.09, 2.93], d: [0.32, 0.22, 0.14, 0.08], a: [0.55, 0.34, 0.2, 0.1], nf: 1100, nq: 0.8, nd: 0.05, na: 0.55, thud: 0.85, tf: 70, bend: 0.01 },
  insulation: { ...DULL, nf: 700, nq: 0.5, nd: 0.05, na: 0.4, thud: 0.2, tf: 200 },
  frp: { f: 380, r: [1, 2.2], d: [0.03, 0.02], a: [0.4, 0.2], nf: 1500, nq: 1.2, nd: 0.03, na: 0.55, thud: 0.4, tf: 150 },
  cardboard: { ...DULL, nf: 900, nq: 0.6, nd: 0.04, na: 0.5, thud: 0.35, tf: 140 },
  rubber: { ...DULL, nf: 300, nq: 0.5, nd: 0.05, na: 0.3, thud: 0.8, tf: 80 },
};

const MASONRY = new Set<MaterialId>([
  'concrete', 'rconcrete', 'brick', 'cinderblock', 'stone', 'sandstone', 'marble', 'terracotta', 'ceramic', 'asphalt', 'adobe', 'plaster', 'drywall', 'roof',
]);
const WOODY = new Set<MaterialId>(['wood', 'oak', 'plywood', 'crate', 'tnt']);
const METALLIC = new Set<MaterialId>(['steel', 'castiron', 'aluminum', 'metal', 'copper', 'barrel', 'propane', 'machine']);
const DENSE_MINERAL = new Set<MaterialId>(['concrete', 'rconcrete', 'brick', 'cinderblock', 'stone', 'sandstone', 'marble', 'asphalt']);
const STRUCTURAL_METAL = new Set<MaterialId>(['steel', 'castiron', 'machine']);

function crack(v: Voice, t: number, a: number, f: number): void {
  nburst(v, B.white, t, 'highpass', f, 0.7, 0.0004, a, 0.01 + rnd() * 0.012);
  nburst(v, B.white, t + rr(0.006, 0.02), 'highpass', f * 1.2, 0.7, 0.0004, a * 0.45, 0.008);
}

function rebarPing(v: Voice, t: number, a: number): void {
  const f = rr(1400, 2300);
  tone(v, 'sine', f, t, 0.001, a, 0.42);
  tone(v, 'sine', f * 2.756, t, 0.001, a * 0.45, 0.2);
}

/** trickling grains: hiss plus sparse crackle through a high-pass */
function sandHiss(v: Voice, t: number, a: number, d: number, f = 3200): void {
  nburst(v, B.pink, t, 'highpass', f, 0.5, 0.01, a * 0.6, d);
  nburst(v, B.crackle, t + 0.01, 'highpass', f * 0.8, 0.6, 0.012, a, d * 1.25, 0.7);
}

function powder(v: Voice, t: number, a: number, d: number): void {
  nburst(v, B.crackle, t, 'lowpass', 1400, 0.7, 0.01, a, d, 0.5);
  nburst(v, B.pink, t, 'lowpass', 650, 0.6, 0.02, a * 0.5, d);
}

const EXTRA: Partial<Record<MaterialId, (v: Voice, t: number, s: number) => void>> = {
  rconcrete: (v, t, s) => {
    if (s > 0.3) rebarPing(v, t + rr(0.004, 0.02), 0.16 * s);
  },
  stone: (v, t, s) => {
    if (s > 0.45) crack(v, t + rr(0.003, 0.015), 0.5 * s, 3200);
  },
  marble: (v, t, s) => {
    if (s > 0.45) crack(v, t + rr(0.003, 0.015), 0.5 * s, 3800);
  },
  castiron: (v, t, s) => {
    if (s > 0.7) crack(v, t + 0.004, 0.45 * s, 2600);
  },
  sandstone: (v, t, s) => sandHiss(v, t, 0.35 * s, 0.25 + 0.3 * s),
  cinderblock: (v, t, s) => sandHiss(v, t, 0.25 * s, 0.18 + 0.2 * s),
  adobe: (v, t, s) => {
    sandHiss(v, t, 0.2 * s, 0.2 + 0.3 * s, 1800);
    powder(v, t, 0.4 * s, 0.2 + 0.2 * s);
  },
  drywall: (v, t, s) => {
    powder(v, t, 0.5 * s, 0.15 + 0.25 * s);
    nburst(v, B.white, t, 'bandpass', 2600, 0.5, 0.001, 0.25 * s, 0.03);
  },
  plywood: (v, t, s) => nburst(v, B.white, t, 'bandpass', 1400, 0.5, 0.0008, 0.6 * s, 0.018),
};

interface Modal {
  /** partial-ladder scale for this member's size */
  fs: number;
  /** first bending mode, Hz */
  f1: number;
  /** T60 of that mode at the material's loss factor, s */
  ring: number;
}

/** Euler-Bernoulli free-free bar: f1 = (4.730^2 / 2pi) (h / sqrt 12) sqrt(E / rho) / L^2 = 1.028 h c / L^2 */
function modal(m: MaterialId, dims: Vec3): Modal | null {
  const a = Math.abs(dims[0]), b = Math.abs(dims[1]), c = Math.abs(dims[2]);
  const len = Math.max(a, b, c), h = Math.min(a, b, c);
  if (!(len > 0.02) || !(h > 0.001)) return null;
  const P = PHYS[m];
  const f1 = (1.028 * h * Math.sqrt((P.eng.E * 1e9) / P.density)) / (len * len);
  const M = MATS[m];
  // the partial ladders were voiced on ~1 m x 0.1 m members; sqrt of the bar ratio keeps each material recognisable
  const fs = clamp(Math.sqrt(h / 0.1) / len, 0.4, 2.5);
  // constant loss factor eta: T60 = 2.2 / (f eta), with eta read off the voiced fundamental
  const ring = M.r.length ? clamp((M.d[0] * M.f) / f1, 0.08, 3) : 0;
  return { fs, f1, ring };
}

function strike(v: Voice, t: number, m: MaterialId, s: number, q: Modal | null = null): void {
  const M = MATS[m];
  const k = rr(0.93, 1.07);
  const fs = q?.fs ?? 1;
  // upper partials of quiet or distant hits are inaudible; skipping them keeps rubble storms cheap
  const cap = v.loud < 0.06 ? 1 : v.loud < 0.15 || s < 0.25 ? 2 : s < 0.6 ? 3 : 6;
  const n = Math.min(cap, M.r.length);
  for (let i = 0; i < n; i++) {
    const f = M.f * k * M.r[i] * fs;
    if (f > 15000) break;
    const dd = Math.min(5, (M.d[i] * (0.55 + 0.6 * s)) / fs);
    const o = tone(v, 'sine', f, t, 0.0015, M.a[i] * s, dd);
    if (M.bend) o.frequency.exponentialRampToValueAtTime(f * (1 - M.bend), t + dd);
  }
  if (M.na > 0) {
    nburst(v, B.white, t, M.hp ? 'highpass' : 'bandpass', M.nf * (0.55 + 0.6 * s), M.nq, 0.001, M.na * s, M.nd * (0.7 + 0.5 * s));
  }
  // a known member thuds at its own first bending mode (E, rho, span, depth) instead of the generic one
  const tf = q ? clamp(q.f1, 30, 240) : M.tf;
  if (M.thud > 0) tone(v, 'sine', tf * k, t, 0.002, M.thud * s, 0.09 + 0.08 * s, tf * k * 0.6, 0.1);
  // long steel members also hum at that mode; small panes and plates radiate it too poorly to matter
  if (q && METALLIC.has(m) && q.f1 >= 25 && q.f1 < M.f * fs * 0.7 && s > 0.25 && v.loud >= 0.06) {
    tone(v, 'sine', q.f1 * k, t + 0.003, 0.004, 0.35 * s, q.ring * (0.55 + 0.6 * s));
  }
  if (v.loud >= 0.06) EXTRA[m]?.(v, t, s);
}

/* ---------------- fracture voices ---------------- */

function oneShot(v: Voice, buf: AudioBuffer, t: number, rate: number, type: BiquadFilterType, f: number, q: number, g: number): void {
  const src = ctx!.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(filt(v, type, f, q)).connect(gainNode(v, g)).connect(v.out);
  src.start(t);
  reg(v, src, t + buf.duration / rate + 0.02);
}

const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

function masonryCrunch(v: Voice, t: number, m: MaterialId, z: number): void {
  const dense = DENSE_MINERAL.has(m), block = m === 'concrete' || m === 'rconcrete';
  const bp = nburst(v, B.pink, t, 'bandpass', block ? 650 : 950, 0.9, 0.012, 0.75, 0.25 + 0.5 * z);
  bp.frequency.exponentialRampToValueAtTime(block ? 210 : 380, t + 0.32 + 0.3 * z);
  nburst(v, B.crackle, t + (block ? 0.035 : 0.005), 'bandpass', block ? 1600 : 2400, 0.7, 0.005, 0.5, 0.3 + 0.55 * z, 0.85);
  // The load arrives first; granular rubble follows the slab rather than sounding like an explosion.
  if (dense) {
    nburst(v, B.brown, t, 'lowpass', block ? 180 : 260, 0.7, 0.008, 0.42 + 0.3 * z, 0.25 + 0.3 * z);
    tone(v, 'sine', block ? 63 : 83, t, 0.008, 0.3 + 0.55 * z, 0.22 + 0.18 * z, 38, 0.32);
  }
  if (m === 'brick' || m === 'roof') {
    strike(v, t, m, 0.7);
    // Short staggered taps read as individual units falling out of the bond.
    for (let i = 0; i < 2; i++) nburst(v, B.crackle, t + 0.08 + i * 0.085, 'bandpass', 1200 + i * 400, 1, 0.002, 0.16, 0.035);
  }
  if (m === 'rconcrete') {
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) rebarPing(v, t + rr(0.02, 0.3), rr(0.08, 0.2));
  }
}

function stoneBreak(v: Voice, t: number, m: MaterialId, z: number): void {
  crack(v, t, 1, m === 'marble' ? 3600 : 2800);
  tone(v, 'sine', 110, t, 0.003, 0.25 + 0.55 * z, 0.3, 60, 0.3);
  strike(v, t + 0.005, m, 0.9);
  nburst(v, B.crackle, t + 0.02, 'bandpass', 2600, 0.7, 0.01, 0.35, 0.15 + 0.2 * z, 1.2);
  if (m === 'marble') {
    // conchoidal fracture leaves a glassy "shing"
    tone(v, 'sine', rr(3200, 3800), t, 0.001, 0.14, 0.14);
    tone(v, 'sine', rr(4400, 5200), t, 0.001, 0.08, 0.09);
  }
}

function crumble(v: Voice, t: number, m: MaterialId, z: number): void {
  const adobe = m === 'adobe';
  const bp = nburst(v, B.pink, t, 'bandpass', adobe ? 520 : 750, 0.8, 0.006, 0.85, 0.25 + 0.4 * z);
  bp.frequency.exponentialRampToValueAtTime(adobe ? 200 : 280, t + 0.35 + 0.3 * z);
  sandHiss(v, t + 0.03, 0.55, 0.6 + 0.8 * z, adobe ? 2000 : 3200);
  powder(v, t + 0.02, adobe ? 0.6 : 0.35, 0.4 + 0.5 * z);
  tone(v, 'sine', 75, t, 0.004, 0.2 + 0.45 * z, 0.22, 42, 0.22);
  if (m === 'cinderblock') strike(v, t, m, 0.75);
}

function ceramic(v: Voice, t: number): void {
  // the annealed-glass cascade an octave down reads as fired clay shards
  oneShot(v, pick(B.glass), t, rr(0.42, 0.55), 'bandpass', 2200, 0.5, 0.9);
  nburst(v, B.white, t, 'bandpass', 1900, 0.8, 0.0008, 0.7, 0.05);
  strike(v, t, 'terracotta', 0.8);
}

function drywallBreak(v: Voice, t: number, z: number): void {
  nburst(v, B.white, t, 'bandpass', 1200, 1.2, 0.0006, 0.9, 0.02);
  const paper = nburst(v, B.pink, t + 0.01, 'bandpass', 1800, 0.8, 0.01, 0.4, 0.12 + 0.1 * z);
  paper.frequency.exponentialRampToValueAtTime(3200, t + 0.16);
  powder(v, t + 0.02, 0.55, 0.4 + 0.3 * z);
  tone(v, 'sine', 90, t, 0.003, 0.4, 0.12, 60, 0.12);
}

function splinter(v: Voice, t: number, m: MaterialId, z: number): void {
  const oak = m === 'oak';
  nburst(v, B.white, t, 'highpass', oak ? 1400 : 1800, 0.7, 0.0008, 1, oak ? 0.04 : 0.03);
  nburst(v, B.crackle, t, 'bandpass', oak ? 2200 : 3000, 1, 0.002, 0.7, 0.25 + 0.2 * z, oak ? 1.4 : 1.8);
  nburst(v, B.pink, t + 0.01, 'bandpass', oak ? 320 : 450, 6, 0.004, 0.5, oak ? 0.22 : 0.15);
  strike(v, t, m, 0.8);
}

function delaminate(v: Voice, t: number, z: number): void {
  strike(v, t, 'plywood', 0.8);
  const n = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) nburst(v, B.white, t + rr(0.02, 0.38), 'bandpass', rr(1500, 3500), 1.5, 0.0005, rr(0.3, 0.8), 0.012);
  const rip = nburst(v, B.pink, t + 0.03, 'bandpass', 900, 2.5, 0.03, 0.35, 0.3 + 0.15 * z);
  rip.frequency.exponentialRampToValueAtTime(1600, t + 0.36);
}

function tear(v: Voice, t: number, m: MaterialId): void {
  const alu = m === 'aluminum';
  const l = amp(v, t, 0.01, 0.35, 0.45);
  const bp = filt(v, 'bandpass', alu ? 2000 : 1200, 4);
  bp.frequency.setValueAtTime(alu ? 2000 : 1200, t);
  bp.frequency.exponentialRampToValueAtTime(alu ? 3600 : 2600, t + 0.4);
  const o = osc(v, 'sawtooth', alu ? 260 : 170, t, l.end);
  o.frequency.exponentialRampToValueAtTime(alu ? 170 : 110, t + 0.45);
  o.connect(bp).connect(l.g);
  strike(v, t, m, 0.9);
  if (m === 'steel') {
    // Thick steel yields before it separates: low bending pressure outlasts the bright tearing edge.
    const bend = tone(v, 'sine', 88, t, 0.04, 0.27, 0.85, 54, 0.75);
    bend.frequency.setValueAtTime(88, t);
    nburst(v, B.brown, t + 0.04, 'bandpass', 310, 1.8, 0.08, 0.22, 0.6);
  }
}

/** Large contact only, not every tap. Bounded layers inside the already admitted impact voice. */
function heavyContact(v: Voice, t: number, m: MaterialId, s: number): void {
  if (DENSE_MINERAL.has(m)) {
    const concrete = m === 'concrete' || m === 'rconcrete';
    const body = nburst(v, B.brown, t, 'lowpass', concrete ? 240 : 340, 0.8, 0.006, 0.3 * s, concrete ? 0.3 : 0.19);
    body.frequency.exponentialRampToValueAtTime(concrete ? 100 : 160, t + (concrete ? 0.3 : 0.19));
    nburst(v, B.crackle, t + (concrete ? 0.055 : 0.028), 'bandpass', concrete ? 1100 : 1850, 0.8, 0.012, 0.2 * s, concrete ? 0.25 : 0.14, 0.8);
  } else if (STRUCTURAL_METAL.has(m)) {
    // A bar keeps its inharmonic modes from strike(); this lower delayed mode suggests frame mass.
    tone(v, 'sine', m === 'steel' ? 72 : m === 'machine' ? 58 : 95, t + 0.014, 0.018, 0.24 * s, 0.4, 50, 0.35);
    nburst(v, B.pink, t + 0.02, 'bandpass', 480, 2, 0.012, 0.14 * s, 0.22);
  }
}

function brittleIron(v: Voice, t: number, z: number): void {
  crack(v, t, 1, 2400);
  strike(v, t + 0.003, 'castiron', 1);
  // a second, slightly detuned strike beats against the first: the cracked-bell sound
  strike(v, t + 0.01, 'castiron', 0.5);
  nburst(v, B.crackle, t + 0.02, 'bandpass', 3200, 0.8, 0.005, 0.4, 0.3 + 0.2 * z, 1.3);
}

function annealedShatter(v: Voice, t: number, z: number): void {
  oneShot(v, pick(B.glass), t, rr(0.85, 1.15) * (1.15 - 0.15 * z), 'highpass', 700, 0.707, 0.9);
  nburst(v, B.white, t, 'highpass', 3500, 0.7, 0.001, 0.6, 0.1);
}

function temperedBurst(v: Voice, t: number, z: number): void {
  oneShot(v, pick(B.tempered), t, rr(0.9, 1.1), 'highpass', 1500, 0.707, 0.95);
  nburst(v, B.white, t, 'bandpass', 1800, 0.8, 0.0005, 0.6, 0.02);
  nburst(v, B.white, t, 'highpass', 5000, 0.6, 0.0008, 0.7, 0.25 + 0.15 * z);
  nburst(v, B.crackle, t + 0.15, 'highpass', 4000, 0.6, 0.1, 0.35, 0.5 + 0.3 * z, 1.4);
}

function plasticCrack(v: Voice, t: number, z: number): void {
  nburst(v, B.white, t, 'bandpass', 2400, 1.4, 0.0005, 0.9, 0.018);
  nburst(v, B.white, t + rr(0.01, 0.03), 'bandpass', 3200, 1.6, 0.0005, 0.45, 0.012);
  // the tube's air column knocked once: hollow and pitched, gone almost at once
  nburst(v, B.pink, t, 'bandpass', rr(380, 520), 6, 0.002, 0.7, 0.07 + 0.05 * z);
  strike(v, t, 'pvc', 0.9);
  tone(v, 'sine', 140, t, 0.002, 0.3 + 0.2 * z, 0.08, 90, 0.08);
}

function lampPop(v: Voice, t: number, z: number): void {
  // bulbs are evacuated: the envelope implodes with a soft low pop before the glass tinkles
  tone(v, 'sine', 210, t, 0.002, 0.6, 0.05, 70, 0.05);
  nburst(v, B.pink, t, 'lowpass', 900, 0.8, 0.001, 0.6, 0.03);
  oneShot(v, pick(B.glass), t + 0.012, rr(1.5, 1.9), 'highpass', 2500, 0.707, 0.5 + 0.2 * z);
  strike(v, t + 0.01, 'lamp', 0.7);
  nburst(v, B.crackle, t + 0.005, 'highpass', 4500, 0.7, 0.002, 0.3, 0.08, 2);
}

function machineBreak(v: Voice, t: number, z: number): void {
  strike(v, t, 'machine', 1);
  tone(v, 'sine', 62, t, 0.004, 0.6 + 0.3 * z, 0.35 + 0.2 * z, 36, 0.3, true);
  nburst(v, B.brown, t, 'lowpass', 300, 0.8, 0.005, 0.5, 0.3 + 0.2 * z);
  crack(v, t + 0.004, 0.5, 1800);
  nburst(v, B.crackle, t + 0.03, 'bandpass', 1500, 0.8, 0.01, 0.35, 0.3 + 0.3 * z, 0.9);
  strike(v, t + rr(0.08, 0.16), 'metal', 0.35);
}

/* ---------------- throttling ---------------- */

interface Gate {
  tok: number;
  t: number;
}
const impGate: Gate = { tok: 10, t: 0 };
const fracGate: Gate = { tok: 6, t: 0 };
const impMerge = new Map<MaterialId, { t: number; s: number }>();
const fracMerge = new Map<MaterialId, { t: number; s: number }>();
const gates = new Map<string, Gate>();

function take(g: Gate, rate: number, cap: number, now: number): boolean {
  g.tok = Math.min(cap, g.tok + (now - g.t) * rate);
  g.t = now;
  if (g.tok < 1) return false;
  g.tok -= 1;
  return true;
}

function allow(key: string, rate: number, cap: number, now: number): boolean {
  let g = gates.get(key);
  if (!g) gates.set(key, (g = { tok: cap, t: now }));
  return take(g, rate, cap, now);
}

/** true = swallowed: something at least as loud of this material played within `win` */
function merged(map: Map<MaterialId, { t: number; s: number }>, m: MaterialId, s: number, now: number, win: number): boolean {
  const e = map.get(m);
  if (e && now - e.t < win && s <= e.s * 1.2) return true;
  if (e) {
    e.t = now;
    e.s = s;
  } else map.set(m, { t: now, s });
  return false;
}

/* ---------------- textures: continuous beds fed by event energy (rubble, fire, hot steel) ---------------- */

interface Tex {
  g: GainNode | null;
  p: PannerNode | null;
  E: number;
  t: number;
  last: number;
  c: Vec3;
  tau: number;
  hold: number;
  rel: number;
  ref: number;
  level: (E: number) => number;
  build: (c: AudioContext, g: GainNode) => void;
  st: Stage | null;
}

const tex = (o: Pick<Tex, 'tau' | 'hold' | 'rel' | 'ref' | 'level' | 'build'>): Tex => ({ g: null, p: null, st: null, E: 0, t: 0, last: -1, c: [0, 0, 0], ...o });

function loopSrc(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(ctx!.currentTime, rnd() * buf.duration);
  return s;
}

function layer(c: AudioContext, out: GainNode, buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, level: number, rate = 1): GainNode {
  const b = c.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  const g = c.createGain();
  g.gain.value = level;
  loopSrc(buf, rate).connect(b).connect(g).connect(out);
  return g;
}

function feed(x: Tex, pos: Vec3, e: number): void {
  if (!(e > 0) || !Number.isFinite(pos[0] + pos[1] + pos[2])) return;
  const c = ctx!;
  const now = c.currentTime;
  if (!x.g) {
    const g = c.createGain();
    g.gain.value = 0;
    const p = c.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = x.ref;
    p.maxDistance = 10000;
    x.st = stage(c, p);
    g.connect(x.st.head);
    p.connect(world);
    x.build(c, g);
    x.g = g;
    x.p = p;
    x.c = [pos[0], pos[1], pos[2]];
    x.t = now;
  }
  x.E = x.E * Math.exp(-(now - x.t) / x.tau) + e;
  x.t = now;
  const w = e / Math.max(x.E, 1e-6);
  x.c[0] += (pos[0] - x.c[0]) * w;
  x.c[1] += (pos[1] - x.c[1]) * w;
  x.c[2] += (pos[2] - x.c[2]) * w;
  if (now - x.last < 0.03) return;
  x.last = now;
  setPos(x.p!, x.c[0], x.c[1], x.c[2]);
  steer(x.st!, x.c);
  const gp = x.g.gain;
  gp.cancelScheduledValues(now);
  gp.setTargetAtTime(x.level(x.E), now, 0.05);
  gp.setTargetAtTime(0, now + x.hold, x.rel);
}

const debrisTex = tex({
  tau: 0.3,
  hold: 0.15,
  rel: 0.35,
  ref: 8,
  level: E => Math.min(0.5, 0.05 * Math.sqrt(Math.max(0, E - 1.5))),
  build: (c, g) => {
    layer(c, g, B.pink, 'bandpass', 1400, 0.5, 1);
    layer(c, g, B.brown, 'lowpass', 350, 0.707, 0.7);
    layer(c, g, B.crackle, 'bandpass', 2600, 0.7, 0.9);
  },
});

const fireTex = tex({
  tau: 1.8,
  hold: 1.3,
  rel: 1.1,
  ref: 6,
  level: E => Math.min(0.5, 0.13 * Math.sqrt(E)),
  build: (c, g) => {
    layer(c, g, B.crackle, 'bandpass', 2600, 0.6, 0.9);
    layer(c, g, B.crackle, 'bandpass', 1100, 0.7, 0.6, 0.55);
    layer(c, g, B.pink, 'bandpass', 900, 0.5, 0.15);
    const roar = layer(c, g, B.brown, 'lowpass', 380, 0.707, 0.6);
    const flicker = c.createOscillator();
    flicker.frequency.value = 0.7;
    const depth = c.createGain();
    depth.gain.value = 0.25;
    flicker.connect(depth).connect(roar.gain);
    flicker.start();
  },
});

const heatTex = tex({
  tau: 1.2,
  hold: 0.6,
  rel: 0.7,
  ref: 4,
  level: E => Math.min(0.22, 0.05 * Math.sqrt(E)),
  build: (c, g) => {
    layer(c, g, B.white, 'highpass', 5500, 0.5, 0.5);
    layer(c, g, B.pink, 'bandpass', 3000, 2, 0.25);
    layer(c, g, B.crackle, 'highpass', 4500, 0.7, 0.6, 0.4);
  },
});

/** bounded multiplicative random walk, for wandering creak/groan pitch curves */
function walk(start: number, n: number, lo: number, hi: number, min: number, max: number): number[] {
  const out: number[] = [];
  let f = start;
  for (let i = 0; i < n; i++) out.push((f = clamp(f * rr(lo, hi), min, max)));
  return out;
}

const thermiteTex = tex({
  tau: 0.5,
  hold: 0.35,
  rel: 0.45,
  ref: 5,
  level: E => Math.min(0.65, 0.13 * Math.sqrt(E)),
  build: (c, g) => {
    layer(c, g, B.white, 'bandpass', 3800, 0.45, 0.9);
    layer(c, g, B.pink, 'highpass', 1200, 0.6, 0.5);
    layer(c, g, B.brown, 'lowpass', 260, 0.707, 0.8);
    layer(c, g, B.crackle, 'highpass', 3000, 0.7, 0.9, 2.2);
  },
});

// service jets are fed ~4x/s per jet: hold must outlast the call gap or the bed pumps
const JET = { tau: 0.6, hold: 0.45, rel: 0.4 };

const gasTex = tex({
  ...JET,
  ref: 6,
  level: E => Math.min(0.6, 0.12 * Math.sqrt(E)),
  build: (c, g) => {
    const roar = layer(c, g, B.brown, 'lowpass', 320, 0.707, 0.9);
    lfo(c, 1.3, 0.3, roar.gain);
    layer(c, g, B.pink, 'bandpass', 900, 0.6, 0.35);
    layer(c, g, B.white, 'highpass', 2800, 0.6, 0.22);
    layer(c, g, B.crackle, 'bandpass', 1800, 0.7, 0.3, 1.3);
  },
});

const waterTex = tex({
  ...JET,
  ref: 5,
  level: E => Math.min(0.5, 0.1 * Math.sqrt(E)),
  build: (c, g) => {
    layer(c, g, B.pink, 'bandpass', 1600, 0.5, 0.6);
    layer(c, g, B.white, 'highpass', 4500, 0.6, 0.3);
    layer(c, g, B.crackle, 'bandpass', 2200, 0.8, 0.8, 1.4);
    layer(c, g, B.crackle, 'lowpass', 700, 0.7, 0.5, 0.7);
    layer(c, g, B.brown, 'lowpass', 250, 0.707, 0.3);
  },
});

const steamTex = tex({
  ...JET,
  ref: 7,
  level: E => Math.min(0.55, 0.11 * Math.sqrt(E)),
  build: (c, g) => {
    layer(c, g, B.white, 'highpass', 3000, 0.6, 0.8);
    layer(c, g, B.pink, 'bandpass', 1200, 0.5, 0.3);
    // a vent edge-tone: narrow noise bands plus a wavering sine, the part that screams
    layer(c, g, B.white, 'bandpass', 1900, 22, 0.9);
    layer(c, g, B.white, 'bandpass', 3150, 30, 0.5);
    const w = loopOsc(c, 'sine', 1880);
    lfo(c, 5.5, 22, w.frequency);
    const wg = c.createGain();
    wg.gain.value = 0.05;
    w.connect(wg).connect(g);
  },
});

/* ---------------- persistent loops: tool motors, hums and weather beds ---------------- */

function lfo(c: AudioContext, hz: number, depth: number, target: AudioParam): void {
  const o = c.createOscillator();
  o.frequency.value = hz;
  const g = c.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
}

function loopOsc(c: AudioContext, type: OscillatorType, f: number): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.start();
  return o;
}

function silentBus(c: AudioContext, dest: AudioNode): GainNode {
  const g = c.createGain();
  g.gain.value = 0;
  g.connect(dest);
  return g;
}

interface WinchLoop {
  g: GainNode;
  motor: OscillatorNode;
  whine: OscillatorNode;
  grit: GainNode;
  on: boolean;
  load: number;
}
let winchLoop: WinchLoop | null = null;

function buildWinch(c: AudioContext): WinchLoop {
  const g = silentBus(c, world);
  const motor = loopOsc(c, 'sawtooth', 60);
  const lp = c.createBiquadFilter();
  lp.frequency.value = 900;
  lp.Q.value = 1.2;
  const gm = c.createGain();
  gm.gain.value = 0.5;
  motor.connect(lp).connect(gm).connect(g);
  const whine = loopOsc(c, 'square', 240);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  bp.Q.value = 6;
  const gw = c.createGain();
  gw.gain.value = 0.12;
  whine.connect(bp).connect(gw).connect(g);
  const grit = layer(c, g, B.crackle, 'highpass', 2500, 0.7, 0.05, 1.6);
  return { g, motor, whine, grit, on: false, load: -1 };
}

interface GravLoop {
  g: GainNode;
  on: boolean;
}
let gravLoop: GravLoop | null = null;

function buildGrav(c: AudioContext): GravLoop {
  const g = silentBus(c, world);
  const lp = c.createBiquadFilter();
  lp.frequency.value = 650;
  const hum = c.createGain();
  hum.gain.value = 0.35;
  // two saws a fraction of a hertz apart beat slowly: the throb of a big field coil
  loopOsc(c, 'sawtooth', 58).connect(lp);
  loopOsc(c, 'sawtooth', 58.6).connect(lp);
  lp.connect(hum).connect(g);
  const h2 = c.createGain();
  h2.gain.value = 0.2;
  loopOsc(c, 'sine', 116).connect(h2).connect(g);
  const whine = loopOsc(c, 'sine', 2400);
  const gw = c.createGain();
  gw.gain.value = 0.03;
  whine.connect(gw).connect(g);
  lfo(c, 5, 14, whine.frequency);
  layer(c, g, B.crackle, 'highpass', 5000, 0.7, 0.06, 0.6);
  return { g, on: false };
}

interface SwingLoop {
  g: GainNode;
  p: PannerNode;
  bp: BiquadFilterNode;
  whistle: GainNode;
  last: number;
  st: Stage;
}
let swingLoop: SwingLoop | null = null;

function buildSwing(c: AudioContext): SwingLoop {
  const g = c.createGain();
  g.gain.value = 0;
  const p = c.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = 6;
  p.maxDistance = 10000;
  const st = stage(c, p, true);
  g.connect(st.head);
  p.connect(world);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 200;
  bp.Q.value = 1.2;
  loopSrc(B.pink).connect(bp).connect(g);
  const whistle = layer(c, g, B.white, 'bandpass', 900, 8, 0);
  return { g, p, bp, whistle, last: -1, st };
}

interface LevelLoop {
  g: GainNode;
  k: number;
}
let quakeLoop: LevelLoop | null = null;
let windLoop: LevelLoop | null = null;

function buildQuake(c: AudioContext): LevelLoop {
  const g = silentBus(c, world);
  layer(c, g, B.brown, 'lowpass', 60, 0.8, 1, 0.6);
  // slowed crackle on the gain makes the mid rumble surge and grind rather than drone
  const surge = layer(c, g, B.brown, 'lowpass', 140, 0.8, 0.45, 0.9);
  const mod = c.createGain();
  mod.gain.value = 1.4;
  loopSrc(B.crackle, 0.08).connect(mod).connect(surge.gain);
  layer(c, g, B.crackle, 'lowpass', 500, 0.7, 0.3, 0.3);
  layer(c, g, B.pink, 'bandpass', 250, 0.7, 0.18);
  return { g, k: 0 };
}

function buildWind(c: AudioContext): LevelLoop {
  const g = silentBus(c, ambBus);
  for (const side of [-1, 1]) {
    const sp = c.createStereoPanner();
    sp.pan.value = side * 0.6;
    sp.connect(g);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420 + side * 60;
    bp.Q.value = 0.5;
    const body = c.createGain();
    body.gain.value = 0.6;
    loopSrc(B.brown, rr(0.9, 1.1)).connect(bp).connect(body).connect(sp);
    lfo(c, rr(0.06, 0.11), 220, bp.frequency);
    lfo(c, rr(0.09, 0.17), 0.25, body.gain);
  }
  const gust = layer(c, g, B.pink, 'bandpass', 1200, 3, 0.12);
  lfo(c, 0.11, 0.08, gust.gain);
  const howl = c.createBiquadFilter();
  howl.type = 'bandpass';
  howl.frequency.value = 700;
  howl.Q.value = 14;
  const hg = c.createGain();
  hg.gain.value = 0.09;
  loopSrc(B.white).connect(howl).connect(hg).connect(g);
  lfo(c, 0.13, 180, howl.frequency);
  return { g, k: 0 };
}

function setLevel(l: LevelLoop, k: number, peak: number, attack: number, release: number): void {
  if (Math.abs(k - l.k) < 0.02 && (k > 0) === (l.k > 0)) return;
  l.k = k;
  l.g.gain.setTargetAtTime(k > 0 ? peak : 0, ctx!.currentTime, k > 0 ? attack : release);
}

function clunk(level: number): void {
  const v = voice({ level, dur: 0.3 });
  if (!v) return;
  tone(v, 'sine', 120, v.t0, 0.002, 0.8, 0.07, 70, 0.06);
  nburst(v, B.white, v.t0, 'bandpass', 1500, 1.2, 0.0006, 0.5, 0.015);
  strike(v, v.t0 + 0.004, 'steel', 0.2);
}

/** a single positional loop driven by "nearest source" calls; decays by itself if the calls stop */
interface PosLoop {
  g: GainNode;
  p: PannerNode;
  st: Stage;
  k: number;
  x: Vec3;
  armed: number;
}

function posLoop(c: AudioContext, ref: number): PosLoop {
  const g = c.createGain();
  g.gain.value = 0;
  const p = c.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.maxDistance = 10000;
  const st = stage(c, p);
  g.connect(st.head);
  p.connect(world);
  return { g, p, st, k: 0, x: [NaN, 0, 0], armed: -9 };
}

/** true when k changed enough that dependent params (pitch) should be rescheduled */
function drive(l: PosLoop, pos: Vec3, k: number, peak: number, attack: number, release: number): boolean {
  const now = ctx!.currentTime;
  const changed = Math.abs(k - l.k) >= 0.02 || (k > 0) !== (l.k > 0);
  const stale = k > 0 && now - l.armed > 0.5;
  if (!(Math.abs(pos[0] - l.x[0]) < 0.2 && Math.abs(pos[1] - l.x[1]) < 0.2 && Math.abs(pos[2] - l.x[2]) < 0.2)) {
    l.x = [pos[0], pos[1], pos[2]];
    setPos(l.p, pos[0], pos[1], pos[2]);
  }
  steer(l.st, l.x);
  if (!changed && !stale) return false;
  const gp = l.g.gain;
  gp.cancelScheduledValues(now);
  if (k > 0) {
    gp.setTargetAtTime(peak, now, attack);
    gp.setTargetAtTime(0, now + 1.5, release);
  } else gp.setTargetAtTime(0, now, release);
  l.armed = now;
  l.k = k;
  return changed;
}

interface HumLoop extends PosLoop {
  buzz: GainNode;
}
let humLoop: HumLoop | null = null;
let coronaLoop: PosLoop | null = null;

function buildCorona(c: AudioContext): PosLoop {
  const l = posLoop(c, 6);
  layer(c, l.g, B.white, 'bandpass', 5500, 1.2, 0.45);
  layer(c, l.g, B.crackle, 'highpass', 3200, 0.7, 0.3, 1.6);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 3;
  const g = c.createGain();
  g.gain.value = 0.07;
  loopOsc(c, 'sawtooth', 100).connect(bp).connect(g).connect(l.g);
  return l;
}

function buildHum(c: AudioContext): HumLoop {
  const l = posLoop(c, 5);
  // magnetostriction hums at twice the mains frequency; the slow beat is two cores slightly out of step
  for (const [f, a] of [[100, 0.5], [100.35, 0.3], [200, 0.28], [300, 0.14], [400, 0.08]] as const) {
    const g = c.createGain();
    g.gain.value = a;
    loopOsc(c, 'sine', f).connect(g).connect(l.g);
  }
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 2;
  const buzz = c.createGain();
  buzz.gain.value = 0.04;
  loopOsc(c, 'sawtooth', 100).connect(bp).connect(buzz).connect(l.g);
  return { ...l, buzz };
}

interface MotorLoop extends PosLoop {
  rotor: OscillatorNode;
  whine: OscillatorNode;
  chuff: OscillatorNode;
  lp: BiquadFilterNode;
}
let motorLoop: MotorLoop | null = null;

function buildMotor(c: AudioContext): MotorLoop {
  const l = posLoop(c, 5);
  const body = c.createGain();
  body.gain.value = 0.6;
  body.connect(l.g);
  const rotor = loopOsc(c, 'sawtooth', 40);
  const lp = c.createBiquadFilter();
  lp.frequency.value = 500;
  lp.Q.value = 1.5;
  rotor.connect(lp).connect(body);
  // blade/spoke pass: a slow LFO on the body gives fans and flywheels their chuff
  const chuff = loopOsc(c, 'sine', 2);
  const depth = c.createGain();
  depth.gain.value = 0.3;
  chuff.connect(depth).connect(body.gain);
  const whine = loopOsc(c, 'square', 320);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 5;
  const gw = c.createGain();
  gw.gain.value = 0.06;
  whine.connect(bp).connect(gw).connect(l.g);
  layer(c, l.g, B.crackle, 'bandpass', 2600, 0.8, 0.12, 1.2);
  layer(c, l.g, B.brown, 'lowpass', 180, 0.707, 0.35);
  return { ...l, rotor, whine, chuff, lp };
}

/* ---------------- ambience ---------------- */

interface Bed {
  env: EnvPreset;
  g: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  timer: number;
}

const AMB: Record<EnvPreset, { wind: number; gust: number; birds: number; crickets: number; city: number }> = {
  noon: { wind: 0.45, gust: 0.5, birds: 1, crickets: 0, city: 0.6 },
  golden: { wind: 0.35, gust: 0.4, birds: 0.75, crickets: 0.25, city: 0.5 },
  overcast: { wind: 0.85, gust: 0.9, birds: 0.2, crickets: 0, city: 0.55 },
  dusk: { wind: 0.45, gust: 0.5, birds: 0.15, crickets: 0.7, city: 0.6 },
  night: { wind: 0.3, gust: 0.35, birds: 0, crickets: 1, city: 0.45 },
};

let bed: Bed | null = null;
let wantEnv: EnvPreset | null = null;

function buildBed(env: EnvPreset): Bed {
  const c = ctx!;
  const now = c.currentTime;
  const P = AMB[env];
  const g = c.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.setTargetAtTime(1, now, 0.9);
  g.connect(ambBus);
  const b: Bed = { env, g, srcs: [], nodes: [g], timer: 0 };
  const node = <T extends AudioNode>(n: T): T => (b.nodes.push(n), n);
  const src = <T extends AudioScheduledSourceNode>(s: T): T => (b.srcs.push(s), s);
  const bq = (type: BiquadFilterType, f: number, q: number) => {
    const f0 = node(c.createBiquadFilter());
    f0.type = type;
    f0.frequency.value = f;
    f0.Q.value = q;
    return f0;
  };
  const gn = (v: number) => {
    const n = node(c.createGain());
    n.gain.value = v;
    return n;
  };
  const lfo = (hz: number, depth: number, target: AudioParam) => {
    const o = src(c.createOscillator());
    o.frequency.value = hz;
    o.start(now);
    o.connect(gn(depth)).connect(target);
  };

  for (const side of [-1, 1]) {
    const bp = bq('bandpass', 320 + side * 40, 0.6);
    const wg = gn(P.wind * 0.35);
    const sp = node(c.createStereoPanner());
    sp.pan.value = side * 0.55;
    src(loopSrc(B.brown, rr(0.9, 1.1))).connect(bp).connect(wg).connect(sp).connect(g);
    lfo(rr(0.05, 0.11), 140 + 100 * P.gust, bp.frequency);
    lfo(rr(0.07, 0.15), P.wind * 0.2 * P.gust, wg.gain);
  }
  if (P.gust > 0.6) {
    const wg = gn(0.02 * P.gust);
    src(loopSrc(B.pink)).connect(bq('bandpass', 1150, 5)).connect(wg).connect(g);
    lfo(0.09, 0.018 * P.gust, wg.gain);
  }
  if (P.crickets > 0) src(loopSrc(B.crickets, rr(0.97, 1.03))).connect(bq('highpass', 3000, 0.7)).connect(gn(0.11 * P.crickets)).connect(g);
  if (P.city > 0) {
    src(loopSrc(B.brown, 0.8)).connect(bq('lowpass', 170, 0.7)).connect(gn(0.16 * P.city)).connect(g);
    const tg = gn(0.035 * P.city);
    src(loopSrc(B.pink, 0.9)).connect(bq('bandpass', 650, 0.6)).connect(tg).connect(g);
    lfo(0.035, 0.028 * P.city, tg.gain);
  }
  if (P.birds > 0) {
    const tick = () => {
      if (bed !== b) return;
      if (live() && !paused) chirp(b, P.birds);
      b.timer = window.setTimeout(tick, rr(600, 3200) / Math.max(P.birds, 0.2));
    };
    b.timer = window.setTimeout(tick, rr(400, 1500));
  }
  return b;
}

function chirp(b: Bed, level: number): void {
  const c = ctx!;
  const t = c.currentTime + 0.02;
  const o = c.createOscillator();
  const g = c.createGain();
  const sp = c.createStereoPanner();
  sp.pan.value = rr(-0.85, 0.85);
  g.gain.value = 0;
  o.connect(g).connect(sp).connect(b.g);
  const peak = 0.028 * level * rr(0.4, 1);
  const fp = o.frequency;
  const kind = rnd();
  let end: number;
  if (kind < 0.4) {
    const f0 = rr(3200, 4200);
    const notes = 4 + Math.floor(rnd() * 6);
    for (let i = 0; i < notes; i++) {
      const tt = t + i * 0.058;
      fp.setValueAtTime(i % 2 ? f0 * 1.18 : f0, tt);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(peak, tt + 0.012);
      g.gain.linearRampToValueAtTime(0, tt + 0.045);
    }
    end = t + notes * 0.058 + 0.05;
  } else if (kind < 0.7) {
    fp.setValueAtTime(2300, t);
    fp.exponentialRampToValueAtTime(3300, t + 0.22);
    fp.setValueAtTime(3300, t + 0.3);
    fp.exponentialRampToValueAtTime(2600, t + 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.04);
    g.gain.linearRampToValueAtTime(0, t + 0.22);
    g.gain.linearRampToValueAtTime(peak * 0.8, t + 0.33);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    end = t + 0.55;
  } else {
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.09;
      fp.setValueAtTime(5200, tt);
      fp.exponentialRampToValueAtTime(3600, tt + 0.045);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(peak, tt + 0.008);
      g.gain.linearRampToValueAtTime(0, tt + 0.045);
    }
    end = t + n * 0.09 + 0.05;
  }
  o.start(t);
  o.stop(end);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
    sp.disconnect();
  };
}

function retireBed(b: Bed, now: number): void {
  window.clearTimeout(b.timer);
  b.g.gain.cancelScheduledValues(now);
  b.g.gain.setTargetAtTime(0, now, 0.6);
  let n = b.srcs.length;
  for (const s of b.srcs) {
    s.onended = () => {
      if (--n <= 0) for (const x of b.nodes) x.disconnect();
    };
    s.stop(now + 4);
  }
}

function applyAmbience(): void {
  if (!live()) return;
  if ((bed?.env ?? null) === wantEnv) return;
  const now = ctx!.currentTime;
  if (bed) retireBed(bed, now);
  bed = wantEnv ? buildBed(wantEnv) : null;
}

/* ---------------- master chain ---------------- */

function hold(p: AudioParam, now: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
  else {
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
  }
}

function build(c: AudioContext): void {
  B = makeBank(c);
  shapeCurve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    shapeCurve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
  }
  const clipCurve = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) {
    const x = (i / 4095) * 2 - 1;
    const a = Math.abs(x);
    clipCurve[i] = a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }

  master = c.createGain();
  master.gain.value = volGain(volume);
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.22;
  const lim = c.createDynamicsCompressor();
  lim.threshold.value = -2.5;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.001;
  lim.release.value = 0.09;
  const clip = c.createWaveShaper();
  clip.curve = clipCurve;
  master.connect(comp).connect(lim).connect(clip).connect(c.destination);

  muffle = c.createBiquadFilter();
  muffle.type = 'lowpass';
  muffle.frequency.value = 20000;
  muffle.Q.value = 0.5;
  muffle.connect(master);
  pauseLP = c.createBiquadFilter();
  pauseLP.type = 'lowpass';
  pauseLP.frequency.value = paused ? 800 : 20000;
  pauseLP.Q.value = 0.5;
  pauseLP.connect(muffle);
  world = c.createGain();
  world.gain.value = paused ? 0.2 : 1;
  world.connect(pauseLP);

  verbIn = c.createGain();
  verbIn.channelCount = 1;
  verbIn.channelCountMode = 'explicit';
  const conv = c.createConvolver();
  conv.buffer = B.ir;
  verbIn.connect(conv);
  E = buildEnv(c, conv);

  ambBus = c.createGain();
  ambBus.gain.value = 0.9;
  ambBus.connect(world);
  uiBus = c.createGain();
  uiBus.gain.value = 0.8;
  uiBus.connect(master);

  ringOsc = c.createOscillator();
  ringOsc.frequency.value = 4000;
  ringGain = c.createGain();
  ringGain.gain.value = 0;
  ringOsc.connect(ringGain).connect(master);
  ringOsc.start();

  // Chrome loads the HRTF database lazily; touching it now avoids a silent first blast.
  c.createPanner().panningModel = 'HRTF';

  applyListener();
}

function applyListener(): void {
  if (!ctx) return;
  const l = ctx.listener;
  if (l.positionX) {
    l.positionX.value = L[0];
    l.positionY.value = L[1];
    l.positionZ.value = L[2];
    l.forwardX.value = F[0];
    l.forwardY.value = F[1];
    l.forwardZ.value = F[2];
    l.upX.value = U[0];
    l.upY.value = U[1];
    l.upZ.value = U[2];
  } else {
    const o = l as unknown as {
      setPosition(x: number, y: number, z: number): void;
      setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
    };
    o.setPosition(L[0], L[1], L[2]);
    o.setOrientation(F[0], F[1], F[2], U[0], U[1], U[2]);
  }
}

/* ---------------- structural noise: ground shock and stress emission ---------------- */

function groundShock(pos: Vec3, level: number, dur: number): void {
  const v = voice({ pos, level, dur: dur + 0.3, ref: 30, speed: GROUND_SPEED, hrtf: false });
  if (!v) return;
  tone(v, 'sine', rr(22, 30), v.t0, 0.06, 0.9, dur, 16, dur);
  nburst(v, B.brown, v.t0, 'lowpass', 55, 0.8, 0.08, 1, dur * 0.8, 0.5, dur * 0.2);
}

const stressCells = new Map<number, { u: number; t: number }>();

function stressTick(pos: Vec3, s: number, f: number): void {
  const v = voice({ pos, level: 0.15 + 0.25 * s, dur: 0.15, ref: 4, send: 0.2, hrtf: false });
  if (!v) return;
  nburst(v, B.white, v.t0, 'highpass', f, 0.8, 0.0003, 0.9, 0.006 + 0.006 * s);
  tone(v, 'sine', f * rr(0.7, 0.9), v.t0, 0.001, 0.2 * s, 0.04);
}

function timberCreak(pos: Vec3, s: number, groan: boolean): void {
  const d = groan ? rr(0.7, 1.4) : rr(0.2, 0.5);
  const v = voice({ pos, level: 0.2 + 0.35 * s, dur: d + 0.2, ref: 6, send: 0.35, hrtf: false });
  if (!v) return;
  const t = v.t0;
  const l = amp(v, t, 0.04, 0.6, d * 0.5, d * 0.4);
  // fibres sliding in a joint stick and slip: a wandering buzz heard through the member's wooden body
  const o = osc(v, 'sawtooth', groan ? rr(45, 70) : rr(90, 160), t, l.end, false);
  o.frequency.setValueCurveAtTime(walk(o.frequency.value, 10, 0.88, 1.12, 30, 240), t, d);
  const am = gainNode(v, 0.5);
  noise(v, B.crackle, t, l.end, 0.25).connect(gainNode(v, 1.6)).connect(am.gain);
  o.connect(filt(v, 'bandpass', rr(260, 420), 9)).connect(am);
  o.connect(filt(v, 'bandpass', rr(750, 1100), 11)).connect(gainNode(v, 0.5)).connect(am);
  am.connect(l.g);
}

function masonryStress(pos: Vec3, s: number, groan: boolean): void {
  const d = groan ? rr(1.2, 2.2) : 0.35;
  const v = voice({ pos, level: 0.25 + 0.4 * s, dur: d + 0.3, ref: groan ? 10 : 5, send: 0.45, hrtf: false });
  if (!v) return;
  const t = v.t0;
  // micro-cracking: acoustic emission arrives as clusters of dry ticks
  const n = 2 + Math.floor(rnd() * 3 * (0.5 + s));
  for (let i = 0; i < n; i++) nburst(v, B.white, t + rr(0, d * 0.6), 'bandpass', rr(1800, 4200), 1.1, 0.0004, rr(0.25, 0.7) * s, 0.008);
  if (!groan) return;
  // a building near failure: crushing grind under a sub-bass swell as load sheds through the frame
  const l = amp(v, t, d * 0.35, 0.7 * s, d * 0.45, d * 0.2);
  const am = gainNode(v, 0.35);
  noise(v, B.brown, t, l.end, 0.8).connect(filt(v, 'lowpass', 140, 0.9)).connect(am).connect(l.g);
  noise(v, B.crackle, t, l.end, 0.12).connect(gainNode(v, 2)).connect(am.gain);
  tone(v, 'sine', rr(30, 40), t, d * 0.4, 0.4 * s, d * 0.6, 24, d);
}

/* ---------------- sound state ---------------- */

let lastCollapse = { t: -1, m: 0 };
let lastSnap = { t: -1, s: 0 };
let lastGroan = { t: -1, s: 0 };
let lastWreck = { t: -1, s: 0 };
let lastStep = -1;
let stepSide = 1;
let lastHover = -1;
let starRun = { t: -9, n: 0 };
let comboRun = { t: -9, n: 0 };

/* ---------------- public API ---------------- */

export interface Acoustics {
  rt60: number;
  mfp: number;
  enclosure: number;
  canyon: number;
  width: number;
  wet: number;
  voices: number;
  rays: number;
}

export const audio = {
  /** the structure the sound travels through; without it propagation is open-field (no occlusion, outdoor reverb) */
  setScene(q: RayQuery | null): void {
    rayQ = q;
    occCache.clear();
    probeD.fill(Infinity);
    probeI = PROBE.length;
    probeT = -9;
  },

  acoustics(): Acoustics {
    return {
      rt60: E?.rt60 ?? 0, mfp: E?.mfp ?? 0, enclosure: E?.encl ?? 0, canyon: E?.canyon ?? 0, width: E?.width ?? 0, wet: E?.wet ?? 0,
      voices: voices.length, rays: raysTotal,
    };
  },

  /** utilisation of a joint or member near `pos` (1 = at capacity); feed the few worst joints at ~4-10 Hz */
  structureStress(pos: Vec3, utilisation: number, mat: MaterialId = 'concrete'): void {
    if (!live()) return;
    const u = utilisation || 0;
    const now = ctx!.currentTime;
    const key = cell(pos, 3);
    let e = stressCells.get(key);
    if (!e) {
      if (stressCells.size > 256) for (const [k, x] of stressCells) if (now - x.t > 1) stressCells.delete(k);
      if (stressCells.size > 256) stressCells.clear();
      stressCells.set(key, (e = { u, t: now }));
    }
    const dt = clamp(now - e.t, 1 / 60, 0.5);
    const du = u - e.u;
    e.u = u;
    e.t = now;
    if (u < 0.5) return;
    const x = clamp((u - 0.5) / 0.5, 0, 1.4);
    // acoustic emission climbs steeply toward capacity; a sudden jump in load always speaks
    if (!(du / dt > 1.5) && rnd() > (0.2 + 7 * x * x) * dt) return;
    if (!allow('stress', 5, 3, now)) return;
    const s = clamp(x, 0.1, 1);
    if (METALLIC.has(mat)) {
      if (u >= 0.85) audio.steelGroan(pos, s);
      else audio.rebarStrain(pos, s);
    } else if (mat === 'glass' || mat === 'tempered' || mat === 'lamp') {
      if (u >= 0.9) audio.glassCrack(pos);
      else stressTick(pos, s, 5200);
    } else if (WOODY.has(mat)) timberCreak(pos, s, u >= 0.85);
    else masonryStress(pos, s, u >= 0.85);
  },

  /** fast debris or a projectile going past: aerodynamic whoosh with a true Doppler shift; vel in m/s */
  flyby(pos: Vec3, vel: Vec3, size = 0.3): void {
    if (!live()) return;
    const sp = Math.hypot(vel[0], vel[1], vel[2]);
    if (!(sp > 12)) return;
    const tc = clamp(((L[0] - pos[0]) * vel[0] + (L[1] - pos[1]) * vel[1] + (L[2] - pos[2]) * vel[2]) / (sp * sp), 0, 1);
    const miss = Math.hypot(pos[0] + vel[0] * tc - L[0], pos[1] + vel[1] * tc - L[1], pos[2] + vel[2] * tc - L[2]);
    if (!(miss < 30) || !allow('flyby', 8, 4, ctx!.currentTime)) return;
    const z = clamp(size, 0.05, 3);
    const dur = 1;
    const v = voice({ pos, vel, level: clamp(0.1 + sp / 150, 0.1, 0.8) * (0.4 + 0.6 * Math.min(z, 1)), dur, ref: 2 + 2 * Math.min(z, 1), send: 0.12 });
    if (!v) return;
    const t = v.t0;
    const fc = clamp((25 * sp) / Math.sqrt(z), 250, 5000);
    nburst(v, B.pink, t, 'bandpass', fc, 0.9, 0.04, 0.8, 0.25, 1, dur - 0.3);
    nburst(v, B.white, t, 'highpass', fc * 1.5, 0.7, 0.04, 0.25 * clamp(sp / 60, 0, 1), 0.2, 1, dur - 0.3);
  },

  init(): void {
    if (ctx || typeof window === 'undefined') return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let c: AudioContext;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    try {
      build(c);
    } catch {
      void c.close().catch(() => undefined);
      return;
    }
    ctx = c;
    c.onstatechange = () => {
      if (c.state === 'running') applyAmbience();
    };
    const unlock = () => {
      if (c.state === 'suspended') c.resume().catch(() => undefined);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  },

  async resume(): Promise<void> {
    audio.init();
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch {
      /* gesture not accepted; the unlock listeners retry on the next one */
    }
    applyAmbience();
  },

  setVolume(v: number): void {
    volume = clamp(v, 0, 1);
    if (!ctx) return;
    master.gain.setTargetAtTime(volGain(volume), ctx.currentTime, 0.03);
  },

  setListener(pos: Vec3, forward: Vec3, up: Vec3 = UP): void {
    L[0] = pos[0];
    L[1] = pos[1];
    L[2] = pos[2];
    F[0] = forward[0];
    F[1] = forward[1];
    F[2] = forward[2];
    U[0] = up[0];
    U[1] = up[1];
    U[2] = up[2];
    applyListener();
    if (live()) frameTick();
  },

  explosion(pos: Vec3, size: number): void {
    if (!live()) return;
    const s = clamp(size, 0.3, 4);
    const far = clamp((distTo(pos) - 40) / 360, 0, 1);
    const v = voice({ pos, level: 0.55 + 0.3 * s, dur: 2.4 + 1.3 * s, ref: 10 + 10 * s, send: 0.55 + 0.35 * far });
    // charge in kg TNT: radius 3 m ~ 1.5 kg
    const T = blast(pos, 1.5 * s * s * s, ctx!.currentTime + 0.006 + distTo(pos) / SOUND_SPEED);
    if (s > 1.5) groundShock(pos, 0.25 * s, 0.6 + 0.25 * s);
    if (!v) return;
    const t = v.t0;
    const big = Math.sqrt(s);
    // the first arrival is the shock front itself; nearby surfaces return duller, stretched copies
    nwave(v, t, T, 0.9);
    wallEchoes(pos, v.dist, 3, (dt, g) => {
      nwave(v, t + dt, T * 1.6, 0.9 * g);
      nburst(v, B.brown, t + dt, 'lowpass', 500, 0.7, 0.004, 0.8 * g, 0.25 + 0.1 * s);
    });
    if (far < 0.95) nburst(v, B.white, t, 'highpass', 1400, 0.7, 0.0008, 0.9 * (1 - far), 0.035 + 0.02 * s);
    tone(v, 'sine', 125 / big, t, 0.004, 1.15, 0.7 + 0.45 * s, 30, 0.28 * big + 0.1, true);
    const body = nburst(v, B.pink, t, 'lowpass', 7000 * (1 - 0.75 * far), 0.6, 0.003, 1, 0.9 + 0.55 * s);
    body.frequency.exponentialRampToValueAtTime(160 + 60 * (1 - far), t + 0.9 * big + 0.2);
    nburst(v, B.brown, t, 'bandpass', 380, 0.7, 0.02, 0.7, 0.4 + 1.2 * Math.pow(s, 0.6), 0.9);
    nburst(v, B.crackle, t + 0.07 + rr(0, 0.05), 'bandpass', 2400 * (1 - 0.6 * far), 0.6, 0.06, 0.45 * big, 1.4 + 0.7 * s, rr(0.85, 1.15));
    nburst(v, B.crackle, t + 0.25, 'bandpass', 700, 0.8, 0.2, 0.35 * big, 1.5 + s, 0.5);
    nburst(v, B.brown, t + 0.03, 'lowpass', 150, 0.8, 0.12, 0.55 + 0.25 * s + 0.4 * far, 2.2 + 1.2 * s);
  },

  /** dims: the struck member's extents (m); tunes its modes from span, depth, E and density */
  impact(pos: Vec3, mat: MaterialId, strength: number, dims?: Vec3): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.015) return;
    const now = ctx!.currentTime;
    feed(debrisTex, pos, s * s);
    if (merged(impMerge, mat, s, now, 0.05)) return;
    if (!take(impGate, 36, 10, now) && !(s >= 0.75 && allow('heavyImpact', 6, 2, now))) return;
    const M = MATS[mat];
    const q = dims ? modal(mat, dims) : null;
    const ring = q ? Math.max(((M.d[0] ?? 0.15) * 1.2) / q.fs, METALLIC.has(mat) ? q.ring : 0) : (M.d[0] ?? 0.15) * 1.2;
    const v = voice({ pos, level: 0.18 + 0.5 * s, dur: Math.min(5, ring) + 0.2, ref: 3 + 3 * s, send: 0.22, hrtf: s > 0.5 });
    if (!v) return;
    strike(v, v.t0, mat, s, q);
    if (s >= 0.62 && v.loud >= 0.07) heavyContact(v, v.t0, mat, s);
    if (MASONRY.has(mat) && s > 0.35) nburst(v, B.crackle, v.t0, 'bandpass', 2000, 0.7, 0.003, 0.35 * s, 0.12 + 0.15 * s, 1.2);
  },

  fracture(pos: Vec3, mat: MaterialId, size: number): void {
    if (!live()) return;
    const z = clamp(size, 0.05, 2);
    const now = ctx!.currentTime;
    const e = Math.min(1, 0.4 + 0.3 * z);
    feed(debrisTex, pos, e * e);
    if (merged(fracMerge, mat, z, now, 0.06)) return;
    if (!take(fracGate, 18, 6, now) && !(z >= 0.8 && allow('largeFracture', 3, 2, now))) return;
    const zc = Math.min(z, 1);
    const v = voice({ pos, level: 0.3 + 0.35 * Math.min(z, 1.5), dur: 1.4, ref: 4 + 4 * z, send: 0.35, hrtf: z > 0.4 });
    if (!v) return;
    const t = v.t0;
    switch (mat) {
      case 'glass': return annealedShatter(v, t, zc);
      case 'tempered': return temperedBurst(v, t, zc);
      case 'terracotta':
      case 'ceramic': return ceramic(v, t);
      case 'stone':
      case 'marble': return stoneBreak(v, t, mat, zc);
      case 'sandstone':
      case 'adobe':
      case 'cinderblock': return crumble(v, t, mat, zc);
      case 'drywall': return drywallBreak(v, t, zc);
      case 'plywood': return delaminate(v, t, zc);
      case 'castiron': return brittleIron(v, t, zc);
      case 'pvc': return plasticCrack(v, t, zc);
      case 'lamp': return lampPop(v, t, zc);
      case 'machine': return machineBreak(v, t, zc);
    }
    if (WOODY.has(mat)) splinter(v, t, mat, zc);
    else if (METALLIC.has(mat)) tear(v, t, mat);
    else masonryCrunch(v, t, mat, zc);
  },

  rebarTwang(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.03) return;
    const now = ctx!.currentTime;
    if (!allow('twang', 8, 4, now) && s < 0.8) return;
    const v = voice({ pos, level: 0.3 + 0.45 * s, dur: 1.6, ref: 6, send: 0.35, hrtf: s > 0.4 });
    if (!v) return;
    const t = v.t0;
    const f0 = rr(260, 480);
    nburst(v, B.white, t, 'highpass', 2500, 0.7, 0.0005, 0.9, 0.015);
    // bending modes of a free bar; pitch sags as the released tension rings out
    for (const [r, d, a] of [[1, 1.1, 0.5], [2.756, 0.6, 0.35], [5.404, 0.35, 0.22], [8.933, 0.2, 0.12]] as const) {
      const o = tone(v, 'sine', f0 * r, t, 0.001, a * (0.5 + 0.5 * s), d * (0.6 + 0.4 * s));
      o.frequency.exponentialRampToValueAtTime(f0 * r * 0.86, t + 0.25);
    }
    const l = amp(v, t + 0.005, 0.004, 0.06 + 0.28 * s, 0.28);
    const bp = filt(v, 'bandpass', 3000, 3);
    bp.frequency.setValueAtTime(3000, t + 0.005);
    bp.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    const zing = osc(v, 'sawtooth', 3200, t + 0.005, l.end);
    zing.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    zing.connect(bp).connect(l.g);
  },

  rebarStrain(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.05) return;
    const now = ctx!.currentTime;
    if (!allow('strain', 2.5, 2, now)) return;
    const v = voice({ pos, level: 0.18 + 0.3 * s, dur: 0.9, ref: 5, send: 0.3, hrtf: false });
    if (!v) return;
    const t = v.t0;
    const d = rr(0.25, 0.6);
    const l = amp(v, t, 0.05, 0.6, d * 0.6, d * 0.3);
    // stick-slip: a buzzy source wandering in pitch, heard through the bar's narrow resonances
    const o = osc(v, 'sawtooth', rr(90, 150), t, l.end, false);
    o.frequency.setValueCurveAtTime(walk(o.frequency.value, 10, 0.88, 1.12, 50, 260), t, d);
    o.connect(filt(v, 'bandpass', rr(900, 1500), 12)).connect(l.g);
    o.connect(filt(v, 'bandpass', rr(2200, 3200), 14)).connect(gainNode(v, 0.5)).connect(l.g);
  },

  steelGroan(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.03) return;
    const now = ctx!.currentTime;
    if (now - lastGroan.t < 0.7 && s <= lastGroan.s + 0.2) return;
    if (!allow('groan', 1.2, 2, now)) return;
    lastGroan = { t: now, s };
    const dur = (1.4 + 2.2 * s) * rr(0.8, 1.1);
    const v = voice({ pos, level: 0.3 + 0.4 * s, dur: dur + 0.3, ref: 10, send: 0.55 });
    if (!v) return;
    const t = v.t0;
    const l = amp(v, t, 0.25 + 0.2 * rnd(), 0.7, dur * 0.45, dur * 0.4);
    const o = osc(v, 'sawtooth', rr(38, 62), t, l.end, false);
    o.frequency.setValueCurveAtTime(walk(o.frequency.value, 14, 0.9, 1.07, 22, 90), t, dur);
    // slowed crackle on the gain gives the stick-slip creak of a yielding member
    const am = gainNode(v, 0.45);
    noise(v, B.crackle, t, l.end, rr(0.08, 0.16)).connect(gainNode(v, 1.8)).connect(am.gain);
    for (const [f, q, g] of [[rr(180, 240), 14, 1.6], [rr(420, 520), 16, 1.1], [rr(760, 900), 18, 0.8], [rr(1300, 1600), 20, 0.45]] as const) {
      o.connect(filt(v, 'bandpass', f, q)).connect(gainNode(v, g)).connect(am);
    }
    am.connect(l.g);
    tone(v, 'sine', rr(30, 36), t, 0.4, 0.1 + 0.35 * s, dur * 0.8, 24, dur);
  },

  spall(pos: Vec3): void {
    if (!live()) return;
    if (!allow('spall', 6, 4, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.45, dur: 0.8, ref: 4, send: 0.25, hrtf: false });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', 1500, 0.7, 0.0004, 1, 0.012);
    tone(v, 'sine', 1100, t, 0.001, 0.5, 0.03, 300, 0.03);
    nburst(v, B.crackle, t + 0.02, 'bandpass', 3600, 0.8, 0.01, 0.6, 0.35, 1.7);
    const chips = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < chips; i++) tone(v, 'sine', rr(2500, 5200), t + rr(0.03, 0.35), 0.001, rr(0.08, 0.2), 0.025);
  },

  sizzle(pos: Vec3, heat: number): void {
    if (!live()) return;
    const h = clamp(heat, 0, 1);
    if (h < 0.02) return;
    feed(heatTex, pos, h * h);
    const now = ctx!.currentTime;
    if (rnd() > 0.5 + 0.5 * h || !allow('tick', 2.5, 2, now)) return;
    const v = voice({ pos, level: 0.12 + 0.15 * h, dur: 0.15, ref: 3, hrtf: false });
    if (!v) return;
    tone(v, 'sine', rr(2600, 4200), v.t0, 0.0008, 0.6, 0.03);
    nburst(v, B.white, v.t0, 'highpass', 5000, 0.7, 0.0005, 0.3, 0.006);
  },

  glassCrack(pos: Vec3): void {
    if (!live()) return;
    if (!allow('gcrack', 5, 3, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.4, dur: 0.6, ref: 4, send: 0.25, hrtf: false });
    if (!v) return;
    const t = v.t0;
    // the crack runs across the pane as a quick burst of ticks
    const n = 3 + Math.floor(rnd() * 6);
    let tt = t;
    for (let i = 0; i < n; i++) {
      nburst(v, B.white, tt, 'highpass', rr(3000, 6000), 0.8, 0.0003, rr(0.35, 1) * (1 - i / (n + 2)), 0.004 + rnd() * 0.006);
      tt += rr(0.004, 0.018);
    }
    tone(v, 'sine', rr(3400, 4600), t, 0.001, 0.18, 0.22);
    tone(v, 'sine', rr(5200, 6800), t + 0.005, 0.001, 0.1, 0.12);
    tone(v, 'sine', rr(1700, 2300), t, 0.001, 0.12, 0.08);
  },

  burn(pos: Vec3, intensity: number): void {
    if (!live()) return;
    const s = clamp(intensity * 0.6, 0, 1);
    if (s < 0.01) return;
    // the fire itself is one shared bed; individual calls only add the odd resin pop on top
    feed(fireTex, pos, s);
    const now = ctx!.currentTime;
    if (rnd() > 0.35 + 0.5 * s || !allow('burn', 3.5, 3, now)) return;
    const v = voice({ pos, level: 0.12 + 0.25 * s, dur: 0.5, ref: 4, send: 0.2, hrtf: false });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', rr(1800, 3200), 0.8, 0.0006, 0.7, rr(0.008, 0.02));
    if (rnd() < 0.5) nburst(v, B.crackle, t + 0.01, 'bandpass', rr(2200, 3800), 0.8, 0.004, 0.5, rr(0.1, 0.25), rr(1, 1.5));
    if (rnd() < 0.25) nburst(v, B.pink, t + rr(0.02, 0.08), 'highpass', 3500, 0.6, 0.03, 0.18, 0.35);
  },

  snap(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.02) return;
    const now = ctx!.currentTime;
    if (now - lastSnap.t < 0.03 && s <= lastSnap.s) return;
    lastSnap = { t: now, s };
    const v = voice({ pos, level: 0.35 + 0.45 * s, dur: 1.2, ref: 6, send: 0.35, hrtf: s > 0.4 });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', 1800, 0.8, 0.0006, 1, 0.022 + 0.02 * s);
    nburst(v, B.white, t + rr(0.018, 0.05), 'bandpass', 2600, 1.2, 0.0006, 0.6, 0.02);
    tone(v, 'sine', 170, t, 0.002, 0.5 * s + 0.05, 0.12, 80, 0.12);
    const d = rr(0.35, 0.8);
    const tc = t + 0.03;
    const l = amp(v, tc, 0.04, 0.28 * s + 0.05, d);
    const o = osc(v, 'sawtooth', rr(40, 70), tc, l.end, false);
    o.frequency.setValueCurveAtTime(walk(o.frequency.value, 8, 0.82, 1.18, 28, 110), tc, d);
    o.connect(filt(v, 'bandpass', rr(520, 900), 7)).connect(l.g);
  },

  collapse(pos: Vec3, mass: number): void {
    if (!live()) return;
    const c = ctx!;
    const now = c.currentTime;
    const m = clamp(Math.log10(Math.max(mass, 1) / 500) / Math.log10(400), 0, 1);
    if (now - lastCollapse.t < 0.4 && m <= lastCollapse.m + 0.15) return;
    if (!allow('collapse', 1.5, 2, now)) return;
    lastCollapse = { t: now, m };
    const dur = 1.6 + 3.4 * m;
    // felt through the floor before it is heard: a ground-borne sub-bass arrival for heavy failures
    if (m > 0.15) groundShock(pos, 0.2 + 0.6 * m, dur * 0.8);
    const v = voice({ pos, level: 0.5 + 0.45 * m, dur: dur + 1, ref: 12 + 18 * m, send: 0.6 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 70, t, 0.006, 0.9, 0.45 + 0.3 * m, 32, 0.4, true);
    const lp = nburst(v, B.brown, t, 'lowpass', 320, 0.9, 0.08, 1, dur * 0.75, 1, dur * 0.25);
    lp.frequency.exponentialRampToValueAtTime(90, t + dur);
    tone(v, 'sine', 46, t, 0.15, 0.45 + 0.35 * m, dur * 0.8, 30, dur);
    // crumble: pink noise amplitude-modulated by slowed-down crackle -> irregular grinding bursts
    const cr = amp(v, t + 0.05, 0.12, 0.55 + 0.3 * m, dur * 0.7, dur * 0.2);
    const am = gainNode(v, 0.35);
    noise(v, B.pink, t + 0.05, cr.end).connect(filt(v, 'bandpass', 520, 0.8)).connect(am).connect(cr.g);
    noise(v, B.crackle, t + 0.05, cr.end, 0.22).connect(gainNode(v, 2.2)).connect(am.gain);
    nburst(v, B.crackle, t + 0.18, 'bandpass', 1900, 0.7, 0.25, 0.4 + 0.2 * m, dur * 0.8, rr(0.8, 1.1), dur * 0.2);
    const gr = amp(v, t + 0.1, 0.5, 0.16 + 0.1 * m, dur * 0.6);
    const o = osc(v, 'sawtooth', rr(36, 44), t + 0.1, gr.end);
    o.frequency.linearRampToValueAtTime(rr(26, 32), t + dur);
    o.connect(filt(v, 'lowpass', 380, 2.5)).connect(gr.g);
  },

  fire(weapon: WeaponId): void {
    if (!live()) return;
    switch (weapon) {
      case 'hammer': {
        const v = voice({ level: 0.5, dur: 0.45 });
        if (!v) return;
        const t = v.t0;
        const bp = nburst(v, B.pink, t, 'bandpass', 380, 1.3, 0.1, 0.8, 0.22, 1, 0.04);
        bp.frequency.exponentialRampToValueAtTime(1500, t + 0.13);
        bp.frequency.exponentialRampToValueAtTime(480, t + 0.36);
        return;
      }
      case 'cannon': {
        const v = voice({ level: 0.9, dur: 2.2, send: 0.5 });
        if (!v) return;
        const t = v.t0;
        nburst(v, B.white, t, 'highpass', 1200, 0.7, 0.0006, 1, 0.045);
        tone(v, 'sine', 95, t, 0.003, 1.2, 0.75, 34, 0.3, true);
        const lp = nburst(v, B.pink, t, 'lowpass', 6000, 0.6, 0.002, 0.9, 0.8);
        lp.frequency.exponentialRampToValueAtTime(220, t + 0.7);
        nburst(v, B.brown, t + 0.02, 'lowpass', 420, 0.7, 0.03, 0.5, 1.5);
        strike(v, t + 0.01, 'steel', 0.25);
        return;
      }
      case 'rocket': {
        const v = voice({ level: 0.7, dur: 1.8, send: 0.35 });
        if (!v) return;
        const t = v.t0;
        tone(v, 'sine', 210, t, 0.002, 0.6, 0.1, 60, 0.1);
        nburst(v, B.white, t, 'highpass', 2500, 0.7, 0.001, 0.5, 0.03);
        const bp = nburst(v, B.pink, t, 'bandpass', 500, 0.9, 0.03, 0.9, 1.25, 1, 0.1);
        bp.frequency.exponentialRampToValueAtTime(2600, t + 0.22);
        bp.frequency.exponentialRampToValueAtTime(420, t + 1.4);
        nburst(v, B.white, t + 0.02, 'highpass', 5000, 0.7, 0.02, 0.22, 0.6);
        return;
      }
      case 'charge': {
        const v = voice({ level: 0.35, dur: 0.4 });
        if (!v) return;
        const t = v.t0;
        const bp = nburst(v, B.pink, t, 'bandpass', 700, 1.2, 0.05, 0.5, 0.12);
        bp.frequency.exponentialRampToValueAtTime(1700, t + 0.16);
        nburst(v, B.pink, t + 0.02, 'highpass', 2200, 0.7, 0.01, 0.3, 0.08);
        return;
      }
      case 'flamer': {
        // the igniter cartridge pops and the first of the stream catches with a soft whoomph
        const v = voice({ level: 0.55, dur: 0.9, send: 0.2 });
        if (!v) return;
        const t = v.t0;
        nburst(v, B.white, t, 'highpass', 2500, 0.7, 0.0008, 0.5, 0.012);
        const w = nburst(v, B.pink, t + 0.03, 'lowpass', 260, 0.9, 0.06, 0.9, 0.6, 1, 0.08);
        w.frequency.exponentialRampToValueAtTime(1500, t + 0.2);
        w.frequency.exponentialRampToValueAtTime(380, t + 0.7);
        tone(v, 'sine', 70, t + 0.03, 0.04, 0.5, 0.3, 42, 0.3);
        return;
      }
      case 'launcher': {
        // the 40 mm's hollow 'bloop': a low-pressure high-low system, far quieter than a rifle
        const v = voice({ level: 0.6, dur: 0.8, send: 0.3 });
        if (!v) return;
        const t = v.t0;
        tone(v, 'sine', 140, t, 0.002, 0.9, 0.16, 58, 0.14);
        nburst(v, B.pink, t, 'bandpass', 420, 1.6, 0.003, 0.7, 0.18);
        nburst(v, B.white, t, 'highpass', 1800, 0.7, 0.001, 0.25, 0.03);
        strike(v, t + 0.01, 'steel', 0.15);
        return;
      }
      case 'recoilless': {
        // a recoilless rifle is brutally loud: the round and the whole propelling charge vent at once, both ends
        const v = voice({ level: 1.1, dur: 2.8, send: 0.6 });
        if (!v) return;
        const t = v.t0;
        nburst(v, B.white, t, 'highpass', 900, 0.7, 0.0004, 1, 0.06);
        tone(v, 'sine', 80, t, 0.002, 1.3, 0.9, 28, 0.4, true);
        const lp = nburst(v, B.pink, t, 'lowpass', 8000, 0.6, 0.002, 1, 1.1);
        lp.frequency.exponentialRampToValueAtTime(180, t + 0.9);
        nburst(v, B.brown, t + 0.02, 'lowpass', 380, 0.7, 0.03, 0.7, 2);
        nburst(v, B.white, t + 0.05, 'highpass', 5000, 0.7, 0.02, 0.25, 0.7);
        return;
      }
      case 'thermobaric': {
        const v = voice({ level: 0.8, dur: 1.6, send: 0.4 });
        if (!v) return;
        const t = v.t0;
        tone(v, 'sine', 160, t, 0.002, 0.8, 0.14, 50, 0.12);
        nburst(v, B.white, t, 'highpass', 2000, 0.7, 0.001, 0.6, 0.04);
        const bp = nburst(v, B.pink, t, 'bandpass', 600, 0.9, 0.02, 0.9, 0.9, 1, 0.1);
        bp.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
        bp.frequency.exponentialRampToValueAtTime(400, t + 0.9);
        return;
      }
      case 'buster': {
        // the designator's laser fire and the controller's acknowledgement tones
        const v = voice({ level: 0.35, dur: 0.6 });
        if (!v) return;
        const t = v.t0;
        nburst(v, B.white, t, 'highpass', 3500, 0.7, 0.0005, 0.4, 0.006);
        for (const [dt, f] of [[0.1, 1200], [0.24, 1600], [0.38, 1200]] as const) {
          const l = amp(v, t + dt, 0.004, 0.18, 0.06, 0.03);
          osc(v, 'sine', f, t + dt, l.end).connect(l.g);
        }
        return;
      }
      case 'satchel': {
        // the pull ring and the fuse igniter's snap, then the bag leaves the hand
        const v = voice({ level: 0.4, dur: 0.6 });
        if (!v) return;
        const t = v.t0;
        nburst(v, B.white, t, 'bandpass', 2600, 2, 0.0005, 0.6, 0.01);
        tone(v, 'sine', 900, t, 0.001, 0.2, 0.03);
        const bp = nburst(v, B.pink, t + 0.15, 'bandpass', 500, 1.2, 0.08, 0.4, 0.2);
        bp.frequency.exponentialRampToValueAtTime(1200, t + 0.35);
        return;
      }
      case 'airstrike': {
        const v = voice({ level: 0.45, dur: 0.7 });
        if (!v) return;
        const t = v.t0;
        nburst(v, B.white, t, 'highpass', 3000, 0.7, 0.0005, 0.5, 0.006);
        tone(v, 'sine', 2350, t + 0.005, 0.002, 0.35, 0.18);
        tone(v, 'sine', 2350 * 2.71, t + 0.005, 0.002, 0.15, 0.09);
        const bp = nburst(v, B.pink, t + 0.15, 'bandpass', 600, 1.2, 0.06, 0.35, 0.16);
        bp.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
        return;
      }
    }
  },

  hammer(hit: MaterialId | null): void {
    if (!live()) return;
    if (!hit) {
      const v = voice({ level: 0.3, dur: 0.3 });
      if (v) nburst(v, B.pink, v.t0, 'lowpass', 320, 0.8, 0.04, 0.8, 0.16);
      return;
    }
    const v = voice({ level: 0.85, dur: 1.8, send: 0.3 });
    if (!v) return;
    const t = v.t0;
    strike(v, t, hit, 1);
    tone(v, 'sine', 90, t, 0.002, 1, 0.22, 45, 0.18, true);
    if (MASONRY.has(hit)) nburst(v, B.crackle, t + 0.01, 'bandpass', 1600, 0.7, 0.01, 0.6, 0.25, 1.3);
    else if (WOODY.has(hit)) nburst(v, B.crackle, t, 'highpass', 2500, 0.7, 0.003, 0.4, 0.12, 1.6);
  },

  chargeStick(pos: Vec3): void {
    if (!live()) return;
    const v = voice({ pos, level: 0.5, dur: 0.6, ref: 3, send: 0.15 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 170, t, 0.002, 0.9, 0.07, 85, 0.07);
    nburst(v, B.pink, t, 'bandpass', 320, 3, 0.002, 0.6, 0.07);
    nburst(v, B.white, t, 'bandpass', 900, 1, 0.001, 0.4, 0.03);
    for (const [dt, f] of [[0.14, 2400], [0.26, 3000]] as const) {
      const l = amp(v, t + dt, 0.002, 0.2, 0.02, 0.05);
      osc(v, 'square', f, t + dt, l.end).connect(filt(v, 'bandpass', f, 4)).connect(l.g);
    }
  },

  detonate(): void {
    if (!live()) return;
    const v = voice({ level: 0.5, dur: 0.4 });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', 3000, 0.7, 0.0005, 0.8, 0.008);
    nburst(v, B.white, t + 0.035, 'bandpass', 1800, 1.5, 0.0005, 0.6, 0.012);
    const l = amp(v, t + 0.05, 0.003, 0.2, 0.03, 0.07);
    const o = osc(v, 'square', 1900, t + 0.05, l.end);
    o.frequency.setValueAtTime(2500, t + 0.09);
    o.connect(filt(v, 'lowpass', 5000)).connect(l.g);
  },

  incoming(pos: Vec3): void {
    if (!live()) return;
    const hi = 80;
    const v = voice({ pos: [pos[0], pos[1] + hi, pos[2]], level: 0.55, dur: 1.4, ref: 25, send: 0.3, delay: false });
    if (!v) return;
    const t = v.t0;
    const T = 1.25;
    if (v.pan?.positionY) {
      v.pan.positionY.setValueAtTime(pos[1] + hi, t);
      v.pan.positionY.linearRampToValueAtTime(pos[1] + 3, t + T);
    }
    const l = amp(v, t, T * 0.85, 0.5, 0.08, T * 0.1);
    const o = osc(v, 'sine', 2300, t, l.end);
    o.frequency.exponentialRampToValueAtTime(620, t + T);
    osc(v, 'sine', 6.5, t, l.end).connect(gainNode(v, 22)).connect(o.frequency);
    o.connect(l.g);
    const b = nburst(v, B.white, t, 'bandpass', 2300, 14, T * 0.85, 0.8, 0.08, 1, T * 0.1);
    b.frequency.exponentialRampToValueAtTime(620, t + T);
  },

  footstep(surface: Surface): void {
    if (!live()) return;
    const now = ctx!.currentTime;
    if (now - lastStep < 0.09) return;
    lastStep = now;
    stepSide = -stepSide;
    const v = voice({ level: 0.22, dur: 0.45, pan: stepSide * 0.08 });
    if (!v) return;
    const t = v.t0;
    const k = rr(0.9, 1.1);
    switch (surface) {
      case 'dirt':
        nburst(v, B.pink, t, 'bandpass', 520 * k, 0.8, 0.004, 0.9, 0.09);
        nburst(v, B.crackle, t, 'highpass', 2600, 0.7, 0.002, 0.5, 0.06, 1.4);
        tone(v, 'sine', 90 * k, t, 0.003, 0.3, 0.05);
        return;
      case 'concrete':
        nburst(v, B.white, t, 'bandpass', 1900 * k, 1.1, 0.001, 0.55, 0.04);
        tone(v, 'sine', 115 * k, t, 0.002, 0.6, 0.05, 70, 0.05);
        return;
      case 'wood':
        strike(v, t, 'wood', 0.45);
        nburst(v, B.pink, t, 'bandpass', 700 * k, 0.9, 0.002, 0.3, 0.05);
        return;
      case 'metal':
        strike(v, t, 'metal', 0.3);
        tone(v, 'sine', 95 * k, t, 0.002, 0.3, 0.05);
        return;
    }
  },

  jump(): void {
    if (!live()) return;
    const v = voice({ level: 0.2, dur: 0.3 });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.pink, t, 'bandpass', 650, 0.9, 0.004, 0.6, 0.07);
    const b = nburst(v, B.white, t + 0.02, 'bandpass', 900, 1.2, 0.05, 0.25, 0.1);
    b.frequency.exponentialRampToValueAtTime(1800, t + 0.15);
  },

  /** boots coming down: the body's thump, and what it lands on (grit on soil, a slap on slab, a hollow knock on
      boards, a clang on plate) */
  land(strength: number, surface: Surface = 'dirt'): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.05) return;
    const v = voice({ level: 0.25 + 0.45 * s, dur: 0.5 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 95, t, 0.003, 0.9, 0.12 + 0.08 * s, 48, 0.12);
    switch (surface) {
      case 'dirt':
        nburst(v, B.pink, t, 'lowpass', 420, 0.7, 0.003, 0.7, 0.14);
        nburst(v, B.crackle, t, 'bandpass', 1800, 0.7, 0.002, 0.35 * s + 0.01, 0.08, 1.2);
        nburst(v, B.crackle, t + 0.03, 'highpass', 2600, 0.6, 0.004, 0.25 * s, 0.12, 1.4);
        return;
      case 'concrete':
        nburst(v, B.white, t, 'bandpass', 1500, 1, 0.001, 0.6, 0.05);
        nburst(v, B.pink, t, 'lowpass', 600, 0.7, 0.002, 0.45, 0.08);
        return;
      case 'wood':
        strike(v, t, 'wood', 0.5 + 0.4 * s);
        nburst(v, B.pink, t, 'bandpass', 380, 0.8, 0.002, 0.5, 0.12);
        return;
      case 'metal':
        strike(v, t, 'metal', 0.35 + 0.35 * s);
        nburst(v, B.pink, t, 'lowpass', 500, 0.7, 0.002, 0.4, 0.1);
        return;
    }
  },

  ui(kind: UiSound): void {
    if (!live()) return;
    const now = ctx!.currentTime;
    switch (kind) {
      case 'hover': {
        if (now - lastHover < 0.035) return;
        lastHover = now;
        const v = voice({ level: 1, dur: 0.05, ui: true });
        if (v) tone(v, 'sine', 2800, v.t0, 0.001, 0.035, 0.018);
        return;
      }
      case 'click': {
        const v = voice({ level: 1, dur: 0.1, ui: true });
        if (!v) return;
        const l = amp(v, v.t0, 0.001, 0.07, 0.025);
        osc(v, 'square', 1500, v.t0, l.end).connect(filt(v, 'lowpass', 3500)).connect(l.g);
        tone(v, 'sine', 190, v.t0, 0.002, 0.22, 0.05, 95, 0.05);
        return;
      }
      case 'win': {
        const v = voice({ level: 1, dur: 1.6, ui: true });
        if (!v) return;
        const notes = [392, 493.9, 587.3, 784];
        notes.forEach((f, i) => {
          const tt = v.t0 + i * 0.095;
          const last = i === notes.length - 1;
          const l = amp(v, tt, 0.008, 0.17, last ? 0.9 : 0.28, last ? 0.15 : 0);
          osc(v, 'sawtooth', f, tt, l.end).connect(filt(v, 'lowpass', 2600, 0.9)).connect(l.g);
          tone(v, 'triangle', f * 2, tt, 0.005, 0.06, 0.3);
        });
        tone(v, 'sine', 110, v.t0 + 0.28, 0.003, 0.4, 0.15, 55, 0.15);
        return;
      }
      case 'lose': {
        const v = voice({ level: 1, dur: 1.2, ui: true });
        if (!v) return;
        [293.7, 233.1].forEach((f, i) => {
          const tt = v.t0 + i * 0.24;
          const l = amp(v, tt, 0.01, 0.18, 0.5);
          osc(v, 'sawtooth', f, tt, l.end).connect(filt(v, 'lowpass', 900, 0.8)).connect(l.g);
        });
        tone(v, 'sine', 73, v.t0, 0.01, 0.25, 0.6);
        return;
      }
      case 'star': {
        starRun = { t: now, n: now - starRun.t < 1.2 ? starRun.n + 1 : 0 };
        const p = [1, 1.26, 1.5][Math.min(starRun.n, 2)];
        const v = voice({ level: 1, dur: 0.8, ui: true });
        if (!v) return;
        const t = v.t0;
        tone(v, 'sine', 150, t, 0.002, 0.7, 0.12, 60, 0.12, true);
        nburst(v, B.pink, t, 'bandpass', 1600, 0.8, 0.001, 0.45, 0.05);
        tone(v, 'sine', 1318 * p, t + 0.01, 0.002, 0.1, 0.55);
        tone(v, 'sine', 1318 * p * 2.76, t + 0.01, 0.002, 0.04, 0.25);
        return;
      }
      case 'target': {
        const v = voice({ level: 1, dur: 1, ui: true });
        if (!v) return;
        tone(v, 'sine', 988, v.t0, 0.004, 0.16, 0.5);
        tone(v, 'triangle', 494, v.t0, 0.004, 0.04, 0.4);
        tone(v, 'sine', 1318.5, v.t0 + 0.1, 0.004, 0.16, 0.7);
        tone(v, 'triangle', 659, v.t0 + 0.1, 0.004, 0.04, 0.5);
        return;
      }
      case 'deny': {
        const v = voice({ level: 1, dur: 0.3, ui: true });
        if (!v) return;
        for (const dt of [0, 0.11]) {
          const l = amp(v, v.t0 + dt, 0.004, 0.16, 0.03, 0.06);
          osc(v, 'square', 110, v.t0 + dt, l.end).connect(filt(v, 'lowpass', 700)).connect(l.g);
        }
        return;
      }
      case 'combo': {
        comboRun = { t: now, n: now - comboRun.t < 1.6 ? Math.min(comboRun.n + 1, 10) : 0 };
        const f = 520 * Math.pow(2, comboRun.n / 6);
        const v = voice({ level: 1, dur: 0.2, ui: true });
        if (!v) return;
        tone(v, 'sine', f, v.t0, 0.002, 0.12, 0.1);
        const l = amp(v, v.t0, 0.002, 0.03, 0.05);
        osc(v, 'square', f * 2, v.t0, l.end).connect(filt(v, 'lowpass', 3000)).connect(l.g);
        return;
      }
      case 'toast': {
        const v = voice({ level: 1, dur: 0.3, ui: true });
        if (!v) return;
        tone(v, 'sine', 1175, v.t0, 0.002, 0.06, 0.09);
        tone(v, 'sine', 1568, v.t0 + 0.06, 0.002, 0.06, 0.12);
        return;
      }
    }
  },

  thermite(pos: Vec3, intensity: number): void {
    if (!live()) return;
    const s = clamp(intensity, 0, 1);
    if (s < 0.01) return;
    feed(thermiteTex, pos, s);
    const now = ctx!.currentTime;
    if (rnd() > 0.25 * s || !allow('thermite', 6, 3, now)) return;
    const v = voice({ pos, level: 0.2 + 0.2 * s, dur: 0.2, ref: 4, hrtf: false });
    if (!v) return;
    nburst(v, B.white, v.t0, 'highpass', 4500, 0.7, 0.0005, 0.8, rr(0.01, 0.03));
    tone(v, 'sine', rr(3000, 6000), v.t0, 0.001, 0.1, 0.02);
  },

  cutter(pos: Vec3): void {
    if (!live()) return;
    if (!allow('cutter', 10, 4, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.8, dur: 1.2, ref: 8, send: 0.5 });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', 700, 0.7, 0.0003, 1, 0.022);
    tone(v, 'sine', 190, t, 0.001, 0.8, 0.09, 60, 0.08, true);
    // the copper jet shearing steel: a fast falling metallic rasp
    const l = amp(v, t + 0.004, 0.003, 0.45, 0.14);
    const bp = filt(v, 'bandpass', 2600, 3);
    bp.frequency.setValueAtTime(2600, t + 0.004);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 0.15);
    const o = osc(v, 'sawtooth', 900, t + 0.004, l.end);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.15);
    o.connect(bp).connect(l.g);
    strike(v, t + 0.01, 'steel', 0.55);
    nburst(v, B.white, t + 0.01, 'highpass', 5000, 0.6, 0.002, 0.35, 0.22);
  },

  wreckingHit(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.03) return;
    const now = ctx!.currentTime;
    feed(debrisTex, pos, 2 * s);
    if (now - lastWreck.t < 0.15 && s <= lastWreck.s * 1.2) return;
    lastWreck = { t: now, s };
    const v = voice({ pos, level: 0.5 + 0.5 * s, dur: 2.2, ref: 10, send: 0.5 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 70, t, 0.003, 1.1, 0.45 + 0.3 * s, 34, 0.3, true);
    const crunch = nburst(v, B.pink, t, 'bandpass', 700, 0.8, 0.004, 0.9, 0.5 + 0.4 * s);
    crunch.frequency.exponentialRampToValueAtTime(220, t + 0.6);
    nburst(v, B.crackle, t, 'bandpass', 1600, 0.7, 0.005, 0.6, 0.6 + 0.5 * s, 1.1);
    strike(v, t + 0.004, 'steel', 0.45 + 0.35 * s);
    nburst(v, B.crackle, t + 0.1, 'bandpass', 900, 0.7, 0.1, 0.4, 1.2, 0.6);
  },

  swing(pos: Vec3, speed: number): void {
    if (!live()) return;
    const c = ctx!;
    const now = c.currentTime;
    const sp = Math.max(0, speed);
    if (!swingLoop) {
      if (sp < 2) return;
      swingLoop = buildSwing(c);
    }
    const w = swingLoop;
    if (now - w.last < 0.03) return;
    w.last = now;
    // works for per-frame calls (follows the speed) and one-off calls (a single whoosh that decays)
    const k = clamp((sp - 2) / 14, 0, 1);
    setPos(w.p, pos[0], pos[1], pos[2]);
    steer(w.st, pos);
    w.bp.frequency.setTargetAtTime(160 + 380 * k, now, 0.05);
    w.whistle.gain.setTargetAtTime(0.25 * k * k, now, 0.05);
    const gp = w.g.gain;
    gp.cancelScheduledValues(now);
    gp.setTargetAtTime(0.6 * Math.pow(k, 1.4), now, 0.05);
    gp.setTargetAtTime(0, now + 0.25, 0.3);
  },

  cableCreak(pos: Vec3, tension: number): void {
    if (!live()) return;
    const s = clamp(tension, 0, 1);
    if (s < 0.05) return;
    if (!allow('cable', 1.2, 1, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.15 + 0.3 * s, dur: 1.2, ref: 6, send: 0.3, hrtf: false });
    if (!v) return;
    const t = v.t0;
    const d = rr(0.4, 0.9);
    const l = amp(v, t, 0.06, 0.6, d * 0.6, d * 0.3);
    const o = osc(v, 'sawtooth', rr(55, 95), t, l.end, false);
    o.frequency.setValueCurveAtTime(walk(o.frequency.value, 10, 0.9, 1.1, 35, 160), t, d);
    const am = gainNode(v, 0.5);
    noise(v, B.crackle, t, l.end, 0.2).connect(gainNode(v, 1.6)).connect(am.gain);
    o.connect(filt(v, 'bandpass', rr(500, 700), 15)).connect(am);
    o.connect(filt(v, 'bandpass', rr(1200, 1600), 18)).connect(gainNode(v, 0.6)).connect(am);
    am.connect(l.g);
    tone(v, 'sine', rr(900, 1300), t, 0.1, 0.05 * s + 0.01, d);
  },

  winch(on: boolean, load: number): void {
    if (!live()) return;
    const c = ctx!;
    const L = clamp(load, 0, 1);
    if (!winchLoop) {
      if (!on) return;
      winchLoop = buildWinch(c);
    }
    const w = winchLoop;
    if (on === w.on && Math.abs(L - w.load) < 0.03) return;
    const now = c.currentTime;
    const f = 150 - 55 * L;
    if (on) {
      if (!w.on) {
        clunk(0.4);
        w.motor.frequency.cancelScheduledValues(now);
        w.motor.frequency.setValueAtTime(40, now);
      }
      w.motor.frequency.setTargetAtTime(f, now, 0.12);
      w.whine.frequency.setTargetAtTime(f * 4, now, 0.12);
      w.g.gain.setTargetAtTime(0.28 + 0.2 * L, now, 0.06);
      w.grit.gain.setTargetAtTime(0.04 + 0.35 * L, now, 0.1);
    } else {
      w.motor.frequency.setTargetAtTime(f * 0.3, now, 0.25);
      w.whine.frequency.setTargetAtTime(f * 1.2, now, 0.25);
      w.g.gain.setTargetAtTime(0, now + 0.08, 0.15);
      clunk(0.25);
    }
    w.on = on;
    w.load = L;
  },

  gravGrab(): void {
    if (!live()) return;
    const v = voice({ level: 0.5, dur: 0.4 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 300, t, 0.004, 0.35, 0.15, 1500, 0.12);
    const l = amp(v, t, 0.003, 0.25, 0.12);
    osc(v, 'sawtooth', 110, t, l.end).connect(filt(v, 'bandpass', 900, 3)).connect(l.g);
    nburst(v, B.white, t, 'bandpass', 3000, 2, 0.001, 0.3, 0.06);
  },

  gravHold(on: boolean): void {
    if (!live()) return;
    const c = ctx!;
    if (!gravLoop) {
      if (!on) return;
      gravLoop = buildGrav(c);
    }
    if (on === gravLoop.on) return;
    gravLoop.on = on;
    gravLoop.g.gain.setTargetAtTime(on ? 0.32 : 0, c.currentTime, on ? 0.08 : 0.12);
  },

  gravThrow(): void {
    if (!live()) return;
    const v = voice({ level: 0.7, dur: 0.6, send: 0.2 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 160, t, 0.003, 1, 0.28, 45, 0.25, true);
    nburst(v, B.pink, t, 'lowpass', 900, 0.7, 0.004, 0.6, 0.2);
    tone(v, 'sine', 1500, t, 0.002, 0.25, 0.16, 180, 0.14);
  },

  firebomb(pos: Vec3): void {
    if (!live()) return;
    if (!allow('firebomb', 4, 2, ctx!.currentTime)) return;
    feed(fireTex, pos, 3);
    const v = voice({ pos, level: 0.7, dur: 2, ref: 8, send: 0.4 });
    if (!v) return;
    const t = v.t0;
    oneShot(v, pick(B.glass), t, rr(1.1, 1.3), 'highpass', 900, 0.707, 0.6);
    strike(v, t, 'glass', 0.8);
    // ignition: the fuel-air cloud catching all at once
    const whoomph = nburst(v, B.pink, t + 0.06, 'lowpass', 220, 0.9, 0.09, 1, 0.9, 1, 0.1);
    whoomph.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    whoomph.frequency.exponentialRampToValueAtTime(420, t + 1.1);
    tone(v, 'sine', 75, t + 0.06, 0.05, 0.7, 0.45, 40, 0.4, true);
    nburst(v, B.brown, t + 0.15, 'lowpass', 400, 0.7, 0.2, 0.5, 1.2);
  },

  /** thermobaric: the burster's crack as the fuel goes out, then the cloud going up: a long, deep, rolling push
      rather than a high explosive's sharp crack (the positive phase lasts several times longer) */
  thermobaric(pos: Vec3, size: number, delay: number): void {
    if (!live()) return;
    const s = clamp(size, 0.5, 4);
    const v = voice({ pos, level: 0.8 + 0.3 * s, dur: 4 + s, ref: 12 + 8 * s, send: 0.7 });
    const T = blast(pos, 2 * s * s * s, ctx!.currentTime + delay + 0.006 + distTo(pos) / SOUND_SPEED);
    groundShock(pos, 0.3 * s, 1 + 0.3 * s);
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', 1500, 0.7, 0.0005, 0.6, 0.03);
    tone(v, 'sine', 180, t, 0.002, 0.35, 0.08, 90, 0.08);
    const d = t + delay;
    nwave(v, d, T * 1.8, 1);
    const whump = nburst(v, B.pink, d, 'lowpass', 180, 0.8, 0.05, 1.2, 1.8 + 0.4 * s, 1, 0.3);
    whump.frequency.exponentialRampToValueAtTime(2400, d + 0.18);
    whump.frequency.exponentialRampToValueAtTime(140, d + 1.6);
    tone(v, 'sine', 48, d, 0.06, 1.3, 1.6 + 0.3 * s, 22, 1.2, true);
    nburst(v, B.brown, d + 0.05, 'lowpass', 260, 0.8, 0.25, 0.9, 2.6 + 0.6 * s);
    nburst(v, B.crackle, d + 0.3, 'bandpass', 900, 0.7, 0.4, 0.4, 2.2, 0.6);
    wallEchoes(pos, v.dist, 3, (dt, g) => nburst(v, B.brown, d + dt, 'lowpass', 300, 0.8, 0.05, 1.1 * g, 1.4));
  },

  /** a heavy round punching through a slab: a dull crump and the crash of what it knocks out */
  punch(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    const v = voice({ pos, level: 0.5 + 0.5 * s, dur: 1.2, ref: 8, send: 0.4 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 95, t, 0.002, 0.9, 0.25, 40, 0.2);
    nburst(v, B.crackle, t, 'bandpass', 1800, 0.7, 0.004, 0.8 * s + 0.2, 0.35);
    nburst(v, B.brown, t, 'lowpass', 400, 0.8, 0.01, 0.7, 0.6);
  },

  megabomb(pos: Vec3): void {
    if (!live()) return;
    const far = clamp((distTo(pos) - 80) / 600, 0, 1);
    const v = voice({ pos, level: 1.25, dur: 11, ref: 60, send: 0.9 });
    const T = blast(pos, 4000, ctx!.currentTime + 0.006 + distTo(pos) / SOUND_SPEED);
    groundShock(pos, 1, 5);
    if (!v) return;
    const t = v.t0;
    if (far < 0.9) nburst(v, B.white, t, 'highpass', 900, 0.7, 0.0003, 1 - far, 0.07);
    tone(v, 'sine', 70, t, 0.003, 1.4, 1.8, 20, 0.9, true);
    tone(v, 'sine', 42, t + 0.02, 0.05, 0.9, 3.2, 18, 3);
    const body = nburst(v, B.pink, t, 'lowpass', 9000 * (1 - 0.8 * far), 0.5, 0.004, 1.1, 3);
    body.frequency.exponentialRampToValueAtTime(110, t + 2.5);
    nburst(v, B.brown, t, 'bandpass', 300, 0.6, 0.03, 0.8, 2.5, 0.8);
    // rolling thunder: low roar surging under a very slowed crackle
    const roll = amp(v, t + 0.25, 0.6, 0.95, 6, 1.5);
    const am = gainNode(v, 0.55);
    noise(v, B.brown, t + 0.25, roll.end, 0.7).connect(filt(v, 'lowpass', 220, 0.8)).connect(am).connect(roll.g);
    noise(v, B.crackle, t + 0.25, roll.end, 0.05).connect(gainNode(v, 2.5)).connect(am.gain);
    nwave(v, t, T, 1.2);
    wallEchoes(pos, v.dist, 4, (dt, g) => {
      nwave(v, t + dt, T * 1.8, g);
      nburst(v, B.brown, t + dt, 'lowpass', 260, 0.8, 0.01, 1.4 * g, 1.5, 0.7);
    });
    // terrain and far facades: a rolling train of ever later, duller and longer returns
    let te = 0.35;
    for (let i = 0; i < 7; i++) {
      te += rr(0.35, 0.8) * (1 + 0.3 * i);
      const a = 0.6 * Math.pow(0.78, i);
      nwave(v, t + te, T * (2 + i), 0.6 * a);
      nburst(v, B.brown, t + te, 'lowpass', 220 - 20 * i, 0.8, 0.03 + 0.04 * i, a, 1.2 + 0.4 * i, 0.6);
    }
    nburst(v, B.crackle, t + 1.1, 'bandpass', 1500, 0.7, 1, 0.55, 3.5, 0.9, 2);
    nburst(v, B.crackle, t + 1.4, 'highpass', 3000, 0.7, 1.2, 0.3, 3, 1.3, 1.5);
    nburst(v, B.pink, t + 1.2, 'bandpass', 650, 0.7, 1, 0.25, 3, 1, 1.5);
  },

  quake(intensity: number): void {
    if (!live()) return;
    const k = clamp(intensity, 0, 1);
    if (!quakeLoop) {
      if (k <= 0) return;
      quakeLoop = buildQuake(ctx!);
    }
    setLevel(quakeLoop, k, 0.25 + 0.6 * k, 0.3, 0.8);
  },

  wind(strength: number): void {
    if (!live()) return;
    const k = clamp(strength, 0, 1);
    if (!windLoop) {
      if (k <= 0) return;
      windLoop = buildWind(ctx!);
    }
    setLevel(windLoop, k, 0.7 * Math.pow(k, 1.3), 0.6, 0.9);
  },

  /** a live cut cable sparking; call per arc every ~0.15-0.4 s */
  arc(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength || 0, 0, 1);
    if (s < 0.02) return;
    if (!allow('arc', 10, 4, ctx!.currentTime)) return;
    const d = rr(0.08, 0.2) * (0.6 + 0.6 * s);
    const v = voice({ pos, level: 0.22 + 0.45 * s, dur: d + 0.1, ref: 4 + 2 * s, send: 0.15, hrtf: s > 0.6 });
    if (!v) return;
    const t = v.t0;
    // mains rasp: a clipped ~100 Hz saw chopped on and off by crackle, the way a sputtering arc strikes and drops
    const l = amp(v, t, 0.002, 0.5, d * 0.5, d * 0.5);
    const am = gainNode(v, 0.3);
    noise(v, B.crackle, t, l.end, rr(1.5, 2.5)).connect(gainNode(v, 3)).connect(am.gain);
    osc(v, 'sawtooth', rr(98, 122), t, l.end).connect(shaper(v)).connect(filt(v, 'highpass', 400)).connect(am).connect(l.g);
    nburst(v, B.crackle, t, 'highpass', 3000, 0.7, 0.001, 0.8, d, rr(1.8, 2.6));
    const n = 2 + Math.floor(rnd() * 3 * (0.5 + s));
    for (let i = 0; i < n; i++) nburst(v, B.white, t + rr(0, d), 'highpass', rr(2500, 5000), 0.7, 0.0003, rr(0.4, 1), 0.004 + rnd() * 0.006);
  },

  /** transformer blowout */
  arcFlash(pos: Vec3): void {
    if (!live()) return;
    if (!allow('arcFlash', 2, 2, ctx!.currentTime)) return;
    const v = voice({ pos, level: 1, dur: 3.2, ref: 14, send: 0.55 });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', 1200, 0.7, 0.0004, 1, 0.04);
    tone(v, 'sine', 95, t, 0.003, 1.1, 0.5, 32, 0.3, true);
    const body = nburst(v, B.pink, t, 'lowpass', 6000, 0.6, 0.002, 0.9, 0.7);
    body.frequency.exponentialRampToValueAtTime(250, t + 0.6);
    const l = amp(v, t, 0.004, 0.55, 0.9, 0.15);
    const o = osc(v, 'sawtooth', 120, t, l.end);
    o.frequency.exponentialRampToValueAtTime(95, t + 1);
    o.connect(shaper(v)).connect(filt(v, 'bandpass', 1400, 0.8)).connect(l.g);
    nburst(v, B.crackle, t + 0.02, 'highpass', 2500, 0.7, 0.01, 0.8, 1.4, 2.2);
    nburst(v, B.crackle, t + 0.1, 'bandpass', 1200, 0.7, 0.05, 0.4, 1.6);
    for (let i = 0; i < 5; i++) nburst(v, B.white, t + rr(0.15, 1.2), 'highpass', rr(2500, 5000), 0.7, 0.0003, rr(0.3, 0.7), 0.006);
    // the core's hum sagging as the field collapses
    const hum = amp(v, t + 0.05, 0.02, 0.45, 2.2);
    const h = osc(v, 'sine', 100, t + 0.05, hum.end);
    h.frequency.exponentialRampToValueAtTime(38, t + 2.3);
    h.connect(hum.g);
    const h2 = osc(v, 'sawtooth', 100, t + 0.05, hum.end);
    h2.frequency.exponentialRampToValueAtTime(38, t + 2.3);
    h2.connect(filt(v, 'lowpass', 500)).connect(gainNode(v, 0.3)).connect(hum.g);
  },

  /** nearest energised transformer/generator, ~4x/s; level 0 fades out, and it fades by itself ~1.5 s after calls stop */
  mainsHum(pos: Vec3, level: number): void {
    if (!live()) return;
    const k = clamp(level || 0, 0, 1);
    if (!humLoop) {
      if (k <= 0) return;
      humLoop = buildHum(ctx!);
    }
    if (drive(humLoop, pos, k, 0.3 * k, 0.25, 0.6)) humLoop.buzz.gain.setTargetAtTime(0.02 + 0.08 * k, ctx!.currentTime, 0.2);
  },

  /** HV corona at the nearest energised bushing, ~2x/s: a hiss and a 100 Hz buzz rising with humidity and rain */
  corona(pos: Vec3, level: number): void {
    if (!live()) return;
    const k = clamp(level || 0, 0, 1);
    if (!coronaLoop) {
      if (k <= 0) return;
      coronaLoop = buildCorona(ctx!);
    }
    drive(coronaLoop, pos, k, 0.25 * k, 0.4, 0.8);
  },

  /** a wet surface tracking: dry-band scintillation, a dry crackle and fizz */
  crackle(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength || 0, 0, 1);
    if (!allow('crackle', 8, 3, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.12 + 0.3 * s, dur: 0.3, ref: 3, send: 0.1 });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.crackle, t, 'highpass', 2500, 0.7, 0.002, 0.7, 0.12 + 0.12 * s, rr(1.5, 2.5));
    for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) nburst(v, B.white, t + rr(0, 0.2), 'bandpass', rr(3000, 6000), 1.5, 0.0003, rr(0.3, 0.8), 0.003);
    tone(v, 'sawtooth', rr(98, 102), t, 0.005, 0.15 * s, 0.15);
  },

  /** lightning: the channel's crack close by, then the long roll; the arrival is delayed by the distance (voice) */
  thunder(pos: Vec3, strength: number): void {
    if (!live()) return;
    const s = clamp(strength || 0, 0.2, 2), d = distTo(pos), far = clamp((d - 60) / 1500, 0, 1);
    const v = voice({ pos, level: 1.1 * (0.6 + 0.4 * Math.min(s, 1)), dur: 12, ref: 120, send: 0.85 });
    if (!v) return;
    const t = v.t0;
    if (far < 0.8) {
      // the rip of the nearest part of the channel, then the report
      nburst(v, B.crackle, t, 'highpass', 1800, 0.7, 0.002, 0.9 * (1 - far), 0.35, 2.2);
      nburst(v, B.white, t + 0.02, 'highpass', 700, 0.7, 0.0005, 1.1 * (1 - far), 0.09);
      tone(v, 'sine', 55, t + 0.02, 0.004, 1.1 * (1 - far), 0.9, 25, 0.9, true);
    }
    // the roll: every part of a kilometre-long channel arriving in turn, echoed off the terrain
    const roll = amp(v, t + 0.15, 0.4 + 0.8 * far, 0.9, 6 + 3 * far, 1.2);
    const am = gainNode(v, 0.5);
    noise(v, B.brown, t + 0.15, roll.end, 0.6).connect(filt(v, 'lowpass', 260 - 120 * far, 0.8)).connect(am).connect(roll.g);
    noise(v, B.crackle, t + 0.15, roll.end, 0.04).connect(gainNode(v, 2.2)).connect(am.gain);
    let te = 0.3;
    for (let i = 0; i < 6; i++) {
      te += rr(0.4, 1.1) * (1 + 0.25 * i);
      nburst(v, B.brown, t + te, 'lowpass', 200 - 18 * i, 0.8, 0.05 + 0.05 * i, 0.55 * Math.pow(0.8, i), 1.3 + 0.4 * i, 0.6);
    }
    nburst(v, B.pink, t + 0.5, 'bandpass', 500, 0.7, 0.8, 0.2 * (1 - far), 3, 1, 1);
  },

  /** nearest running machine, ~4x/s; |speed| in rad/s (hinge) or m/s (slider), 0 = off */
  motor(pos: Vec3, speed: number): void {
    if (!live()) return;
    const sp = Math.abs(speed || 0);
    const k = sp > 0.01 ? 1 - Math.exp(-sp / 4) : 0;
    if (!motorLoop) {
      if (k <= 0) return;
      motorLoop = buildMotor(ctx!);
    }
    const m = motorLoop;
    if (!drive(m, pos, k, 0.1 + 0.22 * k, 0.15, 0.35)) return;
    const now = ctx!.currentTime;
    if (k <= 0) {
      m.rotor.frequency.setTargetAtTime(15, now, 0.3);
      m.whine.frequency.setTargetAtTime(105, now, 0.3);
      return;
    }
    const f = 22 + 90 * k;
    m.rotor.frequency.setTargetAtTime(f, now, 0.25);
    m.whine.frequency.setTargetAtTime(f * 7, now, 0.25);
    m.lp.frequency.setTargetAtTime(300 + 900 * k, now, 0.25);
    m.chuff.frequency.setTargetAtTime(clamp(sp * 0.5, 0.5, 18), now, 0.25);
  },

  /** burning gas jet, ~4x/s per jet (shared bed) */
  gasJet(pos: Vec3, size: number): void {
    if (!live()) return;
    const s = clamp(size || 0, 0, 3);
    if (s >= 0.02) feed(gasTex, pos, s);
  },

  waterSpray(pos: Vec3, size: number): void {
    if (!live()) return;
    const s = clamp(size || 0, 0, 3);
    if (s >= 0.02) feed(waterTex, pos, s);
  },

  steamJet(pos: Vec3, size: number): void {
    if (!live()) return;
    const s = clamp(size || 0, 0, 3);
    if (s >= 0.02) feed(steamTex, pos, s);
  },

  /** a building's grid goes dark */
  powerDown(pos: Vec3): void {
    if (!live()) return;
    if (!allow('powerDown', 3, 2, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.6, dur: 2.4, ref: 8, send: 0.35 });
    if (!v) return;
    const t = v.t0;
    // contactor dropping out: armature clack, a bounce, the contacts' last spit
    tone(v, 'sine', 130, t, 0.002, 0.8, 0.07, 70, 0.06);
    nburst(v, B.white, t, 'bandpass', 1700, 1.2, 0.0005, 0.7, 0.015);
    strike(v, t + 0.003, 'machine', 0.35);
    nburst(v, B.white, t + 0.045, 'bandpass', 2200, 1.4, 0.0005, 0.3, 0.01);
    nburst(v, B.crackle, t, 'highpass', 3500, 0.7, 0.001, 0.35, 0.06, 2);
    const f = rr(96, 104);
    const l = amp(v, t + 0.01, 0.01, 0.4, 1.8);
    const o = osc(v, 'sawtooth', f, t + 0.01, l.end);
    o.frequency.exponentialRampToValueAtTime(f * 0.25, t + 1.8);
    const lp = filt(v, 'lowpass', 900, 1.2);
    lp.frequency.setValueAtTime(900, t + 0.01);
    lp.frequency.exponentialRampToValueAtTime(150, t + 1.8);
    o.connect(lp).connect(l.g);
    tone(v, 'sine', f, t + 0.01, 0.01, 0.35, 1.6, f * 0.3, 1.6);
  },

  /** steam explosion */
  boilerBlast(pos: Vec3): void {
    if (!live()) return;
    if (!allow('boiler', 2, 2, ctx!.currentTime)) return;
    feed(debrisTex, pos, 4);
    const v = voice({ pos, level: 1.05, dur: 4.5, ref: 16, send: 0.6 });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.white, t, 'highpass', 1000, 0.7, 0.0004, 1, 0.05);
    tone(v, 'sine', 80, t, 0.003, 1.2, 0.7, 28, 0.35, true);
    const body = nburst(v, B.pink, t, 'lowpass', 5000, 0.6, 0.003, 0.9, 0.8);
    body.frequency.exponentialRampToValueAtTime(200, t + 0.8);
    strike(v, t + 0.004, 'machine', 1);
    strike(v, t + 0.012, 'steel', 0.7);
    const tl = amp(v, t, 0.01, 0.3, 0.45);
    const tb = filt(v, 'bandpass', 1200, 4);
    tb.frequency.setValueAtTime(1200, t);
    tb.frequency.exponentialRampToValueAtTime(2800, t + 0.4);
    const to = osc(v, 'sawtooth', 150, t, tl.end);
    to.frequency.exponentialRampToValueAtTime(95, t + 0.45);
    to.connect(tb).connect(tl.g);
    // flashing steam thins from a roar to a hiss as the pressure falls
    const roar = nburst(v, B.pink, t + 0.03, 'bandpass', 700, 0.5, 0.05, 0.9, 2.8, 1, 0.5);
    roar.frequency.exponentialRampToValueAtTime(2400, t + 3);
    nburst(v, B.white, t + 0.05, 'highpass', 3000, 0.6, 0.08, 0.7, 3.2, 1, 0.4);
    const w = nburst(v, B.white, t + 0.1, 'bandpass', 1500, 18, 0.3, 0.6, 2.5, 1, 0.3);
    w.frequency.exponentialRampToValueAtTime(2600, t + 3);
    nburst(v, B.crackle, t + 0.15, 'bandpass', 900, 0.7, 0.2, 0.35, 2, 0.6);
  },

  /** a rigging line parting under tension */
  ropeSnap(pos: Vec3, kind: 'rope' | 'wire' | 'chain'): void {
    if (!live()) return;
    if (!allow('ropeSnap', 8, 4, ctx!.currentTime)) return;
    const v = voice({ pos, level: kind === 'rope' ? 0.5 : 0.6, dur: 1, ref: 6, send: 0.3 });
    if (!v) return;
    const t = v.t0;
    switch (kind) {
      case 'rope': {
        // strands let go one after another before the whole line does
        for (let i = 0; i < 4; i++) nburst(v, B.white, t + i * rr(0.006, 0.014), 'bandpass', rr(1200, 2200), 1.2, 0.0005, rr(0.3, 0.6), 0.01);
        nburst(v, B.white, t + 0.05, 'highpass', 1500, 0.7, 0.0005, 1, 0.025);
        tone(v, 'sine', 150, t + 0.05, 0.002, 0.5, 0.1, 70, 0.1);
        const whip = nburst(v, B.pink, t + 0.06, 'bandpass', 1800, 2, 0.005, 0.45, 0.2);
        whip.frequency.exponentialRampToValueAtTime(400, t + 0.26);
        return;
      }
      case 'wire': {
        nburst(v, B.white, t, 'highpass', 3000, 0.7, 0.0003, 0.9, 0.012);
        const l = amp(v, t, 0.002, 0.35, 0.35);
        const bp = filt(v, 'bandpass', 4000, 4);
        bp.frequency.setValueAtTime(4000, t);
        bp.frequency.exponentialRampToValueAtTime(900, t + 0.35);
        const o = osc(v, 'sawtooth', 4200, t, l.end);
        o.frequency.exponentialRampToValueAtTime(500, t + 0.35);
        o.connect(bp).connect(l.g);
        const f = rr(1800, 2600);
        tone(v, 'sine', f, t, 0.001, 0.25, 0.5, f * 0.9, 0.3);
        tone(v, 'sine', f * 2.76, t, 0.001, 0.12, 0.25);
        return;
      }
      case 'chain': {
        nburst(v, B.white, t, 'highpass', 2000, 0.7, 0.0004, 0.9, 0.02);
        tone(v, 'sine', 120, t, 0.002, 0.4, 0.1, 70, 0.1);
        strike(v, t, 'steel', 0.6);
        const n = 5 + Math.floor(rnd() * 4);
        let tt = t + 0.03;
        for (let i = 0; i < n; i++) {
          tt += rr(0.02, 0.07);
          const f = rr(2200, 4200);
          tone(v, 'sine', f, tt, 0.001, rr(0.1, 0.25) * (1 - i / (n + 1)), 0.05);
          nburst(v, B.white, tt, 'bandpass', f * 0.8, 1.5, 0.0004, 0.2, 0.008);
        }
        return;
      }
    }
  },

  spawnPlace(): void {
    if (!live()) return;
    const v = voice({ level: 0.6, dur: 0.6, send: 0.2 });
    if (!v) return;
    const t = v.t0;
    tone(v, 'sine', 120, t, 0.002, 1, 0.2, 55, 0.18, true);
    nburst(v, B.pink, t, 'lowpass', 500, 0.7, 0.002, 0.7, 0.14);
    strike(v, t + 0.005, 'steel', 0.3);
    nburst(v, B.white, t + 0.09, 'bandpass', 2600, 2, 0.0005, 0.3, 0.012);
  },

  setAmbience(env: EnvPreset | null): void {
    wantEnv = env;
    applyAmbience();
  },

  setMuffle(amount: number): void {
    if (!ctx) return;
    // treated as an impulse that decays on its own; per-frame callers with a falling value are ignored
    muffleAt(amount, ctx.currentTime);
  },

  setPaused(p: boolean): void {
    paused = p;
    if (!ctx) return;
    const now = ctx.currentTime;
    world.gain.setTargetAtTime(p ? 0.2 : 1, now, 0.07);
    pauseLP.frequency.setTargetAtTime(p ? 800 : 20000, now, 0.07);
  },

  /** unlit gas escaping: the vent hiss without a flame's roar, ~4x/s per leak (shared bed) */
  gasHiss(pos: Vec3, size: number): void {
    if (!live()) return;
    const s = clamp((size || 0) * 0.6, 0, 2);
    if (s >= 0.02) feed(steamTex, pos, s);
  },

  /** woven fabric ripping: a run of fibre snaps under a rising tearing hiss; netting twangs, tarp crackles */
  fabricTear(pos: Vec3, strength: number, fabric = 'cotton'): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.02 || !allow('tear', 6, 3, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.25 + 0.4 * s, dur: 0.9, ref: 4, send: 0.15, hrtf: false });
    if (!v) return;
    const t = v.t0, d = 0.12 + 0.35 * s * rnd();
    const coated = fabric === 'tarp' || fabric === 'poly';
    const rip = nburst(v, coated ? B.crackle : B.white, t, 'bandpass', coated ? 1800 : 1100, 1.4, 0.004, 0.8, d, coated ? 1.2 : 1);
    rip.frequency.exponentialRampToValueAtTime(coated ? 4200 : 3000, t + d);
    const n = 3 + Math.floor(rnd() * 5 * (0.5 + s));
    for (let i = 0; i < n; i++) nburst(v, B.white, t + rr(0, d), 'highpass', rr(2500, 5000), 0.8, 0.0004, rr(0.2, 0.5), 0.006);
    if (fabric === 'mesh') tone(v, 'triangle', rr(300, 520), t, 0.002, 0.25 * s, 0.25, 180, 0.25);
  },

  /** a sheet cracking taut in a gust (awnings, flags, scaffold wrap) */
  flap(pos: Vec3, strength: number, fabric = 'canvas'): void {
    if (!live()) return;
    const s = clamp(strength, 0, 1);
    if (s < 0.08 || !allow('flap', 4, 2, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.12 + 0.35 * s, dur: 0.5, ref: 5, send: 0.2, hrtf: false });
    if (!v) return;
    const t = v.t0, heavy = fabric === 'tarp' || fabric === 'canvas';
    const k = 1 + Math.floor(rnd() * 3);
    let tt = t;
    for (let i = 0; i < k; i++) {
      nburst(v, B.pink, tt, 'lowpass', heavy ? 700 : 1400, 0.9, 0.003, (0.6 + 0.4 * rnd()) * (1 - i * 0.25), rr(0.03, 0.07));
      nburst(v, B.white, tt, 'bandpass', heavy ? 1600 : 3000, 1, 0.001, 0.25, 0.02);
      tt += rr(0.07, 0.16);
    }
  },

  /** loose grain pouring or sliding (~2×/s while a pile runs) */
  sandHiss(pos: Vec3, amount: number): void {
    if (!live()) return;
    const s = clamp(amount, 0, 1);
    if (s < 0.03 || !allow('sand', 3, 2, ctx!.currentTime)) return;
    const v = voice({ pos, level: 0.1 + 0.3 * s, dur: 0.8, ref: 5, send: 0.1, hrtf: false });
    if (!v) return;
    const t = v.t0;
    nburst(v, B.pink, t, 'bandpass', rr(2200, 3200), 0.6, 0.08, 0.7, 0.55, 1, 0.1);
    nburst(v, B.crackle, t, 'highpass', 4000, 0.7, 0.05, 0.35 * s, 0.5, 1.3);
  },

  /** held cutting tool (~20×/s while in use, level 0 to stop): motor pitch sags with load 0..1, grit and
      scream rise with it; `kind` is the tool ('grinder' | 'saw' | 'drill' | 'shears' | 'plasma' | 'torch') */
  powerTool(kind: string, pos: Vec3, level: number, load: number): void {
    if (!live()) return;
    const k = kind === 'off' ? 0 : clamp(level || 0, 0, 1);
    if (!toolLoop) {
      if (k <= 0) return;
      toolLoop = buildTool(ctx!);
    }
    const l = toolLoop, L = clamp(load || 0, 0, 1);
    const moved = drive(l, pos, k, 0.3, 0.04, 0.18);
    if (!moved && kind === l.kind && Math.abs(L - l.load) < 0.03) return;
    l.kind = kind;
    l.load = L;
    if (k <= 0) { l.beat.gain.setTargetAtTime(0, ctx!.currentTime, 0.05); return; }
    const pr = TOOL_VOICE[kind] ?? TOOL_VOICE.grinder;
    // motors slow as the cut drags on them; a bound or stalled tool drops right off
    const rpm = 1 - 0.3 * L - (L > 0.98 ? 0.35 : 0);
    const now = ctx!.currentTime, tc = 0.08;
    l.motor.frequency.setTargetAtTime(pr.motor * rpm, now, tc);
    l.whine.frequency.setTargetAtTime(pr.whine * rpm, now, tc);
    l.lp.frequency.setTargetAtTime(pr.lp * (0.6 + 0.4 * rpm), now, tc);
    l.gm.gain.setTargetAtTime(pr.body, now, tc);
    l.gw.gain.setTargetAtTime(pr.whineLvl * (0.5 + 0.5 * rpm), now, tc);
    l.grit.gain.setTargetAtTime(pr.grit * L, now, tc);
    l.gritF.frequency.setTargetAtTime(pr.gritF, now, tc);
    l.hiss.gain.setTargetAtTime(pr.hiss * (0.4 + 0.6 * L), now, tc);
    l.roar.gain.setTargetAtTime(pr.roar * (0.5 + 0.5 * L), now, tc);
    l.beat.gain.setTargetAtTime(kind === 'drill' ? 0.25 * L : 0, now, tc);
  },

  /** a site machine's running loop, one per `kind` so several can run at once (breaker, water cannon pump, wire
      saw, excavator engine, splitter pump): same voice model as powerTool; level 0 stops it */
  rig(kind: string, pos: Vec3, level: number, load: number): void {
    if (!live()) return;
    const k = clamp(level || 0, 0, 1);
    let l = rigLoops.get(kind);
    if (!l) {
      if (k <= 0) return;
      l = buildTool(ctx!);
      rigLoops.set(kind, l);
    }
    const L = clamp(load || 0, 0, 1);
    const moved = drive(l, pos, k, 0.3, 0.04, 0.18);
    if (!moved && kind === l.kind && Math.abs(L - l.load) < 0.03) return;
    l.kind = kind;
    l.load = L;
    const now = ctx!.currentTime, tc = 0.08;
    if (k <= 0) { l.beat.gain.setTargetAtTime(0, now, 0.05); return; }
    const pr = TOOL_VOICE[kind] ?? TOOL_VOICE.grinder;
    const rpm = 1 - 0.25 * L;
    l.motor.frequency.setTargetAtTime(pr.motor * rpm, now, tc);
    l.whine.frequency.setTargetAtTime(pr.whine * rpm, now, tc);
    l.lp.frequency.setTargetAtTime(pr.lp * (0.6 + 0.4 * rpm), now, tc);
    l.gm.gain.setTargetAtTime(pr.body, now, tc);
    l.gw.gain.setTargetAtTime(pr.whineLvl * (0.5 + 0.5 * rpm), now, tc);
    l.grit.gain.setTargetAtTime(pr.grit * L, now, tc);
    l.gritF.frequency.setTargetAtTime(pr.gritF, now, tc);
    l.hiss.gain.setTargetAtTime(pr.hiss * (0.4 + 0.6 * L), now, tc);
    l.roar.gain.setTargetAtTime(pr.roar * (0.5 + 0.5 * L), now, tc);
    l.beat.gain.setTargetAtTime(kind === 'breaker' ? 0.45 * L : kind === 'excavator' ? 0.1 : 0, now, tc);
  },

  /** one-shots for the held tools: 'bind' | 'through' | 'stall' | 'shear' | 'crush' | 'ignite' | 'swap' | 'split' | 'dump' */
  /** services and machinery: 'alarm' fire-alarm sounder burst, 'bell' sprinkler water-motor gong, 'valve' a handwheel run
      home, 'breaker' a breaker thrown, 'crank' a standby engine cranking, 'genstart' it catching, 'hose' a hydraulic hose
      bursting, 'burnout' a motor winding burning out */
  utility(kind: string, pos: Vec3): void {
    if (!live() || !allow('util:' + kind, 3, 2, ctx!.currentTime)) return;
    const loud = kind === 'alarm' || kind === 'bell';
    const v = voice({ pos, level: loud ? 0.7 : 0.6, dur: kind === 'crank' ? 2.2 : 1.1, ref: loud ? 14 : 5, send: 0.3 });
    if (!v) return;
    const t = v.t0;
    switch (kind) {
      case 'alarm':
        // BS 5839 sounder: alternating 800 / 970 Hz tones
        for (let k = 0; k < 4; k++) tone(v, 'square', k % 2 ? 800 : 970, t + k * 0.25, 0.005, 0.22, 0.24);
        break;
      case 'bell':
        for (let k = 0; k < 4; k++) {
          const tk = t + k * 0.22;
          tone(v, 'sine', 1180, tk, 0.001, 0.5, 0.6);
          tone(v, 'sine', 1180 * 2.76, tk, 0.001, 0.2, 0.25);
          strike(v, tk, 'steel', 0.25);
        }
        break;
      case 'valve':
        nburst(v, B.white, t, 'bandpass', 2800, 6, 0.05, 0.25, 0.35);
        strike(v, t + 0.4, 'castiron', 0.6);
        break;
      case 'breaker':
        tone(v, 'sine', 150, t, 0.002, 0.7, 0.06, 80, 0.05);
        nburst(v, B.white, t, 'bandpass', 1900, 1.2, 0.0005, 0.7, 0.02);
        strike(v, t + 0.004, 'machine', 0.3);
        break;
      case 'crank':
        for (let k = 0; k < 6; k++) tone(v, 'sawtooth', 70 + 8 * k, t + k * 0.3, 0.02, 0.35, 0.26, 50, 0.2);
        break;
      case 'genstart':
        tone(v, 'sawtooth', 45, t, 0.05, 0.6, 1.0, 90, 0.8, true);
        nburst(v, B.brown, t, 'lowpass', 220, 0.8, 0.02, 0.6, 0.9);
        break;
      case 'hose':
        strike(v, t, 'steel', 0.8);
        nburst(v, B.white, t, 'highpass', 3000, 0.7, 0.002, 0.9, 1.0);
        break;
      case 'burnout':
        tone(v, 'sawtooth', 100, t, 0.01, 0.5, 0.9, 40, 0.8, true);
        nburst(v, B.crackle, t, 'highpass', 3500, 0.7, 0.01, 0.5, 0.8);
        break;
    }
  },

  toolEvent(kind: string, pos: Vec3): void {
    if (!live() || !allow('tool:' + kind, 4, 2, ctx!.currentTime)) return;
    const v = voice({ pos, level: kind === 'swap' ? 0.25 : 0.6, dur: 1.2, ref: 3, send: 0.15 });
    if (!v) return;
    const t = v.t0;
    switch (kind) {
      case 'bind':
        tone(v, 'sawtooth', 180, t, 0.002, 0.5, 0.25, 60, 0.2, true);
        nburst(v, B.white, t, 'bandpass', 3200, 3, 0.002, 0.5, 0.18);
        strike(v, t, 'steel', 0.4);
        break;
      case 'through':
        strike(v, t, 'steel', 0.5);
        nburst(v, B.pink, t, 'lowpass', 900, 0.8, 0.003, 0.4, 0.2);
        break;
      case 'stall': {
        const l = amp(v, t, 0.05, 0.35, 0.9, 0.4);
        osc(v, 'square', 2300, t, l.end).connect(filt(v, 'bandpass', 2300, 8)).connect(l.g);
        nburst(v, B.white, t, 'highpass', 5000, 0.7, 0.05, 0.25, 0.9, 1, 0.3);
        break;
      }
      case 'shear':
        strike(v, t, 'steel', 0.9);
        nburst(v, B.white, t, 'bandpass', 2600, 1.2, 0.001, 0.9, 0.08);
        tone(v, 'sine', 70, t, 0.002, 0.8, 0.3, 40, 0.25);
        break;
      case 'crush':
        nburst(v, B.crackle, t, 'lowpass', 2400, 0.7, 0.004, 0.9, 0.5, 0.8);
        nburst(v, B.brown, t, 'lowpass', 300, 0.7, 0.003, 0.9, 0.35);
        break;
      case 'ignite':
        nburst(v, B.pink, t, 'bandpass', 900, 0.8, 0.01, 0.6, 0.25);
        nburst(v, B.white, t + 0.05, 'highpass', 3000, 0.7, 0.05, 0.3, 0.6, 1, 0.2);
        break;
      case 'swap':
        nburst(v, B.white, t, 'bandpass', 3500, 2, 0.001, 0.5, 0.02);
        nburst(v, B.white, t + 0.35, 'bandpass', 2600, 2, 0.001, 0.4, 0.02);
        break;
      case 'split':
        // a block letting go in tension: a sharp crack, then grinding as the halves settle
        nburst(v, B.white, t, 'highpass', 1800, 0.7, 0.0005, 1, 0.03);
        nburst(v, B.crackle, t + 0.01, 'bandpass', 1200, 0.7, 0.01, 0.8, 0.5, 1.2);
        tone(v, 'sine', 80, t, 0.002, 0.7, 0.2, 40, 0.2);
        nburst(v, B.brown, t + 0.1, 'lowpass', 400, 0.7, 0.05, 0.5, 0.6);
        break;
      case 'dump':
        nburst(v, B.crackle, t, 'lowpass', 1400, 0.7, 0.08, 0.7, 1.1, 0.7);
        nburst(v, B.brown, t, 'lowpass', 250, 0.7, 0.1, 0.8, 0.9);
        break;
    }
  },
};

interface ToolVoice { motor: number; whine: number; lp: number; body: number; whineLvl: number; grit: number; gritF: number; hiss: number; roar: number }
/* Rough source spectra: universal motor + gear whine (grinder, drill), two-stroke firing rate (saw),
   hydraulic pump whine (jaws), arc buzz + gas hiss (plasma), flame roar + oxygen hiss (torch). */
const TOOL_VOICE: Record<string, ToolVoice> = {
  grinder: { motor: 110, whine: 1650, lp: 2400, body: 0.35, whineLvl: 0.16, grit: 0.55, gritF: 3800, hiss: 0.05, roar: 0 },
  saw: { motor: 190, whine: 760, lp: 1600, body: 0.6, whineLvl: 0.05, grit: 0.35, gritF: 2200, hiss: 0.03, roar: 0.08 },
  drill: { motor: 150, whine: 900, lp: 1400, body: 0.35, whineLvl: 0.1, grit: 0.3, gritF: 1800, hiss: 0.02, roar: 0 },
  shears: { motor: 95, whine: 420, lp: 900, body: 0.4, whineLvl: 0.12, grit: 0.15, gritF: 900, hiss: 0.04, roar: 0.05 },
  plasma: { motor: 180, whine: 360, lp: 3000, body: 0.18, whineLvl: 0.06, grit: 0.25, gritF: 5000, hiss: 0.45, roar: 0.1 },
  torch: { motor: 40, whine: 200, lp: 400, body: 0.02, whineLvl: 0, grit: 0.15, gritF: 3000, hiss: 0.3, roar: 0.55 },
  // hydraulic breaker: 25 Hz blows (the beat), power-pack drone and a steel-on-rock rattle
  breaker: { motor: 75, whine: 520, lp: 1600, body: 0.45, whineLvl: 0.05, grit: 0.7, gritF: 2600, hiss: 0.05, roar: 0.1 },
  // fire pump and the jet: diesel drone, a hard broadband hiss at the tip
  hose: { motor: 60, whine: 300, lp: 700, body: 0.25, whineLvl: 0.02, grit: 0.1, gritF: 1500, hiss: 0.6, roar: 0.35 },
  // wire saw: flywheel whine, beads rasping through the kerf, slurry hiss
  wiresaw: { motor: 140, whine: 1300, lp: 2200, body: 0.3, whineLvl: 0.14, grit: 0.45, gritF: 3200, hiss: 0.2, roar: 0 },
  // excavator: six-cylinder diesel and the hydraulic pump whine rising under load
  excavator: { motor: 38, whine: 480, lp: 500, body: 0.7, whineLvl: 0.08, grit: 0.05, gritF: 700, hiss: 0.02, roar: 0.25 },
  splitter: { motor: 90, whine: 640, lp: 900, body: 0.35, whineLvl: 0.14, grit: 0.05, gritF: 900, hiss: 0.04, roar: 0.05 },
  // flamethrower: the fuel rushing out of the nozzle under 26 bar of air, and the rope of flame's low roar
  flamer: { motor: 32, whine: 160, lp: 320, body: 0.06, whineLvl: 0, grit: 0.3, gritF: 1500, hiss: 0.5, roar: 0.95 },
};
const rigLoops = new Map<string, ToolLoop>();

interface ToolLoop extends PosLoop {
  kind: string;
  load: number;
  motor: OscillatorNode;
  whine: OscillatorNode;
  lp: BiquadFilterNode;
  gm: GainNode;
  gw: GainNode;
  grit: GainNode;
  gritF: BiquadFilterNode;
  hiss: GainNode;
  roar: GainNode;
  beat: GainNode;
}
let toolLoop: ToolLoop | null = null;

function buildTool(c: AudioContext): ToolLoop {
  const l = posLoop(c, 3);
  const motor = loopOsc(c, 'sawtooth', 110);
  const lp = c.createBiquadFilter();
  lp.frequency.value = 2000;
  lp.Q.value = 1.2;
  const gm = c.createGain();
  gm.gain.value = 0.3;
  motor.connect(lp).connect(gm).connect(l.g);
  const whine = loopOsc(c, 'square', 1650);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 4;
  const gw = c.createGain();
  gw.gain.value = 0.1;
  whine.connect(bp).connect(gw).connect(l.g);
  const gritF = c.createBiquadFilter();
  gritF.type = 'bandpass';
  gritF.frequency.value = 3800;
  gritF.Q.value = 0.8;
  const grit = c.createGain();
  grit.gain.value = 0;
  loopSrc(B.crackle, 1.4).connect(gritF).connect(grit).connect(l.g);
  const hiss = layer(c, l.g, B.white, 'highpass', 3500, 0.7, 0);
  const roar = layer(c, l.g, B.brown, 'lowpass', 500, 0.7, 0);
  // hammer-drill blows: ~45 Hz amplitude beat on the whole voice
  const beat = c.createGain();
  beat.gain.value = 0;
  const bo = loopOsc(c, 'square', 45);
  bo.connect(beat).connect(l.g.gain);
  return { ...l, kind: '', load: -1, motor, whine, lp, gm, gw, grit, gritF, hiss, roar, beat };
}
