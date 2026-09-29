import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { spiralFolly } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'spiral-stair', name: 'Cast-iron spiral stair', category: 'heritage', group: 'spiral-stair', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => spiralFolly(p as never) }],
};
export default def;
