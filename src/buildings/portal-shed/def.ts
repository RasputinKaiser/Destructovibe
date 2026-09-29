import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { portalShed } from './parts/main.ts';
import { put } from '../_shared/clearance-helpers.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'portal-shed', name: 'Portal shed', category: 'industrial', group: 'portal-shed', pipeline: 'raw',
  defaults: { X: 7, Z: 4, H: 5.5, bays: 2, tint: 0x6f8fae, west: [[0, 1.2, 2.3]], front: [[3, 3.5, 4]] },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 50, build: (_f, p) => put(portalShed(p as never), p as never, 'portal-shed') }],
};
export default def;
