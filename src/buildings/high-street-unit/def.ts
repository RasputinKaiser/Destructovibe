import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { highStreetUnit } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'high-street-unit', name: 'High-street unit', category: 'houses', group: 'high-street-unit', pipeline: 'raw',
  defaults: { tint: 0xa98474, fascia: 0x2f4f7f },
  variants: [{ id: 'high-street-pub', name: 'High-street pub', params: { pub: true, X: 4.5, Z: 5.5, tint: 0x7c4a3a, fascia: 0x3a2418 } }],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 190, build: (_f, p) => highStreetUnit(p as never) }],
};
export default def;
