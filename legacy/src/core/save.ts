export interface SaveData {
  stars: number[];        // per contract, 0-3
  volume: number;         // 0-1
  quality: 'high' | 'low';
}

const KEY = 'destructovibe-save-v1';

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      return {
        stars: Array.isArray(d.stars) ? d.stars : [],
        volume: typeof d.volume === 'number' ? d.volume : 0.8,
        quality: d.quality === 'low' ? 'low' : 'high',
      };
    }
  } catch { /* corrupted or unavailable — start fresh */ }
  return { stars: [], volume: 0.8, quality: 'high' };
}

export function writeSave(d: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode etc. */ }
}

/* contract i is unlocked if it's first or the previous one has ≥1 star */
export function isUnlocked(save: SaveData, i: number): boolean {
  return i === 0 || (save.stars[i - 1] ?? 0) > 0;
}
