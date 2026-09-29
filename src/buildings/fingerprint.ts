import type { PieceSpec } from '../types.ts';
import { MATS } from '../destruction/materials.ts';
import { pieceSolid } from '../levels/validate.ts';

const r = (v: number) => Math.round(v * 1000);

/* Canonical form at every depth: object keys sorted, numbers rounded to 1 mm, non-finite numbers encoded distinctly
   from null, the diagnostic `part` tag dropped, and `detail` lists order-independent. Array order is otherwise kept. */
function canon(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? r(v) : Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf';
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (k === 'part' || o[k] === undefined) continue;
      const c = canon(o[k]);
      out[k] = k === 'detail' && Array.isArray(c) ? c.map((d) => JSON.stringify(d)).sort() : c;
    }
    return out;
  }
  return v;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The piece's canonical line: the unit the fingerprint hashes and sorts on (also assemble's canonical piece order). */
export const canonicalKey = (p: PieceSpec): string => JSON.stringify(canon(p));

export function fingerprint(ps: PieceSpec[]): { pieces: number; mass: number; hash: string } {
  const rows = ps.map((p) => ({ line: canonicalKey(p), p })).sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0));
  let mass = 0;
  for (const { p } of rows) mass += (MATS[p.mat]?.density ?? 0) * pieceSolid(p).volume;
  return { pieces: ps.length, mass: Math.round(mass), hash: fnv(rows.map((x) => x.line).join('\n')) };
}
