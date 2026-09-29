import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { dump } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'mixed-cache', name: 'Mixed explosives', category: 'props', group: 'mixed-cache', pipeline: 'raw',
  defaults: { crates: [2, 1, 2], barrels: [2, 2], propane: [2, 1], tnt: 2 },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => dump(p as never) }],
};
export default def;
