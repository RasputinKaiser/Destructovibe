import type { PieceSpec, PrefabView } from '../../types.ts';
import type { Placement } from './common.ts';
import { railwayStation } from './station.ts';
import { cathedral } from './cathedral.ts';
import { millComplex } from './mill.ts';
import { residentialTower } from './tower.ts';
import { departmentStore } from './deptstore.ts';
import { trussRoadBridge } from './bridge.ts';
import { gasholder } from './gasholder.ts';
import { stadium } from './stadium.ts';

export interface Landmark { id: string; name: string; category: PrefabView['category']; make(p: Placement): PieceSpec[] }

export const LANDMARKS: Landmark[] = [
  { id: 'station', name: 'Victorian railway terminus', category: 'heritage', make: railwayStation },
  { id: 'cathedral', name: 'Gothic church with spire', category: 'heritage', make: cathedral },
  { id: 'cathedral-4', name: 'Gothic church, four bays', category: 'heritage', make: (p) => cathedral({ ...p, bays: 4 }) },
  { id: 'highrise', name: 'Residential tower, 34 storeys', category: 'towers', make: residentialTower },
  { id: 'deptstore', name: 'Art Deco department store', category: 'towers', make: departmentStore },
  { id: 'road-bridge', name: 'Riveted truss road bridge', category: 'infrastructure', make: trussRoadBridge },
  { id: 'gasholder', name: 'Column-guided gasholder', category: 'industrial', make: gasholder },
  { id: 'stadium', name: 'Football ground, two stands', category: 'infrastructure', make: stadium },
  { id: 'millworks', name: 'Cotton mill, engine house and chimney', category: 'industrial', make: millComplex },
];
