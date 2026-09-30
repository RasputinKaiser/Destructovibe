import type { Blueprint, Contract, PieceSpec, Vec3, WeaponId } from '../types.ts';
import {
  brickByBrickWall, brickStack, bungalow, busShelter, car, chapel, chipShop, cottageRow, dump, gardenShed,
  gardenWall, greenhouse, industrialChimney, mill, outhouse, overpass, pipeRack, pumpHouse, rng, siteOffice,
  spiralFolly, towerBlock, van, warehouse, waterTower, TINT,
} from './structures.ts';
import { poleLineSite, windTurbineSite } from './plant.ts';
import { raise } from './kit.ts';
import { clearanceZone } from './maps/clearance.ts';
import { heritageYard } from './maps/heritage.ts';
import { downtown } from './maps/downtown.ts';
import { railwayQuarter, RQ } from './maps/railway.ts';
import { excavator } from './machines.ts';
import { pieceAabb } from './validate.ts';
import { DPC } from '../terrain/spec.ts';
import type { Goal } from '../game/scoring.ts';

/** A campaign contract: filed under a chapter on the job board, with what it asks beyond the demolition target. */
export interface Job extends Contract {
  chapter: string;
  goal?: Goal;
  /** one line of site-foreman advice on the failed-job report: what the job actually turns on */
  tip?: string;
}

const bp = (spawn: Vec3, ...parts: PieceSpec[][]): Blueprint => ({ pieces: parts.flat(), spawn: { pos: spawn, yaw: 0 } });
/** a stock structure put on the fee */
const guarded = (parts: PieceSpec[]): PieceSpec[] => parts.map((p) => ({ ...p, protected: true }));

/** Free play: every tool, unlimited. */
/* a full Record so the compiler refuses a new WeaponId that free play forgot to issue */
const ALL_TOOLS: Record<WeaponId, number> = {
  hammer: -1, cannon: -1, rocket: -1, charge: -1, airstrike: -1,
  thermite: -1, cutter: -1, wrecker: -1, winch: -1, gravgun: -1, incendiary: -1, megabomb: -1,
  grinder: -1, saw: -1, drill: -1, shears: -1, plasma: -1, torch: -1,
  planner: -1, excavator: -1, breaker: -1, hose: -1, splitter: -1, wiresaw: -1,
};

const ODD_JOBS: Omit<Job, 'chapter'>[] = [
  {
    id: 'garden-variety',
    name: 'Garden Variety',
    location: '9 Larch Avenue, back garden · 12:05',
    brief: 'The new owners want a lawn, and they want it by teatime: shed, greenhouse, outdoor facilities, the lot — and the back wall. '
      + 'Start with the sledge: hold to wind it up, let go to strike. The greenhouse glass goes at a tap and the privy in a few full '
      + 'swings. The back wall is nearly half the job and the shed is most of the rest: that is cannon work, low. Every ball the '
      + 'sledge saves you is money back.',
    tip: 'Sledge the greenhouse and the privy first, then put the cannonballs into the back wall and the shed, low.',
    target: 0.45,
    par: 120,
    stars: [1800, 2800],
    ammo: { hammer: -1, cannon: 12 },
    env: 'noon',
    build: () => bp([0, 0, 6],
      gardenWall({ x: 0, z: -17, length: 18, gate: 3 }),
      gardenShed({ x: -5, z: -10 }),
      greenhouse({ x: 3.5, z: -10 }),
      outhouse({ x: 9, z: -13 }),
      dump({ x: -10, z: -8, crates: [2, 1, 2], group: 'props' }),
      dump({ x: 6, z: -15.2, barrels: [2, 1] }),
    ),
  },
  {
    id: 'kerb-appeal',
    name: 'Kerb Appeal',
    location: '14 Orchard Close · 16:50',
    brief: 'One brick bungalow, one tired garden wall, one shed nobody will admit to owning. The developer wants a clean plot for six '
      + 'executive homes. Take the walls out from under the eaves — front, sides and back — and the roof does the rest; roofs are '
      + 'heavy and they know it. Give it a few seconds once it starts to go.',
    tip: 'Corners alone will not drop it: spread the cannonballs along the walls under the eaves, all four sides, then wait for the roof.',
    target: 0.6,
    par: 150,
    stars: [20000, 30000],
    ammo: { hammer: -1, cannon: 18 },
    env: 'golden',
    unlockText: 'ROCKETS UNLOCKED',
    build: () => bp([0, 0, 8],
      bungalow({ x: 0, z: -16 }),
      gardenWall({ x: 0, z: -9.5, length: 12, gate: 2 }),
      gardenShed({ x: 9.5, z: -19, rot: 3 }),
      dump({ x: -9, z: -11, crates: [2, 2, 2] }),
    ),
  },
  {
    id: 'high-and-dry',
    name: 'High and Dry',
    location: 'Kettle Lane Pumping Station · 11:15',
    brief: 'The water board has finally noticed the tower has been empty since 1987. Twelve tonnes of tank on four steel legs, and '
      + 'they are cross-braced, so losing one only makes it lean: take both legs out on the side you want it to go. Rockets are new '
      + 'to you, and a leg is thirty centimetres of steel: the readout over the tools says what the shot will land on, so wait for '
      + '"on target: steel" before you fire. The pump house is not precious.',
    tip: 'Rocket both legs on one side, then a cannonball into the lean. Fire when the readout says "on target: steel", not before.',
    target: 0.55,
    par: 120,
    stars: [6000, 10000],
    ammo: { hammer: -1, cannon: 10, rocket: 6 },
    env: 'overcast',
    build: () => bp([0, 0, 6],
      waterTower({ x: -3, z: -18 }),
      pumpHouse({ x: 6.5, z: -12.5 }),
      dump({ x: -5.3, z: -14.6, barrels: [2, 1], group: 'props' }),
      dump({ x: 9.5, z: -10, propane: [2, 1] }),
      gardenShed({ x: -12, z: -12, rot: 1, group: 'stores' }),
    ),
  },
  {
    id: 'four-stacks',
    name: 'Four Stacks, No Scratches',
    location: 'Old Brickworks Yard · 18:40',
    brief: 'Four boiler stacks round a yard, and parked in the middle of it the site office, the foreman\'s van and a surveyor\'s very '
      + 'clean car. Everything tall comes down; everything with wheels or a kettle stays pristine. Three or four cannonballs into '
      + 'the bottom course brings a stack down, but which way it goes once the course lets go is its own business: watch the first '
      + 'one, and pick the side you shoot the rest from by what it did. The rockets stay in the van today.',
    tip: 'Three or four cannonballs into each stack\'s bottom course. Watch which way the first one goes and shoot the rest from the side that sends them away from the vehicles.',
    target: 0.6,
    par: 180,
    stars: [8000, 11000],
    ammo: { hammer: -1, cannon: 14 },
    env: 'dusk',
    protectedNote: 'PROTECTED: site office, van and car — any damage is deducted from your fee.',
    unlockText: 'REMOTE CHARGES UNLOCKED',
    build: () => {
      const r = rng(4);
      const stacks = ([[-12, -12], [12, -12], [-12, -28], [12, -28]] as const).map(([x, z], i) =>
        brickStack({ x, z, courses: 6 + Math.floor(r() * 3), tint: [0xffffff, TINT.brickPale, 0xf0ddd0, TINT.brickDark][i], group: `stack${i + 1}` }));
      return bp([0, 0, 4],
        ...stacks,
        siteOffice({ x: 0, z: -20 }),
        van({ x: -1.5, z: -26 }),
        car({ x: 1.5, z: -14 }),
        dump({ x: 17, z: -20, crates: [2, 2, 2] }),
      );
    },
  },
  {
    id: 'hot-property',
    name: 'Hot Property',
    location: 'Unit 7, Canal Wharf · 23:10',
    brief: 'Steel shed, tin skin, and a previous tenant who stored propane like it was a hobby. It all has to go before the insurers '
      + 'wake up, and the canal trust\'s gatehouse by the road is let and staying. No guns on this one: walk in, set the charges on '
      + 'the steel columns (the wheel sizes them), walk out, G. The gas is stacked down the gatehouse side and goes when the columns '
      + 'do: the smaller the charges, and the further from the gas, the less of the fireball reaches the gatehouse.',
    target: 0.55,
    par: 150,
    stars: [50000, 70000],
    ammo: { hammer: -1, charge: 6 },
    env: 'night',
    protectedNote: 'PROTECTED: the canal trust gatehouse by the road — let, occupied, and not insured for propane.',
    unlockText: 'TOW WINCH ISSUED',
    tip: 'Charges on the steel columns within arm\'s reach, the wheel turned down, G from well back. Big charges light all the gas at once.',
    build: () => bp([0, 0, 6],
      warehouse({ x: 0, z: -20, stock: true }),
      guarded(pumpHouse({ x: -31, z: -5, rot: 1, group: 'gatehouse' })),
      dump({ x: 13, z: -9, barrels: [3, 2], propane: [2, 1] }),
    ),
  },
  {
    id: 'tall-order',
    name: 'The Tall Order',
    location: 'Bramley Mill · 07:40',
    brief: 'Twenty-six metres of Victorian chimney, a mill that should have closed with the Victorians, and a terrace of cottages '
      + 'whose residents are watching from their front steps. The stack is the job: the mill can go any way you like, the chimney '
      + 'has to be on the ground and not on the terrace. Its plinth is three metres of solid brick; the shaft above it is what '
      + 'you cut. Nobody on this crew has felled one this tall, so take it steady and watch which way it leans.',
    tip: 'Cannon the stack\'s shaft just above the plinth, one face, from the mill side, and watch it lean before you add more. The mill goes on charges along its ground-floor piers.',
    target: 0.65,
    par: 240,
    stars: [65000, 90000],
    goal: { fell: { group: 'chimney', what: 'the chimney', below: 6, from: 12 } },
    ammo: { hammer: -1, cannon: 12, charge: 6, winch: 2 },
    env: 'golden',
    protectedNote: 'PROTECTED: the cottage terrace to the west is occupied. Nothing falls west.',
    unlockText: 'AIRSTRIKE UNLOCKED',
    build: () => bp([3, 0, 3],
      industrialChimney({ x: -2, z: -24 }),
      mill({ x: 14, z: -24 }),
      cottageRow({ x: -31, z: -24, protected: true }),
    ),
  },
  {
    id: 'road-closed',
    name: 'Road Closed',
    location: 'Junction 9 flyover · 05:30',
    brief: 'The flyover failed its inspection in several languages. We have a two-hour closure, so all four spans on the ground before '
      + 'the rush. Piers first, deck follows. Stores sent four charges for six columns, so the rest is up to the cannon and the '
      + 'rockets; someone also abandoned a lorry-load of fuel up top. The bus shelter is council property.',
    tip: 'Three pier bents of two columns each: four charges low on four columns, cannon or rockets on the other two, G from well back.',
    target: 0.75,
    par: 180,
    stars: [60000, 90000],
    ammo: { hammer: -1, cannon: 8, rocket: 3, charge: 4, airstrike: 1 },
    env: 'overcast',
    protectedNote: 'PROTECTED: the bus shelter by the east abutment.',
    unlockText: 'CUTTING CHARGES UNLOCKED',
    build: () => bp([-4, 0, 6],
      overpass({ x: 0, z: -20, traffic: true }),
      busShelter({ x: 25, z: -10 }),
      dump({ x: -10.5, z: -14.6, crates: [1, 1, 1], barrels: [2, 1] }),
    ),
  },
  {
    id: 'last-orders',
    name: 'Last Orders',
    location: 'Carrow Heights · 21:00',
    brief: 'Six storeys of 1960s optimism, now mostly pigeons. Bring it straight down into its own footprint: take the ground-floor '
      + 'columns and let gravity handle the paperwork. Nine columns, five charges and four of the new cutting charges: one to a '
      + 'column, fired together. A cutting charge goes on along the line it shows and severs the column clean, and throws next to '
      + 'nothing: those go on the side facing the chip shop across the road, which is open until midnight and staying open.',
    target: 0.9,
    par: 240,
    stars: [90000, 115000],
    tip: 'Nine ground-floor columns in a three-by-three grid, one device each, low: cutting charges on the row facing the chip shop, charges on the rest, then G.',
    ammo: { hammer: -1, charge: 5, cutter: 4, airstrike: 1 },
    env: 'night',
    protectedNote: 'PROTECTED: the chip shop and the car outside it. Topple the tower east and you will pay for both.',
    build: () => bp([-6, 0, 4],
      towerBlock({ x: 0, z: -22 }),
      dump({ x: -2.8, z: -19.5, propane: [2, 1], group: 'props' }),
      chipShop({ x: 19, z: -12, rot: 3 }),
      car({ x: 21.5, z: -4, tint: TINT.carTeal }),
    ),
  },
];

/* ---------------- contracts on the free-play maps ---------------- */

/** A contract's cut of a free-play map. `clear`: building groups taken down to what lies below the damp course
    (footings, basements, the slab), the plot already cleared; `retag`: pieces moved into a new group by test, in
    order; `protect`: groups on the fee; `spawn`: where the crew is set down (y on the level it names). */
function scoped(bp: Blueprint, o: { clear?: string[]; retag?: [string, (p: PieceSpec) => boolean][]; protect?: string[]; spawn?: [number, number, number, number] }): Blueprint {
  const clear = new Set(o.clear ?? []), guard = new Set(o.protect ?? []);
  const pieces = bp.pieces
    .filter((p) => !p.group || !clear.has(p.group) || pieceAabb(p).max[1] <= DPC + 0.01)
    .map((p) => {
      const q = { ...p };
      for (const [g, test] of o.retag ?? []) if (test(q)) { q.group = g; break; }
      if (q.group && guard.has(q.group)) q.protected = true;
      return q;
    });
  const spawn = o.spawn ? { pos: [o.spawn[0], o.spawn[1], o.spawn[2]] as Vec3, yaw: o.spawn[3] } : bp.spawn;
  return { ...bp, pieces, spawn };
}

const low = (p: PieceSpec) => pieceAabb(p).min[1];
const DT_BLOCKS = ['tower', 'skyscraper2', 'office', 'stand', 'store', 'carpark', 'flats', 'flats2', 'gasholder'];
const except = (all: string[], ...keep: string[]) => all.filter((g) => !keep.includes(g));

const HERITAGE_JOBS: Job[] = [
  {
    id: 'hot-works',
    chapter: 'The Heritage Yard',
    name: 'Hot Works',
    location: 'Heritage Yard, canal footbridge · 06:20',
    brief: 'The museum\'s steel truss footbridge failed its inspection: the bottom chords are more rust than rivet. It comes out for '
      + 'scrap, and it comes out quietly: no explosives on a heritage site. Disc cutter, torch, plasma and shears. Cut the chords '
      + 'and the end posts at the bearings and the span drops into the dry cut on its own weight.',
    target: 0.6,
    par: 240,
    stars: [0, 0],
    ammo: { hammer: -1, grinder: 10, torch: 4, plasma: 8, shears: 3 },
    env: 'noon',
    protectedNote: 'PROTECTED: the listed stone arch bridge and the mill wheel turning beside the footbridge.',
    unlockText: 'WRECKING BALL UNLOCKED',
    goal: { groups: ['trussbridge'], what: 'the truss footbridge' },
    build: () => scoped(heritageYard(), { protect: ['archbridge', 'millwheel'], spawn: [19, 0, 6, -1.25] }),
  },
  {
    id: 'swing-time',
    chapter: 'The Heritage Yard',
    name: 'Swing Time',
    location: 'Heritage Yard, Market Street terrace · 10:30',
    brief: 'A Victorian terrace with a pub on the end, moved here brick by numbered brick in 1978 and not loved since. The crane is on '
      + 'hire by the hour: swing the ball through the front walls, let the floors fold, and break out what is left standing. '
      + 'The boiler house is three metres from the gable and the rotunda is listed; both are staying.',
    target: 0.7,
    par: 240,
    stars: [0, 0],
    ammo: { hammer: -1, wrecker: 16, breaker: -1 },
    env: 'golden',
    protectedNote: 'PROTECTED: the boiler house off the west gable, and the rotunda across Museum Street.',
    unlockText: 'FIREBOMBS UNLOCKED',
    goal: { groups: ['terrace'], what: 'the terrace and pub' },
    build: () => scoped(heritageYard(), { protect: ['boilerhouse', 'rotunda'], spawn: [-5, 0, 30, 0] }),
  },
  {
    id: 'slow-burn',
    chapter: 'The Heritage Yard',
    name: 'Slow Burn',
    location: 'Heritage Yard, tithe barn · 19:45',
    brief: 'The oak barn has death-watch beetle, dry rot and a preservation order that lapsed at midnight. The brigade will allow a '
      + 'controlled burn on one condition: the mill next door does not so much as singe. Firebombs to light it, the chainsaw for '
      + 'the posts, and the water cannon to keep the fire on your side of the yard.',
    target: 0.65,
    par: 300,
    stars: [0, 0],
    ammo: { hammer: -1, incendiary: 6, saw: 4, hose: -1 },
    env: 'dusk',
    protectedNote: 'PROTECTED: the mill and its stock, eight metres west of the barn. Nothing of it burns.',
    unlockText: 'WIRE SAW UNLOCKED',
    goal: { groups: ['barn'], what: 'the barn' },
    build: () => scoped(heritageYard(), { protect: ['mill'], spawn: [35, 0, -13, 0.15] }),
  },
  {
    id: 'sanctuary',
    chapter: 'The Heritage Yard',
    name: 'Sanctuary',
    location: 'Heritage Yard, St Oswald\'s · 07:00',
    brief: 'The church comes down to its crypt, and the diocese wants it down inside its own churchyard: the mill is ten metres off '
      + 'the chancel. Stone does not bend, it lets go, so plan it. Drill and split the pier bases, wire-saw the tower, sequence the '
      + 'charges on the detonator panel and lay the spire along the nave.',
    target: 0.7,
    par: 360,
    stars: [0, 0],
    ammo: { hammer: -1, drill: 6, splitter: -1, wiresaw: -1, planner: -1, charge: 12, cutter: 6 },
    env: 'overcast',
    protectedNote: 'PROTECTED: the mill east of the chancel and the arch bridge over the cut.',
    unlockText: 'RAILWAY QUARTER OPEN',
    goal: { groups: ['cathedral'], what: 'the church', footprint: [-48, -4, -47, -11] },
    build: () => scoped(heritageYard(), { protect: ['mill', 'archbridge'], spawn: [-26, 0, 6, 0] }),
  },
];

const RAILWAY_JOBS: Job[] = [
  {
    id: 'half-measures',
    chapter: 'The Railway Quarter',
    name: 'Half Measures',
    location: 'Viaduct Road bridge · 04:50',
    brief: 'Half the Viaduct Road bridge is being replaced; the other half carries the diversion from six o\'clock. Drop the west '
      + 'span into the dry river bed and leave the east span, its bearings and its half of the pier as they are. The spans share '
      + 'nothing but a movement joint: cut at the west bearings and the portal and let it go.',
    target: 0.55,
    par: 300,
    stars: [0, 0],
    ammo: { hammer: -1, torch: 4, plasma: 8, cutter: 6, wiresaw: -1 },
    env: 'night',
    protectedNote: 'PROTECTED: the east span, its bearings and its half of the river pier.',
    unlockText: 'EXCAVATOR UNLOCKED',
    goal: { groups: ['westspan'], what: 'the west span' },
    build: () => scoped(railwayQuarter(), {
      clear: ['station', 'stadium'],
      retag: [['westspan', (p) => p.group === 'roadbridge' && p.pos[0] < RQ.bridge.x && p.pos[0] > RQ.bridge.x - 42.4 && low(p) >= 2.0],
        ['eastspan', (p) => p.group === 'roadbridge' && p.pos[0] > RQ.bridge.x]],
      protect: ['eastspan'],
      spawn: [-20, 0, -52, 0],
    }),
  },
  {
    id: 'dust-to-dust',
    chapter: 'The Railway Quarter',
    name: 'Dust to Dust',
    location: 'Railway Terrace, nos. 1–4 · 09:00',
    brief: 'Four railway cottages, empty since the line closed, and four more next door with people in them. This is a machine job: '
      + 'walk the excavator up, pull them down into their own plots, break out what is left with the breaker, and keep the hose '
      + 'on the dust. The neighbours have the council on speed dial.',
    target: 0.6,
    par: 360,
    stars: [0, 0],
    ammo: { hammer: -1, excavator: -1, breaker: -1, hose: -1 },
    env: 'noon',
    protectedNote: 'PROTECTED: nos. 5–8, the occupied cottages east of the gap.',
    unlockText: 'THERMITE UNLOCKED',
    goal: { groups: ['cottages-west'], what: 'nos. 1–4' },
    build: () => scoped(railwayQuarter((lv) => raise(excavator({ x: -70, z: 55, rot: 1 }), lv(-70, 55))), {
      clear: ['stadium', 'millworks'],
      retag: [['cottages-west', (p) => p.group === 'cottages' && p.pos[0] < -57]],
      protect: ['cottages'],
      spawn: [-57, 0, 50.8, Math.PI],
    }),
  },
  {
    id: 'final-whistle',
    chapter: 'The Railway Quarter',
    name: 'Final Whistle',
    location: 'Medlock Road ground · 15:00',
    brief: 'The club has moved to a shed by the ring road. Both stand roofs and the four masts come off before the terraces are '
      + 'broken out, and the steel goes for scrap. Thermite the columns behind the rakers, cut the cantilevers, winch what hangs. '
      + 'A 40 m mast falls 40 m: lay them on the pitch, not across Mill Street. The scrap lorries arrive at twenty to five.',
    target: 0.7,
    par: 300,
    stars: [0, 0],
    ammo: { hammer: -1, thermite: 16, torch: 4, cutter: 4, winch: 4 },
    env: 'overcast',
    protectedNote: 'PROTECTED: the cotton mill across Mill Street, under the north masts.',
    unlockText: 'GRAVITY GUN UNLOCKED',
    goal: { groups: ['roofs'], what: 'the stand roofs and masts', limit: 480 },
    build: () => scoped(railwayQuarter(), {
      clear: ['station', 'cottages'],
      retag: [['roofs', (p) => p.group === 'stadium' && p.mat !== 'rconcrete' && p.mat !== 'concrete']],
      protect: ['millworks'],
      spawn: [RQ.stadium.x, 0, RQ.stadium.z, 0],
    }),
  },
  {
    id: 'lost-property',
    chapter: 'The Railway Quarter',
    name: 'Lost Property',
    location: 'Victoria Road terminus · 13:10',
    brief: 'The train shed is coming down; the booking hall is listed and is not. First the lost-property store has to be emptied: '
      + 'crates and gas bottles left all along the island platform. Carry them out into the goods yard with the gravity gun. '
      + 'Anything still under the roof when the charges go will not be coming out in one piece.',
    target: 0.5,
    par: 420,
    stars: [0, 0],
    ammo: { hammer: -1, gravgun: -1, charge: 12, cutter: 6, planner: -1 },
    env: 'golden',
    protectedNote: 'PROTECTED: the booking hall and clock tower, hard against the south end of the shed.',
    unlockText: 'MEGABOMB UNLOCKED',
    goal: {
      groups: ['shed'], what: 'the train shed',
      salvage: { group: 'salvage', zone: [-80, -26, -60, -45], need: 0.75, what: 'lost-property items', where: 'the goods yard' },
    },
    build: () => {
      const s = RQ.station;
      const stock = (lz: number, i: number) => dump({ x: s.x - 4, z: s.z + lz, y: 0.9 + DPC, crates: [1, 1, 1 + (i & 1)], propane: [2, 1], group: 'salvage' });
      return scoped(railwayQuarter(() => [-24, -32, -46].flatMap(stock)), {
        clear: ['stadium', 'millworks'],
        retag: [['shed', (p) => p.group === 'station' && p.pos[2] < s.z - 8 && low(p) > 1.0],
          ['bookinghall', (p) => p.group === 'station' && p.pos[2] > s.z - 0.1]],
        protect: ['bookinghall'],
        spawn: [s.x, 0, -50, Math.PI],
      });
    },
  },
];

const DOWNTOWN_JOBS: Job[] = [
  {
    id: 'steel-nerve',
    chapter: 'Downtown',
    name: 'Steel Nerve',
    location: 'Tower Street, Downtown · 02:00',
    brief: 'Five storeys of steel-framed office over a basement, glazed on every face, in the middle of a district that is still '
      + 'lived in. Tower Street reopens at six. Thermite eats through a column in under a minute and leaves the beams to sort '
      + 'themselves out; cutting charges finish what it starts. The flats across the street and the tower next door are occupied.',
    target: 0.65,
    par: 300,
    stars: [0, 0],
    ammo: { hammer: -1, thermite: 14, cutter: 6, torch: 3 },
    env: 'night',
    protectedNote: 'PROTECTED: the flats across Tower Street and the Tower Street tower to the west.',
    goal: { groups: ['office'], what: 'the office', limit: 540 },
    build: () => scoped(downtown(), { clear: except(DT_BLOCKS, 'office', 'flats', 'skyscraper2'), protect: ['flats', 'skyscraper2'], spawn: [18, 0, -31.5, 0] }),
  },
  {
    id: 'big-finish',
    chapter: 'Downtown',
    name: 'The Big Finish',
    location: 'Carrow Tower, Downtown · 20:00',
    brief: 'Thirty-four storeys on a piled raft, and a developer who wants it gone in one evening for the cameras. One megabomb, two '
      + 'airstrikes and a crate of charges. The Art Deco store across the road is listed and full of shop fittings: put the '
      + 'tower down north, into the cleared plots, and keep every storey of it out of the store.',
    target: 0.6,
    par: 300,
    stars: [0, 0],
    ammo: { hammer: -1, megabomb: 1, airstrike: 2, charge: 12, planner: -1 },
    env: 'dusk',
    protectedNote: 'PROTECTED: the department store south of the tower. It is listed; it is also full of glass.',
    goal: { groups: ['tower'], what: 'the tower' },
    build: () => scoped(downtown(), { clear: except(DT_BLOCKS, 'tower', 'store'), protect: ['store'], spawn: [-29, 0, -31.5, 0.8] }),
  },
];

const filed = (chapter: string, list: Omit<Job, 'chapter'>[]): Job[] => list.map((c) => ({ ...c, chapter }));

export const CONTRACTS: Job[] = [...filed('Odd Jobs', ODD_JOBS), ...HERITAGE_JOBS, ...RAILWAY_JOBS, ...DOWNTOWN_JOBS];

/* Site plan and utility grid: see maps/clearance.ts. */
export const SANDBOX: Contract = {
  id: 'sandbox',
  name: 'Clearance Zone',
  location: 'Hollins Estate, whole-quarter clearance · any time',
  brief: 'A whole quarter slated for clearance while it is still plumbed in: High Street shops and a pub, Terrace Row, the works yard, '
    + 'a half-built frame on the construction site, the chapel over the canal cut. One substation, one gas governor and one pump hall feed all of it. '
    + 'Cut the right cable and a street goes dark; cut the wrong main and it burns. No targets, no clock, no invoices.',
  target: 0,
  par: 0,
  stars: [0, 0],
  ammo: ALL_TOOLS,
  env: 'golden',
  build: clearanceZone,
};

/* A second free-play site for the craft pieces: every period material in one yard (site plan: maps/heritage.ts). */
export const SHOWCASE: Contract = {
  id: 'showcase',
  name: 'The Heritage Yard',
  location: 'Open-air building museum, after hours · any time',
  brief: 'A museum of how things used to be built, assembled one voussoir, brace and brick at a time by volunteers with a lot of patience. '
    + 'The trustees want the site cleared for a car park. Oak burns slow, cast iron snaps, sandstone crumbles; find out which in what order.',
  target: 0,
  par: 0,
  stars: [0, 0],
  ammo: ALL_TOOLS,
  env: 'golden',
  build: heritageYard,
};

/* Downtown: the central business district, site plan in maps/downtown.ts. */
export const DOWNTOWN: Contract = {
  id: 'downtown',
  name: 'Downtown',
  location: 'Central business district, closed for redevelopment · dusk',
  brief: 'The whole district has been sold to a developer who wants a very large hole. Two towers, offices, a car park, flats, a stand '
    + 'from the old ground and a crane nobody remembered to take down. Everything is on the list. Mind the traffic, there is none.',
  target: 0,
  par: 0,
  stars: [0, 0],
  ammo: ALL_TOOLS,
  env: 'dusk',
  build: downtown,
};

/* The Railway Quarter: terminus, mill, football ground and road bridge, site plan in maps/railway.ts. */
export const RAILWAY: Contract = {
  id: 'railway',
  name: 'Railway Quarter',
  location: 'Medlock goods district, closed for regeneration · any time',
  brief: 'The terminus and its train shed, the cotton mill with its engine house and sixty-metre chimney, the football ground, and '
    + 'the riveted road bridge over the dry river, in one quarter the regeneration board wants flat by spring. One substation '
    + 'lights the streets. No targets, no clock, no invoices.',
  target: 0,
  par: 0,
  stars: [0, 0],
  ammo: ALL_TOOLS,
  env: 'overcast',
  build: () => railwayQuarter(),
};
