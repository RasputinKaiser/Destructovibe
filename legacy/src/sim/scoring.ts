/* Score + combo state. Destruction events chain into a combo multiplier
   (up to ×3) when they land within the combo window of each other. */

const COMBO_WINDOW = 2.5;

export let score = 0;
export let penalty = 0;
export let comboCount = 0;
export let comboTimer = 0;
export let elapsed = 0;

export function comboMult(): number {
  return Math.min(3, 1 + comboCount * 0.1);
}

export function resetScoring(): void {
  score = 0; penalty = 0; comboCount = 0; comboTimer = 0; elapsed = 0;
}

/* points for a destruction (or partial event like a crack/dent).
   isKill events extend the combo chain; partial events only score. */
export function notifyDestruction(points: number, isKill: boolean): void {
  if (isKill) {
    comboCount++;
    comboTimer = COMBO_WINDOW;
    score += Math.round(points * comboMult());
  } else {
    score += points;
  }
}

export function addBonus(points: number): void { score += points; }

export function addPenalty(n: number): void {
  penalty += n;
  score = score - n;
}

export function tickScoring(dt: number): void {
  elapsed += dt;
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) comboCount = 0;
  }
}
