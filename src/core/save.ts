import type { SandboxSettings, Settings, WeaponId } from '../types';

export interface SaveData {
  version: 2;
  settings: Settings;
  progress: Record<string, { stars: number; best: number }>;
  /** tools the player pinned to the number keys (free play and big loadouts) */
  pins: (WeaponId | null)[];
  /** onboarding: times each tool's control prompt has been shown, and 'wheel' for the tool wheel */
  seen: Record<string, number>;
}

const KEY = 'destructovibe.v2';

export const DEFAULT_SETTINGS: Settings = { volume: 0.8, quality: 'high', sensitivity: 1, fov: 100, fovH: true, invertY: false, explosives: true,
  shake: true, grain: true, aberration: true, renderScale: 0, headBob: true, crouchToggle: false, sprintToggle: false, impacts: 'real', keys: {},
  uiScale: 1, colorblind: false, reduceFlash: false, reduceMotion: false, prompts: 'new',
};
export const DEFAULT_PINS: WeaponId[] = ['hammer', 'rocket', 'charge', 'planner', 'grinder', 'tether'];

/** world knobs every level starts from; the sandbox panel edits a copy */
export const WORLD_DEFAULTS: Readonly<SandboxSettings> = { timeScale: 1, gravity: 1, jointStrength: 1, wind: 0, fireSpread: true, debrisLimit: 1400 };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      if (d.version === 2) {
        const settings = { ...DEFAULT_SETTINGS, ...d.settings };
        settings.keys = { ...(d.settings?.keys ?? {}) };
        /* fov used to be vertical degrees; saves from then read far too narrow as horizontal */
        if (!d.settings?.fovH) { settings.fov = DEFAULT_SETTINGS.fov; settings.fovH = true; }
        /* fields added since a save was written take their defaults; anything out of range is pulled back in */
        if (!Number.isFinite(settings.uiScale)) settings.uiScale = 1;
        settings.uiScale = Math.min(1.5, Math.max(0.8, settings.uiScale));
        if (!['new', 'always', 'off'].includes(settings.prompts)) settings.prompts = 'new';
        const pins = Array.isArray(d.pins) ? d.pins.slice(0, 6).map(p => (typeof p === 'string' ? p : null)) : [...DEFAULT_PINS];
        const seen = d.seen && typeof d.seen === 'object' ? { ...d.seen } : {};
        return { version: 2, settings, progress: d.progress ?? {}, pins, seen };
      }
    }
  } catch { /* private mode or corrupt save: start fresh */ }
  return { version: 2, settings: { ...DEFAULT_SETTINGS }, progress: {}, pins: [...DEFAULT_PINS], seen: {} };
}

export function writeSave(s: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
