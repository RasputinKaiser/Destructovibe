import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { bungalow } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'bungalow', name: 'Brick bungalow', category: 'houses', group: 'bungalow', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 300, build: (_f, p) => bungalow(p as never) }],
};
export default def;
