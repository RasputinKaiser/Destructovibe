import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { trussBridge } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'truss-bridge', name: 'Steel truss footbridge', category: 'infrastructure', group: 'truss-bridge', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => trussBridge(p as never) }],
};
export default def;
