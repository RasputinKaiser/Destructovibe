import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { gardenShed } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'shed', name: 'Garden shed', category: 'houses', group: 'shed', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => gardenShed(p as never) }],
};
export default def;
