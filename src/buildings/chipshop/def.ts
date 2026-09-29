import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { chipShop } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'chipshop', name: 'Corner chip shop', category: 'houses', group: 'chipshop', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 130, build: (_f, p) => chipShop(p as never) }],
};
export default def;
