import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { trussRoadBridge } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'road-bridge', name: 'Riveted truss road bridge', category: 'infrastructure', group: 'roadbridge', pipeline: 'raw',
  landmark: true, order: 5,
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 500, build: (_f, p) => trussRoadBridge(p as never) }],
};
export default def;
