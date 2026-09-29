import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { timberHouse } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'timber-house', name: 'Timber-frame family house', category: 'houses', group: 'timber-house', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 800, build: (_f, p) => timberHouse(p as never) }],
};
export default def;
