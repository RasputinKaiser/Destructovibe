import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { outhouse } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'outhouse', name: 'Outhouse', category: 'houses', group: 'outhouse', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => outhouse(p as never) }],
};
export default def;
