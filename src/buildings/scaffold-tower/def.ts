import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { scaffoldTower } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'scaffold-tower', name: 'Scaffold tower', category: 'props', group: 'scaffold-tower', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => scaffoldTower(p as never) }],
};
export default def;
