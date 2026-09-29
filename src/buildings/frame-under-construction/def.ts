import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { frameUnderConstruction } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'frame-under-construction', name: 'Steel frame under construction', category: 'industrial', group: 'frame-under-construction', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 50, build: (_f, p) => frameUnderConstruction(p as never) }],
};
export default def;
