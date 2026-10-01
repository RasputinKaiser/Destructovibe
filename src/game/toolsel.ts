/* Tool selection without the DOM: the categories the tool wheel files the WEAPONS table under, the six quick slots on
   the number keys, and the wheel's pointer (a mouse moves it by deltas, a stick points it). Pure functions of the table
   and the loadout, so a contract that issues three tools gets a three-tool wheel and three slots. */
import type { WeaponId } from '../types';
import type { ToolCat } from './weapons';

export interface ToolRow { id: WeaponId; cat: ToolCat }
export type Ammo = Partial<Record<WeaponId, number>>;

/** clockwise from the top of the wheel */
export const CATS: readonly { id: ToolCat; name: string }[] = [
  { id: 'impact', name: 'Impact' },
  { id: 'explosive', name: 'Explosives' },
  { id: 'ordnance', name: 'Ordnance' },
  { id: 'cutting', name: 'Cutting' },
  { id: 'rigging', name: 'Rigging & machines' },
  { id: 'fire', name: 'Fire & water' },
];
export const SLOTS = 6;
export const SECTOR = 360 / CATS.length;
/** wheel radii in wheel units (the pointer is clamped to 1): inside DEAD nothing is picked, past LOCK the category
    holds and the pointer's angle picks a tool on the fan at TOOL_R */
export const DEAD = 0.3, LOCK = 0.62, TOOL_R = 0.84;

const catIndex = (c: ToolCat): number => CATS.findIndex(x => x.id === c);

/** the table in wheel order: by category, then as listed */
export function ordered<T extends ToolRow>(table: readonly T[]): T[] {
  return table.map((t, i) => ({ t, i })).sort((a, b) => catIndex(a.t.cat) - catIndex(b.t.cat) || a.i - b.i).map(x => x.t);
}

export function issued(table: readonly ToolRow[], ammo: Ammo): WeaponId[] {
  return ordered(table).filter(t => ammo[t.id] !== undefined).map(t => t.id);
}

/** the issued tools of each category, in wheel order */
export function fans(table: readonly ToolRow[], ammo: Ammo): WeaponId[][] {
  const o = ordered(table);
  return CATS.map(c => o.filter(t => t.cat === c.id && ammo[t.id] !== undefined).map(t => t.id));
}

/** Keys 1–6. A loadout of six or fewer tools fills them in wheel order (the briefing's list); a bigger one keeps the
    player's pins where they put them (those issued) and fills the gaps with the rest in wheel order. */
export function quickSlots(table: readonly ToolRow[], ammo: Ammo, pins: readonly (WeaponId | null | undefined)[] = []): (WeaponId | null)[] {
  const got = issued(table, ammo);
  const out: (WeaponId | null)[] = Array(SLOTS).fill(null);
  if (got.length <= SLOTS) { got.forEach((id, i) => { out[i] = id; }); return out; }
  for (let i = 0; i < SLOTS; i++) { const p = pins[i]; if (p && got.includes(p) && !out.includes(p)) out[i] = p; }
  const rest = got.filter(id => !out.includes(id));
  for (let i = 0; i < SLOTS; i++) if (!out[i]) out[i] = rest.shift() ?? null;
  return out;
}

/** puts `id` in slot `i` (0-based); where it already sat, the slot's old tool moves there */
export function pin(pins: readonly (WeaponId | null | undefined)[], i: number, id: WeaponId): (WeaponId | null)[] {
  const out = Array.from({ length: SLOTS }, (_, k) => pins[k] ?? null);
  const was = out.indexOf(id);
  if (was >= 0) out[was] = out[i];
  out[i] = id;
  return out;
}

/** degrees clockwise from the top: where tool i of n sits on category c's fan. A fan spans at most FAN_SPAN, under
    two wedges' width, so sweeping the rim from one category's fan reaches the next one's wedge, not the one beyond. */
export const FAN_SPAN = 108;
export function fanStep(n: number): number { return n <= 1 ? 0 : Math.min(24, FAN_SPAN / (n - 1)); }
export function fanAngle(c: number, i: number, n: number): number { return c * SECTOR + (i - (n - 1) / 2) * fanStep(n); }

const wrap = (a: number): number => ((a % 360) + 540) % 360 - 180;

export interface Wheel {
  x: number; y: number;
  /** category under the pointer (-1 none), and whether it is held for a pick along its fan */
  cat: number; lock: boolean;
  tool: WeaponId | null;
}

export function wheelStart(cur: WeaponId, f: WeaponId[][]): Wheel {
  const c = f.findIndex(l => l.includes(cur));
  return { x: 0, y: 0, cat: c, lock: false, tool: c >= 0 ? cur : null };
}

/** Moves the pointer to (x, y) (screen axes, y down; clamped to the rim) and works out what it is on. */
export function wheelAt(w: Wheel, x: number, y: number, f: WeaponId[][]): Wheel {
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  w.x = x; w.y = y;
  const r = Math.min(1, m);
  if (r < DEAD) { w.lock = false; return w; }   // the centre keeps whatever was picked last (a stick let go)
  const a = (Math.atan2(x, -y) * 180) / Math.PI;
  const sector = ((Math.round(a / SECTOR) % CATS.length) + CATS.length) % CATS.length;
  /* the nearest tool on category c's fan to the pointer's angle, and how far off it is */
  const nearest = (c: number): [WeaponId | null, number] => {
    const l = f[c];
    let best: WeaponId | null = null, bd = Infinity;
    l.forEach((id, i) => { const d = Math.abs(wrap(a - fanAngle(c, i, l.length))); if (d < bd) { bd = d; best = id; } });
    return [best, bd];
  };
  if (w.lock && w.cat >= 0 && r >= LOCK) {
    // along the held category's fan: the nearest tool, for as long as the pointer is in the category's own wedge or
    // within half a step of the fan's end; past that the wedge under it takes over
    const [best, bd] = nearest(w.cat);
    const own = Math.abs(wrap(a - w.cat * SECTOR)) <= SECTOR / 2;
    if (best && (own || bd <= fanStep(f[w.cat].length) / 2 + 3)) { w.tool = best; return w; }
    w.lock = false;
  }
  if (!f[sector].length) { w.cat = -1; w.tool = null; w.lock = false; return w; }
  if (sector !== w.cat || !w.tool || !f[sector].includes(w.tool)) {
    w.cat = sector;
    w.tool = f[sector][Math.floor((f[sector].length - 1) / 2)];
  }
  if (r >= LOCK) {
    // out past the ring: the category holds, and the pointer is already in its own wedge, so its fan answers
    w.lock = true;
    const [best] = nearest(sector);
    if (best) w.tool = best;
  }
  return w;
}

/** wheel / bumpers while it is open: the next or previous tool in the category (the first issued one if none) */
export function wheelStep(w: Wheel, dir: number, f: WeaponId[][]): Wheel {
  let c = w.cat;
  if (c < 0) c = f.findIndex(l => l.length > 0);
  if (c < 0) return w;
  const l = f[c];
  const i = w.tool ? l.indexOf(w.tool) : -1;
  w.cat = c;
  w.tool = l[(((i < 0 ? 0 : i + dir) % l.length) + l.length) % l.length];
  return w;
}
