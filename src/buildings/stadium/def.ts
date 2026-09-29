import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { stadium } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'stadium', name: 'Football ground, two stands', category: 'infrastructure', group: 'stadium', pipeline: 'raw',
  landmark: true, order: 7,
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 700, build: (_f, p) => stadium(p as never) }],
};
export default def;
