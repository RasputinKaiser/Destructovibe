import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { mill } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'mill', name: 'Brick mill', category: 'industrial', group: 'mill', pipeline: 'raw',
  defaults: { stock: true },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 400, build: (_f, p) => mill(p as never) }],
};
export default def;
