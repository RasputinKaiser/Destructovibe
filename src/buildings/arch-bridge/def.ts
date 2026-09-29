import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { stoneArchBridge } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'arch-bridge', name: 'Stone arch bridge', category: 'heritage', group: 'arch-bridge', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => stoneArchBridge(p as never) }],
};
export default def;
