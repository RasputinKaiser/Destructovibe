import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { pipeRack } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'pipe-rack', name: 'Construction services pipe rack', category: 'industrial', group: 'pipe-rack', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => pipeRack(p as never) }],
};
export default def;
