import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { greenhouse } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'greenhouse', name: 'Greenhouse', category: 'houses', group: 'greenhouse', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => greenhouse(p as never) }],
};
export default def;
