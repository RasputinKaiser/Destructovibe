import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { brickStack } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'brick-stack', name: 'Brick stack', category: 'towers', group: 'brick-stack', pipeline: 'raw',
  defaults: { courses: 7 },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => brickStack(p as never) }],
};
export default def;
