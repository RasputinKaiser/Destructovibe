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

export function addPenalty(points: number): void {
  score.penalty += points;
  score.points -= points;
  onPenalty(points);
}

function pop(pts: number, label: string): void {
  popAcc += pts;
  if (popTimer < 0) popTimer = POP_WINDOW;
  if (label !== 'DEMOLITION' || !popLabel) popLabel = label;
}

export function tickScore(dt: number): void {
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
