import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { carPark } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'car-park', name: 'Multi-storey car park', category: 'infrastructure', group: 'car-park', pipeline: 'raw',
  defaults: { cars: 2 },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 400, build: (_f, p) => carPark(p as never) }],
};
export default def;
