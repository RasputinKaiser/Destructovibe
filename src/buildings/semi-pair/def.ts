import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { semiPair } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'semi-pair', name: 'Semi-detached pair', category: 'houses', group: 'semi-pair', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 300, build: (_f, p) => semiPair(p as never) }],
};
export default def;
