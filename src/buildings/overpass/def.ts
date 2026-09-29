import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { overpass } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'overpass', name: 'Road overpass', category: 'infrastructure', group: 'overpass', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => overpass(p as never) }],
};
export default def;
