import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { stadiumStand } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'stand', name: 'Stadium stand', category: 'infrastructure', group: 'stand', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => stadiumStand(p as never) }],
};
export default def;
