import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { worksHall } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'works-hall', name: 'Works hall', category: 'industrial', group: 'works-hall', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => worksHall(p as never).filter((q) => q.pos[1] - q.size[1] / 2 >= 0) }],
};
export default def;
