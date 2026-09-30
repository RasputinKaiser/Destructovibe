/* Points come from demolished volume × material value. Demolition events that land inside the
   combo window of each other build a multiplier (up to ×4); the window refills on every event. */

const COMBO_WINDOW = 3.2;
const COMBO_STEP = 0.1;
const COMBO_MAX = 4;
const POP_WINDOW = 0.45;
const CHAIN_GAP = 0.3;           // a collapse is one long event, not a link per fragment

export const score = {
  points: 0,
  penalty: 0,
  chain: 0,
  comboTimer: 0,
  elapsed: 0,
  bestChain: 0,
  explosives: 0,
};

let popAcc = 0;
let lastLink = -99;
let popTimer = -1;
let popLabel = '';
export let onPop: (points: number, label: string) => void = () => {};
export let onPenalty: (points: number) => void = () => {};

export function setScoreHooks(pop: typeof onPop, penalty: typeof onPenalty): void {
  onPop = pop;
  onPenalty = penalty;
}

export function resetScore(): void {
  pendingRaw = unbooked = 0;
  for (const a of book.values()) { a.hurt = 0; a.fine = 0; a.incident = 0; a.lastAt = -1e9; a.incidentFine = 0; }
  score.points = 0; score.penalty = 0; score.chain = 0; score.comboTimer = 0;
  score.elapsed = 0; score.bestChain = 0; score.explosives = 0;
  popAcc = 0; popTimer = -1; popLabel = ''; lastLink = -99;
}

export function comboMult(): number {
  return Math.min(COMBO_MAX, 1 + score.chain * COMBO_STEP);
}

export function addDemolition(value: number, label = 'DEMOLITION'): number {
  if (value <= 0) return 0;
  if (score.elapsed - lastLink >= CHAIN_GAP) {
    lastLink = score.elapsed;
    score.chain++;
    score.bestChain = Math.max(score.bestChain, score.chain);
  }
  score.comboTimer = COMBO_WINDOW;
  const pts = Math.round(value * comboMult());
  score.points += pts;
  pop(pts, label);
  return pts;
}

export function addBonus(points: number, label: string): void {
  score.points += points;
  pop(points, label);
}

/* ---------------- protected property ---------------- */

/* The structure credits a fine per damaged piece of protected property (structure.ts credit(), then its protected-hit
   hook with where it landed). A damaged building goes on shedding pieces for a minute, so the raw per-piece amounts are
   only a measure of how much of it is hurt: the fee is docked per protected structure, on the share of it damaged, in
   the job's own currency (a fraction of what the job pays), capped at the structure's liability. Damage that keeps
   coming within INCIDENT_GAP of the last is the same incident. */
export const LIABILITY = 0.3;     // of the job's value: what wrecking one protected structure costs at most
const FIRST_FINE = 0.15;          // of the liability: the first scratch
/* How much of a structure is hurt (its raw fine so far over its whole): under DAMAGED it is a ding (a blast wave's
   broken windows reach every building on a site and cannot be helped), past it the job is capped at ★★, past WRECKED
   at ★. */
export const DAMAGED = 0.04, WRECKED = 0.15;
export const INCIDENT_GAP = 6;    // s of quiet that closes an incident

export interface Liability { key: string; label: string; raw: number; cap: number }
interface Account extends Liability { hurt: number; fine: number; incident: number; lastAt: number; incidentFine: number }
/** level: 0 a ding, 1 damaged (★★ at most), 2 wrecked (★ at most) */
export interface Incident { key: string; label: string; fine: number; total: number; opened: boolean; capped: boolean; level: 0 | 1 | 2 }

const levelOf = (a: Account): 0 | 1 | 2 => {
  const share = a.hurt / Math.max(a.raw, 1);
  return share >= WRECKED ? 2 : share >= DAMAGED ? 1 : 0;
};

const book = new Map<string, Account>();
let pendingRaw = 0, unbooked = 0;
export let onFine: (i: Incident) => void = () => {};

export function setFineHook(f: typeof onFine): void { onFine = f; }

/** The protected structures on this job and what each can cost; with none listed, fines are charged as they come. */
export function setLiabilities(list: Liability[]): void {
  book.clear();
  pendingRaw = unbooked = 0;
  for (const l of list) book.set(l.key, { ...l, hurt: 0, fine: 0, incident: 0, lastAt: -1e9, incidentFine: 0 });
}

/** The structure's per-piece fine; attributed by chargePenalty() (called straight after, from its protected-hit hook). */
export function addPenalty(points: number): void {
  pendingRaw += points;
}

/** Books the pending damage against the structure `key`. */
export function chargePenalty(key: string | null): void {
  const raw = pendingRaw;
  pendingRaw = 0;
  if (raw <= 0) return;
  const a = key !== null ? book.get(key) : undefined;
  if (!a) { unbooked += raw; dock(raw); return; }
  const opened = score.elapsed - a.lastAt > INCIDENT_GAP;
  if (opened) { a.incident++; a.incidentFine = 0; }
  a.lastAt = score.elapsed;
  a.hurt += raw;
  const k = Math.min(1, FIRST_FINE + (1 - FIRST_FINE) * (a.hurt / Math.max(a.raw, 1)) * 3);
  const fine = Math.round(a.cap * k);
  const delta = fine - a.fine;
  a.fine = fine;
  a.incidentFine += Math.max(0, delta);
  if (delta > 0) dock(delta);
  onFine({ key: a.key, label: a.label, fine: a.incidentFine, total: a.fine, opened, capped: k >= 1, level: levelOf(a) });
}

function dock(points: number): void {
  score.penalty += points;
  score.points -= points;
  onPenalty(points);
}

/** The worst any protected structure came to: 0 untouched or dinged, 1 damaged, 2 wrecked. Fines charged with no
    account to book them to (a job with no liabilities listed) count as damage. */
export function protectedSeverity(): 0 | 1 | 2 {
  let sev: 0 | 1 | 2 = unbooked > 0 ? 1 : 0;
  for (const a of book.values()) sev = Math.max(sev, levelOf(a)) as 0 | 1 | 2;
  return sev;
}

/** The structures that cost the fee something, worst first. */
export function fines(): { label: string; fine: number; level: 0 | 1 | 2 }[] {
  return [...book.values()].filter(a => a.fine > 0).sort((a, b) => b.fine - a.fine)
    .map(a => ({ label: a.label, fine: a.fine, level: levelOf(a) }));
}

function pop(pts: number, label: string): void {
  popAcc += pts;
  if (popTimer < 0) popTimer = POP_WINDOW;
  if (label !== 'DEMOLITION' || !popLabel) popLabel = label;
}

export function tickScore(dt: number): void {
  if (pendingRaw > 0) chargePenalty(null);
  score.elapsed += dt;
  if (score.comboTimer > 0) {
    score.comboTimer -= dt;
    if (score.comboTimer <= 0) { score.chain = 0; score.comboTimer = 0; }
  }
  if (popTimer >= 0) {
    popTimer -= dt;
    if (popTimer < 0) {
      const label = popAcc > 4000 && popLabel === 'DEMOLITION' ? 'COLLAPSE' : popLabel;
      onPop(popAcc, label);
      popAcc = 0; popLabel = '';
    }
  }
}

export function comboFraction(): number {
  return score.comboTimer / COMBO_WINDOW;
}

/* ---------------- contract objectives ---------------- */

/** A plan box, [x0, x1, z0, z1]. */
export type Plan = [number, number, number, number];

/** What a contract asks beyond "this much of the site down". */
export interface Goal {
  /** groups the demolition target counts (the whole site when absent), and what they are called in the briefing */
  groups?: string[];
  what?: string;
  /** the target groups must come down inside this plan box; their volume lying outside it at the end is fly-tipping */
  footprint?: Plan;
  /** seconds: the contract is lost if it is not met by then */
  limit?: number;
  /** loose items of `group` to be carried into the plan box `zone`: `need` of them (a fraction) before sign-off */
  salvage?: { group: string; zone: Plan; need: number; what: string; where: string };
  /** a structure that has to be on the ground whatever the percentage says: nothing of `group` that was built above
      `from` m (its upper part; all of it when absent) still above `below` m */
  fell?: { group: string; what: string; below: number; from?: number };
}

/** The parts of a live piece the objectives read (structure.ts Piece). */
interface Tracked { root: { spec: { group?: string; pos: ArrayLike<number> } }; volume: number; demolished: boolean; curPos: ArrayLike<number> }

/** Progress on the active goal: `frac` is the target's demolished fraction, `outside` the fraction of the target's
    volume lying outside its footprint, `salvaged` items in the salvage zone out of `salvageOf` (`salvageLeft` of
    them still exist; an item broken up counts once, by its root). */
export const objective = { frac: 0, outside: 0, salvaged: 0, salvageOf: 0, salvageLeft: 0, standing: 0 };
const inZone = new Set<object>(), alive = new Set<object>();
/** below-grade parts of the target (footings, basements, piles): no demolition reaches them, so the target skips them */
let buried = new WeakSet<object>();

/** Top of a piece at or under this is below grade (the damp course the buildings stand on). */
export const GRADE = 0.16;
export const belowGrade = (p: { pos: ArrayLike<number>; size: ArrayLike<number> }): boolean => p.pos[1] + p.size[1] / 2 <= GRADE;
let goal: Goal | null = null;
let groups: Set<string> | null = null;
let base = 0;

const inPlan = (b: Plan, p: ArrayLike<number>) => p[0] >= b[0] && p[0] <= b[1] && p[2] >= b[2] && p[2] <= b[3];

export function setGoal(g: Goal | undefined, specs: { group?: string; pos: ArrayLike<number>; size: ArrayLike<number> }[], volumeOf: (i: number) => number): void {
  goal = g ?? null;
  groups = g?.groups ? new Set(g.groups) : null;
  base = 0;
  buried = new WeakSet();
  objective.salvageOf = 0;
  specs.forEach((p, i) => {
    if (groups && p.group && groups.has(p.group)) {
      if (belowGrade(p)) buried.add(p);
      else base += volumeOf(i);
    }
    if (g?.salvage && p.group === g.salvage.group) objective.salvageOf++;
  });
  objective.frac = objective.outside = objective.salvaged = 0;
  objective.salvageLeft = objective.salvageOf;
  objective.standing = Infinity;
}

/** Re-reads the goal's progress off the live pieces; `whole` is the site-wide demolished fraction. */
export function trackGoal(pieces: Iterable<Tracked>, whole: number): void {
  if (!goal || (!groups && !goal.salvage && !goal.fell)) { objective.frac = whole; return; }
  let intact = 0, out = 0, top = 0;
  const fp = goal.footprint, sv = goal.salvage, fl = goal.fell;
  inZone.clear();
  alive.clear();
  for (const p of pieces) {
    const g = p.root.spec.group;
    if (!g) continue;
    if (fl && g === fl.group && p.curPos[1] > top && p.root.spec.pos[1] > (fl.from ?? -Infinity)) top = p.curPos[1];
    if (groups?.has(g) && !buried.has(p.root.spec)) {
      if (!p.demolished) intact += p.volume;
      if (fp && !inPlan(fp, p.curPos)) out += p.volume;
    }
    if (sv && g === sv.group) {
      alive.add(p.root);
      if (inPlan(sv.zone, p.curPos)) inZone.add(p.root);
    }
  }
  objective.frac = groups ? (base > 0 ? Math.min(1, Math.max(0, 1 - intact / base)) : 0) : whole;
  objective.outside = base > 0 ? Math.min(1, out / base) : 0;
  objective.salvaged = inZone.size;
  objective.salvageLeft = alive.size;
  objective.standing = fl ? top : 0;
}

/** The structure the goal says must come down is still standing. */
export function stillStanding(): boolean {
  return !!goal?.fell && objective.standing > goal.fell.below;
}

/** Salvage still owed before the job can be signed off (0 when there is none, or it is in). */
export function salvageOwed(): number {
  if (!goal?.salvage) return 0;
  return Math.max(0, Math.ceil(goal.salvage.need * objective.salvageOf - 1e-9) - objective.salvaged);
}

/** Too much of the salvage has been destroyed for the job ever to be signed off. */
export function salvageLost(): boolean {
  return salvageOwed() > objective.salvageLeft - objective.salvaged;
}

export function goalMet(target: number): boolean {
  return objective.frac >= target && salvageOwed() === 0 && !stillStanding();
}

/** Out of time: the goal's limit has passed with the job unfinished. */
export function goalExpired(target: number): boolean {
  return !!goal?.limit && score.elapsed > goal.limit && !goalMet(target);
}
