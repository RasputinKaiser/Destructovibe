import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { residentialTower } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'highrise', name: 'Residential tower, 34 storeys', category: 'towers', group: 'tower', pipeline: 'raw',
  landmark: true, order: 3,
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 1300, build: (_f, p) => residentialTower(p as never) }],
};
export default def;
