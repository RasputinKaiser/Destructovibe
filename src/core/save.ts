import type { SandboxSettings, Settings } from '../types';

export interface SaveData {
  version: 2;
  settings: Settings;
  progress: Record<string, { stars: number; best: number }>;
}

const KEY = 'destructovibe.v2';

export const DEFAULT_SETTINGS: Settings = { volume: 0.8, quality: 'high', sensitivity: 1, fov: 100, fovH: true, invertY: false, explosives: true,
  shake: true, grain: true, aberration: true, renderScale: 0,
};

/** world knobs every level starts from; the sandbox panel edits a copy */
export const WORLD_DEFAULTS: Readonly<SandboxSettings> = { timeScale: 1, gravity: 1, jointStrength: 1, wind: 0, fireSpread: true, debrisLimit: 1400 };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      if (d.version === 2) {
        const settings = { ...DEFAULT_SETTINGS, ...d.settings };
        /* fov used to be vertical degrees; saves from then read far too narrow as horizontal */
        if (!d.settings?.fovH) { settings.fov = DEFAULT_SETTINGS.fov; settings.fovH = true; }
        return { version: 2, settings, progress: d.progress ?? {} };
      }
    }
  } catch { /* private mode or corrupt save: start fresh */ }
  return { version: 2, settings: { ...DEFAULT_SETTINGS }, progress: {} };
}

export function writeSave(s: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
