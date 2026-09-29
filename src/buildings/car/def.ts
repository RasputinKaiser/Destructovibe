import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { car } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'car', name: 'Car', category: 'props', group: 'car', pipeline: 'raw',
  defaults: { protected: false },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => car(p as never) }],
};
export default def;
