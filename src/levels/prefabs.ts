import type { PieceSpec, PrefabView } from '../types.ts';
import { crates, drums, place, tnt } from './kit.ts';
import { serviceGantry } from './rigging.ts';
import * as B from './buildings.ts';
import * as P from './plant.ts';
import * as S from './structures.ts';
import * as MC from './machines.ts';
import * as GR from './grid.ts';
import * as EL from './electrical.ts';
import { pieceAabb } from './validate.ts';
import { LANDMARKS } from './architecture/index.ts';

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

export const PREFABS: Prefab[] = [
  // houses
  prefab('shed', 'Garden shed', 'houses', () => S.gardenShed(at)),
  prefab('outhouse', 'Outhouse', 'houses', () => S.outhouse(at)),
  prefab('greenhouse', 'Greenhouse', 'houses', () => S.greenhouse(at)),
  prefab('bungalow', 'Brick bungalow', 'houses', () => S.bungalow(at)),
  prefab('timber-house', 'Timber-frame family house', 'houses', () => B.timberHouse(at)),
  prefab('terrace', 'Victorian terrace with pub', 'houses', () => B.victorianTerrace(at)),
  prefab('cottages', 'Cottage terrace', 'houses', () => S.cottageRow(at)),
  prefab('cottages-2', 'Pair of cottages', 'houses', () => S.cottageRow({ ...at, count: 2 })),
  prefab('tudor', 'Timber-frame house', 'houses', () => S.timberFrameHouse(at)),
  prefab('tudor-scaffold', 'Timber-frame house, scaffolded', 'houses', () => S.timberFrameHouse({ ...at, scaffold: true })),
  prefab('flats-3', 'Walk-up flats, 3 storeys', 'houses', () => S.apartmentBlock({ ...at, storeys: 3 })),
  prefab('flats-4', 'Walk-up flats, 4 storeys', 'houses', () => S.apartmentBlock(at)),
  prefab('flats-6', 'Walk-up flats, 6 storeys', 'houses', () => S.apartmentBlock({ ...at, storeys: 6 })),
  prefab('flats-scaffold', 'Walk-up flats under scaffold', 'houses', () => S.apartmentBlock({ ...at, storeys: 3, scaffold: true })),
  prefab('chipshop', 'Corner chip shop', 'houses', () => S.chipShop(at)),
  prefab('site-office', 'Site office', 'houses', () => S.siteOffice(at)),
  // towers
  prefab('tower-block-6', 'Tower block, 6 storeys', 'towers', () => S.towerBlock(at)),
  prefab('tower-block-4', 'Tower block, 4 storeys', 'towers', () => S.towerBlock({ ...at, storeys: 4 })),
  prefab('office-4', 'Glass office, 4 storeys', 'towers', () => S.officeBlock(at)),
  prefab('office-5', 'Glass office, 5 storeys', 'towers', () => S.officeBlock({ ...at, storeys: 5 })),
  prefab('skyscraper-18', 'Skyscraper, 18 storeys', 'towers', () => S.skyscraper(at)),
  prefab('skyscraper-12', 'Skyscraper, 12 storeys', 'towers', () => S.skyscraper({ ...at, storeys: 12 })),
  prefab('backdrop-tower', 'Skyline tower (simple)', 'towers', () => B.backdropTower(at)),
  prefab('water-tower', 'Water tower', 'towers', () => S.waterTower(at)),
  prefab('brick-stack', 'Brick stack', 'towers', () => S.brickStack({ ...at, courses: 7 })),
  prefab('chimney', 'Industrial chimney', 'towers', () => S.industrialChimney(at)),
  prefab('pylon', 'Transmission pylon', 'towers', () => S.latticePylon(at)),
  prefab('crane', 'Tower crane', 'towers', () => S.towerCrane(at)),
  prefab('cooling-tower', 'Cooling tower', 'towers', () => S.coolingTower(at)),
  prefab('wind-turbine', 'Wind turbine', 'towers', () => P.windTurbineSite(at)),
  // industrial
  prefab('warehouse', 'Steel warehouse', 'industrial', () => S.warehouse(at)),
  prefab('warehouse-stocked', 'Warehouse full of gas', 'industrial', () => S.warehouse({ ...at, stock: true })),
  prefab('mill', 'Brick mill', 'industrial', () => S.mill({ ...at, stock: true })),
  prefab('factory', 'Sawtooth factory with stack', 'industrial', () => S.factory({ ...at, stock: true })),
  prefab('factory-plain', 'Sawtooth factory', 'industrial', () => S.factory({ ...at, stack: false })),
  prefab('barn', 'Timber barn', 'industrial', () => S.timberBarn({ ...at, hay: true })),
  prefab('pump-house', 'Pump house', 'industrial', () => S.pumpHouse(at)),
  prefab('pipe-rack', 'Construction services pipe rack', 'industrial', () => S.pipeRack(at)),
  prefab('service-gantry', 'Rope & wiring service gantry', 'industrial', () => serviceGantry(0, 0)),
  prefab('boiler-house', 'Boiler house with flue', 'industrial', () => P.boilerHouse(at)),
  prefab('press-shop', 'Press shop', 'industrial', () => P.pressShop(at)),
  prefab('hvac-plant', 'Rooftop HVAC plant', 'industrial', () => P.hvacPlant(at)),
  prefab('mill-wheel', 'Mill waterwheel', 'industrial', () => P.millWheel(at)),
  // infrastructure
  prefab('car-park', 'Multi-storey car park', 'infrastructure', () => S.carPark({ ...at, cars: 2 })),
  prefab('overpass', 'Road overpass', 'infrastructure', () => S.overpass(at)),
  prefab('truss-bridge', 'Steel truss footbridge', 'infrastructure', () => S.trussBridge(at)),
  prefab('stand', 'Stadium stand', 'infrastructure', () => S.stadiumStand(at)),
  prefab('bus-shelter', 'Bus shelter', 'infrastructure', () => S.busShelter(at)),
  prefab('garden-wall', 'Garden wall', 'infrastructure', () => S.gardenWall({ ...at, length: 12, gate: 2 })),
  prefab('substation', 'Electrical substation', 'infrastructure', () => P.substation(at)),
  prefab('pumping-station', 'Water pumping station', 'infrastructure', () => P.pumpingStation(at)),
  prefab('pole-line', 'Overhead power line', 'infrastructure', () => P.poleLineSite(at)),
  // heritage
  prefab('chapel', 'Chapel and spire', 'heritage', () => S.chapel({ ...at, graves: 5 })),
  prefab('rotunda', 'Domed rotunda', 'heritage', () => S.rotunda(at)),
  prefab('spiral-stair', 'Cast-iron spiral stair', 'heritage', () => S.spiralFolly(at)),
  prefab('arch-bridge', 'Stone arch bridge', 'heritage', () => S.stoneArchBridge(at)),
  prefab('brick-wall', 'Brick-by-brick wall', 'heritage', () => S.brickByBrickWall(at)),
  prefab('cottage-row-5', 'Long cottage terrace', 'heritage', () => S.cottageRow({ ...at, count: 5 })),
  // props
  prefab('car', 'Car', 'props', () => S.car({ ...at, protected: false })),
  prefab('van', 'Panel van', 'props', () => S.van(at)),
  prefab('scaffold-tower', 'Scaffold tower', 'props', () => S.scaffoldTower(at)),
  prefab('crate-stack', 'Crate stack', 'props', () => crates(0, 0, 0, 3, 2, 3)),
  prefab('barrels', 'Barrel cache', 'props', () => drums('barrel', 0, 0, 0, 3, 3)),
  prefab('propane', 'Propane cache', 'props', () => drums('propane', 0, 0, 0, 3, 2)),
  prefab('tnt-stack', 'TNT stack', 'props', () => [...tnt(-0.35, 0, 0, 3), ...tnt(0.35, 0, 0, 2)]),
  prefab('mixed-cache', 'Mixed explosives', 'props', () => S.dump({ ...at, crates: [2, 1, 2], barrels: [2, 2], propane: [2, 1], tnt: 2 })),
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

export function prefabView(p: Prefab): PrefabView {
  const ps = p.build(0, 0, 0);
  const boxes = ps.map(pieceAabb);
  const span = (k: 0 | 2) => Math.max(...boxes.map((b) => b.max[k])) - Math.min(...boxes.map((b) => b.min[k]));
  const r = (v: number) => Math.round(v * 10) / 10;
  return { id: p.id, name: p.name, category: p.category, pieces: ps.length, footprint: [r(span(0)), r(span(2))] };
}
