import type { RegionId, SystemId } from './semantic';

// This is one spatial interpretation. Moving a node never changes its content ID,
// semantic relationships, or Standard Website URL. Units are illustrative, not astronomical.
export type Vec3 = [number, number, number];
export interface ContentPlacement { contentId: string; position: Vec3; radius: number }
export interface SystemPlacement {
  id: SystemId;
  position: Vec3;
  contents: ContentPlacement[];
}
export interface GalaxyPlacement {
  id: RegionId;
  position: Vec3;
  radius: number;
  color: string;
  tilt: Vec3;
  seed: number;
  systems: SystemPlacement[];
}
const center = (contentId: string): ContentPlacement => ({ contentId, position: [0, 0, 0], radius: 1.05 });
const companion = (contentId: string, position: Vec3): ContentPlacement => ({ contentId, position, radius: 0.5 });
export const galaxies: GalaxyPlacement[] = [
  {
    id: 'research', position: [-130, 15, 0], radius: 88, color: '#b3cfc2', tilt: [0.38, 0.15, -0.25], seed: 31,
    systems: [
      { id: 'learning', position: [-47, 7, 22], contents: [center('deep-learning'), companion('reinforcement-learning', [6, 1, 3])] },
      { id: 'perception', position: [-20, 25, -31], contents: [center('multimodal-learning'), companion('vision-language-models', [6, -1, 2])] },
      { id: 'world', position: [30, 19, -17], contents: [center('world-models'), companion('embodied-intelligence', [5, 2, 4])] },
      { id: 'embodied', position: [48, -8, 28], contents: [center('embodied-intelligence'), companion('end-to-end-learning', [-5, 1, 4])] },
      { id: 'agency', position: [0, -17, 47], contents: [center('agents-reasoning'), companion('reinforcement-learning', [-6, 0, 3])] },
      { id: 'integrated', position: [-48, -14, -32], contents: [center('end-to-end-learning'), companion('deep-learning', [5, -1, 4])] },
    ],
  },
  {
    id: 'building', position: [145, -20, -65], radius: 70, color: '#d8b48a', tilt: [0.65, -0.35, 0.4], seed: 71,
    systems: [
      { id: 'alphazero', position: [-24, 6, 18], contents: [center('alphazero'), companion('reinforcement-learning', [6, 1, 3]), companion('deep-learning', [-5, -1, -3])] },
      { id: 'mnist', position: [28, -3, -20], contents: [center('mnist'), companion('deep-learning', [-5, 1, 4])] },
    ],
  },
];
export const overview = { target: [0, 0, -15] as Vec3, offset: [0, 125, 510] as Vec3 };
export const cameraOffsets = {
  galaxy: [0, 52, 195] as Vec3,
  system: [0, 8, 31] as Vec3,
  content: [0, 2.3, 7.2] as Vec3,
};
