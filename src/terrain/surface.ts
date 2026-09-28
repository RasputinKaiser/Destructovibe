import { SURFACES, type SurfaceId } from './spec.ts';

export { SURFACES, type SurfaceId };

export interface SurfaceProps {
  /** tyre peak friction, dry */
  mu: number;
  /** solver friction of the ground contact */
  friction: number;
  /** footstep / impact audio class */
  audio: 'dirt' | 'concrete' | 'wood' | 'metal';
  /** dust and ejecta colour */
  dust: number;
  /** crater size factor: bound pavements resist a surface burst, loose soil throws furthest */
  crater: number;
  /** water soaks away (open ground) */
  soaks: boolean;
}

export const SURFACE: Record<SurfaceId, SurfaceProps> = {
  asphalt: { mu: 0.9, friction: 0.85, audio: 'concrete', dust: 0x3f3d3a, crater: 0.6, soaks: false },
  concrete: { mu: 0.8, friction: 0.8, audio: 'concrete', dust: 0x9d9a92, crater: 0.45, soaks: false },
  paving: { mu: 0.78, friction: 0.8, audio: 'concrete', dust: 0xa9a59b, crater: 0.7, soaks: false },
  setts: { mu: 0.7, friction: 0.75, audio: 'concrete', dust: 0x8a847c, crater: 0.65, soaks: false },
  gravel: { mu: 0.6, friction: 0.75, audio: 'dirt', dust: 0x8f887a, crater: 0.95, soaks: true },
  grass: { mu: 0.55, friction: 0.7, audio: 'dirt', dust: 0x5e4c3a, crater: 1, soaks: true },
  soil: { mu: 0.5, friction: 0.7, audio: 'dirt', dust: 0x6b543e, crater: 1.05, soaks: true },
  rubble: { mu: 0.6, friction: 0.8, audio: 'dirt', dust: 0x8a8278, crater: 0.9, soaks: true },
};

export const surfaceIndex = (s: SurfaceId): number => SURFACES.indexOf(s);
