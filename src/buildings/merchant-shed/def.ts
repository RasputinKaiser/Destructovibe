import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { merchantShed } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'merchant-shed', name: 'Builders merchant shed', category: 'industrial', group: 'merchant-shed', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => merchantShed(p as never) }],
};
export default def;
