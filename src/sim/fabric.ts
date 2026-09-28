import type { PieceSpec } from '../types';

export type SoftSpec = NonNullable<PieceSpec['soft']>;
export type SoftKind = SoftSpec['kind'];
export type FabricId = NonNullable<SoftSpec['fabric']>;

/* Units: sheets kg/m², ropes kg/m, bulk (softbody/granular) kg/m³. Compliances are XPBD α (m/N, or the
   isometric-bending equivalent); at 240 Hz substeps fabric is so light that stretch is effectively
   inextensible, so they mostly shape bending and shear. */
export interface Fabric {
  density: number;
  /** grid spacing, m */
  res: number;
  /** collision radius / half thickness, m */
  radius: number;
  stretch: number;
  shear: number;
  bend: number;
  /** strain at which a cell rips (rope: segment) */
  strain: number;
  /** default pin pull-out / rope break force, N */
  tear: number;
  /** strip tensile strength, N per metre width: governs blast shredding */
  tensile: number;
  friction: number;
  /** share of the area that is solid to wind (netting lets most through) */
  solidity: number;
  /** piloted ignition, °C (undefined: does not burn) */
  ignite?: number;
  /** seconds a spot takes to burn through once alight */
  burn: number;
  /** flame spread along the surface, m/s (upward runs ~3× faster) */
  spread: number;
  tint: number;
  /** render: roughness, sheen, see-through weave (0..1), weave frequency (1/m) */
  look: [number, number, number, number];
  /** granular: static friction (sets the angle of repose), cohesion 0..1 */
  cohesion?: number;
  /** softbody: shape-matching stiffness per substep */
  shape?: number;
  /** bulk contact modulus for pieces resting on it, Pa (foam, packed grain) */
  bulk?: number;
  /** woven sheets: stretch compliance along the warp (v, down the sheet) and weft (u); the bias is `shear` */
  warp?: number;
  weft?: number;
  /** woven: a tear runs along the yarns, and torn edges fray */
  weave?: boolean;
  /** sewn panel width, m (sheets wider than this are joined by seams) */
  panel?: number;
  /** seam / membrane burst strength, N per metre of seam */
  seam?: number;
  /** membranes: rest edges are the authored size over this (latex is stretched when inflated) */
  prestretch?: number;
  /** membranes: tension share of `seam` above which any hole runs and the membrane pops (latex) */
  pop?: number;
  /** creased board / paper: a hinge folded past this (isometric bending residual per unit edge) creases for good */
  crease?: number;
  /** plastic shape matching: deviation from the goal, m, beyond which the rest shape yields */
  plastic?: number;
  /** boxes: crush strength per metre of box perimeter, N/m (box compression ≈ this × perimeter) */
  crush?: number;
}

export const FABRICS: Record<FabricId, Fabric> = {
  // heavy cotton duck (awnings, market stalls)
  canvas: { density: 0.45, res: 0.2, radius: 0.025, stretch: 2e-6, warp: 1.5e-6, weft: 4e-6, shear: 2e-4, bend: 0.004, strain: 0.55, tear: 900, tensile: 30e3, friction: 0.6, solidity: 1, ignite: 360, burn: 9, spread: 0.05, tint: 0xc9b98f, look: [0.9, 0.05, 0, 260], weave: true, panel: 1.0, seam: 14e3 },
  // curtains, bedsheets
  cotton: { density: 0.16, res: 0.15, radius: 0.02, stretch: 5e-6, warp: 4e-6, weft: 1e-5, shear: 1e-3, bend: 0.05, strain: 0.45, tear: 160, tensile: 5e3, friction: 0.55, solidity: 1, ignite: 260, burn: 4, spread: 0.12, tint: 0xe8e2d4, look: [0.85, 0.12, 0, 520], weave: true, panel: 1.4, seam: 2.2e3 },
  velvet: { density: 0.38, res: 0.15, radius: 0.025, stretch: 5e-6, warp: 4e-6, weft: 8e-6, shear: 6e-4, bend: 0.02, strain: 0.45, tear: 220, tensile: 6e3, friction: 0.7, solidity: 1, ignite: 300, burn: 6, spread: 0.08, tint: 0x6e1f2a, look: [0.75, 1, 0, 0], weave: true, panel: 1.4, seam: 2.8e3 },
  // polyester flags and banners: light, flutters, melts back rather than flaming for long
  poly: { density: 0.12, res: 0.15, radius: 0.015, stretch: 4e-6, warp: 3e-6, weft: 6e-6, shear: 6e-4, bend: 0.03, strain: 0.5, tear: 250, tensile: 8e3, friction: 0.4, solidity: 1, ignite: 420, burn: 2.5, spread: 0.06, tint: 0xd8dde6, look: [0.55, 0.2, 0, 700], weave: true, panel: 1.2, seam: 3.5e3 },
  // HDPE debris / safety netting
  mesh: { density: 0.09, res: 0.25, radius: 0.03, stretch: 4e-5, shear: 2e-3, bend: 0.2, strain: 0.9, tear: 3000, tensile: 4e3, friction: 0.5, solidity: 0.45, ignite: 350, burn: 3, spread: 0.07, tint: 0x3f7a52, look: [0.7, 0, 0.55, 22] },
  // PVC-coated polyester sheeting (scaffold wrap, lorry tarp)
  tarp: { density: 0.6, res: 0.3, radius: 0.03, stretch: 2e-6, warp: 2e-6, weft: 3e-6, shear: 1e-4, bend: 0.006, strain: 0.6, tear: 1600, tensile: 22e3, friction: 0.45, solidity: 1, ignite: 400, burn: 5, spread: 0.05, tint: 0x2f5f93, look: [0.35, 0.05, 0, 0], weave: true, panel: 2.0, seam: 12e3 },
  // polyurethane foam (mattresses, cushions)
  foam: { density: 35, res: 0.14, radius: 0.07, stretch: 2e-4, shear: 4e-4, bend: 0, strain: 2, tear: 400, tensile: 2e3, friction: 0.8, solidity: 1, ignite: 370, burn: 14, spread: 0.02, tint: 0xe9e4d8, look: [0.9, 0.3, 0, 300], shape: 0.15, bulk: 2.5e4 },
  // bulk grains: density is the bulk (poured) density
  sand: { density: 1600, res: 0.11, radius: 0.055, stretch: 0, shear: 0, bend: 0, strain: 0.35, tear: 600, tensile: 8e3, friction: 1.0, solidity: 1, burn: 0, spread: 0, tint: 0xcdb487, look: [1, 0, 0, 0], cohesion: 0.03, shape: 0.2, bulk: 4e5 },
  gravel: { density: 1700, res: 0.13, radius: 0.065, stretch: 0, shear: 0, bend: 0, strain: 0.35, tear: 600, tensile: 8e3, friction: 1.1, solidity: 1, burn: 0, spread: 0, tint: 0x8d8a84, look: [0.95, 0, 0, 0], cohesion: 0, shape: 0.2, bulk: 6e5 },
  soil: { density: 1300, res: 0.12, radius: 0.06, stretch: 0, shear: 0, bend: 0, strain: 0.35, tear: 600, tensile: 8e3, friction: 0.9, solidity: 1, burn: 0, spread: 0, tint: 0x5b4634, look: [1, 0, 0, 0], cohesion: 0.18, shape: 0.2, bulk: 2e5 },
  // ropes: density per metre
  hemp: { density: 0.11, res: 0.12, radius: 0.012, stretch: 1e-6, shear: 0, bend: 0.02, strain: 0.4, tear: 9e3, tensile: 0, friction: 0.7, solidity: 1, ignite: 300, burn: 12, spread: 0.04, tint: 0xb59a6a, look: [0.95, 0, 0, 90] },
  steelwire: { density: 0.55, res: 0.15, radius: 0.008, stretch: 1e-8, shear: 0, bend: 0.002, strain: 0.3, tear: 80e3, tensile: 0, friction: 0.25, solidity: 1, burn: 0, spread: 0, tint: 0x8c9096, look: [0.35, 0, 0, 200] },
  // loose yarn frayed from a torn edge
  thread: { density: 0.004, res: 0.025, radius: 0.003, stretch: 1e-6, shear: 0, bend: 0.5, strain: 2, tear: 5, tensile: 0, friction: 0.5, solidity: 1, ignite: 260, burn: 1, spread: 0.1, tint: 0xe8e2d4, look: [0.9, 0, 0, 0] },
  /* membranes: the gas carries them, so they have no bending stiffness of their own. Latex is blown up to its
     strain-stiffening limit, so a little more gas or heat raises the pressure fast, and it pops from any tear. */
  latex: { density: 0.012, res: 0.07, radius: 0.012, stretch: 0, shear: 0, bend: 0, strain: 0.9, tear: 30, tensile: 900, friction: 0.8, solidity: 0.5, ignite: 300, burn: 1.5, spread: 0.15, tint: 0xd23a3a, look: [0.3, 0.15, 0, 0], seam: 1100, prestretch: 2.5, pop: 0.1 },
  // PVC-coated polyester inflatable fabric (air domes, bouncy castles)
  pvc: { density: 0.9, res: 0.35, radius: 0.03, stretch: 2e-6, shear: 2e-4, bend: 0, strain: 0.35, tear: 2500, tensile: 40e3, friction: 0.5, solidity: 0.5, ignite: 400, burn: 6, spread: 0.04, tint: 0xe9e9e4, look: [0.45, 0.05, 0, 0], seam: 25e3 },
  // kraft paper over a PE liner: inflatable dunnage bags
  kraft: { density: 0.35, res: 0.15, radius: 0.02, stretch: 1e-6, shear: 5e-5, bend: 0, strain: 0.12, tear: 800, tensile: 12e3, friction: 0.7, solidity: 0.5, ignite: 250, burn: 3, spread: 0.12, tint: 0xa98a5c, look: [0.95, 0, 0, 0], seam: 5e3 },
  /* single-wall corrugated board: stiff faces hinged at creases; it yields for good when crushed */
  cardboard: { density: 0.55, res: 0.1, radius: 0.012, stretch: 2e-7, shear: 2e-6, bend: 1e-5, strain: 0.08, tear: 300, tensile: 6e3, friction: 0.6, solidity: 1, ignite: 260, burn: 3, spread: 0.18, tint: 0xb48a58, look: [0.95, 0, 0, 0], shape: 0.3, bulk: 7e4, crease: 0.12, plastic: 0.012, crush: 1600 },
  // office paper (80 g/m²): flutters, creases, burns in seconds
  paper: { density: 0.08, res: 0.07, radius: 0.004, stretch: 1e-6, shear: 2e-5, bend: 0.02, strain: 0.08, tear: 20, tensile: 4e3, friction: 0.4, solidity: 1, ignite: 230, burn: 1.2, spread: 0.2, tint: 0xf4f2ec, look: [0.9, 0, 0, 0], crease: 0.3 },
};

export const DEFAULT_FABRIC: Record<SoftKind, FabricId> = {
  cloth: 'cotton', net: 'mesh', rope: 'hemp', softbody: 'foam', granular: 'sand', balloon: 'latex', inflatable: 'pvc', dome: 'pvc', carton: 'cardboard', paper: 'paper',
};

/** pressurised membrane kinds */
export const PRESSURE_KINDS = new Set<SoftKind>(['balloon', 'inflatable', 'dome']);
/** kinds made of a surface mesh (cells are quads; aero, tearing and burning act per cell) */
export const SHEET_KINDS = new Set<SoftKind>(['cloth', 'net', 'balloon', 'inflatable', 'dome', 'carton', 'paper']);

export const GRAIN_FABRICS = new Set<FabricId>(['sand', 'gravel', 'soil']);

/** angle of repose each grain fabric settles at, degrees (heaps are authored at it) */
export const REPOSE: Partial<Record<FabricId, number>> = { sand: 34, gravel: 38, soil: 40 };
