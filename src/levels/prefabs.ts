import type { PieceSpec, PrefabView } from '../types.ts';
import { crates, drums, place, tnt } from './kit.ts';
import { serviceGantry } from './rigging.ts';
import * as P from './plant.ts';
import * as MC from './machines.ts';
import * as GR from './grid.ts';
import * as EL from './electrical.ts';
import { pieceAabb } from './validate.ts';
import { LANDMARKS } from './architecture/index.ts';
import { BUILDING_VARIANTS, building } from '../buildings/registry.gen.ts';

export interface Prefab {
  id: string;
  name: string;
  category: PrefabView['category'];
  /** pieces centred on (x, z), turned by quarter turns about that point */
  build(x: number, z: number, quarter: number): PieceSpec[];
}

const at = { x: 0, z: 0 };

/* Free play has no fees, so protected flags are dropped; each prefab is built once at the origin and shifted so its
   footprint is centred there, then copied, turned and moved per drop. */
function prefab(id: string, name: string, category: Prefab['category'], make: () => PieceSpec[]): Prefab {
  let base: PieceSpec[] | null = null;
  const centred = () => {
    if (!base) {
      const raw = make().map((p) => { const q = { ...p }; delete q.protected; return q; });
      const boxes = raw.map(pieceAabb);
      const cx = (Math.min(...boxes.map((b) => b.min[0])) + Math.max(...boxes.map((b) => b.max[0]))) / 2;
      const cz = (Math.min(...boxes.map((b) => b.min[2])) + Math.max(...boxes.map((b) => b.max[2]))) / 2;
      base = place(raw, -cx, -cz);
    }
    return base;
  };
  return { id, name, category, build: (x, z, quarter) => place(centred(), x, z, quarter) };
}

/* Registry buildings: name, category and parameters come from the package's BuildingDef variants. */
function fromBuilding(id: string): Prefab {
  const v = BUILDING_VARIANTS.find((b) => b.id === id);
  if (!v) throw new Error(`unknown building '${id}'`);
  return prefab(v.id, v.name, v.category, () => building(v.id, at));
}

const HAND: Prefab[] = [
  // houses
  fromBuilding('shed'),
  fromBuilding('outhouse'),
  fromBuilding('greenhouse'),
  fromBuilding('bungalow'),
  fromBuilding('timber-house'),
  fromBuilding('terrace'),
  fromBuilding('cottages'),
  fromBuilding('cottages-2'),
  fromBuilding('tudor'),
  fromBuilding('tudor-scaffold'),
  fromBuilding('flats-3'),
  fromBuilding('flats-4'),
  fromBuilding('flats-6'),
  fromBuilding('flats-scaffold'),
  fromBuilding('chipshop'),
  fromBuilding('site-office'),
  // towers
  fromBuilding('tower-block-6'),
  fromBuilding('tower-block-4'),
  fromBuilding('office-4'),
  fromBuilding('office-5'),
  fromBuilding('skyscraper-18'),
  fromBuilding('skyscraper-12'),
  fromBuilding('backdrop-tower'),
  fromBuilding('water-tower'),
  fromBuilding('brick-stack'),
  fromBuilding('chimney'),
  fromBuilding('pylon'),
  fromBuilding('crane'),
  fromBuilding('cooling-tower'),
  prefab('wind-turbine', 'Wind turbine', 'towers', () => P.windTurbineSite(at)),
  // industrial
  fromBuilding('warehouse'),
  fromBuilding('warehouse-stocked'),
  fromBuilding('mill'),
  fromBuilding('factory'),
  fromBuilding('factory-plain'),
  fromBuilding('barn'),
  fromBuilding('pump-house'),
  fromBuilding('pipe-rack'),
  prefab('service-gantry', 'Rope & wiring service gantry', 'industrial', () => serviceGantry(0, 0)),
  prefab('boiler-house', 'Boiler house with flue', 'industrial', () => P.boilerHouse(at)),
  prefab('press-shop', 'Press shop', 'industrial', () => P.pressShop(at)),
  prefab('hvac-plant', 'Rooftop HVAC plant', 'industrial', () => P.hvacPlant(at)),
  prefab('mill-wheel', 'Mill waterwheel', 'industrial', () => P.millWheel(at)),
  // infrastructure
  fromBuilding('car-park'),
  fromBuilding('overpass'),
  fromBuilding('truss-bridge'),
  fromBuilding('stand'),
  fromBuilding('bus-shelter'),
  fromBuilding('garden-wall'),
  prefab('substation', 'Electrical substation', 'infrastructure', () => P.substation(at)),
  prefab('pumping-station', 'Water pumping station', 'infrastructure', () => P.pumpingStation(at)),
  prefab('pole-line', 'Overhead power line', 'infrastructure', () => P.poleLineSite(at)),
  // heritage
  fromBuilding('chapel'),
  fromBuilding('rotunda'),
  fromBuilding('spiral-stair'),
  fromBuilding('arch-bridge'),
  fromBuilding('brick-wall'),
  fromBuilding('cottage-row-5'),
  // props
  fromBuilding('car'),
  fromBuilding('van'),
  fromBuilding('scaffold-tower'),
  prefab('crate-stack', 'Crate stack', 'props', () => crates(0, 0, 0, 3, 2, 3)),
  prefab('barrels', 'Barrel cache', 'props', () => drums('barrel', 0, 0, 0, 3, 3)),
  prefab('propane', 'Propane cache', 'props', () => drums('propane', 0, 0, 0, 3, 2)),
  prefab('tnt-stack', 'TNT stack', 'props', () => [...tnt(-0.35, 0, 0, 3), ...tnt(0.35, 0, 0, 2)]),
  fromBuilding('mixed-cache'),
  prefab('crate', 'Crate', 'props', () => crates(0, 0, 0, 1, 1, 1)),
  prefab('barrel', 'Barrel', 'props', () => drums('barrel', 0, 0, 0, 1, 1)),
  prefab('propane-tank', 'Propane tank', 'props', () => drums('propane', 0, 0, 0, 1, 1)),
  prefab('tnt', 'TNT crate', 'props', () => tnt(0, 0, 0, 1)),
  // construction plant
  prefab('excavator', 'Tracked excavator (20 t)', 'industrial', () => MC.excavator(at)),
  prefab('bulldozer', 'Crawler dozer', 'industrial', () => MC.bulldozer(at)),
  prefab('dump-truck', 'Site dump truck', 'industrial', () => MC.dumpTruck(at)),
  prefab('mixer-truck', 'Concrete mixer truck', 'industrial', () => MC.mixerTruck(at)),
  prefab('mobile-crane', 'Mobile crane on outriggers', 'industrial', () => MC.mobileCrane(at)),
  prefab('forklift', 'Counterbalance forklift', 'industrial', () => MC.forklift(at)),
  prefab('scissor-lift', 'Scissor lift', 'industrial', () => MC.scissorLift(at)),
  prefab('compressor', 'Site compressor', 'industrial', () => MC.compressor(at)),
  prefab('generator', 'Diesel generator set', 'industrial', () => MC.dieselGenerator(at)),
  prefab('light-tower', 'Site lighting tower', 'industrial', () => MC.lightTower(at)),
  prefab('magnet-crane', 'Scrapyard magnet crane', 'industrial', () => EL.magnetCrane(at)),
  // industrial machinery
  prefab('conveyor-line', 'Roller conveyor line', 'industrial', () => MC.conveyorLine(at)),
  prefab('rotary-kiln', 'Rotary drum dryer', 'industrial', () => MC.rotaryKiln(at)),
  prefab('bucket-elevator', 'Bucket elevator', 'industrial', () => MC.bucketElevator(at)),
  prefab('fan-bank', 'Extract fan bank', 'industrial', () => MC.fanBank(at)),
  prefab('cooling-fan', 'Dry cooler fan', 'industrial', () => MC.coolingFan(at)),
  prefab('press-line', 'Hydraulic press line', 'industrial', () => MC.pressLine(at)),
  prefab('cnc-gantry', 'CNC gantry router', 'industrial', () => MC.cncGantry(at)),
  prefab('robot-arm', 'Robot arm', 'industrial', () => MC.robotArm(at)),
  prefab('goods-lift', 'Goods lift tower', 'industrial', () => MC.goodsLift(at)),
  prefab('vent-stack', 'Ventilation stack', 'industrial', () => MC.ventStack(at)),
  prefab('water-pumps', 'Water pump sets', 'industrial', () => MC.waterPumps(at)),
  prefab('fan-cooling-tower', 'Forced-draught cooling tower', 'industrial', () => MC.coolingTowerFans(at)),
  // utility plant
  prefab('switchgear', 'LV switchgear', 'infrastructure', () => MC.switchgear({ ...at, source: true })),
  prefab('gas-governor', 'District gas governor', 'infrastructure', () => MC.gasGovernor(at)),
  prefab('sewage-station', 'Sewage pumping station', 'infrastructure', () => MC.sewageStation(at)),
  prefab('lv-substation', 'Distribution substation', 'infrastructure', () => GR.substation(at)),
  prefab('pump-hall', 'Water pump hall', 'infrastructure', () => GR.pumpHall({ ...at, feed: 'local' })),
  // vehicles that roll when pushed
  prefab('saloon', 'Saloon car', 'props', () => MC.car(at)),
  prefab('box-van', 'Box van', 'props', () => MC.van(at)),
  prefab('bus', 'Single-deck coach', 'props', () => MC.bus(at)),
  prefab('lorry', 'Curtain-side lorry', 'props', () => MC.lorry(at)),
  // landmarks at true scale (src/levels/architecture)
  ...LANDMARKS.map((l) => prefab(l.id, l.name, l.category, () => l.make(at))),
];

/* A registry building none of whose variants is listed above joins the palette automatically, every variant, in registry
   order: adding a building needs only its package folder and `npm run buildings`. */
const listed = new Set(HAND.map((p) => BUILDING_VARIANTS.find((v) => v.id === p.id)?.base).filter((b) => b !== undefined));
export const PREFABS: Prefab[] = [...HAND, ...BUILDING_VARIANTS.filter((v) => !listed.has(v.base)).map((v) => fromBuilding(v.id))];

export function prefabView(p: Prefab): PrefabView {
  const ps = p.build(0, 0, 0);
  const boxes = ps.map(pieceAabb);
  const span = (k: 0 | 2) => Math.max(...boxes.map((b) => b.max[k])) - Math.min(...boxes.map((b) => b.min[k]));
  const r = (v: number) => Math.round(v * 10) / 10;
  return { id: p.id, name: p.name, category: p.category, pieces: ps.length, footprint: [r(span(0)), r(span(2))] };
}
