import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { brickByBrickWall } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'brick-wall', name: 'Brick-by-brick wall', category: 'heritage', group: 'brick-wall', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => brickByBrickWall(p as never) }],
};
export default def;
