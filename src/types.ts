/* Shared contract between game core, rendering, UI/audio and level data.
   Units: metres, seconds, kilograms. Y is up. Ground surface is y = 0.
   Vectors and quaternions are plain arrays (the `math` / box3d.js convention). */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/* ---------------- materials ---------------- */

export type MaterialId =
  | 'concrete'    // plain (unreinforced) concrete: grey, brittle in tension, dusty chunks
  | 'rconcrete'   // reinforced concrete: fragments stay tied by rebar that stretches, then snaps
  | 'brick'       // fired clay brick in lime/cement mortar — strong in compression, weak joints in tension
  | 'cinderblock' // hollow concrete masonry units (CMU): light, crumbly
  | 'stone'       // granite/limestone ashlar: very strong in compression, breaks into few clean chunks
  | 'sandstone'   // soft sedimentary stone: crumbles to sand
  | 'marble'      // white/veined, brittle, conchoidal breaks (columns, statues, cladding)
  | 'terracotta'  // decorative fired clay (cornices, finials, chimney pots): brittle
  | 'ceramic'     // glazed architectural tile: hard shiny surface, brittle porous body
  | 'asphalt'     // bituminous paving: dense aggregate bound by heat-softening tar
  | 'copper'      // copper sheet, pipework, busbars, heavy cable: ductile, conducts, melts ~1085 °C
  | 'adobe'       // rammed earth / mud brick: weak, crumbles to dust
  | 'plaster'     // painted render over masonry (use `tint`)
  | 'drywall'     // gypsum board partitions: weak, powdery
  | 'wood'        // softwood (pine) planks, joists, studs: snaps, splinters, burns fast
  | 'oak'         // hardwood beams/posts: dense, stronger, burns slow
  | 'plywood'     // sheathing / decking panels: delaminates rather than snapping
  | 'steel'       // structural steel: ductile — yields and bends (plastic hinges), softens in fire
  | 'castiron'    // Victorian columns/brackets: strong but brittle, snaps clean, no bending
  | 'aluminum'    // mullions, window frames, cladding: light, ductile, softens early in heat
  | 'metal'       // sheet / corrugated steel: sheds, containers, trailers
  | 'glass'       // annealed window glass: long radial shards
  | 'tempered'    // tempered safety glass (curtain walls, doors): bursts into small cubes
  | 'roof'        // clay tiles / shingles
  | 'crate'       // loose wooden crate
  | 'barrel'      // red explosive barrel (explodes when damaged)
  | 'propane'     // white propane tank (big explosion)
  | 'tnt'         // dynamite crate (explodes)
  | 'pvc'         // plastic conduit, drains, cable sheathing: light, softens ~80 °C, burns with black smoke
  | 'lamp'        // light fitting (glass + filament): shatters, glows while energised
  | 'machine'     // cast/fabricated machinery housing (motors, pumps, transformers, boilers): heavy, painted steel
  | 'insulation'  // rigid PIR/EPS foam board: crushes to a plateau and stays crushed, melts and burns sooty
  | 'frp'         // glass/carbon fibre-reinforced polymer panels and laminates: strong, brittle, delaminates
  | 'cardboard'   // corrugated board, paper stock, packaging: crushes, tears, goes soft when wet, burns fast
  | 'rubber';     // natural/EPDM rubber mounts, pads, seals, tyres: soft, viscoelastic, heavily damped

export type Quality = 'low' | 'medium' | 'high';
export type EnvPreset = 'noon' | 'golden' | 'overcast' | 'dusk' | 'night';
export type WeaponId =
  | 'hammer' | 'cannon' | 'rocket' | 'charge' | 'airstrike'          // bank 1 (campaign unlock order)
  | 'thermite'    // sticky pot that burns ~2500 °C for several seconds: cuts steel by heat, ignites timber
  | 'cutter'      // linear shaped charge: severs the member it is placed on along a clean plane, tiny blast
  | 'wrecker'     // crawler crane with a wrecking ball: luffed boom, pull-back swing or a free-fall drop
  | 'winch'       // tow cables (up to three) to ground stakes or a vehicle; snatch blocks; hold fire to reel in
  | 'gravgun'     // grab a loose piece, carry it, fire again to throw it
  | 'incendiary'  // thrown firebomb: ignites everything flammable in a splash radius, burning ground patch
  | 'megabomb'    // sandbox-only: enormous blast with shockwave
  | 'grinder'     // held 230 mm disc cutter: abrasive disc on metal, diamond on masonry; progressive kerf
  | 'saw'         // held chainsaw for timber; pinches and kicks back on the compression side
  | 'drill'       // held drill rig: hammer drill in masonry, annular cutter in steel; holes weaken the net section
  | 'shears'      // held hydraulic jaws: shear steel / crush concrete, force-limited
  | 'plasma'      // held plasma cutter: fast narrow kerf through conductive metal only
  | 'torch'       // held oxy-fuel torch: preheat to ignition, then cuts thick steel; lights timber
  | 'planner'     // detonator panel: per-device delays (0-5000 ms), auto-sequencing, fires the timeline
  | 'excavator'   // radio remote for the nearest excavator: bucket follows the aim, digs the terrain, dumps
  | 'breaker'     // handheld hydraulic breaker: percussive chipping of concrete and masonry, exposes rebar
  | 'hose'        // water cannon / fire monitor: ballistic stream douses fires and shoves light debris
  | 'splitter'    // hydraulic wedge splitter in a drilled hole: cracks a block or member along the hole
  | 'wiresaw'     // diamond wire saw looped round a member: slow, unattended cut through any section
  | 'grapple'     // pneumatic grapple launcher: a grapnel on HMPE line, reeled by a powered ascender (haul in, climb)
  | 'tether'      // rigging lines: wire rope, nylon kinetic rope or chain tied between members, vehicles, ground anchors
  | 'hoist'       // 3.2 t lever hoist: a hand-ratcheted chain pull, slow and strong
  | 'flamer'      // bank VI: portable flamethrower, a burning rope of thickened fuel that splashes, sticks and pools
  | 'launcher'    // 40 mm grenade launcher: arcing low-velocity HE-frag, impact or airburst fuze
  | 'recoilless'  // 84 mm recoilless rifle, HEAT: a shaped-charge jet that holes what it perforates, spall behind
  | 'thermobaric' // thermobaric rocket: disperses a fuel cloud, then lights it; fills the room it lands in
  | 'buster'      // bunker buster: laser designator for a delay-fuzed penetrating bomb that counts the floors it passes
  | 'satchel';    // satchel charge: 9 kg of plastic explosive in a bag, thrown, fired from the detonator

/** building-services networks: members of the same kind conduct to each other through their welds */
export type UtilityKind = 'power' | 'gas' | 'water' | 'steam';

/**
 * Sources (live while intact): transformer, generator (power) · gasmain (gas) · watermain (water) · boiler (steam).
 * Consumers: lamp (lights while energised) · radiator (steam heating) · motor (drives `mech` motors while energised).
 */
export type FixtureKind = 'transformer' | 'generator' | 'gasmain' | 'watermain' | 'boiler' | 'lamp' | 'radiator' | 'motor';

export type SvcPart = 'fitting' | 'sprinkler' | 'breaker' | 'fuse' | 'efv' | 'valve';

/** tools that only exist in free play */
export type SandboxToolId = 'spawn' | 'delete';

/* ---------------- level data ---------------- */

export interface PieceSpec {
  mat: MaterialId;
  /** full extents (x, y, z) in metres, before rotation */
  size: Vec3;
  /** centre, world metres */
  pos: Vec3;
  /** yaw in radians about +Y (default 0) */
  rotY?: number;
  /**
   * 'box'      — size = full extents (default)
   * 'cylinder' — Y-axis cylinder, radius size[0]/2, height size[1] (size[2] ignored), smooth-shaded
   * 'prism'    — Y-axis regular n-gon prism (`sides`, default 8), across-flats size[0], height size[1], faceted
   * 'wedge'    — right-triangle prism inside the size box: full height at -X, sloping to zero height at +X
   *              (ramps, roof pitches, buttresses; turn it with rotY), extruded along Z
   * 'hull'     — convex hull of `verts` (local, relative to pos, before rotY): voussoirs, keystones,
   *              dome/spire segments, tapered columns. `size` must still be the hull's bounding extents.
   */
  shape?: 'box' | 'cylinder' | 'prism' | 'wedge' | 'hull';
  /** prism side count (3..24) */
  sides?: number;
  /** hull points, local metres */
  verts?: Vec3[];
  /** 0xRRGGBB paint multiplier for exterior faces */
  tint?: number;
  /**
   * Exterior surface finish, render-only (physics still follows `mat`). Default: the material's own look.
   * 'paint' automotive/enamel gloss with clearcoat · 'satin' powder-coat/machinery enamel · 'galv' galvanised
   * steel · 'chrome' · 'rubber' tyres, seals · 'smoked' tinted glass · 'decal' hazard/livery striping ·
   * 'joinery' painted timber (satin sheen, sparse pale-undercoat chips on arrises, no bare metal).
   */
  finish?: 'paint' | 'satin' | 'galv' | 'chrome' | 'rubber' | 'smoked' | 'decal' | 'joinery';
  /** weld to the ground even if the piece is not touching y = 0 */
  anchored?: boolean;
  /** damaging / displacing it costs a penalty; excluded from the demolition % */
  protected?: boolean;
  /** diagnostics only: '<building>/<part>' that authored this piece (building packages); ignored by physics */
  part?: string;
  /** loose prop: never auto-welded to anything */
  noWeld?: boolean;
  /**
   * Dormant detail: the real layers/units this member is made of (bricks and mortar courses, cavity leaves,
   * insulation, plasterboard, joists and boarding, tiles and battens, cladding rails…), world-space like any
   * PieceSpec and inside this member's bounds. Rendered (instanced) but NOT simulated while the member is
   * intact — the member stays one rigid body carrying their mass. Where the member is damaged or fractured
   * the detail near the damage activates into real pieces, so walls come apart layer by layer and unit by unit.
   */
  detail?: PieceSpec[];
  /** detail units only: which leaf of a layered member the unit belongs to (a fracture parts the leaves of a cavity
   * wall, tied across the cavity); 255 marks wall ties bridging leaves. Default 0. */
  layer?: number;
  /** kg/m³, overriding the material's density (hollow or upholstered furniture); fragments inherit it */
  density?: number;
  /** Coulomb friction coefficient overriding the material's (tyres 0.9, rubber pads 0.8, greased skids 0.1) */
  friction?: number;
  /** Tension-only rigging or light electrical cable from this member's centre to the
   * member containing end. Placement rotates/translates the endpoint with the building. */
  ropeTo?: { end: Vec3; slack?: number; strength?: number; kind?: 'rope' | 'wire' | 'chain' };
  /**
   * Structural section this member's bounding box stands for. Sets the real mass (steel UC/UB are ~5–15 %
   * solid), the section's axial/bending capacity, and — via compound parts — its true collision and render
   * profile. Default: solid. Dimensions in metres.
   */
  section?: {
    kind: 'I' | 'channel' | 'angle' | 'tee' | 'rhs' | 'chs' | 'hollowcore' | 'hollowblock';
    /** flange / wall thickness */ t?: number;
    /** web thickness (I, channel, tee) */ tw?: number;
    /** which local axis the member runs along (default: the longest) */ axis?: 0 | 1 | 2;
    /** local axis of the section depth — the web's plane, the direction flanges are spaced along
     * (default: the larger cross extent; on a tie Y, else Z). Channels open toward +width, tees carry the flange at +depth. */
    depth?: 0 | 1 | 2;
  };
  /**
   * Non-convex member: ONE rigid body made of several convex parts, each relative to `pos` before `rotY`
   * (e.g. an L-shaped wall, a cranked beam, a machine casting). `size` stays the overall bounding extents.
   * Fracture releases parts first, then breaks them individually.
   */
  parts?: { shape?: 'box' | 'cylinder' | 'prism' | 'wedge' | 'hull'; size: Vec3; pos: Vec3; rotY?: number; sides?: number; verts?: Vec3[] }[];
  /**
   * Hybrid bodies simulated outside the rigid solver (position-based dynamics), coupled to rigid pieces.
   * Points are world-space; place() transforms them. Pinned points attach to the member containing them,
   * or to the world when none does, and follow it; they tear loose above `tear` N.
   */
  soft?: {
    /** balloon: closed pressurised ellipsoid · inflatable: closed pressurised box (dunnage bag, bouncy castle) ·
     * dome: air-supported membrane, its rim pinned · carton: creased cardboard box that crushes · paper: a stack
     * that scatters loose sheets when blasted (no particles until then) */
    kind: 'cloth' | 'net' | 'rope' | 'softbody' | 'granular' | 'balloon' | 'inflatable' | 'dome' | 'carton' | 'paper';
    /** cloth/net: 4 corners (a,b,c,d going round the sheet). rope: 2 ends, or a polyline (knots, wraps).
     * softbody/granular/balloon/inflatable/dome/carton/paper: 2 opposite box corners (dome: the low one is the rim) */
    pts: Vec3[];
    /** pinned points (subset of the sheet/rope, e.g. the top edge corners) — 'top' pins the a→b edge.
     * balloon: one point, the anchor its string is tied to */
    pins?: Vec3[] | 'top' | 'corners' | 'ends';
    fabric?: 'canvas' | 'cotton' | 'velvet' | 'poly' | 'mesh' | 'tarp' | 'foam' | 'sand' | 'gravel' | 'soil' | 'hemp' | 'steelwire'
      | 'latex' | 'pvc' | 'kraft' | 'cardboard' | 'paper' | 'thread';
    /** grid spacing m (default by kind) */ res?: number;
    tint?: number;
    /** tear/pull-out force per pin or per edge, N */ tear?: number;
    /** pressurised kinds: gauge pressure at the authored size, Pa */ gauge?: number;
    /** fill gas (balloons float on helium) */ gas?: 'air' | 'helium';
    /** dome: blower capacity keeping the gauge up while the host stands, m³/s */ blower?: number;
    /** cloth: sewn panel width, m (seams run down the sheet); 0 for one piece. Default by fabric */ seams?: number;
    /** paper: sheets in the stack */ count?: number;
  };
  /** building services: this member carries power / gas / water / steam to welded members of the same kind */
  util?: UtilityKind;
  /** service fixture; sources and consumers imply `util` (transformer → power, boiler → steam, lamp → power, …) */
  fixture?: FixtureKind;
  /**
   * Service detail: 'fitting' elbow / tee (a weak point) · 'sprinkler' head (opens at 68 °C or when broken) ·
   * 'breaker' consumer unit / distribution board (MCB + RCD) · 'fuse' service cut-out / feeder fuse (bolted faults only) ·
   * 'efv' gas meter / excess-flow valve · 'valve' isolator.
   */
  svcPart?: SvcPart;
  /** nominal bore (pipes) or supply orifice (sources), m; the physical piece may be drawn fatter than this */
  bore?: number;
  /** lamps: emitted light */
  light?: { color: number; intensity: number; range: number };
  /**
   * Machinery: instead of welding, join this piece to the member containing `at` (or to the world when no
   * member contains it) with a hinge (fans, flywheels, rollers, waterwheels, doors) or a slider (lifts, presses,
   * gates). `at` and `axis` are world-space; place() transforms them with the building. Set noWeld as well.
   * A motor runs only while the host member (or a `motor` fixture welded to it) is energised, unless `always`.
   */
  mech?: {
    kind: 'hinge' | 'slider';
    at: Vec3;
    axis: Vec3;
    /** limits: radians (hinge) or metres from the start pose along axis (slider) */
    lower?: number; upper?: number;
    motor?: MechMotor;
    /** holding brake, N·m (hinge) or N (slider), applied whenever the motor is not driving: parking brake, spring-applied
     * hoist brake (holds through a power cut). Default: limited electric axes hold with their stall torque, others 0. */
    brake?: number;
    /** bearing / guide / seal friction, N·m or N. Default: rolling bearings under the part's weight plus gearbox loss. */
    friction?: number;
    /** air / fluid drag, N·m per (rad/s)², so drag torque = drag·ω². Default: windage of the part's swept outline. */
    drag?: number;
    /** road wheel: rolling-resistance coefficient on its axle load (car tyre 0.012, truck 0.008, gravel 0.03, tracks 0.05) */
    crr?: number;
    /** Driven through a belt, chain or gears by the nearest motorised hinge with a parallel axis (within 4 m), instead of
     * its own motor. ratio = driver speed / this speed. Belts slip above `slip` N·m (default 1.5× the driver's rated torque
     * × ratio); chains and gears snap above it (default 4×). Gears between parallel shafts turn the other way. */
    drivenBy?: { ratio: number; kind?: 'belt' | 'chain' | 'gear'; slip?: number };
    /**
     * Operator-less work cycle: the axis follows `keys` ([t s, position rad|m from the spawn pose]) round a loop of
     * `period` s (offset `phase`), through its own valve / drive at up to its flow-limited speed. Axes of one machine
     * sharing a period stay in step. `dig`: a bucket's heaped capacity, m³ — it digs the terrain while its lowest
     * point is under grade and tips the spoil at `dump` (a position). `thump`: position at which it strikes (a press).
     */
    cycle?: { period: number; keys: [number, number][]; phase?: number; dig?: number; dump?: number; thump?: number };
  };
  /** structure id, e.g. 'house' — used for grouping stats */
  group?: string;
  /**
   * Road vehicle chassis (the floor pan or frame that carries the suspension). Road wheels (`wheel`), crumple members and
   * the welded body beside it become one vehicle: raycast suspension, tyres, drivetrain, crumple zones, fluids.
   */
  vehicle?: { model: VehicleModel };
  /** road wheel of the vehicle whose chassis it sits beside (set noWeld): driven, steered (-1 = rear steer), parking brake */
  wheel?: { drive?: boolean; steer?: 1 | -1; park?: boolean; crr?: number };
  /**
   * Vehicle component. 'crumple' members weld only to each other and ride on the chassis through a plastic crush joint;
   * 'windscreen' is laminated (cracks and stays in the frame); 'fuel' is the tank.
   */
  vpart?: 'crumple' | 'windscreen' | 'fuel';
  /** How this member is connected to what it touches (overrides the connection inferred from the two materials and
   * the building's age); where both members carry one, the first spawned wins. */
  joint?: JointSpec;
  /** Years in service and exposure: corrosion, carbonation, degraded mortar. Set on every piece of a building. */
  age?: AgeSpec;
  /** Laminated member (FRP, plywood, glulam): plies fail one at a time and the bond between them can let go. */
  laminate?: { plies: number; fibre?: 'glass' | 'carbon' | 'wood' };
  /** lightning protection: an air terminal or down conductor, bonded through its welds to an earth electrode */
  lps?: boolean;
  /** lifting electromagnet (a live power member): rated lift, kg; attracts ferrous pieces while energised */
  magnet?: number;
  /** standby generator: starts through its transfer switch when the bus it is connected to loses its supply */
  standby?: boolean;
  /** lamp with its own battery (emergency / exit luminaire): stays lit this many hours after the supply fails */
  emergency?: number;
  /** a mobile crane's carrier: it stands on these outriggers and tips once the lift's moment carries the centre of
      gravity past the line of its jacks */
  outriggers?: boolean;
  /** material on a conveyor: taken off at `to` and fed back on at `from` (the line keeps working) */
  carry?: { from: Vec3; to: Vec3 };
}

/**
 * Mortar bed · bearing (plain contact, cast concrete) · anchor (rebar across a cast joint) · weld (fillet) · bolt · rivet ·
 * nail (or oak pegs) · screw · glue · solder · braze · press (interference fit) · mount (bonded rubber).
 */
export type JointKind = 'mortar' | 'bearing' | 'anchor' | 'weld' | 'bolt' | 'rivet' | 'nail' | 'screw' | 'glue' | 'solder' | 'braze' | 'press' | 'mount';

export interface JointSpec {
  kind?: JointKind;
  /** fasteners across the joint (bolts, rivets, nails, screws) */
  n?: number;
  /** fastener diameter, m */
  d?: number;
  /** bolt property class */
  grade?: '4.6' | '8.8' | '10.9';
  /** share of the design preload (0.8 × proof load) in the bolts: 1 torqued, ~0.2 snug-tight */
  preload?: number;
  /** thread engagement / diameter; under ~0.8 the threads strip before the bolt breaks */
  engage?: number;
  /** locking nut or thread-locker: vibration cannot back it off */
  lock?: boolean;
  /** fillet weld throat, m */
  throat?: number;
  /** EN 1993-1-9 detail category Δσc, MPa (fillet 71, butt 90, …) */
  detail?: number;
  adhesive?: 'pva' | 'epoxy' | 'pu' | 'prf' | 'silicone' | 'solvent' | 'starch';
  /** adhesive cure 0..1 at spawn (fresh glue gains strength over time) */
  cure?: number;
  /** tin-lead solder (183 °C) instead of lead-free (227 °C) */
  lead?: boolean;
}

export interface AgeSpec {
  years: number;
  /** ISO 9223 corrosivity: dry interior C1–C2, outdoor C3, wet (damp, industrial) C4, salt (marine, de-icing) C5 */
  exposure?: 'dry' | 'outdoor' | 'wet' | 'salt';
  /** hot-dip galvanised steelwork: the zinc goes first */
  galv?: boolean;
  /** concrete cover to the bars, m (default 0.03) */
  cover?: number;
}

export type VehicleModel = 'car' | 'van' | 'bus' | 'lorry' | 'dumptruck' | 'mixer' | 'crane' | 'forklift';

/**
 * A machine drive. `speed` (rad/s or m/s) and `force` (N·m or N) alone keep the old meaning — top speed and a force
 * limit — but now behave like the drive they stand for: engine-driven (`always`) as a pressure-compensated hydraulic
 * drive (full force up to a flow-limited speed), grid-powered as an induction motor whose stall torque is `force`.
 * Everything else is optional realism.
 */
export interface MechMotor {
  /** rated output speed, rad/s (hinge) or m/s (slider); its sign sets the initial direction */
  speed: number;
  /** torque (N·m) / force (N) limit; with `kW` it caps the gearbox (0 = no cap beyond the motor's own stall) */
  force: number;
  /** engine-driven: runs without grid power */
  always?: boolean;
  /** reverse at the limits (lift, press, slewing arm) */
  shuttle?: boolean;
  /** default: 'hydraulic' when `always` (or bore/cc/bar given), else 'electric' */
  drive?: 'electric' | 'diesel' | 'hydraulic';
  /** electric / diesel: rated shaft power, kW. Rated output torque = kW·η / speed (η 0.9 incl. gearbox). */
  kW?: number;
  /** motor / engine shaft speed, rpm (default electric 1480, diesel 1800) → gear ratio and reflected rotor inertia */
  rpm?: number;
  /** electric: breakdown (stall-region) torque / rated, default 2.5; diesel: peak torque / rated, default 1.3 */
  stall?: number;
  /** electric: rated slip (default 0.04 — large motors 0.01–0.02, small 0.05; DC/series traction 0.3+) */
  slip?: number;
  /** electric: seconds a locked rotor runs before the thermal overload trips (IEC 60947-4-1 class 10 → 10) */
  trip?: number;
  /** hydraulic cylinder bore and rod diameters, m (slider; hinge with `arm`) */
  bore?: number;
  rod?: number;
  /** hydraulic: relief pressure, bar (plant 250–350, industrial 160–210) */
  bar?: number;
  /** hydraulic: pump flow available to this actuator, L/min */
  lpm?: number;
  /** hydraulic hinge driven by a cylinder: lever arm, m (torque = p·A·arm) */
  arm?: number;
  /** hydraulic hinge driven by a rotary motor: displacement, cm³/rev */
  cc?: number;
  /** diesel: idle speed as a share of rated (default 0.35): lugged below it the engine stalls and restarts */
  idle?: number;
  /** diesel: fuel in the tank, L — the host's destruction spills it and it may burn */
  tank?: number;
}

export interface Blueprint {
  pieces: PieceSpec[];
  /** player start; default { pos: [0, 0, 26], yaw: 0 } — yaw 0 faces -Z */
  spawn?: { pos: Vec3; yaw: number };
  /** the site's ground (heightfield, surfacing, kerbs, walls, holes); default a flat plain at y = 0 */
  terrain?: import('./terrain/spec').TerrainSpec;
  /** render-only surroundings past the site fence: 'town' lays terraced streets out to the view's edge (default open
      country) */
  backdrop?: 'town';
}

export interface Contract {
  id: string;
  name: string;
  /** flavour line, e.g. "Harlow Street · 07:40" */
  location: string;
  brief: string;
  /** demolition fraction needed, 0..1 */
  target: number;
  /** par time, seconds */
  par: number;
  /** score needed for 2 and 3 stars; [0, 0] reckons them from the site's worth (main.ts starThresholds) */
  stars: [number, number];
  /** the tool in hand at the start: the one the job is mostly done with */
  primary?: WeaponId;
  /** -1 = unlimited; weapons missing from the record are not issued */
  ammo: Partial<Record<WeaponId, number>>;
  env: EnvPreset;
  build: () => Blueprint;
  protectedNote?: string;
  /** shown on first clear, e.g. "ROCKETS UNLOCKED" */
  unlockText?: string;
}

/* ---------------- UI view models ---------------- */

export type ScreenId = 'loading' | 'title' | 'contracts' | 'briefing' | 'pause' | 'results' | 'settings';

export interface WeaponView {
  id: WeaponId;
  name: string;
  /** -1 = unlimited */
  ammo: number;
  available: boolean;
  /** 0..1, 1 = ready */
  ready: number;
}

export interface HudState {
  demolition: number;          // 0..1
  target: number | null;       // null in sandbox
  score: number;
  combo: number;               // multiplier, 1 = none
  comboTime: number;           // 0..1 remaining combo window
  time: number;                // elapsed seconds
  par: number | null;
  weapon: WeaponId;
  weapons: WeaponView[];
  /** the tools on the number keys 1–6 (null: an empty slot) */
  slots: (WeaponId | null)[];
  /** the tool wheel has not been found yet: its hotbar chip asks to be tried */
  wheelNew?: boolean;
  /** free-play: 1 = real time */
  timeScale: number;
  chargesPlaced: number;
  penalty: number;
  /** transient contextual hint, e.g. "G / RMB — detonate 3 charges" */
  hint: string | null;
  fps: number;
  /** the working tool's live readout (progress, forces, temperatures), null when idle */
  tool: ToolReadout | null;
  /** demolition firing plan, shown while the detonator panel is out or a sequence is running */
  timeline: TimelineView | null;
}

export interface ToolReadout {
  title: string;
  /** 0..1, or null when the tool has no progress to show */
  progress: number | null;
  detail: string;
  warn: boolean;
  /** rigging lines: each loaded line's tension as a share of its breaking load, and where its working load limit sits
   *  on that scale (the HUD's tension bars) */
  lines?: { label: string; util: number; wll?: number }[];
}

export interface TimelineView {
  /** ms since the sequence was fired, null while planning */
  t: number | null;
  span: number;
  items: { delay: number; kind: 'charge' | 'cutter'; sel: boolean; fired: boolean }[];
}

export interface ContractCard {
  index: number;
  id: string;
  name: string;
  location: string;
  stars: number;   // earned, 0..3
  best: number;    // best score, 0 if never cleared
  locked: boolean;
}

export interface BriefingView {
  index: number;
  name: string;
  location: string;
  brief: string;
  target: number;
  par: number;
  stars: [number, number];
  ammo: { id: WeaponId; name: string; count: number }[];
  protectedNote?: string;
  env: EnvPreset;
}

export interface ResultsView {
  won: boolean;
  title: string;
  subtitle: string;
  rows: { label: string; value: number }[];
  total: number;
  stars: number;
  newBest: boolean;
  hasNext: boolean;
  unlockText?: string;
}

export interface Settings {
  volume: number;       // 0..1
  quality: Quality;
  sensitivity: number;  // 0.2..3, 1 = default
  fov: number;          // horizontal degrees at 16:9 (wider screens see more, Hor+), 70..120
  /** save migration marker: fov is horizontal */
  fovH?: boolean;
  invertY: boolean;
  /** loose barrels, propane and TNT placed around sandbox sites */
  explosives: boolean;
  shake: boolean;
  grain: boolean;
  aberration: boolean;
  /** fraction of the quality's pixel ratio, or 0 = dynamic (tracks a 60 fps frame-time target) */
  renderScale: number;
  /** walking head bob */
  headBob: boolean;
  /** crouch / sprint keys latch on a tap instead of acting while held */
  crouchToggle: boolean;
  sprintToggle: boolean;
  /** what falls and blows do to the player: 'off' a stagger at most, 'stumble' knockdowns, 'real' knockdowns and a
      blackout (respawn) at the extremes */
  impacts: 'off' | 'stumble' | 'real';
  /** key chosen per action (input.ts Action → KeyboardEvent.code); unset actions keep their default */
  keys: Record<string, string>;
  /** interface text size, 1 = as designed (0.8..1.5) */
  uiScale: number;
  /** state colours that do not rely on red against green (blue for good, orange for bad) */
  colorblind: boolean;
  /** dims blast and arc flashes, the blast vignette and the damage flash */
  reduceFlash: boolean;
  /** stills the HUD's own motion (bumps, slides, pulses) whatever the system setting */
  reduceMotion: boolean;
  /** the tool's controls under its readout: for the first few uses of each tool, always, or never */
  prompts: 'new' | 'always' | 'off';
}

export interface UiHandlers {
  onCampaign(): void;
  onSandbox(): void;
  /** second free-play site */
  onShowcase(): void;
  /** high-rise free-play map */
  onDowntown(): void;
  onPickContract(index: number): void;
  onStartContract(): void;
  onBack(): void;           // contracts → title, briefing → contracts, settings → previous
  onResume(): void;
  onRestart(): void;
  onQuit(): void;           // pause/results → title
  onNext(): void;           // results → next briefing
  onRetry(): void;
  onOpenSettings(): void;
  onSettingsChange(s: Settings): void;
  /** any first user gesture — used to unlock WebAudio */
  onUserGesture(): void;
  /** free-play panel (Tab) */
  onSandboxChange(s: SandboxSettings): void;
  onSandboxAction(a: SandboxAction): void;
  /** spawn palette (B): a prefab id to arm the placement tool, or null to cancel */
  onSpawnPick(id: string | null): void;
  /** a free-play overlay (panel/palette) closed and play should resume */
  onOverlayClosed(): void;
}

export interface SandboxSettings {
  timeScale: number;      // 1, 0.5, 0.25, 0.1
  gravity: number;        // multiplier 0.25..2
  jointStrength: number;  // multiplier 0.25..3 on every joint's capacity
  wind: number;           // 0..1 (1 = storm)
  fireSpread: boolean;
  debrisLimit: number;    // max fragments created by breakage (intact structure excluded) 600..4000
}

export type SandboxAction = 'quake' | 'clearDebris' | 'rebuild' | 'extinguish' | 'freezeAll' | 'unfreezeAll' | 'lightning' | 'storm';

export interface PrefabView {
  id: string;
  name: string;
  category: 'houses' | 'towers' | 'industrial' | 'infrastructure' | 'heritage' | 'props';
  pieces: number;
  /** footprint extents x, z in metres (for the placement preview) */
  footprint: [number, number];
}
