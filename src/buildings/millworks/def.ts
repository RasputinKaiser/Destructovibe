import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { millComplex } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'millworks', name: 'Cotton mill, engine house and chimney', category: 'industrial', group: 'millworks', pipeline: 'raw',
  landmark: true, order: 8,
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 1400, build: (_f, p) => millComplex(p as never) }],
};
export default def;
